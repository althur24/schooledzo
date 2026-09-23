/**
 * E2E staging: status UTS/UAS "Selesai" + sweeper tidak lagi menonaktifkan.
 *
 * Bug yang diuji: checkEndedOfficialExams (dulu) mematikan is_active saat
 * jendela waktu lewat → getOfficialExamStatus mengecek is_active duluan →
 * ujian selesai tampil "Draft" selamanya. Fix: hapus auto-deactivate +
 * migrasi reaktivasi korban lama.
 *
 * PRASYARAT (urutan WAJIB):
 *   1. node scripts/e2e-status-utsuas-staging.cjs seed
 *   2. bash loadtest/push-staging-migration.sh  (migrasi 20260923035940)
 *   3. set -a; source .env.staging; set +a; npm run build
 *   4. set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   5. ENV_FILE=.env.staging node scripts/e2e-status-utsuas-staging.cjs run
 *   6. ENV_FILE=.env.staging node scripts/e2e-status-utsuas-staging.cjs cleanup
 *
 * Fixture (UUID deterministik prefix e2e5a000-):
 *   A — is_active=true,  jendela lewat → state post-fix ("Selesai")
 *   B — is_active=false, jendela lewat, ADA submission → korban sweeper lama
 *       (harus direaktivasi oleh migrasi)
 *   C — is_active=false, jendela lewat, TANPA submission → draft asli
 *       (tidak boleh tersentuh migrasi)
 *   D — is_active=true,  jendela berjalan → kontrol "Berlangsung"
 *
 * Seksi:
 *   [1] Migrasi: B→true, C tetap false, A/D tak tersentuh
 *   [2] GET /api/official-exams (admin): is_active benar per ujian
 *   [3] REGRESI INTI: sweeper TIDAK menonaktifkan A/B saat list dibuka
 *   [4] Notifikasi UJIAN_SELESAI terkirim ke guru (TA mapel×kelas)
 *   [5] Dedup notifikasi (GET kedua tidak dobel)
 *   [6] List siswa: ujian selesai tampil, draft tersembunyi + list guru
 *   [7] Gate start: siswa tidak bisa memulai ujian selesai (A) — 400
 *   [8] Resume gate: B (sudah submit) → "Anda sudah mengumpulkan ujian ini"
 *   [9] Monitor ujian selesai tetap bisa dibuka admin (post-mortem)
 *   [10] Monitor ujian live (D) — sanity
 *   [11] GET detail A (admin) — halaman detail butuh data ini
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2su1234!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2' // Matematika STG
const CLASS = '7da71f34-b051-4aa9-ab4d-967ae741f61c'   // Kelas STG 8A

const EX_A = 'e2e5a000-0000-4000-8000-0000000000a1'
const EX_B = 'e2e5a000-0000-4000-8000-0000000000b2'
const EX_C = 'e2e5a000-0000-4000-8000-0000000000c3'
const EX_D = 'e2e5a000-0000-4000-8000-0000000000d4'
const Q_A = 'e2e5a000-0000-4000-8000-000000000011'
const Q_B = 'e2e5a000-0000-4000-8000-000000000022'
const Q_D = 'e2e5a000-0000-4000-8000-000000000044'
const SUB_B = 'e2e5a000-0000-4000-8000-0000000000b5'
const EX_IDS = [EX_A, EX_B, EX_C, EX_D]

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}

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

async function getStates() {
    const { data } = await supabase.from('official_exams').select('id, is_active').in('id', EX_IDS)
    const m = new Map((data || []).map(r => [r.id, r.is_active]))
    return m
}

async function cleanupAll() {
    await supabase.from('notifications').delete().like('link', '/dashboard/guru/uts-uas/e2e5a000-%')
    await supabase.from('official_exam_answers').delete().eq('submission_id', SUB_B)
    await supabase.from('official_exam_submissions').delete().in('exam_id', EX_IDS)
    await supabase.from('official_exam_questions').delete().in('exam_id', EX_IDS)
    await supabase.from('official_exams').delete().in('id', EX_IDS)
    const { data: olds } = await supabase.from('users').select('id').like('username', 'e2su_%')
    for (const x of (olds || [])) {
        const { data: t } = await supabase.from('teachers').select('id').eq('user_id', x.id).maybeSingle()
        if (t) {
            await supabase.from('teaching_assignments').delete().eq('teacher_id', t.id)
            await supabase.from('teachers').delete().eq('id', t.id)
        }
        const { data: s } = await supabase.from('students').select('id').eq('user_id', x.id).maybeSingle()
        if (s) {
            await supabase.from('student_enrollments').delete().eq('student_id', s.id)
            await supabase.from('students').delete().eq('id', s.id)
        }
        await supabase.from('sessions').delete().eq('user_id', x.id)
        await supabase.from('notifications').delete().eq('user_id', x.id)
        await supabase.from('users').delete().eq('id', x.id)
    }
}

async function seed() {
    console.log('═══ SEED ══')
    await cleanupAll()
    const passHash = await bcrypt.hash(PASS, 10)
    const { data: guruU } = await supabase.from('users')
        .insert({ username: 'e2su_guru', full_name: 'E2SU Guru', password_hash: passHash, role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    const { data: adminU } = await supabase.from('users')
        .insert({ username: 'e2su_admin', full_name: 'E2SU Admin', password_hash: passHash, role: 'ADMIN', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    const { data: siswaU } = await supabase.from('users')
        .insert({ username: 'e2su_siswa', full_name: 'E2SU Siswa', password_hash: passHash, role: 'SISWA', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    const { data: teacher } = await supabase.from('teachers')
        .insert({ user_id: guruU.id, school_id: SCHOOL }).select('id').single()
    const { data: student } = await supabase.from('students')
        .insert({ user_id: siswaU.id, school_id: SCHOOL, class_id: CLASS, nis: 'e2su0001' }).select('id').single()
    await supabase.from('student_enrollments')
        .insert({ student_id: student.id, academic_year_id: YEAR, class_id: CLASS, status: 'ACTIVE' })
    await supabase.from('teaching_assignments')
        .insert({ teacher_id: teacher.id, subject_id: SUBJECT, class_id: CLASS, academic_year_id: YEAR })

    const now = Date.now()
    const iso = (ms) => new Date(now + ms).toISOString()
    const H = 3600e3
    const baseExam = {
        school_id: SCHOOL, academic_year_id: YEAR, subject_id: SUBJECT,
        exam_type: 'UTS', duration_minutes: 60, target_class_ids: [CLASS],
    }
    await supabase.from('official_exams').insert([
        { ...baseExam, id: EX_A, title: 'e2su_A Selesai (aktif, jendela lewat)', start_time: iso(-3 * H), window_end_time: iso(-1 * H), is_active: true },
        { ...baseExam, id: EX_B, title: 'e2su_B Korban sweeper (nonaktif, lewat, ada submission)', start_time: iso(-3 * H), window_end_time: iso(-1 * H), is_active: false },
        { ...baseExam, id: EX_C, title: 'e2su_C Draft asli (nonaktif, lewat, tanpa submission)', start_time: iso(-3 * H), window_end_time: iso(-1 * H), is_active: false },
        { ...baseExam, id: EX_D, title: 'e2su_D Berlangsung (aktif, jendela jalan)', start_time: iso(-5 * 60e3), window_end_time: iso(55 * 60e3), is_active: true },
    ])
    const q = (id, examId) => ({
        id, exam_id: examId, question_text: 'e2su: Berapakah 1 + 1?', question_type: 'MULTIPLE_CHOICE',
        options: JSON.stringify(['1', '2', '3', '4']), correct_answer: 'B', points: 100, order_index: 0,
        status: 'approved',
    })
    await supabase.from('official_exam_questions').insert([q(Q_A, EX_A), q(Q_B, EX_B), q(Q_D, EX_D)])
    await supabase.from('official_exam_submissions').insert({
        id: SUB_B, exam_id: EX_B, student_id: student.id,
        started_at: iso(-2 * H), submitted_at: iso(-1.5 * H), is_submitted: true,
        question_order: JSON.stringify([Q_B]), total_score: 100, max_score: 100, is_graded: true,
    })

    const states = await getStates()
    console.log('state awal:', Object.fromEntries(EX_IDS.map(id => [id.slice(-4), states.get(id)])))
    check('seed: A aktif', states.get(EX_A) === true)
    check('seed: B nonaktif (korban)', states.get(EX_B) === false)
    check('seed: C nonaktif (draft asli)', states.get(EX_C) === false)
    check('seed: D aktif (live)', states.get(EX_D) === true)
    console.log(`seed selesai — ${pass} ok, ${fail} fail`)
}

async function run() {
    console.log('═══ RUN ══')
    const admin = await login('e2su_admin')
    const guru = await login('e2su_guru')
    const siswa = await login('e2su_siswa')
    const { data: guruUser } = await supabase.from('users').select('id').eq('username', 'e2su_guru').single()

    // ═══ [1] Efek migrasi ═══
    console.log('\n═══ [1] Migrasi reactivate_ended_official_exams ══')
    const states = await getStates()
    check('B (korban sweeper) direaktivasi → is_active=true', states.get(EX_B) === true, [...states])
    check('C (draft asli) tidak tersentuh → is_active=false', states.get(EX_C) === false)
    check('A tidak tersentuh (tetap true)', states.get(EX_A) === true)
    check('D tidak tersentuh (tetap true)', states.get(EX_D) === true)

    // ═══ [2] List admin ═══
    console.log('\n═══ [2] GET /api/official-exams (admin) ══')
    const { status: lsSt, data: list } = await api('GET', '/api/official-exams', null, admin)
    check('HTTP 200', lsSt === 200, lsSt)
    const byId = new Map((Array.isArray(list) ? list : []).map(e => [e.id, e]))
    check('A: is_active=true → badge "Selesai"', byId.get(EX_A)?.is_active === true)
    check('B: is_active=true → badge "Selesai"', byId.get(EX_B)?.is_active === true)
    check('C: is_active=false → badge "Draft"', byId.get(EX_C)?.is_active === false)
    check('D: is_active=true', byId.get(EX_D)?.is_active === true)
    check('A membawa window_end_time (input status)', !!byId.get(EX_A)?.window_end_time)

    // ═══ [3]+[4] Sweeper: notifikasi terkirim, TIDAK menonaktifkan ═══
    console.log('\n═══ [3/4] Sweeper checkEndedOfficialExams (trigger: GET di atas) ══')
    const notifLink = (id) => `/dashboard/guru/uts-uas/${id}#hasil`
    const pollNotif = async (id) => {
        for (let i = 0; i < 15; i++) {
            const { data } = await supabase.from('notifications').select('id, type, title')
                .eq('link', notifLink(id)).eq('user_id', guruUser.id).limit(3)
            if (data && data.length > 0) return data
            await new Promise(r => setTimeout(r, 1000))
        }
        return []
    }
    const notifA = await pollNotif(EX_A)
    check('Notifikasi UJIAN_SELESAI utk A terkirim ke guru', notifA.length >= 1, notifA)
    check('Notifikasi A bertipe UJIAN_SELESAI', notifA[0]?.type === 'UJIAN_SELESAI')
    const notifB = await pollNotif(EX_B)
    check('Notifikasi UJIAN_SELESAI utk B terkirim ke guru', notifB.length >= 1, notifB)

    // Dulu deactivate terjadi SETELAH insert notifikasi — beri jeda ekstra
    // supaya kalau kode lama masih ada, ia sempat menyalakan alarm.
    await new Promise(r => setTimeout(r, 3000))
    const states2 = await getStates()
    check('REGRESI INTI — A TIDAK dinonaktifkan sweeper (tetap true)', states2.get(EX_A) === true, [...states2])
    check('REGRESI INTI — B TIDAK dinonaktifkan sweeper (tetap true)', states2.get(EX_B) === true)
    check('D (live) tidak tersentuh', states2.get(EX_D) === true)

    // ═══ [5] Dedup notifikasi ═══
    console.log('\n═══ [5] Dedup notifikasi (GET kedua) ══')
    await api('GET', '/api/official-exams', null, admin)
    await new Promise(r => setTimeout(r, 4000))
    const { data: notifACount } = await supabase.from('notifications').select('id')
        .eq('link', notifLink(EX_A)).eq('user_id', guruUser.id)
    check('Notifikasi A tidak dobel', (notifACount || []).length === 1, notifACount?.length)

    // ═══ [6] Visibilitas siswa & guru ═══
    console.log('\n═══ [6] List siswa & guru ══')
    const { status: sSt, data: sList } = await api('GET', '/api/official-exams', null, siswa)
    const sIds = new Set((Array.isArray(sList) ? sList : []).map(e => e.id))
    check('Siswa melihat ujian selesai A (tetap tampil, badge "Waktu Habis")', sIds.has(EX_A))
    check('Siswa melihat ujian selesai B', sIds.has(EX_B))
    check('Siswa melihat ujian live D', sIds.has(EX_D))
    check('Siswa TIDAK melihat draft C', !sIds.has(EX_C))
    const { data: gList } = await api('GET', '/api/official-exams', null, guru)
    const gIds = new Set((Array.isArray(gList) ? gList : []).map(e => e.id))
    check('Guru melihat draft C (bisa dilengkapi/diedit)', gIds.has(EX_C))
    check('Guru melihat A & B (selesai, "Lihat Hasil")', gIds.has(EX_A) && gIds.has(EX_B))

    // ═══ [7] Gate start ujian selesai ═══
    console.log('\n═══ [7] Gate start ujian selesai ══')
    const { status: stSt, data: stData } = await api('POST', '/api/official-exam-submissions', { exam_id: EX_A }, siswa)
    check('Start ujian selesai DITOLAK (400)', stSt === 400, { stSt, stData })
    check('Pesan: jendela waktu ditutup', stData?.error === 'Jendela waktu pengerjaan sudah ditutup', stData)

    // ═══ [8] Resume gate (B: siswa sudah submit) ═══
    const { status: bSt, data: bData } = await api('POST', '/api/official-exam-submissions', { exam_id: EX_B }, siswa)
    check('Start B (sudah submit) → "Anda sudah mengumpulkan ujian ini"', bSt === 400 && bData?.error === 'Anda sudah mengumpulkan ujian ini', { bSt, bData })

    // ═══ [9] Monitor ujian selesai (post-mortem) ═══
    console.log('\n═══ [9] Monitor ujian selesai ══')
    const { status: mSt, data: mData } = await api('GET', `/api/official-exam-submissions/monitor?exam_id=${EX_A}`, null, admin)
    check('Monitor A bisa dibuka admin (200)', mSt === 200, mSt)
    check('Monitor A: exam.is_active=true', mData?.exam?.is_active === true)

    // ═══ [10] Monitor ujian live ═══
    const { status: dSt } = await api('GET', `/api/official-exam-submissions/monitor?exam_id=${EX_D}`, null, admin)
    check('Monitor D (live) 200', dSt === 200)

    // ═══ [11] Detail ujian selesai (dipakai halaman detail admin) ═══
    const { status: detSt, data: detData } = await api('GET', `/api/official-exams/${EX_A}`, null, admin)
    check('GET detail A (admin) 200 & is_active=true', detSt === 200 && detData?.is_active === true, { detSt })

    console.log(`\n═══ HASIL: ${pass} ok, ${fail} fail ═══`)
    if (fail > 0) process.exit(1)
}

async function cleanup() {
    console.log('═══ CLEANUP ══')
    await cleanupAll()
    const { count: exCount } = await supabase.from('official_exams').select('id', { count: 'exact', head: true }).like('id', 'e2e5a000-%')
    const { data: users } = await supabase.from('users').select('id').like('username', 'e2su_%')
    const { data: notifs } = await supabase.from('notifications').select('id').like('link', '/dashboard/guru/uts-uas/e2e5a000-%')
    console.log('sisa exam:', exCount, '| sisa user:', users?.length || 0, '| sisa notif:', notifs?.length || 0)
    if ((exCount || 0) === 0 && (users?.length || 0) === 0 && (notifs?.length || 0) === 0) console.log('cleanup bersih ✓')
    else { console.log('CLEANUP TIDAK BERSIH'); process.exit(1) }
}

const phase = process.argv[2]
if (phase === 'seed') seed().catch(e => { console.error(e); process.exit(1) })
else if (phase === 'run') run().catch(e => { console.error(e); process.exit(1) })
else if (phase === 'cleanup') cleanup().catch(e => { console.error(e); process.exit(1) })
else {
    console.log('Pemakaian: node scripts/e2e-status-utsuas-staging.cjs <seed|run|cleanup>')
    process.exit(1)
}
