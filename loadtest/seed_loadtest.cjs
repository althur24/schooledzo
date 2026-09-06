/**
 * Seeder load test (versi Node dari loadtest/seed_loadtest.sql — hasil identik,
 * UUID deterministik prefix 7e57xx, token lt_token_0001..1000).
 *
 * Jalankan: node loadtest/seed_loadtest.cjs                       (production .env.local)
 *           ENV_FILE=.env.staging node loadtest/seed_loadtest.cjs (staging)
 * Bersihkan: node loadtest/cleanup_loadtest.cjs (dengan ENV_FILE yang sama)
 * Idempotent (upsert by id, onConflict DO NOTHING).
 */
require('./e2e/helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const P = {
    school: '7e570000-0000-0000-0000-000000000001',
    year: '7e570000-0000-0000-0000-000000000002',
    subject: '7e570000-0000-0000-0000-000000000003',
    klass: (i) => `7e570001-0000-0000-0000-${i.toString(16).padStart(12, '0')}`,
    user: (n) => `7e571000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`,
    student: (n) => `7e572000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`,
    enroll: (n) => `7e573000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`,
    session: (n) => `7e574000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`,
    exam: '7e575000-0000-0000-0000-000000000001',
    question: (q) => `7e576000-0000-0000-0000-${q.toString(16).padStart(12, '0')}`,
}
const HASH = '$2b$10$rqXmqWFyi8Tm1.W8EOknfes0laidH4JAfH2G1GxoCAjtwk3panAY.' // Loadtest123!
const N = 1000

async function upsert(table, rows, label) {
    for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true })
        if (error) throw new Error(`${label}: ${error.message}`)
    }
    console.log(`OK ${label} (${rows.length})`)
}

async function main() {
    const now = Date.now()
    await upsert('schools', [{ id: P.school, name: 'LOADTEST School', code: 'LT001', school_level: 'SMP', is_active: true, max_students: 2000, max_teachers: 50 }], 'school')
    await upsert('academic_years', [{ id: P.year, name: 'LOADTEST 2025/2026', start_date: '2025-07-14', end_date: null, status: 'ACTIVE', is_active: true, school_id: P.school }], 'academic_year')
    await upsert('subjects', [{ id: P.subject, name: 'LOADTEST Mapel', school_id: P.school, kkm: 70, level: 'SMP' }], 'subject')
    await upsert('classes', Array.from({ length: 10 }, (_, k) => ({ id: P.klass(k + 1), name: `LT-Kelas-${k + 1}`, grade_level: 3, school_level: 'SMP', academic_year_id: P.year })), 'classes')

    const users = [], students = [], enrolls = [], sessions = []
    for (let n = 1; n <= N; n++) {
        const pad = String(n).padStart(4, '0')
        const classId = P.klass(Math.floor((n - 1) / 100) + 1)
        users.push({ id: P.user(n), username: `lt_siswa_${pad}`, password_hash: HASH, full_name: `Loadtest Siswa ${pad}`, role: 'SISWA', school_id: P.school, must_change_password: false, is_locked: false })
        students.push({ id: P.student(n), user_id: P.user(n), nis: `LT${pad}`, class_id: classId, angkatan: '2025', entry_year: 2025, school_level: 'SMP', status: 'ACTIVE', gender: n % 2 === 0 ? 'L' : 'P', school_id: P.school })
        enrolls.push({ id: P.enroll(n), student_id: P.student(n), class_id: classId, academic_year_id: P.year, status: 'ACTIVE', notes: 'LOADTEST — enrollment dummy uji beban' })
        sessions.push({ id: P.session(n), user_id: P.user(n), token: `lt_token_${pad}`, expires_at: new Date(now + 7 * 86400e3).toISOString() })
    }
    await upsert('users', users, 'users')
    await upsert('students', students, 'students')
    await upsert('student_enrollments', enrolls, 'enrollments')

    await upsert('official_exams', [{
        id: P.exam, title: 'LOADTEST-TO', description: 'Ujian dummy untuk load test 1000 siswa serentak. Jangan dipakai untuk penilaian asli.',
        exam_type: 'UTS', school_id: P.school, subject_id: P.subject, academic_year_id: P.year,
        start_time: new Date(now - 3600e3).toISOString(), duration_minutes: 120,
        is_active: true, is_randomized: false, is_remedial: false, show_results_immediately: true, results_released: false,
        max_violations: 3, target_class_ids: Array.from({ length: 10 }, (_, k) => P.klass(k + 1)),
    }], 'exam (window s/d ' + new Date(now + 3600e3).toISOString() + ')')

    await upsert('official_exam_questions', Array.from({ length: 50 }, (_, k) => {
        const q = k + 1
        return {
            id: P.question(q), exam_id: P.exam, question_text: `LOADTEST soal ${q}: manakah jawaban yang benar?`,
            question_type: 'MULTIPLE_CHOICE', options: ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D'],
            correct_answer: 'ABCD'[(q - 1) % 4], points: 2, order_index: q,
            difficulty: 'MEDIUM', status: 'approved', content_format: 'plain', text_direction: 'ltr',
        }
    }), 'questions')
    await upsert('sessions', sessions, 'sessions')

    // verifikasi hitungan
    const checks = [
        ['users', 'username', 'lt_siswa_%', 1000],
        ['sessions', 'token', 'lt_token_%', 1000],
    ]
    for (const [table, col, like, target] of checks) {
        const { count } = await supabase.from(table).select('*', { count: 'exact', head: true }).like(col, like)
        console.log(`${table}: ${count}/${target}`)
    }
    const { count: qCount } = await supabase.from('official_exam_questions').select('*', { count: 'exact', head: true }).eq('exam_id', P.exam)
    console.log(`questions: ${qCount}/50`)
    console.log('SEED SELESAI')
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
