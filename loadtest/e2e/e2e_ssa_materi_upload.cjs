/**
 * E2E ALUR UPLOAD MATERI END-TO-END — akun SSA SCHOOL (production DB).
 *
 * Motivasi: laporan guru "materi yang di-upload tidak muncul di siswa".
 * Skrip ini membuktikan (atau membantah) setiap hop jalur upload:
 *  - [1] GURU POST /api/materials/upload → presigned URL R2
 *  - [2] PUT file PDF ke presigned URL (byte persis sama saat dibaca balik)
 *  - [3] URL publik R2 hidup (GET 200, content-type pdf)
 *  - [4] GURU POST /api/materials → row masuk DB (1 row/TA)
 *  - [5] SISWA kelas target GET /api/materials → materi BARU muncul
 *  - [6] SISWA kelas lain → materi TIDAK muncul (isolasi kelas)
 *  - [7] GURU GET /api/materials → materi miliknya muncul
 *
 * Cleanup presisi: hapus row materials (by id dari respons POST), notifikasi
 * uji (by title unik), object R2, dan session uji. Tidak menyentuh data lain.
 *
 * Akun (seed SSA, tahun aktif 2029/2030):
 *   guru = siti.rahma.ssa (Matematika X IPA 1 & X IPA 2)
 *   siswa X IPA 1 = 202990001.ssa, siswa X IPA 2 = 202990005.ssa
 *
 * Jalankan: node loadtest/e2e/e2e_ssa_materi_upload.cjs   (default .env.local = production)
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const { makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb, makeSession } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3102
const BASE = `http://localhost:${PORT}`
const PROBE_TITLE = `E2E-UPLOAD-PROBE ${Date.now()}`

const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
})

// PDF minimal (cukup valid utk roundtrip byte; bukan utk dirender)
const PROBE_PDF = Buffer.from('%PDF-1.4\n%E2E-UPLOAD-PROBE\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF\n', 'utf8')

let server = null
const created = { sessions: [], materialIds: [], r2Keys: [] }
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'ssa').single()
    if (!school) throw new Error('SSA SCHOOL tidak ditemukan — abort.')

    const { data: years } = await supabase.from('academic_years')
        .select('id, name').eq('school_id', school.id).eq('is_active', true)
    if (!years || years.length === 0) throw new Error('SSA tidak punya tahun ajaran aktif — abort.')
    const year = years[0]

    const { data: guruUser } = await supabase.from('users').select('id, username').eq('username', 'siti.rahma.ssa').single()
    const { data: guruTeacher } = await supabase.from('teachers').select('id').eq('user_id', guruUser.id).single()
    const { data: guruTAs } = await supabase.from('teaching_assignments')
        .select('id, class_id, class:classes(name), subject:subjects(name)')
        .eq('teacher_id', guruTeacher.id).eq('academic_year_id', year.id)
    const ta1 = guruTAs.find(t => t.class.name === 'X IPA 1') // kelas target upload
    const { data: siswa1Row } = await supabase.from('students')
        .select('id, nis, class_id, user:users!students_user_id_fkey(id, username)').eq('nis', '202990001').single()
    const { data: siswa2Row } = await supabase.from('students')
        .select('id, nis, class_id, user:users!students_user_id_fkey(id, username)').eq('nis', '202990005').single()
    if (!guruUser || !ta1 || !siswa1Row || !siswa2Row) throw new Error('Fixture seed SSA tidak lengkap — abort.')
    if (siswa1Row.class_id !== ta1.class_id) throw new Error('Siswa 202990001 bukan di kelas TA X IPA 1 — abort (fixture berubah).')

    const tokGuru = await makeSession(supabase, guruUser.id, created)
    const tokSiswa1 = await makeSession(supabase, siswa1Row.user.id, created)
    const tokSiswa2 = await makeSession(supabase, siswa2Row.user.id, created)
    console.log(`fixtures OK — guru ${guruUser.username} (${ta1.subject.name} ${ta1.class.name}), tahun ${year.name}`)

    // ---------- START SERVER (production DB) ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, false)
    const api = makeApi(BASE)
    console.log('server up (production DB terverifikasi)\n')

    // ---------- 1. GURU MINTA PRESIGNED URL ----------
    console.log('[1] GURU POST /api/materials/upload — presigned URL R2')
    const upRes = await api('/api/materials/upload', tokGuru, {
        method: 'POST',
        body: JSON.stringify({ filename: `e2e-probe-${Date.now()}.pdf`, contentType: 'application/pdf' }),
    })
    const up = await upRes.json().catch(() => null)
    check('status 200', upRes.status === 200, `status ${upRes.status}, body: ${JSON.stringify(up).slice(0, 120)}`)
    check('respons berisi signedUrl + publicUrl', !!(up && up.signedUrl && up.publicUrl), up?.path || '')
    if (!up || !up.signedUrl) throw new Error('Tidak bisa lanjut tanpa presigned URL — abort.')
    const r2Key = up.path
    created.r2Keys.push(r2Key)

    // ---------- 2. PUT FILE KE R2 ----------
    console.log('[2] PUT PDF ke presigned URL (jalur yang dipakai browser guru)')
    const putRes = await fetch(up.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: PROBE_PDF,
    })
    check('PUT R2 status 2xx', putRes.status >= 200 && putRes.status < 300, `status ${putRes.status}`)
    if (!(putRes.status >= 200 && putRes.status < 300)) {
        const errBody = await putRes.text().catch(() => '')
        console.log('  PUT error body:', errBody.slice(0, 300))
    }

    // ---------- 3. URL PUBLIK HIDUP ----------
    console.log('[3] GET publicUrl — file bisa diakses siswa')
    const pubRes = await fetch(up.publicUrl, { method: 'GET' })
    const pubBody = pubRes.ok ? Buffer.from(await pubRes.arrayBuffer()) : null
    check('GET 200', pubRes.status === 200, `status ${pubRes.status}`)
    check('byte balik identik (roundtrip)', pubBody && pubBody.equals(PROBE_PDF), pubBody ? `${pubBody.length} bytes` : 'no body')
    check('content-type pdf', (pubRes.headers.get('content-type') || '').includes('pdf'), pubRes.headers.get('content-type') || '')

    // ---------- 4. GURU SIMPAN MATERI ----------
    console.log('[4] GURU POST /api/materials — row materi dibuat')
    const postRes = await api('/api/materials', tokGuru, {
        method: 'POST',
        body: JSON.stringify({
            teaching_assignment_ids: [ta1.id],
            title: PROBE_TITLE,
            description: 'probe e2e — auto-cleanup',
            type: 'PDF',
            content_url: up.publicUrl,
        }),
    })
    const post = await postRes.json().catch(() => null)
    check('status 200', postRes.status === 200, `status ${postRes.status}, body: ${JSON.stringify(post).slice(0, 200)}`)
    check('created >= 1 row', post && post.created >= 1, `created: ${post?.created}`)
    if (post && Array.isArray(post.items)) post.items.forEach(it => created.materialIds.push(it.id))
    if (created.materialIds.length === 0) throw new Error('Materi tidak tercatat — tidak bisa lanjut verifikasi siswa.')

    // ---------- 5. SISWA KELAS TARGET MELIHAT MATERI ----------
    console.log('[5] SISWA X IPA 1 GET /api/materials — materi BARU harus muncul')
    const m1res = await api('/api/materials', tokSiswa1)
    const m1 = await m1res.json().catch(() => null)
    check('GET 200 array', m1res.status === 200 && Array.isArray(m1), `status ${m1res.status}`)
    const mine = Array.isArray(m1) ? m1.find(m => m.title === PROBE_TITLE) : null
    check(`materi baru "${PROBE_TITLE.slice(0, 26)}…" TAMPIL di siswa kelas target`,
        !!mine, mine ? `type ${mine.type}, url ${mine.content_url?.slice(0, 60)}…` : 'TIDAK DITEMUKAN')
    check('embed class.id cocok kelas siswa',
        !!mine && mine.teaching_assignment?.class?.id === siswa1Row.class_id,
        mine?.teaching_assignment?.class?.name || '')

    // ---------- 6. SISWA KELAS LAIN TIDAK MELIHAT ----------
    console.log('[6] SISWA X IPA 2 GET /api/materials — isolasi kelas')
    const m2 = await (await api('/api/materials', tokSiswa2)).json().catch(() => null)
    check('materi probe TIDAK bocor ke kelas lain',
        Array.isArray(m2) && !m2.some(m => m.title === PROBE_TITLE),
        Array.isArray(m2) ? `${m2.length} materi kelasnya sendiri` : '?')

    // ---------- 7. GURU MELIHAT MATERI MILIKNYA ----------
    console.log('[7] GURU GET /api/materials — materi muncul di daftar guru')
    const mg = await (await api('/api/materials', tokGuru)).json().catch(() => null)
    check('materi probe tampil di daftar guru',
        Array.isArray(mg) && mg.some(m => m.title === PROBE_TITLE))

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
    // ---------- CLEANUP Presisi ----------
    let cleanLog = []
    if (created.materialIds.length > 0) {
        const { error } = await supabase.from('materials').delete().in('id', created.materialIds)
        cleanLog.push(error ? `materials GAGAL: ${error.message}` : `${created.materialIds.length} materi uji dihapus`)
    }
    // Notifikasi uji: judul unik + hanya yang dibuat sejak script jalan
    const { data: notifDeleted, error: notifErr } = await supabase.from('notifications')
        .delete().like('title', `%${PROBE_TITLE}%`).select('id')
    cleanLog.push(notifErr ? `notifications GAGAL: ${notifErr.message}` : `${notifDeleted?.length || 0} notifikasi uji dihapus`)
    for (const key of created.r2Keys) {
        try {
            await r2Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
            cleanLog.push(`R2 object dihapus: ${key.slice(0, 50)}…`)
        } catch (e) {
            cleanLog.push(`R2 GAGAL (${key.slice(0, 50)}…): ${e.message}`)
        }
    }
    if (created.sessions.length > 0) {
        const { error } = await supabase.from('sessions').delete().in('token', created.sessions)
        cleanLog.push(error ? `sessions GAGAL: ${error.message}` : `${created.sessions.length} session uji dihapus`)
    }
    console.log('cleanup:', cleanLog.join(' | '))
    if (server) await stopServerSafe(server, BASE)
})
