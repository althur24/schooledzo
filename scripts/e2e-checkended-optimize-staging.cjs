/**
 * E2E staging: optimasi checkEndedOfficialExams (fix CPU 100% 24 Sep 2026).
 *
 * Perubahan yang diuji:
 *   1. GATE ROLE   — GET /api/official-exams oleh SISWA tidak lagi memicu
 *      checkEndedOfficialExams (dulu: tiap siswa buka list = loop dedup
 *      ±98 ujian × seq-scan notifications → CPU DB pin saat burst entry).
 *   2. BATCH DEDUP — dedup notifikasi jadi satu query .in('link', semua)
 *      (index idx_notifications_type_link); notifikasi tetap terkirim ke
 *      guru yang tepat (TA mapel×kelas, tahun aktif) dengan format sama.
 *   3. WINDOW 7 HARI — ujian berakhir >7 hari tidak diproses (kandidat
 *      tumbuh permanen sebab ujian aktif tidak pernah dinonaktifkan).
 *   4. THROTTLE in-process 10 mnt per sekolah — GET kedua dalam TTL tidak
 *      menjalankan ulang (uji: ujian baru yang muncul setelah GET pertama
 *      tidak dinotifikasi sampai TTL lewat / proses restart).
 *
 * PRASYARAT:
 *   1. set -a; source .env.staging; set +a; npm run build
 *   2. bash loadtest/push-staging-migration.sh   (20260924051425 index)
 *   3. set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   4. ENV_FILE=.env.staging node scripts/e2e-checkended-optimize-staging.cjs seed
 *   5. ENV_FILE=.env.staging node scripts/e2e-checkended-optimize-staging.cjs phase1
 *   6. RESTART server (kill & ulangi langkah 3) — throttle map in-process kosong lagi
 *   7. ENV_FILE=.env.staging node scripts/e2e-checkended-optimize-staging.cjs phase2
 *   8. ENV_FILE=.env.staging node scripts/e2e-checkended-optimize-staging.cjs cleanup
 *
 * Fixture (prefix e2e5b000-, user e2co_):
 *   E1 — aktif, berakhir 2 jam lalu   → HARUS dinotifikasi saat guru GET
 *   E2 — aktif, berakhir 8 hari lalu  → TIDAK PERNAH (window 7 hari)
 *   E3 — aktif, berakhir 30 mnt lalu, DIBUAT SETELAH GET guru pertama
 *        → tidak dinotifikasi saat GET kedua (throttle), dinotifikasi
 *          setelah restart (TTL in-process, proses baru jalan lagi)
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2co1234!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2' // Matematika STG
const CLASS = '7da71f34-b051-4aa9-ab4d-967ae741f61c'   // Kelas STG 8A

const EX1 = 'e2e5b000-0000-4000-8000-0000000000e1'
const EX2 = 'e2e5b000-0000-4000-8000-0000000000e2'
const EX3 = 'e2e5b000-0000-4000-8000-0000000000e3'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}

const notifLink = (id) => `/dashboard/guru/uts-uas/${id}#hasil`
const legacyNotifLink = (id) => `/dashboard/guru/uts-uas/${id}/hasil`

async function login(username) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASS }),
    })
    if (!res.ok) throw new Error(`login ${username} gagal: ${res.status}`)
    return res.headers.get('set-cookie')?.split(';')[0]
}

async function api(method, path, body, cookie) {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    })
    let data = null
    try { data = await res.json() } catch { /* no body */ }
    return { status: res.status, data }
}

async function notifsFor(examId, userId) {
    let q = supabase.from('notifications')
        .select('id, user_id, type, title, link')
        .in('link', [notifLink(examId), legacyNotifLink(examId)])
    if (userId) q = q.eq('user_id', userId)
    const { data } = await q
    return data || []
}

async function pollNotif(examId, tries = 15) {
    for (let i = 0; i < tries; i++) {
        const rows = await notifsFor(examId)
        if (rows.length > 0) return rows
        await new Promise(r => setTimeout(r, 1000))
    }
    return []
}

async function cleanupAll() {
    await supabase.from('notifications').delete().like('link', '/dashboard/guru/uts-uas/e2e5b000-%')
    await supabase.from('official_exam_questions').delete().in('exam_id', [EX1, EX2, EX3])
    await supabase.from('official_exam_submissions').delete().in('exam_id', [EX1, EX2, EX3])
    await supabase.from('official_exams').delete().in('id', [EX1, EX2, EX3])
    const { data: olds } = await supabase.from('users').select('id').like('username', 'e2co_%')
    for (const x of (olds || [])) {
        const { data: t } = await supabase.from('teachers').select('id').eq('user_id', x.id).maybeSingle()
        if (t) {
            await supabase.from('teaching_assignments').delete().eq('teacher_id', t.id)
            await supabase.from('teachers').delete().eq('id', t.id)
        }
        await supabase.from('sessions').delete().eq('user_id', x.id)
        await supabase.from('notifications').delete().eq('user_id', x.id)
        await supabase.from('users').delete().eq('id', x.id)
    }
}

