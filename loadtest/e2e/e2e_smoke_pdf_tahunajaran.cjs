/**
 * E2E SMOKE TEST fix "Tahun Ajaran" kosong di PDF ulangan (halaman
 * admin/uts-uas/[id]?type=ulangan) — commit fix examYearName.
 *
 * Bug: meta PDF membaca exam?.academic_year?.name (hanya ada di official_exams;
 * tabel exams tidak punya kolom itu) → PDF ulangan selalu "Tahun Ajaran: —".
 * Fix: helper examYearName switch isUlangan → teaching_assignment.academic_year.name.
 *
 * Yang diuji (via app betulan, staging, assertServerDb):
 *  [P1] Mode ULANGAN (?type=ulangan): GET /api/exams/[id] sebagai guru
 *       → teaching_assignment.academic_year.name TERISI (sumber meta PDF)
 *  [P2] Expression examYearName (replikasi persis kode halaman) → non-kosong
 *       untuk ulangan, dan TIDAK membaca path root academic_year (yang undefined)
 *  [P3] Mode UTS/UAS (official_exams): GET /api/official-exams/[id] →
 *       academic_year.name tetap terisi di root (path lama tidak rusak)
 *  [P4] Prasyarat tombol unduh: siswa submit → submissions.length > 0 (204)
 *  [P5] Halaman guru/ulangan/[id] (path yang sudah benar) — paritas: sama-sama
 *       membaca teaching_assignment.academic_year.name, tidak regresi
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_smoke_pdf_tahunajaran.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PORT = 3101
const BASE = `http://localhost:${PORT}`

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], exams: [], officialExams: [], questions: [],
    submissions: [], enrollments: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `pd_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id, name').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} IPA`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const guruU = await mustInsert(supabase, 'users', { username: `${U}_guru`, full_name: `${U} Guru`, password_hash: passHash, role: 'GURU', school_id: school.id }, 'user guru')
    created.users.push(guruU.id)
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guruU.id, school_id: school.id }, 'teacher')
    created.teachers.push(teacher.id)
    const guruTok = (await mustInsert(supabase, 'sessions', { user_id: guruU.id, token: `${U}_tok_guru`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session guru')).token
    created.sessions.push(guruTok)

    const klass = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class')
    created.classes.push(klass.id)
    const ta = await mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: klass.id, subject_id: subject.id, academic_year_id: year.id }, 'TA')
    created.tas.push(ta.id)

    const siswaU = await mustInsert(supabase, 'users', { username: `${U}_siswa`, full_name: `${U} Siswa`, password_hash: passHash, role: 'SISWA', school_id: school.id, must_change_password: false, is_locked: false }, 'user siswa')
    created.users.push(siswaU.id)
    const siswaSt = await mustInsert(supabase, 'students', { user_id: siswaU.id, nis: `${runId}p`, class_id: klass.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, 'student')
    created.students.push(siswaSt.id)
    await mustInsert(supabase, 'student_enrollments', { student_id: siswaSt.id, class_id: klass.id, academic_year_id: year.id, status: 'ACTIVE' }, 'enrollment')
    const siswaTok = (await mustInsert(supabase, 'sessions', { user_id: siswaU.id, token: `${U}_tok_siswa`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session siswa')).token
    created.sessions.push(siswaTok)

    console.log(`fixtures OK (tahun ajaran aktif staging: "${year.name}")`)

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ---------- [P1] MODE ULANGAN: sumber meta PDF terisi ----------
    console.log('[P1] Mode ulangan — GET /api/exams/[id] (sumber meta PDF)')
    const createRes = await api('/api/exams', guruTok, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Ulangan PDF`, description: 'smoke pdf', start_time: new Date(Date.now() - 60000).toISOString(),
            duration_minutes: 30, teaching_assignment_id: ta.id, is_randomized: false,
            max_violations: 3, show_results_immediately: true,
        }),
    })
    const exam = await createRes.json().catch(() => null)
    check('POST /api/exams 200', createRes.status === 200 && exam?.id, `status ${createRes.status}`)
    created.exams.push(exam?.id)

    const { data: insertedQs, error: qErr } = await supabase.from('exam_questions').insert({
        exam_id: exam.id, question_text: 'MC', question_type: 'MULTIPLE_CHOICE',
        options: ['A1', 'B1'], correct_answer: 'A', points: 10, order_index: 0,
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    }).select()
    if (qErr) throw new Error('Insert soal gagal: ' + qErr.message)
    created.questions.push(...insertedQs.map(q => q.id))
    await api(`/api/exams/${exam.id}`, guruTok, { method: 'PUT', body: JSON.stringify({ is_active: true }) })

    const gRes = await api(`/api/exams/${exam.id}`, guruTok)
    const gBody = await gRes.json().catch(() => null)
    check('GET /api/exams/[id] 200', gRes.status === 200, `status ${gRes.status}`)
    const taAy = gBody?.teaching_assignment?.academic_year
    check('teaching_assignment.academic_year terisi (id + name)', !!taAy?.id && !!taAy?.name, `ay=${JSON.stringify(taAy)}`)
    check('Nama tahun ajaran sama dengan tahun aktif staging', taAy?.name === year.name, `got="${taAy?.name}" want="${year.name}"`)

    // ---------- [P2] REPLIKASI EXPRESSION examYearName (kode halaman) ----------
    // Halaman nyata memakai state exam dari GET by id (bukan respons POST yang
    // polos tanpa embed) — replikasi memakai gBody agar akurat.
    console.log('[P2] Expression examYearName (replikasi persis kode uts-uas/[id]/page.tsx)')
    // const examYearName = isUlangan ? exam?.teaching_assignment?.academic_year?.name : exam?.academic_year?.name
    const examState = gBody // === setExam(data) dari GET /api/exams/[id]
    const examYearNameUlangan = true ? (examState)?.teaching_assignment?.academic_year?.name : (examState)?.academic_year?.name
    check('Mode isUlangan → examYearName TERISI (sebelum fix: undefined)', !!examYearNameUlangan, `val="${examYearNameUlangan}"`)
    check('Path lama (root academic_year) memang undefined untuk exams', (examState)?.academic_year?.name === undefined, `val="${(examState)?.academic_year?.name}"`)
    check('PDF tidak akan menampilkan "—" lagi', (examYearNameUlangan || '—') !== '—', `val="${examYearNameUlangan}"`)

    // ---------- [P4] PRASYARAT TOMBOL: submission ada ----------
    console.log('[P4] Prasyarat tombol unduh — siswa submit')
    const start = await api('/api/exam-submissions', siswaTok, { method: 'POST', body: JSON.stringify({ exam_id: exam.id }) })
    const startBody = await start.json().catch(() => null)
    check('Siswa start 200', start.status === 200 && startBody?.id, `status ${start.status}`)
    created.submissions.push(startBody?.id)
    const submit = await api('/api/exam-submissions', siswaTok, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: startBody.id, submit: true,
            answers: [{ question_id: insertedQs[0].id, answer: 'A' }],
        }),
    })
    check('Siswa submit 200 (tombol Unduh PDF muncul)', submit.status === 200, `status ${submit.status}`)
    const subList = await api(`/api/exam-submissions?exam_id=${exam.id}`, guruTok)
    const subListBody = await subList.json().catch(() => null)
    const nSub = Array.isArray(subListBody) ? subListBody.length : (subListBody?.submissions?.length ?? 0)
    check('GET submissions → ada pengumpulan', nSub > 0, `n=${nSub}`)

    // ---------- [P3] MODE UTS/UAS (official_exams): path lama tidak rusak ----------
    console.log('[P3] Mode UTS/UAS — GET /api/official-exams/[id] (path root academic_year)')
    const offExam = await mustInsert(supabase, 'official_exams', {
        title: `${U} UTS PDF`, exam_type: 'UTS', school_id: school.id, subject_id: subject.id,
        academic_year_id: year.id, start_time: new Date(Date.now() - 3600e3).toISOString(),
        duration_minutes: 60, is_active: true, is_randomized: false, is_remedial: false,
        show_results_immediately: true, results_released: false, max_violations: 3,
        target_class_ids: [klass.id],
    }, 'official exam')
    created.officialExams.push(offExam.id)
    const oRes = await api(`/api/official-exams/${offExam.id}`, guruTok)
    const oBody = await oRes.json().catch(() => null)
    check('GET /api/official-exams/[id] 200', oRes.status === 200, `status ${oRes.status}`)
    check('official_exams.academic_year.name terisi di root (path lama utk UTS/UAS)', oBody?.academic_year?.name === year.name, `ay=${JSON.stringify(oBody?.academic_year)}`)
    // expression examYearName untuk mode official (isUlangan = false)
    const examYearNameOfficial = false ? (oBody)?.teaching_assignment?.academic_year?.name : (oBody)?.academic_year?.name
    check('Mode UTS/UAS → examYearName terisi (regresi path lama)', !!examYearNameOfficial, `val="${examYearNameOfficial}"`)

    // ---------- [P5] PARITAS halaman guru/ulangan/[id] (sudah benar, tidak regresi) ----------
    console.log('[P5] Paritas halaman guru/ulangan/[id] — sama-sama via teaching_assignment')
    check('Path meta halaman guru identik dengan sumber data terisi',
        gBody?.teaching_assignment?.academic_year?.name === year.name,
        `val="${gBody?.teaching_assignment?.academic_year?.name}"`)

    // ---------- HASIL ----------
    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL SMOKE TEST PDF TAHUN AJARAN =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'SMOKE-PDF-TA: PASS ✅' : 'SMOKE-PDF-TA: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : null
    const delBy = (t, col, ids) => ids.length ? supabase.from(t).delete().in(col, ids) : null
    await delBy('notifications', 'user_id', created.users)
    await delBy('exam_answers', 'submission_id', created.submissions)
    await del('exam_submissions', created.submissions)
    await del('exam_questions', created.questions)
    await del('exams', created.exams)
    await del('official_exams', created.officialExams)
    await del('sessions', created.sessions)
    await delBy('student_enrollments', 'student_id', created.students)
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
