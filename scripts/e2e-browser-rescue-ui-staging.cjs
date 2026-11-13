/**
 * Uji UI halaman RESCUE (staging) — memastikan tidying:
 *  - Tombol back header mengarah ke /dashboard/siswa (bukan daftar ulangan)
 *  - Tidak ada lagi teks "Kembali ke daftar ulangan"
 *  - Tidak ada baris teknis "ID: <uuid>"
 *  - Kartu draft tampil + tombol "Kirim Jawaban Saya" berfungsi (rescue nyata)
 *
 * Fixture prefix e2fd + cleanup.
 * Jalankan: ENV_FILE=.env.staging E2E_BASE=https://... node scripts/e2e-browser-rescue-ui-staging.cjs
 */
require('./../loadtest/e2e/helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { spawn } = require('child_process')
const fs = require('fs'); const os = require('os'); const path = require('path')
const WebSocket = require('ws')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2rs1234!'
const PFX = 'e2fd0000-0000-4000-8000-'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CDP_PORT = 9233
const P = {
    school: `${PFX}000000000001`, year: `${PFX}000000000002`, subject: `${PFX}000000000003`, klass: `${PFX}000000000004`,
    guruUser: `${PFX}100000000001`, teacher: `${PFX}100000000002`, ta: `${PFX}100000000003`,
    sUser: `${PFX}200000000001`, student: `${PFX}200000000002`,
    exam: `${PFX}300000000001`, q1: `${PFX}400000000001`, q2: `${PFX}400000000002`,
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
let pass = 0, fail = 0, chromeProc = null, chromeTmp = null
const check = (n, c, d) => { if (c) { pass++; console.log(`  ok : ${n}`) } else { fail++; console.log(`  FAIL: ${n}${d !== undefined ? ' — ' + String(d).slice(0, 200) : ''}`) } }
const iso = (ms) => new Date(Date.now() + ms).toISOString()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

class Cdp {
    constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.h = []
        ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } else if (m.method) this.h.forEach(f => f(m)) }) }
    send(method, params = {}) { return new Promise((res, rej) => { const id = ++this.id; this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })) }) }
    on(f) { this.h.push(f) } close() { this.ws.close() }
}
async function ev(cdp, expr) { const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value }
async function waitFor(cdp, expr, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(cdp, expr)) return true } catch { } await sleep(400) } return false }

