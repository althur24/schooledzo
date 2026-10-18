/**
 * Pre-flight cek duplikat-judul ulangan untuk teaching_assignment yang sama.
 *
 * Akar masalah (kasus PIIS): guru/admin membuat ulangan dengan judul yang sudah
 * ada untuk kelas itu → siswa terbelah antar exam duplikat, nilai fragmentasi,
 * guru bingung di list. Varian spasi-depan (" 1. TRY OUT..." vs "1. TRY OUT...")
 * lolos karena string berbeda — normalisasi trim+lowercase menangkapnya.
 *
 * Dipanggil frontend SEBELUM POST /api/exams. Server guard (POST /api/exams,
 * return 409 DUPLICATE_TITLE) adalah backstop anti race-condition + jalur API
 * langsung. Pre-flight ini untuk UX: dialog konfirmasi sebelum creation attempt.
 *
 * Remedial dikecualikan (make-up sah — is_remedial=true).
 */

export interface DuplicateExamHit {
    taId: string
    className: string | null
    existing: {
        id: string
        title: string
        isActive: boolean | null
    }
}

/** Bentuk minimal baris GET /api/exams yang dipakai pre-flight (embed ambigu). */
export interface ExamListRow {
    id: string
    title: string
    is_remedial?: boolean | null
    is_active?: boolean | null
    teaching_assignment?:
        | { id?: string; class?: { name?: string | null } | { name?: string | null }[] | null }
        | { id?: string; class?: { name?: string | null } | { name?: string | null }[] | null }[]
        | null
}

function normalizeTitle(title: string): string {
    return (title || '').trim().toLowerCase()
}

/**
 * Cek duplikat dari exam list yang SUDAH ada di memory (list page state) —
 * tanpa fetch tambahan. Dipakai handler create/Salin di list page (guru & admin)
 * yang sudah punya `exams`/`ulanganExams` ter-fetch. Nol request tambahan.
 *
 * Return 1 hit per TA (match pertama). Paritas `preflightDuplicateExam`.
 */
export function checkDuplicatesInMemory(
    exams: ExamListRow[],
    taIds: string[],
    title: string,
): DuplicateExamHit[] {
    const norm = normalizeTitle(title)
    if (!norm || taIds.length === 0) return []
    const taSet = new Set(taIds)
    const foundByTa = new Map<string, DuplicateExamHit>()
    for (const e of exams) {
        if (e.is_remedial) continue
        if (normalizeTitle(e.title) !== norm) continue
        const ta = Array.isArray(e.teaching_assignment) ? e.teaching_assignment[0] : e.teaching_assignment
        const taId = ta?.id
        if (!taId || !taSet.has(taId)) continue
        if (foundByTa.has(taId)) continue // first match per TA
        const cls = Array.isArray(ta?.class) ? ta?.class?.[0] : ta?.class
        foundByTa.set(taId, {
            taId,
            className: cls?.name || null,
            existing: { id: e.id, title: e.title, isActive: e.is_active ?? null },
        })
    }
    return [...foundByTa.values()]
}

/**
 * Cek apakah setiap TA dalam `taIds` sudah punya ulangan non-remedial dengan
 * judul yang sama (normalize trim+lowercase) di tahun aktif.
 *
 * Mengembalikan daftar hit (TA + info existing) — kosong = aman, tidak ada
 * duplikat. Caller wajib menampilkan dialog konfirmasi bila hit tidak kosong
 * dan hanya mengirim `force_duplicate: true` setelah konfirmasi eksplisit.
 *
 * Catatan: GET /api/exams?teaching_assignment_id=X me-return exam list TA itu
 * (sudah filtered tahun aktif + tenant guard di server). Tiap TA biasanya
 * <20 exam — fetch per-TA paralel aman.
 */
export async function preflightDuplicateExam(
    taIds: string[],
    title: string,
): Promise<DuplicateExamHit[]> {
    const norm = normalizeTitle(title)
    if (!norm || taIds.length === 0) return []

    const results = await Promise.all(taIds.map(async (taId): Promise<DuplicateExamHit | null> => {
        try {
            const res = await fetch(`/api/exams?teaching_assignment_id=${encodeURIComponent(taId)}`)
            if (!res.ok) return null
            const exams: ExamListRow[] = await res.json()
            const dupe = (Array.isArray(exams) ? exams : []).find((e) =>
                !e.is_remedial && normalizeTitle(e.title) === norm,
            )
            if (!dupe) return null
            const ta = Array.isArray(dupe.teaching_assignment) ? dupe.teaching_assignment[0] : dupe.teaching_assignment
            const cls = Array.isArray(ta?.class) ? ta?.class?.[0] : ta?.class
            return {
                taId,
                className: cls?.name || null,
                existing: {
                    id: dupe.id,
                    title: dupe.title,
                    isActive: dupe.is_active ?? null,
                },
            }
        } catch {
            // Non-fatal: kegagalan fetch pre-flight tidak boleh memblokir creation
            // (server guard tetap backstop). Log saja, anggap aman.
            return null
        }
    }))

    return results.filter((r): r is DuplicateExamHit => r !== null)
}
