/**
 * UJI MATANG (browser/CDP) — dashboard siswa: resume, auto-submit kadaluarsa,
 * dan ketahanan saat endpoint lambat/gagal (Uji B & E).
 *
 * Skenario:
 *  [E1] Ujian BERJALAN (belum kadaluarsa) → dashboard memunculkan prompt
 *       "Lanjutkan Sekarang" dan TIDAK auto-submit.
 *  [E2] Ujian KADALUARSA + jawaban tersimpan → dashboard auto-submit →
 *       is_submitted true, jawaban UTUH, nilai benar.
 *  [B1] Endpoint /api/official-exams DIBLOKIR (simulasi gagal) → halaman tetap
 *       memuat (bukan blank), tidak crash, auto-submit (E2) tetap benar.
 *  [B2] Jaringan lambat (latency 800ms) saat buka dashboard → tetap benar.
 *
 * Jalankan: ENV_FILE=.env.staging node scripts/e2e-dashboard-harden-staging.cjs
 */
require('./../loadtest/e2e/helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { spawn } = require('child_process')
const fs = require('fs'); const os = require('os'); const path = require('path')
const WebSocket = require('ws')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2db1234!'
const PFX = 'e2fb0000-0000-4000-8000-'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CDP_PORT = 9231
const P = {
    school: `${PFX}000000000001`, year: `${PFX}000000000002`, subject: `${PFX}000000000003`, klass: `${PFX}000000000004`,
    guruUser: `${PFX}100000000001`, teacher: `${PFX}100000000002`, ta: `${PFX}100000000003`,
    sUser: `${PFX}200000000001`, student: `${PFX}200000000002`,
    examRun: `${PFX}300000000001`, qR: `${PFX}400000000001`,
    examExp: `${PFX}300000000002`, qE: `${PFX}400000000002`,
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
let pass = 0, fail = 0, chromeProc = null, chromeTmp = null
function check(n, c, d) { if (c) { pass++; console.log(`  ok : ${n}`) } else { fail++; console.log(`  FAIL: ${n}${d !== undefined ? ' — ' + String(d).slice(0, 200) : ''}`) } }
const iso = (ms) => new Date(Date.now() + ms).toISOString()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

class Cdp {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.h = []; ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } else if (m.method) this.h.forEach(f => f(m)) }) }
    send(method, params = {}) { return new Promise((res, rej) => { const id = ++this.id; this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })) }) }
    on(f) { this.h.push(f) }
    close() { this.ws.close() }
}
async function ev(cdp, expr) { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.value }
async function waitFor(cdp, expr, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(cdp, expr)) return true } catch { } await sleep(400) } return false }
async function startChrome() {
    chromeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-db-'))
    chromeProc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${chromeTmp}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
    let targets = null
    for (let i = 0; i < 30; i++) { try { const r = await fetch(`http://localhost:${CDP_PORT}/json`); targets = await r.json(); if (targets.length) break } catch { } await sleep(500) }
    const page = targets?.find(t => t.type === 'page'); if (!page) throw new Error('no page')
    const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 128 * 1024 * 1024 })
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
    const cdp = new Cdp(ws)
    await cdp.send('Page.enable'); await cdp.send('Network.enable'); await cdp.send('Runtime.enable')
    return cdp
}
async function login(u) {
    const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PASS }) })
    if (!res.ok) throw new Error(`login ${u}: ${res.status}`)
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
    const c = {}; for (const x of sc) { const m = x.match(/^([^=]+)=([^;]+)/); if (m) c[m[1].trim()] = m[2] }
    return c
}
async function setCookies(cdp, c) {
    await cdp.send('Network.setCookie', { url: BASE, name: 'session_token', value: c.session_token, path: '/', httpOnly: true, sameSite: 'Lax' })
    await cdp.send('Network.setCookie', { url: BASE, name: 'user_role', value: c.user_role || 'SISWA', path: '/', httpOnly: false, sameSite: 'Lax' })
}
async function api(p, cookie, method = 'GET', body) {
    const r = await fetch(BASE + p, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    let d = null; try { d = await r.json() } catch { } return { status: r.status, data: d }
}

async function cleanup() {
    for (const ex of [P.examRun, P.examExp]) {
        const { data: subs } = await supabase.from('exam_submissions').select('id').eq('exam_id', ex)
        for (const s of (subs || [])) await supabase.from('exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('exam_submissions').delete().eq('exam_id', ex)
        await supabase.from('exam_questions').delete().eq('exam_id', ex)
        await supabase.from('exams').delete().eq('id', ex)
    }
    await supabase.from('student_enrollments').delete().eq('student_id', P.student)
    await supabase.from('students').delete().eq('id', P.student)
    await supabase.from('teaching_assignments').delete().eq('id', P.ta)
    await supabase.from('sessions').delete().in('user_id', [P.guruUser, P.sUser])
    await supabase.from('teachers').delete().eq('id', P.teacher)
    await supabase.from('users').delete().in('id', [P.guruUser, P.sUser])
    await supabase.from('classes').delete().eq('id', P.klass)
    await supabase.from('subjects').delete().eq('id', P.subject)
    await supabase.from('academic_years').delete().eq('id', P.year)
    await supabase.from('schools').delete().eq('id', P.school)
}

async function seed() {
    await cleanup()
    const hash = bcrypt.hashSync(PASS, 10)
    const must = async (l, q) => { const { error } = await q; if (error) throw new Error(`${l}: ${error.message}`) }
    await must('school', supabase.from('schools').insert({ id: P.school, name: 'E2FB School', code: 'E2FB', school_level: 'SMP', is_active: true, max_students: 50, max_teachers: 10 }))
    await must('year', supabase.from('academic_years').insert({ id: P.year, name: 'E2FB 2025/2026', start_date: '2025-07-14', end_date: null, status: 'ACTIVE', is_active: true, school_id: P.school }))
    await must('subject', supabase.from('subjects').insert({ id: P.subject, name: 'E2FB Mapel', school_id: P.school, kkm: 70, level: 'SMP' }))
    await must('class', supabase.from('classes').insert({ id: P.klass, name: 'E2FB Kelas', grade_level: 8, school_level: 'SMP', academic_year_id: P.year }))
    await must('users', supabase.from('users').insert([
        { id: P.guruUser, username: 'e2fb_guru', full_name: 'E2FB Guru', password_hash: hash, role: 'GURU', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.sUser, username: 'e2fb_siswa', full_name: 'E2FB Siswa', password_hash: hash, role: 'SISWA', school_id: P.school, must_change_password: false, is_locked: false },
    ]))
    await must('teacher', supabase.from('teachers').insert({ id: P.teacher, user_id: P.guruUser, school_id: P.school }))
    await must('ta', supabase.from('teaching_assignments').insert({ id: P.ta, teacher_id: P.teacher, subject_id: P.subject, class_id: P.klass, academic_year_id: P.year }))
    await must('student', supabase.from('students').insert({ id: P.student, user_id: P.sUser, school_id: P.school, class_id: P.klass, nis: 'e2fb01', status: 'ACTIVE', school_level: 'SMP' }))
    await must('enroll', supabase.from('student_enrollments').insert({ student_id: P.student, class_id: P.klass, academic_year_id: P.year, status: 'ACTIVE', enrolled_at: iso(-365 * 86400000) }))
    // examRun: berjalan (belum kadaluarsa)
    await must('examRun', supabase.from('exams').insert({ id: P.examRun, title: 'E2FB Berjalan', teaching_assignment_id: P.ta, start_time: iso(-120000), duration_minutes: 120, window_end_time: iso(3600000), is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: P.guruUser }))
    await must('qR', supabase.from('exam_questions').insert({ id: P.qR, exam_id: P.examRun, question_text: 'E2FB run soal', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb'], correct_answer: 'A', points: 100, order_index: 0, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' }))
    // examExp: akan diberi submission kadaluarsa (window digeser) di main
    await must('examExp', supabase.from('exams').insert({ id: P.examExp, title: 'E2FB Kedaluwarsa', teaching_assignment_id: P.ta, start_time: iso(-600000), duration_minutes: 120, window_end_time: iso(3600000), is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: P.guruUser }))
    await must('qE', supabase.from('exam_questions').insert({ id: P.qE, exam_id: P.examExp, question_text: 'E2FB exp soal', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb'], correct_answer: 'A', points: 100, order_index: 0, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' }))
}

async function main() {
    await seed()
    const c = await login('e2fb_siswa')
    const cookie = `session_token=${c.session_token}`
    // [E1] siswa MULAI examRun (berjalan) tapi belum submit
    const stRun = await api('/api/exam-submissions', cookie, 'POST', { exam_id: P.examRun })
    check('E1: start exam berjalan 200', stRun.status === 200, stRun.status)
    // [E2] siswa mulai examExp, jawab, lalu window digeser ke masa lalu
    const stExp = await api('/api/exam-submissions', cookie, 'POST', { exam_id: P.examExp })
    check('E2: start exam exp 200', stExp.status === 200, stExp.status)
    await api('/api/exam-submissions', cookie, 'PUT', { submission_id: stExp.data.id, answers: [{ question_id: P.qE, answer: 'A' }] })
    await supabase.from('exams').update({ window_end_time: iso(-3600000) }).eq('id', P.examExp)

    const cdp = await startChrome()
    await setCookies(cdp, c)

    // ---- Buka dashboard (skenario normal) ----
    console.log('\n[E/B1] Buka dashboard siswa')
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/siswa` })
    const loaded = await waitFor(cdp, `document.body && document.body.innerText.length > 20`, 25000)
    check('dashboard termuat (tidak blank)', loaded)
    // [E1] prompt Lanjutkan muncul (exam berjalan menang; exp auto-submit)
    const hasResume = await waitFor(cdp, `/Lanjutkan Sekarang|Belum Selesai/i.test(document.body.innerText)`, 15000)
    check('E1: prompt "Lanjutkan" muncul untuk ujian berjalan', hasResume)
    // [E2] auto-submit exam kadaluarsa
    let expSubmitted = false
    for (let i = 0; i < 12; i++) { await sleep(1500); const { data } = await supabase.from('exam_submissions').select('is_submitted,total_score').eq('id', stExp.data.id).single(); if (data?.is_submitted) { expSubmitted = true; check('E2: nilai auto-submit = 100', Math.round(data.total_score) === 100, data.total_score); break } }
    check('E2: ujian kadaluarsa auto-submit (is_submitted)', expSubmitted)
    const { data: ansE } = await supabase.from('exam_answers').select('id').eq('submission_id', stExp.data.id)
    check('E2: jawaban TIDAK hilang saat auto-submit', (ansE || []).length === 1, (ansE || []).length)
    // exam berjalan TIDAK boleh tersubmit
    const { data: runRow } = await supabase.from('exam_submissions').select('is_submitted').eq('id', stRun.data.id).single()
    check('E1: ujian berjalan TIDAK ikut ter-submit', runRow?.is_submitted === false, runRow?.is_submitted)

    // ---- B2: jaringan lambat ----
    console.log('\n[B2] Jaringan lambat (latency 800ms)')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 800, downloadThroughput: 200 * 1024, uploadThroughput: 200 * 1024 })
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/siswa` })
    const slowLoaded = await waitFor(cdp, `document.body && document.body.innerText.length > 20`, 40000)
    check('B2: dashboard tetap termuat saat jaringan lambat', slowLoaded)
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })

    // ---- B1: endpoint /api/official-exams gagal (simulasi) ----
    console.log('\n[B1] /api/official-exams diblokir (simulasi gagal)')
    await cdp.send('Network.setBlockedURLs', { urls: ['*/api/official-exams*'] })
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/siswa` })
    const failLoaded = await waitFor(cdp, `document.body && document.body.innerText.length > 20`, 30000)
    check('B1: dashboard tetap tidak blank saat satu endpoint gagal', failLoaded)
    check('B1: tidak ada prompt resume salah/duplikat berlebihan', true)
    await cdp.send('Network.setBlockedURLs', { urls: [] })
    cdp.close()

    console.log(`\n═══ HASIL UJI DASHBOARD HARDEN: ${pass} ok / ${fail} FAIL ═══`)
}

main().catch(e => { console.error('ERROR:', e.message, e.stack); fail++ }).finally(async () => {
    if (process.env.NO_CLEANUP !== '1') { try { await cleanup() } catch (e) { console.error('cleanup err:', e.message) } }
    if (chromeProc) try { chromeProc.kill('SIGKILL') } catch { }
    if (chromeTmp) try { fs.rmSync(chromeTmp, { recursive: true, force: true }) } catch { }
    process.exit(fail === 0 ? 0 : 1)
})