async function startChrome() {
    chromeTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-rs-'))
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

async function cleanup() {
    const { data: subs } = await supabase.from('exam_submissions').select('id').eq('exam_id', P.exam)
    for (const s of (subs || [])) await supabase.from('exam_answers').delete().eq('submission_id', s.id)
    await supabase.from('exam_submissions').delete().eq('exam_id', P.exam)
    await supabase.from('exam_questions').delete().eq('exam_id', P.exam)
    await supabase.from('exams').delete().eq('id', P.exam)
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
    await must('school', supabase.from('schools').insert({ id: P.school, name: 'E2FD School', code: 'E2FD', school_level: 'SMP', is_active: true, max_students: 50, max_teachers: 10 }))
    await must('year', supabase.from('academic_years').insert({ id: P.year, name: 'E2FD 2025/2026', start_date: '2025-07-14', end_date: null, status: 'ACTIVE', is_active: true, school_id: P.school }))
    await must('subject', supabase.from('subjects').insert({ id: P.subject, name: 'E2FD Mapel', school_id: P.school, kkm: 70, level: 'SMP' }))
    await must('klass', supabase.from('classes').insert({ id: P.klass, name: 'E2FD Kelas', grade_level: 8, school_level: 'SMP', academic_year_id: P.year }))
    await must('users', supabase.from('users').insert([
        { id: P.guruUser, username: 'e2fd_guru', full_name: 'E2FD Guru', password_hash: hash, role: 'GURU', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.sUser, username: 'e2fd_siswa', full_name: 'E2FD Siswa', password_hash: hash, role: 'SISWA', school_id: P.school, must_change_password: false, is_locked: false },
    ]))
    await must('teacher', supabase.from('teachers').insert({ id: P.teacher, user_id: P.guruUser, school_id: P.school }))
    await must('ta', supabase.from('teaching_assignments').insert({ id: P.ta, teacher_id: P.teacher, subject_id: P.subject, class_id: P.klass, academic_year_id: P.year }))
    await must('student', supabase.from('students').insert({ id: P.student, user_id: P.sUser, school_id: P.school, class_id: P.klass, nis: 'e2fd01', status: 'ACTIVE', school_level: 'SMP' }))
    await must('enroll', supabase.from('student_enrollments').insert({ student_id: P.student, class_id: P.klass, academic_year_id: P.year, status: 'ACTIVE', enrolled_at: iso(-365 * 86400000) }))
    await must('exam', supabase.from('exams').insert({ id: P.exam, title: 'E2FD Ulangan Rescue', teaching_assignment_id: P.ta, start_time: iso(-7200000), duration_minutes: 30, is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: P.guruUser }))
    await must('q', supabase.from('exam_questions').insert([
        { id: P.q1, exam_id: P.exam, question_text: 'E2FD soal 1', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb'], correct_answer: 'A', points: 50, order_index: 0, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
        { id: P.q2, exam_id: P.exam, question_text: 'E2FD soal 2', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb'], correct_answer: 'B', points: 50, order_index: 1, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
    ]))
    // submission SUDAH ditutup sweep, 0 jawaban (kondisi yang butuh rescue)
    await must('sub', supabase.from('exam_submissions').insert({ exam_id: P.exam, student_id: P.student, is_submitted: true, submitted_at: iso(-3600000), started_at: iso(-5400000), total_score: 0, max_score: 100, is_graded: true }))
}

async function main() {
    await seed()
    // login siswa → cookie
    const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'e2fd_siswa', password: PASS }) })
    if (!res.ok) throw new Error('login: ' + res.status)
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
    const cookies = {}; for (const x of sc) { const m = x.match(/^([^=]+)=([^;]+)/); if (m) cookies[m[1].trim()] = m[2] }

    const cdp = await startChrome()
    await cdp.send('Network.setCookie', { url: BASE, name: 'session_token', value: cookies.session_token, path: '/', httpOnly: true, sameSite: 'Lax' })
    if (cookies.user_role) await cdp.send('Network.setCookie', { url: BASE, name: 'user_role', value: cookies.user_role, path: '/', httpOnly: false, sameSite: 'Lax' })

    // Buka origin dulu (agar localStorage bisa diisi), lalu inject draft.
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/siswa` })
    await sleep(2500)
    await ev(cdp, `localStorage.setItem('exam_${P.exam}_answers', JSON.stringify({ answers: { '${P.q1}': 'A', '${P.q2}': 'B' }, synced: {}, lastSaved: new Date().toISOString() }))`)

    // Buka halaman rescue
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/siswa/ulangan/rescue` })
    const loaded = await waitFor(cdp, `document.body && document.body.innerText.includes('Selamatkan Draft Jawaban')`, 25000)
    check('halaman rescue termuat', loaded)

    // Back header → /dashboard/siswa
    const backHref = await ev(cdp, `(() => { const a = document.querySelector('header a[href], a[href="/dashboard/siswa"]'); const links=[...document.querySelectorAll('a')].map(x=>x.getAttribute('href')).filter(Boolean); return { hasDash: links.includes('/dashboard/siswa'), hasList: links.includes('/dashboard/siswa/ulangan'), links } })()`)
    check('tombol back header menuju /dashboard/siswa', backHref?.hasDash === true, backHref)
    check('TIDAK ada link ke /dashboard/siswa/ulangan', backHref?.hasList === false, backHref)

    const text = await ev(cdp, `document.body.innerText`)
    check('TIDAK ada teks "Kembali ke daftar"', !/Kembali ke daftar/i.test(String(text)))
    check('TIDAK ada teks "ID:" pada kartu', !/\bID:\s*[0-9a-f]{8}/i.test(String(text)))
    check('kartu draft tampil (E2FD Ulangan Rescue)', /E2FD Ulangan Rescue/.test(String(text)))

    // Tombol kirim ada & berfungsi
    const hasBtn = await ev(cdp, `[...document.querySelectorAll('button')].some(b=>/Kirim Jawaban Saya/i.test(b.textContent))`)
    check('tombol "Kirim Jawaban Saya" tampil', hasBtn === true)
    if (hasBtn) {
        await ev(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/Kirim Jawaban Saya/i.test(x.textContent)); b.click(); return true })()`)
        const ok = await waitFor(cdp, `/Berhasil|terselamatkan|tidak ada perubahan|sudah ada di server/i.test(document.body.innerText)`, 20000)
        check('klik kirim → respons tampil', ok)
        await sleep(1500)
        const { data: sub } = await supabase.from('exam_submissions').select('total_score').eq('exam_id', P.exam).eq('student_id', P.student).single()
        const { count } = await supabase.from('exam_answers').select('id', { count: 'exact', head: true }).eq('submission_id', (await supabase.from('exam_submissions').select('id').eq('exam_id', P.exam).eq('student_id', P.student).single()).data.id)
        check('rescue menambah jawaban ke server (2)', (count || 0) === 2, count)
        check('skor jadi 100 (2×50 benar)', Math.round(sub?.total_score) === 100, sub?.total_score)
    }

    cdp.close()
    console.log(`\n═══ HASIL UJI UI RESCUE: ${pass} ok / ${fail} FAIL ═══`)
}
main().catch(e => { console.error('ERROR:', e.message, e.stack); fail++ }).finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup:', e.message) }
    if (chromeProc) try { chromeProc.kill('SIGKILL') } catch { }
    if (chromeTmp) try { fs.rmSync(chromeTmp, { recursive: true, force: true }) } catch { }
    process.exit(fail === 0 ? 0 : 1)
})
