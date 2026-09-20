/**
 * E2E AUDIT UTS/UAS (official_exams) — validasi server + penilaian + integritas.
 * Ditulis untuk audit pra-UTS/UAS: angle yang belum tercover script lain.
 *
 * Skenario (fixture mandiri STG01, dibersihkan di akhir):
 *  [GATE]  POST start ditolak: belum mulai / is_active=false / serentak sudah tutup
 *  [RACE]  Double-POST paralel → satu submission (UNIQUE + 23505 resume), id sama
 *  [WINDOW] ends_at = min(started+duration, window_end) → clamp ke window_end
 *  [JUNK]  Autosave dengan question_id sampah → difilter, tidak 500, hanya valid tersimpan
 *  [IDOR]  Siswa lain PUT submission_id bukan miliknya → 403
 *  [VIOL]  Batch violation timestamp di luar [started_at, now] → di-clamp server
 *  [SUBMIT] Submit normal → skor objektif otomatis, essay pending is_graded=false
 *  [DSUB]  Submit kedua → 400 Already submitted (aman, tidak dobel)
 *  [K1]    PUT answers setelah submitted → 400 ANSWERS_RESCUED, objektif re-grade
 *  [GRADE] Guru koreksi essay → total & is_graded=true
 *  [K1VSG] Rescue essay SETELAH guru menilai → points_earned guru TIDAK boleh hilang
 *  [CLAMP] Guru grading points > poin soal → di-clamp 0..poin soal; answer_id asing → 400
 *  [LATE]  Submit lewat grace (started_at dimundurkan) → 409/force-close + jawaban RESCUED
 *  [RELEASE] results_released=true → siswa lihat skor (sebelumnya hidden)
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_official_audit.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PORT = 3105
const BASE = `http://localhost:${PORT}`

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], officialExams: [], officialQuestions: [],
    officialSubmissions: [], enrollments: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `oa_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} Mapel`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const guruUser = await mustInsert(supabase, 'users', { username: `${U}_guru`, full_name: `${U} Guru`, password_hash: passHash, role: 'GURU', school_id: school.id }, 'user guru')
    created.users.push(guruUser.id)
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guruUser.id, school_id: school.id }, 'teacher')
    created.teachers.push(teacher.id)
    const adminUser = await mustInsert(supabase, 'users', { username: `${U}_admin`, full_name: `${U} Admin`, password_hash: passHash, role: 'ADMIN', school_id: school.id }, 'user admin')
    created.users.push(adminUser.id)

    const classA = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class A')
    const classB = await mustInsert(supabase, 'classes', { name: `${U} 9B`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class B')
    created.classes.push(classA.id, classB.id)

    const taA = await mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: classA.id, subject_id: subject.id, academic_year_id: year.id }, 'TA A')
    created.tas.push(taA.id)

    const mkStudent = async (label, cls) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} Siswa ${label.toUpperCase()}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}${label}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session ${label}`)).token
        created.sessions.push(tok)
        return { user: u, student: st, token: tok }
    }
    const siswaA = await mkStudent('a', classA) // pengerjakan utama
    const siswaB = await mkStudent('b', classB) // IDOR + kelas lain
    const siswaC = await mkStudent('c', classA) // gate tests + late submit
    const guruTok = (await mustInsert(supabase, 'sessions', { user_id: guruUser.id, token: `${U}_tok_guru`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session guru')).token
    created.sessions.push(guruTok)
    const adminTok = (await mustInsert(supabase, 'sessions', { user_id: adminUser.id, token: `${U}_tok_admin`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session admin')).token
    created.sessions.push(adminTok)

    console.log('fixtures OK (guru, admin, 3 siswa, TA, tahun aktif)')

    // ---------- UJIAN FIXTURES ----------
    const now = Date.now()
    const windowEnd = new Date(now + 10 * 60000).toISOString()

    // Ujian utama: window mode, hasil ditahan (untuk test release)
    const examMain = await mustInsert(supabase, 'official_exams', {
        school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
        exam_type: 'UTS', title: `${U} UTS Audit`, description: 'audit',
        start_time: new Date(now - 60000).toISOString(), duration_minutes: 30, window_end_time: windowEnd,
        is_randomized: false, max_violations: 3, target_class_ids: [classA.id],
        created_by: guruUser.id, is_active: true, show_results_immediately: false,
    }, 'exam main')
    created.officialExams.push(examMain.id)

    const qRows = [
        { exam_id: examMain.id, question_text: 'MC1', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: examMain.id, question_text: 'MC2', question_type: 'MULTIPLE_CHOICE', options: ['A2', 'B2', 'C2', 'D2'], correct_answer: 'B', points: 10, order_index: 1, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: examMain.id, question_text: 'Essay', question_type: 'ESSAY', options: null, correct_answer: null, points: 10, order_index: 2, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
    ]
    const { data: qs, error: qErr } = await supabase.from('official_exam_questions').insert(qRows).select()
    if (qErr) throw new Error('insert soal: ' + qErr.message)
    created.officialQuestions.push(...qs.map(q => q.id))
    const mc1 = qs[0], mc2 = qs[1], essay = qs[2]

    // Ujian serentak yang SUDAH ditutup (start 10 mnt lalu, durasi 5 mnt)
    const examSerentak = await mustInsert(supabase, 'official_exams', {
        school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
        exam_type: 'UTS', title: `${U} Serentak Tutup`,
        start_time: new Date(now - 10 * 60000).toISOString(), duration_minutes: 5, window_end_time: null,
        is_randomized: false, max_violations: 3, target_class_ids: [classA.id],
        created_by: guruUser.id, is_active: true,
    }, 'exam serentak')
    created.officialExams.push(examSerentak.id)
    await supabase.from('official_exam_questions').insert({ exam_id: examSerentak.id, question_text: 'q', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' }).select()

    // Ujian belum dimulai & ujian non-aktif
    const examFuture = await mustInsert(supabase, 'official_exams', {
        school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
        exam_type: 'UTS', title: `${U} Belum Mulai`,
        start_time: new Date(now + 3600000).toISOString(), duration_minutes: 30, window_end_time: new Date(now + 7200000).toISOString(),
        is_randomized: false, max_violations: 3, target_class_ids: [classA.id],
        created_by: guruUser.id, is_active: true,
    }, 'exam future')
    created.officialExams.push(examFuture.id)
    const examInactive = await mustInsert(supabase, 'official_exams', {
        school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
        exam_type: 'UTS', title: `${U} Nonaktif`,
        start_time: new Date(now - 60000).toISOString(), duration_minutes: 30, window_end_time: windowEnd,
        is_randomized: false, max_violations: 3, target_class_ids: [classA.id],
        created_by: guruUser.id, is_active: false,
    }, 'exam inactive')
    created.officialExams.push(examInactive.id)

    // Ujian late-submit: window panjang, started_at akan dimundurkan via DB
    const examLate = await mustInsert(supabase, 'official_exams', {
        school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
        exam_type: 'UAS', title: `${U} Late Submit`,
        start_time: new Date(now - 60000).toISOString(), duration_minutes: 30, window_end_time: new Date(now + 7200000).toISOString(),
        is_randomized: false, max_violations: 3, target_class_ids: [classA.id],
        created_by: guruUser.id, is_active: true, show_results_immediately: true,
    }, 'exam late')
    created.officialExams.push(examLate.id)
    const { data: lateQs } = await supabase.from('official_exam_questions').insert({ exam_id: examLate.id, question_text: 'MC late', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' }).select()
    created.officialQuestions.push(...lateQs.map(q => q.id))

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ---------- [GATE] ----------
    console.log('[GATE] POST start ditolak untuk kondisi ilegal')
    const g1 = await api('/api/official-exam-submissions', siswaC.token, { method: 'POST', body: JSON.stringify({ exam_id: examFuture.id }) })
    check('Start sebelum start_time ditolak (non-200)', g1.status !== 200, `status ${g1.status}`)
    const g2 = await api('/api/official-exam-submissions', siswaC.token, { method: 'POST', body: JSON.stringify({ exam_id: examInactive.id }) })
    check('Start pada ujian is_active=false ditolak', g2.status !== 200, `status ${g2.status}`)
    const g3 = await api('/api/official-exam-submissions', siswaC.token, { method: 'POST', body: JSON.stringify({ exam_id: examSerentak.id }) })
    check('Start serentak setelah selesai ditolak', g3.status !== 200, `status ${g3.status}`)

    // ---------- [RACE] double-POST paralel ----------
    console.log('[RACE] Double-POST paralel → satu submission')
    const [p1, p2] = await Promise.all([
        api('/api/official-exam-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ exam_id: examMain.id }) }),
        api('/api/official-exam-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ exam_id: examMain.id }) }),
    ])
    const b1 = await p1.json().catch(() => null)
    const b2 = await p2.json().catch(() => null)
    check('Kedua POST balas 200 (satu insert + satu resume 23505)', p1.status === 200 && p2.status === 200, `status ${p1.status}/${p2.status}`)
    check('Kedua response menunjuk submission ID sama', b1?.id && b2?.id && b1.id === b2.id, `${b1?.id?.slice(0, 8)} vs ${b2?.id?.slice(0, 8)}`)
    const { count: dupCount } = await supabase.from('official_exam_submissions').select('id', { count: 'exact', head: true }).eq('exam_id', examMain.id).eq('student_id', siswaA.student.id)
    check('DB: tepat 1 baris submission (UNIQUE constraint)', dupCount === 1, `n=${dupCount}`)
    const subId = b1?.id
    created.officialSubmissions.push(subId)

    // ---------- [WINDOW] ends_at clamp ----------
    console.log('[WINDOW] ends_at = min(started+duration, window_end)')
    const endsAt = b1?.ends_at ? new Date(b1.ends_at).getTime() : 0
    const winEndMs = new Date(windowEnd).getTime()
    const startedMs = new Date(b1.started_at).getTime()
    check('ends_at clamp ke window_end (duration 30m > window 10m)', Math.abs(endsAt - winEndMs) < 3000, `ends_at=${b1?.ends_at} window=${windowEnd}`)
    check('ends_at bukan started+duration (bukti clamp)', endsAt - startedMs < 30 * 60000 - 60 * 1000, `delta=${Math.round((endsAt - startedMs) / 60000)} mnt`)

    // ---------- [JUNK] ----------
    console.log('[JUNK] Autosave dengan question_id sampah')
    // 2 junk + 1 valid (valid ≤ jumlah soal — cap menolak payload valid > jumlah soal)
    const junkRes = await api('/api/official-exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: subId,
            answers: [
                { question_id: '00000000-0000-0000-0000-000000000000', answer: 'X' },
                { question_id: 'bukan-uuid', answer: 'Y' },
                { question_id: mc1.id, answer: 'A' },
            ],
        }),
    })
    check('PUT junk → 200 (bukan 500)', junkRes.status === 200, `status ${junkRes.status}`)
    const { data: ansRows } = await supabase.from('official_exam_answers').select('question_id, answer, points_earned').eq('submission_id', subId)
    const junkSurvived = (ansRows || []).filter(r => r.question_id !== mc1.id && r.question_id !== mc2.id && r.question_id !== essay.id)
    check('Junk question_id difilter (hanya soal asli tersimpan)', junkSurvived.length === 0, `n_junk=${junkSurvived.length} n=${ansRows?.length}`)
    const { data: mc1Saved } = await supabase.from('official_exam_answers').select('answer').eq('submission_id', subId).eq('question_id', mc1.id).maybeSingle()
    check('Jawaban valid di batch yang sama tersimpan', mc1Saved?.answer === 'A', `answer=${mc1Saved?.answer}`)
    // Payload valid melebihi jumlah soal → ditolak 400 (cap anti-spam, bukan 500)
    const capRes = await api('/api/official-exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: subId,
            answers: [mc1, mc1, mc2, essay].map(q => ({ question_id: q.id, answer: 'A' })),
        }),
    })
    check('Cap: 4 valid > 3 soal → 400 (bukan 500)', capRes.status === 400, `status ${capRes.status}`)

    // ---------- [IDOR] ----------
    console.log('[IDOR] Siswa lain PUT submission bukan miliknya')
    const idorRes = await api('/api/official-exam-submissions', siswaB.token, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: subId, answers: [{ question_id: mc1.id, answer: 'C' }] }),
    })
    check('PUT submission siswa lain → 403', idorRes.status === 403, `status ${idorRes.status}`)
    const { data: mc1AfterIdor } = await supabase.from('official_exam_answers').select('answer').eq('submission_id', subId).eq('question_id', mc1.id).single()
    check('Jawaban tidak berubah oleh percobaan IDOR', mc1AfterIdor?.answer === 'A', `answer=${mc1AfterIdor?.answer}`)

    // ---------- [VIOL] clamp timestamp ----------
    console.log('[VIOL] Batch violation dengan timestamp liar → clamp [started_at, now]')
    const vRes = await api('/api/official-exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: subId,
            violations: [
                { type: 'TAB_SWITCH', at: 1577836800000 }, // 2020-01-01 → clamp ke started_at
                { type: 'TAB_SWITCH', at: 1893456000000 }, // 2030-01-01 → clamp ke now
            ],
        }),
    })
    const vBody = await vRes.json().catch(() => null)
    // Catatan: kedua entri setelah clamp bisa jatuh < 3 dtk → dedup menyisakan 1 (perilaku benar)
    check('PUT violations 200 + count naik', vRes.status === 200 && (vBody?.violation_count || 0) >= 1, `status ${vRes.status} count=${vBody?.violation_count}`)
    const { data: subViol } = await supabase.from('official_exam_submissions').select('violations_log').eq('id', subId).single()
    const logTs = (subViol?.violations_log || []).map(v => new Date(v.timestamp).getTime())
    check('Timestamp di-clamp ke [started_at, now] (tidak 2020/2030)', logTs.every(t => t >= startedMs - 1000 && t <= Date.now() + 1000),
        `ts=${(subViol?.violations_log || []).map(v => v.timestamp).join(', ')}`)

    // ---------- [SUBMIT] ----------
    console.log('[SUBMIT] Submit normal → skor otomatis')
    const subRes = await api('/api/official-exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: subId, submit: true,
            answers: [
                { question_id: mc1.id, answer: 'A' },  // benar 10
                { question_id: mc2.id, answer: 'A' },  // salah (kunci B)
                { question_id: essay.id, answer: 'esai panjang jawaban' },
            ],
        }),
    })
    const subBody = await subRes.json().catch(() => null)
    // total_score di response di-null saat hasil ditahan (show_results_immediately=false) — cek DB
    const { data: subDb } = await supabase.from('official_exam_submissions').select('total_score, is_graded').eq('id', subId).single()
    check('Submit 200 + total_score=10 (DB; response null karena hasil ditahan)', subRes.status === 200 && subDb?.total_score === 10, `status ${subRes.status} total_db=${subDb?.total_score} total_res=${subBody?.total_score}`)
    check('is_graded=false (ada essay)', subDb?.is_graded === false, `graded=${subDb?.is_graded}`)

    // ---------- [DSUB] double submit ----------
    console.log('[DSUB] Submit kedua → ditolak aman')
    const dsubRes = await api('/api/official-exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: subId, submit: true }),
    })
    const dsubBody = await dsubRes.json().catch(() => null)
    check('Submit kedua (tanpa jawaban baru) → 400 Already submitted', dsubRes.status === 400, `status ${dsubRes.status} code=${dsubBody?.code}`)
    const { count: subCount } = await supabase.from('official_exam_submissions').select('id', { count: 'exact', head: true }).eq('id', subId)
    check('Masih 1 submission', subCount === 1, `n=${subCount}`)

    // ---------- [K1] rescue pasca-submit ----------
    console.log('[K1] PUT answers setelah submitted → ANSWERS_RESCUED')
    const k1Res = await api('/api/official-exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: subId, answers: [{ question_id: mc2.id, answer: 'B' }] }),
    })
    const k1Body = await k1Res.json().catch(() => null)
    check('400 + code ANSWERS_RESCUED', k1Res.status === 400 && k1Body?.code === 'ANSWERS_RESCUED', `status ${k1Res.status} code=${k1Body?.code}`)
    const { data: mc2After } = await supabase.from('official_exam_answers').select('points_earned').eq('submission_id', subId).eq('question_id', mc2.id).single()
    check('Jawaban rescue di-grade (MC2 kini benar → 10)', mc2After?.points_earned === 10, `points=${mc2After?.points_earned}`)

    // ---------- [GRADE] koreksi essay ----------
    console.log('[GRADE] Guru koreksi essay → total & is_graded')
    const { data: essayAns } = await supabase.from('official_exam_answers').select('id').eq('submission_id', subId).eq('question_id', essay.id).single()
    const gradeRes = await api(`/api/official-exam-submissions/${subId}`, guruTok, {
        method: 'PUT',
        body: JSON.stringify({ grades: [{ answer_id: essayAns?.id, points_earned: 7 }] }),
    })
    check('Grading PUT 200', gradeRes.status === 200, `status ${gradeRes.status}`)
    const { data: subGraded } = await supabase.from('official_exam_submissions').select('total_score, is_graded').eq('id', subId).single()
    check('Essay 7 → total 10+10+7=27, is_graded=true', subGraded?.total_score === 27 && subGraded?.is_graded === true, `total=${subGraded?.total_score} graded=${subGraded?.is_graded}`)

    // ---------- [K1VSG] rescue essay setelah guru menilai ----------
    console.log('[K1VSG] Rescue essay SETELAH guru menilai → nilai guru tidak terinjak')
    const k1vRes = await api('/api/official-exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: subId, answers: [{ question_id: essay.id, answer: 'revisi teks essay offline' }] }),
    })
    check('Rescue essay → 400 ANSWERS_RESCUED', k1vRes.status === 400, `status ${k1vRes.status}`)
    const { data: essayAfterRescue } = await supabase.from('official_exam_answers').select('points_earned, answer').eq('submission_id', subId).eq('question_id', essay.id).single()
    check('points_earned guru TETAP 7 (partial upsert tidak NULL-stomp)', essayAfterRescue?.points_earned === 7, `points=${essayAfterRescue?.points_earned}`)
    check('Teks jawaban rescue tersimpan', essayAfterRescue?.answer === 'revisi teks essay offline', `answer=${essayAfterRescue?.answer?.slice(0, 20)}`)

    // ---------- [CLAMP] grading melebihi poin soal → di-clamp ----------
    console.log('[CLAMP] Guru grading points_earned 9999 pada soal 10 poin → clamp ke 10')
    const { data: mc1Ans } = await supabase.from('official_exam_answers').select('id').eq('submission_id', subId).eq('question_id', mc1.id).single()
    const clampRes = await api(`/api/official-exam-submissions/${subId}`, guruTok, {
        method: 'PUT',
        body: JSON.stringify({ grades: [{ answer_id: mc1Ans?.id, points_earned: 9999 }] }),
    })
    const { data: mc1Clamped } = await supabase.from('official_exam_answers').select('points_earned').eq('id', mc1Ans?.id).single()
    check('Grading PUT diterima server', clampRes.status === 200, `status ${clampRes.status}`)
    check('Nilai 9999 di-clamp ke poin soal (10)', mc1Clamped?.points_earned === 10, `points=${mc1Clamped?.points_earned}`)
    const negRes = await api(`/api/official-exam-submissions/${subId}`, guruTok, {
        method: 'PUT',
        body: JSON.stringify({ grades: [{ answer_id: mc1Ans?.id, points_earned: -5 }] }),
    })
    const { data: mc1Neg } = await supabase.from('official_exam_answers').select('points_earned').eq('id', mc1Ans?.id).single()
    check('Nilai negatif di-clamp ke 0', negRes.status === 200 && mc1Neg?.points_earned === 0, `status ${negRes.status} points=${mc1Neg?.points_earned}`)
    const junkGradeRes = await api(`/api/official-exam-submissions/${subId}`, guruTok, {
        method: 'PUT',
        body: JSON.stringify({ grades: [{ answer_id: '00000000-0000-0000-0000-000000000000', points_earned: 5 }] }),
    })
    check('answer_id asing → 400 (bukan lolos diam-diam)', junkGradeRes.status === 400, `status ${junkGradeRes.status}`)

    // ---------- [LATE] submit lewat grace → force-close + rescue ----------
    console.log('[LATE] Submit lewat grace (started_at dimundurkan 2 jam via DB)')
    const lateStart = await api('/api/official-exam-submissions', siswaC.token, { method: 'POST', body: JSON.stringify({ exam_id: examLate.id }) })
    const lateBody = await lateStart.json().catch(() => null)
    check('Start examLate 200', lateStart.status === 200 && !!lateBody?.id, `status ${lateStart.status}`)
    created.officialSubmissions.push(lateBody?.id)
    // Dimundurkan started_at → endAt & grace sudah lewat jauh
    await supabase.from('official_exam_submissions').update({ started_at: new Date(now - 120 * 60000).toISOString() }).eq('id', lateBody.id)
    const lateRes = await api('/api/official-exam-submissions', siswaC.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: lateBody.id, submit: true,
            answers: [{ question_id: lateQs[0].id, answer: 'A' }],
        }),
    })
    const lateResBody = await lateRes.json().catch(() => null)
    const lateClosed409 = lateRes.status === 409
    const lateRescued400 = lateRes.status === 400 && lateResBody?.code === 'ANSWERS_RESCUED'
    check('Submit lewat grace ditolak (409 TIME_EXPIRED atau sudah ditutup sweep → 400 RESCUED)', lateClosed409 || lateRescued400, `status ${lateRes.status} code=${lateResBody?.code}`)
    const { data: lateSub } = await supabase.from('official_exam_submissions').select('is_submitted, total_score, submitted_at').eq('id', lateBody.id).single()
    const { data: lateAns } = await supabase.from('official_exam_answers').select('points_earned, answer').eq('submission_id', lateBody.id).eq('question_id', lateQs[0].id).maybeSingle()
    check('Submission tertutup paksa (is_submitted)', lateSub?.is_submitted === true, `submitted=${lateSub?.is_submitted}`)
    check('Jawaban lewat-grace TETAP direscue + ter-grade (MC benar → 10)', lateAns?.points_earned === 10, `points=${lateAns?.points_earned} answer=${lateAns?.answer}`)
    check('submitted_at di-backdate ke ends_at (rekapan jujur)', lateSub?.submitted_at && new Date(lateSub.submitted_at).getTime() < now, `submitted_at=${lateSub?.submitted_at}`)

    // ---------- [RELEASE] ----------
    console.log('[RELEASE] results_released → siswa melihat skor')
    const preRelease = await api(`/api/official-exam-submissions?exam_id=${examMain.id}`, siswaA.token)
    const preList = await preRelease.json().catch(() => null)
    const preRow = (Array.isArray(preList) ? preList : []).find(r => r.id === subId)
    check('Sebelum release: results_hidden=true + skor null', preRow?.results_hidden === true && preRow?.total_score == null, `hidden=${preRow?.results_hidden} total=${preRow?.total_score}`)
    const relRes = await api(`/api/official-exams/${examMain.id}`, adminTok, {
        method: 'PUT',
        body: JSON.stringify({ results_released: true }),
    })
    check('PUT results_released=true 200', relRes.status === 200, `status ${relRes.status}`)
    const postRelease = await api(`/api/official-exam-submissions?exam_id=${examMain.id}`, siswaA.token)
    const postList = await postRelease.json().catch(() => null)
    const postRow = (Array.isArray(postList) ? postList : []).find(r => r.id === subId)
    check('Setelah release: skor terlihat siswa', postRow?.results_hidden === false && typeof postRow?.total_score === 'number', `hidden=${postRow?.results_hidden} total=${postRow?.total_score}`)

    // ---------- RINGKASAN ----------
    console.log('\n===== HASIL E2E AUDIT UTS/UAS =====')
    const failed = results.filter(r => !r.ok)
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    console.log(failed.length === 0 ? 'E2E-OFFICIAL-AUDIT: PASS ✅' : 'E2E-OFFICIAL-AUDIT: ADA FAIL ❌')
    await stopServerSafe(server, BASE)
    server = null
    process.exit(failed.length === 0 ? 0 : 1)
}

async function cleanup() {
    if (server) await stopServerSafe(server, BASE).catch(() => { })
    const del = (t, ids, col = 'id') => ids.length ? supabase.from(t).delete().in(col, ids) : Promise.resolve()
    await supabase.from('grade_history').delete().in('ref_id', created.officialExams)
    await supabase.from('notifications').delete().in('user_id', created.users)
    await del('official_exam_answers', created.officialSubmissions, 'submission_id')
    await del('official_exam_submissions', created.officialSubmissions)
    await del('official_exam_questions', created.officialQuestions)
    await del('official_exams', created.officialExams)
    await del('sessions', created.sessions, 'token')
    await del('student_enrollments', created.enrollments)
    await del('students', created.students)
    await del('teaching_assignments', created.tas)
    await del('teachers', created.teachers)
    await del('users', created.users)
    await del('classes', created.classes)
    await del('subjects', created.subjects)
    console.log('cleanup selesai')
}

main()
    .then(() => cleanup())
    .catch(async e => { console.error('ERROR:', e.message); await cleanup().catch(() => { }); process.exit(1) })
