/**
 * E2E SMOKE SUITE FITUR — verifikasi area yang belum punya test otomatis,
 * khususnya yang terdampak perubahan sesi ini (RLS lockdown, service-key strict,
 * storagePublicUrl) DAN perubahan user yang belum di-commit (reset attempt
 * guru dari monitor live + otorisasi canTeachStudentSubmission).
 *
 * Skenario (fixture mandiri STG01, dibersihkan di akhir):
 *  [1]  Login per role via /api/auth/login (password fixture nyata, bcrypt)
 *  [2]  Materi rantai penuh: sign upload → PUT R2 (presigned) → create → scope kelas
 *       siswa & TA guru → public URL → DELETE → hilang + object R2 ikut terhapus
 *  [2g] Guard file-bersama: 2 materi 1 content_url — hapus 1 file tetap hidup,
 *       hapus semua baru file terhapus
 *  [3]  Upload presign R2: tugas siswa + audio + gambar soal (sign JSON → PUT
 *       langsung ke R2; role guard + validasi MIME paritas route lama)
 *  [3d] Sanitasi ekstensi jahat → key R2 tetap bersih
 *  [3e] Logo sekolah: upload R2 server-side → URL BARU per upload (anti
 *       stale-cache CDN) → object lama terhapus + schools.logo_url ter-update
 *  [3f] Passage: audio R2 → PUT ganti audio (object lama terhapus) → DELETE
 *       passage (audio terhapus) + IDOR guard guru lain → 403
 *  [4]  Jadwal: admin POST schedule+entries → siswa GET student-schedule scoped
 *  [5]  Bank soal: guru POST → GET scope → PUT edit → DELETE
 *  [6]  Pengumuman: admin POST → siswa GET
 *  [7]  Grading UTS/UAS manual: PUT official-exam-submissions/[id] grades
 *  [8]  RESET ATTEMPT (kode user, belum di-commit): monitor kirim submission_id;
 *       GURU soft reset (ulangan & official) → is_submitted=false, jawaban tetap;
 *       GURU hard reset → jawaban terhapus + timer_override_until;
 *       GURU kelas salah → 403; ADMIN reset → 200
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_smoke_features.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3100
const BASE = `http://localhost:${PORT}`

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], materials: [], quizzes: [], questions: [],
    submissions: [], enrollments: [], notifications: [], schools: [],
    exams: [], examQuestions: [], examSubmissions: [], examAnswers: [],
    officialExams: [], officialQuestions: [], officialSubmissions: [], officialAnswers: [],
    schedules: [], announcements: [], questionBank: [], passages: [],
    r2Keys: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * GET public URL R2 dengan retry untuk 524/timeout transient (edge Cloudflare
 * sesekali timeout padahal object ada — terbukti saat pengembangan). 4xx tidak
 * di-retry: 404 = object memang hilang (jawaban final). Return status akhir.
 *
 * Ini membuat asersi deterministik:
 *  - "alive"  : pubStatus(url) === 200
 *  - "terhapus": pubStatus(url) === 404 (bukan sekadar !== 200 — 524 sesaat
 *    tidak boleh dihitung sebagai "terhapus")
 */
async function pubStatus(url, tries = 3) {
    let last = 0
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url)
            if (res.status < 500) return res.status
            last = res.status
        } catch (e) {
            last = 0 // network error — treat seperti transient
        }
        if (i < tries - 1) await sleep(700)
    }
    return last
}

