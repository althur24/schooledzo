/**
 * E2E SOAL + GAMBAR R2 — bukti gambar upload presign (commit f245067)
 * BENAR-BENAR muncul di soal yang dilihat siswa, bukan cuma URL hidup.
 *
 * Rantai yang diverifikasi (setiap hop jalur HTTP nyata):
 *  [1] Guru sign+PUT gambar via /api/questions/upload-image (route presign R2 baru)
 *  [2] Kuis: guru buat kuis + soal MC (image_url = R2) + opsi ber-<img> R2
 *      → publish → SISWA GET /api/quizzes/[id]/questions:
 *      image_url UTUH + opsi <img> UTUH + correct_answer ter-strip (sanity C1)
 *  [3] Bank soal: POST /api/question-bank (image_url R2) → GET → image_url utuh
 *  [4] Ulangan: POST /api/exams (soal image_url R2) → GET questions → utuh
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_soal_image_r2.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3110
const BASE = `http://localhost:${PORT}`

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], quizzes: [], questions: [],
    submissions: [], enrollments: [], notifications: [],
    exams: [], examQuestions: [], questionBank: [],
    r2Keys: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function pubStatus(url, tries = 3) {
    let last = 0
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url)
            if (res.status < 500) return res.status
            last = res.status
        } catch (e) { last = 0 }
        if (i < tries - 1) await sleep(700)
    }
    return last
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : Promise.resolve()
    // R2 objects
    if (created.r2Keys.length && process.env.R2_ACCESS_KEY_ID) {
        const { S3Client, DeleteObjectsCommand } = require('@aws-sdk/client-s3')
        const r2 = new S3Client({
            region: 'auto',
            endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
        })
        await r2.send(new DeleteObjectsCommand({
            Bucket: process.env.R2_BUCKET,
            Delete: { Objects: created.r2Keys.map(k => ({ Key: k })) },
        })).catch(() => { })
    }
    await del('quiz_submissions', created.submissions)
    await del('quiz_questions', created.questions)
    await del('quizzes', created.quizzes)
    await del('exam_questions', created.examQuestions)
    await del('exams', created.exams)
    await del('question_bank', created.questionBank)
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

async function main() {
    const runId = Date.now() % 100000
    const U = `soalimg_${runId}`
    const PASS = 'SoalImg-123'
    const passHash = bcrypt.hashSync(PASS, 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} Mapel`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const guruUser = await mustInsert(supabase, 'users', { username: `${U}_guru`, full_name: `${U} Guru`, password_hash: passHash, role: 'GURU', school_id: school.id }, 'user guru')
    created.users.push(guruUser.id)
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guruUser.id, school_id: school.id }, 'teacher')
    created.teachers.push(teacher.id)

    const classA = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class A')
    created.classes.push(classA.id)
    const taA = await mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: classA.id, subject_id: subject.id, academic_year_id: year.id }, 'TA A')
    created.tas.push(taA.id)

    const mkStudent = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} Siswa ${label.toUpperCase()}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}${label}`, class_id: classA.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: classA.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session ${label}`)).token
        created.sessions.push(tok)
        return { user: u, student: st, token: tok }
    }
    const siswaA = await mkStudent('sa')
    const guruTok = (await mustInsert(supabase, 'sessions', { user_id: guruUser.id, token: `${U}_tok_guru`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session guru')).token
    created.sessions.push(guruTok)

    console.log('fixtures OK (guru + siswa + TA)')

    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ════════ [1] UPLOAD GAMBAR VIA ROUTE PRESIGN BARU ════════
    console.log('[1] Guru sign+PUT gambar soal (route presign R2 baru)')
    const signRes = await api('/api/questions/upload-image', guruTok, {
        method: 'POST', body: JSON.stringify({ filename: 'gambar-soal-r2.jpg', contentType: 'image/jpeg' }),
    })
    const sign = await signRes.json().catch(() => null)
    check('sign → 200 + signedUrl', signRes.status === 200 && !!sign?.signedUrl, `status ${signRes.status}`)
    let r2Url = null
    if (sign?.signedUrl) {
        const put = await fetch(sign.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.from('\xFF\xD8\xFF\xE0gambar-soal-r2') })
        check('PUT ke R2 → 200', put.status === 200, `status ${put.status}`)
        r2Url = sign.url
        if (sign.path) created.r2Keys.push(sign.path)
        const stat = await pubStatus(`${r2Url}?cek=${Date.now()}`)
        check('public URL gambar hidup', stat === 200, `status ${stat}`)
    }
    if (!r2Url) throw new Error('Upload gambar gagal — tidak bisa lanjut.')

    // ════════ [2] KUIS: SOAL image_url + OPSI <img> → SISWA ════════
    console.log('[2] Kuis: soal image_url + opsi <img> R2 → siswa lihat utuh')
    const optImgHtml = `<img src="${r2Url}" alt="Opsi B" style="max-width:100%;" />`
    const createRes = await api('/api/quizzes', guruTok, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Kuis Gambar`, duration_minutes: 15, teaching_assignment_id: taA.id, is_randomized: false,
            questions: [{
                question_text: 'Perhatikan gambar berikut!', question_type: 'MULTIPLE_CHOICE',
                options: ['Teks opsi A', `Teks + ${optImgHtml}`],
                correct_answer: 'A', points: 10, order_index: 0,
                image_url: r2Url,
            }],
        }),
    })
    const quiz = await createRes.json().catch(() => null)
    check('POST /api/quizzes (soal ber-gambar) → 200', createRes.status === 200 && !!quiz?.id, `status ${createRes.status}`)
    if (quiz?.id) created.quizzes.push(quiz.id)
    const { data: dbQs } = await supabase.from('quiz_questions').select('id, image_url, options').eq('quiz_id', quiz.id)
    if (dbQs?.length) created.questions.push(...dbQs.map(q => q.id))
    check('DB: quiz_questions.image_url tersimpan (R2)', dbQs?.[0]?.image_url === r2Url, `db=${String(dbQs?.[0]?.image_url).slice(0, 60)}`)

    await api(`/api/quizzes/${quiz.id}`, guruTok, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    const start = await api('/api/quiz-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ quiz_id: quiz.id, answers: [] }) })
    const startBody = await start.json().catch(() => null)
    if (startBody?.id) created.submissions.push(startBody.id)
    check('siswa mulai attempt', start.status === 200, `status ${start.status}`)

    const qRes = await api(`/api/quizzes/${quiz.id}/questions`, siswaA.token)
    const qArr = await qRes.json().catch(() => null)
    check('siswa GET soal → 200 array', qRes.status === 200 && Array.isArray(qArr) && qArr.length === 1, `status ${qRes.status} n=${qArr?.length}`)
    const soal = Array.isArray(qArr) ? qArr[0] : null
    check('siswa melihat image_url R2 UTUH di soal', soal?.image_url === r2Url, `got=${String(soal?.image_url).slice(0, 60)}`)
    const optWithImg = Array.isArray(soal?.options) ? soal.options.find(o => String(o).includes('files.educationzone.id')) : null
    check('siswa melihat opsi <img> R2 UTUH', !!optWithImg && optWithImg.includes(r2Url), `opt=${String(optWithImg).slice(0, 60)}`)
    check('correct_answer ter-strip (sanity C1)', soal?.correct_answer === undefined, `ada=${'correct_answer' in (soal || {})}`)

    // ════════ [3] BANK SOAL (jalur bulk — satu-satunya yang menyimpan image_url;
    // jalur tunggal menjatuhkan image_url = gap pre-existing, lihat
    // BANK_SOAL_REKONSTRUKSI_PLAN.md, di luar scope R2) ════════
    console.log('[3] Bank soal (bulk): image_url R2 → GET utuh')
    const bankRes = await api('/api/question-bank', guruTok, {
        method: 'POST',
        body: JSON.stringify([{
            question_text: 'Soal bank ber-gambar', question_type: 'MULTIPLE_CHOICE',
            options: ['A', 'B'], correct_answer: 'A', subject_id: subject.id, image_url: r2Url,
        }]),
    })
    const bankArr = await bankRes.json().catch(() => null)
    const bankQ = Array.isArray(bankArr) ? bankArr[0] : bankArr
    check('POST /api/question-bank bulk (image_url R2) → 200', bankRes.status === 200 && !!bankQ?.id, `status ${bankRes.status}`)
    if (bankQ?.id) created.questionBank.push(bankQ.id)
    const bankList = await (await api('/api/question-bank', guruTok)).json().catch(() => null)
    const bankRow = (Array.isArray(bankList) ? bankList : []).find(q => q.id === bankQ?.id)
    check('GET /api/question-bank → image_url R2 utuh', bankRow?.image_url === r2Url, `got=${String(bankRow?.image_url).slice(0, 60)}`)

    // ════════ [4] ULANGAN (EXAM): create → tambah soal → GET utuh ════════
    // (POST /api/exams hanya metadata; soal ditambah via
    // POST /api/exams/[id]/questions — jalur yang dipakai UI guru)
    console.log('[4] Ulangan: soal image_url R2 → GET questions utuh')
    const examRes = await api('/api/exams', guruTok, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Ulangan Gambar`, start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            duration_minutes: 30, teaching_assignment_id: taA.id,
        }),
    })
    const exam = await examRes.json().catch(() => null)
    check('POST /api/exams (metadata) → 200', examRes.status === 200 && !!exam?.id, `status ${examRes.status}`)
    if (exam?.id) created.exams.push(exam.id)

    const addQRes = await api(`/api/exams/${exam.id}/questions`, guruTok, {
        method: 'POST',
        body: JSON.stringify({
            questions: [{
                question_text: 'Soal ulangan ber-gambar', question_type: 'MULTIPLE_CHOICE',
                options: ['A', 'B'], correct_answer: 'A', points: 10,
                image_url: r2Url,
            }],
        }),
    })
    const examQArr = await addQRes.json().catch(() => null)
    const examQ = Array.isArray(examQArr) ? examQArr[0] : examQArr
    check('POST /api/exams/[id]/questions (image_url R2) → 200', addQRes.status === 200 && !!examQ?.id, `status ${addQRes.status}`)
    if (examQ?.id) created.examQuestions.push(examQ.id)
    const { data: dbExamQs } = await supabase.from('exam_questions').select('id, image_url').eq('exam_id', exam.id)
    check('DB: exam_questions.image_url tersimpan (R2)', dbExamQs?.[0]?.image_url === r2Url, `db=${String(dbExamQs?.[0]?.image_url).slice(0, 60)}`)
    const eqRes = await api(`/api/exams/${exam.id}/questions`, guruTok)
    const eqArr = await eqRes.json().catch(() => null)
    const eqRow = Array.isArray(eqArr) ? eqArr[0] : null
    check('GET exam questions → image_url R2 utuh', eqRow?.image_url === r2Url, `got=${String(eqRow?.image_url).slice(0, 60)}`)

    // ---------- HASIL ----------
    console.log('\n===== HASIL E2E SOAL + GAMBAR R2 =====')
    const pass = results.filter(r => r.ok).length
    console.log(`PASS: ${pass}/${results.length}`)
    if (pass !== results.length) {
        console.log('GAGAL:')
        results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.name} ${r.detail}`))
        process.exitCode = 1
    }
}

main()
    .catch(async e => {
        console.error('ERROR:', e.message)
        process.exitCode = 1
    })
    .then(async () => {
        if (server) await stopServerSafe(server, BASE).catch(() => { })
        await cleanup()
    })
