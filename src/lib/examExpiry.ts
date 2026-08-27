/**
 * examExpiry.ts — satu-satunya sumber kebenaran untuk batas waktu pengerjaan.
 *
 * Semantik (disetujui user, lihat TIME_ENFORCEMENT_UPGRADE_PLAN.md):
 *  - ULANGAN & UTS/UAS mode SERENTAK (window_end_time NULL): semua siswa
 *    selesai serentak di start_time + duration_minutes. Siswa telat mulai
 *    mendapat sisa jendela. Hard Reset mengisi timer_override_until
 *    (= waktu reset + durasi) → siswa itu dapat durasi penuh baru.
 *  - ULANGAN & UTS/UAS mode JENDELA (window_end_time terisi): siswa boleh
 *    mulai kapan saja antara start_time (jam buka) dan window_end_time
 *    (jam tutup). Setelah mulai: endAt = min(started_at + durasi,
 *    window_end_time) — dipotong di jam tutup. Pengecualian Hard Reset
 *    (timer_override_until): override tidak dipotong jam tutup — guru/admin
 *    secara eksplisit memberi durasi penuh baru.
 *  - KUIS: per-student started_at + duration_minutes, dibatasi deadline kuis;
 *    available_from hanya menggerbang attempt BARU (tidak di sini — di route).
 *  - duration_minutes null/0 → tanpa batas waktu (enforcement di-skip);
 *    mode jendela tanpa durasi → selesai paling lambat jam tutup.
 *
 * Dipakai oleh: endpoint write (exam/quiz/official-exam submissions),
 * cabang reset_attempt, sweep aktif scheduler, dan lazy sweep lama.
 */

export const WRITE_GRACE_MS = 60_000 // toleransi jaringan/autosave utk write & submit
export const SWEEP_BUFFER_MS = 120_000 // sweep menutup submission lewat batas + buffer ini

export type Expiry = { limited: false } | { limited: true; endAt: number }

export interface WindowParent {
    start_time: string | null
    duration_minutes: number | null
    /** Jam tutup jendela (mode jendela waktu). NULL = mode serentak lama. */
    window_end_time?: string | null
}

export interface WindowSubmission {
    started_at: string | null
    timer_override_until?: string | null
}

export interface QuizParent {
    deadline: string | null
    duration_minutes: number | null
}

export interface QuizSubmission {
    started_at: string | null
}

const toMs = (iso: string | null | undefined): number | null => {
    if (!iso) return null
    const t = new Date(iso).getTime()
    return Number.isFinite(t) ? t : null
}

/**
 * ULANGAN / UTS-UAS — dua mode:
 *  - Mode serentak (window_end_time NULL): endAt = max(start_time + durasi,
 *    timer_override_until). Siswa telat mulai mendapat sisa jendela.
 *  - Mode jendela (window_end_time terisi): endAt = min(started_at + durasi,
 *    window_end_time) — mulai alami dipotong jam tutup. Pengecualian Hard Reset
 *    (timer_override_until terisi): endAt = override, TIDAK dipotong jam tutup —
 *    selaras mode serentak, karena reset adalah keputusan eksplisit guru/admin
 *    memberi durasi penuh baru (memotongnya membuat reset setelah jam tutup
 *    memberi siswa 0 waktu).
 *    Tanpa durasi → selesai di jam tutup.
 * Fallback: start_time null → per-student started_at + durasi (data tak lengkap).
 */
export function resolveWindowExpiry(parent: WindowParent, submission: WindowSubmission): Expiry {
    const durationMs = (parent.duration_minutes || 0) * 60_000
    const windowCloseMs = toMs(parent.window_end_time)

    const startMs = toMs(parent.start_time)
    const startedMs = toMs(submission.started_at)
    const overrideMs = toMs(submission.timer_override_until)

    // Mode jendela: mulai alami dipotong jam tutup; hard reset = pengecualian guru
    if (windowCloseMs !== null) {
        if (overrideMs !== null) return { limited: true, endAt: overrideMs }
        const perStudentMs = durationMs > 0 && startedMs !== null ? startedMs + durationMs : null
        const candidates = [perStudentMs, windowCloseMs].filter((v): v is number => v !== null)
        if (candidates.length === 0) return { limited: false }
        return { limited: true, endAt: Math.min(...candidates) }
    }

    // Mode serentak (lama) — perilaku tidak berubah
    if (durationMs <= 0) return { limited: false }

    let windowEnd: number | null = null
    if (startMs !== null) windowEnd = startMs + durationMs
    else if (startedMs !== null) windowEnd = startedMs + durationMs // fallback data tak lengkap

    const candidates = [windowEnd, overrideMs].filter((v): v is number => v !== null)
    if (candidates.length === 0) return { limited: false }
    return { limited: true, endAt: Math.max(...candidates) }
}

/**
 * KUIS — per-student, dibatasi deadline.
 * endAt = min(started_at + durasi, deadline); salah satu boleh tidak ada.
 */
export function resolveQuizExpiry(parent: QuizParent, submission: QuizSubmission): Expiry {
    const durationMs = (parent.duration_minutes || 0) * 60_000
    const startedMs = toMs(submission.started_at)
    const perStudentMs = durationMs > 0 && startedMs !== null ? startedMs + durationMs : null
    const deadlineMs = toMs(parent.deadline)

    const candidates = [perStudentMs, deadlineMs].filter((v): v is number => v !== null)
    if (candidates.length === 0) return { limited: false }
    return { limited: true, endAt: Math.min(...candidates) }
}

/** Write (save/submit) masih diterima sampai endAt + WRITE_GRACE_MS. */
export function isWriteAllowed(expiry: Expiry, now: number = Date.now()): boolean {
    if (!expiry.limited) return true
    return now <= expiry.endAt + WRITE_GRACE_MS
}

/** Sweep boleh menutup submission: lewat endAt + SWEEP_BUFFER_MS. */
export function isSweepDue(expiry: Expiry, now: number = Date.now()): boolean {
    return expiry.limited && now > expiry.endAt + SWEEP_BUFFER_MS
}

/** Untuk kontrak response start/resume: batas efektif sebagai ISO string (null = tanpa batas). */
export function endsAtIso(expiry: Expiry): string | null {
    return expiry.limited ? new Date(expiry.endAt).toISOString() : null
}
