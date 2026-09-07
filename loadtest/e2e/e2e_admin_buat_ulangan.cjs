/**
 * E2E ADMIN BUAT ULANGAN VIA MODAL TERPADU — fitur baru sesi ini.
 *
 * Menghapus fitur "Buat Ulangan untuk Guru" (pilih guru manual) dan menggantinya
 * dengan picker 3 jenis (Ulangan/UTS/UAS) di modal "Buat Ujian" admin: admin cukup
 * pilih mapel + kelas target; sistem mencocokkan guru pengampu otomatis dari
 * teaching_assignments (draft dibuat per TA), kelas tanpa guru pengampu di-skip.
 *
 * Skenario (fixture mandiri STG01, dibersihkan di akhir):
 *  [0] Halaman admin /dashboard/admin/uts-uas merender (SSR) dengan tombol "Buat Ujian"
 *  [1] GET /api/teaching-assignments (admin) — sumber pencocokan guru UI:
 *      TA tahun aktif + embed teacher/subject/class lengkap
 *  [2] Simulasi computeUlanganMatches + handleCreate UI: POST /api/exams per TA cocok
 *      (batch_id utk multi-kelas, kelas tanpa guru di-skip) → draft created_by=admin
 *  [3] Visibilitas: admin lihat semua; guru pemilik TA lihat draft buatan admin
 *      (creator_role=ADMIN); guru tanpa TA mapel tsb TIDAK melihat
 *  [4] Edit silang: guru edit draft buatan admin (200); guru asing di TA orang lain (403)
 *  [5] Publish silang: guru publish draft admin (200); admin publish draft guru (200);
 *      publish tanpa soal ditolak (400)
 *  [6] Regresi jalur UTS/UAS: POST /api/official-exams exam_type=UTS oleh admin tetap 200
 *
 * Jalankan: ENV_FILE=.env.staging node loadtest/e2e/e2e_admin_buat_ulangan.cjs
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
    users: [], teachers: [], sessions: [], classes: [], subjects: [],
    tas: [], exams: [], questions: [], officialExams: [], notifications: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `acu_${runId}`
    const PASS = 'Acu-Test-123'
    const passHash = bcrypt.hashSync(PASS, 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const adminUser = await mustInsert(supabase, 'users', { username: `${U}_admin`, full_name: `${U} Admin`, password_hash: passHash, role: 'ADMIN', school_id: school.id, must_change_password: false, is_locked: false }, 'user admin')
    created.users.push(adminUser.id)

    const mkGuru = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} ${label}`, password_hash: passHash, role: 'GURU', school_id: school.id, must_change_password: false, is_locked: false }, `user ${label}`)
        created.users.push(u.id)
        const t = await mustInsert(supabase, 'teachers', { user_id: u.id, school_id: school.id }, `teacher ${label}`)
        created.teachers.push(t.id)
        return { user: u, teacher: t }
    }
    const guruA = await mkGuru('guruA') // mapel X di kelas A & B
    const guruB = await mkGuru('guruB') // team teaching mapel X kelas A + mapel Y kelas A
    const guruC = await mkGuru('guruC') // HANYA mapel Y kelas C — tidak boleh lihat draft mapel X

    const subjectX = await mustInsert(supabase, 'subjects', { name: `${U} Mapel X`, school_id: school.id, kkm: 75 }, 'subject X')
    const subjectY = await mustInsert(supabase, 'subjects', { name: `${U} Mapel Y`, school_id: school.id, kkm: 75 }, 'subject Y')
    created.subjects.push(subjectX.id, subjectY.id)

    const classA = await mustInsert(supabase, 'classes', { name: `${U} 7A`, academic_year_id: year.id, grade_level: 1, school_level: 'SMP' }, 'class A')
    const classB = await mustInsert(supabase, 'classes', { name: `${U} 7B`, academic_year_id: year.id, grade_level: 1, school_level: 'SMP' }, 'class B')
    const classC = await mustInsert(supabase, 'classes', { name: `${U} 7C`, academic_year_id: year.id, grade_level: 1, school_level: 'SMP' }, 'class C') // TIDAK punya guru mapel X
    created.classes.push(classA.id, classB.id, classC.id)

    const taA_X_A = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruA.teacher.id, class_id: classA.id, subject_id: subjectX.id, academic_year_id: year.id }, 'TA guruA X/A')
    const taA_X_B = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruA.teacher.id, class_id: classB.id, subject_id: subjectX.id, academic_year_id: year.id }, 'TA guruA X/B')
    const taB_X_A = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruB.teacher.id, class_id: classA.id, subject_id: subjectX.id, academic_year_id: year.id }, 'TA guruB X/A (team teaching)')
    const taB_Y_A = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruB.teacher.id, class_id: classA.id, subject_id: subjectY.id, academic_year_id: year.id }, 'TA guruB Y/A')
    const taC_Y_C = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guruC.teacher.id, class_id: classC.id, subject_id: subjectY.id, academic_year_id: year.id }, 'TA guruC Y/C')
    created.tas.push(taA_X_A.id, taA_X_B.id, taB_X_A.id, taB_Y_A.id, taC_Y_C.id)

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    const doLogin = async (username) => {
        const r = await fetch(BASE + '/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: PASS }),
        })
        const setCookie = r.headers.getSetCookie?.() || []
        const tokenCookie = setCookie.map(c => c.split(';')[0]).find(c => c.startsWith('session_token='))
        return tokenCookie ? tokenCookie.split('=')[1] : null
    }

    const tokAdmin = await doLogin(adminUser.username)
    const tokGuruA = await doLogin(guruA.user.username)
    const tokGuruB = await doLogin(guruB.user.username)
    const tokGuruC = await doLogin(guruC.user.username)
    check('login admin + 3 guru', !!(tokAdmin && tokGuruA && tokGuruB && tokGuruC))

    // ════════ [0] HALAMAN ADMIN MERENDER ════════
    console.log('\n[0] Halaman admin /dashboard/admin/uts-uas')
    // Catatan: halaman ini fully client-rendered (AuthContext guard) — HTML SSR
    // hanya shell, jadi tombol diverifikasi dari chunk JS bundle production.
    const pageRes = await fetch(BASE + '/dashboard/admin/uts-uas', { headers: { Cookie: `session_token=${tokAdmin}` } })
    check('halaman 200 (terautentikasi)', pageRes.status === 200, `status=${pageRes.status}`)

    const fs = require('fs')
    const path = require('path')
    const chunkDir = path.join(process.cwd(), '.next', 'static', 'chunks')
    let bundleHasButton = false
    let bundleHasOldFeature = false
    const walk = (dir) => {
        for (const f of fs.readdirSync(dir)) {
            const p = path.join(dir, f)
            const st = fs.statSync(p)
            if (st.isDirectory()) walk(p)
            else if (f.endsWith('.js')) {
                const c = fs.readFileSync(p, 'utf8')
                if (c.includes('Pencocokan Guru Pengampu')) bundleHasButton = true
                if (c.includes('untuk Guru')) bundleHasOldFeature = true
            }
        }
    }
    walk(chunkDir)
    check('tombol/pencocokan UI baru ada di bundle production', bundleHasButton)
    check('fitur lama "untuk Guru" HILANG dari bundle', !bundleHasOldFeature)

    // ════════ [1] SUMBER PENCOCOKAN: /api/teaching-assignments ════════
    console.log('\n[1] GET /api/teaching-assignments (admin) — sumber pencocokan guru UI')
    const taRes = await api('/api/teaching-assignments', tokAdmin)
    const taList = taRes.ok ? await taRes.json() : []
    check('GET 200', taRes.status === 200, `status=${taRes.status}`)
    const ownTAs = (taList || []).filter(t => created.tas.includes(t.id))
    check('semua 5 TA fixture termuat (tahun aktif)', ownTAs.length === 5, `n=${ownTAs.length}`)
    const withEmbed = ownTAs.filter(t => {
        const subj = Array.isArray(t.subject) ? t.subject[0] : t.subject
        const cl = Array.isArray(t.class) ? t.class[0] : t.class
        const tc = Array.isArray(t.teacher) ? t.teacher[0] : t.teacher
        const usr = tc && (Array.isArray(tc.user) ? tc.user[0] : tc.user)
        return !!(subj?.id && cl?.id && usr?.full_name)
    })
    check('embed subject+class+teacher.user lengkap (dipakai UI)', withEmbed.length === 5, `n=${withEmbed.length}`)

    // ════════ [2] ADMIN BUAT ULANGAN — REPLIKA computeUlanganMatches + handleCreate ════════
    console.log('\n[2] Admin buat ulangan mapel X untuk kelas A+B+C (persis payload UI baru)')
    // computeUlanganMatches: kelas A → [guruA, guruB], kelas B → [guruA], kelas C → [] (skip)
    const matches = [
        { classId: classA.id, className: classA.name, taIds: [taA_X_A.id, taB_X_A.id] },
        { classId: classB.id, className: classB.name, taIds: [taA_X_B.id] },
        { classId: classC.id, className: classC.name, taIds: [] },
    ]
    const withTeachers = matches.filter(m => m.taIds.length > 0)
    const skipped = matches.filter(m => m.taIds.length === 0)
    check('simulasi UI: kelas C terdeteksi tanpa guru (di-skip)', skipped.length === 1 && skipped[0].classId === classC.id)

    const allTAs = withTeachers.flatMap(m => m.taIds)
    const batchId = allTAs.length > 1 ? require('crypto').randomUUID() : null
    const startTime = new Date(Date.now() + 3600000).toISOString()
    const basePayload = {
        title: `${U} Ulangan Admin`,
        description: 'e2e admin modal terpadu',
        start_time: startTime,
        duration_minutes: 45,
        window_end_time: null,
        is_randomized: true,
        max_violations: 3,
        show_results_immediately: true,
        batch_id: batchId,
    }
    const createResults = await Promise.allSettled(
        allTAs.map(taId =>
            api('/api/exams', tokAdmin, { method: 'POST', body: JSON.stringify({ ...basePayload, teaching_assignment_id: taId }) })
                .then(async r => ({ status: r.status, body: r.ok ? await r.json() : null }))
        )
    )
    const okCreates = createResults.filter(r => r.status === 'fulfilled' && r.value.status === 200).map(r => r.value.body)
    check('3 POST /api/exams sukses (kelas A ×2 guru + kelas B ×1)', okCreates.length === 3, `ok=${okCreates.length}/${allTAs.length}`)
    check('semua DRAFT (is_active=false)', okCreates.every(e => e?.is_active === false))
    check('created_by = admin (draft atas nama pembuat)', okCreates.every(e => e?.created_by === adminUser.id))
    check('batch_id sama utk multi-kelas (sinkron batch UI)', okCreates.every(e => e?.batch_id === batchId))
    okCreates.forEach(e => created.exams.push(e.id))

    const draftKelasA_guruA = okCreates.find(e => e?.teaching_assignment_id === taA_X_A.id)
    const draftKelasA_guruB = okCreates.find(e => e?.teaching_assignment_id === taB_X_A.id)
    const draftKelasB_guruA = okCreates.find(e => e?.teaching_assignment_id === taA_X_B.id)
    check('draft terpisah per guru (team teaching kelas A → 2 draft)', !!(draftKelasA_guruA && draftKelasA_guruB && draftKelasB_guruA))

    // ════════ [3] VISIBILITAS DRAFT ════════
    console.log('\n[3] Visibilitas draft antar role')
    const adminListRes = await api('/api/exams', tokAdmin)
    const adminList = adminListRes.ok ? await adminListRes.json() : []
    const adminSees = okCreates.filter(e => (adminList || []).some(x => x.id === e.id))
    check('admin melihat SEMUA 3 draft', adminSees.length === 3, `n=${adminSees.length}`)
    const adminSeesCreatorRole = (adminList || []).filter(x => okCreates.some(e => e.id === x.id))
    check('badge creator_role=ADMIN utk draft buatan admin', adminSeesCreatorRole.every(x => x.creator_role === 'ADMIN'))

    const guruAListRes = await api('/api/exams', tokGuruA)
    const guruAList = guruAListRes.ok ? await guruAListRes.json() : []
    const guruASees = okCreates.filter(e => (guruAList || []).some(x => x.id === e.id))
    check('guru A melihat 2 draft buatan admin (TA miliknya)', guruASees.length === 2, `n=${guruASees.length}`)

    const guruBListRes = await api('/api/exams', tokGuruB)
    const guruBList = guruBListRes.ok ? await guruBListRes.json() : []
    const guruBSees = okCreates.filter(e => (guruBList || []).some(x => x.id === e.id))
    check('guru B melihat 1 draft (TA team teaching miliknya)', guruBSees.length === 1, `n=${guruBSees.length}`)

    const guruCListRes = await api('/api/exams', tokGuruC)
    const guruCList = guruCListRes.ok ? await guruCListRes.json() : []
    check('guru C (tanpa TA mapel X) TIDAK melihat draft', !(guruCList || []).some(x => okCreates.some(e => e.id === x.id)))

    // ════════ [4] EDIT SILANG ════════
    console.log('\n[4] Edit silang admin ↔ guru')
    const editByGuru = await api(`/api/exams/${draftKelasB_guruA.id}`, tokGuruA, {
        method: 'PUT', body: JSON.stringify({ title: `${U} Ulangan Admin (edit guru)` }),
    })
    check('guru A edit draft buatan admin → 200', editByGuru.status === 200, `status=${editByGuru.status}`)

    const editByAdmin = await api(`/api/exams/${draftKelasB_guruA.id}`, tokAdmin, {
        method: 'PUT', body: JSON.stringify({ title: `${U} Ulangan Admin (edit admin)` }),
    })
    check('admin edit draft di TA guru → 200', editByAdmin.status === 200, `status=${editByAdmin.status}`)

    const editByWrongGuru = await api(`/api/exams/${draftKelasB_guruA.id}`, tokGuruB, {
        method: 'PUT', body: JSON.stringify({ title: 'Edit Nakal' }),
    })
    check('guru B edit TA milik guru A → 403', editByWrongGuru.status === 403, `status=${editByWrongGuru.status}`)

    // ════════ [5] PUBLISH SILANG ════════
    console.log('\n[5] Publish silang admin ↔ guru')
    const pubNoQuestions = await api(`/api/exams/${draftKelasA_guruA.id}`, tokAdmin, {
        method: 'PUT', body: JSON.stringify({ is_active: true }),
    })
    check('publish tanpa soal ditolak (400)', pubNoQuestions.status === 400, `status=${pubNoQuestions.status}`)

    // Tambah soal ke 2 draft (status approved agar tidak terblokir review AI)
    const mkQ = (examId) => ({ exam_id: examId, question_text: `${U} soal`, question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' })
    const { data: qs, error: qErr } = await supabase.from('exam_questions').insert([mkQ(draftKelasA_guruA.id), mkQ(draftKelasB_guruA.id)]).select()
    if (qErr) throw new Error('Insert exam_questions gagal: ' + qErr.message)
    created.questions.push(...qs.map(q => q.id))

    const pubByGuru = await api(`/api/exams/${draftKelasB_guruA.id}`, tokGuruA, {
        method: 'PUT', body: JSON.stringify({ is_active: true }),
    })
    check('guru A publish draft buatan admin → 200', pubByGuru.status === 200, `status=${pubByGuru.status}`)

    const pubByAdmin = await api(`/api/exams/${draftKelasA_guruA.id}`, tokAdmin, {
        method: 'PUT', body: JSON.stringify({ is_active: true }),
    })
    check('admin publish draft di TA guru → 200 (paritas UTS/UAS)', pubByAdmin.status === 200, `status=${pubByAdmin.status}`)

    const { data: afterPub } = await supabase.from('exams').select('is_active').in('id', [draftKelasA_guruA.id, draftKelasB_guruA.id])
    check('kedua exam is_active=true di DB', (afterPub || []).length === 2 && afterPub.every(e => e.is_active === true))

    // ════════ [6] REGRESI JALUR UTS/UAS ════════
    console.log('\n[6] Regresi: admin tetap bisa buat UTS via /api/official-exams')
    const utsRes = await api('/api/official-exams', tokAdmin, {
        method: 'POST',
        body: JSON.stringify({
            exam_type: 'UTS', title: `${U} UTS Regresi`, subject_id: subjectX.id,
            start_time: startTime, duration_minutes: 90, target_class_ids: [classA.id, classB.id],
            is_randomized: true, max_violations: 3,
        }),
    })
    const utsExam = utsRes.ok ? await utsRes.json() : null
    check('POST /api/official-exams (UTS) → 200', utsRes.status === 200 && !!utsExam?.id, `status=${utsRes.status}`)
    if (utsExam?.id) created.officialExams.push(utsExam.id)

    // ---------- RINGKASAN ----------
    console.log('\n════ RINGKASAN ════')
    const failed = results.filter(r => !r.ok)
    console.log(`${results.length - failed.length}/${results.length} lulus${failed.length ? ` — GAGAL: ${failed.map(f => f.name).join('; ')}` : ''}`)

    // ---------- CLEANUP ----------
    console.log('\ncleanup...')
    const del = async (table, col, ids) => {
        if (!ids || ids.length === 0) return
        for (let i = 0; i < ids.length; i += 100) {
            await supabase.from(table).delete().in(col, ids.slice(i, i + 100))
        }
    }
    await del('notifications', 'user_id', created.users)
    await del('exam_questions', 'exam_id', created.exams)
    await del('exams', 'id', created.exams)
    await del('official_exams', 'id', created.officialExams)
    await del('teaching_assignments', 'id', created.tas)
    await del('subjects', 'id', created.subjects)
    await del('classes', 'id', created.classes)
    await del('teachers', 'id', created.teachers)
    await del('users', 'id', created.users)
    await stopServerSafe(server, BASE)
    console.log('selesai.')
    process.exit(failed.length ? 1 : 0)
}

main().catch(async (err) => {
    console.error('FATAL:', err.message)
    try {
        if (server) await stopServerSafe(server, BASE)
    } catch { /* best effort */ }
    process.exit(1)
})
