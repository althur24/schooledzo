/**
 * extendExamTime — perpanjangan waktu pengerjaan ujian oleh guru/admin
 * (fitur "Tambah Waktu" di Monitor Live, insiden lagging 29 Sep 2026).
 *
 * Semantik (disetujui user): "N menit tambahan dihitung dari
 * max(batas efektif lama, sekarang)" per siswa yang SEDANG mengerjakan —
 * menjamin tiap siswa aktif mendapat minimal N menit dari sekarang,
 * dan tidak ada siswa yang batasnya terPOTONG (semantik max, bukan replace).
 * Stackable: extend +10 lalu +5 = +15 dari batas terkini.
 *
 * Mekanisme (satu sumber kebenaran resolveWindowExpiry — semua jalur
 * write-gate / sweep / monitor / resume membaca hasilnya otomatis):
 *  1. PER-SISWA: submission is_submitted=false & started_at terisi →
 *     timer_override_until = max(batasEfektifLama, now) + N. (Field yang
 *     SUDAH ADA — dipakai hard reset; override dihormati resolveWindowExpiry
 *     di kedua mode, tidak dipotong jam tutup.)
 *  2. LEVEL-UJIAN:
 *     - Mode jendela (window_end_time terisi): jam tutup digeser ke
 *       max(jamTutupLama, now) + N → siswa BELUM MULAI ikut diuntungkan.
 *       (Durasi TIDAK diubah — siswa yang sudah mengerjakan ditangani
 *       override per-siswa di atas.)
 *     - Mode serentak (window NULL): duration_minutes += N → akhir serentak
 *       (start + durasi) tergeser untuk semua, termasuk siswa belum mulai
 *       (gate mulai membaca baris exam segar). Konsisten dengan override
 *       per-siswa: max(start+durBaru, override) — keduanya sama-sama +N.
 *  3. Submission yang sudah submit / ditutup sweep TIDAK disentuh
 *     (jalurnya: Hard Reset per siswa, yang sudah ada).
 *
 * Ujian tanpa batas (durasi 0/null & tanpa jendela) tidak bisa diperpanjang.
 */

import { supabaseAdmin as supabase } from './supabase'
import { resolveWindowExpiry, type WindowParent, type WindowSubmission } from './examExpiry'

export const EXTEND_MIN_MINUTES = 1
export const EXTEND_MAX_MINUTES = 120

export interface ExtendTimeResult {
    /** Jumlah submission is_submitted=false yang di-override (siswa sedang mengerjakan). */
    extended: number
    /** true bila jam tutup jendela digeser (mode jendela). */
    window_shifted: boolean
    /** Jam tutup baru (mode jendela; null bila tidak digeser). */
    new_window_end_time: string | null
    /** Durasi baru (mode serentak; null bila tidak diubah). */
    new_duration_minutes: number | null
}

export interface ExtendableExamRow {
    id: string
    start_time: string | null
    duration_minutes: number | null
    window_end_time: string | null
}

const toMs = (iso: string | null | undefined): number | null => {
    if (!iso) return null
    const t = new Date(iso).getTime()
    return Number.isFinite(t) ? t : null
}

/** Validasi input menit (bulat, 1..120). Mengembalikan pesan error atau null bila valid. */
export function validateExtendMinutes(minutes: unknown): string | null {
    const n = Number(minutes)
    if (!Number.isInteger(n) || n < EXTEND_MIN_MINUTES || n > EXTEND_MAX_MINUTES) {
        return `additional_minutes harus bilangan bulat ${EXTEND_MIN_MINUTES}–${EXTEND_MAX_MINUTES}`
    }
    return null
}

/**
 * Terapkan perpanjangan +N menit untuk SATU ujian (sudah lolos guard di route).
 * Kind menentukan tabel submissions + tabel ujian (ulangan vs UTS/UAS —
 * skema kolom identik). Idempoten-aman dipanggil ulang (semantik max + stackable).
 */
export async function extendTimeForExam(
    kind: 'exam' | 'official',
    exam: ExtendableExamRow,
    minutes: number,
    now: number = Date.now(),
): Promise<ExtendTimeResult> {
    const subsTable = kind === 'exam' ? 'exam_submissions' : 'official_exam_submissions'
    const examTable = kind === 'exam' ? 'exams' : 'official_exams'

    const parent: WindowParent = {
        start_time: exam.start_time,
        duration_minutes: exam.duration_minutes,
        window_end_time: exam.window_end_time,
    }

    // ── 1. Level-ujian ──────────────────────────────────────────────
    let windowShifted = false
    let newWindowEndIso: string | null = null
    let newDuration: number | null = null

    const windowMs = toMs(exam.window_end_time)
    const duration = exam.duration_minutes || 0

    if (windowMs !== null) {
        // Mode jendela: geser jam tutup (siswa belum mulai diuntungkan)
        const newWindowMs = Math.max(windowMs, now) + minutes * 60_000
        newWindowEndIso = new Date(newWindowMs).toISOString()
        windowShifted = true
        const { error: examErr } = await supabase
            .from(examTable)
            .update({ window_end_time: newWindowEndIso })
            .eq('id', exam.id)
        if (examErr) throw examErr
    } else if (duration > 0) {
        // Mode serentak: durasi += N (akhir = start + durasi; semua tergeser)
        newDuration = duration + minutes
        const { error: examErr } = await supabase
            .from(examTable)
            .update({ duration_minutes: newDuration })
            .eq('id', exam.id)
        if (examErr) throw examErr
    } else {
        // Tanpa batas waktu — tidak ada yang bisa/ perlu diperpanjang
        return { extended: 0, window_shifted: false, new_window_end_time: null, new_duration_minutes: null }
    }

    // ── 2. Per-siswa: override semua yang sedang mengerjakan ────────
    const { data: working, error: subsErr } = await supabase
        .from(subsTable)
        .select('id, started_at, timer_override_until')
        .eq('exam_id', exam.id)
        .eq('is_submitted', false)
        .not('started_at', 'is', null)
    if (subsErr) throw subsErr

    let extended = 0
    if (working && working.length > 0) {
        // Hitung batas baru per siswa → kelompokkan per NILAI (di mode serentak
        // nilainya seragam → 1 UPDATE .in() untuk banyak siswa; mode jendela
        // per-siswa unik). Chunk 100 id per UPDATE (batas URL).
        const byValue = new Map<string, string[]>()
        for (const sub of working as (WindowSubmission & { id: string })[]) {
            const eff = resolveWindowExpiry(parent, sub)
            const baseMs = eff.limited ? Math.max(eff.endAt, now) : now
            const newOverrideMs = baseMs + minutes * 60_000
            const iso = new Date(newOverrideMs).toISOString()
            const list = byValue.get(iso) || []
            list.push(sub.id)
            byValue.set(iso, list)
        }
        for (const [iso, ids] of byValue) {
            for (let i = 0; i < ids.length; i += 100) {
                const chunk = ids.slice(i, i + 100)
                const { error: updErr } = await supabase
                    .from(subsTable)
                    .update({ timer_override_until: iso })
                    .in('id', chunk)
                if (updErr) throw updErr
                extended += chunk.length
            }
        }
    }

    return {
        extended,
        window_shifted: windowShifted,
        new_window_end_time: newWindowEndIso,
        new_duration_minutes: newDuration,
    }
}
