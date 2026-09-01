/**
 * E2E FINAL ALUR MATERI + FIX SECURITY — pakai akun demo SSA SCHOOL (production).
 *
 * Memverifikasi seluruh fix sesi materi secara end-to-end lewat HTTP:
 *  - [e30eea7]  SISWA /api/students auto-scope: tanpa user_id → data diri sendiri
 *               (bukan roster se-sekolah); user_id orang lain → []
 *  - [00cc749]  Leak enrollment tertutup: ?user_id=<self>&enrollment_year_id=...
 *               hanya mengembalikan data sendiri (dulu: roster seluruh sekolah)
 *  - [186d303]  /api/materials SISWA ter-scope kelas sendiri via class_id
 *               (bukan nama kelas) — siswa X IPA 1 tidak menerima materi kelas lain
 *  - [186d303]  embed class.id tersedia (prasyarat filter client by class_id)
 *  -            GURU /api/materials hanya materi TA miliknya sendiri
 *
 * Akun (dari _seed_ssa.mjs, tahun aktif 2029/2030):
 *   siswa X IPA 1 = 202990001.ssa, siswa X IPA 2 = 202990005.ssa,
 *   guru          = siti.rahma.ssa (Matematika X IPA 1 & X IPA 2)
 *
 * Jalankan: node loadtest/e2e/e2e_ssa_materi.cjs   (default .env.local = production;
 * session uji dibuat langsung di tabel sessions dan dibersihkan di akhir —
 * tidak ada password yang perlu diketahui, tidak ada data sekolah lain yang disentuh.)
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const { makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb, makeSession } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3101
const BASE = `http://localhost:${PORT}`

let server = null
const created = { sessions: [] }
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    // ---------- FIXTURES (read-only terhadap data SSA yang sudah ada) ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'ssa').single()
    if (!school) throw new Error('SSA SCHOOL tidak ditemukan — abort.')

    const { data: years } = await supabase.from('academic_years')
        .select('id, name').eq('school_id', school.id).eq('is_active', true)
    if (!years || years.length === 0) throw new Error('SSA tidak punya tahun ajaran aktif — abort.')
    const year = years[0]

    const { data: siswa1Row } = await supabase.from('students')
        .select('id, nis, class_id, user:users!students_user_id_fkey(id, username)')
        .eq('nis', '202990001').eq('school_id', school.id).single()
    const { data: siswa2Row } = await supabase.from('students')
        .select('id, nis, class_id, user:users!students_user_id_fkey(id, username)')
        .eq('nis', '202990005').eq('school_id', school.id).single()
    const { data: guruUser } = await supabase.from('users').select('id, username').eq('username', 'siti.rahma.ssa').single()
    if (!siswa1Row || !siswa2Row || !guruUser) throw new Error('Akun seed SSA tidak ditemukan (202990001/202990005/siti.rahma) — abort.')
    const siswa1 = { ...siswa1Row, userId: siswa1Row.user.id }   // X IPA 1
    const siswa2 = { ...siswa2Row, userId: siswa2Row.user.id }   // X IPA 2

    // Expected materi per siswa: semua materi TA kelasnya, tahun aktif (source of truth DB)
    const { data: expected1 } = await supabase.from('materials')
        .select('id, title, ta:teaching_assignments!inner(id, class:classes(id, name))')
        .eq('ta.academic_year_id', year.id).eq('ta.class_id', siswa1.class_id)
    const expTitles1 = new Set((expected1 || []).map(m => m.title))

    const tokSiswa1 = await makeSession(supabase, siswa1.userId, created)
    const tokSiswa2 = await makeSession(supabase, siswa2.userId, created)
    const tokGuru = await makeSession(supabase, guruUser.id, created)
    console.log(`fixtures OK — siswa X IPA 1 (${expTitles1.size} materi expected), siswa X IPA 2, guru siti.rahma`)

    // ---------- START SERVER (production DB) ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, false)
    const api = makeApi(BASE)
    console.log('server up (production DB terverifikasi)\n')

    // ---------- 1. [e30eea7] AUTO-SCOPE /api/students ----------
    console.log('[1] SISWA /api/students — auto-scope')
    const t1res = await api('/api/students', tokSiswa1)
    const t1 = await t1res.json().catch(() => null)
    check('tanpa user_id → 200 dan array', t1res.status === 200 && Array.isArray(t1), `status ${t1res.status}`)
    check('tanpa user_id → HANYA data diri (bukan roster sekolah)', Array.isArray(t1) && t1.length === 1 && t1[0].nis === '202990001', `dapat ${Array.isArray(t1) ? t1.length : '?'} baris`)

    const t1b = await api(`/api/students?user_id=${siswa2.userId}`, tokSiswa1)
    const t1bData = await t1b.json().catch(() => null)
    check('user_id milik siswa LAIN → []', Array.isArray(t1bData) && t1bData.length === 0, `dapat ${Array.isArray(t1bData) ? t1bData.length : '?'} baris`)

    const t2res = await api(`/api/students?user_id=${siswa1.userId}`, tokSiswa1)
    const t2 = await t2res.json().catch(() => null)
    const t2row = Array.isArray(t2) && t2[0]
    check('user_id diri sendiri → 1 baris + class_id + class.id (embed utk filter client)',
        t2row && t2row.nis === '202990001' && t2row.class_id && t2row.class?.id,
        `class.id: ${t2row?.class?.id ? 'ada' : 'HILANG'}`)

    // ---------- 2. [00cc749] LEAK ENROLLMENT TERTUTUP ----------
    console.log('[2] SISWA /api/students?enrollment_year_id — leak roster tertutup')
    const t3res = await api(`/api/students?user_id=${siswa1.userId}&enrollment_year_id=${year.id}`, tokSiswa1)
    const t3 = await t3res.json().catch(() => null)
    check('kombinasi user_id sendiri + enrollment_year_id → maksimal data sendiri (dulu: roster seluruh sekolah)',
        Array.isArray(t3) && t3.length <= 1 && (t3.length === 0 || t3[0].nis === '202990001'),
        `dapat ${Array.isArray(t3) ? t3.length : '?'} baris`)

    // ---------- 3. [186d303] /api/materials SCOPE KELAS SISWA ----------
    console.log('[3] SISWA /api/materials — scope kelas via class_id')
    const m1res = await api('/api/materials', tokSiswa1)
    const m1 = await m1res.json().catch(() => null)
    check('200 dan array', m1res.status === 200 && Array.isArray(m1), `status ${m1res.status}`)
    check('SEMUA materi milik kelas sendiri (class.id === class_id siswa)',
        Array.isArray(m1) && m1.every(m => m.teaching_assignment?.class?.id === siswa1.class_id),
        `aneh: ${Array.isArray(m1) ? m1.filter(m => m.teaching_assignment?.class?.id !== siswa1.class_id).length : '?'} baris kelas lain`)
    check('embed class.id tersedia di setiap baris (prasyarat filter client)',
        Array.isArray(m1) && m1.every(m => !!m.teaching_assignment?.class?.id))
    const gotTitles = new Set((m1 || []).map(m => m.title))
    check(`isi lengkap: ${expTitles1.size} materi kelas X IPA 1 semua tampil`,
        expTitles1.size > 0 && [...expTitles1].every(t => gotTitles.has(t)),
        `expected ${expTitles1.size}, dapat ${gotTitles.size}`)
    // Simulasi filter client (materi page) — harus identik dgn respons server
    check('filter client by class.id (paritas fix materi page) tidak membuang apa pun',
        Array.isArray(m1) && m1.filter(m => m.teaching_assignment?.class?.id === siswa1.class_id).length === m1.length)

    // Siswa kelas lain: konten yang TIDAK boleh terlihat
    const m2 = await (await api('/api/materials', tokSiswa2)).json().catch(() => null)
    const m2Titles = new Set((m2 || []).map(m => m.title))
    const onlyOtherClass = [...expTitles1].filter(t => !m2Titles.has(t))
    check(`siswa X IPA 2 tidak menerima materi eksklusif kelas lain (${onlyOtherClass.length} materi beda)`,
        Array.isArray(m2) && m2.every(m => m.teaching_assignment?.class?.id === siswa2.class_id),
        `kelas2: ${m2Titles.size} materi`)

    // ---------- 4. GURU: MATERI HANYA TA MILIKNYA ----------
    console.log('[4] GURU /api/materials — scope TA sendiri')
    const { data: guruTeacher } = await supabase.from('teachers').select('id').eq('user_id', guruUser.id).single()
    const { data: guruTAs } = await supabase.from('teaching_assignments').select('id').eq('teacher_id', guruTeacher.id)
    const guruTaIds = new Set((guruTAs || []).map(t => t.id))
    const mg = await (await api('/api/materials', tokGuru)).json().catch(() => null)
    check('semua materi milik TA guru sendiri',
        Array.isArray(mg) && mg.every(m => guruTaIds.has(m.teaching_assignment?.id)),
        `aneh: ${Array.isArray(mg) ? mg.filter(m => !guruTaIds.has(m.teaching_assignment?.id)).length : '?'} baris TA orang lain`)

    // ---------- RINGKASAN ----------
    const failed = results.filter(r => !r.ok)
    console.log(`\n${failed.length === 0 ? 'SEMUA PASS' : 'ADA KEGAGALAN'} — ${results.length - failed.length}/${results.length} check lulus`)
    if (failed.length > 0) {
        failed.forEach(f => console.log(`  FAIL: ${f.name} ${f.detail}`))
        process.exitCode = 1
    }
}

main().catch(err => {
    console.error('E2E ERROR:', err.message)
    process.exitCode = 1
}).finally(async () => {
    // Cleanup: hapus session uji (jangan tinggalkan token aktif di production)
    if (created.sessions.length > 0) {
        const { error } = await supabase.from('sessions').delete().in('token', created.sessions)
        if (error) console.error('CLEANUP GAGAL (session uji masih ada):', error.message)
        else console.log(`cleanup: ${created.sessions.length} session uji dihapus`)
    }
    if (server) await stopServerSafe(server, BASE)
})
