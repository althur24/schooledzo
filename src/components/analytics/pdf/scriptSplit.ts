/**
 * Pemisah teks campuran Latin–Arab untuk PDF analitik.
 *
 * LiberationSans (font utama PDF) tidak punya glyph Arab — tanpa pemisahan ini,
 * teks Arab dirender sebagai kotak kosong/notdef. Font Arab (NotoNaskhArabic)
 * juga tidak punya glyph Latin, jadi tiap segmen harus dirender dengan font
 * yang sesuai via nested <Text> (react-pdf tidak punya font-fallback otomatis
 * per karakter).
 *
 * Reorder RTL ditangani engine react-pdf (textkit → bidi-js), jadi urutan
 * segmen tetap logis; cukup ganti fontFamily per segmen.
 */

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
/** Karakter netral (spasi, tanda baca umum, angka) — ikut run sekitarnya */
const NEUTRAL = /[ \t\n\r.,،؛؟!:'"()[\]{}\-–—/\\|;؟]/

export interface ScriptSegment {
    text: string
    arabic: boolean
}

/**
 * Pecah teks menjadi run Latin/Arab. Karakter netral mengikuti kelas karakter
 * sebelumnya (atau sesudahnya bila di awal) supaya spasi antar kata Arab tidak
 * terpisah dari run-nya.
 */
export function splitScripts(text: string): ScriptSegment[] {
    if (!text) return []
    const chars = [...text]
    if (!chars.some(c => ARABIC.test(c))) return [{ text, arabic: false }]

    // Klasifikasi: true=arab, false=latin, null=netral
    const cls: Array<boolean | null> = chars.map(c => (ARABIC.test(c) ? true : NEUTRAL.test(c) ? null : false))

    // Netral di awal teks ikut kelas karakter pertama non-netral setelahnya
    let firstNonNull = cls.findIndex(c => c !== null)
    if (firstNonNull === -1) return [{ text, arabic: false }]
    for (let i = 0; i < firstNonNull; i++) cls[i] = cls[firstNonNull]
    // Netral lainnya ikut kelas sebelumnya
    for (let i = 1; i < cls.length; i++) if (cls[i] === null) cls[i] = cls[i - 1]

    // Gabungkan run berkelas sama
    const segs: ScriptSegment[] = []
    let cur = { text: '', arabic: cls[0] as boolean }
    for (let i = 0; i < chars.length; i++) {
        if (cls[i] === cur.arabic) cur.text += chars[i]
        else {
            segs.push(cur)
            cur = { text: chars[i], arabic: cls[i] as boolean }
        }
    }
    segs.push(cur)
    return segs
}
