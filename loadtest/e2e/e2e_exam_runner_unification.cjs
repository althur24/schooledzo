/**
 * E2E UNIFIKASI RUANG UJIAN (ExamRunner) — ulangan & UTS/UAS kini SATU komponen
 * (src/components/exam/runner). Refactor ini menyentuh halaman siswa, jadi
 * script ini memverifikasi KONTRAK yang dipakai runner baru + RENDER BROWSER NYATA:
 *
 *  [Q-AUDIO] GET official-exams questions mengembalikan passage_audio_url
 *            (dipakai audio group di runner uts-uas — dulu tidak dimuat) dan
 *            correct_answer tetap disembunyikan dari siswa pra-submit.
 *  [FLOW]    UTS/UAS siswa: start → autosave → submit → skor otomatis
 *            (jalur yang sama persis dengan runner ulangan pasca-unifikasi).
 *  [RESULT]  Bentuk data GET official-exam-submissions yang dikonsumsi halaman
 *            hasil baru: exam.subject.name, exam.exam_type, results_hidden,
 *            total/max_score, violation_count, submitted_at.
 *  [HIDDEN]  show_results_immediately=false → results_hidden=true + skor
 *            di-null server (halaman hasil menampilkan "Menunggu Hasil").
 *  [CLASS]   Siswa di luar target_class_ids ditolak 403 saat start.
 *  [RENDER]  Chrome headless (via proxy injeksi cookie) me-load halaman siswa
 *            sungguhan — hydration + fetch + render ExamRunner terverifikasi:
 *            - uts-uas/[id]: soal tampil, fullscreen enforcer, navigator, matriks
 *              KaTeX ter-render TANPA bocor "amp;" (regresi fix matriks di DOM nyata)
 *            - ulangan/[id]: idem (runner sama, config beda)
 *            - uts-uas/[id]/hasil (halaman BARU): skor + statistik tampil
 *
 * WAJIB staging: ENV_FILE=.env.staging node loadtest/e2e/e2e_exam_runner_unification.cjs
 * (build .next dengan env staging lebih dulu — assertServerDb menjaga.)
 * Butuh Google Chrome di /Applications (headless). Tanpa Chrome: [RENDER] skip.
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { execFile, spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PORT = 3101
const BASE = `http://localhost:${PORT}`
const PROXY_PORT = 3103
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const hasChrome = fs.existsSync(CHROME)

let server = null
let proxy = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], exams: [], questions: [], submissions: [],
    officialExams: [], officialQuestions: [], officialSubmissions: [],
    enrollments: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

/** Proxy injeksi cookie — Chrome headless tidak bisa set cookie sendiri. */
function startProxy(sessionToken) {
    return new Promise((resolve) => {
        proxy = http.createServer((req, res) => {
            const opts = {
                hostname: 'localhost', port: PORT, path: req.url, method: req.method,
                headers: { ...req.headers, Cookie: `session_token=${sessionToken}` },
            }
            const p = http.request(opts, (pr) => {
                res.writeHead(pr.statusCode, pr.headers)
                pr.pipe(res)
            })
            p.on('error', () => { res.writeHead(502); res.end() })
            req.pipe(p)
        })
        proxy.listen(PROXY_PORT, () => resolve())
    })
}

/** Dump DOM hasil render Chrome headless (setelah hydration + virtual time). */
function dumpDom(urlPath) {
    return new Promise((resolve, reject) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-e2e-'))
        execFile(CHROME, [
            '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
            '--hide-scrollbars', '--window-size=1280,900',
            `--user-data-dir=${tmpDir}`,
            '--virtual-time-budget=10000',
            '--dump-dom',
            `http://localhost:${PROXY_PORT}${urlPath}`,
        ], { maxBuffer: 64 * 1024 * 1024, timeout: 90000 }, (err, stdout, stderr) => {
            fs.rmSync(tmpDir, { recursive: true, force: true })
            if (err) reject(new Error(`Chrome gagal: ${err.message} ${String(stderr).slice(0, 200)}`))
            else resolve(stdout)
        })
    })
}

