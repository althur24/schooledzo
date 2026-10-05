/**
 * E2E staging: "Tambah Waktu" (extend-time) — fitur perpanjangan waktu
 * pengerjaan ulangan/UTS-UAS oleh guru/admin dari Monitor Live.
 *
 * PRASYARAT (urutan WAJIB):
 *   1. bash loadtest/push-staging-migration.sh  (tidak ada migrasi baru — cek sinkron)
 *   2. set -a; source .env.staging; set +a; npm run build
 *   3. set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   4. ENV_FILE=.env.staging node scripts/e2e-extend-time-staging.cjs
 *      (E2E_BASE untuk remote Railway staging)
 *
 * Seksi:
 *  [S] Seed fixture (prefix e2et_): guru owner + guru luar + admin + 3 siswa,
 *      exam A (jendela, terpotong jam tutup), B (serentak), D1+D2 (batch),
 *      E (UTS jendela) + submission "sedang mengerjakan".
 *  [G] Guard: siswa 401 · guru luar 403 · menit invalid 400 · exam lain 404.
 *  [X] Extend inti: A +5 (guru) → monitor sisa waktu naik; stack +5 (ADMIN
 *      — bukti admin bisa) → ≈ +10; B +5 (serentak → durasi 25→30);
 *      batch D1 → D2 ikut; E +5 (admin, official).
 *  [P] Propagasi: autosave PUT respons membawa ends_at ≈ batas baru.
 *  [W] Write-gate: SETELAH batas lama + grace lewat → PUT tetap 200
 *      (tanpa extension pasti 409 force-close) — inti fitur.
 *  [N] Siswa belum mulai: setelah akhir LAMA exam B → POST start 200
 *      (durasi baru membuka gate).
 *  [V] Sweep: submission A tetap terbuka SETELAH deadline sweep lama
 *      (bukti sweep menghormati batas baru).
 *
 * Cleanup penuh di akhir (semua baris prefix e2et_).
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2et1234!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2' // Matematika STG
const CLASS = '7da71f34-b051-4aa9-ab4d-967ae741f61c'   // Kelas STG 8A
const CLASS2 = '5d4c50c5-2b19-4e18-9798-7a9de3b90b1b'   // ru_78744 9A (member batch D2)

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// UUID deterministik (namespace e2et)
const P = {
    guruUser: 'e2eda000-0000-4000-8000-000000000001',
    guru2User: 'e2eda000-0000-4000-8000-000000000002',
    adminUser: 'e2eda000-0000-4000-8000-000000000003',
    siswa1User: 'e2eda000-0000-4000-8000-000000000011',
    siswa2User: 'e2eda000-0000-4000-8000-000000000012',
    siswa3User: 'e2eda000-0000-4000-8000-000000000013',
    teacher: 'e2eda100-0000-4000-8000-000000000001',
    teacher2: 'e2eda100-0000-4000-8000-000000000002',
    subject2: 'e2eda200-0000-4000-8000-000000000001',
    ta: 'e2eda300-0000-4000-8000-000000000001',
    ta2: 'e2eda300-0000-4000-8000-000000000002',
    taD2: 'e2eda300-0000-4000-8000-000000000004',
    student1: 'e2eda400-0000-4000-8000-000000000011',
    student2: 'e2eda400-0000-4000-8000-000000000012',
    student3: 'e2eda400-0000-4000-8000-000000000013',
    examA: 'e2eda500-0000-4000-8000-000000000001',
    examB: 'e2eda500-0000-4000-8000-000000000002',
    examD1: 'e2eda500-0000-4000-8000-000000000003',
    examD2: 'e2eda500-0000-4000-8000-000000000004',
    examE: 'e2eda500-0000-4000-8000-000000000005',
    qA1: 'e2eda600-0000-4000-8000-000000000001',
    qB1: 'e2eda600-0000-4000-8000-000000000002',
    qD2: 'e2eda600-0000-4000-8000-000000000003',
    qE1: 'e2eda600-0000-4000-8000-000000000004',
    subA: 'e2eda700-0000-4000-8000-000000000001',
    subB: 'e2eda700-0000-4000-8000-000000000002',
    subD2: 'e2eda700-0000-4000-8000-000000000003',
    subE: 'e2eda700-0000-4000-8000-000000000004',
    batchD: 'e2eda900-0000-4000-8000-000000000001',
}
const T0 = Date.now()
const iso = (msFromNow) => new Date(T0 + msFromNow).toISOString()
const MIN = 60_000

let pass = 0, fail = 0
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail ?? '')?.slice(0, 140) : ''}`) }
}

async function login(username) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASS }),
    })
    if (!res.ok) throw new Error(`login ${username}: ${res.status}`)
    return res.headers.get('set-cookie')?.split(';')[0]
}

async function api(method, path, body, cookie) {
    const res = await fetch(BASE + path, {
        method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    let data = null
    try { data = await res.json() } catch { }
    return { status: res.status, data }
}

async function monitorRemaining(cookie, examId) {
    const { status, data } = await api('GET', `/api/exam-submissions/monitor?exam_id=${examId}`, undefined, cookie)
    if (status !== 200) return null
    const row = (data.students || []).find(s => s.submission_id)
    return row ? row.time_remaining_seconds : null
}

async function cleanupAll() {
    const ids = Object.values(P)
    await supabase.from('exam_answers').delete().in('submission_id', [P.subA, P.subB, P.subD2])
    await supabase.from('official_exam_answers').delete().eq('submission_id', P.subE)
    // by exam_id — menangkap submission baru yang dibuat runtime (mis. siswa2 start B)
    await supabase.from('exam_submissions').delete().in('exam_id', [P.examA, P.examB, P.examD1, P.examD2])
    await supabase.from('official_exam_submissions').delete().eq('exam_id', P.examE)
    await supabase.from('exam_questions').delete().in('exam_id', [P.examA, P.examB, P.examD1, P.examD2])
    await supabase.from('official_exam_questions').delete().eq('exam_id', P.examE)
    await supabase.from('exams').delete().in('id', [P.examA, P.examB, P.examD1, P.examD2])
    await supabase.from('official_exams').delete().eq('id', P.examE)
    await supabase.from('teaching_assignments').delete().in('id', [P.ta, P.ta2, P.taD2])
    await supabase.from('student_enrollments').delete().in('student_id', [P.student1, P.student2, P.student3])
    await supabase.from('subjects').delete().eq('id', P.subject2)
    await supabase.from('sessions').delete().in('user_id', [P.guruUser, P.guru2User, P.adminUser, P.siswa1User, P.siswa2User, P.siswa3User])
    await supabase.from('notifications').delete().in('user_id', [P.guruUser, P.guru2User, P.adminUser, P.siswa1User, P.siswa2User, P.siswa3User])
    await supabase.from('students').delete().in('id', [P.student1, P.student2, P.student3])
    await supabase.from('teachers').delete().in('id', [P.teacher, P.teacher2])
    await supabase.from('users').delete().in('id', [P.guruUser, P.guru2User, P.adminUser, P.siswa1User, P.siswa2User])
    // sisa baris via prefix (jaga-jaga run ter-abort)
    const { data: leftovers } = await supabase.from('users').select('id').like('username', 'e2et_%')
    for (const u of (leftovers || [])) await supabase.from('users').delete().eq('id', u.id)
}

async function seed() {
    console.log('═══ SEED ══')
    await cleanupAll()
    const hash = bcrypt.hashSync(PASS, 10)
    const mkUser = (id, username, role) => ({ id, username, full_name: 'E2ET ' + username, password_hash: hash, role, school_id: SCHOOL, must_change_password: false, is_locked: false })
    const { error: uErr } = await supabase.from('users').insert([
        mkUser(P.guruUser, 'e2et_guru', 'GURU'),
        mkUser(P.guru2User, 'e2et_guru2', 'GURU'),
        mkUser(P.adminUser, 'e2et_admin', 'ADMIN'),
        mkUser(P.siswa1User, 'e2et_siswa1', 'SISWA'),
        mkUser(P.siswa2User, 'e2et_siswa2', 'SISWA'),
        mkUser(P.siswa3User, 'e2et_siswa3', 'SISWA'),
    ])
    if (uErr) throw new Error('users: ' + uErr.message)
    const must = async (label, q) => {
        const { error } = await q
        if (error) throw new Error(`${label}: ${error.message}`)
    }
    await must('teachers', supabase.from('teachers').insert([
        { id: P.teacher, user_id: P.guruUser, school_id: SCHOOL },
        { id: P.teacher2, user_id: P.guru2User, school_id: SCHOOL },
    ]))
    await must('students', supabase.from('students').insert([
        { id: P.student1, user_id: P.siswa1User, nis: 'e2et0001', class_id: CLASS, school_id: SCHOOL, status: 'ACTIVE', school_level: 'SMP', entry_year: 2025 },
        { id: P.student2, user_id: P.siswa2User, nis: 'e2et0002', class_id: CLASS, school_id: SCHOOL, status: 'ACTIVE', school_level: 'SMP', entry_year: 2025 },
        { id: P.student3, user_id: P.siswa3User, nis: 'e2et0003', class_id: CLASS2, school_id: SCHOOL, status: 'ACTIVE', school_level: 'SMP', entry_year: 2025 },
    ]))
    await must('enrollments', supabase.from('student_enrollments').insert([
        { student_id: P.student1, academic_year_id: YEAR, class_id: CLASS, status: 'ACTIVE' },
        { student_id: P.student2, academic_year_id: YEAR, class_id: CLASS, status: 'ACTIVE' },
        { student_id: P.student3, academic_year_id: YEAR, class_id: CLASS2, status: 'ACTIVE' },
    ]))
    await must('subjects', supabase.from('subjects').insert({ id: P.subject2, name: 'E2ET Mapel Luar', school_id: SCHOOL, kkm: 75, level: 'SMP' }))
    // TA guru owner (mapel utama) + guru2 (mapel LAIN di kelas sama → co-teacher test negatif)
    await must('teaching_assignments', supabase.from('teaching_assignments').insert([
        { id: P.ta, teacher_id: P.teacher, subject_id: SUBJECT, class_id: CLASS, academic_year_id: YEAR },
        { id: P.ta2, teacher_id: P.teacher2, subject_id: P.subject2, class_id: CLASS, academic_year_id: YEAR },
        { id: P.taD2, teacher_id: P.teacher, subject_id: SUBJECT, class_id: CLASS2, academic_year_id: YEAR },
    ]))

    // Kolom exams mengikuti load_batch_1000.cjs (subject/tahun via TA —
    // exams tidak punya kolom subject_id/academic_year_id langsung)
    const baseExam = {
        description: 'e2et fixture',
        is_active: true, is_randomized: false, max_violations: 3,
        show_results_immediately: true, created_by: P.guruUser,
    }
    // A: jendela — siswa mulai -30 mnt, durasi 60 → tanpa extend selesai di jam tutup (T0+3m)
    // B: serentak — start -20 mnt, durasi 25 → akhir T0+5m
    // D1/D2: batch — D2 punya submission aktif
    const { error: eErr } = await supabase.from('exams').insert([
        { ...baseExam, id: P.examA, title: 'e2et_A Jendela', start_time: iso(-3 * 60 * MIN), duration_minutes: 60, window_end_time: iso(3 * MIN), teaching_assignment_id: P.ta },
        { ...baseExam, id: P.examB, title: 'e2et_B Serentak', start_time: iso(-20 * MIN), duration_minutes: 25, window_end_time: null, teaching_assignment_id: P.ta },
        { ...baseExam, id: P.examD1, title: 'e2et_D1 Batch', start_time: iso(-3 * 60 * MIN), duration_minutes: 60, window_end_time: iso(3 * MIN), teaching_assignment_id: P.ta, batch_id: P.batchD },
        { ...baseExam, id: P.examD2, title: 'e2et_D2 Batch member', start_time: iso(-3 * 60 * MIN), duration_minutes: 60, window_end_time: iso(3 * MIN), teaching_assignment_id: P.taD2, batch_id: P.batchD },
    ])
    if (eErr) throw new Error('exams: ' + eErr.message)

    // E: UTS/UAS jendela (official)
    const { error: oeErr } = await supabase.from('official_exams').insert({
        id: P.examE, title: 'e2et_E UTS', exam_type: 'UTS', school_id: SCHOOL, academic_year_id: YEAR,
        subject_id: SUBJECT, target_class_ids: [CLASS], start_time: iso(-3 * 60 * MIN),
        duration_minutes: 60, window_end_time: iso(4 * MIN), is_active: true, is_randomized: false,
        is_remedial: false, show_results_immediately: true, results_released: false, max_violations: 3, created_by: P.adminUser,
    })
    if (oeErr) throw new Error('official_exams: ' + oeErr.message)

    const q = (id, examId) => ({
        id, exam_id: examId, question_text: 'e2et: 1+1?', question_type: 'MULTIPLE_CHOICE',
        options: JSON.stringify(['1', '2', '3', '4']), correct_answer: 'B', points: 10, order_index: 0,
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    })
    const { error: qErr } = await supabase.from('exam_questions').insert([q(P.qA1, P.examA), q(P.qB1, P.examB), q(P.qD2, P.examD2)])
    if (qErr) throw new Error('exam_questions: ' + qErr.message)
    const { error: oqErr } = await supabase.from('official_exam_questions').insert([q(P.qE1, P.examE)])
    if (oqErr) throw new Error('official_exam_questions: ' + oqErr.message)

    // Submission "sedang mengerjakan"
    const mkSub = (id, examId, studentId, startedMinsAgo) => ({
        id, exam_id: examId, student_id: studentId, started_at: iso(startedMinsAgo * -MIN),
        is_submitted: false, violation_count: 0, violations_log: [], question_order: JSON.stringify([]),
    })
    const { error: sErr } = await supabase.from('exam_submissions').insert([
        mkSub(P.subA, P.examA, P.student1, 30),
        mkSub(P.subB, P.examB, P.student1, 20),
        mkSub(P.subD2, P.examD2, P.student3, 30),
    ])
    if (sErr) throw new Error('exam_submissions: ' + sErr.message)
    const { error: osErr } = await supabase.from('official_exam_submissions').insert([mkSub(P.subE, P.examE, P.student1, 30)])
    if (osErr) throw new Error('official_exam_submissions: ' + osErr.message)

    console.log(`seed OK — A jendela tutup T0+3m · B serentak akhir T0+5m · E jendela T0+4m`)
}

async function run() {
    console.log('═══ RUN ══')
    const guru = await login('e2et_guru')
    const guru2 = await login('e2et_guru2')
    const admin = await login('e2et_admin')
    const siswa1 = await login('e2et_siswa1')

    // ═══ [G] Guard ═══
    console.log('\n═══ [G] Guard ══')
    let r = await api('POST', '/api/exam-submissions/extend-time', { exam_id: P.examA, additional_minutes: 5 }, siswa1)
    check('G1: siswa → 401', r.status === 401, r)

    r = await api('POST', '/api/exam-submissions/extend-time', { exam_id: P.examA, additional_minutes: 5 }, guru2)
    check('G2: guru luar (mapel beda) → 403', r.status === 403, r)

    r = await api('POST', '/api/exam-submissions/extend-time', { exam_id: P.examA, additional_minutes: 0 }, guru)
    check('G3: menit 0 → 400', r.status === 400, r)
    r = await api('POST', '/api/exam-submissions/extend-time', { exam_id: P.examA, additional_minutes: 121 }, guru)
    check('G4: menit 121 → 400', r.status === 400, r)
    r = await api('POST', '/api/exam-submissions/extend-time', { exam_id: P.examA, additional_minutes: 'abc' }, guru)
    check('G5: menit "abc" → 400', r.status === 400, r)
    r = await api('POST', '/api/exam-submissions/extend-time', { exam_id: 'e2eda500-0000-4000-8000-00000000dead', additional_minutes: 5 }, guru)
    check('G6: exam tak dikenal → 404', r.status === 404, r)

    // ═══ [X] Extend inti ═══
    console.log('\n═══ [X] Extend ══')
    const beforeA = await monitorRemaining(guru, P.examA)
    check('X0: monitor awal A ≈ ≤3 mnt (terpotong jam tutup)', beforeA !== null && beforeA <= 190 && beforeA > 0, beforeA)

    r = await api('POST', '/api/exam-submissions/extend-time', { exam_id: P.examA, additional_minutes: 5 }, guru)
    check('X1: guru extend A +5 → 200', r.status === 200 && r.data?.success, r)
    check('X1b: window_shifted true + extended=1', r.data?.window_shifted === true && r.data?.extended === 1, r.data)

    // Stack — oleh ADMIN (bukti admin bisa menambah waktu ujian guru)
    r = await api('POST', '/api/exam-submissions/extend-time', { exam_id: P.examA, additional_minutes: 5 }, admin)
    check('X2: ADMIN stack extend A +5 → 200', r.status === 200 && r.data?.success, r)

    const afterA = await monitorRemaining(guru, P.examA)
    // A: batas lama T0+3m → setelah +5+5 = T0+13m; remaining ≈ 13m - elapsed
    check('X3: monitor A naik ≈ +10 (stack, 11–14 mnt)', afterA !== null && afterA > 11 * 60 && afterA < 14 * 60, afterA)

    // B serentak: durasi 25 → 30 (akhir T0+10m); override = max(T0+5m, now)+5 ≈ T0+10m
    r = await api('POST', '/api/exam-submissions/extend-time', { exam_id: P.examB, additional_minutes: 5 }, guru)
    check('X4: guru extend B (serentak) +5 → 200', r.status === 200 && r.data?.success, r)
    check('X4b: durasi baru 30', r.data?.new_duration_minutes === 30, r.data)
    const { data: examBRow } = await supabase.from('exams').select('duration_minutes').eq('id', P.examB).single()
    check('X4c: exams.duration_minutes tersimpan 30', examBRow?.duration_minutes === 30, examBRow)
    const afterB = await monitorRemaining(guru, P.examB)
    check('X4d: monitor B ≈ 9–11 mnt', afterB !== null && afterB > 9 * 60 && afterB < 11 * 60, afterB)

    // Batch: extend D1 (batch) → submission D2 ikut ter-override
    r = await api('POST', '/api/exam-submissions/extend-time', { exam_id: P.examD1, additional_minutes: 5, batch: true }, guru)
    check('X5: batch extend D1 +5 → 200', r.status === 200 && r.data?.success, r)
    const { data: subD2 } = await supabase.from('exam_submissions').select('timer_override_until').eq('id', P.subD2).single()
    const d2ms = subD2?.timer_override_until ? new Date(subD2.timer_override_until).getTime() : null
    check('X5b: submission member D2 ter-override (≈ T0+8m ±90s)', d2ms !== null && Math.abs(d2ms - (T0 + 8 * MIN)) < 90_000, subD2)

    // Official (UTS): admin extend E +5
    r = await api('POST', '/api/official-exam-submissions/extend-time', { exam_id: P.examE, additional_minutes: 5 }, admin)
    check('X6: ADMIN extend UTS E +5 → 200', r.status === 200 && r.data?.success, r)
    const { data: subE } = await supabase.from('official_exam_submissions').select('timer_override_until').eq('id', P.subE).single()
    const eMs = subE?.timer_override_until ? new Date(subE.timer_override_until).getTime() : null
    check('X6b: submission E ter-override (≈ T0+9m ±90s)', eMs !== null && Math.abs(eMs - (T0 + 9 * MIN)) < 90_000, subE)
    const { data: examERow } = await supabase.from('official_exams').select('window_end_time').eq('id', P.examE).single()
    const eWin = examERow?.window_end_time ? new Date(examERow.window_end_time).getTime() : null
    check('X6c: jendela E digeser (≈ T0+9m ±90s)', eWin !== null && Math.abs(eWin - (T0 + 9 * MIN)) < 90_000, examERow)

    // ═══ [P] Propagasi ends_at di respons autosave ═══
    console.log('\n═══ [P] Propagasi ends_at ══')
    r = await api('PUT', '/api/exam-submissions', { submission_id: P.subA, answers: [{ question_id: P.qA1, answer: 'B' }] }, siswa1)
    const endsMs = r.data?.ends_at ? new Date(r.data.ends_at).getTime() : null
    check('P1: autosave 200', r.status === 200, r)
    check('P2: respons memuat ends_at ≈ T0+13m ±90s', endsMs !== null && Math.abs(endsMs - (T0 + 13 * MIN)) < 90_000, r.data?.ends_at)

    // ═══ [W] Write-gate SETELAH batas lama + grace ═══
    console.log('\n═══ [W] Write-gate pasca batas lama (menunggu) ═══')
    const waitT1 = (T0 + 4 * MIN + 20_000) - Date.now()
    if (waitT1 > 0) { console.log(`  menunggu ${(waitT1 / 1000).toFixed(0)}s sampai lelewat batas lama A (T0+3m) + grace 60s...`); await new Promise(r2 => setTimeout(r2, waitT1)) }
    // Re-login: session cache (30 dtk TTL) mungkin kedaluwarsa selama tunggu
    const siswa1Fresh = await login('e2et_siswa1')
    r = await api('PUT', '/api/exam-submissions', { submission_id: P.subA, answers: [{ question_id: P.qA1, answer: 'A' }] }, siswa1Fresh)
    check('W1: PUT SETELAH batas lama+grace → tetap 200 (inti fitur; tanpa extend pasti 409)', r.status === 200, r)
    const { data: subACheck } = await supabase.from('exam_submissions').select('is_submitted').eq('id', P.subA).single()
    check('W1b: submission A masih terbuka', subACheck?.is_submitted === false, subACheck)

    // ═══ [N] Siswa belum mulai di mode serentak ═══
    console.log('\n═══ [N] Gate mulai pasca akhir lama B ══')
    const waitT2 = (T0 + 5 * MIN + 40_000) - Date.now()
    if (waitT2 > 0) { console.log(`  menunggu ${(waitT2 / 1000).toFixed(0)}s sampai lewat akhir lama B (T0+5m)...`); await new Promise(r2 => setTimeout(r2, waitT2)) }
    const siswa2 = await login('e2et_siswa2')
    r = await api('POST', '/api/exam-submissions', { exam_id: P.examB }, siswa2)
    check('N1: siswa2 mulai B SETELAH akhir lama → 200 (durasi baru membuka gate)', r.status === 200 && r.data?.id, r)

    // ═══ [V] Sweep menghormati batas baru ═══
    const { data: subACheck2 } = await supabase.from('exam_submissions').select('is_submitted').eq('id', P.subA).single()
    check('V1: A tetap terbuka SETELAH deadline sweep lama (T0+5m) — sweep menghormati extend', subACheck2?.is_submitted === false, subACheck2)

    console.log(`\n═══ HASIL: ${pass} pass, ${fail} fail ══`)
    process.exitCode = fail > 0 ? 1 : 0
}

const phase = process.argv[2] || 'all'
if (phase === 'seed') seed().catch(e => { console.error(e); process.exit(1) })
else if (phase === 'run') run().catch(e => { console.error(e); process.exit(1) })
else if (phase === 'all') seed().then(run).catch(e => { console.error(e); process.exit(1) })
else if (phase === 'cleanup') cleanupAll().then(() => console.log('cleanup bersih ✓'))
else { console.log('Pemakaian: node scripts/e2e-extend-time-staging.cjs <all|seed|run|cleanup>'); process.exit(1) }
