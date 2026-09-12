/**
 * E2E OFFLINE RUANG UJIAN (ExamRunner) — simulasi jaringan mati NYATA via
 * Chrome DevTools Protocol (Network.emulateNetworkConditions offline=true),
 * bukan sekadar mock fetch. Menguji jalur offline yang di-port ke runner:
 *
 *  [ONLINE]   Siswa kerja online: klik jawaban → autosave 1.5 dtk → tersimpan DB.
 *  [OFF-BANNER] emulateNetworkConditions offline → navigator.onLine=false →
 *             banner merah "Koneksi terputus" muncul.
 *  [OFF-DRAFT] Ganti jawaban saat offline → draft masuk localStorage
 *             (exam_${id}_answers), TIDAK ke server.
 *  [OFF-TIMEOUT] Timer habis saat offline (durasi 1 menit) → modal
 *             "Waktu Habis (Offline)" muncul — jalur yang dulu cuma ada di
 *             ulangan, kini juga di UTS/UAS via runner.
 *  [ON-RECOVERY] Kembali online → event 'online' → syncLocalToServer dengan
 *             isTimeUp → submit OTOMATIS → redirect halaman hasil → DB
 *             is_submitted + total_score benar.
 *
 * WAJIB staging: ENV_FILE=.env.staging node loadtest/e2e/e2e_exam_runner_offline.cjs
 * Butuh Google Chrome (/Applications) + module ws (bundled Next.js).
 * Durasi test ~2 menit (menunggu timer natural 1 menit).
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

const PORT = 3101
const BASE = `http://localhost:${PORT}`
const PROXY_PORT = 3104
const CDP_PORT = 9223
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

/** Client CDP minimal: send command + tunggu hasil; listener event via onEvent. */
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

