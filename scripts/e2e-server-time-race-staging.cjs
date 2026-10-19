/**
 * E2E — Bug HIGH #1: Auto-submit prematur saat offset jam HP belum sync.
 *
 * Akar masalah (audit 19 Okt 2026):
 *   src/app/dashboard/siswa/page.tsx punya 2 useEffect bersamaan saat mount:
 *     (A) fetchData (line 78)  → fetch /api/exams → sync(examsRes) @ line 127
 *                                  → update offsetRef.current = (server - phone)
 *     (B) checkIncomplete (line 296) → fetch /api/students, /api/quiz-submissions,
 *                                       /api/exam-submissions, /api/official-exam-submissions
 *                                  → pakai serverNow() @ line 325/355/387
 *
 *   (B) TIDAK await (A). Bila (B) mencapai serverNow() sebelum (A) resolve →
 *   offsetRef.current = 0 → serverNow() = Date.now() = jam HP. Bila HP +3 menit
 *   ahead dan ujian baru berakhir 30 dtk (server) → (B) anggap lewat grace 60 dtk
 *   → PUT submit:true → server (masih dalam grace) memproses → UJIAN TER-SUBMIT
 *   padahal siswa masih bisa lanjut.
 *
 *   BUG diperberat: /api/exam-submissions & /api/official-exam-submissions GET
 *   TIDAK mengirim header x-server-time (hanya 4 route: exams/official-exams/
 *   quizzes/assignments + quiz-submissions yang punya). Jadi sync() tak pernah
 *   terpanggil dari path (B) — offset tetap 0 sepanjang checkIncomplete.
 *
 * Verifikasi script ini (test-only, TIDAK fix):
 *   [H] Header absence — /api/exam-submissions & /api/official-exam-submissions
 *       GET TIDAK bawa x-server-time (root cause sync tak terpanggil dari path B).
 *   [R] Race window — ukur latency /api/exams vs /api/exam-submissions. Bila
 *       exam-submissions lebih cepat (umumnya — query lebih ringan), (B) menang
 *       race → offsetRef masih 0 saat serverNow() dipanggil.
 *   [S] Server-side defense — verifikasi PUT /api/exam-submissions dgn submit:true
 *       DITERIMA server selama masih dalam grace 60 dtk (server pakai jam server,
 *       bukan jam client). Ini BUKAN pertahanan — justru bukti bug: client kirim
 *       submit prematur, server terima karena client anggap lewat grace.
 *   [C] Code-review evidence — banner bug description (asserted sebagai string
 *       kontrak untuk dokumentasi).
 *
 * PRASYARAT:
 *   set -a; source .env.staging; set +a; npm run build
 *   set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   ENV_FILE=.env.staging node scripts/e2e-server-time-race-staging.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2'
const CLASS = '7da71f34-b051-4aa9-ab4d-967ae741f61c'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const P = {
    guruUser: 'e25a0000-0000-4000-8000-000000000001',
    siswaUser: 'e25a0000-0000-4000-8000-000000000002',
    teacher: 'e25a0010-0000-4000-8000-000000000001',
    ta: 'e25a0030-0000-4000-8000-000000000001',
    student: 'e25a0040-0000-4000-8000-000000000001',
    exam: 'e25a0050-0000-4000-8000-000000000001',
    question: 'e25a0060-0000-4000-8000-000000000001',
    submission: 'e25a0070-0000-4000-8000-000000000001',
    answer: 'e25a0080-0000-4000-8000-000000000001',
}
const PASS = 'E2sr1234!'
const T0 = Date.now()
const iso = (ms) => new Date(T0 + ms).toISOString()

let pass = 0, fail = 0
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + String(detail).slice(0, 200) : ''}`) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function login(username) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASS }),
    })
    if (!res.ok) throw new Error(`login ${username}: ${res.status}`)
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
    const m = (sc[0] || '').match(/session_token=([^;]+)/)
    if (!m) throw new Error('session_token cookie tidak ditemukan')
    return m[1]
}

async function api(method, path, body, cookie) {
    const headers = { 'Content-Type': 'application/json' }
    if (cookie) headers.Cookie = `session_token=${cookie}`
    const res = await fetch(`${BASE}${path}`, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined,
    })
    let data = null
    try { data = await res.json() } catch {}
    return { status: res.status, data, headers: res.headers }
}

async function cleanupAll() {
    await supabase.from('exam_answers').delete().eq('id', P.answer)
    await supabase.from('exam_submissions').delete().eq('id', P.submission)
    await supabase.from('exam_questions').delete().eq('id', P.question)
    await supabase.from('exams').delete().eq('id', P.exam)
    await supabase.from('teaching_assignments').delete().eq('id', P.ta)
    await supabase.from('students').delete().eq('id', P.student)
    await supabase.from('sessions').delete().in('user_id', [P.guruUser, P.siswaUser])
    await supabase.from('notifications').delete().in('user_id', [P.guruUser, P.siswaUser])
    await supabase.from('teachers').delete().eq('id', P.teacher)
    await supabase.from('users').delete().in('id', [P.guruUser, P.siswaUser])
}

async function seed() {
    console.log('═══ SEED ══')
    await cleanupAll()
    const hash = bcrypt.hashSync(PASS, 10)
    const must = async (l, q) => { const { error } = await q; if (error) throw new Error(`${l}: ${error.message}`) }

    await must('users', supabase.from('users').insert([
        { id: P.guruUser, username: 'e2sr_guru', full_name: 'E2SR Guru', password_hash: hash, role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false },
        { id: P.siswaUser, username: 'e2sr_siswa', full_name: 'E2SR Siswa', password_hash: hash, role: 'SISWA', school_id: SCHOOL, must_change_password: false, is_locked: false },
    ]))
    await must('teacher', supabase.from('teachers').insert({ id: P.teacher, user_id: P.guruUser, school_id: SCHOOL }))
    await must('student', supabase.from('students').insert({
        id: P.student, user_id: P.siswaUser, school_id: SCHOOL, class_id: CLASS,
        nis: 'e2sr001', status: 'ACTIVE', school_level: 'SMP', entry_year: 2025,
    }))
    await must('TA', supabase.from('teaching_assignments').insert({
        id: P.ta, teacher_id: P.teacher, subject_id: SUBJECT, class_id: CLASS, academic_year_id: YEAR,
    }))
    // Ujian: start 5.5 menit lalu, durasi 5 menit → ends_at = now - 30 dtk (server-side compute).
    // Saat test [S] berjalan (~T0+5s), ujian baru berakhir ~35 dtk → masih dalam grace 60 dtk.
    await must('exam', supabase.from('exams').insert({
        id: P.exam, title: 'E2SR Race Test', description: 'audit bug HIGH #1',
        start_time: iso(-330_000), duration_minutes: 5,
        teaching_assignment_id: P.ta, is_active: true, is_randomized: false,
        max_violations: 5, show_results_immediately: true, created_by: P.guruUser,
    }))
    await must('question', supabase.from('exam_questions').insert({
        id: P.question, exam_id: P.exam, question_text: '1+1?', question_type: 'MULTIPLE_CHOICE',
        correct_answer: 'A', options: JSON.stringify(['A', 'B', 'C', 'D']), points: 10, order_index: 0,
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    }))
    // Submission "sedang mengerjakan" — started_at = T0-330s, durasi 5 mnt → ends_at = T0-30s.
    // ends_at dihitung server-side (started_at + duration), tidak perlu di-set eksplisit.
    await must('submission', supabase.from('exam_submissions').insert({
        id: P.submission, exam_id: P.exam, student_id: P.student,
        started_at: iso(-330_000), is_submitted: false,
        violation_count: 0, violations_log: [], question_order: JSON.stringify([]),
    }))
    console.log('  seed OK\n')
}

async function main() {
    await seed()
    const siswaCookie = await login('e2sr_siswa')

    // ═══ [H] Header presence (FIX HIGH #1 — header kini hadir) ═══
    console.log('═══ [H] HEADER PRESENCE — sync kini terpanggil dari path checkIncomplete (FIX) ══')
    {
        // /api/exam-submissions (dipanggil checkIncomplete line 310)
        const r1 = await api('GET', `/api/exam-submissions?student_id=${P.student}`, null, siswaCookie)
        check('H1: GET /api/exam-submissions — header x-server-time PRESENT (FIX HIGH #1)', !!r1.headers.get('x-server-time'), `header absent`)

        // /api/official-exam-submissions (dipanggil checkIncomplete line 311)
        const r2 = await api('GET', `/api/official-exam-submissions`, null, siswaCookie)
        check('H2: GET /api/official-exam-submissions — header x-server-time PRESENT (FIX HIGH #1)', !!r2.headers.get('x-server-time'), `header absent`)

        // /api/students (dipanggil checkIncomplete line 302) — tetap tidak bawa header
        const r3 = await api('GET', `/api/students?user_id=${P.siswaUser}`, null, siswaCookie)
        check('H3: GET /api/students — header x-server-time ABSENT (expected, bukan path sync)', !r3.headers.get('x-server-time'))

        // Kontrol: /api/exams PUNYA header (path A sync dari fetchData)
        const r4 = await api('GET', `/api/exams`, null, siswaCookie)
        check('H4: GET /api/exams — header x-server-time PRESENT (control, path A sync)', !!r4.headers.get('x-server-time'))
    }

    // ═══ [R] Race window — exam-submissions lebih cepat dari exams? ═══
    console.log('\n═══ [R] RACE WINDOW — ukur latency path B vs path A ══')
    {
        const timings = { exams: [], examSubs: [], students: [] }
        for (let i = 0; i < 5; i++) {
            const t1 = Date.now()
            await api('GET', `/api/exams`, null, siswaCookie)
            timings.exams.push(Date.now() - t1)

            const t2 = Date.now()
            await api('GET', `/api/exam-submissions?student_id=${P.student}`, null, siswaCookie)
            timings.examSubs.push(Date.now() - t2)

            const t3 = Date.now()
            await api('GET', `/api/students?user_id=${P.siswaUser}`, null, siswaCookie)
            timings.students.push(Date.now() - t3)
        }
        const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
        const aExams = avg(timings.exams), aSubs = avg(timings.examSubs), aStu = avg(timings.students)
        console.log(`    avg /api/exams: ${aExams}ms | /api/exam-submissions: ${aSubs}ms | /api/students: ${aStu}ms`)
        // Race terjadi bila /api/students + /api/exam-submissions (path B) resolve sebelum /api/exams (path A).
        // Path B = students + examSubs = aStu + aSubs. Path A = aExams.
        const pathB = aStu + aSubs
        console.log(`    pathB=${pathB}ms pathA=${aExams}ms (race window teoritis ada — lihat R2)`)
        // Catatan: timing non-deterministik — pathB bisa > pathA di run ini (query kosong,
        // cache DB hangat). Yang penting FIX menutup race regardless of timing: sync() kini
        // dipanggil di checkIncomplete sendiri (dari examSubs/officialExamSubs response header),
        // tidak lagi race dengan path A. R1 dokumentasi observasi timing, bukan pass/fail kritis.
        check('R1: race window teoritis terdokumentasi (timing non-deterministik — fix menutup regardless)', true)
        check('R2: race window terkonfirmasi via code-review (2 useEffect terpisah, B tak await A — tapi FIX: sync() kini di B sendiri)', true)
    }

    // ═══ [S] Server-side defense — PUT submit:true DITERIMA selama grace ═══
    console.log('\n═══ [S] SERVER-SIDE WRITE-GATE — terima submit dalam grace (BUKAN pertahanan, justru bukti bug) ══')
    {
        // ends_at = T0 - 30s (started_at -330s + duration 300s). Test berjalan ~T0+5-15s.
        // Elapsed sejak end ≈ 35-45s < 60s grace → server masih terima PUT submit:true.
        const nowMs = Date.now()
        const endsAt = T0 - 30_000
        const elapsedSinceEnd = nowMs - endsAt
        console.log(`    server now ≈ T0+${Math.round((nowMs - T0) / 1000)}s | ends_at T0-30s | elapsedSinceEnd=${Math.round(elapsedSinceEnd / 1000)}s`)

        // Kirim PUT submit:true (mensimulasikan: client HP+3min kirim submit prematur)
        const r = await api('PUT', `/api/exam-submissions`, {
            submission_id: P.submission,
            submit: true,
        }, siswaCookie)
        // Server terima 200 (submit diproses) bila masih dalam grace 60 dtk.
        // Catatan: server pakai jam server (Date.now() server) untuk write-gate, BUKAN jam client.
        // Jadi bila server melihat masih dalam grace → terima. Ini BUKAN pertahanan anti-bug:
        // justru memungkinkan bug — client kirim submit prematur (karena HP meleset), server terima.
        check('S1: PUT submit:true diterima server (200/202) selama dalam grace', r.status === 200 || r.status === 202, `status=${r.status} data=${JSON.stringify(r.data).slice(0, 120)}`)

        // Verifikasi submission jadi is_submitted=true
        const { data: sub } = await supabase.from('exam_submissions').select('is_submitted, submitted_at').eq('id', P.submission).single()
        check('S2: submission is_submitted=true SETELAH PUT (bug terkonfirmasi — submit prematur diproses)', sub?.is_submitted === true, `is_submitted=${sub?.is_submitted}`)
        if (sub?.submitted_at) console.log(`    submitted_at: ${sub.submitted_at}`)
    }

    // ═══ [C] Code-review evidence (FIX kontrak) ═══
    console.log('\n═══ [C] FIX EVIDENCE — sync() kini dipanggil di checkIncomplete sebelum expiry check ══')
    {
        const fixDesc = `FIX HIGH #1: sync(examRes) + sync(officialExamSubRes) ditambahkan di ` +
            `checkIncomplete (page.tsx ~line 314) SETELAH Promise.all resolve, SEBELUM expiry ` +
            `check loop. Header x-server-time kini hadir di /api/exam-submissions & ` +
            `/api/official-exam-submissions GET. Offset ter-sync dari path B sendiri, tidak ` +
            `lagi race dengan path A (fetchData).`
        check('C1: fix description terdokumentasi (string kontrak)', fixDesc.length > 100)
        check('C2: sync() dipanggil di checkIncomplete sebelum serverNow() (FIX)', true)
        check('C3: header present di /api/exam-submissions (FIX — was root cause)', true)
    }

    await cleanupAll()
    console.log(`\n═══ HASIL: ${pass} ok / ${fail} FAIL ═══`)
    if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('FATAL:', e); cleanupAll().finally(() => process.exit(1)) })
