/**
 * Browser E2E UI Susulan (staging) — READ-ONLY terhadap data demo.
 *
 * Memverifikasi elemen UI yang tidak dicakup E2E API:
 *  [A] Guru Monitor Live: tombol Susulan, modal (nilai penuh/cap), badge expired.
 *  [B] Siswa: kartu "Mulai Susulan" + expiry/cap, prompt dashboard, UTS/UAS.
 *  [C] Siswa tanpa grant: kartu "Waktu Sudah Habis" (bukan Mulai Susulan).
 *  [D] Admin Monitor Live: tombol Susulan + modal (ulangan ?type=ulangan & UTS).
 *
 * Tidak mengklik tombol yang memulai attempt / grant — data demo tetap utuh.
 *
 * PRASYARAT:
 *   ENV_FILE=.env.staging node scripts/seed-demo-susulan-staging.cjs
 *   E2E_BASE=https://schooledzo-production-e036.up.railway.app \
 *     ENV_FILE=.env.staging node scripts/e2e-browser-susulan.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const WebSocket = require('ws')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'Susulan123!'
const P = 'susa_'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CDP_PORT = Number(process.env.CDP_PORT || 9237)
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

class Cdp {
    constructor(ws) {
        this.ws = ws; this.id = 0; this.pending = new Map()
        ws.on('message', raw => {
            const msg = JSON.parse(raw)
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id)
                this.pending.delete(msg.id)
                msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
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
}

async function evalInPage(cdp, expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails))
    return r.result?.value
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
    if (!cookies.session_token) throw new Error('session_token tidak ditemukan')
    return cookies
}

async function withBrowser(username, pagePath, fn) {
    const cookies = await login(username)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-susulan-'))
    const proc = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${tmp}`,
        '--window-size=1400,1000', 'about:blank',
    ], { stdio: 'ignore' })

    try {
        let targets = null
        for (let i = 0; i < 40; i++) {
            try { const r = await fetch(`http://localhost:${CDP_PORT}/json`); targets = await r.json(); if (targets.length) break } catch { }
            await sleep(500)
        }
        const page = targets?.find(t => t.type === 'page')
        if (!page) throw new Error('Chrome page target tidak ditemukan')
        const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
        await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
        const cdp = new Cdp(ws)
        await cdp.send('Page.enable')
        await cdp.send('Network.enable')
        await cdp.send('Runtime.enable')
        await cdp.send('Network.setCookie', { url: BASE, name: 'session_token', value: cookies.session_token, path: '/', httpOnly: true, sameSite: 'Lax' })
        await cdp.send('Network.setCookie', { url: BASE, name: 'user_role', value: cookies.user_role || 'SISWA', path: '/', httpOnly: false, sameSite: 'Lax' })
        await cdp.send('Page.navigate', { url: `${BASE}${pagePath}` })
        await sleep(8000)
        await fn(cdp)
        ws.close()
    } finally {
        proc.kill('SIGKILL')
        try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { }
    }
}

async function bodyText(cdp) {
    return (await evalInPage(cdp, 'document.body.innerText')) || ''
}

async function closeModalIfAny(cdp) {
    await evalInPage(cdp, `(() => {
        const b = [...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === 'Tutup')
        if (b) b.click()
        const nanti = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Nanti Saja')
        if (nanti) nanti.click()
        return true
    })()`)
    await sleep(600)
}

async function openSusulanModalFor(cdp, studentName) {
    return await evalInPage(cdp, `(() => {
        const row = [...document.querySelectorAll('tr')].find(r => r.innerText.includes(${JSON.stringify(studentName)}))
        if (!row) return 'row-not-found'
        const btn = [...row.querySelectorAll('button')].find(b => b.innerText.trim().startsWith('Susulan'))
        if (!btn) return 'button-not-found'
        btn.click()
        return 'clicked'
    })()`)
}

async function main() {
    const { data: exam } = await supabase.from('exams').select('id').like('title', `${P}Ulangan Berakhir`).maybeSingle()
    const { data: off } = await supabase.from('official_exams').select('id').like('title', `${P}UTS Berakhir`).maybeSingle()
    if (!exam?.id || !off?.id) throw new Error('Demo fixture belum ada. Jalankan seed-demo-susulan-staging.cjs dulu.')

    console.log('\n[A] Guru Monitor Live (ulangan)')
    await withBrowser(`${P}guru`, `/dashboard/guru/ulangan/${exam.id}/monitor`, async (cdp) => {
        const text = await bodyText(cdp)
        check('A1 monitor guru termuat', text.includes('Progress Siswa'))
        check('A2 siswa demo tampil', text.includes('Siswa Demo s1'))
        check('A3 tombol Susulan tampil', text.includes('Susulan'))

        const clicked = await openSusulanModalFor(cdp, 'Siswa Demo s1')
        await sleep(700)
        const modalText = await bodyText(cdp)
        check('A4 modal Susulan terbuka', clicked === 'clicked' && modalText.includes('Susulan — Siswa Demo s1'), clicked)
        check('A5 opsi nilai penuh tampil', modalText.includes('Nilai penuh'))
        check('A6 opsi batasi nilai tampil', modalText.includes('Batasi nilai maksimal'))
        await closeModalIfAny(cdp)

        const after = await bodyText(cdp)
        check('A7 badge/aksi grant expired tampil', after.includes('kedaluwarsa') || after.includes('Perpanjang'))
        check('A8 siswa submit tampil Selesai', after.includes('Selesai'))
    })

    console.log('\n[B] Siswa dengan grant aktif')
    await withBrowser(`${P}s2`, '/dashboard/siswa/ulangan', async (cdp) => {
        const text = await bodyText(cdp)
        check('B1 kartu ulangan tampil', text.includes(`${P}Ulangan Berakhir`))
        check('B2 tombol Mulai Susulan tampil', text.includes('Mulai Susulan'))
        check('B3 expiry/cap tampil', text.includes('Berlaku sampai') && text.includes('nilai maks 80%'))
        check('B5 kartu UTS susulan tampil', text.includes(`${P}UTS Berakhir`) && text.includes('Mulai Susulan'))
        await closeModalIfAny(cdp)

        // Prompt Susulan ada di dashboard siswa (bukan halaman daftar ulangan).
        await cdp.send('Page.navigate', { url: `${BASE}/dashboard/siswa` })
        await sleep(8000)
        const dashText = await bodyText(cdp)
        check('B4 prompt Susulan dashboard tampil', dashText.includes('Susulan Tersedia!') || dashText.includes('kesempatan susulan'))
    })

    console.log('\n[C] Siswa tanpa grant')
    await withBrowser(`${P}s1`, '/dashboard/siswa/ulangan', async (cdp) => {
        const text = await bodyText(cdp)
        check('C1 kartu ulangan tampil', text.includes(`${P}Ulangan Berakhir`))
        check('C2 status Waktu Habis untuk tanpa grant', text.includes('Waktu Sudah Berakhir'))
        check('C3 tidak menampilkan Mulai Susulan', !text.includes('Mulai Susulan'))
    })

    console.log('\n[D] Admin Monitor Live')
    await withBrowser(`${P}admin`, `/dashboard/admin/uts-uas/${exam.id}/monitor?type=ulangan`, async (cdp) => {
        const text = await bodyText(cdp)
        check('D1 admin monitor ulangan termuat', text.includes('Progress Siswa'))
        check('D2 tombol Susulan admin tampil', text.includes('Susulan'))
        const clicked = await openSusulanModalFor(cdp, 'Siswa Demo s1')
        await sleep(700)
        const modalText = await bodyText(cdp)
        check('D3 modal Susulan admin terbuka', clicked === 'clicked' && modalText.includes('Susulan — Siswa Demo s1'), clicked)
        await closeModalIfAny(cdp)
    })

    await withBrowser(`${P}admin`, `/dashboard/admin/uts-uas/${off.id}/monitor`, async (cdp) => {
        const text = await bodyText(cdp)
        check('D4 admin monitor UTS termuat', text.includes('Progress Siswa'))
        check('D5 tombol Susulan UTS admin tampil', text.includes('Susulan'))
    })

    if (process.env.START_FLOW === '1') {
        console.log('\n[E] Start Susulan (mutasi — reseed demo setelah ini)')
        await withBrowser(`${P}s2`, `/dashboard/siswa/ulangan/${exam.id}`, async (cdp) => {
            const text = await bodyText(cdp)
            check('E1 runner susulan tidak crash', !/Application error|client-side exception/i.test(text), text.slice(0, 200))
            check('E2 soal susulan tampil', /susa_soal|Soal\s*1/i.test(text))
            check('E3 timer/sisa waktu tampil', /\d{1,2}:\d{2}/.test(text) || /sisa waktu/i.test(text))
        })
    }

    console.log(`\n=== BROWSER SUSULAN: ${pass} pass, ${fail} fail ===`)
    process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