async function main() {
    const runId = Date.now() % 100000
    const U = `ru_${runId}`
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
    const siswaA = await mkStudent('a', classA) // kelas target
    const siswaB = await mkStudent('b', classB) // kelas lain

    console.log('fixtures OK (guru, 2 siswa beda kelas, TA, tahun aktif)')

    // ---------- START SERVER (mewarisi env staging) ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ---------- UJIAN 1: UTS aktif + audio group + hasil langsung ----------
    console.log('[1] Buat UTS (aktif, audio group, show_results_immediately=true)')
    const startAt = new Date(Date.now() - 5 * 60000).toISOString()
    const windowEnd = new Date(Date.now() + 2 * 3600000).toISOString()
    const exam1 = await mustInsert(supabase, 'official_exams', {
        school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
        exam_type: 'UTS', title: `${U} UTS Runner`, description: 'e2e unifikasi',
        start_time: startAt, duration_minutes: 30, window_end_time: windowEnd,
        is_randomized: false, max_violations: 3, target_class_ids: [classA.id],
        created_by: guruUser.id, is_active: true, show_results_immediately: true,
    }, 'official exam 1')
    created.officialExams.push(exam1.id)

    // Soal: 1 MC + 2 soal audio group (sama passage_audio_url) + 1 essay — max 40
    const AUDIO_URL = `https://example.com/${U}_listening.mp3`
    const qRows = [
        { exam_id: exam1.id, question_text: 'MC biasa', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: exam1.id, question_text: 'Listening essay', question_type: 'ESSAY', options: null, correct_answer: null, points: 10, order_index: 1, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain', passage_text: `${U} bacaan listening`, passage_audio_url: AUDIO_URL },
        { exam_id: exam1.id, question_text: 'Listening MC', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1'], correct_answer: 'A', points: 10, order_index: 2, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain', passage_text: `${U} bacaan listening`, passage_audio_url: AUDIO_URL },
        { exam_id: exam1.id, question_text: 'Essay bebas', question_type: 'ESSAY', options: null, correct_answer: null, points: 10, order_index: 3, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
    ]
    const { data: insertedQs, error: qInsErr } = await supabase.from('official_exam_questions').insert(qRows).select()
    if (qInsErr) throw new Error('Insert official_exam_questions gagal: ' + qInsErr.message)
    created.officialQuestions.push(...insertedQs.map(q => q.id))
    const mcId = insertedQs.find(q => q.question_text === 'MC biasa').id
    const audioMcId = insertedQs.find(q => q.question_text === 'Listening MC').id
    const audioEssayId = insertedQs.find(q => q.question_text === 'Listening essay').id
    check('4 soal tersimpan (2 di antaranya audio group)', insertedQs.length === 4, `n=${insertedQs.length}`)

    // ---------- 2. [Q-AUDIO] kontrak questions API untuk runner ----------
    console.log('[2] [Q-AUDIO] Questions API: passage_audio_url ikut, kunci disembunyikan')
    const qRes = await api(`/api/official-exams/${exam1.id}/questions`, siswaA.token)
    const qBody = await qRes.json().catch(() => null)
    const qArr = Array.isArray(qBody) ? qBody : []
    const audioQs = qArr.filter(q => q.passage_audio_url === AUDIO_URL)
    const leaked = qArr.filter(q => q.correct_answer !== undefined)
    check('GET questions 200 + 4 soal', qRes.status === 200 && qArr.length === 4, `status=${qRes.status} n=${qArr.length}`)
    check('passage_audio_url tersedia untuk siswa (audio group runner uts-uas)', audioQs.length === 2, `n=${audioQs.length}`)
    check('correct_answer TIDAK bocor pra-submit', leaked.length === 0, `leaked=${leaked.length}`)

    // ---------- 3. [CLASS] kelas lain ditolak ----------
    console.log('[3] [CLASS] Siswa kelas lain ditolak start')
    const wrongStart = await api('/api/official-exam-submissions', siswaB.token, { method: 'POST', body: JSON.stringify({ exam_id: exam1.id }) })
    check('Start siswa luar target → 403', wrongStart.status === 403, `status=${wrongStart.status}`)

    // ---------- 4. [FLOW] start → autosave → submit ----------
    console.log('[4] [FLOW] Siswa kelas target: start → autosave → submit')
    const start = await api('/api/official-exam-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ exam_id: exam1.id }) })
    const startBody = await start.json().catch(() => null)
    check('Start 200 + kontrak waktu (started_at/ends_at/server_time)', start.status === 200 && !!startBody?.id && !!startBody?.started_at && startBody?.ends_at !== undefined && !!startBody?.server_time, `status=${start.status}`)
    check('question_order 4 entri (runner mengurutkan soal darinya)', Array.isArray(startBody?.question_order) && startBody.question_order.length === 4, `n=${startBody?.question_order?.length}`)
    created.officialSubmissions.push(startBody?.id)
    const subId = startBody?.id

    const saveRes = await api('/api/official-exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: subId, answers: [{ question_id: mcId, answer: 'A' }] }),
    })
    check('Autosave sukses', saveRes.status === 200, `status=${saveRes.status}`)

    const submitRes = await api('/api/official-exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: subId, submit: true,
            answers: [
                { question_id: mcId, answer: 'A' },           // benar 10
                { question_id: audioEssayId, answer: 'esai' }, // pending
                { question_id: audioMcId, answer: 'B' },       // salah (kunci A)
            ],
        }),
    })
    const submitBody = await submitRes.json().catch(() => null)
    check('Submit 200 + total_score=10 (MC benar; MC audio salah; essay pending)', submitRes.status === 200 && submitBody?.total_score === 10, `status=${submitRes.status} total=${submitBody?.total_score}`)
    check('submitted_at terisi', !!submitBody?.submitted_at)

    // ---------- 5. [RESULT] bentuk data untuk halaman hasil baru ----------
    console.log('[5] [RESULT] GET submissions (dipakai halaman uts-uas/[id]/hasil)')
    const subListRes = await api(`/api/official-exam-submissions?exam_id=${exam1.id}`, siswaA.token)
    const subList = await subListRes.json().catch(() => null)
    const sub = Array.isArray(subList) ? subList[0] : null
    check('Submissions list 200 + 1 baris milik siswa', subListRes.status === 200 && !!sub, `status=${subListRes.status}`)
    check('embed exam.subject.name (header hasil)', !!sub?.exam?.subject?.name, `subject=${sub?.exam?.subject?.name}`)
    check('embed exam.exam_type (judul hasil via labelForGradeType)', sub?.exam?.exam_type === 'UTS', `type=${sub?.exam?.exam_type}`)
    check('results_hidden=false (show_results_immediately)', sub?.results_hidden === false, `hidden=${sub?.results_hidden}`)
    check('skor utuh (total 10 / max 40 / violation 0 / is_submitted)', sub?.total_score === 10 && sub?.max_score === 40 && sub?.violation_count === 0 && sub?.is_submitted === true,
        `total=${sub?.total_score} max=${sub?.max_score} viol=${sub?.violation_count}`)

    // ---------- 6. [HIDDEN] show_results_immediately=false ----------
    console.log('[6] [HIDDEN] UTS kedua: hasil ditahan → results_hidden=true + skor null')
    const exam2 = await mustInsert(supabase, 'official_exams', {
        school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
        exam_type: 'UAS', title: `${U} UAS Hidden`, description: null,
        start_time: startAt, duration_minutes: 30, window_end_time: windowEnd,
        is_randomized: false, max_violations: 3, target_class_ids: [classA.id],
        created_by: guruUser.id, is_active: true, show_results_immediately: false,
    }, 'official exam 2')
    created.officialExams.push(exam2.id)
    const { data: q2 } = await supabase.from('official_exam_questions').insert({
        exam_id: exam2.id, question_text: 'MC hidden', question_type: 'MULTIPLE_CHOICE',
        options: ['A1', 'B1'], correct_answer: 'A', points: 10, order_index: 0,
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    }).select()
    created.officialQuestions.push(q2[0].id)

    const start2 = await api('/api/official-exam-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ exam_id: exam2.id }) })
    const start2Body = await start2.json().catch(() => null)
    created.officialSubmissions.push(start2Body?.id)
    await api('/api/official-exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: start2Body?.id, submit: true, answers: [{ question_id: q2[0].id, answer: 'A' }] }),
    })
    const sub2List = await (await api(`/api/official-exam-submissions?exam_id=${exam2.id}`, siswaA.token)).json().catch(() => null)
    const sub2 = Array.isArray(sub2List) ? sub2List[0] : null
    check('results_hidden=true + skor di-null server (halaman hasil → "Menunggu Hasil")', sub2?.results_hidden === true && sub2?.total_score === null,
        `hidden=${sub2?.results_hidden} total=${sub2?.total_score}`)

    // ---------- 7. [RENDER] Chrome headless: halaman siswa render NYATA ----------
    console.log('[7] [RENDER] Chrome headless me-load halaman siswa (hydration + fetch + render)')
    if (!hasChrome) {
        console.log('  ⚠ Google Chrome tidak ditemukan — [RENDER] dilewati (bukan fail)')
    } else {
        // Fixture render: UTS segelap apa pun tidak boleh — exam3 official fresh (belum dikerjakan siapa pun)
        const MATRIX_HTML = `<p>Determinan matriks $\\begin{bmatrix} a &amp; b &amp; c \\\\ d &amp; e &amp; f \\\\ g &amp; h &amp; i \\end{bmatrix}$ adalah...</p>`
        const exam3 = await mustInsert(supabase, 'official_exams', {
            school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
            exam_type: 'UTS', title: `${U} UTS Render`, description: null,
            start_time: startAt, duration_minutes: 30, window_end_time: windowEnd,
            is_randomized: false, max_violations: 3, target_class_ids: [classA.id],
            created_by: guruUser.id, is_active: true, show_results_immediately: true,
        }, 'official exam 3 (render)')
        created.officialExams.push(exam3.id)
        // Matriks sengaja di urutan PERTAMA — view paginated hanya merender soal aktif
        const { data: q3 } = await supabase.from('official_exam_questions').insert([
            { exam_id: exam3.id, question_text: MATRIX_HTML, question_type: 'MULTIPLE_CHOICE', options: ['<p>opsi 1</p>', '<p>opsi 2</p>'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'html' },
            { exam_id: exam3.id, question_text: 'MC render B', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1'], correct_answer: 'A', points: 10, order_index: 1, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'html' },
        ]).select()
        created.officialQuestions.push(...q3.map(q => q.id))

        // Fixture render: ulangan biasa (exam3 regular) — runner yang sama, config beda
        const guruTok2 = (await mustInsert(supabase, 'sessions', { user_id: guruUser.id, token: `${U}_tok_guru2`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session guru 2')).token
        created.sessions.push(guruTok2)
        const createUlg = await api('/api/exams', guruTok2, {
            method: 'POST',
            body: JSON.stringify({
                title: `${U} Ulangan Render`, description: null, start_time: startAt,
                duration_minutes: 30, teaching_assignment_id: taA.id, is_randomized: false,
                max_violations: 3, show_results_immediately: true,
            }),
        })
        const ulgExam = await createUlg.json().catch(() => null)
        created.exams.push(ulgExam?.id)
        const { data: qUlg } = await supabase.from('exam_questions').insert({
            exam_id: ulgExam.id, question_text: MATRIX_HTML, question_type: 'MULTIPLE_CHOICE',
            options: ['<p>opsi 1</p>', '<p>opsi 2</p>'], correct_answer: 'A', points: 10, order_index: 0,
            status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'html',
        }).select()
        created.questions.push(...qUlg.map(q => q.id))
        await api(`/api/exams/${ulgExam.id}`, guruTok2, { method: 'PUT', body: JSON.stringify({ is_active: true }) })

        await startProxy(siswaA.token)
        console.log(`  proxy cookie-injector up :${PROXY_PORT}`)

        // 7a. Halaman UTS/UAS (runner + config official)
        // Catatan asersi: "amp;" yang sah memang ada di DOM (URL Google Fonts
        // &display=swap, annotation MathML KaTeX) — tanda tangan bug lama yang
        // spesifik adalah sel "amp;b"/"amp;c" dari matriks yang bocor.
        const domUts = await dumpDom(`/dashboard/siswa/uts-uas/${exam3.id}`).catch(e => { console.error('  Chrome error:', e.message); return '' })
        check('[RENDER] uts-uas/[id]: soal matriks (pertama) tampil', domUts.includes('Determinan'), `len=${domUts.length}`)
        check('[RENDER] uts-uas/[id]: fullscreen enforcer aktif', domUts.includes('Layar Penuh Diwajibkan'))
        check('[RENDER] uts-uas/[id]: navigator soal dirender', domUts.includes('Navigasi'))
        check('[RENDER] uts-uas/[id]: matriks ter-render KaTeX', domUts.includes('class="katex"'), `katex=${domUts.includes('class="katex"')}`)
        check('[RENDER] uts-uas/[id]: sel matriks BERSIH (tanpa amp;b/amp;c — regresi fix)', !domUts.includes('amp;b') && !domUts.includes('amp;c'))

        // 7b. Halaman ulangan (runner yang sama, config exam_*)
        const domUlg = await dumpDom(`/dashboard/siswa/ulangan/${ulgExam.id}`).catch(e => { console.error('  Chrome error:', e.message); return '' })
        check('[RENDER] ulangan/[id]: runner render soal matriks', domUlg.includes('Determinan') && domUlg.includes('class="katex"'), `len=${domUlg.length}`)
        check('[RENDER] ulangan/[id]: fullscreen enforcer aktif', domUlg.includes('Layar Penuh Diwajibkan'))
        check('[RENDER] ulangan/[id]: sel matriks BERSIH (tanpa amp;b/amp;c)', !domUlg.includes('amp;b') && !domUlg.includes('amp;c'))

        // 7c. Halaman hasil BARU uts-uas (exam1: skor terlihat)
        const domHsl = await dumpDom(`/dashboard/siswa/uts-uas/${exam1.id}/hasil`).catch(e => { console.error('  Chrome error:', e.message); return '' })
        check('[RENDER] uts-uas/[id]/hasil (BARU): judul + skor tampil', domHsl.includes('Hasil UTS') && domHsl.includes('25%'), `len=${domHsl.length}`)
        check('[RENDER] hasil: statistik (Waktu Pengerjaan/Pelanggaran) tampil', domHsl.includes('Waktu Pengerjaan') && domHsl.includes('Pelanggaran'))

        // Submission yang dibuat oleh render halaman (untuk cleanup)
        const { data: renderSubsOfficial } = await supabase.from('official_exam_submissions').select('id').eq('exam_id', exam3.id).eq('student_id', siswaA.student.id)
        created.officialSubmissions.push(...(renderSubsOfficial || []).map(s => s.id))
        const { data: renderSubsExam } = await supabase.from('exam_submissions').select('id').eq('exam_id', ulgExam.id).eq('student_id', siswaA.student.id)
        created.submissions.push(...(renderSubsExam || []).map(s => s.id))

        proxy.close()
    }

    // ---------- HASIL ----------
    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL E2E UNIFIKASI EXAMRUNNER =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'E2E-RUNNER-UNIFICATION: PASS ✅' : 'E2E-RUNNER-UNIFICATION: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : null
    const delBy = (t, col, ids) => ids.length ? supabase.from(t).delete().in(col, ids) : null
    await delBy('exam_answers', 'submission_id', created.submissions)
    await del('exam_submissions', created.submissions)
    await del('exam_questions', created.questions)
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
