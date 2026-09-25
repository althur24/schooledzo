/**
 * E2E staging: Ganda Kompleks — mode penilaian, poin desimal, seimbangkan.
 *
 * PRASYARAT (urutan WAJIB — NEXT_PUBLIC_* ter-inline saat BUILD):
 *   1. bash loadtest/push-staging-migration.sh   (3 migrasi GK harus ter-apply)
 *   2. set -a; source .env.staging; set +a; npm run build
 *   3. set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   4. ENV_FILE=.env.staging node scripts/e2e-gk-staging.cjs
 *
 * Mengexersais jalur HTTP NYATA (server next start env staging):
 *  [A] Guru buat kuis + soal GK campuran (mode PROPORTIONAL/ALL_OR_NOTHING,
 *      kunci format koma "A, C" — reproduksi bug asli) + PG + isian,
 *      poin desimal 3.33 (hasil "Seimbangkan" 100/30).
 *  [B] Siswa kerjakan: GET soal (kunci ter-strip) → POST submit.
 *      Verifikasi skor desimal per soal + total.
 *  [C] Guru koreksi: PUT nilai isian desimal → total ter-update.
 *  [D] Guru buat ulangan + GK; siswa start+autosave+submit; monitor RPC
 *      (skor desimal) + analytics quiz/exam (tidak 500, distribusi benar).
 *  [Q] GK batas pilihan: gk_max_picks = jumlah kunci ter-inject di 4 rute
 *      siswa (quiz /questions + embed, exam, official exam) + penalti pick
 *      salah PROPORTIONAL: 2 kunci + pilih 3 (2 benar) → 50%; select-all →
 *      (M-N)/M; bypass over-pick via API tetap kena penalti.
 *
 * Cleanup penuh di akhir (semua baris ber-prefix ltgk2_).
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'LtGk1234!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2' // Matematika STG
const CLASS = '7da71f34-b051-4aa9-ab4d-967ae741f61c'   // Kelas STG 8A

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

/**
 * Publish ujian/kuis dengan retry: HOTS analysis berjalan async dan bisa
 * men-set ulang status soal ke 'admin_review' setelah kita meng-approve —
 * publish saat itu hanya menghasilkan pending_publish. Poll + approve ulang
 * sampai is_active benar-benar true (maks ~15 dtk).
 */
async function ensurePublished(kind, id, questionsTable, fk, cookie) {
    for (let attempt = 0; attempt < 6; attempt++) {
        await supabase.from(questionsTable).update({ status: 'approved' }).eq(fk, id)
        const { status } = await api('PUT', `/api/${kind}/${id}`, { is_active: true }, cookie)
        const { data: row } = await supabase.from(kind === 'quizzes' ? 'quizzes' : 'exams')
            .select('is_active, pending_publish').eq('id', id).single()
        if (row?.is_active === true) return { ok: true, status }
        await new Promise(r => setTimeout(r, 2500))
    }
    return { ok: false }
}

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
    const cookie = res.headers.get('set-cookie')?.split(';')[0]
    return cookie
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

