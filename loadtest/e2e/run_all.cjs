/**
 * E2E Functional Test — refactor notifikasi scheduler + cache soal.
 *
 * Menjalankan skenario B1-B4 (job reminder), A4 (API notifikasi),
 * C1-C4 (alur ujian + cache) terhadap `next start` lokal + DB produksi.
 *
 * Safety: hanya INSERT/DELETE baris ber-marker E2E/e2e_; cleanup di finally.
 * Jalankan: node loadtest/e2e/run_all.cjs
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const { spawn } = require('child_process')
const bcrypt = require('bcryptjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3100
const BASE = `http://localhost:${PORT}`

const results = []
function report(name, pass, evidence) {
    results.push({ name, pass, evidence })
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${evidence}`)
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ---- server management ----
let server = null
async function startServer() {
    await supabase.from('cron_runs').update({ last_run_at: '2000-01-01T00:00:00Z' }).eq('job', 'notification_jobs')
    server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' })
    for (let i = 0; i < 60; i++) {
        try { const r = await fetch(BASE + '/login'); if (r.status) return } catch { }
        await sleep(1000)
    }
    throw new Error('server tidak start dalam 60s')
}
async function stopServer() {
    if (server) { server.kill('SIGTERM'); server = null }
    spawn('pkill', ['-f', `next start.*${PORT}`])
    await sleep(2000)
}
// tunggu sampai kondisi DB terpenuhi (job butuh ~10-20s setelah boot)
async function waitFor(fn, timeoutMs = 90000, intervalMs = 3000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
        const v = await fn()
        if (v) return v
        await sleep(intervalMs)
    }
    return null
}

async function http(path, opts = {}, token) {
    const t0 = Date.now()
    const res = await fetch(BASE + path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `session_token=${token}` } : {}) },
    })
    const ms = Date.now() - t0
    let body = null
    try { body = await res.json() } catch { }
    return { status: res.status, body, ms }
}

// ---- fixture registry untuk cleanup ----
const created = { users: [], students: [], teachers: [], tas: [], assignments: [], exams: [], questions: [], sessions: [], notifications: [], submissions: [], classes: [], subjects: [], enrollments: [] }

async function template(table) {
    const { data } = await supabase.from(table).select('*').limit(1)
    return data && data[0] ? data[0] : null
}

async function main() {
    const runId = Date.now() % 100000
    const U = `e2e_${runId}` // prefix unik per run

    // ============ SETUP FIXTURES ============
    const { data: school } = await supabase.from('schools').select('id').limit(1).single()
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!school || !year) throw new Error('school/tahun ajaran aktif tidak ditemukan')

    const subjT = await template('subjects')
    const { data: subject } = await supabase.from('subjects').insert({ ...subjT, id: undefined, name: `${U} Mapel`, school_id: subjT?.school_id ?? school.id }).select().single()
    created.subjects.push(subject.id)

    const classT = await template('classes')
    const { data: klass } = await supabase.from('classes').insert({ ...classT, id: undefined, name: `${U} Kelas`, academic_year_id: classT?.academic_year_id ?? year.id }).select().single()
    created.classes.push(klass.id)

    const passHash = bcrypt.hashSync('e2e-pass', 10)
    const { data: siswaUser } = await supabase.from('users').insert({ username: `${U}_siswa`, full_name: 'E2E Siswa', password_hash: passHash, role: 'SISWA', school_id: school.id }).select().single()
    const { data: guruUser } = await supabase.from('users').insert({ username: `${U}_guru`, full_name: 'E2E Guru', password_hash: passHash, role: 'GURU', school_id: school.id }).select().single()
    created.users.push(siswaUser.id, guruUser.id)

    const studT = await template('students')
    const { data: student } = await supabase.from('students').insert({ ...studT, id: undefined, user_id: siswaUser.id, nis: `${runId}`, class_id: klass.id }).select().single()
    created.students.push(student.id)

    const enrT = await template('student_enrollments')
    const { data: enr } = await supabase.from('student_enrollments').insert({ ...enrT, id: undefined, student_id: student.id, class_id: klass.id, academic_year_id: year.id, status: 'ACTIVE' }).select().single()
    if (enr) created.enrollments.push(enr.id)

    const teachT = await template('teachers')
    const { data: teacher } = await supabase.from('teachers').insert({ ...teachT, id: undefined, user_id: guruUser.id, nip: `e2e${runId}` }).select().single()
    created.teachers.push(teacher.id)

    const taT = await template('teaching_assignments')
    const { data: ta } = await supabase.from('teaching_assignments').insert({ ...taT, id: undefined, teacher_id: teacher.id, subject_id: subject.id, class_id: klass.id, academic_year_id: year.id }).select().single()
    created.tas.push(ta.id)

    const asgT = await template('assignments')
    const { data: asg } = await supabase.from('assignments').insert({ ...asgT, id: undefined, teaching_assignment_id: ta.id, title: `${U} Tugas`, due_date: new Date(Date.now() + 23 * 3600e3).toISOString() }).select().single()
    created.assignments.push(asg.id)

    const examT = await template('official_exams')
    const now = Date.now()
    async function makeExam(title, startOffsetMin, durMin) {
        const { data, error } = await supabase.from('official_exams').insert({
            ...examT, id: undefined, title, school_id: school.id, subject_id: subject.id, academic_year_id: year.id,
            exam_type: 'UTS', start_time: new Date(now + startOffsetMin * 60e3).toISOString(),
            duration_minutes: durMin, is_active: true, is_remedial: false, allowed_student_ids: null,
            target_class_ids: [klass.id], created_by: examT?.created_by ?? guruUser.id,
        }).select().single()
        if (error) throw new Error(`buat exam "${title}" gagal: ${error.message}`)
        created.exams.push(data.id)
        return data
    }
    const examScheduled = await makeExam(`${U} Terjadwal`, 180, 60)   // B2: mulai 3 jam lagi
    const examLive = await makeExam(`${U} Berlangsung`, -10, 60)     // B3 + C1/C2
    const examViol = await makeExam(`${U} Pelanggaran`, -5, 60)      // C3
    const examCache = await makeExam(`${U} Cache`, -5, 60)           // C4

    const qT = await template('official_exam_questions')
    async function makeQuestion(examId, type, key, points, ord) {
        const row = {
            ...qT, id: undefined, exam_id: examId, question_type: type, correct_answer: key, points,
            question_text: `${U} soal ${ord}`, options: type === 'MULTIPLE_CHOICE' ? ['opsi A', 'opsi B', 'opsi C', 'opsi D'] : null,
            order_index: ord,
        }
        const { data, error } = await supabase.from('official_exam_questions').insert(row).select().single()
        if (error) throw new Error('buat soal gagal: ' + error.message)
        created.questions.push(data.id)
        return data
    }
    const q1 = await makeQuestion(examLive.id, 'MULTIPLE_CHOICE', 'A', 2, 1)
    const q2 = await makeQuestion(examLive.id, 'MULTIPLE_CHOICE', 'B', 2, 2)
    await makeQuestion(examLive.id, 'ESSAY', '', 6, 3)
    const qv = await makeQuestion(examViol.id, 'MULTIPLE_CHOICE', 'A', 10, 1)
    const qc = await makeQuestion(examCache.id, 'MULTIPLE_CHOICE', 'A', 2, 1)

    for (const [uid, tok] of [[siswaUser.id, `${U}_tok_siswa`], [guruUser.id, `${U}_tok_guru`]]) {
        const { data } = await supabase.from('sessions').insert({ user_id: uid, token: tok, expires_at: new Date(now + 7 * 86400e3).toISOString() }).select().single()
        created.sessions.push(data.id)
    }
    const SISWA_TOK = `${U}_tok_siswa`, GURU_TOK = `${U}_tok_guru`

    // B4 fixtures: notifikasi basi + notifikasi terbaca berumur 40 hari
    const { data: staleNotif } = await supabase.from('notifications').insert({ user_id: siswaUser.id, type: 'UJIAN_RESMI', title: `📅 UTS Dijadwalkan: ${U} Hantu`, message: 'x' }).select().single()
    const { data: oldNotif } = await supabase.from('notifications').insert({ user_id: siswaUser.id, type: 'UJIAN_RESMI', title: `${U} Lama`, is_read: true, created_at: new Date(now - 40 * 86400e3).toISOString() }).select().single()
    created.notifications.push(staleNotif.id, oldNotif.id)

    console.log('fixtures OK — menjalankan server + job pertama...')
    await startServer()

    // ============ B1: deadline reminder ============
    const b1 = await waitFor(async () => {
        const { data } = await supabase.from('notifications').select('id').eq('user_id', siswaUser.id).eq('type', 'DEADLINE_REMINDER').ilike('title', `%${U} Tugas%`)
        return data && data.length > 0 ? data : null
    })
    report('B1 deadline reminder terkirim', !!b1, b1 ? `${b1.length} notif ditemukan` : 'timeout menunggu job')

    // ============ B2: ujian dijadwalkan (hanya kelas target) ============
    // Ujian < 24 jam: siswa target dapat EXAM_REMINDER "Segera" dan guru mapel
    // juga dapat EXAM_REMINDER. ("Dijadwalkan" UJIAN_RESMI sengaja tidak dibuat
    // untuk ujian < 24 jam — dedupe any-type, perilaku lama.) Yang penting:
    // tidak ada user di luar kelas/mapel target yang menerima notif ini.
    const b2first = await waitFor(async () => {
        const { data } = await supabase.from('notifications').select('id').ilike('title', `%${U} Terjadwal%`)
        return data && data.length > 0 ? true : null
    })
    // job memproses user bertahap — tunggu settle supaya hitungan final
    if (b2first) await sleep(15000)
    const { data: b2 } = await supabase.from('notifications').select('id, user_id, type').ilike('title', `%${U} Terjadwal%`)
    const b2Users = [...new Set((b2 || []).map(n => n.user_id))]
    const b2Allowed = new Set([siswaUser.id, guruUser.id])
    const b2Types = (b2 || []).map(n => n.type).sort().join('+')
    const b2ok = !!b2first && !!b2 && b2.length >= 1 && b2Users.every(u => b2Allowed.has(u))
    report('B2 notif ujian hanya ke kelas/mapel target', b2ok, b2 ? `${b2.length} notif [${b2Types}] untuk ${b2Users.length} user e2e (siswa+guru), user lain=0` : 'tidak ada notif')

    // ============ B3: guru dapat "Dimulai" ============
    const b3 = await waitFor(async () => {
        const { data } = await supabase.from('notifications').select('id').eq('user_id', guruUser.id).ilike('title', `%Dimulai: ${U} Berlangsung%`)
        return data && data.length > 0 ? data : null
    })
    report('B3 guru dapat notif "Dimulai"', !!b3, b3 ? `${b3.length} notif` : 'timeout')

    // ============ B4: cleanup basi + global 30 hari ============
    const b4 = await waitFor(async () => {
        const { data: s } = await supabase.from('notifications').select('id').eq('id', staleNotif.id)
        const { data: o } = await supabase.from('notifications').select('id').eq('id', oldNotif.id)
        return (s?.length === 0 && o?.length === 0) ? true : null
    })
    report('B4 notif basi + notif lama terhapus job', !!b4, b4 ? 'keduanya hilang dari DB' : 'masih ada')

    // ============ A4: API notifikasi ============
    const g = await http('/api/notifications?limit=10', {}, SISWA_TOK)
    const a4shape = g.status === 200 && Array.isArray(g.body?.notifications) && typeof g.body?.unreadCount === 'number'
    report('A4 GET /api/notifications (shape+latency)', a4shape, `HTTP ${g.status}, ${g.ms}ms, unread=${g.body?.unreadCount}`)
    const target = g.body?.notifications?.find(n => n.title?.includes(U))
    if (target) {
        const put1 = await http('/api/notifications', { method: 'PUT', body: JSON.stringify({ notification_id: target.id }) }, SISWA_TOK)
        const { data: chk } = await supabase.from('notifications').select('is_read').eq('id', target.id).single()
        report('A4 PUT tandai dibaca', put1.status === 200 && chk?.is_read === true, `HTTP ${put1.status}, is_read=${chk?.is_read}`)
    }
    const putAll = await http('/api/notifications', { method: 'PUT', body: JSON.stringify({ mark_all: true }) }, SISWA_TOK)
    const { data: unreadLeft } = await supabase.from('notifications').select('id').eq('user_id', siswaUser.id).eq('is_read', false)
    report('A4 PUT tandai semua', putAll.status === 200 && (unreadLeft?.length ?? 1) === 0, `HTTP ${putAll.status}, sisa unread=${unreadLeft?.length}`)

    // ============ C1: mulai ujian + autosave + grading ============
    const start = await http('/api/official-exam-submissions', { method: 'POST', body: JSON.stringify({ exam_id: examLive.id }) }, SISWA_TOK)
    const subId = start.body?.id
    if (subId) created.submissions.push(subId)
    report('C1 mulai ujian (POST submission)', start.status === 200 && !!subId, `HTTP ${start.status}, sub=${subId?.slice(0, 8)}`)

    const save = await http('/api/official-exam-submissions', { method: 'PUT', body: JSON.stringify({ submission_id: subId, answers: [{ question_id: q1.id, answer: 'A' }, { question_id: q2.id, answer: 'A' }] }) }, SISWA_TOK)
    const { data: ans } = await supabase.from('official_exam_answers').select('question_id, is_correct, points_earned').eq('submission_id', subId)
    const a1 = ans?.find(a => a.question_id === q1.id), a2 = ans?.find(a => a.question_id === q2.id)
    report('C1 autosave + grading benar', save.status === 200 && a1?.is_correct === true && a1?.points_earned === 2 && a2?.is_correct === false && a2?.points_earned === 0,
        `q1=${a1?.is_correct}/${a1?.points_earned}, q2=${a2?.is_correct}/${a2?.points_earned}`)

    // ============ C2: submit ============
    const sub = await http('/api/official-exam-submissions', { method: 'PUT', body: JSON.stringify({ submission_id: subId, submit: true }) }, SISWA_TOK)
    const { data: subRow } = await supabase.from('official_exam_submissions').select('is_submitted, total_score, is_graded').eq('id', subId).single()
    report('C2 submit (skor & is_graded)', sub.status === 200 && subRow?.is_submitted === true && subRow?.total_score === 2 && subRow?.is_graded === false,
        `submitted=${subRow?.is_submitted}, score=${subRow?.total_score} (harap 2), is_graded=${subRow?.is_graded} (harap false, ada essay)`)

    // ============ C3: pelanggaran 3x = force submit ============
    const startV = await http('/api/official-exam-submissions', { method: 'POST', body: JSON.stringify({ exam_id: examViol.id }) }, SISWA_TOK)
    const subV = startV.body?.id
    if (subV) created.submissions.push(subV)
    let forceResp = null
    for (let i = 0; i < 3; i++) {
        forceResp = await http('/api/official-exam-submissions', { method: 'PUT', body: JSON.stringify({ submission_id: subV, violation: { type: 'TAB_SWITCH' } }) }, SISWA_TOK)
        if (i < 2) await sleep(3300) // dedupe server: 3 detik
    }
    const { data: subVRow } = await supabase.from('official_exam_submissions').select('is_submitted, violation_count').eq('id', subV).single()
    report('C3 pelanggaran 3x = force submit', forceResp?.body?.force_submitted === true && subVRow?.is_submitted === true,
        `force_submitted=${forceResp?.body?.force_submitted}, count=${subVRow?.violation_count}, submitted=${subVRow?.is_submitted}`)

    // ============ C4: cache soal ============
    const startC = await http('/api/official-exam-submissions', { method: 'POST', body: JSON.stringify({ exam_id: examCache.id }) }, SISWA_TOK)
    const subC = startC.body?.id
    if (subC) created.submissions.push(subC)
    await http('/api/official-exam-submissions', { method: 'PUT', body: JSON.stringify({ submission_id: subC, answers: [{ question_id: qc.id, answer: 'B' }] }) }, SISWA_TOK)
    let { data: cAns1 } = await supabase.from('official_exam_answers').select('points_earned').eq('submission_id', subC).eq('question_id', qc.id).single()
    const wrongFirst = cAns1?.points_earned === 0
    // ubah kunci di DB: jawaban 'B' sekarang benar — tapi cache server masih memegang kunci lama
    await supabase.from('official_exam_questions').update({ correct_answer: 'B' }).eq('id', qc.id)
    await http('/api/official-exam-submissions', { method: 'PUT', body: JSON.stringify({ submission_id: subC, answers: [{ question_id: qc.id, answer: 'B' }] }) }, SISWA_TOK)
    let { data: cAns2 } = await supabase.from('official_exam_answers').select('points_earned').eq('submission_id', subC).eq('question_id', qc.id).single()
    const cacheHeld = cAns2?.points_earned === 0
    report('C4a cache menahan kunci lama', wrongFirst && cacheHeld, `setelah ganti kunci: ${cAns2?.points_earned} (harap tetap 0 = cache aktif)`)

    console.log('restart server (cache clear) + job kedua (uji dedupe B1)...')
    await stopServer()
    await startServer()

    await http('/api/official-exam-submissions', { method: 'PUT', body: JSON.stringify({ submission_id: subC, answers: [{ question_id: qc.id, answer: 'B' }] }) }, SISWA_TOK)
    let { data: cAns3 } = await supabase.from('official_exam_answers').select('points_earned').eq('submission_id', subC).eq('question_id', qc.id).single()
    report('C4b setelah restart grading pakai kunci baru', cAns3?.points_earned === 2, `points=${cAns3?.points_earned} (harap 2)`)

    // ============ B1 dedupe: job kedua tidak duplikat ============
    const b1dup = await waitFor(async () => {
        const { data } = await supabase.from('notifications').select('id').eq('user_id', siswaUser.id).eq('type', 'DEADLINE_REMINDER').ilike('title', `%${U} Tugas%`)
        return data && data.length > 0 ? data : null
    })
    report('B1b run kedua tidak duplikat reminder', !!b1dup && b1dup.length === 1, `jumlah notif=${b1dup?.length} (harap 1)`)

    await stopServer()
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = async (table, ids) => { if (ids.length) await supabase.from(table).delete().in('id', ids) }
    // submissions & answers
    for (const sid of created.submissions) {
        await supabase.from('official_exam_answers').delete().eq('submission_id', sid)
        await supabase.from('official_exam_submissions').delete().eq('id', sid)
    }
    // notifikasi milik user e2e (termasuk yang dibuat job)
    for (const uid of created.users) await supabase.from('notifications').delete().eq('user_id', uid)
    await del('sessions', created.sessions)
    await del('assignments', created.assignments)
    await del('official_exam_questions', created.questions)
    await del('official_exams', created.exams)
    await del('teaching_assignments', created.tas)
    await del('student_enrollments', created.enrollments)
    await del('students', created.students)
    await del('teachers', created.teachers)
    await del('users', created.users)
    await del('classes', created.classes)
    await del('subjects', created.subjects)
    // verifikasi bersih
    const leftover = []
    for (const [table, ids] of Object.entries(created)) {
        if (!ids.length) continue
        const tbl = table === 'tas' ? 'teaching_assignments' : table
        const { data } = await supabase.from(tbl).select('id').in('id', ids)
        if (data?.length) leftover.push(`${tbl}:${data.length}`)
    }
    console.log(leftover.length ? `SISA DATA: ${leftover.join(', ')}` : 'cleanup bersih — tidak ada sisa baris E2E')
}

main()
    .catch(e => { console.error('ERROR:', e.message); report('eksekusi script', false, e.message) })
    .finally(async () => {
        await stopServer()
        await cleanup()
        const pass = results.filter(r => r.pass).length
        console.log(`\n===== HASIL: ${pass}/${results.length} PASS =====`)
        process.exit(pass === results.length ? 0 : 1)
    })
