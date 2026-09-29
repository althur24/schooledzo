/**
 * Seeder ULANGAN load test — fixture batch 10 kelas di atas seed_loadtest.cjs
 * (sekolah/siswa/token lt_token_NNNN). Dipakai bersama loadtest/ulangan_load.js (k6).
 *
 * Perbedaan vs load_batch_1000.cjs: tanpa bagian submit/ukur — murni fixture
 * untuk autosave loop k6 (mode ulangan, ±147rb request). Namespace UUID
 * sendiri (7e5789xx) supaya tidak bentrok dengan fixture batch_1000.
 *
 * Ujian: mode JENDELA (window_end +2 jam dari seed) supaya auto-close sweep
 * tidak menutup submission di tengah run k6 (~20 mnt).
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/seed_ulangan_loadtest.cjs seed
 * Cleanup:  ENV_FILE=.env.staging node loadtest/seed_ulangan_loadtest.cjs cleanup
 * (siswa/sekolah LT dibersihkan terpisah via cleanup_loadtest.cjs)
 */
require('./e2e/helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const P = {
    school: '7e570000-0000-0000-0000-000000000001',
    year: '7e570000-0000-0000-0000-000000000002',
    subject: '7e570000-0000-0000-0000-000000000003',
    klass: (i) => `7e570001-0000-0000-0000-${i.toString(16).padStart(12, '0')}`,
    guruUser: '7e578600-0000-0000-0000-000000000001',
    teacher: '7e578700-0000-0000-0000-000000000001',
    ta: (i) => `7e578800-0000-0000-0000-${i.toString(16).padStart(12, '0')}`,
    exam: (i) => `7e578900-0000-0000-0000-${i.toString(16).padStart(12, '0')}`,
}
const GURU_TOKEN = 'lt_guru_ulg_token_0001'
const BATCH_ID = '7e57a000-0000-0000-0000-000000000002'
const N_CLASS = 10, N_Q = 50
const EXAMS = Array.from({ length: N_CLASS }, (_, i) => P.exam(i + 1))
const TAS = Array.from({ length: N_CLASS }, (_, i) => P.ta(i + 1))

async function seed() {
    const now = Date.now()
    const passHash = bcrypt.hashSync('Loadtest123!', 10)

    // Guru owner batch (TA mapel LT × 10 kelas)
    await supabase.from('users').upsert({
        id: P.guruUser, username: 'lt_guru_ulg', full_name: 'LT Guru Ulangan',
        password_hash: passHash, role: 'GURU', school_id: P.school, must_change_password: false, is_locked: false,
    }, { onConflict: 'id', ignoreDuplicates: true })
    await supabase.from('teachers').upsert({ id: P.teacher, user_id: P.guruUser, school_id: P.school }, { onConflict: 'id', ignoreDuplicates: true })
    await supabase.from('sessions').upsert({ user_id: P.guruUser, token: GURU_TOKEN, expires_at: new Date(now + 86400e3).toISOString() }, { onConflict: 'token', ignoreDuplicates: true })
    await supabase.from('teaching_assignments').upsert(
        TAS.map((id, i) => ({ id, teacher_id: P.teacher, class_id: P.klass(i + 1), subject_id: P.subject, academic_year_id: P.year })),
        { onConflict: 'id', ignoreDuplicates: true },
    )

    // 10 exam batch — mode jendela +2 jam (sweep aman untuk run ±20 mnt)
    await supabase.from('exams').upsert(EXAMS.map((id, i) => ({
        id, title: 'LT-ULG Ulangan 1000 Siswa', description: 'load test ulangan autosave — jangan dipakai nilai asli',
        start_time: new Date(now - 600e3).toISOString(), duration_minutes: 120,
        window_end_time: new Date(now + 2 * 3600e3).toISOString(),
        teaching_assignment_id: TAS[i], is_active: true, is_randomized: false,
        max_violations: 3, show_results_immediately: true, batch_id: BATCH_ID, created_by: P.guruUser,
    })), { onConflict: 'id', ignoreDuplicates: true })

    // 50 soal × 10 member (insert generik — cleanup by exam_id)
    const qRows = []
    for (let q = 0; q < N_Q; q++) {
        for (const ex of EXAMS) {
            qRows.push({
                exam_id: ex, question_text: `LT-ULG soal ${q + 1}`, question_type: 'MULTIPLE_CHOICE',
                options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 2, order_index: q,
                status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
            })
        }
    }
    for (let i = 0; i < qRows.length; i += 500) {
        const { error } = await supabase.from('exam_questions').insert(qRows.slice(i, i + 500))
        if (error) throw new Error('seed soal: ' + error.message)
    }

    // Verifikasi
    for (const ex of EXAMS) {
        const { count } = await supabase.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', ex)
        if (count !== N_Q) throw new Error(`exam ${ex.slice(0, 8)}: ${count} soal (harus ${N_Q})`)
    }
    console.log(`SEED ULANGAN OK: guru lt_guru_ulg + 10 TA + 10 exam batch (${BATCH_ID.slice(0, 8)}) × 50 soal`)
    console.log(`window: s/d ${new Date(now + 2 * 3600e3).toISOString()}`)
}

async function cleanup() {
    console.log('cleanup fixture ulangan...')
    for (const ex of EXAMS) {
        let from = 0
        const subIds = []
        for (;;) {
            const { data } = await supabase.from('exam_submissions').select('id').eq('exam_id', ex).range(from, from + 999).order('id')
            subIds.push(...(data || []).map(r => r.id))
            if (!data || data.length < 1000) break
            from += 1000
        }
        for (let i = 0; i < subIds.length; i += 100) {
            await supabase.from('exam_answers').delete().in('submission_id', subIds.slice(i, i + 100))
        }
        for (let i = 0; i < subIds.length; i += 100) {
            await supabase.from('exam_submissions').delete().in('id', subIds.slice(i, i + 100))
        }
        await supabase.from('exam_questions').delete().eq('exam_id', ex)
    }
    await supabase.from('exams').delete().in('id', EXAMS)
    await supabase.from('teaching_assignments').delete().in('id', TAS)
    await supabase.from('notifications').delete().eq('user_id', P.guruUser)
    await supabase.from('sessions').delete().eq('token', GURU_TOKEN)
    await supabase.from('teachers').delete().eq('id', P.teacher)
    await supabase.from('users').delete().eq('id', P.guruUser)
    console.log('cleanup ulangan selesai (siswa LT via cleanup_loadtest.cjs)')
}

const phase = process.argv[2] || 'seed'
if (phase === 'seed') seed().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
else if (phase === 'cleanup') cleanup().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
else { console.log('Pemakaian: node seed_ulangan_loadtest.cjs <seed|cleanup>'); process.exit(1) }
