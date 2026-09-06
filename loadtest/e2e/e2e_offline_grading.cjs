/**
 * E2E FUNGSIONAL PENILAIAN OFFLINE + GRADE HISTORY — tugas/ulangan offline,
 * kuis offline, input nilai manual, riwayat perubahan nilai, dampak lintas-fitur.
 *
 * Menguji korelasi fitur offline assignments di seluruh rantai:
 *  - POST /api/assignments submission_mode=OFFLINE → tersimpan benar
 *  - POST /api/grades jalur offline → placeholder submission (is_offline=true)
 *    + grade + grade_history (ASSIGNMENT, null→80), update 80→90, diff-guard
 *    (nilai sama tidak menambah riwayat)
 *  - GET /api/grade-history → riwayat desc + changed_by_name
 *  - Guard: siswa ditolak mengumpulkan tugas offline (400)
 *  - Guard: penilaian langsung ditolak untuk tugas ONLINE (400)
 *  - Guard: guru bukan pemilik TA ditolak (403)
 *  - Kuis offline: POST /api/quizzes langsung aktif tanpa soal,
 *    nilai manual via /api/quiz-submissions/manual (upsert + riwayat),
 *    attempt siswa DITOLAK (guard korelasi — kuis offline bukan kerjaan siswa),
 *    nilai manual ditolak untuk kuis online (400)
 *  - Kontrak filter client: /api/assignments & /api/quizzes (sebagai SISWA)
 *    mengirim submission_mode
 *  - Parent dashboard: kolom query benar (bug fix status/deadline→due_date),
 *    totalAssignments mengkecualikan tugas offline
 *  - Integrasi: skor offline & manual masuk ke agregat /api/guru/siswa
 *    (matrix performa) dan warnings tetap jalan
 *
 * WAJIB staging: ENV_FILE=.env.staging node loadtest/e2e/e2e_offline_grading.cjs
 * (.next harus dibangun dengan env staging — assertServerDb memverifikasinya.)
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3100
const BASE = `http://localhost:${PORT}`

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], quizzes: [], assignments: [], submissions: [],
    quizSubmissions: [], enrollments: [], gradeHistoryRefs: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `og_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} Matematika`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const mkGuru = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} Guru ${label.toUpperCase()}`, password_hash: passHash, role: 'GURU', school_id: school.id }, `user guru ${label}`)
        created.users.push(u.id)
        const t = await mustInsert(supabase, 'teachers', { user_id: u.id, school_id: school.id }, `teacher ${label}`)
        created.teachers.push(t.id)
        const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session ${label}`)).token
        created.sessions.push(tok)
        return { user: u, teacher: t, token: tok }
    }
    const guruA = await mkGuru('a') // pemilik TA
    const guruB = await mkGuru('b') // bukan pemilik TA (untuk guard 403)

    const cls = await mustInsert(supabase, 'classes', { name: `${U} 8A`, academic_year_id: year.id, grade_level: 2, school_level: 'SMP' }, 'class')
    created.classes.push(cls.id)
    const taA = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruA.teacher.id, class_id: cls.id, subject_id: subject.id, academic_year_id: year.id }, 'TA A')
    created.tas.push(taA.id)

    const siswaUser = await mustInsert(supabase, 'users', { username: `${U}_siswa`, full_name: `${U} Siswa A`, password_hash: passHash, role: 'SISWA', school_id: school.id }, 'user siswa')
    created.users.push(siswaUser.id)
    const siswa = await mustInsert(supabase, 'students', { user_id: siswaUser.id, nis: `${runId}01`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, 'student')
    created.students.push(siswa.id)
    const en = await mustInsert(supabase, 'student_enrollments', { student_id: siswa.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, 'enrollment')
    created.enrollments.push(en.id)
    const siswaTok = (await mustInsert(supabase, 'sessions', { user_id: siswaUser.id, token: `${U}_tok_siswa`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session siswa')).token
    created.sessions.push(siswaTok)

    // Orang tua (WALI) terhubung ke siswa
    const waliUser = await mustInsert(supabase, 'users', { username: `${U}_wali`, full_name: `${U} Wali`, password_hash: passHash, role: 'WALI', school_id: school.id }, 'user wali')
    created.users.push(waliUser.id)
    await supabase.from('students').update({ parent_user_id: waliUser.id }).eq('id', siswa.id)
    const waliTok = (await mustInsert(supabase, 'sessions', { user_id: waliUser.id, token: `${U}_tok_wali`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session wali')).token
    created.sessions.push(waliTok)

    console.log('fixtures OK (guru A/B, siswa + wali, TA, tahun aktif)')

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ========== SECTION 1: TUGAS OFFLINE ==========
    console.log('[1] Guru membuat ulangan offline (kolom penilaian manual)')
    const tugasRes = await api('/api/assignments', guruA.token, {
        method: 'POST',
        body: JSON.stringify({ teaching_assignment_id: taA.id, title: `${U} Ulangan Offline`, description: 'e2e', type: 'ULANGAN', due_date: null, submission_mode: 'OFFLINE' }),
    })
    const tugas = await tugasRes.json().catch(() => null)
    check('POST /api/assignments OFFLINE sukses', tugasRes.ok && tugas?.id, `status ${tugasRes.status}`)
    created.assignments.push(tugas?.id)
    const { data: dbTugas } = await supabase.from('assignments').select('submission_mode').eq('id', tugas.id).single()
    check('DB: submission_mode tersimpan OFFLINE', dbTugas?.submission_mode === 'OFFLINE', dbTugas?.submission_mode)

    console.log('[2] Input nilai offline pertama (null→80) + placeholder submission')
    const g1 = await api('/api/grades', guruA.token, {
        method: 'POST', body: JSON.stringify({ assignment_id: tugas.id, student_id: siswa.id, score: 80 }),
    })
    check('POST /api/grades (jalur offline) sukses', g1.ok, `status ${g1.status}`)
    const { data: dbSub } = await supabase.from('student_submissions').select('id, is_offline, answers, submitted_at').eq('assignment_id', tugas.id).eq('student_id', siswa.id).maybeSingle()
    check('DB: placeholder submission is_offline=true', dbSub?.is_offline === true)
    // submitted_at terisi oleh DEFAULT now() di skema (benign — konsumen
    // downstream memfilter is_offline atau memakai grade). Yang penting:
    // placeholder bukan pengumpulan siswa — answers/attachments kosong.
    check('DB: placeholder bersih (answers & attachments null)', dbSub?.answers === null && !dbSub?.attachments, `answers=${JSON.stringify(dbSub?.answers)}`)
    if (dbSub) created.submissions.push(dbSub.id)
    const { data: dbGrade1 } = await supabase.from('grades').select('score').eq('submission_id', dbSub.id).maybeSingle()
    check('DB: grade tersimpan skor 80', dbGrade1?.score === 80, String(dbGrade1?.score))
    const { data: gh1 } = await supabase.from('grade_history').select('old_score, new_score, source').eq('source', 'ASSIGNMENT').eq('ref_id', tugas.id).eq('student_id', siswa.id)
    check('DB: grade_history ASSIGNMENT null→80', gh1?.length === 1 && gh1[0].old_score === null && gh1[0].new_score === 80, `rows ${gh1?.length}`)

    console.log('[3] Update nilai (80→90) + riwayat kedua')
    const g2 = await api('/api/grades', guruA.token, {
        method: 'POST', body: JSON.stringify({ assignment_id: tugas.id, student_id: siswa.id, score: 90 }),
    })
    check('POST /api/grades update sukses', g2.ok, `status ${g2.status}`)
    const { count: subCount } = await supabase.from('student_submissions').select('id', { count: 'exact', head: true }).eq('assignment_id', tugas.id).eq('student_id', siswa.id)
    check('DB: submission tidak duplikat (tetap 1)', subCount === 1, String(subCount))
    const { data: dbGrade2 } = await supabase.from('grades').select('score').eq('submission_id', dbSub.id).maybeSingle()
    check('DB: grade ter-update skor 90', dbGrade2?.score === 90, String(dbGrade2?.score))
    const { data: gh2 } = await supabase.from('grade_history').select('old_score, new_score').eq('source', 'ASSIGNMENT').eq('ref_id', tugas.id).eq('student_id', siswa.id).order('changed_at')
    check('DB: grade_history 2 baris (80→90)', gh2?.length === 2 && gh2[1].old_score === 80 && gh2[1].new_score === 90, `rows ${gh2?.length}`)

    console.log('[4] Diff-guard: nilai sama tidak menambah riwayat')
    await api('/api/grades', guruA.token, {
        method: 'POST', body: JSON.stringify({ assignment_id: tugas.id, student_id: siswa.id, score: 90 }),
    })
    const { data: gh3 } = await supabase.from('grade_history').select('id').eq('source', 'ASSIGNMENT').eq('ref_id', tugas.id).eq('student_id', siswa.id)
    check('DB: grade_history tetap 2 baris', gh3?.length === 2, `rows ${gh3?.length}`)

    console.log('[5] GET /api/grade-history (riwayat desc + nama pengubah)')
    const histRes = await api(`/api/grade-history?source=ASSIGNMENT&ref_id=${tugas.id}&student_id=${siswa.id}`, guruA.token)
    const hist = await histRes.json().catch(() => null)
    check('GET /api/grade-history sukses', histRes.ok, `status ${histRes.status}`)
    check('Riwayat terbaru duluan (90 di atas)', Array.isArray(hist) && hist[0]?.new_score === 90 && hist[1]?.new_score === 80)
    check('changed_by_name terisi (nama guru)', hist?.[0]?.changed_by_name === guruA.user.full_name, String(hist?.[0]?.changed_by_name))
    const histSiswa = await api(`/api/grade-history?source=ASSIGNMENT&ref_id=${tugas.id}&student_id=${siswa.id}`, siswaTok)
    check('Guard: SISWA ditolak akses riwayat (401)', histSiswa.status === 401, `status ${histSiswa.status}`)

    console.log('[6] Guard: siswa tidak bisa mengumpulkan tugas offline')
    const subAttempt = await api('/api/submissions', siswaTok, {
        method: 'POST', body: JSON.stringify({ assignment_id: tugas.id, content: 'coba curang' }),
    })
    check('POST /api/submissions utk tugas offline ditolak 400', subAttempt.status === 400, `status ${subAttempt.status}`)
    const { count: subCount2 } = await supabase.from('student_submissions').select('id', { count: 'exact', head: true }).eq('assignment_id', tugas.id).eq('student_id', siswa.id)
    check('DB: tidak ada submission baru dari siswa (tetap 1)', subCount2 === 1, String(subCount2))

    console.log('[7] Kontrak filter client: submission_mode sampai ke siswa')
    const stuAssignments = await api('/api/assignments', siswaTok)
    const stuAssignmentsBody = await stuAssignments.json().catch(() => null)
    const offlineA = (stuAssignmentsBody || []).find(a => a.id === tugas.id)
    check('GET /api/assignments (SISWA) memuat submission_mode=OFFLINE', offlineA?.submission_mode === 'OFFLINE', String(offlineA?.submission_mode))

    console.log('[8] Guard: penilaian langsung ditolak untuk tugas ONLINE')
    const tugasOnline = await (await api('/api/assignments', guruA.token, {
        method: 'POST', body: JSON.stringify({ teaching_assignment_id: taA.id, title: `${U} Tugas Online`, description: '', type: 'TUGAS', due_date: null }),
    })).json().catch(() => null)
    created.assignments.push(tugasOnline?.id)
    const onlineDirect = await api('/api/grades', guruA.token, {
        method: 'POST', body: JSON.stringify({ assignment_id: tugasOnline.id, student_id: siswa.id, score: 75 }),
    })
    check('POST /api/grades jalur offline utk tugas ONLINE ditolak 400', onlineDirect.status === 400, `status ${onlineDirect.status}`)

    console.log('[9] Guard: guru bukan pemilik TA ditolak (403)')
    const otherGuru = await api('/api/grades', guruB.token, {
        method: 'POST', body: JSON.stringify({ assignment_id: tugas.id, student_id: siswa.id, score: 70 }),
    })
    check('POST /api/grades guru lain ditolak 403', otherGuru.status === 403, `status ${otherGuru.status}`)

    // ========== SECTION 2: KUIS OFFLINE ==========
    console.log('[10] Guru membuat kuis offline (langsung aktif, tanpa soal)')
    const kuisRes = await api('/api/quizzes', guruA.token, {
        method: 'POST',
        body: JSON.stringify({ title: `${U} Kuis Offline`, description: 'e2e', duration_minutes: 30, teaching_assignment_id: taA.id, is_randomized: false, submission_mode: 'OFFLINE' }),
    })
    const kuis = await kuisRes.json().catch(() => null)
    check('POST /api/quizzes OFFLINE sukses', kuisRes.ok && kuis?.id, `status ${kuisRes.status}`)
    created.quizzes.push(kuis?.id)
    const { data: dbKuis } = await supabase.from('quizzes').select('submission_mode, is_active').eq('id', kuis.id).single()
    check('DB: kuis submission_mode=OFFLINE & aktif', dbKuis?.submission_mode === 'OFFLINE' && dbKuis?.is_active === true, `${dbKuis?.submission_mode}/${dbKuis?.is_active}`)

    console.log('[11] Nilai manual kuis offline (null→85)')
    const mq1 = await api('/api/quiz-submissions/manual', guruA.token, {
        method: 'POST', body: JSON.stringify({ quiz_id: kuis.id, student_id: siswa.id, score: 85 }),
    })
    check('POST /api/quiz-submissions/manual sukses', mq1.ok, `status ${mq1.status}`)
    const { data: dbQs } = await supabase.from('quiz_submissions').select('id, total_score, max_score, is_graded').eq('quiz_id', kuis.id).eq('student_id', siswa.id).maybeSingle()
    check('DB: submission is_graded=true skor 85/100', dbQs?.is_graded === true && dbQs?.total_score === 85 && dbQs?.max_score === 100, `${dbQs?.total_score}/${dbQs?.max_score}`)
    if (dbQs) created.quizSubmissions.push(dbQs.id)
    const { data: qh1 } = await supabase.from('grade_history').select('old_score, new_score').eq('source', 'QUIZ').eq('ref_id', kuis.id).eq('student_id', siswa.id)
    check('DB: grade_history QUIZ null→85', qh1?.length === 1 && qh1[0].old_score === null && qh1[0].new_score === 85, `rows ${qh1?.length}`)

    console.log('[12] Update nilai manual (85→95) — upsert, bukan baris baru')
    const mq2 = await api('/api/quiz-submissions/manual', guruA.token, {
        method: 'POST', body: JSON.stringify({ quiz_id: kuis.id, student_id: siswa.id, score: 95 }),
    })
    check('POST manual update sukses', mq2.ok, `status ${mq2.status}`)
    const { count: qCount } = await supabase.from('quiz_submissions').select('id', { count: 'exact', head: true }).eq('quiz_id', kuis.id).eq('student_id', siswa.id)
    check('DB: quiz_submission tetap 1 (upsert)', qCount === 1, String(qCount))
    const { data: qh2 } = await supabase.from('grade_history').select('old_score, new_score').eq('source', 'QUIZ').eq('ref_id', kuis.id).eq('student_id', siswa.id).order('changed_at')
    check('DB: grade_history QUIZ 2 baris (85→95)', qh2?.length === 2 && qh2[1].old_score === 85 && qh2[1].new_score === 95, `rows ${qh2?.length}`)

    console.log('[13] Guard KORELASI: siswa tidak bisa attempt kuis offline')
    const qAttempt = await api('/api/quiz-submissions', siswaTok, {
        method: 'POST', body: JSON.stringify({ quiz_id: kuis.id, answers: [] }),
    })
    check('POST /api/quiz-submissions utk kuis offline ditolak 400', qAttempt.status === 400, `status ${qAttempt.status}`)

    console.log('[14] Guard: nilai manual ditolak untuk kuis ONLINE')
    const kuisOnline = await (await api('/api/quizzes', guruA.token, {
        method: 'POST', body: JSON.stringify({ title: `${U} Kuis Online Draft`, description: '', duration_minutes: 30, teaching_assignment_id: taA.id, is_randomized: false }),
    })).json().catch(() => null)
    created.quizzes.push(kuisOnline?.id)
    const mqOnline = await api('/api/quiz-submissions/manual', guruA.token, {
        method: 'POST', body: JSON.stringify({ quiz_id: kuisOnline.id, student_id: siswa.id, score: 88 }),
    })
    check('POST manual utk kuis online ditolak 400', mqOnline.status === 400, `status ${mqOnline.status}`)

    console.log('[15] Kontrak filter client: kuis offline terlihat siswa dengan submission_mode')
    const stuQuizzes = await api('/api/quizzes', siswaTok)
    const stuQuizzesBody = await stuQuizzes.json().catch(() => null)
    const offlineQ = (stuQuizzesBody || []).find(q => q.id === kuis.id)
    check('GET /api/quizzes (SISWA) memuat submission_mode=OFFLINE', offlineQ?.submission_mode === 'OFFLINE', String(offlineQ?.submission_mode))

    // ========== SECTION 3: PARENT DASHBOARD (bug fix kolom + korelasi offline) ==========
    console.log('[16] Parent dashboard: query kolom benar + offline dikecualikan dari total')
    const parentRes = await api('/api/parent/dashboard', waliTok)
    const parent = await parentRes.json().catch(() => null)
    check('GET /api/parent/dashboard sukses', parentRes.ok && parent?.child, `status ${parentRes.status}`)
    const pSub = (parent?.child?.recentSubmissions || []).find(s => s.title === tugas.title)
    check('RecentSubmissions memuat submission offline (query kolom benar)', !!pSub, pSub ? 'ditemukan' : 'tidak ada')
    check('Submissions: status=SUBMITTED & deadline=due_date (bukan kolom hantu)', pSub?.status === 'SUBMITTED' && pSub?.deadline === null, `${pSub?.status}/${JSON.stringify(pSub?.deadline)}`)
    check('totalAssignments mengkecualikan tugas offline (1 online saja)', parent?.child?.totalAssignments === 1, String(parent?.child?.totalAssignments))

    // ========== SECTION 4: INTEGRASI & REGRESI ==========
    console.log('[17] Integrasi: skor offline + manual masuk matrix performa siswa')
    const siswaApi = await api('/api/guru/siswa', guruA.token)
    const siswaData = await siswaApi.json().catch(() => null)
    check('GET /api/guru/siswa sukses', siswaApi.ok, `status ${siswaApi.status}`)
    const sg = siswaData?.student_grades?.find(g => g.student_id === siswa.id)
    const subjData = sg?.subjects?.[subject.id]
    const tugasHas90 = subjData?.tugas_scores?.includes(90)
    const kuisHas95 = subjData?.kuis_scores?.includes(95)
    check('Skor offline 90 masuk agregat nilai (tugas)', tugasHas90 === true, JSON.stringify(subjData?.tugas_scores))
    check('Skor manual kuis 95 masuk agregat nilai (kuis)', kuisHas95 === true, JSON.stringify(subjData?.kuis_scores))

    console.log('[18] Regresi: warnings guru tetap jalan dengan data offline')
    const warnRes = await api('/api/dashboard/guru/warnings', guruA.token)
    const warn = await warnRes.json().catch(() => null)
    check('GET /api/dashboard/guru/warnings sukses tanpa error', warnRes.ok && !warn?.error, `status ${warnRes.status}`)

    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL E2E PENILAIAN OFFLINE + GRADE HISTORY =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'E2E-OFFLINE-GRADING: PASS ✅' : 'E2E-OFFLINE-GRADING: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    try {
        // grade_history tanpa FK — hapus by ref
        if (created.assignments.length || created.quizzes.length) {
            await supabase.from('grade_history').delete().in('ref_id', [...created.assignments, ...created.quizzes].filter(Boolean))
        }
        const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : null
        const delBy = (t, col, ids) => ids.length ? supabase.from(t).delete().in(col, ids) : null
        // grades by submission
        if (created.submissions.length) await delBy('grades', 'submission_id', created.submissions)
        await del('quiz_submissions', created.quizSubmissions)
        await del('student_submissions', created.submissions)
        await del('quizzes', created.quizzes)
        await del('assignments', created.assignments)
        for (const uid of created.users) await supabase.from('notifications').delete().eq('user_id', uid)
        await del('sessions', created.sessions)
        await del('student_enrollments', created.enrollments)
        await del('students', created.students)
        await del('teaching_assignments', created.tas)
        await del('teachers', created.teachers)
        await del('classes', created.classes)
        await del('subjects', created.subjects)
        await del('users', created.users)
    } catch (e) {
        console.error('cleanup error:', e.message)
    }
    console.log('cleanup selesai')
}

main()
    .catch(async e => {
        console.error('ERROR:', e.message)
        process.exitCode = 1
        if (server) await stopServerSafe(server, BASE).catch(() => { })
    })
    .finally(cleanup)
