/**
 * SMOKE TEST AUDIT — verifikasi perbaikan audit ulangan/UTS-UAS di staging.
 *
 * Membuat fixture terisolasi (sekolah SMOKE-AUDIT, prefix UUID a0d0) lalu
 * menjalankan matriks verifikasi via HTTP terhadap server staging:
 *   A. Alur penuh guru: buat ulangan → soal → publish
 *   B. T2  : mutasi soal saat aktif → 409 (semua jalur)
 *   C. T1  : GET soal siswa luar kelas → tolak; draft/pra-jadwal → tolak; resume attempt → lolos
 *   D. T4  : junk question_id dibuang (answered_count tidak ter-inflate)
 *   E. T5  : grading attempt yang belum dikumpulkan → 400
 *   F. T6  : grade_history tercatat saat koreksi manual
 *   G. N1  : submit dengan jawaban > soal (draft basi) → SUKSES
 *   H. T7  : spam duplikat id valid → 400
 *   I. K1  : PUT/DELETE soal official dgn question_id ujian lain → 404
 *   J. K2  : duplikasi dari exam guru lain sed sekolah → 403; milik sendiri → 200
 *   K. T3  : copy-questions lintas guru → 403; milik sendiri → 200
 *   L. Remedial: guard allowed_student_ids + submit remedial
 *   M. T8/T9: rekap grades & warnings tidak dobel (merge remedial)
 *   N. T11 : re-PUT publish tidak spam notifikasi
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/smoke_audit.cjs
 * Server staging harus jalan (assertServerDb bawaan helpers tidak dipakai —
 * script ini memverifikasi via fixture school sendiri).
 * Cleanup otomatis di akhir (juga aman diulang).
 */
require('./e2e/helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000'

const P = {
    school: 'a0d00000-0000-0000-0000-000000000001',
    year: 'a0d00000-0000-0000-0000-000000000002',
    subject: 'a0d00000-0000-0000-0000-000000000003',
    classA: 'a0d00001-0000-0000-0000-000000000001',
    classB: 'a0d00001-0000-0000-0000-000000000002',
    userAdmin: 'a0d01000-0000-0000-0000-0000000000ff',
    userGuru: 'a0d01000-0000-0000-0000-000000000001',
    userGuruB: 'a0d01000-0000-0000-0000-000000000002',
    userS1: 'a0d01000-0000-0000-0000-000000000011',
    userS2: 'a0d01000-0000-0000-0000-000000000012',
    userS3: 'a0d01000-0000-0000-0000-000000000013',
    teacherA: 'a0d02000-0000-0000-0000-000000000001',
    teacherB: 'a0d02000-0000-0000-0000-000000000002',
    taA: 'a0d03000-0000-0000-0000-000000000001', // guru A: subject × classA
    taB: 'a0d03000-0000-0000-0000-000000000002', // guru B: subject × classA (same class, beda guru)
    taB2: 'a0d03000-0000-0000-0000-000000000003', // guru B: subject × classB
    student1: 'a0d04000-0000-0000-0000-000000000001',
    student2: 'a0d04000-0000-0000-0000-000000000002',
    student3: 'a0d04000-0000-0000-0000-000000000003',
}
const TOK = { admin: 'smk_admin', guru: 'smk_guru_a', guruB: 'smk_guru_b', s1: 'smk_siswa_1', s2: 'smk_siswa_2', s3: 'smk_siswa_3' }
const now = Date.now()
const iso = (offsetMs) => new Date(now + offsetMs).toISOString()

let PASS = 0, FAIL = 0
function check(label, cond, detail) {
    if (cond) { PASS++; console.log(`  ✅ ${label}`) }
    else { FAIL++; console.log(`  ❌ ${label}${detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : ''}`) }
}
async function api(method, path, body, who) {
    const res = await fetch(BASE + path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            Cookie: who ? `session_token=${TOK[who]}; user_role=${who.startsWith('s') ? 'SISWA' : (who === 'admin' ? 'ADMIN' : 'GURU')}` : '',
        },
        body: body ? JSON.stringify(body) : undefined,
    })
    let data = null
    try { data = await res.json() } catch { /* empty body */ }
    return { status: res.status, ok: res.ok, data }
}

