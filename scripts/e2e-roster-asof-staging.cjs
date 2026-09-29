/**
 * E2E staging: atribusi kelas historis di GET /api/students?as_of= (fix panel
 * "Belum Mengerjakan" menampilkan siswa yang sudah pindah kelas).
 *
 * Bug asli (Kaila 29 Sep 2026): panel "N Siswa Belum Mengerjakan" di halaman
 * detail ujian memanggil /api/students?class_id&enrollment_year_id TANPA logika
 * interval — baris enrollment TRANSFERRED_OUT (riwayat kelas lama, tahun aktif)
 * lolos filter → siswa pindah kelas dianggap anggota kelas lamanya dan muncul
 * sebagai "belum mengerjakan" di ujian yang bahkan tidak menarget kelas barunya.
 * Monitor Live tidak terdampak (sudah pakai enrollmentClassAt sejak fix 24 Sep).
 *
 * Fix: param as_of (ISO) di /api/students → pilih SATU interval per siswa yang
 * berlaku pada waktu itu via enrollmentClassAt. Call-site panel + modal remedial
 * mengirim as_of = start_time ujian / available_from kuis. Bonus: PUT
 * /api/students/[id] dengan perubahan class_id kini lewat RPC
 * move_student_to_class (menutup sumber drift class_id-vs-enrollment).
 *
 * Fixture: 2 kelas e2ra + 3 siswa (A, B, C) di STAGING SCHOOL:
 *   - A: anggota Kelas 1 sejak T0 — dipindah ke Kelas 2 via RPC (kasus Kaila)
 *   - B: anggota Kelas 1 sejak T0 — kontrol, tidak pernah pindah
 *   - C: pindah Kelas 1→Kelas 2 SEBELUM titik ujian (interval tertutup yang
 *         menutupi titik ujian di kelas lama = kasus historis sah)
 *
 * Timeline (deterministik, UTC):
 *   T0 (1 Sep)   : A, B, C enroll Kelas 1 (ACTIVE)
 *   T1 (10 Sep)  : C pindah ke Kelas 2 (baris 1 ditutup PROMOTED)
 *   T2 (20 Sep)  : TITIK UJIAN (as_of utk panel historis)
 *   T3 (sekarang): A dipindah via RPC ke Kelas 2 (kasus Kaila live)
 *
 * Seksi:
 *   [S] Seed fixture (kelas, users, students, enrollments) + login admin.
 *   [P] as_of=T2: Kelas 1 = {A, B} (interval A masih buka di T2, C sudah
 *       tertutup); Kelas 2 = {C}. Historis benar MESKI A sudah pindah sekarang.
 *   [G] as_of=setelah pindah (pasca RPC): Kelas 1 = {B} — A TIDAK muncul (bug
 *       Kaila tertutup); Kelas 2 = {A, C}.
 *   [C] Tanpa as_of: Kelas 1 masih memuat A & C (perilaku lama dipertahankan —
 *       kontrak kenaikan-kelas/tahun-ajaran yang butuh seluruh riwayat).
 *   [K] status=ACTIVE tanpa as_of: A terhitung TEPAT di satu kelas (Kelas 2).
 *   [U] PUT /api/students/:id pindah balik A → 200 + rantai interval benar
 *       (Kelas 1 tertutup → Kelas 2 tertutup → Kelas 1 ACTIVE baru, TEPAT SATU
 *       ACTIVE + students.class_id sinkron); PUT class_id='' → 400; PUT tanpa
 *       perubahan kelas (edit nama saja) tetap 200.
 *
 * PRASYARAT:
 *   1. set -a; source .env.staging; set +a; npm run build   (kode fix ter-build)
 *   2. set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   3. ENV_FILE=.env.staging node scripts/e2e-roster-asof-staging.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'E2pg1234!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'

// PFX UUID harus HEX-ONLY (kolom uuid — 'r' tidak valid). Username fixture
// tetap e2ra_* untuk cleanup by prefix.
const PFX = 'e2a00000-0000-4000-8000-'
const CLASS_1 = `${PFX}c00000000001`
const CLASS_2 = `${PFX}c00000000002`
// Siswa A/B/C: user id + student id deterministik (hex-only — kolom uuid)
const ST = {
    A: { user: `${PFX}100000000001`, student: `${PFX}200000000001`, nis: 'e2ra01' },
    B: { user: `${PFX}100000000002`, student: `${PFX}200000000002`, nis: 'e2ra02' },
    C: { user: `${PFX}100000000003`, student: `${PFX}200000000003`, nis: 'e2ra03' },
}

// Timeline deterministik (UTC, ISO tanpa offset → kolom timestamp naive DB)
const T0 = '2026-09-01T00:00:00'
const T1 = '2026-09-10T00:00:00'
const T2 = '2026-09-20T00:00:00' // titik ujian (as_of historis)

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
    // enrollment → students → users (FK-safe); classes fixture terakhir
    for (const key of Object.keys(ST)) {
        await supabase.from('student_enrollments').delete().eq('student_id', ST[key].student)
        await supabase.from('students').delete().eq('id', ST[key].student)
        await supabase.from('sessions').delete().eq('user_id', ST[key].user)
        await supabase.from('users').delete().eq('id', ST[key].user)
    }
    const { data: oldUsers } = await supabase.from('users').select('id').like('username', 'e2ra%')
    for (const u of (oldUsers || [])) {
        const { data: s } = await supabase.from('students').select('id').eq('user_id', u.id).maybeSingle()
        if (s) {
            await supabase.from('student_enrollments').delete().eq('student_id', s.id)
            await supabase.from('students').delete().eq('id', s.id)
        }
        await supabase.from('sessions').delete().eq('user_id', u.id)
        await supabase.from('users').delete().eq('id', u.id)
    }
    await supabase.from('classes').delete().in('id', [CLASS_1, CLASS_2])
}

/** NIS siswa pada respons roster (untuk asersi keanggotaan). */
const nisses = (data) => (Array.isArray(data) ? data : []).map(s => s.nis).sort()

