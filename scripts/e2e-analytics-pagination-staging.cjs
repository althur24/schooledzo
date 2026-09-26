/**
 * E2E staging: paginasi fetchAllRows stabil di analytics (fix heatmap bolong).
 *
 * Bug asli (Fisika XI 25 Sep 2026): query jawaban analytics TANPA .order()
 * di-paginasi .range() per 1000 baris — tiap halaman query terpisah dengan
 * urutan ikut execution plan per koneksi → baris dobel/terlewat INTERMITTEN.
 * Reproduksi: 610 duplikat / 59 dari 102 siswa kehilangan jawaban heatmap,
 * siswa nilai 100 tampak 11/25 terjawab.
 *
 * Fix: .order('id') pada query jawaban (analytics official + exam) dan 4
 * query latent (notif enrollments ×2, cascade delete, broadcast announcement).
 *
 * Fixture: ujian + 45 submission × 25 soal = 1.125 baris jawaban (>1000 →
 * paginasi multi-halaman, ZONA bug) untuk kedua jenis (official + ulangan).
 * Semua jawaban benar — heatmap tiap siswa HARUS 25/25 terisi di SETIAP poll.
 *
 * Seksi:
 *   [S] Simulasi query-level: 10× fetch jawaban dgn .order(id) → selalu
 *       unik-lengkap (deterministik by construction) — pembanding varian
 *       tanpa order yang gagal intermitten.
 *   [O] Analytics official-exam: 5× GET endpoint → tiap poll: 45 siswa di
 *       heatmap, 25/25 jawaban terisi per siswa, questionAnalysis 45/45
 *       terjawab per soal, total jawaban konsisten.
 *   [E] Analytics exam (ulangan): idem 5×.
 *   [N] Smoke jalur wave-2: broadcast announcement global → semua 46 user
 *       siswa fixture + template menerima (tanpa siswa terlewat) — di
 *       staging skala kecil, jalur order dieksekusi tanpa error.
 *
 * PRASYARAT:
 *   1. set -a; source .env.staging; set +a; npm run build   (kode fix ter-build)
 *   2. set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   3. ENV_FILE=.env.staging node scripts/e2e-analytics-pagination-staging.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2pg1234!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2' // Matematika STG
const CLASS = '7da71f34-b051-4aa9-ab4d-967ae741f61c'   // Kelas STG 8A

const N_STUDENTS = 45
const N_QUESTIONS = 25
const EXPECTED_ANSWERS = N_STUDENTS * N_QUESTIONS // 1125 → 2 halaman paginasi

const EX_OFFICIAL = 'e2e5c000-0000-4000-8000-0000000000aa'
const EX_EXAM = 'e2e5c000-0000-4000-8000-0000000000bb'
const PFX = 'e2e5c000-0000-4000-8000-'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}

async function login(username) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASS }),
    })
    if (!res.ok) throw new Error(`login ${username} gagal: ${res.status}`)
    return res.headers.get('set-cookie')?.split(';')[0]
}

async function api(path, cookie) {
    const res = await fetch(BASE + path, { headers: { Cookie: cookie } })
    let data = null
    try { data = await res.json() } catch { /* no body */ }
    return { status: res.status, data }
}

async function cleanupAll() {
    // like '%e2pg_%' — tangkap prefix emoji ("📢 e2pg_...") yang tak cocok pola 'e2pg_%'
    await supabase.from('notifications').delete().like('title', '%e2pg_%')
    for (const [answersT, subsT, examT, id] of [
        ['official_exam_answers', 'official_exam_submissions', 'official_exams', EX_OFFICIAL],
        ['exam_answers', 'exam_submissions', 'exams', EX_EXAM],
    ]) {
        const { data: subs } = await supabase.from(subsT).select('id').eq('exam_id', id)
        for (const s of (subs || [])) await supabase.from(answersT).delete().eq('submission_id', s.id)
        await supabase.from(subsT).delete().eq('exam_id', id)
        await supabase.from(examT === 'exams' ? 'exam_questions' : 'official_exam_questions').delete().eq('exam_id', id)
        await supabase.from(examT).delete().eq('id', id)
    }
    const { data: olds } = await supabase.from('users').select('id').like('username', 'e2pg_%')
    for (const x of (olds || [])) {
        const { data: s } = await supabase.from('students').select('id').eq('user_id', x.id).maybeSingle()
        if (s) {
            await supabase.from('student_enrollments').delete().eq('student_id', s.id)
            await supabase.from('students').delete().eq('id', s.id)
        }
        await supabase.from('sessions').delete().eq('user_id', x.id)
        await supabase.from('notifications').delete().eq('user_id', x.id)
        await supabase.from('users').delete().eq('id', x.id)
    }
}

