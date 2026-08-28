/**
 * Cleanup load test (versi Node dari loadtest/cleanup_loadtest.sql).
 * Menghapus SEMUA data bertanda lt_/LOADTEST (UUID prefix 7e57xx) dalam urutan FK-safe.
 * Jalankan: node loadtest/cleanup_loadtest.cjs
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// PostgREST memotong hasil ke 1000 baris per request — ambil per halaman sampai habis.
async function fetchAllRows(query, pageSize = 1000) {
    const all = []
    let page = 0
    while (page < 20) {
        const { data, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1)
        if (error) throw error
        all.push(...(data || []))
        if ((data || []).length < pageSize) break
        page++
    }
    return all
}

const EXAM = '7e575000-0000-0000-0000-000000000001'
const SCHOOL = '7e570000-0000-0000-0000-000000000001'
const YEAR = '7e570000-0000-0000-0000-000000000002'
const SUBJECT = '7e570000-0000-0000-0000-000000000003'

async function delIn(table, col, ids, label) {
    for (let i = 0; i < ids.length; i += 500) {
        const { error } = await supabase.from(table).delete().in(col, ids.slice(i, i + 500))
        if (error) throw new Error(`${label}: ${error.message}`)
    }
    if (ids.length) console.log(`hapus ${label}: ${ids.length}`)
}

async function main() {
    // submissions & answers milik ujian dummy
    const subs = await fetchAllRows(supabase.from('official_exam_submissions').select('id').eq('exam_id', EXAM))
    const subIds = subs.map(s => s.id)
    await delIn('official_exam_answers', 'submission_id', subIds, 'answers')
    await delIn('official_exam_submissions', 'id', subIds, 'submissions')

    // user dummy + turunannya
    const users = await fetchAllRows(supabase.from('users').select('id').like('username', 'lt_siswa_%'))
    const userIds = users.map(u => u.id)
    await delIn('notifications', 'user_id', userIds, 'notifications')
    await delIn('sessions', 'user_id', userIds, 'sessions')

    const students = await fetchAllRows(supabase.from('students').select('id').eq('school_id', SCHOOL))
    const studentIds = students.map(s => s.id)
    await delIn('student_enrollments', 'student_id', studentIds, 'enrollments')
    await delIn('students', 'id', studentIds, 'students')
    await delIn('users', 'id', userIds, 'users')

    await delIn('official_exam_questions', 'exam_id', [EXAM], 'questions')
    await delIn('official_exams', 'id', [EXAM], 'exam')
    await delIn('classes', 'academic_year_id', [YEAR], 'classes')
    await delIn('academic_years', 'id', [YEAR], 'year')
    await delIn('subjects', 'id', [SUBJECT], 'subject')
    await delIn('schools', 'id', [SCHOOL], 'school')

    // verifikasi nol
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true }).like('username', 'lt_siswa_%')
    console.log(count === 0 ? 'CLEANUP BERSIH' : `SISA users: ${count}`)
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
