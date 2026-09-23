/**
 * E2E SMOKE TEST perbaikan bug 42703 (classes.school_id tidak ada) — commit
 * "fix(notifikasi): hapus query classes.school_id yang tidak ada".
 *
 * Empat jalur yang diperbaiki diuji END-TO-END lewat app betulan (next start
 * + env staging, diverifikasi assertServerDb):
 *
 *  [S1] GET /api/schedules/[id] sebagai admin sekolah → 200, embed class tanpa
 *       school_id, academic_year.school_id terisi (filter via academic_years)
 *  [S2] Isolasi antar-sekolah: admin sekolah LAIN GET/PUT/DELETE schedule
 *       sekolah ini → ditolak (404/500), data tidak bocor
 *  [S3] PUT + DELETE /api/schedules/[id] oleh admin yang benar → 200
 *  [S4] Jalur notifikasi guru (teacherNotifyBuffer — sumber error 42703 tiap
 *       1-2 menit di prod): siswa submit ulangan → tunggu flush 60 dtk →
 *       notifikasi SUBMISSION_ULANGAN ke guru MUNCUL (sebelum fix: mati)
 *  [S5] Regresi alur inti: guru buat ulangan → publish → siswa start →
 *       autosave → submit → skor otomatis (paritas e2e_exam_flow versi ringkas)
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_smoke_fix42703.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PORT = 3101
const BASE = `http://localhost:${PORT}`
const FLUSH_WAIT_MS = 75_000 // flush teacherNotifyBuffer = 60 dtk + margin

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], exams: [], questions: [], submissions: [],
    enrollments: [], schedules: [], entries: [], schools: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
    const runId = Date.now() % 100000
    const U = `fx_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    // Sekolah kedua — untuk uji isolasi antar-sekolah (S2)
    const schoolB = await mustInsert(supabase, 'schools', {
        name: `${U} School B`, code: `FXB${runId}`, school_level: 'SMP', is_active: true, max_students: 100, max_teachers: 20,
    }, 'school B')
    created.schools.push(schoolB.id)

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} IPA`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const mkUser = async (label, role, schoolId) => {
        const u = await mustInsert(supabase, 'users', {
            username: `${U}_${label}`, full_name: `${U} ${label}`, password_hash: passHash,
            role, school_id: schoolId, must_change_password: false, is_locked: false,
        }, `user ${label}`)
        created.users.push(u.id)
        const tok = (await mustInsert(supabase, 'sessions', {
            user_id: u.id, token: `${U}_tok_${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString(),
        }, `session ${label}`)).token
        created.sessions.push(tok)
        return { user: u, token: tok }
    }

    const guru = await mkUser('guru', 'GURU', school.id)
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guru.user.id, school_id: school.id }, 'teacher')
    created.teachers.push(teacher.id)
    const adminA = await mkUser('admina', 'ADMIN', school.id)   // admin sekolah yang benar
    const adminB = await mkUser('adminb', 'ADMIN', schoolB.id)  // admin sekolah lain

    const classA = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class A')
    created.classes.push(classA.id)

    const taA = await mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: classA.id, subject_id: subject.id, academic_year_id: year.id }, 'TA A')
    created.tas.push(taA.id)

    const siswaU = await mustInsert(supabase, 'users', { username: `${U}_siswa`, full_name: `${U} Siswa`, password_hash: passHash, role: 'SISWA', school_id: school.id, must_change_password: false, is_locked: false }, 'user siswa')
    created.users.push(siswaU.id)
    const siswaSt = await mustInsert(supabase, 'students', { user_id: siswaU.id, nis: `${runId}s`, class_id: classA.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, 'student')
    created.students.push(siswaSt.id)
    await mustInsert(supabase, 'student_enrollments', { student_id: siswaSt.id, class_id: classA.id, academic_year_id: year.id, status: 'ACTIVE' }, 'enrollment')
    created.enrollments.push(`${runId}`)
    const siswaTok = (await mustInsert(supabase, 'sessions', { user_id: siswaU.id, token: `${U}_tok_siswa`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session siswa')).token
    created.sessions.push(siswaTok)

    console.log('fixtures OK (guru, admin A, admin B sekolah lain, siswa, TA, tahun aktif)')

    // ---------- START SERVER (env staging diwariskan; DB diverifikasi) ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ---------- S1/S3/S2: SCHEDULES [id] ----------
    console.log('[S1] GET /api/schedules/[id] — admin sekolah yang benar')
    const sched = await mustInsert(supabase, 'schedules', {
        academic_year_id: year.id, class_id: classA.id, effective_from: new Date().toISOString().slice(0, 10),
        is_active: true, notes: 'smoke 42703',
    }, 'schedule')
    created.schedules.push(sched.id)
    const entry = await mustInsert(supabase, 'schedule_entries', {
        schedule_id: sched.id, day_of_week: 1, period: 1, subject_id: subject.id,
        time_start: '07:00', time_end: '07:45', room: 'R1',
    }, 'schedule_entry')
    created.entries.push(entry.id)

    const g1 = await api(`/api/schedules/${sched.id}`, adminA.token)
    const g1Body = await g1.json().catch(() => null)
    check('GET schedule 200 (dulu 500 karena classes.school_id)', g1.status === 200, `status ${g1.status}`)
    check('embed class benar & tanpa school_id', g1Body?.class?.id === classA.id && !('school_id' in (g1Body?.class || {})), `class=${JSON.stringify(g1Body?.class)}`)
    check('academic_year.school_id terisi (filter via academic_years)', g1Body?.academic_year?.school_id === school.id, `ay=${JSON.stringify(g1Body?.academic_year)}`)
    check('entries ikut ter-embed', Array.isArray(g1Body?.entries) && g1Body.entries.length === 1, `n=${g1Body?.entries?.length}`)

    console.log('[S2] Isolasi antar-sekolah — admin sekolah lain')
    const g2 = await api(`/api/schedules/${sched.id}`, adminB.token)
    const g2Body = await g2.json().catch(() => null)
    check('GET oleh admin sekolah lain ditolak (bukan 200)', g2.status !== 200, `status ${g2.status}`)
    check('Data schedule TIDAK bocor ke sekolah lain', !g2Body?.id && !g2Body?.class && !g2Body?.entries, `body=${JSON.stringify(g2Body)?.slice(0, 80)}`)
    const p2 = await api(`/api/schedules/${sched.id}`, adminB.token, { method: 'PUT', body: JSON.stringify({ notes: 'perusuh' }) })
    check('PUT oleh admin sekolah lain ditolak', p2.status !== 200, `status ${p2.status}`)
    const d2 = await api(`/api/schedules/${sched.id}`, adminB.token, { method: 'DELETE' })
    check('DELETE oleh admin sekolah lain ditolak', d2.status !== 200, `status ${d2.status}`)
    const { data: stillThere } = await supabase.from('schedules').select('id, notes').eq('id', sched.id).maybeSingle()
    check('Schedule masih utuh & tidak diubah sekolah lain', !!stillThere && stillThere.notes === 'smoke 42703', `notes=${stillThere?.notes}`)

    console.log('[S3] PUT + DELETE oleh admin yang benar')
    const p1 = await api(`/api/schedules/${sched.id}`, adminA.token, {
        method: 'PUT',
        body: JSON.stringify({
            notes: 'smoke 42703 revisi', is_active: true,
            entries: [{ day_of_week: 2, period: 2, time_start: '08:00', time_end: '08:45', subject_id: subject.id, room: 'R2' }],
        }),
    })
    check('PUT schedule 200 (ownership via academic_years)', p1.status === 200, `status ${p1.status}`)
    const { data: afterPut } = await supabase.from('schedules').select('notes').eq('id', sched.id).single()
    const { data: newEntries } = await supabase.from('schedule_entries').select('id, room').eq('schedule_id', sched.id)
    check('Update & replace entries tersimpan', afterPut?.notes === 'smoke 42703 revisi' && newEntries?.length === 1 && newEntries[0]?.room === 'R2', `notes=${afterPut?.notes} entries=${newEntries?.length}`)
    const d1 = await api(`/api/schedules/${sched.id}`, adminA.token, { method: 'DELETE' })
    check('DELETE schedule 200', d1.status === 200, `status ${d1.status}`)
    const { data: afterDel } = await supabase.from('schedules').select('id').eq('id', sched.id).maybeSingle()
    check('Schedule terhapus', !afterDel)

    // ---------- S5: ALUR ULANGAN (regresi inti) ----------
    console.log('[S5] Alur ulangan: guru buat → publish → siswa start → autosave → submit')
    const createRes = await api('/api/exams', guru.token, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Ulangan Smoke`, description: 'smoke 42703', start_time: new Date(Date.now() - 60000).toISOString(),
            duration_minutes: 30, teaching_assignment_id: taA.id, is_randomized: false,
            max_violations: 3, show_results_immediately: true,
        }),
    })
    const exam1 = await createRes.json().catch(() => null)
    check('POST /api/exams 200', createRes.status === 200 && exam1?.id, `status ${createRes.status}`)
    created.exams.push(exam1?.id)

    const { data: insertedQs, error: qInsErr } = await supabase.from('exam_questions').insert([
        { exam_id: exam1.id, question_text: 'MC benar', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: exam1.id, question_text: 'Isian', question_type: 'SHORT_ANSWER', options: null, correct_answer: 'fotosintesis', points: 10, order_index: 1, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
    ]).select()
    if (qInsErr) throw new Error('Insert exam_questions gagal: ' + qInsErr.message)
    created.questions.push(...insertedQs.map(q => q.id))
    const mcId = insertedQs[0].id, saId = insertedQs[1].id

    const pubRes = await api(`/api/exams/${exam1.id}`, guru.token, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    check('Publish 200', pubRes.status === 200, `status ${pubRes.status}`)

    const start = await api('/api/exam-submissions', siswaTok, { method: 'POST', body: JSON.stringify({ exam_id: exam1.id }) })
    const startBody = await start.json().catch(() => null)
    check('Siswa start 200', start.status === 200 && startBody?.id, `status ${start.status}`)
    created.submissions.push(startBody?.id)

    const saveRes = await api('/api/exam-submissions', siswaTok, {
        method: 'PUT', body: JSON.stringify({ submission_id: startBody.id, answers: [{ question_id: mcId, answer: 'A' }] }),
    })
    check('Autosave 200', saveRes.status === 200, `status ${saveRes.status}`)

    const submitRes = await api('/api/exam-submissions', siswaTok, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: startBody.id, submit: true,
            answers: [{ question_id: mcId, answer: 'A' }, { question_id: saId, answer: 'fotosintesis' }],
        }),
    })
    const submitBody = await submitRes.json().catch(() => null)
    // Perilaku baru: isian TIDAK di-auto-grade di ulangan (paritas kuis) —
    // hanya MC yang dinilai otomatis (10); isian menunggu guru.
    check('Submit 200 + skor otomatis 10 (isian pending — tak di-auto-grade)', submitRes.status === 200 && submitBody?.total_score === 10, `status ${submitRes.status} total=${submitBody?.total_score}`)

    // ---------- S4: NOTIFIKASI GURU SETELAH FLUSH 60 DTK ----------
    console.log(`[S4] Tunggu flush teacherNotifyBuffer (${FLUSH_WAIT_MS / 1000}s)...`)
    await sleep(FLUSH_WAIT_MS)
    const { data: notifs } = await supabase.from('notifications')
        .select('type, title, message, link')
        .eq('user_id', guru.user.id)
        .order('created_at', { ascending: false })
    const subNotif = (notifs || []).find(n => n.type === 'SUBMISSION_ULANGAN')
    check('Notifikasi SUBMISSION_ULANGAN ke guru MUNCUL (mati sebelum fix)', !!subNotif, `notifs=${(notifs || []).length}`)
    check('Isi notifikasi benar (nama siswa + judul ulangan)',
        !!subNotif && subNotif.message.includes(siswaU.full_name) && subNotif.message.includes(exam1.title),
        `msg=${JSON.stringify(subNotif?.message)}`)

    // ---------- HASIL ----------
    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL SMOKE TEST FIX 42703 =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'SMOKE-42703: PASS ✅' : 'SMOKE-42703: FAIL ❌')
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
    await del('schedule_entries', created.entries)
    await del('schedules', created.schedules)
    await del('sessions', created.sessions)
    await delBy('student_enrollments', 'student_id', created.students)
    await del('students', created.students)
    await del('teaching_assignments', created.tas)
    await del('teachers', created.teachers)
    await del('classes', created.classes)
    await del('subjects', created.subjects)
    await del('users', created.users)
    await del('schools', created.schools)
    console.log('cleanup selesai')
}

main()
    .catch(async e => {
        console.error('ERROR:', e.message)
        process.exitCode = 1
        if (server) await stopServerSafe(server, BASE).catch(() => { })
    })
    .finally(cleanup)
