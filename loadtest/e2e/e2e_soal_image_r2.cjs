/**
 * E2E SOAL + GAMBAR R2 — bukti gambar upload presign (commit f245067)
 * BENAR-BENAR muncul di soal yang dilihat siswa, bukan cuma URL hidup.
 *
 * Rantai yang diverifikasi (setiap hop jalur HTTP nyata):
 *  [1] Guru sign+PUT gambar & audio via route presign R2 (commit f245067)
 *  [2] Kuis: guru buat kuis + soal MC (image_url = R2) + opsi ber-<img> R2
 *      → publish → SISWA GET /api/quizzes/[id]/questions:
 *      image_url UTUH + opsi <img> UTUH + correct_answer ter-strip (sanity C1)
 *  [3] Bank soal (bulk): POST /api/question-bank (image_url R2) → GET → utuh
 *  [4] Ulangan: POST /api/exams → POST soal (image_url R2) → GET → utuh
 *  [5] UTS/UAS: POST /api/official-exams → POST soal (image_url +
 *      passage_audio_url R2) → DB + GET utuh (jalur siswa + AudioGroup runner
 *      sudah dibuktikan e2e_exam_runner_unification [Q-AUDIO])
 *  [6] Kuis listening: soal passage_audio_url R2 → SISWA GET soal → utuh
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
    officialExams: [], officialQuestions: [],
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
    await del('official_exam_questions', created.officialQuestions)
    await del('official_exams', created.officialExams)
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

    // ════════ [1] UPLOAD GAMBAR + AUDIO VIA ROUTE PRESIGN BARU ════════
    console.log('[1] Guru sign+PUT gambar & audio soal (route presign R2 baru)')
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

    // Audio listening via route presign (dipakai seksi [5] & [6])
    const signAudioRes = await api('/api/audio/upload', guruTok, {
        method: 'POST', body: JSON.stringify({ filename: 'listening-r2.mp3', contentType: 'audio/mpeg' }),
    })
    const signAudio = await signAudioRes.json().catch(() => null)
    let audioUrl = null
    if (signAudio?.signedUrl) {
        const putA = await fetch(signAudio.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: Buffer.from('ID3-listening-r2') })
        check('audio: PUT ke R2 → 200', putA.status === 200, `status ${putA.status}`)
        audioUrl = signAudio.url
        if (signAudio.path) created.r2Keys.push(signAudio.path)
        const statA = await pubStatus(`${audioUrl}?cek=${Date.now()}`)
        check('audio: public URL hidup', statA === 200, `status ${statA}`)
    }
    if (!audioUrl) throw new Error('Upload audio gagal — tidak bisa lanjut.')

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

    // ════════ [5] UTS/UAS (OFFICIAL EXAMS): gambar + audio listening R2 ════════
    // Jalur API nyata: POST exam (draft) → POST soal → DB → guru GET utuh.
    // (Siswa GET soal UTS/UAS + rendering AudioGroup runner sudah dibuktikan
    // e2e_exam_runner_unification seksi [Q-AUDIO] — di sana passage_audio_url
    // utuh sampai siswa.)
    console.log('[5] UTS/UAS: soal image_url + passage_audio_url R2 → DB + GET utuh')
    const oeRes = await api('/api/official-exams', guruTok, {
        method: 'POST',
        body: JSON.stringify({
            exam_type: 'UTS', title: `${U} UTS Gambar`, subject_id: subject.id,
            start_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            duration_minutes: 60, target_class_ids: [classA.id],
        }),
    })
    const oe = await oeRes.json().catch(() => null)
    check('POST /api/official-exams (draft) → 200', oeRes.status === 200 && !!oe?.id, `status ${oeRes.status} ${oe?.error || ''}`)
    if (oe?.id) created.officialExams.push(oe.id)

    if (oe?.id) {
        const oqRes = await api(`/api/official-exams/${oe.id}/questions`, guruTok, {
            method: 'POST',
            body: JSON.stringify({
                questions: [{
                    question_text: 'Soal UTS listening ber-gambar', question_type: 'MULTIPLE_CHOICE',
                    options: ['A', 'B'], correct_answer: 'A', points: 10,
                    image_url: r2Url,
                    passage_text: 'Bacaan listening UTS', passage_audio_url: audioUrl,
                }],
            }),
        })
        const oqArr = await oqRes.json().catch(() => null)
        const oq = Array.isArray(oqArr) ? oqArr[0] : oqArr
        check('POST /api/official-exams/[id]/questions (image+audio R2) → 200', oqRes.status === 200 && !!oq?.id, `status ${oqRes.status}`)
        if (oq?.id) created.officialQuestions.push(oq.id)
        const { data: dbOQ } = await supabase.from('official_exam_questions')
            .select('id, image_url, passage_audio_url').eq('exam_id', oe.id)
        check('DB: official_exam_questions.image_url tersimpan (R2)', dbOQ?.[0]?.image_url === r2Url, `db=${String(dbOQ?.[0]?.image_url).slice(0, 60)}`)
        check('DB: official_exam_questions.passage_audio_url tersimpan (R2)', dbOQ?.[0]?.passage_audio_url === audioUrl, `db=${String(dbOQ?.[0]?.passage_audio_url).slice(0, 60)}`)
        const oqGet = await api(`/api/official-exams/${oe.id}/questions`, guruTok)
        const oqGetArr = await oqGet.json().catch(() => null)
        const oqRow = Array.isArray(oqGetArr) ? oqGetArr[0] : null
        check('GET official questions → image_url R2 utuh', oqRow?.image_url === r2Url, `got=${String(oqRow?.image_url).slice(0, 60)}`)
        check('GET official questions → passage_audio_url R2 utuh', oqRow?.passage_audio_url === audioUrl, `got=${String(oqRow?.passage_audio_url).slice(0, 60)}`)
    }

    // ════════ [6] AUDIO PASSAGE KUIS: siswa lihat passage_audio_url R2 utuh ════════
    console.log('[6] Kuis: audio passage R2 → siswa lihat utuh')
    const quizAudioRes = await api('/api/quizzes', guruTok, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Kuis Listening`, duration_minutes: 15, teaching_assignment_id: taA.id, is_randomized: false,
            questions: [{
                question_text: 'What did the speaker say?', question_type: 'MULTIPLE_CHOICE',
                options: ['A', 'B'], correct_answer: 'A', points: 10, order_index: 0,
                passage_text: 'Audio listening kuis', passage_audio_url: audioUrl,
            }],
        }),
    })
    const quizAudio = await quizAudioRes.json().catch(() => null)
    check('POST /api/quizzes (soal audio passage) → 200', quizAudioRes.status === 200 && !!quizAudio?.id, `status ${quizAudioRes.status}`)
    if (quizAudio?.id) created.quizzes.push(quizAudio.id)
    const { data: dbAQ } = await supabase.from('quiz_questions').select('id, passage_audio_url').eq('quiz_id', quizAudio.id)
    if (dbAQ?.length) created.questions.push(...dbAQ.map(q => q.id))
    check('DB: quiz_questions.passage_audio_url tersimpan (R2)', dbAQ?.[0]?.passage_audio_url === audioUrl, `db=${String(dbAQ?.[0]?.passage_audio_url).slice(0, 60)}`)

    await api(`/api/quizzes/${quizAudio.id}`, guruTok, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    const startA = await api('/api/quiz-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ quiz_id: quizAudio.id, answers: [] }) })
    const startABody = await startA.json().catch(() => null)
    if (startABody?.id) created.submissions.push(startABody.id)
    check('siswa mulai attempt kuis listening', startA.status === 200, `status ${startA.status}`)
    const aqRes = await api(`/api/quizzes/${quizAudio.id}/questions`, siswaA.token)
    const aqArr = await aqRes.json().catch(() => null)
    const aqRow = Array.isArray(aqArr) ? aqArr[0] : null
    check('siswa melihat passage_audio_url R2 UTUH di soal kuis', aqRow?.passage_audio_url === audioUrl, `got=${String(aqRow?.passage_audio_url).slice(0, 60)}`)

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
