/**
 * PROBE ANON KOMPREHENSIF — verifikasi tabel terkunci dari akses anon PostgREST
 * (meniru browser yang memegang NEXT_PUBLIC anon key).
 *
 * Desain anti-false-pass (hasil audit robustness):
 *  1. KONTROL POSITIF AWAL: GET /auth/v1/health dengan anon key WAJIB 200
 *     (401 untuk key palsu — teruji diskriminatif). Gagal → ABORT total:
 *     anon key invalid / jaringan mati / salah project tidak boleh menghasilkan
 *     hijau palsu. (Tidak memakai tabel schools: policy schools_super_admin_all
 *     me-subquery users → rekursi untuk anon — bug laten pre-existing, app tak
 *     terdampak karena /api/schools/public memakai service role.)
 *  2. Error anon TIDAK otomatis dihitung "blocked". Hanya pesan RLS spesifik
 *     yang dihitung blocked: "row-level security", "permission denied", dan
 *     "infinite recursion" (rekursi = evaluasi policy meledak → operasi GAGAL,
 *     anon terblokir — efek aman walau penyebabnya policy yang perlu ditulis
 *     ulang kalau kelak pakai supabase-auth). Error lain (FK, tabel hilang,
 *     JWT) = FAIL eksplisit.
 *  3. Seed marker via service role untuk tabel yang kosong (rantai kuis, exam,
 *     bank soal, nilai, dsb.) sehingga perbandingan service-vs-anon menjadi
 *     bukti KUAT, bukan "tabel kosong tak bisa dibedakan".
 *  4. Uji tulis memakai fixture FK lengkap — satu-satunya alasan kegagalan
 *     anon adalah RLS, bukan FK/NOT NULL yang kebetulan menolak.
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/probe_anon_rls.cjs
 * Exit 0 = tidak ada kebocoran/kegagalan. WEAK dihitung hijau tapi dilabel.
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const results = []
function record(name, verdict, detail = '') {
    const ok = verdict === 'STRONG' || verdict === 'BLOCKED' || verdict === 'WEAK'
    results.push({ name, verdict, detail, ok })
    const tag = { STRONG: '✓', BLOCKED: '✓', WEAK: '~', LEAK: '✗', FAIL: '✗' }[verdict]
    console.log(`  ${tag} [${verdict}] ${name}${detail ? ` (${detail})` : ''}`)
}

/** Klasifikasi error anon: hanya RLS (atau rekursi policy) yang dihitung blocked. */
function classifyAnonError(err) {
    const msg = `${err?.message || ''} ${err?.code || ''} ${err?.details || ''} ${err?.hint || ''}`
    if (/row-level security/i.test(msg)) return 'RLS'
    if (/permission denied/i.test(msg)) return 'RLS'
    if (/infinite recursion/i.test(msg)) return 'RLS_RECURSION'
    if (/jwt|api key|invalid api key/i.test(msg)) return 'PROBE_AUTH' // masalah probe, BUKAN bukti
    return 'UNKNOWN'
}

/** SELECT anon dengan fallback: head+count kadang mengembalikan error TANPA
 *  message — ulangi via select biasa supaya pesan asli terbaca. */
async function anonSelect(table) {
    const r = await anon.from(table).select('*', { count: 'exact', head: true })
    if (r.error && !r.error.message) {
        const r2 = await anon.from(table).select('*').limit(1)
        return { count: null, error: r2.error || null }
    }
    return { count: r.count ?? null, error: r.error || null }
}

/** Probe satu tabel: bandingkan apa yang dilihat service role vs anon. */
async function probeTable(table) {
    const svc = await admin.from(table).select('*', { count: 'exact', head: true })
    if (svc.error) return { verdict: 'FAIL', detail: `service error: ${svc.error.message}` }
    const svcCount = svc.count ?? 0

    const a = await anonSelect(table)
    if (a.error) {
        const cls = classifyAnonError(a.error)
        if (cls === 'RLS') return { verdict: 'BLOCKED', detail: a.error.message }
        if (cls === 'RLS_RECURSION') return { verdict: 'BLOCKED', detail: `rekursi policy (anon terblokir): ${a.error.message}` }
        return { verdict: 'FAIL', detail: `error non-RLS — bukan bukti terkunci: ${a.error.message || JSON.stringify(a.error)}` }
    }
    const anonCount = a.count ?? 0
    if (anonCount > 0) return { verdict: 'LEAK', detail: `anon MELIHAT ${anonCount} baris (service=${svcCount})!` }
    if (svcCount > 0) return { verdict: 'STRONG', detail: `service=${svcCount}, anon=0` }
    return { verdict: 'WEAK', detail: 'tabel kosong — tidak bisa dibedakan; kebenaran struktural di catalog' }
}

