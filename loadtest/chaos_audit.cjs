/**
 * CHAOS TEST LAPIS A — jaminan server saat jaringan buruk / kondisi adverse.
 *
 * Melengkapi smoke_audit.cjs (68 asersi di jaringan sempurna) dengan skenario
 * adverse yang DISIMULASIKAN di level API (waktu dikontrol via fixture, bukan
 * menunggu real-time):
 *   C1. Putus koneksi → resume device baru: saved_answers dikembalikan utuh
 *   C2. Submit DALAM grace window (deadline lewat <60 dtk): diterima 200
 *   C3. Submit LEWAT grace (offline lama): 409 TIME_EXPIRED + jawaban
 *       terakhir terselamatkan (force-close merge)
 *   C4. Browser mati total (tak pernah submit): scheduler sweep menutup
 *       otomatis dengan jawaban autosave terakhir
 *   C5. Double-submit & double-start paralel: idempoten, 1 baris submission
 *   C6. Autosave bertahap + penimpaan (latensi): last-write-wins per soal
 *   C7. Spot-check UTS/UAS: C3 di jalur official-exam-submissions
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/chaos_audit.cjs
 * Server staging harus jalan. Fixture terisolasi + cleanup otomatis.
 * Manipulasi exams.start_time dilakukan LANGSUNG via service key — itu fixture
 * setup untuk mengontrol jam, bukan jalur yang diuji.
 */
require('./e2e/helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000'

const P = {
    school: 'ca050000-0000-0000-0000-000000000001',
    year: 'ca050000-0000-0000-0000-000000000002',
    subject: 'ca050000-0000-0000-0000-000000000003',
    classA: 'ca050001-0000-0000-0000-000000000001',
    userGuru: 'ca051000-0000-0000-0000-000000000001',
    userS1: 'ca051000-0000-0000-0000-000000000011',
    userS2: 'ca051000-0000-0000-0000-000000000012',
    teacherA: 'ca052000-0000-0000-0000-000000000001',
    taA: 'ca053000-0000-0000-0000-000000000001',
    student1: 'ca054000-0000-0000-0000-000000000001',
    student2: 'ca054000-0000-0000-0000-000000000002',
}
const TOK = { guru: 'cha_guru_a', s1: 'cha_siswa_1', s2: 'cha_siswa_2' }
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString()
const MIN = 60_000

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
            Cookie: who ? `session_token=${TOK[who]}; user_role=${who.startsWith('s') ? 'SISWA' : 'GURU'}` : '',
        },
        body: body ? JSON.stringify(body) : undefined,
    })
    let data = null
    try { data = await res.json() } catch { /* empty body */ }
    return { status: res.status, ok: res.ok, data }
}

