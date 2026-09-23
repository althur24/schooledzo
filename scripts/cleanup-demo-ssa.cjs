/**
 * scripts/cleanup-demo-ssa.cjs — Hapus semua row demo di SSA (prefix UUID 5e5a).
 *
 * Hanya menghapus data demo yang dibuat scripts/seed-demo-ssa.cjs. Data lama SSA
 * (siswa/kelas/guru/mapel yang sudah ada sebelum seed) TIDAK dihapus. Password guru
 * TIDAK direstore otomatis (hash lama dicetak saat seed — restore manual bila perlu).
 *
 * Jalankan: node scripts/cleanup-demo-ssa.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
if (!URL.includes('veohqmrydavkokfiqvjj')) { console.error('[GUARD] Bukan production. ABORT.'); process.exit(1) }
if (URL.includes('vkkgnredrfqqraonynte')) { console.error('[GUARD] URL staging. ABORT.'); process.exit(1) }
const sb = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PREFIX = '5e5a'

// Rentang UUID demo (kind 0x0000–0x00ff, semua id '5e5a<4hex kind>-...').
// Operator `like` tidak berlaku untuk kolom uuid — pakai range gte/lt (byte-wise).
const ID_MIN = '5e5a0000-0000-0000-0000-000000000000'
const ID_MAX = '5e5a0100-0000-0000-0000-000000000000'

// Ambil semua id demo pada satu tabel — paging 1000 baris.
async function demoIds(table, col = 'id') {
    const ids = []
    let page = 0
    for (;;) {
        const r = await sb.from(table).select(col)
            .gte(col, ID_MIN).lt(col, ID_MAX).range(page, page + 999)
        if (r.error) throw new Error(`${table}: ${r.error.message}`)
        for (const row of r.data) ids.push(row[col])
        if (r.data.length < 1000) return ids
        page += 1000
    }
}

// Hapus per tabel FK-safe; chunk 100 id (batas URL).
async function del(table, ids, label) {
    if (!ids.length) { console.log(`  -- ${label}: 0`); return 0 }
    let deleted = 0
    for (let i = 0; i < ids.length; i += 100) {
        const { error, data } = await sb.from(table).delete().in('id', ids.slice(i, i + 100)).select('id')
        if (error && !/no rows|not found/i.test(error.message)) throw new Error(`del ${table}: ${error.message}`)
        deleted += (data || []).length
    }
    console.log(`  -- ${label}: ${deleted} dihapus`)
    return deleted
}

async function delBy(table, col, ids, label) {
    if (!ids.length) { console.log(`  -- ${label}: 0`); return 0 }
    let deleted = 0
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const { error, data } = await sb.from(table).delete().in(col, chunk).select('id')
        if (error && !/no rows|not found/i.test(error.message)) throw new Error(`del ${table}.${col}: ${error.message}`)
        deleted += (data || []).length
    }
    console.log(`  -- ${label}: ${deleted} dihapus`)
    return deleted
}

async function main() {
    console.log('Menghapus data demo SSA (prefix 5e5a) ...')

    // Kumpulkan id demo untuk tabel induk (dipakai filter tabel anak).
    const examSubIds = await demoIds('exam_submissions')
    const oexSubIds = await demoIds('official_exam_submissions')
    const stdSubIds = await demoIds('student_submissions')
    const quizIds = await demoIds('quizzes')
    const examIds = await demoIds('exams')
    const oexIds = await demoIds('official_exams')
    const asgIds = await demoIds('assignments')
    const schedIds = await demoIds('schedules')
    const userIds = await demoIds('users')
    const taIds = await demoIds('teaching_assignments')

    // 1. Anak dari submissions (FK submission_id)
    await delBy('exam_answers', 'submission_id', examSubIds, 'exam_answers')
    await delBy('official_exam_answers', 'submission_id', oexSubIds, 'official_exam_answers')
    await delBy('submission_revisions', 'submission_id', stdSubIds, 'submission_revisions')
    await delBy('grades', 'submission_id', stdSubIds, 'grades')

    // 2. Anak langsung dari aset (FK quiz/exam/asg/schedule)
    await del('quiz_submissions', await demoIds('quiz_submissions'), 'quiz_submissions')
    await del('quiz_questions', await demoIds('quiz_questions'), 'quiz_questions')
    await del('exam_submissions', examSubIds, 'exam_submissions')
    await del('official_exam_submissions', oexSubIds, 'official_exam_submissions')
    await del('exam_questions', await demoIds('exam_questions'), 'exam_questions')
    await del('official_exam_questions', await demoIds('official_exam_questions'), 'official_exam_questions')
    await delBy('schedule_entries', 'schedule_id', schedIds, 'schedule_entries')

    // 3. Aset induk
    await del('quizzes', quizIds, 'quizzes')
    await del('exams', examIds, 'exams')
    await del('official_exams', oexIds, 'official_exams')
    await del('student_submissions', stdSubIds, 'student_submissions')
    await del('assignments', asgIds, 'assignments')
    await del('schedules', schedIds, 'schedules')

    // 4. Audit & referensi lepas
    await del('grade_history', await demoIds('grade_history'), 'grade_history')
    await del('question_bank', await demoIds('question_bank'), 'question_bank')
    await del('materials', await demoIds('materials'), 'materials')

    // 5. Notifikasi demo (prefix id) + notifikasi untuk user demo (user_id)
    await del('notifications', await demoIds('notifications'), 'notifications (id)')
    // Tambahan: notifikasi yang user-nya demo tapi id tidak ber-prefix (tidak terjadi di seed ini, jaga-jaga)
    // — dilewati agar tidak menghapus notifikasi lama user yang kebetulan.

    // 6. Enrollment & akun siswa demo
    await del('student_enrollments', await demoIds('student_enrollments'), 'student_enrollments')
    await del('students', await demoIds('students'), 'students')

    // 7. TA demo (2 baru — prefix)
    await del('teaching_assignments', taIds, 'teaching_assignments')

    // 8. Pengumuman demo
    await del('announcements', await demoIds('announcements'), 'announcements')

    // 9. users siswa demo (paling akhir — FK students)
    await del('users', userIds, 'users')

    // Catatan: password guru & homeroom TIDAK direstore otomatis.
    console.log('\nCatatan: password 3 guru demo (Demo123!) & wali kelas tidak direstore otomatis.')
    console.log('         Hash lama dicetak saat seed — restore manual bila perlu.')
    console.log('CLEANUP SELESAI ✓')
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
