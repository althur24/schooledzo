/**
 * MONITOR POLLER — guru/admin polling Monitor Live UTS/UAS selama load test
 * berjalan (dipasangkan dengan k6 loadtest/tryout.js).
 *
 * Membuat fixture guru + TA (mapel × 10 kelas) di atas seed_loadtest.cjs
 * (LOADTEST School, UUID deterministik prefix 7e57b... — namespace sendiri,
 * tidak bentrok dengan load_batch_1000), lalu polling
 * GET /api/official-exam-submissions/monitor?exam_id=... tiap POLL_MS.
 *
 * Ini mengukur endpoint yang dirombak commit 1d687d8 (roster interval
 * enrollment + fetchAllRows + batchedIn + RPC answerStats) DI BAWAH BEBAN
 * 1000 siswa autosave serentak — jalur yang di-poll guru asli tiap 15 dtk
 * selama UTS berjalan.
 *
 * Jalankan (bersamaan dengan k6):
 *   ENV_FILE=.env.staging LOAD_BASE=https://<railway> \
 *     EXAM_ID=7e575000-0000-0000-0000-000000000001 \
 *     node loadtest/e2e/monitor_poll.cjs
 * Berhenti otomatis saat DURATION_MS tercapai, atau <Ctrl-C> (summary tetap
 * dicetak). Cleanup fixture: node loadtest/e2e/monitor_poll.cjs cleanup
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const BASE = process.env.LOAD_BASE || 'http://localhost:3000'
// Namespace seed_loadtest (lihat loadtest/seed_loadtest.cjs)
const P = {
    school: '7e570000-0000-0000-0000-000000000001',
    year: '7e570000-0000-0000-0000-000000000002',
    subject: '7e570000-0000-0000-0000-000000000003',
    klass: (i) => `7e570001-0000-0000-0000-${i.toString(16).padStart(12, '0')}`,
    // Namespace poller ini sendiri (prefix 7e57b)
    guruUser: '7e57b000-0000-0000-0000-000000000001',
    teacher: '7e57b100-0000-0000-0000-000000000001',
    ta: (i) => `7e57b200-0000-0000-0000-${i.toString(16).padStart(12, '0')}`,
    exam: process.env.EXAM_ID || '7e575000-0000-0000-0000-000000000001',
}
const TOKEN = 'lt_guru_monitorpoll_token_0001'
const POLL_MS = parseInt(process.env.POLL_MS || '15000', 10)
const DURATION_MS = parseInt(process.env.DURATION_MS || '', 10) || 11 * 60 * 1000

const pct = (arr, p) => { if (!arr.length) return -1; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) }

let interrupted = false
process.on('SIGINT', () => { console.log('\n[SIGINT] berhenti — summary...'); interrupted = true })

async function fixture() {
    const passHash = bcrypt.hashSync('Loadtest123!', 10)
    const { error: uErr } = await supabase.from('users').upsert({
        id: P.guruUser, username: 'lt_guru_monitorpoll', full_name: 'LT Guru MonitorPoll',
        password_hash: passHash, role: 'GURU', school_id: P.school, must_change_password: false, is_locked: false,
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (uErr) throw new Error('guru user: ' + uErr.message)
    await supabase.from('teachers').upsert({ id: P.teacher, user_id: P.guruUser, school_id: P.school }, { onConflict: 'id', ignoreDuplicates: true })
    await supabase.from('sessions').upsert({ user_id: P.guruUser, token: TOKEN, expires_at: new Date(Date.now() + 86400e3).toISOString() }, { onConflict: 'token', ignoreDuplicates: true })
    for (let i = 1; i <= 10; i++) {
        await supabase.from('teaching_assignments').upsert({
            id: P.ta(i), teacher_id: P.teacher, class_id: P.klass(i),
            subject_id: P.subject, academic_year_id: P.year,
        }, { onConflict: 'id', ignoreDuplicates: true })
    }
    console.log(`fixture OK: guru + TA 10 kelas | target ${BASE} | exam ${P.exam}`)
}

async function poll() {
    const times = []
    const statuses = {}
    let lastSummary = null
    const t0 = Date.now()
    while (!interrupted && Date.now() - t0 < DURATION_MS) {
        const s = Date.now()
        try {
            const res = await fetch(`${BASE}/api/official-exam-submissions/monitor?exam_id=${P.exam}`, {
                headers: { Cookie: `session_token=${TOKEN}` },
                signal: AbortSignal.timeout(60000),
            })
            const ms = Date.now() - s
            times.push(ms)
            statuses[res.status] = (statuses[res.status] || 0) + 1
            if (res.status === 200) {
                const body = await res.json().catch(() => null)
                if (body?.summary) {
                    lastSummary = body.summary
                    console.log(`poll #${times.length}: ${ms}ms | target ${body.summary.total_target_students} · belum ${body.summary.not_started} · kerjakan ${body.summary.working} · selesai ${body.summary.submitted}`)
                } else {
                    console.log(`poll #${times.length}: ${ms}ms | 200 tanpa summary`)
                }
            } else {
                console.log(`poll #${times.length}: ${ms}ms | HTTP ${res.status}`)
            }
        } catch (e) {
            times.push(Date.now() - s)
            const code = e?.cause?.code || e.name || 'error'
            statuses[code] = (statuses[code] || 0) + 1
            console.log(`poll #${times.length}: ERROR ${code}`)
        }
        await new Promise(r => setTimeout(r, POLL_MS))
    }
    console.log('\n===== MONITOR POLLER: RINGKASAN =====')
    console.log(`poll total : ${times.length} | status: ${JSON.stringify(statuses)}`)
    console.log(`p50/p95/max: ${pct(times, .5)}ms / ${pct(times, .95)}ms / ${Math.max(...times, 0)}ms  (guard: p95 < 10000ms)`)
    if (lastSummary) console.log(`summary akhir: ${JSON.stringify(lastSummary)}`)
    const non200 = Object.entries(statuses).filter(([k]) => k !== '200').reduce((a, [, v]) => a + v, 0)
    const pass = times.length > 0 && non200 === 0 && pct(times, .95) < 10000
    console.log(pass ? 'MONITOR-POLL: PASS ✅' : 'MONITOR-POLL: FAIL ❌')
    if (!pass) process.exitCode = 1
}

async function cleanup() {
    for (let i = 1; i <= 10; i++) await supabase.from('teaching_assignments').delete().eq('id', P.ta(i))
    await supabase.from('sessions').delete().eq('token', TOKEN)
    await supabase.from('teachers').delete().eq('id', P.teacher)
    await supabase.from('notifications').delete().eq('user_id', P.guruUser)
    await supabase.from('users').delete().eq('id', P.guruUser)
    console.log('cleanup monitor-poll OK')
}

const mode = process.argv[2]
if (mode === 'cleanup') cleanup().catch(e => { console.error(e); process.exit(1) })
else (async () => { await fixture(); await poll(); })().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
