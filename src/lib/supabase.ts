import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Hardening insiden 29 Sep 2026 (Supabase API Gateway degraded: 521/522 + ECONNRESET):
// fetch Node TIDAK punya timeout default — saat upstream flap, request menggantung
// 60 dtk+, soket menumpuk, dan seluruh proses ikut tersendat (bahkan file statis)
// sampai edge Railway membalas 502. Timeout memotong hang menjadi error terstruktur
// ({ error, status: 0 }) yang sudah ditangani jalur error tiap route — jalur yang
// sama persis dengan ECONNRESET storm 29 Sep (terbukti survive di production).
//
// Mekanisme UTAMA: opsi native supabase-js `db.timeout` — abort otomatis via
// AbortController + komposisi signal caller-vs-timeout yang benar (keduanya
// dihormati, listener dibersihkan, timer bebas leak — impl. postgrest-js).
// Cover PostgREST (seluruh query app). Storage tidak dicover opsi ini →
// safety net global.fetch di bawah (pemakaian storage saat ini hanya .remove()).
//
// Override: SUPABASE_FETCH_TIMEOUT_MS (default 20000). Set "0" untuk mematikan.
// Nilai invalid ("abc", kosong, negatif) TIDAK boleh diam-diam mematikan
// hardening → fail-safe ke default (hanya "0" eksplisit yang off).
const rawEnv = (process.env.SUPABASE_FETCH_TIMEOUT_MS ?? '').trim()
const parsedTimeout = rawEnv === '' ? NaN : Number(rawEnv)
const FETCH_TIMEOUT_MS = Number.isFinite(parsedTimeout) && parsedTimeout >= 0
    ? parsedTimeout
    : 20_000

interface TimeoutOpts {
    db?: { timeout: number }
    global?: { fetch: typeof fetch }
}

const hardening: TimeoutOpts = FETCH_TIMEOUT_MS > 0
    ? {
        db: { timeout: FETCH_TIMEOUT_MS },
        global: {
            // Tunduk pada signal yang sudah ada (termasuk punya db.timeout) —
            // fallback ke AbortSignal.timeout hanya bila caller tak membawa signal.
            fetch: (input, init) =>
                fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
        },
    }
    : {}

// Client khusus untuk akses publik (terkena RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, hardening)

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
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, hardening)

/**
 * Factory client admin DENGAN hardening timeout — untuk route yang membuat
 * client sendiri (bukan import supabaseAdmin). Semua createClient service-role
 * WAJIB lewat sini: client buatan langsung `createClient(...)` lolos dari
 * db.timeout → saat upstream flap request-nya menggantung tanpa batas
 * (patologi insiden 29 Sep). Gagal keras bila service key hilang — paritas
 * guard supabaseAdmin di atas.
 */
export function createAdminClient() {
    if (!supabaseServiceKey) {
        throw new Error(
            'SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di environment. Client admin (bypass RLS) tidak bisa dibuat — perbaiki env, jangan fallback ke anon.'
        )
    }
    return createClient(supabaseUrl, supabaseServiceKey, hardening)
}
