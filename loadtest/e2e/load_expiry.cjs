/**
 * Load test EXPIRY — 50 siswa berbarengan, jendela ujian MENUTUP di tengah fase kerja.
 * Memvalidasi penegakan batas waktu di bawah beban (TIME_ENFORCEMENT_UPGRADE_PLAN Fase 6):
 *  - 0 write diterima setelah ends_at + grace 60 dtk (yang lewat harus 409 TIME_EXPIRED)
 *  - tidak ada 5xx apa pun (409 yang diharapkan bukan error)
 *  - semua submission tertutup ≤ ends_at + buffer sweep + 2 tick (≤ ~4,5 menit)
 *  - p95 autosave fase normal (sebelum jendela tutup) < 800ms (hot path tanpa query tambahan)
 *
 * Jalankan: node loadtest/e2e/load_expiry.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { assertMin, mustInsert, spawnServer, stopServerSafe, waitPortUp } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3100
const BASE = `http://localhost:${PORT}`
const N_STUDENTS = require('./helpers.cjs').nStudents(50)
const DURATION_MS = 120 * 1000      // fase kerja 2 menit (jendela menutup di detik ke-30)
const SAVE_EVERY = [1000, 3000]

const metrics = { saveOk: [], saveLate: [], errors5xx: 0, total: 0 }
const statusHist = {}
const pct = (arr, p) => { if (!arr.length) return -1; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) }
const fmtPct = (arr, p) => arr.length ? `${pct(arr, p)}ms` : 'n/a (n=0)'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

let server = null
const serverErrLines = []
async function startServer() {
    server = spawnServer(process.cwd(), PORT, ['ignore', 'pipe', 'pipe'])
    const capture = (chunk) => {
        const lines = chunk.toString().split('\n').filter(l => /error|Error|warn|Auto-close|auto-close/i.test(l))
        serverErrLines.push(...lines)
        if (serverErrLines.length > 300) serverErrLines.splice(0, serverErrLines.length - 300)
    }
    server.stdout.on('data', capture)
    server.stderr.on('data', capture)
    await waitPortUp(BASE)
    await require('./helpers.cjs').assertServerDb(BASE, !!(process.env.ENV_FILE || '').includes('staging'))
}
async function stopServer() {
    // hanya membunuh process group milik sendiri — bukan pkill yang bisa kena proses lain
    await stopServerSafe(server, BASE)
    server = null
}

const created = { users: [], students: [], sessions: [], exams: [], questions: [], submissions: [], classes: [], subjects: [] }

async function main() {
    const runId = Date.now() % 100000
    const U = `lx_${runId}`

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

    // Jendela: mulai 30 dtk lalu, durasi 1 mnt → MENUTUP ~30 dtk setelah fase kerja mulai
    const now = Date.now()
    const exam = await mustInsert(supabase, 'official_exams', {
        ...examT[0], id: undefined, title: `${U} TO`, school_id: school.id, subject_id: subject.id, academic_year_id: year.id,
        exam_type: 'UTS', start_time: new Date(now - 30 * 1000).toISOString(), duration_minutes: 1,
        is_active: true, is_remedial: false, allowed_student_ids: null, target_class_ids: [klass.id],
    }, 'exam fixture')
    created.exams.push(exam.id)
    // windowEnd/graceEnd di-set nanti setelah server up (jendela harus menutup di tengah fase kerja)

    const qIds = []
    for (let q = 1; q <= 5; q++) {
        const data = await mustInsert(supabase, 'official_exam_questions', {
            ...qT[0], id: undefined, exam_id: exam.id, question_text: `${U} soal ${q}`, question_type: 'MULTIPLE_CHOICE',
            options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 20, order_index: q,
        }, `soal #${q}`)
        created.questions.push(data.id)
        qIds.push(data.id)
    }

    const passHash = bcrypt.hashSync('lx', 10)
    const users = []
    for (let n = 1; n <= N_STUDENTS; n++) {
        const pad = String(n).padStart(3, '0')
        const u = await mustInsert(supabase, 'users',
            { username: `${U}_${pad}`, full_name: `${U} Siswa ${pad}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user siswa ${pad}`)
        const st = await mustInsert(supabase, 'students',
            { ...studT[0], id: undefined, user_id: u.id, nis: `${runId}${pad}`, class_id: klass.id, school_id: studT[0]?.school_id ?? school.id }, `student ${pad}`)
        // Enrollment wajib: start ujian resmi memverifikasi student_enrollments (ACTIVE, tahun aktif)
        await mustInsert(supabase, 'student_enrollments',
            { student_id: st.id, class_id: klass.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${pad}`)
        const se = await mustInsert(supabase, 'sessions',
            { user_id: u.id, token: `${U}_tok_${pad}`, expires_at: new Date(now + 86400e3).toISOString() }, `session ${pad}`)
        created.users.push(u.id); created.students.push(st.id); created.sessions.push(se.id)
        users.push({ token: `${U}_tok_${pad}` })
    }
    console.log(`fixtures OK: ${N_STUDENTS} siswa — jendela di-set setelah server up`)

    await startServer()
    // Jendela di-set SEKARANG (setelah fixtures + boot): mulai 30 dtk lalu, durasi 1 mnt
    // → menutup ~30 dtk ke dalam fase kerja. Start gate memakai nilai DB saat request.
    const phaseNow = Date.now()
    await supabase.from('official_exams').update({ start_time: new Date(phaseNow - 30 * 1000).toISOString() }).eq('id', exam.id)
    const windowEnd = phaseNow + 30 * 1000
    const graceEnd = windowEnd + 60 * 1000
    console.log(`server up — fase kerja 2 menit; jendela menutup ${new Date(windowEnd).toISOString()} (grace s.d. ${new Date(graceEnd).toISOString()})`)

    let acceptedAfterGrace = 0
    let closedEarly = 0 // 409 SEBELUM windowEnd = bug (terlalu agresif)
    let startFail = 0   // start gagal (bukan 5xx) — dicatat terpisah dengan statusnya
    const startFailHist = {}
    const studentWork = async (u) => {
        const start = await fetch(BASE + '/api/official-exam-submissions', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `session_token=${u.token}` },
            body: JSON.stringify({ exam_id: exam.id })
        })
        const startBody = await start.json().catch(() => null)
        const subId = startBody?.id
        if (!subId) {
            startFail++
            startFailHist[start.status] = (startFailHist[start.status] || 0) + 1
            if (start.status >= 500) metrics.errors5xx++
            return
        }
        created.submissions.push(subId)
        const t0 = Date.now()
        while (Date.now() - t0 < DURATION_MS) {
            const reqStart = Date.now()
            const res = await fetch(BASE + '/api/official-exam-submissions', {
                method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: `session_token=${u.token}` },
                body: JSON.stringify({ submission_id: subId, answers: [{ question_id: qIds[rand(0, 4)], answer: 'ABCD'[rand(0, 3)] }] })
            })
            const ms = Date.now() - reqStart
            metrics.total++
            statusHist[res.status] = (statusHist[res.status] || 0) + 1
            if (res.status >= 500) metrics.errors5xx++
            else if (res.status === 409) {
                if (reqStart < windowEnd) closedEarly++
                metrics.saveLate.push(ms)
            } else if (res.ok) {
                if (reqStart > graceEnd) acceptedAfterGrace++ // request MULAI lewat grace — seharusnya tidak pernah
                metrics.saveOk.push(ms)
            }
            await sleep(rand(...SAVE_EVERY))
        }
    }

    await Promise.all(users.map(studentWork))
    console.log('fase kerja selesai — menunggu sweep menutup semua (maks ~4,5 menit)...')

    // Semua submission harus tertutup ≤ ends_at + buffer 2 mnt + 2 tick sweep
    let allClosed = false
    const deadlineWait = Date.now() + 270 * 1000
    while (Date.now() < deadlineWait) {
        const { data: openLeft } = await supabase
            .from('official_exam_submissions').select('id', { count: 'exact' })
            .eq('exam_id', exam.id).eq('is_submitted', false)
        if ((openLeft || []).length === 0) { allClosed = true; break }
        await sleep(5000)
    }

    await stopServer()

    console.log('\n===== HASIL LOAD EXPIRY 50 VU =====')
    console.log(`total write        : ${metrics.total} | status: ${JSON.stringify(statusHist)}`)
    console.log(`save diterima (normal+grace) : n=${metrics.saveOk.length} p50=${fmtPct(metrics.saveOk, .5)} p95=${fmtPct(metrics.saveOk, .95)} (target p95<800)`)
    console.log(`save ditolak 409   : n=${metrics.saveLate.length}`)
    console.log(`5xx                : ${metrics.errors5xx}`)
    console.log(`start gagal        : ${startFail} (status: ${JSON.stringify(startFailHist)})`)
    console.log(`diterima lewat grace — request mulai setelah grace (HARUS 0): ${acceptedAfterGrace}`)
    console.log(`409 sebelum jendela tutup (HARUS 0): ${closedEarly}`)
    console.log(`semua submission tertutup oleh sweep: ${allClosed}`)
    if (serverErrLines.length > 0) {
        console.log('\n----- log server (error/warn) -----')
        serverErrLines.slice(-40).forEach(l => console.log('  ' + l))
    }
    // guard array kosong: pct() = -1 saat n=0 bisa lolos threshold <800 secara palsu
    const pass = metrics.errors5xx === 0 && acceptedAfterGrace === 0 && closedEarly === 0 && allClosed
        && metrics.saveOk.length > 0 && pct(metrics.saveOk, .95) < 800
    console.log(pass ? 'LOAD-EXPIRY: PASS' : 'LOAD-EXPIRY: FAIL')
    process.exitCode = pass ? 0 : 1
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
    .finally(cleanup)