const LOCKED_TABLES = [
    'users', 'students', 'teachers', 'teaching_assignments', 'subjects', 'classes',
    'quizzes', 'assignments', 'question_passages', 'materials', 'notifications',
    'sessions', 'academic_years', 'announcements', 'exams',
    'exam_questions', 'exam_submissions', 'exam_answers',
    'official_exams', 'official_exam_questions', 'official_exam_submissions', 'official_exam_answers',
    'quiz_questions', 'quiz_submissions', 'student_submissions',
    'grades', 'question_bank', 'questions', 'student_enrollments',
    'admin_reviews', 'ai_reviews', 'cron_runs',
    'schedules', 'schedule_entries', 'grade_history', 'subject_kkm',
]

const cleanupIds = {
    users: [], students: [], quizzes: [], questions: [], quizSubmissions: [],
    notifications: [], examAnswers: [], examSubmissions: [], examQuestions: [], exams: [],
    questionBank: [], legacyQuestions: [], grades: [], gradeHistory: [],
    studentSubmissions: [], subjectKkm: [],
}
let cleanupCronJob = null

async function main() {
    // ════════ [0] KONTROL POSITIF ANON (wajib hijau sebelum apa pun) ════════
    console.log('=== [0] Kontrol positif anon (validitas key + jaringan + project) ===')
    const health = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
        signal: AbortSignal.timeout(10000),
    }).catch(() => null)
    if (!health || health.status !== 200) {
        console.error(`  ✗ ABORT — /auth/v1/health status ${health?.status ?? 'fetch gagal'}: anon key invalid / jaringan mati / salah project. Probe tidak valid.`)
        process.exit(1)
    }
    console.log('  ✓ /auth/v1/health 200 (anon key valid — probe valid)')

    // ════════ [1] FIXTURE via service role (rantai kuis + exam + marker) ════════
    console.log('=== [1] Fixture marker via service role (supaya cek jadi bukti kuat) ===')
    const { data: school } = await admin.from('schools').select('id').eq('code', 'STG01').single()
    if (!school) { console.error('ABORT: STG01 tidak ada'); process.exit(1) }
    const { data: year } = await admin.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) { console.error('ABORT: tahun ajaran aktif tidak ada'); process.exit(1) }

    const ensure = async (table, match, insert) => {
        const { data } = await admin.from(table).select('id').match(match).maybeSingle()
        if (data) return data
        const { data: ins, error } = await admin.from(table).insert(insert).select().single()
        if (error) throw new Error(`ensure ${table}: ${error.message}`)
        return ins
    }
    const tGuruUser = await ensure('users', { username: 'stg_template_guru' },
        { username: 'stg_template_guru', full_name: 'Template Guru (Seed)', password_hash: bcrypt.hashSync('stg_template', 10), role: 'GURU', school_id: school.id })
    const tTeacher = await ensure('teachers', { user_id: tGuruUser.id }, { user_id: tGuruUser.id, school_id: school.id, nip: 'STG-TPL-01' })
    const tSubject = await ensure('subjects', { name: 'STG Template Mapel' }, { name: 'STG Template Mapel', school_id: school.id, kkm: 75 })
    const tClass = await ensure('classes', { name: 'STG Template Kelas' }, { name: 'STG Template Kelas', academic_year_id: year.id, grade_level: 1, school_level: 'SMP' })
    const tTa = await ensure('teaching_assignments', { teacher_id: tTeacher.id, class_id: tClass.id, subject_id: tSubject.id },
        { teacher_id: tTeacher.id, class_id: tClass.id, subject_id: tSubject.id, academic_year_id: year.id })

    const runId = Date.now() % 100000
    const mustIns = async (table, row, label, key) => {
        const { data, error } = await admin.from(table).insert(row).select().single()
        if (error) throw new Error(`fixture ${label}: ${error.message}`)
        if (key) cleanupIds[key].push(data.id)
        return data
    }
    const mUser = await mustIns('users',
        { username: `probe_anon_${runId}`, full_name: 'Probe Anon Siswa', password_hash: bcrypt.hashSync('x', 10), role: 'SISWA', school_id: school.id }, 'user', 'users')
    const mStudent = await mustIns('students',
        { user_id: mUser.id, nis: `probe${runId}`, class_id: tClass.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, 'student', 'students')

    // Rantai KUIS
    const mQuiz = await mustIns('quizzes',
        { teaching_assignment_id: tTa.id, title: `PROBE RLS Q ${runId}`, duration_minutes: 30, is_active: true }, 'quiz', 'quizzes')
    const { data: mQs, error: eqq } = await admin.from('quiz_questions').insert([
        { quiz_id: mQuiz.id, question_text: 'PROBE kunci', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'A', points: 10, order_index: 0 },
        { quiz_id: mQuiz.id, question_text: 'PROBE kunci 2', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'B', points: 10, order_index: 1 },
    ]).select()
    if (eqq) throw new Error('fixture quiz_questions: ' + eqq.message)
    cleanupIds.questions.push(...mQs.map(q => q.id))
    const mSub = await mustIns('quiz_submissions',
        { quiz_id: mQuiz.id, student_id: mStudent.id, started_at: new Date().toISOString(), answers: [], total_score: 7, max_score: 20 }, 'quiz_sub', 'quizSubmissions')
    const mNotif = await mustIns('notifications',
        { user_id: mUser.id, type: 'SYSTEM', title: 'PROBE RLS', message: 'x' }, 'notif', 'notifications')

    // Rantai EXAM (ulangan)
    const mExam = await mustIns('exams',
        { title: `PROBE RLS E ${runId}`, start_time: new Date(Date.now() - 3600e3).toISOString(), duration_minutes: 30, teaching_assignment_id: tTa.id, is_active: true, max_violations: 3 }, 'exam', 'exams')
    const mExamQ = await mustIns('exam_questions',
        { exam_id: mExam.id, question_text: 'PROBE exam kunci', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'A', points: 10, order_index: 0 }, 'exam_q', 'examQuestions')
    const mExamSub = await mustIns('exam_submissions',
        { exam_id: mExam.id, student_id: mStudent.id, started_at: new Date().toISOString(), is_submitted: false, question_order: [mExamQ.id], max_score: 10 }, 'exam_sub', 'examSubmissions')
    await mustIns('exam_answers',
        { submission_id: mExamSub.id, question_id: mExamQ.id, answer: 'A', is_correct: true, points_earned: 10 }, 'exam_ans', 'examAnswers')

    // Marker tabel skor/bank/tunggal
    const mGrade = await mustIns('grades', { score: 55 }, 'grade', 'grades')
    await mustIns('grade_history',
        { school_id: school.id, source: 'QUIZ', ref_id: mQuiz.id, ref_title: 'PROBE', student_id: mStudent.id, new_score: 55, max_score: 100 }, 'grade_hist', 'gradeHistory')
    await mustIns('question_bank',
        { teacher_id: tTeacher.id, subject_id: tSubject.id, question_text: 'PROBE bank kunci', question_type: 'MULTIPLE_CHOICE', correct_answer: 'A' }, 'qbank', 'questionBank')
    await mustIns('questions', { type: 'PG', question: 'PROBE legacy', correct_answer: 'A' }, 'legacy_q', 'legacyQuestions')
    await mustIns('student_submissions',
        { student_id: mStudent.id, answers: [] }, 'student_sub', 'studentSubmissions')
    { // subject_kkm: UNIQUE(subject_id, school_level, grade_level) → idempoten via upsert
        const { error } = await admin.from('subject_kkm').upsert(
            { subject_id: tSubject.id, school_level: 'SMP', grade_level: 1, kkm: 75, school_id: school.id },
            { onConflict: 'subject_id,school_level,grade_level' }
        ).select().single()
        if (error) throw new Error('fixture kkm: ' + error.message)
        const { data: kkmRow } = await admin.from('subject_kkm').select('id')
            .eq('subject_id', tSubject.id).eq('school_level', 'SMP').eq('grade_level', 1).single()
        if (kkmRow) cleanupIds.subjectKkm.push(kkmRow.id)
    }
    { // cron_runs: PK = job → upsert marker
        const { error } = await admin.from('cron_runs').upsert({ job: `probe_anon_rls_${runId}`, last_run_at: new Date().toISOString() })
        if (error) throw new Error('fixture cron_runs: ' + error.message)
        cleanupCronJob = `probe_anon_rls_${runId}`
    }
    console.log('  fixture OK (kuis, exam, notifikasi, bank soal, nilai, kkm, cron marker)')

    // ════════ [2] BREADTH: semua tabel terkunci (count-compare) ════════
    console.log('=== [2] SELECT semua tabel terkunci (service vs anon) ===')
    for (const t of LOCKED_TABLES) {
        const r = await probeTable(t)
        record(`anon SELECT ${t}`, r.verdict, r.detail)
    }

    // ════════ [3] PEMBUKTIAN KUAT pada fixture (baris nyata ada) ════════
    console.log('=== [3] Bukti kuat: baris NYATA ada, anon tidak boleh melihat/mengubah ===')
    for (const [label, table, col, val] of [
        ['quiz_questions kunci jawaban', 'quiz_questions', 'quiz_id', mQuiz.id],
        ['quiz_submissions skor', 'quiz_submissions', 'id', mSub.id],
        ['exam_questions kunci jawaban', 'exam_questions', 'exam_id', mExam.id],
        ['exam_submissions skor', 'exam_submissions', 'id', mExamSub.id],
        ['question_bank kunci jawaban', 'question_bank', 'question_text', 'PROBE bank kunci'],
        ['notifications', 'notifications', 'id', mNotif.id],
        ['users (password_hash)', 'users', 'id', mUser.id],
    ]) {
        const svcRow = await admin.from(table).select('id').eq(col, val).limit(1)
        const a = await anon.from(table).select('*').eq(col, val).limit(1)
        if (a.error) {
            const cls = classifyAnonError(a.error)
            record(`${label}: anon SELECT by-id`, cls === 'RLS' || cls === 'RLS_RECURSION' ? 'BLOCKED' : 'FAIL', a.error.message)
        } else if (a.data.length > 0) {
            record(`${label}: anon SELECT by-id`, 'LEAK', `anon melihat ${a.data.length} baris!`)
        } else if (svcRow.data && svcRow.data.length > 0) {
            record(`${label}: anon SELECT by-id`, 'STRONG', 'service=1, anon=0')
        } else {
            record(`${label}: anon SELECT by-id`, 'FAIL', 'fixture tidak terlihat oleh service role?')
        }
    }

    // INSERT dengan FK NYATA — satu-satunya penolak yang mungkin = RLS/rekursi
    for (const [label, table, row] of [
        ['anon INSERT quiz_submissions (FK valid)', 'quiz_submissions', { quiz_id: mQuiz.id, student_id: mStudent.id, answers: [] }],
        ['anon INSERT exam_submissions (FK valid)', 'exam_submissions', { exam_id: mExam.id, student_id: mStudent.id, started_at: new Date().toISOString() }],
        ['anon INSERT notifications (FK valid)', 'notifications', { user_id: mUser.id, type: 'SYSTEM', title: 'probe', message: 'x' }],
        ['anon INSERT grades', 'grades', { score: 100 }],
    ]) {
        const { error } = await anon.from(table).insert(row)
        if (!error) record(label, 'LEAK', 'INSERT DITERIMA — kebocoran tulis!')
        else {
            const cls = classifyAnonError(error)
            record(label, cls === 'RLS' ? 'STRONG' : cls === 'RLS_RECURSION' ? 'BLOCKED' : 'FAIL',
                cls === 'RLS' ? 'ditolak RLS: ' + error.message : cls === 'RLS_RECURSION' ? 'ditolak rekursi policy: ' + error.message : `ditolak alasan non-RLS (bukan bukti): ${error.message}`)
        }
    }

    // UPDATE baris nyata — 0 baris terpengaruh & nilai tak berubah (atau ditolak RLS)
    const updCheck = async (label, table, patch, col, val, verify) => {
        const up = await anon.from(table).update(patch).eq(col, val)
        if (!up.error) {
            const affected = (up.data || []).length
            const after = await admin.from(table).select('*').eq(col, val).single()
            const unchanged = verify(after.data)
            if (affected === 0 && unchanged) record(label, 'STRONG', '0 baris terpengaruh, isi tak berubah')
            else record(label, 'LEAK', `affected=${affected}, isi=${JSON.stringify(after.data)}`)
        } else {
            const cls = classifyAnonError(up.error)
            record(label, cls === 'RLS' ? 'STRONG' : cls === 'RLS_RECURSION' ? 'BLOCKED' : 'FAIL',
                cls === 'RLS' ? 'ditolak RLS: ' + up.error.message : cls === 'RLS_RECURSION' ? 'ditolak rekursi policy: ' + up.error.message : `error non-RLS (bukan bukti): ${up.error.message}`)
        }
    }
    await updCheck('anon UPDATE quiz_submissions.total_score (tamper skor)', 'quiz_submissions', { total_score: 999 }, 'id', mSub.id, r => r?.total_score === 7)
    await updCheck('anon UPDATE notifications (phishing edit)', 'notifications', { is_read: true, title: 'HACKED' }, 'id', mNotif.id, r => r?.is_read === false && r?.title === 'PROBE RLS')
    await updCheck('anon UPDATE grades.score (tamper nilai)', 'grades', { score: 100 }, 'id', mGrade.id, r => r?.score === 55)

    // DELETE baris nyata
    const del1 = await anon.from('quiz_submissions').delete().eq('id', mSub.id)
    const stillThere = await admin.from('quiz_submissions').select('id').eq('id', mSub.id).maybeSingle()
    if (del1.error) {
        const cls = classifyAnonError(del1.error)
        record('anon DELETE quiz_submissions', cls === 'RLS' ? 'STRONG' : cls === 'RLS_RECURSION' ? 'BLOCKED' : 'FAIL', del1.error.message)
    } else if (stillThere.data) {
        record('anon DELETE quiz_submissions', 'STRONG', '0 baris terhapus, baris masih ada')
    } else {
        record('anon DELETE quiz_submissions', 'LEAK', 'baris hilang/terhapus oleh anon!')
    }

    // ════════ [4] KONTROL POSITIF SERVICE ROLE ════════
    console.log('=== [4] Kontrol positif service role (bypass RLS) ===')
    const ctl = await admin.from('schools').select('id').limit(1)
    const ctl2 = await admin.from('quiz_questions').select('id').eq('quiz_id', mQuiz.id)
    record('service role SELECT schools + quiz_questions', (!ctl.error && !ctl2.error && ctl2.data.length === 2) ? 'STRONG' : 'FAIL',
        ctl.error?.message || ctl2.error?.message || `schools=${ctl.data?.length}, soal=${ctl2.data?.length}`)

    // ════════ RINGKASAN ════════
    const failed = results.filter(r => !r.ok)
    const weak = results.filter(r => r.verdict === 'WEAK')
    const strong = results.filter(r => r.verdict === 'STRONG' || r.verdict === 'BLOCKED')
    console.log(`\n===== PROBE ANON: ${results.length - failed.length}/${results.length} PASS (${strong.length} bukti kuat, ${weak.length} weak) =====`)
    if (weak.length) console.log('  WEAK (percaya catalog pg_class/pg_policies untuk tabel ini):', weak.map(w => w.name.replace('anon SELECT ', '')).join(', '))
    if (failed.length) failed.forEach(f => console.log(`  ✗ [${f.verdict}] ${f.name} ${f.detail}`))
    process.exit(failed.length === 0 ? 0 : 1)
}

