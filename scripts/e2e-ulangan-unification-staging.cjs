/**
 * E2E staging: Unifikasi wrapper ulangan + bug fix audit.
 *
 * PRASYARAT (urutan WAJIB — NEXT_PUBLIC_* ter-inline saat BUILD):
 *   1. set -a; source .env.staging; set +a; npm run build
 *   2. set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   3. ENV_FILE=.env.staging node scripts/e2e-ulangan-unification-staging.cjs
 *
 * Mengexersais kontrak server yang dipakai wrapper guru/ulangan/[id] (komponen
 * admin via prop forcedIsUlangan). Client-side behavior (4-tab render, #hasil
 * hash, URL builder, ResetAttemptMenu) tidak di-test di sini (butuh browser
 * automation); yang diverify adalah kontrak API yang diandalkan kode client:
 *
 *  [A] Wrapper route parity: GET /dashboard/guru/ulangan/<id> → 200 (halaman
 *      render, bukan 404). GET tanpa ?type=ulangan tetap 200 (forced via prop).
 *  [B] Deep-link #hasil: GET /dashboard/guru/ulangan/<id>#hasil → 200 (hash
 *      di-handle client-side, bukan 404 server).
 *  [C] PUT publish + batch_sync: PUT /api/exams/<id> { is_active: true } →
 *      response mengandung field `batch_sync` (object dengan total/failed).
 *      Verifikasi shape { total: N, failed: [...] } — kontrak yang dikonsumsi
 *      handleToggleActive untuk trigger auto-retry.
 *  [D] Sync-batch endpoint: POST /api/exams/<id>/sync-batch → 200 dengan
 *      { success, total, failed }. Verifikasi endpoint exists & returns kontrak.
 *  [E] Copy-questions legacy: POST /api/exams/copy-questions
 *      { source_exam_id, target_exam_ids, also_publish } → 200. Verifikasi
 *      endpoint untuk fallback legacy (no batch_id, sessionStorage siblings).
 *  [F] Mode-aware label: PUT /api/exams/<id> rename ke judul duplikat → 409
 *      dengan { error: 'DUPLICATE_TITLE', ... }. Verifikasi guard rename
 *      (audit HIGH #2 — backport ke PUT).
 *  [G] Reset attempt: PUT /api/exam-submissions { submission_id,
 *      reset_attempt: 'soft' } → 200 dengan { reset_success, message,
 *      effective_ends_at }. Verifikasi endpoint untuk ResetAttemptMenu.
 *  [H] Grading halaman koreksi (shared admin+guru): PUT payload paritas client
 *      (iterasi QUESTIONS) → soal tanpa baris jawaban tetap dibuat & dinilai,
 *      feedback per soal tersimpan, total_score direkap server. Regresi 2 bug
 *      HIGH unifikasi (feedback hilang + nilai esai kosong silent-drop).
 *  [I] Reorder soal (drag & drop): POST /api/exams/<id>/questions { reorder }
 *      mengubah order_index. Kontrak yang dipakai fitur drag halaman shared.
 *
 * Cleanup penuh di akhir (semua baris ber-prefix e2b1).
 *
 * Jalankan REMOTE: E2E_BASE=https://schooledzo-production-e036.up.railway.app \
 *   ENV_FILE=.env.staging node scripts/e2e-ulangan-unification-staging.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2u1p4ss!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2' // Matematika STG

// PFX hex-only (kolom uuid)
const PFX = 'e2b10000-0000-4000-8000-'
const CLASS_A = `${PFX}c00000000001`
const CLASS_B = `${PFX}c00000000002`
const BATCH1 = `${PFX}b00000000001`
const TA1_ID = `${PFX}a0000000000a`
const TA2_ID = `${PFX}a0000000000b`
const EXAM_A = `${PFX}e00000000001`
const EXAM_B = `${PFX}e00000000002`
// Exam terpisah khusus Fase H (grading) — TIDAK dipakai fase lain. Fase C
// (publish sync-batch) & E (copy-questions) menimpa/menyalin soal exam A,
// sehingga soal Fase H harus hidup di exam sendiri agar deterministik.
// ID unik per run (jam epoch hex → 8 hex char): examQuestionsCache server
// punya TTL 10 mnt keyed by exam_id — ID tetap antar-run menyajikan soal run
// sebelumnya → PUT grading ditolak "Soal tidak ditemukan" walau DB sudah baru.
const RUN_TAG = Date.now().toString(16).slice(-3)          // 3 hex terakhir
const EXAM_C = `e2b1c${RUN_TAG}-0000-4000-8000-e0000000000c`
const HQ_PFX = `e2b1c${RUN_TAG}`                            // 8 char: e2b1c+3
const TEACHER1 = `${PFX}100000000001`
const TEACHER2 = `${PFX}100000000002`
const ADMIN_ID = `${PFX}100000000003`
const SISWA1 = `${PFX}100000000004`
const STUDENT1 = `${PFX}200000000001`

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}

async function login(username) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASS }),
    })
    if (!res.ok) throw new Error(`login ${username} gagal: ${res.status}`)
    return res.headers.get('set-cookie')?.split(';')[0]
}

async function api(path, cookie, method = 'GET', body) {
    const res = await fetch(BASE + path, {
        method,
        headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
    })
    let data = null
    try { data = await res.json() } catch { /* no body */ }
    return { status: res.status, data }
}

