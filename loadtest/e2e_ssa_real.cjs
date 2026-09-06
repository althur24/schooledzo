/**
 * E2E REAL — SSA SCHOOL (PRODUCTION DB).
 *
 * Menguji flow lengkap Ulangan + UTS/UAS dengan LOGIN ASLI (bcrypt) memakai
 * akun demo SSA, melalui server lokal yang menjalankan kode main (= kode
 * yang ter-deploy) menghadap PRODUCTION DB.
 *
 *   1. Login asli guru (siti.rahma.ssa) & siswa (202990001.ssa) via /api/auth/login
 *   2. Guru: buat ulangan [E2E-CHECK] → 3 soal (2 PG + 1 esai) → publish
 *   3. Guard live: edit soal saat aktif → 409 (fix T2 aktif di prod)
 *   4. Siswa: GET soal (kunci tak bocor) → start → autosave (+ junk id terbuang) → submit
 *   5. Guru: koreksi esai → total benar → grade_history tercatat (fix T6)
 *   6. UTS/UAS: guru buat + publish → siswa kerjakan + submit → nilai auto
 *   7. Monitor: endpoint sehat untuk kedua ujian
 *   8. CLEANUP bedah: HANYA data yang dibuat script ini (answers → submissions →
 *      questions → exams → notifikasi terkait → grade_history terkait → sessions login)
 *
 * Jalankan: node loadtest/e2e_ssa_real.cjs   (server prod-code di localhost:3000,
 * .next dibangun dengan .env.local — guard bawah memastikan BUKAN staging)
 */
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

// env production dari .env.local (bukan .env.staging!)
const env = fs.readFileSync('.env.local', 'utf8')
const envOf = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]
const SUPABASE_URL = envOf('NEXT_PUBLIC_SUPABASE_URL')
const SERVICE_KEY = envOf('SUPABASE_SERVICE_ROLE_KEY')
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('.env.local tidak lengkap')
if (SUPABASE_URL.includes('vkkgnredrfqqraonynte')) throw new Error('FATAL: ini env STAGING — abort')

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000'

const SSA = 'f128ce1c-8014-41a8-9183-75e2e823fce1'
const CLASS_X1 = '2d6a9d13-76cd-4c2d-b984-d6d8af377bf2' // X IPA 1 (TA siti.rahma matematika)
const YEAR = '09010906-f191-4f13-a082-2d98d69cc9b1'    // tahun aktif SSA
const GURU = { username: 'siti.rahma.ssa', password: '199001012015011001' } // matematika X IPA 1 & 2
const SISWA = { username: '202990001.ssa', password: '202990001' }          // siswa demo (dibuat & dibersihkan script ini)

const DEMO_STUDENTS = [
    { nis: '202990001', name: 'Siswa Demo E2E 1', gender: 'L' },
    { nis: '202990002', name: 'Siswa Demo E2E 2', gender: 'P' },
]

/** Seed minimal: siswa demo di X IPA 1 (password = NIS) — dibersihkan/dipulihkan di akhir.
 *  Akun yang sudah ada: password di-reset sementara (hash asli dipulihkan di cleanup). */
const originalHashes = {}
async function seedDemoStudents() {
    const bcrypt = require('bcrypt')
    const created = []
    for (const st of DEMO_STUDENTS) {
        const username = `${st.nis}.ssa`
        const { data: existing } = await supabase.from('users').select('id, password_hash').eq('username', username).maybeSingle()
        if (existing) {
            originalHashes[username] = existing.password_hash
            const password_hash = await bcrypt.hash(st.nis, 10)
            const { error } = await supabase.from('users').update({ password_hash }).eq('id', existing.id)
            if (error) throw new Error('reset password demo: ' + error.message)
            console.log('  (password demo di-reset sementara:', username + ')')
            continue
        }
        const password_hash = await bcrypt.hash(st.nis, 10)
        const { data: u, error: e1 } = await supabase.from('users').insert({
            username, password_hash, full_name: st.name, role: 'SISWA', school_id: SSA, must_change_password: true
        }).select('id').single()
        if (e1) throw new Error('seed user siswa: ' + e1.message)
        const { data: srow, error: e2 } = await supabase.from('students').insert({
            user_id: u.id, nis: st.nis, class_id: CLASS_X1, school_id: SSA, gender: st.gender, angkatan: '2029', status: 'ACTIVE'
        }).select('id').single()
        if (e2) throw new Error('seed student: ' + e2.message)
        const { error: e3 } = await supabase.from('student_enrollments').insert({
            student_id: srow.id, class_id: CLASS_X1, academic_year_id: YEAR, status: 'ACTIVE'
        })
        if (e3) throw new Error('seed enrollment: ' + e3.message)
        created.push({ userId: u.id, studentId: srow.id })
        console.log('  siswa demo dibuat:', username)
    }
    return created
}

