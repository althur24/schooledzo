/**
 * E2E SMOKE TEST upgrade integritas kelas target + co-teaching ulangan.
 *
 * Fase yang diuji (via app betulan, staging, assertServerDb):
 *  [T1-T4] FASE A — validasi target_class_ids server-side:
 *     A1 create invalid (kelas tahun lain) → 400; valid → 200
 *     A3 PUT invalid target → 400
 *     A2 duplicate invalid target → 400
 *  [T5] FASE C — co-teaching ulangan (kelas 2 pengampu, 1 exam):
 *     C5 co-teacher melihat exam di list
 *     C4 co-teacher GET questions + monitor + grading PUT → 200
 *     C6 submit siswa → SEMUA pengampu dapat notifikasi (60 dtk flush)
 *     C7 grading-overview co-teacher memuat exam tsb
 *  [T6] C1 — batch badge kelas UNIK (2 kelas → 2; legacy 2 exam 1 kelas → 1)
 *  [T7] B2 — list official-exams menyertakan target_class_names
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_smoke_coteach_targetclass.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PORT = 3102
const BASE = `http://localhost:${PORT}`
const FLUSH_WAIT_MS = 75_000

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], exams: [], officialExams: [], questions: [],
    submissions: [], enrollments: [], years: [], schools: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const unwrap = (v) => Array.isArray(v) ? v[0] : v

async function main() {
    const runId = Date.now() % 100000
    const U = `ct_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id, name').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    // Tahun ajaran LAIN (COMPLETED) + kelasnya — untuk uji validasi target
    const oldYear = await mustInsert(supabase, 'academic_years', {
        name: `${U} tahun lama`, school_id: school.id, start_date: '2020-01-01', status: 'COMPLETED', is_active: false,
    }, 'tahun lama')
    created.years.push(oldYear.id)
    const oldClass = await mustInsert(supabase, 'classes', { name: `${U} Lama`, academic_year_id: oldYear.id, grade_level: 1, school_level: 'SMP' }, 'kelas tahun lama')
    created.classes.push(oldClass.id)

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} IPA`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    // Kelas utama — 2 pengampu (co-teaching)
    const classA = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class A')
    // Kelas kedua — untuk uji batch
    const classB = await mustInsert(supabase, 'classes', { name: `${U} 9B`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class B')
    created.classes.push(classA.id, classB.id)

    const mkGuru = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} ${label}`, password_hash: passHash, role: 'GURU', school_id: school.id, must_change_password: false, is_locked: false }, `user ${label}`)
        created.users.push(u.id)
        const t = await mustInsert(supabase, 'teachers', { user_id: u.id, school_id: school.id }, `teacher ${label}`)
        created.teachers.push(t.id)
        const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session ${label}`)).token
        created.sessions.push(tok)
        return { user: u, teacher: t, token: tok }
    }
    const guru1 = await mkGuru('guru1') // anchor
    const guru2 = await mkGuru('guru2') // co-teacher (mapel+kelas sama)
    const guru3 = await mkGuru('guru3') // kelas lain (kontrol)

    // TA: guru1 + guru2 sama mapel+kelas (co-teaching); guru3 kelas B
    const ta1 = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guru1.teacher.id, class_id: classA.id, subject_id: subject.id, academic_year_id: year.id }, 'TA guru1')
    const ta2 = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guru2.teacher.id, class_id: classA.id, subject_id: subject.id, academic_year_id: year.id }, 'TA guru2 (co-teacher)')
    const ta3 = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guru3.teacher.id, class_id: classB.id, subject_id: subject.id, academic_year_id: year.id }, 'TA guru3')
    created.tas.push(ta1.id, ta2.id, ta3.id)

    // Admin + siswa
    const adminU = await mustInsert(supabase, 'users', { username: `${U}_admin`, full_name: `${U} Admin`, password_hash: passHash, role: 'ADMIN', school_id: school.id, must_change_password: false, is_locked: false }, 'user admin')
    created.users.push(adminU.id)
    const adminTok = (await mustInsert(supabase, 'sessions', { user_id: adminU.id, token: `${U}_tok_admin`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session admin')).token
    created.sessions.push(adminTok)

    const siswaU = await mustInsert(supabase, 'users', { username: `${U}_siswa`, full_name: `${U} Siswa`, password_hash: passHash, role: 'SISWA', school_id: school.id, must_change_password: false, is_locked: false }, 'user siswa')
    created.users.push(siswaU.id)
    const siswaSt = await mustInsert(supabase, 'students', { user_id: siswaU.id, nis: `${runId}c`, class_id: classA.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, 'student')
    created.students.push(siswaSt.id)
    await mustInsert(supabase, 'student_enrollments', { student_id: siswaSt.id, class_id: classA.id, academic_year_id: year.id, status: 'ACTIVE' }, 'enrollment')
    const siswaTok = (await mustInsert(supabase, 'sessions', { user_id: siswaU.id, token: `${U}_tok_siswa`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session siswa')).token
    created.sessions.push(siswaTok)

    console.log('fixtures OK (2 guru co-teaching 1 kelas, guru kontrol kelas lain, admin, siswa, tahun lama)')

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ============ FASE A: validasi target_class_ids ============
    console.log('[T1] A1 — POST /api/official-exams valid vs invalid')
    const oeBase = {
        exam_type: 'UTS', title: `${U} UTS`, description: null,
        subject_id: subject.id, start_time: new Date(Date.now() + 3600e3).toISOString(),
        duration_minutes: 60, is_randomized: false, max_violations: 3,
        show_results_immediately: true,
    }
    const c1 = await api('/api/official-exams', adminTok, { method: 'POST', body: JSON.stringify({ ...oeBase, target_class_ids: [classA.id] }) })
    const oe1 = await c1.json().catch(() => null)
    check('Create target kelas tahun aktif → 200', c1.status === 200 && oe1?.id, `status ${c1.status}`)
    created.officialExams.push(oe1?.id)

    const c2 = await api('/api/official-exams', adminTok, { method: 'POST', body: JSON.stringify({ ...oeBase, title: `${U} UTS INVALID`, target_class_ids: [oldClass.id] }) })
    const c2Body = await c2.json().catch(() => null)
    check('Create target kelas tahun LAIN → 400 (A1)', c2.status === 400, `status ${c2.status}`)
    check('Pesan error menyebut kelas invalid', (c2Body?.error || '').includes('tidak valid'), `err=${JSON.stringify(c2Body?.error)?.slice(0, 100)}`)

    console.log('[T2] A3 — PUT target invalid → 400')
    const p1 = await api(`/api/official-exams/${oe1.id}`, adminTok, { method: 'PUT', body: JSON.stringify({ target_class_ids: [oldClass.id] }) })
    check('PUT target kelas tahun lain → 400 (A3)', p1.status === 400, `status ${p1.status}`)
    const p2 = await api(`/api/official-exams/${oe1.id}`, adminTok, { method: 'PUT', body: JSON.stringify({ target_class_ids: [classA.id, classB.id] }) })
    check('PUT target valid → 200', p2.status === 200, `status ${p2.status}`)

    console.log('[T3] A2 — duplicate target invalid → 400')
    const d1 = await api('/api/official-exams/duplicate', adminTok, {
        method: 'POST',
        body: JSON.stringify({ source_exam_id: oe1.id, title: `${U} DUPE INVALID`, start_time: new Date(Date.now() + 7200e3).toISOString(), duration_minutes: 60, target_class_ids: [oldClass.id] }),
    })
    check('Duplicate target kelas tahun lain → 400 (A2)', d1.status === 400, `status ${d1.status}`)
    const d2 = await api('/api/official-exams/duplicate', adminTok, {
        method: 'POST',
        body: JSON.stringify({ source_exam_id: oe1.id, title: `${U} DUPE OK`, start_time: new Date(Date.now() + 7200e3).toISOString(), duration_minutes: 60, target_class_ids: [classA.id] }),
    })
    const dupe = await d2.json().catch(() => null)
    check('Duplicate target valid → 200', d2.status === 200 && dupe?.id, `status ${d2.status}`)
    created.officialExams.push(dupe?.id)

    // ============ FASE C: co-teaching ulangan ============
    console.log('[T5] Co-teaching — 1 exam (anchor guru1), guru2 co-teacher')
    // Siswa hanya boleh melihat 1 ulangan untuk kelas A → buat 1 exam anchor ta1
    const e1 = await api('/api/exams', guru1.token, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Ulangan CoTeach`, description: 'smoke', start_time: new Date(Date.now() - 60000).toISOString(),
            duration_minutes: 30, teaching_assignment_id: ta1.id, is_randomized: false,
            max_violations: 3, show_results_immediately: true,
        }),
    })
    const exam1 = await e1.json().catch(() => null)
    check('Guru1 (anchor) buat ulangan → 200', e1.status === 200 && exam1?.id, `status ${e1.status}`)
    created.exams.push(exam1?.id)
    const { data: q1 } = await supabase.from('exam_questions').insert({
        exam_id: exam1.id, question_text: 'MC cot', question_type: 'MULTIPLE_CHOICE',
        options: ['A1', 'B1'], correct_answer: 'A', points: 10, order_index: 0,
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    }).select()
    created.questions.push(...q1.map(x => x.id))
    await api(`/api/exams/${exam1.id}`, guru1.token, { method: 'PUT', body: JSON.stringify({ is_active: true }) })

    // C5: guru2 (co-teacher) melihat exam di list
    const l2 = await api('/api/exams', guru2.token)
    const l2Body = await l2.json().catch(() => null)
    const seenByCo = (Array.isArray(l2Body) ? l2Body : []).find(e => e.id === exam1.id)
    check('C5: co-teacher MELIHAT exam anchor di daftarnya', !!seenByCo, `found=${!!seenByCo}`)

    // Kontrol: guru3 (kelas lain, mapel sama) TIDAK melihat
    const l3 = await api('/api/exams', guru3.token)
    const l3Body = await l3.json().catch(() => null)
    const seenBy3 = (Array.isArray(l3Body) ? l3Body : []).find(e => e.id === exam1.id)
    check('Kontrol: guru kelas lain TIDAK melihat exam', !seenBy3, `found=${!!seenBy3}`)

    // C4: co-teacher GET questions (guard co-teaching)
    const q2 = await api(`/api/exams/${exam1.id}/questions`, guru2.token)
    check('C4: co-teacher GET questions → 200', q2.status === 200, `status ${q2.status}`)

    // C4: co-teacher monitor
    const m2 = await api(`/api/exam-submissions/monitor?exam_id=${exam1.id}`, guru2.token)
    check('C4: co-teacher GET monitor → 200', m2.status === 200, `status ${m2.status}`)

    // C4: co-teacher PUT edit exam (guard canManageExamCoTaught)
    const pu2 = await api(`/api/exams/${exam1.id}`, guru2.token, { method: 'PUT', body: JSON.stringify({ description: ' Diedit co-teacher' }) })
    check('C4: co-teacher PUT edit exam → 200', pu2.status === 200, `status ${pu2.status}`)

    // Siswa submit → notifikasi ke SEMUA pengampu (C6)
    const start = await api('/api/exam-submissions', siswaTok, { method: 'POST', body: JSON.stringify({ exam_id: exam1.id }) })
    const startBody = await start.json().catch(() => null)
    created.submissions.push(startBody?.id)
    const submit = await api('/api/exam-submissions', siswaTok, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: startBody.id, submit: true, answers: [{ question_id: q1[0].id, answer: 'A' }] }),
    })
    check('Siswa submit → 200', submit.status === 200, `status ${submit.status}`)

    // C4: co-teacher grading PUT
    const gr2 = await api(`/api/exam-submissions/${startBody.id}`, guru2.token, {
        method: 'PUT',
        body: JSON.stringify({ answers: [{ question_id: q1[0].id, score: 10, answer: 'A', is_correct: true }], is_graded: true }),
    })
    check('C4: co-teacher PUT grading → 200', gr2.status === 200, `status ${gr2.status}`)

    console.log(`[C6] Tunggu flush notifikasi (${FLUSH_WAIT_MS / 1000}s)...`)
    await sleep(FLUSH_WAIT_MS)
    const { data: notif1 } = await supabase.from('notifications').select('type').eq('user_id', guru1.user.id).eq('type', 'SUBMISSION_ULANGAN')
    const { data: notif2 } = await supabase.from('notifications').select('type').eq('user_id', guru2.user.id).eq('type', 'SUBMISSION_ULANGAN')
    check('C6: notifikasi ke guru ANCHOR', (notif1 || []).length > 0, `n=${(notif1 || []).length}`)
    check('C6: notifikasi ke CO-TEACHER', (notif2 || []).length > 0, `n=${(notif2 || []).length}`)

    // C7: grading-overview co-teacher memuat exam
    const go2 = await api('/api/dashboard/guru/grading-overview', guru2.token)
    const go2Body = await go2.json().catch(() => null)
    const goItem = (go2Body?.items || []).find(i => i.id === exam1.id)
    check('C7: grading-overview co-teacher memuat exam co-taught', !!goItem, `found=${!!goItem}`)
    check('C7: exam ter-grade → ungraded 0', goItem?.ungraded_count === 0, `ungraded=${goItem?.ungraded_count}`)

    // ============ C1: batch badge kelas unik ============
    console.log('[T6] C1 — batch badge kelas unik')
    // Batch 2 exam 2 kelas (normal) — batch_id WAJIB UUID (kolom DB bertipe uuid)
    const batchId = crypto.randomUUID()
    const legacyBatchId = crypto.randomUUID()
    const b1 = await api('/api/exams', guru1.token, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Batch A`, start_time: new Date(Date.now() - 60000).toISOString(),
            duration_minutes: 30, teaching_assignment_id: ta1.id, is_randomized: false, max_violations: 3, batch_id: batchId,
        }),
    })
    const b1e = await b1.json().catch(() => null)
    created.exams.push(b1e?.id)
    const b2 = await api('/api/exams', guru3.token, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Batch B`, start_time: new Date(Date.now() - 60000).toISOString(),
            duration_minutes: 30, teaching_assignment_id: ta3.id, is_randomized: false, max_violations: 3, batch_id: batchId,
        }),
    })
    const b2e = await b2.json().catch(() => null)
    created.exams.push(b2e?.id)
    // Batch legacy: 2 exam KELAS SAMA (1 per guru — meniru data pra-fix)
    const b3 = await api('/api/exams', guru1.token, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Legacy A`, start_time: new Date(Date.now() - 60000).toISOString(),
            duration_minutes: 30, teaching_assignment_id: ta1.id, is_randomized: false, max_violations: 3, batch_id: legacyBatchId,
        }),
    })
    const b3e = await b3.json().catch(() => null)
    created.exams.push(b3e?.id)
    const b4 = await api('/api/exams', guru2.token, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Legacy B`, start_time: new Date(Date.now() - 60000).toISOString(),
            duration_minutes: 30, teaching_assignment_id: ta2.id, is_randomized: false, max_violations: 3, batch_id: legacyBatchId,
        }),
    })
    const b4e = await b4.json().catch(() => null)
    created.exams.push(b4e?.id)

    const l1v = await api('/api/exams', guru1.token)
    const l1vBody = await l1v.json().catch(() => null)
    const batchA = (Array.isArray(l1vBody) ? l1vBody : []).find(e => e.id === b1e.id)
    const legacyA = (Array.isArray(l1vBody) ? l1vBody : []).find(e => e.id === b3e.id)
    check('Batch 2 exam 2 kelas → badge 2 (uniqueClassCount)', batchA?.batch_size === 2, `size=${batchA?.batch_size}`)
    check('Batch 2 exam 1 KELAS (legacy multi-guru) → badge 1', legacyA?.batch_size === 1, `size=${legacyA?.batch_size}`)
    check('Tooltip nama kelas tersedia (batch_class_names)', Array.isArray(batchA?.batch_class_names) && batchA.batch_class_names.length === 2, `names=${JSON.stringify(batchA?.batch_class_names)}`)

    // ============ B2: target_class_names di list official ============
    console.log('[T7] B2 — list official-exams menyertakan target_class_names')
    const oe = await api('/api/official-exams', adminTok)
    const oeBody = await oe.json().catch(() => null)
    const oeRow = (Array.isArray(oeBody) ? oeBody : []).find(e => e.id === oe1.id)
    check('target_class_names terisi (aligned dgn ids)', Array.isArray(oeRow?.target_class_names) && oeRow.target_class_names.length === 2, `names=${JSON.stringify(oeRow?.target_class_names)}`)

    // ---------- HASIL ----------
    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL SMOKE COTEACH + TARGET CLASS =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'SMOKE-COTEACH: PASS ✅' : 'SMOKE-COTEACH: FAIL ❌')
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
    await del('academic_years', created.years)
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
