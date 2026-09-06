/**
 * E2E REMEDIAL UTS/UAS OLEH GURU — fitur baru sesi ini.
 *
 * Skenario (fixture mandiri STG01, dibersihkan di akhir):
 *  [1] GURU buat remedial via POST /api/official-exams/duplicate
 *      (is_remedial + allowed_student_ids + target_class_ids irisan kelas guru)
 *      → 200 + exam.is_remedial + remedial_for_id + allowed_student_ids tersimpan
 *  [2] Scope guard: guru yang TIDAK mengajar mapel/kelas target → 403
 *  [3] Siswa di LUAR allowed_student_ids ditolak 403 saat start attempt
 *      (butuh exam aktif + waktu sudah mulai — set manual via service-role)
 *  [4] Notifikasi remedial sampai ke siswa terpilih, teks "Guru telah membuat..."
 *      (role-aware) + judul memakai label menu kustom bila sekolah mengaturnya
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_official_remedial.cjs
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
    tas: [], enrollments: [], officialExams: [], officialQuestions: [],
    officialSubmissions: [], notifications: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `rem_${runId}`
    const PASS = 'Remedial-Test-123'
    const passHash = bcrypt.hashSync(PASS, 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code, settings').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const settingsSnapshot = school.settings
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} Mapel`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const mkGuru = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} ${label}`, password_hash: passHash, role: 'GURU', school_id: school.id, must_change_password: false, is_locked: false }, `user ${label}`)
        created.users.push(u.id)
        const t = await mustInsert(supabase, 'teachers', { user_id: u.id, school_id: school.id }, `teacher ${label}`)
        created.teachers.push(t.id)
        return { user: u, teacher: t }
    }
    const guruA = await mkGuru('guruA') // mengajar mapel di kedua kelas
    const guruB = await mkGuru('guruB') // mengajar mapel LAIN — untuk uji scope 403

    const classA = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class A')
    const classB = await mustInsert(supabase, 'classes', { name: `${U} 9B`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class B')
    created.classes.push(classA.id, classB.id)

    // TA guru A: mapel ujian di kelas A & B (lolos scope). TA guru B: mapel lain.
    const taA1 = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruA.teacher.id, class_id: classA.id, subject_id: subject.id, academic_year_id: year.id }, 'TA A1')
    const taA2 = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruA.teacher.id, class_id: classB.id, subject_id: subject.id, academic_year_id: year.id }, 'TA A2')
    created.tas.push(taA1.id, taA2.id)

    const subjectB = await mustInsert(supabase, 'subjects', { name: `${U} Mapel Lain`, school_id: school.id, kkm: 75 }, 'subject B')
    created.subjects.push(subjectB.id)
    const taB1 = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruB.teacher.id, class_id: classA.id, subject_id: subjectB.id, academic_year_id: year.id }, 'TA B1')
    created.tas.push(taB1.id)

    const mkStudent = async (label, cls) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} Siswa ${label.toUpperCase()}`, password_hash: passHash, role: 'SISWA', school_id: school.id, must_change_password: false, is_locked: false }, `user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}r${label}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        return { user: u, student: st }
    }
    const siswaA = await mkStudent('sa', classA) // ikut ujian, nilai rendah → remedial
    const siswaA2 = await mkStudent('sb', classA) // ikut ujian, nilai tinggi → TIDAK remedial
    const siswaB = await mkStudent('sc', classB) // remedial dari kelas B

    // Source UTS: sudah selesai (start lampau), aktif, target kedua kelas
    const pastStart = new Date(Date.now() - 2 * 3600000).toISOString()
    const sourceExam = await mustInsert(supabase, 'official_exams', {
        title: `${U} UTS Sumber`, school_id: school.id, subject_id: subject.id, academic_year_id: year.id,
        exam_type: 'UTS', start_time: pastStart, duration_minutes: 60, is_active: true,
        is_remedial: false, allowed_student_ids: null, target_class_ids: [classA.id, classB.id],
        created_by: guruA.user.id,
    }, 'source exam')
    created.officialExams.push(sourceExam.id)

    // Soal sumber (agar duplikasi menyalin soal — jalur realistis)
    const q1 = await mustInsert(supabase, 'official_exam_questions', {
        exam_id: sourceExam.id, question_type: 'MULTIPLE_CHOICE', correct_answer: 'A', points: 10,
        question_text: `${U} soal 1`, options: ['A', 'B'], order_index: 1,
    }, 'source q1')
    created.officialQuestions.push(q1.id)

    // Submissions: sa = 40 (di bawah KKM), sb = 90 (lulus), sc = 50 (remedial)
    const mkOfficialSub = async (st, score) => {
        const sub = await mustInsert(supabase, 'official_exam_submissions', {
            exam_id: sourceExam.id, student_id: st.id, started_at: pastStart,
            submitted_at: new Date(Date.now() - 1 * 3600000).toISOString(),
            is_submitted: true, is_graded: true, total_score: score, max_score: 100,
        }, `official sub ${st.id}`)
        created.officialSubmissions.push(sub.id)
        return sub
    }
    await mkOfficialSub(siswaA.student, 40)
    await mkOfficialSub(siswaA2.student, 90)
    await mkOfficialSub(siswaB.student, 50)

    // Label kustom sementara — memverifikasi judul notifikasi ikut label sekolah
    const customLabels = { tugas: 'Tugas', kuis: 'Kuis', ulangan: 'Ulangan', uts: 'UJIAN TENGAH', uas: 'UAS' }
    await supabase.from('schools').update({ settings: { ...(settingsSnapshot || {}), menu_labels: customLabels } }).eq('id', school.id)

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

    // ════════ [1] GURU MEMBUAT REMEDIAL ════════
    console.log('[1] Guru membuat remedial UTS via /api/official-exams/duplicate')
    const tokGuruA = await doLogin(guruA.user.username)
    check('login guru A', !!tokGuruA)

    const remedialStart = new Date(Date.now() - 5 * 60000).toISOString() // sudah dimulai (untuk skenario [3])
    const createRes = await api('/api/official-exams/duplicate', tokGuruA, {
        method: 'POST',
        body: JSON.stringify({
            source_exam_id: sourceExam.id,
            title: `Remedial ${sourceExam.title}`,
            start_time: remedialStart,
            duration_minutes: 60,
            window_end_time: null,
            target_class_ids: [classA.id, classB.id], // guru A mengajar kedua kelas → lolos
            is_remedial: true,
            allowed_student_ids: [siswaA.student.id, siswaB.student.id],
        }),
    })
    const remedialExam = createRes.ok ? await createRes.json() : null
    check('duplicate (remedial) oleh GURU → 200', createRes.status === 200, `status=${createRes.status}`)
    check('exam baru is_remedial=true', remedialExam?.is_remedial === true)
    check('remedial_for_id = source exam', remedialExam?.remedial_for_id === sourceExam.id)
    check('allowed_student_ids tersimpan (2 siswa)', Array.isArray(remedialExam?.allowed_student_ids) && remedialExam.allowed_student_ids.length === 2)
    check('dibuat sebagai DRAFT (is_active=false)', remedialExam?.is_active === false)
    if (remedialExam?.id) created.officialExams.push(remedialExam.id)

    // Soal tersalin
    const { data: copiedQ } = await supabase.from('official_exam_questions').select('id').eq('exam_id', remedialExam?.id)
    check('soal sumber tersalin ke remedial', (copiedQ || []).length === 1, `n=${copiedQ?.length ?? 0}`)

    // ════════ [2] SCOPE GUARD — GURU ASING 403 ════════
    console.log('\n[2] Scope guard: guru B (tidak mengajar mapel/kelas) → 403')
    const tokGuruB = await doLogin(guruB.user.username)
    const forbiddenRes = await api('/api/official-exams/duplicate', tokGuruB, {
        method: 'POST',
        body: JSON.stringify({
            source_exam_id: sourceExam.id,
            title: 'Remedial Nakal',
            start_time: remedialStart,
            duration_minutes: 60,
            target_class_ids: [classA.id],
            is_remedial: true,
            allowed_student_ids: [siswaA.student.id],
        }),
    })
    check('guru B ditolak 403', forbiddenRes.status === 403, `status=${forbiddenRes.status}`)

    // ════════ [3] SISWA DI LUAR ALLOWED LIST DITOLAK ════════
    console.log('\n[3] Guard attempt: siswa tidak terdaftar remedial ditolak')
    // Aktifkan remedial exam + pastikan waktu sudah dimulai
    await supabase.from('official_exams').update({ is_active: true }).eq('id', remedialExam.id)

    const tokSiswaA2 = await doLogin(siswaA2.user.username) // nilai 90, tidak ikut remedial
    const tokSiswaA = await doLogin(siswaA.user.username)   // nilai 40, ikut remedial
    check('login siswa A & A2', !!(tokSiswaA2 && tokSiswaA))

    const startForbidden = await api('/api/official-exam-submissions', tokSiswaA2, {
        method: 'POST', body: JSON.stringify({ exam_id: remedialExam.id }),
    })
    check('siswa TIDAK terdaftar remedial → 403', startForbidden.status === 403, `status=${startForbidden.status}`)

    const startAllowed = await api('/api/official-exam-submissions', tokSiswaA, {
        method: 'POST', body: JSON.stringify({ exam_id: remedialExam.id }),
    })
    check('siswa terdaftar remedial → bisa mulai (200)', startAllowed.status === 200, `status=${startAllowed.status}`)

    // ════════ [4] NOTIFIKASI ROLE-AWARE + LABEL KUSTOM ════════
    console.log('\n[4] Notifikasi remedial ke siswa terpilih')
    const { data: notifs } = await supabase.from('notifications')
        .select('user_id, title, message')
        .in('user_id', [siswaA.user.id, siswaB.user.id, siswaA2.user.id])
        .ilike('title', `%${sourceExam.title}%`)
    const notifSiswaA = (notifs || []).find(n => n.user_id === siswaA.user.id)
    const notifSiswaB = (notifs || []).find(n => n.user_id === siswaB.user.id)
    const notifSiswaA2 = (notifs || []).find(n => n.user_id === siswaA2.user.id)
    check('siswa remedial A dapat notifikasi', !!notifSiswaA, notifSiswaA?.title || '-')
    check('siswa remedial B (kelas lain) dapat notifikasi', !!notifSiswaB)
    check('siswa NON-remedial TIDAK dapat notifikasi', !notifSiswaA2)
    check('judul notifikasi pakai label kustom ("UJIAN TENGAH")', notifSiswaA?.title?.includes('UJIAN TENGAH'), notifSiswaA?.title || '-')
    check('pesan role-aware: "Guru telah membuat"', notifSiswaA?.message?.includes('Guru telah membuat'), (notifSiswaA?.message || '').slice(0, 60))

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
    // hapus notifikasi uji (milik user fixture)
    await del('notifications', 'user_id', created.users)
    await del('official_exam_answers', 'submission_id', created.officialSubmissions)
    await del('official_exam_submissions', 'id', created.officialSubmissions)
    await del('official_exam_questions', 'exam_id', created.officialExams)
    await del('official_exams', 'id', created.officialExams)
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
        // best-effort cleanup — fixture ber-prefix rem_ mudah dikenali
        const { data: us } = await supabase.from('users').select('id').like('username', `rem_${Date.now() % 100000}%`)
        if (server) await stopServerSafe(server, BASE)
    } catch { /* best effort */ }
    process.exit(1)
})
