/**
 * Utilitas bersama ujian & kuis — SATU sumber kebenaran untuk format
 * tanggal, perhitungan waktu efektif, dan status/warna badge card.
 * Dipakai oleh: ExamCard + adaptor (DailyExamCard / OfficialExamCard /
 * QuizCard) + halaman guru & admin. Jangan mendefinisikan salinan lokal
 * di halaman — itulah sumber inkonsistensi antar role.
 *
 * Model waktu (jangan tertukar):
 * - ULANGAN & UTS/UAS: serentak (mulai + durasi) atau jendela
 *   (start_time → window_end_time). Akhir = getEffectiveEndTime().
 * - KUIS: jendela per-siswa (available_from → deadline, keduanya
 *   opsional) + durasi per-siswa SETELAH mulai — TIDAK memakai
 *   getEffectiveEndTime (lihat src/lib/examExpiry.ts).
 */

// ─── Status ───

export interface ExamStatusInfo {
    label: string
    color: string
    /** Sedang berlangsung sekarang (hanya ujian serentak/jendela — kuis tidak punya konsep live) */
    isLive: boolean
    /** Waktu sudah habis (Selesai / Berakhir) */
    isDone: boolean
}

export const STATUS_COLORS = {
    underReview: 'bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-500/20 dark:text-amber-400 font-bold',
    draft: 'bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-500/20 dark:text-amber-400',
    scheduled: 'bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-500/20 dark:text-blue-400',
    live: 'bg-green-500/10 text-green-600 border-green-200 dark:border-green-500/20 dark:text-green-400',
    done: 'bg-secondary/10 text-text-secondary border-secondary/20',
} as const

// ─── Format tanggal (id-ID) ───

export const formatDate = (dateString: string): string =>
    new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })

export const formatDateTime = (dateString: string): string =>
    new Date(dateString).toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })

// ─── Waktu efektif ujian (ulangan & UTS/UAS — BUKAN kuis) ───

export interface ExamTimeFields {
    start_time: string
    window_end_time?: string | null
    duration_minutes: number
}

/**
 * Akhir efektif ujian:
 * mode jendela = jam tutup (window_end_time);
 * mode serentak = start_time + duration_minutes.
 */
export function getEffectiveEndTime(exam: ExamTimeFields): string {
    return exam.window_end_time
        ?? new Date(new Date(exam.start_time).getTime() + exam.duration_minutes * 60000).toISOString()
}

/** Label jadwal card ujian: mode jendela vs mode serentak. */
export function examScheduleLabels(windowEndTime?: string | null): { start: string; end: string } {
    return windowEndTime
        ? { start: 'Dibuka', end: 'Ditutup' }
        : { start: 'Waktu Mulai', end: 'Waktu Selesai' }
}

// ─── Status ujian ───

/** Status ulangan harian: Under Review → Draft → Terjadwal → Berlangsung → Selesai. */
export function getExamStatus(exam: ExamTimeFields & {
    is_active?: boolean | null
    pending_publish?: boolean | null
}): ExamStatusInfo {
    if (exam.pending_publish) {
        return { label: '🔍 Under Review', color: STATUS_COLORS.underReview, isLive: false, isDone: false }
    }
    return getOfficialExamStatus(exam)
}

/** Status UTS/UAS: Draft → Terjadwal → Berlangsung → Selesai (tanpa Under Review). */
export function getOfficialExamStatus(exam: ExamTimeFields & {
    is_active?: boolean | null
}): ExamStatusInfo {
    const now = Date.now()
    const start = new Date(exam.start_time).getTime()
    const end = new Date(getEffectiveEndTime(exam)).getTime()

    if (!exam.is_active) return { label: 'Draft', color: STATUS_COLORS.draft, isLive: false, isDone: false }
    if (now < start) return { label: 'Terjadwal', color: STATUS_COLORS.scheduled, isLive: false, isDone: false }
    if (now <= end) return { label: 'Berlangsung', color: STATUS_COLORS.live, isLive: true, isDone: false }
    return { label: 'Selesai', color: STATUS_COLORS.done, isLive: false, isDone: true }
}

/**
 * Status kuis: Under Review → Draft → Aktif → Berakhir (deadline lewat).
 * Tanpa deadline kuis tidak pernah "Berakhir" (siswa bisa mengerjakan
 * kapan saja selama aktif).
 */
export function getQuizStatus(quiz: {
    is_active?: boolean | null
    pending_publish?: boolean | null
    deadline?: string | null
}): ExamStatusInfo {
    if (quiz.pending_publish) {
        return { label: '🔍 Under Review', color: STATUS_COLORS.underReview, isLive: false, isDone: false }
    }
    if (!quiz.is_active) return { label: 'Draft', color: STATUS_COLORS.draft, isLive: false, isDone: false }
    if (quiz.deadline && Date.now() > new Date(quiz.deadline).getTime()) {
        return { label: 'Berakhir', color: STATUS_COLORS.done, isLive: false, isDone: true }
    }
    return { label: 'Aktif', color: STATUS_COLORS.live, isLive: false, isDone: false }
}

// ─── Badge jenis ujian (satu definisi warna untuk semua role) ───

export const TYPE_BADGE_STYLES = {
    ulangan: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20',
    uts: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20',
    uas: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20',
    kuis: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/20',
} as const

/**
 * Badge jenis siap-pakai untuk ExamCard. Label yang dikembalikan adalah
 * nilai KANONIK ('ULANGAN' | 'UTS' | 'UAS' | 'KUIS') — ExamCard yang
 * memetakan ke label kustom sekolah via labelForGradeType (sekali saja,
 * jangan dipetakan dua kali).
 */
export function typeBadgeFor(type: keyof typeof TYPE_BADGE_STYLES) {
    return {
        label: type.toUpperCase(),
        className: TYPE_BADGE_STYLES[type],
    }
}

// ─── Helper embed PostgREST ───

/**
 * PostgREST kadang mengembalikan embed sebagai array (FK ambigu) —
 * ambil elemen pertama. Embed tunggal tetap dikembalikan apa adanya.
 */
export function unwrapEmbed<T>(value: T | T[] | null | undefined): T | null | undefined {
    return Array.isArray(value) ? value[0] : value
}
