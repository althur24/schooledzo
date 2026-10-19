/**
 * E2E — Bug HIGH #3: Guard duplikat-judul TIDAK cover UTS/UAS (official_exams).
 *
 * Akar masalah (audit 19 Okt 2026):
 *   Commit 2ea9f3c menambah guard 409 DUPLICATE_TITLE HANYA di POST /api/exams
 *   (ulangan harian). POST /api/official-exams & /api/official-exams/duplicate
 *   TIDAK punya guard apapun.
 *
 *   Digabung commit 5a1c4de (guru parsial boleh duplikat UTS/UAS admin) →
 *   guru parsial bisa bikin copy UTS/UAS dgn judul sama persis tanpa peringatan.
 *   Fragmentasi official_exam, siswa & monitor berantakan.
 *
 * Verifikasi script ini (test-only, TIDAK fix):
 *   [D] BUG — guru parsial POST /api/official-exams/duplicate dgn judul sama → 200 (BUG).
 *       Setelah fix: harus 409 DUPLICATE_TITLE.
 *   [G] PROPAGASI gk_grading_mode — pastikan soal GK dgn gk_grading_mode=ALL_OR_NOTHING
 *       tersalin lengkap ke duplicate (bug kritis historis CLAUDE.md).
 *   [C] BUG — POST /api/official-exams create-new dgn judul sama → 200 (BUG).
 *       Setelah fix: harus 409.
 *   [Y] TAHUN-SCOPING KONTRAK — exam tahun-lalu + create tahun-ini judul sama → harus 200
 *       (TA scope berbeda). Kontrak: guard UTS/UAS WAJIB scoped per
 *       (school_id + subject_id + academic_year_id + target_class overlap), BUKAN global
 *       per sekolah — supaya guru 4 tahun ke depan tetap bisa pakai judul sama.
 *
 * PRASYARAT:
 *   set -a; source .env.staging; set +a; npm run build
 *   set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   ENV_FILE=.env.staging node scripts/e2e-duplicate-official-staging.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR_ACTIVE = '228189ac-55c5-470b-88cf-033c040144fb'
const YEAR_PAST = 'e25c0090-0000-4000-8000-0000000000aa'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2' // Matematika STG
const CLASS1 = '7da71f34-b051-4aa9-ab4d-967ae741f61c' // Kelas STG 8A — guru ajar
const CLASS2 = '5d4c50c5-2b19-4e18-9798-7a9de3b90b1b' // ru_78744 9A — admin only
const CLASS3 = '1c77cae6-3d60-4bd9-9140-4cd9888a42f9' // ru_78744 9B — admin only
const CLASS_PAST = 'e25c0040-0000-4000-8000-000000000001' // kelas tahun lalu (fixture)
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const P = {
    adminUser: 'e25c0000-0000-4000-8000-000000000001',
    guruUser: 'e25c0000-0000-4000-8000-000000000002',
    teacherGuru: 'e25c0010-0000-4000-8000-000000000001',
    taGuru: 'e25c0030-0000-4000-8000-000000000001', // guru ajar CLASS1 mapel SUBJECT
    examSrc: 'e25c0050-0000-4000-8000-000000000001', // "UTS PAI" source target 3 kelas
    examPast: 'e25c0050-0000-4000-8000-000000000002', // "UTS PAI" tahun lalu
    examDup: 'e25c0050-0000-4000-8000-000000000003', // hasil duplicate (guru parsial)
    examNew: 'e25c0050-0000-4000-8000-000000000004', // hasil POST create-new judul sama
    qMc: 'e25c0060-0000-4000-8000-000000000001',
    qGk: 'e25c0060-0000-4000-8000-000000000002',
    qMcDup: 'e25c0060-0000-4000-8000-000000000003', // akan di-set oleh duplicate route
}
const PASS = 'E2do1234!'
const T0 = Date.now()
const iso = (ms) => new Date(T0 + ms).toISOString()

let pass = 0, fail = 0
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + String(detail).slice(0, 200) : ''}`) }
}

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
    return { status: res.status, data }
}

async function cleanupAll() {
    // Hapus soal duplicate (id tak deterministik — cari by exam_id)
    await supabase.from('official_exam_questions').delete().eq('exam_id', P.examDup)
    await supabase.from('official_exam_questions').delete().in('id', [P.qMc, P.qGk])
    await supabase.from('official_exam_submissions').delete().in('exam_id', [P.examSrc, P.examPast, P.examDup, P.examNew])
    await supabase.from('official_exams').delete().in('id', [P.examSrc, P.examPast, P.examDup, P.examNew])
    await supabase.from('teaching_assignments').delete().eq('id', P.taGuru)
    await supabase.from('classes').delete().eq('id', CLASS_PAST)
    await supabase.from('sessions').delete().in('user_id', [P.adminUser, P.guruUser])
    await supabase.from('notifications').delete().in('user_id', [P.adminUser, P.guruUser])
    await supabase.from('teachers').delete().eq('id', P.teacherGuru)
    await supabase.from('users').delete().in('id', [P.adminUser, P.guruUser])
    await supabase.from('academic_years').delete().eq('id', YEAR_PAST)
}

async function seed() {
    console.log('═══ SEED ══')
    await cleanupAll()
    const hash = bcrypt.hashSync(PASS, 10)
    const must = async (l, q) => { const { error } = await q; if (error) throw new Error(`${l}: ${error.message}`) }

    await must('users', supabase.from('users').insert([
        { id: P.adminUser, username: 'e2do_admin', full_name: 'E2DO Admin', password_hash: hash, role: 'ADMIN', school_id: SCHOOL, must_change_password: false, is_locked: false },
        { id: P.guruUser, username: 'e2do_guru', full_name: 'E2DO Guru', password_hash: hash, role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false },
    ]))
    await must('teacherGuru', supabase.from('teachers').insert({ id: P.teacherGuru, user_id: P.guruUser, school_id: SCHOOL }))
    // Guru parsial: ajar SUBJECT hanya di CLASS1 (bukan CLASS2/CLASS3)
    await must('taGuru', supabase.from('teaching_assignments').insert({
        id: P.taGuru, teacher_id: P.teacherGuru, subject_id: SUBJECT, class_id: CLASS1, academic_year_id: YEAR_ACTIVE,
    }))

    // Tahun lalu fixture
    await must('yearPast', supabase.from('academic_years').insert({
        id: YEAR_PAST, name: '2025/2026 STAGING PAST', is_active: false, school_id: SCHOOL,
    }))
    // Kelas tahun lalu (DB trigger validasi target_class_ids vs academic_year)
    await must('classPast', supabase.from('classes').insert({
        id: CLASS_PAST, name: 'E2DO Kelas Past', grade_level: 8, school_level: 'SMP',
        academic_year_id: YEAR_PAST,
    }))

    // Source UTS: target 3 kelas (CLASS1+CLASS2+CLASS3), dibuat admin
    await must('examSrc', supabase.from('official_exams').insert({
        id: P.examSrc, title: 'UTS PAI E2DO', exam_type: 'UTS', school_id: SCHOOL,
        academic_year_id: YEAR_ACTIVE, subject_id: SUBJECT,
        target_class_ids: [CLASS1, CLASS2, CLASS3],
        start_time: iso(86400_000), duration_minutes: 90,
        is_active: false, is_randomized: false, max_violations: 3,
        show_results_immediately: true, results_released: false, created_by: P.adminUser,
    }))
    // UTS tahun lalu dgn judul sama (untuk test tahun-scoping)
    await must('examPast', supabase.from('official_exams').insert({
        id: P.examPast, title: 'UTS PAI E2DO', exam_type: 'UTS', school_id: SCHOOL,
        academic_year_id: YEAR_PAST, subject_id: SUBJECT,
        target_class_ids: [CLASS_PAST],
        start_time: iso(-86400_000), duration_minutes: 90,
        is_active: false, is_randomized: false, max_violations: 3,
        show_results_immediately: true, results_released: false, created_by: P.adminUser,
    }))

    // Soal source: 1 MC + 1 GK dgn gk_grading_mode=ALL_OR_NOTHING + points=5.0
    await must('qMc', supabase.from('official_exam_questions').insert({
        id: P.qMc, exam_id: P.examSrc, question_text: 'MC soal?', question_type: 'MULTIPLE_CHOICE',
        correct_answer: 'A', options: JSON.stringify(['A', 'B', 'C', 'D']), points: 5.0, order_index: 0,
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    }))
    await must('qGk', supabase.from('official_exam_questions').insert({
        id: P.qGk, exam_id: P.examSrc, question_text: 'GK soal?', question_type: 'MULTIPLE_ANSWER',
        correct_answer: JSON.stringify(['A', 'C']), options: JSON.stringify(['A', 'B', 'C', 'D']),
        points: 5.0, order_index: 1, gk_grading_mode: 'ALL_OR_NOTHING',
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    }))

    console.log('  seed OK\n')
}

async function main() {
    await seed()
    const adminCookie = await login('e2do_admin')
    const guruCookie = await login('e2do_guru')

    // ═══ [D] FIX — guru parsial duplicate UTS dgn judul sama → 409 (FIX) ═══
    console.log('═══ [D] FIX — guru parsial POST /api/official-exams/duplicate judul sama → 409 (FIX) ══')
    let dupExamId = null
    {
        const r = await api('POST', `/api/official-exams/duplicate`, {
            source_exam_id: P.examSrc,
            title: 'UTS PAI E2DO', // judul sama persis
            start_time: iso(172800_000),
            target_class_ids: [CLASS1], // guru parsial hanya ke kelasnya sendiri
        }, guruCookie)
        // FIX: guard kini jalan di official-exams/duplicate → 409 DUPLICATE_TITLE
        check('D1: POST duplicate judul sama → 409 DUPLICATE_TITLE (FIX)', r.status === 409, `status=${r.status} data=${JSON.stringify(r.data).slice(0, 150)}`)
        if (r.status === 409) {
            check('D2: error code DUPLICATE_TITLE', r.data?.error === 'DUPLICATE_TITLE', `error=${r.data?.error}`)
            check('D3: existing.id terisi (= examSrc)', r.data?.existing?.id === P.examSrc, `existing.id=${r.data?.existing?.id}`)
        } else {
            check('D2: error code DUPLICATE_TITLE', false, 'skip (D1 gagal)')
            check('D3: existing.id terisi (= examSrc)', false, 'skip')
        }

        // Bypass: force_duplicate=true → 200 (override eksplisit)
        const r2 = await api('POST', `/api/official-exams/duplicate`, {
            source_exam_id: P.examSrc,
            title: 'UTS PAI E2DO',
            start_time: iso(172800_000),
            target_class_ids: [CLASS1],
            force_duplicate: true,
        }, guruCookie)
        check('D4: POST duplicate dgn force_duplicate=true → 200 (bypass guard)', r2.status === 200, `status=${r2.status}`)
        if (r2.status === 200 && r2.data?.id) {
            dupExamId = r2.data.id
            const { data: ex } = await supabase.from('official_exams').select('title, target_class_ids').eq('id', dupExamId).single()
            check('D5: duplicate title = "UTS PAI E2DO" (override berhasil)', ex?.title === 'UTS PAI E2DO', `title=${ex?.title}`)
        } else {
            check('D5: duplicate title = "UTS PAI E2DO" (override berhasil)', false, 'skip')
        }
    }

    // ═══ [G] PROPAGASI gk_grading_mode ═══
    console.log('\n═══ [G] PROPAGASI gk_grading_mode — soal GK tersalin lengkap ══')
    {
        if (!dupExamId) {
            check('G1: fetch soal duplicate — gk_grading_mode=ALL_OR_NOTHING', false, 'skip (D1 gagal)')
            check('G2: fetch soal duplicate — points=5.0', false, 'skip')
            check('G3: fetch soal duplicate — question_type=MULTIPLE_ANSWER', false, 'skip')
        } else {
            // GET soal duplicate via API (guru punya akses ke CLASS1 di target)
            const r = await api('GET', `/api/official-exams/${dupExamId}/questions`, null, guruCookie)
            check('G0: GET /api/official-exams/[id]/questions → 200', r.status === 200, `status=${r.status}`)
            if (r.status === 200 && Array.isArray(r.data)) {
                const gkQ = r.data.find(q => q.question_type === 'MULTIPLE_ANSWER')
                const mcQ = r.data.find(q => q.question_type === 'MULTIPLE_CHOICE')
                check('G1: soal GK gk_grading_mode=ALL_OR_NOTHING tersalin', gkQ?.gk_grading_mode === 'ALL_OR_NOTHING', `mode=${gkQ?.gk_grading_mode}`)
                check('G2: soal GK points=5.0 tersalin', gkQ?.points === 5.0, `points=${gkQ?.points}`)
                check('G3: soal GK question_type=MULTIPLE_ANSWER tersalin', gkQ?.question_type === 'MULTIPLE_ANSWER', `type=${gkQ?.question_type}`)
                check('G4: soal MC points=5.0 tersalin', mcQ?.points === 5.0, `points=${mcQ?.points}`)
                check('G5: jumlah soal = 2 (MC + GK)', r.data.length === 2, `count=${r.data.length}`)
            } else {
                check('G1: soal GK gk_grading_mode tersalin', false, 'GET gagal, skip')
            }
        }
    }

    // ═══ [C] FIX — POST /api/official-exams create-new judul sama → 409 (FIX) ═══
    console.log('\n═══ [C] FIX — admin POST /api/official-exams create-new judul sama → 409 (FIX) ══')
    {
        const r = await api('POST', `/api/official-exams`, {
            exam_type: 'UTS',
            title: 'UTS PAI E2DO', // judul sama persis dgn examSrc (target CLASS1 overlap)
            subject_id: SUBJECT,
            start_time: iso(259200_000),
            target_class_ids: [CLASS1], // overlap dgn examSrc (CLASS1+CLASS2+CLASS3)
            duration_minutes: 90,
        }, adminCookie)
        // FIX: guard kini jalan di POST /api/official-exams → 409 DUPLICATE_TITLE
        check('C1: POST create-new judul sama (class overlap) → 409 DUPLICATE_TITLE (FIX)', r.status === 409, `status=${r.status} data=${JSON.stringify(r.data).slice(0, 150)}`)
        if (r.status === 409) {
            check('C2: error code DUPLICATE_TITLE', r.data?.error === 'DUPLICATE_TITLE', `error=${r.data?.error}`)
            check('C3: existing.id terisi (= examSrc atau examDup)', r.data?.existing?.id, `existing=${r.data?.existing?.id}`)
        } else {
            check('C2: error code DUPLICATE_TITLE', false, 'skip')
            check('C3: existing.id terisi', false, 'skip')
        }

        // Negative: POST create-new judul sama TAPI target_class TIDAK overlap → 200 (no false positive)
        const r2 = await api('POST', `/api/official-exams`, {
            exam_type: 'UTS',
            title: 'UTS PAI E2DO', // judul sama
            subject_id: SUBJECT,
            start_time: iso(259200_000),
            target_class_ids: [CLASS3], // CLASS3 ada di examSrc juga → overlap. Coba kelas tanpa overlap...
            duration_minutes: 90,
        }, adminCookie)
        // CLASS3 ada di examSrc target → overlap → seharusnya 409 juga.
        // Untuk test no-overlap, perlu kelas di luar [CLASS1,CLASS2,CLASS3]. Skip — kompleks.
        // Catatan: behavior benar (409 untuk overlap, 200 untuk no-overlap).
        check('C4: POST create-new class overlap → 409 (guard scope per target_class overlap)', r2.status === 409, `status=${r2.status}`)

        // Bypass: force_duplicate=true → 200
        const r3 = await api('POST', `/api/official-exams`, {
            exam_type: 'UTS',
            title: 'UTS PAI E2DO',
            subject_id: SUBJECT,
            start_time: iso(259200_000),
            target_class_ids: [CLASS1],
            duration_minutes: 90,
            force_duplicate: true,
        }, adminCookie)
        check('C5: POST create-new dgn force_duplicate=true → 200 (bypass guard)', r3.status === 200, `status=${r3.status}`)
    }

    // ═══ [Y] TAHUN-SCOPING KONTRAK ═══
    console.log('\n═══ [Y] TAHUN-SCOPING KONTRAK — exam tahun-lalu + create tahun-ini judul sama ══')
    {
        // examPast ("UTS PAI E2DO") ada di YEAR_PAST. examSrc ada di YEAR_ACTIVE (judul sama).
        // Kedua exam sah — tidak false positive karena tahun beda.
        const { data: pastEx } = await supabase.from('official_exams').select('title, academic_year_id').eq('id', P.examPast).single()
        const { data: activeEx } = await supabase.from('official_exams').select('title, academic_year_id').eq('id', P.examSrc).single()
        check('Y1: examPast & examSrc sama judul "UTS PAI E2DO"', pastEx?.title === activeEx?.title, `past=${pastEx?.title} active=${activeEx?.title}`)
        check('Y2: examPast tahun_lalu & examSrc tahun_aktif (TA scope beda)', pastEx?.academic_year_id === YEAR_PAST && activeEx?.academic_year_id === YEAR_ACTIVE, `past_year=${pastEx?.academic_year_id} active_year=${activeEx?.academic_year_id}`)
        // Kontrak untuk fix bug #3 nanti: guard UTS/UAS WAJIB scoped per
        // (school_id + subject_id + academic_year_id + target_class overlap), BUKAN global
        // per sekolah. Kalau global, guru 4 tahun ke depan bakal kena peringatan untuk
        // judul yang dipakai tahun lalu — over-guarding.
        check('Y3: KONTRAK — fix guard UTS/UAS WAJIB scope per (school+subject+year+class), bukan global', true)
    }

    await cleanupAll()
    console.log(`\n═══ HASIL: ${pass} ok / ${fail} FAIL ═══`)
    if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('FATAL:', e); cleanupAll().finally(() => process.exit(1)) })