async function cleanupAll() {
    // Exam + soal Fase H (ID dinamis per run — tidak ber-prefix PFX utuh)
    await supabase.from('exam_submissions').delete().eq('exam_id', EXAM_C)
    await supabase.from('exam_questions').delete().eq('exam_id', EXAM_C)
    await supabase.from('exams').delete().eq('id', EXAM_C)
    // Sisa soal Fase H (UUID ber-prefix e2b1c, tidak terikat prefix exam)
    await supabase.from('exam_questions').delete().like('id', 'e2b1c%')
    // Hapus exam fixture
    const { data: exams } = await supabase.from('exams').select('id').like('id', `${PFX}e%`)
    for (const ex of (exams || [])) {
        await supabase.from('exam_submissions').delete().eq('exam_id', ex.id)
        await supabase.from('exam_questions').delete().eq('exam_id', ex.id)
        await supabase.from('exams').delete().eq('id', ex.id)
    }
    // Sisa submission orphan
    await supabase.from('exam_submissions').delete().eq('student_id', STUDENT1)
    // TA + teacher + users
    const { data: oldUsers } = await supabase.from('users').select('id').like('username', 'e2b1_%')
    for (const u of (oldUsers || [])) {
        const { data: t } = await supabase.from('teachers').select('id').eq('user_id', u.id).maybeSingle()
        if (t) {
            const { data: tas } = await supabase.from('teaching_assignments').select('id').eq('teacher_id', t.id)
            for (const a of (tas || [])) await supabase.from('teaching_assignments').delete().eq('id', a.id)
            await supabase.from('teachers').delete().eq('id', t.id)
        }
        const { data: s } = await supabase.from('students').select('id').eq('user_id', u.id).maybeSingle()
        if (s) {
            await supabase.from('student_enrollments').delete().eq('student_id', s.id)
            await supabase.from('students').delete().eq('id', s.id)
        }
        await supabase.from('notifications').delete().eq('user_id', u.id)
        await supabase.from('sessions').delete().eq('user_id', u.id)
        await supabase.from('users').delete().eq('id', u.id)
    }
    await supabase.from('classes').delete().eq('id', CLASS_A)
    await supabase.from('classes').delete().eq('id', CLASS_B)
}

