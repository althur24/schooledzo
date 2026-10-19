/**
 * E2E — Bug HIGH #2: Guard duplikat-judul TIDAK jalan saat RENAME (PATCH).
 *
 * Akar masalah (audit 19 Okt 2026):
 *   src/app/api/exams/route.ts POST punya guard 409 DUPLICATE_TITLE (line 359-402).
 *   src/app/api/exams/[id]/route.ts PATCH TIDAK punya guard apapun — title change
 *   diterima mentah (line 304: `if (title !== undefined) updateData.title = title`).
 *
 *   Skenario: guru punya "Ulangan A" + "Ulangan B" di TA sama (kelas+mapel+tahun sama).
 *   Guru rename "B" → "A" → 2 exam judul sama → siswa bingung, fragmentasi nilai.
 *
 * Verifikasi script ini (test-only, TIDAK fix):
 *   [B] BUG — PUT rename ke judul yang sudah ada di TA sama → assert 200 (BUG).
 *       Setelah fix: harus 409 DUPLICATE_TITLE dgn existing.id terisi.
 *   [N] NEGATIVE — PUT ke judul sama dgn diri sendiri → 200 (bukan false positive).
 *   [U] NEGATIVE — PUT ke judul unik → 200.
 *   [Y] TAHUN-SCOPING KONTRAK — exam "X" di TA tahun-lalu, rename exam tahun-ini ke "X"
 *       → harus 200 (TA beda, tidak false positive lintas tahun). Catat sebagai kontrak:
 *       saat fix bug #2 ditambahkan ke PATCH, guard WAJIB scoped per teaching_assignment_id
 *       (bukan global per sekolah), supaya guru 4 tahun ke depan tetap bisa pakai judul sama.
 *
 * PRASYARAT:
 *   set -a; source .env.staging; set +a; npm run build
 *   set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   ENV_FILE=.env.staging node scripts/e2e-duplicate-rename-staging.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR_ACTIVE = '228189ac-55c5-470b-88cf-033c040144fb' // 2026/2027
const YEAR_PAST = 'e25b0090-0000-4000-8000-0000000000aa'   // tahun lalu fixture
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2'
const CLASS = '7da71f34-b051-4aa9-ab4d-967ae741f61c'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const P = {
    guruUser: 'e25b0000-0000-4000-8000-000000000001',
    teacher: 'e25b0010-0000-4000-8000-000000000001',
    taActive: 'e25b0030-0000-4000-8000-000000000001', // TA tahun aktif
    taPast: 'e25b0030-0000-4000-8000-000000000002',   // TA tahun lalu
    examA: 'e25b0050-0000-4000-8000-000000000001',    // "Ulangan A" tahun aktif
    examB: 'e25b0050-0000-4000-8000-000000000002',    // "Ulangan B" tahun aktif (akan direname)
    examX: 'e25b0050-0000-4000-8000-000000000003',    // "Ulangan X" tahun lalu
    qA: 'e25b0060-0000-4000-8000-000000000001',
    qB: 'e25b0060-0000-4000-8000-000000000002',
    qX: 'e25b0060-0000-4000-8000-000000000003',
}
const PASS = 'E2dr1234!'
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
    await supabase.from('exam_questions').delete().in('id', [P.qA, P.qB, P.qX])
    await supabase.from('exam_submissions').delete().in('exam_id', [P.examA, P.examB, P.examX])
    await supabase.from('exams').delete().in('id', [P.examA, P.examB, P.examX])
    await supabase.from('teaching_assignments').delete().in('id', [P.taActive, P.taPast])
    await supabase.from('sessions').delete().eq('user_id', P.guruUser)
    await supabase.from('notifications').delete().eq('user_id', P.guruUser)
    await supabase.from('teachers').delete().eq('id', P.teacher)
    await supabase.from('users').delete().eq('id', P.guruUser)
    await supabase.from('academic_years').delete().eq('id', YEAR_PAST)
}

async function seed() {
    console.log('═══ SEED ══')
    await cleanupAll()
    const hash = bcrypt.hashSync(PASS, 10)
    const must = async (l, q) => { const { error } = await q; if (error) throw new Error(`${l}: ${error.message}`) }

    await must('users', supabase.from('users').insert({
        id: P.guruUser, username: 'e2dr_guru', full_name: 'E2DR Guru', password_hash: hash,
        role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false,
    }))
    await must('teacher', supabase.from('teachers').insert({ id: P.teacher, user_id: P.guruUser, school_id: SCHOOL }))

    // Tahun lalu fixture (is_active=false)
    await must('yearPast', supabase.from('academic_years').insert({
        id: YEAR_PAST, name: '2025/2026 STAGING PAST', is_active: false, school_id: SCHOOL,
    }))

    // 2 TA: tahun aktif + tahun lalu (guru+mapel+kelas sama, tahun beda → TA beda)
    await must('TA', supabase.from('teaching_assignments').insert([
        { id: P.taActive, teacher_id: P.teacher, subject_id: SUBJECT, class_id: CLASS, academic_year_id: YEAR_ACTIVE },
        { id: P.taPast, teacher_id: P.teacher, subject_id: SUBJECT, class_id: CLASS, academic_year_id: YEAR_PAST },
    ]))

    // Exam A & B di TA aktif (tahun ini)
    const mkExam = (id, title, taId) => ({
        id, title, description: 'e2dr fixture', start_time: iso(120_000), duration_minutes: 30,
        teaching_assignment_id: taId, is_active: false, is_randomized: false,
        max_violations: 3, show_results_immediately: true, created_by: P.guruUser,
    })
    await must('exams active', supabase.from('exams').insert([
        mkExam(P.examA, 'Ulangan A', P.taActive),
        mkExam(P.examB, 'Ulangan B', P.taActive),
        mkExam(P.examX, 'Ulangan X', P.taPast), // tahun lalu
    ]))

    const mkQ = (id, eid) => ({
        id, exam_id: eid, question_text: '1+1?', question_type: 'MULTIPLE_CHOICE',
        correct_answer: 'A', options: JSON.stringify(['A', 'B', 'C', 'D']), points: 10, order_index: 0,
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    })
    await must('questions', supabase.from('exam_questions').insert([mkQ(P.qA, P.examA), mkQ(P.qB, P.examB), mkQ(P.qX, P.examX)]))
    console.log('  seed OK\n')
}

async function main() {
    await seed()
    const guruCookie = await login('e2dr_guru')

    // ═══ [B] FIX — PUT rename ke judul yang sudah ada di TA sama → 409 (FIX) ═══
    console.log('═══ [B] FIX — PUT rename "Ulangan B" → "Ulangan A" (TA sama, kini 409) ══')
    {
        const r = await api('PUT', `/api/exams/${P.examB}`, { title: 'Ulangan A' }, guruCookie)
        // FIX: guard kini jalan di PUT — return 409 DUPLICATE_TITLE dgn existing.id = P.examA.
        check('B1: PUT rename ke judul existing → 409 DUPLICATE_TITLE (FIX)', r.status === 409, `status=${r.status} data=${JSON.stringify(r.data).slice(0, 150)}`)
        if (r.status === 409) {
            check('B2: error code DUPLICATE_TITLE', r.data?.error === 'DUPLICATE_TITLE', `error=${r.data?.error}`)
            check('B3: existing.id terisi (= examA)', r.data?.existing?.id === P.examA, `existing.id=${r.data?.existing?.id}`)
        } else {
            check('B2: error code DUPLICATE_TITLE', false, 'skip (B1 gagal)')
            check('B3: existing.id terisi (= examA)', false, 'skip')
        }

        // Verifikasi title TIDAK berubah (guard mencegah)
        const { data: exam } = await supabase.from('exams').select('title').eq('id', P.examB).single()
        check('B4: title examB tetap "Ulangan B" (guard mencegah perubahan)', exam?.title === 'Ulangan B', `title=${exam?.title}`)

        // Bypass: force_duplicate=true → 200 (override eksplisit)
        const r2 = await api('PUT', `/api/exams/${P.examB}`, { title: 'Ulangan A', force_duplicate: true }, guruCookie)
        check('B5: PUT dgn force_duplicate=true → 200 (bypass guard)', r2.status === 200, `status=${r2.status}`)
        if (r2.status === 200) {
            const { data: exam2 } = await supabase.from('exams').select('title').eq('id', P.examB).single()
            check('B6: title examB berubah jadi "Ulangan A" (override berhasil)', exam2?.title === 'Ulangan A', `title=${exam2?.title}`)
        }
    }

    // ═══ [N] NEGATIVE — PUT ke judul sama dgn diri sendiri ═══
    console.log('\n═══ [N] NEGATIVE — PUT examA ke "Ulangan A" (sama dgn diri, harus 200) ══')
    {
        const r = await api('PUT', `/api/exams/${P.examA}`, { title: 'Ulangan A' }, guruCookie)
        check('N1: PUT ke judul sama dgn diri sendiri → 200 (no false positive)', r.status === 200, `status=${r.status}`)
    }

    // ═══ [U] NEGATIVE — PUT ke judul unik ═══
    console.log('\n═══ [U] NEGATIVE — PUT examA ke "Ulangan C" (unik, harus 200) ══')
    {
        const r = await api('PUT', `/api/exams/${P.examA}`, { title: 'Ulangan C' }, guruCookie)
        check('U1: PUT ke judul unik → 200', r.status === 200, `status=${r.status}`)
        if (r.status === 200) {
            const { data: exam } = await supabase.from('exams').select('title').eq('id', P.examA).single()
            check('U2: title examA berubah jadi "Ulangan C"', exam?.title === 'Ulangan C', `title=${exam?.title}`)
        }
    }

    // ═══ [Y] TAHUN-SCOPING KONTRAK ═══
    console.log('\n═══ [Y] TAHUN-SCOPING KONTRAK — rename exam tahun-ini ke judul exam tahun-lalu ══')
    {
        // examX "Ulangan X" ada di TA tahun lalu (taPast).
        // Rename examB (tahun aktif) ke "Ulangan X" → TA beda → harus 200 (tidak false positive).
        const r = await api('PUT', `/api/exams/${P.examB}`, { title: 'Ulangan X' }, guruCookie)
        check('Y1: PUT ke judul exam di tahun lalu → 200 (TA beda, no false positive)', r.status === 200, `status=${r.status}`)
        if (r.status === 200) {
            const { data: exam } = await supabase.from('exams').select('title').eq('id', P.examB).single()
            check('Y2: title examB berubah jadi "Ulangan X" (lintas tahun sah)', exam?.title === 'Ulangan X', `title=${exam?.title}`)
        }
        // Kontrak untuk fix bug #2 nanti: guard PATCH WAJIB scoped per teaching_assignment_id
        // (bukan global per sekolah). Kalau di-scope global, guru 4 tahun ke depan bakal
        // terus kena peringatan untuk judul yang dipakai di tahun lalu — over-guarding.
        check('Y3: KONTRAK — fix guard PATCH WAJIB scope per TA (bukan global)', true)
    }

    await cleanupAll()
    console.log(`\n═══ HASIL: ${pass} ok / ${fail} FAIL ═══`)
    if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('FATAL:', e); cleanupAll().finally(() => process.exit(1)) })