async function cleanup() {
    const { data: tas } = await supabase.from('teaching_assignments').select('id').eq('id', P.taA)
    const taIds = (tas || []).map(t => t.id)
    if (taIds.length) {
        const { data: exs } = await supabase.from('exams').select('id').in('teaching_assignment_id', taIds)
        for (const e of (exs || [])) {
            const { data: subs } = await supabase.from('exam_submissions').select('id').eq('exam_id', e.id)
            for (const s of (subs || [])) await supabase.from('exam_answers').delete().eq('submission_id', s.id)
            await supabase.from('exam_submissions').delete().eq('exam_id', e.id)
            await supabase.from('exam_questions').delete().eq('exam_id', e.id)
            await supabase.from('exams').delete().eq('id', e.id)
        }
    }
    const { data: oes } = await supabase.from('official_exams').select('id').eq('school_id', P.school)
    for (const oe of (oes || [])) {
        const { data: subs } = await supabase.from('official_exam_submissions').select('id').eq('exam_id', oe.id)
        for (const s of (subs || [])) await supabase.from('official_exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('official_exam_submissions').delete().eq('exam_id', oe.id)
        await supabase.from('official_exam_questions').delete().eq('exam_id', oe.id)
        await supabase.from('official_exams').delete().eq('id', oe.id)
    }
    await supabase.from('notifications').delete().in('user_id', [P.userGuru, P.userS1, P.userS2])
    await supabase.from('student_enrollments').delete().in('student_id', [P.student1, P.student2])
    await supabase.from('students').delete().in('id', [P.student1, P.student2])
    await supabase.from('teaching_assignments').delete().eq('id', P.taA)
    await supabase.from('teachers').delete().eq('id', P.teacherA)
    await supabase.from('sessions').delete().in('token', Object.values(TOK))
    await supabase.from('users').delete().in('id', [P.userGuru, P.userS1, P.userS2])
    await supabase.from('classes').delete().eq('id', P.classA)
    await supabase.from('subjects').delete().eq('id', P.subject)
    await supabase.from('academic_years').delete().eq('id', P.year)
    await supabase.from('schools').delete().eq('id', P.school)
}

async function seed() {
    const u = async (table, rows) => {
        const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
        if (error) throw new Error(`seed ${table}: ${error.message}`)
    }
    const HASH = '$2b$10$rqXmqWFyi8Tm1.W8EOknfes0laidH4JAfH2G1GxoCAjtwk3panAY.'
    await u('schools', [{ id: P.school, name: 'CHAOS AUDIT School', code: 'CHA01', school_level: 'SMP', is_active: true, max_students: 2000, max_teachers: 50, settings: { ai_review_enabled: false } }])
    await u('academic_years', [{ id: P.year, name: 'CHAOS 2026/2027', start_date: '2026-07-14', status: 'ACTIVE', is_active: true, school_id: P.school }])
    await u('subjects', [{ id: P.subject, name: 'Chaos Mapel', school_id: P.school, kkm: 70, level: 'SMP' }])
    await u('classes', [{ id: P.classA, name: 'CHA-7A', grade_level: 1, school_level: 'SMP', academic_year_id: P.year }])
    await u('users', [
        { id: P.userGuru, username: 'cha_guru_a', password_hash: HASH, full_name: 'Chaos Guru A', role: 'GURU', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.userS1, username: 'cha_siswa_1', password_hash: HASH, full_name: 'Chaos Siswa 1', role: 'SISWA', school_id: P.school, must_change_password: false, is_locked: false },
        { id: P.userS2, username: 'cha_siswa_2', password_hash: HASH, full_name: 'Chaos Siswa 2', role: 'SISWA', school_id: P.school, must_change_password: false, is_locked: false },
    ])
    await u('teachers', [{ id: P.teacherA, user_id: P.userGuru, school_id: P.school, gender: 'L' }])
    await u('teaching_assignments', [{ id: P.taA, teacher_id: P.teacherA, subject_id: P.subject, class_id: P.classA, academic_year_id: P.year }])
    await u('students', [
        { id: P.student1, user_id: P.userS1, nis: 'CHA0001', class_id: P.classA, angkatan: '2026', entry_year: 2026, school_level: 'SMP', status: 'ACTIVE', gender: 'L', school_id: P.school },
        { id: P.student2, user_id: P.userS2, nis: 'CHA0002', class_id: P.classA, angkatan: '2026', entry_year: 2026, school_level: 'SMP', status: 'ACTIVE', gender: 'P', school_id: P.school },
    ])
    await u('student_enrollments', [
        { id: 'ca055000-0000-0000-0000-000000000001', student_id: P.student1, class_id: P.classA, academic_year_id: P.year, status: 'ACTIVE' },
        { id: 'ca055000-0000-0000-0000-000000000002', student_id: P.student2, class_id: P.classA, academic_year_id: P.year, status: 'ACTIVE' },
    ])
    await u('sessions', [
        { id: 'ca056000-0000-0000-0000-000000000001', user_id: P.userGuru, token: TOK.guru, expires_at: iso(6 * 3600e3) },
        { id: 'ca056000-0000-0000-0000-000000000011', user_id: P.userS1, token: TOK.s1, expires_at: iso(6 * 3600e3) },
        { id: 'ca056000-0000-0000-0000-000000000012', user_id: P.userS2, token: TOK.s2, expires_at: iso(6 * 3600e3) },
    ])
}

/** Buat ulangan aktif 3 soal PG + 1 attempt siswa; kembalikan {examId, subId, qIds}. */
async function makeActiveExamWithAttempt(label, who) {
    let r = await api('POST', '/api/exams', { title: label, start_time: iso(-2 * MIN), duration_minutes: 60, teaching_assignment_id: P.taA }, 'guru')
    const examId = r.data?.id
    r = await api('POST', `/api/exams/${examId}/questions`, { questions: [
        { question_text: 'Q1', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'A', points: 10 },
        { question_text: 'Q2', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'B', points: 10 },
        { question_text: 'Q3', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'A', points: 10 },
    ] }, 'guru')
    const qIds = (r.data || []).map(q => q.id)
    await api('PUT', `/api/exams/${examId}`, { is_active: true }, 'guru')
    r = await api('POST', '/api/exam-submissions', { exam_id: examId }, who)
    return { examId, subId: r.data?.id, qIds }
}

/** Geser jam ujian sehingga endAt (start+duration) = now - offsetMs. */
async function shiftExamClock(examId, durationMinutes, offsetMs) {
    const { error } = await supabase
        .from('exams')
        .update({ start_time: new Date(Date.now() - offsetMs - durationMinutes * MIN).toISOString() })
        .eq('id', examId)
    if (error) throw new Error('shiftExamClock: ' + error.message)
}

async function main() {
    console.log('== SEED fixture ==')
    await cleanup().catch(() => { })
    await seed()

    // ------------------------------------------------------------------
    console.log('\n== C1. Putus koneksi → resume device baru ==')
    let fx = await makeActiveExamWithAttempt('CHAOS C1', 's1')
    check('C1a attempt dibuat', !!fx.subId, fx)
    // autosave 2 jawaban lalu "device hilang" (tanpa localStorage) → resume
    let r = await api('PUT', '/api/exam-submissions', { submission_id: fx.subId, answers: [
        { question_id: fx.qIds[0], answer: 'A' },
        { question_id: fx.qIds[1], answer: 'B' },
    ] }, 's1')
    check('C1b autosave 2 jawaban 200', r.status === 200, r)
    r = await api('POST', '/api/exam-submissions', { exam_id: fx.examId }, 's1')
    check('C1c resume 200 + id sama', r.status === 200 && r.data?.id === fx.subId, r.data && { id: r.data.id })
    const saved = r.data?.saved_answers || []
    check('C1d saved_answers berisi 2 jawaban (resume lintas device)', saved.length === 2, saved)
    check('C1e isi jawaban sama (Q1=A, Q2=B)',
        saved.find(a => a.question_id === fx.qIds[0])?.answer === 'A' &&
        saved.find(a => a.question_id === fx.qIds[1])?.answer === 'B', saved)
    check('C1f ends_at + server_time terkirim (patokan timer)', !!r.data?.ends_at && !!r.data?.server_time, r.data && { ends_at: r.data.ends_at, server_time: r.data.server_time })

    // ------------------------------------------------------------------
    console.log('\n== C2. Submit DALAM grace window (deadline lewat 20 dtk) ==')
    fx = await makeActiveExamWithAttempt('CHAOS C2', 's1')
    // geser jam: endAt = now - 20 dtk (masih dalam grace 60 dtk)
    await shiftExamClock(fx.examId, 60, 20_000)
    r = await api('PUT', '/api/exam-submissions', { submission_id: fx.subId, answers: [
        { question_id: fx.qIds[0], answer: 'A' }, { question_id: fx.qIds[1], answer: 'B' }, { question_id: fx.qIds[2], answer: 'A' },
    ], submit: true }, 's1')
    check('C2a submit dalam grace → 200 (bukan 409)', r.status === 200, r)
    check('C2b is_submitted=true & skor 30', r.data?.is_submitted === true && r.data?.total_score === 30, r.data && { submitted: r.data.is_submitted, score: r.data.total_score })

    // ------------------------------------------------------------------
    console.log('\n== C3. Submit LEWAT grace (offline 5 menit) → jawaban terselamatkan ==')
    fx = await makeActiveExamWithAttempt('CHAOS C3', 's1')
    // autosave parsial dulu (yang sempat tersimpan sebelum offline)
    await api('PUT', '/api/exam-submissions', { submission_id: fx.subId, answers: [
        { question_id: fx.qIds[0], answer: 'A' },
    ] }, 's1')
    await shiftExamClock(fx.examId, 60, 5 * MIN) // endAt = now - 5 mnt (lewat grace)
    r = await api('PUT', '/api/exam-submissions', { submission_id: fx.subId, answers: [
        // "jawaban yang diketik saat offline" — dikirim saat menemukan sinyal
        { question_id: fx.qIds[0], answer: 'A' }, { question_id: fx.qIds[1], answer: 'B' },
    ], submit: true }, 's1')
    check('C3a submit lewat grace → 409 TIME_EXPIRED', r.status === 409 && r.data?.code === 'TIME_EXPIRED', r)
    check('C3b force_submitted=true (jawaban tetap dikumpulkan)', r.data?.force_submitted === true, r.data)
    const { data: c3sub } = await supabase.from('exam_submissions').select('is_submitted, total_score').eq('id', fx.subId).single()
    check('C3c DB: is_submitted=true', c3sub?.is_submitted === true, c3sub)
    check('C3d jawaban offline terselamatkan (skor 20 = Q1+Q2 benar)', c3sub?.total_score === 20, c3sub)

    // ------------------------------------------------------------------
    console.log('\n== C4. Browser mati total → scheduler sweep menutup otomatis ==')
    fx = await makeActiveExamWithAttempt('CHAOS C4', 's2')
    // autosave 1 jawaban lalu browser mati (tidak pernah submit)
    await api('PUT', '/api/exam-submissions', { submission_id: fx.subId, answers: [
        { question_id: fx.qIds[0], answer: 'A' }, { question_id: fx.qIds[1], answer: 'B' },
    ] }, 's2')
    await shiftExamClock(fx.examId, 60, 4 * MIN) // endAt = now - 4 mnt (> sweep buffer 2 mnt)
    console.log('  ⏳ menunggu scheduler sweep (tick 1 dtk-1 mnt, buffer 2 mnt)...')
    let c4done = false, c4sub = null
    const c4deadline = Date.now() + 150_000
    while (Date.now() < c4deadline) {
        await new Promise(res => setTimeout(res, 5000))
        const { data: s } = await supabase.from('exam_submissions').select('is_submitted, total_score, submitted_at').eq('id', fx.subId).single()
        if (s?.is_submitted) { c4done = true; c4sub = s; break }
    }
    check('C4a sweep menutup otomatis (≤150 dtk)', c4done, c4sub)
    check('C4b jawaban autosave terakhir dinilai (skor 20)', c4sub?.total_score === 20, c4sub)
    check('C4c submitted_at = batas efektif (jujur, bukan jam sweep)', c4sub?.submitted_at && new Date(c4sub.submitted_at).getTime() <= Date.now() - 3.5 * MIN, c4sub?.submitted_at)

    // ------------------------------------------------------------------
    console.log('\n== C5. Double-submit & double-start paralel (race) ==')
    fx = await makeActiveExamWithAttempt('CHAOS C5', 's1')
    await api('PUT', '/api/exam-submissions', { submission_id: fx.subId, answers: [
        { question_id: fx.qIds[0], answer: 'A' }, { question_id: fx.qIds[1], answer: 'B' }, { question_id: fx.qIds[2], answer: 'A' },
    ] }, 's1')
    // 2 PUT submit konkuren (double-click / retry network)
    const [s1a, s1b] = await Promise.all([
        api('PUT', '/api/exam-submissions', { submission_id: fx.subId, submit: true }, 's1'),
        api('PUT', '/api/exam-submissions', { submission_id: fx.subId, submit: true }, 's1'),
    ])
    const codes = [s1a.status, s1b.status].sort()
    check('C5a double-submit: kombinasi valid (200/200 atau 200/400), tanpa 500', !codes.includes(500) && codes.includes(200), codes)
    const { count: c5count } = await supabase.from('exam_submissions').select('id', { count: 'exact', head: true }).eq('exam_id', fx.examId).eq('student_id', P.student1)
    check('C5b DB tetap 1 baris submission, skor final tunggal', c5count === 1, c5count)
    const { data: c5sub } = await supabase.from('exam_submissions').select('total_score, is_submitted').eq('id', fx.subId).single()
    check('C5c skor final 30 & submitted', c5sub?.is_submitted === true && c5sub?.total_score === 30, c5sub)
    // 2 POST start konkuren untuk siswa 2 (belum punya attempt)
    const [s2a, s2b] = await Promise.all([
        api('POST', '/api/exam-submissions', { exam_id: fx.examId }, 's2'),
        api('POST', '/api/exam-submissions', { exam_id: fx.examId }, 's2'),
    ])
    check('C5d double-start: keduanya respons sukses (insert/resume 23505), tanpa 500', s2a.status === 200 && s2b.status === 200, [s2a.status, s2b.status])
    const { count: c5count2 } = await supabase.from('exam_submissions').select('id', { count: 'exact', head: true }).eq('exam_id', fx.examId).eq('student_id', P.student2)
    check('C5e DB siswa 2 tetap 1 baris (constraint UNIQUE menang)', c5count2 === 1, c5count2)

    // ------------------------------------------------------------------
    console.log('\n== C6. Autosave bertahap + penimpaan (jaringan lambat) ==')
    fx = await makeActiveExamWithAttempt('CHAOS C6', 's1')
    // simulasi: jawab salah → koreksi ke benar (Q1), jawab benar → ganti salah (Q2), Q3 dua kali
    await api('PUT', '/api/exam-submissions', { submission_id: fx.subId, answers: [{ question_id: fx.qIds[0], answer: 'B' }] }, 's1')
    await new Promise(res => setTimeout(res, 300))
    await api('PUT', '/api/exam-submissions', { submission_id: fx.subId, answers: [{ question_id: fx.qIds[1], answer: 'B' }] }, 's1')
    await new Promise(res => setTimeout(res, 300))
    await api('PUT', '/api/exam-submissions', { submission_id: fx.subId, answers: [{ question_id: fx.qIds[0], answer: 'A' }] }, 's1') // Q1 dikoreksi
    await new Promise(res => setTimeout(res, 300))
    await api('PUT', '/api/exam-submissions', { submission_id: fx.subId, answers: [{ question_id: fx.qIds[2], answer: 'A' }] }, 's1')
    await new Promise(res => setTimeout(res, 300))
    await api('PUT', '/api/exam-submissions', { submission_id: fx.subId, answers: [{ question_id: fx.qIds[1], answer: 'A' }] }, 's1') // Q2 berubah salah
    const { data: c6answers } = await supabase.from('exam_answers').select('question_id, answer, points_earned').eq('submission_id', fx.subId)
    const a0 = c6answers?.find(a => a.question_id === fx.qIds[0])
    const a1 = c6answers?.find(a => a.question_id === fx.qIds[1])
    const a2 = c6answers?.find(a => a.question_id === fx.qIds[2])
    check('C6a Q1 nilai terakhir menang (A, 10 poin)', a0?.answer === 'A' && a0?.points_earned === 10, a0)
    check('C6b Q2 nilai terakhir menang (A, 0 poin — salah)', a1?.answer === 'A' && a1?.points_earned === 0, a1)
    check('C6c Q3 utuh (A, 10 poin)', a2?.answer === 'A' && a2?.points_earned === 10, a2)
    check('C6d tidak ada jawaban dobel per soal (3 baris)', (c6answers || []).length === 3, c6answers?.length)

    // ------------------------------------------------------------------
    console.log('\n== C7. UTS/UAS: submit lewat grace → jawaban terselamatkan ==')
    let r2 = await api('POST', '/api/official-exams', { title: 'CHAOS UTS', exam_type: 'UTS', subject_id: P.subject, target_class_ids: [P.classA], academic_year_id: P.year, start_time: iso(-2 * MIN), duration_minutes: 60, school_id: P.school }, 'guru')
    const oeId = r2.data?.id
    check('C7a buat UTS 200', !!oeId, r2)
    r2 = await api('POST', `/api/official-exams/${oeId}/questions`, { questions: [
        { question_text: 'OQ1', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'A', points: 10 },
        { question_text: 'OQ2', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'B', points: 10 },
    ] }, 'guru')
    const oqIds = (r2.data || []).map(q => q.id)
    await api('PUT', `/api/official-exams/${oeId}`, { is_active: true }, 'guru')
    r2 = await api('POST', '/api/official-exam-submissions', { exam_id: oeId }, 's1')
    const oeSub = r2.data?.id
    check('C7b start UTS 200', !!oeSub, r2)
    await api('PUT', '/api/official-exam-submissions', { submission_id: oeSub, answers: [{ question_id: oqIds[0], answer: 'A' }] }, 's1')
    // geser jam official exam: endAt = now - 5 mnt
    const { error: oeShiftErr } = await supabase.from('official_exams').update({ start_time: new Date(Date.now() - 5 * MIN - 60 * MIN).toISOString() }).eq('id', oeId)
    if (oeShiftErr) throw new Error('shift official: ' + oeShiftErr.message)
    r2 = await api('PUT', '/api/official-exam-submissions', { submission_id: oeSub, answers: [
        { question_id: oqIds[0], answer: 'A' }, { question_id: oqIds[1], answer: 'B' },
    ], submit: true }, 's1')
    check('C7c submit lewat grace → 409 TIME_EXPIRED + force_submitted', r2.status === 409 && r2.data?.code === 'TIME_EXPIRED' && r2.data?.force_submitted === true, r2)
    const { data: c7sub } = await supabase.from('official_exam_submissions').select('is_submitted, total_score').eq('id', oeSub).single()
    check('C7d DB: submitted & jawaban offline terselamatkan (skor 20)', c7sub?.is_submitted === true && c7sub?.total_score === 20, c7sub)

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