async function startChromeWithPage(url) {
    chromeTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-off-'))
    chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${chromeTmpDir}`,
        '--window-size=1280,900', 'about:blank',
    ], { stdio: 'ignore' })

    // tunggu DevTools endpoint siap
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

    // Auto-dismiss alert()/confirm() — alert runner akan mem-block dump kalau tidak
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
    // tunggu load + hydration (fetch data + render)
    await sleep(6000)
    return cdp
}

const dialogLog = []

/** Evaluasi ekspresi di page; return value JSON-serializable. */
async function evalInPage(cdp, expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.value
}

async function main() {
    const runId = Date.now() % 100000
    const U = `of_${runId}`
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
    const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}o`, class_id: classA.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, 'student')
    created.students.push(st.id)
    const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: classA.id, academic_year_id: year.id, status: 'ACTIVE' }, 'enrollment')
    created.enrollments.push(en.id)
    const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session')).token
    created.sessions.push(tok)
    const guruTok = (await mustInsert(supabase, 'sessions', { user_id: guruUser.id, token: `${U}_gtok`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session guru')).token
    created.sessions.push(guruTok)

    // Ulangan durasi 1 MENIT — timer habis alami saat fase offline
    console.log('[fixture] ulangan durasi 1 menit, 1 soal MC (kunci A)')
    const api = makeApi(BASE)
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)

    const createRes = await api('/api/exams', guruTok, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Ulangan Offline`, start_time: new Date(Date.now() - 30000).toISOString(),
            duration_minutes: 1, teaching_assignment_id: taA.id, is_randomized: false,
            max_violations: 3, show_results_immediately: true,
        }),
    })
    const exam = await createRes.json().catch(() => null)
    created.exams.push(exam?.id)
    const { data: q } = await supabase.from('exam_questions').insert({
        exam_id: exam.id, question_text: 'Ibu kota Indonesia?', question_type: 'MULTIPLE_CHOICE',
        options: ['Jakarta', 'Bandung'], correct_answer: 'A', points: 10, order_index: 0,
        status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain',
    }).select()
    created.questions.push(q[0].id)
    await api(`/api/exams/${exam.id}`, guruTok, { method: 'PUT', body: JSON.stringify({ is_active: true }) })

    // Pre-start via API supaya started_at deterministik (sisa waktu ~60 dtk)
    const startRes = await api('/api/exam-submissions', tok, { method: 'POST', body: JSON.stringify({ exam_id: exam.id }) })
    const startBody = await startRes.json()
    created.submissions.push(startBody?.id)
    const subId = startBody?.id
    console.log(`  submission ${subId?.slice(0, 8)} started; ends_at=${startBody?.ends_at}`)

    // ---------- PROXY + CHROME ----------
    await new Promise(r => {
        proxy = http.createServer((req, res) => {
            const p = http.request({ hostname: 'localhost', port: PORT, path: req.url, method: req.method, headers: { ...req.headers, Cookie: `session_token=${tok}` } }, pr => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res) })
            p.on('error', () => { res.writeHead(502); res.end() }); req.pipe(p)
        })
        proxy.listen(PROXY_PORT, r)
    })

    console.log('\n[1] [ONLINE] load halaman → resume modal (pre-start) → lanjutkan → jawab → autosave')
    const cdp = await startChromeWithPage(`http://localhost:${PROXY_PORT}/dashboard/siswa/ulangan/${exam.id}`)

    // Resume modal muncul karena elapsed > 10 dtk → klik Lanjutkan
    const resumeOk = await evalInPage(cdp, `(async () => {
        const btns = [...document.querySelectorAll('button')]
        const lanjut = btns.find(b => b.textContent.includes('Lanjutkan'))
        if (!lanjut) return 'modal-tidak-ada'
        lanjut.click(); return 'clicked'
    })()`)
    await sleep(1500)
    check('Resume modal tampil dan bisa dilanjutkan', resumeOk === 'clicked' || resumeOk === 'modal-tidak-ada', resumeOk)

    // Klik jawaban A (opsi pertama)
    const clickA = await evalInPage(cdp, `(() => {
        const opts = [...document.querySelectorAll('button, label')]
        const jakarta = opts.find(el => el.textContent.includes('Jakarta'))
        if (!jakarta) return 'opsi-tidak-ditemukan'
        jakarta.click(); return 'clicked'
    })()`)
    check('Klik jawaban "Jakarta" (online)', clickA === 'clicked', clickA)

    // Tunggu debounce autosave 1.5 dtk + margin, lalu cek DB
    await sleep(3500)
    const { data: ans1 } = await supabase.from('exam_answers').select('answer').eq('submission_id', subId).eq('question_id', q[0].id).single()
    check('[ONLINE] Autosave masuk DB (answer=A)', ans1?.answer === 'A', `answer=${ans1?.answer}`)

    // ---------- OFFLINE ----------
    console.log('\n[2] [OFF-BANNER] emulateNetworkConditions offline=true')
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await sleep(1500)
    const offlineNav = await evalInPage(cdp, `navigator.onLine`)
    const banner = await evalInPage(cdp, `document.body.innerText.includes('Koneksi terputus')`)
    check('navigator.onLine = false (emulasi offline aktif)', offlineNav === false)
    check('[OFF-BANNER] Banner merah "Koneksi terputus" tampil', banner === true)

    console.log('\n[3] [OFF-DRAFT] ganti jawaban saat offline → draft lokal, bukan server')
    const clickB = await evalInPage(cdp, `(() => {
        const opts = [...document.querySelectorAll('button, label')]
        const bandung = opts.find(el => el.textContent.includes('Bandung'))
        if (!bandung) return 'opsi-tidak-ditemukan'
        bandung.click(); return 'clicked'
    })()`)
    check('Klik jawaban "Bandung" (offline)', clickB === 'clicked', clickB)
    await sleep(1000)

    const draftRaw = await evalInPage(cdp, `localStorage.getItem('exam_${exam.id}_answers')`)
    let draft = null
    try { draft = JSON.parse(draftRaw) } catch { }
    check('Draft tersimpan di localStorage (exam_${id}_answers)', !!draft?.answers && draft.answers[q[0].id] === 'B', `draft=${draftRaw ? 'ada' : 'null'}`)

    const { data: ans2 } = await supabase.from('exam_answers').select('answer').eq('submission_id', subId).eq('question_id', q[0].id).single()
    check('Server MASIH answer=A (perubahan offline belum terkirim)', ans2?.answer === 'A', `answer=${ans2?.answer}`)

    // ---------- TIMER HABIS SAAT OFFLINE ----------
    console.log('\n[4] [OFF-TIMEOUT] tunggu timer habis saat offline → modal "Waktu Habis (Offline)"')
    // ends_at ≈ start + 60 dtk; sudah terpakai ~20 dtk → tunggu maks 55 dtk
    let modalMuncul = false
    for (let i = 0; i < 40; i++) {
        await sleep(2000)
        modalMuncul = await evalInPage(cdp, `document.body.innerText.includes('Waktu Habis (Offline)')`)
        if (modalMuncul) break
    }
    check('Modal "Waktu Habis (Offline)" tampil (timer habis + offline)', modalMuncul)

    // Pastikan TIDAK auto-submit saat offline (fetch pasti gagal → draft tetap)
    const { data: subOff } = await supabase.from('exam_submissions').select('is_submitted').eq('id', subId).single()
    check('Belum tersubmit saat offline (draft menunggu recovery)', subOff?.is_submitted === false, `submitted=${subOff?.is_submitted}`)

    // ---------- RECOVERY ----------
    console.log('\n[5] [ON-RECOVERY] online kembali → auto-submit recovery')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await sleep(1000)

    let submitted = false
    let redirectOk = false
    for (let i = 0; i < 20; i++) {
        await sleep(2000)
        const { data: subR } = await supabase.from('exam_submissions').select('is_submitted, total_score').eq('id', subId).single()
        submitted = !!subR?.is_submitted
        if (submitted) break
    }
    check('Submission ter-submit otomatis setelah online (isTimeUp → submit:true)', submitted)

    const { data: subFinal } = await supabase.from('exam_submissions').select('total_score, max_score, is_submitted, submitted_at').eq('id', subId).single()
    check('Skor benar (jawaban terakhir offline B dipakai → 0; bukan A → 10)', subFinal?.total_score === 0 && subFinal?.is_submitted === true,
        `total=${subFinal?.total_score}/${subFinal?.max_score}`)

    // Draft lokal dibersihkan setelah state final
    const draftAfter = await evalInPage(cdp, `localStorage.getItem('exam_${exam.id}_answers')`)
    check('Draft localStorage dibersihkan setelah submit', !draftAfter, `draft=${draftAfter ? 'masih ada' : 'bersih'}`)

    // Halaman redirect ke hasil (route hasil ulangan)
    const urlNow = await evalInPage(cdp, `location.pathname`)
    redirectOk = String(urlNow).includes(`/ulangan/${exam.id}/hasil`)
    check('Redirect ke halaman hasil', redirectOk, `path=${urlNow}`)

    cdp.close()

    // ---------- HASIL ----------
    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL E2E OFFLINE EXAMRUNNER =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    if (dialogLog.length) console.log('dialog (alert) yang muncul:', JSON.stringify(dialogLog))
    console.log(failed.length === 0 ? 'E2E-RUNNER-OFFLINE: PASS ✅' : 'E2E-RUNNER-OFFLINE: FAIL ❌')
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