/** Seed pasangan (exam, submissions, answers) — semua jawaban benar penuh. */
async function seedExam(kind) {
    const isOfficial = kind === 'official'
    const examId = isOfficial ? EX_OFFICIAL : EX_EXAM
    const qT = isOfficial ? 'official_exam_questions' : 'exam_questions'
    const sT = isOfficial ? 'official_exam_submissions' : 'exam_submissions'
    const aT = isOfficial ? 'official_exam_answers' : 'exam_answers'

    const questions = []
    for (let i = 0; i < N_QUESTIONS; i++) {
        questions.push({
            id: `${PFX}${isOfficial ? '0c' : '0d'}${String(i).padStart(10, '0')}`,
            exam_id: examId,
            question_text: `e2pg soal ${i + 1}: berapa 1+1?`,
            question_type: 'MULTIPLE_CHOICE',
            options: ['1', '2', '3', '4'], // jsonb: kirim array JS (string = jsonb string scalar)
            correct_answer: 'B',
            points: 4, order_index: i, status: 'approved',
        })
    }
    const { error: qErr } = await supabase.from(qT).insert(questions)
    if (qErr) throw new Error(`seed questions ${kind}: ${qErr.message}`)

    // 45 user siswa (sekali untuk kedua jenis — dibuat di caller)
    const { data: studentUsers } = await supabase.from('users').select('id').like('username', 'e2pg_s%').order('username')
    const students = studentUsers || []
    if (students.length < N_STUDENTS) throw new Error(`butuh ${N_STUDENTS} siswa, ada ${students.length}`)

    const { data: studentRows } = await supabase.from('students').select('id, user_id').like('nis', 'e2pg%')
    const studentIdByUser = new Map((studentRows || []).map(r => [r.user_id, r.id]))

    const subs = []
    const now = Date.now()
    for (let i = 0; i < N_STUDENTS; i++) {
        const uid = students[i].id
        subs.push({
            id: `${PFX}${isOfficial ? '0e' : '0f'}${String(i).padStart(10, '0')}`,
            exam_id: examId,
            student_id: studentIdByUser.get(uid),
            started_at: new Date(now - 3600e3).toISOString(),
            submitted_at: new Date(now - 1800e3).toISOString(),
            is_submitted: true, is_graded: true,
            question_order: questions.map(q => q.id),
            total_score: 100, max_score: 100,
            violation_count: 0,
        })
    }
    const { error: sErr } = await supabase.from(sT).insert(subs)
    if (sErr) throw new Error(`seed submissions ${kind}: ${sErr.message}`)

    const answers = []
    for (const sub of subs) {
        for (const q of questions) {
            answers.push({
                submission_id: sub.id,
                question_id: q.id,
                answer: 'B', is_correct: true, points_earned: 4,
                created_at: new Date(now - 1700e3).toISOString(),
            })
        }
    }
    for (let i = 0; i < answers.length; i += 500) {
        const { error: aErr } = await supabase.from(aT).insert(answers.slice(i, i + 500))
        if (aErr) throw new Error(`seed answers ${kind}: ${aErr.message}`)
    }
    return { examId, subIds: subs.map(s => s.id), questionIds: questions.map(q => q.id) }
}

