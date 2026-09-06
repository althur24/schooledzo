/**
 * E2E SMOKE SUITE FITUR — verifikasi area yang belum punya test otomatis,
 * khususnya yang terdampak perubahan sesi ini (RLS lockdown, service-key strict,
 * storagePublicUrl) DAN perubahan user yang belum di-commit (reset attempt
 * guru dari monitor live + otorisasi canTeachStudentSubmission).
 *
 * Skenario (fixture mandiri STG01, dibersihkan di akhir):
 *  [1]  Login per role via /api/auth/login (password fixture nyata, bcrypt)
 *  [2]  Materi rantai penuh: sign upload → PUT R2 (presigned) → create → scope kelas
 *       siswa & TA guru → public URL → DELETE → hilang
 *  [3]  Upload tugas online + audio (route strict service-key)
 *  [4]  Jadwal: admin POST schedule+entries → siswa GET student-schedule scoped
 *  [5]  Bank soal: guru POST → GET scope → PUT edit → DELETE
 *  [6]  Pengumuman: admin POST → siswa GET
 *  [7]  Grading UTS/UAS manual: PUT official-exam-submissions/[id] grades
 *  [8]  RESET ATTEMPT (kode user, belum di-commit): monitor kirim submission_id;
 *       GURU soft reset (ulangan & official) → is_submitted=false, jawaban tetap;
 *       GURU hard reset → jawaban terhapus + timer_override_until;
 *       GURU kelas salah → 403; ADMIN reset → 200
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_smoke_features.cjs
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
    subjects: [], tas: [], materials: [], quizzes: [], questions: [],
    submissions: [], enrollments: [], notifications: [],
    exams: [], examQuestions: [], examSubmissions: [], examAnswers: [],
    officialExams: [], officialQuestions: [], officialSubmissions: [], officialAnswers: [],
    schedules: [], announcements: [], questionBank: [],
    storagePaths: [],
    r2Keys: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
    const runId = Date.now() % 100000
    const U = `smk_${runId}`
    const PASS = 'Smoke-Test-123'
    const passHash = bcrypt.hashSync(PASS, 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} Mapel`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    // Guru utama (mengajar kelas A), guru asing (mengajar kelas B)
    const mkGuru = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} ${label}`, password_hash: passHash, role: 'GURU', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const t = await mustInsert(supabase, 'teachers', { user_id: u.id, school_id: school.id }, `teacher ${label}`)
        created.teachers.push(t.id)
        return { user: u, teacher: t }
    }
    const guruA = await mkGuru('guruA')
    const guruB = await mkGuru('guruB')

    const adminUser = await mustInsert(supabase, 'users', { username: `${U}_admin`, full_name: `${U} Admin`, password_hash: passHash, role: 'ADMIN', school_id: school.id }, 'user admin')
    created.users.push(adminUser.id)

    const classA = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class A')
    const classB = await mustInsert(supabase, 'classes', { name: `${U} 9B`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class B')
    created.classes.push(classA.id, classB.id)

    const taA = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruA.teacher.id, class_id: classA.id, subject_id: subject.id, academic_year_id: year.id }, 'TA A')
    const taB = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruB.teacher.id, class_id: classB.id, subject_id: subject.id, academic_year_id: year.id }, 'TA B')
    created.tas.push(taA.id, taB.id)

    const mkStudent = async (label, cls) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} Siswa ${label.toUpperCase()}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}${label}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        return { user: u, student: st }
    }
    const siswaA = await mkStudent('sa', classA) // kelas guru A
    const siswaB = await mkStudent('sb', classB) // kelas guru B

    console.log('fixtures OK (admin, 2 guru beda kelas, 2 siswa, 2 TA)')

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ════════ [1] LOGIN PER ROLE ════════
    console.log('[1] Login via /api/auth/login (route belum pernah teruji e2e)')
    const doLogin = async (username) => {
        const r = await fetch(BASE + '/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: PASS }),
        })
        const b = await r.json().catch(() => null)
        // token dikirim via Set-Cookie httpOnly — ambil dari header
        const setCookie = r.headers.getSetCookie?.() || []
        const tokenCookie = setCookie.map(c => c.split(';')[0]).find(c => c.startsWith('session_token='))
        const token = tokenCookie ? tokenCookie.split('=')[1] : null
        return { status: r.status, body: b, token }
    }
    for (const [label, username, role] of [
        ['guru A', `${U}_guruA`, 'GURU'], ['siswa A', `${U}_sa`, 'SISWA'], ['admin', `${U}_admin`, 'ADMIN'],
    ]) {
        const { status, body, token } = await doLogin(username)
        check(`login ${label} → 200 + role ${role} + cookie session`, status === 200 && body?.user?.role === role && !!token,
            `status ${status}, role=${body?.user?.role}, cookie=${token ? 'ada' : 'HILANG'}`)
        if (token) created.sessions.push(token)
    }
    const wrongLogin = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `${U}_sa`, password: 'salah-total' }),
    })
    check('login password salah → 401', wrongLogin.status === 401, `status ${wrongLogin.status}`)

    // Session via login cookie dipakai untuk sisa suite.
    const tokGuruA = (await doLogin(`${U}_guruA`)).token
    const tokSiswaA = (await doLogin(`${U}_sa`)).token
    const tokAdmin = (await doLogin(`${U}_admin`)).token
    created.sessions.push(tokGuruA, tokSiswaA, tokAdmin)
    const tokGuruB = (await mustInsert(supabase, 'sessions', { user_id: guruB.user.id, token: `${U}_tok_guruB`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session guruB')).token
    created.sessions.push(tokGuruB)

    // ════════ [2] MATERI RANTAI PENUH ════════
    console.log('[2] Materi: sign upload → PUT R2 → create → scope → public URL → delete')
    // 2a. Sign upload (guru A) — materi upload baru via presigned PUT ke Cloudflare R2
    const signRes = await api('/api/materials/upload', tokGuruA, {
        method: 'POST', body: JSON.stringify({ filename: 'smoke materi uji.pdf', contentType: 'application/pdf' }),
    })
    const sign = await signRes.json().catch(() => null)
    check('POST /api/materials/upload sign → 200 + signedUrl R2', signRes.status === 200 && !!sign?.signedUrl, `status ${signRes.status}`)
    // 2b. PUT file ke R2 (paritas perilaku browser: PUT signedUrl + Content-Type)
    let putOk = false, publicOk = false
    if (sign?.signedUrl) {
        try {
            const put = await fetch(sign.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-smoke-materi') })
            putOk = put.status === 200
            check('PUT file ke R2 (presigned URL) → 200', putOk, `status ${put.status}`)
        } catch (e) {
            check('PUT file ke R2 (presigned URL) → 200', false, `fetch error: ${e.message} | cause: ${e.cause?.message || e.cause?.code || '?'}`)
        }
        if (sign.path) created.r2Keys.push(sign.path)
        try {
            const pub = await fetch(sign.publicUrl)
            publicOk = pub.status === 200
            check('public URL materi R2 bisa dibaca (paritas publicR2Url)', publicOk, `status ${pub.status}`)
        } catch (e) {
            check('public URL materi R2 bisa dibaca (paritas publicR2Url)', false, `fetch error: ${e.message} | cause: ${e.cause?.message || e.cause?.code || '?'}`)
        }
    } else {
        check('PUT file ke R2 (presigned URL) → 200', false, 'sign gagal')
        check('public URL materi R2 bisa dibaca (paritas publicR2Url)', false, 'sign gagal')
    }
    // 2c. Create materi untuk kelas A & B (type harus enum: PDF/VIDEO/TEXT/LINK).
    // Respons route = { created: n, items: [...] } (satu baris per TA).
    const matARes = await api('/api/materials', tokGuruA, {
        method: 'POST',
            body: JSON.stringify({ title: `${U} Materi Kelas A`, type: 'PDF', content_url: sign?.publicUrl || 'x', teaching_assignment_id: taA.id }),
    })
    const matAJson = await matARes.json().catch(() => null)
    const matA = Array.isArray(matAJson?.items) ? matAJson.items[0] : (Array.isArray(matAJson) ? matAJson[0] : matAJson)
    check('POST /api/materials (kelas A) → 200', matARes.status === 200 && !!matA?.id, `status ${matARes.status} ${matAJson?.error || ''}`)
    if (matA?.id) created.materials.push(matA.id)
    const matBRes = await api('/api/materials', tokGuruB, {
        method: 'POST',
        body: JSON.stringify({ title: `${U} Materi Kelas B`, type: 'TEXT', content_text: 'isi b', teaching_assignment_id: taB.id }),
    })
    const matBJson = await matBRes.json().catch(() => null)
    const matB = Array.isArray(matBJson?.items) ? matBJson.items[0] : (Array.isArray(matBJson) ? matBJson[0] : matBJson)
    check('POST /api/materials (kelas B, guru B) → 200', matBRes.status === 200 && !!matB?.id, `status ${matBRes.status}`)
    if (matB?.id) created.materials.push(matB.id)
    // 2d. Scope: siswa A hanya lihat materi kelas A
    const matSiswaARes = await api('/api/materials', tokSiswaA)
    const matSiswaA = await matSiswaARes.json().catch(() => null)
    const matSiswaAArr = Array.isArray(matSiswaA) ? matSiswaA : []
    check('GET /api/materials siswa A → 200 array', matSiswaARes.status === 200 && Array.isArray(matSiswaA), `status ${matSiswaARes.status}`)
    const ownCount = matSiswaAArr.filter(m => m.title === `${U} Materi Kelas A`).length
    const leakCount = matSiswaAArr.filter(m => m.title === `${U} Materi Kelas B`).length
    check('siswa A melihat materi kelasnya sendiri', ownCount === 1, `own=${ownCount}`)
    check('siswa A TIDAK melihat materi kelas lain', leakCount === 0, `leak=${leakCount}`)
    check('semua materi siswa A embed class.id (filter client)', matSiswaAArr.every(m => m.teaching_assignment?.class?.id !== undefined))
    // 2e. Guru scope: guru A tidak melihat materi TA guru B
    const matGuruA = await (await api('/api/materials', tokGuruA)).json().catch(() => null)
    check('guru A tidak melihat materi TA guru B', (Array.isArray(matGuruA) ? matGuruA : []).every(m => m.teaching_assignment?.id !== taB.id))
    // 2f. DELETE → hilang dari daftar siswa
    if (matA?.id) {
        const delRes = await api(`/api/materials/${matA.id}`, tokGuruA, { method: 'DELETE' })
        check('DELETE /api/materials/[id] → 200', delRes.status === 200, `status ${delRes.status}`)
        const after = await (await api('/api/materials', tokSiswaA)).json().catch(() => null)
        check('materi terhapus hilang dari daftar siswa', !(Array.isArray(after) ? after : []).some(m => m.id === matA.id))
    }

    // ════════ [3] UPLOAD TUGAS ONLINE + AUDIO ════════
    console.log('[3] Upload tugas online & audio (route strict service-key)')
    // Route ini menerima FormData dengan field 'file' (server-side upload).
    // PENTING: JANGAN set Content-Type untuk FormData (fetch yang generate multipart
    // boundary) — makeApi default JSON header justru merusaknya.
    {
        const postForm = (path, token, fd) => fetch(`${BASE}${path}`, {
            method: 'POST',
            headers: { Cookie: `session_token=${token}` },
            body: fd,
        })
        const fd = new FormData()
        fd.append('file', new Blob([Buffer.from('smoke-tugas-jpg')], { type: 'image/jpeg' }), 'tugas-smoke.jpg')
        let tugasRes = await postForm('/api/submissions/upload', tokSiswaA, fd)
        let tugasBody = await tugasRes.json().catch(() => null)
        const tugasOk = tugasRes.status === 200 && !!tugasBody?.url
        check('POST /api/submissions/upload (FormData) → 200 + url', tugasOk, `status ${tugasRes.status} ${JSON.stringify(tugasBody)?.slice(0, 150)}`)
        if (tugasBody?.url) {
            const path = tugasBody.url.split('/object/public/submissions/')[1]
            if (path) created.storagePaths.push('submissions:' + path)
        }

        const mkAudioFd = () => {
            const f = new FormData()
            f.append('file', new Blob([Buffer.from('smoke-audio-mp3')], { type: 'audio/mpeg' }), 'audio-smoke.mp3')
            return f
        }
        let audioRes = await postForm('/api/audio/upload', tokGuruA, mkAudioFd())
        let audioBody = await audioRes.json().catch(() => null)
        const audioOk = audioRes.status === 200 && !!audioBody?.url
        check('POST /api/audio/upload (FormData) → 200 + url', audioOk, `status ${audioRes.status} ${JSON.stringify(audioBody)?.slice(0, 150)}`)
        if (audioBody?.url) {
            const path = audioBody.url.split('/object/public/materials/')[1]
            if (path) created.storagePaths.push('materials:' + path)
        }
    }

    // ════════ [4] JADWAL ════════
    console.log('[4] Jadwal: admin POST → siswa GET student-schedule scoped')
    const schedRes = await api('/api/schedules', tokAdmin, {
        method: 'POST',
        body: JSON.stringify({
            class_id: classA.id, academic_year_id: year.id,
            entries: [{ day_of_week: 1, period: 1, time_start: '07:00', time_end: '07:40', subject_id: subject.id, teacher_id: guruA.teacher.id, room: 'R1' }],
        }),
    })
    const sched = await schedRes.json().catch(() => null)
    check('POST /api/schedules (admin) → 200 + entries', schedRes.status === 200 && !!sched?.id, `status ${schedRes.status} ${sched?.error || ''}`)
    if (sched?.id) created.schedules.push(sched.id)
    const siswaSched = await api('/api/schedules/student-schedule?all=true', tokSiswaA)
    const siswaSchedBody = await siswaSched.json().catch(() => null)
    const schedArr = Array.isArray(siswaSchedBody) ? siswaSchedBody : []
    const hasOwnEntry = schedArr.some(e => e.subject?.name === `${U} Mapel`)
    check('GET /api/schedules/student-schedule siswa A → 200', siswaSched.status === 200, `status ${siswaSched.status}`)
    check('jadwal kelas A terlihat siswa A (mapel fixture)', hasOwnEntry, `entries=${schedArr.length}`)

    // ════════ [5] BANK SOAL ════════
    console.log('[5] Bank soal: guru POST → GET scope → PUT edit → DELETE')
    const qbRes = await api('/api/question-bank', tokGuruA, {
        method: 'POST',
        body: JSON.stringify([{
            subject_id: subject.id, question_text: `${U} Soal bank`, question_type: 'MULTIPLE_CHOICE',
            options: ['a', 'b', 'c', 'd'], correct_answer: 'A', difficulty: 'EASY', tags: ['smoke'],
        }]),
    })
    const qb = await qbRes.json().catch(() => null)
    const qbRow = Array.isArray(qb) ? qb[0] : qb
    check('POST /api/question-bank → 200 + baris', qbRes.status === 200 && !!qbRow?.id, `status ${qbRes.status} ${qb?.error || ''}`)
    if (qbRow?.id) created.questionBank.push(qbRow.id)
    const qbList = await (await api(`/api/question-bank?search=${encodeURIComponent(U)}`, tokGuruA)).json().catch(() => null)
    const qbVisible = Array.isArray(qbList) && qbList.some(q => q.id === qbRow?.id)
    check('GET /api/question-bank menampilkan soal baru', qbVisible, `list=${Array.isArray(qbList) ? qbList.length : '?'}`)
    if (qbRow?.id) {
        const qbEdit = await api(`/api/question-bank`, tokGuruA, {
            method: 'PUT', body: JSON.stringify({ id: qbRow.id, question_text: `${U} Soal bank (edit)`, question_type: 'MULTIPLE_CHOICE', options: ['a', 'b', 'c', 'd'], correct_answer: 'B', difficulty: 'EASY' }),
        })
        check('PUT /api/question-bank edit → 200', qbEdit.status === 200, `status ${qbEdit.status}`)
        const qbDel = await api(`/api/question-bank?id=${qbRow.id}`, tokGuruA, { method: 'DELETE' })
        check('DELETE /api/question-bank → 200', qbDel.status === 200, `status ${qbDel.status}`)
        const qbAfter = await (await api(`/api/question-bank?search=${encodeURIComponent(U)}`, tokGuruA)).json().catch(() => null)
        check('soal bank terhapus', !(qbAfter || []).some(q => q.id === qbRow.id))
    }

    // ════════ [6] PENGUMUMAN ════════
    console.log('[6] Pengumuman: admin POST → siswa GET')
    const annRes = await api('/api/announcements', tokAdmin, {
        method: 'POST', body: JSON.stringify({ title: `${U} Pengumuman`, content: 'isi smoke', is_global: true }),
    })
    const ann = await annRes.json().catch(() => null)
    check('POST /api/announcements → 200/201', [200, 201].includes(annRes.status) && !!ann?.id, `status ${annRes.status} ${ann?.error || ''}`)
    if (ann?.id) created.announcements.push(ann.id)
    const annSiswa = await (await api('/api/announcements', tokSiswaA)).json().catch(() => null)
    const annVisible = Array.isArray(annSiswa) && annSiswa.some(a => a.title === `${U} Pengumuman`)
    check('siswa A melihat pengumuman global', annVisible, `list=${Array.isArray(annSiswa) ? annSiswa.length : '?'}`)

    // ════════ [7] GRADING UTS/UAS MANUAL ════════
    console.log('[7] Grading UTS/UAS manual: PUT official-exam-submissions/[id]')
    {
        const exam = await mustInsert(supabase, 'official_exams', {
            title: `${U} UTS Smoke`, school_id: school.id, subject_id: subject.id, academic_year_id: year.id,
            exam_type: 'UTS', start_time: new Date(Date.now() - 5 * 60e3).toISOString(),
            duration_minutes: 60, is_active: true, is_remedial: false, allowed_student_ids: null,
            target_class_ids: [classA.id], created_by: guruA.user.id,
        }, 'official exam')
        created.officialExams.push(exam.id)
        const q1 = await mustInsert(supabase, 'official_exam_questions', {
            exam_id: exam.id, question_type: 'MULTIPLE_CHOICE', correct_answer: 'A', points: 2,
            question_text: `${U} soal 1`, options: ['opsi A', 'opsi B'], order_index: 1,
        }, 'official q1')
        const q2 = await mustInsert(supabase, 'official_exam_questions', {
            exam_id: exam.id, question_type: 'ESSAY', correct_answer: null, points: 6,
            question_text: `${U} soal essay`, options: null, order_index: 2,
        }, 'official q2')
        created.officialQuestions.push(q1.id, q2.id)
        // siswa A kerjakan: MC benar, essay dijawab
        const sub = await mustInsert(supabase, 'official_exam_submissions', {
            exam_id: exam.id, student_id: siswaA.student.id, started_at: new Date().toISOString(),
            submitted_at: new Date().toISOString(), is_submitted: true, is_graded: false, total_score: 2, max_score: 8,
        }, 'official sub')
        created.officialSubmissions.push(sub.id)
        const a1 = await mustInsert(supabase, 'official_exam_answers', { submission_id: sub.id, question_id: q1.id, answer: 'A', is_correct: true, points_earned: 2 }, 'off ans1')
        const a2 = await mustInsert(supabase, 'official_exam_answers', { submission_id: sub.id, question_id: q2.id, answer: 'esai siswa', is_correct: null, points_earned: 0 }, 'off ans2')
        created.officialAnswers.push(a1.id, a2.id)
        // guru A (mengajar kelas A) grade essay 5
        const gradeRes = await api(`/api/official-exam-submissions/${sub.id}`, tokGuruA, {
            method: 'PUT', body: JSON.stringify({ grades: [{ answer_id: a2.id, points_earned: 5 }] }),
        })
        const graded = await gradeRes.json().catch(() => null)
        check('PUT grading official (guru kelas benar) → 200 + skor 7', gradeRes.status === 200 && graded?.total_score === 7 && graded?.is_graded === true,
            `status ${gradeRes.status}, total=${graded?.total_score}, graded=${graded?.is_graded}`)
        // guru B (TIDAK mengajar kelas A) → 403
        const gradeForbidden = await api(`/api/official-exam-submissions/${sub.id}`, tokGuruB, {
            method: 'PUT', body: JSON.stringify({ grades: [{ answer_id: a2.id, points_earned: 6 }] }),
        })
        check('PUT grading official guru kelas SALAH → 403', gradeForbidden.status === 403, `status ${gradeForbidden.status}`)
    }

    // ════════ [8] RESET ATTEMPT DARI MONITOR (kode user, belum di-commit) ════════
    console.log('[8] Reset attempt guru dari monitor live (kode baru user)')
    {
        // --- Ulangan (exam_*) ---
        const exam = await mustInsert(supabase, 'exams', {
            title: `${U} Ulangan Reset`, start_time: new Date(Date.now() - 5 * 60e3).toISOString(),
            duration_minutes: 60, teaching_assignment_id: taA.id, is_active: true, max_violations: 3, created_by: guruA.user.id,
        }, 'exam reset')
        created.exams.push(exam.id)
        const q = await mustInsert(supabase, 'exam_questions', {
            exam_id: exam.id, question_text: `${U} soal reset`, question_type: 'MULTIPLE_CHOICE',
            options: ['a', 'b'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved',
        }, 'exam reset q')
        created.examQuestions.push(q.id)
        // siswa A sudah submit dengan 1 jawaban
        const sub = await mustInsert(supabase, 'exam_submissions', {
            exam_id: exam.id, student_id: siswaA.student.id, started_at: new Date().toISOString(),
            submitted_at: new Date().toISOString(), is_submitted: true, total_score: 10, max_score: 10,
        }, 'exam reset sub')
        created.examSubmissions.push(sub.id)
        const ans = await mustInsert(supabase, 'exam_answers', { submission_id: sub.id, question_id: q.id, answer: 'A', is_correct: true, points_earned: 10 }, 'exam reset ans')
        created.examAnswers.push(ans.id)

        // 8a. Monitor kirim submission_id (kontrak tombol reset user)
        const mon = await api(`/api/exam-submissions/monitor?exam_id=${exam.id}`, tokGuruA)
        const monBody = await mon.json().catch(() => null)
        const monRow = (monBody?.students || monBody || []).find?.((s) => s.student_id === siswaA.student.id) || null
        check('monitor ulangan → 200 + submission_id ada (kontrak tombol reset)', mon.status === 200 && !!monRow?.submission_id,
            `status ${mon.status}, submission_id=${monRow?.submission_id ? 'ada' : 'HILANG'}`)

        // 8b. GURU A soft reset (kode baru: dulu admin-only) — jawaban tetap
        const softRes = await api('/api/exam-submissions', tokGuruA, {
            method: 'PUT', body: JSON.stringify({ submission_id: sub.id, reset_attempt: 'soft' }),
        })
        const softBody = await softRes.json().catch(() => null)
        check('GURU soft reset ulangan → 200', softRes.status === 200 && softBody?.reset_success === true, `status ${softRes.status} ${softBody?.error || ''}`)
        const afterSoft = await supabase.from('exam_submissions').select('is_submitted, violation_count, total_score').eq('id', sub.id).single()
        const ansAfterSoft = await supabase.from('exam_answers').select('id').eq('submission_id', sub.id)
        check('soft reset: is_submitted=false, jawaban TETAP ada', afterSoft.data?.is_submitted === false && (ansAfterSoft.data || []).length === 1,
            `submitted=${afterSoft.data?.is_submitted}, answers=${ansAfterSoft.data?.length}`)

        // 8c. GURU B (kelas salah) reset → 403 (otorisasi canTeachStudentSubmission)
        const wrongRes = await api('/api/exam-submissions', tokGuruB, {
            method: 'PUT', body: JSON.stringify({ submission_id: sub.id, reset_attempt: 'hard' }),
        })
        check('GURU kelas salah reset ulangan → 403', wrongRes.status === 403, `status ${wrongRes.status}`)

        // submit ulang lalu hard reset oleh GURU A — jawaban terhapus + override timer
        await supabase.from('exam_submissions').update({ is_submitted: true, submitted_at: new Date().toISOString() }).eq('id', sub.id)
        const hardRes = await api('/api/exam-submissions', tokGuruA, {
            method: 'PUT', body: JSON.stringify({ submission_id: sub.id, reset_attempt: 'hard' }),
        })
        const hardBody = await hardRes.json().catch(() => null)
        check('GURU hard reset ulangan → 200', hardRes.status === 200 && hardBody?.reset_success === true, `status ${hardRes.status} ${hardBody?.error || ''}`)
        const afterHard = await supabase.from('exam_submissions').select('is_submitted, timer_override_until, started_at').eq('id', sub.id).single()
        const ansAfterHard = await supabase.from('exam_answers').select('id').eq('submission_id', sub.id)
        check('hard reset: jawaban TERHAPUS + timer_override_until terisi',
            (ansAfterHard.data || []).length === 0 && !!afterHard.data?.timer_override_until && afterHard.data?.is_submitted === false,
            `answers=${ansAfterHard.data?.length}, override=${afterHard.data?.timer_override_until ? 'ada' : 'HILANG'}`)

        // 8d. ADMIN reset (jalur lama) → 200
        await supabase.from('exam_submissions').update({ is_submitted: true, submitted_at: new Date().toISOString() }).eq('id', sub.id)
        const adminRes = await api('/api/exam-submissions', tokAdmin, {
            method: 'PUT', body: JSON.stringify({ submission_id: sub.id, reset_attempt: 'soft' }),
        })
        check('ADMIN soft reset ulangan → 200', adminRes.status === 200, `status ${adminRes.status}`)

        // --- Official (UTS/UAS): jalur resmi yang diubah user ---
        const offExam = created.officialExams[0]
        const offSubId = created.officialSubmissions[0]
        const offMon = await api(`/api/official-exam-submissions/monitor?exam_id=${offExam}`, tokGuruA)
        const offMonBody = await offMon.json().catch(() => null)
        const offMonRow = (offMonBody?.students || offMonBody || []).find?.((s) => s.submission_id === offSubId) || null
        check('monitor official → 200 + submission_id ada (kontrak tombol reset)', offMon.status === 200 && !!offMonRow?.submission_id,
            `status ${offMon.status}`)

        const offSoft = await api('/api/official-exam-submissions', tokGuruA, {
            method: 'PUT', body: JSON.stringify({ submission_id: offSubId, reset_attempt: 'soft' }),
        })
        const offSoftBody = await offSoft.json().catch(() => null)
        check('GURU soft reset official → 200', offSoft.status === 200 && offSoftBody?.reset_success === true, `status ${offSoft.status} ${offSoftBody?.error || ''}`)
        const offAfter = await supabase.from('official_exam_submissions').select('is_submitted, total_score').eq('id', offSubId).single()
        const offAnsAfter = await supabase.from('official_exam_answers').select('id, points_earned').eq('submission_id', offSubId)
        check('soft reset official: is_submitted=false, jawaban & skor tetap',
            offAfter.data?.is_submitted === false && (offAnsAfter.data || []).length === 2,
            `submitted=${offAfter.data?.is_submitted}, answers=${offAnsAfter.data?.length}`)

        const offWrong = await api('/api/official-exam-submissions', tokGuruB, {
            method: 'PUT', body: JSON.stringify({ submission_id: offSubId, reset_attempt: 'soft' }),
        })
        check('GURU kelas salah reset official → 403', offWrong.status === 403, `status ${offWrong.status}`)
    }

    // ════════ [9] ANALITIK ADMIN + JADWAL GURU (role-specific) ════════
    console.log('[9] Analitik admin + jadwal guru sendiri')
    {
        // Admin: analitik nilai kelas (route buat client sendiri — cek shape & no-error)
        const anRes = await api(`/api/analytics/class-grades?academic_year_id=${year.id}`, tokAdmin)
        const anBody = await anRes.json().catch(() => null)
        check('GET /api/analytics/class-grades (admin) → 200', anRes.status === 200, `status ${anRes.status} ${anBody?.error || ''}`)

        // Guru: jadwal sendiri (dipakai beranda guru)
        const mySchedRes = await api('/api/schedules/my-schedule', tokGuruA)
        const mySchedBody = await mySchedRes.json().catch(() => null)
        const mySchedOk = mySchedRes.status === 200 && (Array.isArray(mySchedBody) || typeof mySchedBody === 'object')
        check('GET /api/schedules/my-schedule (guru) → 200 + shape valid', mySchedOk, `status ${mySchedRes.status}`)

        // Guru B (kelas B) tidak boleh melihat entri jadwal guru A via my-schedule
        const mySchedB = await (await api('/api/schedules/my-schedule', tokGuruB)).json().catch(() => null)
        const schedBArr = Array.isArray(mySchedB) ? mySchedB : (mySchedB?.entries || [])
        const leak = schedBArr.filter?.((e) => e.teacher_id === guruA.teacher.id).length || 0
        check('guru B tidak melihat entri jadwal guru A', leak === 0, `leak=${leak}`)

        // Siswa dilarang analitik
        const anForbidden = await api(`/api/analytics/class-grades?academic_year_id=${year.id}`, tokSiswaA)
        check('GET analytics oleh SISWA → ditolak', [401, 403].includes(anForbidden.status), `status ${anForbidden.status}`)
    }

    // ---------- HASIL ----------
    await stopServerSafe(server, BASE)
    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL SMOKE FITUR =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'E2E-SMOKE-FEATURES: PASS ✅' : 'E2E-SMOKE-FEATURES: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : Promise.resolve()
    const delBy = (t, col, ids) => ids.length ? supabase.from(t).delete().in(col, ids) : Promise.resolve()
    // storage objects (prefix bucket per jenis: audio → materials Supabase, tugas → submissions)
    for (const p of created.storagePaths) {
        if (p.startsWith('materials:')) await supabase.storage.from('materials').remove([p.slice(9)]).catch(() => { })
        else if (p.startsWith('submissions:')) await supabase.storage.from('submissions').remove([p.slice(11)]).catch(() => { })
    }
    // R2 objects (upload materi via presigned PUT ke Cloudflare R2)
    if (created.r2Keys.length && process.env.R2_ACCESS_KEY_ID) {
        const { S3Client, DeleteObjectsCommand } = require('@aws-sdk/client-s3')
        const r2 = new S3Client({
            region: 'auto',
            endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
        })
        await r2.send(new DeleteObjectsCommand({
            Bucket: process.env.R2_BUCKET,
            Delete: { Objects: created.r2Keys.map(k => ({ Key: k })) },
        })).catch(() => { })
    }
    // exam chain
    await delBy('exam_answers', 'submission_id', created.examSubmissions)
    await del('exam_submissions', created.examSubmissions)
    await del('exam_questions', created.examQuestions)
    await del('exams', created.exams)
    // official chain
    await delBy('official_exam_answers', 'submission_id', created.officialSubmissions)
    await del('official_exam_submissions', created.officialSubmissions)
    await del('official_exam_questions', created.officialQuestions)
    await del('official_exams', created.officialExams)
    // lain-lain
    await del('schedule_entries', []) // terhapus cascade schedule; safety no-op
    await delBy('schedule_entries', 'schedule_id', created.schedules)
    await del('schedules', created.schedules)
    await del('announcements', created.announcements)
    await del('question_bank', created.questionBank)
    await del('materials', created.materials)
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
