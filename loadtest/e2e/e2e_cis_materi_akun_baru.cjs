/**
 * E2E UPLOAD MATERI CIS — AKUN BARU (guru + siswa) di production DB.
 *
 * Motivasi: guru SMP CIS melaporkan "materi yang di-upload tidak muncul di
 * siswa". Investigasi data CIS sehat + jalur upload SSA terbukti PASS, jadi
 * skrip ini menguji skenario paling mirip laporan: akun BARU (guru & siswa
 * cis) melakukan alur upload lengkap via login ASLI (bukan session injeksi):
 *  - [SEED]  guru e2e.guru.cis + TA (TIK, kelas 8, tahun aktif 2026/2027)
 *            siswa 262699999.cis (kelas 8) + enrollment ACTIVE
 *  - [1] POST /api/auth/login guru → cookie session asli (bukti bcrypt ok)
 *  - [2] POST /api/auth/login siswa → cookie session asli
 *  - [3] GURU POST /api/materials/upload → presigned R2
 *  - [4] PUT PDF ke R2 (jalur browser guru) + GET publicUrl roundtrip
 *  - [5] GURU POST /api/materials → row masuk DB (kelas 8 asli)
 *  - [6] SISWA GET /api/students?user_id → class_id kelas 8
 *  - [7] SISWA GET /api/materials → MATERI BARU TAMPIL ← inti laporan bug
 *
 * Cleanup presisi via registry ID: notifications → materials → R2 object →
 * student_enrollments → students → teaching_assignments → teachers →
 * users → sessions. 20 siswa asli kelas 8 akan menerima notifikasi
 * "Materi Baru" ±1 menit sebelum dihapus (disetujui user).
 *
 * Jalankan: node loadtest/e2e/e2e_cis_materi_akun_baru.cjs   (.env.local = production)
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const { makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3103
const BASE = `http://localhost:${PORT}`
const PROBE_TITLE = `E2E-CIS-PROBE ${Date.now()}`
const GURU_USERNAME = 'e2e.guru.cis'
const SISWA_NIS = '262699999'
const SISWA_USERNAME = `${SISWA_NIS}.cis`
const GURU_PASSWORD = `E2e-${Date.now()}-cis`
const SISWA_PASSWORD = `E2e-${Date.now()}-sis`

// Fixture CIS (hasil riset production, 7 Sep 2026):
const CIS = '5fdc5b7c-b819-44b8-b3fe-3818b0f519a3'
const YEAR_AKTIF = '9de00e57-ea0e-4490-8226-c353d3847265' // 2026/2027
const KELAS_8 = 'a2d1df47-810d-4ebc-ba16-713f3f4733d6'    // kelas 8 TAHUN AKTIF
const KELAS_8_LAMA = '5e0478e3-d28d-40bc-ac0e-57cc464a3e93' // kelas 8 tahun 2025/2026 (TA rusak nyasar ke sini)
const TIK = '09752602-fd87-412b-9d5d-e7e0b8ef3475' // subject TIK (dari TA TIK kelas 8)

const PROBE_PDF = Buffer.from('%PDF-1.4\n%E2E-CIS-PROBE\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF\n', 'utf8')

const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
})

let server = null
const created = { users: [], teachers: [], tas: [], students: [], enrollments: [], materialIds: [], r2Keys: [], sessions: [] }
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    })
    const cookie = res.headers.get('set-cookie') || ''
    const token = /session_token=([^;]+)/.exec(cookie)?.[1] || null
    return { status: res.status, token, body: await res.text().catch(() => '') }
}

async function main() {
    // ---------- 0. SEED AKUN BARU ----------
    console.log('[SEED] Buat akun guru + siswa CIS baru (production)')
    const guruHash = await bcrypt.hash(GURU_PASSWORD, 10)
    const siswaHash = await bcrypt.hash(SISWA_PASSWORD, 10)

    const { data: guruUser, error: e1 } = await supabase.from('users').insert({
        username: GURU_USERNAME, password_hash: guruHash, full_name: 'E2E Guru CIS (auto-cleanup)',
        role: 'GURU', school_id: CIS, must_change_password: false,
    }).select('id').single()
    if (e1) throw new Error('Seed guru user gagal: ' + e1.message)
    created.users.push(guruUser.id)

    const { data: teacherRow, error: e2 } = await supabase.from('teachers').insert({
        user_id: guruUser.id, nip: `E2E${Date.now()}`, gender: 'L', school_id: CIS,
    }).select('id').single()
    if (e2) throw new Error('Seed teacher gagal: ' + e2.message)
    created.teachers.push(teacherRow.id)

    // TA sengaja dibuat dengan pola BUG PRODUCTION: academic_year_id = tahun
    // aktif TAPI class_id = kelas tahun LAMA (persis 17 TA rusak CIS buatan
    // 8 Juli 2026 — kelas lama & baru bernama sama "8", admin salah pilih).
    const { data: taRow, error: e3 } = await supabase.from('teaching_assignments').insert({
        teacher_id: teacherRow.id, subject_id: TIK, class_id: KELAS_8_LAMA, academic_year_id: YEAR_AKTIF,
    }).select('id').single()
    if (e3) throw new Error('Seed TA gagal: ' + e3.message)
    created.tas.push(taRow.id)

    const { data: siswaUser, error: e4 } = await supabase.from('users').insert({
        username: SISWA_USERNAME, password_hash: siswaHash, full_name: 'E2E Siswa CIS (auto-cleanup)',
        role: 'SISWA', school_id: CIS, must_change_password: false,
    }).select('id').single()
    if (e4) throw new Error('Seed siswa user gagal: ' + e4.message)
    created.users.push(siswaUser.id)

    const { data: studentRow, error: e5 } = await supabase.from('students').insert({
        user_id: siswaUser.id, nis: SISWA_NIS, class_id: KELAS_8, school_id: CIS,
        gender: 'L', angkatan: '2026', status: 'ACTIVE',
    }).select('id').single()
    if (e5) throw new Error('Seed student gagal: ' + e5.message)
    created.students.push(studentRow.id)

    const { error: e6 } = await supabase.from('student_enrollments').insert({
        student_id: studentRow.id, class_id: KELAS_8, academic_year_id: YEAR_AKTIF, status: 'ACTIVE',
    })
    if (e6) throw new Error('Seed enrollment gagal: ' + e6.message)
    created.enrollments.push(`${studentRow.id}`)

    console.log(`fixtures OK — guru ${GURU_USERNAME} (TIK kelas 8), siswa ${SISWA_USERNAME} (kelas 8)`)

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, false)
    const api = makeApi(BASE)
    console.log('server up (production DB terverifikasi)\n')

    // ---------- 1. LOGIN GURU ----------
    console.log('[1] GURU login asli (bcrypt)')
    const lg = await login(BASE, GURU_USERNAME, GURU_PASSWORD)
    check('login guru 200 + session token', lg.status === 200 && !!lg.token, `status ${lg.status}`)
    if (lg.token) created.sessions.push(lg.token)
    if (!lg.token) throw new Error('Login guru gagal — tidak bisa lanjut. Body: ' + lg.body.slice(0, 200))

    // ---------- 2. LOGIN SISWA ----------
    console.log('[2] SISWA login asli (bcrypt)')
    const ls = await login(BASE, SISWA_USERNAME, SISWA_PASSWORD)
    check('login siswa 200 + session token', ls.status === 200 && !!ls.token, `status ${ls.status}`)
    if (ls.token) created.sessions.push(ls.token)
    if (!ls.token) throw new Error('Login siswa gagal — tidak bisa lanjut. Body: ' + ls.body.slice(0, 200))

    // ---------- 3. PRESIGNED URL ----------
    console.log('[3] GURU POST /api/materials/upload — presigned R2')
    const upRes = await api('/api/materials/upload', lg.token, {
        method: 'POST',
        body: JSON.stringify({ filename: `e2e-cis-probe-${Date.now()}.pdf`, contentType: 'application/pdf' }),
    })
    const up = await upRes.json().catch(() => null)
    check('status 200 + signedUrl + publicUrl', upRes.status === 200 && !!(up && up.signedUrl && up.publicUrl),
        `status ${upRes.status}, path ${up?.path || '?'}`)
    if (!up || !up.signedUrl) throw new Error('Tidak dapat presigned URL — abort.')
    created.r2Keys.push(up.path)

    // ---------- 4. PUT + ROUNDTRIP R2 ----------
    console.log('[4] PUT PDF ke R2 + GET publicUrl roundtrip')
    const putRes = await fetch(up.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: PROBE_PDF,
    })
    check('PUT R2 2xx', putRes.status >= 200 && putRes.status < 300, `status ${putRes.status}`)
    const pubRes = await fetch(up.publicUrl)
    const pubBody = pubRes.ok ? Buffer.from(await pubRes.arrayBuffer()) : null
    check('GET publicUrl 200 + byte identik', pubRes.status === 200 && pubBody && pubBody.equals(PROBE_PDF),
        `status ${pubRes.status}`)

    // ---------- 5. SIMPAN MATERI ----------
    console.log('[5] GURU POST /api/materials — row ke kelas 8 (asli)')
    const postRes = await api('/api/materials', lg.token, {
        method: 'POST',
        body: JSON.stringify({
            teaching_assignment_ids: [taRow.id],
            title: PROBE_TITLE,
            description: 'probe e2e cis — auto-cleanup',
            type: 'PDF',
            content_url: up.publicUrl,
        }),
    })
    const post = await postRes.json().catch(() => null)
    check('status 200 + created >= 1', postRes.status === 200 && post && post.created >= 1,
        `status ${postRes.status}, created ${post?.created}`)
    if (post && Array.isArray(post.items)) post.items.forEach(it => created.materialIds.push(it.id))
    if (created.materialIds.length === 0) throw new Error('Materi tidak tercatat — abort.')

    // ---------- 6. SISWA: DATA DIRI ----------
    console.log('[6] SISWA /api/students?user_id — data diri + class kelas 8')
    const stRes = await api(`/api/students?user_id=${siswaUser.id}`, ls.token)
    const st = await stRes.json().catch(() => null)
    const myRow = Array.isArray(st) && st.find(s => s.user?.id === siswaUser.id)
    check('1 baris data sendiri + class_id kelas 8',
        !!myRow && myRow.class_id === KELAS_8 && myRow.class?.id === KELAS_8,
        myRow ? `class: ${myRow.class?.name}` : `dapat ${Array.isArray(st) ? st.length : '?'} baris`)

    // ---------- 7. SISWA: MATERI BARU TAMPIL? ----------
    console.log('[7] SISWA /api/materials — TA nyasar ke kelas tahun lama (REPRO BUG)')
    const mRes = await api('/api/materials', ls.token)
    const m = await mRes.json().catch(() => null)
    check('GET 200 array', mRes.status === 200 && Array.isArray(m), `status ${mRes.status}`)
    const mine = Array.isArray(m) ? m.find(x => x.title === PROBE_TITLE) : null
    check('BUG TERREPRODUKSI: materi TIDAK tampil di siswa (TA → kelas tahun lama)',
        !mine,
        mine ? 'ANEH: materi muncul (bug tidak terjadi?)' : 'ya, materi hilang dari view siswa — sama seperti laporan guru')

    // ---------- 8. SIMULASI FIX DATA: re-point class_id TA ke kelas tahun aktif ----------
    console.log('[8] FIX DATA: TA.class_id kelas lama → kelas tahun aktif')
    const { error: fixErr } = await supabase.from('teaching_assignments')
        .update({ class_id: KELAS_8 })
        .eq('id', taRow.id)
    check('update TA class_id sukses', !fixErr, fixErr?.message || '')

    const m2Res = await api('/api/materials', ls.token)
    const m2 = await m2Res.json().catch(() => null)
    const mine2 = Array.isArray(m2) ? m2.find(x => x.title === PROBE_TITLE) : null
    check('FIX TERBUKTI: materi yang sama kini TAMPIL di siswa kelas 8',
        !!mine2,
        mine2 ? `${mine2.type}, class ${mine2.teaching_assignment?.class?.name}` : 'TIDAK DITEMUKAN')
    check('embed class.id kini === class_id siswa (kelas tahun aktif)',
        !!mine2 && mine2.teaching_assignment?.class?.id === KELAS_8,
        mine2?.teaching_assignment?.class?.name || '')

    // ---------- RINGKASAN ----------
    const failed = results.filter(r => !r.ok)
    console.log(`\n${failed.length === 0 ? 'SEMUA PASS' : 'ADA KEGAGALAN'} — ${results.length - failed.length}/${results.length} check lulus`)
    if (failed.length > 0) {
        failed.forEach(f => console.log(`  FAIL: ${f.name} ${f.detail}`))
        process.exitCode = 1
    }
}

main().catch(err => {
    console.error('E2E ERROR:', err.message)
    process.exitCode = 1
}).finally(async () => {
    // ---------- CLEANUP Presisi (urutan: anak dulu, induk belakangan) ----------
    const log = []
    const { data: nd, error: ne } = await supabase.from('notifications')
        .delete().like('title', `%${PROBE_TITLE}%`).select('id')
    log.push(ne ? `notifications GAGAL: ${ne.message}` : `${nd?.length || 0} notif dihapus`)
    if (created.materialIds.length > 0) {
        const { error } = await supabase.from('materials').delete().in('id', created.materialIds)
        log.push(error ? `materials GAGAL: ${error.message}` : `${created.materialIds.length} materi dihapus`)
    }
    for (const key of created.r2Keys) {
        try {
            await r2Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
            log.push(`R2 dihapus`)
        } catch (e) { log.push(`R2 GAGAL: ${e.message}`) }
    }
    if (created.enrollments.length > 0) {
        const { error } = await supabase.from('student_enrollments').delete().in('student_id', created.enrollments)
        log.push(error ? `enrollments GAGAL: ${error.message}` : `${created.enrollments.length} enrollment dihapus`)
    }
    if (created.students.length > 0) {
        const { error } = await supabase.from('students').delete().in('id', created.students)
        log.push(error ? `students GAGAL: ${error.message}` : `${created.students.length} student dihapus`)
    }
    if (created.tas.length > 0) {
        const { error } = await supabase.from('teaching_assignments').delete().in('id', created.tas)
        log.push(error ? `TAs GAGAL: ${error.message}` : `${created.tas.length} TA dihapus`)
    }
    if (created.teachers.length > 0) {
        const { error } = await supabase.from('teachers').delete().in('id', created.teachers)
        log.push(error ? `teachers GAGAL: ${error.message}` : `${created.teachers.length} teacher dihapus`)
    }
    if (created.users.length > 0) {
        const { error } = await supabase.from('users').delete().in('id', created.users)
        log.push(error ? `users GAGAL: ${error.message}` : `${created.users.length} user dihapus`)
    }
    if (created.sessions.length > 0) {
        const { error } = await supabase.from('sessions').delete().in('token', created.sessions)
        log.push(error ? `sessions GAGAL: ${error.message}` : `${created.sessions.length} session dihapus`)
    }
    console.log('cleanup:', log.join(' | '))
    if (server) await stopServerSafe(server, BASE)
})