async function cleanup() {
    // hapus fixture marker (rantai template dibiarkan — dipakai ulang lintas run)
    const del = (t, ids) => ids.length ? admin.from(t).delete().in('id', ids) : Promise.resolve()
    await del('exam_answers', cleanupIds.examAnswers)
    await del('exam_submissions', cleanupIds.examSubmissions)
    await del('exam_questions', cleanupIds.examQuestions)
    await del('exams', cleanupIds.exams)
    await del('notifications', cleanupIds.notifications)
    await del('quiz_submissions', cleanupIds.quizSubmissions)
    await del('quiz_questions', cleanupIds.questions)
    await del('quizzes', cleanupIds.quizzes)
    await del('grade_history', cleanupIds.gradeHistory)
    await del('grades', cleanupIds.grades)
    await del('question_bank', cleanupIds.questionBank)
    await del('questions', cleanupIds.legacyQuestions)
    await del('student_submissions', cleanupIds.studentSubmissions)
    await del('subject_kkm', cleanupIds.subjectKkm)
    if (cleanupCronJob) await admin.from('cron_runs').delete().eq('job', cleanupCronJob)
    await del('students', cleanupIds.students)
    await del('users', cleanupIds.users)
}

main()
    .then(cleanup)
    .catch(async e => { console.error('ERROR:', e.message); await cleanup().catch(() => { }); process.exit(1) })