async function main() {
    console.log('═══ SEED ══')
    await cleanupAll()
    const passHash = await bcrypt.hash(PASS, 10)

    // Seed classes
    const { error: clsErr } = await supabase.from('classes').insert([
        { id: CLASS_A, name: 'e2b1 Kelas A', academic_year_id: YEAR, grade_level: 8, school_level: 'SMP' },
        { id: CLASS_B, name: 'e2b1 Kelas B', academic_year_id: YEAR, grade_level: 9, school_level: 'SMP' },
    ])
    if (clsErr) throw new Error(`seed classes: ${clsErr.message}`)

    // Seed users: guru1 (pemilik), guru2 (sibling), admin, siswa1
    // (id auto-generated — paritas reference script e2a9)
    const ids = {}
    for (const [key, role] of [['guru1', 'GURU'], ['guru2', 'GURU'], ['admin', 'ADMIN'], ['siswa1', 'SISWA']]) {
        const { data: u, error } = await supabase.from('users')
            .insert({ username: `e2b1_${key}`, full_name: `E2B1 ${key}`, password_hash: passHash, role, school_id: SCHOOL, must_change_password: false, is_locked: false })
            .select('id').single()
        if (error) throw new Error(`seed user ${key}: ${error.message}`)
        ids[key] = u.id
    }

    // Seed teachers (id auto-generated)
    const { data: t1, error: t1Err } = await supabase.from('teachers').insert({ user_id: ids.guru1, school_id: SCHOOL }).select('id').single()
    const { data: t2, error: t2Err } = await supabase.from('teachers').insert({ user_id: ids.guru2, school_id: SCHOOL }).select('id').single()
    if (t1Err) throw new Error(`seed teacher1: ${t1Err.message}`)
    if (t2Err) throw new Error(`seed teacher2: ${t2Err.message}`)
    await supabase.from('teaching_assignments').insert([
        { id: TA1_ID, teacher_id: t1.id, subject_id: SUBJECT, class_id: CLASS_A, academic_year_id: YEAR },
        { id: TA2_ID, teacher_id: t2.id, subject_id: SUBJECT, class_id: CLASS_B, academic_year_id: YEAR },
    ])

    // Seed student
    await supabase.from('students').insert({
        id: STUDENT1, user_id: ids.siswa1, school_id: SCHOOL, class_id: CLASS_A, nis: 'e2b101',
        status: 'ACTIVE', school_level: 'SMP',
    })
    await supabase.from('student_enrollments').insert({
        student_id: STUDENT1, class_id: CLASS_A, academic_year_id: YEAR, status: 'ACTIVE', enrolled_at: '2026-09-01T00:00:00',
    })

    // Seed exams (batch, draft) — created_by = admin user id
    const T0 = '2026-09-15T02:00:00'
    await supabase.from('exams').insert([
        {
            id: EXAM_A, title: 'e2b1 Ulangan Batch A', teaching_assignment_id: TA1_ID,
            start_time: T0, duration_minutes: 60, is_active: false, batch_id: BATCH1,
            is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: ids.admin,
        },
        {
            id: EXAM_B, title: 'e2b1 Ulangan Batch B', teaching_assignment_id: TA2_ID,
            start_time: T0, duration_minutes: 60, is_active: false, batch_id: BATCH1,
            is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: ids.admin,
        },
    ])

    // Seed questions di exam A (primary) — exam B biarkan kosong (akan di-sync)
    await supabase.from('exam_questions').insert([
        { exam_id: EXAM_A, question_text: 'e2b1 Soal 1', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 50, order_index: 0 },
        { exam_id: EXAM_A, question_text: 'e2b1 Soal 2', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'B', points: 50, order_index: 1 },
    ])

    console.log('═══ FASE A — Wrapper route parity ══')
    {
        const cookieGuru = await login('e2b1_guru1')
        // GET halaman detail ulangan (wrapper → admin component)
        const { status: s1 } = await api(`/dashboard/guru/ulangan/${EXAM_A}`, cookieGuru)
        check('A1: GET /dashboard/guru/ulangan/<id> → 200', s1 === 200, `got ${s1}`)
        // GET tanpa ?type=ulangan (forced via prop)
        const { status: s2 } = await api(`/dashboard/guru/ulangan/${EXAM_A}`, cookieGuru)
        check('A2: GET tanpa ?type=ulangan tetap 200 (forced via prop)', s2 === 200, `got ${s2}`)
    }

    console.log('═══ FASE B — Deep-link #hasil ══')
    {
        const cookieGuru = await login('e2b1_guru1')
        // GET dengan #hasil (hash di-handle client-side, server tetap 200)
        const { status } = await api(`/dashboard/guru/ulangan/${EXAM_A}#hasil`, cookieGuru)
        check('B1: GET /dashboard/guru/ulangan/<id>#hasil → 200', status === 200, `got ${status}`)
        // GET legacy ?tab=hasil (sudah deprecated tapi tidak boleh 500)
        const { status: s2 } = await api(`/dashboard/guru/ulangan/${EXAM_A}?tab=hasil`, cookieGuru)
        check('B2: GET ?tab=hasil legacy tetap 200 (deprecated, tidak 500)', s2 === 200, `got ${s2}`)
    }

    console.log('═══ FASE C — PUT publish + batch_sync ══')
    {
        const cookieGuru = await login('e2b1_guru1')
        // PUT publish → response harus mengandung batch_sync
        const { status, data } = await api(`/api/exams/${EXAM_A}`, cookieGuru, 'PUT', { is_active: true })
        check('C1: PUT publish → 200', status === 200, `got ${status}`)
        check('C2: response mengandung field batch_sync', !!data?.batch_sync, data)
        check('C3: batch_sync.total > 0 (batch punya sibling)', (data?.batch_sync?.total ?? 0) > 0, data?.batch_sync)
        check('C4: batch_sync.failed adalah array', Array.isArray(data?.batch_sync?.failed), data?.batch_sync)
        // Setelah publish, soal harusnya tersalin ke exam B (sibling)
        const { data: qB } = await supabase.from('exam_questions').select('id').eq('exam_id', EXAM_B)
        check('C5: soal tersalin ke exam B (sibling)', (qB || []).length === 2, `${(qB || []).length} soal`)
        // Verify exam B juga aktif (batch propagate)
        const { data: examBRow } = await supabase.from('exams').select('is_active').eq('id', EXAM_B).single()
        check('C6: exam B (sibling) ikut aktif', examBRow?.is_active === true, examBRow)
    }

    console.log('═══ FASE D — Sync-batch endpoint ══')
    {
        const cookieGuru = await login('e2b1_guru1')
        // POST sync-batch — endpoint retry yang dipakai auto-retry
        const { status, data } = await api(`/api/exams/${EXAM_A}/sync-batch`, cookieGuru, 'POST')
        check('D1: POST /api/exams/<id>/sync-batch → 200', status === 200, `got ${status}`)
        check('D2: response mengandung success/total/failed', !!data && 'total' in data, data)
    }

    console.log('═══ FASE E — Copy-questions legacy ══')
    {
        const cookieAdmin = await login('e2b1_admin')
        // POST copy-questions — legacy fallback untuk ujian tanpa batch_id
        const { status, data } = await api('/api/exams/copy-questions', cookieAdmin, 'POST', {
            source_exam_id: EXAM_A,
            target_exam_ids: [EXAM_B],
            also_publish: false,
        })
        check('E1: POST /api/exams/copy-questions → 200', status === 200, `got ${status} ${JSON.stringify(data)}`)
        check('E2: soal di-copy ke target', (data?.failed_targets || []).length === 0, data)
    }

    console.log('═══ FASE F — Mode-aware label (dup409 guard rename) ══')
    {
        const cookieGuru = await login('e2b1_guru1')
        // Rename exam A ke judul yang sudah dipakai exam lain di TA se-mapel
        // (exam B punya judul beda — buat exam C dengan judul "DUP" dulu)
        const { data: examC } = await supabase.from('exams').insert({
            id: `${PFX}e00000000003`, title: 'e2b1 DUP', teaching_assignment_id: TA1_ID,
            start_time: T0, duration_minutes: 60, is_active: false,
            is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: ADMIN_ID,
        }).select('id').single()
        // Coba rename exam A ke "e2b1 DUP" → harus 409 (guard rename, audit HIGH #2)
        const { status, data } = await api(`/api/exams/${EXAM_A}`, cookieGuru, 'PUT', { title: 'e2b1 DUP' })
        check('F1: PUT rename ke judul duplikat → 409', status === 409, `got ${status}`)
        check('F2: error code DUPLICATE_TITLE', data?.error === 'DUPLICATE_TITLE', data)
        // force_duplicate bypass → 200 (paritas POST)
        const { status: s2 } = await api(`/api/exams/${EXAM_A}`, cookieGuru, 'PUT', { title: 'e2b1 DUP', force_duplicate: true })
        check('F3: PUT rename dengan force_duplicate → 200', s2 === 200, `got ${s2}`)
        // Cleanup exam C
        await supabase.from('exam_questions').delete().eq('exam_id', examC.id)
        await supabase.from('exams').delete().eq('id', examC.id)
    }

    console.log('═══ FASE G — Reset attempt (hard reset) ══')
    {
        const cookieGuru = await login('e2b1_guru1')
        // Buat submission untuk siswa1 di exam A
        const { data: sub } = await supabase.from('exam_submissions').insert({
            exam_id: EXAM_A, student_id: STUDENT1, is_submitted: true, is_graded: false,
            total_score: 0, max_score: 100, violation_count: 0, started_at: T0, submitted_at: T0,
        }).select('id').single()
        // PUT reset_attempt hard (soft butuh window masih aktif — start_time di masa lalu
        // membuat soft reset 400 "jendela waktu berakhir". Hard reset selalu valid.)
        const { status, data } = await api('/api/exam-submissions', cookieGuru, 'PUT', {
            submission_id: sub.id, reset_attempt: 'hard',
        })
        check('G1: PUT reset_attempt hard → 200', status === 200, `got ${status}`)
        check('G2: response reset_success true', data?.reset_success === true, data)
        check('G3: response mengandung message', !!data?.message, data)
        check('G4: response mengandung effective_ends_at', !!data?.effective_ends_at, data)
        // Cleanup submission
        await supabase.from('exam_answers').delete().eq('submission_id', sub.id)
        await supabase.from('exam_submissions').delete().eq('id', sub.id)
    }

    console.log('═══ FASE H — Grading halaman koreksi (feedback + soal tanpa jawaban) ══')
    {
        // Regresi 2 bug HIGH pada unifikasi halaman koreksi admin/guru:
        //  #1 feedback per soal hilang (state grades hanya {score}, payload tanpa feedback)
        //  #2 soal yang TIDAK dijawab siswa (esai/isian kosong) tak ada baris
        //     exam_answers → hilang dari payload saat client iterasi answers →
        //     nilai guru silent-drop & total_score salah.
        // Kontrak server yang WAJIB dipenuhi: upsert menerima feedback dan membuat
        // baris baru untuk soal yang belum punya jawaban, lalu merekap total.
        //
        // CATATAN: server punya cache in-memory daftar soal (examQuestionsCache,
        // TTL 10 mnt) — grading terhadap exam yang sama setelah soal dihapus/insert
        // ulang bisa ditolak "Soal tidak ditemukan" bila cache menyimpan ID lama.
        // Karena itu Fase H memakai EXAM_C yang soalnya dibuat SEKALI di sini
        // (tidak pernah diganti fase lain) dan UUID soal unik per run.
        const cookieGuru = await login('e2b1_guru1')
        await supabase.from('exams').insert({
            id: EXAM_C, title: 'e2b1 Ulangan Grading (Fase H)', teaching_assignment_id: TA1_ID,
            start_time: T0, duration_minutes: 60, is_active: true,
            is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: ids.admin,
        })
        const { data: qs, error: qErr } = await supabase.from('exam_questions').insert([
            { id: `${HQ_PFX}-0001-4000-8000-000000000001`, exam_id: EXAM_C, question_text: 'H soal 1 (dijawab)', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 50, order_index: 0 },
            { id: `${HQ_PFX}-0002-4000-8000-000000000002`, exam_id: EXAM_C, question_text: 'H soal 2 (kosong)', question_type: 'ESSAY', options: null, correct_answer: null, points: 50, order_index: 1 },
        ]).select('id, points, order_index')
        if (qErr) throw new Error(`seed soal Fase H: ${qErr.message}`)
        const q1 = (qs || []).find(q => q.order_index === 0)
        const q2 = (qs || []).find(q => q.order_index === 1)
        if (!q1 || !q2) throw new Error('seed soal Fase H tidak lengkap')

        const { data: sub, error: subErr } = await supabase.from('exam_submissions').insert({
            exam_id: EXAM_C, student_id: STUDENT1, is_submitted: true, is_graded: false,
            total_score: 0, max_score: 100, violation_count: 0, started_at: T0, submitted_at: T0,
        }).select('id').single()
        if (subErr) throw new Error(`seed submission Fase H: ${subErr.message}`)
        // q1 dijawab, q2 KOSONG (tidak ada baris exam_answers — mensimulasikan esai kosong)
        await supabase.from('exam_answers').insert({
            submission_id: sub.id, question_id: q1.id, answer: 'A', is_correct: true, points_earned: 50,
        })
        // Payload paritas client (iterasi QUESTIONS, bukan answers):
        const { status, data } = await api(`/api/exam-submissions/${sub.id}`, cookieGuru, 'PUT', {
            answers: [
                { question_id: q1.id, score: 45, feedback: 'Kurang teliti di langkah 2' },
                { question_id: q2.id, score: 40, feedback: '', answer: null, is_correct: null },
            ],
            total_score: 85,
            is_graded: true,
        })
        check('H1: PUT grading → 200', status === 200, `got ${status} ${JSON.stringify(data)}`)
        const { data: rows } = await supabase
            .from('exam_answers').select('question_id, points_earned, feedback').eq('submission_id', sub.id)
        const rowQ2 = (rows || []).find(r => r.question_id === q2.id)
        check('H2: soal TANPA jawaban tetap dibuatkan baris (bukan silent-drop)', !!rowQ2, rows)
        check('H3: nilai soal tanpa jawaban tersimpan (40)', rowQ2?.points_earned === 40, rowQ2)
        const rowQ1 = (rows || []).find(r => r.question_id === q1.id)
        check('H4: feedback tersimpan di DB', rowQ1?.feedback === 'Kurang teliti di langkah 2', rowQ1)
        const { data: subAfter } = await supabase
            .from('exam_submissions').select('total_score, is_graded').eq('id', sub.id).single()
        check('H5: total_score direkap server = 85', subAfter?.total_score === 85, subAfter)
        check('H6: is_graded true', subAfter?.is_graded === true, subAfter)
        // Cleanup
        await supabase.from('exam_answers').delete().eq('submission_id', sub.id)
        await supabase.from('exam_submissions').delete().eq('id', sub.id)
        await supabase.from('exam_questions').delete().eq('exam_id', EXAM_C)
        await supabase.from('exams').delete().eq('id', EXAM_C)
    }

    console.log('═══ FASE I — Reorder soal (drag & drop) ══')
    {
        // Kontrak client drag-reorder: POST /api/exams/:id/questions { reorder }
        // harus mengubah order_index. Exam draft TANPA batch & TANPA submission
        // (reorder diblok saat aktif / sudah ada yang mengerjakan).
        const cookieGuru = await login('e2b1_guru1')
        const EXAM_R = `${PFX}e0000000000d`
        await supabase.from('exams').insert({
            id: EXAM_R, title: 'e2b1 Reorder (Fase I)', teaching_assignment_id: TA1_ID,
            start_time: T0, duration_minutes: 60, is_active: false,
            is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: ids.admin,
        })
        const { data: rq, error: rqErr } = await supabase.from('exam_questions').insert([
            { exam_id: EXAM_R, question_text: 'I soal 1', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 50, order_index: 0 },
            { exam_id: EXAM_R, question_text: 'I soal 2', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'B', points: 50, order_index: 1 },
        ]).select('id, order_index')
        if (rqErr) throw new Error(`seed soal Fase I: ${rqErr.message}`)
        const sorted = [...rq].sort((a, b) => a.order_index - b.order_index)
        // Tukar urutan: q2 → 0, q1 → 1
        const { status: s1 } = await api(`/api/exams/${EXAM_R}/questions`, cookieGuru, 'POST', {
            reorder: [{ id: sorted[1].id, order_index: 0 }, { id: sorted[0].id, order_index: 1 }],
        })
        check('I1: POST reorder → 200', s1 === 200, `got ${s1}`)
        const { data: after } = await supabase.from('exam_questions')
            .select('id, order_index, question_text').eq('exam_id', EXAM_R).order('order_index')
        check('I2: urutan tersimpan (soal 2 jadi pertama)', (after || [])[0]?.question_text === 'I soal 2', after)
        check('I3: order_index kontigu 0,1', JSON.stringify((after || []).map(r => r.order_index)) === '[0,1]', after)
        await supabase.from('exam_questions').delete().eq('exam_id', EXAM_R)
        await supabase.from('exams').delete().eq('id', EXAM_R)
    }

    console.log('═══ SUMMARY ══')
    console.log(`PASS: ${pass} / FAIL: ${fail}`)
    if (fail > 0) process.exitCode = 1
}

;(async () => {
    try {
        await main()
    } catch (err) {
        console.error('FATAL:', err)
        process.exitCode = 2
    } finally {
        await cleanupAll()
        console.log('cleanup done')
    }
})()
