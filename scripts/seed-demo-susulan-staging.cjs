/**
 * Demo fixture SUSULAN untuk staging (untuk uji manual UI).
 *
 * Membuat:
 *  - admin, guru, 4 siswa (password sama)
 *  - 1 ulangan berakhir + 1 UTS berakhir (10 MC x 10 poin)
 *  - state per siswa:
 *      s1: belum mulai, tanpa grant  -> guru/admin bisa klik Susulan
 *      s2: grant aktif (cap 80)      -> siswa lihat "Mulai Susulan"
 *      s3: grant expired             -> monitor "Perpanjang"/expired
 *      s4: sudah submit (nilai 80)   -> badge cap/hasil
 *    UTS: s1 tanpa grant, s2 grant aktif (full), s3 submit 100.
 *
 * Jalankan: ENV_FILE=.env.staging node scripts/seed-demo-susulan-staging.cjs
 * Bersihkan: CLEANUP_ONLY=1 ENV_FILE=.env.staging node scripts/seed-demo-susulan-staging.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const APP_BASE = process.env.DEMO_BASE || 'https://schooledzo-production-e036.up.railway.app'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2'
const P = 'susa_'
const PASS = 'Susulan123!'
const CLEANUP_ONLY = process.env.CLEANUP_ONLY === '1'

const ins = async (table, row) => {
    const { data, error } = await supabase.from(table).insert(row).select().single()
    if (error || !data) throw new Error(`insert ${table}: ${JSON.stringify(error)}`)
    return data
}

async function preClean() {
    const like = `${P}%`
    const { data: exams } = await supabase.from('exams').select('id').like('title', like)
    const examIds = (exams || []).map(e => e.id)
    if (examIds.length) {
        const { data: subs } = await supabase.from('exam_submissions').select('id').in('exam_id', examIds)
        for (const s of subs || []) await supabase.from('exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('exam_submissions').delete().in('exam_id', examIds)
        await supabase.from('exam_questions').delete().in('exam_id', examIds)
        await supabase.from('exams').delete().in('id', examIds)
    }
    const { data: offs } = await supabase.from('official_exams').select('id').like('title', like)
    const offIds = (offs || []).map(e => e.id)
    if (offIds.length) {
        const { data: subs } = await supabase.from('official_exam_submissions').select('id').in('exam_id', offIds)
        for (const s of subs || []) await supabase.from('official_exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('official_exam_submissions').delete().in('exam_id', offIds)
        await supabase.from('official_exam_questions').delete().in('exam_id', offIds)
        await supabase.from('official_exams').delete().in('id', offIds)
    }
    await supabase.from('grade_history').delete().like('ref_title', like)
    const { data: users } = await supabase.from('users').select('id').like('username', like)
    const userIds = (users || []).map(u => u.id)
    if (userIds.length) {
        const { data: students } = await supabase.from('students').select('id').in('user_id', userIds)
        for (const s of students || []) {
            await supabase.from('student_enrollments').delete().eq('student_id', s.id)
            await supabase.from('students').delete().eq('id', s.id)
        }
        const { data: teachers } = await supabase.from('teachers').select('id').in('user_id', userIds)
        for (const t of teachers || []) {
            await supabase.from('teaching_assignments').delete().eq('teacher_id', t.id)
            await supabase.from('teachers').delete().eq('id', t.id)
        }
        await supabase.from('sessions').delete().in('user_id', userIds)
        await supabase.from('notifications').delete().in('user_id', userIds)
        await supabase.from('users').delete().in('id', userIds)
    }
    const { data: classes } = await supabase.from('classes').select('id').like('name', like)
    if (classes?.length) await supabase.from('classes').delete().in('id', classes.map(c => c.id))
}

async function main() {
    await preClean()
    if (CLEANUP_ONLY) {
        console.log('CLEANUP_ONLY selesai — fixture demo susulan dibersihkan.')
        return
    }

    const hash = await bcrypt.hash(PASS, 10)
    const uname = (s) => `${P}${s}`

    const adminU = await ins('users', {
        username: uname('admin'), password_hash: hash, full_name: 'Admin Demo Susulan',
        role: 'ADMIN', school_id: SCHOOL, must_change_password: false, is_locked: false,
    })
    const guruU = await ins('users', {
        username: uname('guru'), password_hash: hash, full_name: 'Guru Demo Susulan',
        role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false,
    })
    const guru = await ins('teachers', { user_id: guruU.id, school_id: SCHOOL })
    const kelas = await ins('classes', { name: `${P}kelas`, grade_level: 8, school_level: 'SMP', academic_year_id: YEAR })
    const ta = await ins('teaching_assignments', {
        teacher_id: guru.id, subject_id: SUBJECT, class_id: kelas.id, academic_year_id: YEAR,
    })

    const students = []
    for (const [i, label] of ['s1', 's2', 's3', 's4'].entries()) {
        const u = await ins('users', {
            username: uname(label), password_hash: hash, full_name: `Siswa Demo ${label}`,
            role: 'SISWA', school_id: SCHOOL, must_change_password: false, is_locked: false,
        })
        const s = await ins('students', {
            user_id: u.id, nis: `${Date.now()}${i}`.slice(-9), class_id: kelas.id,
            school_id: SCHOOL, school_level: 'SMP', status: 'ACTIVE',
        })
        await ins('student_enrollments', {
            student_id: s.id, class_id: kelas.id, academic_year_id: YEAR, status: 'ACTIVE',
            enrolled_at: new Date(Date.now() - 40 * 86400000).toISOString(),
        })
        students.push({ label, user: u, student: s })
    }
    const [s1, s2, s3, s4] = students

    const exam = await ins('exams', {
        teaching_assignment_id: ta.id,
        title: `${P}Ulangan Berakhir`,
        start_time: new Date(Date.now() - 3 * 3600000).toISOString(),
        duration_minutes: 60, is_active: true, max_violations: 3,
        show_results_immediately: true, is_randomized: false,
    })
    const examQs = []
    for (let i = 0; i < 10; i++) {
        examQs.push(await ins('exam_questions', {
            exam_id: exam.id, question_text: `${P}soal ${i + 1}`,
            question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'],
            correct_answer: 'A', points: 10, order_index: i, status: 'approved',
            difficulty: 'EASY', content_format: 'plain',
        }))
    }
    const qOrder = examQs.map(q => q.id)
    const nowIso = new Date().toISOString()
    const futureIso = new Date(Date.now() + 7 * 86400000).toISOString()
    const pastIso = new Date(Date.now() - 86400000).toISOString()

    await ins('exam_submissions', {
        exam_id: exam.id, student_id: s2.student.id, started_at: null, is_submitted: false,
        question_order: qOrder, max_score: 100, total_score: 0, is_graded: false,
        susulan_granted_at: nowIso, susulan_expires_at: futureIso,
        susulan_max_percent: 80, susulan_granted_by: guruU.id,
    })
    await ins('exam_submissions', {
        exam_id: exam.id, student_id: s3.student.id, started_at: null, is_submitted: false,
        question_order: qOrder, max_score: 100, total_score: 0, is_graded: false,
        susulan_granted_at: nowIso, susulan_expires_at: pastIso,
        susulan_max_percent: 100, susulan_granted_by: guruU.id,
    })
    await ins('exam_submissions', {
        exam_id: exam.id, student_id: s4.student.id,
        started_at: new Date(Date.now() - 2 * 3600000).toISOString(),
        submitted_at: new Date(Date.now() - 1 * 3600000).toISOString(),
        is_submitted: true, question_order: qOrder, max_score: 100, total_score: 80,
        is_graded: true, susulan_granted_at: nowIso, susulan_expires_at: futureIso,
        susulan_max_percent: 80, susulan_granted_by: guruU.id,
    })

    const off = await ins('official_exams', {
        school_id: SCHOOL, academic_year_id: YEAR, subject_id: SUBJECT, exam_type: 'UTS',
        title: `${P}UTS Berakhir`, start_time: new Date(Date.now() - 3 * 3600000).toISOString(),
        duration_minutes: 60, is_active: true, max_violations: 3,
        target_class_ids: [kelas.id], created_by: guruU.id, show_results_immediately: true,
    })
    const offQs = []
    for (let i = 0; i < 10; i++) {
        offQs.push(await ins('official_exam_questions', {
            exam_id: off.id, question_text: `${P}uts soal ${i + 1}`,
            question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'],
            correct_answer: 'A', points: 10, order_index: i, status: 'approved',
            difficulty: 'EASY', content_format: 'plain',
        }))
    }
    const offQOrder = offQs.map(q => q.id)
    await ins('official_exam_submissions', {
        exam_id: off.id, student_id: s2.student.id, started_at: null, is_submitted: false,
        question_order: offQOrder, max_score: 100, total_score: 0, is_graded: false,
        susulan_granted_at: nowIso, susulan_expires_at: futureIso,
        susulan_max_percent: 100, susulan_granted_by: guruU.id,
    })
    await ins('official_exam_submissions', {
        exam_id: off.id, student_id: s3.student.id,
        started_at: new Date(Date.now() - 2 * 3600000).toISOString(),
        submitted_at: new Date(Date.now() - 1 * 3600000).toISOString(),
        is_submitted: true, question_order: offQOrder, max_score: 100, total_score: 100,
        is_graded: true,
    })

    console.log('\n=== DEMO SUSULAN STAGING SIAP ===')
    console.log(`URL   : ${APP_BASE}`)
    console.log(`Admin : ${uname('admin')} / ${PASS}`)
    console.log(`Guru  : ${uname('guru')} / ${PASS}`)
    console.log(`Siswa : ${uname('s1')} .. ${uname('s4')} / ${PASS}`)
    console.log(`Ulangan: ${exam.title}  id=${exam.id}`)
    console.log(`UTS    : ${off.title}  id=${off.id}`)
    console.log(`Monitor guru ulangan : /dashboard/guru/ulangan/${exam.id}/monitor`)
    console.log(`Monitor admin ulangan: /dashboard/admin/uts-uas/${exam.id}/monitor?type=ulangan`)
    console.log(`Monitor guru/admin UTS: /dashboard/guru/uts-uas/${off.id}/monitor | /dashboard/admin/uts-uas/${off.id}/monitor`)
    console.log(`Siswa: /dashboard/siswa/ulangan (kartu ulangan & UTS/UAS)`)
    console.log(`\nCleanup: CLEANUP_ONLY=1 ENV_FILE=.env.staging node scripts/seed-demo-susulan-staging.cjs`)
}

main().catch(async (e) => {
    console.error('FATAL:', e)
    try { await preClean() } catch { }
    process.exit(1)
})
