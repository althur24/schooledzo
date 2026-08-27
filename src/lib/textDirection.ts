/**
 * Deteksi arah teks untuk dukungan bahasa Arab (RTL).
 *
 * Dipakai render passage (PassageBlock) dan textarea/input editor agar
 * paragraf Arab otomatis rata kanan tanpa guru harus mengatur apa pun.
 *
 * SmartText memakai deteksi "ada huruf Arab" untuk font (teks campuran
 * tetap dapat font Arab pada bagian Arab). Untuk ARAH paragraf, "ada huruf
 * Arab" terlalu agresif — kutipan Arab dalam teks Indonesia tidak boleh
 * membalik seluruh paragraf. Maka di sini dipakai mayoritas: RTL hanya bila
 * huruf Arab melebihi huruf Latin.
 */

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const ARABIC_GLOBAL_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g
const LATIN_RE = /[A-Za-z]/g

export function containsArabic(text: string): boolean {
    return ARABIC_RE.test(text)
}

/** RTL bila huruf Arab lebih banyak dari huruf Latin (teks murni Arab → RTL) */
export function detectTextDirection(text: string): 'ltr' | 'rtl' {
    if (!text) return 'ltr'
    const arabicCount = (text.match(ARABIC_GLOBAL_RE) || []).length
    if (arabicCount === 0) return 'ltr'
    const latinCount = (text.match(LATIN_RE) || []).length
    return arabicCount > latinCount ? 'rtl' : 'ltr'
}
