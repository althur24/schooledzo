/**
 * VERIFIKASI PASCA-PUSH MAIN — sekolah SSA (production DB, read-only utk data SSA).
 *
 * Menjawab: "apakah perubahan paritas admin/guru aman utk data SSA?"
 * SSA tidak punya ulangan batch (seed tanpa batch_id) → jalur yang dipakai SSA
 * adalah ulangan SINGLE-KELAS + UTS/UAS official — keduanya harus 100% perilaku lama.
 *
 * Yang diverifikasi (GET semua — NOL tulis ke data SSA; satu-satunya tulis = baris
 * session uji milik skrip ini, dihapus di cleanup):
 *   [S] Seed ok: SSA ada, ulangan & UTS ditemukan, admin+guru+siswa ada
 *   [A] ADMIN: list /api/exams & /api/official-exams → 200 (list baru dgn batch_siblings)
 *       - detail ulangan SSA → batch_siblings = [] (single-kelas → UI tanpa dropdown)
 *       - detail UTS → tanpa batch field (official tak tersentuh)
 *       - hasil ulangan ?exam_id= → submission + embed kelas utk kolom Kelas
 *   [G] GURU pemilik TA (siti.rahma): detail ulangan → 200 + batch_siblings []
 *       - ?batch_id (ulangan tanpa batch) → guard: tidak melebar ke sekolah lain
 *   [C] SISWA: detail exam TANPA batch_siblings & TANPA allowed_student_ids (hardening baru)
 *       - ?exam_id hasil → HANYA barisnya sendiri
 *       - ?batch_id ulangan SSA → tidak ada baris kelas lain (batch nihil = kosong)
 *
 * Jalankan: ENV_FILE=.env.local node scripts/verify-ssa-parity.cjs
 * (Guard bawaan: server lokal diverifikasi menunjuk production via assertServerDb)
 */
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' })
const { makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb, makeSession } = require('../loadtest/e2e/helpers.cjs')

const PORT = 3461
const BASE = `http://localhost:${PORT}`
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let server = null
const created = { sessions: [] }
let pass = 0, fail = 0
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}
const arr = (v) => Array.isArray(v) ? v[0] : v

async function cleanup() {
    for (const s of (created.sessions || [])) {
        await supabase.from('sessions').delete().eq('id', s.id)
    }
}

