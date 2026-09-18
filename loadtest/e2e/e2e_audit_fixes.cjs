/**
 * E2E AUDIT FIXES — verifikasi perbaikan audit eksternal 2026-09-18 fitur ulangan.
 *
 *   [K1] RESCUE jawaban offline: submission ditutup (is_submitted=true via
 *        force-close) → PUT draft tetap menyelamatkan jawaban (objektif di-grade,
 *        total direkap) → 400 code ANSWERS_RESCUED (bukan 400 polos).
 *   [K2] PUT koreksi guru: question_id asing → 400; skor > poin soal → clamp;
 *        body answer/is_correct diabaikan (jawaban siswa tak tertimpa).
 *   [K3] Durasi: POST exams durasi < 5 → 400; PUT durasi < 5 → 400.
 *   [M7] Poin soal < 1 / desimal → 400 (POST); max_violations di luar 1..10 → 400.
 *   [H1] Unpublish dengan submission terkumpul → 409; DELETE soal dengan attempt → 409.
 *   [H2] Kunci ditahan: siswa submit cepat saat jendela MASIH terbuka → GET
 *        detail submission → correct_answer ter-strip; setelah jam tutup → terlihat.
 *   [M9] batch_id injection: guru menyusup exam ke batch guru lain → 403.
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_audit_fixes.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const crypto = require('crypto')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PORT = 3113
const BASE = `http://localhost:${PORT}`

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], exams: [], questions: [], submissions: [],
    enrollments: [], quizzes: [], quizQuestions: [], quizSubmissions: [],
    officialExams: [], officialQuestions: [], officialSubmissions: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `ax_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} IPA`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const mkGuru = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} ${label}`, password_hash: passHash, role: 'GURU', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const t = await mustInsert(supabase, 'teachers', { user_id: u.id, school_id: school.id }, `teacher ${label}`)
        created.teachers.push(t.id)
        const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session ${label}`)).token
        created.sessions.push(tok)
        return { user: u, teacher: t, token: tok }
    }
    const guru1 = await mkGuru('owner')   // korban batch (M9)
    const guru2 = await mkGuru('lain')    // penyerang (M9)

    const mkClass = async (label) => {
        const c = await mustInsert(supabase, 'classes', { name: `${U} 9${label}`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, `class ${label}`)
        created.classes.push(c.id)
        return c
    }
    const classA = await mkClass('A'), classB = await mkClass('B')

    const mkTa = (teacher, cls) => mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: cls.id, subject_id: subject.id, academic_year_id: year.id }, 'TA')
        .then(ta => { created.tas.push(ta.id); return ta })
    const taA1 = await mkTa(guru1.teacher, classA) // guru1 di A
    const taB1 = await mkTa(guru1.teacher, classB) // guru1 di B (batch-nya)
    const taA2 = await mkTa(guru2.teacher, classA) // guru2 juga mengajar mapel sama di A → bukan TA batch, tapi co-teacher kelas A
    // guru2 perlu TA di kelas C sendiri untuk M9 (TA sah miliknya, beda kelas dari batch)
    const classC = await mkClass('C')
    const taC2 = await mkTa(guru2.teacher, classC)

    // siswa A
    const mkStudent = async (label, cls) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_s${label}`, full_name: `${U} Siswa ${label.toUpperCase()}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}${label}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_s${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session ${label}`)).token
        created.sessions.push(tok)
        return { user: u, student: st, token: tok }
    }
    const siswaA = await mkStudent('a', classA)

    console.log('fixtures OK: guru owner(A+B batch) + guru lain(A co + C) + siswa A')

    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ---------- Setup exam utama: 2 soal objektif + 1 esai, aktif ----------
    const examMain = (await (await api('/api/exams', guru1.token, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Main`, start_time: new Date(Date.now() - 300000).toISOString(),
            duration_minutes: 60, teaching_assignment_id: taA1.id, is_randomized: false,
            max_violations: 3, show_results_immediately: true,
        }),
    })).json())
    created.exams.push(examMain.id)
    const qRows = [
        { exam_id: examMain.id, question_text: `${U} obj1`, question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'A', points: 40, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: examMain.id, question_text: `${U} obj2`, question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'B', points: 40, order_index: 1, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: examMain.id, question_text: `${U} esai`, question_type: 'ESSAY', correct_answer: null, points: 20, order_index: 2, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
    ]
    const { data: qs, error: qErr } = await supabase.from('exam_questions').insert(qRows).select()
    if (qErr) throw new Error('seed soal: ' + qErr.message)
    created.questions.push(...qs.map(q => q.id))
    const pubRes = await api(`/api/exams/${examMain.id}`, guru1.token, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    check('setup: publish exam utama', pubRes.status === 200, `status=${pubRes.status}`)

    // Siswa A start + submit cepat (H2: jendela masih terbuka)
    const st = await (await api('/api/exam-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ exam_id: examMain.id }) })).json()
    created.submissions.push(st.id)
    const su = await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: st.id, submit: true,
            answers: [
                { question_id: qs[0].id, answer: 'A' }, // benar 40
                { question_id: qs[1].id, answer: 'A' }, // salah 0
                { question_id: qs[2].id, answer: 'jawaban esai siswa' },
            ],
        }),
    })
    check('setup: siswa submit (40/100 + esai pending)', su.status === 200, `status=${su.status}`)

    // ================= [H2] kunci ditahan sampai jam tutup =================
    console.log('\n[H2] kunci jawaban ditahan selama jendela terbuka')
    const det = await (await api(`/api/exam-submissions/${st.id}`, siswaA.token)).json()
    const keysLeaked = (det.exam?.questions || []).some(q => q.correct_answer !== undefined)
    // H2 revisi: is_correct/score = hasil milik siswa sendiri (TETAP terlihat —
    // fitur Tampilkan Hasil Langsung); yang ditahan sampai jam tutup hanya KUNCI.
    // Over-strip pertama merusak halaman hasil (tertangkap e2e_runner_unification).
    check('H2a: siswa submit cepat, jendela TERBUKA → correct_answer ter-strip (kunci ditahan)', !keysLeaked, `leaked=${keysLeaked}`)
    check('H2b: skor milik siswa sendiri TETAP terlihat saat jendela terbuka (hasil, bukan kunci)',
        (det.answers || []).some(a => a.is_correct !== undefined), `n=${(det.answers || []).length}`)
    // Setelah jam tutup ( Geser jadwal exam ke masa lalu via service-role, paritas expiry server)
    await supabase.from('exams').update({
        start_time: new Date(Date.now() - 7200000).toISOString(),
        duration_minutes: 60,
    }).eq('id', examMain.id)
    const det2 = await (await api(`/api/exam-submissions/${st.id}`, siswaA.token)).json()
    const keysVisible = (det2.exam?.questions || []).every(q => q.correct_answer !== undefined)
    check('H2c: setelah jam tutup → kunci terlihat (normal)', keysVisible, `n=${(det2.exam?.questions || []).length}`)

    // ================= [K1] rescue jawaban offline =================
    console.log('\n[K1] rescue jawaban saat submission tertutup')
    // Buat submission kedua yang SUDAH ditutup (force-close dengan jawaban lama):
    const exam2 = (await (await api('/api/exams', guru1.token, {
        method: 'POST',
        body: JSON.stringify({
            // Masa depan: siswa harus bisa START dulu; penutupan paksa
            // disimulasikan via update DB (persis hasil sweep).
            title: `${U} K1`, start_time: new Date(Date.now() - 30000).toISOString(),
            duration_minutes: 60, teaching_assignment_id: taA1.id, is_randomized: false,
            max_violations: 3, show_results_immediately: true,
        }),
    })).json())
    created.exams.push(exam2.id)
    const { data: qs2 } = await supabase.from('exam_questions').insert([
        { exam_id: exam2.id, question_text: `${U} k1 q1`, question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'A', points: 50, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: exam2.id, question_text: `${U} k1 q2`, question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'B', points: 50, order_index: 1, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
    ]).select()
    created.questions.push(...qs2.map(q => q.id))
    await api(`/api/exams/${exam2.id}`, guru1.token, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    const st2res = await api('/api/exam-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ exam_id: exam2.id }) })
    const st2 = await st2res.json().catch(() => null)
    if (!st2res.ok || !st2?.id) throw new Error(`K1 setup start gagal: ${st2res.status}`)
    created.submissions.push(st2.id)
    // Siswa hanya tersimpan 1 jawaban lama (q1=A salah) sebelum "offline"
    await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: st2.id, answers: [{ question_id: qs2[0].id, answer: 'B' }] }),
    })
    // Force-close: tandai submitted langsung (simulasi sweep yang menutup submission)
    await supabase.from('exam_submissions').update({
        is_submitted: true, submitted_at: new Date().toISOString(), is_graded: true,
    }).eq('id', st2.id)
    // Koneksi pulih → client kirim draft PENUH (2 jawaban)
    const rescue = await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({
            submission_id: st2.id,
            answers: [
                { question_id: qs2[0].id, answer: 'A' }, // benar — hanya ada di draft offline
                { question_id: qs2[1].id, answer: 'B' }, // benar — hanya ada di draft offline
            ],
        }),
    })
    const rescueBody = await rescue.json().catch(() => null)
    check('K1a: PUT draft pasca-tutup → 400 code ANSWERS_RESCUED',
        rescue.status === 400 && rescueBody?.code === 'ANSWERS_RESCUED',
        `status=${rescue.status} code=${rescueBody?.code}`)
    // Verifikasi DB: jawaban offline terselamatkan + skor direkap
    const { data: k1answers } = await supabase.from('exam_answers').select('question_id, answer, is_correct, points_earned').eq('submission_id', st2.id)
    const k1q1 = (k1answers || []).find(a => a.question_id === qs2[0].id)
    const k1q2 = (k1answers || []).find(a => a.question_id === qs2[1].id)
    check('K1b: jawaban offline q1=A & q2=B terselamatkan (di-grade benar)',
        k1q1?.answer === 'A' && k1q1?.is_correct === true && k1q2?.answer === 'B' && k1q2?.is_correct === true,
        `q1=${k1q1?.answer}/${k1q1?.is_correct} q2=${k1q2?.answer}/${k1q2?.is_correct}`)
    const k1sub = (await supabase.from('exam_submissions').select('total_score, max_score').eq('id', st2.id).single()).data
    check('K1c: total_score direkap = 100/100 (sebelumnya 0)', k1sub?.total_score === 100, `${k1sub?.total_score}/${k1sub?.max_score}`)
    // PUT tanpa jawaban → 400 polos (bukan rescue path)
    const noRescue = await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT', body: JSON.stringify({ submission_id: st2.id, violation: { type: 'TAB_SWITCH', at: Date.now() } }),
    })
    const noRescueBody = await noRescue.json().catch(() => null)
    check('K1d: PUT tanpa jawaban pasca-tutup → 400 polos (bukan rescue)',
        noRescue.status === 400 && noRescueBody?.code === undefined, `status=${noRescue.status}`)

    // ================= [K2] hardening PUT koreksi =================
    console.log('\n[K2] PUT koreksi guru — filter + clamp + proteksi jawaban')
    // question_id asing
    const asing = crypto.randomUUID()
    const k2a = await api(`/api/exam-submissions/${st.id}`, guru1.token, {
        method: 'PUT', body: JSON.stringify({ answers: [{ question_id: asing, score: 99 }], is_graded: true }),
    })
    check('K2a: question_id asing → 400', k2a.status === 400, `status=${k2a.status}`)
    // clamp + proteksi jawaban: esai diberi skor 9999 (> poin 20) & coba timpa answer
    const k2b = await api(`/api/exam-submissions/${st.id}`, guru1.token, {
        method: 'PUT',
        body: JSON.stringify({
            answers: [{
                question_id: qs[2].id, score: 9999,
                answer: 'JAWABAN PALSU', is_correct: true,
            }],
            is_graded: false,
        }),
    })
    check('K2b: koreksi esai skor over-point → 200 (di-clamp)', k2b.status === 200, `status=${k2b.status}`)
    const k2row = (await supabase.from('exam_answers').select('answer, is_correct, points_earned').eq('submission_id', st.id).eq('question_id', qs[2].id).single()).data
    check('K2c: points_earned clamp ke poin soal (20, bukan 9999)', k2row?.points_earned === 20, `pts=${k2row?.points_earned}`)
    check('K2d: jawaban siswa TIDAK tertimpa (tetap "jawaban esai siswa")', k2row?.answer === 'jawaban esai siswa', `answer="${k2row?.answer?.slice(0, 25)}"`)
    check('K2e: is_correct tidak tertimpa dari body (tetap nilai auto-grade siswa: false)',
        k2row?.is_correct === false, `is_correct=${k2row?.is_correct}`)
    const k2total = (await supabase.from('exam_submissions').select('total_score').eq('id', st.id).single()).data
    check('K2f: total direkap benar (40 obj + 20 esai = 60)', k2total?.total_score === 60, `total=${k2total?.total_score}`)

    // ================= [K3] + [M7] validasi numerik =================
    console.log('\n[K3/M7] validasi durasi, poin, max_violations')
    // Exam draft khusus M7 (soal bisa dimutasi — exam aktif menolak 409 duluan)
    const examDraft = (await (await api('/api/exams', guru1.token, {
        method: 'POST',
        body: JSON.stringify({ title: `${U} Draft`, start_time: new Date(Date.now() + 3600000).toISOString(), duration_minutes: 30, teaching_assignment_id: taA1.id }),
    })).json())
    created.exams.push(examDraft.id)
    const k3a = await api('/api/exams', guru1.token, {
        method: 'POST',
        body: JSON.stringify({ title: `${U} Dur0`, start_time: new Date().toISOString(), duration_minutes: 0, teaching_assignment_id: taA1.id }),
    })
    check('K3a: POST durasi 0 → 400', k3a.status === 400, `status=${k3a.status}`)
    const k3b = await api('/api/exams', guru1.token, {
        method: 'POST',
        body: JSON.stringify({ title: `${U} Dur4`, start_time: new Date().toISOString(), duration_minutes: 4, teaching_assignment_id: taA1.id }),
    })
    check('K3b: POST durasi 4 → 400', k3b.status === 400, `status=${k3b.status}`)
    const k3c = await api(`/api/exams/${examMain.id}`, guru1.token, {
        method: 'PUT', body: JSON.stringify({ duration_minutes: 2 }),
    })
    check('K3c: PUT durasi 2 → 400', k3c.status === 400, `status=${k3c.status}`)
    const m7a = await api(`/api/exams/${examDraft.id}/questions`, guru1.token, {
        method: 'POST',
        body: JSON.stringify({ questions: [{ question_text: 'x', question_type: 'TRUE_FALSE', correct_answer: 'BENAR', points: 0 }] }),
    })
    check('M7a: POST soal poin 0 → 400', m7a.status === 400, `status=${m7a.status}`)
    // seed 1 soal di draft untuk PUT
    const { data: draftQ } = await supabase.from('exam_questions').insert({
        exam_id: examDraft.id, question_text: `${U} draft q`, question_type: 'TRUE_FALSE',
        correct_answer: 'BENAR', points: 10, order_index: 0, status: 'approved',
        difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain',
    }).select()
    created.questions.push(draftQ[0].id)
    const m7b = await api(`/api/exams/${examDraft.id}/questions`, guru1.token, {
        method: 'PUT', body: JSON.stringify({ question_id: draftQ[0].id, points: -5 }),
    })
    check('M7b: PUT soal poin -5 → 400', m7b.status === 400, `status=${m7b.status}`)
    const m7c = await api(`/api/exams/${examMain.id}`, guru1.token, {
        method: 'PUT', body: JSON.stringify({ max_violations: 99 }),
    })
    check('M7c: PUT max_violations 99 → 400', m7c.status === 400, `status=${m7c.status}`)

    // ================= [H1] unpublish & delete guard =================
    console.log('\n[H1] unpublish dengan submission → 409; delete soal dengan attempt → 409')
    const h1a = await api(`/api/exams/${examMain.id}`, guru1.token, {
        method: 'PUT', body: JSON.stringify({ is_active: false }),
    })
    check('H1a: unpublish exam dengan submission terkumpul → 409', h1a.status === 409, `status=${h1a.status}`)
    const h1b = await api(`/api/exams/${examMain.id}/questions?question_id=${qs[0].id}`, guru1.token, { method: 'DELETE' })
    check('H1b: DELETE soal dengan attempt ada → 409', h1b.status === 409, `status=${h1b.status}`)
    // soal tetap utuh
    const { count: qCount } = await supabase.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', examMain.id)
    check('H1c: soal tetap utuh (3)', qCount === 3, `n=${qCount}`)

    // ================= [M9] batch_id injection =================
    console.log('\n[M9] batch_id injection → 403')
    // guru1 membuat batch sah (A + B)
    const batchId = crypto.randomUUID()
    const b1 = await (await api('/api/exams', guru1.token, {
        method: 'POST',
        body: JSON.stringify({ title: `${U} Batch`, start_time: new Date(Date.now() + 3600000).toISOString(), duration_minutes: 30, teaching_assignment_id: taA1.id, batch_id: batchId }),
    })).json()
    created.exams.push(b1.id)
    const b2 = await (await api('/api/exams', guru1.token, {
        method: 'POST',
        body: JSON.stringify({ title: `${U} Batch`, start_time: new Date(Date.now() + 3600000).toISOString(), duration_minutes: 30, teaching_assignment_id: taB1.id, batch_id: batchId }),
    })).json()
    created.exams.push(b2.id)
    check('M9-setup: guru1 membuat batch 2 member', !!b1.id && !!b2.id)
    // guru2 (bukan pemilik batch, TA kelas C bukan co-teacher batch) coba menyusup
    const m9 = await api('/api/exams', guru2.token, {
        method: 'POST',
        body: JSON.stringify({ title: `${U} Susup`, start_time: new Date(Date.now() + 3600000).toISOString(), duration_minutes: 30, teaching_assignment_id: taC2.id, batch_id: batchId }),
    })
    check('M9a: guru lain menyusup exam ke batch → 403', m9.status === 403, `status=${m9.status}`)
    const m9b = (await m9.json().catch(() => null))
    check('M9b: exam susup TIDAK tersimpan', !m9b?.id, `id=${m9b?.id?.slice(0, 8)}`)
    // jalur sah tetap jalan: co-teacher mapel sama (guru2 di kelas A) BOLEH ikut batch
    const m9ok = await api('/api/exams', guru2.token, {
        method: 'POST',
        body: JSON.stringify({ title: `${U} CoTeacherOK`, start_time: new Date(Date.now() + 3600000).toISOString(), duration_minutes: 30, teaching_assignment_id: taA2.id, batch_id: batchId }),
    })
    check('M9c: co-teacher mapel sama di kelas member tetap BOLEH (200)', m9ok.status === 200, `status=${m9ok.status}`)
    if (m9ok.status === 200) {
        const m9body = await m9ok.json()
        created.exams.push(m9body.id)
    }

    // ================= [R4] rescue esai tidak merusak nilai koreksi =================
    console.log('\n[R4] rescue esai — nilai koreksi guru selamat')
    // Exam3: 1 esai saja. Siswa submit → guru koreksi 12/20 → force-close
    // (sudah submitted) → "koneksi pulih" kirim draft esai BARU → assert
    // points_earned koreksi (12) SELAMAT & answer ter-update.
    const exam3 = (await (await api('/api/exams', guru1.token, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} R4`, start_time: new Date(Date.now() - 30000).toISOString(),
            duration_minutes: 60, teaching_assignment_id: taA1.id, is_randomized: false,
            max_violations: 3, show_results_immediately: true,
        }),
    })).json())
    created.exams.push(exam3.id)
    const { data: q3 } = await supabase.from('exam_questions').insert({
        exam_id: exam3.id, question_text: `${U} r4 esai`, question_type: 'ESSAY',
        correct_answer: null, points: 20, order_index: 0, status: 'approved',
        difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    }).select()
    created.questions.push(q3[0].id)
    await api(`/api/exams/${exam3.id}`, guru1.token, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    const st3 = await (await api('/api/exam-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ exam_id: exam3.id }) })).json()
    created.submissions.push(st3.id)
    await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: st3.id, submit: true, answers: [{ question_id: q3[0].id, answer: 'jawaban awal' }] }),
    })
    // Guru koreksi 12/20
    await api(`/api/exam-submissions/${st3.id}`, guru1.token, {
        method: 'PUT',
        body: JSON.stringify({ answers: [{ question_id: q3[0].id, score: 12, feedback: 'cukup' }], is_graded: true }),
    })
    const preRescue = (await supabase.from('exam_answers').select('points_earned, feedback, answer').eq('submission_id', st3.id).eq('question_id', q3[0].id).single()).data
    check('R4-setup: koreksi guru 12/20 + feedback tersimpan', preRescue?.points_earned === 12 && preRescue?.feedback === 'cukup', `pts=${preRescue?.points_earned}`)
    // "Offline" draft esai baru → koneksi pulih → PUT ditolak tapi jawaban diselamatkan
    const r4 = await api('/api/exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: st3.id, answers: [{ question_id: q3[0].id, answer: 'jawaban revisi offline' }] }),
    })
    const r4body = await r4.json().catch(() => null)
    check('R4a: PUT draft esai pasca-tutup → 400 ANSWERS_RESCUED', r4.status === 400 && r4body?.code === 'ANSWERS_RESCUED', `status=${r4.status} code=${r4body?.code}`)
    const postRescue = (await supabase.from('exam_answers').select('points_earned, feedback, answer, is_correct').eq('submission_id', st3.id).eq('question_id', q3[0].id).single()).data
    check('R4b: nilai koreksi guru SELAMAT (12, bukan 0/null)', postRescue?.points_earned === 12, `pts=${postRescue?.points_earned}`)
    check('R4c: feedback koreksi selamat ("cukup")', postRescue?.feedback === 'cukup', `fb="${postRescue?.feedback}"`)
    check('R4d: jawaban ter-update ke revisi offline', postRescue?.answer === 'jawaban revisi offline', `answer="${postRescue?.answer?.slice(0, 25)}"`)

    // ================= [R1] rescue UTS/UAS =================
    console.log('\n[R1] rescue jawaban UTS/UAS pasca-tutup')
    const off1 = await mustInsert(supabase, 'official_exams', {
        school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
        exam_type: 'UTS', title: `${U} R1`, description: null,
        start_time: new Date(Date.now() - 30000).toISOString(), duration_minutes: 60,
        window_end_time: new Date(Date.now() + 3600000).toISOString(),
        is_randomized: false, max_violations: 3, target_class_ids: [classA.id],
        created_by: guru1.user.id, is_active: true, show_results_immediately: true,
    }, 'uts r1')
    created.officialExams.push(off1.id)
    const { data: offQ } = await supabase.from('official_exam_questions').insert({
        exam_id: off1.id, question_text: `${U} r1 q1`, question_type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'], correct_answer: 'A', points: 100, order_index: 0,
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    }).select()
    created.officialQuestions.push(offQ[0].id)
    const ost = await (await api('/api/official-exam-submissions', siswaA.token, { method: 'POST', body: JSON.stringify({ exam_id: off1.id }) })).json()
    created.officialSubmissions.push(ost.id)
    // force-close via DB (simulasi sweep)
    await supabase.from('official_exam_submissions').update({ is_submitted: true, submitted_at: new Date().toISOString(), is_graded: true }).eq('id', ost.id)
    const r1 = await api('/api/official-exam-submissions', siswaA.token, {
        method: 'PUT',
        body: JSON.stringify({ submission_id: ost.id, answers: [{ question_id: offQ[0].id, answer: 'A' }] }),
    })
    const r1body = await r1.json().catch(() => null)
    check('R1a: PUT draft UTS pasca-tutup → 400 ANSWERS_RESCUED',
        r1.status === 400 && r1body?.code === 'ANSWERS_RESCUED', `status=${r1.status} code=${r1body?.code}`)
    const r1ans = (await supabase.from('official_exam_answers').select('answer, is_correct, points_earned').eq('submission_id', ost.id).eq('question_id', offQ[0].id).single()).data
    check('R1b: jawaban offline UTS terselamatkan + di-grade', r1ans?.answer === 'A' && r1ans?.is_correct === true && r1ans?.points_earned === 100, `${r1ans?.answer}/${r1ans?.is_correct}/${r1ans?.points_earned}`)

    // ================= [R2] rescue kuis =================
    console.log('\n[R2] rescue jawaban kuis pasca-tutup')
    const quiz1 = await mustInsert(supabase, 'quizzes', {
        title: `${U} R2 Kuis`, duration_minutes: 30, teaching_assignment_id: taA1.id,
        is_randomized: false, submission_mode: 'ONLINE', is_active: true,
        available_from: new Date(Date.now() - 60000).toISOString(),
    }, 'quiz r2')
    created.quizzes.push(quiz1.id)
    const { data: quizQ } = await supabase.from('quiz_questions').insert({
        quiz_id: quiz1.id, question_text: `${U} r2 q1`, question_type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'], correct_answer: 'A', points: 100, order_index: 0,
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    }).select()
    created.quizQuestions.push(quizQ[0].id)
    // siswa mulai attempt (POST) lalu force-close via DB
    const qst = await (await api('/api/quiz-submissions', siswaA.token, {
        method: 'POST',
        body: JSON.stringify({ quiz_id: quiz1.id, started_at: new Date().toISOString(), answers: [] }),
    })).json()
    if (qst?.id) created.quizSubmissions.push(qst.id)
    check('R2-setup: attempt kuis dibuat', !!qst?.id, `status=${qst ? 'ok' : 'fail'}`)
    await supabase.from('quiz_submissions').update({ submitted_at: new Date().toISOString(), is_graded: true }).eq('id', qst.id)
    const r2 = await api('/api/quiz-submissions', siswaA.token, {
        method: 'POST',
        body: JSON.stringify({
            quiz_id: quiz1.id, started_at: qst.started_at || new Date().toISOString(),
            answers: [{ question_id: quizQ[0].id, answer: 'A' }],
        }),
    })
    const r2body = await r2.json().catch(() => null)
    check('R2a: POST draft kuis pasca-tutup → 400 ANSWERS_RESCUED',
        r2.status === 400 && r2body?.code === 'ANSWERS_RESCUED', `status=${r2.status} code=${r2body?.code} err=${r2body?.error?.slice(0, 25)}`)
    const r2sub = (await supabase.from('quiz_submissions').select('answers, total_score, is_graded').eq('id', qst.id).single()).data
    const r2ans = (r2sub?.answers || []).find(a => a.question_id === quizQ[0].id)
    check('R2b: jawaban kuis terselamatkan (merge) + nilai ulang',
        r2ans?.answer === 'A' && r2ans?.is_correct === true && r2sub?.total_score === 100,
        `ans=${r2ans?.answer}/${r2ans?.is_correct} total=${r2sub?.total_score}`)

    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL E2E AUDIT FIXES =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'E2E-AUDIT-FIXES: PASS ✅' : 'E2E-AUDIT-FIXES: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : null
    const delBy = (t, col, ids) => ids.length ? supabase.from(t).delete().in(col, ids) : null
    await delBy('exam_answers', 'submission_id', created.submissions)
    await del('exam_submissions', created.submissions)
    await delBy('exam_questions', 'exam_id', created.exams)
    await del('exams', created.exams)
    await delBy('official_exam_answers', 'submission_id', created.officialSubmissions)
    await del('official_exam_submissions', created.officialSubmissions)
    await delBy('official_exam_questions', 'exam_id', created.officialExams)
    await del('official_exams', created.officialExams)
    await del('quiz_submissions', created.quizSubmissions)
    await delBy('quiz_questions', 'quiz_id', created.quizzes)
    await del('quizzes', created.quizzes)
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
