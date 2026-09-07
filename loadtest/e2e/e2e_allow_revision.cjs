/**
 * E2E FUNGSIONAL OPSI REVISI PER-TUGAS (assignments.allow_revision).
 *
 * Menguji korelasi penuh fitur revisi:
 *  - POST /api/assignments menyimpan allow_revision (false) & default (true)
 *  - PUT /api/assignments/[id] explicit-only: tanpa field → flag tak berubah
 *  - Siswa submit → guru nilai → revisi DITOLAK 400 untuk allow_revision=false
 *  - Siswa submit → guru nilai → revisi DIIZINKAN untuk allow_revision=true:
 *      + snapshot submission_revisions (nilai + komentar lama)
 *      + grade terhapus (status kembali Belum Dinilai)
 *      + notifikasi SUBMISSION_REVISI ke guru
 *  - Edit SEBELUM dinilai tetap bebas untuk allow_revision=false (tanpa history)
 *
 * WAJIB staging: ENV_FILE=.env.staging node loadtest/e2e/e2e_allow_revision.cjs
 * (.next harus dibangun dengan env staging — assertServerDb memverifikasinya.)
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const PORT = 3101
const BASE = `http://localhost:${PORT}`

let server = null
const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], assignments: [], submissions: [], enrollments: [],
    revisions: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `ar_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()
    if (!year) throw new Error('Tahun ajaran aktif staging tidak ditemukan — abort.')

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} B. Indonesia`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)

    const guruUser = await mustInsert(supabase, 'users', { username: `${U}_guru`, full_name: `${U} Guru`, password_hash: passHash, role: 'GURU', school_id: school.id }, 'user guru')
    created.users.push(guruUser.id)
    const guru = await mustInsert(supabase, 'teachers', { user_id: guruUser.id, school_id: school.id }, 'teacher')
    created.teachers.push(guru.id)
    const guruTok = (await mustInsert(supabase, 'sessions', { user_id: guruUser.id, token: `${U}_tok_guru`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session guru')).token
    created.sessions.push(guruTok)

    const siswaUser = await mustInsert(supabase, 'users', { username: `${U}_siswa`, full_name: `${U} Siswa`, password_hash: passHash, role: 'SISWA', school_id: school.id }, 'user siswa')
    created.users.push(siswaUser.id)
    const siswa = await mustInsert(supabase, 'students', { user_id: siswaUser.id, nis: `${runId}02`, class_id: null, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, 'student')
    created.students.push(siswa.id)
    const siswaTok = (await mustInsert(supabase, 'sessions', { user_id: siswaUser.id, token: `${U}_tok_siswa`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session siswa')).token
    created.sessions.push(siswaTok)

    const cls = await mustInsert(supabase, 'classes', { name: `${U} 9A`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, 'class')
    created.classes.push(cls.id)
    await supabase.from('students').update({ class_id: cls.id }).eq('id', siswa.id)
    const ta = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guru.id, class_id: cls.id, subject_id: subject.id, academic_year_id: year.id }, 'TA')
    created.tas.push(ta.id)
    const en = await mustInsert(supabase, 'student_enrollments', { student_id: siswa.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, 'enrollment')
    created.enrollments.push(en.id)

    const dueDate = new Date(Date.now() + 86400e3).toISOString()

    // ---------- START SERVER ----------
    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('fixtures + server OK (staging DB terverifikasi)\n')

    // ========== SECTION 1: penyimpanan flag ==========
    console.log('[1] POST /api/assignments menyimpan allow_revision')
    const mk = async (title, body) => {
        const res = await api('/api/assignments', guruTok, {
            method: 'POST',
            body: JSON.stringify({ teaching_assignment_id: ta.id, title, description: 'e2e', type: 'TUGAS', due_date: dueDate, ...body }),
        })
        const data = await res.json().catch(() => null)
        if (data?.id) created.assignments.push(data.id)
        return { res, data }
    }
    const kunci = await mk(`${U} Kunci`, { allow_revision: false })
    check('buat tugas allow_revision=false sukses', kunci.res.ok, `status ${kunci.res.status}`)
    const bebas = await mk(`${U} Bebas`, {}) // tanpa field → default
    check('buat tugas tanpa allow_revision sukses', bebas.res.ok, `status ${bebas.res.status}`)
    const { data: dbKunci } = await supabase.from('assignments').select('allow_revision').eq('id', kunci.data.id).single()
    const { data: dbBebas } = await supabase.from('assignments').select('allow_revision').eq('id', bebas.data.id).single()
    check('DB: allow_revision=false tersimpan', dbKunci?.allow_revision === false, String(dbKunci?.allow_revision))
    check('DB: default allow_revision=true', dbBebas?.allow_revision === true, String(dbBebas?.allow_revision))

    console.log('[2] PUT explicit-only: tanpa field → flag tidak berubah')
    const putRes = await api(`/api/assignments/${kunci.data.id}`, guruTok, {
        method: 'PUT',
        body: JSON.stringify({ title: `${U} Kunci (edit)`, description: 'e2e', type: 'TUGAS', due_date: dueDate }),
    })
    check('PUT tanpa allow_revision sukses', putRes.ok, `status ${putRes.status}`)
    const { data: dbKunci2 } = await supabase.from('assignments').select('allow_revision').eq('id', kunci.data.id).single()
    check('DB: flag tetap false setelah PUT tanpa field', dbKunci2?.allow_revision === false, String(dbKunci2?.allow_revision))

    // ========== SECTION 2: revisi ditolak (allow_revision=false) ==========
    console.log('[3] Revisi setelah dinilai DITOLAK untuk allow_revision=false')
    const submit = (aid, answer) => api('/api/submissions', siswaTok, {
        method: 'POST',
        body: JSON.stringify({ assignment_id: aid, answers: [{ type: 'text', answer }], attachments: [] }),
    })
    const s1 = await submit(kunci.data.id, 'jawaban v1')
    const s1data = await s1.json().catch(() => null)
    check('siswa submit tugas kunci (v1)', s1.ok, `status ${s1.status}`)
    if (s1data?.id) created.submissions.push(s1data.id)

    const g1 = await api('/api/grades', guruTok, {
        method: 'POST',
        body: JSON.stringify({ submission_id: s1data.id, score: 60, feedback: 'kurang rapi' }),
    })
    check('guru menilai 60', g1.ok, `status ${g1.status}`)

    const revTolak = await submit(kunci.data.id, 'jawaban v2 (revisi)')
    const revTolakBody = await revTolak.json().catch(() => null)
    check('revisi DITOLAK 400', revTolak.status === 400, `status ${revTolak.status}`)
    check('pesan error jelas', typeof revTolakBody?.error === 'string' && revTolakBody.error.toLowerCase().includes('tidak dapat direvisi'), revTolakBody?.error)

    const { data: s1After } = await supabase.from('student_submissions').select('answers').eq('id', s1data.id).single()
    check('jawaban TIDAK berubah (v1 tetap)', Array.isArray(s1After?.answers) && s1After.answers[0]?.answer === 'jawaban v1', JSON.stringify(s1After?.answers?.[0]?.answer))
    const { data: g1After } = await supabase.from('grades').select('score').eq('submission_id', s1data.id).maybeSingle()
    check('nilai 60 TIDAK terhapus', g1After?.score === 60, String(g1After?.score))
    const { data: rev1 } = await supabase.from('submission_revisions').select('id').eq('submission_id', s1data.id)
    check('tidak ada history revisi yatim', (rev1 || []).length === 0, `${(rev1 || []).length} rows`)

    // ========== SECTION 3: revisi diizinkan (allow_revision=true) ==========
    console.log('[4] Revisi setelah dinilai DIIZINKAN untuk allow_revision=true')
    const s2 = await submit(bebas.data.id, 'jawaban v1')
    const s2data = await s2.json().catch(() => null)
    check('siswa submit tugas bebas (v1)', s2.ok, `status ${s2.status}`)
    if (s2data?.id) created.submissions.push(s2data.id)

    const g2 = await api('/api/grades', guruTok, {
        method: 'POST',
        body: JSON.stringify({ submission_id: s2data.id, score: 40, feedback: 'tolong perbaiki' }),
    })
    check('guru menilai 40', g2.ok, `status ${g2.status}`)

    const revOk = await submit(bebas.data.id, 'jawaban v2 (revisi)')
    check('revisi DITERIMA (200)', revOk.ok, `status ${revOk.status}`)

    const { data: rev2 } = await supabase.from('submission_revisions').select('grade_score, grade_feedback, answers').eq('submission_id', s2data.id).order('created_at').limit(5)
    for (const r of rev2 || []) created.revisions.push(r.id)
    check('history revisi tercatat', (rev2 || []).length === 1, `${(rev2 || []).length} rows`)
    check('snapshot nilai lama 40', rev2?.[0]?.grade_score === 40, String(rev2?.[0]?.grade_score))
    check('snapshot komentar lama', rev2?.[0]?.grade_feedback === 'tolong perbaiki', rev2?.[0]?.grade_feedback)
    check('snapshot jawaban lama v1', Array.isArray(rev2?.[0]?.answers) && rev2[0].answers[0]?.answer === 'jawaban v1', JSON.stringify(rev2?.[0]?.answers?.[0]?.answer))

    const { data: g2After } = await supabase.from('grades').select('id').eq('submission_id', s2data.id).maybeSingle()
    check('nilai terhapus (Belum Dinilai)', !g2After, g2After ? 'masih ada' : 'sudah hilang')

    const { data: notif } = await supabase.from('notifications').select('type, message').eq('user_id', guruUser.id).eq('type', 'SUBMISSION_REVISI').limit(5)
    check('notifikasi SUBMISSION_REVISI ke guru', (notif || []).length >= 1, `${(notif || []).length} notif`)

    // ========== SECTION 4: edit sebelum dinilai tetap bebas ==========
    console.log('[5] Edit SEBELUM dinilai tetap bebas meski allow_revision=false')
    // Patokan jumlah notifikasi revisi guru — tidak boleh bertambah oleh edit sebelum dinilai
    const { count: notifBefore } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', guruUser.id).eq('type', 'SUBMISSION_REVISI')
    const tugas3 = await mk(`${U} Kunci 2`, { allow_revision: false })
    const s3 = await submit(tugas3.data.id, 'jawaban v1')
    const s3data = await s3.json().catch(() => null)
    check('siswa submit tugas kunci-2 (v1)', s3.ok, `status ${s3.status}`)
    if (s3data?.id) created.submissions.push(s3data.id)

    const s3edit = await submit(tugas3.data.id, 'jawaban v1 (edit)')
    check('edit sebelum dinilai DITERIMA (200)', s3edit.ok, `status ${s3edit.status}`)
    const { data: rev3 } = await supabase.from('submission_revisions').select('id').eq('submission_id', s3data.id)
    check('edit sebelum dinilai TIDAK membuat history', (rev3 || []).length === 0, `${(rev3 || []).length} rows`)
    const { count: notifAfter } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', guruUser.id).eq('type', 'SUBMISSION_REVISI')
    check('edit sebelum dinilai TIDAK mengirim notifikasi revisi', (notifAfter || 0) === (notifBefore || 0), `sebelum ${notifBefore} / sesudah ${notifAfter}`)

    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL E2E ALLOW_REVISION =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'E2E-ALLOW-REVISION: PASS ✅' : 'E2E-ALLOW-REVISION: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    try {
        const delBy = (t, col, ids) => ids.length ? supabase.from(t).delete().in(col, ids) : null
        await delBy('submission_revisions', 'submission_id', created.submissions)
        await delBy('grades', 'submission_id', created.submissions)
        await delBy('student_submissions', 'assignment_id', created.assignments)
        if (created.assignments.length) await supabase.from('assignments').delete().in('id', created.assignments)
        for (const uid of created.users) await supabase.from('notifications').delete().eq('user_id', uid)
        await delBy('sessions', 'token', created.sessions)
        await delBy('student_enrollments', 'student_id', created.students)
        await delBy('students', 'id', created.students)
        await delBy('teaching_assignments', 'id', created.tas)
        await delBy('teachers', 'id', created.teachers)
        await delBy('classes', 'id', created.classes)
        await delBy('subjects', 'id', created.subjects)
        await delBy('users', 'id', created.users)
    } catch (e) {
        console.error('cleanup error:', e.message)
    }
    console.log('cleanup selesai')
}

main()
    .catch(async e => {
        console.error('ERROR:', e.message)
        process.exitCode = 1
        if (server) await stopServerSafe(server, BASE).catch(() => { })
    })
    .finally(cleanup)