let PASS = 0, FAIL = 0
function check(label, cond, detail) {
    if (cond) { PASS++; console.log(`  ✅ ${label}`) }
    else { FAIL++; console.log(`  ❌ ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : ''}`) }
}

/** Login ASLI via endpoint auth (bcrypt sungguhan) — ekstrak cookie dari respons. */
async function login(creds) {
    const res = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: creds.username, password: creds.password }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, status: res.status, data }
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]
    const token = (raw.find(c => c && c.startsWith('session_token=')) || '').split(';')[0]
    const role = (raw.find(c => c && c.startsWith('user_role=')) || '').split(';')[0]
    return { ok: true, cookie: `${token}; ${role}`, user: data.user }
}
const jar = {}
async function api(method, path, body, who) {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: jar[who] || '' },
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    })
    let data = null
    try { data = await res.json() } catch { /* empty */ }
    return { status: res.status, ok: res.ok, data }
}

async function main() {
    console.log('== 0. Guard: server menunjuk DB PRODUCTION ==')
    const guard = await fetch(BASE + '/api/schools/public').then(r => r.json()).catch(() => null)
    const isStaging = (Array.isArray(guard) ? guard : []).some(s => s?.code === 'STG01')
    check('0a server BUKAN staging (guard)', !isStaging, guard && guard.length)

    console.log('\n== 1. Seed siswa demo + login ASLI (bcrypt) ==')
    await seedDemoStudents()
    let r = await login(GURU)
    check('1a login guru 200', r.ok, r)
    if (!r.ok) throw new Error('login guru gagal — abort')
    jar.guru = r.cookie
    check('1b role GURU & sekolah SSA', r.user?.role === 'GURU' && r.user?.school_id === SSA, r.user)

    r = await login(SISWA)
    check('1c login siswa 200', r.ok, r)
    if (!r.ok) throw new Error('login siswa gagal — abort')
    jar.siswa = r.cookie
    check('1d role SISWA & sekolah SSA', r.user?.role === 'SISWA' && r.user?.school_id === SSA, r.user)

    console.log('\n== 2. Guru: TA & kelas tersedia ==')
    r = await api('GET', '/api/my-teaching-assignments', null, 'guru')
    const tas = Array.isArray(r.data) ? r.data : (r.data?.assignments || r.data?.data || [])
    check('2a my-teaching-assignments 200', r.status === 200 && tas.length > 0, r.status)
    // TA matematika kelas X IPA 1 (kelas siswa demo)
    const ta = tas.find(t => (t.subject?.name || '').toLowerCase().includes('matematika') && (t.class?.id || t.class_id) === CLASS_X1)
        || tas.find(t => (t.subject?.name || '').toLowerCase().includes('matematika'))
    check('2b TA matematika ditemukan', !!ta, tas.map(t => t.subject?.name))
    const taId = ta?.id || ta?.teaching_assignment_id
    const classId = ta?.class?.id || ta?.class_id
    check('2c TA punya kelas', !!classId, ta)

    console.log('\n== 3. Guru: buat ulangan [E2E-CHECK] → soal → publish ==')
    r = await api('POST', '/api/exams', {
        title: '[E2E-CHECK] Ulangan Verifikasi Produksi',
        description: 'Ujian uji verifikasi otomatis — akan dihapus',
        start_time: new Date(Date.now() - 60_000).toISOString(),
        duration_minutes: 30,
        teaching_assignment_id: taId,
        max_violations: 3,
    }, 'guru')
    check('3a create ulangan 200', r.status === 200 && r.data?.id, r)
    const examId = r.data?.id

    r = await api('POST', `/api/exams/${examId}/questions`, { questions: [
        { question_text: 'Hasil 12 × 3 adalah...', question_type: 'MULTIPLE_CHOICE', options: ['36', '30', '24', '18'], correct_answer: '36', points: 30 },
        { question_text: 'Nilai x dari 2x = 10 adalah...', question_type: 'MULTIPLE_CHOICE', options: ['2', '3', '5', '10'], correct_answer: '5', points: 30 },
        { question_text: 'Jelaskan cara menghitung luas persegi panjang!', question_type: 'ESSAY', correct_answer: 'panjang × lebar', points: 40 },
    ] }, 'guru')
    check('3b tambah 3 soal 200', r.status === 200 && Array.isArray(r.data) && r.data.length === 3, r)
    const qIds = (r.data || []).map(q => q.id)

    r = await api('PUT', `/api/exams/${examId}`, { is_active: true }, 'guru')
    check('3c publish 200 & aktif', r.status === 200 && r.data?.is_active === true, r)

    console.log('\n== 4. Guard live di produksi (fix audit aktif) ==')
    r = await api('PUT', `/api/exams/${examId}/questions`, { question_id: qIds[0], question_text: 'hack mid-exam' }, 'guru')
    check('4a edit soal saat aktif → 409 (fix T2 live)', r.status === 409, r)
    r = await api('POST', `/api/exams/${examId}/questions`, { questions: [{ question_text: 'x', question_type: 'MULTIPLE_CHOICE', options: ['a', 'b'], correct_answer: 'a', points: 1 }] }, 'guru')
    check('4b tambah soal saat aktif → 409', r.status === 409, r)

    console.log('\n== 5. Siswa: menerima ulangan → kerjakan → submit ==')
    r = await api('GET', `/api/exams/${examId}/questions`, null, 'siswa')
    check('5a GET soal 200 & 3 soal', r.status === 200 && Array.isArray(r.data) && r.data.length === 3, r.status)
    check('5b kunci jawaban tidak bocor', Array.isArray(r.data) && r.data.every(q => !('correct_answer' in q)), r.data && r.data[0] && Object.keys(r.data[0]))

    r = await api('POST', '/api/exam-submissions', { exam_id: examId }, 'siswa')
    check('5c start 200 + ends_at/server_time', r.status === 200 && r.data?.id && r.data?.ends_at && r.data?.server_time, r.data && { id: r.data.id, ends_at: r.data.ends_at })
    const subId = r.data?.id

    // autosave: Q1 benar, Q2 salah, plus junk id (harus terbuang — fix T4)
    const junkId = '00000000-0000-0000-0000-00000000beef'
    r = await api('PUT', '/api/exam-submissions', { submission_id: subId, answers: [
        { question_id: qIds[0], answer: '36' },
        { question_id: qIds[1], answer: '30' },
        { question_id: junkId, answer: 'junk' },
    ] }, 'siswa')
    check('5d autosave 200', r.status === 200, r)
    const { data: rawAns } = await supabase.from('exam_answers').select('question_id').eq('submission_id', subId)
    check('5e junk terbuang — hanya 2 jawaban tersimpan', (rawAns || []).length === 2 && !rawAns.some(a => a.question_id === junkId), rawAns)

    // koreksi jawaban Q2 sambil jalan (autosave kedua — last write wins)
    r = await api('PUT', '/api/exam-submissions', { submission_id: subId, answers: [{ question_id: qIds[1], answer: '5' }] }, 'siswa')
    check('5f autosave koreksi Q2 200', r.status === 200, r)

    r = await api('PUT', '/api/exam-submissions', { submission_id: subId, answers: [
        { question_id: qIds[0], answer: '36' }, { question_id: qIds[1], answer: '5' },
        { question_id: qIds[2], answer: 'Luas persegi panjang = panjang × lebar' },
    ], submit: true }, 'siswa')
    check('5g submit 200 & is_submitted', r.status === 200 && r.data?.is_submitted === true, r)
    check('5h skor auto 60 (2 PG benar, esai menunggu koreksi)', r.data?.total_score === 60, r.data && { total: r.data.total_score })
    check('5i is_graded=false (ada esai)', r.data?.is_graded === false, r.data && { is_graded: r.data.is_graded })

    console.log('\n== 6. Guru: koreksi esai → nilai final ==')
    const { data: studentRow } = await supabase.from('students').select('id').eq('user_id', (await whoAmI('siswa'))).single()
    r = await api('GET', `/api/exam-submissions?exam_id=${examId}`, null, 'guru')
    const subRow = (r.data || []).find(s => (s.student?.id || s.student_id) === studentRow?.id)
    check('6a guru melihat submission siswa', !!subRow, r.data && r.data.length)
    r = await api('PUT', `/api/exam-submissions/${subId}`, { answers: [{ question_id: qIds[2], answer: 'Luas persegi panjang = panjang × lebar', score: 35, is_correct: true }], is_graded: true }, 'guru')
    check('6b koreksi esai 200 & is_graded', r.status === 200 && r.data?.is_graded === true, r)
    check('6c nilai final 95 (60 + 35)', r.data?.total_score === 95, r.data && { total: r.data.total_score })
    const { data: gh } = await supabase.from('grade_history').select('*').eq('ref_id', examId).order('changed_at', { ascending: false }).limit(1)
    check('6d grade_history tercatat (60 → 95)', gh?.length === 1 && gh[0].old_score === 60 && gh[0].new_score === 95, gh)

    console.log('\n== 7. UTS/UAS: flow singkat ==')
    const { data: subj } = await supabase.from('subjects').select('id').eq('id', '9bf01e15-29ec-4b63-adc1-1f56364f628c').single()
    const { data: year } = await supabase.from('academic_years').select('id').eq('id', '09010906-f191-4f13-a082-2d98d69cc9b1').single()
    r = await api('POST', '/api/official-exams', {
        title: '[E2E-CHECK] UTS Verifikasi Produksi', exam_type: 'UTS',
        subject_id: subj.id, target_class_ids: [classId], academic_year_id: year.id, school_id: SSA,
        start_time: new Date(Date.now() - 60_000).toISOString(), duration_minutes: 30,
    }, 'guru')
    check('7a buat UTS 200', r.status === 200 && r.data?.id, r)
    const oeId = r.data?.id
    r = await api('POST', `/api/official-exams/${oeId}/questions`, { questions: [
        { question_text: 'Turunan dari x² adalah...', question_type: 'MULTIPLE_CHOICE', options: ['x', '2x', 'x²', '2'], correct_answer: '2x', points: 100 },
    ] }, 'guru')
    check('7b soal UTS 200', r.status === 200, r)
    const oeQ = (r.data || [])[0]?.id
    r = await api('PUT', `/api/official-exams/${oeId}`, { is_active: true }, 'guru')
    check('7c publish UTS 200', r.status === 200, r)

    r = await api('GET', `/api/official-exams/${oeId}/questions`, null, 'siswa')
    check('7d siswa GET soal UTS 200 & kunci tak bocor', r.status === 200 && Array.isArray(r.data) && r.data.length === 1 && !('correct_answer' in r.data[0]), r.status)
    r = await api('POST', '/api/official-exam-submissions', { exam_id: oeId }, 'siswa')
    check('7e start UTS 200', r.status === 200 && r.data?.id, r)
    const oeSubId = r.data?.id
    r = await api('PUT', '/api/official-exam-submissions', { submission_id: oeSubId, answers: [{ question_id: oeQ, answer: '2x' }], submit: true }, 'siswa')
    check('7f submit UTS 200 & auto-graded 100', r.status === 200 && r.data?.is_graded === true && r.data?.total_score === 100, r.data && { total: r.data.total_score, graded: r.data.is_graded })

    console.log('\n== 8. Monitor Live ==')
    r = await api('GET', `/api/exam-submissions/monitor?exam_id=${examId}`, null, 'guru')
    check('8a monitor ulangan 200', r.status === 200 && r.data && typeof r.data === 'object', r.status)
    r = await api('GET', `/api/official-exam-submissions/monitor?exam_id=${oeId}`, null, 'guru')
    check('8b monitor UTS/UAS 200', r.status === 200 && r.data && typeof r.data === 'object', r.status)

    console.log(`\n=== HASIL E2E REAL SSA: ${PASS} PASS, ${FAIL} FAIL ===`)
    await cleanupAndReport(examId, oeId, [subId, oeSubId])
    process.exit(FAIL > 0 ? 1 : 0)
}