async function main() {
    const runId = Date.now() % 100000
    const U = `smk_${runId}`
    const PASS = 'Smoke-Test-123'
    const passHash = bcrypt.hashSync(PASS, 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} Mapel`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    // Guru utama (mengajar kelas A), guru asing (mengajar kelas B)
    const mkGuru = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} ${label}`, password_hash: passHash, role: 'GURU', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const t = await mustInsert(supabase, 'teachers', { user_id: u.id, school_id: school.id }, `teacher ${label}`)
        created.teachers.push(t.id)
        return { user: u, teacher: t }
    }
    const guruA = await mkGuru('guruA')
    const guruB = await mkGuru('guruB')

    const adminUser = await mustInsert(supabase, 'users', { username: `${U}_admin`, full_name: `${U} Admin`, password_hash: passHash, role: 'ADMIN', school_id: school.id }, 'user admin')
    created.users.push(adminUser.id)

    const classA = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class A')
    const classB = await mustInsert(supabase, 'classes', { name: `${U} 9B`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class B')
    created.classes.push(classA.id, classB.id)

    const taA = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruA.teacher.id, class_id: classA.id, subject_id: subject.id, academic_year_id: year.id }, 'TA A')
    const taB = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruB.teacher.id, class_id: classB.id, subject_id: subject.id, academic_year_id: year.id }, 'TA B')
    created.tas.push(taA.id, taB.id)

    const mkStudent = async (label, cls) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} Siswa ${label.toUpperCase()}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}${label}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        return { user: u, student: st }
    }
    const siswaA = await mkStudent('sa', classA) // kelas guru A
    const siswaB = await mkStudent('sb', classB) // kelas guru B

    console.log('fixtures OK (admin, 2 guru beda kelas, 2 siswa, 2 TA)')

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ════════ [1] LOGIN PER ROLE ════════
    console.log('[1] Login via /api/auth/login (route belum pernah teruji e2e)')
    const doLogin = async (username) => {
        const r = await fetch(BASE + '/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: PASS }),
        })
        const b = await r.json().catch(() => null)
        // token dikirim via Set-Cookie httpOnly — ambil dari header
        const setCookie = r.headers.getSetCookie?.() || []
        const tokenCookie = setCookie.map(c => c.split(';')[0]).find(c => c.startsWith('session_token='))
        const token = tokenCookie ? tokenCookie.split('=')[1] : null
        return { status: r.status, body: b, token }
    }
    for (const [label, username, role] of [
        ['guru A', `${U}_guruA`, 'GURU'], ['siswa A', `${U}_sa`, 'SISWA'], ['admin', `${U}_admin`, 'ADMIN'],
    ]) {
        const { status, body, token } = await doLogin(username)
        check(`login ${label} → 200 + role ${role} + cookie session`, status === 200 && body?.user?.role === role && !!token,
            `status ${status}, role=${body?.user?.role}, cookie=${token ? 'ada' : 'HILANG'}`)
        if (token) created.sessions.push(token)
    }
    const wrongLogin = await fetch(BASE + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `${U}_sa`, password: 'salah-total' }),
    })
    check('login password salah → 401', wrongLogin.status === 401, `status ${wrongLogin.status}`)

    // Session via login cookie dipakai untuk sisa suite.
    const tokGuruA = (await doLogin(`${U}_guruA`)).token
    const tokSiswaA = (await doLogin(`${U}_sa`)).token
    const tokAdmin = (await doLogin(`${U}_admin`)).token
    created.sessions.push(tokGuruA, tokSiswaA, tokAdmin)
    const tokGuruB = (await mustInsert(supabase, 'sessions', { user_id: guruB.user.id, token: `${U}_tok_guruB`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session guruB')).token
    created.sessions.push(tokGuruB)

    // ════════ [2] MATERI RANTAI PENUH ════════
    console.log('[2] Materi: sign upload → PUT R2 → create → scope → public URL → delete')
    // 2a. Sign upload (guru A) — materi upload baru via presigned PUT ke Cloudflare R2
    const signRes = await api('/api/materials/upload', tokGuruA, {
        method: 'POST', body: JSON.stringify({ filename: 'smoke materi uji.pdf', contentType: 'application/pdf' }),
    })
    const sign = await signRes.json().catch(() => null)
    check('POST /api/materials/upload sign → 200 + signedUrl R2', signRes.status === 200 && !!sign?.signedUrl, `status ${signRes.status}`)
    // 2b. PUT file ke R2 (paritas perilaku browser: PUT signedUrl + Content-Type)
    let putOk = false, publicOk = false
    if (sign?.signedUrl) {
        try {
            const put = await fetch(sign.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-smoke-materi') })
            putOk = put.status === 200
            check('PUT file ke R2 (presigned URL) → 200', putOk, `status ${put.status}`)
        } catch (e) {
            check('PUT file ke R2 (presigned URL) → 200', false, `fetch error: ${e.message} | cause: ${e.cause?.message || e.cause?.code || '?'}`)
        }
        if (sign.path) created.r2Keys.push(sign.path)
        const pubStat = await pubStatus(sign.publicUrl)
        publicOk = pubStat === 200
        check('public URL materi R2 bisa dibaca (paritas publicR2Url)', publicOk, `status ${pubStat}`)
    } else {
        check('PUT file ke R2 (presigned URL) → 200', false, 'sign gagal')
        check('public URL materi R2 bisa dibaca (paritas publicR2Url)', false, 'sign gagal')
    }
    // 2c. Create materi untuk kelas A & B (type harus enum: PDF/VIDEO/TEXT/LINK).
    // Respons route = { created: n, items: [...] } (satu baris per TA).
    const matARes = await api('/api/materials', tokGuruA, {
        method: 'POST',
            body: JSON.stringify({ title: `${U} Materi Kelas A`, type: 'PDF', content_url: sign?.publicUrl || 'x', teaching_assignment_id: taA.id }),
    })
    const matAJson = await matARes.json().catch(() => null)
    const matA = Array.isArray(matAJson?.items) ? matAJson.items[0] : (Array.isArray(matAJson) ? matAJson[0] : matAJson)
    check('POST /api/materials (kelas A) → 200', matARes.status === 200 && !!matA?.id, `status ${matARes.status} ${matAJson?.error || ''}`)
    if (matA?.id) created.materials.push(matA.id)
    const matBRes = await api('/api/materials', tokGuruB, {
        method: 'POST',
        body: JSON.stringify({ title: `${U} Materi Kelas B`, type: 'TEXT', content_text: 'isi b', teaching_assignment_id: taB.id }),
    })
    const matBJson = await matBRes.json().catch(() => null)
    const matB = Array.isArray(matBJson?.items) ? matBJson.items[0] : (Array.isArray(matBJson) ? matBJson[0] : matBJson)
    check('POST /api/materials (kelas B, guru B) → 200', matBRes.status === 200 && !!matB?.id, `status ${matBRes.status}`)
    if (matB?.id) created.materials.push(matB.id)
    // 2d. Scope: siswa A hanya lihat materi kelas A
    const matSiswaARes = await api('/api/materials', tokSiswaA)
    const matSiswaA = await matSiswaARes.json().catch(() => null)
    const matSiswaAArr = Array.isArray(matSiswaA) ? matSiswaA : []
    check('GET /api/materials siswa A → 200 array', matSiswaARes.status === 200 && Array.isArray(matSiswaA), `status ${matSiswaARes.status}`)
    const ownCount = matSiswaAArr.filter(m => m.title === `${U} Materi Kelas A`).length
    const leakCount = matSiswaAArr.filter(m => m.title === `${U} Materi Kelas B`).length
    check('siswa A melihat materi kelasnya sendiri', ownCount === 1, `own=${ownCount}`)
    check('siswa A TIDAK melihat materi kelas lain', leakCount === 0, `leak=${leakCount}`)
    check('semua materi siswa A embed class.id (filter client)', matSiswaAArr.every(m => m.teaching_assignment?.class?.id !== undefined))
    // 2e. Guru scope: guru A tidak melihat materi TA guru B
    const matGuruA = await (await api('/api/materials', tokGuruA)).json().catch(() => null)
    check('guru A tidak melihat materi TA guru B', (Array.isArray(matGuruA) ? matGuruA : []).every(m => m.teaching_assignment?.id !== taB.id))
    // 2f. DELETE → hilang dari daftar siswa + file R2 ikut terhapus (cleanup)
    if (matA?.id) {
        const delRes = await api(`/api/materials/${matA.id}`, tokGuruA, { method: 'DELETE' })
        check('DELETE /api/materials/[id] → 200', delRes.status === 200, `status ${delRes.status}`)
        const after = await (await api('/api/materials', tokSiswaA)).json().catch(() => null)
        check('materi terhapus hilang dari daftar siswa', !(Array.isArray(after) ? after : []).some(m => m.id === matA.id))
        // Cleanup file PDF: object R2 dihapus route → origin 404.
        // Query param = cache key unik → bypass cache edge Cloudflare
        // (custom domain R2 di-cache per ekstensi; fetch 2b tadi mengisi cache).
        if (sign?.publicUrl && putOk) {
            const pubAfter = await pubStatus(`${sign.publicUrl}?cek_hapus=${Date.now()}`)
            check('object R2 materi terhapus dari storage (origin mati, bypass cache CDN)', pubAfter === 404, `status ${pubAfter}`)
        }
    }

    // 2g. GUARD FILE-BERSAMA: dua materi menunjuk content_url sama — hapus satu,
    // file TIDAK boleh ikut terhapus (row lain masih memakainya); hapus dua-duanya,
    // file baru terhapus. POST /api/materials menerima content_url arbitrary
    // (duplikat manual sah) — cleanup wajib cek referensi dulu.
    {
        const postMateri = async (tok, title, contentUrl, taId) => {
            const r = await api('/api/materials', tok, {
                method: 'POST',
                body: JSON.stringify({ title, type: 'PDF', content_url: contentUrl, teaching_assignment_id: taId }),
            })
            const j = await r.json().catch(() => null)
            return Array.isArray(j?.items) ? j.items[0] : (Array.isArray(j) ? j[0] : j)
        }
        const signG = await api('/api/materials/upload', tokGuruA, {
            method: 'POST', body: JSON.stringify({ filename: 'materi-bersama.pdf', contentType: 'application/pdf' }),
        })
        const signGBody = await signG.json().catch(() => null)
        let guardUrlOk = false
        if (signGBody?.signedUrl) {
            const putG = await fetch(signGBody.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-bersama') })
            guardUrlOk = putG.status === 200
            created.r2Keys.push(signGBody.path)
        }
        check('2g: upload file bersama → PUT 200', guardUrlOk, `sign=${signG.status}`)
        const matX = await postMateri(tokGuruA, `${U} Materi Bersama 1`, signGBody?.publicUrl, taA.id)
        const matY = await postMateri(tokGuruA, `${U} Materi Bersama 2`, signGBody?.publicUrl, taA.id)
        check('2g: dua materi file sama terbuat', !!matX?.id && !!matY?.id, `x=${!!matX?.id} y=${!!matY?.id}`)
        if (matX?.id) created.materials.push(matX.id)
        if (matY?.id) created.materials.push(matY.id)
        if (matX?.id && matY?.id && signGBody?.publicUrl) {
            const delX = await api(`/api/materials/${matX.id}`, tokGuruA, { method: 'DELETE' })
            check('2g: DELETE materi pertama → 200', delX.status === 200, `status ${delX.status}`)
            const g1 = await pubStatus(`${signGBody.publicUrl}?cek_g1=${Date.now()}`)
            check('2g: file MASIH hidup (dipakai materi kedua — guard jalan)', g1 === 200, `status ${g1}`)
            const delY = await api(`/api/materials/${matY.id}`, tokGuruA, { method: 'DELETE' })
            check('2g: DELETE materi kedua → 200', delY.status === 200, `status ${delY.status}`)
            const g2 = await pubStatus(`${signGBody.publicUrl}?cek_g2=${Date.now()}`)
            check('2g: file terhapus setelah referensi terakhir hilang', g2 === 404, `status ${g2}`)
        }
    }

    // ════════ [3] UPLOAD TUGAS ONLINE + AUDIO (PRESIGN R2) ════════
    console.log('[3] Upload tugas online & audio (presign JSON → PUT R2)')
    // Semua route upload non-materi kini presign (pola /api/materials/upload):
    // client PUT langsung ke R2 — file tidak transit server.
    {
        // 3a. Tugas siswa: sign → PUT → public URL hidup
        const signTugasRes = await api('/api/submissions/upload', tokSiswaA, {
            method: 'POST', body: JSON.stringify({ filename: 'tugas-smoke.jpg', contentType: 'image/jpeg' }),
        })
        const signTugas = await signTugasRes.json().catch(() => null)
        check('POST /api/submissions/upload sign (JSON) → 200 + signedUrl', signTugasRes.status === 200 && !!signTugas?.signedUrl, `status ${signTugasRes.status} ${JSON.stringify(signTugas)?.slice(0, 150)}`)
        if (signTugas?.signedUrl) {
            try {
                const put = await fetch(signTugas.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.from('smoke-tugas-jpg') })
                check('PUT tugas ke R2 (presigned URL) → 200', put.status === 200, `status ${put.status}`)
            } catch (e) {
                check('PUT tugas ke R2 (presigned URL) → 200', false, `fetch error: ${e.message}`)
            }
            const pubTugas = await pubStatus(signTugas.url)
            check('public URL tugas R2 bisa dibaca', pubTugas === 200, `status ${pubTugas}`)
            if (signTugas.path) created.r2Keys.push(signTugas.path)
        }
        // Role guard paritas route lama: GURU tidak boleh presign upload tugas siswa
        const signTugasTolak = await api('/api/submissions/upload', tokGuruA, {
            method: 'POST', body: JSON.stringify({ filename: 'x.jpg', contentType: 'image/jpeg' }),
        })
        check('POST /api/submissions/upload oleh GURU → 401', signTugasTolak.status === 401, `status ${signTugasTolak.status}`)

        // 3b. Audio listening guru: sign → PUT
        const signAudioRes = await api('/api/audio/upload', tokGuruA, {
            method: 'POST', body: JSON.stringify({ filename: 'audio-smoke.mp3', contentType: 'audio/mpeg' }),
        })
        const signAudio = await signAudioRes.json().catch(() => null)
        check('POST /api/audio/upload sign (JSON) → 200 + signedUrl', signAudioRes.status === 200 && !!signAudio?.signedUrl, `status ${signAudioRes.status} ${JSON.stringify(signAudio)?.slice(0, 150)}`)
        if (signAudio?.signedUrl) {
            try {
                const put = await fetch(signAudio.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: Buffer.from('smoke-audio-mp3') })
                check('PUT audio ke R2 (presigned URL) → 200', put.status === 200, `status ${put.status}`)
            } catch (e) {
                check('PUT audio ke R2 (presigned URL) → 200', false, `fetch error: ${e.message}`)
            }
            if (signAudio.path) created.r2Keys.push(signAudio.path)
        }
        // Validasi MIME paritas route lama: tipe tak dikenal ditolak
        const signAudioBad = await api('/api/audio/upload', tokGuruA, {
            method: 'POST', body: JSON.stringify({ filename: 'x.exe', contentType: 'application/x-msdownload' }),
        })
        check('POST /api/audio/upload tipe tak didukung → 400', signAudioBad.status === 400, `status ${signAudioBad.status}`)

        // 3c. Gambar soal: sign → PUT (dipakai uploadQuestionImage untuk
        // QuestionImageUpload / QuestionOptionsEditor / RichTextEditor)
        const signImgRes = await api('/api/questions/upload-image', tokGuruA, {
            method: 'POST', body: JSON.stringify({ filename: 'soal-smoke.jpg', contentType: 'image/jpeg' }),
        })
        const signImg = await signImgRes.json().catch(() => null)
        check('POST /api/questions/upload-image sign (JSON) → 200 + signedUrl', signImgRes.status === 200 && !!signImg?.signedUrl, `status ${signImgRes.status} ${JSON.stringify(signImg)?.slice(0, 150)}`)
        if (signImg?.signedUrl) {
            try {
                const put = await fetch(signImg.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: Buffer.from('smoke-soal-jpg') })
                check('PUT gambar soal ke R2 (presigned URL) → 200', put.status === 200, `status ${put.status}`)
            } catch (e) {
                check('PUT gambar soal ke R2 (presigned URL) → 200', false, `fetch error: ${e.message}`)
            }
            const pubImg = await pubStatus(`${signImg.url}?cek=${Date.now()}`)
            check('public URL gambar soal R2 bisa dibaca', pubImg === 200, `status ${pubImg}`)
            if (signImg.filename) created.r2Keys.push(signImg.filename)
        }
        // Validasi MIME gambar paritas route lama
        const signImgBad = await api('/api/questions/upload-image', tokGuruA, {
            method: 'POST', body: JSON.stringify({ filename: 'x.pdf', contentType: 'application/pdf' }),
        })
        check('POST /api/questions/upload-image tipe non-gambar → 400', signImgBad.status === 400, `status ${signImgBad.status}`)

        // 3d. Sanitasi ekstensi jahat: "file.mp3/x" → key tetap bersih (fallback ext)
        const signJahat = await api('/api/audio/upload', tokGuruA, {
            method: 'POST', body: JSON.stringify({ filename: 'jahat.mp3/../../logos/x', contentType: 'audio/mpeg' }),
        })
        const jahat = await signJahat.json().catch(() => null)
        const jahatBersih = signJahat.status === 200 && !!jahat?.path?.match(/\/audio\/\d+-[a-z0-9]+\.[a-z0-9]{1,8}$/)
        check('ekstensi jahat disanitasi → key R2 bersih', jahatBersih, `path=${jahat?.path}`)
        if (jahat?.path) created.r2Keys.push(jahat.path)
    }

    // ════════ [3e] LOGO SEKOLAH (server-side R2 + anti stale-cache CDN) ════════
    console.log('[3e] Logo sekolah: upload R2 → URL baru per upload → object lama terhapus')
    {
        const schoolFix = await mustInsert(supabase, 'schools', { name: `${U} Logo School`, code: `LG${runId}`, school_level: 'SMP' }, 'school logo fixture')
        created.schools.push(schoolFix.id)

        const superUser = await mustInsert(supabase, 'users', { username: `${U}_super`, full_name: `${U} Super`, password_hash: passHash, role: 'SUPER_ADMIN', school_id: null }, 'user super')
        created.users.push(superUser.id)
        const tokSuper = (await mustInsert(supabase, 'sessions', { user_id: superUser.id, token: `${U}_tok_super`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session super')).token
        created.sessions.push(tokSuper)

        const postLogo = (pngBody) => {
            const fd = new FormData()
            fd.append('logo', new Blob([Buffer.from(pngBody)], { type: 'image/png' }), `logo-${runId}.png`)
            return fetch(`${BASE}/api/schools/${schoolFix.id}/logo`, {
                method: 'POST',
                headers: { Cookie: `session_token=${tokSuper}` },
                body: fd,
            })
        }

        // Upload pertama
        const logo1Res = await postLogo('PNG-logo-1')
        const logo1 = await logo1Res.json().catch(() => null)
        const logo1Ok = logo1Res.status === 200 && !!logo1?.logo_url?.startsWith(process.env.R2_PUBLIC_BASE_URL + '/')
        check('POST logo (SUPER_ADMIN) → 200 + logo_url R2', logo1Ok, `status ${logo1Res.status} ${logo1?.logo_url || ''}`)
        if (logo1?.logo_url) {
            const key = logo1.logo_url.substring((process.env.R2_PUBLIC_BASE_URL + '/').length)
            created.r2Keys.push(decodeURIComponent(key))
            const pubLogo = await pubStatus(`${logo1.logo_url}?cek=${Date.now()}`)
            check('object logo R2 bisa dibaca', pubLogo === 200, `status ${pubLogo}`)
        }

        // Role guard paritas route lama: ADMIN biasa → 403
        const logoTolak = await fetch(`${BASE}/api/schools/${schoolFix.id}/logo`, {
            method: 'POST',
            headers: { Cookie: `session_token=${tokAdmin}` },
            body: (() => { const fd = new FormData(); fd.append('logo', new Blob([Buffer.from('x')], { type: 'image/png' }), 'x.png'); return fd })(),
        })
        check('POST logo oleh ADMIN → 403', logoTolak.status === 403, `status ${logoTolak.status}`)

        // Upload kedua → URL BARU (cache-bust CDN) + object lama dihapus
        const logo2Res = await postLogo('PNG-logo-2')
        const logo2 = await logo2Res.json().catch(() => null)
        check('upload logo kedua → logo_url BARU (anti stale-cache CDN)', logo2Res.status === 200 && !!logo2?.logo_url && logo2.logo_url !== logo1?.logo_url, `status ${logo2Res.status}`)
        if (logo2?.logo_url) {
            const key = logo2.logo_url.substring((process.env.R2_PUBLIC_BASE_URL + '/').length)
            created.r2Keys.push(decodeURIComponent(key))
        }
        // schools.logo_url kini menunjuk logo baru
        const { data: schoolAfter } = await supabase.from('schools').select('logo_url').eq('id', schoolFix.id).single()
        check('schools.logo_url ter-update ke logo baru', schoolAfter?.logo_url === logo2?.logo_url, `db=${schoolAfter?.logo_url?.slice(-20)} resp=${logo2?.logo_url?.slice(-20)}`)
        if (logo1?.logo_url) {
            const pubOld = await pubStatus(`${logo1.logo_url}?cek_hapus=${Date.now()}`)
            check('object logo PERTAMA terhapus dari R2 (origin, bypass cache)', pubOld === 404, `status ${pubOld}`)
        }
    }

    // ════════ [3f] PASSAGES: audio R2 → ganti audio (lama terhapus) → DELETE ════════
    console.log('[3f] Passage: audio R2, replace, delete, IDOR guard, cleanup object')
    {
        const signAudio = async (label) => {
            const r = await api('/api/audio/upload', tokGuruA, {
                method: 'POST', body: JSON.stringify({ filename: `passage-${label}.mp3`, contentType: 'audio/mpeg' }),
            })
            const b = await r.json().catch(() => null)
            if (b?.signedUrl) {
                await fetch(b.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: Buffer.from(`passage-audio-${label}`) })
                if (b.path) created.r2Keys.push(b.path)
            }
            return b
        }
        const audioA = await signAudio('a')
        const audioB = await signAudio('b')
        check('3f: dua audio R2 ter-upload', !!audioA?.url && !!audioB?.url, `a=${!!audioA?.url} b=${!!audioB?.url}`)

        const mkQ = (n) => ({ question_text: `Pertanyaan ${n}`, question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'], correct_answer: 'A' })
        const createRes = await api('/api/passages', tokGuruA, {
            method: 'POST',
            body: JSON.stringify({
                title: `${U} Passage R2`, passage_text: 'Teks bacaan uji cleanup audio R2',
                subject_id: subject.id, audio_url: audioA?.url, questions: [mkQ(1), mkQ(2)],
            }),
        })
        const passage = await createRes.json().catch(() => null)
        check('3f: POST /api/passages (audio R2) → 200', createRes.status === 200 && !!passage?.id, `status ${createRes.status}`)
        if (passage?.id) created.passages.push(passage.id)

        // IDOR: guru B tidak boleh menghapus passage guru A
        if (passage?.id) {
            const idor = await api(`/api/passages?id=${passage.id}`, tokGuruB, { method: 'DELETE' })
            check('3f: DELETE passage oleh guru lain → 403', idor.status === 403, `status ${idor.status}`)
        }

        // Ganti audio → object lama terhapus (cleanup fire-and-forget: beri jeda)
        if (passage?.id) {
            const putRes = await api(`/api/passages?id=${passage.id}`, tokGuruA, {
                method: 'PUT',
                body: JSON.stringify({ title: `${U} Passage R2`, passage_text: 'Teks bacaan uji cleanup audio R2', audio_url: audioB?.url }),
            })
            check('3f: PUT passage ganti audio → 200', putRes.status === 200, `status ${putRes.status}`)
            await sleep(800)
            const aStat = await pubStatus(`${audioA.url}?cek_p1=${Date.now()}`)
            const bStat = await pubStatus(`${audioB.url}?cek_p2=${Date.now()}`)
            check('3f: audio LAMA terhapus dari R2 saat diganti', aStat === 404, `status ${aStat}`)
            check('3f: audio BARU tetap hidup', bStat === 200, `status ${bStat}`)

            const delRes = await api(`/api/passages?id=${passage.id}`, tokGuruA, { method: 'DELETE' })
            check('3f: DELETE passage → 200', delRes.status === 200, `status ${delRes.status}`)
            await sleep(800)
            const bStat2 = await pubStatus(`${audioB.url}?cek_p3=${Date.now()}`)
            check('3f: audio passage terhapus dari R2 saat passage dihapus', bStat2 === 404, `status ${bStat2}`)
        }
    }

    // ════════ [4] JADWAL ════════
    console.log('[4] Jadwal: admin POST → siswa GET student-schedule scoped')
    const schedRes = await api('/api/schedules', tokAdmin, {
        method: 'POST',
        body: JSON.stringify({
            class_id: classA.id, academic_year_id: year.id,
            entries: [{ day_of_week: 1, period: 1, time_start: '07:00', time_end: '07:40', subject_id: subject.id, teacher_id: guruA.teacher.id, room: 'R1' }],
        }),
    })
    const sched = await schedRes.json().catch(() => null)
    check('POST /api/schedules (admin) → 200 + entries', schedRes.status === 200 && !!sched?.id, `status ${schedRes.status} ${sched?.error || ''}`)
    if (sched?.id) created.schedules.push(sched.id)
    const siswaSched = await api('/api/schedules/student-schedule?all=true', tokSiswaA)
    const siswaSchedBody = await siswaSched.json().catch(() => null)
    const schedArr = Array.isArray(siswaSchedBody) ? siswaSchedBody : []
    const hasOwnEntry = schedArr.some(e => e.subject?.name === `${U} Mapel`)
    check('GET /api/schedules/student-schedule siswa A → 200', siswaSched.status === 200, `status ${siswaSched.status}`)
    check('jadwal kelas A terlihat siswa A (mapel fixture)', hasOwnEntry, `entries=${schedArr.length}`)

    // ════════ [5] BANK SOAL ════════
    console.log('[5] Bank soal: guru POST → GET scope → PUT edit → DELETE')
    const qbRes = await api('/api/question-bank', tokGuruA, {
        method: 'POST',
        body: JSON.stringify([{
            subject_id: subject.id, question_text: `${U} Soal bank`, question_type: 'MULTIPLE_CHOICE',
            options: ['a', 'b', 'c', 'd'], correct_answer: 'A', difficulty: 'EASY', tags: ['smoke'],
        }]),
    })
    const qb = await qbRes.json().catch(() => null)
    const qbRow = Array.isArray(qb) ? qb[0] : qb
    check('POST /api/question-bank → 200 + baris', qbRes.status === 200 && !!qbRow?.id, `status ${qbRes.status} ${qb?.error || ''}`)
    if (qbRow?.id) created.questionBank.push(qbRow.id)
    const qbList = await (await api(`/api/question-bank?search=${encodeURIComponent(U)}`, tokGuruA)).json().catch(() => null)
    const qbVisible = Array.isArray(qbList) && qbList.some(q => q.id === qbRow?.id)
    check('GET /api/question-bank menampilkan soal baru', qbVisible, `list=${Array.isArray(qbList) ? qbList.length : '?'}`)
    if (qbRow?.id) {
        const qbEdit = await api(`/api/question-bank`, tokGuruA, {
            method: 'PUT', body: JSON.stringify({ id: qbRow.id, question_text: `${U} Soal bank (edit)`, question_type: 'MULTIPLE_CHOICE', options: ['a', 'b', 'c', 'd'], correct_answer: 'B', difficulty: 'EASY' }),
        })
        check('PUT /api/question-bank edit → 200', qbEdit.status === 200, `status ${qbEdit.status}`)
        const qbDel = await api(`/api/question-bank?id=${qbRow.id}`, tokGuruA, { method: 'DELETE' })
        check('DELETE /api/question-bank → 200', qbDel.status === 200, `status ${qbDel.status}`)
        const qbAfter = await (await api(`/api/question-bank?search=${encodeURIComponent(U)}`, tokGuruA)).json().catch(() => null)
        check('soal bank terhapus', !(qbAfter || []).some(q => q.id === qbRow.id))
    }

    // ════════ [6] PENGUMUMAN ════════
    console.log('[6] Pengumuman: admin POST → siswa GET')
    const annRes = await api('/api/announcements', tokAdmin, {
        method: 'POST', body: JSON.stringify({ title: `${U} Pengumuman`, content: 'isi smoke', is_global: true }),
    })
    const ann = await annRes.json().catch(() => null)
    check('POST /api/announcements → 200/201', [200, 201].includes(annRes.status) && !!ann?.id, `status ${annRes.status} ${ann?.error || ''}`)
    if (ann?.id) created.announcements.push(ann.id)
    const annSiswa = await (await api('/api/announcements', tokSiswaA)).json().catch(() => null)
    const annVisible = Array.isArray(annSiswa) && annSiswa.some(a => a.title === `${U} Pengumuman`)
    check('siswa A melihat pengumuman global', annVisible, `list=${Array.isArray(annSiswa) ? annSiswa.length : '?'}`)

    // ════════ [7] GRADING UTS/UAS MANUAL ════════
    console.log('[7] Grading UTS/UAS manual: PUT official-exam-submissions/[id]')
    {
        const exam = await mustInsert(supabase, 'official_exams', {
            title: `${U} UTS Smoke`, school_id: school.id, subject_id: subject.id, academic_year_id: year.id,
            exam_type: 'UTS', start_time: new Date(Date.now() - 5 * 60e3).toISOString(),
            duration_minutes: 60, is_active: true, is_remedial: false, allowed_student_ids: null,
            target_class_ids: [classA.id], created_by: guruA.user.id,
        }, 'official exam')
        created.officialExams.push(exam.id)
        const q1 = await mustInsert(supabase, 'official_exam_questions', {
            exam_id: exam.id, question_type: 'MULTIPLE_CHOICE', correct_answer: 'A', points: 2,
            question_text: `${U} soal 1`, options: ['opsi A', 'opsi B'], order_index: 1,
        }, 'official q1')
        const q2 = await mustInsert(supabase, 'official_exam_questions', {
            exam_id: exam.id, question_type: 'ESSAY', correct_answer: null, points: 6,
            question_text: `${U} soal essay`, options: null, order_index: 2,
        }, 'official q2')
        created.officialQuestions.push(q1.id, q2.id)
        // siswa A kerjakan: MC benar, essay dijawab
        const sub = await mustInsert(supabase, 'official_exam_submissions', {
            exam_id: exam.id, student_id: siswaA.student.id, started_at: new Date().toISOString(),
            submitted_at: new Date().toISOString(), is_submitted: true, is_graded: false, total_score: 2, max_score: 8,
        }, 'official sub')
        created.officialSubmissions.push(sub.id)
        const a1 = await mustInsert(supabase, 'official_exam_answers', { submission_id: sub.id, question_id: q1.id, answer: 'A', is_correct: true, points_earned: 2 }, 'off ans1')
        const a2 = await mustInsert(supabase, 'official_exam_answers', { submission_id: sub.id, question_id: q2.id, answer: 'esai siswa', is_correct: null, points_earned: 0 }, 'off ans2')
        created.officialAnswers.push(a1.id, a2.id)
        // guru A (mengajar kelas A) grade essay 5
        const gradeRes = await api(`/api/official-exam-submissions/${sub.id}`, tokGuruA, {
            method: 'PUT', body: JSON.stringify({ grades: [{ answer_id: a2.id, points_earned: 5 }] }),
        })
        const graded = await gradeRes.json().catch(() => null)
        check('PUT grading official (guru kelas benar) → 200 + skor 7', gradeRes.status === 200 && graded?.total_score === 7 && graded?.is_graded === true,
            `status ${gradeRes.status}, total=${graded?.total_score}, graded=${graded?.is_graded}`)
        // guru B (TIDAK mengajar kelas A) → 403
        const gradeForbidden = await api(`/api/official-exam-submissions/${sub.id}`, tokGuruB, {
            method: 'PUT', body: JSON.stringify({ grades: [{ answer_id: a2.id, points_earned: 6 }] }),
        })
        check('PUT grading official guru kelas SALAH → 403', gradeForbidden.status === 403, `status ${gradeForbidden.status}`)
    }

    // ════════ [8] RESET ATTEMPT DARI MONITOR (kode user, belum di-commit) ════════
    console.log('[8] Reset attempt guru dari monitor live (kode baru user)')
    {
        // --- Ulangan (exam_*) ---
        const exam = await mustInsert(supabase, 'exams', {
            title: `${U} Ulangan Reset`, start_time: new Date(Date.now() - 5 * 60e3).toISOString(),
            duration_minutes: 60, teaching_assignment_id: taA.id, is_active: true, max_violations: 3, created_by: guruA.user.id,
        }, 'exam reset')
        created.exams.push(exam.id)
        const q = await mustInsert(supabase, 'exam_questions', {
            exam_id: exam.id, question_text: `${U} soal reset`, question_type: 'MULTIPLE_CHOICE',
            options: ['a', 'b'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved',
        }, 'exam reset q')
        created.examQuestions.push(q.id)
        // siswa A sudah submit dengan 1 jawaban
        const sub = await mustInsert(supabase, 'exam_submissions', {
            exam_id: exam.id, student_id: siswaA.student.id, started_at: new Date().toISOString(),
            submitted_at: new Date().toISOString(), is_submitted: true, total_score: 10, max_score: 10,
        }, 'exam reset sub')
        created.examSubmissions.push(sub.id)
        const ans = await mustInsert(supabase, 'exam_answers', { submission_id: sub.id, question_id: q.id, answer: 'A', is_correct: true, points_earned: 10 }, 'exam reset ans')
        created.examAnswers.push(ans.id)

        // 8a. Monitor kirim submission_id (kontrak tombol reset user)
        const mon = await api(`/api/exam-submissions/monitor?exam_id=${exam.id}`, tokGuruA)
        const monBody = await mon.json().catch(() => null)
        const monRow = (monBody?.students || monBody || []).find?.((s) => s.student_id === siswaA.student.id) || null
        check('monitor ulangan → 200 + submission_id ada (kontrak tombol reset)', mon.status === 200 && !!monRow?.submission_id,
            `status ${mon.status}, submission_id=${monRow?.submission_id ? 'ada' : 'HILANG'}`)

        // 8b. GURU A soft reset (kode baru: dulu admin-only) — jawaban tetap
        const softRes = await api('/api/exam-submissions', tokGuruA, {
            method: 'PUT', body: JSON.stringify({ submission_id: sub.id, reset_attempt: 'soft' }),
        })
        const softBody = await softRes.json().catch(() => null)
        check('GURU soft reset ulangan → 200', softRes.status === 200 && softBody?.reset_success === true, `status ${softRes.status} ${softBody?.error || ''}`)
        const afterSoft = await supabase.from('exam_submissions').select('is_submitted, violation_count, total_score').eq('id', sub.id).single()
        const ansAfterSoft = await supabase.from('exam_answers').select('id').eq('submission_id', sub.id)
        check('soft reset: is_submitted=false, jawaban TETAP ada', afterSoft.data?.is_submitted === false && (ansAfterSoft.data || []).length === 1,
            `submitted=${afterSoft.data?.is_submitted}, answers=${ansAfterSoft.data?.length}`)

        // 8c. GURU B (kelas salah) reset → 403 (otorisasi canTeachStudentSubmission)
        const wrongRes = await api('/api/exam-submissions', tokGuruB, {
            method: 'PUT', body: JSON.stringify({ submission_id: sub.id, reset_attempt: 'hard' }),
        })
        check('GURU kelas salah reset ulangan → 403', wrongRes.status === 403, `status ${wrongRes.status}`)

        // submit ulang lalu hard reset oleh GURU A — jawaban terhapus + override timer
        await supabase.from('exam_submissions').update({ is_submitted: true, submitted_at: new Date().toISOString() }).eq('id', sub.id)
        const hardRes = await api('/api/exam-submissions', tokGuruA, {
            method: 'PUT', body: JSON.stringify({ submission_id: sub.id, reset_attempt: 'hard' }),
        })
        const hardBody = await hardRes.json().catch(() => null)
        check('GURU hard reset ulangan → 200', hardRes.status === 200 && hardBody?.reset_success === true, `status ${hardRes.status} ${hardBody?.error || ''}`)
        const afterHard = await supabase.from('exam_submissions').select('is_submitted, timer_override_until, started_at').eq('id', sub.id).single()
        const ansAfterHard = await supabase.from('exam_answers').select('id').eq('submission_id', sub.id)
        check('hard reset: jawaban TERHAPUS + timer_override_until terisi',
            (ansAfterHard.data || []).length === 0 && !!afterHard.data?.timer_override_until && afterHard.data?.is_submitted === false,
            `answers=${ansAfterHard.data?.length}, override=${afterHard.data?.timer_override_until ? 'ada' : 'HILANG'}`)

        // 8d. ADMIN reset (jalur lama) → 200
        await supabase.from('exam_submissions').update({ is_submitted: true, submitted_at: new Date().toISOString() }).eq('id', sub.id)
        const adminRes = await api('/api/exam-submissions', tokAdmin, {
            method: 'PUT', body: JSON.stringify({ submission_id: sub.id, reset_attempt: 'soft' }),
        })
        check('ADMIN soft reset ulangan → 200', adminRes.status === 200, `status ${adminRes.status}`)

        // --- Official (UTS/UAS): jalur resmi yang diubah user ---
        const offExam = created.officialExams[0]
        const offSubId = created.officialSubmissions[0]
        const offMon = await api(`/api/official-exam-submissions/monitor?exam_id=${offExam}`, tokGuruA)
        const offMonBody = await offMon.json().catch(() => null)
        const offMonRow = (offMonBody?.students || offMonBody || []).find?.((s) => s.submission_id === offSubId) || null
        check('monitor official → 200 + submission_id ada (kontrak tombol reset)', offMon.status === 200 && !!offMonRow?.submission_id,
            `status ${offMon.status}`)

        const offSoft = await api('/api/official-exam-submissions', tokGuruA, {
            method: 'PUT', body: JSON.stringify({ submission_id: offSubId, reset_attempt: 'soft' }),
        })
        const offSoftBody = await offSoft.json().catch(() => null)
        check('GURU soft reset official → 200', offSoft.status === 200 && offSoftBody?.reset_success === true, `status ${offSoft.status} ${offSoftBody?.error || ''}`)
        const offAfter = await supabase.from('official_exam_submissions').select('is_submitted, total_score').eq('id', offSubId).single()
        const offAnsAfter = await supabase.from('official_exam_answers').select('id, points_earned').eq('submission_id', offSubId)
        check('soft reset official: is_submitted=false, jawaban & skor tetap',
            offAfter.data?.is_submitted === false && (offAnsAfter.data || []).length === 2,
            `submitted=${offAfter.data?.is_submitted}, answers=${offAnsAfter.data?.length}`)

        const offWrong = await api('/api/official-exam-submissions', tokGuruB, {
            method: 'PUT', body: JSON.stringify({ submission_id: offSubId, reset_attempt: 'soft' }),
        })
        check('GURU kelas salah reset official → 403', offWrong.status === 403, `status ${offWrong.status}`)
    }

    // ════════ [9] ANALITIK ADMIN + JADWAL GURU (role-specific) ════════
    console.log('[9] Analitik admin + jadwal guru sendiri')
    {
        // Admin: analitik nilai kelas (route buat client sendiri — cek shape & no-error)
        const anRes = await api(`/api/analytics/class-grades?academic_year_id=${year.id}`, tokAdmin)
        const anBody = await anRes.json().catch(() => null)
        check('GET /api/analytics/class-grades (admin) → 200', anRes.status === 200, `status ${anRes.status} ${anBody?.error || ''}`)

        // Guru: jadwal sendiri (dipakai beranda guru)
        const mySchedRes = await api('/api/schedules/my-schedule', tokGuruA)
        const mySchedBody = await mySchedRes.json().catch(() => null)
        const mySchedOk = mySchedRes.status === 200 && (Array.isArray(mySchedBody) || typeof mySchedBody === 'object')
        check('GET /api/schedules/my-schedule (guru) → 200 + shape valid', mySchedOk, `status ${mySchedRes.status}`)

        // Guru B (kelas B) tidak boleh melihat entri jadwal guru A via my-schedule
        const mySchedB = await (await api('/api/schedules/my-schedule', tokGuruB)).json().catch(() => null)
        const schedBArr = Array.isArray(mySchedB) ? mySchedB : (mySchedB?.entries || [])
        const leak = schedBArr.filter?.((e) => e.teacher_id === guruA.teacher.id).length || 0
        check('guru B tidak melihat entri jadwal guru A', leak === 0, `leak=${leak}`)

        // Siswa dilarang analitik
        const anForbidden = await api(`/api/analytics/class-grades?academic_year_id=${year.id}`, tokSiswaA)
        check('GET analytics oleh SISWA → ditolak', [401, 403].includes(anForbidden.status), `status ${anForbidden.status}`)
    }

    // ---------- HASIL ----------
    await stopServerSafe(server, BASE)
    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL SMOKE FITUR =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'E2E-SMOKE-FEATURES: PASS ✅' : 'E2E-SMOKE-FEATURES: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : Promise.resolve()
    const delBy = (t, col, ids) => ids.length ? supabase.from(t).delete().in(col, ids) : Promise.resolve()
    // R2 objects (semua upload via presigned PUT ke Cloudflare R2)
    if (created.r2Keys.length && process.env.R2_ACCESS_KEY_ID) {
        const { S3Client, DeleteObjectsCommand } = require('@aws-sdk/client-s3')
        const r2 = new S3Client({
            region: 'auto',
            endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
        })
        await r2.send(new DeleteObjectsCommand({
            Bucket: process.env.R2_BUCKET,
            Delete: { Objects: created.r2Keys.map(k => ({ Key: k })) },
        })).catch(() => { })
    }
    // exam chain
    await delBy('exam_answers', 'submission_id', created.examSubmissions)
    await del('exam_submissions', created.examSubmissions)
    await del('exam_questions', created.examQuestions)
    await del('exams', created.exams)
    // official chain
    await delBy('official_exam_answers', 'submission_id', created.officialSubmissions)
    await del('official_exam_submissions', created.officialSubmissions)
    await del('official_exam_questions', created.officialQuestions)
    await del('official_exams', created.officialExams)
    // lain-lain
    await del('schedule_entries', []) // terhapus cascade schedule; safety no-op
    await delBy('schedule_entries', 'schedule_id', created.schedules)
    await del('schedules', created.schedules)
    await del('announcements', created.announcements)
    await del('question_bank', created.questionBank)
    await delBy('question_bank', 'passage_id', created.passages)
    await del('question_passages', created.passages)
    await del('materials', created.materials)
    for (const uid of created.users) await supabase.from('notifications').delete().eq('user_id', uid)
    await del('sessions', created.sessions)
    await del('student_enrollments', created.enrollments)
    await del('students', created.students)
    await del('teaching_assignments', created.tas)
    await del('teachers', created.teachers)
    await del('classes', created.classes)
    await del('subjects', created.subjects)
    await del('users', created.users)
    await del('schools', created.schools)
    console.log('cleanup selesai')
}

main()
    .catch(async e => {
        console.error('ERROR:', e.message)
        process.exitCode = 1
        if (server) await stopServerSafe(server, BASE).catch(() => { })
    })
    .finally(cleanup)