async function seedUsersAndTa() {
    const passHash = await bcrypt.hash(PASS, 10)
    const { data: guruU } = await supabase.from('users')
        .insert({ username: 'e2co_guru', full_name: 'E2CO Guru', password_hash: passHash, role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    const { data: siswaU } = await supabase.from('users')
        .insert({ username: 'e2co_siswa', full_name: 'E2CO Siswa', password_hash: passHash, role: 'SISWA', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    const { data: teacher } = await supabase.from('teachers')
        .insert({ user_id: guruU.id, school_id: SCHOOL }).select('id').single()
    const { data: student } = await supabase.from('students')
        .insert({ user_id: siswaU.id, school_id: SCHOOL, class_id: CLASS, nis: 'e2co0001' }).select('id').single()
    await supabase.from('student_enrollments')
        .insert({ student_id: student.id, academic_year_id: YEAR, class_id: CLASS, status: 'ACTIVE' })
    await supabase.from('teaching_assignments')
        .insert({ teacher_id: teacher.id, subject_id: SUBJECT, class_id: CLASS, academic_year_id: YEAR })
    return { guruUserId: guruU.id }
}

const baseExam = (title) => ({
    school_id: SCHOOL, academic_year_id: YEAR, subject_id: SUBJECT,
    exam_type: 'UTS', duration_minutes: 60, target_class_ids: [CLASS],
    title, is_active: true,
})

async function seed() {
    console.log('═══ SEED ══')
    await cleanupAll()
    await seedUsersAndTa()

    const now = Date.now()
    const iso = (ms) => new Date(now + ms).toISOString()
    const D = 24 * 3600e3
    await supabase.from('official_exams').insert([
        { ...baseExam('e2co_E1 Baru berakhir (2 jam)'), id: EX1, start_time: iso(-3 * 3600e3), window_end_time: iso(-1 * 3600e3) },
        { ...baseExam('e2co_E2 Tua (8 hari)'), id: EX2, start_time: iso(-8 * D - 3600e3), window_end_time: iso(-8 * D) },
    ])
    const { data: states } = await supabase.from('official_exams').select('id, is_active').in('id', [EX1, EX2])
    check('seed: E1 aktif', states?.find(r => r.id === EX1)?.is_active === true)
    check('seed: E2 aktif', states?.find(r => r.id === EX2)?.is_active === true)
    check('seed: E1 tanpa notifikasi awal', (await notifsFor(EX1)).length === 0)
    check('seed: E2 tanpa notifikasi awal', (await notifsFor(EX2)).length === 0)
    console.log(`seed selesai — ${pass} ok, ${fail} fail`)
}

async function phase1() {
    console.log('═══ PHASE 1 (server baru, throttle kosong) ══')
    const guru = await login('e2co_guru')
    const siswa = await login('e2co_siswa')
    const { data: guruUser } = await supabase.from('users').select('id').eq('username', 'e2co_guru').single()

    // ═══ [A] GATE ROLE: siswa tidak memicu checkEndedOfficialExams ═══
    console.log('\n═══ [A] Siswa GET list — TIDAK memicu notifikasi ══')
    const t0 = Date.now()
    const { status: sSt } = await api('GET', '/api/official-exams', null, siswa)
    check('Siswa GET /api/official-exams 200', sSt === 200, sSt)
    check('Respons siswa cepat (fire-and-forget tidak menunggu)', Date.now() - t0 < 5000, Date.now() - t0)
    await new Promise(r => setTimeout(r, 8000))
    check('GATE ROLE: tidak ada notif E1 setelah siswa buka list', (await notifsFor(EX1)).length === 0)
    check('GATE ROLE: tidak ada notif E2 setelah siswa buka list', (await notifsFor(EX2)).length === 0)

    // ═══ [B] GURU GET → notifikasi terkirim via batch dedup ═══
    console.log('\n═══ [B] Guru GET list → notifikasi E1 terkirim (batch path) ══')
    const { status: gSt } = await api('GET', '/api/official-exams', null, guru)
    check('Guru GET 200', gSt === 200, gSt)
    const notif1 = await pollNotif(EX1)
    // Notifikasi dikirim ke SEMUA guru pengampu mapel×kelas (termasuk
    // stg_template_guru dari seed baseline) — asersi per-user, bukan total.
    const mine1 = notif1.filter(n => n.user_id === guruUser.id)
    check('Notif E1 terkirim', notif1.length >= 1, notif1)
    check('Notif E1 → guru pengampu yang tepat (TA mapel×kelas)', mine1.length === 1, notif1.map(n => n.user_id))
    check('Notif E1 bertipe UJIAN_SELESAI', mine1[0]?.type === 'UJIAN_SELESAI', mine1[0]?.type)
    check('Notif E1 link format #hasil', mine1[0]?.link === notifLink(EX1), mine1[0]?.link)
    check('Notif E1 judul "✅ UTS Selesai: <title>"', mine1[0]?.title === '✅ UTS Selesai: e2co_E1 Baru berakhir (2 jam)', mine1[0]?.title)

    // ═══ [C] WINDOW 7 HARI: E2 (8 hari) tidak dinotifikasi ═══
    console.log('\n═══ [C] Window 7 hari — E2 (8 hari) di-skip ══')
    await new Promise(r => setTimeout(r, 3000))
    check('WINDOW: tidak ada notif E2 (berakhir 8 hari lalu)', (await notifsFor(EX2)).length === 0)

    // ═══ [D] THROTTLE: ujian baru setelah GET pertama tidak dinotifikasi ═══
    console.log('\n═══ [D] Throttle — GET kedua dalam TTL tidak menjalankan ulang ══')
    const now = Date.now()
    await supabase.from('official_exams').insert({
        ...baseExam('e2co_E3 Muncul setelah GET (30 mnt)'),
        id: EX3, start_time: new Date(now - 90 * 60e3).toISOString(), window_end_time: new Date(now - 30 * 60e3).toISOString(),
    })
    await new Promise(r => setTimeout(r, 2000))
    const { status: g2St } = await api('GET', '/api/official-exams', null, guru)
    check('Guru GET kedua 200', g2St === 200, g2St)
    await new Promise(r => setTimeout(r, 8000))
    check('THROTTLE: E3 TIDAK dinotifikasi (run ke-2 di-skip)', (await notifsFor(EX3)).length === 0)
    check('Dedup: notif E1 tidak dobel (per guru)', (await notifsFor(EX1, guruUser.id)).length === 1)

    console.log(`\n═══ PHASE 1: ${pass} ok, ${fail} fail ══`)
    if (fail > 0) process.exit(1)
    console.log('\n>>> RESTART server sekarang (throttle map in-process kosong lagi), lalu jalankan phase2 <<<')
}

async function phase2() {
    console.log('═══ PHASE 2 (setelah restart — throttle in-process reset) ══')
    const guru = await login('e2co_guru')
    const { data: guruUser } = await supabase.from('users').select('id').eq('username', 'e2co_guru').single()

    // ═══ [E] Setelah restart, GET guru → E3 (kandidat baru) dinotifikasi ═══
    console.log('\n═══ [E] Restart → E3 dinotifikasi pada run berikutnya ══')
    const { status: gSt } = await api('GET', '/api/official-exams', null, guru)
    check('Guru GET 200', gSt === 200, gSt)
    const notif3 = await pollNotif(EX3)
    const mine3 = notif3.filter(n => n.user_id === guruUser.id)
    check('E3 dinotifikasi setelah restart (throttle in-process)', mine3.length === 1, notif3.map(n => n.user_id))
    check('Notif E3 → guru pengampu yang tepat', mine3[0]?.user_id === guruUser.id)
    check('Dedup lintas restart: E1 tetap 1 per guru (batch dedup)', (await notifsFor(EX1, guruUser.id)).length === 1, (await notifsFor(EX1, guruUser.id)).length)
    check('WINDOW: E2 tetap tanpa notif', (await notifsFor(EX2)).length === 0)

    console.log(`\n═══ PHASE 2: ${pass} ok, ${fail} fail ══`)
    if (fail > 0) process.exit(1)
}

async function cleanup() {
    console.log('═══ CLEANUP ══')
    await cleanupAll()
    const { count: exCount } = await supabase.from('official_exams').select('id', { count: 'exact', head: true }).like('id', 'e2e5b000-%')
    const { data: users } = await supabase.from('users').select('id').like('username', 'e2co_%')
    const { data: notifs } = await supabase.from('notifications').select('id').like('link', '/dashboard/guru/uts-uas/e2e5b000-%')
    console.log('sisa exam:', exCount, '| sisa user:', users?.length || 0, '| sisa notif:', notifs?.length || 0)
    if ((exCount || 0) === 0 && (users?.length || 0) === 0 && (notifs?.length || 0) === 0) console.log('cleanup bersih ✓')
    else { console.log('CLEANUP TIDAK BERSIH'); process.exit(1) }
}

const phase = process.argv[2]
if (phase === 'seed') seed().catch(e => { console.error(e); process.exit(1) })
else if (phase === 'phase1') phase1().catch(e => { console.error(e); process.exit(1) })
else if (phase === 'phase2') phase2().catch(e => { console.error(e); process.exit(1) })
else if (phase === 'cleanup') cleanup().catch(e => { console.error(e); process.exit(1) })
else {
    console.log('Pemakaian: node scripts/e2e-checkended-optimize-staging.cjs <seed|phase1|phase2|cleanup>')
    process.exit(1)
}
