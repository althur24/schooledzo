/**
 * E2E VERIFIKASI FITUR MENU LABELS (custom nama menu per-sekolah).
 *
 * Menguji perubahan session ini:
 *  [1]  GET /api/school-settings kini terbuka untuk SEMUA role (SISWA/WALI
 *       butuh menu_labels untuk navigasi) — sebelumnya ADMIN+GURU saja
 *  [2]  PUT menu_labels → hanya ADMIN (GURU 403)
 *  [3]  Validasi: tipe salah → 400; key asing diabaikan; >30 char dipotong
 *       + BASELINE propagasi: error API lain memakai label DEFAULT
 *  [4]  Persistensi: schools.settings.menu_labels tersimpan di DB
 *  [5]  Merge safety: PUT key lain tidak menghapus menu_labels
 *  [6]  PROPAGASI label kustom ke pesan error API lain (getMenuLabelsForSchool
 *       di route terpisah) — termasuk jalur cache hit (panggilan ke-2/3) dan
 *       invalidation cache setelah PUT di [4]
 *  [7]  GET school-settings sebagai WALI → 200 (regresi role ke-4)
 *  [8]  Reset: label kosong → kembali default (key menu_labels hilang)
 *
 * Settings STG01 di-snapshot di awal dan DIPULIHKAN di akhir.
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_labels.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3101
const BASE = `http://localhost:${PORT}`

let server = null
let settingsSnapshot = null
const createdUsers = []
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `lbl_${runId}`
    const PASS = 'Label-Test-123'
    const passHash = bcrypt.hashSync(PASS, 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code, settings').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    settingsSnapshot = school.settings // untuk restore di akhir

    const mkUser = async (label, role) => {
        const u = await supabase.from('users').insert({
            username: `${U}_${label}`, full_name: `${U} ${label}`,
            password_hash: passHash, role, school_id: school.id,
            must_change_password: false, is_locked: false,
        }).select().single()
        if (u.error || !u.data) throw new Error(`Insert user ${label} gagal: ${u.error?.message}`)
        createdUsers.push(u.data.id)
        return u.data
    }
    const admin = await mkUser('admin', 'ADMIN')
    const guru = await mkUser('guru', 'GURU')
    const siswa = await mkUser('siswa', 'SISWA')
    const wali = await mkUser('wali', 'WALI')

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    const doLogin = async (username) => {
        const r = await fetch(BASE + '/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: PASS }),
        })
        const setCookie = r.headers.getSetCookie?.() || []
        const tokenCookie = setCookie.map(c => c.split(';')[0]).find(c => c.startsWith('session_token='))
        return tokenCookie ? tokenCookie.split('=')[1] : null
    }

    // ════════ [1] GET terbuka untuk semua role ════════
    console.log('[1] GET /api/school-settings per role')
    const adminTok = await doLogin(admin.username)
    const guruTok = await doLogin(guru.username)
    const siswaTok = await doLogin(siswa.username)
    check('login admin/guru/siswa', !!(adminTok && guruTok && siswaTok))

    const gSiswa = await api('/api/school-settings', siswaTok)
    const gSiswaBody = gSiswa.ok ? await gSiswa.json() : null
    check('GET sebagai SISWA → 200 (dulu 403)', gSiswa.status === 200)
    // Struktur-based (bukan nilai default): sekolah mungkin sudah punya label
    // kustom tersimpan dari pemakaian nyata — yang dijamin API adalah respons
    // selalu berisi 5 key lengkap (fallback default di server).
    const mlKeys = Object.keys(gSiswaBody?.menu_labels || {})
    check('respons SISWA berisi menu_labels lengkap (5 key)', gSiswa.status === 200 && mlKeys.length === 5 && ['tugas','kuis','ulangan','uts','uas'].every(k => typeof gSiswaBody.menu_labels[k] === 'string'), JSON.stringify(gSiswaBody?.menu_labels))

    const gGuru = await api('/api/school-settings', guruTok)
    check('GET sebagai GURU → 200 (regresi: tetap boleh)', gGuru.status === 200)

    // ════════ [2] PUT hanya ADMIN ════════
    console.log('\n[2] PUT menu_labels — otorisasi')
    const pGuru = await api('/api/school-settings', guruTok, {
        method: 'PUT', body: JSON.stringify({ menu_labels: { tugas: 'Hack' } }),
    })
    check('PUT sebagai GURU → 403', pGuru.status === 403)

    // ════════ [3] Validasi input ════════
    console.log('\n[3] Validasi input menu_labels')
    const pBad = await api('/api/school-settings', adminTok, {
        method: 'PUT', body: JSON.stringify({ menu_labels: { tugas: 123 } }),
    })
    check('PUT tipe salah (number) → 400', pBad.status === 400)

    const longStr = 'X'.repeat(50)
    const pLong = await api('/api/school-settings', adminTok, {
        method: 'PUT', body: JSON.stringify({ menu_labels: { uts: longStr } }),
    })
    const pLongBody = pLong.ok ? await pLong.json() : null
    check('label >30 karakter dipotong ke 30', pLong.status === 200 && pLongBody?.menu_labels?.uts === 'X'.repeat(30))

    // ID fiktif (UUID valid) untuk memicu jalur error berlabel di route lain
    const FAKE_ID = '00000000-0000-0000-0000-000000000000'

    // BASELINE: sebelum label kustom, pesan error API lain pakai default 'Kuis'
    const bManual = await api('/api/quiz-submissions/manual', guruTok, {
        method: 'POST', body: JSON.stringify({ quiz_id: FAKE_ID, student_id: FAKE_ID, score: 80 }),
    })
    const bManualBody = bManual.json ? await bManual.json().catch(() => null) : null
    check('baseline: error API pakai label default "Kuis tidak ditemukan"', bManual.status === 404 && bManualBody?.error === 'Kuis tidak ditemukan', `status=${bManual.status} error=${bManualBody?.error}`)

    // ════════ [4] Simpan label kustom + persistensi DB ════════
    console.log('\n[4] Simpan label kustom (ADMIN)')
    const custom = {
        tugas: 'PR Harian',
        kuis: 'Tes Kilat',
        ulangan: 'Ujian Harian',
        uts: 'Ujian Tengah Semester',
        uas: 'Ujian Akhir Semester',
        key_asing: 'harus-diabaikan',
    }
    const pSave = await api('/api/school-settings', adminTok, {
        method: 'PUT', body: JSON.stringify({ menu_labels: custom }),
    })
    const pSaveBody = pSave.ok ? await pSave.json() : null
    check('PUT label kustom → 200', pSave.status === 200)
    check('respons PUT berisi label ter-resolve', pSaveBody?.menu_labels?.tugas === 'PR Harian' && pSaveBody?.menu_labels?.uts === 'Ujian Tengah Semester', JSON.stringify(pSaveBody?.menu_labels))
    check('key asing DI DALAM menu_labels diabaikan (respons tepat 5 key)', Object.keys(pSaveBody?.menu_labels || {}).length === 5 && !('key_asing' in (pSaveBody?.menu_labels || {})))

    const { data: schoolAfter } = await supabase.from('schools').select('settings').eq('id', school.id).single()
    check('DB schools.settings.menu_labels tersimpan', schoolAfter?.settings?.menu_labels?.tugas === 'PR Harian')
    check('DB menu_labels bersih dari key asing', Object.keys(schoolAfter?.settings?.menu_labels || {}).length === 5)

    const gSiswa2 = await api('/api/school-settings', siswaTok)
    const gSiswa2Body = gSiswa2.ok ? await gSiswa2.json() : null
    check('SISWA melihat label kustom', gSiswa2Body?.menu_labels?.ulangan === 'Ujian Harian' && gSiswa2Body?.menu_labels?.uas === 'Ujian Akhir Semester')

    // ════════ [5] Merge safety ════════
    console.log('\n[5] Merge safety — PUT key lain tidak menghapus menu_labels')
    const pOther = await api('/api/school-settings', adminTok, {
        method: 'PUT', body: JSON.stringify({ ai_review_enabled: false }),
    })
    const { data: schoolMerged } = await supabase.from('schools').select('settings').eq('id', school.id).single()
    check('menu_labels selamat setelah PUT ai_review_enabled', pOther.status === 200 && schoolMerged?.settings?.menu_labels?.tugas === 'PR Harian')

    // ════════ [6] Propagasi label kustom ke API lain + cache ════════
    console.log('\n[6] Propagasi label kustom ke pesan error API lain')
    // Label kustom aktif sejak [4]. Panggilan #1 = cache miss (fetch DB),
    // #2 & #3 = cache hit — semua harus menampilkan label kustom (bukan default),
    // membuktikan invalidateSchoolLabelsCache() di PUT benar-benar bekerja.
    const pManual = await api('/api/quiz-submissions/manual', guruTok, {
        method: 'POST', body: JSON.stringify({ quiz_id: FAKE_ID, student_id: FAKE_ID, score: 80 }),
    })
    const pManualBody = pManual.json ? await pManual.json().catch(() => null) : null
    check('quiz-submissions/manual (cache miss) → "Tes Kilat tidak ditemukan"', pManual.status === 404 && pManualBody?.error === 'Tes Kilat tidak ditemukan', `status=${pManual.status} error=${pManualBody?.error}`)

    const pExamSync = await api(`/api/exams/${FAKE_ID}/sync-batch`, guruTok, { method: 'POST' })
    const pExamSyncBody = pExamSync.json ? await pExamSync.json().catch(() => null) : null
    check('exams/sync-batch (cache hit) → "Ujian Harian tidak ditemukan"', pExamSync.status === 404 && pExamSyncBody?.error === 'Ujian Harian tidak ditemukan', `status=${pExamSync.status} error=${pExamSyncBody?.error}`)

    const pQuizSync = await api(`/api/quizzes/${FAKE_ID}/sync-batch`, adminTok, { method: 'POST' })
    const pQuizSyncBody = pQuizSync.json ? await pQuizSync.json().catch(() => null) : null
    check('quizzes/sync-batch (cache hit) → "Tes Kilat tidak ditemukan"', pQuizSync.status === 404 && pQuizSyncBody?.error === 'Tes Kilat tidak ditemukan', `status=${pQuizSync.status} error=${pQuizSyncBody?.error}`)

    // ════════ [7] GET school-settings sebagai WALI ════════
    console.log('\n[7] GET /api/school-settings sebagai WALI')
    const waliTok = await doLogin(wali.username)
    check('login WALI', !!waliTok)
    const gWali = await api('/api/school-settings', waliTok)
    const gWaliBody = gWali.ok ? await gWali.json() : null
    check('GET sebagai WALI → 200 + menu_labels', gWali.status === 200 && gWaliBody?.menu_labels?.tugas === 'PR Harian', `status=${gWali.status}`)

    // ════════ [8] Reset ke default ════════
    console.log('\n[8] Reset label ke default')
    const pReset = await api('/api/school-settings', adminTok, {
        method: 'PUT', body: JSON.stringify({ menu_labels: { tugas: '', kuis: '   ', ulangan: '', uts: '', uas: '' } }),
    })
    const pResetBody = pReset.ok ? await pReset.json() : null
    const { data: schoolReset } = await supabase.from('schools').select('settings').eq('id', school.id).single()
    check('PUT label kosong → respons kembali default', pReset.status === 200 && pResetBody?.menu_labels?.tugas === 'Tugas')
    check('key menu_labels hilang dari DB (default)', !('menu_labels' in (schoolReset?.settings || {})))

    // ---------- RINGKASAN ----------
    console.log('\n════ RINGKASAN ════')
    const failed = results.filter(r => !r.ok)
    console.log(`${results.length - failed.length}/${results.length} lulus${failed.length ? ` — GAGAL: ${failed.map(f => f.name).join('; ')}` : ''}`)

    // ---------- CLEANUP ----------
    console.log('\ncleanup: pulihkan settings STG01 + hapus user uji')
    await supabase.from('schools').update({ settings: settingsSnapshot }).eq('id', school.id)
    for (const uid of createdUsers) await supabase.from('users').delete().eq('id', uid)
    await stopServerSafe(server, BASE)
    console.log('selesai.')
    process.exit(failed.length ? 1 : 0)
}

main().catch(async (err) => {
    console.error('FATAL:', err.message)
    // cleanup best-effort
    try {
        if (settingsSnapshot) {
            const { data: s } = await supabase.from('schools').select('id').eq('code', 'STG01').single()
            if (s) await supabase.from('schools').update({ settings: settingsSnapshot }).eq('id', s.id)
        }
        for (const uid of createdUsers) await supabase.from('users').delete().eq('id', uid)
        if (server) await stopServerSafe(server, BASE)
    } catch { /* best effort */ }
    process.exit(1)
})