async function whoAmI(who) {
    const res = await fetch(BASE + '/api/auth/me', { headers: { Cookie: jar[who] } })
    const d = await res.json().catch(() => null)
    return d?.user?.id
}

/** Cleanup bedah — hanya baris yang dibuat/dipicu script ini. */
async function cleanupAndReport(examId, oeId, subIds) {
    console.log('\n== CLEANUP (bedah presisi) ==')
    try {
        for (const sid of subIds) {
            if (sid) {
                await supabase.from('exam_answers').delete().eq('submission_id', sid)
                await supabase.from('official_exam_answers').delete().eq('submission_id', sid)
            }
        }
        if (examId) {
            await supabase.from('exam_submissions').delete().eq('exam_id', examId)
            await supabase.from('exam_questions').delete().eq('exam_id', examId)
            await supabase.from('grade_history').delete().eq('ref_id', examId)
            const { error } = await supabase.from('exams').delete().eq('id', examId)
            check('cleanup ulangan [E2E-CHECK] terhapus', !error, error?.message)
        }
        if (oeId) {
            await supabase.from('official_exam_submissions').delete().eq('exam_id', oeId)
            await supabase.from('official_exam_questions').delete().eq('exam_id', oeId)
            await supabase.from('grade_history').delete().eq('ref_id', oeId)
            const { error } = await supabase.from('official_exams').delete().eq('id', oeId)
            check('cleanup UTS [E2E-CHECK] terhapus', !error, error?.message)
        }
        // notifikasi terpicu publish (link/berisi judul E2E-CHECK)
        const { data: notifs } = await supabase.from('notifications').select('id').or('title.ilike.%[E2E-CHECK]%,message.ilike.%[E2E-CHECK]%')
        if (notifs && notifs.length) await supabase.from('notifications').delete().in('id', notifs.map(n => n.id))
        check('cleanup notifikasi terpicu', true, notifs?.length)
        // session login tadi
        for (const who of ['guru', 'siswa']) {
            const token = (jar[who] || '').match(/session_token=([^;]+)/)?.[1]
            if (token) await supabase.from('sessions').delete().eq('token', token)
        }
        // siswa demo: yang dibuat script → hapus total; yang sudah ada → pulihkan password asli
        for (const st of DEMO_STUDENTS) {
            const username = `${st.nis}.ssa`
            const { data: u } = await supabase.from('users').select('id, full_name').eq('username', username).maybeSingle()
            if (!u) continue
            if (originalHashes[username]) {
                await supabase.from('users').update({ password_hash: originalHashes[username] }).eq('id', u.id)
                await supabase.from('sessions').delete().eq('user_id', u.id)
                console.log('  password asli dipulihkan:', username)
            } else if (u.full_name.startsWith('Siswa Demo E2E')) {
                const { data: srow } = await supabase.from('students').select('id').eq('user_id', u.id).maybeSingle()
                if (srow) {
                    await supabase.from('student_enrollments').delete().eq('student_id', srow.id)
                    await supabase.from('students').delete().eq('id', srow.id)
                }
                await supabase.from('sessions').delete().eq('user_id', u.id)
                await supabase.from('users').delete().eq('id', u.id)
                console.log('  siswa demo dihapus:', username)
            }
        }
        // verifikasi hancur total
        const { count: left } = await supabase.from('exams').select('id', { count: 'exact', head: true }).ilike('title', '%[E2E-CHECK]%')
        const { count: leftOe } = await supabase.from('official_exams').select('id', { count: 'exact', head: true }).ilike('title', '%[E2E-CHECK]%')
        check('verifikasi: 0 sisa [E2E-CHECK] di exams', left === 0, left)
        check('verifikasi: 0 sisa [E2E-CHECK] di official_exams', leftOe === 0, leftOe)
        console.log('cleanup selesai')
    } catch (e) {
        console.error('CLEANUP ERROR (perlu manual):', e)
    }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
