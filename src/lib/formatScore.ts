/**
 * formatScore.ts — SATU sumber kebenaran format & parse nilai numerik.
 *
 * Konteks: skor LMS mendukung desimal 2 angka (poin soal hasil "Seimbangkan",
 * nilai GK proporsional, nilai manual guru). Helper ini mencegah
 * `Math.round`/`parseInt` baru bermunculan (pelajaran parser GK yang dulu
 * terduplikasi 8× dan menyebabkan "benar tapi disalahkan").
 *
 * KONTRAK:
 *  - Semua skor numerik DISIMPAN & DIKIRIM sebagai number round-2
 *    (`round2`) — bukan string, bukan koma.
 *  - `formatScore` HANYA untuk render teks UI (koma desimal, tanpa nol
 *    buntut). JANGAN dipakai di payload JSON/export numerik.
 *  - `parseScoreInput` HANYA untuk input manual guru (tolak NaN/inf,
 *    clamp/validasi range, hasil round-2).
 */

/** Pembulatan konsisten ke 2 desimal (anti debu float 0.1+0.2≠0.3). */
export function round2(n: number | null | undefined): number {
    const v = Number(n)
    if (!Number.isFinite(v)) return 0
    return Math.round(v * 100) / 100
}

/**
 * Format skor untuk TAMPILAN: round 2 desimal + buang nol buntut + koma
 * desimal (gaya e-Rapor Indonesia).
 *   87     → "87"
 *   87.5   → "87,5"
 *   87.25  → "87,25"
 *   6.6600 → "6,66"
 *   null   → "-" (TIDAK "0" — sel kosong ≠ nilai nol; "0" terbaca gagal)
 */
export function formatScore(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-'
    return String(round2(n)).replace('.', ',')
}

/**
 * Parse input nilai manual guru: menerima "87", "87.5", "87,5" (koma
 * kekalir dari keyboard numerik) → number round-2.
 * Return null bila kosong/bukan angka — caller memutuskan (tolak vs treat 0).
 */
export function parseScoreInput(raw: string | number | null | undefined): number | null {
    if (raw === null || raw === undefined) return null
    if (typeof raw === 'number') return Number.isFinite(raw) ? round2(raw) : null
    const s = String(raw).trim().replace(',', '.')
    if (s === '' || s === '.' || s === '-') return null
    const v = parseFloat(s)
    return Number.isFinite(v) ? round2(v) : null
}

/**
 * Validasi nilai manual terhadap rentang (mis. 0-100 tugas offline).
 * Return pesan error bila di luar rentang, null bila sah.
 */
export function validateScoreRange(n: number | null, min: number, max: number, label = 'Nilai'): string | null {
    if (n === null) return `${label} harus diisi angka`
    if (n < min || n > max) return `${label} harus di antara ${min} dan ${max}`
    return null
}
