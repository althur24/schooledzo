/**
 * examExpiry.ts — satu-satunya sumber kebenaran untuk batas waktu pengerjaan.
 *
 * Semantik (disetujui user, lihat TIME_ENFORCEMENT_UPGRADE_PLAN.md):
 *  - ULANGAN & UTS/UAS: JENDELA GLOBAL — semua siswa selesai serentak di
 *    start_time + duration_minutes. Siswa telat mulai mendapat sisa jendela.
 *    Pengecualian: Hard Reset guru/admin mengisi timer_override_until
 *    (= waktu reset + durasi) → siswa itu dapat durasi penuh baru.
 *  - KUIS: per-student started_at + duration_minutes, dibatasi deadline kuis.
 *  - duration_minutes null/0 → tanpa batas waktu (enforcement di-skip).
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
 * ULANGAN / UTS-UAS — jendela global + override hard reset.
 * endAt = max(start_time + durasi, timer_override_until).
 * Fallback: start_time null → per-student started_at + durasi (data tak lengkap).
 */
export function resolveWindowExpiry(parent: WindowParent, submission: WindowSubmission): Expiry {
    const durationMs = (parent.duration_minutes || 0) * 60_000
    if (durationMs <= 0) return { limited: false }

    const startMs = toMs(parent.start_time)
    const startedMs = toMs(submission.started_at)
    const overrideMs = toMs(submission.timer_override_until)

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
