/**
 * LOAD TEST LOGIN — 1000 siswa login SERENTAK dari SATU IP (localhost,
 * mensimulasikan 1000 siswa di WiFi sekolah yang sama jam 07:30).
 *
 * Ini menguji dua perbaikan audit sekaligus:
 *  1. Rate limit login: hanya percobaan GAGAL yang dihitung — 1000 login
 *     sukses dari 1 IP TIDAK boleh ada yang 429 (perilaku lama: 900 siswa
 *     kena 429 karena MAX_ATTEMPTS=100/menit/IP).
 *  2. bcrypt native: /api/ping (zero-DB) dipolling selama burst — kalau event
 *     loop terblok bcryptjs lama, ping ikut terkunci ratusan ms.
 *
 * Plus negative test: 15x password salah untuk satu username → mulai percobaan
 * ke-11 harus 429 (USERNAME_FAIL_LIMIT=10/10mnt), sementara IP tetap bebas
 * (IP_FAIL_LIMIT=200).
 *
 * Jalankan: ENV_FILE=.env.staging N_STUDENTS=1000 node loadtest/e2e/load_login.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const http = require('http')
const bcrypt = require('bcrypt')
const { spawnServer, stopServerSafe, waitPortUp, assertServerDb, nStudents } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3100
const BASE = `http://localhost:${PORT}`
const N = nStudents(1000)
const PASSWORD = 'LoginBench123!'
// WAVE_MS: sebar mulai login dalam window ini (default 30 dtk — 1000 manusia
// tidak klik dalam mikrodetik yang sama; guru bilang "mulai" lalu siswa klik
// selama puluhan detik). SYNC=1 untuk stress ekstrem semua-serentak-mikrodetik.
const WAVE_MS = process.env.SYNC === '1' ? 0 : parseInt(process.env.WAVE_MS || '30000', 10)

const pct = (arr, p) => { if (!arr.length) return -1; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// HTTP POST via node:http dengan socket tak terbatas — fetch/undici punya
// perilaku pool internal yang membiaskan pengukuran konkurensi setinggi ini.
const httpAgent = new http.Agent({ keepAlive: false, maxSockets: Infinity })
function httpPost(path, body) {
    return new Promise((resolve) => {
        const t0 = Date.now()
        const payload = JSON.stringify(body)
        const req = http.request({
            host: '127.0.0.1', port: PORT, path, method: 'POST',
            agent: httpAgent,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        }, (res) => {
            let raw = ''
            res.on('data', (c) => { raw += c })
            res.on('end', () => {
                let ok = false
                try { ok = JSON.parse(raw)?.success === true } catch { }
                resolve({ status: res.statusCode, ok, ms: Date.now() - t0 })
            })
        })
        req.on('error', (e) => resolve({ status: 0, ok: false, ms: Date.now() - t0, cause: e.code || e.message }))
        req.setTimeout(120000, () => req.destroy(new Error('CLIENT_TIMEOUT')))
        req.end(payload)
    })
}

let server = null

async function batchUpsert(table, rows, label) {
    for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict: 'username', ignoreDuplicates: true })
        if (error) throw new Error(`${label}: ${error.message}`)
    }
    console.log(`fixture ${label}: ${rows.length} baris`)
}

async function main() {
    // SATU sumber prefix (dihitung module-load, dipakai main DAN cleanup —
    // dua Date.now() terpisah menghasilkan prefix berbeda → cleanup meleset)
    const U = process.env.LL_PREFIX

    // ---- fixtures (batch, bukan per-baris) ----
    const { data: school } = await supabase.from('schools').select('id').limit(1).single()
    if (!school) throw new Error('school staging tidak ditemukan')
    const passHash = bcrypt.hashSync(PASSWORD, 10) // hash SEKALI — semua user share (perilaku seed_loadtest)

    const usernames = Array.from({ length: N }, (_, i) => `${U}_${String(i + 1).padStart(4, '0')}`)
    await batchUpsert('users', usernames.map(u => ({
        username: u, password_hash: passHash, full_name: `LoginBench ${u}`,
        role: 'SISWA', school_id: school.id, must_change_password: false, is_locked: false,
    })), 'users')

    // ---- server ----
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    console.log(`server up (staging) — ${N} login serentak dari 1 IP...`)

    // ---- monitor /api/ping selama burst (deteksi event loop terblok) ----
    const pings = []
    let pinging = true
    const pingLoop = (async () => {
        while (pinging) {
            const t0 = Date.now()
            try { await fetch(BASE + '/api/ping', { signal: AbortSignal.timeout(30000) }) } catch { }
            pings.push(Date.now() - t0)
            await new Promise(r => setTimeout(r, 300))
        }
    })()

    // ---- fase 1: N login benar, mulai tersebar dalam WAVE_MS ----
    const errCauses = {}
    const t0 = Date.now()
    const results = await Promise.all(usernames.map(async (u, i) => {
        // sebar start (deterministik merata + jitter kecil) — 1000 siswa nyata
        // klik dalam puluhan detik setelah guru mengucap "mulai"
        if (WAVE_MS > 0) await sleep((i / N) * WAVE_MS + Math.random() * 200)
        const r = await httpPost('/api/auth/login', { username: u, password: PASSWORD })
        if (r.cause) errCauses[r.cause] = (errCauses[r.cause] || 0) + 1
        return r
    }))
    const burstMs = Date.now() - t0
    await new Promise(r => setTimeout(r, 1000))
    pinging = false
    await pingLoop

    const okCount = results.filter(r => r.ok).length
    const s429 = results.filter(r => r.status === 429).length
    const s401 = results.filter(r => r.status === 401).length
    const s5xx = results.filter(r => r.status >= 500).length
    const lat = results.map(r => r.ms)

    console.log('\n===== FASE 1: LOGIN SERENTAK =====')
    console.log(`siswa         : ${N} (semua dari 1 IP = simulasi WiFi sekolah; start tersebar ${WAVE_MS / 1000}s)`)
    console.log(`sukses (200)  : ${okCount}/${N}`)
    console.log(`429 rate-limit: ${s429}  (harap 0 — login sukses tidak dihitung)`)
    console.log(`401           : ${s401}`)
    console.log(`5xx/error     : ${s5xx}  (harap 0)`)
    const statusHist = {}
    for (const r of results) statusHist[r.status] = (statusHist[r.status] || 0) + 1
    console.log(`histogram status: ${JSON.stringify(statusHist)}`)
    if (Object.keys(errCauses).length) console.log(`penyebab fetch error: ${JSON.stringify(errCauses)}`)
    console.log(`durasi total  : ${(burstMs / 1000).toFixed(1)}s`)
    console.log(`login p50/p95/p99 : ${pct(lat, .5)}ms / ${pct(lat, .95)}ms / ${pct(lat, .99)}ms`)
    console.log(`/api/ping selama burst: n=${pings.length} p50=${pct(pings, .5)}ms p95=${pct(pings, .95)}ms max=${Math.max(...pings, 0)}ms  (zero-DB; besar = event loop terblok)`)

    // ---- fase 2: negative test rate limit per-username ----
    const victim = `${U}_0001` // user nyata, password salah berulang
    let first429 = -1
    for (let i = 1; i <= 15; i++) {
        const r = await httpPost('/api/auth/login', { username: victim, password: 'salah-total' })
        if (r.status === 429 && first429 === -1) first429 = i
        await sleep(80)
    }
    // user LAIN tetap bebas login (IP tidak terblok oleh 15 gagal username lain)
    const otherRes = await httpPost('/api/auth/login', { username: `${U}_0002`, password: PASSWORD })
    console.log('\n===== FASE 2: RATE LIMIT (negative) =====')
    console.log(`password salah 15x utk 1 username: 429 pertama di percobaan #${first429}  (harap 11 — limit 10 gagal/username)`)
    console.log(`user lain dari IP yang sama: HTTP ${otherRes.status}  (harap 200 — IP tidak ikut terblok)`)

    // ---- verdict ----
    const pass = okCount === N && s429 === 0 && s5xx === 0
        && first429 === 11 && otherRes.status === 200
        && pct(pings, .95) < 1000
    console.log(pass ? '\nLOAD-LOGIN: PASS ✅' : '\nLOAD-LOGIN: FAIL ❌')
    if (!pass) process.exitCode = 1
}

async function cleanup() {
    console.log('\ncleanup...')
    const prefix = process.env.LL_PREFIX
    if (!prefix) { console.log('LL_PREFIX kosong — skip cleanup fixture'); return }
    const { data: users } = await supabase.from('users').select('id').like('username', `${prefix}_%`)
    const ids = (users || []).map(u => u.id)
    for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500)
        await supabase.from('notifications').delete().in('user_id', chunk)
        await supabase.from('sessions').delete().in('user_id', chunk)
        await supabase.from('users').delete().in('id', chunk)
    }
    console.log(`cleanup: ${ids.length} user + sessions + notifikasi dihapus`)
}

// prefix tunggal per proses — dipakai main() dan cleanup()
const runId = Date.now() % 100000
process.env.LL_PREFIX = `ll${runId}`

main()
    .catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
    .finally(async () => {
        await stopServerSafe(server, BASE)
        await cleanup()
        process.exit(process.exitCode || 0)
    })
