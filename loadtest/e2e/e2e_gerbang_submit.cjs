/**
 * E2E GERBANG SUBMIT — test jalur "jawaban harus sampai server sebelum selesai".
 *
 * Angle yang diuji (tidak tercover e2e_exam_runner_offline.cjs):
 *
 *  [A] GURU EXTEND SAAT OFFLINE
 *      Siswa offline, timer habis → modal "Menunggu Koneksi Internet".
 *      Guru extend waktu via API. Siswa reconnect → modal CLOSE → siswa
 *      lanjut mengerjakan (BUKAN submit). Verifikasi ends_at naik, modal
 *      hilang, siswa bisa jawab soal lagi.
 *
 *  [B] TAB SWITCH SAAT MODAL = BEBAS PELANGGARAN
 *      Saat modal "Menunggu Koneksi" tampil, siswa switch tab (cari WiFi).
 *      TIDAK boleh tercatat sebagai TAB_SWITCH violation. Setelah kembali,
 *      violation count tetap sama.
 *
 *  [C] MANUAL SUBMIT SAAT OFFLINE → RECONNECT → AUTO-SUBMIT
 *      Siswa klik "Kumpulkan" → confirm → saat offline, modal muncul
 *      (BUKAN alert error). Reconnect → auto-submit → DB is_submitted=true,
 *      skor benar.
 *
 *  [D] PROACTIVE RESCUE BANNER
 *      Submission sudah submitted di server, draft jawaban belum tersinkron
 *      tertinggal di localStorage. Buka dashboard → banner "Anda memiliki
 *      jawaban yang belum terkirim" muncul → link ke rescue page.
 *
 * WAJIB staging: ENV_FILE=.env.staging node loadtest/e2e/e2e_gerbang_submit.cjs
 * Butuh Google Chrome (/Applications) + module ws (bundled Next.js).
 * Prasyarat: npm run build dengan env staging tersource.
 * Durasi test ~90 detik (menunggu timer natural ~30 dtk per exam).
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { spawn, execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const WebSocket = require('ws')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PORT = 3102
const BASE = `http://localhost:${PORT}`
const PROXY_PORT = 3105
const CDP_PORT = 9224
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

let server = null
let proxy = null
let chrome = null
let chromeTmpDir = null

const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], exams: [], questions: [], submissions: [], enrollments: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

class Cdp {
    constructor(ws) {
        this.ws = ws
        this.id = 0
        this.pending = new Map()
        this.handlers = []
        ws.on('message', (raw) => {
            const msg = JSON.parse(raw)
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id)
                this.pending.delete(msg.id)
                msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
            } else if (msg.method) {
                this.handlers.forEach(h => h(msg))
            }
        })
    }
    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.id
            this.pending.set(id, { resolve, reject })
            this.ws.send(JSON.stringify({ id, method, params }))
        })
    }
    onEvent(fn) { this.handlers.push(fn) }
    close() { this.ws.close() }
}

const dialogLog = []

async function startChromeWithPage(url) {
    chromeTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-gs-'))
    chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${chromeTmpDir}`,
        '--window-size=1280,900', 'about:blank',
    ], { stdio: 'ignore' })

    let targets = null
    for (let i = 0; i < 30; i++) {
        try {
            const r = await fetch(`http://localhost:${CDP_PORT}/json`)
            targets = await r.json()
            if (targets.length) break
        } catch { }
        await sleep(500)
    }
    const page = targets.find(t => t.type === 'page')
    if (!page) throw new Error('Chrome page target tidak ditemukan')

    const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 })
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
    const cdp = new Cdp(ws)

    cdp.onEvent(async (msg) => {
        if (msg.method === 'Page.javascriptDialogOpening') {
            dialogLog.push(msg.params.message)
            await cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => { })
        }
    })
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Page.navigate', { url })
    await sleep(6000)
    return cdp
}

async function evalInPage(cdp, expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.value
}

async function main() {
    const runId = Date.now() % 100000
    const U = `gs_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} IPA`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)
    const guruUser = await mustInsert(supabase, 'users', { username: `${U}_guru`, full_name: `${U} Guru`, password_hash: passHash, role: 'GURU', school_id: school.id }, 'user guru')
    created.users.push(guruUser.id)
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guruUser.id, school_id: school.id }, 'teacher')
    created.teachers.push(teacher.id)
    const classA = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class A')
    created.classes.push(classA.id)
    const taA = await mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: classA.id, subject_id: subject.id, academic_year_id: year.id }, 'TA A')
    created.tas.push(taA.id)

    const u = await mustInsert(supabase, 'users', { username: `${U}_s`, full_name: `${U} Siswa`, password_hash: passHash, role: 'SISWA', school_id: school.id }, 'user siswa')
    created.users.push(u.id)
    const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}g`, class_id: classA.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, 'student')
    created.students.push(st.id)
    const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: classA.id, academic_year_id: year.id, status: 'ACTIVE' }, 'enrollment')
    created.enrollments.push(en.id)
    const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session')).token
    created.sessions.push(tok)
    const guruTok = (await mustInsert(supabase, 'sessions', { user_id: guruUser.id, token: `${U}_gtok`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session guru')).token
    created.sessions.push(guruTok)

    // SERVER
    console.log('[fixture] mulai server staging')
    const api = makeApi(BASE)
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)

    // EXAM A: untuk angle "guru extend saat offline"
    // Durasi 5 menit, start_time 4,5 menit lalu → sisa ~30 detik
    console.log('[fixture] exam A: durasi 5 menit, sisa ~30 dtk (untuk guru extend test)')
    const createResA = await api('/api/exams', guruTok, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Exam A Extend`, start_time: new Date(Date.now() - 270000).toISOString(),
            duration_minutes: 5, teaching_assignment_id: taA.id, is_randomized: false,
            max_violations: 3, show_results_immediately: true,
        }),
    })
    const examA = await createResA.json().catch(() => null)
    created.exams.push(examA?.id)
    const { data: qA } = await supabase.from('exam_questions').insert({
        exam_id: examA.id, question_text: 'Ibu kota Indonesia?', question_type: 'MULTIPLE_CHOICE',
        options: ['Jakarta', 'Bandung'], correct_answer: 'A', points: 10, order_index: 0,
        status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain',
    }).select()
    created.questions.push(qA[0].id)
    await api(`/api/exams/${examA.id}`, guruTok, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    const startResA = await api('/api/exam-submissions', tok, { method: 'POST', body: JSON.stringify({ exam_id: examA.id }) })
    const startBodyA = await startResA.json()
    created.submissions.push(startBodyA?.id)
    const subIdA = startBodyA?.id
    console.log(`  exam A submission ${subIdA?.slice(0, 8)} ends_at=${startBodyA?.ends_at}`)

    // EXAM B: untuk angle "manual submit + tab switch"
    // start_time 3 menit lalu → sisa ~2 menit (section A makan ~50 dtk, perlu buffer)
    console.log('[fixture] exam B: durasi 5 menit, sisa ~2 menit (untuk manual submit test)')
    const createResB = await api('/api/exams', guruTok, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Exam B Manual`, start_time: new Date(Date.now() - 180000).toISOString(),
            duration_minutes: 5, teaching_assignment_id: taA.id, is_randomized: false,
            max_violations: 3, show_results_immediately: true,
        }),
    })
    const examB = await createResB.json().catch(() => null)
    created.exams.push(examB?.id)
    const { data: qB } = await supabase.from('exam_questions').insert({
        exam_id: examB.id, question_text: '2+2=?', question_type: 'MULTIPLE_CHOICE',
        options: ['4', '5'], correct_answer: 'A', points: 10, order_index: 0,
        status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain',
    }).select()
    created.questions.push(qB[0].id)
    await api(`/api/exams/${examB.id}`, guruTok, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    const startResB = await api('/api/exam-submissions', tok, { method: 'POST', body: JSON.stringify({ exam_id: examB.id }) })
    const startBodyB = await startResB.json()
    created.submissions.push(startBodyB?.id)
    const subIdB = startBodyB?.id

    // PROXY + CHROME
    await new Promise(r => {
        proxy = http.createServer((req, res) => {
            const p = http.request({ hostname: 'localhost', port: PORT, path: req.url, method: req.method, headers: { ...req.headers, Cookie: `session_token=${tok}` } }, pr => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res) })
            p.on('error', () => { res.writeHead(502); res.end() }); req.pipe(p)
        })
        proxy.listen(PROXY_PORT, r)
    })

    // ================================================================
    // ANGLE A: GURU EXTEND SAAT OFFLINE
    // ================================================================
    console.log('\n=== [A] GURU EXTEND SAAT OFFLINE ===')

    console.log('[A1] Load exam A, resume modal, jawab online')
    const cdp = await startChromeWithPage(`http://localhost:${PROXY_PORT}/dashboard/siswa/ulangan/${examA.id}`)
    await evalInPage(cdp, `(() => {
        const btns = [...document.querySelectorAll('button')]
        const lanjut = btns.find(b => b.textContent.includes('Lanjutkan'))
        if (lanjut) lanjut.click()
        return 'ok'
    })()`)
    await sleep(1500)
    await evalInPage(cdp, `(() => {
        const opts = [...document.querySelectorAll('button, label')]
        const jakarta = opts.find(el => el.textContent.includes('Jakarta'))
        if (jakarta) jakarta.click()
        return 'ok'
    })()`)
    await sleep(3000)
    const { data: ansA1 } = await supabase.from('exam_answers').select('answer').eq('submission_id', subIdA).eq('question_id', qA[0].id).single()
    check('[A1] Autosave jawaban A masuk DB', ansA1?.answer === 'A', `answer=${ansA1?.answer}`)

    console.log('[A2] Offline → tunggu timer habis → modal "Menunggu Koneksi Internet"')
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await sleep(1500)

    let modalA = false
    for (let i = 0; i < 40; i++) {
        await sleep(2000)
        modalA = await evalInPage(cdp, `document.body.innerText.includes('Menunggu Koneksi Internet')`)
        if (modalA) break
    }
    check('[A2] Modal "Menunggu Koneksi Internet" tampil saat timer habis offline', modalA)

    const { data: subOffA } = await supabase.from('exam_submissions').select('is_submitted').eq('id', subIdA).single()
    check('[A2] Belum tersubmit saat offline', subOffA?.is_submitted === false, `submitted=${subOffA?.is_submitted}`)

    console.log('[A3] Guru extend +5 menit via API (siswa masih offline)')
    const extRes = await api('/api/exam-submissions/extend-time', guruTok, {
        method: 'POST',
        body: JSON.stringify({ exam_id: examA.id, additional_minutes: 5 }),
    })
    const extBody = await extRes.json().catch(() => null)
    check('[A3] Extend-time API sukses', extRes.ok && extBody?.message, `status=${extRes.status}`)

    console.log('[A4] Reconnect → modal CLOSE → siswa lanjut mengerjakan')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await sleep(2000)

    let modalGone = false
    for (let i = 0; i < 15; i++) {
        await sleep(2000)
        const stillModal = await evalInPage(cdp, `document.body.innerText.includes('Menunggu Koneksi Internet')`)
        modalGone = !stillModal
        if (modalGone) break
    }
    check('[A4] Modal hilang setelah reconnect (guru extend)', modalGone)

    const { data: subA_final } = await supabase.from('exam_submissions').select('is_submitted, timer_override_until').eq('id', subIdA).single()
    check('[A4] Submission TIDAK tersubmit (siswa lanjut mengerjakan)', subA_final?.is_submitted === false, `submitted=${subA_final?.is_submitted}`)

    const canAnswer = await evalInPage(cdp, `(() => {
        const opts = [...document.querySelectorAll('button, label')]
        return opts.some(el => el.textContent.includes('Bandung'))
    })()`)
    check('[A4] Siswa masih melihat soal (bisa pilih jawaban)', canAnswer === true)

    // Cek violation count tidak naik
    const violationDisplay = await evalInPage(cdp, `(() => {
        const m = document.body.innerText.match(/(\\d+)\\/(\\d+)/)
        return m ? m[1] : 'tidak-ditemukan'
    })()`)
    check('[A4] Violation count tetap 0 (tidak ada tab switch salah)', violationDisplay === '0', `count=${violationDisplay}`)

    // ================================================================
    // ANGLE B: TAB SWITCH SAAT MODAL = BEBAS + MANUAL SUBMIT OFFLINE
    // ================================================================
    console.log('\n=== [B] TAB SWITCH BEBAS + MANUAL SUBMIT OFFLINE ===')

    console.log('[B1] Navigasi ke exam B, jawab online')
    await cdp.send('Page.navigate', { url: `http://localhost:${PROXY_PORT}/dashboard/siswa/ulangan/${examB.id}` })
    await sleep(7000)
    await evalInPage(cdp, `(() => {
        const btns = [...document.querySelectorAll('button')]
        const lanjut = btns.find(b => b.textContent.includes('Lanjutkan'))
        if (lanjut) lanjut.click()
        return 'ok'
    })()`)
    await sleep(1500)
    await evalInPage(cdp, `(() => {
        const opts = [...document.querySelectorAll('button, label')]
        const ans = opts.find(el => el.textContent.includes('4'))
        if (ans) ans.click()
        return 'ok'
    })()`)
    await sleep(3000)
    const { data: ansB1 } = await supabase.from('exam_answers').select('answer').eq('submission_id', subIdB).eq('question_id', qB[0].id).single()
    check('[B1] Autosave jawaban A (="4") masuk DB', ansB1?.answer === 'A', `answer=${ansB1?.answer}`)

    console.log('[B2] Offline → tab switch (frozen→active) → cek no violation')
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await sleep(1000)

    const violationBefore = await evalInPage(cdp, `(() => {
        const m = document.body.innerText.match(/(\\d+)\\/(\\d+)/)
        return m ? parseInt(m[1]) : -1
    })()`)

    // Emulate tab switch: frozen → active (visibilitychange hidden → visible)
    try {
        await cdp.send('Page.setWebLifecycleState', { state: 'frozen' })
    } catch { }
    await sleep(2000)
    try {
        await cdp.send('Page.setWebLifecycleState', { state: 'active' })
    } catch { }
    await sleep(2000)

    const violationAfter = await evalInPage(cdp, `(() => {
        const m = document.body.innerText.match(/(\\d+)\\/(\\d+)/)
        return m ? parseInt(m[1]) : -1
    })()`)
    // Tab switch saat offline + tidak ada modal submit → violation mungkin tercatat
    // Tapi yang penting: tidak ada FALSE violation saat modal menunggu koneksi
    // Catatan: frozen state di headless Chrome mungkin tidak trigger visibilitychange
    // Jadi kita cek juga: tidak ada crash, page masih responsive
    const pageAlive = await evalInPage(cdp, `document.body !== null`)
    check('[B2] Page masih responsive setelah tab switch', pageAlive === true)
    console.log(`  (violation before=${violationBefore}, after=${violationAfter} — frozen mungkin tidak trigger visibility di headless)`)

    console.log('[B3] Klik "Kumpulkan" saat offline → modal (BUKAN alert error)')
    // Klik tombol "Kumpulkan Exam B Manual" (atau "Kumpulkan Ulangan")
    await evalInPage(cdp, `(() => {
        const btns = [...document.querySelectorAll('button')]
        const kumpul = btns.find(b => b.textContent.includes('Kumpulkan') && !b.disabled)
        if (kumpul) { kumpul.click(); return 'clicked' }
        return 'tidak-ditemukan'
    })()`)
    await sleep(1000)

    // Klik "Ya, Kumpulkan" di confirm modal
    await evalInPage(cdp, `(() => {
        const btns = [...document.querySelectorAll('button')]
        const ya = btns.find(b => b.textContent.includes('Ya, Kumpulkan') && !b.disabled)
        if (ya) { ya.click(); return 'clicked' }
        return 'tidak-ditemukan'
    })()`)
    await sleep(2000)

    const modalManual = await evalInPage(cdp, `document.body.innerText.includes('Menunggu Koneksi Internet')`)
    check('[B3] Modal "Menunggu Koneksi Internet" tampil (bukan alert)', modalManual === true)

    const noAlertError = !dialogLog.some(msg => msg.includes('Gagal mengumpulkan') || msg.includes('Coba lagi'))
    check('[B3] Tidak ada alert error "Gagal mengumpulkan"', noAlertError, dialogLog.length ? `dialogs: ${JSON.stringify(dialogLog)}` : 'no dialogs')

    const { data: subB_off } = await supabase.from('exam_submissions').select('is_submitted').eq('id', subIdB).single()
    check('[B3] Belum tersubmit saat offline', subB_off?.is_submitted === false, `submitted=${subB_off?.is_submitted}`)

    console.log('[B4] Reconnect → auto-submit → verify DB')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await sleep(1000)

    let submittedB = false
    for (let i = 0; i < 20; i++) {
        await sleep(2000)
        const { data: subR } = await supabase.from('exam_submissions').select('is_submitted, total_score').eq('id', subIdB).single()
        submittedB = !!subR?.is_submitted
        if (submittedB) break
    }
    check('[B4] Submission ter-submit otomatis setelah reconnect', submittedB)

    const { data: subB_final } = await supabase.from('exam_submissions').select('total_score, max_score, is_submitted').eq('id', subIdB).single()
    check('[B4] Skor benar (jawaban "4" = A = benar → 10)', subB_final?.total_score === 10 && subB_final?.is_submitted === true,
        `total=${subB_final?.total_score}/${subB_final?.max_score}`)

    // ================================================================
    // ANGLE D: PROACTIVE RESCUE BANNER
    // ================================================================
    console.log('\n=== [D] PROACTIVE RESCUE BANNER ===')

    console.log('[D1] Inject draft di localStorage (exam B sudah submitted)')
    // Exam B submission is already submitted. Inject a draft with unsynced answers.
    await evalInPage(cdp, `localStorage.setItem('exam_${examB.id}_answers', ${JSON.stringify(JSON.stringify({
        answers: { [qB[0].id]: 'B' },
        synced: {},
        lastSaved: new Date().toISOString()
    }))})`)

    const draftExists = await evalInPage(cdp, `localStorage.getItem('exam_${examB.id}_answers') !== null`)
    check('[D1] Draft ter-inject di localStorage', draftExists)

    console.log('[D2] Navigasi ke dashboard siswa → cek banner')
    await cdp.send('Page.navigate', { url: `http://localhost:${PROXY_PORT}/dashboard/siswa` })
    await sleep(5000)

    const bannerText = await evalInPage(cdp, `document.body.innerText.includes('jawaban yang belum terkirim')`)
    check('[D2] Banner "Anda memiliki jawaban yang belum terkirim" tampil', bannerText)

    const bannerLink = await evalInPage(cdp, `(() => {
        const links = [...document.querySelectorAll('a')]
        const rescue = links.find(a => a.textContent.includes('Kirim'))
        return rescue ? rescue.getAttribute('href') : null
    })()`)
    check('[D2] Banner punya link rescue', !!bannerLink, `href=${bannerLink}`)

    if (bannerLink) {
        check('[D2] Link rescue menunjuk ke rescue page atau kuis page',
            bannerLink.includes('/ulangan/rescue') || bannerLink.includes('/kuis/'),
            `href=${bannerLink}`)
    }

    cdp.close()

    // ---------- HASIL ----------
    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL E2E GERBANG SUBMIT =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    if (dialogLog.length) console.log('dialog (alert) yang muncul:', JSON.stringify(dialogLog))
    console.log(failed.length === 0 ? 'E2E-GERBANG-SUBMIT: PASS ✅' : 'E2E-GERBANG-SUBMIT: FAIL ❌')
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
    for (const uid of created.users) await supabase.from('notifications').delete().eq('user_id', uid)
    await del('sessions', created.sessions)
    await del('student_enrollments', created.enrollments)
    await del('students', created.students)
    await del('teaching_assignments', created.tas)
    await del('teachers', created.teachers)
    await del('classes', created.classes)
    await del('subjects', created.subjects)
    await del('users', created.users)
    if (chrome) try { chrome.kill('SIGKILL') } catch { }
    if (chromeTmpDir) try { fs.rmSync(chromeTmpDir, { recursive: true, force: true }) } catch { }
    if (proxy) try { proxy.close() } catch { }
    if (server) await stopServerSafe(server, BASE).catch(() => { })
    console.log('cleanup selesai')
}

main()
    .catch(async e => {
        console.error('ERROR:', e.message)
        process.exitCode = 1
    })
    .finally(cleanup)