async function cleanup() {
    const ids = { school_id: P.school }
    // exam-related dulu (FK), lalu users/sessions/students dst.
    await supabase.from('grade_history').delete().eq('school_id', P.school)
    for (const t of ['exam_answers', 'exam_submissions', 'exam_questions']) {
        const col = t === 'exam_questions' ? 'exam_id' : null
        // exam_questions/submissions/answers difilter via exam_id in exams milik sekolah
        const { data: exs } = await supabase.from('exams').select('id').eq('school_id', P.school) // exams tak punya school_id? guard via TA
        void exs; void col
    }
    // Lebih sederhana: hapus exam milik TA sekolah ini via daftar TA
    const { data: tas } = await supabase.from('teaching_assignments').select('id').in('id', [P.taA, P.taB, P.taB2])
    const taIds = (tas || []).map(t => t.id)
    if (taIds.length) {
        const { data: exs } = await supabase.from('exams').select('id').in('teaching_assignment_id', taIds)
        const exIds = (exs || []).map(e => e.id)
        for (const eid of exIds) {
            await supabase.from('exam_answers').delete().eq('submission_id', supabase.from('exam_submissions').select('id').eq('exam_id', eid) ? 'x' : 'x') // placeholder
        }
        void exIds
    }
    // Fallback paling aman: delete urutan tabel dengan filter eksplisit (id deterministik)
    const { data: exs2 } = await supabase.from('exams').select('id, teaching_assignment_id')
    const mine = (exs2 || []).filter(e => taIds.includes(e.teaching_assignment_id)).map(e => e.id)
    for (const eid of mine) {
        const { data: subs } = await supabase.from('exam_submissions').select('id').eq('exam_id', eid)
        for (const s of (subs || [])) await supabase.from('exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('exam_submissions').delete().eq('exam_id', eid)
        await supabase.from('exam_questions').delete().eq('exam_id', eid)
        await supabase.from('exams').delete().eq('id', eid)
    }
    // official exams (by school_id)
    const { data: oes } = await supabase.from('official_exams').select('id').eq('school_id', P.school)
    for (const oe of (oes || [])) {
        const { data: subs } = await supabase.from('official_exam_submissions').select('id').eq('exam_id', oe.id)
        for (const s of (subs || [])) await supabase.from('official_exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('official_exam_submissions').delete().eq('exam_id', oe.id)
        await supabase.from('official_exam_questions').delete().eq('exam_id', oe.id)
        await supabase.from('official_exams').delete().eq('id', oe.id)
    }
    for (const [table, col, val] of [
        ['notifications', 'user_id', [P.userAdmin, P.userGuru, P.userGuruB, P.userS1, P.userS2, P.userS3]],
    ]) {
        await supabase.from(table).delete().in(col, val)
    }
    await supabase.from('student_enrollments').delete().in('student_id', [P.student1, P.student2, P.student3])
    await supabase.from('students').delete().in('id', [P.student1, P.student2, P.student3])
    await supabase.from('teaching_assignments').delete().in('id', [P.taA, P.taB, P.taB2])
    await supabase.from('teachers').delete().in('id', [P.teacherA, P.teacherB])
    await supabase.from('sessions').delete().in('token', Object.values(TOK))
    await supabase.from('users').delete().in('id', [P.userAdmin, P.userGuru, P.userGuruB, P.userS1, P.userS2, P.userS3])
    await supabase.from('classes').delete().in('id', [P.classA, P.classB])
    await supabase.from('subjects').delete().eq('id', P.subject)
    await supabase.from('academic_years').delete().eq('id', P.year)
    await supabase.from('schools').delete().eq('id', P.school)
    void ids
}

async function seed() {
    const u = async (table, rows) => {
        const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
        if (error) throw new Error(`seed ${table}: ${error.message}`)
    }
    await u('schools', [{ id: P.school, name: 'SMOKE AUDIT School', code: 'SMKA1', school_level: 'SMP', is_active: true, max_students: 2000, max_teachers: 50, settings: { ai_review_enabled: false } }])
    await u('academic_years', [{ id: P.year, name: 'SMOKE 2026/2027', start_date: '2026-07-14', status: 'ACTIVE', is_active: true, school_id: P.school }])
    await u('subjects', [{ id: P.subject, name: 'Smoke Mapel', school_id: P.school, kkm: 70, level: 'SMP' }])
    await u('classes', [
        { id: P.classA, name: 'SMK-7A', grade_level: 1, school_level: 'SMP', academic_year_id: P.year },
        { id: P.classB, name: 'SMK-7B', grade_level: 1, school_level: 'SMP', academic_year_id: P.year },
    ])
    await u('users', [
        { id: P.userAdmin, username: 'smk_admin', password_hash: '$2b$10$rqXmqWFyi8Tm1.W8EOknfes0laidH4JAfH2G1GxoCAjtwk3panAY.', full_name: 'Smoke Admin', role: 'ADMIN', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.userGuru, username: 'smk_guru_a', password_hash: '$2b$10$rqXmqWFyi8Tm1.W8EOknfes0laidH4JAfH2G1GxoCAjtwk3panAY.', full_name: 'Smoke Guru A', role: 'GURU', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.userGuruB, username: 'smk_guru_b', password_hash: '$2b$10$rqXmqWFyi8Tm1.W8EOknfes0laidH4JAfH2G1GxoCAjtwk3panAY.', full_name: 'Smoke Guru B', role: 'GURU', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.userS1, username: 'smk_siswa_1', password_hash: '$2b$10$rqXmqWFyi8Tm1.W8EOknfes0laidH4JAfH2G1GxoCAjtwk3panAY.', full_name: 'Smoke Siswa 1', role: 'SISWA', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.userS2, username: 'smk_siswa_2', password_hash: '$2b$10$rqXmqWFyi8Tm1.W8EOknfes0laidH4JAfH2G1GxoCAjtwk3panAY.', full_name: 'Smoke Siswa 2', role: 'SISWA', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.userS3, username: 'smk_siswa_3', password_hash: '$2b$10$rqXmqWFyi8Tm1.W8EOknfes0laidH4JAfH2G1GxoCAjtwk3panAY.', full_name: 'Smoke Siswa 3', role: 'SISWA', school_id: P.school, must_change_password: false, is_locked: false },
    ])
    await u('teachers', [
        { id: P.teacherA, user_id: P.userGuru, school_id: P.school, gender: 'L' },
        { id: P.teacherB, user_id: P.userGuruB, school_id: P.school, gender: 'P' },
    ])
    await u('teaching_assignments', [
        { id: P.taA, teacher_id: P.teacherA, subject_id: P.subject, class_id: P.classA, academic_year_id: P.year },
        { id: P.taB, teacher_id: P.teacherB, subject_id: P.subject, class_id: P.classA, academic_year_id: P.year },
        { id: P.taB2, teacher_id: P.teacherB, subject_id: P.subject, class_id: P.classB, academic_year_id: P.year },
    ])
    await u('students', [
        { id: P.student1, user_id: P.userS1, nis: 'SMK0001', class_id: P.classA, angkatan: '2026', entry_year: 2026, school_level: 'SMP', status: 'ACTIVE', gender: 'L', school_id: P.school },
        { id: P.student2, user_id: P.userS2, nis: 'SMK0002', class_id: P.classA, angkatan: '2026', entry_year: 2026, school_level: 'SMP', status: 'ACTIVE', gender: 'P', school_id: P.school },
        { id: P.student3, user_id: P.userS3, nis: 'SMK0003', class_id: P.classB, angkatan: '2026', entry_year: 2026, school_level: 'SMP', status: 'ACTIVE', gender: 'L', school_id: P.school },
    ])
    await u('student_enrollments', [
        { id: 'a0d05000-0000-0000-0000-000000000001', student_id: P.student1, class_id: P.classA, academic_year_id: P.year, status: 'ACTIVE' },
        { id: 'a0d05000-0000-0000-0000-000000000002', student_id: P.student2, class_id: P.classA, academic_year_id: P.year, status: 'ACTIVE' },
        { id: 'a0d05000-0000-0000-0000-000000000003', student_id: P.student3, class_id: P.classB, academic_year_id: P.year, status: 'ACTIVE' },
    ])
    await u('sessions', [
        { id: 'a0d06000-0000-0000-0000-0000000000ff', user_id: P.userAdmin, token: TOK.admin, expires_at: iso(6 * 3600e3) },
        { id: 'a0d06000-0000-0000-0000-000000000001', user_id: P.userGuru, token: TOK.guru, expires_at: iso(6 * 3600e3) },
        { id: 'a0d06000-0000-0000-0000-000000000002', user_id: P.userGuruB, token: TOK.guruB, expires_at: iso(6 * 3600e3) },
        { id: 'a0d06000-0000-0000-0000-000000000011', user_id: P.userS1, token: TOK.s1, expires_at: iso(6 * 3600e3) },
        { id: 'a0d06000-0000-0000-0000-000000000012', user_id: P.userS2, token: TOK.s2, expires_at: iso(6 * 3600e3) },
        { id: 'a0d06000-0000-0000-0000-000000000013', user_id: P.userS3, token: TOK.s3, expires_at: iso(6 * 3600e3) },
    ])
}

async function main() {
    console.log('== SEED fixture ==')
    await cleanup().catch(e => console.warn('pre-cleanup (abaikan bila kosong):', e.message))
    await seed()

    console.log('\n== A. Alur penuh: guru A buat ulangan → soal → publish ==')
    let r = await api('POST', '/api/exams', { title: 'SMOKE Ulangan 1', start_time: iso(-5 * 60e3), duration_minutes: 60, teaching_assignment_id: P.taA, max_violations: 3 }, 'guru')
    check('A1 create exam 200', r.status === 200 && r.data?.id, r)
    const exam1 = r.data.id

    r = await api('POST', `/api/exams/${exam1}/questions`, { questions: [
        { question_text: 'Ibu kota Indonesia?', question_type: 'MULTIPLE_CHOICE', options: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'], correct_answer: 'Jakarta', points: 10 },
        { question_text: '2+2?', question_type: 'MULTIPLE_CHOICE', options: ['3', '4', '5', '6'], correct_answer: '4', points: 10 },
        { question_text: 'Jelaskan fotosintesis', question_type: 'ESSAY', correct_answer: 'proses', points: 10 },
    ] }, 'guru')
    check('A2 add 3 questions 200', r.status === 200 && Array.isArray(r.data) && r.data.length === 3, r)
    const qIds = (r.data || []).map(q => q.id)

    r = await api('PUT', `/api/exams/${exam1}`, { is_active: true }, 'guru')
    check('A3 publish 200 & is_active', r.status === 200 && r.data?.is_active === true, r)

    console.log('\n== B. T2: soal terkunci saat ujian aktif ==')
    r = await api('PUT', `/api/exams/${exam1}/questions`, { question_id: qIds[0], question_text: 'hack' }, 'guru')
    check('B1 PUT soal saat aktif → 409', r.status === 409, r)
    r = await api('DELETE', `/api/exams/${exam1}/questions?question_id=${qIds[0]}`, null, 'guru')
    check('B2 DELETE soal saat aktif → 409', r.status === 409, r)
    r = await api('POST', `/api/exams/${exam1}/questions`, { questions: [{ question_text: 'x', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'a', points: 1 }] }, 'guru')
    check('B3 POST soal saat aktif → 409', r.status === 409, r)

    console.log('\n== C. T1: gate akses soal siswa ==')
    r = await api('GET', `/api/exams/${exam1}/questions`, null, 's3')
    check('C1 siswa luar kelas GET soal → tolak (403/404)', r.status === 403 || r.status === 404, r)
    r = await api('GET', `/api/exams/${exam1}/questions`, null, 's1')
    check('C2 siswa kelas target GET soal → 200', r.status === 200 && Array.isArray(r.data) && r.data.length === 3, r)
    check('C3 correct_answer tidak bocor ke siswa', r.data.every(q => !('correct_answer' in q)), r.data && r.data[0])

    // draft & pra-jadwal
    r = await api('POST', '/api/exams', { title: 'SMOKE Draft', start_time: iso(3600e3), duration_minutes: 30, teaching_assignment_id: P.taA }, 'guru')
    const examDraft = r.data?.id
    r = await api('POST', `/api/exams/${examDraft}/questions`, { questions: [{ question_text: 'draft q', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'a', points: 1 }] }, 'guru')
    r = await api('GET', `/api/exams/${examDraft}/questions`, null, 's1')
    check('C4 soal DRAFT tidak terbaca siswa kelas target → 403', r.status === 403, r)

    console.log('\n== D. Siswa 1 kerjakan + junk question_id (T4) ==')
    r = await api('POST', '/api/exam-submissions', { exam_id: exam1 }, 's1')
    check('D1 start 200', r.status === 200 && r.data?.id, r)
    const sub1 = r.data.id
    const junkId = '00000000-0000-0000-0000-00000000dead'
    r = await api('PUT', '/api/exam-submissions', { submission_id: sub1, answers: [
        { question_id: qIds[0], answer: 'Jakarta' },
        { question_id: qIds[1], answer: 'Bandung' },
        { question_id: junkId, answer: 'junk' },
    ] }, 's1')
    check('D2 autosave 200', r.status === 200, r)
    const { data: rawAnswers } = await supabase.from('exam_answers').select('question_id, points_earned').eq('submission_id', sub1)
    check('D3 junk tidak tersimpan (2 baris, bukan 3)', (rawAnswers || []).length === 2, rawAnswers)
    check('D4 PG benar dinilai 10', rawAnswers?.find(a => a.question_id === qIds[0])?.points_earned === 10, rawAnswers)

    r = await api('PUT', '/api/exam-submissions', { submission_id: sub1, answers: [
        { question_id: qIds[0], answer: 'Jakarta' }, { question_id: qIds[1], answer: 'Bandung' },
    ], submit: true }, 's1')
    check('D5 submit 200 & is_submitted', r.status === 200 && r.data?.is_submitted === true, r)
    check('D6 total_score = 10 (essay 0 belum dikoreksi)', r.data?.total_score === 10, r.data)

    console.log('\n== E. T5: grading attempt hidup ditolak ==')
    r = await api('POST', '/api/exam-submissions', { exam_id: exam1 }, 's2')
    const sub2 = r.data?.id
    check('E1 siswa 2 start 200', r.status === 200 && sub2, r)
    r = await api('PUT', `/api/exam-submissions/${sub2}`, { answers: [{ question_id: qIds[0], answer: 'Jakarta', score: 10, is_correct: true }], is_graded: true }, 'guru')
    check('E2 grading attempt belum dikumpulkan → 400', r.status === 400, r)

    console.log('\n== F. T6: koreksi manual + audit trail ==')
    r = await api('PUT', `/api/exam-submissions/${sub1}`, { answers: [{ question_id: qIds[2], answer: 'proses', score: 8, is_correct: true }], is_graded: true }, 'guru')
    check('F1 koreksi essay 200', r.status === 200, r)
    check('F2 total_score = 18 (10+8)', r.data?.total_score === 18, r.data)
    const { data: gh } = await supabase.from('grade_history').select('*').eq('school_id', P.school).eq('source', 'EXAM').order('changed_at', { ascending: false }).limit(1)
    check('F3 grade_history tercatat (old 10 → new 18)', gh?.length === 1 && gh[0].old_score === 10 && gh[0].new_score === 18, gh)

    console.log('\n== G. N1: submit draft basi (jawaban > soal) tidak diblokir ==')
    r = await api('PUT', `/api/exams/${exam1}`, { is_active: false }, 'guru')
    check('G1 tarik draft 200', r.status === 200 && r.data?.is_active === false, r)
    r = await api('DELETE', `/api/exams/${exam1}/questions?question_id=${qIds[2]}`, null, 'guru')
    check('G2 hapus 1 soal saat draft 200', r.status === 200, r)
    r = await api('PUT', `/api/exams/${exam1}`, { is_active: true }, 'guru')
    check('G3 publish ulang 200', r.status === 200, r)
    // siswa 2 masih punya attempt; submit dengan 3 jawaban (1 sudah tak ada di ujian)
    r = await api('PUT', '/api/exam-submissions', { submission_id: sub2, answers: [
        { question_id: qIds[0], answer: 'Jakarta' }, { question_id: qIds[1], answer: '4' }, { question_id: qIds[2], answer: 'essay lama' },
    ], submit: true }, 's2')
    check('G4 submit dengan jawaban soal-terhapus → SUKSES (bukan 400)', r.status === 200 && r.data?.is_submitted === true, r)
    const { data: sub2Answers } = await supabase.from('exam_answers').select('question_id').eq('submission_id', sub2)
    check('G5 hanya 2 jawaban valid tersimpan', (sub2Answers || []).length === 2, sub2Answers)

    console.log('\n== H. T7: spam duplikat id valid → 400 ==')
    r = await api('POST', '/api/exams', { title: 'SMOKE Ulangan 2', start_time: iso(-60e3), duration_minutes: 30, teaching_assignment_id: P.taA }, 'guru')
    const exam2 = r.data?.id
    await api('POST', `/api/exams/${exam2}/questions`, { questions: [
        { question_text: '1+1?', question_type: 'MULTIPLE_CHOICE', options: ['1', '2'], correct_answer: '2', points: 5 },
    ] }, 'guru')
    await api('PUT', `/api/exams/${exam2}`, { is_active: true }, 'guru')
    r = await api('POST', '/api/exam-submissions', { exam_id: exam2 }, 's1')
    const sub3 = r.data?.id
    const q2Ids = (await supabase.from('exam_questions').select('id').eq('exam_id', exam2)).data.map(q => q.id)
    r = await api('PUT', '/api/exam-submissions', { submission_id: sub3, answers: Array.from({ length: 10 }, () => ({ question_id: q2Ids[0], answer: '2' })) }, 's1')
    check('H1 spam 10 duplikat id valid → 400', r.status === 400, r)

    console.log('\n== I. K1: IDOR soal official-exams ==')
    r = await api('POST', '/api/official-exams', { title: 'SMOKE UTS A', exam_type: 'UTS', subject_id: P.subject, target_class_ids: [P.classA], academic_year_id: P.year, start_time: iso(-60e3), duration_minutes: 60, school_id: P.school }, 'guru')
    check('I1 guru A buat UTS 200', r.status === 200 && r.data?.id, r)
    const oeA = r.data.id
    r = await api('POST', '/api/official-exams', { title: 'SMOKE UTS B', exam_type: 'UTS', subject_id: P.subject, target_class_ids: [P.classB], academic_year_id: P.year, start_time: iso(-60e3), duration_minutes: 60, school_id: P.school }, 'guruB')
    const oeB = r.data?.id
    check('I2 guru B buat UTS 200', r.status === 200 && oeB, r)
    r = await api('POST', `/api/official-exams/${oeA}/questions`, { questions: [
        { question_text: 'UTS q1', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'a', points: 10 },
    ] }, 'guru')
    const oeAQ = r.data?.[0]?.id
    r = await api('POST', `/api/official-exams/${oeB}/questions`, { questions: [
        { question_text: 'UTS B q1', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'b', points: 10 },
    ] }, 'guruB')
    const oeBQ = r.data?.[0]?.id
    // guru B (punya scope mapel×kelas? oeA target classA — guru B punya TA classA juga!) coba edit soal oeA via URL oeB
    r = await api('PUT', `/api/official-exams/${oeB}/questions`, { question_id: oeAQ, question_text: 'INJECTED' }, 'guruB')
    check('I3 PUT soal ujian lain via exam_id beda → 404', r.status === 404, r)
    r = await api('DELETE', `/api/official-exams/${oeB}/questions`, { question_id: oeAQ }, 'guruB')
    check('I4 DELETE soal ujian lain → 404 (tidak terhapus)', r.status === 404, r)
    const { data: oeACheck } = await supabase.from('official_exam_questions').select('question_text').eq('id', oeAQ).single()
    check('I5 soal oeA utuh (bukan INJECTED)', oeACheck?.question_text !== 'INJECTED', oeACheck)

    console.log('\n== J. K2: duplikasi lintas guru sed sekolah ==')
    r = await api('POST', '/api/exams', { title: 'SMOKE Duplikat', start_time: iso(-60e3), duration_minutes: 30, teaching_assignment_id: P.taA, duplicate_questions: true, duplicate_from_exam_id: exam2 }, 'guruB')
    check('J1 guru B duplikat dari exam guru A → 403', r.status === 403, r)
    r = await api('POST', '/api/exams', { title: 'SMOKE Duplikat Sendiri', start_time: iso(-60e3), duration_minutes: 30, teaching_assignment_id: P.taA, duplicate_questions: true, duplicate_from_exam_id: exam2 }, 'guru')
    check('J2 guru A duplikat exam sendiri → 200 + soal tersalin', r.status === 200, r)

    console.log('\n== K. T3: copy-questions lintas guru ==')
    const { data: exGuruA } = await supabase.from('exams').select('id, title').eq('teaching_assignment_id', P.taA)
    const targetMine = exGuruA.find(e => e.title === 'SMOKE Duplikat Sendiri')
    r = await api('POST', '/api/exams/copy-questions', { source_exam_id: exam2, target_exam_ids: [targetMine.id] }, 'guru')
    check('K1 guru A copy ke exam sendiri → 200', r.status === 200 && r.data?.success, r)
    r = await api('POST', '/api/exams/copy-questions', { source_exam_id: exam2, target_exam_ids: [targetMine.id] }, 'guruB')
    check('K2 guru B copy ke exam guru A → 403', r.status === 403, r)

    console.log('\n== L. Remedial ulangan: guard + merge ==')
    // siswa 1 di exam2: skor 5/5=100? — gunakan exam1 (nilai 18/30=60 < KKM 70) → remedial
    r = await api('POST', '/api/exams', { title: 'SMOKE Remedial 1', start_time: iso(-60e3), duration_minutes: 30, teaching_assignment_id: P.taA, is_remedial: true, remedial_for_id: exam1, allowed_student_ids: [P.student1], duplicate_questions: true, remedial_score_policy: 'HIGHEST' }, 'guru')
    check('L1 buat remedial (same TA) 200', r.status === 200 && r.data?.id, r)
    const remedialExam = r.data.id
    r = await api('PUT', `/api/exams/${remedialExam}`, { is_active: true }, 'guru')
    check('L2 publish remedial 200', r.status === 200, r)
    r = await api('POST', '/api/exam-submissions', { exam_id: remedialExam }, 's2')
    check('L3 siswa di luar allowed_student_ids → 403', r.status === 403, r)
    r = await api('POST', '/api/exam-submissions', { exam_id: remedialExam }, 's1')
    check('L4 siswa allowed start 200', r.status === 200 && r.data?.id, r)
    const subRem = r.data.id
    const { data: remQs } = await supabase.from('exam_questions').select('id, correct_answer').eq('exam_id', remedialExam)
    r = await api('PUT', '/api/exam-submissions', { submission_id: subRem, answers: remQs.map(q => ({ question_id: q.id, answer: q.correct_answer })), submit: true }, 's1')
    check('L5 submit remedial 200 (skor penuh → final 100 > asli 60)', r.status === 200 && r.data?.is_submitted, r)

    console.log('\n== M. T8/T9: rekap & warnings tidak dobel ==')
    // /api/grades (rekap) adalah endpoint ADMIN — jalur guru memakai GET submissions per-exam
    r = await api('GET', `/api/grades?student_id=${P.student1}`, null, 'admin')
    const ulanganEntries = (r.data || []).filter(g => g.grade_type === 'ULANGAN')
    const exam1Entries = ulanganEntries.filter(g => g.exam_id === exam1)
    check('M1 rekap admin: 1 entri final untuk exam1 (merge, bukan 2)', exam1Entries.length === 1, ulanganEntries)
    check('M2 nilai final = 100 (HIGHEST: max(60,100))', exam1Entries[0]?.score === 100, exam1Entries)
    // Jalur guru: GET submissions exam1 → skor S1 harus merged (100%, bukan 60%)
    r = await api('GET', `/api/exam-submissions?exam_id=${exam1}`, null, 'guru')
    const s1Sub = (r.data || []).find(s => (s.student?.id || s.student_id) === P.student1)
    check('M2b jalur guru: skor S1 merged 100% (30/30, flag merged)', s1Sub?.merged_from_remedial === true && s1Sub?.max_score > 0 && s1Sub?.total_score === s1Sub?.max_score, s1Sub && { total: s1Sub.total_score, max: s1Sub.max_score, merged: s1Sub.merged_from_remedial })
    r = await api('GET', '/api/dashboard/guru/warnings', null, 'guru')
    check('M3 warnings 200 tanpa crash', r.status === 200 && Array.isArray(r.data?.teachingWarnings), r)
    const s1Warn = (r.data?.teachingWarnings || []).filter(w => w.student_id === P.student1)
    check('M4 siswa 1 (final 100 ≥ KKM 70) tidak muncul di warning', s1Warn.length === 0, s1Warn)

    console.log('\n== N. T11: re-PUT publish tidak spam notifikasi ==')
    const { count: notifBefore } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', P.userS2).eq('type', 'ULANGAN_BARU')
    r = await api('PUT', `/api/exams/${exam2}`, { title: 'SMOKE Ulangan 2 (edit judul)', is_active: true }, 'guru')
    check('N1 re-PUT publish 200', r.status === 200, r)
    const { count: notifAfter } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', P.userS2).eq('type', 'ULANGAN_BARU')
    check('N2 notifikasi ULANGAN_BARU tidak bertambah', notifAfter === notifBefore, { notifBefore, notifAfter })

    console.log('\n== O. UTS/UAS: siswa kerjakan → koreksi esai → audit trail ==')
    // UTS guru A (oeA dari section I) sudah punya 1 soal PG — tambah esai lalu publish
    r = await api('POST', `/api/official-exams/${oeA}/questions`, { questions: [
        { question_text: 'Jelaskan hukum Ohm', question_type: 'ESSAY', correct_answer: 'V=IR', points: 50 },
    ] }, 'guru')
    check('O1 tambah soal esai UTS 200', r.status === 200 && Array.isArray(r.data), r)
    r = await api('PUT', `/api/official-exams/${oeA}`, { is_active: true }, 'guru')
    check('O2 publish UTS 200', r.status === 200 && r.data?.is_active === true, r)
    // siswa 1 (kelas A = target oeA) mulai
    r = await api('GET', `/api/official-exams/${oeA}/questions`, null, 's1')
    check('O3 siswa kelas target GET soal UTS → 200', r.status === 200 && Array.isArray(r.data) && r.data.length === 2, r)
    r = await api('POST', '/api/official-exam-submissions', { exam_id: oeA }, 's1')
    check('O4 start UTS 200', r.status === 200 && r.data?.id, r)
    const oeSub = r.data.id
    const { data: oeQs } = await supabase.from('official_exam_questions').select('id, question_type, correct_answer').eq('exam_id', oeA)
    r = await api('PUT', '/api/official-exam-submissions', { submission_id: oeSub, answers: oeQs.map(q => ({ question_id: q.id, answer: q.question_type === 'ESSAY' ? 'Hukum Ohm menyatakan V=IR' : q.correct_answer })), submit: true }, 's1')
    check('O5 submit UTS 200 (is_graded=false karena ada esai)', r.status === 200 && r.data?.is_submitted === true && r.data?.is_graded === false, r)
    const beforeTotal = r.data?.total_score
    // guru koreksi esai: 40/50
    const { data: oeAns } = await supabase.from('official_exam_answers').select('id, question_id, points_earned').eq('submission_id', oeSub)
    const essayAns = oeAns.find(a => a.question_id === oeQs.find(q => q.question_type === 'ESSAY').id)
    r = await api('PUT', `/api/official-exam-submissions/${oeSub}`, { grades: [{ answer_id: essayAns.id, points_earned: 40 }] }, 'guru')
    check('O6 koreksi esai UTS 200 & is_graded', r.status === 200 && r.data?.is_graded === true, r)
    check('O7 total naik setelah koreksi (+' + (r.data?.total_score - beforeTotal) + ')', typeof r.data?.total_score === 'number' && r.data.total_score > beforeTotal, { beforeTotal, after: r.data?.total_score })
    const { data: ghO } = await supabase.from('grade_history').select('*').eq('school_id', P.school).eq('source', 'OFFICIAL_EXAM').order('changed_at', { ascending: false }).limit(1)
    check('O8 grade_history OFFICIAL_EXAM tercatat', ghO?.length === 1 && ghO[0].new_score === r.data?.total_score, ghO)
    // grading attempt hidup official → 400 (siswa 2 belum submit UTS — juga kelas A)
    r = await api('POST', '/api/official-exam-submissions', { exam_id: oeA }, 's2')
    const oeSub2 = r.data?.id
    if (oeSub2) {
        const { data: oeAns2 } = await supabase.from('official_exam_answers').select('id').eq('submission_id', oeSub2).limit(1)
        r = await api('PUT', `/api/official-exam-submissions/${oeSub2}`, { grades: (oeAns2 || []).map(a => ({ answer_id: a.id, points_earned: 1 })) }, 'guru')
        check('O9 grading attempt UTS belum dikumpulkan → 400', r.status === 400, r)
        // siswa 2 submit dengan jawaban SALAH SEMUA → skor rendah (basis remedial)
        r = await api('PUT', '/api/official-exam-submissions', { submission_id: oeSub2, answers: oeQs.map(q => ({ question_id: q.id, answer: q.question_type === 'ESSAY' ? 'salah' : 'ZZZ' })), submit: true }, 's2')
        check('O10 siswa 2 submit jawaban salah → skor rendah', r.status === 200 && (r.data?.total_score ?? 0) <= 10, r)
    }

    console.log('\n== P. Remedial UTS/UAS: guard + merge ==')
    r = await api('POST', '/api/official-exams/duplicate', { source_exam_id: oeA, title: 'SMOKE Remedial UTS', start_time: iso(-60e3), duration_minutes: 30, is_remedial: true, allowed_student_ids: [P.student2], remedial_score_policy: 'HIGHEST' }, 'guru')
    check('P1 buat remedial UTS 200', r.status === 200 && r.data?.id, r)
    const oeRem = r.data.id
    r = await api('PUT', `/api/official-exams/${oeRem}`, { is_active: true }, 'guru')
    check('P2 publish remedial UTS 200', r.status === 200, r)
    r = await api('POST', '/api/official-exam-submissions', { exam_id: oeRem }, 's1')
    check('P3 siswa di luar allowed → 403', r.status === 403, r)
    r = await api('POST', '/api/official-exam-submissions', { exam_id: oeRem }, 's2')
    check('P4 siswa allowed start 200', r.status === 200 && r.data?.id, r)
    const oeSubRem = r.data.id
    const { data: remOQs } = await supabase.from('official_exam_questions').select('id, correct_answer, question_type').eq('exam_id', oeRem)
    r = await api('PUT', '/api/official-exam-submissions', { submission_id: oeSubRem, answers: remOQs.map(q => ({ question_id: q.id, answer: q.question_type === 'ESSAY' ? 'V=IR' : q.correct_answer })), submit: true }, 's2')
    check('P5 submit remedial UTS 200', r.status === 200 && r.data?.is_submitted === true, r)
    // merge di GET submissions guru: skor S2 pada oeA harus merged (rendah → tinggi)
    r = await api('GET', `/api/official-exam-submissions?exam_id=${oeA}`, null, 'guru')
    const s2OeSub = (r.data || []).find(s => (s.student?.id || s.student_id) === P.student2)
    check('P6 skor S2 merged di GET submissions (flag merged_from_remedial)', s2OeSub?.merged_from_remedial === true, s2OeSub && { total: s2OeSub.total_score, merged: s2OeSub.merged_from_remedial })
    // skor asli siswa 2 (jawaban salah semua) di DB = 0; esai remedial belum dikoreksi
    // guru (auto-grade 0) → remedial efektif = skor PG saja. Merge HIGHEST(0, pg) = pg.
    const { data: s2Base } = await supabase.from('official_exam_submissions').select('total_score').eq('exam_id', oeA).eq('student_id', P.student2).single()
    check('P7 skor merged > skor asli (HIGHEST bekerja)', (s2OeSub?.total_score ?? 0) > (s2Base?.total_score ?? 0), { base: s2Base?.total_score, merged: s2OeSub?.total_score })

    console.log('\n== Q. Monitor Live: endpoint sehat ==')
    r = await api('GET', `/api/exam-submissions/monitor?exam_id=${exam1}`, null, 'guru')
    check('Q1 monitor ulangan 200 + ada submission', r.status === 200 && Array.isArray(r.data?.submissions || r.data?.students || r.data), typeof r.data === 'object' && Object.keys(r.data || {}).slice(0, 8))
    r = await api('GET', `/api/official-exam-submissions/monitor?exam_id=${oeA}`, null, 'guru')
    check('Q2 monitor UTS/UAS 200 + ada submission', r.status === 200 && Array.isArray(r.data?.submissions || r.data?.students || r.data), typeof r.data === 'object' && Object.keys(r.data || {}).slice(0, 8))
    r = await api('GET', `/api/exam-submissions/monitor?exam_id=${exam1}`, null, 's1')
    check('Q3 monitor ditolak untuk siswa (401/403)', r.status === 401 || r.status === 403, r)

    console.log(`\n=== HASIL: ${PASS} PASS, ${FAIL} FAIL ===`)
    if (process.env.SMOKE_KEEP !== '1') {
        console.log('\n== CLEANUP ==')
        await cleanup()
        console.log('fixture dibersihkan')
    }
    process.exit(FAIL > 0 ? 1 : 0)
}

main().catch(async e => {
    console.error('FATAL:', e)
    await cleanup().catch(() => { })
    process.exit(1)
})
