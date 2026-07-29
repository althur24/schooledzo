/**
 * fetchAllRows — ambil SEMUA baris dari query supabase dengan range-loop.
 *
 * PostgREST secara diam-diam memotong hasil ke 1000 baris per request.
 * Helper ini mengambil per halaman (1000) sampai habis, sehingga data besar
 * (1088+ siswa, ribuan submissions) tidak terpotong tanpa disadari.
 *
 * Contoh:
 *   const rows = await fetchAllRows(
 *     supabase.from('students').select('id, nis').eq('school_id', schoolId)
 *   )
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllRows<T = any>(query: any, pageSize = 1000, maxPages = 20): Promise<T[]> {
    const all: T[] = []
    let page = 0
    while (page < maxPages) {
        const { data, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1)
        if (error) throw error
        const rows = (data || []) as T[]
        all.push(...rows)
        if (rows.length < pageSize) break
        page++
    }
    return all
}