async function main() {
    console.log('═══ SEED ══')
    // Idempoten: bersihkan sisa run sebelumnya (jika ada)
    {
        const { data: olds } = await supabase.from('users').select('id').like('username', 'ltgk2_%')
        for (const x of (olds || [])) {
            const { data: t } = await supabase.from('teachers').select('id').eq('user_id', x.id).maybeSingle()
            if (t) {
                const { data: tas } = await supabase.from('teaching_assignments').select('id').eq('teacher_id', t.id)
                for (const a of (tas || [])) await supabase.from('teaching_assignments').delete().eq('id', a.id)
                await supabase.from('teachers').delete().eq('id', t.id)
            }
            const { data: s } = await supabase.from('students').select('id').eq('user_id', x.id).maybeSingle()
            if (s) await supabase.from('students').delete().eq('id', s.id)
            await supabase.from('sessions').delete().eq('user_id', x.id)
            await supabase.from('notifications').delete().eq('user_id', x.id)
            await supabase.from('users').delete().eq('id', x.id)
        }
    }
    const passHash = await bcrypt.hash(PASS, 10)
    const { data: guruU } = await supabase.from('users')
        .insert({ username: 'ltgk2_guru', full_name: 'LTGK2 Guru', password_hash: passHash, role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    const { data: adminU } = await supabase.from('users')
        .insert({ username: 'ltgk2_admin', full_name: 'LTGK2 Admin', password_hash: passHash, role: 'ADMIN', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    const { data: siswaU } = await supabase.from('users')
        .insert({ username: 'ltgk2_siswa', full_name: 'LTGK2 Siswa', password_hash: passHash, role: 'SISWA', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    // Siswa kedua — ujian nyata multi-siswa (randomized + force-submit pelanggaran)
    const { data: siswa2U } = await supabase.from('users')
        .insert({ username: 'ltgk2_siswa2', full_name: 'LTGK2 Siswa Dua', password_hash: passHash, role: 'SISWA', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    const { data: teacher } = await supabase.from('teachers')
        .insert({ user_id: guruU.id, school_id: SCHOOL })
        .select('id').single()
    const { data: student } = await supabase.from('students')
        .insert({ user_id: siswaU.id, school_id: SCHOOL, class_id: CLASS, nis: 'ltgk20001' })
        .select('id').single()
    const { data: student2 } = await supabase.from('students')
        .insert({ user_id: siswa2U.id, school_id: SCHOOL, class_id: CLASS, nis: 'ltgk20002' })
        .select('id').single()
    // Monitor & roster membaca student_enrollments — siswa E2E perlu enrollment aktif
    const { data: enroll } = await supabase.from('student_enrollments')
        .insert({ student_id: student.id, academic_year_id: YEAR, class_id: CLASS, status: 'ACTIVE' })
        .select('id').single()
    const { data: enroll2 } = await supabase.from('student_enrollments')
        .insert({ student_id: student2.id, academic_year_id: YEAR, class_id: CLASS, status: 'ACTIVE' })
        .select('id').single()
    const { data: ta } = await supabase.from('teaching_assignments')
        .insert({ teacher_id: teacher.id, subject_id: SUBJECT, class_id: CLASS, academic_year_id: YEAR })
        .select('id').single()
    console.log('seed ok')

    const guru = await login('ltgk2_guru')
    const siswa = await login('ltgk2_siswa')
    const siswa2 = await login('ltgk2_siswa2')
    const admin = await login('ltgk2_admin')
    check('login guru + siswa + admin (bcrypt + session)', true)

    try {
        // ═══ [A] KUIS ═══
        console.log('\n═══ [A] Guru buat kuis GK + poin desimal ══')
        const now = new Date()
        const iso = (h) => new Date(now.getTime() + h * 3600e3).toISOString()
        const { data: quiz, status: qSt } = await api('POST', '/api/quizzes', {
            title: 'ltgk2_Kuis GK E2E', teaching_assignment_id: ta.id,
            is_active: true, available_from: iso(-1), deadline: iso(48), duration_minutes: 30,
        }, guru)
        check('POST /api/quizzes 201', qSt === 201 || qSt === 200, quiz)
        const quizId = quiz.id

        // 5 soal — kombinasi lengkap. S1: kunci KOMA (bug asli), mode default (bagi).
        const questionsBody = [
            { question_text: 'S1 pilih bilangan prima (kunci koma)', question_type: 'MULTIPLE_ANSWER', options: ['2', '3', '4', '5'], correct_answer: 'A, C', points: 10, order_index: 0 },
            { question_text: 'S2 pilih bilangan ganjil (ketat)', question_type: 'MULTIPLE_ANSWER', options: ['1', '2', '3', '4'], correct_answer: '["A","C"]', points: 10, order_index: 1, gk_grading_mode: 'ALL_OR_NOTHING' },
            { question_text: 'S3 pilih vokal (kunci lowercase)', question_type: 'MULTIPLE_ANSWER', options: ['a', 'b', 'c', 'd'], correct_answer: '["a","c"]', points: 3.33, order_index: 2, gk_grading_mode: 'PROPORTIONAL' },
            { question_text: 'S4 ibu kota RI', question_type: 'MULTIPLE_CHOICE', options: ['Bandung', 'Jakarta', 'Surabaya', 'Medan'], correct_answer: 'B', points: 3.33, order_index: 3 },
            { question_text: 'S5 proses tumbuhan', question_type: 'SHORT_ANSWER', correct_answer: 'fotosintesis, Fotosintesis', points: 3.34, order_index: 4 },
        ]
        const { status: insSt, data: insData } = await api('POST', `/api/quizzes/${quizId}/questions`, questionsBody, guru)
        check('bulk insert soal campuran GK+PG+isian (bug NOT NULL tertonjol)', insSt === 200 || insSt === 201, insData)
        const qs = insData
        const qid = (i) => qs[i].id
        check('poin desimal tersimpan 3.33', qs[2].points === 3.33, qs[2].points)
        check('mode ketat tersimpan', qs[1].gk_grading_mode === 'ALL_OR_NOTHING', qs[1].gk_grading_mode)

        // Publish kuis (dibuat draft; AI review aktif di staging — poll sampai
        // HOTS selesai & soal approved, lalu publish efektif)
        const pub = await ensurePublished('quizzes', quizId, 'quiz_questions', 'quiz_id', guru)
        check('publish kuis', pub.ok, pub)

        // ═══ [B] SISWA KERJAKAN ═══
        console.log('\n═══ [B] Siswa submit — skor desimal + mode ══')
        const sQ = await api('GET', `/api/quizzes/${quizId}/questions`, null, siswa)
        check('GET soal siswa 200', sQ.status === 200, sQ)
        const sQuestions = sQ.data
        check('GET soal siswa: kunci ter-strip', Array.isArray(sQuestions) && sQuestions.every(q => q.correct_answer === undefined), Array.isArray(sQuestions) ? sQuestions[0] : sQuestions)

        const answers = [
            { question_id: qid(0), answer: '["A","C"]' },        // S1: persis kunci → 10 (bug lama: 0!)
            { question_id: qid(1), answer: '["A","C","B"]' },    // S2 ketat: ada salah → 0
            { question_id: qid(2), answer: '["A"]' },            // S3 bagi 2 kunci benar 1 → 1.67 (1.665→1.67)
            { question_id: qid(3), answer: 'B' },                // S4 PG benar → 3.33
            { question_id: qid(4), answer: 'FOTOSINTESIS' },     // S5 isian — dinilai guru
        ]
        const { status: subSt, data: sub } = await api('POST', '/api/quiz-submissions', { quiz_id: quizId, answers, submit: true }, siswa)
        check('POST submit 200', subSt === 200, sub)
        const byQ = Object.fromEntries((sub.answers || []).map(a => [a.question_id, a]))
        check('S1 kunci koma: jawaban persis sama → benar 10 (bug "benar tapi disalahkan" MATI)', byQ[qid(0)].is_correct === true && byQ[qid(0)].score === 10, byQ[qid(0)])
        check('S2 mode ketat: salah satu → 0', byQ[qid(1)].is_correct === false && byQ[qid(1)].score === 0, byQ[qid(1)])
        check('S3 mode bagi: 1 dari 2 kunci × 3.33 = 1.67 (desimal!)', byQ[qid(2)].score === 1.67, byQ[qid(2)])
        check('S4 PG: benar 3.33', byQ[qid(3)].is_correct === true && byQ[qid(3)].score === 3.33, byQ[qid(3)])
        check('S5 isian: belum dinilai guru (null)', byQ[qid(4)].score === null, byQ[qid(4)])
        // total = 10 + 0 + 1.67 + 3.33 = 15
        check('total_score = 15 (desimal dijumlah benar, tanpa string concat)', sub.total_score === 15, sub.total_score)
        check('max_score = 30 (10+10+3.33+3.33+3.34)', sub.max_score === 30, sub.max_score)

        // ═══ [C] KOREKSI GURU DESIMAL ═══
        console.log('\n═══ [C] Guru koreksi isian dengan nilai desimal ══')
        const updatedAnswers = sub.answers.map(a =>
            a.question_id === qid(4)
                ? { ...a, score: 3.34, feedback: 'Benar!' }
                : a
        )
        const newTotal = updatedAnswers.reduce((s, a) => s + (a.score || 0), 0) // 18.34
        const { status: putSt, data: putData } = await api('PUT', `/api/quiz-submissions/${sub.id}`, { answers: updatedAnswers, total_score: newTotal, is_graded: true }, guru)
        check('PUT koreksi desimal 3.34 diterima', putSt === 200, putData)
        check('total koreksi = 18.34 tersimpan', putData?.total_score === 18.34, putData?.total_score)

        // hasil siswa — isian kini dinilai
        const { data: hasil } = await api('GET', `/api/quiz-submissions?quiz_id=${quizId}&student_id=${student.id}`, null, siswa)
        check('GET hasil siswa 200 & skor benar', Array.isArray(hasil) && hasil[0]?.total_score === 18.34, hasil?.[0]?.total_score)

        // ═══ [D] ULANGAN + MONITOR RPC + ANALYTICS ═══
        console.log('\n═══ [D] Ulangan GK → monitor RPC + analytics ══')
        const { data: exam } = await api('POST', '/api/exams', {
            title: 'ltgk2_Ulangan GK E2E', teaching_assignment_id: ta.id,
            start_time: iso(0), duration_minutes: 60, is_randomized: false,
            show_results_immediately: true, is_active: true,
        }, guru)
        const examId = exam.id
        const examQs = [
            { question_text: 'E1 pilih prima', question_type: 'MULTIPLE_ANSWER', options: ['2', '3', '4', '5'], correct_answer: '["A","C"]', points: 3.33, order_index: 0 },
            { question_text: 'E2 ibu kota', question_type: 'MULTIPLE_CHOICE', options: ['Bandung', 'Jakarta'], correct_answer: 'B', points: 3.33, order_index: 1 },
        ]
        const { status: eInsSt, data: eIns } = await api('POST', `/api/exams/${examId}/questions`, { questions: examQs }, guru)
        check('exam bulk insert soal poin desimal', eInsSt === 200 || eInsSt === 201, eIns)

        // Publish ulangan (dibuat draft — poll sampai HOTS selesai, paritas kuis)
        const ePub = await ensurePublished('exams', examId, 'exam_questions', 'exam_id', guru)
        check('publish ulangan', ePub.ok, ePub)

        // siswa start (POST exam-submissions) → autosave → submit
        // (semua via PUT /api/exam-submissions bulk — pola useExamRunner.syncToServer)
        const { status: startSt, data: startData } = await api('POST', '/api/exam-submissions', { exam_id: examId }, siswa)
        check('siswa start ulangan', startSt === 200 || startSt === 201, startData)
        const subId = startData.submission?.id || startData.id

        const { status: saveSt } = await api('PUT', '/api/exam-submissions', {
            submission_id: subId,
            answers: [
                { question_id: eIns[0].id, answer: '["A","C"]' }, // benar penuh 3.33
                { question_id: eIns[1].id, answer: 'A' },          // salah 0
            ],
        }, siswa)
        check('autosave jawaban GK', saveSt === 200, saveSt)
        const { status: finSt, data: fin } = await api('PUT', '/api/exam-submissions', { submission_id: subId, submit: true }, siswa)
        check('submit final', finSt === 200, fin)

        const { data: subRow } = await supabase.from('exam_submissions').select('total_score, max_score').eq('id', subId).single()
        check('exam total_score = 3.33 (float8 number)', subRow.total_score === 3.33, subRow)
        check('exam max_score = 6.66', subRow.max_score === 6.66, subRow)

        // monitor (RPC points_sum)
        const { status: monSt, data: mon } = await api('GET', `/api/exam-submissions/monitor?exam_id=${examId}`, null, guru)
        check('monitor RPC 200 (tanpa 500)', monSt === 200, mon)
        const monSub = (mon?.students || []).find(s => s.submission_id === subId)
        check('monitor skor siswa terbaca (total_score 3.33)', monSub && monSub.total_score === 3.33, monSub)

        // analytics quiz & exam
        const { status: anSt, data: an } = await api('GET', `/api/analytics/quiz/${quizId}`, null, guru)
        check('analytics quiz 200', anSt === 200, an)
        const gkQ = (an?.questionAnalysis || []).find(q => q.questionType === 'MULTIPLE_ANSWER')
        check('analytics quiz: distribusi GK ter-parse (kunci koma)', !!gkQ?.optionDistribution, gkQ)
        const { status: aneSt, data: ane } = await api('GET', `/api/analytics/exam/${examId}`, null, guru)
        check('analytics exam 200', aneSt === 200, aneSt)

        // ═══ [M] SEIMBANGKAN END-TO-END (balance → PUT per soal → total = 100 PERSIS) ═══
        console.log('\n═══ [M] Seimbangkan: bagi 100 ke 3 soal → 33.33+33.33+33.34, total PERSIS ═══')
        {
            // Simulasi persis handler BalancePointsControl: largest-remainder cents
            // lalu PUT per soal (kuis draft baru agar tidak terkunci is_active)
            const { data: quizM } = await api('POST', '/api/quizzes', {
                title: 'ltgk2_Kuis Balance', teaching_assignment_id: ta.id,
                available_from: iso(-1), deadline: iso(48), duration_minutes: 30,
            }, guru)
            const soalM = [
                { question_text: 'M1 GK', question_type: 'MULTIPLE_ANSWER', options: ['a', 'b', 'c', 'd'], correct_answer: '["A","C"]', points: 10, order_index: 0, gk_grading_mode: 'PROPORTIONAL' },
                { question_text: 'M2 PG', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b', 'c', 'd'], correct_answer: 'A', points: 10, order_index: 1 },
                { question_text: 'M3 isian', question_type: 'SHORT_ANSWER', correct_answer: 'x, X', points: 10, order_index: 2 },
            ]
            const { status: insMSt, data: insM } = await api('POST', `/api/quizzes/${quizM.id}/questions`, soalM, guru)
            check('M1: kuis balance 3 soal campuran dibuat', insMSt === 200 || insMSt === 201, insM)

            // Algoritma Seimbangkan (largest-remainder 2 desimal) — persis BalancePointsControl
            const count = insM.length
            const cents = Math.round(100 * 100)
            const base = Math.floor(cents / count)
            const rem = cents - base * count
            const pointsPerQ = Array.from({ length: count }, (_, i) => (i < rem ? base + 1 : base) / 100)

            // PUT per soal — persis handler halaman guru
            const putResults = await Promise.all(insM.map((q, i) =>
                api('PUT', `/api/quizzes/${quizM.id}/questions`, { question_id: q.id, points: pointsPerQ[i] }, guru)))
            check('M2: PUT poin seimbang 3 soal — semua 200', putResults.every(r => r.status === 200), putResults.map(r => r.status))

            // Verifikasi DB: poin tersimpan & total PERSIS 100
            const { data: afterM } = await supabase.from('quiz_questions')
                .select('points').eq('quiz_id', quizM.id).order('order_index')
            const pts = (afterM || []).map(q => q.points)
            const sum = Math.round(pts.reduce((a, b) => a + b, 0) * 100) / 100
            check('M3: poin per soal = {33.33, 33.33, 33.34} (100/3 largest-remainder — SET, urutan ikut order_index DB)',
                pts.length === 3 && [...pts].sort((a, b) => a - b).join(',') === '33.33,33.33,33.34', pts)
            check('M4: total PERSIS 100 (bukan 99.99/100.01)', sum === 100, sum)

            // cleanup kuis balance
            await supabase.from('quiz_questions').delete().eq('quiz_id', quizM.id)
            await supabase.from('quizzes').delete().eq('id', quizM.id)
        }

        // ═══ [N] ANALYTICS VALUES (bukan sekadar 200) — data desimal quiz [B] ═══
        console.log('\n═══ [N] Analytics: verifikasi NILAI (avg/passRate/bins/questionAnalysis) ═══')
        {
            // Quiz [B]: siswa = 18.34/30 → pct 61.1333…; KKM resolveKkm (subjects.kkm default?)
            const pctRaw = (18.34 / 30) * 100 // 61.1333...
            const co = an?.classOverview || {}
            check('N1: avgScore round-2 (61.13, bukan 61.13333333)', co.avgScore === Math.round(pctRaw * 100) / 100, co.avgScore)
            check('N2: highestScore = lowestScore = avgScore (1 siswa)', co.highestScore === co.avgScore && co.lowestScore === co.avgScore, co)
            check('N3: maxScore round-2 = 30', co.maxScore === 30, co.maxScore)
            check('N4: highestRawScore round-2 = 18.34', co.highestRawScore === 18.34, co.highestRawScore)
            // passRate: kkm tergantung subjects.kkm (Matematika STG kkm 75 → 61.13 < 75 → 0%)
            // jangan asumsi kkm — cukup pastikan number 0..100 round-2
            check('N5: passRate number 0..100', typeof co.passRate === 'number' && co.passRate >= 0 && co.passRate <= 100, co.passRate)
            // bins: 61.13 masuk bin 60-70, jumlah tak bocor
            const dist = an?.scoreDistribution || []
            const sumDist = dist.reduce((s2, d) => s2 + d.count, 0)
            const bin60 = dist.find(d => d.range === '60-70')
            check('N6: bins — 61.13% masuk bin 60-70, total count = 1', sumDist === 1 && bin60?.count === 1, dist)
            // questionAnalysis: GK S3 (kunci ["a","c"], jawaban ["A"] → 1.67/3.33 = 50%)
            const s3q = (an?.questionAnalysis || []).find(q => q.maxPoints === 3.33 && q.questionType === 'MULTIPLE_ANSWER')
            check('N7: GK questionAnalysis avgScore = 1.67 (parsial round-2)', s3q?.avgScore === 1.67, s3q?.avgScore)
            check('N8: GK correctRate = 0 (parsial ≠ exact match — semantik is_correct)', s3q?.correctRate === 0, s3q?.correctRate)
            // N14: partialRate = % siswa dapat kredit APA PUN (skor>0) — GK parsial 1.67>0 → 100%
            check('N14: GK partialRate = 100 (dapat kredit parsial — beda dari correctRate 0)', s3q?.partialRate === 100, s3q?.partialRate)
            // PG S4: benar penuh → partialRate = correctRate = 100
            const s4q = (an?.questionAnalysis || []).find(q => q.questionType === 'MULTIPLE_CHOICE' && q.maxPoints === 3.33)
            check('N15: PG partialRate = correctRate = 100 (identik utk non-GK)', s4q?.partialRate === s4q?.correctRate, s4q)
            // studentRanking
            const rank = (an?.studentRanking || [])[0]
            check('N9: studentRanking[0] percentage = 61.13 round-2, score 18.34', rank?.percentage === 61.13 && rank?.score === 18.34, rank)
            // timeAnalysis skor round-2
            const ta0 = (an?.timeAnalysis || [])[0]
            check('N10: timeAnalysis score = 61.13 round-2', ta0?.score === 61.13, ta0?.score)

            // Exam analytics [D]: total 3.33/6.66 = 50%
            const pctExam = (3.33 / 6.66) * 100 // 49.9999...→ round 50
            const coE = ane?.classOverview || {}
            check('N11: exam analytics avgScore = 50 (3.33/6.66 round-2, bukan 49.99999)', coE.avgScore === 50, coE.avgScore)
            check('N12: exam maxScore = 6.66 round-2', coE.maxScore === 6.66, coE.maxScore)
            const rankE = (ane?.studentRanking || [])[0]
            check('N13: exam ranking score = 3.33, percentage = 50', rankE?.score === 3.33 && rankE?.percentage === 50, rankE)
        }

        // ═══ REGRADE ═══
        console.log('\n═══ [F] Verifikasi data di endpoint lain ═══')
        const { status: hasilSiswaSt } = await api('GET', `/api/quiz-submissions?quiz_id=${quizId}&student_id=${student.id}`, null, siswa)
        check('GET hasil siswa setelah koreksi (ulang) 200', hasilSiswaSt === 200, hasilSiswaSt)

        // ═══ [G] NILAI TUGAS DESIMAL (putaran nilai-desimal penuh) ═══
        console.log('\n═══ [G] Nilai tugas desimal 87.5 — DB, API guru, dashboard wali ═══')
        // Tugas OFFLINE milik TA guru E2E (nilai langsung tanpa submission siswa)
        const { data: tugas } = await supabase.from('assignments')
            .insert({ title: 'ltgk2_Tugas Offline', type: 'TUGAS', submission_mode: 'OFFLINE', teaching_assignment_id: ta.id })
            .select('id').single()
        const { status: gSt, data: gData } = await api('POST', '/api/grades', {
            assignment_id: tugas.id, student_id: student.id, score: 87.5,
        }, guru)
        check('POST /api/grades nilai 87.5 diterima', gSt === 200, gData)
        // nilai mentah di DB (bukan 87/88)
        const { data: gradeRow } = await supabase.from('grades')
            .select('score').eq('submission_id', gData?.submission_id || gData?.id || '').maybeSingle()
        // fallback: cari via submission assignment
        let dbScore = gradeRow?.score
        if (dbScore === undefined) {
            const { data: subG } = await supabase.from('student_submissions')
                .select('grade:grades(score)').eq('assignment_id', tugas.id).eq('student_id', student.id).maybeSingle()
            dbScore = Array.isArray(subG?.grade) ? subG.grade[0]?.score : subG?.grade?.score
        }
        check('DB grades.score = 87.5 (float8, tanpa pembulatan)', dbScore === 87.5, dbScore)
        // nilai muncul utuh di sumber data API guru (guru/siswa)
        const { status: gsSt, data: gsData } = await api('GET', `/api/guru/siswa?class_id=${CLASS}&enrollment_year_id=${YEAR}`, null, guru)
        check('GET /api/guru/siswa 200', gsSt === 200, gsSt)
        const gsStudent = (gsData?.students || []).find(s => s.id === student.id)
        const gsGrade = gsStudent ? (gsData?.student_grades || []).find(sg => sg.student_id === student.id) : null
        const tugasScores = gsGrade?.subjects?.[SUBJECT]?.tugas_scores || []
        check('API guru/siswa: nilai tugas 87.5 utuh (round-2, bukan Math.round)', tugasScores.includes(87.5), tugasScores)
        // nilai desimal ditolak di luar range
        const { status: badSt } = await api('POST', '/api/grades', {
            assignment_id: tugas.id, student_id: student.id, score: 101.5,
        }, guru)
        check('POST /api/grades 101.5 ditolak 400', badSt === 400, badSt)
        // KKM desimal ditolak (kontrak integer) — route butuh ADMIN
        const { status: kkmBadSt } = await api('PUT', '/api/subject-kkm', {
            subject_id: SUBJECT, school_level: 'SMP', grade_level: 8, kkm: 75.5,
        }, admin)
        check('PUT /api/subject-kkm kkm 75.5 ditolak 400 (kontrak integer)', kkmBadSt === 400, kkmBadSt)
        // ═══ [I] REGRESI F1: remedial kuis GK — gk_grading_mode + passage ikut tersalin ═══
        console.log('\n═══ [I] Remedial GK — mode + passage tersalin utuh (regresi F1) ═══')
        {
            // Buat kuis remedial VIA API dengan duplicate_questions (jalur POST /api/quizzes)
            const { data: remedial } = await api('POST', '/api/quizzes', {
                title: 'ltgk2_Rem remedial GK', teaching_assignment_id: ta.id,
                is_remedial: true, remedial_for_id: quizId, duplicate_questions: true,
                allowed_student_ids: [student.id],
                available_from: iso(0), deadline: iso(48), duration_minutes: 30,
            }, guru)
            check('POST remedial kuis + duplicate_questions 201', !!remedial?.id, remedial)
            const { data: rqs } = await supabase.from('quiz_questions')
                .select('id, question_type, correct_answer, gk_grading_mode, points, passage_text, content_format, image_url')
                .eq('quiz_id', remedial.id).order('order_index')
            const srcQs = qs // soal kuis asli [A]
            const gk2 = rqs?.find(q => q.question_type === 'MULTIPLE_ANSWER' && q.gk_grading_mode === 'ALL_OR_NOTHING')
            check('I1: soal GK mode ketat TERSALIN ke remedial (bukan default PROPORTIONAL)', !!gk2, rqs?.map(q => q.gk_grading_mode))
            const srcStrict = srcQs.find(q => q.gk_grading_mode === 'ALL_OR_NOTHING')
            check('I2: kunci + poin soal ketat identik dgn asli', !!srcStrict && gk2 && gk2.correct_answer === srcStrict.correct_answer && gk2.points === srcStrict.points,
                { asli: srcStrict?.correct_answer, remedial: gk2?.correct_answer })
            // I3: nilai remedial GK ketat konsisten dgn asli (siswa 3-pick vs kunci 2 → 0 di kedua)
            if (gk2) {
                await supabase.from('quiz_questions').update({ status: 'approved' }).eq('quiz_id', remedial.id)
                const pubI = await ensurePublished('quizzes', remedial.id, 'quiz_questions', 'quiz_id', guru)
                check('I3a: remedial ter-publish', pubI.ok, pubI)
                // Jawab SEMUA soal objektif: GK → 3-pick (["A","C","B"]), PG → "B",
                // terhadap question_id EKSPLISIT per soal remedial.
                const ansI = rqs
                    .filter(q => ['MULTIPLE_ANSWER', 'MULTIPLE_CHOICE', 'TRUE_FALSE'].includes(q.question_type))
                    .map(q => ({
                        question_id: q.id,
                        // GK ketat: 3-pick vs kunci 2 → HARUS 0; GK lain: pakai kuncinya biar
                        // tidak menimbulkan asersi tambahan — hanya I3c yang diuji.
                        answer: q.gk_grading_mode === 'ALL_OR_NOTHING'
                            ? '["A","C","B"]'
                            : (q.question_type === 'MULTIPLE_ANSWER'
                                ? q.correct_answer // jawab persis kunci (format koma ditangani parser)
                                : 'B'),
                    }))
                const { status: subISt, data: subI } = await api('POST', '/api/quiz-submissions', { quiz_id: remedial.id, answers: ansI, submit: true }, siswa)
                check('I3b: submit remedial', subISt === 200, subI)
                const gkAns = (subI?.answers || []).find(a => a.question_id === gk2.id)
                check('I3c: GK ketat remedial → salah satu = 0 (mode ikut, bukan proporsional)', gkAns?.score === 0 && gkAns?.is_correct === false, gkAns)
            }
            // cleanup remedial
            await supabase.from('quiz_submissions').delete().eq('quiz_id', remedial.id)
            await supabase.from('quiz_questions').delete().eq('quiz_id', remedial.id)
            await supabase.from('quizzes').delete().eq('id', remedial.id)
        }

        // ═══ [J] REGRESI F2: merge remedial GET round-2 (bukan 1 desimal) ═══
        console.log('\n═══ [J] Merge remedial GET — round-2 (regresi F2) ═══')
        {
            // Ambil GET list kuis sumber sebagai guru (merge remedial aktif) — siswa kini punya
            // remedial ltgk2 selesai; pastikan total merged presisi round-2, bukan *10)/10.
            // Skor asli S1=10 S2=0 S3=1.67 S4=3.33 (total 15) + koreksi isian 3.34 → 18.34;
            // remedial GK ketat di [I] 0 + PG benar → total kecil. Cukup assert angka round-2 muncul.
            const { status: jSt, data: jData } = await api('GET', `/api/quiz-submissions?quiz_id=${quizId}`, null, guru)
            const rows = Array.isArray(jData) ? jData : []
            const rowSiswa = rows.find(r => r.student?.id === student.id || r.merged_from_remedial)
            check('J1: GET merge remedial 200 + baris siswa ada', jSt === 200 && !!rowSiswa, { jSt, n: rows.length })
            if (rowSiswa) {
                const total = rowSiswa.total_score
                // round-2 = maksimal 2 desimal; round-1 (bug lama) menghasilkan tepat 1 desimal utk nilai sela
                const twoDecimals = Number.isFinite(total) && Math.round(total * 100) === Math.round(total * 100) / 1
                const hasFullPrecision = Math.round(total * 100) / 100 === total
                check('J2: total merged round-2 presisi (bukan dibulatkan 1 desimal)', hasFullPrecision, total)
            }
        }

        // ═══ [K1] KUIS OFFLINE FULL FLOW (audit round-3: jalur offline belum teruji E2E) ═══
        console.log('\n═══ [K1] Kuis offline: create → blok siswa → nilai manual → siswa lihat → rekap ═══')
        {
            // Create kuis OFFLINE — auto-active sesuai route (is_active: true saat OFFLINE)
            const { data: offQuiz } = await api('POST', '/api/quizzes', {
                title: 'ltgk2_Kuis Offline Flow', teaching_assignment_id: ta.id,
                submission_mode: 'OFFLINE', duration_minutes: 30,
            }, guru)
            check('K1a: create kuis OFFLINE auto-active', !!offQuiz?.id && offQuiz.is_active === true, { id: offQuiz?.id, active: offQuiz?.is_active })

            // Siswa attempt → ditolak 400 (kuis offline dinilai guru)
            const { status: attemptSt } = await api('POST', '/api/quiz-submissions', { quiz_id: offQuiz.id, answers: [], submit: true }, siswa)
            check('K1b: siswa attempt kuis offline DITOLAK 400', attemptSt === 400, attemptSt)

            // Guru input nilai manual desimal
            const { status: manualSt } = await api('POST', '/api/quiz-submissions/manual', {
                quiz_id: offQuiz.id, student_id: student.id, score: 87.5,
            }, guru)
            check('K1c: guru input nilai offline 87.5 (desimal)', manualSt === 200, manualSt)

            // Siswa GET hasil → nilai muncul utuh
            const { status: hasilSt, data: hasilData } = await api('GET', `/api/quiz-submissions?quiz_id=${offQuiz.id}&student_id=${student.id}`, null, siswa)
            const offRow = Array.isArray(hasilData) ? hasilData[0] : null
            check('K1d: siswa lihat nilai offline 87.5/100 utuh', hasilSt === 200 && offRow?.total_score === 87.5 && offRow?.max_score === 100, { st: hasilSt, total: offRow?.total_score, max: offRow?.max_score })

            // Rekap guru/siswa → 87.5 masuk kuis_scores (round-2, bukan Math.round)
            const { data: gsOff } = await api('GET', `/api/guru/siswa?class_id=${CLASS}&enrollment_year_id=${YEAR}`, null, guru)
            const gsGradeOff = (gsOff?.student_grades || []).find(sg => sg.student_id === student.id)
            const kuisScores = gsGradeOff?.subjects?.[SUBJECT]?.kuis_scores || []
            check('K1e: rekap guru/siswa — kuis offline 87.5 masuk kuis_scores utuh', kuisScores.includes(87.5), kuisScores)

            // cleanup kuis offline
            await supabase.from('quiz_submissions').delete().eq('quiz_id', offQuiz.id)
            await supabase.from('grade_history').delete().eq('ref_id', offQuiz.id)
            await supabase.from('notifications').delete().eq('user_id', siswaU.id)
            await supabase.from('quizzes').delete().eq('id', offQuiz.id)
        }

        // ═══ [K2] UTS/UAS (official exam) GK DESIMAL — jalur ini BELUM pernah teruji E2E ═══
        console.log('\n═══ [K2] UTS/UAS: create GK desimal → publish → siswa → skor → koreksi guru ═══')
        {
            // Create official exam (butuh target_class_ids + academic_year_id + subject)
            const { data: oe } = await api('POST', '/api/official-exams', {
                exam_type: 'UTS', title: 'ltgk2_UTS GK Desimal',
                subject_id: SUBJECT, target_class_ids: [CLASS],
                academic_year_id: YEAR, start_time: iso(0), duration_minutes: 60,
                is_randomized: false, show_results_immediately: true,
            }, guru)
            check('K2a: create UTS 201/200', !!oe?.id, oe)

            // Soal GK: 1 ketat + 1 PG — poin desimal
            const oeQs = [
                { question_text: 'K2 GK ketat', question_type: 'MULTIPLE_ANSWER', options: ['a', 'b', 'c', 'd'], correct_answer: '["A","C"]', points: 3.33, order_index: 0, gk_grading_mode: 'ALL_OR_NOTHING' },
                { question_text: 'K2 PG', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'A', points: 3.33, order_index: 1 },
            ]
            const { status: oeInsSt, data: oeIns } = await api('POST', `/api/official-exams/${oe.id}/questions`, { questions: oeQs }, guru)
            check('K2b: insert soal UTS GK desimal', oeInsSt === 200 || oeInsSt === 201, oeIns)

            // Publish (butuh approved)
            await supabase.from('official_exam_questions').update({ status: 'approved' }).eq('exam_id', oe.id)
            const { status: oePubSt } = await api('PUT', `/api/official-exams/${oe.id}`, { is_active: true }, guru)
            check('K2c: publish UTS', oePubSt === 200, oePubSt)

            // Siswa start → autosave → submit
            const { status: oeStartSt, data: oeStart } = await api('POST', '/api/official-exam-submissions', { exam_id: oe.id }, siswa)
            check('K2d: siswa start UTS', oeStartSt === 200 || oeStartSt === 201, oeStart)
            const oeSubId = oeStart?.submission?.id || oeStart?.id

            // Autosave: GK ketat jawab 3-pick (harus 0) + PG benar (3.33)
            const { status: oeSaveSt } = await api('PUT', '/api/official-exam-submissions', {
                submission_id: oeSubId,
                answers: [
                    { question_id: oeIns[0].id, answer: '["A","C","B"]' }, // ketat: ada salah → 0
                    { question_id: oeIns[1].id, answer: 'A' },             // PG benar → 3.33
                ],
            }, siswa)
            check('K2e: autosave UTS', oeSaveSt === 200, oeSaveSt)

            // Submit final
            const { status: oeFinSt } = await api('PUT', '/api/official-exam-submissions', { submission_id: oeSubId, submit: true }, siswa)
            check('K2f: submit UTS final', oeFinSt === 200, oeFinSt)

            // Verifikasi skor di DB (float8 number)
            const { data: oeRow } = await supabase.from('official_exam_submissions')
                .select('total_score, max_score').eq('id', oeSubId).single()
            check('K2g: UTS total = 3.33 (PG benar; GK ketat 0)', oeRow?.total_score === 3.33, oeRow)
            check('K2h: UTS max = 6.66', oeRow?.max_score === 6.66, oeRow)

            // Verifikasi jawaban GK di official_exam_answers
            const { data: oeAns } = await supabase.from('official_exam_answers')
                .select('id, question_id, answer, is_correct, points_earned').eq('submission_id', oeSubId)
            const gkAns = (oeAns || []).find(a => a.question_id === oeIns[0].id)
            check('K2i: UTS GK ketat → is_correct false, points 0', gkAns?.is_correct === false && gkAns?.points_earned === 0, gkAns)
            const pgAns = (oeAns || []).find(a => a.question_id === oeIns[1].id)
            check('K2j: UTS PG → benar 3.33', pgAns?.is_correct === true && pgAns?.points_earned === 3.33, pgAns)

            // Koreksi guru desimal (PUT grades — jalur official: { grades: [{answer_id, points_earned}] })
            const { status: oeGradeSt } = await api('PUT', `/api/official-exam-submissions/${oeSubId}`, {
                grades: [{ answer_id: gkAns?.id, points_earned: 1.67 }], is_graded: true,
            }, guru)
            const oeAfter = (await supabase.from('official_exam_submissions').select('total_score').eq('id', oeSubId).single()).data
            check('K2k: koreksi guru UTS desimal 1.67 → total 5 (1.67+3.33)', oeGradeSt === 200 && oeAfter?.total_score === 5, { st: oeGradeSt, total: oeAfter?.total_score })

            // Monitor official (RPC) — skor desimal terbaca
            const { status: oeMonSt } = await api('GET', `/api/official-exam-submissions/monitor?exam_id=${oe.id}`, null, guru)
            check('K2l: monitor UTS RPC 200 (tanpa 500)', oeMonSt === 200, oeMonSt)

            // Analytics official exam
            const { status: oeAnSt } = await api('GET', `/api/analytics/official-exam/${oe.id}`, null, guru)
            check('K2m: analytics UTS 200', oeAnSt === 200, oeAnSt)

            // cleanup UTS
            await supabase.from('official_exam_answers').delete().eq('submission_id', oeSubId)
            await supabase.from('official_exam_submissions').delete().eq('id', oeSubId)
            await supabase.from('official_exam_questions').delete().eq('exam_id', oe.id)
            await supabase.from('official_exams').delete().eq('id', oe.id)
        }

        // ═══ [K3] TUGAS REVISI — snapshot nilai desimal ke submission_revisions ═══
        console.log('\n═══ [K3] Tugas revisi: nilai 87.5 → revisi → snapshot desimal utuh ═══')
        {
            // Tugas ONLINE (allow_revision default true)
            const { data: tugasR } = await supabase.from('assignments')
                .insert({ title: 'ltgk2_Tugas Revisi', type: 'TUGAS', submission_mode: 'ONLINE', teaching_assignment_id: ta.id })
                .select('id').single()

            // Siswa submit tugas
            const { status: sub1St } = await api('POST', '/api/submissions', {
                assignment_id: tugasR.id, answers: 'jawaban pertama',
            }, siswa)
            check('K3a: siswa submit tugas', sub1St === 200 || sub1St === 201, sub1St)

            // Guru nilai 87.5 (desimal) — tugas ONLINE wajib submission_id
            // (route menolak assignment_id untuk online: "dinilai murni dari submission")
            const { data: tugasSub } = await supabase.from('student_submissions')
                .select('id').eq('assignment_id', tugasR.id).eq('student_id', student.id).single()
            const { status: gradeSt } = await api('POST', '/api/grades', {
                submission_id: tugasSub?.id, score: 87.5,
            }, guru)
            check('K3b: guru nilai tugas online 87.5 (via submission_id)', gradeSt === 200, gradeSt)

            // Siswa revisi → snapshot ke submission_revisions + grade terhapus
            const { status: revSt } = await api('POST', '/api/submissions', {
                assignment_id: tugasR.id, answers: 'jawaban revisi',
            }, siswa)
            check('K3c: siswa revisi tugas (diterima)', revSt === 200 || revSt === 201, revSt)

            // Verifikasi snapshot grade_score = 87.5 (float8 utuh)
            const { data: revSnap } = await supabase.from('submission_revisions')
                .select('grade_score, grade_feedback, answers').eq('submission_id',
                    (await supabase.from('student_submissions').select('id').eq('assignment_id', tugasR.id).eq('student_id', student.id).single()).data?.id
                )
            const snap = Array.isArray(revSnap) ? revSnap[0] : revSnap
            check('K3d: snapshot submission_revisions.grade_score = 87.5 utuh (float8)', snap?.grade_score === 87.5, snap)
            check('K3e: snapshot answers lama tersimpan', snap?.answers === 'jawaban pertama', snap?.answers)

            // Grade terhapus → nilai reset (siswa bisa dinilai ulang)
            const { data: afterGrade } = await supabase.from('student_submissions')
                .select('grade:grades(score)').eq('assignment_id', tugasR.id).eq('student_id', student.id).single()
            const g = Array.isArray(afterGrade?.grade) ? afterGrade.grade[0] : afterGrade?.grade
            check('K3f: grade terhapus setelah revisi (nilai reset)', g === null || g === undefined, g)

            // cleanup tugas revisi
            await supabase.from('submission_revisions').delete().in('submission_id',
                (await supabase.from('student_submissions').select('id').eq('assignment_id', tugasR.id)).data?.map(s => s.id) || [])
            await supabase.from('student_submissions').delete().eq('assignment_id', tugasR.id)
            await supabase.from('assignments').delete().eq('id', tugasR.id)
        }

        // cleanup tugas E2E (submission+grade ikut cascade)
        await supabase.from('student_submissions').delete().eq('assignment_id', tugas.id)
        await supabase.from('assignments').delete().eq('id', tugas.id)

        // ═══ [H] AUDIT REGRESI (post-self-audit — lihat PLAN-AUDIT-STAGING.md) ═══
        console.log('\n═══ [H] Audit regresi: clamp, null esai, bins, grade_history ═══')

        // H4: clamp & rekonsiliasi server-side — payload manipulasi (score 9999;
        //     total dikirim VALID agar lolos validasi awal — total palsu 99999 memang
        //     ditolak 400 oleh guard lama, itu juga perilaku benar)
        {
            const cur = (await supabase.from('quiz_submissions').select('answers').eq('id', sub.id).single()).data
            const malicious = (cur.answers || []).map(a =>
                a.question_id === qid(0) ? { ...a, score: 9999 } : { ...a, score: a.score ?? null })
            const { status: h4st } = await api('PUT', `/api/quiz-submissions/${sub.id}`, {
                answers: malicious, total_score: 18.34, is_graded: true,
            }, guru)
            const after = (await supabase.from('quiz_submissions').select('answers, total_score').eq('id', sub.id).single()).data
            const s1 = (after.answers || []).find(a => a.question_id === qid(0))
            check('H4a: PUT koreksi score 9999 di-clamp ke poin soal (10)', h4st === 200 && s1?.score === 10, { st: h4st, s1 })
            const expected = Math.round((after.answers || []).reduce((s2, a) => s2 + (typeof a?.score === 'number' ? a.score : 0), 0) * 100) / 100
            check('H4b: total_score direkonsiliasi server-side dari jawaban ter-clamp', after.total_score === expected, { total: after.total_score, expected })
            // Guard lama tetap hidup: total palsu > max ditolak keras
            const { status: guardSt } = await api('PUT', `/api/quiz-submissions/${sub.id}`, {
                answers: malicious, total_score: 99999, is_graded: true,
            }, guru)
            check('H4c: guard lama tetap menolak total_score 99999 (400)', guardSt === 400, guardSt)
        }

        // H2: bins distribusi tak bocor — pct desimal 61.13% (18.34/30) harus masuk bin 60-70
        {
            const { data: anH2 } = await api('GET', `/api/analytics/quiz/${quizId}`, null, guru)
            const dist = anH2?.scoreDistribution || []
            const sum = dist.reduce((s, d) => s + d.count, 0)
            const bin60 = dist.find(d => d.range === '60-70')
            check('H2: bins Math.floor mencakup nilai sela (61.13% → bin 60-70, jumlah tak bocor)', sum === 1 && bin60?.count === 1, dist)
        }

        // H1: esai/isian belum dinilai (score null) TIDAK diubah jadi 0 oleh PUT koreksi
        {
            const cur = (await supabase.from('quiz_submissions').select('answers').eq('id', sub.id).single()).data
            const withNull = (cur.answers || []).map(a =>
                a.question_id === qid(4) ? { ...a, score: null, is_correct: null } : a)
            const { status: h1st } = await api('PUT', `/api/quiz-submissions/${sub.id}`, {
                answers: withNull, total_score: 15, is_graded: false,
            }, guru)
            const after = (await supabase.from('quiz_submissions').select('answers').eq('id', sub.id).single()).data
            const s5 = (after.answers || []).find(a => a.question_id === qid(4))
            check('H1: esai score null TETAP null setelah PUT koreksi (regresi clamp)', h1st === 200 && s5?.score === null && s5?.is_correct === null, s5)
        }

        // H3: grade_history diff round-2 — nilai identik disimpan 2× hanya 1 baris audit;
        //     sekaligus verifikasi 87.46 tersimpan utuh (round-2, bukan *10/10 → 87.5)
        {
            const { data: quizOffline } = await supabase.from('quizzes')
                .insert({ title: 'ltgk2_Kuis Offline Audit', teaching_assignment_id: ta.id, is_active: true, submission_mode: 'OFFLINE' })
                .select('id').single()
            const p1 = await api('POST', '/api/quiz-submissions/manual', { quiz_id: quizOffline.id, student_id: student.id, score: 87.46 }, guru)
            const p2 = await api('POST', '/api/quiz-submissions/manual', { quiz_id: quizOffline.id, student_id: student.id, score: 87.46 }, guru)
            check('H3a: nilai manual 87.46 diterima 2× (200)', p1.status === 200 && p2.status === 200, [p1.status, p2.status])
            const { data: dbSub } = await supabase.from('quiz_submissions')
                .select('total_score').eq('quiz_id', quizOffline.id).eq('student_id', student.id).single()
            check('H3b: DB total_score = 87.46 utuh (round-2, bukan 87.5)', dbSub?.total_score === 87.46, dbSub?.total_score)
            const { data: hist } = await supabase.from('grade_history')
                .select('id, new_score').eq('source', 'QUIZ').eq('ref_id', quizOffline.id).eq('student_id', student.id)
            check('H3c: grade_history hanya 1 baris (nilai sama ≠ perubahan — anti false-positive)', (hist || []).length === 1 && hist[0].new_score === 87.46, hist)
            // cleanup audit offline
            await supabase.from('quiz_submissions').delete().eq('quiz_id', quizOffline.id)
            await supabase.from('grade_history').delete().eq('ref_id', quizOffline.id).eq('student_id', student.id)
            await supabase.from('quizzes').delete().eq('id', quizOffline.id)
        }
        // ═══ [L] ULANGAN REAL-WORLD: 2 siswa + randomized + essay koreksi desimal + clamp + force-submit pelanggaran ═══
        console.log('\n═══ [L] Ulangan real-world: randomized, essay desimal, clamp, force-submit ═══')
        {
            // Soal: GK bagi 3.33 (2 kunci) + ESSAY 10 — jalur yang diubah clamp/round2
            const lQs = [
                { question_text: 'L1 GK bagi', question_type: 'MULTIPLE_ANSWER', options: ['a', 'b', 'c', 'd'], correct_answer: '["A","C"]', points: 3.33, order_index: 0 },
                { question_text: 'L2 essay', question_type: 'ESSAY', correct_answer: null, points: 10, order_index: 1 },
            ]
            // is_randomized TRUE — ujian nyata
            const { data: examL } = await api('POST', '/api/exams', {
                title: 'ltgk2_Ulangan Real', teaching_assignment_id: ta.id,
                start_time: iso(0), duration_minutes: 60, is_randomized: true,
                max_violations: 3, show_results_immediately: true,
            }, guru)
            check('L1a: create ulangan randomized', !!examL?.id, examL)
            const { status: lInsSt, data: lIns } = await api('POST', `/api/exams/${examL.id}/questions`, { questions: lQs }, guru)
            check('L1b: insert soal GK+essay', lInsSt === 200 || lInsSt === 201, lIns)
            await supabase.from('exam_questions').update({ status: 'approved' }).eq('exam_id', examL.id)
            const pubL = await ensurePublished('exams', examL.id, 'exam_questions', 'exam_id', guru)
            check('L1c: publish ulangan', pubL.ok, pubL)

            // ── Siswa 1: randomized order + essay koreksi desimal + clamp ──
            const { status: s1StartSt, data: s1Start } = await api('POST', '/api/exam-submissions', { exam_id: examL.id }, siswa)
            check('L2a: siswa1 start', s1StartSt === 200 || s1StartSt === 201, s1Start)
            const s1SubId = s1Start?.submission?.id || s1Start?.id
            // question_order tersimpan & memuat semua soal (randomized)
            const s1Order = s1Start?.submission?.question_order || s1Start?.question_order
            check('L2b: question_order randomized tersimpan (2 soal)', Array.isArray(s1Order) && s1Order.length === 2, s1Order)

            // Autosave: GK 1 dari 2 kunci (1.67) + essay dijawab
            const { status: s1SaveSt } = await api('PUT', '/api/exam-submissions', {
                submission_id: s1SubId,
                answers: [
                    { question_id: lIns[0].id, answer: '["A"]' },  // 1 dari 2 → 1.67
                    { question_id: lIns[1].id, answer: 'esai siswa1' },
                ],
            }, siswa)
            check('L2c: siswa1 autosave', s1SaveSt === 200, s1SaveSt)
            const { status: s1FinSt, data: s1Fin } = await api('PUT', '/api/exam-submissions', { submission_id: s1SubId, submit: true }, siswa)
            check('L2d: siswa1 submit', s1FinSt === 200, s1Fin)
            const { data: s1Row } = await supabase.from('exam_submissions').select('total_score, is_graded').eq('id', s1SubId).single()
            check('L2e: siswa1 total = 1.67, is_graded false (essay pending)', s1Row?.total_score === 1.67 && s1Row?.is_graded === false, s1Row)

            // Guru koreksi essay desimal 7.33 via PUT /api/exam-submissions/[id]
            // (route yang diubah: clamp 0..poin + round-2 + rekonsiliasi total)
            const { status: s1GradeSt, data: s1GradeErr } = await api('PUT', `/api/exam-submissions/${s1SubId}`, {
                answers: [{ question_id: lIns[1].id, score: 7.33, answer: 'esai siswa1', is_correct: null, feedback: 'baik' }],
                is_graded: true,
            }, guru)
            const { data: s1Graded } = await supabase.from('exam_submissions').select('total_score, is_graded').eq('id', s1SubId).single()
            check('L2f: koreksi essay desimal 7.33 → total 9 (1.67+7.33)', s1GradeSt === 200 && s1Graded?.total_score === 9 && s1Graded?.is_graded === true,
                { st: s1GradeSt, err: s1GradeErr?.error, total: s1Graded?.total_score })
            // essay points_earned tersimpan round-2
            const { data: s1EssayAns } = await supabase.from('exam_answers')
                .select('points_earned').eq('submission_id', s1SubId).eq('question_id', lIns[1].id).single()
            check('L2g: essay points_earned = 7.33 (round-2 float8)', s1EssayAns?.points_earned === 7.33, s1EssayAns)

            // Clamp: koreksi essay 9999 → di-clamp ke poin soal (10)
            const { status: clampSt } = await api('PUT', `/api/exam-submissions/${s1SubId}`, {
                answers: [{ question_id: lIns[1].id, score: 9999, answer: 'esai siswa1', is_correct: null }],
                is_graded: true,
            }, guru)
            const { data: clamped } = await supabase.from('exam_submissions').select('total_score').eq('id', s1SubId).single()
            check('L2h: koreksi 9999 di-clamp → total tetap 11.67 (1.67+10)', clampSt === 200 && clamped?.total_score === 11.67, { st: clampSt, total: clamped?.total_score })

            // ── Siswa 2: force-submit via pelanggaran (max_violations 3) + GK desimal ──
            const { status: s2StartSt, data: s2Start } = await api('POST', '/api/exam-submissions', { exam_id: examL.id }, siswa2)
            check('L3a: siswa2 start', s2StartSt === 200 || s2StartSt === 201, s2Start)
            const s2SubId = s2Start?.submission?.id || s2Start?.id

            // Autosave GK 1-dari-2 (1.67) dulu — skor tersimpan di exam_answers
            const { status: s2SaveSt } = await api('PUT', '/api/exam-submissions', {
                submission_id: s2SubId,
                answers: [{ question_id: lIns[0].id, answer: '["A"]' }],
            }, siswa2)
            check('L3b: siswa2 autosave GK', s2SaveSt === 200, s2SaveSt)

            // 3 pelanggaran → force-submit (jalur yang diubah round-2).
            // Timestamp eksplisit di masa depan di-clamp ke nowMs → gap 0 → dedup
            // menolak (anti-spam, perilaku benar). Pola deterministik: jalur legacy
            // `violation` (timestamp server) + jeda nyata > DEDUP_MS (3 dtk).
            let forceBody = null
            for (let v = 1; v <= 3; v++) {
                const { data: vRes } = await api('PUT', '/api/exam-submissions', {
                    submission_id: s2SubId,
                    violation: { type: 'TAB_SWITCH' },
                }, siswa2)
                forceBody = vRes
                if (v < 3) await new Promise(r => setTimeout(r, 3300))
            }
            check('L3c: force-submit terpicu di pelanggaran ke-3', forceBody?.force_submitted === true, forceBody)
            const { data: s2Row } = await supabase.from('exam_submissions')
                .select('total_score, is_graded, is_submitted').eq('id', s2SubId).single()
            check('L3d: siswa2 total = 1.67 round-2 (bukan debu float)', s2Row?.total_score === 1.67, s2Row)
            check('L3e: siswa2 is_submitted = true', s2Row?.is_submitted === true, s2Row)

            // Monitor dengan 2 siswa — keduanya terbaca
            const { status: monLSt, data: monL } = await api('GET', `/api/exam-submissions/monitor?exam_id=${examL.id}`, null, guru)
            const monStudents = monL?.students || []
            const s1Mon = monStudents.find(s => s.submission_id === s1SubId)
            const s2Mon = monStudents.find(s => s.submission_id === s2SubId)
            check('L4a: monitor 2 siswa — keduanya terbaca', monLSt === 200 && !!s1Mon && !!s2Mon, { st: monLSt, n: monStudents.length })
            check('L4b: monitor skor siswa1 = 11.67 (post-clamp)', s1Mon?.total_score === 11.67, s1Mon?.total_score)
            check('L4c: monitor skor siswa2 = 1.67 (force-submit)', s2Mon?.total_score === 1.67, s2Mon?.total_score)

            // GET hasil siswa (show_results_immediately: true) — skor tampil
            const { status: s1HasilSt, data: s1Hasil } = await api('GET', `/api/exam-submissions/${s1SubId}`, null, siswa)
            check('L5a: siswa1 GET hasil — skor 11.67 terlihat', s1HasilSt === 200 && s1Hasil?.total_score === 11.67, { st: s1HasilSt, total: s1Hasil?.total_score })

            // Analytics dengan 2 siswa — tidak 500
            const { status: anLSt } = await api('GET', `/api/analytics/exam/${examL.id}`, null, guru)
            check('L5b: analytics 2-siswa 200', anLSt === 200, anLSt)

            // cleanup ulangan [L]
            for (const sid of [s1SubId, s2SubId]) {
                await supabase.from('exam_answers').delete().eq('submission_id', sid)
                await supabase.from('exam_submissions').delete().eq('id', sid)
            }
            await supabase.from('exam_questions').delete().eq('exam_id', examL.id)
            await supabase.from('exams').delete().eq('id', examL.id)
        }

        // ═══ [O] RESCUE OFFLINE (WiFi putus dekat deadline → force-close → online → jawaban diselamatkan) ═══
        // Jalur K1-rescue yang diubah migrasi desimal (round2 + gk mode) —
        // skenario: server sudah menutup submission (is_submitted), siswa online
        // lagi dengan draft jawaban GK desimal di tangan.
        console.log('\n═══ [O] Rescue offline: jawaban GK desimal diselamatkan pasca force-close ═══')
        {
            // ── O1: ULANGAN (exam-submissions PUT → ANSWERS_RESCUED) ──
            const oQs = [
                { question_text: 'O1 GK bagi', question_type: 'MULTIPLE_ANSWER', options: ['a', 'b', 'c', 'd'], correct_answer: '["A","C"]', points: 3.33, order_index: 0 },
                { question_text: 'O1 PG', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'A', points: 3.33, order_index: 1 },
            ]
            const { data: examO } = await api('POST', '/api/exams', {
                title: 'ltgk2_Exam Rescue', teaching_assignment_id: ta.id,
                start_time: iso(0), duration_minutes: 60, is_randomized: false,
                show_results_immediately: true,
            }, guru)
            const { status: oInsSt, data: oIns } = await api('POST', `/api/exams/${examO.id}/questions`, { questions: oQs }, guru)
            check('O1a: exam rescue dibuat + soal GK desimal', oInsSt === 200 || oInsSt === 201, oIns)
            await supabase.from('exam_questions').update({ status: 'approved' }).eq('exam_id', examO.id)
            await ensurePublished('exams', examO.id, 'exam_questions', 'exam_id', guru)

            // Siswa mulai + submit "resmi" (jawaban awal)
            const oStart = await api('POST', '/api/exam-submissions', { exam_id: examO.id }, siswa)
            const oSubId = oStart.data?.submission?.id || oStart.data?.id
            await api('PUT', '/api/exam-submissions', {
                submission_id: oSubId,
                answers: [
                    { question_id: oIns[0].id, answer: '["A"]' },  // 1 dari 2 → 1.67
                    { question_id: oIns[1].id, answer: 'B' },      // salah → 0
                ],
            }, siswa)
            await api('PUT', '/api/exam-submissions', { submission_id: oSubId, submit: true }, siswa)
            const preRescue = (await supabase.from('exam_submissions').select('total_score').eq('id', oSubId).single()).data
            check('O1b: submit awal total = 1.67 (GK parsial)', preRescue?.total_score === 1.67, preRescue)

            // Siswa "online lagi" dengan draft BARU (jawaban lebih baik) → PUT ditolak
            // 400 ANSWERS_RESCUED tapi jawaban DISELAMATKAN + dinilai ulang
            const { status: oRescueSt, data: oRescueBody } = await api('PUT', '/api/exam-submissions', {
                submission_id: oSubId,
                answers: [
                    { question_id: oIns[0].id, answer: '["A","C"]' }, // persis kunci → 3.33 (GK mode ikut!)
                    { question_id: oIns[1].id, answer: 'A' },          // benar → 3.33
                ],
            }, siswa)
            check('O1c: PUT pasca-submit ditolak 400 ANSWERS_RESCUED', oRescueSt === 400 && oRescueBody?.code === 'ANSWERS_RESCUED', oRescueBody)
            const postRescue = (await supabase.from('exam_submissions').select('total_score').eq('id', oSubId).single()).data
            check('O1d: jawaban rescue dinilai ulang → total = 6.66 (GK desimal + gk mode ikut)', postRescue?.total_score === 6.66, postRescue)
            const oAnswers = await supabase.from('exam_answers').select('points_earned, is_correct').eq('submission_id', oSubId)
            const oGk = (oAnswers.data || []).find(a => a.points_earned === 3.33)
            check('O1e: GK rescue dinilai benar penuh (3.33, float8 round-2)', !!oGk && oGk.is_correct === true, oAnswers.data)

            // cleanup exam rescue
            await supabase.from('exam_answers').delete().eq('submission_id', oSubId)
            await supabase.from('exam_submissions').delete().eq('id', oSubId)
            await supabase.from('exam_questions').delete().eq('exam_id', examO.id)
            await supabase.from('exams').delete().eq('id', examO.id)

            // ── O2: KUIS (quiz-submissions POST → ANSWERS_RESCUED, field `score`) ──
            const oqQs = [
                { question_text: 'O2 GK', question_type: 'MULTIPLE_ANSWER', options: ['a', 'b', 'c', 'd'], correct_answer: '["A","C"]', points: 3.33, order_index: 0, gk_grading_mode: 'ALL_OR_NOTHING' },
                { question_text: 'O2 isian', question_type: 'SHORT_ANSWER', correct_answer: 'fotosintesis, Fotosintesis', points: 3.33, order_index: 1 },
            ]
            const { data: quizO } = await api('POST', '/api/quizzes', {
                title: 'ltgk2_Kuis Rescue', teaching_assignment_id: ta.id,
                available_from: iso(-1), deadline: iso(48), duration_minutes: 30,
            }, guru)
            const { status: oqInsSt, data: oqIns } = await api('POST', `/api/quizzes/${quizO.id}/questions`, oqQs, guru)
            await supabase.from('quiz_questions').update({ status: 'approved' }).eq('quiz_id', quizO.id)
            await ensurePublished('quizzes', quizO.id, 'quiz_questions', 'quiz_id', guru)

            // Submit awal
            const oqSub1 = await api('POST', '/api/quiz-submissions', {
                quiz_id: quizO.id, submit: true,
                answers: [
                    { question_id: oqIns[0].id, answer: '["A"]' },      // ketat: kurang → 0
                    { question_id: oqIns[1].id, answer: 'salah' },       // isian salah → null (manual)
                ],
            }, siswa)
            check('O2a: kuis submit awal (GK ketat 0 + isian pending)', oqSub1.status === 200, oqSub1)
            const preQ = (await supabase.from('quiz_submissions').select('total_score, answers').eq('quiz_id', quizO.id).eq('student_id', student.id).single()).data
            check('O2b: total awal = 0 (GK ketat kurang → 0)', preQ?.total_score === 0, preQ?.total_score)

            // Rescue: POST dengan jawaban baru → 400 ANSWERS_RESCUED + merge + regrade
            const oqRescue = await api('POST', '/api/quiz-submissions', {
                quiz_id: quizO.id, submit: true,
                answers: [
                    { question_id: oqIns[0].id, answer: '["A","C"]' }, // persis → 3.33
                    { question_id: oqIns[1].id, answer: 'FOTOSINTESIS' }, // isian → null (guru nilai)
                ],
            }, siswa)
            check('O2c: POST pasca-submit ditolak 400 ANSWERS_RESCUED', oqRescue.status === 400 && oqRescue.data?.code === 'ANSWERS_RESCUED', oqRescue.data)
            const postQ = (await supabase.from('quiz_submissions').select('total_score, answers').eq('quiz_id', quizO.id).eq('student_id', student.id).single()).data
            check('O2d: total rescue = 3.33 (GK ketat rescue dinilai dgn mode)', postQ?.total_score === 3.33, postQ?.total_score)
            const oqGkAns = (postQ?.answers || []).find(a => a.question_id === oqIns[0].id)
            // REGRESI field name: rescue path dulu menulis `points_earned`, analytics
            // membaca `a.score` — jawaban rescue tampil 0/stale di analitik.
            check('O2e: jawaban rescue pakai field `score` (regresi analytics) = 3.33', oqGkAns?.score === 3.33 && oqGkAns?.is_correct === true, oqGkAns)
            const oqIsianAns = (postQ?.answers || []).find(a => a.question_id === oqIns[1].id)
            check('O2f: isian rescue tetap null (nilai guru tak terinjak)', oqIsianAns?.score === null && oqIsianAns?.is_correct === null, oqIsianAns)

            // cleanup kuis rescue
            await supabase.from('quiz_submissions').delete().eq('quiz_id', quizO.id)
            await supabase.from('quiz_questions').delete().eq('quiz_id', quizO.id)
            await supabase.from('quizzes').delete().eq('id', quizO.id)
        }

        // ═══ [P] ISIAN SINGKAT DI ULANGAN — netral di autosave (bukan auto-grade salah) ═══
        // Regresi audit round-4: autosave exam/official dulu menilai SEMUA jawaban
        // termasuk isian (beda dgn kuis) → jawaban "kota  jakarta" (spasi ganda)
        // dinilai 0 + is_correct=false sebelum guru melihat.
        console.log('\n═══ [P] Isian singkat ulangan: autosave netral + koreksi guru + flag tak stale ══')
        {
            const pQs = [
                { question_text: 'P1 GK', question_type: 'MULTIPLE_ANSWER', options: ['a', 'b', 'c', 'd'], correct_answer: '["A","C"]', points: 4, order_index: 0 },
                { question_text: 'P1 isian', question_type: 'SHORT_ANSWER', correct_answer: 'kota jakarta, Kota Jakarta', points: 6, order_index: 1 },
            ]
            const { data: examP } = await api('POST', '/api/exams', {
                title: 'ltgk2_Exam Isian', teaching_assignment_id: ta.id,
                start_time: iso(0), duration_minutes: 60, is_randomized: false,
                show_results_immediately: true,
            }, guru)
            const { status: pInsSt, data: pIns } = await api('POST', `/api/exams/${examP.id}/questions`, { questions: pQs }, guru)
            check('P1a: exam isian dibuat', pInsSt === 200 || pInsSt === 201, pIns)
            await supabase.from('exam_questions').update({ status: 'approved' }).eq('exam_id', examP.id)
            await ensurePublished('exams', examP.id, 'exam_questions', 'exam_id', guru)

            // Siswa mulai + autosave isian dengan JAWABAN BENAR TAPI FORMAT BEDA (spasi ganda)
            const pStart = await api('POST', '/api/exam-submissions', { exam_id: examP.id }, siswa)
            const pSubId = pStart.data?.submission?.id || pStart.data?.id
            const { status: pSaveSt } = await api('PUT', '/api/exam-submissions', {
                submission_id: pSubId,
                answers: [
                    { question_id: pIns[0].id, answer: '["A","C"]' },        // GK penuh → 4
                    { question_id: pIns[1].id, answer: 'kota  jakarta' },    // isian benar, spasi ganda
                ],
            }, siswa)
            check('P1b: autosave diterima', pSaveSt === 200, pSaveSt)

            // Verifikasi: isian TIDAK di-auto-grade (is_correct null, points null — bukan false/0)
            const pAns = (await supabase.from('exam_answers')
                .select('is_correct, points_earned').eq('submission_id', pSubId).eq('question_id', pIns[1].id).single()).data
            check('P1c: isian NETRAL saat autosave (is_correct null, points null — bukan dinilai salah)',
                pAns?.is_correct === null && pAns?.points_earned === null, pAns)

            // Submit → total = GK 4 saja (isian menunggu guru), is_graded false
            const { status: pFinSt } = await api('PUT', '/api/exam-submissions', { submission_id: pSubId, submit: true }, siswa)
            const pRow = (await supabase.from('exam_submissions').select('total_score, is_graded').eq('id', pSubId).single()).data
            check('P1d: total = 4 (GK saja; isian pending), is_graded false', pFinSt === 200 && pRow?.total_score === 4 && pRow?.is_graded === false, pRow)

            // Guru koreksi isian 5.5 (desimal) → total 9.5 + is_correct NETRAL (bukan false stale)
            const { status: pGradeSt } = await api('PUT', `/api/exam-submissions/${pSubId}`, {
                answers: [{ question_id: pIns[1].id, score: 5.5, answer: 'kota  jakarta' }],
                is_graded: true,
            }, guru)
            const pGraded = (await supabase.from('exam_submissions').select('total_score, is_graded').eq('id', pSubId).single()).data
            const pIsianAfter = (await supabase.from('exam_answers')
                .select('is_correct, points_earned').eq('submission_id', pSubId).eq('question_id', pIns[1].id).single()).data
            check('P1e: koreksi guru isian 5.5 → total 9.5, is_graded true', pGradeSt === 200 && pGraded?.total_score === 9.5 && pGraded?.is_graded === true, { st: pGradeSt, g: pGraded })
            check('P1f: is_correct isian NETRAL pasca koreksi (bukan false stale — regresi 924 flag)',
                pIsianAfter?.is_correct === null && pIsianAfter?.points_earned === 5.5, pIsianAfter)

            // cleanup exam isian
            await supabase.from('exam_answers').delete().eq('submission_id', pSubId)
            await supabase.from('exam_submissions').delete().eq('id', pSubId)
            await supabase.from('exam_questions').delete().eq('exam_id', examP.id)
            await supabase.from('exams').delete().eq('id', examP.id)
        }

        // ═══ [Q] GK: BATAS PILIHAN = JUMLAH KUNCI + PENALTI PICK SALAH ═══
        // Keluhan guru 2026-09-25: siswa memilih lebih banyak dari jumlah kunci
        // dan 2-benar-dari-3-pick dapat poin PENUH (select-all = penuh pasti).
        // Fix dua sisi: (1) API siswa meng-inject gk_max_picks = jumlah kunci
        // saat kunci di-strip (UI memblokir pilihan ke-N+1); (2) rumus
        // PROPORTIONAL = (benar − salah)/M × poin, min 0 — bypass API tetap
        // kena penalti.
        console.log('\n═══ [Q] GK: cap gk_max_picks di 4 rute + penalti pick salah ══')
        {
            // ── Q1: kuis — cap ter-inject di GET /questions & embed /api/quizzes/[id] ──
            const { data: quizQ } = await api('POST', '/api/quizzes', {
                title: 'ltgk2_Kuis Cap GK', teaching_assignment_id: ta.id,
                available_from: iso(-1), deadline: iso(48), duration_minutes: 30,
            }, guru)
            const qQs = [
                { question_text: 'Q1 GK 2 kunci', question_type: 'MULTIPLE_ANSWER', options: ['a', 'b', 'c', 'd'], correct_answer: '["A","C"]', points: 10, order_index: 0 },
                { question_text: 'Q1 GK 2 kunci (kedua)', question_type: 'MULTIPLE_ANSWER', options: ['a', 'b', 'c', 'd'], correct_answer: '["A","C"]', points: 10, order_index: 1 },
                { question_text: 'Q1 GK 3 kunci', question_type: 'MULTIPLE_ANSWER', options: ['a', 'b', 'c', 'd'], correct_answer: '["A","B","D"]', points: 10, order_index: 2 },
            ]
            const { status: qInsSt, data: qIns } = await api('POST', `/api/quizzes/${quizQ.id}/questions`, qQs, guru)
            check('Q1a: kuis cap GK dibuat', qInsSt === 200 || qInsSt === 201, qIns)
            await supabase.from('quiz_questions').update({ status: 'approved' }).eq('quiz_id', quizQ.id)
            await ensurePublished('quizzes', quizQ.id, 'quiz_questions', 'quiz_id', guru)

            // GET /api/quizzes/[id]/questions sebagai siswa — kunci ter-strip + cap ter-inject
            const qGet = await api('GET', `/api/quizzes/${quizQ.id}/questions`, null, siswa)
            const qList = qGet.data
            check('Q1b: route /questions — kunci ter-strip utk siswa', qGet.status === 200 && Array.isArray(qList) && qList.every(q => q.correct_answer === undefined), qList?.[0])
            check('Q1c: route /questions — gk_max_picks = jumlah kunci (2, 2, 3)',
                qList?.[0]?.gk_max_picks === 2 && qList?.[1]?.gk_max_picks === 2 && qList?.[2]?.gk_max_picks === 3,
                qList?.map(q => q.gk_max_picks))

            // GET /api/quizzes/[id] (embed) — jalur yang dipakai halaman kuis siswa
            const qEmbed = await api('GET', `/api/quizzes/${quizQ.id}`, null, siswa)
            const embedQs = qEmbed.data?.questions
            check('Q1d: embed /api/quizzes/[id] — kunci ter-strip + gk_max_picks ter-inject',
                Array.isArray(embedQs) && embedQs.length === 3 && embedQs.every(q => q.correct_answer === undefined && q.gk_max_picks),
                embedQs?.map(q => q.gk_max_picks))

            // ── Q2: submit over-pick LANGSUNG via API (bypass cap UI) → penalti server ──
            // S1 persis skenario guru: 2 kunci, pilih 3, 2 benar → (2-1)/2×10 = 5 (dulu 10 PENUH)
            // S2 select-all vs 2 kunci: (2-2)/2×10 = 0 (exploit penuh MATI)
            // S3 select-all vs 3 kunci: (3-1)/3×10 = 6.67
            const { status: qSubSt, data: qSub } = await api('POST', '/api/quiz-submissions', {
                quiz_id: quizQ.id, submit: true,
                answers: [
                    { question_id: qIns[0].id, answer: '["A","C","B"]' },
                    { question_id: qIns[1].id, answer: '["A","B","C","D"]' },
                    { question_id: qIns[2].id, answer: '["A","B","C","D"]' },
                ],
            }, siswa)
            check('Q2a: submit over-pick diterima (dinilai, bukan ditolak)', qSubSt === 200, qSubSt)
            const qaByQ = Object.fromEntries((qSub.answers || []).map(a => [a.question_id, a]))
            check('Q2b: 2 kunci + pilih 3 (2 benar) → 5, is_correct false (dulu 10 PENUH — skenario guru)',
                qaByQ[qIns[0].id]?.score === 5 && qaByQ[qIns[0].id]?.is_correct === false, qaByQ[qIns[0].id])
            check('Q2c: select-all vs 2 kunci → 0 (exploit penuh MATI)',
                qaByQ[qIns[1].id]?.score === 0 && qaByQ[qIns[1].id]?.is_correct === false, qaByQ[qIns[1].id])
            check('Q2d: select-all vs 3 kunci → 6.67 = (3-1)/3×10',
                qaByQ[qIns[2].id]?.score === 6.67, qaByQ[qIns[2].id])
            check('Q2e: total = 11.67 (5+0+6.67, round-2)', qSub.total_score === 11.67, qSub.total_score)

            // ── Q5: NILAI GURU — skor over-pick terbaca benar di view koreksi guru & hasil siswa ──
            // GET /api/quiz-submissions/[id] = sumber data halaman koreksi guru (guru/kuis/[id]/hasil/[sid]).
            const gDet = await api('GET', `/api/quiz-submissions/${qSub.id}`, null, guru)
            const gAns = gDet.data?.answers || []
            const gByQ = Object.fromEntries(gAns.map(a => [a.question_id, a]))
            check('Q5a: GET koreksi guru 200 + 3 answers terbawa', gDet.status === 200 && gAns.length === 3, gDet.status)
            check('Q5b: view koreksi guru — over-pick skor 5/0/6.67 (rumus baru, bukan 10/10/10)',
                gByQ[qIns[0].id]?.score === 5 && gByQ[qIns[1].id]?.score === 0 && gByQ[qIns[2].id]?.score === 6.67,
                gAns.map(a => a.score))
            check('Q5c: view koreksi guru — total 11.67 + is_correct false utk over-pick (parsial ≠ benar)',
                gDet.data?.total_score === 11.67 && gByQ[qIns[0].id]?.is_correct === false, { total: gDet.data?.total_score, s1: gByQ[qIns[0].id] })
            // GET hasil siswa — konsisten dgn yang guru lihat
            const sHasil = await api('GET', `/api/quiz-submissions?quiz_id=${quizQ.id}&student_id=${student.id}`, null, siswa)
            check('Q5d: hasil siswa — total 11.67 konsisten dgn view guru',
                Array.isArray(sHasil.data) && sHasil.data[0]?.total_score === 11.67, sHasil.data?.[0]?.total_score)

            // cleanup kuis cap
            await supabase.from('quiz_submissions').delete().eq('quiz_id', quizQ.id)
            await supabase.from('quiz_questions').delete().eq('quiz_id', quizQ.id)
            await supabase.from('quizzes').delete().eq('id', quizQ.id)

            // ── Q3: ulangan — cap ter-inject di GET /api/exams/[id]/questions ──
            const { data: examQ3 } = await api('POST', '/api/exams', {
                title: 'ltgk2_Exam Cap GK', teaching_assignment_id: ta.id,
                start_time: iso(0), duration_minutes: 60, is_randomized: false,
                show_results_immediately: true,
            }, guru)
            const e3Qs = [
                { question_text: 'Q3 GK 2 kunci', question_type: 'MULTIPLE_ANSWER', options: ['a', 'b', 'c', 'd'], correct_answer: '["A","C"]', points: 4, order_index: 0 },
                { question_text: 'Q3 PG', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'A', points: 6, order_index: 1 },
            ]
            const { status: e3St, data: e3Ins } = await api('POST', `/api/exams/${examQ3.id}/questions`, { questions: e3Qs }, guru)
            check('Q3a: exam cap GK dibuat', e3St === 200 || e3St === 201, e3Ins)
            await supabase.from('exam_questions').update({ status: 'approved' }).eq('exam_id', examQ3.id)
            await ensurePublished('exams', examQ3.id, 'exam_questions', 'exam_id', guru)
            const e3Get = await api('GET', `/api/exams/${examQ3.id}/questions`, null, siswa)
            const e3List = e3Get.data
            check('Q3b: GET soal ulangan siswa — kunci ter-strip + gk_max_picks=2 utk GK, PG tanpa cap',
                e3Get.status === 200 && Array.isArray(e3List) && e3List[0]?.correct_answer === undefined && e3List[0]?.gk_max_picks === 2 && e3List[1]?.gk_max_picks === undefined,
                e3List?.map(q => ({ t: q.question_type, cap: q.gk_max_picks })))

            // cleanup exam cap
            await supabase.from('exam_questions').delete().eq('exam_id', examQ3.id)
            await supabase.from('exams').delete().eq('id', examQ3.id)

            // ── Q4: UTS/UAS — cap ter-inject di GET /api/official-exams/[id]/questions ──
            const { data: oeQ } = await api('POST', '/api/official-exams', {
                exam_type: 'UTS', title: 'ltgk2_UTS Cap GK',
                subject_id: SUBJECT, target_class_ids: [CLASS],
                academic_year_id: YEAR, start_time: iso(0), duration_minutes: 60,
                is_randomized: false, show_results_immediately: true,
            }, guru)
            const o4Qs = [
                { question_text: 'Q4 GK 2 kunci', question_type: 'MULTIPLE_ANSWER', options: ['a', 'b', 'c', 'd'], correct_answer: '["A","C"]', points: 4, order_index: 0 },
            ]
            const { status: o4St, data: o4Ins } = await api('POST', `/api/official-exams/${oeQ.id}/questions`, { questions: o4Qs }, guru)
            check('Q4a: UTS cap GK dibuat', o4St === 200 || o4St === 201, o4Ins)
            await supabase.from('official_exam_questions').update({ status: 'approved' }).eq('exam_id', oeQ.id)
            const { status: o4PubSt } = await api('PUT', `/api/official-exams/${oeQ.id}`, { is_active: true }, guru)
            check('Q4b: publish UTS cap', o4PubSt === 200, o4PubSt)
            const o4Get = await api('GET', `/api/official-exams/${oeQ.id}/questions`, null, siswa)
            const o4List = o4Get.data
            check('Q4c: GET soal UTS siswa — kunci ter-strip + gk_max_picks=2',
                o4Get.status === 200 && Array.isArray(o4List) && o4List[0]?.correct_answer === undefined && o4List[0]?.gk_max_picks === 2,
                o4List?.[0])

            // cleanup UTS cap
            await supabase.from('official_exam_questions').delete().eq('exam_id', oeQ.id)
            await supabase.from('official_exams').delete().eq('id', oeQ.id)
        }
    } finally {
        // ═══ CLEANUP ═══
        console.log('\n═══ CLEANUP ══')
        const { data: ex } = await supabase.from('exams').select('id').eq('title', 'ltgk2_Ulangan GK E2E').maybeSingle()
        if (ex) {
            await supabase.from('exam_answers').delete().in('submission_id', (await supabase.from('exam_submissions').select('id').eq('exam_id', ex.id)).data?.map(s => s.id) || [])
            await supabase.from('exam_submissions').delete().eq('exam_id', ex.id)
            await supabase.from('exam_questions').delete().eq('exam_id', ex.id)
            await supabase.from('exams').delete().eq('id', ex.id)
        }
        const { data: qz } = await supabase.from('quizzes').select('id').eq('title', 'ltgk2_Kuis GK E2E').maybeSingle()
        if (qz) {
            await supabase.from('quiz_submissions').delete().eq('quiz_id', qz.id)
            await supabase.from('quiz_questions').delete().eq('quiz_id', qz.id)
            await supabase.from('quizzes').delete().eq('id', qz.id)
        }
        await supabase.from('teaching_assignments').delete().eq('id', ta.id)
        if (enroll) await supabase.from('student_enrollments').delete().eq('id', enroll.id)
        if (enroll2) await supabase.from('student_enrollments').delete().eq('id', enroll2.id)
        await supabase.from('students').delete().eq('id', student.id)
        await supabase.from('students').delete().eq('id', student2.id)
        await supabase.from('teachers').delete().eq('id', teacher.id)
        await supabase.from('sessions').delete().eq('user_id', siswaU.id)
        await supabase.from('sessions').delete().eq('user_id', siswa2U.id)
        await supabase.from('sessions').delete().eq('user_id', guruU.id)
        await supabase.from('sessions').delete().eq('user_id', adminU.id)
        await supabase.from('notifications').delete().eq('user_id', siswaU.id)
        await supabase.from('notifications').delete().eq('user_id', siswa2U.id)
        await supabase.from('users').delete().in('id', [guruU.id, siswaU.id, siswa2U.id, adminU.id])
        console.log('cleanup ok')
    }

    console.log(`\n═══ HASIL: ${pass} pass, ${fail} fail ══`)
    process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
