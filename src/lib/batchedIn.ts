/**
 * batchedIn — jalankan `.in(column, ids)` dalam batch kecil (default 100).
 *
 * Kenapa: `.in()` dengan ratusan UUID membuat URL >16KB dan PostgREST
 * menolak dengan 500. Batching memecahnya menjadi beberapa request.
 *
 * PERHATIAN: batching memperbaiki BATAS URL, BUKAN batas 1000 baris per request.
 * Jika satu batch bisa mengembalikan >1000 baris (mis. 100 assignment × 40 siswa),
 * hasilnya tetap terpotong — gunakan fetchAllRows untuk query-nya, atau perkecil batch.
 *
 * Contoh:
 *   const subs = await batchedIn('assignment_id', assignmentIds, (chunk) =>
 *     supabase.from('student_submissions').select('*').in('assignment_id', chunk)
 *   )
 */

export const IN_BATCH_SIZE = 100

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function batchedIn<T = any>(
    column: string,
    ids: string[],
    runBatch: (chunk: string[]) => any
): Promise<T[]> {
    if (ids.length === 0) return []
    const all: T[] = []
    for (let i = 0; i < ids.length; i += IN_BATCH_SIZE) {
        const chunk = ids.slice(i, i + IN_BATCH_SIZE)
        const { data, error } = await runBatch(chunk)
        if (error) throw error
        all.push(...((data || []) as T[]))
    }
    return all
}