async function main() {
    console.log('═══ [S] Fixture SSA (read-only) ══')
    const { data: school } = await supabase.from('schools').select('id, code, name').ilike('code', 'ssa').single()
    check('SSA ditemukan', !!school, school?.code)

    const { data: exams } = await supabase.from('exams')
        .select('id, title, is_active, batch_id, teaching_assignment:teaching_assignments!inner(teacher_id, subject_id, class_id, class:classes(id, name), teacher:teachers(id, user:users(id, username)))')
        .eq('teaching_assignment.class.classes.school_id', school.id)
    const ssaExams = (exams || [])
    check('SSA punya ulangan (tabel exams)', ssaExams.length > 0, ssaExams.length)
    const batchedSsa = ssaExams.filter(e => e.batch_id)
    check('SSA ulangan batch (harusnya 0 — jalur single-kelas)', batchedSsa.length === 0, batchedSsa.map(e => e.title))

    const exam = ssaExams.find(e => e.is_active === false) || ssaExams[0]
    check('Ulangan contoh tersedia', !!exam, exam?.title)

    const { data: official } = await supabase.from('official_exams')
        .select('id, title, exam_type')
        .limit(1)
    const uts = (official || [])[0]
    check('UTS/UAS official contoh tersedia', !!uts, uts?.title)

    const adminUser = (await supabase.from('users').select('id, username').eq('school_id', school.id).eq('role', 'ADMIN').limit(1).single()).data
    const guruUser = (await supabase.from('users').select('id, username').eq('username', 'siti.rahma.ssa').single()).data
    const taClassId = arr(exam.teaching_assignment)?.class_id
    const { data: anyStudent } = await supabase.from('students')
        .select('id, user:users!students_user_id_fkey(id, username)').eq('class_id', taClassId).limit(1).single()
    check('Admin + guru + siswa SSA tersedia', !!adminUser && !!guruUser && !!anyStudent, [adminUser?.username, guruUser?.username, anyStudent?.user?.username])

    // ── Start server (production DB) ──
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, false)
    const api = makeApi(BASE)

    const tokAdmin = await makeSession(supabase, adminUser.id, created)
    const tokGuru = await makeSession(supabase, guruUser.id, created)
    const tokSiswa = await makeSession(supabase, anyStudent.user.id, created)
    console.log('server up (production DB) — 3 session uji dibuat (di-cleanup di akhir)\n')

    try {
        console.log('═══ [A] ADMIN ══')
        {
            const rList = await api('/api/exams', tokAdmin)
            check('A1: list ulangan admin 200 (response shape baru)', rList.status === 200 && Array.isArray(rList.data), rList.status)
            const rDetail = await api(`/api/exams/${exam.id}`, tokAdmin)
            check('A2: detail ulangan SSA → batch_siblings [] (single-kelas: UI tanpa dropdown filter)',
                rDetail.status === 200 && Array.isArray(rDetail.data?.batch_siblings) && rDetail.data.batch_siblings.length === 0, rDetail.data?.batch_siblings)
            const rRes = await api(`/api/exam-submissions?exam_id=${exam.id}`, tokAdmin)
            const subs = Array.isArray(rRes.data) ? rRes.data : []
            const withClass = subs.filter(s => {
                const ex = arr(s.exam); const ta = ex?.teaching_assignment
                const cls = Array.isArray(ta) ? ta[0]?.class : ta?.class
                return !!arr(cls)?.name
            })
            check('A3: hasil ulangan → embed kelas utk kolom Kelas (kolom baru tak menghasilkan "-")',
                rRes.status === 200 && subs.length > 0 && withClass.length === subs.length, { n: subs.length, withClass: withClass.length })
            if (uts) {
                const rOff = await api(`/api/official-exams/${uts.id}`, tokAdmin)
                check('A4: detail UTS official utuh (tanpa field batch — tak tersentuh)',
                    rOff.status === 200 && !('batch_siblings' in (rOff.data || {})), rOff.status)
            }
        }

        console.log('═══ [G] GURU ══')
        {
            const rDetail = await api(`/api/exams/${exam.id}`, tokGuru)
            check('G1: guru lihat detail ulangan mapelnya → 200', rDetail.status === 200, [rDetail.status, rDetail.data?.error])
            const rBatch = await api(`/api/exam-submissions?batch_id=${exam.batch_id || '00000000-0000-0000-0000-000000000000'}`, tokGuru)
            check('G2: ?batch_id ulangan tanpa batch → kosong (tidak melebar ke data lain)',
                rBatch.status === 200 && (Array.isArray(rBatch.data) ? rBatch.data : []).length === 0, rBatch.status)
            const rSib = await api(`/api/exams/${exam.id}`, tokGuru)
            check('G3: guru detail → batch_siblings [] (bukan [] lain sekolah)', Array.isArray(rSib.data?.batch_siblings) && rSib.data.batch_siblings.length === 0, rSib.data?.batch_siblings)
        }

        console.log('═══ [C] SISWA (hardening baru) ══')
        {
            const rDetail = await api(`/api/exams/${exam.id}`, tokSiswa)
            check('C1: SISWA detail exam TANPA batch_siblings (field tak dikirim sama sekali)',
                rDetail.status !== 200 || !('batch_siblings' in (rDetail.data || {})), { status: rDetail.status })
            check('C2: SISWA detail exam TANPA allowed_student_ids', !('allowed_student_ids' in (rDetail.data || {})))
            const rRes = await api(`/api/exam-submissions?exam_id=${exam.id}`, tokSiswa)
            const rows = Array.isArray(rRes.data) ? rRes.data : []
            const other = rows.filter(s => s.student?.id !== anyStudent.id && s.student_id !== anyStudent.id)
            check('C3: SISWA ?exam_id → hanya barisnya sendiri', other.length === 0, rows.map(s => s.student_id))
        }
    } finally {
        console.log('\n═══ CLEANUP ══')
        await cleanup()
        console.log('session uji dihapus')
        if (server) await stopServerSafe(server, BASE)
    }

    console.log(`\n═══ HASIL: ${pass} pass, ${fail} fail ══`)
    process.exit(fail > 0 ? 1 : 0)
}

main().catch(async (e) => {
    console.error('FATAL:', e?.message || e)
    await cleanup().catch(() => { })
    if (server) await stopServerSafe(server, BASE).catch(() => { })
    process.exit(1)
})
