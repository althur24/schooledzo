/**
 * E2E ANALITIK + PDF (sesi analitik/PDF) — verifikasi perubahan:
 *  [E1] GET /api/quizzes/[id] → embed BARU teaching_assignment.teacher.user.full_name
 *  [E2] GET /api/exams/[id] → embed BARU teaching_assignment.academic_year.{id,name}
 *  [E3] GET /api/analytics/quiz/[id] (guru) → 200 + shape (overview/ranking/butir)
 *  [E4] GET /api/analytics/exam/[id] (guru) → 200 + studentRanking[].violations
 *       (sumber kolom "Pelanggaran" di PDF ulangan/UTS-UAS)
 *  [E5] GET /api/analytics/official-exam/[id] (guru) → 200 + filter ?class_id=
 *  [E6] Role guard: SISWA akses analytics → 403
 *  [E7] Tenant guard (IDOR): quiz/exam/official-exam SEKOLAH LAIN → 404 semua
 *  [E8] GET /api/students?class_id&enrollment_year_id (guru) → roster tahun-ajaran
 *       benar (sumber panel "Belum Mengerjakan")
 *  [E9] SSR smoke: 3 halaman yang diedit (kuis/hasil, ulangan?tab=hasil,
 *       guru uts-uas wrapper) → 200 HTML, tidak crash saat render
 *  [E10] Halaman hasil guru yang dihapus → 404 (bukan 500)
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_analytics_pdf.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3100
const BASE = `http://localhost:${PORT}`

let server = null
const created = {
    schools: [], years: [], users: [], teachers: [], students: [], sessions: [],
    classes: [], subjects: [], tas: [], enrollments: [],
    quizzes: [], quizQuestions: [], quizSubmissions: [],
    exams: [], examQuestions: [], examSubmissions: [], examAnswers: [],
    officialExams: [], officialQuestions: [], officialSubmissions: [], officialAnswers: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function http(path, opts = {}, token) {
    const res = await fetch(BASE + path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `session_token=${token}` } : {}) },
    })
    let body = null
    try { body = await res.json() } catch { }
    return { status: res.status, body }
}

async function template(table) {
    const { data } = await supabase.from(table).select('*').limit(1)
    return data && data[0] ? data[0] : null
}

async function main() {
    const runId = Date.now() % 100000
    const U = `ap_${runId}`
    const passHash = bcrypt.hashSync('e2e-pass', 10)
    const now = Date.now()

    // ---------- FIXTURES: sekolah utama (STG01 staging) ----------
    const { data: school } = await supabase.from('schools').select('id').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id, name').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} Mapel`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)
    const klass = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class')
    created.classes.push(klass.id)

    const mkUser = async (label, role) => {
        const u = await mustInsert(supabase, 'users',
            { username: `${U}_${label}`, full_name: `${U} ${label}`, password_hash: passHash, role, school_id: school.id, must_change_password: false, is_locked: false }, `user ${label}`)
        created.users.push(u.id)
        return u
    }
    const guruUser = await mkUser('guru', 'GURU')
    const siswaUser = await mkUser('siswa', 'SISWA')
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guruUser.id, school_id: school.id, nip: `ap${runId}` }, 'teacher')
    created.teachers.push(teacher.id)
    const ta = await mustInsert(supabase, 'teaching_assignments',
        { teacher_id: teacher.id, class_id: klass.id, subject_id: subject.id, academic_year_id: year.id }, 'TA')
    created.tas.push(ta.id)

    const student = await mustInsert(supabase, 'students',
        { user_id: siswaUser.id, nis: `ap${runId}`, class_id: klass.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, 'student')
    created.students.push(student.id)
    const enr = await mustInsert(supabase, 'student_enrollments',
        { student_id: student.id, class_id: klass.id, academic_year_id: year.id, status: 'ACTIVE' }, 'enrollment')
    created.enrollments.push(enr.id)

    // sesi login
    const mkTok = async (userId, label) => {
        const tok = `${U}_tok_${label}`
        const s = await mustInsert(supabase, 'sessions', { user_id: userId, token: tok, expires_at: new Date(now + 3600e3).toISOString() }, `session ${label}`)
        created.sessions.push(s.id)
        return tok
    }
    const GURU_TOK = await mkTok(guruUser.id, 'guru')
    const SISWA_TOK = await mkTok(siswaUser.id, 'siswa')

    // ---------- FIXTURE: rantai KUIS (2 soal PG + 1 submission terkumpul) ----------
    const quiz = await mustInsert(supabase, 'quizzes',
        { teaching_assignment_id: ta.id, title: `${U} Kuis`, duration_minutes: 30, is_active: true }, 'quiz')
    created.quizzes.push(quiz.id)
    const { data: quizQs, error: qErr } = await supabase.from('quiz_questions').insert([
        { quiz_id: quiz.id, question_text: `${U} soal 1`, question_type: 'MULTIPLE_CHOICE', options: ['a', 'b', 'c', 'd'], correct_answer: 'A', points: 10, order_index: 0 },
        { quiz_id: quiz.id, question_text: `${U} soal 2`, question_type: 'MULTIPLE_CHOICE', options: ['a', 'b', 'c', 'd'], correct_answer: 'B', points: 10, order_index: 1 },
    ]).select()
    if (qErr) throw new Error('fixture quiz_questions: ' + qErr.message)
    created.quizQuestions.push(...quizQs.map(q => q.id))
    const quizSub = await mustInsert(supabase, 'quiz_submissions', {
        quiz_id: quiz.id, student_id: student.id,
        started_at: new Date(now - 20 * 60e3).toISOString(), submitted_at: new Date(now - 10 * 60e3).toISOString(),
        answers: [
            { question_id: quizQs[0].id, answer: 'A', is_correct: true, score: 10 },
            { question_id: quizQs[1].id, answer: 'A', is_correct: false, score: 0 },
        ],
        total_score: 10, max_score: 20, is_graded: true,
    }, 'quiz_submission')
    created.quizSubmissions.push(quizSub.id)

    // ---------- FIXTURE: rantai ULANGAN/exams (2 soal + submission + answers) ----------
    const exam = await mustInsert(supabase, 'exams', {
        title: `${U} Ulangan`, start_time: new Date(now - 3600e3).toISOString(),
        window_end_time: new Date(now - 1800e3).toISOString(), duration_minutes: 30,
        teaching_assignment_id: ta.id, is_active: false, max_violations: 3,
    }, 'exam')
    created.exams.push(exam.id)
    const { data: examQs, error: eErr } = await supabase.from('exam_questions').insert([
        { exam_id: exam.id, question_text: `${U} esoal 1`, question_type: 'MULTIPLE_CHOICE', options: ['a', 'b', 'c', 'd'], correct_answer: 'A', points: 10, order_index: 0 },
        { exam_id: exam.id, question_text: `${U} esoal 2`, question_type: 'ESSAY', options: null, correct_answer: '', points: 10, order_index: 1 },
    ]).select()
    if (eErr) throw new Error('fixture exam_questions: ' + eErr.message)
    created.examQuestions.push(...examQs.map(q => q.id))
    const examSub = await mustInsert(supabase, 'exam_submissions', {
        exam_id: exam.id, student_id: student.id,
        started_at: new Date(now - 3500e3).toISOString(), submitted_at: new Date(now - 3400e3).toISOString(),
        is_submitted: true, is_graded: true, total_score: 15, max_score: 20,
        violation_count: 1, question_order: examQs.map(q => q.id),
    }, 'exam_submission')
    created.examSubmissions.push(examSub.id)
    for (const [q, ans, ok, pts] of [[examQs[0], 'A', true, 10], [examQs[1], 'jawaban esai', true, 5]]) {
        const a = await mustInsert(supabase, 'exam_answers',
            { submission_id: examSub.id, question_id: q.id, answer: ans, is_correct: ok, points_earned: pts }, 'exam_answer')
        created.examAnswers.push(a.id)
    }

    // ---------- FIXTURE: rantai UTS/UAS official (2 soal + submission + answers) ----------
    const oe = await mustInsert(supabase, 'official_exams', {
        title: `${U} UTS`, exam_type: 'UTS', school_id: school.id, subject_id: subject.id,
        academic_year_id: year.id, target_class_ids: [klass.id],
        start_time: new Date(now - 3600e3).toISOString(), window_end_time: new Date(now - 1800e3).toISOString(),
        duration_minutes: 60, is_active: false, is_remedial: false, allowed_student_ids: null, created_by: guruUser.id,
    }, 'official_exam')
    created.officialExams.push(oe.id)
    const { data: oeQs, error: oErr } = await supabase.from('official_exam_questions').insert([
        { exam_id: oe.id, question_text: `${U} osoal 1`, question_type: 'MULTIPLE_CHOICE', options: ['a', 'b', 'c', 'd'], correct_answer: 'A', points: 10, order_index: 0 },
        { exam_id: oe.id, question_text: `${U} osoal 2`, question_type: 'MULTIPLE_CHOICE', options: ['a', 'b', 'c', 'd'], correct_answer: 'B', points: 10, order_index: 1 },
    ]).select()
    if (oErr) throw new Error('fixture official_exam_questions: ' + oErr.message)
    created.officialQuestions.push(...oeQs.map(q => q.id))
    const oeSub = await mustInsert(supabase, 'official_exam_submissions', {
        exam_id: oe.id, student_id: student.id,
        started_at: new Date(now - 3500e3).toISOString(), submitted_at: new Date(now - 3400e3).toISOString(),
        is_submitted: true, is_graded: true, total_score: 10, max_score: 20,
        violation_count: 0, question_order: oeQs.map(q => q.id),
    }, 'official_submission')
    created.officialSubmissions.push(oeSub.id)
    for (const [q, ans, ok, pts] of [[oeQs[0], 'A', true, 10], [oeQs[1], 'A', false, 0]]) {
        const a = await mustInsert(supabase, 'official_exam_answers',
            { submission_id: oeSub.id, question_id: q.id, answer: ans, is_correct: ok, points_earned: pts }, 'official_answer')
        created.officialAnswers.push(a.id)
    }

    // ---------- FIXTURE: SEKOLAH LAIN (tenant guard / IDOR) ----------
    const schoolT = await template('schools')
    const schoolB = await mustInsert(supabase, 'schools',
        { ...schoolT, id: undefined, name: `${U} Sekolah Lain`, code: `E2E${runId}`, is_active: true }, 'school B')
    created.schools.push(schoolB.id)
    const yearB = await mustInsert(supabase, 'academic_years',
        { school_id: schoolB.id, name: `${U} TA`, is_active: true }, 'year B')
    created.years.push(yearB.id)
    const subjectB = await mustInsert(supabase, 'subjects', { name: `${U} Mapel B`, school_id: schoolB.id, kkm: 75 }, 'subject B')
    created.subjects.push(subjectB.id)
    const klassB = await mustInsert(supabase, 'classes', { name: `${U} 9B`, academic_year_id: yearB.id, grade_level: 3, school_level: 'SMP' }, 'class B')
    created.classes.push(klassB.id)
    const guruBUser = await mustInsert(supabase, 'users',
        { username: `${U}_gurub`, full_name: `${U} Guru B`, password_hash: passHash, role: 'GURU', school_id: schoolB.id, must_change_password: false, is_locked: false }, 'user guru B')
    created.users.push(guruBUser.id)
    const teacherB = await mustInsert(supabase, 'teachers', { user_id: guruBUser.id, school_id: schoolB.id }, 'teacher B')
    created.teachers.push(teacherB.id)
    const taB = await mustInsert(supabase, 'teaching_assignments',
        { teacher_id: teacherB.id, class_id: klassB.id, subject_id: subjectB.id, academic_year_id: yearB.id }, 'TA B')
    created.tas.push(taB.id)
    const quizB = await mustInsert(supabase, 'quizzes',
        { teaching_assignment_id: taB.id, title: `${U} Kuis B`, duration_minutes: 30, is_active: true }, 'quiz B')
    created.quizzes.push(quizB.id)
    const examB = await mustInsert(supabase, 'exams', {
        title: `${U} Ulangan B`, start_time: new Date(now - 3600e3).toISOString(),
        duration_minutes: 30, teaching_assignment_id: taB.id, is_active: false, max_violations: 3,
    }, 'exam B')
    created.exams.push(examB.id)
    const oeB = await mustInsert(supabase, 'official_exams', {
        title: `${U} UTS B`, exam_type: 'UTS', school_id: schoolB.id, subject_id: subjectB.id,
        academic_year_id: yearB.id, target_class_ids: [klassB.id],
        start_time: new Date(now - 3600e3).toISOString(), duration_minutes: 60,
        is_active: false, is_remedial: false, allowed_student_ids: null, created_by: guruBUser.id,
    }, 'official exam B')
    created.officialExams.push(oeB.id)

    console.log('fixtures OK — start server...')
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, !!(process.env.ENV_FILE || '').includes('staging'))

    // ============ E1: embed teacher di GET /api/quizzes/[id] ============
    const q1 = await http(`/api/quizzes/${quiz.id}`, {}, GURU_TOK)
    const q1ta = q1.body?.teaching_assignment
    check('E1 GET quiz: embed teacher.user.full_name (BARU)',
        q1.status === 200 && q1ta?.teacher?.user?.full_name === `${U} guru`,
        `HTTP ${q1.status}, teacher=${q1ta?.teacher?.user?.full_name || 'TIDAK ADA'}`)

    // ============ E2: embed academic_year di GET /api/exams/[id] ============
    const e1 = await http(`/api/exams/${exam.id}`, {}, GURU_TOK)
    const e1ta = e1.body?.teaching_assignment
    check('E2 GET exam: embed academic_year.{id,name} (BARU)',
        e1.status === 200 && e1ta?.academic_year?.id === year.id && typeof e1ta?.academic_year?.name === 'string' && e1ta?.academic_year?.name.length > 0,
        `HTTP ${e1.status}, tahun=${e1ta?.academic_year?.name || 'TIDAK ADA'}`)

    // ============ E3: analytics quiz ============
    const aq = await http(`/api/analytics/quiz/${quiz.id}`, {}, GURU_TOK)
    const aqOk = aq.status === 200
        && aq.body?.classOverview?.submitted === 1
        && aq.body?.classOverview?.avgScore === 50
        && aq.body?.totalQuestions === 2
        && Array.isArray(aq.body?.questionAnalysis) && aq.body.questionAnalysis.length === 2
        && Array.isArray(aq.body?.questionAnalysis[0]?.optionDistribution)
        && Array.isArray(aq.body?.studentRanking) && aq.body.studentRanking[0]?.name === `${U} siswa`
    check('E3 analytics quiz (shape: overview/butir/ranking)', aqOk,
        `HTTP ${aq.status}, submitted=${aq.body?.classOverview?.submitted}, avg=${aq.body?.classOverview?.avgScore}, butir=${aq.body?.questionAnalysis?.length}`)

    // ============ E4: analytics exam (violations utk kolom PDF) ============
    const ae = await http(`/api/analytics/exam/${exam.id}`, {}, GURU_TOK)
    const aeRank = ae.body?.studentRanking?.[0]
    const aeOk = ae.status === 200
        && ae.body?.classOverview?.submitted === 1
        && aeRank?.violations === 1
        && ae.body?.questionAnalysis?.length === 2
        && typeof aeRank?.duration === 'number'
    check('E4 analytics exam (ranking.violations + duration utk PDF)', aeOk,
        `HTTP ${ae.status}, violations=${aeRank?.violations}, duration=${aeRank?.duration}, butir=${ae.body?.questionAnalysis?.length}`)

    // ============ E5: analytics official-exam (+ filter kelas) ============
    const ao = await http(`/api/analytics/official-exam/${oe.id}`, {}, GURU_TOK)
    const aoOk = ao.status === 200 && ao.body?.classOverview?.submitted === 1 && ao.body?.questionAnalysis?.length === 2
    const aoF = await http(`/api/analytics/official-exam/${oe.id}?class_id=${klass.id}`, {}, GURU_TOK)
    const aoFOk = aoF.status === 200 && aoF.body?.classOverview?.submitted === 1
    check('E5 analytics official-exam (+ filter class_id)', aoOk && aoFOk,
        `HTTP ${ao.status}/${aoF.status}, submitted=${ao.body?.classOverview?.submitted}/${aoF.body?.classOverview?.submitted}`)

    // ============ E6: role guard — SISWA ditolak ============
    const s6 = await http(`/api/analytics/quiz/${quiz.id}`, {}, SISWA_TOK)
    const s6b = await http(`/api/analytics/exam/${exam.id}`, {}, SISWA_TOK)
    const s6c = await http(`/api/analytics/official-exam/${oe.id}`, {}, SISWA_TOK)
    check('E6 SISWA akses analytics → 403', s6.status === 403 && s6b.status === 403 && s6c.status === 403,
        `HTTP ${s6.status}/${s6b.status}/${s6c.status}`)

    // ============ E7: tenant guard — aset sekolah lain → 404 ============
    const t1 = await http(`/api/quizzes/${quizB.id}`, {}, GURU_TOK)
    const t2 = await http(`/api/exams/${examB.id}`, {}, GURU_TOK)
    const t3 = await http(`/api/analytics/quiz/${quizB.id}`, {}, GURU_TOK)
    const t4 = await http(`/api/analytics/exam/${examB.id}`, {}, GURU_TOK)
    const t5 = await http(`/api/analytics/official-exam/${oeB.id}`, {}, GURU_TOK)
    check('E7 IDOR lintas sekolah → 404 semua (quiz/exam/analytics×3)',
        [t1, t2, t3, t4, t5].every(r => r.status === 404),
        `HTTP ${t1.status}/${t2.status}/${t3.status}/${t4.status}/${t5.status}`)

    // ============ E8: roster year-aware (panel Belum Mengerjakan) ============
    const r8 = await http(`/api/students?class_id=${klass.id}&enrollment_year_id=${year.id}`, {}, GURU_TOK)
    const r8names = Array.isArray(r8.body) ? r8.body.map(s => s.user?.full_name) : null
    check('E8 roster kelas per tahun ajaran', r8.status === 200 && Array.isArray(r8.body) && r8names.includes(`${U} siswa`),
        `HTTP ${r8.status}, roster=${r8.body?.length} siswa, target=${r8names?.includes(`${U} siswa`)}`)

    // ============ E9: SSR smoke — halaman yang diedit tidak crash ============
    const pages = [
        [`/dashboard/guru/kuis/${quiz.id}/hasil`, 'kuis/hasil'],
        [`/dashboard/guru/ulangan/${exam.id}?tab=hasil`, 'ulangan tab hasil'],
        [`/dashboard/guru/uts-uas/${oe.id}`, 'guru uts-uas (wrapper shared)'],
    ]
    for (const [path, label] of pages) {
        const res = await fetch(BASE + path, { headers: { Cookie: `session_token=${GURU_TOK}` }, redirect: 'manual' })
        const html = await res.text().catch(() => '')
        check(`E9 SSR ${label}`, res.status === 200 && html.length > 500, `HTTP ${res.status}, html=${html.length}b`)
    }

    // ============ E10: halaman terhapus → 404 (bukan 500) ============
    const p10 = await fetch(`${BASE}/dashboard/guru/uts-uas/${oe.id}/hasil`, { headers: { Cookie: `session_token=${GURU_TOK}` }, redirect: 'manual' })
    check('E10 halaman hasil guru lama terhapus → 404', p10.status === 404, `HTTP ${p10.status}`)
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : Promise.resolve()
    await del('official_exam_answers', created.officialAnswers)
    await del('official_exam_submissions', created.officialSubmissions)
    await del('official_exam_questions', created.officialQuestions)
    await del('official_exams', created.officialExams)
    await del('exam_answers', created.examAnswers)
    await del('exam_submissions', created.examSubmissions)
    await del('exam_questions', created.examQuestions)
    await del('exams', created.exams)
    await del('quiz_submissions', created.quizSubmissions)
    await del('quiz_questions', created.quizQuestions)
    await del('quizzes', created.quizzes)
    await del('sessions', created.sessions)
    await del('student_enrollments', created.enrollments)
    await del('students', created.students)
    await del('teaching_assignments', created.tas)
    await del('teachers', created.teachers)
    await del('users', created.users)
    await del('classes', created.classes)
    await del('subjects', created.subjects)
    await del('academic_years', created.years)
    await del('schools', created.schools)
    const leftover = []
    for (const [table, ids] of Object.entries(created)) {
        if (!ids.length) continue
        const { data } = await supabase.from(table).select('id').in('id', ids)
        if (data?.length) leftover.push(`${table}:${data.length}`)
    }
    console.log(leftover.length ? `SISA DATA: ${leftover.join(', ')}` : 'cleanup bersih — tidak ada sisa baris E2E')
}

main()
    .catch(e => { console.error('ERROR:', e.message); check('eksekusi script', false, e.message) })
    .finally(async () => {
        await stopServerSafe(server, BASE)
        await cleanup()
        const pass = results.filter(r => r.ok).length
        console.log(`\n===== HASIL: ${pass}/${results.length} PASS =====`)
        process.exit(pass === results.length ? 0 : 1)
    })
