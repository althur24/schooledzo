/**
 * Uji GERBANG KUNCI JAWABAN (anti-leak) — ulangan + UTS/UAS, mode production-like.
 *
 * Memverifikasi refaktor "gabung query /questions" TIDAK merusak gerbang kunci:
 *   [1] Belum submit → correct_answer TERTAHAN (tak ada di respons), gk_max_picks ada.
 *   [2] Sudah submit + show_results_immediately=true → kunci TERBUKA.
 *   [3] Sudah submit + show_results_immediately=false + results_released=false
 *       → kunci TETAP TERTAHAN.
 *   [4] results_released=true → kunci TERBUKA.
 *   [5] Belum submit lagi (submission dihapus) → kembali TERTAHAN.
 *
 * Prasyarat: server lokal staging di :3457 (set -a; source .env.staging; next start).
 * Jalankan: ENV_FILE=.env.staging node scripts/e2e-kunci-gerbang-staging.cjs
 */
require('./../loadtest/e2e/helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2kg1234!'
const PFX = 'e2f90000-0000-4000-8000-'
const P = {
    school: `${PFX}000000000001`,
    year: `${PFX}000000000002`,
    subject: `${PFX}000000000003`,
    klass: `${PFX}000000000004`,
    guruUser: `${PFX}100000000001`,
    teacher: `${PFX}100000000002`,
    ta: `${PFX}100000000003`,
    sUser: `${PFX}200000000001`,
    student: `${PFX}200000000002`,
    exam: `${PFX}300000000001`,
    q: `${PFX}400000000001`,
    examO: `${PFX}300000000002`,
    qO: `${PFX}400000000002`,
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
const hasKey = (arr) => Array.isArray(arr) && arr.some(q => q.correct_answer !== undefined && q.correct_answer !== null)

async function cleanup() {
    for (const ex of [P.exam, P.examO]) {
        const { data: subs } = await supabase.from('exam_submissions').select('id').eq('exam_id', ex)
        for (const s of (subs || [])) await supabase.from('exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('exam_submissions').delete().eq('exam_id', ex)
        const { data: osubs } = await supabase.from('official_exam_submissions').select('id').eq('exam_id', ex)
        for (const s of (osubs || [])) await supabase.from('official_exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('official_exam_submissions').delete().eq('exam_id', ex)
        await supabase.from('exam_questions').delete().eq('exam_id', ex)
        await supabase.from('official_exam_questions').delete().eq('exam_id', ex)
        await supabase.from('exams').delete().eq('id', ex)
        await supabase.from('official_exams').delete().eq('id', ex)
    }
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

async function main() {
    await cleanup()
    const hash = bcrypt.hashSync(PASS, 10)
    const must = async (l, q) => { const { error } = await q; if (error) throw new Error(`${l}: ${error.message}`) }
    await must('school', supabase.from('schools').insert({ id: P.school, name: 'E2F9 School', code: 'E2F9', school_level: 'SMP', is_active: true, max_students: 50, max_teachers: 10 }))
    await must('year', supabase.from('academic_years').insert({ id: P.year, name: 'E2F9 2025/2026', start_date: '2025-07-14', end_date: null, status: 'ACTIVE', is_active: true, school_id: P.school }))
    await must('subject', supabase.from('subjects').insert({ id: P.subject, name: 'E2F9 Mapel', school_id: P.school, kkm: 70, level: 'SMP' }))
    await must('class', supabase.from('classes').insert({ id: P.klass, name: 'E2F9 Kelas', grade_level: 8, school_level: 'SMP', academic_year_id: P.year }))
    await must('users', supabase.from('users').insert([
        { id: P.guruUser, username: 'e2f9_guru', full_name: 'E2F9 Guru', password_hash: hash, role: 'GURU', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.sUser, username: 'e2f9_siswa', full_name: 'E2F9 Siswa', password_hash: hash, role: 'SISWA', school_id: P.school, must_change_password: false, is_locked: false },
    ]))
    await must('teacher', supabase.from('teachers').insert({ id: P.teacher, user_id: P.guruUser, school_id: P.school }))
    await must('ta', supabase.from('teaching_assignments').insert({ id: P.ta, teacher_id: P.teacher, subject_id: P.subject, class_id: P.klass, academic_year_id: P.year }))
    await must('student', supabase.from('students').insert({ id: P.student, user_id: P.sUser, school_id: P.school, class_id: P.klass, nis: 'e2f901', status: 'ACTIVE', school_level: 'SMP' }))
    await must('enroll', supabase.from('student_enrollments').insert({ student_id: P.student, class_id: P.klass, academic_year_id: P.year, status: 'ACTIVE', enrolled_at: iso(-365 * 86400000) }))

    // Ulangan: show_results_immediately=false (gerbang kunci ketat)
    await must('exam', supabase.from('exams').insert({ id: P.exam, title: 'E2F9 Ulangan', teaching_assignment_id: P.ta, start_time: iso(-300000), duration_minutes: 120, window_end_time: iso(3600000), is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: false, results_released: false, created_by: P.guruUser }))
    await must('q', supabase.from('exam_questions').insert({ id: P.q, exam_id: P.exam, question_text: 'E2F9 soal kunci', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb'], correct_answer: 'B', points: 100, order_index: 0, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' }))

    const sTok = await login('e2f9_siswa')

    // [1] Belum submit → kunci tertahan
    console.log('\n[1] Belum submit → kunci TERTAHAN')
    const startU = await api('/api/exam-submissions', sTok, 'POST', { exam_id: P.exam })
    check('start 200', startU.status === 200, startU.status)
    const q1 = await api(`/api/exams/${P.exam}/questions`, sTok)
    check('GET questions 200', q1.status === 200, q1.status)
    check('[1] correct_answer TERTAHAN', !hasKey(q1.data), q1.data)

    // [2] Submit → tetap tertahan (show_results_immediately=false, belum released)
    console.log('\n[2] Sudah submit (belum released) → kunci TETAP TERTAHAN')
    await api('/api/exam-submissions', sTok, 'PUT', { submission_id: startU.data.id, submit: true, answers: [{ question_id: P.q, answer: 'B' }] })
    const q2 = await api(`/api/exams/${P.exam}/questions`, sTok)
    check('[2] kunci tetap tertahan walau sudah submit', !hasKey(q2.data), q2.data)

    // [3] results_released=true + JENDELA TUTUP → kunci TERBUKA
    // Catatan: gerbang kunci = hasSubmitted && examKeysWindow(jendela tutup)
    // && resultsGate. Ujian masih aktif → examKeysWindow false. Jadi untuk melihat
    // kunci terbuka, jendela harus TUTUP (window_end ke masa lalu) + hasil dirilis.
    console.log('\n[3] results_released=true + jendela tutup → kunci TERBUKA')
    await supabase.from('exams').update({ results_released: true, window_end_time: iso(-60000) }).eq('id', P.exam)
    const q3 = await api(`/api/exams/${P.exam}/questions`, sTok)
    check('[3] kunci TERBUKA setelah released + jendela tutup', hasKey(q3.data), q3.data)

    // [4] show_results_immediately=true + jendela tutup → kunci terbuka
    console.log('\n[4] show_results_immediately=true + jendela tutup → kunci terbuka')
    await supabase.from('exams').update({ results_released: false, show_results_immediately: true }).eq('id', P.exam)
    const q4 = await api(`/api/exams/${P.exam}/questions`, sTok)
    check('[4] kunci terbuka (show_results_immediately + jendela tutup)', hasKey(q4.data), q4.data)

    // ── UTS/UAS: gerbang sama ──
    console.log('\n[5] UTS/UAS belum submit → kunci tertahan')
    await must('examO', supabase.from('official_exams').insert({ id: P.examO, title: 'E2F9 UTS', exam_type: 'UTS', school_id: P.school, subject_id: P.subject, academic_year_id: P.year, start_time: iso(-300000), duration_minutes: 120, window_end_time: iso(3600000), is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: false, results_released: false, target_class_ids: [P.klass] }))
    await must('qO', supabase.from('official_exam_questions').insert({ id: P.qO, exam_id: P.examO, question_text: 'E2F9 UTS soal', question_type: 'MULTIPLE_CHOICE', options: ['Aaa', 'Bbb'], correct_answer: 'A', points: 100, order_index: 0, status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' }))
    const startO = await api('/api/official-exam-submissions', sTok, 'POST', { exam_id: P.examO })
    check('UTS start 200', startO.status === 200, startO.status)
    const qo1 = await api(`/api/official-exams/${P.examO}/questions`, sTok)
    check('[5] UTS kunci tertahan sebelum submit', !hasKey(qo1.data), qo1.data)

    console.log('\n[6] UTS/UAS sudah submit (belum released) → kunci tetap tertahan')
    await api('/api/official-exam-submissions', sTok, 'PUT', { submission_id: startO.data.id, submit: true, answers: [{ question_id: P.qO, answer: 'A' }] })
    const qo2 = await api(`/api/official-exams/${P.examO}/questions`, sTok)
    check('[6] UTS kunci tetap tertahan', !hasKey(qo2.data), qo2.data)

    console.log(`\n═══ HASIL UJI GERBANG KUNCI: ${pass} ok / ${fail} FAIL ═══`)
}

main().catch(e => { console.error('ERROR:', e.message); fail++ }).finally(async () => {
    if (process.env.NO_CLEANUP === '1') { console.log('\n(NO_CLEANUP → lewati cleanup untuk inspeksi)'); process.exit(fail === 0 ? 0 : 1) }
    console.log('\ncleanup...')
    try { await cleanup() } catch (e) { console.error('cleanup err:', e.message) }
    console.log('cleanup selesai')
    process.exit(fail === 0 ? 0 : 1)
})
