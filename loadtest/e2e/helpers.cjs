/**
 * loadtest/e2e/helpers.cjs — helper bersama untuk semua script E2E (CommonJS).
 *
 * Alasan ada: sebelumnya tiap script menduplikasi helper inline dengan pola
 * yang rawan (insert gagal diam-diam, pkill membunuh proses orang lain,
 * akses index data tanpa guard). Helper ini menegakkan:
 *  - fail-fast saat prasyarat data kurang (assertMin)
 *  - insert fixture yang throw dengan konteks jelas (mustInsert)
 *  - matikan server TANPA pkill — hanya process group milik sendiri (stopServerSafe)
 */

const crypto = require('crypto')

/**
 * Muat .env dengan GUARD anti-salah-key:
 *  - ENV_FILE=.env.staging → URL WAJIB mengandung ref staging (vkkgnredrfqqraonynte),
 *    dan WAJIB TIDAK mengandung ref production (veohqmrydavkokfiqvjj).
 *  - ENV_FILE=.env.local (default) → kebalikannya.
 * Manusia bisa lupa; guard ini membuat salah kombinasi MUSTAHIL diam-diam:
 * script mati sebelum menyentuh database apa pun.
 */
function loadEnvGuarded() {
    const envFile = process.env.ENV_FILE || '.env.local'
    require('dotenv').config({ path: envFile })
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const isStagingFile = envFile.includes('staging')
    const urlHasStaging = url.includes('vkkgnredrfqqraonynte')
    const urlHasProd = url.includes('veohqmrydavkokfiqvjj')
    if (isStagingFile && !urlHasStaging) {
        throw new Error(`[ENV GUARD] ${envFile} aktif tapi NEXT_PUBLIC_SUPABASE_URL bukan project staging (vkkgnredrfqqraonynte). URL: ${url || '(kosong)'}. ABORT sebelum menyentuh DB.`)
    }
    if (!isStagingFile && urlHasStaging) {
        throw new Error(`[ENV GUARD] ${envFile} aktif tapi URL menunjuk STAGING (vkkgnredrfqqraonynte) — .env.local harus production. ABORT.`)
    }
    if (isStagingFile && urlHasProd) {
        throw new Error(`[ENV GUARD] ${envFile} (staging) berisi URL PRODUCTION (veohqmrydavkokfiqvjj)! ABORT sebelum menyentuh DB production.`)
    }
    if (!urlHasStaging && !urlHasProd) {
        console.warn(`[ENV GUARD] URL tidak dikenali (bukan staging/prod yang dikenal) — lanjut dengan hati-hati: ${url}`)
    }
    return { envFile, url }
}

/** Jumlah siswa virtual — override via env, default dipertahankan dari script lama. */
function nStudents(defaultN) {
    const v = parseInt(process.env.N_STUDENTS || '', 10)
    return Number.isFinite(v) && v > 0 ? v : defaultN
}

/**
 * Guard ketiga (paling penting): pastikan server `next start` BENAR-BENAR
 * menunjuk ke DB yang diharapkan. NEXT_PUBLIC_SUPABASE_URL di-inline saat
 * BUILD — bila .next dibangun dengan env lain, runtime env TIDAK mengubahnya.
 * Deteksi: /api/schools/public membaca tabel schools dari DB yang dipakai
 * server — staging harus mengandung seed 'STG01', production tidak boleh.
 */
async function assertServerDb(baseUrl, expectStaging) {
    const r = await fetch(baseUrl + '/api/schools/public', { signal: AbortSignal.timeout(10000) })
        .catch(() => null)
    const body = r ? await r.json().catch(() => null) : null
    const list = Array.isArray(body) ? body : (body?.schools || body?.data || [])
    const codes = list.map((s) => s?.code).filter(Boolean)
    const isStagingDb = codes.includes('STG01')
    if (expectStaging && !isStagingDb) {
        throw new Error(`[SERVER GUARD] Server menunjuk ke DB BUKAN staging (codes: ${codes.join(',') || 'kosong'}). Kemungkinan .next dibangun dengan env production — jalankan ulang build dengan env staging. ABORT.`)
    }
    if (!expectStaging && isStagingDb) {
        throw new Error(`[SERVER GUARD] Server menunjuk ke DB STAGING padahal ini run production. ABORT.`)
    }
    return true
}

/**
 * Fail-fast: jumlah data prasyarat harus cukup, kalau tidak abort dengan pesan jelas.
 * Lebih baik gagal di awal daripada TypeError di tengah / hasil menyesatkan.
 */
