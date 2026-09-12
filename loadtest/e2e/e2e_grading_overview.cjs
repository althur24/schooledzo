/**
 * E2E GRADING OVERVIEW + BELUM MENGUMPULKAN — menguji fitur dashboard guru:
 * badge koreksi (GET /api/dashboard/guru/grading-overview) dan daftar siswa
 * belum mengumpulkan (missingSubmissions di GET /api/dashboard/guru/warnings).
 *
 * CATATAN PENTING TENTANG CACHE: grading-overview memakai cache TTL 30 dtk —
 * assertion state DB harus menunggu TTL lewat (sleep 31 dtk) atau dilakukan
 * pada GET pertama setelah perubahan yang jaraknya > 30 dtk. Run pertama
 * script ini mengajarkan itu: 7 assertion gagal karena GET beruntun menerima
 * cache stale — cache bekerja BENAR, test-nya yang salah desain.
 *
 * Yang diverifikasi (korelasi antar-fitur, bukan hanya 200 OK):
 *  - Guard role: SISWA ditolak; guru tanpa TA dapat counts 0
 *  - Kuis essay: submit 2 siswa → ungraded_count 2; badge counts.kuis = JUMLAH
 *    PENILAIAN (1), bukan jumlah submission; koreksi guru menurunkan angka
 *  - Tugas: submission tanpa grade → counts.tugas; siswa tak kumpul → missing
 *  - Missing kuis: hanya yang deadline-nya TERISI & sudah lewat; kuis tanpa
 *    deadline tidak pernah missing; allowed_student_ids dihormati
 *  - Missing ulangan: window lewat → missing; hard reset aktif (timer_override_until
 *    masa depan) → TIDAK missing; submission ungraded → masuk counts.ulangan
 *  - UTS/UAS: submission ungraded → counts.utsUas; siswa tak ikut → missing;
 *    official exam tahun NON-AKTIF → TIDAK terhitung (bug fix year-scope);
 *    subject/kelas di luar scope guru → TIDAK terhitung
 *  - Remedial: submit remedial = menyelesaikan kuis asal (missing hilang),
 *    tapi kuis remedial tetap masuk antrian koreksi
 *  - Struktur missingSubmissions: field lengkap + sorting missing_count desc
 *  - Cache TTL 30 dtk: data baru TIDAK muncul segera (cache), muncul setelah
 *    TTL lewat — membuktikan cache aktif DAN tidak stale permanen
 *
 * WAJIB staging: ENV_FILE=.env.staging node loadtest/e2e/e2e_grading_overview.cjs
 * (.next harus dibangun dengan env staging — assertServerDb memverifikasinya.)
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3170
const BASE = `http://localhost:${PORT}`
const CACHE_TTL_WAIT_MS = 31_000

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], quizzes: [], quizSubmissions: [], assignments: [],
    submissions: [], examSubmissions: [], officialExams: [], officialSubmissions: [],
    enrollments: [], academicYears: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString()
const H = 3600_000

async function getJson(api, path, token) {
    const res = await api(path, token)
    return { res, body: await res.json().catch(() => null) }
}
const waitCacheExpire = () => new Promise(r => setTimeout(r, CACHE_TTL_WAIT_MS))

async function main() {
    const runId = Date.now() % 100000
    const U = `go_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')
    // Tahun NON-AKTIF untuk membuktikan official exam tahun lalu tidak terhitung
    const oldYear = await mustInsert(supabase, 'academic_years', { name: `${U} TA Lama`, school_id: school.id, is_active: false }, 'tahun non-aktif')
    created.academicYears.push(oldYear.id)

    const subjA = await mustInsert(supabase, 'subjects', { name: `${U} B. Indonesia`, school_id: school.id, kkm: 75 }, 'subject A')
    const subjB = await mustInsert(supabase, 'subjects', { name: `${U} Prakarya`, school_id: school.id, kkm: 75 }, 'subject B')
    created.subjects.push(subjA.id, subjB.id)

    const mkUser = async (label, role) => mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} ${label}`, password_hash: passHash, role, school_id: school.id }, `user ${label}`)
    const mkSession = async (userId, label) => {
        const tok = (await mustInsert(supabase, 'sessions', { user_id: userId, token: `${U}_tok_${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session ${label}`)).token
        created.sessions.push(tok)
        return tok
    }

    const guruAUser = await mkUser('guru', 'GURU')
    created.users.push(guruAUser.id)
    const guruATeacher = await mustInsert(supabase, 'teachers', { user_id: guruAUser.id, school_id: school.id }, 'teacher A')
    created.teachers.push(guruATeacher.id)
    const guruATok = await mkSession(guruAUser.id, 'guru')

    const guruBUser = await mkUser('gurub', 'GURU') // tanpa TA — untuk guard counts 0
    created.users.push(guruBUser.id)
    await mustInsert(supabase, 'teachers', { user_id: guruBUser.id, school_id: school.id }, 'teacher B')
    created.teachers.push(guruBUser.id)
    const guruBTok = await mkSession(guruBUser.id, 'gurub')

    const clsA = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class A')
    const clsB = await mustInsert(supabase, 'classes', { name: `${U} 9B`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class B')
    created.classes.push(clsA.id, clsB.id)
    const taA = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruATeacher.id, class_id: clsA.id, subject_id: subjA.id, academic_year_id: year.id }, 'TA A')
    created.tas.push(taA.id)

    const mkSiswa = async (no, cls) => {
        const u = await mkUser(`siswa${no}`, 'SISWA')
        created.users.push(u.id)
        const s = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}0${no}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${no}`)
        created.students.push(s.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: s.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${no}`)
        created.enrollments.push(en.id)
        return { user: u, student: s, token: await mkSession(u.id, `siswa${no}`) }
    }
    const s1 = await mkSiswa(1, clsA) // patuh: kumpul semuanya
    const s2 = await mkSiswa(2, clsA) // bolos: tidak pernah kumpul
    const s3 = await mkSiswa(3, clsB) // kelas lain — di luar scope guru A

    console.log('fixtures OK (guru A/B, siswa 1-3, TA, tahun aktif + non-aktif)')

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ========== SECTION 1: GUARD (guru B fresh — belum pernah GET) ==========
    console.log('[1] Guard role & guru tanpa penugasan')
    const g1 = await getJson(api, '/api/dashboard/guru/grading-overview', s1.token)
    check('SISWA ditolak 401 di grading-overview', g1.res.status === 401, `status ${g1.res.status}`)
    const g2 = await getJson(api, '/api/dashboard/guru/grading-overview', guruBTok)
    check('Guru tanpa TA: counts semua 0', g2.res.ok && g2.body?.counts?.tugas === 0 && g2.body?.counts?.kuis === 0 && g2.body?.counts?.ulangan === 0 && g2.body?.counts?.utsUas === 0, `status ${g2.res.status}`)
    check('Guru tanpa TA: items kosong', Array.isArray(g2.body?.items) && g2.body.items.length === 0)

    // ========== SECTION 2: SIAPKAN SEMUA STATE-1 ==========
    console.log('[2] State-1: kuis essay (2 submit), tugas, kuis lampau/terbatas/abadi, ulangan, UTS ×3')

    // K1 — kuis essay via API (jalur asli), 2 siswa submit → ungraded
    const k1Res = await api('/api/quizzes', guruATok, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Kuis Essay`, duration_minutes: 30, teaching_assignment_id: taA.id, is_randomized: false,
            questions: [{ question_text: 'Esai bebas', question_type: 'ESSAY', correct_answer: null, points: 10, order_index: 0 }],
        }),
    })
    const k1 = await k1Res.json().catch(() => null)
    check('POST /api/quizzes sukses', k1Res.ok && k1?.id, `status ${k1Res.status}`)
    created.quizzes.push(k1.id)
    const { data: k1q } = await supabase.from('quiz_questions').select('id').eq('quiz_id', k1.id).single()
    await supabase.from('quizzes').update({ deadline: iso(2 * H) }).eq('id', k1.id)
    await api(`/api/quizzes/${k1.id}`, guruATok, { method: 'PUT', body: JSON.stringify({ is_active: true }) })

    const submitQuiz = async (tok, name) => {
        const r = await api('/api/quiz-submissions', tok, {
            method: 'POST',
            body: JSON.stringify({ quiz_id: k1.id, submit: true, answers: [{ question_id: k1q.id, answer: `jawaban ${name}` }] }),
        })
        const b = await r.json().catch(() => null)
        if (b?.id) created.quizSubmissions.push(b.id)
        return { r, b }
    }
    const sub1 = await submitQuiz(s1.token, 'satu')
    check('Siswa 1 submit kuis essay sukses (is_graded false)', sub1.r.ok && sub1.b?.is_graded === false, `status ${sub1.r.status} graded=${sub1.b?.is_graded}`)
    const sub2 = await submitQuiz(s2.token, 'dua')
    check('Siswa 2 submit kuis essay sukses', sub2.r.ok && sub2.b?.is_graded === false, `status ${sub2.r.status}`)

    // T1 — tugas due lampau, siswa 1 kumpul (tanpa grade)
    const t1 = await mustInsert(supabase, 'assignments', { teaching_assignment_id: taA.id, title: `${U} Tugas 1`, type: 'TUGAS', due_date: iso(-1 * H), submission_mode: 'ONLINE' }, 'tugas 1')
    created.assignments.push(t1.id)
    const t1Submit = await api('/api/submissions', s1.token, { method: 'POST', body: JSON.stringify({ assignment_id: t1.id, content: 'kerjaan saya' }) })
    check('Siswa 1 kumpulkan tugas sukses', t1Submit.status === 200, `status ${t1Submit.status}`)
    const t1SubBody = await t1Submit.json().catch(() => null)
    if (t1SubBody?.id) created.submissions.push(t1SubBody.id)

    // K2 (deadline lampau, semua siswa), K3 (allowed siswa 1 saja), K4 (tanpa deadline)
    const mkQuiz = async (label, extra) => {
        const q = await mustInsert(supabase, 'quizzes', { title: `${U} ${label}`, duration_minutes: 30, teaching_assignment_id: taA.id, is_randomized: false, is_active: true, ...extra }, `kuis ${label}`)
        created.quizzes.push(q.id)
        return q
    }
    const k2 = await mkQuiz('Kuis Lampau', { deadline: iso(-1 * H) })
    const k3 = await mkQuiz('Kuis Terbatas', { deadline: iso(-1 * H), allowed_student_ids: [s1.student.id] })
    const k4 = await mkQuiz('Kuis Abadi', { deadline: null })

    // E1 (window mode lampau; s1 submit ungraded, s2 hard-reset aktif), E2 (serentak lampau, tanpa submission)
    const e1 = await mustInsert(supabase, 'exams', { title: `${U} Ulangan Jendela`, start_time: iso(-3 * H), window_end_time: iso(-1 * H), duration_minutes: 60, teaching_assignment_id: taA.id, is_active: true }, 'exam 1')
    const e2 = await mustInsert(supabase, 'exams', { title: `${U} Ulangan Serentak`, start_time: iso(-3 * H), duration_minutes: 60, teaching_assignment_id: taA.id, is_active: true }, 'exam 2')
    const e1sub = await mustInsert(supabase, 'exam_submissions', { exam_id: e1.id, student_id: s1.student.id, started_at: iso(-2 * H), submitted_at: iso(-1.5 * H), is_submitted: true, is_graded: false, total_score: 40, max_score: 100 }, 'e1 sub s1')
    created.examSubmissions.push(e1sub.id)
    const e1reset = await mustInsert(supabase, 'exam_submissions', { exam_id: e1.id, student_id: s2.student.id, started_at: iso(-2 * H), is_submitted: false, timer_override_until: iso(1 * H) }, 'e1 hard reset s2')
    created.examSubmissions.push(e1reset.id)

    // O1 (UTS scope guru, s1 submit ungraded), O2 (UTS tahun NON-AKTIF), O3 (UTS mapel/kelas lain)
    const o1 = await mustInsert(supabase, 'official_exams', { title: `${U} UTS Aktif`, exam_type: 'UTS', school_id: school.id, academic_year_id: year.id, subject_id: subjA.id, target_class_ids: [clsA.id], start_time: iso(-3 * H), window_end_time: iso(-1 * H), duration_minutes: 60, is_active: true }, 'official 1')
    created.officialExams.push(o1.id)
    const o1sub = await mustInsert(supabase, 'official_exam_submissions', { exam_id: o1.id, student_id: s1.student.id, started_at: iso(-2 * H), submitted_at: iso(-1.5 * H), is_submitted: true, is_graded: false, total_score: 50, max_score: 100 }, 'o1 sub s1')
    created.officialSubmissions.push(o1sub.id)
    const o2 = await mustInsert(supabase, 'official_exams', { title: `${U} UTS Tahun Lama`, exam_type: 'UTS', school_id: school.id, academic_year_id: oldYear.id, subject_id: subjA.id, target_class_ids: [clsA.id], start_time: iso(-3 * H), window_end_time: iso(-1 * H), duration_minutes: 60, is_active: true }, 'official tahun lama')
    created.officialExams.push(o2.id)
    const o2sub = await mustInsert(supabase, 'official_exam_submissions', { exam_id: o2.id, student_id: s1.student.id, started_at: iso(-2 * H), submitted_at: iso(-1.5 * H), is_submitted: true, is_graded: false, total_score: 50, max_score: 100 }, 'o2 sub s1')
    created.officialSubmissions.push(o2sub.id)
    const o3 = await mustInsert(supabase, 'official_exams', { title: `${U} UTS Kelas Lain`, exam_type: 'UTS', school_id: school.id, academic_year_id: year.id, subject_id: subjB.id, target_class_ids: [clsB.id], start_time: iso(-3 * H), window_end_time: iso(-1 * H), duration_minutes: 60, is_active: true }, 'official kelas lain')
    created.officialExams.push(o3.id)
    const o3sub = await mustInsert(supabase, 'official_exam_submissions', { exam_id: o3.id, student_id: s3.student.id, started_at: iso(-2 * H), submitted_at: iso(-1.5 * H), is_submitted: true, is_graded: false, total_score: 50, max_score: 100 }, 'o3 sub s3')
    created.officialSubmissions.push(o3sub.id)

    // ========== SECTION 3: GRADING-OVERVIEW STATE-1 (GET pertama guru A = fresh) ==========
    console.log('[3] Grading-overview state-1 (badge + detail item)')
    const g3 = await getJson(api, '/api/dashboard/guru/grading-overview', guruATok)
    const k1Item = g3.body?.items?.find(i => i.id === k1.id)
    check('counts.kuis = 1 (JUMLAH PENILAIAN, bukan 2 submission)', g3.body?.counts?.kuis === 1, `counts.kuis=${g3.body?.counts?.kuis}`)
    check('Item kuis essay: submitted 2, ungraded 2', k1Item?.submitted_count === 2 && k1Item?.ungraded_count === 2, `${k1Item?.submitted_count}/${k1Item?.ungraded_count}`)
    check('counts.tugas = 1 (submission tanpa grade)', g3.body?.counts?.tugas === 1, `counts=${g3.body?.counts?.tugas}`)
    check('Item tugas: submitted 1, ungraded 1', g3.body?.items?.find(i => i.id === t1.id)?.ungraded_count === 1)
    check('counts.ulangan = 1 (E1 ungraded)', g3.body?.counts?.ulangan === 1, `counts=${g3.body?.counts?.ulangan}`)
    check('counts.utsUas = 1 (tahun lama & kelas lain TIDAK terhitung)', g3.body?.counts?.utsUas === 1, `counts=${g3.body?.counts?.utsUas}`)

    // ========== SECTION 4: MISSING SUBMISSIONS STATE-1 ==========
    console.log('[4] missingSubmissions state-1 (warnings — tanpa cache)')
    const w1 = await getJson(api, '/api/dashboard/guru/warnings', guruATok)
    check('GET warnings sukses tanpa error', w1.res.ok && !w1.body?.error, `status ${w1.res.status}`)
    const missing = w1.body?.missingSubmissions || []
    const m1 = missing.find(m => m.student_id === s1.student.id)
    const m2 = missing.find(m => m.student_id === s2.student.id)
    const m3 = missing.find(m => m.student_id === s3.student.id)

    check('Siswa 1 missing tepat 3: Kuis Lampau, Kuis Terbatas (allowed), Ulangan Serentak',
        m1 && m1.items.length === 3 &&
        m1.items.some(i => i.type === 'KUIS' && i.title === k2.title) &&
        m1.items.some(i => i.type === 'KUIS' && i.title === k3.title) &&
        m1.items.some(i => i.type === 'ULANGAN' && i.title === e2.title),
        JSON.stringify((m1?.items || []).map(i => `${i.type}:${i.title}`)))
    check('Siswa 1 TIDAK missing tugas / E1 / UTS (semua dikumpulkan)',
        !m1 || !m1.items.some(i => i.title === t1.title || i.title === e1.title || i.title === o1.title))

    check('Siswa 2 missing tepat 4: tugas, Kuis Lampau, Ulangan Serentak, UTS Aktif',
        m2 && m2.items.length === 4 &&
        m2.items.some(i => i.type === 'TUGAS' && i.title === t1.title) &&
        m2.items.some(i => i.type === 'KUIS' && i.title === k2.title) &&
        m2.items.some(i => i.type === 'ULANGAN' && i.title === e2.title) &&
        m2.items.some(i => i.type === 'UTS' && i.title === o1.title),
        JSON.stringify((m2?.items || []).map(i => `${i.type}:${i.title}`)))
    check('Siswa 2 TIDAK missing Kuis Terbatas (allowed_student_ids)', !m2 || !m2.items.some(i => i.title === k3.title))
    check('Siswa 2 TIDAK missing Ulangan Jendela (hard reset aktif)', !m2 || !m2.items.some(i => i.title === e1.title))
    check('Tidak ada missing dari kuis tanpa deadline (Kuis Abadi)', !missing.some(m => m.items.some(i => i.title === k4.title)))
    check('Tidak ada missing dari UTS tahun lama / kelas lain', !missing.some(m => m.items.some(i => i.title === o2.title || i.title === o3.title)))
    check('Siswa kelas lain (9B) tidak masuk scope guru A', !m3, m3 ? 'muncul!' : 'tidak ada')

    check('Struktur item missing lengkap (type, title, subject_name)', (m2?.items || []).every(i => i.type && i.title && i.subject_name === subjA.name))
    check('Struktur siswa missing lengkap', m2 && m2.student_name && m2.class_id === clsA.id && m2.class_name === clsA.name && m2.missing_count === 4)
    check('Sorting: missing_count terbanyak duluan', missing[0]?.student_id === s2.student.id && missing[0]?.missing_count >= (missing[1]?.missing_count || 0))

    // ========== SECTION 5: KOREKSI KUIS (2 siklus TTL) ==========
    console.log('[5] Koreksi kuis — badge turun bertahap (2 siklus TTL)')
    const grade1 = await api(`/api/quiz-submissions/${sub1.b.id}`, guruATok, {
        method: 'PUT', body: JSON.stringify({ answers: sub1.b.answers, total_score: 10, is_graded: true }),
    })
    check('Guru koreksi siswa 1 sukses', grade1.status === 200, `status ${grade1.status}`)
    await waitCacheExpire()
    const g4 = await getJson(api, '/api/dashboard/guru/grading-overview', guruATok)
    check('Setelah 1 koreksi: ungraded 1, badge kuis tetap 1', g4.body?.items?.find(i => i.id === k1.id)?.ungraded_count === 1 && g4.body?.counts?.kuis === 1)

    await api(`/api/quiz-submissions/${sub2.b.id}`, guruATok, {
        method: 'PUT', body: JSON.stringify({ answers: sub2.b.answers, total_score: 8, is_graded: true }),
    })
    await waitCacheExpire()
    const g5 = await getJson(api, '/api/dashboard/guru/grading-overview', guruATok)
    check('Semua terkoreksi: badge kuis kembali 0', g5.body?.counts?.kuis === 0, `counts.kuis=${g5.body?.counts?.kuis}`)
    check('Item kuis tetap terdaftar (ungraded 0) utk submitted_count', g5.body?.items?.find(i => i.id === k1.id)?.ungraded_count === 0)

    // ========== SECTION 6: REMEDIAL ==========
    console.log('[6] Remedial — menyelesaikan kuis asal, tetap masuk antrian koreksi')
    const kr = await mustInsert(supabase, 'quizzes', { title: `${U} Remedial Kuis Lampau`, duration_minutes: 30, teaching_assignment_id: taA.id, is_randomized: false, is_active: true, deadline: iso(2 * H), is_remedial: true, remedial_for_id: k2.id, remedial_score_policy: 'HIGHEST', remedial_max_score: 75 }, 'kuis remedial')
    created.quizzes.push(kr.id)
    const krq = await mustInsert(supabase, 'quiz_questions', { quiz_id: kr.id, question_text: 'Esai remedial', question_type: 'ESSAY', correct_answer: null, points: 10, order_index: 0 }, 'soal remedial')
    const krsub = await mustInsert(supabase, 'quiz_submissions', { quiz_id: kr.id, student_id: s1.student.id, answers: [{ question_id: krq.id, answer: 'remedial saya' }], started_at: iso(-30 * 60_000), submitted_at: iso(-20 * 60_000), total_score: 0, max_score: 10, is_graded: false }, 'kuis remedial sub')
    created.quizSubmissions.push(krsub.id)

    await waitCacheExpire()
    const g6 = await getJson(api, '/api/dashboard/guru/grading-overview', guruATok)
    check('Kuis remedial masuk antrian koreksi (counts.kuis = 1)', g6.body?.counts?.kuis === 1, `counts=${g6.body?.counts?.kuis}`)

    const w2 = await getJson(api, '/api/dashboard/guru/warnings', guruATok)
    const missing2 = w2.body?.missingSubmissions || []
    const m1r = missing2.find(m => m.student_id === s1.student.id)
    const m2r = missing2.find(m => m.student_id === s2.student.id)
    check('Siswa 1 TIDAK missing Kuis Lampau (remedial = selesai asal)', !m1r || !m1r.items.some(i => i.title === k2.title))
    check('Siswa 2 TETAP missing Kuis Lampau (tidak ikut remedial)', m2r && m2r.items.some(i => i.title === k2.title))

    // ========== SECTION 7: CACHE TTL (dua arah) ==========
    console.log('[7] Cache TTL — aktif DAN tidak stale permanen')
    // g6 (GET terakhir) mengisi cache. Tambah submission baru pada kuis remedial.
    const krsub2 = await mustInsert(supabase, 'quiz_submissions', { quiz_id: kr.id, student_id: s2.student.id, answers: [{ question_id: krq.id, answer: 'remedial dua' }], started_at: iso(-25 * 60_000), submitted_at: iso(-15 * 60_000), total_score: 0, max_score: 10, is_graded: false }, 'kuis remedial sub 2')
    created.quizSubmissions.push(krsub2.id)

    const gCache = await getJson(api, '/api/dashboard/guru/grading-overview', guruATok)
    check('Sebelum TTL lewat: cache lama (ungraded KR masih 1)', gCache.body?.items?.find(i => i.id === kr.id)?.ungraded_count === 1, `ungraded=${gCache.body?.items?.find(i => i.id === kr.id)?.ungraded_count}`)

    await waitCacheExpire()
    const gFresh = await getJson(api, '/api/dashboard/guru/grading-overview', guruATok)
    const krFresh = gFresh.body?.items?.find(i => i.id === kr.id)
    check('Setelah TTL: data segar (ungraded KR jadi 2)', krFresh?.ungraded_count === 2, `ungraded=${krFresh?.ungraded_count}`)
    check('Badge kuis TETAP 1 (jumlah penilaian, bukan submission)', gFresh.body?.counts?.kuis === 1, `counts=${gFresh.body?.counts?.kuis}`)

    const finalGuard = await getJson(api, '/api/dashboard/guru/grading-overview', s1.token)
    check('Guard tetap hidup setelah cache aktif (SISWA 401)', finalGuard.res.status === 401, `status ${finalGuard.res.status}`)

    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL E2E GRADING OVERVIEW + BELUM MENGUMPULKAN =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'E2E-GRADING-OVERVIEW: PASS ✅' : 'E2E-GRADING-OVERVIEW: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    try {
        const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : null
        if (created.quizzes.length) {
            const { data: qs } = await supabase.from('quiz_questions').select('id').in('quiz_id', created.quizzes)
            await del('quiz_questions', (qs || []).map(q => q.id))
        }
        await del('official_exam_submissions', created.officialSubmissions)
        await del('official_exams', created.officialExams)
        await del('exam_submissions', created.examSubmissions)
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
        await del('academic_years', created.academicYears)
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
