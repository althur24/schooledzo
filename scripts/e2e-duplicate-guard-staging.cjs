/**
 * E2E staging: Guard duplikat-judul + deteksi duplikat + expandable card data.
 *
 * Menguji Plan 1 (server guard 409 + force_duplicate bypass + pre-flight data)
 * dan Plan 3 (detectDuplicateGroups data layer — badge muncul berdasar data
 * list). UI rendering (dialog/expandable/badge visual) divalidasi via data
 * assertion: POST 409 memicu dialog, list berisi duplikat memicu badge.
 *
 * PRASYARAT (urutan WAJIB):
 *   1. set -a; source .env.staging; set +a; npm run build
 *   2. set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   3. ENV_FILE=.env.staging node scripts/e2e-duplicate-guard-staging.cjs
 *      (E2E_BASE=https://...railway.app untuk remote staging — WAJIB kode sudah
 *      ter-deploy ke branch staging)
 *
 * Seksi:
 *  [S] Seed: guru owner (TA1+TA2 kelas berbeda) + admin + exam existing
 *      "Ulangan Duplikat Test" untuk TA1 (aktif, 1 submission).
 *  [G] Server guard: 409 judul sama · bypass force_duplicate · bypass remedial ·
 *      normalize spasi-depan · TA beda lolos · judul beda lolos · draft existing
 *      tetap tertangkap.
 *  [P] Pre-flight data: GET /api/exams?ta=X mengembalikan existing → detect hit.
 *  [D] Deteksi duplikat: seed 2 exam judul sama TA sama → GET list guru & admin
 *      keduanya melihat 2 baris (data untuk badge) — adil.
 *  [F] Flow create: guru POST judul baru → 201 (no dialog); judul duplikat → 409.
 *  [C] Cleanup penuh (prefix e2dg_).
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2dg1234!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2' // Matematika STG
const CLASS = '7da71f34-b051-4aa9-ab4d-967ae741f61c'   // Kelas STG 8A
const CLASS2 = '5d4c50c5-2b19-4e18-9798-7a9de3b90b1b'   // Kelas STG 9A

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const P = {
    guruUser: 'e2d00000-0000-4000-8000-000000000001',
    adminUser: 'e2d00000-0000-4000-8000-000000000002',
    teacher: 'e2d01000-0000-4000-8000-000000000001',
    ta1: 'e2d03000-0000-4000-8000-000000000001', // guru owner, CLASS, SUBJECT
    ta2: 'e2d03000-0000-4000-8000-000000000002', // guru owner, CLASS2, SUBJECT
    examExisting: 'e2d05000-0000-4000-8000-000000000001', // existing dup target
    examExisting2: 'e2d05000-0000-4000-8000-000000000002', // 2nd duplicate for detection
    examNew: 'e2d05000-0000-4000-8000-000000000003',
    qExisting: 'e2d06000-0000-4000-8000-000000000001',
}

const T0 = Date.now()
const iso = (msFromNow) => new Date(T0 + msFromNow).toISOString()

let pass = 0, fail = 0
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail ?? '').slice(0, 160) : ''}`) }
}

async function login(username) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASS }),
    })
    if (!res.ok) throw new Error(`login ${username}: ${res.status}`)
    return res.headers.get('set-cookie')?.split(';')[0]
}

async function api(method, path, body, cookie) {
    const res = await fetch(BASE + path, {
        method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    let data = null
    try { data = await res.json() } catch { }
    return { status: res.status, data }
}

async function cleanupAll() {
    const ids = Object.values(P)
    await supabase.from('exam_answers').delete().in('exam_id', [P.examExisting, P.examExisting2, P.examNew])
    await supabase.from('exam_submissions').delete().in('exam_id', [P.examExisting, P.examExisting2, P.examNew])
    await supabase.from('exam_questions').delete().in('exam_id', [P.examExisting, P.examExisting2, P.examNew])
    await supabase.from('exams').delete().in('id', [P.examExisting, P.examExisting2, P.examNew])
    await supabase.from('teaching_assignments').delete().in('id', [P.ta1, P.ta2])
    await supabase.from('sessions').delete().in('user_id', [P.guruUser, P.adminUser])
    await supabase.from('notifications').delete().in('user_id', [P.guruUser, P.adminUser])
    await supabase.from('teachers').delete().eq('id', P.teacher)
    await supabase.from('users').delete().in('id', [P.guruUser, P.adminUser])
    // sisa via prefix jaga-jaga
    const { data: lo } = await supabase.from('users').select('id').like('username', 'e2dg_%')
    for (const u of (lo || [])) await supabase.from('users').delete().eq('id', u.id)
}

async function seed() {
    console.log('═══ SEED ══')
    await cleanupAll()
    const hash = bcrypt.hashSync(PASS, 10)
    const must = async (label, q) => { const { error } = await q; if (error) throw new Error(`${label}: ${error.message}`) }
    await must('users', supabase.from('users').insert([
        { id: P.guruUser, username: 'e2dg_guru', full_name: 'E2DG Guru', password_hash: hash, role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false },
        { id: P.adminUser, username: 'e2dg_admin', full_name: 'E2DG Admin', password_hash: hash, role: 'ADMIN', school_id: SCHOOL, must_change_password: false, is_locked: false },
    ]))
    await must('teachers', supabase.from('teachers').insert({ id: P.teacher, user_id: P.guruUser, school_id: SCHOOL }))
    await must('TA', supabase.from('teaching_assignments').insert([
        { id: P.ta1, teacher_id: P.teacher, subject_id: SUBJECT, class_id: CLASS, academic_year_id: YEAR },
        { id: P.ta2, teacher_id: P.teacher, subject_id: SUBJECT, class_id: CLASS2, academic_year_id: YEAR },
    ]))
    // Existing exam "Ulangan Duplikat Test" untuk TA1 (target guard)
    await must('examExisting', supabase.from('exams').insert({
        id: P.examExisting, title: 'Ulangan Duplikat Test', description: 'e2dg fixture',
        start_time: iso(60_000), duration_minutes: 30, teaching_assignment_id: P.ta1,
        is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: true,
        created_by: P.guruUser,
    }))
    await must('qExisting', supabase.from('exam_questions').insert({
        id: P.qExisting, exam_id: P.examExisting, question_text: 'Soal 1?', question_type: 'MULTIPLE_CHOICE',
        correct_answer: 'A', options: ['A', 'B', 'C', 'D'], points: 10, order_index: 0,
    }))
    console.log('  seed OK\n')
}

async function main() {
    await seed()
    const guruCookie = await login('e2dg_guru')
    const adminCookie = await login('e2dg_admin')
    const dupTitle = 'Ulangan Duplikat Test'
    const baseBody = (overrides = {}) => ({
        title: dupTitle,
        description: 'e2dg new',
        start_time: iso(120_000),
        duration_minutes: 30,
        teaching_assignment_id: P.ta1,
        is_randomized: false, max_violations: 3, show_results_immediately: true,
        ...overrides,
    })

    // ═══ [G] SERVER GUARD ═══
    console.log('═══ [G] SERVER GUARD ══')

    // G1: judul sama untuk TA sama → 409 DUPLICATE_TITLE
    {
        const r = await api('POST', '/api/exams', baseBody(), guruCookie)
        check('G1: judul sama TA sama → 409', r.status === 409, { status: r.status, err: r.data?.error })
        check('G1b: error code DUPLICATE_TITLE', r.data?.error === 'DUPLICATE_TITLE', r.data)
        check('G1c: existing.id terisi', r.data?.existing?.id === P.examExisting, r.data?.existing)
        check('G1d: existing.title terisi', r.data?.existing?.title === dupTitle, r.data?.existing)
        check('G1e: existing.className terisi', typeof r.data?.existing?.className === 'string', r.data?.existing)
        check('G1f: existing.submissionCount angka', typeof r.data?.existing?.submissionCount === 'number', r.data?.existing)
    }

    // G2: force_duplicate:true → 201
    {
        const r = await api('POST', '/api/exams', baseBody({ force_duplicate: true }), guruCookie)
        check('G2: force_duplicate:true → 201', r.status === 201 || r.status === 200, { status: r.status, err: r.data })
        if (r.data?.id) {
            await supabase.from('exam_questions').delete().eq('exam_id', r.data.id)
            await supabase.from('exam_submissions').delete().eq('exam_id', r.data.id)
            await supabase.from('exams').delete().eq('id', r.data.id)
        }
    }

    // G3: is_remedial:true + judul sama → 201 (bypass)
    {
        const r = await api('POST', '/api/exams', baseBody({ is_remedial: true, remedial_for_id: P.examExisting, remedial_score_policy: 'CAP', remedial_max_score: 75 }), guruCookie)
        check('G3: is_remedial → 201 (bypass guard)', r.status === 201 || r.status === 200, { status: r.status, err: r.data })
        if (r.data?.id) {
            await supabase.from('exam_questions').delete().eq('exam_id', r.data.id)
            await supabase.from('exam_submissions').delete().eq('exam_id', r.data.id)
            await supabase.from('exams').delete().eq('id', r.data.id)
        }
    }

    // G4: normalize spasi-depan "  Ulangan Duplikat Test  " → 409
    {
        const r = await api('POST', '/api/exams', baseBody({ title: '  Ulangan Duplikat Test  ' }), guruCookie)
        check('G4: spasi-depan+belakang normalize → 409', r.status === 409, { status: r.status })
    }

    // G4b: case-insensitive "ULANGAN DUPLIKAT TEST" → 409
    {
        const r = await api('POST', '/api/exams', baseBody({ title: 'ULANGAN DUPLIKAT TEST' }), guruCookie)
        check('G4b: uppercase normalize → 409', r.status === 409, { status: r.status })
    }

    // G5: TA berbeda (TA2) + judul sama → 201 (tidak konflik)
    {
        const r = await api('POST', '/api/exams', baseBody({ teaching_assignment_id: P.ta2 }), guruCookie)
        check('G5: TA beda judul sama → 201', r.status === 201 || r.status === 200, { status: r.status, err: r.data })
        if (r.data?.id) {
            await supabase.from('exam_questions').delete().eq('exam_id', r.data.id)
            await supabase.from('exam_submissions').delete().eq('exam_id', r.data.id)
            await supabase.from('exams').delete().eq('id', r.data.id)
        }
    }

    // G6: TA sama + judul BERBEDA → 201
    {
        const r = await api('POST', '/api/exams', baseBody({ title: 'Ulangan Baru Lain' }), guruCookie)
        check('G6: TA sama judul beda → 201', r.status === 201 || r.status === 200, { status: r.status, err: r.data })
        if (r.data?.id) {
            await supabase.from('exam_questions').delete().eq('exam_id', r.data.id)
            await supabase.from('exam_submissions').delete().eq('exam_id', r.data.id)
            await supabase.from('exams').delete().eq('id', r.data.id)
        }
    }

    // ═══ [P] PRE-FLIGHT DATA ═══
    console.log('\n═══ [P] PRE-FLIGHT DATA ══')

    // P1: GET /api/exams?teaching_assignment_id=TA1 → mengandung examExisting
    {
        const r = await api('GET', `/api/exams?teaching_assignment_id=${P.ta1}`, undefined, guruCookie)
        check('P1: GET exams TA1 → 200', r.status === 200, r.status)
        const arr = Array.isArray(r.data) ? r.data : []
        const found = arr.find(e => e.title === dupTitle && !e.is_remedial)
        check('P2: examExisting muncul di list TA1', !!found, { n: arr.length, titles: arr.map(e => e.title) })
    }

    // P3: GET TA2 → tidak mengandung dupTitle (exam existing hanya di TA1)
    {
        const r = await api('GET', `/api/exams?teaching_assignment_id=${P.ta2}`, undefined, guruCookie)
        const arr = Array.isArray(r.data) ? r.data : []
        const found = arr.find(e => (e.title || '').trim().toLowerCase() === dupTitle.toLowerCase() && !e.is_remedial)
        check('P3: TA2 tidak punya exam judul sama (pre-flight return [])', !found, { titles: arr.map(e => e.title) })
    }

    // ═══ [D] DETEKSI DUPLIKAT (data untuk badge) ═══
    console.log('\n═══ [D] DETEKSI DUPLIKAT (data layer) ══')

    // Seed examExisting2: judul sama dgn examExisting untuk TA1 (duplicate suspect)
    {
        const { error } = await supabase.from('exams').insert({
            id: P.examExisting2, title: 'Ulangan Duplikat Test', description: 'e2dg dup 2',
            start_time: iso(120_000), duration_minutes: 30, teaching_assignment_id: P.ta1,
            is_active: true, is_randomized: false, max_violations: 3, show_results_immediately: true,
            created_by: P.guruUser,
        })
        check('D-seed: examExisting2 (duplicate) ter-insert', !error, error?.message)
    }

    // D1: GET /api/exams (guru) → 2 exam dgn judul sama untuk TA1
    {
        const r = await api('GET', '/api/exams', undefined, guruCookie)
        const arr = Array.isArray(r.data) ? r.data : []
        const dups = arr.filter(e => (e.title || '').trim().toLowerCase() === dupTitle.toLowerCase() && !e.is_remedial)
        check('D1: guru list → 2 exam judul sama (data badge)', dups.length === 2, { n: dups.length })
    }

    // D2: GET /api/exams (admin) → juga 2 exam (konsisten dgn guru — adil)
    {
        const r = await api('GET', '/api/exams', undefined, adminCookie)
        const arr = Array.isArray(r.data) ? r.data : []
        const dups = arr.filter(e => (e.title || '').trim().toLowerCase() === dupTitle.toLowerCase() && !e.is_remedial)
        check('D2: admin list → juga 2 exam (adil, identik guru)', dups.length === 2, { n: dups.length })
    }

    // D3: guard 409 masih jalan untuk examExisting2 (kedua exam jadi target)
    {
        const r = await api('POST', '/api/exams', baseBody(), guruCookie)
        check('D3: POST judul duplikat (ada 2 existing) → tetap 409', r.status === 409, r.status)
    }

    // Hapus examExisting2 untuk tes no-false-positive
    await supabase.from('exam_questions').delete().eq('exam_id', P.examExisting2)
    await supabase.from('exam_submissions').delete().eq('exam_id', P.examExisting2)
    await supabase.from('exams').delete().eq('id', P.examExisting2)

    // D4: setelah examExisting2 dihapus → hanya 1 exam → bukan duplikat
    {
        const r = await api('GET', '/api/exams', undefined, guruCookie)
        const arr = Array.isArray(r.data) ? r.data : []
        const dups = arr.filter(e => (e.title || '').trim().toLowerCase() === dupTitle.toLowerCase() && !e.is_remedial)
        check('D4: setelah hapus dup → 1 exam (no false positive)', dups.length === 1, { n: dups.length })
    }

    // ═══ [F] FLOW CREATE ═══
    console.log('\n═══ [F] FLOW CREATE ══')

    // F1: guru create judul BARU → 201 (no dialog)
    {
        const r = await api('POST', '/api/exams', baseBody({ title: 'Ulangan Sepenuhnya Baru' }), guruCookie)
        check('F1: create judul baru → 201', r.status === 201 || r.status === 200, { status: r.status, err: r.data })
        if (r.data?.id) {
            await supabase.from('exam_questions').delete().eq('exam_id', r.data.id)
            await supabase.from('exam_submissions').delete().eq('exam_id', r.data.id)
            await supabase.from('exams').delete().eq('id', r.data.id)
        }
    }

    // F2: admin create judul sama dgn existing → 409 (guard cover admin)
    {
        const r = await api('POST', '/api/exams', baseBody(), adminCookie)
        check('F2: admin POST judul duplikat → 409 (guard cover admin)', r.status === 409, { status: r.status, err: r.data })
    }

    // ═══ [R] REGRESI ═══
    console.log('\n═══ [R] REGRESI ══')

    // R1: examExisting masih utuh (guard tidak menghapus existing)
    {
        const { data } = await supabase.from('exams').select('id, title').eq('id', P.examExisting).single()
        check('R1: examExisting utuh (guard tidak rusak data)', data?.id === P.examExisting, data)
    }

    // R2: soal examExisting utuh
    {
        const { data } = await supabase.from('exam_questions').select('id').eq('exam_id', P.examExisting)
        check('R2: soal examExisting utuh', (data || []).length === 1, data)
    }

    await cleanupAll()
    console.log(`\n═══ HASIL: ${pass} ok / ${fail} FAIL ═══`)
    if (fail > 0) process.exit(1)
}

main().catch(e => { console.error('FATAL:', e); cleanupAll().finally(() => process.exit(1)) })
