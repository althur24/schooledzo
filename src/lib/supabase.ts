import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Client khusus untuk akses publik (terkena RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Client khusus untuk server/API (bypass RLS).
// JANGAN pernah fallback ke anon key: tabel inti (exam_*, official_exam_*, ...) kini
// RLS-enabled, sehingga anon key akan diblokir diam-diam → kegagalan akses data yang
// sulit didiagnosis. Gagal keras saat startup bila service key hilang (mis. rotasi kunci
// staging/prod yang tidak lengkap) supaya bocornya ketahuan saat deploy, bukan saat siswa
// mengerjakan ulangan.
if (!supabaseServiceKey) {
    throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di environment. Client admin (bypass RLS) tidak bisa dibuat — perbaiki env, jangan fallback ke anon.'
    )
}
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