async function main() {
    console.log('═══ SEED ══')
    await cleanupAll()
    const passHash = await bcrypt.hash(PASS, 10)

    const { error: clsErr } = await supabase.from('classes').insert([
        { id: CLASS_1, name: 'e2ra Kelas 1', academic_year_id: YEAR, grade_level: 8, school_level: 'SMP' },
        { id: CLASS_2, name: 'e2ra Kelas 2', academic_year_id: YEAR, grade_level: 8, school_level: 'SMP' },
    ])
    if (clsErr) throw new Error(`seed classes: ${clsErr.message}`)

    const { data: adminU } = await supabase.from('users')
        .insert({ username: 'e2ra_admin', full_name: 'E2RA Admin', password_hash: passHash, role: 'ADMIN', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    if (!adminU) throw new Error('seed admin gagal')

    for (const key of Object.keys(ST)) {
        const { error: uErr } = await supabase.from('users').insert({
            id: ST[key].user, username: `e2ra_siswa_${key.toLowerCase()}`, full_name: `E2RA Siswa ${key}`,
            password_hash: passHash, role: 'SISWA', school_id: SCHOOL, must_change_password: false, is_locked: false,
        })
        if (uErr) throw new Error(`seed user ${key}: ${uErr.message}`)
        const { error: sErr } = await supabase.from('students').insert({
            id: ST[key].student, user_id: ST[key].user, school_id: SCHOOL,
            class_id: CLASS_1, nis: ST[key].nis, status: 'ACTIVE', school_level: 'SMP',
        })
        if (sErr) throw new Error(`seed student ${key}: ${sErr.message}`)
    }

    // Enrollment timeline: A & B tetap di Kelas 1; C pindah ke Kelas 2 di T1
    const { error: eErr } = await supabase.from('student_enrollments').insert([
        { student_id: ST.A.student, class_id: CLASS_1, academic_year_id: YEAR, status: 'ACTIVE', enrolled_at: T0 },
        { student_id: ST.B.student, class_id: CLASS_1, academic_year_id: YEAR, status: 'ACTIVE', enrolled_at: T0 },
        // C: dua baris — interval Kelas 1 [T0, T1) PROMOTED + Kelas 2 [T1, ∞) ACTIVE
        { student_id: ST.C.student, class_id: CLASS_1, academic_year_id: YEAR, status: 'PROMOTED', enrolled_at: T0, ended_at: T1 },
        { student_id: ST.C.student, class_id: CLASS_2, academic_year_id: YEAR, status: 'ACTIVE', enrolled_at: T1 },
    ])
    if (eErr) throw new Error(`seed enrollments: ${eErr.message}`)
    console.log('seed 2 kelas + admin + 3 siswa (A kontrol-pindah, B tetap, C pindah pra-ujian)')

    const admin = await login('e2ra_admin')
    const q = (p) => `/api/students?class_id=${p.cls}&enrollment_year_id=${YEAR}${p.extra || ''}`
    const roster = async (cls, extra) => (await api(q({ cls, extra }), admin)).data

    // ═══ [P] Historis: as_of = T2 (titik ujian) ═══
    console.log('\n═══ [P] as_of=T2 (titik ujian historis) ══')
    {
        const k1 = await roster(CLASS_1, `&as_of=${encodeURIComponent(T2 + 'Z')}`)
        const k2 = await roster(CLASS_2, `&as_of=${encodeURIComponent(T2 + 'Z')}`)
        check('Kelas 1 saat T2 = {A, B} — C sudah pindah, intervalnya tertutup',
            JSON.stringify(nisses(k1)) === JSON.stringify([ST.A.nis, ST.B.nis]), nisses(k1))
        check('Kelas 2 saat T2 = {C} — C tercatat di kelas barunya',
            JSON.stringify(nisses(k2)) === JSON.stringify([ST.C.nis]), nisses(k2))
    }

    // ═══ [G] Pindahkan A via RPC (kasus Kaila) lalu as_of "setelah pindah" ═══
    console.log('\n═══ [G] pasca RPC move A → Kelas 2, as_of=setelah pindah (bug Kaila) ══')
    {
        const { error: rpcErr } = await supabase.rpc('move_student_to_class', {
            p_student_id: ST.A.student, p_to_class_id: CLASS_2, p_school_id: SCHOOL, p_notes: 'e2ra move A',
        })
        check('RPC move_student_to_class A → Kelas 2 sukses', !rpcErr, rpcErr?.message)

        // as_of = sekarang + 2 mnt: deterministik "setelah pindah" (jam laptop vs
        // jam DB bisa meleset ±1 dtk — as_of=now persis berbalapan dengan
        // ended_at baris yang baru ditutup RPC). Interval ACTIVE terbuka ke ∞,
        // jadi t masa depan tetap cocok untuk anggota sekarang.
        const afterMove = encodeURIComponent(new Date(Date.now() + 120000).toISOString())
        const k1 = await roster(CLASS_1, `&as_of=${afterMove}`)
        const k2 = await roster(CLASS_2, `&as_of=${afterMove}`)
        check('Kelas 1 setelah pindah = {B} — A (TRANSFERRED_OUT) TIDAK muncul (ghost hilang)',
            JSON.stringify(nisses(k1)) === JSON.stringify([ST.B.nis]), nisses(k1))
        check('Kelas 2 setelah pindah = {A, C}',
            JSON.stringify(nisses(k2)) === JSON.stringify([ST.A.nis, ST.C.nis]), nisses(k2))
    }

    // ═══ [C] Tanpa as_of: perilaku lama dipertaharkan ═══
    console.log('\n═══ [C] tanpa as_of (kontrak kenaikan-kelas/tahun-ajaran) ══')
    {
        const k1 = await roster(CLASS_1)
        const k2 = await roster(CLASS_2)
        // Kelas 1: baris A (TRANSFERRED_OUT) + B (ACTIVE) + C (PROMOTED) = 3 baris
        check('Kelas 1 tanpa as_of masih memuat riwayat A & C (perilaku lama)',
            JSON.stringify(nisses(k1)) === JSON.stringify([ST.A.nis, ST.B.nis, ST.C.nis]), nisses(k1))
        check('Kelas 2 tanpa as_of = {A, C}',
            JSON.stringify(nisses(k2)) === JSON.stringify([ST.A.nis, ST.C.nis]), nisses(k2))
    }

    // ═══ [K] status=ACTIVE: A terhitung tepat satu kelas ═══
    console.log('\n═══ [K] status=ACTIVE (hitungan anggota sekarang) ══')
    {
        const k1 = await roster(CLASS_1, '&status=ACTIVE')
        const k2 = await roster(CLASS_2, '&status=ACTIVE')
        check('Kelas 1 ACTIVE = {B}',
            JSON.stringify(nisses(k1)) === JSON.stringify([ST.B.nis]), nisses(k1))
        check('Kelas 2 ACTIVE = {A, C} — A terhitung TEPAT satu kelas',
            JSON.stringify(nisses(k2)) === JSON.stringify([ST.A.nis, ST.C.nis]), nisses(k2))
    }

    // ═══ [U] PUT /api/students/:id — pindah kelas via RPC + jalur negatif ═══
    console.log('\n═══ [U] PUT /api/students/:id (hardening RPC) ══')
    {
        // U1: edit nama TANPA sentuh class_id — jalur normal tak regresi
        const r1 = await api(`/api/students/${ST.A.student}`, admin, 'PUT', { full_name: 'E2RA Siswa A (rename)' })
        check('PUT edit nama tanpa class_id → 200', r1.status === 200, r1)

        // U2: pindah balik A → Kelas 1 via PUT (dulu: tulis class_id mentah)
        const r2 = await api(`/api/students/${ST.A.student}`, admin, 'PUT', { class_id: CLASS_1 })
        check('PUT pindah kelas A → Kelas 1 → 200', r2.status === 200, r2)
        const { data: aRows } = await supabase.from('student_enrollments')
            .select('class_id, status, ended_at').eq('student_id', ST.A.student).order('enrolled_at')
        // Roundtrip A→Kelas2→Kelas1: rantai interval bersih =
        //   Kelas 1 [T0, move1) TRANSFERRED_OUT → Kelas 2 [move1, move2) TRANSFERRED_OUT
        //   → Kelas 1 [move2, ∞) ACTIVE. 3 baris, TEPAT SATU ACTIVE.
        const k1Rows = (aRows || []).filter(r => r.class_id === CLASS_1)
        const k2Rows = (aRows || []).filter(r => r.class_id === CLASS_2)
        check('Rantai interval: 3 baris (2 tertutup + 1 ACTIVE baru)',
            aRows?.length === 3
            && k1Rows.length === 2 && k2Rows.length === 1
            && k1Rows.filter(r => r.status === 'ACTIVE').length === 1
            && k1Rows.filter(r => r.status === 'TRANSFERRED_OUT').every(r => !!r.ended_at)
            && k2Rows[0]?.status === 'TRANSFERRED_OUT' && !!k2Rows[0]?.ended_at,
            aRows)
        const { data: aStudent } = await supabase.from('students').select('class_id').eq('id', ST.A.student).single()
        check('students.class_id sinkron ke Kelas 1', aStudent?.class_id === CLASS_1, aStudent)

        // U3: class_id kosong → 400 (bukan mengosongkan kelas diam-diam)
        const r3 = await api(`/api/students/${ST.A.student}`, admin, 'PUT', { class_id: '' })
        check('PUT class_id="" → 400 dengan pesan', r3.status === 400 && !!r3.data?.error, r3)

        // U4: kelas tujuan di luar sekolah → 400 (tenant guard)
        const r4 = await api(`/api/students/${ST.A.student}`, admin, 'PUT', { class_id: '00000000-0000-0000-0000-000000000000' })
        check('PUT class_id sekolah lain/tak dikenal → 400', r4.status === 400, r4)
    }

    console.log(`\n═══ HASIL: ${pass} pass, ${fail} fail ══`)
    await cleanupAll()
    console.log('cleanup selesai')
    process.exit(fail > 0 ? 1 : 0)
}

main().catch(async (e) => {
    console.error('FATAL:', e)
    await cleanupAll()
    process.exit(1)
})
