/**
 * storagePublicUrl — pengganti `supabase.storage.from(bucket).getPublicUrl(path)`
 * di komponen client.
 *
 * Alasan ada: src/lib/supabase kini throw bila SUPABASE_SERVICE_ROLE_KEY kosong
 * (guard fail-fast di module scope). Env itu TIDAK pernah ada di browser, jadi
 * SEMUA komponen 'use client' yang mengimpor lib itu akan crash saat load.
 * getPublicUrl sendiri cuma string-builder tanpa request — util ini mereplikasi
 * persis perilaku @supabase/storage-js 2.x:
 *   encodeURI(`${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`)
 */
export function getPublicStorageUrl(bucket: string, path: string): string {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL
    return encodeURI(`${base}/storage/v1/object/public/${bucket}/${path}`)
}
