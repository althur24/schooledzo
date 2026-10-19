/**
 * Browser smoke test — Guard duplikat + expandable card + badge.
 *
 * Menguja RENDERING di Chrome asli (bukan cuma data layer):
 *  1. Page guru/ulangan load tanpa crash (no console error)
 *  2. Badge "Kemungkinan Duplikat" TIDAK muncul di kartu (removed per request —
 *     peringatan duplikat cukup saat create/duplicate via dialog)
 *  3. Expandable "Lihat per kelas" muncul di kartu batch + expandable works
 *  4. Badge konsisten di admin tab Ulangan (adil)
 *
 * PRASYARAT:
 *   set -a; source .env.staging; set +a; npm run build
 *   set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   ENV_FILE=.env.staging node scripts/e2e-browser-smoke.cjs
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
const PASS = 'E2bs1234!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2'
const CLASS = '7da71f34-b051-4aa9-ab4d-967ae741f61c'
const CLASS2 = '5d4c50c5-2b19-4e18-9798-7a9de3b90b1b'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CDP_PORT = 9224

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const P = {
    guruUser: 'e2b00000-0000-4000-8000-000000000001',
    adminUser: 'e2b00000-0000-4000-8000-000000000002',
    teacher: 'e2b00100-0000-4000-8000-000000000001',
    ta1: 'e2b00300-0000-4000-8000-000000000001',
    ta2: 'e2b00300-0000-4000-8000-000000000002',
    examDup1: 'e2b00500-0000-4000-8000-000000000001',
    examDup2: 'e2b00500-0000-4000-8000-000000000002',
    examB1: 'e2b00500-0000-4000-8000-000000000003',
    examB2: 'e2b00500-0000-4000-8000-000000000004',
    q1: 'e2b00600-0000-4000-8000-000000000001',
    batchId: 'e2b00900-0000-4000-8000-000000000001',
}
const T0 = Date.now()
const iso = (ms) => new Date(T0 + ms).toISOString()

let pass = 0, fail = 0, chromeProc = null, chromeTmp = null
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + String(detail).slice(0, 160) : ''}`) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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
    chromeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-bs-'))
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
    const page = targets.find(t => t.type === 'page')
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

async function setCookieAndNav(cdp, cookie, url) {
    // Set session cookie via CDP, lalu navigate
    await cdp.send('Network.setCookie', {
        url: BASE, name: 'session', value: cookie,
        path: '/', httpOnly: true,
    })
    await cdp.send('Page.navigate', { url })
    await sleep(7000) // tunggu hydration + client fetch data
}

async function login(username) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASS }),
    })
    if (!res.ok) throw new Error(`login ${username}: ${res.status}`)
    // Login set 2 cookie: session_token (HttpOnly) + user_role (non-HttpOnly).
    // getSetCookie() (undici) → array of "name=value; ..." strings.
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
    const cookies = {}
    for (const sc of setCookies) {
        const m = sc.match(/^([^=]+)=([^;]+)/)
        if (m) cookies[m[1].trim()] = m[2]
    }
    if (!cookies.session_token) throw new Error('login: session_token cookie tidak ditemukan di response')
    return cookies // { session_token, user_role }
}

async function cleanupAll() {
    await supabase.from('exam_questions').delete().in('exam_id', [P.examDup1, P.examDup2, P.examB1, P.examB2])
    await supabase.from('exam_submissions').delete().in('exam_id', [P.examDup1, P.examDup2, P.examB1, P.examB2])
    await supabase.from('exams').delete().in('id', [P.examDup1, P.examDup2, P.examB1, P.examB2])
    await supabase.from('teaching_assignments').delete().in('id', [P.ta1, P.ta2])
    await supabase.from('sessions').delete().in('user_id', [P.guruUser, P.adminUser])
    await supabase.from('notifications').delete().in('user_id', [P.guruUser, P.adminUser])
    await supabase.from('teachers').delete().eq('id', P.teacher)
    await supabase.from('users').delete().in('id', [P.guruUser, P.adminUser])
}

async function seed() {
    console.log('═══ SEED ══')
    await cleanupAll()
    const hash = bcrypt.hashSync(PASS, 10)
    const must = async (l, q) => { const { error } = await q; if (error) throw new Error(`${l}: ${error.message}`) }
    await must('users', supabase.from('users').insert([
        { id: P.guruUser, username: 'e2b0_guru', full_name: 'E2BS Guru', password_hash: hash, role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false },
        { id: P.adminUser, username: 'e2b0_admin', full_name: 'E2BS Admin', password_hash: hash, role: 'ADMIN', school_id: SCHOOL, must_change_password: false, is_locked: false },
    ]))
    await must('teachers', supabase.from('teachers').insert({ id: P.teacher, user_id: P.guruUser, school_id: SCHOOL }))
    await must('TA', supabase.from('teaching_assignments').insert([
        { id: P.ta1, teacher_id: P.teacher, subject_id: SUBJECT, class_id: CLASS, academic_year_id: YEAR },
        { id: P.ta2, teacher_id: P.teacher, subject_id: SUBJECT, class_id: CLASS2, academic_year_id: YEAR },
    ]))
    const dupTitle = 'Ulangan Browser Smoke Dup'
    const batchTitle = 'Ulangan Browser Smoke Batch'
    // 2 exam duplikat (TA1, judul sama) — sebelumnya trigger badge, sekarang
    // badge dihapus; kartu tetap render normal tanpa badge merah.
    await must('dup1', supabase.from('exams').insert({
        id: P.examDup1, title: dupTitle, description: 'e2b0 dup1', start_time: iso(120_000),
        duration_minutes: 30, teaching_assignment_id: P.ta1, is_active: true, is_randomized: false,
        max_violations: 3, show_results_immediately: true, created_by: P.guruUser,
    }))
    await must('dup2', supabase.from('exams').insert({
        id: P.examDup2, title: dupTitle, description: 'e2b0 dup2', start_time: iso(120_000),
        duration_minutes: 30, teaching_assignment_id: P.ta1, is_active: true, is_randomized: false,
        max_violations: 3, show_results_immediately: true, created_by: P.guruUser,
    }))
    // Batch 2 kelas (TA1+TA2, batch_id sama, judul sama) → trigger expandable card
    await must('b1', supabase.from('exams').insert({
        id: P.examB1, title: batchTitle, description: 'e2b0 batch1', start_time: iso(120_000),
        duration_minutes: 30, teaching_assignment_id: P.ta1, is_active: true, is_randomized: false,
        max_violations: 3, show_results_immediately: true, created_by: P.guruUser, batch_id: P.batchId,
    }))
    await must('b2', supabase.from('exams').insert({
        id: P.examB2, title: batchTitle, description: 'e2b0 batch2', start_time: iso(120_000),
        duration_minutes: 30, teaching_assignment_id: P.ta2, is_active: true, is_randomized: false,
        max_violations: 3, show_results_immediately: true, created_by: P.guruUser, batch_id: P.batchId,
    }))
    // Soal untuk masing-masing (biar card render normal)
    for (const eid of [P.examDup1, P.examDup2, P.examB1, P.examB2]) {
        await must('q', supabase.from('exam_questions').insert({
            exam_id: eid, question_text: 'Soal 1?', question_type: 'MULTIPLE_CHOICE',
            correct_answer: 'A', options: ['A', 'B', 'C', 'D'], points: 10, order_index: 0,
        }))
    }
    console.log('  seed OK\n')
}

async function main() {
    await seed()
    const guruCookies = await login('e2b0_guru')
    const adminCookies = await login('e2b0_admin')

    // ═══ [GURU] Page load + badge + expandable ═══
    console.log('═══ [GURU] Browser smoke ══')
    {
        const { cdp, ws } = await startChrome(`${BASE}/dashboard/guru/ulangan`)
        // Set BOTH cookies (session_token + user_role) — middleware butuh user_role
        await cdp.send('Network.setCookie', { url: BASE, name: 'session_token', value: guruCookies.session_token, path: '/', httpOnly: true, sameSite: 'Lax' })
        await cdp.send('Network.setCookie', { url: BASE, name: 'user_role', value: guruCookies.user_role || 'GURU', path: '/', httpOnly: false, sameSite: 'Lax' })
        await cdp.send('Page.navigate', { url: `${BASE}/dashboard/guru/ulangan` })
        await sleep(8000) // tunggu hydration + fetch data list

        // B1: page load tanpa crash fatal
        const title = await evalInPage(cdp, 'document.title')
        check('B1: page guru/ulangan load (title terisi)', !!title && title.length > 0, title)

        // B2: tidak ada React exception (console error fatal)
        const errs = cdp.consoleErrors.filter(e => !e.includes('favicon') && !e.includes('404'))
        check('B2: no fatal React exception', errs.length === 0, errs.slice(0, 3))

        // B3: badge "Kemungkinan Duplikat" TIDAK muncul (dihapus per request user —
        // peringatan cukup saat create/duplicate, bukan badge persistent di kartu)
        const bodyText = await evalInPage(cdp, 'document.body.innerText')
        check('B3: badge "Kemungkinan Duplikat" TIDAK muncul di kartu (removed)', !bodyText?.includes('Kemungkinan Duplikat'), 'badge masih tampil')

        // B4: expandable "Lihat per kelas" muncul (batch card ada)
        const hasExpandBtn = await evalInPage(cdp, `document.body.innerText.includes('Lihat per kelas')`)
        check('B4: expandable "Lihat per kelas" muncul di batch card', hasExpandBtn, 'expand button tidak ditemukan')

        // B5: klik expandable → member list muncul
        if (hasExpandBtn) {
            await evalInPage(cdp, `(() => {
                const btns = [...document.querySelectorAll('button')].filter(b => b.innerText.includes('Lihat per kelas'))
                if (btns.length) btns[0].click()
                return btns.length
            })()`)
            await sleep(1000)
            // Setelah klik, chevron rotate + member rows tampil. Cek ada nama kelas STG di expanded section.
            const expandedText = await evalInPage(cdp, 'document.body.innerText')
            check('B5: expandable terbuka — member rows tampil', expandedText?.includes('STG') || expandedText?.includes('siswa'), 'member rows tidak tampil')
        } else {
            check('B5: expandable terbuka — member rows tampil', false, 'skip (B4 gagal)')
        }

        ws.close()
    }

    // ═══ [ADMIN] Konsistensi — adil ═══
    console.log('\n═══ [ADMIN] Browser smoke (adil) ══')
    {
        const { cdp, ws } = await startChrome(`${BASE}/dashboard/admin/uts-uas`)
        await cdp.send('Network.setCookie', { url: BASE, name: 'session_token', value: adminCookies.session_token, path: '/', httpOnly: true, sameSite: 'Lax' })
        await cdp.send('Network.setCookie', { url: BASE, name: 'user_role', value: adminCookies.user_role || 'ADMIN', path: '/', httpOnly: false, sameSite: 'Lax' })
        // Admin tab Ulangan — pakai ?tab=ulangan
        await cdp.send('Page.navigate', { url: `${BASE}/dashboard/admin/uts-uas?tab=ulangan` })
        await sleep(8000)

        const bodyText = await evalInPage(cdp, 'document.body.innerText')
        check('A1: page admin tab Ulangan load', !!bodyText && bodyText.length > 10)
        check('A2: badge "Kemungkinan Duplikat" TIDAK muncul di admin (removed)', !bodyText?.includes('Kemungkinan Duplikat'), 'badge masih tampil di admin')
        check('A3: expandable "Lihat per kelas" di admin (adil)', bodyText?.includes('Lihat per kelas'), 'expand tidak ditemukan di admin')

        const errs = cdp.consoleErrors.filter(e => !e.includes('favicon') && !e.includes('404'))
        check('A4: admin no fatal exception', errs.length === 0, errs.slice(0, 3))

        ws.close()
    }

    await cleanupAll()
    console.log(`\n═══ HASIL BROWSER SMOKE: ${pass} ok / ${fail} FAIL ═══`)
    if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('FATAL:', e); cleanupAll().finally(() => { try { chromeProc?.kill() } catch {}; process.exit(1) }) })
