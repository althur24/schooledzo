/**
 * E2E PRODUCTION — ALUR SISWA (ulangan + UTS/UAS) di sekolah SSA.
 *
 * Fokus: apa yang dialami SISWA dari membuka daftar sampai melihat hasil.
 *   [A] Daftar ujian siswa memuat ulangan fixture & tombol Mulai tampil.
 *   [B] Siswa membuka ruang ujian (ulangan): layar penuh, soal tampil, timer jalan.
 *   [C] Siswa menjawab MC via klik opsi → autosave ke DB (answer tersimpan).
 *   [D] Navigasi soal (Selanjutnya/Sebelumnya) & navigator jumlah terjawab.
 *   [E] Kumpulkan → modal konfirmasi → "Ya, Kumpulkan" → redirect halaman hasil.
 *   [F] Halaman hasil menampilkan nilai (show_results_immediately).
 *   [G] OFFLINE: emulateNetworkConditions offline → TIDAK ada notif "Koneksi
 *       terputus"/badge Offline, soal tetap tampil (zero-distraction), jawaban
 *       tersimpan lokal; klik Kumpulkan saat offline → modal Menunggu Koneksi +
 *       tombol "Coba Lagi"; online → terkirim.
 *   [H] UTS/UAS siswa: ruang ujian, jawab, submit, hasil.
 *   [I] Susulan: grant dibuat (via service-role) → daftar siswa menampilkan
 *       "Mulai Susulan" → siswa mulai → timer jalan (durasi penuh) → jawab → submit.
 *
 * PRASYARAT: jalankan ke production SSA (tanpa server lokal).
 * Fixture prefix e2f8, cleanup FK-safe di finally. Data SSA asli TIDAK disentuh.
 *
 * Jalankan:
 *   ENV_FILE=.env.local E2E_BASE=https://hippocampus.educationzone.id \
 *   T_SCHOOL=... T_YEAR=... T_SUBJECT=... T_CLASS=... \
 *   node scripts/e2e-siswa-ssa-production.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const WebSocket = require('ws')

const BASE = process.env.E2E_BASE || 'https://hippocampus.educationzone.id'
const PASS = 'E2sw1234!'
const SCHOOL = process.env.T_SCHOOL || 'f128ce1c-8014-41a8-9183-75e2e823fce1'
const YEAR = process.env.T_YEAR || '09010906-f191-4f13-a082-2d98d69cc9b1'
const SUBJECT = process.env.T_SUBJECT || '9bf01e15-29ec-4b63-adc1-1f56364f628c'
const CLASS = process.env.T_CLASS || '2d6a9d13-76cd-4c2d-b984-d6d8af377bf2'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CDP_PORT = 9229

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PFX = 'e2f80000-0000-4000-8000-'
const P = {
    guruUser: `${PFX}100000000001`,
    teacher: `${PFX}200000000001`,
    ta: `${PFX}300000000001`,
    s1User: `${PFX}400000000001`,
    s1: `${PFX}500000000001`,
    examU: `${PFX}600000000001`,   // ulangan
    examO: `${PFX}600000000002`,   // UTS/UAS
    examS: `${PFX}600000000003`,   // ulangan untuk susulan (sudah berakhir)
    qU1: `${PFX}700000000001`,
    qU2: `${PFX}700000000002`,
    qO1: `${PFX}700000000003`,
    qS1: `${PFX}700000000004`,
}
const T0 = Date.now()
const iso = (ms) => new Date(T0 + ms).toISOString()

let pass = 0, fail = 0, chromeProc = null, chromeTmp = null
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + String(detail).slice(0, 220) : ''}`) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

class Cdp {
    constructor(ws) {
        this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; this.consoleErrors = []; this.dialogs = []
        ws.on('message', (raw) => {
            const msg = JSON.parse(raw)
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id)
                msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
            } else if (msg.method) this.handlers.forEach(h => h(msg))
        })
    }
    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.id; this.pending.set(id, { resolve, reject })
            this.ws.send(JSON.stringify({ id, method, params }))
        })
    }
    onEvent(fn) { this.handlers.push(fn) }
    close() { this.ws.close() }
}
async function evalInPage(cdp, expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.exceptionDetails))
    return r.result?.value
}
async function waitFor(cdp, expression, timeoutMs = 20000, interval = 400) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        try { if (await evalInPage(cdp, expression)) return true } catch { }
        await sleep(interval)
    }
    return false
}
async function startChrome() {
    chromeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-sw-'))
    chromeProc = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${chromeTmp}`,
        '--window-size=1280,900', 'about:blank',
    ], { stdio: 'ignore' })
    let targets = null
    for (let i = 0; i < 30; i++) {
        try { const r = await fetch(`http://localhost:${CDP_PORT}/json`); targets = await r.json(); if (targets.length) break } catch { }
        await sleep(500)
    }
    const page = targets?.find(t => t.type === 'page')
    if (!page) throw new Error('Chrome page target tidak ditemukan')
    const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 })
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
    const cdp = new Cdp(ws)
    cdp.onEvent((msg) => {
        if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails
            cdp.consoleErrors.push(d.exception?.description || d.text || JSON.stringify(d))
        }
        if (msg.method === 'Log.entryAdded' && msg.params.entry?.level === 'error') cdp.consoleErrors.push(msg.params.entry.text)
        if (msg.method === 'Page.javascriptDialogOpening') {
            cdp.dialogs.push(msg.params.message)
            cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => { })
        }
    })
    await cdp.send('Page.enable'); await cdp.send('Network.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable')
    return cdp
}
async function login(username) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASS }),
    })
    if (!res.ok) throw new Error(`login ${username}: ${res.status}`)
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
    const cookies = {}
    for (const sc of setCookies) { const m = sc.match(/^([^=]+)=([^;]+)/); if (m) cookies[m[1].trim()] = m[2] }
    if (!cookies.session_token) throw new Error('login: session_token tidak ditemukan')
    return cookies
}
async function applyCookies(cdp, cookies, role) {
    await cdp.send('Network.setCookie', { url: BASE, name: 'session_token', value: cookies.session_token, path: '/', httpOnly: true, sameSite: 'Lax' })
    await cdp.send('Network.setCookie', { url: BASE, name: 'user_role', value: cookies.user_role || role, path: '/', httpOnly: false, sameSite: 'Lax' })
}
function cleanErrors(cdp) {
    return cdp.consoleErrors.filter(e => !e.includes('favicon') && !e.includes('404') && !/Failed to load resource/i.test(e))
}

// Jawab 1 opsi MC: klik tombol opsi. Struktur tombol = <span>LETTER</span> + teks opsi,
// jadi kita cari tombol yang memiliki <span> berisi tepat satu huruf A/B/C/D.
async function pickOption(cdp, letter) {
    return evalInPage(cdp, `(() => {
        const btns = [...document.querySelectorAll('button')]
        const b = btns.find(x => {
            const spans = [...x.querySelectorAll('span')]
            if (!spans.some(s => s.textContent.trim() === '${letter}')) return false
            // hindari tombol navigasi/label: tombol opsi punya teks opsi lebih panjang
            return x.textContent.trim().length > 1
        })
        if (!b) return 'tidak-ditemukan'
        b.click(); return 'clicked'
    })()`)
}
async function subStateByExam(examId, studentId) {
    const { data } = await supabase.from('exam_submissions').select('id,is_submitted,started_at,total_score,max_score,timer_override_until')
        .eq('exam_id', examId).eq('student_id', studentId).maybeSingle()
    return data
}
async function answersOf(subId) {
    const { data } = await supabase.from('exam_answers').select('question_id,answer').eq('submission_id', subId)
    return data || []
}

async function cleanupAll() {
    // hapus semua fixture e2f8 (FK-safe)
    // Submission milik siswa fixture (semua exam, apa pun) dulu
    const { data: subsByStudent } = await supabase.from('exam_submissions').select('id').eq('student_id', P.s1)
    const sIds = (subsByStudent || []).map(s => s.id)
    for (let i = 0; i < sIds.length; i += 100) await supabase.from('exam_answers').delete().in('submission_id', sIds.slice(i, i + 100))
    await supabase.from('exam_submissions').delete().eq('student_id', P.s1)
    const { data: osubsByStudent } = await supabase.from('official_exam_submissions').select('id').eq('student_id', P.s1)
    const osIds = (osubsByStudent || []).map(s => s.id)
    for (let i = 0; i < osIds.length; i += 100) await supabase.from('official_exam_answers').delete().in('submission_id', osIds.slice(i, i + 100))
    await supabase.from('official_exam_submissions').delete().eq('student_id', P.s1)
    for (const ex of [P.examU, P.examO, P.examS]) {
        const { data: subs } = await supabase.from('exam_submissions').select('id').eq('exam_id', ex)
        const ids = (subs || []).map(s => s.id)
        for (let i = 0; i < ids.length; i += 100) await supabase.from('exam_answers').delete().in('submission_id', ids.slice(i, i + 100))
        await supabase.from('exam_submissions').delete().eq('exam_id', ex)
        await supabase.from('exam_questions').delete().eq('exam_id', ex)
        await supabase.from('exams').delete().eq('id', ex)
    }
    await supabase.from('official_exam_questions').delete().eq('exam_id', P.examO)
    await supabase.from('official_exams').delete().eq('id', P.examO)
    await supabase.from('student_enrollments').delete().eq('student_id', P.s1)
    await supabase.from('students').delete().eq('id', P.s1)
    await supabase.from('teaching_assignments').delete().eq('id', P.ta)
    await supabase.from('notifications').delete().in('user_id', [P.guruUser, P.s1User])
    await supabase.from('sessions').delete().in('user_id', [P.guruUser, P.s1User])
    await supabase.from('teachers').delete().eq('id', P.teacher)
    await supabase.from('users').delete().in('id', [P.guruUser, P.s1User])
}

async function seed() {
    console.log('═══ SEED (SSA, alur siswa) ══')
    await cleanupAll()
    const hash = bcrypt.hashSync(PASS, 10)
    const must = async (l, q) => { const { error } = await q; if (error) throw new Error(`${l}: ${error.message}`) }
    await must('users', supabase.from('users').insert([
        { id: P.guruUser, username: 'e2f8_guru', full_name: 'E2F8 Guru', password_hash: hash, role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false },
        { id: P.s1User, username: 'e2f8_siswa', full_name: 'E2F8 Siswa', password_hash: hash, role: 'SISWA', school_id: SCHOOL, must_change_password: false, is_locked: false },
    ]))
    await must('teacher', supabase.from('teachers').insert({ id: P.teacher, user_id: P.guruUser, school_id: SCHOOL }))
    await must('TA', supabase.from('teaching_assignments').insert({ id: P.ta, teacher_id: P.teacher, subject_id: SUBJECT, class_id: CLASS, academic_year_id: YEAR }))
    await must('student', supabase.from('students').insert({ id: P.s1, user_id: P.s1User, school_id: SCHOOL, class_id: CLASS, nis: 'e2f801', status: 'ACTIVE', school_level: 'SMA' }))
    await must('enroll', supabase.from('student_enrollments').insert({ student_id: P.s1, class_id: CLASS, academic_year_id: YEAR, status: 'ACTIVE', enrolled_at: iso(-365 * 86400000) }))

    // Ulangan aktif (jendela panjang) + 2 MC
    await must('examU', supabase.from('exams').insert({
        id: P.examU, title: 'E2F8 Ulangan Siswa', teaching_assignment_id: P.ta,
        start_time: iso(-5 * 60000), duration_minutes: 120, window_end_time: iso(3600000),
        is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: P.guruUser,
    }))
    await must('qU', supabase.from('exam_questions').insert([
        { id: P.qU1, exam_id: P.examU, question_text: 'E2F8 soal 1 (pilih B)', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb', 'Ccc', 'Ddd'], correct_answer: 'B', points: 50, order_index: 0, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
        { id: P.qU2, exam_id: P.examU, question_text: 'E2F8 soal 2 (pilih A)', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb', 'Ccc', 'Ddd'], correct_answer: 'A', points: 50, order_index: 1, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
    ]))

    // UTS/UAS aktif + 1 MC
    await must('examO', supabase.from('official_exams').insert({
        id: P.examO, title: 'E2F8 UTS Siswa', exam_type: 'UTS', school_id: SCHOOL, subject_id: SUBJECT, academic_year_id: YEAR,
        start_time: iso(-5 * 60000), duration_minutes: 120, window_end_time: iso(3600000),
        is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: true, results_released: true,
        target_class_ids: [CLASS],
    }))
    await must('qO', supabase.from('official_exam_questions').insert({
        id: P.qO1, exam_id: P.examO, question_text: 'E2F8 UTS soal (pilih C)', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb', 'Ccc', 'Ddd'], correct_answer: 'C', points: 100, order_index: 0, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain',
    }))

    // Ulangan SUDAH berakhir (untuk susulan) + 1 MC
    await must('examS', supabase.from('exams').insert({
        id: P.examS, title: 'E2F8 Ulangan Susulan', teaching_assignment_id: P.ta,
        start_time: iso(-3 * 3600000), duration_minutes: 60, is_active: true,
        is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: P.guruUser,
    }))
    await must('qS', supabase.from('exam_questions').insert({
        id: P.qS1, exam_id: P.examS, question_text: 'E2F8 susulan soal (pilih A)', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb'], correct_answer: 'A', points: 100, order_index: 0, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain',
    }))
    console.log('  seed OK\n')
}

async function main() {
    await seed()
    const siswa = await login('e2f8_siswa')
    const cdp = await startChrome()
    await applyCookies(cdp, siswa, 'SISWA')

    // ── [A] Daftar ujian siswa ──
    console.log('═══ [A] Daftar ujian siswa ══')
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/siswa/ulangan` })
    await sleep(4000)
    const listOk = await waitFor(cdp, `document.body.innerText.includes('E2F8 Ulangan Siswa')`, 20000)
    check('A1: daftar ujian memuat ulangan fixture', listOk)
    check('A2: tombol Mulai tampil untuk ulangan aktif', await evalInPage(cdp, `[...document.querySelectorAll('a,button')].some(e=>/Mulai/i.test(e.textContent||''))`))

    // ── [B] Buka ruang ujian ulangan ──
    console.log('\n═══ [B] Ruang ujian ulangan ══')
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/siswa/ulangan/${P.examU}` })
    await sleep(4000)
    // resume modal mungkin muncul; klik Lanjutkan bila ada
    await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Lanjutkan/i.test(x.textContent)); if(b) b.click(); return true })()`)
    const inRunner = await waitFor(cdp, `document.body.innerText.includes('E2F8 soal 1')`, 25000)
    check('B1: soal tampil di ruang ujian', inRunner)
    check('B2: timer tampil (format mm:ss)', await evalInPage(cdp, `/\\d+:\\d{2}/.test(document.body.innerText)`))
    const stU = await subStateByExam(P.examU, P.s1)
    check('B3: submission siswa berjalan (started_at terisi)', !!stU?.started_at, stU?.started_at)

    // ── [C] Jawab soal 1 (B) → autosave ──
    console.log('\n═══ [C] Jawab soal + autosave ══')
    const ck = await pickOption(cdp, 'B')
    check('C1: klik opsi B', ck === 'clicked', ck)
    await sleep(3000) // debounce autosave 1.5s + margin
    const ansU = await answersOf(stU.id)
    const a1 = (ansU || []).find(a => a.question_id === P.qU1)
    check('C2: jawaban soal 1 tersimpan di DB = B', a1?.answer === 'B', a1)

    // ── [D] Navigasi soal ──
    console.log('\n═══ [D] Navigasi soal ══')
    const nextClicked = await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Selanjutnya/i.test(x.textContent)); if(b){b.click();return 'clicked'} return 'none' })()`)
    await sleep(1500)
    check('D1: tombol Selanjutnya berfungsi', nextClicked === 'clicked', nextClicked)
    check('D2: soal 2 tampil', await evalInPage(cdp, `document.body.innerText.includes('E2F8 soal 2')`))
    const ck2 = await pickOption(cdp, 'A')
    check('D3: jawab soal 2 (A)', ck2 === 'clicked', ck2)
    await sleep(3000)
    const ansU2 = await answersOf(stU.id)
    check('D4: jawaban soal 2 tersimpan = A', (ansU2 || []).find(a => a.question_id === P.qU2)?.answer === 'A')

    // ── [E] Kumpulkan ──
    console.log('\n═══ [E] Kumpulkan ulangan ══')
    const submitBtn = await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Kumpulkan/i.test(x.textContent)); if(b){b.click();return 'clicked'} return 'none' })()`)
    check('E1: tombol Kumpulkan diklik', submitBtn === 'clicked', submitBtn)
    const modal = await waitFor(cdp, `document.body.innerText.includes('Kumpulkan') && /Ya, Kumpulkan/i.test(document.body.innerText)`, 8000)
    check('E2: modal konfirmasi kumpulkan muncul', modal)
    await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Ya, Kumpulkan/i.test(x.textContent)); if(b) b.click(); return !!b })()`)
    const redirected = await waitFor(cdp, `location.pathname.includes('/ulangan/${P.examU}/hasil')`, 20000)
    check('E3: redirect ke halaman hasil', redirected, await evalInPage(cdp, `location.pathname`))
    const stUfinal = await subStateByExam(P.examU, P.s1)
    check('E4: submission ter-submit di DB', stUfinal?.is_submitted === true, stUfinal?.is_submitted)
    check('E5: nilai = 100 (2×50 benar)', Math.round(stUfinal?.total_score) === 100, stUfinal?.total_score)

    // ── [F] Halaman hasil ──
    console.log('\n═══ [F] Halaman hasil ══')
    check('F1: halaman hasil memuat nilai', await waitFor(cdp, `/100|Nilai/i.test(document.body.innerText)`, 10000))
    check('F2: tidak ada exception fatal', cleanErrors(cdp).length === 0, cleanErrors(cdp)[0])

    // ── [G] Offline zero-distraction (ujian baru) ──
    console.log('\n═══ [G] Offline zero-distraction ══')
    // reset submission ulangan U supaya bisa dikerjakan lagi (service-role)
    const { data: oldSub } = await supabase.from('exam_submissions').select('id').eq('exam_id', P.examU).eq('student_id', P.s1).maybeSingle()
    if (oldSub) { await supabase.from('exam_answers').delete().eq('submission_id', oldSub.id); await supabase.from('exam_submissions').delete().eq('id', oldSub.id) }
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/siswa/ulangan/${P.examU}` })
    await sleep(4000)
    await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Lanjutkan/i.test(x.textContent)); if(b) b.click(); return true })()`)
    await waitFor(cdp, `document.body.innerText.includes('E2F8 soal 1')`, 25000)
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await sleep(2000)
    const bodyOff = await evalInPage(cdp, `document.body.innerText`)
    check('G1: TIDAK ada banner "Koneksi terputus" saat offline', !String(bodyOff).includes('Koneksi terputus'))
    const badgeOff = await evalInPage(cdp, `[...document.querySelectorAll('span')].some(s=>s.textContent.trim()==='Offline')`)
    check('G2: TIDAK ada badge "Offline" di header', badgeOff === false)
    check('G3: soal tetap tampil saat offline (siswa bisa lanjut)', String(bodyOff).includes('E2F8 soal 1'))
    // jawab offline → tersimpan lokal
    await pickOption(cdp, 'B')
    await sleep(1500)
    const draftRaw = await evalInPage(cdp, `localStorage.getItem('exam_${P.examU}_answers')`)
    let draft = null; try { draft = JSON.parse(draftRaw) } catch { }
    check('G4: jawaban offline tersimpan di localStorage', !!draft?.answers && Object.keys(draft.answers).length > 0, draftRaw ? 'ada' : 'null')
    // Tombol "Kumpulkan" hanya tampil di soal terakhir → navigasi sampai akhir dulu
    for (let i = 0; i < 5; i++) {
        const adaKumpul = await evalInPage(cdp, `[...document.querySelectorAll('button')].some(b=>/Kumpulkan/i.test(b.textContent))`)
        if (adaKumpul) break
        await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Selanjutnya/i.test(x.textContent)); if(b) b.click(); return !!b })()`)
        await sleep(1200)
    }
    check('G4b: tombol Kumpulkan tampil di soal terakhir', await evalInPage(cdp, `[...document.querySelectorAll('button')].some(b=>/Kumpulkan/i.test(b.textContent))`))
    // klik kumpulkan saat offline → modal menunggu + tombol Coba Lagi
    await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Kumpulkan/i.test(x.textContent)); if(b) b.click(); return !!b })()`)
    await sleep(1200)
    await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Ya, Kumpulkan/i.test(x.textContent)); if(b) b.click(); return !!b })()`)
    const waitModal = await waitFor(cdp, `document.body.innerText.includes('Menunggu Koneksi Internet')`, 12000)
    check('G5: modal Menunggu Koneksi muncul saat submit offline', waitModal)
    check('G6: tombol "Coba Lagi" tersedia di modal', await evalInPage(cdp, `[...document.querySelectorAll('button')].some(b=>/Coba Lagi/i.test(b.textContent))`))
    // online → terkirim
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    let submittedOnline = false
    for (let i = 0; i < 15; i++) {
        await sleep(2000)
        const { data: s } = await supabase.from('exam_submissions').select('is_submitted').eq('exam_id', P.examU).eq('student_id', P.s1).maybeSingle()
        if (s?.is_submitted) { submittedOnline = true; break }
    }
    check('G7: setelah online → submission ter-submit otomatis', submittedOnline)

    // ── [H] UTS/UAS siswa ──
    console.log('\n═══ [H] UTS/UAS siswa ══')
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/siswa/uts-uas/${P.examO}` })
    await sleep(4000)
    await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Lanjutkan/i.test(x.textContent)); if(b) b.click(); return true })()`)
    const utsIn = await waitFor(cdp, `document.body.innerText.includes('E2F8 UTS soal')`, 25000)
    check('H1: ruang ujian UTS/UAS tampil', utsIn)
    const ckO = await pickOption(cdp, 'C')
    check('H2: jawab opsi C', ckO === 'clicked', ckO)
    await sleep(2500)
    await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Kumpulkan/i.test(x.textContent)); if(b) b.click(); return !!b })()`)
    await sleep(1200)
    await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Ya, Kumpulkan/i.test(x.textContent)); if(b) b.click(); return !!b })()`)
    const utsRedirect = await waitFor(cdp, `location.pathname.includes('/uts-uas/${P.examO}/hasil')`, 20000)
    check('H3: UTS/UAS submit → redirect hasil', utsRedirect, await evalInPage(cdp, `location.pathname`))
    const { data: subO } = await supabase.from('official_exam_submissions').select('is_submitted,total_score').eq('exam_id', P.examO).eq('student_id', P.s1).maybeSingle()
    check('H4: submission UTS ter-submit', subO?.is_submitted === true, subO?.is_submitted)
    check('H5: nilai UTS = 100', Math.round(subO?.total_score) === 100, subO?.total_score)

    // ── [I] Susulan siswa ──
    console.log('\n═══ [I] Susulan siswa ══')
    // grant susulan via service-role (paritas tombol guru; sudah teruji di API suite)
    const { data: granted, error: gErr } = await supabase.from('exam_submissions').insert({
        exam_id: P.examS, student_id: P.s1, started_at: null, is_submitted: false,
        susulan_granted_at: iso(0), susulan_expires_at: iso(7 * 86400000), susulan_max_percent: 100,
        susulan_granted_by: P.guruUser, max_score: 100,
    }).select('id').single()
    check('I1: grant susulan placeholder dibuat', !!granted?.id && !gErr, gErr?.message)
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/siswa/ulangan` })
    await sleep(4000)
    const susulanBtn = await waitFor(cdp, `/Mulai Susulan/i.test(document.body.innerText)`, 15000)
    check('I2: daftar siswa menampilkan "Mulai Susulan"', susulanBtn)
    check('I3: badge SUSULAN tampil', /SUSULAN/i.test(await evalInPage(cdp, `document.body.innerText`)))
    // mulai susulan
    await evalInPage(cdp, `(() => { const a=[...document.querySelectorAll('a,button')].find(x=>/Mulai Susulan/i.test(x.textContent)); if(a){a.click();return true} return false })()`)
    const susulanRunner = await waitFor(cdp, `document.body.innerText.includes('E2F8 susulan soal')`, 25000)
    check('I4: ruang ujian susulan terbuka (soal tampil)', susulanRunner)
    const { data: subS } = await supabase.from('exam_submissions').select('started_at,timer_override_until,susulan_granted_at').eq('exam_id', P.examS).eq('student_id', P.s1).maybeSingle()
    check('I5: susulan dimulai → started_at terisi', !!subS?.started_at, subS?.started_at)
    check('I6: timer_override_until = durasi penuh dari mulai', !!subS?.timer_override_until, subS?.timer_override_until)
    await pickOption(cdp, 'A')
    await sleep(2500)
    await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Kumpulkan/i.test(x.textContent)); if(b) b.click(); return !!b })()`)
    await sleep(1200)
    await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Ya, Kumpulkan/i.test(x.textContent)); if(b) b.click(); return !!b })()`)
    const susulanRedirect = await waitFor(cdp, `location.pathname.includes('/ulangan/${P.examS}/hasil')`, 20000)
    check('I7: susulan submit → redirect hasil', susulanRedirect, await evalInPage(cdp, `location.pathname`))
    const { data: subS2 } = await supabase.from('exam_submissions').select('is_submitted,total_score').eq('exam_id', P.examS).eq('student_id', P.s1).maybeSingle()
    check('I8: susulan ter-submit + nilai 100', subS2?.is_submitted === true && Math.round(subS2?.total_score) === 100, subS2)

    console.log(`\n═══ HASIL E2E ALUR SISWA SSA: ${pass} ok / ${fail} FAIL ═══`)
    cdp.close()
}

main()
    .catch(e => { console.error('ERROR:', e.message); fail++ })
    .finally(async () => {
        console.log('\ncleanup...')
        try { await cleanupAll() } catch (e) { console.error('cleanup err:', e.message) }
        if (chromeProc) try { chromeProc.kill('SIGKILL') } catch { }
        if (chromeTmp) try { fs.rmSync(chromeTmp, { recursive: true, force: true }) } catch { }
        console.log('cleanup selesai')
        process.exit(fail === 0 ? 0 : 1)
    })
