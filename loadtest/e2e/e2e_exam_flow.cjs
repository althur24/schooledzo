/**
 * E2E FUNGSIONAL ALUR ULANGAN (exam_*) LENGKAP — guru buat → publish → siswa
 * kerjakan → autosave → submit → penilaian otomatis → koreksi manual essay.
 *
 * TUJUAN UTAMA: memverifikasi bahwa meng-enable RLS pada exam_questions /
 * exam_submissions / exam_answers TIDAK memutus alur manapun (semua akses data
 * lewat service-role API route) DAN menutup lubang anon-key PostgREST.
 *
 * Cakupan:
 *  - [RLS-A] akses anon langsung ke PostgREST DITOLAK (select kosong, insert error)
 *  - [FLOW] guru buat ulangan + soal → publish → siswa start/autosave/submit
 *  - [SCORE] penilaian otomatis MC/SHORT_ANSWER benar; essay menunggu koreksi
 *  - [GRADE] koreksi manual essay → total_score & is_graded update
 *  - [K1] correct_answer disembunyikan dari siswa pra-submit, muncul pasca-submit
 *  - [CLASS] siswa kelas lain ditolak saat start
 *  - [VIOL] batch violations (queue offline): timestamp client, dedup 3 dtk,
 *           jalur tunggal lama, force-submit saat capai max_violations
 *  - [MON] guru bisa fetch monitor (service-role read exam_answers) tanpa error
 *
 * WAJIB staging: ENV_FILE=.env.staging node loadtest/e2e/e2e_exam_flow.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
// Klien anon (subjek RLS) — dipakai HANYA untuk probe kebocoran, meniru browser siswa.
const anonSupa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const PORT = 3100
const BASE = `http://localhost:${PORT}`

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], exams: [], questions: [], submissions: [],
    enrollments: [], notificationsByUser: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `ex_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} IPA`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const guruUser = await mustInsert(supabase, 'users', { username: `${U}_guru`, full_name: `${U} Guru`, password_hash: passHash, role: 'GURU', school_id: school.id }, 'user guru')
    created.users.push(guruUser.id)
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guruUser.id, school_id: school.id }, 'teacher')
    created.teachers.push(teacher.id)

    const classA = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class A')
    const classB = await mustInsert(supabase, 'classes', { name: `${U} 9B`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class B')
    created.classes.push(classA.id, classB.id)

    const taA = await mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: classA.id, subject_id: subject.id, academic_year_id: year.id }, 'TA A')
    created.tas.push(taA.id)

    const mkStudent = async (label, cls) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} Siswa ${label.toUpperCase()}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}${label}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session ${label}`)).token
        created.sessions.push(tok)
        return { user: u, student: st, token: tok }
    }
    const siswaA = await mkStudent('a', classA) // kelas yang benar
    const siswaB = await mkStudent('b', classB) // kelas lain
    const guruTok = (await mustInsert(supabase, 'sessions', { user_id: guruUser.id, token: `${U}_tok_guru`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session guru')).token
    created.sessions.push(guruTok)

    console.log('fixtures OK (guru, 2 siswa beda kelas, TA, tahun aktif)')

    // ---------- START SERVER (mewarisi env staging) ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ---------- 1. GURU BUAT ULANGAN (draft) ----------
    console.log('[1] Guru membuat ulangan (draft)')
    const startTime = new Date(Date.now() - 60000).toISOString() // mulai 1 menit lalu (available sekarang)
    const createRes = await api('/api/exams', guruTok, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Ulangan E2E`, description: 'e2e rls', start_time: startTime,
            duration_minutes: 30, teaching_assignment_id: taA.id, is_randomized: false,
            max_violations: 3, show_results_immediately: true,
        }),
    })
    const exam1 = await createRes.json().catch(() => null)
    check('POST /api/exams sukses (200)', createRes.status === 200 && exam1?.id, `status ${createRes.status}`)
    created.exams.push(exam1?.id)

    // ---------- 2. TAMBAH SOAL (langsung via service-role, status approved) ----------
    // Sengaja pakai service-role insert: membuktikan write exam_questions tetap jalan
    // setelah RLS enabled (service role bypass). status=approved agar publish tak terblokir AI.
    console.log('[2] Tambah soal via service-role (3 MC + 1 SHORT_ANSWER + 1 ESSAY, 10 poin)')
    const qRows = [
        { exam_id: exam1.id, question_text: 'MC benar', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: exam1.id, question_text: 'MC salah', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 10, order_index: 1, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: exam1.id, question_text: 'Isian: proses buat makanan tumbuhan', question_type: 'SHORT_ANSWER', options: null, correct_answer: 'fotosintesis', points: 10, order_index: 2, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: exam1.id, question_text: 'Jelaskan dampak hujan asam', question_type: 'ESSAY', options: null, correct_answer: null, points: 10, order_index: 3, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
    ]
    const { data: insertedQs, error: qInsErr } = await supabase.from('exam_questions').insert(qRows).select()
    if (qInsErr) throw new Error('Insert exam_questions gagal: ' + qInsErr.message)
    created.questions.push(...insertedQs.map(q => q.id))
    const qIds = {}
    insertedQs.forEach(q => { qIds[q.question_text.split(':')[0].split(' ')[0]] = q.id })
    const mcBenarId = insertedQs.find(q => q.question_text === 'MC benar').id
    const mcSalahId = insertedQs.find(q => q.question_text === 'MC salah').id
    const saId = insertedQs.find(q => q.question_type === 'SHORT_ANSWER').id
    const essayId = insertedQs.find(q => q.question_type === 'ESSAY').id
    check('4 soal tersimpan (service-role write OK)', insertedQs.length === 4, `n=${insertedQs.length}`)

    // ---------- 3. GURU PUBLISH ----------
    console.log('[3] Guru publish ulangan')
    const pubRes = await api(`/api/exams/${exam1.id}`, guruTok, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    check('PUT publish sukses (200)', pubRes.status === 200, `status ${pubRes.status}`)

    // ---------- 4. SISWA LIHAT DAFTAR + SOAL (correct_answer disembunyikan) ----------
    console.log('[4] [K1] Siswa lihat soal — correct_answer disembunyikan pra-submit')
    const listRes = await api('/api/exams', siswaA.token)
    const listBody = await listRes.json().catch(() => null)
    const examInList = (listBody || []).find(e => e.id === exam1.id)
    check('Ulangan muncul di daftar siswa kelas A', !!examInList, `found=${!!examInList}`)

    const qRes = await api(`/api/exams/${exam1.id}/questions`, siswaA.token)
    const qBody = await qRes.json().catch(() => null)
    const leaked = (Array.isArray(qBody) ? qBody : []).filter(q => q.correct_answer !== undefined)
    check('correct_answer TIDAK bocor pra-submit', Array.isArray(qBody) && qBody.length === 4 && leaked.length === 0, `leaked=${leaked.length}`)

    // ---------- 5. [CLASS] SISWA KELAS LAIN DITOLAK SAAT START ----------
    console.log('[5] [CLASS] Siswa kelas lain ditolak saat start')
    const wrongStart = await api('/api/exam-submissions', siswaB.token, { method: 'POST', body: JSON.stringify({ exam_id: exam1.id }) })
    check('Start siswa kelas lain ditolak 403', wrongStart.status === 403, `status ${wrongStart.status}`)

    // ---------- 6. SISWA KELAS A MULAI ----------
    console.log('[6] Siswa kelas A mulai attempt')
    const start = await api('/api/exam-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ exam_id: exam1.id }) })
    const startBody = await start.json().catch(() => null)
    check('Start sukses (200)', start.status === 200 && startBody?.id, `status ${start.status}`)
    check('Kontrak waktu ada (started_at + ends_at + server_time)', !!startBody?.started_at && startBody?.ends_at !== undefined && !!startBody?.server_time)
    created.submissions.push(startBody?.id)
    const sub1Id = startBody?.id

    // ---------- 7. AUTOSAVE ----------
    console.log('[7] Autosave jawaban')
    const saveRes = await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: sub1Id,
            answers: [
                { question_id: mcBenarId, answer: 'A' },      // benar
                { question_id: mcSalahId, answer: 'B' },      // salah (kunci A)
                { question_id: saId, answer: 'fotosintesis' },// benar
            ],
        }),
    })
    check('Autosave sukses', saveRes.status === 200, `status ${saveRes.status}`)

    // ---------- 7b. VIOLATION BATCH (queue offline) + DEDUP + LEGACY TUNGGAL ----------
    // Skenario: siswa pindah tab saat offline → warning tampil, PUT gagal →
    // client mengantre {type, at} lalu flush batch saat online. Server harus:
    // (a) menerima batch & memakai timestamp kejadian client, (b) dedup 3 dtk
    // antar kejadian, (c) jalur `violation` tunggal lama tetap jalan.
    console.log('[7b] Violation: batch (queue offline) + dedup 3 dtk + jalur tunggal lama')
    const stAt1 = new Date(startBody.started_at).getTime()
    await new Promise(r => setTimeout(r, 2500)) // pastikan at ≤ server now (tidak kena clamp atas)

    const vBatch = await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: sub1Id,
            violations: [{ type: 'TAB_SWITCH', at: stAt1 + 1000 }],
        }),
    })
    const vBatchBody = await vBatch.json().catch(() => null)
    check('Batch violations (1 entri) → violation_count 1', vBatch.status === 200 && vBatchBody?.violation_count === 1, `count=${vBatchBody?.violation_count}`)

    // Entri kedua hanya 2 dtk setelah yang diterima → kena dedup 3 dtk
    const vDedup = await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: sub1Id,
            violations: [{ type: 'TAB_SWITCH', at: stAt1 + 3000 }],
        }),
    })
    const vDedupBody = await vDedup.json().catch(() => null)
    check('Entri <3 dtk dari yang diterima → dedup (count tetap)', vDedup.status === 200 && vDedupBody?.violation_count === 1, `count=${vDedupBody?.violation_count}`)

    // Timestamp kejadian client tersimpan apa adanya (bukan waktu tiba di server)
    const { data: subV1 } = await supabase.from('exam_submissions').select('violations_log').eq('id', sub1Id).single()
    const logTs = new Date(subV1?.violations_log?.[0]?.timestamp).getTime()
    check('violations_log memakai timestamp kejadian client', Math.abs(logTs - (stAt1 + 1000)) < 1000, `ts=${subV1?.violations_log?.[0]?.timestamp}`)

    // Jalur legacy `violation` tunggal (tanpa `at`) tetap jalan — gap >3 dtk dari entri terakhir
    await new Promise(r => setTimeout(r, 3500))
    const vSingle = await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: sub1Id, violation: { type: 'TAB_SWITCH' } }),
    })
    const vSingleBody = await vSingle.json().catch(() => null)
    check('Legacy violation tunggal → count 2 (belum force, max 3)', vSingle.status === 200 && vSingleBody?.violation_count === 2 && !vSingleBody?.force_submitted, `count=${vSingleBody?.violation_count}`)

    // ---------- 8. SUBMIT + PENILAIAN OTOMATIS ----------
    console.log('[8] Submit — skor otomatis (MC benar 10 + SA benar 10 = 20, essay pending)')
    const submitRes = await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: sub1Id, submit: true,
            answers: [
                { question_id: mcBenarId, answer: 'A' },
                { question_id: mcSalahId, answer: 'B' },
                { question_id: saId, answer: 'fotosintesis' },
                { question_id: essayId, answer: 'esai siswa' },
            ],
        }),
    })
    const submitBody = await submitRes.json().catch(() => null)
    check('Submit sukses', submitRes.status === 200, `status ${submitRes.status}`)
    check('total_score = 20 (auto-graded, essay belum dinilai)', submitBody?.total_score === 20, `total=${submitBody?.total_score}`)
    check('is_graded = false (ada essay)', submitBody?.is_graded === false, `graded=${submitBody?.is_graded}`)
    check('submitted_at terisi', !!submitBody?.submitted_at)

    // ---------- 9. KOREKSI MANUAL ESSAY ----------
    console.log('[9] Koreksi manual essay → total_score & is_graded update')
    const gradeRes = await api(`/api/exam-submissions/${sub1Id}`, guruTok, {
        method: 'PUT',
        body: JSON.stringify({
            answers: [{ question_id: essayId, score: 8, answer: 'esai siswa', is_correct: null, feedback: 'cukup' }],
            is_graded: true,
        }),
    })
    check('Grading PUT sukses (200)', gradeRes.status === 200, `status ${gradeRes.status}`)
    const gradeBody = await gradeRes.json().catch(() => null)
    const { data: subGraded } = await supabase.from('exam_submissions').select('total_score, is_graded').eq('id', sub1Id).single()
    // DEBUG: respons grading + baris exam_answers pasca-grading (deteksi upsert gagal diam-diam)
    const { data: dbgAnswers } = await supabase.from('exam_answers').select('question_id, points_earned, feedback').eq('submission_id', sub1Id)
    console.log('    [debug] gradeRes body:', JSON.stringify(gradeBody))
    console.log('    [debug] exam_answers:', JSON.stringify(dbgAnswers))
    console.log('    [debug] essayId:', essayId)
    check('Nilai tersimpan (28, is_graded=true)', subGraded?.total_score === 28 && subGraded?.is_graded === true, `total=${subGraded?.total_score}`)

    // ---------- 10. [K1] correct_answer MUNCUL PASCA-SUBMIT ----------
    console.log('[10] [K1] correct_answer muncul setelah submit')
    const qRes2 = await api(`/api/exams/${exam1.id}/questions`, siswaA.token)
    const qBody2 = await qRes2.json().catch(() => null)
    const allHaveKey = Array.isArray(qBody2) && qBody2.length === 4 && qBody2.every(q => q.correct_answer !== undefined)
    check('correct_answer kembali setelah submit', allHaveKey, `n=${qBody2?.length}`)

    // ---------- 10b. FORCE-SUBMIT VIA BATCH VIOLATIONS (ujian kedua) ----------
    // Skenario puncak: siswa offline pindah tab 3x (spasi >3 dtk), lalu online
    // → flush batch 3 entri → count mencapai max_violations → force submit.
    console.log('[10b] Batch violations mencapai max → force submit otomatis')
    const createRes2 = await api('/api/exams', guruTok, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Ulangan Violation`, description: 'e2e force submit', start_time: startTime,
            duration_minutes: 30, teaching_assignment_id: taA.id, is_randomized: false,
            max_violations: 3, show_results_immediately: true,
        }),
    })
    const exam2 = await createRes2.json().catch(() => null)
    created.exams.push(exam2?.id)
    const { data: insertedQ2, error: q2Err } = await supabase.from('exam_questions').insert({
        exam_id: exam2.id, question_text: 'MC force', question_type: 'MULTIPLE_CHOICE',
        options: ['A1', 'B1'], correct_answer: 'A', points: 10, order_index: 0,
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    }).select()
    if (q2Err) throw new Error('Insert soal exam2 gagal: ' + q2Err.message)
    created.questions.push(insertedQ2[0].id)
    await api(`/api/exams/${exam2.id}`, guruTok, { method: 'PUT', body: JSON.stringify({ is_active: true }) })

    const start2 = await api('/api/exam-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ exam_id: exam2.id }) })
    const start2Body = await start2.json().catch(() => null)
    created.submissions.push(start2Body?.id)
    const sub2Id = start2Body?.id
    const stAt2 = new Date(start2Body.started_at).getTime()

    // Tunggu supaya semua `at` ≤ server now (tidak kena clamp atas yang bisa
    // membuat dua entri bertabrakan di titik clamp → saling dimakan dedup)
    await new Promise(r => setTimeout(r, 7000))

    const vForce = await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: sub2Id,
            violations: [
                { type: 'TAB_SWITCH', at: stAt2 + 100 },
                { type: 'TAB_SWITCH', at: stAt2 + 3200 },
                { type: 'TAB_SWITCH', at: stAt2 + 6300 },
            ],
        }),
    })
    const vForceBody = await vForce.json().catch(() => null)
    check('Batch 3 pelanggaran (spasi >3 dtk) → force_submitted', vForce.status === 200 && vForceBody?.force_submitted === true, `force=${vForceBody?.force_submitted}`)
    const { data: subV2 } = await supabase.from('exam_submissions')
        .select('violation_count, is_submitted, violations_log, submitted_at')
        .eq('id', sub2Id).single()
    check('DB: count 3, is_submitted, 3 entri log', subV2?.violation_count === 3 && subV2?.is_submitted === true && (subV2?.violations_log || []).length === 3,
        `count=${subV2?.violation_count} submitted=${subV2?.is_submitted} log=${subV2?.violations_log?.length}`)

    // ---------- 11. [MON] GURU FETCH MONITOR ----------
    console.log('[11] [MON] Guru fetch monitor (service-role read exam_answers)')
    const monRes = await api(`/api/exam-submissions/monitor?exam_id=${exam1.id}`, guruTok)
    check('GET monitor sukses (200)', monRes.status === 200, `status ${monRes.status}`)

    // ---------- 12. [RLS-A] PROBE ANON — lubang kebocoran TERTUTUP ----------
    console.log('[12] [RLS-A] Probe anon langsung ke PostgREST (meniru browser)')
    // SELECT exam_questions.correct_answer → harus kosong (RLS menolak anon)
    const { data: anonQ, error: anonQErr } = await anonSupa
        .from('exam_questions').select('id, correct_answer').eq('exam_id', exam1.id)
    check('Anon SELECT exam_questions → 0 baris (kebocoran kunci tertutup)', !anonQErr && Array.isArray(anonQ) && anonQ.length === 0, `rows=${anonQ?.length} err=${anonQErr?.message || '-'}`)

    // SELECT exam_submissions → harus kosong
    const { data: anonS, error: anonSErr } = await anonSupa
        .from('exam_submissions').select('id, total_score').eq('exam_id', exam1.id)
    check('Anon SELECT exam_submissions → 0 baris', !anonSErr && Array.isArray(anonS) && anonS.length === 0, `rows=${anonS?.length} err=${anonSErr?.message || '-'}`)

    // SELECT exam_answers → harus kosong
    const { data: anonA, error: anonAErr } = await anonSupa
        .from('exam_answers').select('id, points_earned').eq('submission_id', sub1Id)
    check('Anon SELECT exam_answers → 0 baris', !anonAErr && Array.isArray(anonA) && anonA.length === 0, `rows=${anonA?.length} err=${anonAErr?.message || '-'}`)

    // INSERT exam_submissions via anon → harus error (RLS block write)
    const { error: anonInsErr } = await anonSupa
        .from('exam_submissions').insert({ exam_id: exam1.id, student_id: siswaA.student.id, started_at: new Date().toISOString() })
    check('Anon INSERT exam_submissions → ditolak (RLS block write)', !!anonInsErr, `err=${anonInsErr?.message || '-'}`)

    // ---------- HASIL ----------
    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL E2E ALUR ULANGAN (exam_*) =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'E2E-EXAM-FLOW: PASS ✅' : 'E2E-EXAM-FLOW: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : null
    const delBy = (t, col, ids) => ids.length ? supabase.from(t).delete().in(col, ids) : null
    await delBy('exam_answers', 'submission_id', created.submissions)
    await del('exam_submissions', created.submissions)
    await del('exam_questions', created.questions)
    await del('exams', created.exams)
    for (const uid of created.users) await supabase.from('notifications').delete().eq('user_id', uid)
    await del('sessions', created.sessions)
    await del('student_enrollments', created.enrollments)
    await del('students', created.students)
    await del('teaching_assignments', created.tas)
    await del('teachers', created.teachers)
    await del('classes', created.classes)
    await del('subjects', created.subjects)
    await del('users', created.users)
    console.log('cleanup selesai')
}

main()
    .catch(async e => {
        console.error('ERROR:', e.message)
        process.exitCode = 1
        if (server) await stopServerSafe(server, BASE).catch(() => { })
    })
    .finally(cleanup)
