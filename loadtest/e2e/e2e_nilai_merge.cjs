/**
 * E2E NILAI & REKAP — verifikasi merge nilai remedial + rekap guru TIDAK
 * berantakan setelah guard scope ditambahkan di GET /api/quiz-submissions dan
 * GET /api/exam-submissions (halaman Rekap Nilai guru memanggil endpoint ini
 * dengan ?quiz_id= / ?exam_id=).
 *
 * Skenario per tipe (kuis & ulangan):
 *   - kuis sumber 2 MC ×10: siswa1 = 10/20 (remedial), siswa2 = 20/20
 *   - remedial dibuat VIA API asli (guard remedial ikut teruji), policy HIGHEST
 *   - siswa1 remedial = 20/20
 *   - [MERGE] guru GET ?quiz_id=sumber → siswa1 TEPAT 1 baris, skor merge 20/20
 *     (bukan 10, bukan 30, bukan 2 baris dobel) — DB mentah tidak tersentuh
 *   - [COTEACHER] guru co-teacher (mapel+kelas sama) melihat data identik
 *   - [ASING] guru lain (mapel beda, kelas sama) → 403 path A, kosong path B
 *   - [REMEDIAL-GATE] siswa tak terdaftar remedial tidak bisa attempt
 *
 * WAJIB staging: ENV_FILE=.env.staging node loadtest/e2e/e2e_nilai_merge.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PORT = 3122
const BASE = `http://localhost:${PORT}`
const PAST = new Date(Date.now() - 60_000).toISOString()

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [], subjects: [], tas: [],
    quizzes: [], exams: [], questions: [], quizSubs: [], examSubs: [], enrollments: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `nm${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subjA = await mustInsert(supabase, 'subjects', { name: `${U} Matematika`, school_id: school.id, kkm: 75 }, 'subject A')
    const subjZ = await mustInsert(supabase, 'subjects', { name: `${U} Sejarah`, school_id: school.id, kkm: 75 }, 'subject Z')
    created.subjects.push(subjA.id, subjZ.id)
    const classA = await mustInsert(supabase, 'classes', { name: `${U} 9N`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class A')
    created.classes.push(classA.id)

    const mkGuru = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_g${label}`, full_name: `${U} Guru ${label}`, password_hash: passHash, role: 'GURU', school_id: school.id }, `user guru ${label}`)
        created.users.push(u.id)
        const t = await mustInsert(supabase, 'teachers', { user_id: u.id, school_id: school.id }, `teacher ${label}`)
        created.teachers.push(t.id)
        const s = await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_g${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session guru ${label}`)
        created.sessions.push(s.token)
        return { user: u, teacher: t, token: s.token }
    }
    const mkSiswa = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_s${label}`, full_name: `${U} Siswa ${label}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user siswa ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}${label}`, class_id: classA.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: classA.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        const s = await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_s${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session siswa ${label}`)
        created.sessions.push(s.token)
        return { user: u, student: st, token: s.token }
    }

    const gOwner = await mkGuru('own')   // pemilik TA Matematika@A
    const gCo = await mkGuru('co')       // co-teacher: Matematika@A (pair sama)
    const gAsing = await mkGuru('for')   // guru asing: Sejarah@A (mapel beda)
    const s1 = await mkSiswa('1')        // siswa remedial
    const s2 = await mkSiswa('2')        // siswa baik

    const taOwn = await mustInsert(supabase, 'teaching_assignments', { teacher_id: gOwner.teacher.id, class_id: classA.id, subject_id: subjA.id, academic_year_id: year.id }, 'TA owner')
    await mustInsert(supabase, 'teaching_assignments', { teacher_id: gCo.teacher.id, class_id: classA.id, subject_id: subjA.id, academic_year_id: year.id }, 'TA co-teacher')
    await mustInsert(supabase, 'teaching_assignments', { teacher_id: gAsing.teacher.id, class_id: classA.id, subject_id: subjZ.id, academic_year_id: year.id }, 'TA asing')
    created.tas.push(taOwn.id)

    console.log('fixtures OK: pemilik + co-teacher + guru asing, 2 siswa\n')

    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ============================ [KUIS] ============================
    console.log('═══ KUIS: nilai + merge remedial + rekap ═══')
    const kuisBody = {
        title: `${U} Kuis Sumber`, duration_minutes: 30, teaching_assignment_id: taOwn.id,
        is_randomized: false,
        questions: [
            { question_text: '2+2?', question_type: 'MULTIPLE_CHOICE', options: ['3', '4', '5', '6'], correct_answer: '4', points: 10, order_index: 0 },
            { question_text: '3+3?', question_type: 'MULTIPLE_CHOICE', options: ['5', '6', '7', '8'], correct_answer: '6', points: 10, order_index: 1 },
        ],
    }
    const kuisRes = await api('/api/quizzes', gOwner.token, { method: 'POST', body: JSON.stringify(kuisBody) })
    const kuis = await kuisRes.json().catch(() => null)
    check('K1: kuis sumber dibuat', kuisRes.status === 200 && !!kuis?.id, `status ${kuisRes.status}`)
    created.quizzes.push(kuis?.id)
    const pubK = await api(`/api/quizzes/${kuis.id}`, gOwner.token, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    check('K2: kuis dipublish', pubK.status === 200, `status ${pubK.status}`)

    const { data: kq } = await supabase.from('quiz_questions').select('id, order_index').eq('quiz_id', kuis.id).order('order_index')
    created.questions.push(...kq.map(q => q.id))
    const kqA = kq[0].id, kqB = kq[1].id

    const quizSubmit = async (tok, quizId, a1, a2) => {
        const r = await api('/api/quiz-submissions', tok, {
            method: 'POST',
            body: JSON.stringify({ quiz_id: quizId, submit: true, answers: [
                { question_id: kqA, answer: a1 }, { question_id: kqB, answer: a2 },
            ] }),
        })
        return { status: r.status, body: await r.json().catch(() => null) }
    }
    const sub1 = await quizSubmit(s1.token, kuis.id, '4', '5')  // 1 benar → 10/20
    const sub2 = await quizSubmit(s2.token, kuis.id, '4', '6')  // 2 benar → 20/20
    check('K3: siswa1 submit 10/20', sub1.body?.total_score === 10 && sub1.body?.max_score === 20, `total=${sub1.body?.total_score}/${sub1.body?.max_score}`)
    check('K4: siswa2 submit 20/20', sub2.body?.total_score === 20 && sub2.body?.max_score === 20, `total=${sub2.body?.total_score}/${sub2.body?.max_score}`)
    created.quizSubs.push(sub1.body?.id, sub2.body?.id)

    // Remedial via API asli (guard "kelas & mapel sama" ikut dievaluasi)
    const remKuisRes = await api('/api/quizzes', gOwner.token, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Kuis Remedial`, duration_minutes: 30, teaching_assignment_id: taOwn.id,
            is_remedial: true, remedial_for_id: kuis.id, remedial_score_policy: 'HIGHEST',
            duplicate_questions: true, allowed_student_ids: [s1.student.id],
        }),
    })
    const remKuis = await remKuisRes.json().catch(() => null)
    check('K5: kuis remedial dibuat via API (soal tersalin)', remKuisRes.status === 200 && !!remKuis?.id, `status ${remKuisRes.status}`)
    created.quizzes.push(remKuis?.id)
    if (remKuis?.id) {
        const { data: rq } = await supabase.from('quiz_questions').select('id').eq('quiz_id', remKuis.id).order('order_index')
        created.questions.push(...rq.map(q => q.id))
        const pubRK = await api(`/api/quizzes/${remKuis.id}`, gOwner.token, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
        check('K6: remedial dipublish', pubRK.status === 200, `status ${pubRK.status}`)
    }

    // Gate remedial: siswa tak terdaftar ditolak
    const gateK = await quizSubmit(s2.token, remKuis.id, '4', '6')
    check('K7: [REMEDIAL-GATE] siswa tak terdaftar remedial ditolak', gateK.status === 403, `status ${gateK.status}`)

    // Siswa1 kerjakan remedial → 20/20
    const { data: remKq } = await supabase.from('quiz_questions').select('id').eq('quiz_id', remKuis.id).order('order_index')
    const remSub = await api('/api/quiz-submissions', s1.token, {
        method: 'POST',
        body: JSON.stringify({ quiz_id: remKuis.id, submit: true, answers: [
            { question_id: remKq[0].id, answer: '4' }, { question_id: remKq[1].id, answer: '6' },
        ] }),
    })
    const remSubBody = await remSub.json().catch(() => null)
    check('K8: siswa1 remedial 20/20', remSubBody?.total_score === 20, `total=${remSubBody?.total_score}`)
    created.quizSubs.push(remSubBody?.id)

    // [MERGE] Rekap guru pemilik — inilah yang dipakai halaman Rekap Nilai
    const rekapOwner = await api(`/api/quiz-submissions?quiz_id=${kuis.id}`, gOwner.token)
    const rekapOwnerBody = rekapOwner.ok ? await rekapOwner.json() : []
    const rowsS1 = (rekapOwnerBody || []).filter(r => r.student_id === s1.student.id)
    const rowsS2 = (rekapOwnerBody || []).filter(r => r.student_id === s2.student.id)
    check('K9: [MERGE] siswa1 TEPAT 1 baris (bukan dobel)', rowsS1.length === 1, `n=${rowsS1.length}`)
    check('K10: [MERGE] siswa1 skor HIGHEST = 20/20 (bukan 10, bukan 30)', rowsS1[0]?.total_score === 20 && rowsS1[0]?.max_score === 20, `total=${rowsS1[0]?.total_score}/${rowsS1[0]?.max_score}`)
    check('K11: [MERGE] siswa1 ada penanda merged_from_remedial', rowsS1[0]?.merged_from_remedial === true)
    check('K12: siswa2 tetap 20/20 satu baris', rowsS2.length === 1 && rowsS2[0]?.total_score === 20, `n=${rowsS2.length} total=${rowsS2[0]?.total_score}`)

    // DB mentah tidak dirusak merge
    const { data: dbSub1 } = await supabase.from('quiz_submissions').select('total_score').eq('id', sub1.body.id).single()
    check('K13: skor DB mentah sumber TIDAK tersentuh merge (tetap 10)', dbSub1?.total_score === 10, `db=${dbSub1?.total_score}`)

    // [COTEACHER] co-teacher melihat rekap identik (guard tidak memutus co-teaching)
    const rekapCo = await api(`/api/quiz-submissions?quiz_id=${kuis.id}`, gCo.token)
    check('K14: [COTEACHER] co-teacher boleh (200)', rekapCo.status === 200, `status ${rekapCo.status}`)
    const rekapCoBody = rekapCo.ok ? await rekapCo.json() : []
    const coS1 = (rekapCoBody || []).filter(r => r.student_id === s1.student.id)
    check('K15: [COTEACHER] merge remedial identik utk co-teacher', coS1.length === 1 && coS1[0]?.total_score === 20, `n=${coS1.length} total=${coS1[0]?.total_score}`)

    // [ASING] guru lain ditolak
    const rekapAsing = await api(`/api/quiz-submissions?quiz_id=${kuis.id}`, gAsing.token)
    check('K16: [ASING] guru mapel lain 403 di rekap kuis', rekapAsing.status === 403, `status ${rekapAsing.status}`)

    // Path B: rekap tanpa quiz_id — guru asing tidak melihat baris kuis owner
    const allAsing = await api('/api/quiz-submissions', gAsing.token)
    const allAsingBody = allAsing.ok ? await allAsing.json() : []
    const asingIds = (allAsingBody || []).map(r => r.quiz_id)
    check('K17: [ASING][path B] baris kuis owner+remedial tidak muncul', !ising(asingIds, kuis.id) && !ising(asingIds, remKuis.id))

    // ============================ [ULANGAN] ============================
    console.log('\n═══ ULANGAN: nilai + merge remedial + rekap ═══')
    const examRes = await api('/api/exams', gOwner.token, {
        method: 'POST',
        body: JSON.stringify({ title: `${U} Ulangan Sumber`, start_time: PAST, duration_minutes: 30, teaching_assignment_id: taOwn.id }),
    })
    const exam = await examRes.json().catch(() => null)
    check('E1: ulangan sumber dibuat', examRes.status === 200 && !!exam?.id, `status ${examRes.status}`)
    created.exams.push(exam?.id)

    // Tambah soal SEBELUM publish (publish tanpa soal ditolak 400 by-design)
    const addEq = await api(`/api/exams/${exam.id}/questions`, gOwner.token, {
        method: 'POST',
        body: JSON.stringify({ questions: [
            { question_text: 'Ibu kota?', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'X', 'Y'], correct_answer: 'A', points: 10, order_index: 0 },
            { question_text: '2×2?', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'X', 'Y'], correct_answer: 'B', points: 10, order_index: 1 },
        ] }),
    })
    check('E1b: 2 soal ulangan ditambah via API', addEq.status === 200, `status ${addEq.status}`)
    // AI review staging memicu HOTS async yang menimpa status soal
    // (draft → ai_reviewing → admin_review) — publish saat status belum final
    // masuk jalur pending_publish (200 tapi tidak aktif). Poll sampai proses
    // selesai, lalu setujui (meniru review admin selesai), baru publish.
    const settleQuestions = async (examId) => {
        for (let i = 0; i < 30; i++) {
            const { data: st } = await supabase.from('exam_questions').select('status').eq('exam_id', examId)
            if ((st || []).every(q => q.status !== 'ai_reviewing' && q.status !== 'draft')) break
            await new Promise(r => setTimeout(r, 500))
        }
        await supabase.from('exam_questions').update({ status: 'approved' }).eq('exam_id', examId)
    }
    await settleQuestions(exam.id)
    const pubE = await api(`/api/exams/${exam.id}`, gOwner.token, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    check('E2: ulangan dipublish', pubE.status === 200, `status ${pubE.status}`)
    const { data: examActive } = await supabase.from('exams').select('is_active').eq('id', exam.id).single()
    check('E2b: ulangan benar-benar aktif (bukan pending)', examActive?.is_active === true, `is_active=${examActive?.is_active}`)

    const { data: eq } = await supabase.from('exam_questions').select('id').eq('exam_id', exam.id).order('order_index')
    created.questions.push(...eq.map(q => q.id))

    const examRun = async (tok, examId, a1, a2) => {
        const start = await api('/api/exam-submissions', tok, { method: 'POST', body: JSON.stringify({ exam_id: examId }) })
        if (!start.ok) {
            const eb = await start.json().catch(() => null)
            return { status: start.status, body: null, err: eb?.error || `start ${start.status}` }
        }
        const sb = await start.json()
        const put = await api('/api/exam-submissions', tok, {
            method: 'PUT',
            body: JSON.stringify({ submission_id: sb.id, submit: true, answers: [
                { question_id: eq[0].id, answer: a1 }, { question_id: eq[1].id, answer: a2 },
            ] }),
        })
        const pb = await put.json().catch(() => null)
        return { status: put.status, body: pb, err: pb?.error || (put.ok ? null : `submit ${put.status}`) }
    }
    const esub1 = await examRun(s1.token, exam.id, 'A', 'X') // 1 benar → 10/20
    const esub2 = await examRun(s2.token, exam.id, 'A', 'B') // 2 benar → 20/20
    check('E3: siswa1 ulangan 10/20', esub1.body?.total_score === 10 && esub1.body?.max_score === 20, `total=${esub1.body?.total_score}/${esub1.body?.max_score} err=${esub1.err || '-'}`)
    check('E4: siswa2 ulangan 20/20', esub2.body?.total_score === 20, `total=${esub2.body?.total_score} err=${esub2.err || '-'}`)
    created.examSubs.push(esub1.body?.id, esub2.body?.id)

    const remExamRes = await api('/api/exams', gOwner.token, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Ulangan Remedial`, start_time: PAST, duration_minutes: 30,
            teaching_assignment_id: taOwn.id, is_remedial: true, remedial_for_id: exam.id,
            remedial_score_policy: 'HIGHEST', duplicate_questions: true, allowed_student_ids: [s1.student.id],
        }),
    })
    const remExam = await remExamRes.json().catch(() => null)
    check('E5: ulangan remedial dibuat via API', remExamRes.status === 200 && !!remExam?.id, `status ${remExamRes.status}`)
    created.exams.push(remExam?.id)
    if (remExam?.id) {
        const { data: erq } = await supabase.from('exam_questions').select('id').eq('exam_id', remExam.id).order('order_index')
        created.questions.push(...erq.map(q => q.id))
        // Duplicate menyalin status soal sumber — pastikan approved lalu publish
        await settleQuestions(remExam.id)
        const pubRE = await api(`/api/exams/${remExam.id}`, gOwner.token, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
        check('E5b: remedial ulangan dipublish & aktif', pubRE.status === 200, `status ${pubRE.status}`)
    }

    const egate = await examRun(s2.token, remExam.id, 'A', 'B')
    check('E6: [REMEDIAL-GATE] siswa tak terdaftar remedial ulangan ditolak', egate.status === 403, `status ${egate.status}`)

    const { data: erq2 } = await supabase.from('exam_questions').select('id').eq('exam_id', remExam.id).order('order_index')
    const eremStart = await api('/api/exam-submissions', s1.token, { method: 'POST', body: JSON.stringify({ exam_id: remExam.id }) })
    const eremSb = eremStart.ok ? await eremStart.json().catch(() => null) : null
    if (!eremSb?.id) throw new Error(`start remedial ulangan gagal: ${eremStart.status}`)
    const eremPut = await api('/api/exam-submissions', s1.token, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: eremSb?.id, submit: true, answers: [
            { question_id: erq2[0].id, answer: 'A' }, { question_id: erq2[1].id, answer: 'B' },
        ] }),
    })
    const eremBody = await eremPut.json().catch(() => null)
    check('E7: siswa1 remedial ulangan 20/20', eremBody?.total_score === 20, `total=${eremBody?.total_score}`)
    created.examSubs.push(eremSb?.id)

    const eRekapOwner = await api(`/api/exam-submissions?exam_id=${exam.id}`, gOwner.token)
    const eRekapBody = eRekapOwner.ok ? await eRekapOwner.json() : []
    const eRowsS1 = (eRekapBody || []).filter(r => r.student_id === s1.student.id)
    const eRowsS2 = (eRekapBody || []).filter(r => r.student_id === s2.student.id)
    check('E8: [MERGE] siswa1 TEPAT 1 baris', eRowsS1.length === 1, `n=${eRowsS1.length}`)
    check('E9: [MERGE] siswa1 skor HIGHEST = 20/20', eRowsS1[0]?.total_score === 20 && eRowsS1[0]?.max_score === 20, `total=${eRowsS1[0]?.total_score}/${eRowsS1[0]?.max_score}`)
    check('E10: siswa2 tetap 20/20 satu baris', eRowsS2.length === 1 && eRowsS2[0]?.total_score === 20, `n=${eRowsS2.length}`)

    const { data: dbEsub1 } = await supabase.from('exam_submissions').select('total_score').eq('id', esub1.body.id).single()
    check('E11: skor DB mentah ulangan sumber TIDAK tersentuh (tetap 10)', dbEsub1?.total_score === 10, `db=${dbEsub1?.total_score}`)

    const eRekapCo = await api(`/api/exam-submissions?exam_id=${exam.id}`, gCo.token)
    check('E12: [COTEACHER] co-teacher boleh rekap ulangan', eRekapCo.status === 200, `status ${eRekapCo.status}`)
    const eRekapAsing = await api(`/api/exam-submissions?exam_id=${exam.id}`, gAsing.token)
    check('E13: [ASING] guru mapel lain 403 di rekap ulangan', eRekapAsing.status === 403, `status ${eRekapAsing.status}`)

    // ---------- RINGKASAN ----------
    const failed = results.filter(r => !r.ok)
    console.log(`\n${'='.repeat(60)}\nHASIL: ${results.length - failed.length}/${results.length} PASS${failed.length ? `, ${failed.length} FAIL` : ''}`)
    if (failed.length) {
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
        process.exitCode = 1
    }
}

function ising(arr, v) { return arr.includes(v) }

async function cleanup() {
    const del = async (table, key, ids) => {
        const clean = (ids || []).filter(Boolean)
        if (!clean.length) return
        for (let i = 0; i < clean.length; i += 100) {
            const { error } = await supabase.from(table).delete().in(key, clean.slice(i, i + 100))
            if (error) console.error(`cleanup ${table}: ${error.message}`)
        }
    }
    await del('quiz_submissions', 'id', created.quizSubs)
    await del('exam_submissions', 'id', created.examSubs)
    await del('quiz_questions', 'id', created.questions)
    await del('exam_questions', 'id', created.questions)
    await del('quizzes', 'id', created.quizzes)
    await del('exams', 'id', created.exams)
    await del('notifications', 'user_id', created.users)
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
    .catch((e) => { console.error('FATAL:', e.stack || e.message); process.exitCode = 1 })
    .finally(async () => {
        await cleanup()
        if (server) await stopServerSafe(server, BASE)
        process.exit(process.exitCode || 0)
    })
