/**
 * E2E staging: FITUR SUSULAN (ulangan + UTS/UAS)
 *
 * Mencakup:
 *  - grant hanya boleh setelah ujian berakhir (live -> 400)
 *  - placeholder submission (started_at NULL) dibuat, TIDAK tampil sebagai
 *    attempt kosong di daftar hasil guru
 *  - siswa mulai susulan setelah jam tutup asli -> timer penuh dari sekarang
 *  - nilai akhir dibatasi cap persen (80%) dan tanpa cap (100%)
 *  - placeholder tidak dibunuh lazy sweep / auto-submit
 *  - revoke sebelum mulai, grant kedaluwarsa, grant ganda, non-owner (403)
 *  - jalur UTS/UAS (official_exam_submissions)
 *  - PUT sebelum start ditolak; gate soal menutup baca-sebelum-timer
 *  - unpublish diblokir saat grant pending
 *  - placeholder remedial tidak menurunkan nilai (AVERAGE) / ghost row
 *  - RPC list-counts tidak menghitung placeholder
 *
 * PRASYARAT: migrasi `20261029165239_susulan_exam.sql` DAN
 * `20261029175838_susulan_constraints_counts.sql` sudah di-push ke STAGING,
 * build + next start dengan env .env.staging (paritas script e2e lain).
 *
 * Jalankan: node scripts/e2e-susulan-staging.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const P = 'esus_'
const PASS = 'Susulan123!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2'
// KEEP_FIXTURE=1 → jangan cleanup, tinggalkan data demo untuk uji manual.
// CLEANUP_ONLY=1 → hanya bersihkan fixture (tanpa membuat/menjalankan test).
const KEEP_FIXTURE = process.env.KEEP_FIXTURE === '1'
const CLEANUP_ONLY = process.env.CLEANUP_ONLY === '1'

let pass = 0, fail = 0
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  ✓ ${name}`) }
    else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`login gagal ${username}: ${JSON.stringify(data)}`)
    return (res.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ')
}

function api(cookie, path, options = {}) {
    return fetch(`${BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
            ...(options.headers || {}),
        },
    })
}

const ins = async (table, row) => {
    const { data, error } = await supabase.from(table).insert(row).select().single()
    if (error || !data) throw new Error(`insert ${table} gagal: ${JSON.stringify(error)}`)
    return data
}

async function preClean() {
    const like = `${P}%`
    const del = async (table, col) => {
        const { error } = await supabase.from(table).delete().like(col, like)
        if (error) throw new Error(`preClean ${table}: ${JSON.stringify(error)}`)
    }
    const { data: exams } = await supabase.from('exams').select('id').like('title', like)
    const examIds = (exams || []).map(e => e.id)
    if (examIds.length) {
        const { data: subs } = await supabase.from('exam_submissions').select('id').in('exam_id', examIds)
        for (const s of subs || []) await supabase.from('exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('exam_submissions').delete().in('exam_id', examIds)
        await supabase.from('exam_questions').delete().in('exam_id', examIds)
        await supabase.from('exams').delete().in('id', examIds)
    }
    const { data: offs } = await supabase.from('official_exams').select('id').like('title', like)
    const offIds = (offs || []).map(e => e.id)
    if (offIds.length) {
        const { data: subs } = await supabase.from('official_exam_submissions').select('id').in('exam_id', offIds)
        for (const s of subs || []) await supabase.from('official_exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('official_exam_submissions').delete().in('exam_id', offIds)
        await supabase.from('official_exam_questions').delete().in('exam_id', offIds)
        await supabase.from('official_exams').delete().in('id', offIds)
    }
    await supabase.from('grade_history').delete().like('ref_title', like)
    const { data: users } = await supabase.from('users').select('id').like('username', like)
    const userIds = (users || []).map(u => u.id)
    if (userIds.length) {
        const { data: students } = await supabase.from('students').select('id').in('user_id', userIds)
        for (const s of students || []) {
            await supabase.from('student_enrollments').delete().eq('student_id', s.id)
            await supabase.from('students').delete().eq('id', s.id)
        }
        const { data: teachers } = await supabase.from('teachers').select('id').in('user_id', userIds)
        for (const t of teachers || []) {
            await supabase.from('teaching_assignments').delete().eq('teacher_id', t.id)
            await supabase.from('teachers').delete().eq('id', t.id)
        }
        await supabase.from('sessions').delete().in('user_id', userIds)
        // Notifikasi bisa dibuat checkEnded saat suite lain/manual testing paralel;
        // hapus dulu agar FK users tidak memblokir cleanup.
        await supabase.from('notifications').delete().in('user_id', userIds)
        await supabase.from('users').delete().in('id', userIds)
    }
    await del('classes', 'name')
}

async function main() {
    if (CLEANUP_ONLY) {
        await preClean()
        console.log('CLEANUP_ONLY selesai — fixture dibersihkan.')
        return
    }

    await preClean()
    const hash = await bcrypt.hash(PASS, 10)
    const uname = (s) => `${P}${s}`

    // ── Fixture guru/kelas/siswa ──────────────────────────────────────────
    const guruU = await ins('users', { username: uname('guru'), password_hash: hash, full_name: 'Guru Susulan', role: 'GURU', school_id: SCHOOL })
    const guru = await ins('teachers', { user_id: guruU.id, school_id: SCHOOL })
    const guru2U = await ins('users', { username: uname('guru2'), password_hash: hash, full_name: 'Guru Lain', role: 'GURU', school_id: SCHOOL })
    const guru2 = await ins('teachers', { user_id: guru2U.id, school_id: SCHOOL })
    const adminU = await ins('users', {
        username: uname('admin'), password_hash: hash, full_name: 'Admin Susulan',
        role: 'ADMIN', school_id: SCHOOL, must_change_password: false, is_locked: false,
    })
    const kelas = await ins('classes', { name: `${P}kelas`, grade_level: 8, school_level: 'SMP', academic_year_id: YEAR })
    const ta = await ins('teaching_assignments', {
        teacher_id: guru.id, subject_id: SUBJECT, class_id: kelas.id, academic_year_id: YEAR,
    })

    const students = []
    for (const [i, label] of ['s1', 's2', 's3', 's4', 's5'].entries()) {
        const u = await ins('users', {
            username: uname(label), password_hash: hash, full_name: `Siswa ${label}`, role: 'SISWA', school_id: SCHOOL,
        })
        const s = await ins('students', {
            user_id: u.id, nis: `${Date.now()}${i}`.slice(-9), class_id: kelas.id,
            school_id: SCHOOL, school_level: 'SMP', status: 'ACTIVE',
        })
        await ins('student_enrollments', {
            student_id: s.id, class_id: kelas.id, academic_year_id: YEAR, status: 'ACTIVE',
            // enrolled_at WAJIB sebelum exam.start_time (roster official memakai interval)
            enrolled_at: new Date(Date.now() - 40 * 86400000).toISOString(),
        })
        students.push({ key: label, user: u, student: s })
    }
    const [s1, s2, s3, s4, s5] = students

    // Siswa di kelas lain (bukan roster exam) untuk uji negatif grant.
    const kelasLain = await ins('classes', { name: `${P}kelas luar`, grade_level: 8, school_level: 'SMP', academic_year_id: YEAR })
    const outsiderU = await ins('users', {
        username: uname('outsider'), password_hash: hash, full_name: 'Siswa Luar Kelas', role: 'SISWA', school_id: SCHOOL,
    })
    const outsiderStudent = await ins('students', {
        user_id: outsiderU.id, nis: `${Date.now()}9`.slice(-9), class_id: kelasLain.id,
        school_id: SCHOOL, school_level: 'SMP', status: 'ACTIVE',
    })
    await ins('student_enrollments', {
        student_id: outsiderStudent.id, class_id: kelasLain.id, academic_year_id: YEAR, status: 'ACTIVE',
        enrolled_at: new Date(Date.now() - 40 * 86400000).toISOString(),
    })

    // ── Exam ulangan yang SUDAH berakhir (10 MC x 10 poin) ───────────────
    const examEnded = await ins('exams', {
        teaching_assignment_id: ta.id,
        title: `${P}Ulangan Berakhir`,
        start_time: new Date(Date.now() - 3 * 3600000).toISOString(),
        duration_minutes: 60,
        is_active: true,
        max_violations: 3,
        show_results_immediately: true,
    })
    const examQs = []
    for (let i = 0; i < 10; i++) {
        examQs.push(await ins('exam_questions', {
            exam_id: examEnded.id,
            question_text: `${P}soal ${i + 1}`,
            question_type: 'MULTIPLE_CHOICE',
            options: ['A', 'B', 'C', 'D'],
            correct_answer: 'A',
            points: 10,
            order_index: i,
            status: 'approved',
            difficulty: 'EASY',
            content_format: 'plain',
        }))
    }

    // ── Exam ulangan yang masih LIVE (grant harus ditolak) ───────────────
    const examLive = await ins('exams', {
        teaching_assignment_id: ta.id,
        title: `${P}Ulangan Live`,
        start_time: new Date(Date.now() - 5 * 60000).toISOString(),
        duration_minutes: 60,
        is_active: true,
        max_violations: 3,
        show_results_immediately: true,
    })
    await ins('exam_questions', {
        exam_id: examLive.id,
        question_text: `${P}soal live`,
        question_type: 'TRUE_FALSE',
        options: ['BENAR', 'SALAH'],
        correct_answer: 'BENAR',
        points: 10,
        order_index: 0,
        status: 'approved',
        difficulty: 'EASY',
        content_format: 'plain',
    })

    // ── Fixture unpublish: exam berakhir dengan grant pending ────────────
    const examUnpublish = await ins('exams', {
        teaching_assignment_id: ta.id,
        title: `${P}Ulangan Unpublish`,
        start_time: new Date(Date.now() - 3 * 3600000).toISOString(),
        duration_minutes: 60,
        is_active: true,
        max_violations: 3,
        show_results_immediately: true,
    })
    await ins('exam_questions', {
        exam_id: examUnpublish.id,
        question_text: `${P}soal unpublish`,
        question_type: 'TRUE_FALSE',
        options: ['BENAR', 'SALAH'],
        correct_answer: 'BENAR',
        points: 10,
        order_index: 0,
        status: 'approved',
        difficulty: 'EASY',
        content_format: 'plain',
    })

    // ── Fixture merge remedial: nilai asli 80 + placeholder remedial AVERAGE
    //    Tidak boleh menurunkan nilai asli menjadi 40.
    const examBase = await ins('exams', {
        teaching_assignment_id: ta.id,
        title: `${P}Ulangan Basis Remedial`,
        start_time: new Date(Date.now() - 4 * 3600000).toISOString(),
        duration_minutes: 60,
        is_active: true,
        max_violations: 3,
        show_results_immediately: true,
    })
    await ins('exam_questions', {
        exam_id: examBase.id,
        question_text: `${P}soal basis`,
        question_type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'],
        correct_answer: 'A',
        points: 100,
        order_index: 0,
        status: 'approved',
        difficulty: 'EASY',
        content_format: 'plain',
    })
    await ins('exam_submissions', {
        exam_id: examBase.id,
        student_id: s5.student.id,
        started_at: new Date(Date.now() - 3 * 3600000).toISOString(),
        submitted_at: new Date(Date.now() - 2 * 3600000).toISOString(),
        is_submitted: true,
        total_score: 80,
        max_score: 100,
        is_graded: true,
        question_order: [],
    })
    const examRemedial = await ins('exams', {
        teaching_assignment_id: ta.id,
        title: `${P}Remedial AVERAGE`,
        start_time: new Date(Date.now() - 3 * 3600000).toISOString(),
        duration_minutes: 60,
        is_active: true,
        max_violations: 3,
        show_results_immediately: true,
        is_remedial: true,
        remedial_for_id: examBase.id,
        remedial_score_policy: 'AVERAGE',
        allowed_student_ids: [s5.student.id],
    })
    await ins('exam_questions', {
        exam_id: examRemedial.id,
        question_text: `${P}soal remedial`,
        question_type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'],
        correct_answer: 'A',
        points: 100,
        order_index: 0,
        status: 'approved',
        difficulty: 'EASY',
        content_format: 'plain',
    })

    // ── Official exam (UTS) yang sudah berakhir ──────────────────────────
    const off = await ins('official_exams', {
        school_id: SCHOOL,
        academic_year_id: YEAR,
        subject_id: SUBJECT,
        exam_type: 'UTS',
        title: `${P}UTS Berakhir`,
        start_time: new Date(Date.now() - 3 * 3600000).toISOString(),
        duration_minutes: 60,
        is_active: true,
        max_violations: 3,
        target_class_ids: [kelas.id],
        created_by: guruU.id,
        show_results_immediately: true,
    })
    const offQs = []
    for (let i = 0; i < 10; i++) {
        offQs.push(await ins('official_exam_questions', {
            exam_id: off.id,
            question_text: `${P}uts soal ${i + 1}`,
            question_type: 'MULTIPLE_CHOICE',
            options: ['A', 'B', 'C', 'D'],
            correct_answer: 'A',
            points: 10,
            order_index: i,
            status: 'approved',
            difficulty: 'EASY',
            content_format: 'plain',
        }))
    }

    const guruCookie = await login(uname('guru'), PASS)
    const guru2Cookie = await login(uname('guru2'), PASS)
    const adminCookie = await login(uname('admin'), PASS)
    const cookieOf = {}
    for (const s of students) cookieOf[s.key] = await login(uname(s.key), PASS)

    const correctPayload = (qs) => qs.map(q => ({ question_id: q.id, answer: 'A' }))

    console.log('\nA. Monitor & guard waktu')
    {
        const res = await api(guruCookie, `/api/exam-submissions/monitor?exam_id=${examEnded.id}`)
        const body = await res.json()
        const row = (body.students || []).find(s => s.student_id === s1.student.id)
        check('monitor 200 + siswa tampil', res.ok && !!row, JSON.stringify(body).slice(0, 200))
        check('monitor menandai ujian berakhir', row?.exam_ended === true)
        check('monitor status masih Belum Mulai', row?.status === 'not_started')

        const liveRes = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examLive.id, student_id: s1.student.id, max_percent: 80 }),
        })
        check('grant saat ujian LIVE ditolak 400', liveRes.status === 400, `status=${liveRes.status}`)

        const badPct = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id, student_id: s1.student.id, max_percent: 0 }),
        })
        check('persen di luar 1-100 ditolak 400', badPct.status === 400, `status=${badPct.status}`)

        const decimalPct = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id, student_id: s1.student.id, max_percent: 80.5 }),
        })
        check('persen desimal ditolak 400', decimalPct.status === 400, `status=${decimalPct.status}`)

        const missingPct = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id, student_id: s1.student.id }),
        })
        check('max_percent wajib eksplisit (400)', missingPct.status === 400, `status=${missingPct.status}`)

        const outsider = await api(guru2Cookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id, student_id: s1.student.id, max_percent: 80 }),
        })
        check('guru non-pengampu ditolak 403', outsider.status === 403, `status=${outsider.status}`)

        const outsideRoster = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id, student_id: outsiderStudent.id, max_percent: 80 }),
        })
        check('grant ke siswa luar roster ditolak 403', outsideRoster.status === 403, `status=${outsideRoster.status}`)
    }

    console.log('\nB. Grant + placeholder + sweep safety (ulangan)')
    let grantS1
    {
        const res = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id, student_id: s1.student.id, max_percent: 80 }),
        })
        grantS1 = await res.json()
        check('grant susulan 200', res.ok && grantS1.success === true, JSON.stringify(grantS1))

        const examDetail = await api(cookieOf.s1, `/api/exams/${examEnded.id}`)
        const examDetailBody = await examDetail.json()
        check('exam detail menandai susulan_pending', examDetailBody?.susulan_pending === true, JSON.stringify(examDetailBody).slice(0, 120))

        const { data: sub } = await supabase.from('exam_submissions')
            .select('id, started_at, is_submitted, susulan_granted_at, susulan_max_percent')
            .eq('id', grantS1.submission_id).single()
        check('placeholder dibuat (started_at NULL)', !!sub && sub.started_at === null && sub.is_submitted === false)
        check('cap tersimpan 80%', sub?.susulan_max_percent === 80)

        // Lazy sweep guru tidak boleh menutup placeholder
        await api(guruCookie, `/api/exam-submissions?exam_id=${examEnded.id}`)
        const { data: afterSweep } = await supabase.from('exam_submissions')
            .select('started_at, is_submitted').eq('id', grantS1.submission_id).single()
        check('lazy sweep tidak menutup placeholder', afterSweep?.started_at === null && afterSweep?.is_submitted === false)

        const detail = await api(guruCookie, `/api/exam-submissions?exam_id=${examEnded.id}`)
        const detailBody = await detail.json()
        check('placeholder tidak tampil sebagai attempt di daftar hasil', Array.isArray(detailBody) && detailBody.length === 0)

        const listRes = await api(cookieOf.s1, `/api/exam-submissions?student_id=${s1.student.id}`)
        const listBody = await listRes.json()
        const mine = (Array.isArray(listBody) ? listBody : []).find(s => s.id === grantS1.submission_id)
        check('siswa melihat grant dengan ends_at null', !!mine && mine.ends_at === null && !!mine.susulan_granted_at)

        const monitor = await api(guruCookie, `/api/exam-submissions/monitor?exam_id=${examEnded.id}`)
        const mBody = await monitor.json()
        const mRow = (mBody.students || []).find(s => s.student_id === s1.student.id)
        check('monitor menampilkan badge susulan', mRow?.susulan?.max_percent === 80 && mRow?.status === 'not_started')

        const detailRes = await api(guruCookie, `/api/exam-submissions/${grantS1.submission_id}`)
        check('detail placeholder (guru) tetap 200', detailRes.status === 200)

        // Siswa pemilik placeholder tidak boleh membaca exam.questions via detail.
        const studentDetail = await api(cookieOf.s1, `/api/exam-submissions/${grantS1.submission_id}`)
        const studentDetailBody = await studentDetail.json()
        check('detail placeholder (siswa) ditolak 409 NOT_STARTED', studentDetail.status === 409 && studentDetailBody?.code === 'NOT_STARTED', `status=${studentDetail.status}`)
        check('detail placeholder tidak mengirim teks soal', !JSON.stringify(studentDetailBody).includes('question_text'))

        // Placeholder belum start: PUT harus ditolak (anti nilai tanpa cap).
        const putBefore = await api(cookieOf.s1, '/api/exam-submissions', {
            method: 'PUT',
            body: JSON.stringify({
                submission_id: grantS1.submission_id,
                answers: correctPayload(examQs),
                submit: true,
            }),
        })
        const putBeforeBody = await putBefore.json()
        check('PUT sebelum start ditolak 409 NOT_STARTED', putBefore.status === 409 && putBeforeBody?.code === 'NOT_STARTED', JSON.stringify(putBeforeBody).slice(0, 160))
        const { data: stillPending } = await supabase.from('exam_submissions')
            .select('started_at, is_submitted').eq('id', grantS1.submission_id).single()
        check('placeholder tetap belum start & belum submit', stillPending?.started_at === null && stillPending?.is_submitted === false)

        // Gate soal: tidak boleh membaca soal sebelum timer berjalan.
        const qBefore = await api(cookieOf.s1, `/api/exams/${examEnded.id}/questions`)
        check('GET soal sebelum start ditolak 403', qBefore.status === 403, `status=${qBefore.status}`)
    }

    console.log('\nC. Mulai susulan setelah jam tutup asli + cap 80%')
    {
        const res = await api(cookieOf.s1, '/api/exam-submissions', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id }),
        })
        const body = await res.json()
        check('POST start susulan 200', res.ok && !!body.id, JSON.stringify(body).slice(0, 200))
        check('started_at terisi', !!body.started_at)
        check('ends_at = durasi penuh dari sekarang', !!body.ends_at && new Date(body.ends_at).getTime() > Date.now() + 50 * 60000)
        check('timer_override_until terisi', !!body.timer_override_until)

        const qAfter = await api(cookieOf.s1, `/api/exams/${examEnded.id}/questions`)
        const qAfterBody = await qAfter.json()
        check('GET soal SETELAH start 200', qAfter.ok && Array.isArray(qAfterBody), `status=${qAfter.status}`)

        const examDetailAfter = await api(cookieOf.s1, `/api/exams/${examEnded.id}`)
        const examDetailAfterBody = await examDetailAfter.json()
        check('susulan_pending false setelah start', examDetailAfterBody?.susulan_pending === false)

        const submit = await api(cookieOf.s1, '/api/exam-submissions', {
            method: 'PUT',
            body: JSON.stringify({
                submission_id: body.id,
                answers: correctPayload(examQs),
                submit: true,
            }),
        })
        const submitBody = await submit.json()
        check('submit setelah jam tutup asli 200', submit.ok, JSON.stringify(submitBody).slice(0, 200))

        const { data: sub } = await supabase.from('exam_submissions')
            .select('is_submitted, total_score, max_score, susulan_max_percent').eq('id', body.id).single()
        check('submission tersimpan', sub?.is_submitted === true)
        check('nilai dibatasi 80% dari max', sub?.total_score === 80 && sub?.max_score === 100, JSON.stringify(sub))

        const again = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id, student_id: s1.student.id, max_percent: 90 }),
        })
        check('grant ulang setelah submit ditolak 409', again.status === 409, `status=${again.status}`)
    }

    console.log('\nD. Revoke & kedaluwarsa')
    {
        const g = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id, student_id: s2.student.id, max_percent: 100 }),
        })
        const gBody = await g.json()
        check('grant siswa 2 (full) 200', g.ok && gBody.success === true)

        const rev = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'DELETE',
            body: JSON.stringify({ submission_id: gBody.submission_id }),
        })
        check('revoke sebelum mulai 200', rev.ok)
        const { data: gone } = await supabase.from('exam_submissions').select('id').eq('id', gBody.submission_id).maybeSingle()
        check('baris placeholder terhapus', gone === null)

        const startRevoked = await api(cookieOf.s2, '/api/exam-submissions', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id }),
        })
        check('start setelah revoke ditolak 400', startRevoked.status === 400, `status=${startRevoked.status}`)

        const g3 = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id, student_id: s3.student.id, max_percent: 100 }),
        })
        const g3Body = await g3.json()
        await supabase.from('exam_submissions')
            .update({ susulan_expires_at: new Date(Date.now() - 60000).toISOString() })
            .eq('id', g3Body.submission_id)
        const startExpired = await api(cookieOf.s3, '/api/exam-submissions', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id }),
        })
        const startExpiredBody = await startExpired.json()
        check('start setelah grant kedaluwarsa ditolak 400', startExpired.status === 400, `status=${startExpired.status}`)
        check('respons meminta retry start normal', startExpiredBody?.code === 'SUSULAN_EXPIRED_RETRY', JSON.stringify(startExpiredBody).slice(0, 160))
        const { data: expiredPlaceholder } = await supabase.from('exam_submissions')
            .select('id').eq('id', g3Body.submission_id).maybeSingle()
        check('placeholder expired dibersihkan dari DB', expiredPlaceholder === null)

        // Placeholder expired baru untuk fase H (harus tidak dihitung RPC).
        const g4 = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id, student_id: s2.student.id, max_percent: 100 }),
        })
        const g4Body = await g4.json()
        await supabase.from('exam_submissions')
            .update({ susulan_expires_at: new Date(Date.now() - 60000).toISOString() })
            .eq('id', g4Body.submission_id)
        check('placeholder expired baru tersimpan', g4.ok && !!g4Body.submission_id)
    }

    console.log('\nE. UTS/UAS (official) — full 100%')
    {
        const g = await api(guruCookie, '/api/official-exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: off.id, student_id: s4.student.id, max_percent: 100 }),
        })
        const gBody = await g.json()
        check('grant UTS/UAS 200', g.ok && gBody.success === true, JSON.stringify(gBody))
        check('cap 100 = tanpa batas', gBody.susulan_max_percent === 100)

        const officialDetail = await api(cookieOf.s4, `/api/official-exam-submissions/${gBody.submission_id}`)
        const officialDetailBody = await officialDetail.json()
        check('detail official placeholder (siswa) ditolak 409', officialDetail.status === 409 && officialDetailBody?.code === 'NOT_STARTED', `status=${officialDetail.status}`)

        const monitor = await api(guruCookie, `/api/official-exam-submissions/monitor?exam_id=${off.id}`)
        const mBody = await monitor.json()
        const mRow = (mBody.students || []).find(s => s.student_id === s4.student.id)
        check('monitor UTS/UAS menandai ujian berakhir', mRow?.exam_ended === true)
        check('monitor UTS/UAS menampilkan grant', !!mRow?.susulan)

        await api(guruCookie, `/api/official-exam-submissions?exam_id=${off.id}`)
        const { data: afterSweep } = await supabase.from('official_exam_submissions')
            .select('started_at, is_submitted').eq('id', gBody.submission_id).single()
        check('lazy auto-submit official tidak menutup placeholder', afterSweep?.started_at === null && afterSweep?.is_submitted === false)

        const start = await api(cookieOf.s4, '/api/official-exam-submissions', {
            method: 'POST',
            body: JSON.stringify({ exam_id: off.id }),
        })
        const startBody = await start.json()
        check('POST start UTS/UAS susulan 200', start.ok && !!startBody.id, JSON.stringify(startBody).slice(0, 200))

        const submit = await api(cookieOf.s4, '/api/official-exam-submissions', {
            method: 'PUT',
            body: JSON.stringify({
                submission_id: startBody.id,
                answers: correctPayload(offQs),
                submit: true,
            }),
        })
        check('submit UTS/UAS susulan 200', submit.ok)

        const { data: sub } = await supabase.from('official_exam_submissions')
            .select('is_submitted, total_score, max_score, susulan_max_percent').eq('id', startBody.id).single()
        check('nilai penuh (100) tersimpan', sub?.total_score === 100 && sub?.max_score === 100, JSON.stringify(sub))
    }

    console.log('\nF. Unpublish diblokir selama grant pending')
    {
        const g = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examUnpublish.id, student_id: s5.student.id, max_percent: 100 }),
        })
        const gBody = await g.json()
        check('grant fixture unpublish 200', g.ok && gBody.success === true)

        const unpub = await api(guruCookie, `/api/exams/${examUnpublish.id}`, {
            method: 'PUT',
            body: JSON.stringify({ is_active: false }),
        })
        const unpubBody = await unpub.json()
        check('unpublish dengan grant pending ditolak 409', unpub.status === 409, `status=${unpub.status} ${JSON.stringify(unpubBody).slice(0, 160)}`)

        const rev = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'DELETE',
            body: JSON.stringify({ submission_id: gBody.submission_id }),
        })
        check('revoke grant fixture 200', rev.ok)

        const unpub2 = await api(guruCookie, `/api/exams/${examUnpublish.id}`, {
            method: 'PUT',
            body: JSON.stringify({ is_active: false }),
        })
        check('unpublish setelah revoke 200', unpub2.ok, `status=${unpub2.status}`)

        // Hanya placeholder yang sudah direvoke → delete exam boleh.
        const delClean = await api(guruCookie, `/api/exams/${examUnpublish.id}`, { method: 'DELETE' })
        check('delete exam tanpa attempt nyata 200', delClean.ok, `status=${delClean.status}`)

        // Delete exam dengan attempt nyata harus ditolak (cegah data loss).
        const delReal = await api(guruCookie, `/api/exams/${examEnded.id}`, { method: 'DELETE' })
        check('delete exam dengan attempt nyata ditolak 409', delReal.status === 409, `status=${delReal.status}`)

        // Guard official: unpublish diblokir saat grant pending.
        const offGrant = await api(guruCookie, '/api/official-exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: off.id, student_id: s2.student.id, max_percent: 100 }),
        })
        const offGrantBody = await offGrant.json()
        check('grant official untuk uji unpublish 200', offGrant.ok && offGrantBody.success === true)

        const offUnpub = await api(guruCookie, `/api/official-exams/${off.id}`, {
            method: 'PUT',
            body: JSON.stringify({ is_active: false }),
        })
        check('unpublish official dengan grant pending ditolak 409', offUnpub.status === 409, `status=${offUnpub.status}`)

        const offRevoke = await api(guruCookie, '/api/official-exam-submissions/susulan', {
            method: 'DELETE',
            body: JSON.stringify({ submission_id: offGrantBody.submission_id }),
        })
        check('revoke grant official 200', offRevoke.ok)

        // Delete official dengan nilai/submission nyata harus ditolak.
        const delOff = await api(guruCookie, `/api/official-exams/${off.id}`, { method: 'DELETE' })
        check('delete official dengan attempt nyata ditolak 409', delOff.status === 409, `status=${delOff.status}`)
    }

    console.log('\nG. Placeholder remedial tidak menurunkan nilai (AVERAGE)')
    {
        const g = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examRemedial.id, student_id: s5.student.id, max_percent: 100 }),
        })
        check('grant susulan pada ujian remedial 200', g.ok, `status=${g.status}`)

        const res = await api(guruCookie, `/api/exam-submissions?exam_id=${examBase.id}`)
        const rows = await res.json()
        const mine = (Array.isArray(rows) ? rows : []).filter(r => r.student_id === s5.student.id)
        check('tidak ada ghost row placeholder remedial', mine.length === 1, `rows=${mine.length}`)
        check('nilai asli 80 tidak turun oleh AVERAGE placeholder', mine[0]?.total_score === 80, JSON.stringify(mine[0] || {}).slice(0, 200))
    }

    console.log('\nH. RPC list-counts tidak menghitung placeholder')
    {
        // examEnded: s1 submitted (1 attempt nyata), s2 grant kedaluwarsa (placeholder).
        // RPC baru harus melaporkan total=1, bukan 2. Panggil RPC langsung agar
        // tidak terpengaruh cache in-memory route (TTL 30 dtk).
        const { data: rows, error } = await supabase.rpc('fn_exam_submission_counts', {
            p_school_id: SCHOOL,
            p_academic_year_id: YEAR,
        })
        check('RPC counts 200', !error, error?.message || '')
        const row = (rows || []).find(r => r.exam_id === examEnded.id)
        check('placeholder tidak menambah total attempt', Number(row?.total) === 1, JSON.stringify(row || {}))
        check('submitted tetap 1', Number(row?.submitted) === 1, JSON.stringify(row || {}))
    }

    console.log('\nI. ADMIN dapat monitor & mengelola susulan')
    {
        const mon = await api(adminCookie, `/api/exam-submissions/monitor?exam_id=${examEnded.id}`)
        const monBody = await mon.json()
        const monRow = (monBody.students || []).find(s => s.student_id === s3.student.id)
        check('admin monitor ulangan 200', mon.ok && !!monRow, JSON.stringify(monBody).slice(0, 160))

        const g = await api(adminCookie, '/api/exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: examEnded.id, student_id: s3.student.id, max_percent: 90 }),
        })
        const gBody = await g.json()
        check('admin grant susulan ulangan 200', g.ok && gBody.success === true, JSON.stringify(gBody).slice(0, 160))

        const rev = await api(adminCookie, '/api/exam-submissions/susulan', {
            method: 'DELETE',
            body: JSON.stringify({ submission_id: gBody.submission_id }),
        })
        check('admin revoke susulan ulangan 200', rev.ok)

        const offMon = await api(adminCookie, `/api/official-exam-submissions/monitor?exam_id=${off.id}`)
        check('admin monitor UTS/UAS 200', offMon.ok, `status=${offMon.status}`)

        const offG = await api(adminCookie, '/api/official-exam-submissions/susulan', {
            method: 'POST',
            body: JSON.stringify({ exam_id: off.id, student_id: s3.student.id, max_percent: 90 }),
        })
        const offGBody = await offG.json()
        check('admin grant susulan UTS/UAS 200', offG.ok && offGBody.success === true, JSON.stringify(offGBody).slice(0, 160))

        const offRev = await api(adminCookie, '/api/official-exam-submissions/susulan', {
            method: 'DELETE',
            body: JSON.stringify({ submission_id: offGBody.submission_id }),
        })
        check('admin revoke susulan UTS/UAS 200', offRev.ok)
    }

    // ── Cleanup ──────────────────────────────────────────────────────────
    if (KEEP_FIXTURE) {
        console.log('\n=== FIXTURE DIPERTAHANKAN UNTUK UJI MANUAL ===')
        console.log(`Guru : ${uname('guru')} / ${PASS}`)
        console.log(`Admin: ${uname('admin')} / ${PASS}`)
        console.log(`Siswa: ${uname('s1')}..${uname('s5')} / ${PASS}`)
        console.log(`Siswa luar roster: ${uname('outsider')} (tidak bisa di-grant)`)
        console.log(`Ulangan: ${P}Ulangan Berakhir  id=${examEnded.id}`)
        console.log(`UTS    : ${P}UTS Berakhir      id=${off.id}`)
        console.log(`Monitor guru: /dashboard/guru/ulangan/${examEnded.id}/monitor`)
        console.log(`Monitor UTS : /dashboard/guru/uts-uas/${off.id}/monitor`)
        console.log('Bersihkan: CLEANUP_ONLY=1 ENV_FILE=.env.staging node scripts/e2e-susulan-staging.cjs')
    } else {
        console.log('\nCleanup fixture...')
        await preClean()
        console.log('Cleanup selesai.')
    }
}

main()
    .then(() => {
        console.log(`\n=== SUSULAN E2E: ${pass} PASS, ${fail} FAIL ===`)
        process.exit(fail > 0 ? 1 : 0)
    })
    .catch(async (e) => {
        console.error('FATAL:', e)
        try { await preClean() } catch (err) { console.error('Cleanup gagal:', err) }
        process.exit(1)
    })