async function main() {
    console.log('═══ SEED ══')
    await cleanupAll()
    const passHash = await bcrypt.hash(PASS, 10)
    const { data: adminU } = await supabase.from('users')
        .insert({ username: 'e2pg_admin', full_name: 'E2PG Admin', password_hash: passHash, role: 'ADMIN', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    const studentUsers = []
    for (let i = 0; i < N_STUDENTS; i++) {
        const { data: su } = await supabase.from('users')
            .insert({ username: `e2pg_s${String(i).padStart(2, '0')}`, full_name: `E2PG Siswa ${i}`, password_hash: passHash, role: 'SISWA', school_id: SCHOOL, must_change_password: false, is_locked: false })
            .select('id').single()
        const { data: st } = await supabase.from('students')
            .insert({ user_id: su.id, school_id: SCHOOL, class_id: CLASS, nis: `e2pg${String(i).padStart(2, '0')}` })
            .select('id').single()
        await supabase.from('student_enrollments').insert({ student_id: st.id, academic_year_id: YEAR, class_id: CLASS, status: 'ACTIVE' })
        studentUsers.push(su)
    }
    console.log(`seed ${N_STUDENTS} siswa + admin`)

    // exams row
    const now = Date.now()
    const baseExam = {
        school_id: SCHOOL, academic_year_id: YEAR, subject_id: SUBJECT,
        exam_type: 'UTS', duration_minutes: 60, target_class_ids: [CLASS], is_active: true,
        start_time: new Date(now - 7200e3).toISOString(), window_end_time: new Date(now - 3600e3).toISOString(),
    }
    await supabase.from('official_exams').insert({ ...baseExam, id: EX_OFFICIAL, title: 'e2pg_official analytics pagination' })
    // ulangan: skema tabel exams = teaching_assignment_id (tanpa school/target_class_ids)
    const { data: ta } = await supabase.from('teaching_assignments')
        .select('id').eq('subject_id', SUBJECT).eq('class_id', CLASS).eq('academic_year_id', YEAR).limit(1)
    const { error: examInsErr } = await supabase.from('exams').insert({
        id: EX_EXAM, title: 'e2pg_ulangan analytics pagination', teaching_assignment_id: ta[0].id,
        start_time: baseExam.start_time, duration_minutes: baseExam.duration_minutes,
        window_end_time: baseExam.window_end_time, is_active: true, is_randomized: false,
        show_results_immediately: true,
    })
    if (examInsErr) throw new Error(`seed exams row: ${examInsErr.message}`)

    const official = await seedExam('official')
    const ulangan = await seedExam('exam')
    console.log(`seed 2 ujian × ${N_STUDENTS} submission × ${N_QUESTIONS} soal = ${EXPECTED_ANSWERS} jawaban/ujian`)

    // ═══ [S] Simulasi query-level: 10× dgn .order(id) → selalu unik-lengkap ═══
    console.log('\n═══ [S] Simulasi query-level (pola persis route ter-fix) ══')
    const admin = await login('e2pg_admin')
    {
        let allUnique = true
        for (let run = 1; run <= 10; run++) {
            const rows = []
            for (let i = 0; i < official.subIds.length; i += 100) {
                const chunk = official.subIds.slice(i, i + 100)
                let page = 0
                while (page < 20) {
                    const { data } = await supabase.from('official_exam_answers')
                        .select('submission_id, question_id')
                        .in('submission_id', chunk)
                        .order('id')
                        .range(page * 1000, (page + 1) * 1000 - 1)
                    const r = data || []
                    rows.push(...r)
                    if (r.length < 1000) break
                    page++
                }
            }
            const seen = new Set(); let dup = 0
            for (const a of rows) { const k = a.submission_id + ':' + a.question_id; if (seen.has(k)) dup++; seen.add(k) }
            if (rows.length !== EXPECTED_ANSWERS || seen.size !== EXPECTED_ANSWERS || dup > 0) {
                allUnique = false
                console.log(`  run-${run}: rows=${rows.length} unique=${seen.size} dup=${dup} ← ANOMALI`)
            }
        }
        check(`10× fetch dgn .order(id): selalu ${EXPECTED_ANSWERS} baris unik (0 dup, 0 hilang)`, allUnique)
    }

    // ═══ [O] Analytics official-exam: 5× GET — kelengkapan heatmap & questionAnalysis ═══
    console.log('\n═══ [O] GET /api/analytics/official-exam (5× poll) ══')
    for (let poll = 1; poll <= 5; poll++) {
        const { status, data } = await api(`/api/analytics/official-exam/${EX_OFFICIAL}?class_id=${CLASS}`, admin)
        if (status !== 200) { check(`poll-${poll} HTTP 200`, false, status); continue }
        const hm = data.performanceHeatmap || []
        const studentsComplete = hm.filter(s => (s.answers || []).every(a => a.isCorrect === true)).length
        const qa = data.questionAnalysis || []
        const qaComplete = qa.filter(q => q.correctRate === 100).length
        const hmOk = hm.length === N_STUDENTS && studentsComplete === N_STUDENTS
        const qaOk = qa.length === N_QUESTIONS && qaComplete === N_QUESTIONS
        check(`poll-${poll}: heatmap ${hm.length}/${N_STUDENTS} siswa — SEMUA 25/25 terisi benar (${studentsComplete})`, hmOk, { hm: hm.length, complete: studentsComplete })
        check(`poll-${poll}: questionAnalysis ${qa.length}/${N_QUESTIONS} soal — SEMUA correctRate 100% (${qaComplete})`, qaOk, { qa: qa.length, complete: qaComplete })
    }

    // ═══ [E] Analytics exam (ulangan): idem ═══
    console.log('\n═══ [E] GET /api/analytics/exam (5× poll) ══')
    for (let poll = 1; poll <= 5; poll++) {
        const { status, data } = await api(`/api/analytics/exam/${EX_EXAM}?class_id=${CLASS}`, admin)
        if (status !== 200) { check(`poll-${poll} HTTP 200`, false, status); continue }
        const hm = data.performanceHeatmap || []
        const studentsComplete = hm.filter(s => (s.answers || []).every(a => a.isCorrect === true)).length
        const qa = data.questionAnalysis || []
        const qaComplete = qa.filter(q => q.correctRate === 100).length
        const hmOk = hm.length === N_STUDENTS && studentsComplete === N_STUDENTS
        const qaOk = qa.length === N_QUESTIONS && qaComplete === N_QUESTIONS
        check(`poll-${poll}: heatmap ${hm.length}/${N_STUDENTS} siswa — SEMUA 25/25 terisi benar (${studentsComplete})`, hmOk, { hm: hm.length, complete: studentsComplete })
        check(`poll-${poll}: questionAnalysis ${qa.length}/${N_QUESTIONS} soal — SEMUA correctRate 100% (${qaComplete})`, qaOk, { qa: qa.length, complete: qaComplete })
    }

    // ═══ [N] Smoke wave-2: broadcast announcement — semua siswa menerima ═══
    console.log('\n═══ [N] Broadcast announcement (jalur .order baru) ══')
    {
        const create = await fetch(BASE + '/api/announcements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: admin },
            body: JSON.stringify({ title: 'e2pg_test broadcast', content: 'uji paginasi broadcast', is_global: true }),
        })
        check('POST announcement 200/201', create.status === 200 || create.status === 201, create.status)
        await new Promise(r => setTimeout(r, 4000))
        const { count } = await supabase.from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('title', '📢 e2pg_test broadcast')
            .in('user_id', studentUsers.map(u => u.id))
        check(`semua ${N_STUDENTS} siswa fixture menerima notifikasi broadcast`, count === N_STUDENTS, count)
    }

    console.log(`\n═══ HASIL: ${pass} ok, ${fail} fail ══`)
    if (fail > 0) process.exit(1)
}

async function cleanup() {
    console.log('═══ CLEANUP ══')
    await cleanupAll()
    const { count: exO } = await supabase.from('official_exams').select('id', { count: 'exact', head: true }).eq('id', EX_OFFICIAL)
    const { count: exE } = await supabase.from('exams').select('id', { count: 'exact', head: true }).eq('id', EX_EXAM)
    const { count: us } = await supabase.from('users').select('id', { count: 'exact', head: true }).like('username', 'e2pg_%')
    const { count: nf } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).like('title', '%e2pg_%')
    console.log(`sisa: official=${exO} exam=${exE} user=${us} notif=${nf}`)
    if ((exO || 0) === 0 && (exE || 0) === 0 && (us || 0) === 0 && (nf || 0) === 0) console.log('cleanup bersih ✓')
    else { console.log('CLEANUP TIDAK BERSIH'); process.exit(1) }
}

const phase = process.argv[2]
if (phase === 'run') main().then(cleanup).catch(e => { console.error(e); process.exit(1) })
else if (phase === 'cleanup') cleanup().catch(e => { console.error(e); process.exit(1) })
else {
    console.log('Pemakaian: node scripts/e2e-analytics-pagination-staging.cjs <run|cleanup>')
    process.exit(1)
}
