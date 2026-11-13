/**
 * Uji: halaman koreksi UTS/UAS menampilkan SOAL walau siswa 0 jawaban.
 * Verifikasi server mengirim `questions` untuk GURU/ADMIN, tidak untuk SISWA.
 * Fixture prefix e2fc + cleanup.
 */
require('./../loadtest/e2e/helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2kc1234!'
const PFX = 'e2fc0000-0000-4000-8000-'
const P = {
    school: `${PFX}000000000001`, year: `${PFX}000000000002`, subject: `${PFX}000000000003`, klass: `${PFX}000000000004`,
    guruUser: `${PFX}100000000001`, teacher: `${PFX}100000000002`, ta: `${PFX}100000000003`,
    sUser: `${PFX}200000000001`, student: `${PFX}200000000002`,
    exam: `${PFX}300000000001`, q1: `${PFX}400000000001`, q2: `${PFX}400000000002`,
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
let pass = 0, fail = 0
function check(n, c, d) { if (c) { pass++; console.log(`  ok : ${n}`) } else { fail++; console.log(`  FAIL: ${n}${d !== undefined ? ' — ' + JSON.stringify(d) : ''}`) } }
const iso = (ms) => new Date(Date.now() + ms).toISOString()
async function login(u) { const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PASS }) }); if (!r.ok) throw new Error(`login ${u}: ${r.status}`); return r.headers.get('set-cookie')?.split(';')[0] }
async function api(p, c, m = 'GET') { const r = await fetch(BASE + p, { method: m, headers: { Cookie: c } }); let d = null; try { d = await r.json() } catch { } return { status: r.status, data: d } }

async function cleanup() {
    const { data: subs } = await supabase.from('official_exam_submissions').select('id').eq('exam_id', P.exam)
    for (const s of (subs || [])) await supabase.from('official_exam_answers').delete().eq('submission_id', s.id)
    await supabase.from('official_exam_submissions').delete().eq('exam_id', P.exam)
    await supabase.from('official_exam_questions').delete().eq('exam_id', P.exam)
    await supabase.from('official_exams').delete().eq('id', P.exam)
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
    await must('school', supabase.from('schools').insert({ id: P.school, name: 'E2FC School', code: 'E2FC', school_level: 'SMA', is_active: true, max_students: 50, max_teachers: 10 }))
    await must('year', supabase.from('academic_years').insert({ id: P.year, name: 'E2FC 2025/2026', start_date: '2025-07-14', end_date: null, status: 'ACTIVE', is_active: true, school_id: P.school }))
    await must('subject', supabase.from('subjects').insert({ id: P.subject, name: 'E2FC Mapel', school_id: P.school, kkm: 70, level: 'SMA' }))
    await must('klass', supabase.from('classes').insert({ id: P.klass, name: 'E2FC Kelas', grade_level: 10, school_level: 'SMA', academic_year_id: P.year }))
    await must('users', supabase.from('users').insert([
        { id: P.guruUser, username: 'e2fc_guru', full_name: 'E2FC Guru', password_hash: hash, role: 'GURU', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.sUser, username: 'e2fc_siswa', full_name: 'E2FC Siswa', password_hash: hash, role: 'SISWA', school_id: P.school, must_change_password: false, is_locked: false },
    ]))
    await must('teacher', supabase.from('teachers').insert({ id: P.teacher, user_id: P.guruUser, school_id: P.school }))
    await must('ta', supabase.from('teaching_assignments').insert({ id: P.ta, teacher_id: P.teacher, subject_id: P.subject, class_id: P.klass, academic_year_id: P.year }))
    await must('student', supabase.from('students').insert({ id: P.student, user_id: P.sUser, school_id: P.school, class_id: P.klass, nis: 'e2fc01', status: 'ACTIVE', school_level: 'SMA' }))
    await must('enroll', supabase.from('student_enrollments').insert({ student_id: P.student, class_id: P.klass, academic_year_id: P.year, status: 'ACTIVE', enrolled_at: iso(-365 * 86400000) }))
    await must('exam', supabase.from('official_exams').insert({ id: P.exam, title: 'E2FC UTS', exam_type: 'UTS', school_id: P.school, subject_id: P.subject, academic_year_id: P.year, start_time: iso(-3600000), duration_minutes: 60, is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: false, results_released: false, target_class_ids: [P.klass] }))
    await must('q', supabase.from('official_exam_questions').insert([
        { id: P.q1, exam_id: P.exam, question_text: 'E2FC soal 1', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb'], correct_answer: 'A', points: 50, order_index: 0, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
        { id: P.q2, exam_id: P.exam, question_text: 'E2FC soal esai', question_type: 'ESSAY', options: null, correct_answer: null, points: 50, order_index: 1, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
    ]))
    // submission SUDAH SUBMIT tapi 0 jawaban (pola siswa tak menjawab / auto-close)
    await must('sub', supabase.from('official_exam_submissions').insert({ exam_id: P.exam, student_id: P.student, is_submitted: true, submitted_at: iso(0), started_at: iso(-3660000), total_score: 0, max_score: 100, is_graded: true }))
}

async function main() {
    await seed()
    const guru = await login('e2fc_guru')
    const siswa = await login('e2fc_siswa')
    const { data: sub } = await supabase.from('official_exam_submissions').select('id').eq('exam_id', P.exam).single()

    console.log('\n[1] GURU buka detail submission (untuk halaman koreksi)')
    const g = await api(`/api/official-exam-submissions/${sub.id}`, guru)
    check('GET 200', g.status === 200, g.status)
    check('answers kosong (siswa tak menjawab)', Array.isArray(g.data.answers) && g.data.answers.length === 0, g.data.answers?.length)
    check('ada field questions (soal tetap terkirim)', Array.isArray(g.data.questions), g.data.questions)
    check('jumlah soal = 2', Array.isArray(g.data.questions) && g.data.questions.length === 2, g.data.questions?.length)
    check('soal punya question_text', (g.data.questions || []).every(q => q.question_text))
    check('soal MC punya options array', Array.isArray((g.data.questions || []).find(q => q.id === P.q1)?.options))

    console.log('\n[2] SISWA buka detail → TIDAK boleh dapat daftar questions (anti kunci)')
    const s = await api(`/api/official-exam-submissions/${sub.id}`, siswa)
    check('SISWA tidak menerima field questions', !s.data.questions || (Array.isArray(s.data.questions) && s.data.questions.length === 0), s.data.questions)

    console.log(`\n═══ HASIL: ${pass} ok / ${fail} FAIL ═══`)
}
main().catch(e => { console.error('ERROR:', e.message); fail++ }).finally(async () => {
    try { await cleanup() } catch (e) { console.error('cleanup:', e.message) }
    process.exit(fail === 0 ? 0 : 1)
})
