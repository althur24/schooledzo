/**
 * E2E SECURITY SCOPE — verifikasi lengkap fix bocor-soal antar guru/kelas
 * (komplain: soal guru A muncul di akun guru B, mapel sama kelas beda).
 *
 * Fixture mereplikasi pola produksi:
 *   T1 "Oyok-like"    : PAIBP di kelas XI
 *   T2 "Ariandi-like" : PAIBP di kelas X + BTQ di kelas XI  (cross-product!)
 *   → T2 TIDAK mengajar PAIBP@XI — segala data T1 di XI tidak boleh terlihat.
 *
 * FIX yang diuji (label di nama test):
 *   A  GET /api/official-exams                — exact pair (root cause)
 *   B  GET /api/official-exams/[id]/questions — guard guru
 *   C  GET /api/dashboard/guru/grading-overview — exact pair
 *   D  GET /api/official-exams/[id]           — guard guru
 *   E  GET /api/official-exam-submissions/[id] — guard guru per-submission
 *   F  GET /api/quizzes/[id]/questions        — guard siswa+guru
 *   G  GET /api/quizzes/[id] (embed soal)     — guard siswa+guru (bypass patch)
 *   H  GET /api/quizzes                       — siswa: is_active + TA-param tertutup
 *   I  GET /api/exams                         — siswa: is_active + TA-param tertutup
 *   J  GET /api/quiz-submissions              — guard guru path A (quiz_id) + B (no id)
 *   K  GET /api/exam-submissions              — guard guru path A + B
 *
 * plus REGRESI alur sah: pemilik/co-teacher/admin/siswa kelas target tetap
 * bisa mengakses semua yang seharusnya (list, soal, resume, nilai, monitor).
 *
 * WAJIB staging: ENV_FILE=.env.staging node loadtest/e2e/e2e_security_scope.cjs
 * (server harus di-build dengan env staging — NEXT_PUBLIC_* inlined saat build;
 *  assertServerDb memverifikasi server benar-benar menunjuk DB staging.)
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PORT = 3121
const BASE = `http://localhost:${PORT}`
const PASS = new Date(Date.now() - 60_000).toISOString() // start lampau: ujian dianggap sudah mulai
const FUTURE = new Date(Date.now() + 3600_000).toISOString()

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], exams: [], quizzes: [], officialExams: [],
    questions: [], examSubs: [], quizSubs: [], officialSubs: [], enrollments: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}
const first = (v) => (Array.isArray(v) ? v[0] : v)
async function jsonOf(res) {
    try { return await res.json() } catch { return null }
}

async function main() {
    const runId = Date.now() % 100000
    const U = `sec${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif STG01 tidak ditemukan — abort.')

    const subjP = await mustInsert(supabase, 'subjects', { name: `${U} PAIBP`, school_id: school.id, kkm: 75 }, 'subject P')
    const subjB = await mustInsert(supabase, 'subjects', { name: `${U} BTQ`, school_id: school.id, kkm: 75 }, 'subject B')
    created.subjects.push(subjP.id, subjB.id)

    const classX = await mustInsert(supabase, 'classes', { name: `${U} X-A`, academic_year_id: year.id, grade_level: 1, school_level: 'SMA' }, 'class X')
    const classXI = await mustInsert(supabase, 'classes', { name: `${U} XI-B`, academic_year_id: year.id, grade_level: 2, school_level: 'SMA' }, 'class XI')
    created.classes.push(classX.id, classXI.id)

    const mkGuru = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_g${label}`, full_name: `${U} Guru ${label}`, password_hash: passHash, role: 'GURU', school_id: school.id }, `user guru ${label}`)
        created.users.push(u.id)
        const t = await mustInsert(supabase, 'teachers', { user_id: u.id, school_id: school.id }, `teacher ${label}`)
        created.teachers.push(t.id)
        const s = await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_g${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session guru ${label}`)
        created.sessions.push(s.token)
        return { user: u, teacher: t, token: s.token }
    }
    const admin = await (async () => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_adm`, full_name: `${U} Admin`, password_hash: passHash, role: 'ADMIN', school_id: school.id }, 'user admin')
        created.users.push(u.id)
        const s = await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_adm`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session admin')
        created.sessions.push(s.token)
        return { user: u, token: s.token }
    })()
    const mkSiswa = async (label, cls) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_s${label}`, full_name: `${U} Siswa ${label}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user siswa ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}${label}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMA' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        const s = await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_s${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session siswa ${label}`)
        created.sessions.push(s.token)
        return { user: u, student: st, token: s.token }
    }

    const t1 = await mkGuru('1') // "Oyok": PAIBP @ XI
    const t2 = await mkGuru('2') // "Ariandi": PAIBP @ X + BTQ @ XI
    const sxa = await mkSiswa('xa', classX)   // kelas X (PAIBP milik T2)
    const sxib = await mkSiswa('xib', classXI) // kelas XI (PAIBP milik T1) — punya submission (sudah submit)
    const sxib2 = await mkSiswa('xj2', classXI) // kelas XI TANPA submission — uji strip kunci

    const ta_t1_xi = await mustInsert(supabase, 'teaching_assignments', { teacher_id: t1.teacher.id, class_id: classXI.id, subject_id: subjP.id, academic_year_id: year.id }, 'TA T1 PAIBP@XI')
    const ta_t2_x = await mustInsert(supabase, 'teaching_assignments', { teacher_id: t2.teacher.id, class_id: classX.id, subject_id: subjP.id, academic_year_id: year.id }, 'TA T2 PAIBP@X')
    const ta_t2_xi_btq = await mustInsert(supabase, 'teaching_assignments', { teacher_id: t2.teacher.id, class_id: classXI.id, subject_id: subjB.id, academic_year_id: year.id }, 'TA T2 BTQ@XI')
    created.tas.push(ta_t1_xi.id, ta_t2_x.id, ta_t2_xi_btq.id)

    // Ujian resmi (UTS) T1: PAIBP target XI — inilah yang dulu bocor ke "Ariandi"
    const oe1 = await mustInsert(supabase, 'official_exams', {
        exam_type: 'UTS', title: `${U} UTS PAIBP XI (T1)`, subject_id: subjP.id, school_id: school.id,
        academic_year_id: year.id, target_class_ids: [classXI.id], is_active: true,
        start_time: PASS, duration_minutes: 60, created_by: t1.user.id,
    }, 'official exam T1')
    created.officialExams.push(oe1.id)
    const oq1 = await mustInsert(supabase, 'official_exam_questions', {
        exam_id: oe1.id, question_text: `${U} Soal UTS rahasia T1?`, question_type: 'MULTIPLE_CHOICE',
        options: ['a', 'b', 'c', 'd'], correct_answer: 'a', points: 10, order_index: 0, status: 'approved',
    }, 'official question')
    created.questions.push(oq1.id)
    const oeSub = await mustInsert(supabase, 'official_exam_submissions', {
        exam_id: oe1.id, student_id: sxib.student.id, is_submitted: true, is_graded: false,
        started_at: PASS, submitted_at: new Date().toISOString(), total_score: 0, max_score: 10,
    }, 'official submission')
    created.officialSubs.push(oeSub.id)

    // Kuis T1 aktif di XI + kuis T1 DRAFT di XI (uji bocor draft) + kuis T2 di X
    const mkQuiz = async (ta, title, isActive) => {
        const q = await mustInsert(supabase, 'quizzes', {
            title, teaching_assignment_id: ta.id, duration_minutes: 30,
            available_from: isActive ? PASS : FUTURE, is_active: isActive,
        }, `quiz ${title}`)
        created.quizzes.push(q.id)
        const qq = await mustInsert(supabase, 'quiz_questions', {
            quiz_id: q.id, question_text: `${title} — soal?`, question_type: 'MULTIPLE_CHOICE',
            options: ['a', 'b'], correct_answer: 'a', points: 1, order_index: 0, status: 'approved',
        }, 'quiz question')
        created.questions.push(qq.id)
        return q
    }
    const q1 = await mkQuiz(ta_t1_xi, `${U} Kuis T1 XI`, true)
    const q1draft = await mkQuiz(ta_t1_xi, `${U} Kuis T1 XI DRAFT`, false)
    const q2 = await mkQuiz(ta_t2_x, `${U} Kuis T2 X`, true)
    const q2Sub = await mustInsert(supabase, 'quiz_submissions', {
        quiz_id: q2.id, student_id: sxa.student.id, started_at: PASS,
        submitted_at: new Date().toISOString(), is_graded: false, total_score: 0, max_score: 1,
    }, 'quiz submission q2')
    created.quizSubs.push(q2Sub.id)
    const q1Sub = await mustInsert(supabase, 'quiz_submissions', {
        quiz_id: q1.id, student_id: sxib.student.id, started_at: PASS,
        submitted_at: new Date().toISOString(), is_graded: false, total_score: 0, max_score: 1,
    }, 'quiz submission q1')
    created.quizSubs.push(q1Sub.id)

    // Ulangan T1 aktif + draft di XI; ulangan T2 di X
    const mkExam = async (ta, title, isActive) => {
        const e = await mustInsert(supabase, 'exams', {
            title, start_time: PASS, duration_minutes: 30, teaching_assignment_id: ta.id,
            is_active: isActive, created_by: t1.user.id,
        }, `exam ${title}`)
        created.exams.push(e.id)
        const eq = await mustInsert(supabase, 'exam_questions', {
            exam_id: e.id, question_text: `${title} — soal?`, question_type: 'MULTIPLE_CHOICE',
            options: ['a', 'b'], correct_answer: 'a', points: 1, order_index: 0, status: 'approved',
        }, 'exam question')
        created.questions.push(eq.id)
        return e
    }
    const e1 = await mkExam(ta_t1_xi, `${U} Ulangan T1 XI`, true)
    const e1draft = await mkExam(ta_t1_xi, `${U} Ulangan T1 XI DRAFT`, false)
    const e2 = await mkExam(ta_t2_x, `${U} Ulangan T2 X`, true)
    const e1Sub = await mustInsert(supabase, 'exam_submissions', {
        exam_id: e1.id, student_id: sxib.student.id, is_submitted: true, is_graded: false,
        total_score: 0, max_score: 1,
    }, 'exam submission e1')
    created.examSubs.push(e1Sub.id)
    const e2Sub = await mustInsert(supabase, 'exam_submissions', {
        exam_id: e2.id, student_id: sxa.student.id, is_submitted: true, is_graded: false,
        total_score: 0, max_score: 1,
    }, 'exam submission e2')
    created.examSubs.push(e2Sub.id)

    console.log('fixtures OK: T1 (PAIBP@XI), T2 (PAIBP@X + BTQ@XI), 2 siswa, UTS/kuis/ulangan + submission\n')

    // ---------- SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ---------- [A] LIST UTS/UAS ----------
    console.log('[A] GET /api/official-exams — exact pair (root cause komplain)')
    {
        const r2 = await jsonOf(await api('/api/official-exams', t2.token))
        check('A1: T2 TIDAK melihat UTS T1 (root cause)', !Array.isArray(r2) || !r2.some(e => e.id === oe1.id))
        const r1 = await jsonOf(await api('/api/official-exams', t1.token))
        check('A2: T1 (pemilik) tetap melihat UTS-nya', Array.isArray(r1) && r1.some(e => e.id === oe1.id))
        const ra = await jsonOf(await api('/api/official-exams', admin.token))
        check('A3: ADMIN tetap melihat semua', Array.isArray(ra) && ra.some(e => e.id === oe1.id))
        const rs = await jsonOf(await api('/api/official-exams', sxib.token))
        check('A4: siswa kelas target tetap melihat UTS', Array.isArray(rs) && rs.some(e => e.id === oe1.id))
        const rsx = await jsonOf(await api('/api/official-exams', sxa.token))
        check('A5: siswa kelas X tidak melihat UTS XI', !Array.isArray(rsx) || !rsx.some(e => e.id === oe1.id))
    }

    // ---------- [B] SOAL UTS/UAS ----------
    console.log('\n[B] GET /api/official-exams/[id]/questions — guard guru')
    {
        const r2 = await api(`/api/official-exams/${oe1.id}/questions`, t2.token)
        check('B1: T2 ditolak (403) — soal+kunci T1 tak bocor', r2.status === 403, `status ${r2.status}`)
        const r1 = await jsonOf(await api(`/api/official-exams/${oe1.id}/questions`, t1.token))
        check('B2: T1 (pemilik) baca soal 200 + kunci ada', Array.isArray(r1) && r1.length === 1 && r1[0].correct_answer === 'a')
        const ra = await api(`/api/official-exams/${oe1.id}/questions`, admin.token)
        check('B3: ADMIN tetap boleh', ra.status === 200)
        const rs = await jsonOf(await api(`/api/official-exams/${oe1.id}/questions`, sxib.token))
        check('B4: siswa target yang SUDAH submit boleh lihat kunci (review)', Array.isArray(rs) && rs.length === 1 && rs[0].correct_answer === 'a')
        const rs2 = await jsonOf(await api(`/api/official-exams/${oe1.id}/questions`, sxib2.token))
        check('B5: siswa target yang BELUM submit baca soal TANPA kunci', Array.isArray(rs2) && rs2.length === 1 && !('correct_answer' in rs2[0]))
    }

    // ---------- [D] DETAIL UTS/UAS ----------
    console.log('\n[D] GET /api/official-exams/[id] — guard guru (metadata)')
    {
        const r2 = await api(`/api/official-exams/${oe1.id}`, t2.token)
        check('D1: T2 ditolak (403)', r2.status === 403, `status ${r2.status}`)
        const r1 = await api(`/api/official-exams/${oe1.id}`, t1.token)
        check('D2: T1 tetap boleh', r1.status === 200)
    }

    // ---------- [C] GRADING OVERVIEW ----------
    console.log('\n[C] GET /api/dashboard/guru/grading-overview — exact pair')
    {
        const r2 = await jsonOf(await api('/api/dashboard/guru/grading-overview', t2.token))
        const items2 = (r2 && r2.items) || []
        check('C1: T2 tidak menanggung beban koreksi UTS T1', !items2.some(i => i.id === oe1.id))
        const r1 = await jsonOf(await api('/api/dashboard/guru/grading-overview', t1.token))
        const items1 = (r1 && r1.items) || []
        const oe1Item = items1.find(i => i.id === oe1.id)
        check('C2: T1 melihat beban koreksi UTS-nya (ungraded>=1)', !!oe1Item && oe1Item.ungraded_count >= 1)
        const e1Item = items1.find(i => i.id === e1.id)
        check('C3: T1 melihat beban koreksi ulangan XI-nya', !!e1Item)
        const e2Item = items1.find(i => i.id === e2.id)
        check('C4: T1 TIDAK melihat ulangan T2 di kelas X', !e2Item)
        const items2HasE2 = items2.some(i => i.id === e2.id)
        check('C5: T2 tetap melihat ulangannya sendiri di X', items2HasE2)
    }

    // ---------- [E] DETAIL SUBMISSION UTS ----------
    console.log('\n[E] GET /api/official-exam-submissions/[id] — guard guru per-submission')
    {
        const r2 = await api(`/api/official-exam-submissions/${oeSub.id}`, t2.token)
        check('E1: T2 ditolak (403) — jawaban siswa + kunci tak bocor', r2.status === 403, `status ${r2.status}`)
        const r1 = await api(`/api/official-exam-submissions/${oeSub.id}`, t1.token)
        check('E2: T1 (pengampu kelas siswa) tetap boleh', r1.status === 200)
        const rs = await api(`/api/official-exam-submissions/${oeSub.id}`, sxib.token)
        check('E3: siswa pemilik submission tetap boleh', rs.status === 200)
        const rm = await api(`/api/official-exam-submissions/monitor?exam_id=${oe1.id}`, t1.token)
        check('E4: monitor T1 (pengampu) tetap jalan', rm.status === 200)
    }

    // ---------- [F]+[G] KUIS: SOAL & DETAIL ----------
    console.log('\n[F] GET /api/quizzes/[id]/questions + [G] GET /api/quizzes/[id] — guard siswa+guru')
    {
        const f1 = await api(`/api/quizzes/${q1.id}/questions`, sxa.token)
        check('F1: siswa kelas X ditolak baca soal kuis XI', f1.status === 404, `status ${f1.status}`)
        const f2 = await api(`/api/quizzes/${q1.id}/questions`, t2.token)
        check('F2: T2 (guru lain) ditolak baca soal kuis T1', f2.status === 404, `status ${f2.status}`)
        const f3 = await jsonOf(await api(`/api/quizzes/${q1.id}/questions`, sxib.token))
        check('F3: siswa XI yang SUDAH submit boleh lihat kunci (review)', Array.isArray(f3) && f3.length === 1 && f3[0].correct_answer === 'a')
        const f3b = await jsonOf(await api(`/api/quizzes/${q1.id}/questions`, sxib2.token))
        check('F3b: siswa XI yang BELUM submit baca soal TANPA kunci', Array.isArray(f3b) && f3b.length === 1 && !('correct_answer' in f3b[0]))
        const f4 = await jsonOf(await api(`/api/quizzes/${q1.id}/questions`, t1.token))
        check('F4: T1 pemilik baca soal + kunci', Array.isArray(f4) && f4.length === 1 && f4[0].correct_answer === 'a')

        const g1 = await api(`/api/quizzes/${q1.id}`, sxa.token)
        check('G1: [bypass-patch] siswa X ditolak di detail embed soal', g1.status === 404, `status ${g1.status}`)
        const g2 = await api(`/api/quizzes/${q1.id}`, t2.token)
        check('G2: [bypass-patch] T2 ditolak di detail embed soal', g2.status === 404, `status ${g2.status}`)
        const g3 = await jsonOf(await api(`/api/quizzes/${q1.id}`, sxib.token))
        const g3q = (g3 && g3.questions) || []
        check('G3: siswa XI detail kuis OK (sudah submit → kunci boleh)', !!(g3 && g3.id) && g3q.length === 1 && g3q[0].correct_answer === 'a')
        const g3b = await jsonOf(await api(`/api/quizzes/${q1.id}`, sxib2.token))
        const g3bq = (g3b && g3b.questions) || []
        check('G3b: siswa XI BELUM submit → kunci di-strip', !!(g3b && g3b.id) && g3bq.length === 1 && !('correct_answer' in g3bq[0]))
        const g4 = await jsonOf(await api(`/api/quizzes/${q1.id}`, t1.token))
        const g4q = (g4 && g4.questions) || []
        check('G4: T1 detail kuis + kunci (editor jalan)', !!(g4 && g4.id) && g4q.some(q => q.correct_answer === 'a'))
        const g5 = await api(`/api/quizzes/${q1draft.id}`, sxib.token)
        check('G5: kuis DRAFT tak bisa dibuka siswa sekelas pun', g5.status === 403 || g5.status === 404, `status ${g5.status}`)
    }

    // ---------- [H] LIST KUIS SISWA ----------
    console.log('\n[H] GET /api/quizzes — siswa hanya aktif + jalur TA tertutup')
    {
        const r = await jsonOf(await api('/api/quizzes', sxib.token))
        const ids = (Array.isArray(r) ? r : []).map(q => q.id)
        check('H1: siswa XI melihat kuis aktifnya', ids.includes(q1.id))
        check('H2: draft TIDAK bocor ke siswa', !ids.includes(q1draft.id))
        check('H3: kuis kelas lain tidak muncul', !ids.includes(q2.id))
        const rx = await jsonOf(await api('/api/quizzes', sxa.token))
        check('H4: siswa X melihat kuis kelasnya sendiri', (Array.isArray(rx) ? rx : []).some(q => q.id === q2.id))
        const rp = await jsonOf(await api(`/api/quizzes?teaching_assignment_id=${ta_t1_xi.id}`, sxib.token))
        check('H5: siswa tak bisa lintas kelas via ?teaching_assignment_id', Array.isArray(rp) && rp.length === 0)
        const rg = await jsonOf(await api(`/api/quizzes?teaching_assignment_id=${ta_t1_xi.id}`, t1.token))
        check('H6: guru editor tetap bisa via ?teaching_assignment_id', Array.isArray(rg) && rg.some(q => q.id === q1.id))
    }

    // ---------- [I] LIST ULANGAN SISWA ----------
    console.log('\n[I] GET /api/exams — siswa hanya aktif + jalur TA tertutup')
    {
        const r = await jsonOf(await api('/api/exams', sxib.token))
        const ids = (Array.isArray(r) ? r : []).map(e => e.id)
        check('I1: siswa XI melihat ulangan aktifnya', ids.includes(e1.id))
        check('I2: draft ulangan TIDAK bocor', !ids.includes(e1draft.id))
        check('I3: ulangan kelas lain tidak muncul', !ids.includes(e2.id))
        const rp = await jsonOf(await api(`/api/exams?teaching_assignment_id=${ta_t1_xi.id}`, sxib.token))
        check('I4: siswa tak bisa lintas kelas via ?teaching_assignment_id', Array.isArray(rp) && rp.length === 0)
    }

    // ---------- [J] QUIZ SUBMISSIONS ----------
    console.log('\n[J] GET /api/quiz-submissions — guard guru path A + B')
    {
        const j1 = await api(`/api/quiz-submissions?quiz_id=${q1.id}`, t2.token)
        check('J1: T2 ditolak (403) baca nilai kuis T1', j1.status === 403, `status ${j1.status}`)
        const j2 = await jsonOf(await api(`/api/quiz-submissions?quiz_id=${q1.id}`, t1.token))
        check('J2: T1 melihat submission kuisnya', Array.isArray(j2) && j2.some(s => s.id === q1Sub.id))
        const j3 = await jsonOf(await api('/api/quiz-submissions', t2.token))
        const j3ids = (Array.isArray(j3) ? j3 : []).map(s => s.id)
        check('J3: [path B] T2 hanya submission miliknya (q2)', j3ids.includes(q2Sub.id) && !j3ids.includes(q1Sub.id))
        const j4 = await jsonOf(await api('/api/quiz-submissions', t1.token))
        const j4ids = (Array.isArray(j4) ? j4 : []).map(s => s.id)
        check('J4: [path B] T1 hanya submission miliknya (q1)', j4ids.includes(q1Sub.id) && !j4ids.includes(q2Sub.id))
        const j5 = await jsonOf(await api(`/api/quiz-submissions?quiz_id=${q1.id}&student_id=${sxib.student.id}`, sxib.token))
        check('J5: siswa tetap melihat attempt miliknya', Array.isArray(j5) && j5.some(s => s.id === q1Sub.id))
    }

    // ---------- [K] EXAM SUBMISSIONS ----------
    console.log('\n[K] GET /api/exam-submissions — guard guru path A + B')
    {
        const k1 = await api(`/api/exam-submissions?exam_id=${e1.id}`, t2.token)
        check('K1: T2 ditolak (403) baca nilai ulangan T1', k1.status === 403, `status ${k1.status}`)
        const k2 = await jsonOf(await api(`/api/exam-submissions?exam_id=${e1.id}`, t1.token))
        check('K2: T1 melihat submission ulangannya', Array.isArray(k2) && k2.some(s => s.id === e1Sub.id))
        const k3 = await jsonOf(await api('/api/exam-submissions', t2.token))
        const k3ids = (Array.isArray(k3) ? k3 : []).map(s => s.id)
        check('K3: [path B] T2 hanya submission miliknya (e2)', k3ids.includes(e2Sub.id) && !k3ids.includes(e1Sub.id))
        const k4 = await jsonOf(await api('/api/exam-submissions', t1.token))
        const k4ids = (Array.isArray(k4) ? k4 : []).map(s => s.id)
        check('K4: [path B] T1 hanya submission miliknya (e1)', k4ids.includes(e1Sub.id) && !k4ids.includes(e2Sub.id))
        const k5 = await jsonOf(await api('/api/exam-submissions', sxib.token))
        check('K5: siswa hanya submission miliknya', Array.isArray(k5) && k5.some(s => s.id === e1Sub.id) && !k5.some(s => s.id === e2Sub.id))
    }

    // ---------- [M] REGRESI MUTASI ----------
    console.log('\n[M] Guard mutasi tetap berfungsi (termasuk fix canTeachScope exact pair)')
    {
        const m1 = await api(`/api/quizzes/${q1.id}`, t2.token, { method: 'PUT', body: JSON.stringify({ duration_minutes: 45 }) })
        check('M1: T2 tidak bisa mengubah kuis T1 (PUT 403)', m1.status === 403, `status ${m1.status}`)
        const m2 = await api(`/api/official-exams/${oe1.id}/questions`, t2.token, { method: 'POST', body: JSON.stringify([{ question_text: 'x', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'a' }]) })
        check('M2: T2 tidak bisa menambah soal ke UTS T1 (403, bukan 409)', m2.status === 403, `status ${m2.status}`)
        const m3 = await api(`/api/official-exams/${oe1.id}`, t2.token, { method: 'DELETE' })
        check('M3: T2 tidak bisa menghapus UTS T1 (403)', m3.status === 403, `status ${m3.status}`)
        const m4 = await api('/api/official-exams', t2.token, {
            method: 'POST',
            body: JSON.stringify({
                exam_type: 'UTS', title: `${U} UTS ilegal T2`, subject_id: subjP.id, school_id: school.id,
                academic_year_id: year.id, target_class_ids: [classXI.id], start_time: FUTURE, duration_minutes: 60,
            }),
        })
        check('M4: T2 tidak bisa MEMBUAT UTS PAIBP target XI (403)', m4.status === 403, `status ${m4.status}`)
        const m5 = await api('/api/official-exams', t2.token, {
            method: 'POST',
            body: JSON.stringify({
                exam_type: 'UTS', title: `${U} UTS sah T2 kelas X`, subject_id: subjP.id, school_id: school.id,
                academic_year_id: year.id, target_class_ids: [classX.id], start_time: FUTURE, duration_minutes: 60,
            }),
        })
        if (m5.ok) {
            const m5data = await m5.json()
            created.officialExams.push(m5data.id)
        }
        check('M5: T2 tetap bisa membuat UTS PAIBP di kelasnya sendiri (X)', m5.status === 200, `status ${m5.status}`)
    }

    // ---------- RINGKASAN ----------
    const failed = results.filter(r => !r.ok)
    console.log(`\n${'='.repeat(60)}\nHASIL: ${results.length - failed.length}/${results.length} PASS${failed.length ? `, ${failed.length} FAIL` : ''}`)
    if (failed.length) {
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
        process.exitCode = 1
    }
}

async function cleanup() {
    // Urutan hormati FK: submissions → questions → exams → TA → enrollment → students/teachers → sessions/users → classes → subjects
    const del = async (table, key, ids) => {
        if (!ids.length) return
        for (let i = 0; i < ids.length; i += 100) {
            const { error } = await supabase.from(table).delete().in(key, ids.slice(i, i + 100))
            if (error) console.error(`cleanup ${table}: ${error.message}`)
        }
    }
    await del('official_exam_submissions', 'id', created.officialSubs)
    await del('exam_submissions', 'id', created.examSubs)
    await del('quiz_submissions', 'id', created.quizSubs)
    await del('official_exam_questions', 'id', created.questions)
    await del('quiz_questions', 'id', created.questions)
    await del('exam_questions', 'id', created.questions)
    await del('official_exams', 'id', created.officialExams)
    await del('quizzes', 'id', created.quizzes)
    await del('exams', 'id', created.exams)
    await del('teaching_assignments', 'id', created.tas)
    await del('student_enrollments', 'id', created.enrollments)
    await del('students', 'id', created.students)
    await del('teachers', 'id', created.teachers)
    await del('sessions', 'token', created.sessions)
    await del('users', 'id', created.users)
    await del('classes', 'id', created.classes)
    await del('subjects', 'id', created.subjects)
    console.log('cleanup fixtures selesai')
}

main()
    .catch((e) => { console.error('FATAL:', e.message); process.exitCode = 1 })
    .finally(async () => {
        await cleanup()
        if (server) await stopServerSafe(server, BASE)
        process.exit(process.exitCode || 0)
    })
