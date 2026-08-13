/**
 * D1 — Load test SMOKE 50 siswa berbarengan (tanpa k6, dependensi nol).
 *
 * Membuat fixtures sendiri (50 user e2e, 1 ujian live, 10 soal PG), menjalankan
 * `next start` lokal, lalu 50 "siswa virtual" berbarengan: mulai ujian →
 * autosave jawaban tiap 2-5 dtk → polling notifikasi tiap 15 dtk → submit.
 * Mengukur p50/p95 per endpoint dan error rate. Cleanup otomatis.
 *
 * Jalankan: node loadtest/e2e/load_smoke.cjs
 * (Full test 1000 VU tetap pakai k6: loadtest/tryout.js — lihat D2.)
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const { spawn } = require('child_process')
const bcrypt = require('bcryptjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3100
const BASE = `http://localhost:${PORT}`
const N_STUDENTS = 50
const DURATION_MS = 60 * 1000      // lama fase mengerjakan
const SAVE_EVERY = [2000, 5000]    // autosave tiap 2-5 dtk (lebih rapat dari produksi: smoke)
const NOTIF_EVERY_MS = 15000

const metrics = { save: [], notif: [], start: [], submit: [], errors: 0, total: 0 }
function record(bucket, ms) { metrics[bucket].push(ms) }
function pct(arr, p) { if (!arr.length) return -1; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) }

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

let server = null
async function startServer() {
    server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' })
    for (let i = 0; i < 60; i++) {
        try { const r = await fetch(BASE + '/login'); if (r.status) return } catch { }
        await sleep(1000)
    }
    throw new Error('server tidak start')
}
async function stopServer() {
    if (server) { server.kill('SIGTERM'); server = null }
    spawn('pkill', ['-f', `next start.*${PORT}`])
    await sleep(2000)
}

async function api(path, opts, token, bucket) {
    const t0 = Date.now()
    try {
        const res = await fetch(BASE + path, {
            ...opts,
            headers: { 'Content-Type': 'application/json', Cookie: `session_token=${token}` },
        })
        const ms = Date.now() - t0
        metrics.total++
        if (res.status >= 500) metrics.errors++
        if (bucket) record(bucket, ms)
        let body = null
        try { body = await res.json() } catch { }
        return { status: res.status, body }
    } catch (e) {
        metrics.total++; metrics.errors++
        return { status: 0, body: null }
    }
}

const created = { users: [], students: [], sessions: [], exams: [], questions: [], submissions: [], classes: [], subjects: [], enrollments: [] }

async function main() {
    const runId = Date.now() % 100000
    const U = `ld_${runId}`

    // fixtures
    const { data: school } = await supabase.from('schools').select('id').limit(1).single()
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    const { data: subjT } = await supabase.from('subjects').select('*').limit(1)
    const { data: classT } = await supabase.from('classes').select('*').limit(1)
    const { data: examT } = await supabase.from('official_exams').select('*').limit(1)
    const { data: qT } = await supabase.from('official_exam_questions').select('*').limit(1)
    const { data: studT } = await supabase.from('students').select('*').limit(1)

    const { data: subject } = await supabase.from('subjects').insert({ ...subjT[0], id: undefined, name: `${U} Mapel`, school_id: school.id }).select().single()
    created.subjects.push(subject.id)
    const { data: klass } = await supabase.from('classes').insert({ ...classT[0], id: undefined, name: `${U} Kelas`, academic_year_id: year.id }).select().single()
    created.classes.push(klass.id)

    const now = Date.now()
    const { data: exam } = await supabase.from('official_exams').insert({
        ...examT[0], id: undefined, title: `${U} TO`, school_id: school.id, subject_id: subject.id, academic_year_id: year.id,
        exam_type: 'UTS', start_time: new Date(now - 10 * 60e3).toISOString(), duration_minutes: 120,
        is_active: true, is_remedial: false, allowed_student_ids: null, target_class_ids: [klass.id],
    }).select().single()
    created.exams.push(exam.id)

    const qIds = []
    for (let q = 1; q <= 10; q++) {
        const { data } = await supabase.from('official_exam_questions').insert({
            ...qT[0], id: undefined, exam_id: exam.id, question_text: `${U} soal ${q}`, question_type: 'MULTIPLE_CHOICE',
            options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 10, order_index: q,
        }).select().single()
        created.questions.push(data.id)
        qIds.push(data.id)
    }

    const passHash = bcrypt.hashSync('ld', 10)
    const users = []
    for (let n = 1; n <= N_STUDENTS; n++) {
        const pad = String(n).padStart(3, '0')
        const { data: u } = await supabase.from('users').insert({ username: `${U}_${pad}`, full_name: `${U} Siswa ${pad}`, password_hash: passHash, role: 'SISWA', school_id: school.id }).select().single()
        const { data: st } = await supabase.from('students').insert({ ...studT[0], id: undefined, user_id: u.id, nis: `${runId}${pad}`, class_id: klass.id, school_id: studT[0]?.school_id ?? school.id }).select().single()
        const { data: se } = await supabase.from('sessions').insert({ user_id: u.id, token: `${U}_tok_${pad}`, expires_at: new Date(now + 86400e3).toISOString() }).select().single()
        created.users.push(u.id); created.students.push(st.id); created.sessions.push(se.id)
        users.push({ token: `${U}_tok_${pad}` })
    }
    console.log(`fixtures OK: ${N_STUDENTS} siswa, 1 ujian, 10 soal`)

    await startServer()
    console.log('server up — mulai fase ujian 60 detik...')

    // fase ujian: semua siswa berbarengan
    const studentWork = async (u) => {
        const start = await api('/api/official-exam-submissions', { method: 'POST', body: JSON.stringify({ exam_id: exam.id }) }, u.token, 'start')
        const subId = start.body?.id
        if (!subId) return
        created.submissions.push(subId)
        let lastNotif = 0
        const t0 = Date.now()
        while (Date.now() - t0 < DURATION_MS) {
            await api('/api/official-exam-submissions', {
                method: 'PUT',
                body: JSON.stringify({ submission_id: subId, answers: [{ question_id: qIds[rand(0, 9)], answer: 'ABCD'[rand(0, 3)] }] }),
            }, u.token, 'save')
            if (Date.now() - lastNotif > NOTIF_EVERY_MS) {
                lastNotif = Date.now()
                await api('/api/notifications?limit=10', {}, u.token, 'notif')
            }
            await sleep(rand(...SAVE_EVERY))
        }
        await api('/api/official-exam-submissions', { method: 'PUT', body: JSON.stringify({ submission_id: subId, submit: true }) }, u.token, 'submit')
    }

    await Promise.all(users.map(studentWork))
    await stopServer()

    const errRate = metrics.total ? (metrics.errors / metrics.total * 100).toFixed(2) : '0'
    console.log('\n===== HASIL SMOKE 50 VU =====')
    console.log(`total request : ${metrics.total} (error ${metrics.errors} = ${errRate}%)`)
    console.log(`start_exam    : n=${metrics.start.length} p50=${pct(metrics.start, .5)}ms p95=${pct(metrics.start, .95)}ms`)
    console.log(`save_answer   : n=${metrics.save.length} p50=${pct(metrics.save, .5)}ms p95=${pct(metrics.save, .95)}ms  (target p95<800)`)
    console.log(`notifications : n=${metrics.notif.length} p50=${pct(metrics.notif, .5)}ms p95=${pct(metrics.notif, .95)}ms  (target p95<300)`)
    console.log(`submit        : n=${metrics.submit.length} p50=${pct(metrics.submit, .5)}ms p95=${pct(metrics.submit, .95)}ms`)
    const pass = metrics.errors / metrics.total < 0.01 && pct(metrics.save, .95) < 800 && pct(metrics.notif, .95) < 300
    console.log(pass ? 'D1: PASS (semua threshold terpenuhi)' : 'D1: FAIL (ada threshold dilanggar)')
}

async function cleanup() {
    console.log('cleanup...')
    for (const sid of created.submissions) {
        await supabase.from('official_exam_answers').delete().eq('submission_id', sid)
        await supabase.from('official_exam_submissions').delete().eq('id', sid)
    }
    for (const uid of created.users) await supabase.from('notifications').delete().eq('user_id', uid)
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : null
    await del('sessions', created.sessions)
    await del('official_exam_questions', created.questions)
    await del('official_exams', created.exams)
    await del('students', created.students)
    await del('users', created.users)
    await del('classes', created.classes)
    await del('subjects', created.subjects)
    console.log('cleanup selesai')
}

main()
    .catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
    .finally(async () => { await stopServer(); await cleanup(); process.exit(process.exitCode || 0) })
