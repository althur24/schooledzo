/**
 * E2E staging: PARITAS ADMIN vs GURU untuk ulangan batch multi-kelas —
 * kontrak server yang dipakai 3 fitur baru di sisi admin (commit b11fe89):
 *
 *   [A] Tab Hasil admin batch-aware:
 *       - ADMIN ?batch_id= → submission SEMUA member (embed kelas per baris =
 *         sumber kolom "Kelas"); ?exam_id= per member = filter kelas.
 *       - GURU pemilik 1 member → batch ter-scope ke membernya saja (co-teacher
 *         parsial — perilaku server yang sudah benar, UI guru memakai ini).
 *       - Roster /api/students?as_of=start_time memuat siswa BELUM mengerjakan
 *         (sumber panel "N Siswa Belum Mengerjakan").
 *       - LEAK: SISWA ?batch_id= hanya barisnya sendiri; detail exam TIDAK
 *         membawa batch_siblings / allowed_student_ids.
 *   [B] Duplikasi multi-kelas (path server persis yang dikirim UI admin):
 *       - 2 POST /api/exams per TA + batch_id sama → batch terbentuk, soal
 *         tersalin lengkap (gk_grading_mode + poin), draft.
 *       - GURU asing TIDAK bisa menyusup ke batch orang (guard M9 — 403
 *         deterministik via guru dengan mapel berbeda).
 *   [C] Remedial multi-kelas:
 *       - Guard TA: remedial_for_id milik TA lain → 400 (basis per-member Fix C).
 *       - Per member: remedial_for_id = exam member + TA member → 200, soal
 *         tersalin, allowed_student_ids tersimpan.
 *       - LEAK: allowed_student_ids TERSTRIP untuk SISWA (daftar remedial bukan
 *         miliknya); ADMIN tetap melihat.
 *       - Policy CAP: remedial_max_score tersimpan.
 *
 * Fixture namespace e2a9 (hex-only UUID), sekolah STAGING SCHOOL — cleanup
 * FK-safe di finally.
 *
 * Jalankan REMOTE: E2E_BASE=https://schooledzo-production-e036.up.railway.app \
 *   ENV_FILE=.env.staging node scripts/e2e-admin-ulangan-parity-staging.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2pg1234!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2' // Matematika STG

// PFX hex-only (kolom uuid)
const PFX = 'e2a90000-0000-4000-8000-'
const CLASS_A = `${PFX}c00000000001`
const CLASS_B = `${PFX}c00000000002`
const SUBJECT2 = `${PFX}a00000000001`
const BATCH1 = `${PFX}b00000000001`
const BATCH2 = `${PFX}b00000000002`
const BATCH3 = `${PFX}b00000000003`
const ST = {
    A1: { user: `${PFX}100000000001`, student: `${PFX}200000000001`, nis: 'e2a901' },
    A2: { user: `${PFX}100000000002`, student: `${PFX}200000000002`, nis: 'e2a902' },
    B1: { user: `${PFX}100000000003`, student: `${PFX}200000000003`, nis: 'e2a903' },
    B2: { user: `${PFX}100000000004`, student: `${PFX}200000000004`, nis: 'e2a904' },
}
// start_time exam: masa lalu deterministik (kolom timestamp naive → tanpa offset)
const T0 = '2026-09-15T02:00:00'

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

const examIdsByBatch = async (batchId) =>
    (await supabase.from('exams').select('id').eq('batch_id', batchId)).data?.map(e => e.id) || []

async function cleanupAll() {
    // Hapus exam fixture (semua batch e2a9) — FK-safe: questions & submissions dulu
    const { data: exams } = await supabase.from('exams').select('id').or('batch_id.like.e2a90000-0000-4000-8000-b000000000%,id.like.e2a90000-0000-4000-8000-e%')
    for (const ex of (exams || [])) {
        await supabase.from('exam_submissions').delete().eq('exam_id', ex.id)
        await supabase.from('exam_questions').delete().eq('exam_id', ex.id)
        await supabase.from('exams').delete().eq('id', ex.id)
    }
    // Sisa submission orphan (jika exam gagal dibuat di run sebelumnya)
    await supabase.from('exam_submissions').delete().in('student_id', Object.values(ST).map(s => s.student))
    // RA + TA + teacher + users
    const { data: oldUsers } = await supabase.from('users').select('id').like('username', 'e2a9%')
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
    await supabase.from('subjects').delete().eq('id', SUBJECT2)
    await supabase.from('classes').delete().in('id', [CLASS_A, CLASS_B])
}

async function main() {
    console.log('═══ SEED ══')
    await cleanupAll()
    const passHash = await bcrypt.hash(PASS, 10)

    const { error: clsErr } = await supabase.from('classes').insert([
        { id: CLASS_A, name: 'e2a9 Kelas A', academic_year_id: YEAR, grade_level: 8, school_level: 'SMP' },
        { id: CLASS_B, name: 'e2a9 Kelas B', academic_year_id: YEAR, grade_level: 9, school_level: 'SMP' },
    ])
    if (clsErr) throw new Error(`seed classes: ${clsErr.message}`)
    const { error: subErr } = await supabase.from('subjects').insert({ id: SUBJECT2, name: 'e2a9 Mapel B', school_id: SCHOOL, kkm: 75 })
    if (subErr) throw new Error(`seed subject2: ${subErr.message}`)

    const ids = {}
    for (const role of ['admin', 'guru1', 'guru2', 'guru3']) {
        const { data: u } = await supabase.from('users')
            .insert({ username: `e2a9_${role}`, full_name: `E2AP ${role}`, password_hash: passHash, role: role === 'admin' ? 'ADMIN' : 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false })
            .select('id').single()
        ids[role] = u.id
    }
    const teachers = {}
    for (const g of ['guru1', 'guru2', 'guru3']) {
        const { data: t } = await supabase.from('teachers').insert({ user_id: ids[g], school_id: SCHOOL }).select('id').single()
        teachers[g] = t.id
    }
    const { data: ta1 } = await supabase.from('teaching_assignments')
        .insert({ teacher_id: teachers.guru1, subject_id: SUBJECT, class_id: CLASS_A, academic_year_id: YEAR }).select('id').single()
    const { data: ta2 } = await supabase.from('teaching_assignments')
        .insert({ teacher_id: teachers.guru2, subject_id: SUBJECT, class_id: CLASS_B, academic_year_id: YEAR }).select('id').single()
    const { data: ta3 } = await supabase.from('teaching_assignments')
        .insert({ teacher_id: teachers.guru3, subject_id: SUBJECT2, class_id: CLASS_B, academic_year_id: YEAR }).select('id').single()

    for (const key of Object.keys(ST)) {
        const cls = key.startsWith('A') ? CLASS_A : CLASS_B
        await supabase.from('users').insert({
            id: ST[key].user, username: `e2a9_siswa_${key.toLowerCase()}`, full_name: `E2AP Siswa ${key}`,
            password_hash: passHash, role: 'SISWA', school_id: SCHOOL, must_change_password: false, is_locked: false,
        })
        await supabase.from('students').insert({
            id: ST[key].student, user_id: ST[key].user, school_id: SCHOOL,
            class_id: cls, nis: ST[key].nis, status: 'ACTIVE', school_level: 'SMP',
        })
        await supabase.from('student_enrollments').insert({
            student_id: ST[key].student, class_id: cls, academic_year_id: YEAR, status: 'ACTIVE', enrolled_at: '2026-09-01T00:00:00',
        })
    }

    // Exam batch: A (TA1/CLASS_A) + B (TA2/CLASS_B) — draft, start masa lalu
    const { data: examA } = await supabase.from('exams').insert({
        id: `${PFX}e00000000001`, title: 'e2a9 Ulangan A', teaching_assignment_id: ta1.id,
        start_time: T0, duration_minutes: 60, is_active: false, batch_id: BATCH1,
        is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: ids.admin,
    }).select('id').single()
    const { data: examB } = await supabase.from('exams').insert({
        id: `${PFX}e00000000002`, title: 'e2a9 Ulangan B', teaching_assignment_id: ta2.id,
        start_time: T0, duration_minutes: 60, is_active: false, batch_id: BATCH1,
        is_randomized: false, max_violations: 3, show_results_immediately: true, created_by: ids.admin,
    }).select('id').single()
    await supabase.from('exam_questions').insert([
        { exam_id: examA.id, question_text: 'PG biasa', question_type: 'MULTIPLE_CHOICE', options: ['1', '2', '3', '4'], correct_answer: 'A', points: 10, order_index: 0 },
        { exam_id: examA.id, question_text: 'GK kompleks', question_type: 'MULTIPLE_ANSWER', options: ['1', '2', '3', '4'], correct_answer: '["A","C"]', points: 10, order_index: 1, gk_grading_mode: 'ALL_OR_NOTHING' },
    ])

    // Submission nyata: A1 (examA) & B1 (examB) — A2/B2 tidak mengerjakan
    await supabase.from('exam_submissions').insert([
        { id: `${PFX}300000000001`, exam_id: examA.id, student_id: ST.A1.student, started_at: T0, submitted_at: '2026-09-15T02:30:00', is_submitted: true, is_graded: true, total_score: 16, max_score: 20, violation_count: 0 },
        { id: `${PFX}300000000002`, exam_id: examB.id, student_id: ST.B1.student, started_at: T0, submitted_at: '2026-09-15T02:40:00', is_submitted: true, is_graded: true, total_score: 15, max_score: 20, violation_count: 0 },
    ])
    console.log('seed ok — batch 2 kelas (A draft, 2 soal incl GK) + 2 submission + 2 siswa kosong')

    const admin = await login('e2a9_admin')
    const guru1 = await login('e2a9_guru1')
    const guru3 = await login('e2a9_guru3')
    const siswaA1 = await login('e2a9_siswa_a1')
    const siswaB1 = await login('e2a9_siswa_b1')

    try {
        // ═══ [A] TAB HASIL BATCH (kontrak server UI admin) ═══
        console.log('\n═══ [A] Hasil batch multi-kelas ══')
        {
            const r = await api(`/api/exam-submissions?batch_id=${BATCH1}`, admin)
            check('A1: ADMIN ?batch_id → 2 submission (semua member)', r.status === 200 && r.data.length === 2, r.data.map(s => s.exam_id))
            const classNames = r.data.map(s => {
                const ex = Array.isArray(s.exam) ? s.exam[0] : s.exam
                const ta = ex?.teaching_assignment
                const cls = Array.isArray(ta) ? ta[0]?.class : ta?.class
                const clsObj = Array.isArray(cls) ? cls[0] : cls
                return clsObj?.name
            }).sort()
            check('A2: embed kelas per baris utk kolom Kelas (2 nama beda)', JSON.stringify(classNames) === JSON.stringify(['e2a9 Kelas A', 'e2a9 Kelas B']), classNames)

            const rA = await api(`/api/exam-submissions?exam_id=${examA.id}`, admin)
            check('A3: ADMIN ?exam_id=A → tepat 1 submission (filter kelas UI)', rA.status === 200 && rA.data.length === 1 && rA.data[0].student?.nis === ST.A1.nis, rA.data.map(s => s.student?.nis))

            const rG = await api(`/api/exam-submissions?batch_id=${BATCH1}`, guru1)
            check('A4: GURU pemilik 1 member → batch ter-scope ke membernya (co-teacher parsial)', rG.status === 200 && rG.data.length === 1 && rG.data[0].exam_id === examA.id, rG.data.map(s => s.exam_id))

            const roster = await api(`/api/students?class_id=${CLASS_A}&enrollment_year_id=${YEAR}&as_of=${encodeURIComponent(T0 + 'Z')}`, admin)
            check('A5: roster as_of=start memuat siswa belum mengerjakan (panel merah)',
                roster.status === 200 && JSON.stringify((roster.data || []).map(s => s.nis).sort()) === JSON.stringify([ST.A1.nis, ST.A2.nis]), roster.data?.map(s => s.nis))

            const rS = await api(`/api/exam-submissions?batch_id=${BATCH1}`, siswaA1)
            check('A6 LEAK: SISWA ?batch_id → hanya barisnya sendiri', rS.status === 200 && rS.data.length === 1 && rS.data[0].student?.nis === ST.A1.nis, rS.data.map(s => s.student?.nis))

            const rS2 = await api(`/api/exam-submissions?exam_id=${examB.id}`, siswaA1)
            check('A7 LEAK: SISWA tak melihat submission exam kelas lain', rS2.status === 200 && rS2.data.length === 0, rS2.data)

            const dS = await api(`/api/exams/${examA.id}`, siswaA1)
            check('A8 LEAK: detail exam utk SISWA tanpa field batch_siblings sama sekali',
                dS.status !== 200 || !('batch_siblings' in (dS.data || {})), { status: dS.status, sib: dS.data?.batch_siblings })

            const dA = await api(`/api/exams/${examA.id}`, admin)
            check('A9: ADMIN detail exam → batch_siblings = {examB} (dropdown filter UI)',
                dA.status === 200 && (dA.data?.batch_siblings || []).length === 1 && dA.data.batch_siblings[0].id === examB.id, dA.data?.batch_siblings)
        }

        // ═══ [B] DUPLIKASI MULTI-KELAS (path server yang dikirim UI admin) ═══
        console.log('\n═══ [B] Duplikasi multi-kelas ══')
        let copyA, copyB
        {
            const payload = (taId) => ({
                teaching_assignment_id: taId, title: 'e2a9 Copy',
                start_time: '2026-10-05T01:00:00Z', duration_minutes: 45,
                is_randomized: false, max_violations: 3, show_results_immediately: true,
                duplicate_from_exam_id: examA.id, duplicate_questions: true, batch_id: BATCH2,
            })
            const r1 = await api('/api/exams', admin, 'POST', payload(ta1.id))
            const r2 = await api('/api/exams', admin, 'POST', payload(ta2.id))
            check('B1: 2 POST per TA + batch_id sama → 200 draft', r1.status === 200 && r2.status === 200 && r1.data?.is_active === false && r2.data?.is_active === false, [r1.status, r2.status, r1.data?.error, r2.data?.error])
            copyA = r1.data?.id; copyB = r2.data?.id

            const q = await api(`/api/exams/${copyA}/questions`, admin)
            const gk = (q.data || []).find(x => x.question_type === 'MULTIPLE_ANSWER')
            check('B2: soal tersalin lengkap (2 soal, gk_grading_mode + poin utuh)',
                q.status === 200 && (q.data || []).length === 2 && gk?.gk_grading_mode === 'ALL_OR_NOTHING' && gk?.points === 10, q.data?.map(x => [x.question_type, x.gk_grading_mode, x.points]))

            const d = await api(`/api/exams/${copyA}`, admin)
            check('B3: batch duplikasi terbentuk (siblings = copyB)', d.status === 200 && (d.data?.batch_siblings || []).some(s => s.id === copyB), d.data?.batch_siblings)

            // Guard M9: guru3 (mapel BEDA, kelas B) mencoba menyusup ke BATCH2 → 403
            const rInj = await api('/api/exams', guru3, 'POST', {
                teaching_assignment_id: ta3.id, title: 'e2a9 Inject',
                start_time: '2026-10-05T01:00:00Z', duration_minutes: 45,
                duplicate_from_exam_id: examA.id, duplicate_questions: true, batch_id: BATCH2,
            })
            check('B4 LEAK/GUARD: guru mapel beda tak bisa menyusup ke batch orang (403 M9)', rInj.status === 403, rInj.status)

            const rOwn = await api('/api/exams', guru1, 'POST', {
                teaching_assignment_id: ta1.id, title: 'e2a9 Own Batch',
                start_time: '2026-10-05T01:00:00Z', duration_minutes: 45,
                duplicate_from_exam_id: examA.id, duplicate_questions: true, batch_id: BATCH3,
            })
            check('B5: guru pemilik TA boleh mulai batch sendiri (single member)', rOwn.status === 200, rOwn.status)
        }

        // ═══ [C] REMEDIAL MULTI-KELAS (per member — basis Fix C) ═══
        console.log('\n═══ [C] Remedial multi-kelas ══')
        let remA
        {
            const rWrongTa = await api('/api/exams', admin, 'POST', {
                teaching_assignment_id: ta2.id, title: 'e2a9 Rem Salah TA',
                start_time: '2026-10-06T01:00:00Z', duration_minutes: 45,
                is_remedial: true, remedial_for_id: examA.id, allowed_student_ids: [ST.A1.student],
                duplicate_questions: true,
            })
            check('C1 GUARD: remedial_for_id examA + TA kelas lain → 400 (constraint per-member Fix C)', rWrongTa.status === 400, rWrongTa.status)

            const rOk = await api('/api/exams', admin, 'POST', {
                teaching_assignment_id: ta1.id, title: 'e2a9 Remedial A',
                start_time: '2026-10-06T01:00:00Z', duration_minutes: 45,
                is_remedial: true, remedial_for_id: examA.id, allowed_student_ids: [ST.A1.student],
                remedial_score_policy: 'HIGHEST', duplicate_questions: true,
            })
            check('C2: remedial per member (remedial_for_id=examA, TA1) → 200', rOk.status === 200 && rOk.data?.is_remedial === true, [rOk.status, rOk.data?.error])
            remA = rOk.data?.id

            const q = await api(`/api/exams/${remA}/questions`, admin)
            const gk = (q.data || []).find(x => x.question_type === 'MULTIPLE_ANSWER')
            check('C3: soal remedial tersalin + gk mode terbawa', q.status === 200 && (q.data || []).length === 2 && gk?.gk_grading_mode === 'ALL_OR_NOTHING', q.data?.length)

            const dAdm = await api(`/api/exams/${remA}`, admin)
            check('C4: ADMIN melihat allowed_student_ids', dAdm.status === 200 && JSON.stringify(dAdm.data?.allowed_student_ids) === JSON.stringify([ST.A1.student]), dAdm.data?.allowed_student_ids)
            const dSis = await api(`/api/exams/${remA}`, siswaA1)
            check('C5 LEAK: SISWA TIDAK melihat allowed_student_ids (daftar remedial)',
                dSis.status !== 200 || !('allowed_student_ids' in (dSis.data || {})), { status: dSis.status, allowed: dSis.data?.allowed_student_ids })

            const rCap = await api('/api/exams', admin, 'POST', {
                teaching_assignment_id: ta2.id, title: 'e2a9 Remedial B CAP',
                start_time: '2026-10-06T01:00:00Z', duration_minutes: 45,
                is_remedial: true, remedial_for_id: examB.id, allowed_student_ids: [ST.B1.student],
                remedial_score_policy: 'CAP', remedial_max_score: 70, duplicate_questions: false,
            })
            check('C6: remedial member B policy CAP (tanpa salin soal) → 200', rCap.status === 200 && rCap.data?.remedial_for_id === examB.id, [rCap.status, rCap.data?.error])
            const dCap = await api(`/api/exams/${rCap.data?.id}`, admin)
            check('C7: remedial_max_score tersimpan (CAP)', dCap.status === 200 && dCap.data?.remedial_max_score === 70, dCap.data?.remedial_max_score)

            const qEmpty = await api(`/api/exams/${rCap.data?.id}/questions`, admin)
            check('C8: Soal BARU (duplicate_questions=false) → 0 soal', qEmpty.status === 200 && (qEmpty.data || []).length === 0, qEmpty.data?.length)
        }

        // ═══ [D] KONSISTENSI BATCH — tidak ada member liar ═══
        console.log('\n═══ [D] Konsistensi batch ══')
        {
            const b2 = await examIdsByBatch(BATCH2)
            check('D1: BATCH2 berisi tepat 2 member (tidak ada injeksi guru3)', b2.length === 2 && b2.includes(copyA) && b2.includes(copyB), b2)
            const b3 = await examIdsByBatch(BATCH3)
            check('D2: BATCH3 single member milik guru1', b3.length === 1, b3)
        }
    } finally {
        console.log('\n═══ CLEANUP ══')
        await cleanupAll()
        console.log('cleanup ok')
    }

    console.log(`\n═══ HASIL: ${pass} pass, ${fail} fail ══`)
    process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