function assertMin(n, min, label) {
    if (!(n >= min)) {
        throw new Error(`Prasyarat kurang: ${label} butuh >= ${min}, yang tersedia ${n}. Abort agar tidak ada hasil menyesatkan.`)
    }
    return true
}

/**
 * Insert yang TIDAK boleh gagal diam-diam. Throw dengan nama tabel + pesan error
 * Supabase, supaya kegagalan fixture tidak meledak jauh di downstream.
 */
async function mustInsert(supabase, table, row, label) {
    const { data, error } = await supabase.from(table).insert(row).select().single()
    if (error || !data) {
        throw new Error(`Insert fixture ${label || table} gagal: ${error?.message || 'tidak ada data kembali'}`)
    }
    return data
}

/**
 * Buat sesi login uji (tabel sessions) + registrasi token ke registry cleanup.
 * Registry adalah objek `created` milik script pemanggil (created.sessions.push).
 */
async function makeSession(supabase, userId, createdRegistry) {
    const token = crypto.randomBytes(32).toString('hex')
    const { error } = await supabase.from('sessions').insert({
        user_id: userId,
        token,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
    })
    if (error) throw new Error(`Gagal buat sesi uji untuk user ${userId}: ${error.message}`)
    if (createdRegistry) createdRegistry.sessions.push(token)
    return token
}

/**
 * Fetch wrapper dengan cookie session_token. Pakai:
 *   const api = makeApi(BASE_URL)
 *   const res = await api('/api/exams/123', token)
 */
function makeApi(baseUrl) {
    return (path, token, opts = {}) =>
        fetch(`${baseUrl}${path}`, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                Cookie: `session_token=${token}`,
                ...(opts.headers || {}),
            },
        })
}

/**
 * Spawn `next start` dengan process group sendiri (detached), sehingga bisa
 * dimatikan penuh (npx + child next) TANPA pkill yang bisa membunuh proses lain.
 */
function spawnServer(cwd, port, stdio = 'ignore') {
    return require('child_process').spawn('npx', ['next', 'start', '-p', String(port)], {
        cwd,
        detached: true,
        stdio,
    })
}

/**
 * Matikan server dengan aman: SIGTERM ke process group milik sendiri, tunggu
 * port benar-benar bebas (maks timeoutMs), lalu SIGKILL jika perlu.
 * Menggantikan pola `pkill -f 'next start.*3100'` yang bisa membunuh proses lain.
 * Return true kalau port bebas dalam timeout.
 */
async function stopServerSafe(server, baseUrl, timeoutMs = 10000) {
    if (server && server.pid) {
        try { process.kill(-server.pid, 'SIGTERM') } catch { /* grup mungkin sudah mati */ }
    }
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
        try {
            await fetch(baseUrl + '/login', { signal: AbortSignal.timeout(1000) })
            // masih merespons — beri waktu mati lalu cek lagi
            await new Promise(r => setTimeout(r, 500))
        } catch {
            return true // koneksi ditolak → port bebas
        }
    }
    if (server && server.pid) {
        try { process.kill(-server.pid, 'SIGKILL') } catch { }
    }
    return false
}

/** Tunggu sampai server merespons (dipakai startServer di tiap script). */
async function waitPortUp(baseUrl, timeoutMs = 60000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
        try {
            const r = await fetch(baseUrl + '/login', { signal: AbortSignal.timeout(2000) })
            if (r.status) return true
        } catch { }
        await new Promise(r => setTimeout(r, 1000))
    }
    throw new Error('server tidak start dalam ' + Math.round(timeoutMs / 1000) + 's')
}

/**
 * Fetch semua baris melewati batas potongan 1000 baris PostgREST (halaman 1000/baris).
 * Harus dipanggil dengan query yang SUDAH punya .order() stabil.
 * (Versi CommonJS dari src/lib/fetchAllRows.ts — script e2e tidak bisa import TS.)
 */
async function fetchAllRowsCjs(query, pageSize = 1000) {
    const all = []
    let from = 0
    while (true) {
        const { data, error } = await query.range(from, from + pageSize - 1)
        if (error) throw new Error('fetchAllRows: ' + error.message)
        all.push(...(data || []))
        if (!data || data.length < pageSize) break
        from += pageSize
    }
    return all
}

module.exports = {
    assertMin,
    mustInsert,
    makeSession,
    makeApi,
    spawnServer,
    stopServerSafe,
    waitPortUp,
    fetchAllRowsCjs,
    loadEnvGuarded,
    nStudents,
    assertServerDb,
}
