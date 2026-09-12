/**
 * E2E MULTI-CLASS (BATCH ULANGAN + UTS MULTI-Target) — verifikasi flow
 * multi-kelas end-to-end dengan ruang ujian baru (ExamRunner).
 *
 * Dua konsep multi-class yang berbeda di sistem ini:
 *
 *  [BATCH] Ulangan multi-kelas — wizard membuat N exam (1 per kelas paralel)
 *          yang diikat batch_id; publish di primary menyalin soal + menerbitkan
 *          semua sibling (server-side syncExamBatch). Siswa tiap kelas
 *          mengerjakan exam KELASNYA SENDIRI via ExamRunner.
 *    B1  simulasi wizard: POST /api/exams ×3 (TA A/B/C) share batch_id → 200
 *    B2  soal ditambah ke primary (2 MC approved)
 *    B3  PUT primary {is_active:true} → batch_sync {total:2, failed:0}
 *    B4  soal identik di exam A/B/C (teks + jumlah)
 *    B5  sibling ikut aktif (is_active=true semua)
 *    B6  siswa A hanya melihat exam kelasnya di list (scoping kelas)
 *    B7  siswa B start exam B (kontrak runner: order/ends_at/server_time) →
 *        jawab → submit → skor benar (soal hasil salinan batch dinilai normal)
 *    B8  siswa D (kelas tanpa TA) start exam A → 403
 *
 *  [OFFICIAL] UTS multi-target — SATU ujian, target_class_ids banyak kelas;
 *          siswa semua kelas target mengerjakan ujian yang sama.
 *    O1  siswa A & B sama-sama start ujian yang sama → 200
 *    O2  keduanya submit → skor benar (submission terpisah per siswa)
 *    O3  siswa C (luar target) → 403
 *
 *  [RENDER] Chrome headless: siswa kelas B membuka exam B (hasil salinan
 *          batch) — soal render via ExamRunner (bukan layar error).
 *
 * WAJIB staging: ENV_FILE=.env.staging node loadtest/e2e/e2e_multiclass_flow.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { execFile, spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PORT = 3109
const BASE = `http://localhost:${PORT}`
const PROXY_PORT = 3110
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

let server = null
let proxy = null

const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], exams: [], questions: [], submissions: [],
    enrollments: [], officialExams: [], officialQuestions: [], officialSubmissions: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `mc_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES: 1 guru, 4 kelas (A/B/C batch + D luar), siswa per kelas ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} IPA`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const guruUser = await mustInsert(supabase, 'users', { username: `${U}_guru`, full_name: `${U} Guru`, password_hash: passHash, role: 'GURU', school_id: school.id }, 'user guru')
    created.users.push(guruUser.id)
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guruUser.id, school_id: school.id }, 'teacher')
    created.teachers.push(teacher.id)
    const guruTok = (await mustInsert(supabase, 'sessions', { user_id: guruUser.id, token: `${U}_tok_guru`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session guru')).token
    created.sessions.push(guruTok)

    const mkClass = async (label) => {
        const c = await mustInsert(supabase, 'classes', { name: `${U} 9${label}`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, `class ${label}`)
        created.classes.push(c.id)
        return c
    }
    const classA = await mkClass('A'), classB = await mkClass('B'), classC = await mkClass('C'), classD = await mkClass('D')

    // Guru mengampu A, B, C (batch kelas paralel); D tanpa dia
    const mkTa = async (cls) => {
        const ta = await mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: cls.id, subject_id: subject.id, academic_year_id: year.id }, `TA ${cls.id.slice(0, 8)}`)
        created.tas.push(ta.id)
        return ta
    }
    const taA = await mkTa(classA), taB = await mkTa(classB), taC = await mkTa(classC)

    const mkStudent = async (label, cls) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} Siswa ${label.toUpperCase()}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}${label.toLowerCase()}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session ${label}`)).token
        created.sessions.push(tok)
        return { user: u, student: st, token: tok }
    }
    const siswaA = await mkStudent('a', classA)
    const siswaB = await mkStudent('b', classB)
    const siswaC = await mkStudent('c', classC)
    const siswaD = await mkStudent('d', classD)

    console.log('fixtures OK: 1 guru (TA di A/B/C), 4 kelas, 4 siswa')

    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ================= [BATCH] ULANGAN MULTI-KELAS =================
    console.log('[BATCH-1..2] Simulasi wizard: 3 exam share batch_id + 2 soal di primary')
    const batchId = crypto.randomUUID() // persis wizard: batch_id dibuat client
    const startAt = new Date(Date.now() - 60000).toISOString()
    const mkExam = async (ta) => {
        const r = await api('/api/exams', guruTok, {
            method: 'POST',
            body: JSON.stringify({
                title: `${U} Ulangan Batch`, description: 'e2e multiclass', start_time: startAt,
                duration_minutes: 30, teaching_assignment_id: ta.id, is_randomized: false,
                max_violations: 3, show_results_immediately: true, batch_id: batchId,
            }),
        })
        const body = await r.json().catch(() => null)
        if (!r.ok || !body?.id) throw new Error(`POST exam gagal untuk TA ${ta.id}: ${r.status}`)
        created.exams.push(body.id)
        return body.id
    }
    const examA = await mkExam(taA)
    const examB = await mkExam(taB)
    const examC = await mkExam(taC)
    check('B1: 3 exam batch dibuat (POST ×3, batch_id sama)', true, `${examA.slice(0, 8)}/${examB.slice(0, 8)}/${examC.slice(0, 8)}`)

    // Soal di primary — persis jalur wizard (service-role, approved)
    const qRows = [
        { exam_id: examA, question_text: 'MC batch 1', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: examA, question_text: 'MC batch 2', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1'], correct_answer: 'B', points: 10, order_index: 1, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
    ]
    const { data: insertedQ, error: qErr } = await supabase.from('exam_questions').insert(qRows).select()
    if (qErr) throw new Error('Insert soal primary gagal: ' + qErr.message)
    created.questions.push(...insertedQ.map(q => q.id))
    const q1Id = insertedQ[0].id, q2Id = insertedQ[1].id
    check('B2: 2 soal approved di primary', insertedQ.length === 2)

    console.log('[BATCH-3..5] Publish primary → server sinkron seluruh batch')
    const pubRes = await api(`/api/exams/${examA}`, guruTok, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    const pubBody = await pubRes.json().catch(() => null)
    check('B3: PUT publish primary 200', pubRes.status === 200, `status=${pubRes.status}`)
    check('B3: batch_sync menyalin ke 2 sibling tanpa gagal', pubBody?.batch_sync?.total === 2 && (pubBody.batch_sync?.failed?.length || 0) === 0,
        `total=${pubBody?.batch_sync?.total} failed=${pubBody?.batch_sync?.failed?.length}`)

    // B4: soal identik di semua exam batch
    const qsOf = async (examId) => (await supabase.from('exam_questions').select('question_text, correct_answer, points, order_index').eq('exam_id', examId).order('order_index')).data || []
    const qsA = await qsOf(examA), qsB = await qsOf(examB), qsC = await qsOf(examC)
    check('B4: soal identik di exam A/B/C (teks+kunci+poin)', JSON.stringify(qsA) === JSON.stringify(qsB) && JSON.stringify(qsA) === JSON.stringify(qsC) && qsA.length === 2,
        `A=${qsA.length} B=${qsB.length} C=${qsC.length}`)

    // B5: semua sibling aktif
    const activeOf = async (examId) => (await supabase.from('exams').select('is_active, batch_id').eq('id', examId).single()).data
    const eA = await activeOf(examA), eB = await activeOf(examB), eC = await activeOf(examC)
    check('B5: primary + sibling semua is_active=true', eA?.is_active === true && eB?.is_active === true && eC?.is_active === true,
        `A=${eA?.is_active} B=${eB?.is_active} C=${eC?.is_active}`)
    check('B5b: batch_id terikat konsisten', eA?.batch_id === batchId && eB?.batch_id === batchId && eC?.batch_id === batchId)

    console.log('[BATCH-6..8] Siswa multi-kelas via ExamRunner')
    // B6: scoping list — siswa A hanya melihat exam kelasnya
    const listA = await (await api('/api/exams', siswaA.token)).json().catch(() => [])
    const idsInA = (Array.isArray(listA) ? listA : []).map(e => e.id)
    check('B6: siswa A hanya melihat exam kelasnya (bukan B/C)', idsInA.includes(examA) && !idsInA.includes(examB) && !idsInA.includes(examC),
        `n=${idsInA.length} punyaA=${idsInA.includes(examA)}`)

    // B7: siswa B start exam B (soal hasil salinan batch) → jawab → submit
    const startB = await api('/api/exam-submissions', siswaB.token, { method: 'POST', body: JSON.stringify({ exam_id: examB }) })
    const startBBody = await startB.json().catch(() => null)
    check('B7: siswa B start exam B 200 (kontrak runner: order/ends_at/server_time)', startB.status === 200 && Array.isArray(startBBody?.question_order) && startBBody.question_order.length === 2 && startBBody?.ends_at !== undefined && !!startBBody?.server_time,
        `status=${startB.status} order=${startBBody?.question_order?.length}`)
    created.submissions.push(startBBody?.id)

    const qB = await (await api(`/api/exams/${examB}/questions`, siswaB.token)).json().catch(() => [])
    const qB1 = qB.find(q => q.question_text === 'MC batch 1'), qB2 = qB.find(q => q.question_text === 'MC batch 2')
    check('B7b: soal salinan batch bisa dimuat siswa B (kunci tidak bocor)', qB.length === 2 && !!qB1 && !!qB2 && qB.every(q => q.correct_answer === undefined))

    const submitB = await api('/api/exam-submissions', siswaB.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: startBBody.id, submit: true,
            // pakai id soal exam B (bukan exam A!) — kunci jawaban disalin persis: A lalu B
            answers: [{ question_id: qB1.id, answer: 'A' }, { question_id: qB2.id, answer: 'B' }],
        }),
    })
    const submitBBody = await submitB.json().catch(() => null)
    check('B7c: submit siswa B → skor 20/20 (penilaian soal batch benar)', submitB.status === 200 && submitBBody?.total_score === 20 && submitBBody?.max_score === 20,
        `total=${submitBBody?.total_score}/${submitBBody?.max_score}`)

    // B7d: siswa A juga kerjakan exam A (primary) — pastikan primary juga normal
    const startA = await api('/api/exam-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ exam_id: examA }) })
    const startABody = await startA.json().catch(() => null)
    created.submissions.push(startABody?.id)
    const qA = await (await api(`/api/exams/${examA}/questions`, siswaA.token)).json().catch(() => [])
    const submitA = await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: startABody.id, submit: true,
            answers: [{ question_id: qA[0].id, answer: 'A' }, { question_id: qA[1].id, answer: 'A' }],
        }),
    })
    const submitABody = await submitA.json().catch(() => null)
    check('B7d: siswa A kerjakan primary → skor 10/20', submitABody?.total_score === 10, `total=${submitABody?.total_score}`)

    // B8: siswa D (kelas tanpa TA) ditolak
    const startD = await api('/api/exam-submissions', siswaD.token, { method: 'POST', body: JSON.stringify({ exam_id: examA }) })
    check('B8: siswa kelas lain start exam A → 403', startD.status === 403, `status=${startD.status}`)

    // ================= [OFFICIAL] UTS MULTI-TARGET =================
    console.log('[OFFICIAL] UTS 1 ujian, target 2 kelas (A+B)')
    const uts = await mustInsert(supabase, 'official_exams', {
        school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
        exam_type: 'UTS', title: `${U} UTS MultiKelas`, description: null,
        start_time: new Date(Date.now() - 60000).toISOString(), duration_minutes: 30,
        window_end_time: new Date(Date.now() + 3600000).toISOString(),
        is_randomized: false, max_violations: 3, target_class_ids: [classA.id, classB.id],
        created_by: guruUser.id, is_active: true, show_results_immediately: true,
    }, 'uts multi-target')
    created.officialExams.push(uts.id)
    const { data: utsQ } = await supabase.from('official_exam_questions').insert({
        exam_id: uts.id, question_text: 'MC uts multi', question_type: 'MULTIPLE_CHOICE',
        options: ['A1', 'B1'], correct_answer: 'A', points: 10, order_index: 0,
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    }).select()
    created.officialQuestions.push(utsQ[0].id)

    // O1: siswa A dan B start ujian yang SAMA
    const oStartA = await api('/api/official-exam-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ exam_id: uts.id }) })
    const oStartABody = await oStartA.json().catch(() => null)
    const oStartB = await api('/api/official-exam-submissions', siswaB.token, { method: 'POST', body: JSON.stringify({ exam_id: uts.id }) })
    const oStartBBody = await oStartB.json().catch(() => null)
    check('O1: siswa A start UTS (kelas target 1)', oStartA.status === 200 && !!oStartABody?.id, `status=${oStartA.status}`)
    check('O1b: siswa B start UTS yang sama (kelas target 2)', oStartB.status === 200 && !!oStartBBody?.id, `status=${oStartB.status}`)
    created.officialSubmissions.push(oStartABody?.id, oStartBBody?.id)

    // O2: keduanya submit → skor benar, submission terpisah
    const oSubmitA = await api('/api/official-exam-submissions', siswaA.token, {
        method: 'PUT', body: JSON.stringify({ submission_id: oStartABody.id, submit: true, answers: [{ question_id: utsQ[0].id, answer: 'A' }] }),
    })
    const oSubmitB = await api('/api/official-exam-submissions', siswaB.token, {
        method: 'PUT', body: JSON.stringify({ submission_id: oStartBBody.id, submit: true, answers: [{ question_id: utsQ[0].id, answer: 'B' }] }),
    })
    const oSubmitABody = await oSubmitA.json().catch(() => null)
    const oSubmitBBody = await oSubmitB.json().catch(() => null)
    check('O2: submit A → 10/10, submit B → 0/10 (jawaban beda, kunci sama)', oSubmitABody?.total_score === 10 && oSubmitBBody?.total_score === 0,
        `A=${oSubmitABody?.total_score} B=${oSubmitBBody?.total_score}`)
    check('O2b: submission terpisah per siswa', oStartABody.id !== oStartBBody.id)

    // O3: siswa C (kelas batch tapi BUKAN target UTS) ditolak
    const oStartC = await api('/api/official-exam-submissions', siswaC.token, { method: 'POST', body: JSON.stringify({ exam_id: uts.id }) })
    check('O3: siswa C (luar target UTS) → 403', oStartC.status === 403, `status=${oStartC.status}`)

    // ================= [RENDER] Chrome: siswa C di exam batch C =================
    // siswa C dipilih karena BELUM pernah menyentuh exam C — siswa yang sudah
    // submit memicu alert() "Already submitted" di runner, dan alert menggantung
    // headless Chrome tanpa dialog handler (kejadian run pertama).
    console.log('[RENDER] Chrome headless: exam C (salinan batch) di-render ExamRunner')
    if (!fs.existsSync(CHROME)) {
        console.log('  ⚠ Chrome tidak ditemukan — [RENDER] dilewati (bukan fail)')
    } else {
        await new Promise(r => {
            proxy = http.createServer((req, res) => {
                const p = http.request({ hostname: 'localhost', port: PORT, path: req.url, method: req.method, headers: { ...req.headers, Cookie: `session_token=${siswaC.token}` } }, pr => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res) })
                p.on("error", () => { res.writeHead(502); res.end() }); req.pipe(p)
            })
            proxy.listen(PROXY_PORT, r)
        })
        const dom = await new Promise((resolve) => {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mc-'))
            execFile(CHROME, [
                '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                `--user-data-dir=${tmp}`, '--virtual-time-budget=15000', '--dump-dom',
                `http://localhost:${PROXY_PORT}/dashboard/siswa/ulangan/${examC}`,
            ], { maxBuffer: 64 * 1024 * 1024, timeout: 60000 }, (err, stdout) => {
                fs.rmSync(tmp, { recursive: true, force: true })
                resolve(err ? '' : stdout)
            })
        })
        check('[RENDER] exam C render soal batch via ExamRunner', dom.includes('MC batch 1') && dom.includes('Layar Penuh Diwajibkan'), `len=${dom.length}`)
        check('[RENDER] kunci jawaban tidak muncul di DOM', !dom.includes('correct_answer'))
        proxy.close()
    }

    // ---------- HASIL ----------
    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL E2E MULTI-CLASS =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'E2E-MULTICLASS: PASS ✅' : 'E2E-MULTICLASS: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : null
    const delBy = (t, col, ids) => ids.length ? supabase.from(t).delete().in(col, ids) : null
    await delBy('exam_answers', 'submission_id', created.submissions)
    await del('exam_submissions', created.submissions)
    await delBy('exam_questions', 'exam_id', created.exams)
    await del('exams', created.exams)
    await delBy('official_exam_answers', 'submission_id', created.officialSubmissions)
    await del('official_exam_submissions', created.officialSubmissions)
    await delBy('official_exam_questions', 'exam_id', created.officialExams)
    await del('official_exams', created.officialExams)
    for (const uid of created.users) await supabase.from('notifications').delete().eq('user_id', uid)
    await del('sessions', created.sessions)
    await del('student_enrollments', created.enrollments)
    await del('students', created.students)
    await del('teaching_assignments', created.tas)
    await del('teachers', created.teachers)
    await del('classes', created.classes)
    await del('subjects', created.subjects)
    await del('users', created.users)
    if (proxy) try { proxy.close() } catch { }
    console.log('cleanup selesai')
}

main()
    .catch(async e => {
        console.error('ERROR:', e.message)
        process.exitCode = 1
        if (server) await stopServerSafe(server, BASE).catch(() => { })
    })
    .finally(cleanup)
