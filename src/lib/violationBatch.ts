/**
 * violationBatch.ts — merge batch pelanggaran (anti-hilang saat offline).
 *
 * Masalah: logViolation di halaman ulangan/UTS-UAS adalah fetch tunggal. Saat
 * offline, warning tetap tampil di client tapi PUT gagal → pelanggaran HILANG
 * dan tidak pernah tercatat walau koneksi pulih (jawaban punya localStorage +
 * retry, pelanggaran tidak).
 *
 * Solusi: client mengantre pelanggaran (persist localStorage) dan mengirim
 * batch `violations: [{type, at}]` saat online. `at` = timestamp kejadian di
 * client — dipertahankan supaya beberapa pelanggaran sah yang terjadi >3 dtk
 * terpisah saat offline tidak saling dimakan dedup server (dedup lama
 * membandingkan waktu TIBA di server: semua elemen queue tiba di ms yang sama
 * → cuma 1 yang diterima).
 *
 * Dipakai route exam-submissions & official-exam-submissions (jalur `violation`
 * tunggal lama tetap didukung — dibungkus jadi batch 1 entri).
 */

export interface IncomingViolation {
    type?: string
    at?: number | string | null
}

export interface ViolationLogEntry {
    type: string
    timestamp: string
}

export interface MergedViolations {
    log: ViolationLogEntry[]
    count: number
}

const MAX_BATCH = 20   // batas entri per request — anti-abus
const DEDUP_MS = 3000  // jarak minimum antar pelanggaran yang dicatat (paritas jalur lama)

/**
 * Gabungkan batch pelanggaran baru ke log existing.
 *
 * - Entri existing SELALU dipertahankan (count tidak pernah turun).
 * - Entri baru diurutkan menurut waktu kejadian, lalu dedup 3 dtk terhadap
 *   entri terakhir yang diterima (existing maupun kandidat baru sebelumnya).
 * - `at` di-clamp ke [started_at, now] — jam client ngaco tidak boleh
 *   menggeser sejarah pelanggaran.
 * - Return null bila tidak ada entri baru yang diterima (semua kena dedup) —
 *   pemanggil merespons tanpa update DB (perilaku sama dengan jalur lama).
 */
export function mergeViolations(
    currentLog: ViolationLogEntry[] | null | undefined,
    currentCount: number | null | undefined,
    incoming: IncomingViolation[],
    startedAt: string | null | undefined,
    nowMs: number = Date.now()
): MergedViolations | null {
    if (!Array.isArray(incoming) || incoming.length === 0) return null

    // Filter entri valid + cap jumlah per request
    const batch = incoming
        .filter((v): v is { type: string; at?: number | string | null } =>
            typeof v?.type === 'string' && v.type.length > 0)
        .slice(0, MAX_BATCH)
    if (batch.length === 0) return null

    const lower = startedAt ? new Date(startedAt).getTime() : 0
    const clamp = (t: number) => Math.min(Math.max(t, Number.isFinite(lower) ? lower : 0), nowMs)

    const toTime = (at: number | string | null | undefined): number => {
        if (typeof at === 'number' && Number.isFinite(at)) return clamp(at)
        if (typeof at === 'string') {
            const t = new Date(at).getTime()
            if (Number.isFinite(t)) return clamp(t)
        }
        return nowMs // tanpa `at` (jalur legacy) → waktu server, seperti dulu
    }

    // Entri existing: selalu diterima (urut waktu untuk dedup yang benar)
    const existing = (currentLog || [])
        .map(v => ({ t: new Date(v.timestamp).getTime() }))
        .filter(e => Number.isFinite(e.t))
        .sort((a, b) => a.t - b.t)

    // Kandidat baru: urut menurut waktu kejadian
    const candidates = batch
        .map(v => ({ t: toTime(v.at), type: v.type }))
        .sort((a, b) => a.t - b.t)

    let lastAcceptedAt = existing.length ? existing[existing.length - 1].t : -Infinity
    const accepted: { t: number; type: string }[] = []
    for (const c of candidates) {
        if (c.t - lastAcceptedAt >= DEDUP_MS) {
            accepted.push(c)
            lastAcceptedAt = c.t
        }
    }

    if (accepted.length === 0) return null

    return {
        log: [
            ...(currentLog || []),
            ...accepted.map(a => ({ type: a.type, timestamp: new Date(a.t).toISOString() })),
        ],
        count: (currentCount || 0) + accepted.length,
    }
}
