/**
 * UJI MATANG — paritas auto-submit/nilai, jalur GURU, multi-siswa, guard.
 * Read-only terhadap data nyata; fixture prefix e2fa + cleanup.
 *
 * Jalankan: ENV_FILE=.env.staging node scripts/e2e-perf-parity-staging.cjs <new|old>
 *   arg=old → jalankan terhadap server yang memakai kode LAMA (untuk banding skor).
 * Output JSON ringkas ke stdout (skor & jumlah jawaban) agar bisa dibandingkan.
 */
require('./../loadtest/e2e/helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2pa1234!'
const PFX = 'e2fa0000-0000-4000-8000-'
const P = {
    school: `${PFX}000000000001`, year: `${PFX}000000000002`, subject: `${PFX}000000000003`,
    classA: `${PFX}000000000004`, classB: `${PFX}000000000005`,
    guruUser: `${PFX}100000000001`, teacher: `${PFX}100000000002`, taA: `${PFX}100000000003`,
    sAUser: `${PFX}200000000001`, sA: `${PFX}200000000002`,
    sBUser: `${PFX}200000000003`, sB: `${PFX}200000000004`,
    examA: `${PFX}300000000001`, qA1: `${PFX}400000000001`, qA2: `${PFX}400000000002`,
    examB: `${PFX}300000000002`, qB1: `${PFX}400000000003`,
    examExp: `${PFX}300000000003`, qE1: `${PFX}400000000004`,
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
let pass = 0, fail = 0
function check(n, c, d) { if (c) { pass++; console.log(`  ok : ${n}`) } else { fail++; console.log(`  FAIL: ${n}${d !== undefined ? ' — ' + JSON.stringify(d) : ''}`) } }
const iso = (ms) => new Date(Date.now() + ms).toISOString()

async function login(u) {
    const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PASS }) })
    if (!res.ok) throw new Error(`login ${u}: ${res.status}`)
    return res.headers.get('set-cookie')?.split(';')[0]
}
async function api(path, cookie, method = 'GET', body) {
    const res = await fetch(BASE + path, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    let data = null; try { data = await res.json() } catch { }
    return { status: res.status, data }
}
const safeArr = (x) => Array.isArray(x) ? x : []

async function cleanup() {
    for (const ex of [P.examA, P.examB, P.examExp]) {
        const { data: subs } = await supabase.from('exam_submissions').select('id').eq('exam_id', ex)
        for (const s of (subs || [])) await supabase.from('exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('exam_submissions').delete().eq('exam_id', ex)
        await supabase.from('exam_questions').delete().eq('exam_id', ex)
        await supabase.from('exams').delete().eq('id', ex)
    }
    await supabase.from('student_enrollments').delete().in('student_id', [P.sA, P.sB])
    await supabase.from('students').delete().in('id', [P.sA, P.sB])
    await supabase.from('teaching_assignments').delete().eq('id', P.taA)
    await supabase.from('sessions').delete().in('user_id', [P.guruUser, P.sAUser, P.sBUser])
    await supabase.from('teachers').delete().eq('id', P.teacher)
    await supabase.from('users').delete().in('id', [P.guruUser, P.sAUser, P.sBUser])
    await supabase.from('classes').delete().in('id', [P.classA, P.classB])
    await supabase.from('subjects').delete().eq('id', P.subject)
    await supabase.from('academic_years').delete().eq('id', P.year)
    await supabase.from('schools').delete().eq('id', P.school)
}

async function seed() {
    await cleanup()
    const hash = bcrypt.hashSync(PASS, 10)
    const must = async (l, q) => { const { error } = await q; if (error) throw new Error(`${l}: ${error.message}`) }
    await must('school', supabase.from('schools').insert({ id: P.school, name: 'E2FA School', code: 'E2FA', school_level: 'SMP', is_active: true, max_students: 50, max_teachers: 10 }))
    await must('year', supabase.from('academic_years').insert({ id: P.year, name: 'E2FA 2025/2026', start_date: '2025-07-14', end_date: null, status: 'ACTIVE', is_active: true, school_id: P.school }))
    await must('subject', supabase.from('subjects').insert({ id: P.subject, name: 'E2FA Mapel', school_id: P.school, kkm: 70, level: 'SMP' }))
    await must('classes', supabase.from('classes').insert([
        { id: P.classA, name: 'E2FA A', grade_level: 8, school_level: 'SMP', academic_year_id: P.year },
        { id: P.classB, name: 'E2FA B', grade_level: 8, school_level: 'SMP', academic_year_id: P.year },
    ]))
    await must('users', supabase.from('users').insert([
        { id: P.guruUser, username: 'e2fa_guru', full_name: 'E2FA Guru', password_hash: hash, role: 'GURU', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.sAUser, username: 'e2fa_sa', full_name: 'E2FA Siswa A', password_hash: hash, role: 'SISWA', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.sBUser, username: 'e2fa_sb', full_name: 'E2FA Siswa B', password_hash: hash, role: 'SISWA', school_id: P.school, must_change_password: false, is_locked: false },
    ]))
    await must('teacher', supabase.from('teachers').insert({ id: P.teacher, user_id: P.guruUser, school_id: P.school }))
    await must('ta', supabase.from('teaching_assignments').insert({ id: P.taA, teacher_id: P.teacher, subject_id: P.subject, class_id: P.classA, academic_year_id: P.year }))
    await must('students', supabase.from('students').insert([
        { id: P.sA, user_id: P.sAUser, school_id: P.school, class_id: P.classA, nis: 'e2fa01', status: 'ACTIVE', school_level: 'SMP' },
        { id: P.sB, user_id: P.sBUser, school_id: P.school, class_id: P.classB, nis: 'e2fa02', status: 'ACTIVE', school_level: 'SMP' },
    ]))
    await must('enroll', supabase.from('student_enrollments').insert([
        { student_id: P.sA, class_id: P.classA, academic_year_id: P.year, status: 'ACTIVE', enrolled_at: iso(-365 * 86400000) },
        { student_id: P.sB, class_id: P.classB, academic_year_id: P.year, status: 'ACTIVE', enrolled_at: iso(-365 * 86400000) },
    ]))
    // examA (kelas A) — 2 MC
    await must('examA', supabase.from('exams').insert({ id: P.examA, title: 'E2FA Exam A', teaching_assignment_id: P.taA, start_time: iso(-300000), duration_minutes: 120, window_end_time: iso(3600000), is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: false, results_released: false, created_by: P.guruUser }))
    await must('qA', supabase.from('exam_questions').insert([
        { id: P.qA1, exam_id: P.examA, question_text: 'A1', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb'], correct_answer: 'B', points: 50, order_index: 0, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
        { id: P.qA2, exam_id: P.examA, question_text: 'A2', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb'], correct_answer: 'A', points: 50, order_index: 1, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
    ]))
    // examB (kelas A juga, untuk multi-siswa? — kelas B tak punya exam; cukup A)
    // examExp — dibuat AKTIF dulu agar siswa bisa mulai, lalu window digeser ke
    // masa lalu (simulasi waktu berjalan) untuk menguji auto-submit kadaluarsa.
    await must('examExp', supabase.from('exams').insert({ id: P.examExp, title: 'E2FA Exam Expired', teaching_assignment_id: P.taA, start_time: iso(-600000), duration_minutes: 120, window_end_time: iso(3600000), is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: P.guruUser }))
    await must('qE', supabase.from('exam_questions').insert({ id: P.qE1, exam_id: P.examExp, question_text: 'E1', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb'], correct_answer: 'A', points: 100, order_index: 0, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' }))
}

async function main() {
    const mode = process.argv[2] || 'new'
    await seed()
    const sATok = await login('e2fa_sa')
    const guruTok = await login('e2fa_guru')

    // ===== UJI A: paritas auto-submit (payload dashboard: {submission_id, submit:true}) =====
    console.log('\n== UJI A: auto-submit paritas ==')
    // Siswa A mulai examExp, jawab 1 soal benar, TIDAK submit
    const st = await api('/api/exam-submissions', sATok, 'POST', { exam_id: P.examExp })
    check('start examExp 200', st.status === 200, st.status)
    const subId = st.data?.id
    if (!subId) throw new Error('examExp start gagal — hentikan')
    await api('/api/exam-submissions', sATok, 'PUT', { submission_id: subId, answers: [{ question_id: P.qE1, answer: 'A' }] })
    // Simulasikan waktu sudah lewat: geser window_end & timer_override ke masa lalu
    // (auto-submit dashboard memicu saat ends_at lewat + 60s).
    await supabase.from('exams').update({ window_end_time: iso(-3600000) }).eq('id', P.examExp)
    const { data: before } = await supabase.from('exam_answers').select('id').eq('submission_id', subId)
    // Payload IDENTIK dgn dashboard checkIncomplete (tanpa answers)
    const sub = await api('/api/exam-submissions', sATok, 'PUT', { submission_id: subId, submit: true })
    // 200 = diterima; 409 TIME_EXPIRED = server sudah force-close & merekap jawaban.
    // Keduanya sah untuk auto-submit kadaluarsa (yang penting: tertutup + nilai benar).
    check('auto-submit diterima (200 atau 409 force-close)', sub.status === 200 || sub.status === 409, sub.status)
    const { data: row } = await supabase.from('exam_submissions').select('is_submitted,total_score,max_score,is_graded').eq('id', subId).single()
    const { data: after } = await supabase.from('exam_answers').select('id,points_earned,answer').eq('submission_id', subId)
    check('is_submitted true', row?.is_submitted === true, row?.is_submitted)
    check('jawaban TIDAK hilang (1 baris)', (after || []).length === 1, (after || []).length)
    check('nilai = 100 (1 soal benar, 100 poin)', Math.round(row?.total_score) === 100, row?.total_score)
    console.log(`PARITY_JSON ${JSON.stringify({ mode, subId: subId.slice(0, 8), total: row?.total_score, answers: (after || []).length, graded: row?.is_graded })}`)

    // ===== UJI C: jalur GURU /questions =====
    console.log('\n== UJI C: GURU /questions ==')
    const gq = await api(`/api/exams/${P.examA}/questions`, guruTok)
    check('guru GET questions 200', gq.status === 200, gq.status)
    check('guru melihat correct_answer (tidak di-strip)', safeArr(gq.data).some(q => q.correct_answer === 'B' || q.correct_answer === 'A'))
    check('guru melihat 2 soal', safeArr(gq.data).length === 2, safeArr(gq.data).length)

    // ===== UJI D: multi-siswa paralel (tidak ada data silang) =====
    console.log('\n== UJI D: multi-siswa paralel ==')
    const stA = await api('/api/exam-submissions', sATok, 'POST', { exam_id: P.examA })
    check('siswa A start exam A', stA.status === 200, stA.status)
    // siswa B (kelas B) tidak boleh baca soal exam A (kelas A)
    const sBTok = await login('e2fa_sb')
    const qBtoA = await api(`/api/exams/${P.examA}/questions`, sBTok)
    check('siswa B (kelas lain) DITOLAK baca soal exam A', qBtoA.status === 404 || qBtoA.status === 403, qBtoA.status)
    // siswa A sebelum submit → kunci tertahan
    const qApre = await api(`/api/exams/${P.examA}/questions`, sATok)
    check('siswa A pra-submit: kunci TERTAHAN', !safeArr(qApre.data).some(q => q.correct_answer !== undefined && q.correct_answer !== null))
    check('siswa A dapat 2 soal', safeArr(qApre.data).length === 2, safeArr(qApre.data).length)
    // paralel: A & guru sekaligus
    const [pa, pg] = await Promise.all([
        api(`/api/exams/${P.examA}/questions`, sATok),
        api(`/api/exams/${P.examA}/questions`, guruTok),
    ])
    check('paralel: siswa lihat kunci tertahan', !safeArr(pa.data).some(q => q.correct_answer !== undefined && q.correct_answer !== null))
    check('paralel: guru lihat kunci', safeArr(pg.data).some(q => q.correct_answer))

    console.log(`\n═══ HASIL UJI MATANG (mode=${mode}): ${pass} ok / ${fail} FAIL ═══`)
}

main().catch(e => { console.error('ERROR:', e.message, e.stack); fail++ }).finally(async () => {
    if (process.env.NO_CLEANUP === '1') { process.exit(fail === 0 ? 0 : 1) }
    try { await cleanup() } catch (e) { console.error('cleanup err:', e.message) }
    process.exit(fail === 0 ? 0 : 1)
})
