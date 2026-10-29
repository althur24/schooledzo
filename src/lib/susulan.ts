/**
 * susulan.ts — satu sumber kebenaran untuk fitur Susulan (attempt make-up).
 *
 * Alur: guru/admin membuka susulan untuk siswa yang BELUM MULAI setelah ujian
 * berakhir. Submission placeholder (started_at NULL) disimpan; saat siswa
 * mulai, timer_override_until diisi durasi penuh dari waktu mulai (tidak
 * dipotong jam tutup). Guru memilih batas nilai akhir (persen); 100 = tanpa cap.
 *
 * Jangan menulis logika cap di tempat lain — semua jalur tulis skor wajib
 * memakai applySusulanCap agar nilai di DB konsisten dengan rekap/analitik.
 */

export const SUSULAN_VALIDITY_DAYS = 7
export const SUSULAN_VALIDITY_MS = SUSULAN_VALIDITY_DAYS * 24 * 60 * 60 * 1000
export const SUSULAN_MIN_PERCENT = 1
export const SUSULAN_MAX_PERCENT = 100
export const SUSULAN_DEFAULT_PERCENT = 100

/** Validasi input persen dari body request. null = tidak valid. */
export function sanitizeSusulanMaxPercent(value: unknown): number | null {
    // Field wajib eksplisit di API — jangan diam-diam mengartikan "tidak dikirim"
    // sebagai 100 (tanpa cap). UI selalu mengirim 100 atau angka cap.
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'number' && typeof value !== 'string') return null
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null
    if (n < SUSULAN_MIN_PERCENT || n > SUSULAN_MAX_PERCENT) return null
    return n
}

/** ISO batas berlaku grant baru (now + 7 hari). */
export function susulanExpiresAtIso(now: number = Date.now()): string {
    return new Date(now + SUSULAN_VALIDITY_MS).toISOString()
}

/** Grant masih berlaku untuk MULAI mengerjakan? (null = tidak kedaluwarsa) */
export function isSusulanExpired(expiresAt: string | null | undefined, now: number = Date.now()): boolean {
    if (!expiresAt) return false
    const t = new Date(expiresAt).getTime()
    return Number.isFinite(t) && now > t
}

/**
 * Terapkan cap nilai akhir susulan.
 * - maxPercent null / >= 100 -> nilai asli (tanpa cap)
 * - maxScore <= 0 -> nilai asli (max_score belum tersedia; jangan menebak)
 * - selain itu -> min(total, maxPercent% x maxScore), round 2 desimal
 */
export function applySusulanCap(
    totalScore: number,
    maxScore: number | null | undefined,
    maxPercent: number | null | undefined,
): number {
    const total = Number.isFinite(totalScore) ? totalScore : 0
    const round2 = (n: number) => Math.round(n * 100) / 100
    if (typeof maxPercent !== 'number' || !Number.isFinite(maxPercent)) return round2(total)
    if (maxPercent >= 100) return round2(total)
    // FAIL-CLOSED: cap aktif tetapi max_score tidak valid (null/0) tidak boleh
    // diam-diam membiarkan nilai mentah lolos. Semua attempt susulan yang sah
    // mengisi max_score saat grant/start, jadi kasus ini hanya data korup.
    if (typeof maxScore !== 'number' || !Number.isFinite(maxScore) || maxScore <= 0) return 0

    const capPoints = (Math.max(0, maxPercent) / 100) * maxScore
    return round2(Math.min(total, capPoints))
}

/** Persentase nilai efektif (untuk display/banner). null bila maxScore tidak valid. */
export function susulanCapPercentDisplay(maxPercent: number | null | undefined): number | null {
    if (typeof maxPercent !== 'number' || !Number.isFinite(maxPercent)) return null
    if (maxPercent >= 100) return null
    return Math.max(0, Math.min(100, maxPercent))
}
