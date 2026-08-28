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
const bcrypt = require('bcryptjs')
const { assertMin, mustInsert, spawnServer, stopServerSafe, waitPortUp } = require('./helpers.cjs')

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
function fmtPct(arr, p) { return arr.length ? `${pct(arr, p)}ms` : 'n/a (n=0)' }

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

let server = null
async function startServer() {
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
}
async function stopServer() {
    // hanya membunuh process group milik sendiri — bukan pkill yang bisa kena proses lain
    await stopServerSafe(server, BASE)
    server = null
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

    // fixtures — template wajib ada, gagal insert harus throw (bukan null diam-diam)
    const { data: school } = await supabase.from('schools').select('id').limit(1).single()
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).limit(1).maybeSingle()
    if (!school || !year) throw new Error('school/tahun ajaran aktif tidak ditemukan')
    const { data: subjT } = await supabase.from('subjects').select('*').limit(1)
    const { data: classT } = await supabase.from('classes').select('*').limit(1)
    const { data: examT } = await supabase.from('official_exams').select('*').limit(1)
    const { data: qT } = await supabase.from('official_exam_questions').select('*').limit(1)
    const { data: studT } = await supabase.from('students').select('*').limit(1)
    assertMin(subjT?.length || 0, 1, 'template subjects')
    assertMin(classT?.length || 0, 1, 'template classes')
    assertMin(examT?.length || 0, 1, 'template official_exams')
    assertMin(qT?.length || 0, 1, 'template official_exam_questions')
    assertMin(studT?.length || 0, 1, 'template students')

    const subject = await mustInsert(supabase, 'subjects',
        { ...subjT[0], id: undefined, name: `${U} Mapel`, school_id: school.id }, 'subject fixture')
    created.subjects.push(subject.id)
    const klass = await mustInsert(supabase, 'classes',
        { ...classT[0], id: undefined, name: `${U} Kelas`, academic_year_id: year.id }, 'class fixture')
    created.classes.push(klass.id)

    const now = Date.now()
    const exam = await mustInsert(supabase, 'official_exams', {
        ...examT[0], id: undefined, title: `${U} TO`, school_id: school.id, subject_id: subject.id, academic_year_id: year.id,
        exam_type: 'UTS', start_time: new Date(now - 10 * 60e3).toISOString(), duration_minutes: 120,
        is_active: true, is_remedial: false, allowed_student_ids: null, target_class_ids: [klass.id],
    }, 'exam fixture')
    created.exams.push(exam.id)

    const qIds = []
    for (let q = 1; q <= 10; q++) {
        const data = await mustInsert(supabase, 'official_exam_questions', {
            ...qT[0], id: undefined, exam_id: exam.id, question_text: `${U} soal ${q}`, question_type: 'MULTIPLE_CHOICE',
            options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 10, order_index: q,
        }, `soal #${q}`)
        created.questions.push(data.id)
        qIds.push(data.id)
    }

    const passHash = bcrypt.hashSync('ld', 10)
    const users = []
    for (let n = 1; n <= N_STUDENTS; n++) {
        const pad = String(n).padStart(3, '0')
        const u = await mustInsert(supabase, 'users',
            { username: `${U}_${pad}`, full_name: `${U} Siswa ${pad}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user siswa ${pad}`)
        const st = await mustInsert(supabase, 'students',
            { ...studT[0], id: undefined, user_id: u.id, nis: `${runId}${pad}`, class_id: klass.id, school_id: studT[0]?.school_id ?? school.id }, `student ${pad}`)
        const se = await mustInsert(supabase, 'sessions',
            { user_id: u.id, token: `${U}_tok_${pad}`, expires_at: new Date(now + 86400e3).toISOString() }, `session ${pad}`)
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
    console.log(`start_exam    : n=${metrics.start.length} p50=${fmtPct(metrics.start, .5)} p95=${fmtPct(metrics.start, .95)}`)
    console.log(`save_answer   : n=${metrics.save.length} p50=${fmtPct(metrics.save, .5)} p95=${fmtPct(metrics.save, .95)}  (target p95<800)`)
    console.log(`notifications : n=${metrics.notif.length} p50=${fmtPct(metrics.notif, .5)} p95=${fmtPct(metrics.notif, .95)}  (target p95<300)`)
    console.log(`submit        : n=${metrics.submit.length} p50=${fmtPct(metrics.submit, .5)} p95=${fmtPct(metrics.submit, .95)}`)
    // guard array kosong: pct() = -1 saat n=0 bisa lolos threshold <800 secara palsu
    const pass = metrics.total > 0
        && metrics.errors / metrics.total < 0.01
        && metrics.save.length > 0 && pct(metrics.save, .95) < 800
        && metrics.notif.length > 0 && pct(metrics.notif, .95) < 300
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
