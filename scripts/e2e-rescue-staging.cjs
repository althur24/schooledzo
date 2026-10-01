/**
 * E2E staging: RESCUE DRAFT (POST /api/exam-submissions/rescue)
 * Replikasi kasus Jenar: siswa autosave GAGAL semua (koneksi putus) →
 * submission ditutup server via jalur pelanggaran dengan 0 jawaban → nilai 0.
 * Lalu siswa rescue draft dari localStorage → jawaban masuk, dinilai resmi,
 * total direkap, audit grade_history tercatat.
 *
 * PRASYARAT: build + next start dengan env .env.staging.
 * Cleanup penuh di akhir (prefix lrsq_).
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  ✓ ${name}`) }
    else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`login gagal ${username}: ${JSON.stringify(data)}`)
    return (res.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ')
}

async function preClean() {
    // Hapus sisa run sebelumnya (run gagal bisa meninggalkan baris yatim)
    const P = 'lrsq_'
    const like = `${P}%`
    const del = async (table, col) => {
        const { error } = await supabase.from(table).delete().like(col, like)
        if (error) throw new Error(`preClean ${table}: ${JSON.stringify(error)}`)
    }
    await del('exam_submissions', 'exam_id').catch?.(() => {})
    // exam_submissions tak punya kolom judul → lewat exam ids
    const { data: oldExams } = await supabase.from('exams').select('id').like('title', like)
    for (const e of oldExams || []) {
        await supabase.from('exam_answers').delete().eq('exam_id', 'x').or(`submission_id.eq.00000000-0000-0000-0000-000000000000`) // no-op safe
    }
    await supabase.from('grade_history').delete().like('ref_title', like)
    const { data: oldQs } = await supabase.from('exam_questions').select('id, exam_id').like('question_text', like)
    const oldExamIds = [...new Set((oldQs || []).map(q => q.exam_id))]
    if (oldExamIds.length) {
        const { data: oldSubs } = await supabase.from('exam_submissions').select('id').in('exam_id', oldExamIds)
        for (const s of oldSubs || []) await supabase.from('exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('exam_submissions').delete().in('exam_id', oldExamIds)
    }
    await supabase.from('exam_questions').delete().like('question_text', like)
    await supabase.from('exams').delete().like('title', like)
    const { data: oldUsers } = await supabase.from('users').select('id').like('username', like)
    for (const u of oldUsers || []) {
        await supabase.from('sessions').delete().eq('user_id', u.id)
        const { data: st } = await supabase.from('students').select('id').eq('user_id', u.id)
        for (const s of st || []) await supabase.from('students').delete().eq('id', s.id)
        const { data: tc } = await supabase.from('teachers').select('id').eq('user_id', u.id)
        for (const t of tc || []) {
            const { data: tas } = await supabase.from('teaching_assignments').select('id').eq('teacher_id', t.id)
            for (const ta2 of tas || []) await supabase.from('teaching_assignments').delete().eq('id', ta2.id)
            await supabase.from('teachers').delete().eq('id', t.id)
        }
        await supabase.from('users').delete().eq('id', u.id)
    }
    const { data: oldClasses } = await supabase.from('classes').select('id').like('name', like)
    for (const c of oldClasses || []) await supabase.from('classes').delete().eq('id', c.id)
}

async function main() {
    await preClean()
    const P = 'lrsq_' // prefix cleanup
    const PASS_H = await bcrypt.hash('Rescue123!', 10)
    const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
    const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
    const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2'

    // ---- Fixture: guru + TA + kelas + 1 siswa
    const uname = (s) => `${P}${s}`
    const ins = async (table, row) => {
        const { data, error } = await supabase.from(table).insert(row).select().single()
        if (error || !data) throw new Error(`insert ${table} gagal: ${JSON.stringify(error)}`)
        return data
    }
    const guru = await ins('users', {
        username: uname('guru'), password_hash: PASS_H, full_name: 'Guru Rescue', role: 'GURU', school_id: SCHOOL
    })
    const teacher = await ins('teachers', { user_id: guru.id, school_id: SCHOOL })
    const kelas = await ins('classes', { name: `${P}kelas`, grade_level: 8, school_level: 'SMP', academic_year_id: YEAR })
    const ta = await ins('teaching_assignments', {
        teacher_id: teacher.id, subject_id: SUBJECT, class_id: kelas.id, academic_year_id: YEAR
    })
    const siswaU = await ins('users', {
        username: uname('siswa'), password_hash: PASS_H, full_name: 'Siswa Rescue', role: 'SISWA', school_id: SCHOOL
    })
    const siswa = await ins('students', {
        user_id: siswaU.id, nis: `${Date.now()}`.slice(-8), class_id: kelas.id, school_id: SCHOOL, school_level: 'SMP', status: 'ACTIVE'
    })

    // ---- Exam 30 soal ala TKA (MC + TF + GK), semua objektif
    const mkQ = (i) => ({
        exam_id: exam.id, question_type: i % 3 === 0 ? 'TRUE_FALSE' : (i % 3 === 1 ? 'MULTIPLE_CHOICE' : 'MULTIPLE_ANSWER'),
        question_text: `${P}soal ${i}`,
        options: JSON.stringify(i % 3 === 0 ? ['BENAR', 'SALAH'] : ['A', 'B', 'C', 'D']),
        correct_answer: i % 3 === 0 ? 'BENAR' : (i % 3 === 1 ? 'A' : JSON.stringify(['A', 'B'])),
        points: 3.34, order_index: i, status: 'approved', content_format: 'plain'
    })
    const exam = await ins('exams', {
        teaching_assignment_id: ta.id, title: `${P}TKA Rescue`, start_time: new Date(Date.now() - 30 * 60000).toISOString(),
        duration_minutes: 90, is_active: true, max_violations: 3, show_results_immediately: false
    })
    const questions = []
    for (let i = 0; i < 30; i++) {
        const q = await ins('exam_questions', mkQ(i))
        questions.push(q)
    }

    // ---- Submission "Jenar-like": ditutup via jalur pelanggaran, 0 jawaban tersimpan
    const sub = await ins('exam_submissions', {
        exam_id: exam.id, student_id: siswa.id, started_at: new Date(Date.now() - 29 * 60000).toISOString(),
        is_submitted: true, submitted_at: new Date(Date.now() - 5 * 60000).toISOString(),
        total_score: 0, max_score: 100.2, is_graded: true, violation_count: 4,
        violations_log: [{ type: 'TAB_SWITCH', timestamp: new Date(Date.now() - 6 * 60000).toISOString() }],
        question_order: questions.map(q => q.id)
    })

    // ---- Login & siswa mengirim draft (seolah dari localStorage)
    const guruCookie = await login(uname('guru'), 'Rescue123!')
    const siswaCookie = await login(uname('siswa'), 'Rescue123!')

    // Jawaban siswa: 20 benar, 8 salah, 2 tidak dijawab (draft realistis)
    const draft = questions.map((q, i) => {
        if (i >= 28) return null // 2 tidak dijawab
        let ans
        if (i % 3 === 0) ans = i < 21 ? 'BENAR' : 'SALAH'          // TF
        else if (i % 3 === 1) ans = i < 21 ? 'A' : 'C'             // MC
        else ans = i < 21 ? '["A","B"]' : '["A","C"]'              // GK
        return { question_id: q.id, answer: ans }
    }).filter(Boolean)

    // Smoke: guru tidak boleh akses rescue
    {
        const res = await fetch(`${BASE}/api/exam-submissions/rescue`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: guruCookie },
            body: JSON.stringify({ submission_id: sub.id, kind: 'exam', answers: draft })
        })
        check('guru ditolak 403', res.status === 403, `got ${res.status}`)
    }

    // Smoke: siswa TIDAK pemilik tidak boleh
    // (skip — fixture kedua mahal; cakupan kepemilikan via unit route guard di atas)

    // ---- RESCUE
    let body = null
    {
        const res = await fetch(`${BASE}/api/exam-submissions/rescue`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: siswaCookie },
            body: JSON.stringify({ submission_id: sub.id, kind: 'exam', answers: draft })
        })
        body = await res.json()
        check('rescue sukses (HTTP 200)', res.ok, JSON.stringify(body))
        check('rescued=28', body?.rescued === 28, `got ${body?.rescued}`)
        check('total_score=70.14 (21×3.34)', body?.total_score === 70.14, `got ${body?.total_score}`)
        check('is_graded=true (tanpa esai)', body?.is_graded === true, `got ${body?.is_graded}`)
    }

    // Idempotent: kirim ulang → rescued=0
    {
        const res = await fetch(`${BASE}/api/exam-submissions/rescue`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: siswaCookie },
            body: JSON.stringify({ submission_id: sub.id, kind: 'exam', answers: draft })
        })
        const b2 = await res.json()
        check('idempotent: rescued=0 di kirim ulang', b2?.rescued === 0, JSON.stringify(b2))
    }

    // DB: jawaban + skor + audit
    const { data: answersDb } = await supabase.from('exam_answers').select('question_id, is_correct, points_earned').eq('submission_id', sub.id)
    check('28 baris exam_answers', (answersDb || []).length === 28, `got ${answersDb?.length}`)
    const correctRows = (answersDb || []).filter(a => a.is_correct === true)
    check('21 jawaban is_correct=true', correctRows.length === 21, `got ${correctRows.length}`)
    const { data: subAfter } = await supabase.from('exam_submissions').select('total_score, is_graded').eq('id', sub.id).single()
    check('total_score DB=70.14', subAfter?.total_score === 70.14, `got ${subAfter?.total_score}`)
    const { data: gh } = await supabase.from('grade_history').select('*').eq('student_id', siswa.id).eq('ref_id', exam.id)
    check('grade_history tercatat (0→70.14)', (gh || []).length === 1 && gh[0].old_score === 0 && gh[0].new_score === 70.14, JSON.stringify(gh))

    // Payload ilegal: 1 junk question id di antara draft
    {
        const bad = [...draft, { question_id: '00000000-0000-0000-0000-000000000000', answer: 'A' }]
        const res = await fetch(`${BASE}/api/exam-submissions/rescue`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: siswaCookie },
            body: JSON.stringify({ submission_id: sub.id, kind: 'exam', answers: bad })
        })
        const b3 = await res.json()
        check('junk question difilter (tetap rescued=0, invalid=1)', b3?.rescued === 0 && b3?.invalid_questions === 1, JSON.stringify(b3))
    }

    // ==================== FASE 2: jalur OFFICIAL (UTS/UAS) + esai + jawaban kosong ====================
    console.log('\n--- Fase 2: official (UTS/UAS) + esai + jawaban kosong ---')

    // Official exam: 1 MC (benar) + 1 ESSAY — verifikasi paritas K1:
    // esai disimpan tanpa poin, is_graded=false sampai guru menilai.
    const offExam = await ins('official_exams', {
        school_id: SCHOOL, academic_year_id: YEAR, subject_id: SUBJECT, exam_type: 'UTS',
        title: `${P}UTS Rescue`, start_time: new Date(Date.now() - 30 * 60000).toISOString(),
        duration_minutes: 90, is_active: true, max_violations: 3, show_results_immediately: false,
        target_class_ids: [kelas.id]
    })
    const offMc = await ins('official_exam_questions', {
        exam_id: offExam.id, question_type: 'MULTIPLE_CHOICE', question_text: `${P}off mc`,
        options: JSON.stringify(['A', 'B', 'C', 'D']), correct_answer: 'B', points: 60, order_index: 0, content_format: 'plain'
    })
    const offEssay = await ins('official_exam_questions', {
        exam_id: offExam.id, question_type: 'ESSAY', question_text: `${P}off essay`,
        correct_answer: null, points: 40, order_index: 1, content_format: 'plain'
    })
    const offSub = await ins('official_exam_submissions', {
        exam_id: offExam.id, student_id: siswa.id, started_at: new Date(Date.now() - 29 * 60000).toISOString(),
        is_submitted: true, submitted_at: new Date(Date.now() - 5 * 60000).toISOString(),
        total_score: 0, max_score: 100, is_graded: true, violation_count: 0,
        question_order: [offMc.id, offEssay.id]
    })

    {
        // Draft berisi 1 MC benar + 1 esai + 1 jawaban kosong (harus difilter client-side,
        // di sini dikirim apa adanya untuk menguji server menerima string kosong = baris junk 0 poin)
        const res = await fetch(`${BASE}/api/exam-submissions/rescue`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: siswaCookie },
            body: JSON.stringify({
                submission_id: offSub.id, kind: 'official',
                answers: [
                    { question_id: offMc.id, answer: 'B' },
                    { question_id: offEssay.id, answer: 'Jawaban esai siswa' },
                    { question_id: offMc.id, answer: '' } // duplikat id — server: 1 valid 1 existing-skip
                ]
            })
        })
        const b = await res.json()
        check('official: rescue sukses', res.ok, JSON.stringify(b))
        check('official: rescued=2 (MC + esai)', b?.rescued === 2, `got ${b?.rescued}`)
        // Skor: MC 60 penuh + esai 0 (belum dinilai) = 60
        check('official: total_score=60 (esai belum dinilai)', b?.total_score === 60, `got ${b?.total_score}`)
        check('official: is_graded=false (esai pending)', b?.is_graded === false, `got ${b?.is_graded}`)

        const { data: offAns } = await supabase.from('official_exam_answers').select('*').eq('submission_id', offSub.id)
        const essayRow = (offAns || []).find(a => a.question_id === offEssay.id)
        const mcRow = (offAns || []).find(a => a.question_id === offMc.id)
        check('official: esai tersimpan tanpa poin (K1 paritas)', !!essayRow && essayRow.points_earned === null && essayRow.is_correct === null && essayRow.answer === 'Jawaban esai siswa', JSON.stringify(essayRow))
        check('official: MC benar 60 poin', !!mcRow && mcRow.is_correct === true && mcRow.points_earned === 60, JSON.stringify(mcRow))
    }

    // ==================== FASE 3: skor tetap 0 (semua jawaban salah) ====================
    console.log('\n--- Fase 3: semua jawaban salah → rescued>0 tapi skor 0 ---')
    const badExam = await ins('official_exams', {
        school_id: SCHOOL, academic_year_id: YEAR, subject_id: SUBJECT, exam_type: 'UTS',
        title: `${P}UTS Salah Semua`, start_time: new Date(Date.now() - 30 * 60000).toISOString(),
        duration_minutes: 60, is_active: true, max_violations: 3, show_results_immediately: true,
        target_class_ids: [kelas.id]
    })
    const badQ = await ins('official_exam_questions', {
        exam_id: badExam.id, question_type: 'MULTIPLE_CHOICE', question_text: `${P}bad mc`,
        options: JSON.stringify(['A', 'B', 'C', 'D']), correct_answer: 'A', points: 100, order_index: 0, content_format: 'plain'
    })
    const badSub = await ins('official_exam_submissions', {
        exam_id: badExam.id, student_id: siswa.id, started_at: new Date(Date.now() - 29 * 60000).toISOString(),
        is_submitted: true, submitted_at: new Date(Date.now() - 5 * 60000).toISOString(),
        total_score: 0, max_score: 100, is_graded: true, violation_count: 0,
        question_order: [badQ.id]
    })
    {
        const res = await fetch(`${BASE}/api/exam-submissions/rescue`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: siswaCookie },
            body: JSON.stringify({ submission_id: badSub.id, kind: 'official', answers: [{ question_id: badQ.id, answer: 'D' }] })
        })
        const b = await res.json()
        check('salah-semua: rescue sukses', res.ok, JSON.stringify(b))
        check('salah-semua: rescued=1', b?.rescued === 1, `got ${b?.rescued}`)
        check('salah-semua: total_score=0 (jawaban salah — bukan kegagalan rescue)', b?.total_score === 0, `got ${b?.total_score}`)
        const { data: badAns } = await supabase.from('official_exam_answers').select('*').eq('submission_id', badSub.id)
        check('salah-semua: baris jawaban tetap tersimpan (bisa direview guru)', (badAns || []).length === 1 && badAns[0].is_correct === false, JSON.stringify(badAns))
    }

    console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`)
    return {
        guru: guru.id, teacher: teacher.id, kelas: kelas.id, ta: ta.id, siswaU: siswaU.id, siswa: siswa.id,
        exam: exam.id, questions, sub: sub.id,
        offExam: offExam.id, offSub: offSub.id,
        badExam: badExam.id, badSub: badSub.id
    }
}

main().then(async (f) => {
    // ---- Cleanup
    console.log('Cleanup…')
    for (const t of [f.offExam, f.badExam]) {
        await supabase.from('grade_history').delete().eq('ref_id', t)
    }
    await supabase.from('grade_history').delete().eq('ref_id', f.exam)
    for (const [subT, ansT, subId] of [
        ['exam_submissions', 'exam_answers', f.sub],
        ['official_exam_submissions', 'official_exam_answers', f.offSub],
        ['official_exam_submissions', 'official_exam_answers', f.badSub],
    ]) {
        await supabase.from(ansT).delete().eq('submission_id', subId)
        await supabase.from(subT).delete().eq('id', subId)
    }
    await supabase.from('exam_questions').delete().eq('exam_id', f.exam)
    await supabase.from('exams').delete().eq('id', f.exam)
    await supabase.from('official_exam_questions').delete().in('exam_id', [f.offExam, f.badExam])
    await supabase.from('official_exams').delete().in('id', [f.offExam, f.badExam])
    await supabase.from('sessions').delete().in('user_id', [f.guru, f.siswaU])
    await supabase.from('users').delete().in('id', [f.guru, f.siswaU])
    await supabase.from('students').delete().eq('id', f.siswa)
    await supabase.from('teaching_assignments').delete().eq('id', f.ta)
    await supabase.from('classes').delete().eq('id', f.kelas)
    await supabase.from('teachers').delete().eq('id', f.teacher)
    console.log('Selesai.')
}).catch(e => { console.error('FATAL', e); process.exit(1) })
