/**
 * E2E FLOW PEMBUATAN SOAL ULANGAN OLEH ADMIN — lanjutan fitur modal terpadu.
 *
 * Fitur modal terpadu (commit sebelumnya) mengarahkan admin ke editor
 * `?type=ulangan` untuk melengkapi soal. Test ini memverifikasi seluruh flow
 * CRUD soal + guard keamanan yang menyertainya:
 *
 *  [1] Admin buat draft ulangan di TA guru (alur UI baru) → guru pemilik lihat draft
 *  [2] ADMIN tambah soal ke draft ulangan TA guru → 200, soal approved (AI off)
 *  [3] GURU pemilik TA tambah soal → 200
 *  [4] Guru asing (sekolah sama): POST/PUT/DELETE soal → 403;
 *      GET questions → 404 (fix baru: bocor soal+kunci antar guru tertutup)
 *  [5] ADMIN edit soal (poin & teks) → 200
 *  [6] ADMIN hapus soal tunggal → 200
 *  [7] Publish gate: AI ON + soal draft → 400; semua approved → publish 200;
 *      soal terkunci saat exam aktif (POST → 409)
 *  [8] Guard /api/ai/hots-analyze (fix baru): SISWA → 401; guru asing → 403;
 *      guru pemilik lolos guard role/ownership (bukan 401/403)
 *  [9] Regresi: siswa kelas target tetap bisa GET questions (correct_answer
 *      ter-strip); siswa kelas lain → 404
 *  [10] Guard /api/exams/copy-questions also_publish (fix baru): soal draft
 *      → TIDAK diaktifkan (publish_blocked, paritas gate PUT); semua approved
 *      → diaktifkan. Termasuk kasus self-target (source = target).
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_admin_soal_ulangan.cjs
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
    users: [], teachers: [], students: [], sessions: [], classes: [], subjects: [],
    tas: [], exams: [], questions: [], notifications: [], submissions: [], enrollments: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `asu_${runId}`
    const PASS = 'Asu-Test-123'
    const passHash = bcrypt.hashSync(PASS, 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code, settings').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const settingsSnapshot = school.settings
    // AI review OFF untuk skenario [2]-[6] (status soal deterministik: approved).
    // Dinyalakan lagi di [7] untuk menguji publish gate.
    await supabase.from('schools').update({ settings: { ...(settingsSnapshot || {}), ai_review_enabled: false } }).eq('id', school.id)
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const adminUser = await mustInsert(supabase, 'users', { username: `${U}_admin`, full_name: `${U} Admin`, password_hash: passHash, role: 'ADMIN', school_id: school.id, must_change_password: false, is_locked: false }, 'user admin')
    created.users.push(adminUser.id)

    const mkGuru = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} ${label}`, password_hash: passHash, role: 'GURU', school_id: school.id, must_change_password: false, is_locked: false }, `user ${label}`)
        created.users.push(u.id)
        const t = await mustInsert(supabase, 'teachers', { user_id: u.id, school_id: school.id }, `teacher ${label}`)
        created.teachers.push(t.id)
        return { user: u, teacher: t }
    }
    const guruA = await mkGuru('guruA') // pemilik TA mapel X kelas A
    const guruB = await mkGuru('guruB') // guru asing — hanya mapel Y kelas B

    const subjectX = await mustInsert(supabase, 'subjects', { name: `${U} Mapel X`, school_id: school.id, kkm: 75 }, 'subject X')
    const subjectY = await mustInsert(supabase, 'subjects', { name: `${U} Mapel Y`, school_id: school.id, kkm: 75 }, 'subject Y')
    created.subjects.push(subjectX.id, subjectY.id)

    const classA = await mustInsert(supabase, 'classes', { name: `${U} 8A`, academic_year_id: year.id, grade_level: 2, school_level: 'SMP' }, 'class A')
    const classB = await mustInsert(supabase, 'classes', { name: `${U} 8B`, academic_year_id: year.id, grade_level: 2, school_level: 'SMP' }, 'class B')
    created.classes.push(classA.id, classB.id)

    const taA = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruA.teacher.id, class_id: classA.id, subject_id: subjectX.id, academic_year_id: year.id }, 'TA guruA')
    const taB = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruB.teacher.id, class_id: classB.id, subject_id: subjectY.id, academic_year_id: year.id }, 'TA guruB')
    created.tas.push(taA.id, taB.id)

    const mkStudent = async (label, cls) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} Siswa ${label.toUpperCase()}`, password_hash: passHash, role: 'SISWA', school_id: school.id, must_change_password: false, is_locked: false }, `user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}s${label}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        return st
    }
    const siswaA = await mkStudent('sa', classA) // kelas target
    const siswaB = await mkStudent('sb', classB) // kelas lain

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    const doLogin = async (username) => {
        const r = await fetch(BASE + '/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: PASS }),
        })
        const setCookie = r.headers.getSetCookie?.() || []
        const tokenCookie = setCookie.map(c => c.split(';')[0]).find(c => c.startsWith('session_token='))
        return tokenCookie ? tokenCookie.split('=')[1] : null
    }

    const tokAdmin = await doLogin(adminUser.username)
    const tokGuruA = await doLogin(guruA.user.username)
    const tokGuruB = await doLogin(guruB.user.username)
    const tokSiswaA = await doLogin(`${U}_sa`)
    const tokSiswaB = await doLogin(`${U}_sb`)
    check('login admin + 2 guru + 2 siswa', !!(tokAdmin && tokGuruA && tokGuruB && tokSiswaA && tokSiswaB))

    // ════════ [1] ADMIN BUAT DRAFT ULANGAN DI TA GURU ════════
    console.log('\n[1] Admin buat draft ulangan di TA guruA (alur UI modal terpadu)')
    const createRes = await api('/api/exams', tokAdmin, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Ulangan Soal Flow`, description: 'e2e flow soal admin',
            start_time: new Date(Date.now() + 3600000).toISOString(),
            duration_minutes: 30, teaching_assignment_id: taA.id,
            is_randomized: false, max_violations: 3, show_results_immediately: true,
        }),
    })
    const draft = createRes.ok ? await createRes.json() : null
    check('POST /api/exams oleh admin → 200 (draft)', createRes.status === 200 && !!draft?.id, `status=${createRes.status}`)
    created.exams.push(draft?.id)
    check('draft is_active=false, TA guruA', draft?.is_active === false && draft?.teaching_assignment_id === taA.id)

    // ════════ [2] ADMIN TAMBAH SOAL ════════
    console.log('\n[2] Admin tambah soal ke draft ulangan TA guru')
    const addQRes = await api(`/api/exams/${draft.id}/questions`, tokAdmin, {
        method: 'POST',
        body: JSON.stringify({
            questions: [
                { question_text: `${U} Ibu kota Indonesia?`, question_type: 'MULTIPLE_CHOICE', options: ['Jakarta', 'Bandung', 'Surabaya', 'Medan'], correct_answer: 'A', points: 5, order_index: 0, difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
                { question_text: `${U} 2+2?`, question_type: 'MULTIPLE_CHOICE', options: ['3', '4'], correct_answer: 'B', points: 5, order_index: 1, difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' },
            ],
        }),
    })
    const addedQs = addQRes.ok ? await addQRes.json() : null
    const addedList = Array.isArray(addedQs) ? addedQs : addedQs?.questions || []
    check('ADMIN POST soal ke TA guru → 200', addQRes.status === 200, `status=${addQRes.status}`)
    check('2 soal tersimpan', (addedList || []).length === 2 || addedQs?.id, `n=${addedList?.length ?? (addedQs?.id ? 1 : 0)}`)
    const qRows = Array.isArray(addedQs) ? addedQs : (addedQs?.questions || (addedQs?.id ? [addedQs] : []))
    qRows.forEach(q => created.questions.push(q.id))
    check('status soal approved (AI review off)', qRows.length === 2 && qRows.every(q => q.status === 'approved' || q.status === undefined || q.status === null), `status=[${qRows.map(q => q.status).join(',')}]`)

    // Verifikasi langsung di DB (sumber kebenaran)
    const { data: dbQs } = await supabase.from('exam_questions').select('id, status, points').eq('exam_id', draft.id)
    check('DB: 2 soal, status approved, poin tersimpan', dbQs?.length === 2 && dbQs.every(q => q.status === 'approved') && dbQs.reduce((s, q) => s + q.points, 0) === 10, `n=${dbQs?.length}, total_poin=${dbQs?.reduce((s, q) => s + q.points, 0)}`)
    const q1 = dbQs?.[0]

    // ════════ [3] GURU PEMILIK TAMBAH SOAL ════════
    console.log('\n[3] Guru pemilik TA tambah soal')
    const addQGuruRes = await api(`/api/exams/${draft.id}/questions`, tokGuruA, {
        method: 'POST',
        body: JSON.stringify({
            questions: [{ question_text: `${U} soal guru`, question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1'], correct_answer: 'A', points: 5, order_index: 2, difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' }],
        }),
    })
    const addedGuru = addQGuruRes.ok ? await addQGuruRes.json() : null
    const guruQ = Array.isArray(addedGuru) ? addedGuru[0] : addedGuru?.questions?.[0] || addedGuru
    check('GURU pemilik POST soal → 200', addQGuruRes.status === 200 && !!guruQ?.id, `status=${addQGuruRes.status}`)
    if (guruQ?.id) created.questions.push(guruQ.id)

    // ════════ [4] GURU ASING DITOLAK ════════
    console.log('\n[4] Guru asing (sekolah sama, TA orang lain) → ditolak semua')
    const alienPost = await api(`/api/exams/${draft.id}/questions`, tokGuruB, {
        method: 'POST',
        body: JSON.stringify({ questions: [{ question_text: 'soal nakal', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'A', points: 1, order_index: 9 }] }),
    })
    check('guru asing POST soal → 403', alienPost.status === 403, `status=${alienPost.status}`)

    const alienPut = await api(`/api/exams/${draft.id}/questions`, tokGuruB, {
        method: 'PUT', body: JSON.stringify({ question_id: q1?.id, points: 100 }),
    })
    check('guru asing PUT soal → 403', alienPut.status === 403, `status=${alienPut.status}`)

    const alienDel = await api(`/api/exams/${draft.id}/questions?question_id=${q1?.id}`, tokGuruB, { method: 'DELETE' })
    check('guru asing DELETE soal → 403', alienDel.status === 403, `status=${alienDel.status}`)

    const alienGet = await api(`/api/exams/${draft.id}/questions`, tokGuruB)
    check('guru asing GET questions → 404 (fix: bocor kunci tertutup)', alienGet.status === 404, `status=${alienGet.status}`)

    // ════════ [5] ADMIN EDIT SOAL ════════
    console.log('\n[5] Admin edit soal (poin & teks)')
    const editPts = await api(`/api/exams/${draft.id}/questions`, tokAdmin, {
        method: 'PUT', body: JSON.stringify({ question_id: q1?.id, points: 7 }),
    })
    check('ADMIN PUT ubah poin → 200', editPts.status === 200, `status=${editPts.status}`)

    const editText = await api(`/api/exams/${draft.id}/questions`, tokAdmin, {
        method: 'PUT', body: JSON.stringify({ question_id: q1?.id, question_text: `${U} Ibu kota Indonesia (revisi)?` }),
    })
    check('ADMIN PUT ubah teks → 200', editText.status === 200, `status=${editText.status}`)

    const { data: q1After } = await supabase.from('exam_questions').select('question_text, points, status').eq('id', q1?.id).single()
    check('DB: poin=7 + teks revisi tersimpan', q1After?.points === 7 && q1After?.question_text?.includes('(revisi)'), `poin=${q1After?.points}`)
    check('AI off: edit konten tidak menurunkan status ke draft', q1After?.status === 'approved', `status=${q1After?.status}`)

    // ════════ [6] ADMIN HAPUS SOAL ════════
    console.log('\n[6] Admin hapus soal tunggal')
    const delRes = await api(`/api/exams/${draft.id}/questions?question_id=${guruQ?.id}`, tokAdmin, { method: 'DELETE' })
    check('ADMIN DELETE soal → 200', delRes.status === 200, `status=${delRes.status}`)
    const { data: qGone } = await supabase.from('exam_questions').select('id').eq('id', guruQ?.id)
    check('DB: soal terhapus', (qGone || []).length === 0)

    // ════════ [7] PUBLISH GATE + LOCK SOAL SAAT AKTIF ════════
    console.log('\n[7] Publish gate (AI ON) + kunci soal saat exam aktif')
    // Nyalakan AI review → set 1 soal ke draft → publish harus ditolak
    await supabase.from('schools').update({ settings: { ...(settingsSnapshot || {}), ai_review_enabled: true } }).eq('id', school.id)
    await supabase.from('exam_questions').update({ status: 'draft' }).eq('id', q1?.id)

    const pubBlocked = await api(`/api/exams/${draft.id}`, tokAdmin, {
        method: 'PUT', body: JSON.stringify({ is_active: true }),
    })
    check('publish dengan soal draft (AI ON) → 400', pubBlocked.status === 400, `status=${pubBlocked.status}`)

    await supabase.from('exam_questions').update({ status: 'approved' }).eq('exam_id', draft.id)
    const pubOk = await api(`/api/exams/${draft.id}`, tokAdmin, {
        method: 'PUT', body: JSON.stringify({ is_active: true, start_time: new Date(Date.now() - 60000).toISOString() }),
    })
    check('admin publish draft TA guru (semua soal approved) → 200', pubOk.status === 200, `status=${pubOk.status}`)

    // Exam aktif → soal terkunci
    const addWhileActive = await api(`/api/exams/${draft.id}/questions`, tokAdmin, {
        method: 'POST',
        body: JSON.stringify({ questions: [{ question_text: 'soal saat aktif', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'A', points: 1, order_index: 9 }] }),
    })
    check('POST soal saat exam AKTIF → 409 (terkunci)', addWhileActive.status === 409, `status=${addWhileActive.status}`)

    // ════════ [8] GUARD /api/ai/hots-analyze (FIX BARU) ════════
    console.log('\n[8] Guard /api/ai/hots-analyze: role + ownership')
    // Pakai soal q1 (exam aktif, milik TA guruA) — role/ownership dicek SEBELUM mutasi
    const hotsBody = { question_id: q1?.id, question_source: 'exam', question_text: 'teks soal', question_type: 'MULTIPLE_CHOICE' }
    const hotsSiswa = await api('/api/ai/hots-analyze', tokSiswaA, { method: 'POST', body: JSON.stringify(hotsBody) })
    check('SISWA panggil hots-analyze → 401 (fix: dulu terbuka semua role)', hotsSiswa.status === 401, `status=${hotsSiswa.status}`)

    const hotsAlien = await api('/api/ai/hots-analyze', tokGuruB, { method: 'POST', body: JSON.stringify(hotsBody) })
    check('guru asing (TA orang lain) → 403', hotsAlien.status === 403, `status=${hotsAlien.status}`)

    const hotsOwner = await api('/api/ai/hots-analyze', tokGuruA, { method: 'POST', body: JSON.stringify(hotsBody) })
    check('guru pemilik lolos role/ownership (bukan 401/403)', hotsOwner.status !== 401 && hotsOwner.status !== 403, `status=${hotsOwner.status} (500 wajar: GEMINI key staging dummy)`)
    const hotsAdmin = await api('/api/ai/hots-analyze', tokAdmin, { method: 'POST', body: JSON.stringify(hotsBody) })
    check('admin lolos role/ownership (bukan 401/403)', hotsAdmin.status !== 401 && hotsAdmin.status !== 403, `status=${hotsAdmin.status}`)

    // Soal palsu → 404 (tidak ada info leak)
    const hotsGhost = await api('/api/ai/hots-analyze', tokGuruA, {
        method: 'POST', body: JSON.stringify({ question_id: '00000000-0000-0000-0000-000000000000', question_source: 'exam', question_text: 'x' }),
    })
    check('soal tidak ditemukan → 404', hotsGhost.status === 404, `status=${hotsGhost.status}`)

    // ════════ [9] REGRESI: SISWA ════════
    console.log('\n[9] Regresi akses siswa')
    const siswaGet = await api(`/api/exams/${draft.id}/questions`, tokSiswaA)
    const siswaQs = siswaGet.ok ? await siswaGet.json() : []
    const leaked = (Array.isArray(siswaQs) ? siswaQs : []).filter(q => q.correct_answer !== undefined)
    check('siswa kelas target: GET questions 200 + correct_answer ter-strip', siswaGet.status === 200 && leaked.length === 0, `status=${siswaGet.status}, leaked=${leaked.length}`)

    const siswaBGet = await api(`/api/exams/${draft.id}/questions`, tokSiswaB)
    check('siswa kelas lain → 404', siswaBGet.status === 404, `status=${siswaBGet.status}`)

    // ════════ [10] GUARD copy-questions also_publish (FIX BARU) ════════
    console.log('\n[10] Guard /api/exams/copy-questions also_publish — paritas publish gate')
    // Exam draft kedua milik guruA (target copy), soal belum ada
    const draft2 = await mustInsert(supabase, 'exams', {
        title: `${U} Ulangan Target Copy`, teaching_assignment_id: taA.id,
        start_time: new Date(Date.now() + 7200000).toISOString(),
        duration_minutes: 30, is_active: false, is_randomized: false, max_violations: 3,
        created_by: guruA.user.id,
    }, 'draft2 target copy')
    created.exams.push(draft2.id)

    // [10a] Soal sumber masih draft (AI ON) + also_publish → TIDAK boleh aktif
    // (dulu: langsung is_active=true — bypass total gate, termasuk self-target)
    await supabase.from('exam_questions').update({ status: 'draft' }).eq('exam_id', draft.id)
    const copyBlocked = await api('/api/exams/copy-questions', tokGuruA, {
        method: 'POST',
        body: JSON.stringify({ source_exam_id: draft.id, target_exam_ids: [draft2.id], also_publish: true }),
    })
    const copyBlockedData = copyBlocked.ok ? await copyBlocked.json() : null
    check('copy soal draft + also_publish → 200 (copy sah)', copyBlocked.status === 200, `status=${copyBlocked.status}`)
    check('response menandai publish_blocked', Array.isArray(copyBlockedData?.publish_blocked) && copyBlockedData.publish_blocked.includes(draft2.id), `blocked=${JSON.stringify(copyBlockedData?.publish_blocked)}`)
    const { data: draft2Row } = await supabase.from('exams').select('is_active, pending_publish').eq('id', draft2.id).single()
    check('DB: target TIDAK diaktifkan (is_active=false)', draft2Row?.is_active === false, `is_active=${draft2Row?.is_active}`)

    // [10b] Self-target: source = target, soal draft → exam utama tidak boleh
    // diaktifkan lewat copy-questions
    const selfBlocked = await api('/api/exams/copy-questions', tokGuruA, {
        method: 'POST',
        body: JSON.stringify({ source_exam_id: draft.id, target_exam_ids: [draft.id], also_publish: true }),
    })
    const selfData = selfBlocked.ok ? await selfBlocked.json() : null
    check('self-target soal draft → publish_blocked (bypass total tertutup)', Array.isArray(selfData?.publish_blocked) && selfData.publish_blocked.includes(draft.id), `blocked=${JSON.stringify(selfData?.publish_blocked)}`)
    const { data: draftRow } = await supabase.from('exams').select('is_active').eq('id', draft.id).single()
    check('DB: exam utama tidak dipaksa aktif', draftRow?.is_active === true, `is_active=${draftRow?.is_active} (tetap true dari publish [7], tidak diubah)`)

    // [10c] Semua soal approved + also_publish → target diaktifkan (fitur tetap jalan)
    await supabase.from('exam_questions').update({ status: 'approved' }).eq('exam_id', draft.id)
    const copyOk = await api('/api/exams/copy-questions', tokGuruA, {
        method: 'POST',
        body: JSON.stringify({ source_exam_id: draft.id, target_exam_ids: [draft2.id], also_publish: true }),
    })
    const copyOkData = copyOk.ok ? await copyOk.json() : null
    check('copy soal approved + also_publish → 200 tanpa publish_blocked', copyOk.status === 200 && !copyOkData?.publish_blocked, `status=${copyOk.status}`)
    const { data: draft2After } = await supabase.from('exams').select('is_active').eq('id', draft2.id).single()
    check('DB: target diaktifkan (fitur copy+publish tetap jalan)', draft2After?.is_active === true, `is_active=${draft2After?.is_active}`)

    // ---------- RINGKASAN ----------
    console.log('\n════ RINGKASAN ════')
    const failed = results.filter(r => !r.ok)
    console.log(`${results.length - failed.length}/${results.length} lulus${failed.length ? ` — GAGAL: ${failed.map(f => f.name).join('; ')}` : ''}`)

    // ---------- CLEANUP ----------
    console.log('\ncleanup...')
    await supabase.from('schools').update({ settings: settingsSnapshot }).eq('id', school.id)
    const del = async (table, col, ids) => {
        if (!ids || ids.length === 0) return
        for (let i = 0; i < ids.length; i += 100) {
            await supabase.from(table).delete().in(col, ids.slice(i, i + 100))
        }
    }
    // exam_submissions (jika skenario siswa sempat buat attempt) + answers
    const { data: subs } = await supabase.from('exam_submissions').select('id').eq('exam_id', draft.id)
    for (const s of (subs || [])) {
        await supabase.from('exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('exam_submissions').delete().eq('id', s.id)
    }
    await del('notifications', 'user_id', created.users)
    await del('ai_reviews', 'question_id', created.questions)
    await del('exam_questions', 'id', created.questions)
    await del('exams', 'id', created.exams)
    await del('student_enrollments', 'id', created.enrollments)
    await del('students', 'id', created.students)
    await del('teaching_assignments', 'id', created.tas)
    await del('subjects', 'id', created.subjects)
    await del('classes', 'id', created.classes)
    await del('teachers', 'id', created.teachers)
    await del('users', 'id', created.users)
    await stopServerSafe(server, BASE)
    console.log('selesai.')
    process.exit(failed.length ? 1 : 0)
}

main().catch(async (err) => {
    console.error('FATAL:', err.message)
    try {
        if (server) await stopServerSafe(server, BASE)
    } catch { /* best effort */ }
    process.exit(1)
})
