/**
 * E2E SMOKE — UNIFIKASI CARD UJIAN & KUIS (ExamCard + adaptor + lib/exam.ts).
 *
 * Verifikasi perubahan sesi ini terhadap API & halaman (fixture mandiri STG01):
 *  [1] GET /api/official-exams (ADMIN):
 *      - 200 + array; item fixture punya creator_name === nama guru (FIELD BARU),
 *        creator_role === 'GURU', question_count, embed subject
 *  [2] GET /api/official-exams (GURU): filter scope mapel×kelas TIDAK rusak
 *      oleh refactor typing OfficialExamRow — item fixture tetap muncul
 *  [3] GET /api/exams (ADMIN): embed teaching_assignment.teacher.user.full_name
 *      ada (sumber sel "Guru" DailyExamCard admin) + question_count + batch_size
 *  [4] GET /api/exams (GURU): 200 + field jadwal (start_time, window_end_time, created_at)
 *  [5] GET /api/quizzes (GURU): 200 + available_from/deadline/created_at ikut
 *      (sumber jadwal QuizCard — sebelumnya tidak dirender)
 *  [6] Halaman render 200: /dashboard/admin/uts-uas (admin),
 *      /dashboard/guru/ulangan + /dashboard/guru/kuis (guru)
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_card_unification.cjs
 * (Server .next WAJIB dibangun dengan env staging — NEXT_PUBLIC_* di-inline saat build:
 *  set -a; source .env.staging; set +a; npm run build)
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
    users: [], teachers: [], subjects: [], classes: [], tas: [],
    exams: [], officialExams: [], quizzes: [], sessions: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `card_${runId}`
    const PASS = 'Card-Smoke-123'
    const passHash = bcrypt.hashSync(PASS, 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} Mapel`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const guruUser = await mustInsert(supabase, 'users', { username: `${U}_guru`, full_name: `${U} Budi Guru`, password_hash: passHash, role: 'GURU', school_id: school.id }, 'user guru')
    created.users.push(guruUser.id)
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guruUser.id, school_id: school.id }, 'teacher')
    created.teachers.push(teacher.id)

    const adminUser = await mustInsert(supabase, 'users', { username: `${U}_admin`, full_name: `${U} Admin`, password_hash: passHash, role: 'ADMIN', school_id: school.id }, 'user admin')
    created.users.push(adminUser.id)

    const cls = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class')
    created.classes.push(cls.id)

    const ta = await mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: cls.id, subject_id: subject.id, academic_year_id: year.id }, 'TA')
    created.tas.push(ta.id)

    // UTS milik GURU (created_by guru → creator_name harus nama guru, creator_role GURU)
    const startFuture = new Date(Date.now() + 24 * 3600e3).toISOString()
    const official = await mustInsert(supabase, 'official_exams', {
        school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
        exam_type: 'UTS', title: `${U} UTS Smoketest`, description: 'fixture card unification',
        start_time: startFuture, duration_minutes: 60, window_end_time: null,
        is_randomized: false, max_violations: 3, target_class_ids: [cls.id],
        created_by: guruUser.id, is_active: true,
    }, 'official_exam')
    created.officialExams.push(official.id)

    // Ulangan harian milik guru (mode jendela — cek window_end_time ikut)
    const ulangan = await mustInsert(supabase, 'exams', {
        teaching_assignment_id: ta.id, title: `${U} Ulangan Smoketest`,
        description: 'fixture card unification',
        start_time: startFuture, duration_minutes: 30,
        window_end_time: new Date(Date.now() + 48 * 3600e3).toISOString(),
        is_randomized: false, max_violations: 3, is_active: true,
        created_by: guruUser.id,
    }, 'exam ulangan')
    created.exams.push(ulangan.id)

    // Kuis milik guru (dengan jendela available_from → deadline)
    const quiz = await mustInsert(supabase, 'quizzes', {
        teaching_assignment_id: ta.id, title: `${U} Kuis Smoketest`,
        description: 'fixture card unification',
        submission_mode: 'ONLINE', duration_minutes: 20,
        available_from: new Date(Date.now() + 3600e3).toISOString(),
        deadline: new Date(Date.now() + 72 * 3600e3).toISOString(),
        is_randomized: true, is_active: true,
    }, 'quiz')
    created.quizzes.push(quiz.id)

    console.log('fixtures OK (admin, guru+TA, kelas, UTS, ulangan, kuis)\n')

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ---------- LOGIN ----------
    const doLogin = async (username) => {
        const r = await fetch(BASE + '/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: PASS }),
        })
        const setCookie = r.headers.getSetCookie?.() || []
        const tokenCookie = setCookie.map(c => c.split(';')[0]).find(c => c.startsWith('session_token='))
        return { status: r.status, token: tokenCookie ? tokenCookie.split('=')[1] : null }
    }
    const adminLogin = await doLogin(`${U}_admin`)
    const guruLogin = await doLogin(`${U}_guru`)
    check('login admin 200 + token', adminLogin.status === 200 && !!adminLogin.token, `status ${adminLogin.status}`)
    check('login guru 200 + token', guruLogin.status === 200 && !!guruLogin.token, `status ${guruLogin.status}`)
    if (!adminLogin.token || !guruLogin.token) throw new Error('Login gagal — tidak bisa lanjut.')

    // ════════ [1] /api/official-exams (ADMIN) — field baru creator_name ════════
    console.log('\n[1] GET /api/official-exams (admin) — creator_name (field baru)')
    const r1 = await api('/api/official-exams', adminLogin.token)
    const b1 = await r1.json().catch(() => null)
    check('status 200', r1.status === 200, `status ${r1.status}`)
    check('respons array', Array.isArray(b1), `tipe ${Array.isArray(b1) ? 'array' : typeof b1}`)
    const fxOfficial = Array.isArray(b1) ? b1.find(e => e.id === official.id) : null
    check('item fixture UTS muncul', !!fxOfficial)
    if (fxOfficial) {
        check('creator_name === nama guru (FIELD BARU)', fxOfficial.creator_name === guruUser.full_name, `dapat: ${JSON.stringify(fxOfficial.creator_name)}`)
        check('creator_role === GURU', fxOfficial.creator_role === 'GURU', `dapat: ${fxOfficial.creator_role}`)
        check('question_count ada (0)', typeof fxOfficial.question_count === 'number')
        check('embed subject ada', fxOfficial.subject?.name === subject.name)
        check('official_exam_questions di-strip', fxOfficial.official_exam_questions === undefined)
    }

    // ════════ [2] /api/official-exams (GURU) — filter scope tetap utuh ════════
    console.log('\n[2] GET /api/official-exams (guru) — filter scope mapel×kelas')
    const r2 = await api('/api/official-exams', guruLogin.token)
    const b2 = await r2.json().catch(() => null)
    check('status 200', r2.status === 200, `status ${r2.status}`)
    const guruOfficial = Array.isArray(b2) ? b2.find(e => e.id === official.id) : null
    check('item fixture terlihat guru pemilik scope', !!guruOfficial)

    // ════════ [3] /api/exams (ADMIN) — embed nama guru utk card admin ════════
    console.log('\n[3] GET /api/exams (admin) — embed teacher.user.full_name')
    const r3 = await api('/api/exams', adminLogin.token)
    const b3 = await r3.json().catch(() => null)
    check('status 200', r3.status === 200, `status ${r3.status}`)
    const fxUlangan = Array.isArray(b3) ? b3.find(e => e.id === ulangan.id) : null
    check('item fixture ulangan muncul', !!fxUlangan)
    if (fxUlangan) {
        const taAny = Array.isArray(fxUlangan.teaching_assignment) ? fxUlangan.teaching_assignment[0] : fxUlangan.teaching_assignment
        const teacherName = Array.isArray(taAny?.teacher?.user) ? taAny?.teacher?.user?.[0]?.full_name : taAny?.teacher?.user?.full_name
        check('embed teacher.user.full_name benar', teacherName === guruUser.full_name, `dapat: ${JSON.stringify(teacherName)}`)
        check('question_count ada', typeof fxUlangan.question_count === 'number')
        check('batch_size ada', typeof fxUlangan.batch_size === 'number')
        check('window_end_time ikut (mode jendela)', !!fxUlangan.window_end_time)
        check('created_at ikut', !!fxUlangan.created_at)
    }

    // ════════ [4] /api/exams (GURU) ════════
    console.log('\n[4] GET /api/exams (guru)')
    const r4 = await api('/api/exams', guruLogin.token)
    const b4 = await r4.json().catch(() => null)
    check('status 200', r4.status === 200, `status ${r4.status}`)
    const guruUlangan = Array.isArray(b4) ? b4.find(e => e.id === ulangan.id) : null
    check('item fixture terlihat guru pemilik', !!guruUlangan)
    if (guruUlangan) {
        check('start_time + created_at + window_end_time lengkap', !!(guruUlangan.start_time && guruUlangan.created_at && guruUlangan.window_end_time))
    }

    // ════════ [5] /api/quizzes (GURU) — sumber jadwal QuizCard ════════
    console.log('\n[5] GET /api/quizzes (guru) — available_from/deadline/created_at')
    const r5 = await api('/api/quizzes', guruLogin.token)
    const b5 = await r5.json().catch(() => null)
    check('status 200', r5.status === 200, `status ${r5.status}`)
    const fxQuiz = Array.isArray(b5) ? b5.find(q => q.id === quiz.id) : null
    check('item fixture kuis muncul', !!fxQuiz)
    if (fxQuiz) {
        check('available_from ikut (jadwal Dibuka)', !!fxQuiz.available_from)
        check('deadline ikut (jadwal Ditutup)', !!fxQuiz.deadline)
        check('created_at ikut (sel Dibuat)', !!fxQuiz.created_at)
        check('batch_size ada', typeof fxQuiz.batch_size === 'number')
    }

    // ════════ [6] Halaman render 200 ════════
    console.log('\n[6] Halaman render')
    const pages = [
        ['/dashboard/admin/uts-uas', adminLogin.token, 'admin uts-uas (2 tab pakai komponen sama)'],
        ['/dashboard/guru/ulangan', guruLogin.token, 'guru ulangan (DailyExamCard + OfficialExamCard)'],
        ['/dashboard/guru/kuis', guruLogin.token, 'guru kuis (QuizCard)'],
    ]
    for (const [path, token, label] of pages) {
        const r = await api(path, token)
        const html = await r.text().catch(() => '')
        // Menangkap crash render: Next error page punya penanda khusus
        const isNextError = html.includes('__next_error__') || html.includes('Application error')
        check(`GET ${path} 200 & bukan error page (${label})`, r.status === 200 && !isNextError, `status ${r.status}`)
    }

    // ---------- RINGKASAN ----------
    const fail = results.filter(r => !r.ok)
    console.log(`\n${'═'.repeat(50)}\nHASIL: ${results.length - fail.length}/${results.length} lulus${fail.length ? ` — GAGAL: ${fail.map(f => f.name).join(' | ')}` : ''}`)
    if (fail.length) process.exitCode = 1
}

async function cleanup() {
    try {
        if (server) await stopServerSafe(server, BASE)
    } catch { }
    try {
        // Hapus fixture — urutan menghormati FK
        await supabase.from('quizzes').delete().in('id', created.quizzes)
        await supabase.from('exams').delete().in('id', created.exams)
        await supabase.from('official_exams').delete().in('id', created.officialExams)
        await supabase.from('teaching_assignments').delete().in('id', created.tas)
        await supabase.from('classes').delete().in('id', created.classes)
        await supabase.from('subjects').delete().in('id', created.subjects)
        await supabase.from('teachers').delete().in('id', created.teachers)
        await supabase.from('users').delete().in('id', created.users)
        console.log('cleanup fixture selesai')
    } catch (e) {
        console.error('cleanup error:', e.message)
    }
}

main().catch(e => { console.error('FATAL:', e.message); process.exitCode = 1 }).finally(cleanup)
