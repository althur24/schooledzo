/**
 * Browser E2E — halaman detail Guru (komponen shared) + halaman koreksi.
 *
 * Memvalidasi RENDERING & interaksi UI yang TIDAK tercakup tes API:
 *  [A] Detail ulangan draft:
 *      - halaman load tanpa exception
 *      - anchor tutorial (exam-add-section, exam-question-list) ada
 *      - drag handle muncul (mode draft, tanpa submission)
 *      - audio listening berkelompok tampil (tag <audio> + label Listening)
 *      - tombol Publish membuka modal konfirmasi (tidak langsung publish)
 *  [B] Status review AI:
 *      - ringkasan "Status Soal" tampil
 *      - badge "Dikembalikan" + catatan admin tampil
 *      - FIX poll: mengetik di form Pengaturan TIDAK ter-reset setelah 6,5 dtk
 *        (regresi: poll lama memanggil fetchExam yang mengisi ulang settingsForm)
 *  [C] Halaman koreksi:
 *      - input Feedback per soal tampil (mode ulangan)
 *
 * PRASYARAT: server dengan env staging + DB staging:
 *   set -a; source .env.staging; set +a; npm run build
 *   set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   ENV_FILE=.env.staging node scripts/e2e-browser-guru-detail.cjs
 *
 * Fixture namespace e2bd, cleanup FK-safe di finally.
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const WebSocket = require('ws')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2bd1234!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2'
const CLASS = '7da71f34-b051-4aa9-ab4d-967ae741f61c'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CDP_PORT = 9226

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const P = {
    guruUser: 'e2bd0000-0000-4000-8000-000000000001',
    siswaUser: 'e2bd0000-0000-4000-8000-000000000002',
    teacher: 'e2bd0010-0000-4000-8000-000000000001',
    student: 'e2bd0020-0000-4000-8000-000000000001',
    ta: 'e2bd0030-0000-4000-8000-000000000001',
    examA: 'e2bd00a0-0000-4000-8000-000000000001',
    examB: 'e2bd00b0-0000-4000-8000-000000000001',
    examC: 'e2bd00c0-0000-4000-8000-000000000001',
    qa1: 'e2bd00a1-0000-4000-8000-000000000001',
    qa2: 'e2bd00a1-0000-4000-8000-000000000002',
    qb1: 'e2bd00b1-0000-4000-8000-000000000001',
    qb2: 'e2bd00b1-0000-4000-8000-000000000002',
    qb3: 'e2bd00b1-0000-4000-8000-000000000003',
    qc1: 'e2bd00c1-0000-4000-8000-000000000001',
    subC: 'e2bd00c2-0000-4000-8000-000000000001',
}
const AUDIO = 'https://example.com/e2bd-listen.mp3'
const T0 = Date.now()
const iso = (ms) => new Date(T0 + ms).toISOString()

let pass = 0, fail = 0, chromeProc = null, chromeTmp = null
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + String(detail).slice(0, 200) : ''}`) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function waitFor(cdp, expression, timeoutMs = 15000, interval = 400) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        try { if (await evalInPage(cdp, expression)) return true } catch { }
        await sleep(interval)
    }
    return false
}

class Cdp {
    constructor(ws) {
        this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []
        this.consoleErrors = []
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

async function startChrome(url) {
    chromeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-gd-'))
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
        if (msg.method === 'Log.entryAdded' && msg.params.entry?.level === 'error') {
            cdp.consoleErrors.push(msg.params.entry.text)
        }
    })
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    return { cdp, ws }
}

async function login(username) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASS }),
    })
    if (!res.ok) throw new Error(`login ${username}: ${res.status}`)
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
    const cookies = {}
    for (const sc of setCookies) {
        const m = sc.match(/^([^=]+)=([^;]+)/)
        if (m) cookies[m[1].trim()] = m[2]
    }
    if (!cookies.session_token) throw new Error('login: session_token cookie tidak ditemukan')
    return cookies
}

async function applyCookies(cdp, cookies) {
    await cdp.send('Network.setCookie', { url: BASE, name: 'session_token', value: cookies.session_token, path: '/', httpOnly: true, sameSite: 'Lax' })
    await cdp.send('Network.setCookie', { url: BASE, name: 'user_role', value: cookies.user_role || 'GURU', path: '/', httpOnly: false, sameSite: 'Lax' })
}

async function cleanupAll() {
    await supabase.from('exam_answers').delete().eq('submission_id', P.subC)
    await supabase.from('exam_submissions').delete().in('exam_id', [P.examA, P.examB, P.examC])
    await supabase.from('admin_reviews').delete().in('question_id', [P.qa1, P.qa2, P.qb1, P.qb2, P.qb3, P.qc1])
    await supabase.from('exam_questions').delete().in('exam_id', [P.examA, P.examB, P.examC])
    await supabase.from('exams').delete().in('id', [P.examA, P.examB, P.examC])
    await supabase.from('student_enrollments').delete().eq('student_id', P.student)
    await supabase.from('students').delete().eq('id', P.student)
    await supabase.from('teaching_assignments').delete().eq('id', P.ta)
    await supabase.from('sessions').delete().in('user_id', [P.guruUser, P.siswaUser])
    await supabase.from('notifications').delete().in('user_id', [P.guruUser, P.siswaUser])
    await supabase.from('teachers').delete().eq('id', P.teacher)
    await supabase.from('users').delete().in('id', [P.guruUser, P.siswaUser])
}

async function seed() {
    console.log('═══ SEED ══')
    await cleanupAll()
    const hash = bcrypt.hashSync(PASS, 10)
    const must = async (label, q) => { const { error } = await q; if (error) throw new Error(`${label}: ${error.message}`) }

    await must('users', supabase.from('users').insert([
        { id: P.guruUser, username: 'e2bd_guru', full_name: 'E2BD Guru', password_hash: hash, role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false },
        { id: P.siswaUser, username: 'e2bd_siswa', full_name: 'E2BD Siswa', password_hash: hash, role: 'SISWA', school_id: SCHOOL, must_change_password: false, is_locked: false },
    ]))
    await must('teacher', supabase.from('teachers').insert({ id: P.teacher, user_id: P.guruUser, school_id: SCHOOL }))
    await must('TA', supabase.from('teaching_assignments').insert({ id: P.ta, teacher_id: P.teacher, subject_id: SUBJECT, class_id: CLASS, academic_year_id: YEAR }))
    await must('student', supabase.from('students').insert({ id: P.student, user_id: P.siswaUser, school_id: SCHOOL, class_id: CLASS, nis: 'e2bd01', status: 'ACTIVE', school_level: 'SMP' }))
    await must('enrollment', supabase.from('student_enrollments').insert({ student_id: P.student, class_id: CLASS, academic_year_id: YEAR, status: 'ACTIVE', enrolled_at: iso(-365 * 86400000) }))

    // Exam A — draft, semua approved (audio group + publish modal)
    await must('examA', supabase.from('exams').insert({
        id: P.examA, title: 'E2BD Uji Detail A', teaching_assignment_id: P.ta,
        start_time: iso(30 * 60000), duration_minutes: 60, is_active: false,
        is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: P.guruUser,
    }))
    await must('examA q', supabase.from('exam_questions').insert([
        { id: P.qa1, exam_id: P.examA, question_text: 'Soal audio 1?', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 50, order_index: 0, status: 'approved', passage_text: 'Bacaan audio uji', passage_audio_url: AUDIO },
        { id: P.qa2, exam_id: P.examA, question_text: 'Soal audio 2?', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'B', points: 50, order_index: 1, status: 'approved', passage_text: 'Bacaan audio uji', passage_audio_url: AUDIO },
    ]))

    // Exam B — draft + 1 draft (poll) + 1 returned (badge + notes)
    await must('examB', supabase.from('exams').insert({
        id: P.examB, title: 'E2BD Uji Detail B', teaching_assignment_id: P.ta,
        start_time: iso(30 * 60000), duration_minutes: 60, is_active: false,
        is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: P.guruUser,
    }))
    await must('examB q', supabase.from('exam_questions').insert([
        { id: P.qb1, exam_id: P.examB, question_text: 'Soal B approved?', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 30, order_index: 0, status: 'approved' },
        { id: P.qb2, exam_id: P.examB, question_text: 'Soal B draft?', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'B', points: 30, order_index: 1, status: 'draft' },
        { id: P.qb3, exam_id: P.examB, question_text: 'Soal B dikembalikan?', question_type: 'ESSAY', options: null, correct_answer: null, points: 40, order_index: 2, status: 'returned' },
    ]))
    await must('admin_review', supabase.from('admin_reviews').insert({
        question_id: P.qb3, question_source: 'exam', decision: 'return',
        notes: 'Catatan uji browser E2BD', return_reasons: ['Soal kurang jelas'],
    }))

    // Exam C — submission + jawaban esai (halaman koreksi feedback)
    await must('examC', supabase.from('exams').insert({
        id: P.examC, title: 'E2BD Uji Koreksi C', teaching_assignment_id: P.ta,
        start_time: iso(-10 * 60000), duration_minutes: 60, is_active: true,
        is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: P.guruUser,
    }))
    await must('examC q', supabase.from('exam_questions').insert({
        id: P.qc1, exam_id: P.examC, question_text: 'Uraikan jawaban Anda.', question_type: 'ESSAY',
        options: null, correct_answer: null, points: 100, order_index: 0, status: 'approved',
    }))
    await must('subC', supabase.from('exam_submissions').insert({
        id: P.subC, exam_id: P.examC, student_id: P.student, is_submitted: true, is_graded: false,
        total_score: 0, max_score: 100, violation_count: 0,
        started_at: iso(-5 * 60000), submitted_at: iso(-60000),
    }))
    await must('ansC', supabase.from('exam_answers').insert({
        submission_id: P.subC, question_id: P.qc1, answer: 'Jawaban uji', is_correct: null, points_earned: 0,
    }))
    console.log('  seed OK\n')
}

function cleanErrors(cdp) {
    return cdp.consoleErrors.filter(e => !e.includes('favicon') && !e.includes('404'))
}

async function main() {
    await seed()
    const guru = await login('e2bd_guru')
    const { cdp, ws } = await startChrome(BASE)
    await applyCookies(cdp, guru)

    // ── [A] Detail ulangan draft: anchor, drag, audio, publish confirm ──
    console.log('═══ [A] Detail Guru — soal/audio/publish ══')
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/guru/ulangan/${P.examA}` })
    await sleep(4000)
    await waitFor(cdp, `document.body.innerText.includes('E2BD Uji Detail A')`, 20000)

    check('A1: halaman detail load (title terisi)', !!(await evalInPage(cdp, 'document.title')), 'title kosong')
    check('A2: anchor tutorial add-section ada', !!(await evalInPage(cdp, `!!document.querySelector('[data-tutorial="exam-add-section"]')`)))
    check('A3: anchor tutorial question-list ada', !!(await evalInPage(cdp, `!!document.querySelector('[data-tutorial="exam-question-list"]')`)))
    const handles = await evalInPage(cdp, `document.querySelectorAll('button[title="Geser untuk mengubah urutan"]').length`)
    check('A4: drag handle muncul (draft, tanpa submission)', handles >= 2, `handle=${handles}`)
    const audioCount = await evalInPage(cdp, `document.querySelectorAll('audio').length`)
    check('A5: audio listening (<audio>) tampil', audioCount >= 1, `audio=${audioCount}`)
    check('A6: label grup Listening tampil', await evalInPage(cdp, `document.body.innerText.includes('Listening')`))
    console.log('  DEBUG[A] buttons:', await evalInPage(cdp, `[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean).slice(0,25).join(' | ')`))
    console.log('  DEBUG[A] hasPublishUlangan:', await evalInPage(cdp, `document.body.innerText.includes('Publish Ulangan')`), '| hasPublish:', await evalInPage(cdp, `document.body.innerText.includes('Publish')`))

    // Klik Publish → harus buka modal konfirmasi (tidak langsung publish)
    const publishClicked = await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Publish'); if(b) b.click(); return !!b })()`)
    check('A7a: tombol Publish ditemukan', publishClicked === true)
    const a7 = await waitFor(cdp, `document.body.innerText.includes('Ya, Publish')`, 15000)
    check('A7: modal konfirmasi Publish muncul', a7, a7 ? undefined : (await evalInPage(cdp, 'document.body.innerText.slice(0,400)')))
    await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Batal'); if(b) b.click(); return !!b })()`)
    const a8 = await waitFor(cdp, `!document.body.innerText.includes('Ya, Publish')`, 5000)
    check('A8: modal tertutup setelah Batal', a8)
    check('A9: tidak ada exception fatal (fase A)', cleanErrors(cdp).length === 0, cleanErrors(cdp).slice(0, 2))

    // ── [B] Review AI + poll tidak reset form Pengaturan ──
    console.log('\n═══ [B] Detail Guru — review AI + poll settings ══')
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/guru/ulangan/${P.examB}` })
    await sleep(4000)
    await waitFor(cdp, `document.body.innerText.includes('E2BD Uji Detail B')`, 20000)

    check('B1: ringkasan Status Soal tampil', await waitFor(cdp, `document.body.innerText.includes('Status Soal:')`, 15000))
    check('B2: badge Dikembalikan tampil', await evalInPage(cdp, `document.body.innerText.includes('Dikembalikan')`))
    check('B3: catatan admin tampil', await evalInPage(cdp, `document.body.innerText.includes('Catatan uji browser E2BD')`))
    check('B4: alasan pengembalian tampil', await evalInPage(cdp, `document.body.innerText.includes('Soal kurang jelas')`))
    console.log('  DEBUG[B] buttons:', await evalInPage(cdp, `[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean).slice(0,25).join(' | ')`))
    console.log('  DEBUG[B] hasJudul:', await evalInPage(cdp, `document.body.innerText.includes('Judul Ujian')`), '| hasStatusSoal:', await evalInPage(cdp, `document.body.innerText.includes('Status Soal')`))

    // Buka tab Pengaturan
    await evalInPage(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Pengaturan'); if(b) b.click(); return !!b })()`)
    const labelReady = await waitFor(cdp, `(() => !!([...document.querySelectorAll('label')].find(l=>l.textContent.includes('Judul Ujian'))))()`, 15000)
    // Set judul via native setter + input event (React controlled)
    const setOk = labelReady && await evalInPage(cdp, `(() => {
        const label=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Judul Ujian'));
        if(!label) return false;
        const input=label.parentElement.querySelector('input');
        if(!input) return false;
        const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        setter.call(input,'E2BD JUDUL BARU');
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.setAttribute('data-testid','e2bd-title');
        return true;
    })()`)
    check('B5: form Pengaturan bisa diisi', setOk === true, setOk ? undefined : (await evalInPage(cdp, 'document.body.innerText.slice(0,400)')))
    // Tunggu >1 siklus poll (5 dtk)
    await sleep(6500)
    const titleAfter = await evalInPage(cdp, `(() => { const el=document.querySelector('[data-testid="e2bd-title"]'); return el?el.value:null })()`)
    check('B6: judul TIDAK ter-reset poll setelah 6,5 dtk', titleAfter === 'E2BD JUDUL BARU', `value=${titleAfter}`)
    check('B7: tidak ada exception fatal (fase B)', cleanErrors(cdp).length === 0, cleanErrors(cdp).slice(0, 2))

    // ── [C] Halaman koreksi — input Feedback ──
    console.log('\n═══ [C] Halaman koreksi — feedback ══')
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/guru/ulangan/${P.examC}/hasil/${P.subC}` })
    await sleep(6000)
    const hasFeedback = await evalInPage(cdp, `!!document.querySelector('input[placeholder="Berikan catatan..."]')`)
    check('C1: input Feedback per soal tampil (mode ulangan)', hasFeedback === true)
    check('C2: label Feedback tampil', await evalInPage(cdp, `document.body.innerText.includes('Feedback')`))
    check('C3: tidak ada exception fatal (fase C)', cleanErrors(cdp).length === 0, cleanErrors(cdp).slice(0, 2))

    ws.close()
    await cleanupAll()
    console.log(`\n═══ HASIL BROWSER GURU DETAIL: ${pass} ok / ${fail} FAIL ═══`)
    try { chromeProc?.kill() } catch { }
    try { fs.rmSync(chromeTmp, { recursive: true, force: true }) } catch { }
    process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => {
    console.error('FATAL:', e)
    cleanupAll().finally(() => { try { chromeProc?.kill() } catch { }; process.exit(1) })
})
