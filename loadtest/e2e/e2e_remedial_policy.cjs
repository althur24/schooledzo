/**
 * E2E KEBIJAKAN NILAI REMEDIAL (remedial score policy: HIGHEST/AVERAGE/CAP).
 *
 * Menguji penerapan kebijakan di SEMUA titik merge setelah remedial selesai:
 *  [1] POST /api/exams (remedial ulangan) menyimpan policy + validasi CAP tanpa batas → 400
 *  [2] POST /api/quizzes (remedial kuis) menyimpan policy
 *  [3] POST /api/official-exams/duplicate (remedial UTS) menyimpan policy
 *  [4] HIGHEST (ulangan): asli 40 + remedial 80 → grades 1 nilai = 80
 *  [5] AVERAGE (kuis): asli 40 + remedial 80 → grades 1 nilai = 60
 *  [6] CAP 70 (UTS): asli 40 + remedial 95 → grades 1 nilai = 70
 *  [7] Siswa TIDAK mengerjakan remedial (AVERAGE kuis): nilai asli utuh (40)
 *  [8] Analytics class-grades: skor merge (grade_count=1) untuk ketiga jenis
 *  [9] guru/siswa: skor merge di kuis_scores/ulangan_scores/uts_scores
 *  [10] Halaman hasil guru (teacher_view): skor final sesuai policy
 *  [11] Visibilitas: siswa non-peserta TIDAK melihat remedial kuis/ulangan
 *       di daftar (GET /api/quizzes & /api/exams); allowed_student_ids tidak
 *       bocor; dashboard wali: recentQuizzes/recentExams ter-merge sesuai
 *       kebijakan (1 entri per ujian, skor final — bukan dobel hitung).
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_remedial_policy.cjs
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
    users: [], teachers: [], students: [], classes: [], subjects: [], tas: [],
    enrollments: [], exams: [], examSubmissions: [], quizzes: [], quizSubmissions: [],
    officialExams: [], officialSubmissions: [], notifications: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `pol_${runId}`
    const PASS = 'Policy-Test-123'
    const passHash = bcrypt.hashSync(PASS, 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} Mapel`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const guruUser = await mustInsert(supabase, 'users', { username: `${U}_guru`, full_name: `${U} Guru`, password_hash: passHash, role: 'GURU', school_id: school.id, must_change_password: false, is_locked: false }, 'user guru')
    created.users.push(guruUser.id)
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guruUser.id, school_id: school.id }, 'teacher')
    created.teachers.push(teacher.id)
    const adminUser = await mustInsert(supabase, 'users', { username: `${U}_admin`, full_name: `${U} Admin`, password_hash: passHash, role: 'ADMIN', school_id: school.id, must_change_password: false, is_locked: false }, 'user admin')
    created.users.push(adminUser.id)

    const cls = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class')
    created.classes.push(cls.id)

    const ta = await mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: cls.id, subject_id: subject.id, academic_year_id: year.id }, 'TA')
    created.tas.push(ta.id)

    const mkStudent = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} Siswa ${label.toUpperCase()}`, password_hash: passHash, role: 'SISWA', school_id: school.id, must_change_password: false, is_locked: false }, `user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}p${label}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        return st
    }
    // 4 siswa: s1 ikut semua remedial, s2 tidak mengerjakan remedial, s3 pembanding, s4 tidak ikut remedial sama sekali
    const s1 = await mkStudent('s1')
    const s2 = await mkStudent('s2')
    const s3 = await mkStudent('s3')

    // Wali terhubung ke s1 (untuk verifikasi merge di parent dashboard)
    const waliUser = await mustInsert(supabase, 'users', { username: `${U}_wali`, full_name: `${U} Wali`, password_hash: passHash, role: 'WALI', school_id: school.id, must_change_password: false, is_locked: false }, 'user wali')
    created.users.push(waliUser.id)
    await supabase.from('students').update({ parent_user_id: waliUser.id }).eq('id', s1.id)

    const pastStart = new Date(Date.now() - 3 * 3600000).toISOString()
    const pastSubmit = new Date(Date.now() - 2 * 3600000).toISOString()

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
    const tokGuru = await doLogin(guruUser.username)
    const tokAdmin = await doLogin(adminUser.username)
    check('login guru & admin', !!(tokGuru && tokAdmin))

    // ════════ [1] REMEDIAL ULANGAN — policy HIGHEST via API ════════
    console.log('\n[1] Remedial ulangan (POST /api/exams) + validasi policy')
    // Ulangan asli max_score 40 — sengaja BUKAN 100 untuk menangkap bug skala
    // raw-vs-persen di titik merge (skor disimpan sebagai persen di perhitungan).
    // s1=40%, s2=40%, s3=90%
    const examAsli = await mustInsert(supabase, 'exams', {
        title: `${U} Ulangan Asli`, start_time: pastStart, duration_minutes: 60,
        teaching_assignment_id: ta.id, is_active: true, max_violations: 3, created_by: guruUser.id,
    }, 'exam asli')
    created.exams.push(examAsli.id)
    await mustInsert(supabase, 'exam_questions', { exam_id: examAsli.id, question_text: 'q', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'A', points: 40, order_index: 1, status: 'approved' }, 'exam q')
    const mkExamSub = async (st, pct) => {
        const sub = await mustInsert(supabase, 'exam_submissions', {
            exam_id: examAsli.id, student_id: st.id, started_at: pastStart, submitted_at: pastSubmit,
            is_submitted: true, total_score: Math.round(pct / 100 * 40), max_score: 40,
        }, 'exam sub')
        created.examSubmissions.push(sub.id)
    }
    await mkExamSub(s1, 40); await mkExamSub(s2, 40); await mkExamSub(s3, 90)

    // CAP tanpa batas → 400
    const badCap = await api('/api/exams', tokGuru, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Remedial Bad`, start_time: pastStart, duration_minutes: 60,
            teaching_assignment_id: ta.id, is_remedial: true, remedial_for_id: examAsli.id,
            allowed_student_ids: [s1.id], duplicate_questions: false,
            remedial_score_policy: 'CAP', // tanpa remedial_max_score
        }),
    })
    check('CAP tanpa remedial_max_score → 400', badCap.status === 400, `status=${badCap.status}`)

    const remExamRes = await api('/api/exams', tokGuru, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Remedial Ulangan HIGHEST`, start_time: pastStart, duration_minutes: 60,
            teaching_assignment_id: ta.id, is_remedial: true, remedial_for_id: examAsli.id,
            allowed_student_ids: [s1.id, s2.id], duplicate_questions: false,
            remedial_score_policy: 'HIGHEST',
        }),
    })
    const remExam = remExamRes.ok ? await remExamRes.json() : null
    check('remedial ulangan dibuat → 200', remExamRes.status === 200, `status=${remExamRes.status}`)
    check('policy HIGHEST tersimpan', remExam?.remedial_score_policy === 'HIGHEST')
    if (remExam?.id) created.exams.push(remExam.id)
    // s1 mengerjakan remedial: 80% (32/40); s2 tidak mengerjakan
    const remSub = await mustInsert(supabase, 'exam_submissions', {
        exam_id: remExam.id, student_id: s1.id, started_at: pastStart, submitted_at: pastSubmit,
        is_submitted: true, total_score: 32, max_score: 40,
    }, 'remedial exam sub')
    created.examSubmissions.push(remSub.id)

    // ════════ [2] REMEDIAL KUIS — policy AVERAGE ════════
    console.log('\n[2] Remedial kuis (POST /api/quizzes) — AVERAGE')
    const quizAsli = await mustInsert(supabase, 'quizzes', {
        title: `${U} Kuis Asli`, teaching_assignment_id: ta.id, is_active: true,
        duration_minutes: 30, submission_mode: 'ONLINE', available_from: pastStart,
    }, 'quiz asli')
    created.quizzes.push(quizAsli.id)
    const mkQuizSub = async (quizId, st, score) => {
        const sub = await mustInsert(supabase, 'quiz_submissions', {
            quiz_id: quizId, student_id: st.id, started_at: pastStart, submitted_at: pastSubmit,
            total_score: score, max_score: 100, is_graded: true, needs_manual_review: false, answers: [],
        }, 'quiz sub')
        created.quizSubmissions.push(sub.id)
    }
    await mkQuizSub(quizAsli.id, s1, 40); await mkQuizSub(quizAsli.id, s2, 40); await mkQuizSub(quizAsli.id, s3, 90)

    const remQuizRes = await api('/api/quizzes', tokGuru, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Remedial Kuis AVERAGE`, duration_minutes: 30, teaching_assignment_id: ta.id,
            is_remedial: true, remedial_for_id: quizAsli.id, allowed_student_ids: [s1.id, s2.id],
            duplicate_questions: false, remedial_score_policy: 'AVERAGE',
        }),
    })
    const remQuiz = remQuizRes.ok ? await remQuizRes.json() : null
    check('remedial kuis dibuat → 200', remQuizRes.status === 200, `status=${remQuizRes.status}`)
    check('policy AVERAGE tersimpan', remQuiz?.remedial_score_policy === 'AVERAGE')
    if (remQuiz?.id) created.quizzes.push(remQuiz.id)
    await mkQuizSub(remQuiz.id, s1, 80) // s2 tidak mengerjakan

    // ════════ [3] REMEDIAL UTS — policy CAP 70 ════════
    console.log('\n[3] Remedial UTS (POST /api/official-exams/duplicate) — CAP 70')
    const utsAsli = await mustInsert(supabase, 'official_exams', {
        title: `${U} UTS Asli`, school_id: school.id, subject_id: subject.id, academic_year_id: year.id,
        exam_type: 'UTS', start_time: pastStart, duration_minutes: 90, is_active: true,
        is_remedial: false, allowed_student_ids: null, target_class_ids: [cls.id], created_by: guruUser.id,
    }, 'UTS asli')
    created.officialExams.push(utsAsli.id)
    await mustInsert(supabase, 'official_exam_questions', { exam_id: utsAsli.id, question_type: 'MULTIPLE_CHOICE', correct_answer: 'A', points: 100, question_text: 'q', options: ['a', 'b'], order_index: 1 }, 'UTS q')
    const mkOffSub = async (examId, st, score) => {
        const sub = await mustInsert(supabase, 'official_exam_submissions', {
            exam_id: examId, student_id: st.id, started_at: pastStart, submitted_at: pastSubmit,
            is_submitted: true, is_graded: true, total_score: score, max_score: 100,
        }, 'official sub')
        created.officialSubmissions.push(sub.id)
    }
    await mkOffSub(utsAsli.id, s1, 40); await mkOffSub(utsAsli.id, s2, 40); await mkOffSub(utsAsli.id, s3, 90)

    const remUtsRes = await api('/api/official-exams/duplicate', tokGuru, {
        method: 'POST',
        body: JSON.stringify({
            source_exam_id: utsAsli.id, title: `${U} Remedial UTS CAP`,
            start_time: pastStart, duration_minutes: 90,
            target_class_ids: [cls.id], is_remedial: true, allowed_student_ids: [s1.id],
            remedial_score_policy: 'CAP', remedial_max_score: 70,
        }),
    })
    const remUts = remUtsRes.ok ? await remUtsRes.json() : null
    check('remedial UTS dibuat → 200', remUtsRes.status === 200, `status=${remUtsRes.status}`)
    check('policy CAP + max 70 tersimpan', remUts?.remedial_score_policy === 'CAP' && remUts?.remedial_max_score === 70)
    if (remUts?.id) created.officialExams.push(remUts.id)
    await mkOffSub(remUts.id, s1, 95) // remedial dapat 95 → final = min(95, 70) = 70

    // ════════ [4-7] MERGE DI /api/grades ════════
    console.log('\n[4-7] Merge kebijakan di /api/grades')
    const gradesRes = await api(`/api/grades?academic_year_id=${year.id}`, tokAdmin)
    const allGrades = gradesRes.ok ? await gradesRes.json() : []
    const subjGrades = (sid) => allGrades.filter(g => g.student_id === sid && g.subject_id === subject.id)

    const s1Ulangan = subjGrades(s1.id).filter(g => g.grade_type === 'ULANGAN')
    check('[4] HIGHEST: s1 ulangan = 1 nilai, 80', s1Ulangan.length === 1 && s1Ulangan[0].score === 80, `n=${s1Ulangan.length} score=${s1Ulangan[0]?.score}`)

    const s1Kuis = subjGrades(s1.id).filter(g => g.grade_type === 'KUIS')
    check('[5] AVERAGE: s1 kuis = 1 nilai, 60', s1Kuis.length === 1 && s1Kuis[0].score === 60, `n=${s1Kuis.length} score=${s1Kuis[0]?.score}`)

    const s1Uts = subjGrades(s1.id).filter(g => g.grade_type === 'UTS')
    check('[6] CAP 70: s1 UTS = 1 nilai, 70 (remedial 95 dibatasi)', s1Uts.length === 1 && s1Uts[0].score === 70, `n=${s1Uts.length} score=${s1Uts[0]?.score}`)

    const s2Kuis = subjGrades(s2.id).filter(g => g.grade_type === 'KUIS')
    check('[7] s2 tidak ikut remedial kuis (AVERAGE) → nilai asli 40 utuh', s2Kuis.length === 1 && s2Kuis[0].score === 40, `n=${s2Kuis.length} score=${s2Kuis[0]?.score}`)

    const s3Ulangan = subjGrades(s3.id).filter(g => g.grade_type === 'ULANGAN')
    check('pembanding: s3 (tanpa remedial) tetap 90', s3Ulangan.length === 1 && s3Ulangan[0].score === 90)

    // ════════ [8] ANALYTICS ════════
    console.log('\n[8] Merge di /api/analytics/class-grades')
    const analyticsRes = await api(`/api/analytics/class-grades?academic_year_id=${year.id}`, tokAdmin)
    const analytics = analyticsRes.ok ? await analyticsRes.json() : []
    const clsA = analytics.find(c => c.class_name === `${U} 9A`)
    const subjA = clsA?.subjects?.find(s => s.subject_id === subject.id)
    const s1Detail = subjA?.students?.find(s => s.student_id === s1.id)
    // s1: ulangan 80 + kuis 60 + UTS 70 = 3 nilai, avg (80+60+70)/3 = 70
    check('analytics: s1 grade_count = 3 (merge per jenis)', s1Detail?.grade_count === 3, `count=${s1Detail?.grade_count}`)
    check('analytics: s1 average = 70 (bukan tanpa-merge)', Math.round(s1Detail?.average) === 70, `avg=${s1Detail?.average}`)

    // ════════ [9] GURU/SISWA ════════
    console.log('\n[9] Merge di /api/guru/siswa')
    const guruSiswaRes = await api(`/api/guru/siswa?class_id=${cls.id}`, tokGuru)
    const guruSiswaData = guruSiswaRes.ok ? await guruSiswaRes.json() : null
    const s1Grades = (guruSiswaData?.student_grades || []).find(sg => sg.student_id === s1.id)
    const s1Subjects = s1Grades?.subjects?.[subject.id]
    check('guru/siswa: s1 ulangan_scores = [80]', JSON.stringify(s1Subjects?.ulangan_scores) === '[80]', JSON.stringify(s1Subjects?.ulangan_scores))
    check('guru/siswa: s1 kuis_scores = [60]', JSON.stringify(s1Subjects?.kuis_scores) === '[60]', JSON.stringify(s1Subjects?.kuis_scores))
    check('guru/siswa: s1 uts_scores = [70]', JSON.stringify(s1Subjects?.uts_scores) === '[70]', JSON.stringify(s1Subjects?.uts_scores))

    // ════════ [10] HALAMAN HASIL GURU (teacher_view) ════════
    console.log('\n[10] Halaman hasil guru — skor final sesuai policy')
    const hasilUlanganRes = await api(`/api/exam-submissions?exam_id=${examAsli.id}&teacher_view=true`, tokGuru)
    const hasilUlangan = hasilUlanganRes.ok ? await hasilUlanganRes.json() : []
    const s1Hasil = (Array.isArray(hasilUlangan) ? hasilUlangan : []).find(s => s.student?.id === s1.id)
    check('hasil ulangan guru: s1 total_score = 32/40 (80% HIGHEST, proporsional max asli)', s1Hasil?.total_score === 32, `score=${s1Hasil?.total_score}`)

    const hasilOfficialRes = await api(`/api/official-exam-submissions?exam_id=${utsAsli.id}`, tokGuru)
    const hasilOfficial = hasilOfficialRes.ok ? await hasilOfficialRes.json() : []
    const s1OffHasil = (Array.isArray(hasilOfficial) ? hasilOfficial : []).find(s => s.student?.id === s1.id)
    check('hasil UTS guru: s1 total_score = 70 (CAP)', s1OffHasil?.total_score === 70, `score=${s1OffHasil?.total_score}`)

    // ════════ [11] VISIBILITAS & WALI ════════
    console.log('\n[11] Visibilitas remedial di daftar siswa + merge di dashboard wali')
    // Siswa non-peserta (s3) tidak melihat remedial kuis/ulangan di daftarnya
    const tokS3 = await doLogin(`${U}_s3`)
    const tokS1 = await doLogin(`${U}_s1`)
    check('login siswa s1 & s3', !!(tokS3 && tokS1))

    const s3QuizzesRes = await api('/api/quizzes', tokS3)
    const s3Quizzes = s3QuizzesRes.ok ? await s3QuizzesRes.json() : []
    const s3SeesRemQuiz = (Array.isArray(s3Quizzes) ? s3Quizzes : []).some(q => q.id === remQuiz.id)
    check('s3 (non-peserta) TIDAK melihat remedial kuis di daftar', !s3SeesRemQuiz)

    const s3ExamsRes = await api('/api/exams', tokS3)
    const s3Exams = s3ExamsRes.ok ? await s3ExamsRes.json() : []
    const s3SeesRemExam = (Array.isArray(s3Exams) ? s3Exams : []).some(e => e.id === remExam.id)
    check('s3 (non-peserta) TIDAK melihat remedial ulangan di daftar', !s3SeesRemExam)

    const s1ExamsRes = await api('/api/exams', tokS1)
    const s1Exams = s1ExamsRes.ok ? await s1ExamsRes.json() : []
    const s1SeesRemExam = (Array.isArray(s1Exams) ? s1Exams : []).some(e => e.id === remExam.id)
    check('s1 (peserta) melihat remedial ulangannya', s1SeesRemExam)

    // Privacy: allowed_student_ids tidak bocor ke siswa
    const s3QuizLeak = (Array.isArray(s3Quizzes) ? s3Quizzes : []).some(q => 'allowed_student_ids' in q)
    check('allowed_student_ids tidak bocor di respons siswa', !s3QuizLeak)

    // Dashboard wali: recentQuizzes/recentExams ter-merge sesuai kebijakan
    const tokWali = await doLogin(waliUser.username)
    check('login wali', !!tokWali)
    const parentRes = await api('/api/parent/dashboard', tokWali)
    const parentData = parentRes.ok ? await parentRes.json() : null
    const waliQuizzes = parentData?.child?.recentQuizzes || parentData?.recentQuizzes || []
    const waliExams = parentData?.child?.recentExams || parentData?.recentExams || []
    // s1: kuis asli + remedial AVERAGE → 1 entri skor 60 (bukan 2 entri 40+80)
    const waliKuisAsli = waliQuizzes.filter(q => q.title === `${U} Kuis Asli`)
    check('wali: kuis asli = 1 entri (merge, bukan 2)', waliKuisAsli.length === 1, `n=${waliKuisAsli.length}`)
    check('wali: skor kuis = 60 (AVERAGE, bukan rata 40&80=60 dobel-entri)', waliKuisAsli[0]?.score === 60, `score=${waliKuisAsli[0]?.score}`)
    // s1: ulangan asli + remedial HIGHEST → 1 entri skor 80
    const waliUlanganAsli = waliExams.filter(e => e.title === `${U} Ulangan Asli`)
    check('wali: ulangan asli = 1 entri, skor 80 (HIGHEST)', waliUlanganAsli.length === 1 && waliUlanganAsli[0]?.score === 80, `n=${waliUlanganAsli.length} score=${waliUlanganAsli[0]?.score}`)

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
    await del('notifications', 'user_id', created.users)
    await del('official_exam_submissions', 'id', created.officialSubmissions)
    await del('official_exam_questions', 'exam_id', created.officialExams)
    await del('official_exams', 'id', created.officialExams)
    await del('quiz_submissions', 'id', created.quizSubmissions)
    await del('quizzes', 'id', created.quizzes)
    await del('exam_submissions', 'id', created.examSubmissions)
    await del('exam_questions', 'exam_id', created.exams)
    await del('exams', 'id', created.exams)
    await del('student_enrollments', 'id', created.enrollments)
    await del('students', 'id', created.students)
    await del('teaching_assignments', 'id', created.tas)
    await del('subjects', 'id', created.subjects)
    await del('classes', 'id', created.classes)
    await del('teachers', 'id', created.teachers)
    await del('users', 'id', created.users)
    await stopServerSafe(server, BASE)
    console.log('selesai.')
    process.exit(failed.length ? 1 : 0)
}

main().catch(async (err) => {
    console.error('FATAL:', err.message)
    try { if (server) await stopServerSafe(server, BASE) } catch { /* best effort */ }
    process.exit(1)
})
