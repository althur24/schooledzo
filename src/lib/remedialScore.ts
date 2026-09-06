/**
 * Kebijakan nilai remedial (remedial score policy) — engine tunggal untuk
 * SEMUA titik merge nilai remedial (rekap/rapor, analitik, detail siswa,
 * halaman hasil). Jangan menulis logika merge remedial di tempat lain.
 *
 * Kebijakan dipilih PEMBUAT remedial (guru/admin) saat membuat remedial dan
 * tersimpan di baris ujian remedial itu sendiri (kolom remedial_score_policy
 * + remedial_max_score di exams / quizzes / official_exams) — historis akurat:
 * mengubah kebijakan pada remedial berikutnya tidak mengubah perhitungan
 * remedial lama.
 *
 * Policy:
 *  - 'HIGHEST' (default, juga saat NULL/kolom kosong — data pra-migrasi):
 *      nilai final = max(nilai asli, nilai remedial)
 *  - 'AVERAGE': nilai final = (nilai asli + nilai remedial) / 2
 *  - 'CAP':      nilai final = min(max(asli, remedial), cap)
 *      cap = remedial_max_score (mis. sebesar KKM) — walau remedial 100,
 *      yang tercatat maksimal sebesar cap.
 *
 * Siswa yang TIDAK mengerjakan remedial: nilai asli dipakai apa adanya
 * (tidak di-rata dengan 0 — jangan menghukum dua kali).
 */

export type RemedialScorePolicy = 'HIGHEST' | 'AVERAGE' | 'CAP'

export const REMEDIAL_POLICIES: RemedialScorePolicy[] = ['HIGHEST', 'AVERAGE', 'CAP']

/** Nilai kebijakan yang aman untuk dipakai — input aneh → HIGHEST (default). */
export function resolvePolicy(policy: unknown): RemedialScorePolicy {
    return policy === 'AVERAGE' || policy === 'CAP' ? policy : 'HIGHEST'
}

/** Batas CAP yang aman — di luar 0..100 dipakai apa adanya (dipotong 0..100). */
export function resolveCap(cap: unknown): number | null {
    if (typeof cap !== 'number' || !Number.isFinite(cap)) return null
    return Math.max(0, Math.min(100, Math.round(cap)))
}

/**
 * Hitung nilai final dari pasangan (asli, remedial) sesuai kebijakan.
 * Skor dalam skala 0..100 (persen) — SEMUA titik merge sudah memakai persen.
 *
 * original == null  → siswa tidak punya nilai asli (langsung remedial):
 *                     pakai remedial apa adanya.
 * remedial == null  → siswa tidak mengerjakan remedial: nilai asli utuh.
 */
export function applyRemedialPolicy(
    original: number | null,
    remedial: number | null,
    policy: unknown,
    cap: unknown,
): number | null {
    if (original === null || original === undefined) return remedial
    if (remedial === null || remedial === undefined) return original

    switch (resolvePolicy(policy)) {
        case 'AVERAGE':
            return (original + remedial) / 2
        case 'CAP': {
            const capValue = resolveCap(cap)
            if (capValue === null) return Math.max(original, remedial)
            return Math.min(Math.max(original, remedial), capValue)
        }
        case 'HIGHEST':
        default:
            return Math.max(original, remedial)
    }
}

/**
 * Gabungkan daftar skor satu siswa untuk satu ujian dasar (ujian asli +
 * semua remedialnya) menjadi SATU skor final sesuai kebijakan remedial.
 *
 * @param entries  daftar { score, isRemedial, policy, cap } — ujian asli
 *                 (isRemedial=false) + remedialnya. Skala persen 0..100.
 *                 Kebijakan diambil dari entri REMEDIAL (ujian asli tidak
 *                 punya kebijakan); bila ada beberapa remedial berantai
 *                 (remedial dari remedial), dipakai kebijakan remedial
 *                 pertama yang menaut remedial_for_id langsung ke basis.
 * @returns skor final, atau null bila tidak ada entri valid.
 */
export function mergeRemedialScores(
    entries: Array<{ score: number | null | undefined; isRemedial?: boolean; policy?: unknown; cap?: unknown }>,
): number | null {
    const valid = entries.filter(e => typeof e.score === 'number' && Number.isFinite(e.score)) as Array<{ score: number; isRemedial?: boolean; policy?: unknown; cap?: unknown }>
    if (valid.length === 0) return null

    const original = valid.find(e => !e.isRemedial)?.score ?? null
    // Remedial berlapis: ambil skor remedial TERTINGGI sebagai perwakilan
    // (mis. remedial 1: 50, remedial 2: 70 → remedial = 70) — konsisten
    // dengan semangat HIGHEST dan tidak pernah lebih rendah dari keduanya.
    const remedials = valid.filter(e => e.isRemedial)
    const remedial = remedials.length > 0
        ? Math.max(...remedials.map(e => e.score))
        : null
    const policy = remedials[0]?.policy
    const cap = remedials[0]?.cap

    return applyRemedialPolicy(original, remedial, policy, cap)
}

/** Validasi input policy dari body request (API pembuatan remedial). */
export function sanitizePolicyInput(
    policy: unknown,
    cap: unknown,
): { policy: RemedialScorePolicy; cap: number | null } | { error: string } {
    const resolved = resolvePolicy(policy)
    if (policy !== undefined && policy !== null && !REMEDIAL_POLICIES.includes(policy as RemedialScorePolicy)) {
        return { error: 'remedial_score_policy harus HIGHEST, AVERAGE, atau CAP' }
    }
    let capValue: number | null = null
    if (resolved === 'CAP') {
        if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0 || cap > 100) {
            return { error: 'remedial_max_score wajib angka 0-100 saat kebijakan CAP' }
        }
        capValue = resolveCap(cap)
    }
    return { policy: resolved, cap: capValue }
}
