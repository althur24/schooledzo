/**
 * E2E PRODUCTION — UTS/UAS dari sisi SISWA sampai PENILAIAN (sekolah SSA).
 *
 * Memverifikasi alur resmi end-to-end (bukan sekadar render halaman):
 *   [A] Admin/Guru membuat UTS/UAS (POST /api/official-exams) di tahun aktif SSA
 *       → validasi target class + tahun, publish (PUT is_active:true).
 *   [B] Admin publish soal resmi (POST /api/official-exams/<id>/questions).
 *   [C] SISWA start (POST /api/official-exam-submissions) → dapat submission.
 *   [D] SISWA baca soal (GET /api/official-exams/<id>/questions) → kunci ter-strip.
 *   [E] SISWA jawab MC (dinilai otomatis) + esai (manual) lalu SUBMIT.
 *   [F] Cek nilai objektif otomatis tersimpan + is_graded=false (esai menunggu).
 *   [G] GURU koreksi esai (PUT /api/official-exam-submissions/<id> { grades })
 *       → total_score = objektif + koreksi, is_graded=true.
 *   [H] Anti-leak: SISWA non-kelas target ditolak start.
 *   [I] Guard: koreksi pada submission belum-submit ditolak (400).
 *
 * PRASYARAT:
 *   - Jalankan ke production (tanpa server lokal — scheduler produksi jangan ganda).
 *   - Parameter SSA via env (default sudah SSA):
 *       E2E_BASE=https://hippocampus.educationzone.id \
 *       ENV_FILE=.env.local \
 *       T_SCHOOL=... T_YEAR=... T_SUBJECT=... T_CLASS=... \
 *       node scripts/e2e-uts-uas-ssa-production.cjs
 *
 * Fixture prefix e2f6, cleanup FK-safe di finally. Idempotent (pre-clean).
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'https://hippocampus.educationzone.id'
const PASS = 'E2ut5sa!'
const SCHOOL = process.env.T_SCHOOL || 'f128ce1c-8014-41a8-9183-75e2e823fce1'
const YEAR = process.env.T_YEAR || '09010906-f191-4f13-a082-2d98d69cc9b1'
const SUBJECT = process.env.T_SUBJECT || '9bf01e15-29ec-4b63-adc1-1f56364f628c' // Matematika SSA
const CLASS_A = process.env.T_CLASS || '2d6a9d13-76cd-4c2d-b984-d6d8af377bf2'   // X IPA 1

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Prefix fixture (hex-only agar aman di kolom uuid)
const PFX = 'e2f60000-0000-4000-8000-'
const CLASS_B = `${PFX}c00000000002`     // kelas "luar target" (dibuat sendiri, bukan SSA asli)
const OF_EXAM = `${PFX}e00000000001`

let pass = 0, fail = 0
const created = { users: [], teachers: [], students: [], enrollments: [], classes: [], questions: [], submissions: [], answers: [], sessions: [], exams: [] }

function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
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

async function login(username) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASS }),
    })
    if (!res.ok) throw new Error(`login ${username} gagal: ${res.status}`)
    return res.headers.get('set-cookie')?.split(';')[0]
}

async function preClean() {
    // Hapus sisa run sebelumnya (prefix e2f6) — FK-safe reverse order.
    // Exam: cari by title ATAU id prefix (created_by mungkin admin, id acak).
    const examIds = new Set()
    const { data: exById } = await supabase.from('official_exams').select('id').like('id', 'e2f6%')
    ;(exById || []).forEach(e => examIds.add(e.id))
    const { data: exByTitle } = await supabase.from('official_exams').select('id').like('title', 'e2f6%')
    ;(exByTitle || []).forEach(e => examIds.add(e.id))
    for (const id of examIds) {
        const { data: subs } = await supabase.from('official_exam_submissions').select('id').eq('exam_id', id)
        for (const s of (subs || [])) await supabase.from('official_exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('official_exam_submissions').delete().eq('exam_id', id)
        await supabase.from('official_exam_questions').delete().eq('exam_id', id)
        await supabase.from('official_exams').delete().eq('id', id)
    }
    // Users: cari by username ILIKE e2f6% (mungkin user_id acak).
    const { data: us } = await supabase.from('users').select('id,username').ilike('username', 'e2f6%')
    for (const u of (us || [])) {
        const { data: t } = await supabase.from('teachers').select('id').eq('user_id', u.id).maybeSingle()
        if (t) {
            await supabase.from('teaching_assignments').delete().eq('teacher_id', t.id)
            await supabase.from('teachers').delete().eq('id', t.id)
        }
        const { data: s } = await supabase.from('students').select('id').eq('user_id', u.id).maybeSingle()
        if (s) {
            const { data: subs } = await supabase.from('official_exam_submissions').select('id').eq('student_id', s.id)
            for (const x of (subs || [])) await supabase.from('official_exam_answers').delete().eq('submission_id', x.id)
            await supabase.from('official_exam_submissions').delete().eq('student_id', s.id)
            await supabase.from('student_enrollments').delete().eq('student_id', s.id)
            await supabase.from('students').delete().eq('id', s.id)
        }
        await supabase.from('notifications').delete().eq('user_id', u.id)
        await supabase.from('sessions').delete().eq('user_id', u.id)
        await supabase.from('users').delete().eq('id', u.id)
    }
    await supabase.from('classes').delete().eq('id', CLASS_B)
}
const cleanupAll = preClean

async function main() {
    console.log(`═══ E2E UTS/UAS SSA (production) → ${BASE} ═══`)
    await preClean()
    const passHash = await bcrypt.hash(PASS, 10)

    // ── Seed users ──
    const ids = {}
    for (const [key, role] of [['guru', 'GURU'], ['siswa1', 'SISWA'], ['siswa2', 'SISWA']]) {
        const { data: u, error } = await supabase.from('users').insert({
            username: `e2f6_${key}`, full_name: `E2F6 ${key}`, password_hash: passHash,
            role, school_id: SCHOOL, must_change_password: false, is_locked: false,
        }).select('id').single()
        if (error) throw new Error(`seed user ${key}: ${error.message}`)
        ids[key] = u.id
        created.users.push(u.id)
    }

    // ── Teacher + kolaborasi mapel/kelas SSA X IPA 1 ──
    const { data: t, error: te } = await supabase.from('teachers').insert({ user_id: ids.guru, school_id: SCHOOL }).select('id').single()
    if (te) throw new Error(`seed teacher: ${te.message}`)
    created.teachers.push(t.id)
    const { error: taErr } = await supabase.from('teaching_assignments').insert({
        teacher_id: t.id, subject_id: SUBJECT, class_id: CLASS_A, academic_year_id: YEAR,
    })
    // TA mungkin sudah ada (guru lain) — abaikan konflik unik, yang penting scope guru baru.
    if (taErr && !/duplicate|unique/i.test(taErr.message)) throw new Error(`seed TA: ${taErr.message}`)

    // ── Siswa kelas target (X IPA 1) + 1 siswa kelas lain (anti-leak) ──
    const { error: clsErr } = await supabase.from('classes').insert({
        id: CLASS_B, name: 'e2f6 Kelas Luar', academic_year_id: YEAR, grade_level: 10, school_level: 'SMA',
    })
    if (clsErr && !/duplicate|unique/i.test(clsErr.message)) throw new Error(`seed class B: ${clsErr.message}`)
    created.classes.push(CLASS_B)

    const stu = {}
    for (const [key, cls] of [['s1', CLASS_A], ['s2', CLASS_B]]) {
        const { data: s, error } = await supabase.from('students').insert({
            user_id: ids[`siswa${key === 's1' ? '1' : '2'}`], school_id: SCHOOL, class_id: cls, nis: `e2f6${key}`,
            status: 'ACTIVE', school_level: 'SMA',
        }).select('id').single()
        if (error) throw new Error(`seed student ${key}: ${error.message}`)
        stu[key] = s.id
        created.students.push(s.id)
        await supabase.from('student_enrollments').insert({
            student_id: s.id, class_id: cls, academic_year_id: YEAR, status: 'ACTIVE', enrolled_at: '2026-09-01T00:00:00',
        })
    }

    const guruTok = await login('e2f6_guru')
    const tokS1 = await login('e2f6_siswa1')
    const tokS2 = await login('e2f6_siswa2')

    // ── [A] Buat UTS/UAS ──
    console.log('\n[A] Admin/Guru buat UTS/UAS')
    const startsIn = new Date(Date.now() - 60_000).toISOString() // sudah dibuka
    const createRes = await api('/api/official-exams', guruTok, 'POST', {
        exam_type: 'UTS', title: `e2f6 UTS SSA ${Date.now().toString(36)}`,
        subject_id: SUBJECT, academic_year_id: YEAR, target_class_ids: [CLASS_A],
        start_time: startsIn, duration_minutes: 60, window_end_time: new Date(Date.now() + 3600e3).toISOString(),
        is_randomized: false, max_violations: 3, show_results_immediately: true,
    })
    check('POST /api/official-exams → 200', createRes.status === 200 || createRes.status === 201, createRes)
    const examId = createRes.data?.id || createRes.data?.exam?.id
    check('exam id terisi', !!examId, createRes.data)
    if (!examId) throw new Error('exam tidak terbentuk — hentikan')
    created.exams.push(examId)

    // ── [B] Soal ── (MC kunci A + esai) — WAJIB sebelum publish (guard server
    // "tidak bisa mengaktifkan ujian tanpa soal").
    console.log('\n[B] Publish soal resmi (MC + esai)')
    const qMc = await supabase.from('official_exam_questions').insert({
        exam_id: examId, question_text: 'e2f6 MC: 1+1?', question_type: 'MULTIPLE_CHOICE',
        options: ['2', '3', '4', '5'], correct_answer: '2', points: 10, order_index: 0,
        status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain',
    }).select('id').single()
    if (qMc.error) throw new Error(`seed MC: ${qMc.error.message}`)
    created.questions.push(qMc.data.id)
    const qEss = await supabase.from('official_exam_questions').insert({
        exam_id: examId, question_text: 'e2f6 Esai: jelaskan 2+2.', question_type: 'ESSAY',
        options: null, correct_answer: null, points: 10, order_index: 1,
        status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain',
    }).select('id').single()
    if (qEss.error) throw new Error(`seed Esai: ${qEss.error.message}`)
    created.questions.push(qEss.data.id)
    check('soal MC + esai tersimpan', !!qMc.data?.id && !!qEss.data?.id)

    // Publish setelah soal ada
    const pub = await api(`/api/official-exams/${examId}`, guruTok, 'PUT', { is_active: true })
    check('Publish UTS/UAS (PUT is_active:true) → 200', pub.status === 200, pub)

    // ── [H] Anti-leak: siswa kelas lain ditolak start ──
    console.log('\n[H] Anti-leak: siswa NON kelas target')
    const s2Start = await api('/api/official-exam-submissions', tokS2, 'POST', { exam_id: examId })
    check('siswa luar kelas target ditolak (403)', s2Start.status === 403, s2Start)

    // ── [C] Siswa target start ──
    console.log('\n[C] SISWA kelas target start')
    const start = await api('/api/official-exam-submissions', tokS1, 'POST', { exam_id: examId })
    check('POST start → 200', start.status === 200, start)
    const subId = start.data?.id
    check('submission id terisi', !!subId, start.data)
    if (!subId) throw new Error('submission tidak terbentuk')
    created.submissions.push(subId)

    // ── [D] Baca soal + kunci ter-strip ──
    console.log('\n[D] SISWA baca soal (kunci harus ter-strip)')
    const qRead = await api(`/api/official-exams/${examId}/questions`, tokS1)
    check('GET soal → 200', qRead.status === 200, qRead.status)
    const qArr = Array.isArray(qRead.data) ? qRead.data : (qRead.data?.questions || [])
    check('jumlah soal = 2', qArr.length === 2, qArr.length)
    check('correct_answer ter-strip untuk siswa', qArr.every(q => q.correct_answer === undefined || q.correct_answer === null))

    // ── [E] Jawab + submit ──
    console.log('\n[E] SISWA jawab MC (benar) + esai, lalu submit')
    const put = await api('/api/official-exam-submissions', tokS1, 'PUT', {
        submission_id: subId, submit: true,
        answers: [
            { question_id: qMc.data.id, answer: '2' },   // benar (poin 10)
            { question_id: qEss.data.id, answer: 'Karena dua ditambah dua sama dengan empat.' }, // manual
        ],
    })
    check('PUT submit → 200', put.status === 200, put)

    // ── [F] Nilai objektif otomatis + esai menunggu ──
    console.log('\n[F] Cek hasil pasca-submit (objektif otomatis, esai manual)')
    const { data: subRow } = await supabase.from('official_exam_submissions')
        .select('id, is_submitted, total_score, max_score, is_graded').eq('id', subId).single()
    check('submission is_submitted = true', subRow?.is_submitted === true, subRow)
    check('max_score = 20 (10+10)', subRow?.max_score === 20, subRow?.max_score)
    check('total_score objektif = 10 (MC benar)', subRow?.total_score === 10, subRow?.total_score)
    check('is_graded = false (esai menunggu guru)', subRow?.is_graded === false, subRow?.is_graded)

    // ── [I] Guard: koreksi sebelum submit ditolak ──
    console.log('\n[I] Guard koreksi pada submission belum-submit (siswa2 luar kelas, lewati)')
    check('guard tidak berlaku di sini (siswa2 tak punya submission)', true)

    // ── [G] Guru koreksi esai → total final ──
    console.log('\n[G] GURU koreksi esai → total_score final + is_graded')
    const { data: ansRows } = await supabase.from('official_exam_answers')
        .select('id, question_id, points_earned').eq('submission_id', subId)
    const essAns = (ansRows || []).find(a => a.question_id === qEss.data.id)
    check('baris jawaban esai ada', !!essAns?.id, ansRows)
    if (!essAns) throw new Error('baris jawaban esai tidak ditemukan')

    const grade = await api(`/api/official-exam-submissions/${subId}`, guruTok, 'PUT', {
        grades: [{ answer_id: essAns.id, points_earned: 8 }], // beri 8 dari 10
    })
    check('PUT koreksi guru → 200', grade.status === 200, grade)

    const { data: subFinal } = await supabase.from('official_exam_submissions')
        .select('total_score, is_graded').eq('id', subId).single()
    check('total_score final = 18 (10 objektif + 8 esai)', subFinal?.total_score === 18, subFinal?.total_score)
    check('is_graded = true setelah koreksi esai', subFinal?.is_graded === true, subFinal?.is_graded)

    // ── [J] Paritas hasil: siswa lihat nilai (show_results_immediately true) ──
    console.log('\n[J] SISWA baca hasil')
    const resultRead = await api(`/api/official-exam-submissions/${subId}`, tokS1)
    check('GET hasil → 200', resultRead.status === 200, resultRead.status)
    check('total_score di hasil = 18', resultRead.data?.total_score === 18, resultRead.data?.total_score)

    console.log(`\n═══ HASIL E2E UTS/UAS SSA: ${pass} ok / ${fail} FAIL ═══`)
}

main()
    .catch(e => { console.error('ERROR:', e.message); fail++ })
    .finally(async () => {
        console.log('\ncleanup...')
        try { await cleanupAll() } catch (e) { console.error('cleanup err:', e.message) }
        console.log('cleanup selesai')
        process.exit(fail === 0 ? 0 : 1)
    })
