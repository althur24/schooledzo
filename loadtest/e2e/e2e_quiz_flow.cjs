/**
 * E2E FUNGSIONAL ALUR KUIS LENGKAP — guru buat kuis → publish → siswa kerjakan
 * → autosave → submit → penilaian otomatis → koreksi manual → rescue draft.
 *
 * Sekaligus memverifikasi fix Batch A–E:
 *  - [A] attempt baru ditolak untuk kuis draft & siswa kelas lain
 *  - [A] /api/students tanpa param → [] untuk SISWA
 *  - [A] all_years=true tetap ter-scope kelas siswa
 *  - [A] re-publish tidak spam notifikasi
 *  - [B] max_score = total SEMUA soal (bukan hanya yang dijawab)
 *  - [B] grading PUT ditolak untuk attempt belum dikumpulkan & skor negatif
 *  - [B/C] autosave tidak menyimpan is_correct/score
 *  - [D] notifikasi NILAI_KELUAR saat koreksi manual selesai
 *  - [E] rescue draft → needs_manual_review + jawaban merge
 *
 * WAJIB staging: ENV_FILE=.env.staging node loadtest/e2e/e2e_quiz_flow.cjs
 * (server next start di-spawn mewarisi env staging; .next harus dibangun dengan
 * env staging — assertServerDb memverifikasinya.)
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
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], quizzes: [], questions: [], submissions: [],
    enrollments: [], notificationsByUser: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `eq_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} Matematika`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const guruUser = await mustInsert(supabase, 'users', { username: `${U}_guru`, full_name: `${U} Guru`, password_hash: passHash, role: 'GURU', school_id: school.id }, 'user guru')
    created.users.push(guruUser.id)
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guruUser.id, school_id: school.id }, 'teacher')
    created.teachers.push(teacher.id)

    const classA = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class A')
    const classB = await mustInsert(supabase, 'classes', { name: `${U} 9B`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class B')
    created.classes.push(classA.id, classB.id)

    const taA = await mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: classA.id, subject_id: subject.id, academic_year_id: year.id }, 'TA A')
    created.tas.push(taA.id)

    const mkStudent = async (label, cls) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} Siswa ${label.toUpperCase()}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}${label}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session ${label}`)).token
        created.sessions.push(tok)
        return { user: u, student: st, token: tok }
    }
    const siswaA = await mkStudent('a', classA) // kelas yang benar
    const siswaB = await mkStudent('b', classB) // kelas lain
    const guruTok = (await mustInsert(supabase, 'sessions', { user_id: guruUser.id, token: `${U}_tok_guru`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session guru')).token
    created.sessions.push(guruTok)

    console.log('fixtures OK (guru, 2 siswa beda kelas, TA, tahun aktif)')

    // ---------- START SERVER (mewarisi env staging) ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ---------- 1. GURU BUAT KUIS (3 MC + 1 ESSAY, 10 poin/soal) ----------
    console.log('[1] Guru membuat kuis (draft)')
    const questions = [
        { question_text: 'MC benar', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 10, order_index: 0 },
        { question_text: 'MC salah', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 10, order_index: 1 },
        { question_text: 'MC kosong', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 10, order_index: 2 },
        { question_text: 'Essay', question_type: 'ESSAY', correct_answer: null, points: 10, order_index: 3 },
    ]
    const createRes = await api('/api/quizzes', guruTok, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Kuis E2E`, description: 'e2e', duration_minutes: 30,
            teaching_assignment_id: taA.id, is_randomized: false, questions,
        }),
    })
    const quiz1 = await createRes.json().catch(() => null)
    check('POST /api/quizzes sukses (200)', createRes.status === 200 && quiz1?.id, `status ${createRes.status}`)
    created.quizzes.push(quiz1?.id)
    const qIds = {}
    const { data: dbQs } = await supabase.from('quiz_questions').select('id, question_text').eq('quiz_id', quiz1.id).order('order_index')
    dbQs.forEach(q => { qIds[q.question_text] = q.id })
    created.questions.push(...dbQs.map(q => q.id))

    // ---------- 2. [A] ATTEMPT DITOLAK SAAT MASIH DRAFT ----------
    console.log('[2] [A] Siswa tidak bisa mengerjakan draft')
    const draftStart = await api('/api/quiz-submissions', siswaA.token, {
        method: 'POST', body: JSON.stringify({ quiz_id: quiz1.id, answers: [] }),
    })
    check('Attempt di kuis draft ditolak 403', draftStart.status === 403, `status ${draftStart.status}`)

    // ---------- 3. GURU PUBLISH + [A] ANTI-SPAM NOTIFIKASI ----------
    console.log('[3] Guru publish kuis (notifikasi 1x saja)')
    const pubRes = await api(`/api/quizzes/${quiz1.id}`, guruTok, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    check('PUT publish sukses', pubRes.status === 200, `status ${pubRes.status}`)
    await new Promise(r => setTimeout(r, 500))
    const notifCount1 = (await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', siswaA.user.id).eq('type', 'KUIS_BARU')).count || 0
    check('Notifikasi KUIS_BARU terkirim 1x', notifCount1 === 1, `count=${notifCount1}`)

    const repubRes = await api(`/api/quizzes/${quiz1.id}`, guruTok, { method: 'PUT', body: JSON.stringify({ is_active: true, title: `${U} Kuis E2E` }) })
    check('Re-PUT kuis aktif sukses (tanpa spam)', repubRes.status === 200, `status ${repubRes.status}`)
    await new Promise(r => setTimeout(r, 500))
    const notifCount2 = (await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', siswaA.user.id).eq('type', 'KUIS_BARU')).count || 0
    check('Re-publish TIDAK mengirim notifikasi lagi', notifCount2 === 1, `count=${notifCount2}`)

    // ---------- 4. [A] SISWA KELAS LAIN DITOLAK ----------
    console.log('[4] [A] Siswa kelas lain tidak bisa mulai')
    const wrongClass = await api('/api/quiz-submissions', siswaB.token, {
        method: 'POST', body: JSON.stringify({ quiz_id: quiz1.id, answers: [] }),
    })
    check('Attempt siswa kelas lain ditolak 403', wrongClass.status === 403, `status ${wrongClass.status}`)

    // ---------- 5. SISWA KELAS YANG BENAR MULAI ----------
    console.log('[5] Siswa kelas A mulai attempt')
    const start = await api('/api/quiz-submissions', siswaA.token, {
        method: 'POST', body: JSON.stringify({ quiz_id: quiz1.id, answers: [] }),
    })
    const startBody = await start.json().catch(() => null)
    check('Attempt sukses dibuat', start.status === 200 && startBody?.id, `status ${start.status}`)
    check('Kontrak waktu ada (started_at + ends_at)', !!startBody?.started_at && startBody?.ends_at !== undefined)
    created.submissions.push(startBody.id)
    const sub1Id = startBody.id

    // ---------- 6. [B/C] AUTOSAVE TANPA IS_CORRECT ----------
    console.log('[6] Autosave — tanpa bocoran is_correct/score')
    const saveRes = await api('/api/quiz-submissions', siswaA.token, {
        method: 'POST',
        body: JSON.stringify({
            quiz_id: quiz1.id,
            answers: [
                { question_id: qIds['MC benar'], answer: 'A' },
                { question_id: qIds['MC salah'], answer: 'B' },
            ],
        }),
    })
    check('Autosave sukses', saveRes.status === 200, `status ${saveRes.status}`)
    const { data: subAfterSave } = await supabase.from('quiz_submissions').select('answers').eq('id', sub1Id).single()
    const answersAfterSave = Array.isArray(subAfterSave?.answers) ? subAfterSave.answers : []
    const leaky = answersAfterSave.filter(a => a.is_correct !== undefined || a.score !== undefined)
    check('Jawaban tersimpan TANPA is_correct/score', answersAfterSave.length === 2 && leaky.length === 0, `leaky=${leaky.length}`)

    // ---------- 7. SUBMIT + [B] MAX_SCORE = SEMUA SOAL ----------
    console.log('[7] Submit — max_score total SEMUA soal (4×10=40)')
    const submitRes = await api('/api/quiz-submissions', siswaA.token, {
        method: 'POST',
        body: JSON.stringify({
            quiz_id: quiz1.id, submit: true,
            answers: [
                { question_id: qIds['MC benar'], answer: 'A' },
                { question_id: qIds['MC salah'], answer: 'B' },
            ],
        }),
    })
    const submitBody = await submitRes.json().catch(() => null)
    check('Submit sukses', submitRes.status === 200, `status ${submitRes.status}`)
    check('total_score = 10 (1 MC benar × 10)', submitBody?.total_score === 10, `total=${submitBody?.total_score}`)
    check('max_score = 40 (SEMUA 4 soal, bukan 2 yang dijawab=20)', submitBody?.max_score === 40, `max=${submitBody?.max_score}`)
    check('is_graded = false (ada essay)', submitBody?.is_graded === false, `graded=${submitBody?.is_graded}`)
    check('submitted_at terisi', !!submitBody?.submitted_at)

    // ---------- 8. [B] GRADING GUARD ----------
    console.log('[8] Guard koreksi guru')
    const negScore = await api(`/api/quiz-submissions/${sub1Id}`, guruTok, {
        method: 'PUT', body: JSON.stringify({ answers: submitBody.answers, total_score: -5, is_graded: false }),
    })
    check('Skor negatif ditolak 400', negScore.status === 400, `status ${negScore.status}`)

    const overScore = await api(`/api/quiz-submissions/${sub1Id}`, guruTok, {
        method: 'PUT', body: JSON.stringify({ answers: submitBody.answers, total_score: 999, is_graded: false }),
    })
    check('Skor > max_score ditolak 400', overScore.status === 400, `status ${overScore.status}`)

    // Attempt kedua belum dikumpulkan → grading harus ditolak
    const createQuiz2 = await api('/api/quizzes', guruTok, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Kuis 2`, duration_minutes: 30, teaching_assignment_id: taA.id,
            is_randomized: false,
            questions: [{ question_text: 'MC2', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'A', points: 10, order_index: 0 }],
        }),
    })
    const quiz2 = await createQuiz2.json().catch(() => null)
    check('POST kuis kedua sukses', createQuiz2.status === 200 && !!quiz2?.id, `status ${createQuiz2.status}`)
    created.quizzes.push(quiz2?.id)
    await api(`/api/quizzes/${quiz2.id}`, guruTok, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    const { data: q2q } = await supabase.from('quiz_questions').select('id').eq('quiz_id', quiz2.id).single()
    if (q2q) created.questions.push(q2q.id)
    const start2 = await api('/api/quiz-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ quiz_id: quiz2.id, answers: [] }) })
    const sub2 = await start2.json().catch(() => null)
    created.submissions.push(sub2.id)
    const gradeUnsubmitted = await api(`/api/quiz-submissions/${sub2.id}`, guruTok, {
        method: 'PUT', body: JSON.stringify({ answers: [], total_score: 10, is_graded: true }),
    })
    check('Koreksi attempt BELUM dikumpulkan ditolak 400', gradeUnsubmitted.status === 400, `status ${gradeUnsubmitted.status}`)

    // ---------- 9. [D] KOREKSI MANUAL + NOTIFIKASI NILAI_KELUAR ----------
    console.log('[9] Koreksi manual essay + notifikasi Nilai Keluar')
    const gradedAnswers = submitBody.answers.map(a =>
        a.question_id === qIds['Essay'] ? { ...a, answer: a.answer || '-', is_correct: null, score: 20 > 20 ? 10 : 10, feedback: 'Jawaban cukup' } : a
    )
    const gradeRes = await api(`/api/quiz-submissions/${sub1Id}`, guruTok, {
        method: 'PUT', body: JSON.stringify({ answers: gradedAnswers, total_score: 30, is_graded: true }),
    })
    check('Grading PUT sukses', gradeRes.status === 200, `status ${gradeRes.status}`)
    const { data: subGraded } = await supabase.from('quiz_submissions').select('total_score, is_graded').eq('id', sub1Id).single()
    check('Nilai tersimpan (30/40, is_graded=true)', subGraded?.total_score === 30 && subGraded?.is_graded === true, `total=${subGraded?.total_score}`)
    await new Promise(r => setTimeout(r, 500))
    const { count: nilaiNotif } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', siswaA.user.id).eq('type', 'NILAI_KELUAR')
    check('Notifikasi NILAI_KELUAR terkirim saat koreksi selesai', (nilaiNotif || 0) === 1, `count=${nilaiNotif}`)

    // ---------- 10. [E] RESCUE DRAFT ----------
    console.log('[10] Rescue draft (attempt tertutup, jawaban tertunda)')
    // Siswa B submit 1 jawaban benar via autosave di quiz2 (kelas B tidak bisa —
    // pakai siswa A): tutup paksa attempt sub2 (simulasi waktu habis saat offline)
    await supabase.from('quiz_submissions').update({
        submitted_at: new Date().toISOString(), total_score: 0, max_score: 10, is_graded: true, answers: [],
    }).eq('id', sub2.id)
    const rescueRes = await api(`/api/quiz-submissions/${sub2.id}/rescue`, siswaA.token, {
        method: 'POST', body: JSON.stringify({ answers: [{ question_id: q2q.id, answer: 'A' }] }),
    })
    check('Rescue sukses', rescueRes.status === 200, `status ${rescueRes.status}`)
    const { data: subRescued } = await supabase.from('quiz_submissions').select('needs_manual_review, answers, total_score, submitted_at').eq('id', sub2.id).single()
    check('needs_manual_review = true', subRescued?.needs_manual_review === true)
    check('Jawaban rescue ter-merge (1 jawaban)', Array.isArray(subRescued?.answers) && subRescued.answers.length === 1)
    check('Skor & tanggal TIDAK diubah oleh rescue', subRescued?.total_score === 0, `total=${subRescued?.total_score}`)

    // Rescue attempt yang masih berjalan harus ditolak
    const start3 = await api('/api/quiz-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ quiz_id: quiz2.id, answers: [] }) })
    // quiz2 sudah dikumpulkan siswa A (sub2 closed) → 400 "sudah dikumpulkan" — jalur yang diharapkan
    check('Attempt ulang kuis yang sudah dikumpulkan ditolak 400', start3.status === 400, `status ${start3.status}`)

    // ---------- 11. [A] GUARD /api/students & SCOPE all_years ----------
    console.log('[11] Guard students & scope all_years untuk SISWA')
    const studsOpen = await api('/api/students', siswaA.token)
    const studsOpenBody = await studsOpen.json().catch(() => null)
    // [e30eea7] SISWA tanpa user_id → auto-scope DATA DIRI (dulu: [], sebelumnya pernah
    // bocor roster sekolah). Yang penting: HANYA dirinya, bukan siswa lain.
    const selfOnly = Array.isArray(studsOpenBody) && studsOpenBody.length === 1 && studsOpenBody[0].user_id === siswaA.user.id
    check('GET /api/students tanpa param → hanya data diri (auto-scope)', selfOnly, `len=${Array.isArray(studsOpenBody) ? studsOpenBody.length : 'n/a'}`)

    const studsSelf = await api(`/api/students?user_id=${siswaA.user.id}`, siswaA.token)
    const studsSelfBody = await studsSelf.json().catch(() => null)
    check('GET /api/students?user_id=dirinya → 1 baris', Array.isArray(studsSelfBody) && studsSelfBody.length === 1)

    const allYears = await api('/api/quizzes?all_years=true', siswaA.token)
    const allYearsBody = await allYears.json().catch(() => null)
    const wrongClassQuizzes = (allYearsBody || []).filter(q => {
        const ta = Array.isArray(q.teaching_assignment) ? q.teaching_assignment[0] : q.teaching_assignment
        return ta?.class?.id !== classA.id
    })
    check('all_years=true hanya kuis kelas siswa sendiri', Array.isArray(allYearsBody) && wrongClassQuizzes.length === 0, `total=${allYearsBody?.length}, salah-kelas=${wrongClassQuizzes.length}`)

    const stuList = await api('/api/quizzes', siswaA.token)
    const stuListBody = await stuList.json().catch(() => null)
    const leakAllowed = (stuListBody || []).find(q => q.allowed_student_ids !== undefined)
    check('allowed_student_ids tidak bocor ke SISWA', !leakAllowed)

    // ---------- HASIL ----------
    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL E2E ALUR KUIS =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'E2E-QUIZ-FLOW: PASS ✅' : 'E2E-QUIZ-FLOW: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : null
    const delBy = (t, col, ids) => ids.length ? supabase.from(t).delete().in(col, ids) : null
    await del('quiz_submissions', created.submissions)
    await del('quiz_questions', created.questions)
    await del('quizzes', created.quizzes)
    for (const uid of created.users) await supabase.from('notifications').delete().eq('user_id', uid)
    await del('sessions', created.sessions)
    await del('student_enrollments', created.enrollments)
    await del('students', created.students)
    await del('teaching_assignments', created.tas)
    await del('teachers', created.teachers)
    await del('classes', created.classes)
    await del('subjects', created.subjects)
    await del('users', created.users)
    console.log('cleanup selesai')
}

main()
    .catch(async e => {
        console.error('ERROR:', e.message)
        process.exitCode = 1
        if (server) await stopServerSafe(server, BASE).catch(() => { })
    })
    .finally(cleanup)
