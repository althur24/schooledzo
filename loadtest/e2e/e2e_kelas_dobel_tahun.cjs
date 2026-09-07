/**
 * E2E KELAS DOBEL LINTAS TAHUN AJARAN — anti-kambuh regresi.
 *
 * Bug asli: GET /api/classes tanpa scope tahun mengembalikan kelas SEMUA
 * tahun ajaran. Karena fitur Salin Kelas (persiapan tahun baru) membuat kelas
 * senama lintas tahun (by design), konsumen yang tidak memfilter menampilkan
 * kelas dobel (picker Pengaturan editor ujian, pengumuman, rekap-nilai,
 * statistik dashboard). Staging hanya punya 1 tahun ajaran sehingga bug ini
 * lolos dari E2E — test ini MEMBUAT kondisi 2 tahun + kelas senama.
 *
 * Skenario (fixture mandiri STG01, dibersihkan di akhir):
 *  [1] Reproduksi akar masalah: /api/classes TANPA param → kelas senama dari
 *      2 tahun (2 baris) — inilah sumber dobel di konsumen tanpa filter
 *  [2] Scope yang benar: /api/classes?academic_year_id=<aktif> → hanya 1
 *  [3] Scope tahun lama: ?academic_year_id=<selesai> → hanya 1 (kelas tahun itu)
 *  [4] Endpoint copy-classes tidak membuat dobel intra-tahun (idempotent):
 *      salin ulang tahun lama → tahun aktif → skipped semua, tetap 1 kelas
 *  [5] Filter client-side konsumen (pola yang dipakai fix): kombinasi
 *      is_active/status — tahun COMPLETED & PLANNED tidak pernah lolos
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_kelas_dobel_tahun.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3100
const BASE = `http://localhost:${PORT}`

let server = null
const created = {
    users: [], teachers: [], classes: [], years: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `kdt_${runId}`
    const PASS = 'Kdt-Test-123'
    const passHash = bcrypt.hashSync(PASS, 10)

    // ---------- FIXTURES: 2 tahun ajaran + kelas senama ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')

    // Tahun AKTIF (tidak usah dibuat — staging sudah punya satu)
    const { data: activeYear } = await supabase.from('academic_years')
        .select('id, name').eq('school_id', school.id).eq('is_active', true).single()
    if (!activeYear) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    // Tahun LAMA (COMPLETED) — setahun di belakang nama tahun aktif untuk keunikan
    const oldName = activeYear.name.includes('/')
        ? (() => { const [a, b] = activeYear.name.split('/').map(s => s.trim()); return `${parseInt(a) - 1}/${parseInt(b) - 1}` })()
        : `${U} Tahun Lama`
    const oldYear = await mustInsert(supabase, 'academic_years', {
        school_id: school.id, name: oldName, is_active: false, status: 'COMPLETED',
    }, 'tahun lama')
    created.years.push(oldYear.id)

    // Kelas AKTIF + kelas SENAMA di tahun lama (persis hasil Salin Kelas)
    const clsActive = await mustInsert(supabase, 'classes', {
        name: `${U} 9X`, academic_year_id: activeYear.id, grade_level: 3, school_level: 'SMP',
    }, 'kelas tahun aktif')
    const clsOld = await mustInsert(supabase, 'classes', {
        name: `${U} 9X`, academic_year_id: oldYear.id, grade_level: 3, school_level: 'SMP',
    }, 'kelas senama tahun lama')
    created.classes.push(clsActive.id, clsOld.id)

    const adminUser = await mustInsert(supabase, 'users', {
        username: `${U}_admin`, full_name: `${U} Admin`, password_hash: passHash,
        role: 'ADMIN', school_id: school.id, must_change_password: false, is_locked: false,
    }, 'user admin')
    created.users.push(adminUser.id)

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    const loginRes = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminUser.username, password: PASS }),
    })
    const setCookie = loginRes.headers.getSetCookie?.() || []
    const tokAdmin = setCookie.map(c => c.split(';')[0]).find(c => c.startsWith('session_token='))?.split('=')[1]
    check('login admin', !!tokAdmin)

    // ════════ [1] REPRODUKSI AKAR MASALAH ════════
    console.log('\n[1] Reproduksi: /api/classes TANPA scope tahun → kelas senama dobel')
    const noScopeRes = await api('/api/classes', tokAdmin)
    const noScope = noScopeRes.ok ? await noScopeRes.json() : []
    const sameName = (noScope || []).filter((c) => c.name === `${U} 9X`)
    check('GET 200', noScopeRes.status === 200, `status=${noScopeRes.status}`)
    check('kelas senama muncul 2 baris (sumber dobel — by design multi-tahun)', sameName.length === 2, `n=${sameName.length}`)
    check('embed academic_year tersedia (prasyarat filter client-side)', sameName.every((c) => c.academic_year?.id))

    // ════════ [2] SCOPE TAHUN AKTIF ════════
    console.log('\n[2] Scope tahun aktif: ?academic_year_id=<aktif> → hanya 1')
    const activeRes = await api(`/api/classes?academic_year_id=${activeYear.id}`, tokAdmin)
    const activeList = activeRes.ok ? await activeRes.json() : []
    const activeSame = (activeList || []).filter((c) => c.name === `${U} 9X`)
    check('hanya kelas tahun aktif (1 baris)', activeSame.length === 1 && activeSame[0]?.id === clsActive.id, `n=${activeSame.length}, id_cocok=${activeSame[0]?.id === clsActive.id}`)

    // ════════ [3] SCOPE TAHUN LAMA ════════
    console.log('\n[3] Scope tahun lama: ?academic_year_id=<selesai> → kelas tahun itu')
    const oldRes = await api(`/api/classes?academic_year_id=${oldYear.id}`, tokAdmin)
    const oldList = oldRes.ok ? await oldRes.json() : []
    const oldSame = (oldList || []).filter((c) => c.name === `${U} 9X`)
    check('hanya kelas tahun lama (1 baris, id beda)', oldSame.length === 1 && oldSame[0]?.id === clsOld.id, `n=${oldSame.length}, id_cocok=${oldSame[0]?.id === clsOld.id}`)

    // ════════ [4] COPY-CLASSES IDEMPOTENT (tidak bikin dobel intra-tahun) ════════
    console.log('\n[4] copy-classes: salin ulang tidak membuat dobel intra-tahun')
    const copyRes = await api('/api/classes/copy-classes', tokAdmin, {
        method: 'POST',
        body: JSON.stringify({ from_year_id: oldYear.id, to_year_id: activeYear.id, copy_homeroom: false }),
    })
    const copyData = copyRes.ok ? await copyRes.json() : null
    check('copy-classes 200', copyRes.status === 200, `status=${copyRes.status}`)
    check('kelas senama di-skip (idempotent)', copyData?.copied === 0 && (copyData?.skipped || 0) >= 1, `copied=${copyData?.copied}, skipped=${copyData?.skipped}`)
    const { data: afterCopy } = await supabase.from('classes').select('id').eq('academic_year_id', activeYear.id).eq('name', `${U} 9X`)
    check('DB: tetap 1 kelas senama di tahun aktif (tidak dobel intra-tahun)', afterCopy?.length === 1, `n=${afterCopy?.length}`)

    // ════════ [5] POLA FILTER CLIENT-SIDE (dipakai fix konsumen) ════════
    console.log('\n[5] Pola filter client-side: is_active/status — hanya tahun aktif lolos')
    // Replikasi persis filter di fix pengumuman/dashboard:
    //   ay?.is_active === true || ay?.status === 'ACTIVE'
    const { data: allCls } = await supabase.from('classes')
        .select('id, name, academic_year:academic_years(is_active, status)')
        .eq('name', `${U} 9X`)
    const lolosFilter = (allCls || []).filter((c) => {
        const ay = Array.isArray(c.academic_year) ? c.academic_year[0] : c.academic_year
        return ay?.is_active === true || ay?.status === 'ACTIVE'
    })
    check('filter lolos: hanya kelas tahun AKTIF (COMPLETED tertahan)', lolosFilter.length === 1 && lolosFilter[0]?.id === clsActive.id, `n=${lolosFilter.length}`)

    // Tahun PLANNED juga harus tertahan (guard masa depan)
    const plannedYear = await mustInsert(supabase, 'academic_years', {
        school_id: school.id, name: `${parseInt(activeYear.name.split('/')[0]) + 5}/${parseInt(activeYear.name.split('/')[1]) + 5}`, is_active: false, status: 'PLANNED',
    }, 'tahun planned')
    created.years.push(plannedYear.id)
    const clsPlanned = await mustInsert(supabase, 'classes', {
        name: `${U} 9X`, academic_year_id: plannedYear.id, grade_level: 3, school_level: 'SMP',
    }, 'kelas senama tahun planned')
    created.classes.push(clsPlanned.id)
    const { data: allCls2 } = await supabase.from('classes')
        .select('id, name, academic_year:academic_years(is_active, status)')
        .eq('name', `${U} 9X`)
    const lolos2 = (allCls2 || []).filter((c) => {
        const ay = Array.isArray(c.academic_year) ? c.academic_year[0] : c.academic_year
        return ay?.is_active === true || ay?.status === 'ACTIVE'
    })
    check('3 kelas senama (aktif+completed+planned) → filter tetap hanya 1', lolos2.length === 1 && lolos2[0]?.id === clsActive.id, `n=${lolos2.length}`)

    // ---------- RINGKASAN ----------
    console.log('\n════ RINGKASAN ════')
    const failed = results.filter(r => !r.ok)
    console.log(`${results.length - failed.length}/${results.length} lulus${failed.length ? ` — GAGAL: ${failed.map(f => f.name).join('; ')}` : ''}`)

    // ---------- CLEANUP ----------
    console.log('\ncleanup...')
    const del = async (table, col, ids) => {
        if (!ids || ids.length === 0) return
        for (let i = 0; i < ids.length; i += 100) {
            await supabase.from(table).delete().in(col, ids.slice(i, i + 100))
        }
    }
    await del('classes', 'id', created.classes)
    await del('academic_years', 'id', created.years)
    await del('users', 'id', created.users)
    await stopServerSafe(server, BASE)
    console.log('selesai.')
    process.exit(failed.length ? 1 : 0)
}

main().catch(async (err) => {
    console.error('FATAL:', err.message)
    try {
        if (server) await stopServerSafe(server, BASE)
    } catch { /* best effort */ }
    process.exit(1)
})
