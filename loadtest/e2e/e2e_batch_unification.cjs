/**
 * E2E BATCH UNIFICATION (ulangan 1 card per batch) — verifikasi fitur
 * "ulangan multi-kelas jadi 1 card" end-to-end: kontrak data list, tab hasil
 * multi-kelas (batch_id), analisa merge, monitor multi-kelas, dan KEAMANAN
 * scope co-teacher + tenant lintas sekolah.
 *
 * Fixture: 1 guru owner (TA A/B/C), 1 co-teacher (TA mapel sama di B saja),
 * 1 guru tak terkait (mapel lain di A), 1 guru sekolah lain, batch 3 exam
 * (1 per kelas), 3 siswa submit dengan nilai berbeda (100/50/0).
 *
 *   [LIST]  kontrak data grouping (server → client card)
 *     L1  GET /api/exams (owner): baris batch membawa batch_size=3 +
 *         batch_class_names=3 (kontrak card "3 kelas")
 *     L2  GET /api/exams (co-teacher): hanya member kelas B yang terlihat
 *     L3  GET /api/exams/[A] (owner): batch_siblings = [B,C] + class_id/name
 *     L4  GET /api/exams/[B] (co-teacher): batch_siblings kosong (scope A4)
 *
 *   [HASIL] tab hasil "Semua Kelas"
 *     H1  GET /api/exam-submissions?batch_id (owner): 3 baris lintas kelas
 *     H2  (co-teacher): 1 baris (kelas B saja)
 *     H3  (guru tak terkait): []
 *     H4  (guru sekolah lain): [] (tenant guard)
 *     H5  SISWA pakai batch_id: tetap scoped ke submission sendiri (S5)
 *
 *   [G1] guard detail submission
 *     G1a GET /api/exam-submissions/[id] guru tak terkait → 403
 *     G1b (co-teacher kelas B) → 200
 *
 *   [ANALITIK] merge batch
 *     A1  single (regresi): analytics exam A saja → submitted=1
 *     A2  batch: submitted=3, avg=50, totalStudents=3,
 *         ranking[0] bawa className, correctRate q1=66.67 q2=33.33
 *     A3  batch via co-teacher (kelas B): submitted=1 (graceful single)
 *     A4  batch via guru sekolah lain → 404 (tenant)
 *
 *   [MONITOR] multi-kelas mirror UTS/UAS
 *     M1  monitor?exam_id=A&batch=1 (owner): target_classes=3, 3 siswa, 3 submitted
 *     M2  monitor?exam_id=B&batch=1 (co-teacher): hanya siswa B (tanpa bocor A/C)
 *     M3  monitor?exam_id=A&batch=1 (guru tak terkait) → 403
 *     M4  monitor?exam_id=A&batch=1 (guru sekolah lain) → 404 (tenant)
 *
 *   [SISWA] regresi — siswa tidak terdampak
 *     S1  siswa A hanya melihat exam kelasnya (bukan B/C)
 *
 *   [RENDER] Chrome headless (bila tersedia)
 *     R1  list guru: judul batch muncul PERSIS 1x (1 card, bukan 3) +
 *         "3 kelas" + badge "Kelas Paralel" + filter "Semua Kelas"
 *     R2  tab hasil exam A: dropdown "Semua Kelas", kolom "Kelas",
 *         nama kelas B & nama siswa B terlihat di tabel
 *
 * WAJIB staging: build dulu dengan env staging, lalu
 *   ENV_FILE=.env.staging node loadtest/e2e/e2e_batch_unification.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const { execFile, spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PORT = 3115
const BASE = `http://localhost:${PORT}`
const PROXY_PORT = 3116
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

let server = null
let proxy = null

const created = {
    users: [], teachers: [], students: [], sessions: [], classes: [],
    subjects: [], tas: [], exams: [], questions: [], submissions: [],
    enrollments: [], schools: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
    const runId = Date.now() % 100000
    const U = `bu_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    // ---------- FIXTURES ----------
    const { data: school } = await supabase.from('schools').select('id, code').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} IPA`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)
    const subject2 = await mustInsert(supabase, 'subjects', { name: `${U} MTK`, school_id: school.id, kkm: 75 }, 'subject2')
    created.subjects.push(subject2.id)

    const mkGuru = async (label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_${label}`, full_name: `${U} Guru ${label}`, password_hash: passHash, role: 'GURU', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const t = await mustInsert(supabase, 'teachers', { user_id: u.id, school_id: school.id }, `teacher ${label}`)
        created.teachers.push(t.id)
        const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session ${label}`)).token
        created.sessions.push(tok)
        return { user: u, teacher: t, token: tok }
    }
    const guru1 = await mkGuru('owner')   // TA A/B/C (batch owner)
    const guru2 = await mkGuru('coteach') // TA mapel sama, kelas B saja
    const guru3 = await mkGuru('asing')   // TA mapel lain di kelas A

    const mkClass = async (label) => {
        const c = await mustInsert(supabase, 'classes', { name: `${U} 9${label}`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, `class ${label}`)
        created.classes.push(c.id)
        return c
    }
    const classA = await mkClass('A'), classB = await mkClass('B'), classC = await mkClass('C')

    const mkTa = (teacher, cls, subj) => {
        const p = mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: cls.id, subject_id: subj.id, academic_year_id: year.id }, 'TA')
            .then(ta => { created.tas.push(ta.id); return ta })
        return p
    }
    const taA = await mkTa(guru1.teacher, classA, subject)
    const taB = await mkTa(guru1.teacher, classB, subject)
    const taC = await mkTa(guru1.teacher, classC, subject)
    await mkTa(guru2.teacher, classB, subject)      // co-teacher kelas B
    await mkTa(guru3.teacher, classA, subject2)     // guru asing: mapel lain di A

    const mkStudent = async (label, cls) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_s${label}`, full_name: `${U} Siswa ${label.toUpperCase()}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}0${label}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `enrollment ${label}`)
        created.enrollments.push(en.id)
        const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_s${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `session ${label}`)).token
        created.sessions.push(tok)
        return { user: u, student: st, token: tok }
    }
    const siswaA = await mkStudent('a', classA)
    const siswaB = await mkStudent('b', classB)
    const siswaC = await mkStudent('c', classC)

    // Guru sekolah lain (tenant guard) — cukup school+user+teacher+session
    const school2 = await mustInsert(supabase, 'schools', { code: `X${U}`.slice(0, 20), name: `${U} Sekolah Lain`, is_active: true }, 'school2')
    created.schools.push(school2.id)
    const guruS2User = await mustInsert(supabase, 'users', { username: `${U}_guru_s2`, full_name: `${U} Guru Sekolah Lain`, password_hash: passHash, role: 'GURU', school_id: school2.id }, 'user guru s2')
    created.users.push(guruS2User.id)
    await mustInsert(supabase, 'teachers', { user_id: guruS2User.id, school_id: school2.id }, 'teacher s2').then(t => created.teachers.push(t.id))
    const guruS2Tok = (await mustInsert(supabase, 'sessions', { user_id: guruS2User.id, token: `${U}_tok_s2`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session s2')).token
    created.sessions.push(guruS2Tok)

    console.log('fixtures OK: owner(A/B/C) + co-teacher(B) + guru asing + guru sekolah lain, 3 kelas, 3 siswa')

    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // ---------- BATCH: 3 exam share batch_id (persis wizard), publish dari A ----------
    const batchId = crypto.randomUUID()
    const startAt = new Date(Date.now() - 60000).toISOString()
    const mkExam = async (ta) => {
        const r = await api('/api/exams', guru1.token, {
            method: 'POST',
            body: JSON.stringify({
                title: `${U} Ulangan Batch`, description: 'e2e batch unification', start_time: startAt,
                duration_minutes: 30, teaching_assignment_id: ta.id, is_randomized: false,
                max_violations: 3, show_results_immediately: true, batch_id: batchId,
            }),
        })
        const body = await r.json().catch(() => null)
        if (!r.ok || !body?.id) throw new Error(`POST exam gagal: ${r.status}`)
        created.exams.push(body.id)
        return body.id
    }
    const examA = await mkExam(taA)
    const examB = await mkExam(taB)
    const examC = await mkExam(taC)

    const { data: insertedQ, error: qErr } = await supabase.from('exam_questions').insert([
        { exam_id: examA, question_text: 'BU q1', question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1', 'C1', 'D1'], correct_answer: 'A', points: 10, order_index: 0, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
        { exam_id: examA, question_text: 'BU q2', question_type: 'MULTIPLE_CHOICE', options: ['A2', 'B2'], correct_answer: 'B', points: 10, order_index: 1, status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain' },
    ]).select()
    if (qErr) throw new Error('Insert soal gagal: ' + qErr.message)
    created.questions.push(...insertedQ.map(q => q.id))

    const pubRes = await api(`/api/exams/${examA}`, guru1.token, { method: 'PUT', body: JSON.stringify({ is_active: true }) })
    const pubBody = await pubRes.json().catch(() => null)
    check('setup: publish primary → batch_sync 2 sibling OK', pubRes.status === 200 && pubBody?.batch_sync?.total === 2 && (pubBody.batch_sync?.failed?.length || 0) === 0,
        `status=${pubRes.status} total=${pubBody?.batch_sync?.total}`)

    // ---------- Siswa submit dengan nilai berbeda: A=100%, B=50%, C=0% ----------
    const submitAs = async (siswa, examId, answers) => {
        const st = await api('/api/exam-submissions', siswa.token, { method: 'POST', body: JSON.stringify({ exam_id: examId }) })
        const stBody = await st.json().catch(() => null)
        if (!st.ok || !stBody?.id) throw new Error(`start gagal exam ${examId}: ${st.status}`)
        created.submissions.push(stBody.id)
        const qs = await (await api(`/api/exams/${examId}/questions`, siswa.token)).json().catch(() => [])
        const ordered = [...qs].sort((x, y) => x.order_index - y.order_index)
        const su = await api('/api/exam-submissions', siswa.token, {
            method: 'PUT',
            body: JSON.stringify({
                submission_id: stBody.id, submit: true,
                answers: answers.map((ans, i) => ({ question_id: ordered[i].id, answer: ans })),
            }),
        })
        return { startBody: stBody, submitBody: await su.json().catch(() => null) }
    }
    const subA = await submitAs(siswaA, examA, ['A', 'B']) // 20/20
    const subB = await submitAs(siswaB, examB, ['A', 'A']) // 10/20
    const subC = await submitAs(siswaC, examC, ['B', 'A']) // 0/20
    check('setup: skor siswa 20/10/0 (A/B/C)', subA.submitBody?.total_score === 20 && subB.submitBody?.total_score === 10 && subC.submitBody?.total_score === 0,
        `${subA.submitBody?.total_score}/${subB.submitBody?.total_score}/${subC.submitBody?.total_score}`)

    // ================= [LIST] =================
    console.log('\n[LIST] kontrak data grouping')
    const listOwner = await (await api('/api/exams', guru1.token)).json().catch(() => [])
    const rowA = (Array.isArray(listOwner) ? listOwner : []).find(e => e.id === examA)
    check('L1: baris batch membawa batch_size=3', rowA?.batch_size === 3, `batch_size=${rowA?.batch_size}`)
    check('L1b: batch_class_names berisi 3 nama kelas', Array.isArray(rowA?.batch_class_names) && rowA.batch_class_names.length === 3,
        `n=${rowA?.batch_class_names?.length}`)

    const listCo = await (await api('/api/exams', guru2.token)).json().catch(() => [])
    const coIds = (Array.isArray(listCo) ? listCo : []).map(e => e.id)
    check('L2: co-teacher hanya melihat member kelas B (bukan A/C)', coIds.includes(examB) && !coIds.includes(examA) && !coIds.includes(examC),
        `n=${coIds.length}`)

    const detailA = await (await api(`/api/exams/${examA}`, guru1.token)).json().catch(() => null)
    const sib = detailA?.batch_siblings || []
    check('L3: owner melihat batch_siblings B+C dengan class_id & class_name',
        Array.isArray(sib) && sib.length === 2 && sib.every(s => s.id && s.class_id && s.class_name),
        `n=${sib.length} keys=${sib[0] ? Object.keys(sib[0]).join(',') : '-'}`)

    const detailBco = await (await api(`/api/exams/${examB}`, guru2.token)).json().catch(() => null)
    check('L4: co-teacher batch_siblings kosong (scope A4 — tanpa bocor A/C)', Array.isArray(detailBco?.batch_siblings) && detailBco.batch_siblings.length === 0,
        `n=${detailBco?.batch_siblings?.length}`)

    // ================= [HASIL batch] =================
    console.log('\n[HASIL] tab hasil "Semua Kelas" (batch_id)')
    const batchSubs = await (await api(`/api/exam-submissions?batch_id=${batchId}`, guru1.token)).json().catch(() => null)
    const bArr = Array.isArray(batchSubs) ? batchSubs : []
    const bStudentIds = bArr.map(s => s.student?.id)
    check('H1: owner melihat 3 submission lintas kelas (A+B+C)',
        bArr.length === 3 && bStudentIds.includes(siswaA.student.id) && bStudentIds.includes(siswaB.student.id) && bStudentIds.includes(siswaC.student.id),
        `n=${bArr.length}`)
    check('H1b: tiap baris membawa exam_id member (link koreksi per kelas)',
        bArr.every(s => [examA, examB, examC].includes(s.exam_id)))
    check('H1c: embed nama kelas tersedia per baris', bArr.every(s => {
        const ex = Array.isArray(s.exam) ? s.exam[0] : s.exam
        const ta = Array.isArray(ex?.teaching_assignment) ? ex.teaching_assignment[0] : ex?.teaching_assignment
        const cls = Array.isArray(ta?.class) ? ta.class[0] : ta?.class
        return !!cls?.name
    }))

    const batchSubsCo = await (await api(`/api/exam-submissions?batch_id=${batchId}`, guru2.token)).json().catch(() => null)
    const coArr = Array.isArray(batchSubsCo) ? batchSubsCo : []
    check('H2: co-teacher hanya 1 submission (kelas B, tanpa bocor A/C)',
        coArr.length === 1 && coArr[0]?.student?.id === siswaB.student.id, `n=${coArr.length}`)

    const batchSubsAsing = await (await api(`/api/exam-submissions?batch_id=${batchId}`, guru3.token)).json().catch(() => null)
    check('H3: guru tak terkait (mapel lain) → kosong', Array.isArray(batchSubsAsing) && batchSubsAsing.length === 0, `n=${batchSubsAsing?.length}`)

    const batchSubsS2 = await (await api(`/api/exam-submissions?batch_id=${batchId}`, guruS2Tok)).json().catch(() => null)
    check('H4: guru sekolah lain → kosong (tenant guard)', Array.isArray(batchSubsS2) && batchSubsS2.length === 0, `n=${batchSubsS2?.length}`)

    const batchSubsSiswa = await (await api(`/api/exam-submissions?batch_id=${batchId}`, siswaB.token)).json().catch(() => null)
    const sisArr = Array.isArray(batchSubsSiswa) ? batchSubsSiswa : []
    check('H5: SISWA pakai batch_id tetap scoped ke submission sendiri (S5)',
        sisArr.length >= 1 && sisArr.every(s => s.student?.id === siswaB.student.id), `n=${sisArr.length}`)

    // ================= [G1] guard detail submission =================
    console.log('\n[G1] guard detail submission')
    const g1Asing = await api(`/api/exam-submissions/${subB.startBody.id}`, guru3.token)
    check('G1a: guru tak terkait baca detail submission → 403', g1Asing.status === 403, `status=${g1Asing.status}`)
    const g1Co = await api(`/api/exam-submissions/${subB.startBody.id}`, guru2.token)
    check('G1b: co-teacher kelas B baca detail → 200', g1Co.status === 200, `status=${g1Co.status}`)

    // ================= [ANALITIK] =================
    console.log('\n[ANALITIK] merge batch')
    const anSingle = await (await api(`/api/analytics/exam/${examA}`, guru1.token)).json().catch(() => null)
    check('A1: single (regresi) — analytics exam A saja submitted=1', anSingle?.classOverview?.submitted === 1,
        `submitted=${anSingle?.classOverview?.submitted}`)

    const anBatch = await (await api(`/api/analytics/exam/${examA}?batch_id=${batchId}`, guru1.token)).json().catch(() => null)
    check('A2: batch submitted=3', anBatch?.classOverview?.submitted === 3, `submitted=${anBatch?.classOverview?.submitted}`)
    check('A2b: batch totalStudents=3 (enrollment A+B+C)', anBatch?.classOverview?.totalStudents === 3, `total=${anBatch?.classOverview?.totalStudents}`)
    check('A2c: batch avgScore=50 (100/50/0)', Math.round(anBatch?.classOverview?.avgScore) === 50, `avg=${anBatch?.classOverview?.avgScore}`)
    const rank0 = anBatch?.studentRanking?.[0]
    check('A2d: ranking[0] = siswa A bawa className kelas A',
        rank0?.name === `${U} Siswa A` && !!rank0?.className, `name=${rank0?.name} class=${rank0?.className || '-'}`)
    const qa = anBatch?.questionAnalysis || []
    check('A2e: correctRate merge — q1=66.67 (2/3), q2=33.33 (1/3)',
        qa.length === 2 && Math.round(qa[0]?.correctRate * 100) / 100 === 66.67 && Math.round(qa[1]?.correctRate * 100) / 100 === 33.33,
        `q1=${qa[0]?.correctRate} q2=${qa[1]?.correctRate}`)
    const hm = anBatch?.performanceHeatmap || []
    check('A2f: heatmap merge 3 siswa × 2 soal', hm.length === 3 && hm.every(s => s.answers?.length === 2), `n=${hm.length}`)

    const anBatchCo = await (await api(`/api/analytics/exam/${examB}?batch_id=${batchId}`, guru2.token)).json().catch(() => null)
    check('A3: batch via co-teacher → graceful single (submitted=1 kelas B)', anBatchCo?.classOverview?.submitted === 1,
        `submitted=${anBatchCo?.classOverview?.submitted}`)

    const anBatchS2 = await api(`/api/analytics/exam/${examA}?batch_id=${batchId}`, guruS2Tok)
    check('A4: batch via guru sekolah lain → 404 (tenant)', anBatchS2.status === 404, `status=${anBatchS2.status}`)

    // ================= [MONITOR] =================
    console.log('\n[MONITOR] multi-kelas (mirror UTS/UAS)')
    const monOwner = await (await api(`/api/exam-submissions/monitor?exam_id=${examA}&batch=1`, guru1.token)).json().catch(() => null)
    check('M1: owner — target_classes=3', (monOwner?.exam?.target_classes || []).length === 3,
        `n=${monOwner?.exam?.target_classes?.length}`)
    check('M1b: owner — 3 siswa target', monOwner?.summary?.total_target_students === 3, `total=${monOwner?.summary?.total_target_students}`)
    check('M1c: owner — 3 submitted', monOwner?.summary?.submitted === 3, `submitted=${monOwner?.summary?.submitted}`)
    const monStudentIds = (monOwner?.students || []).map(s => s.student_id)
    check('M1d: owner — siswa A/B/C semua muncul dengan nama kelas masing-masing',
        monStudentIds.includes(siswaA.student.id) && monStudentIds.includes(siswaB.student.id) && monStudentIds.includes(siswaC.student.id)
        && (monOwner?.students || []).every(s => !!s.class_name))

    const monCo = await (await api(`/api/exam-submissions/monitor?exam_id=${examB}&batch=1`, guru2.token)).json().catch(() => null)
    const monCoIds = (monCo?.students || []).map(s => s.student_id)
    check('M2: co-teacher — hanya siswa B (tanpa bocor A/C)',
        monCoIds.length === 1 && monCoIds[0] === siswaB.student.id, `n=${monCoIds.length}`)

    const monAsing = await api(`/api/exam-submissions/monitor?exam_id=${examA}&batch=1`, guru3.token)
    check('M3: guru tak terkait monitor batch → 403', monAsing.status === 403, `status=${monAsing.status}`)

    const monS2 = await api(`/api/exam-submissions/monitor?exam_id=${examA}&batch=1`, guruS2Tok)
    check('M4: guru sekolah lain monitor batch → 404 (tenant)', monS2.status === 404, `status=${monS2.status}`)

    // ================= [SISWA] regresi =================
    console.log('\n[SISWA] regresi — siswa tidak terdampak')
    const listSiswaA = await (await api('/api/exams', siswaA.token)).json().catch(() => [])
    const sIds = (Array.isArray(listSiswaA) ? listSiswaA : []).map(e => e.id)
    check('S1: siswa A hanya melihat exam kelasnya (bukan B/C)', sIds.includes(examA) && !sIds.includes(examB) && !sIds.includes(examC),
        `n=${sIds.length}`)

    // ================= [RENDER] =================
    console.log('\n[RENDER] Chrome headless')
    const renderDom = async (url, cookieToken, budget = 20000) => {
        if (!fs.existsSync(CHROME)) return null
        await new Promise(r => {
            proxy = http.createServer((req, res) => {
                const p = http.request({ hostname: 'localhost', port: PORT, path: req.url, method: req.method, headers: { ...req.headers, Cookie: `session_token=${cookieToken}` } }, pr => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res) })
                p.on('error', () => { res.writeHead(502); res.end() }); req.pipe(p)
            })
            proxy.listen(PROXY_PORT, r)
        })
        const dom = await new Promise((resolve) => {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-bu-'))
            execFile(CHROME, [
                '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
                `--user-data-dir=${tmp}`, `--virtual-time-budget=${budget}`, '--dump-dom',
                `http://localhost:${PROXY_PORT}${url}`,
            ], { maxBuffer: 64 * 1024 * 1024, timeout: 90000 }, (err, stdout) => {
                fs.rmSync(tmp, { recursive: true, force: true })
                resolve(err ? '' : stdout)
            })
        })
        proxy.close(); proxy = null
        return dom
    }
    const countOcc = (hay, needle) => hay.split(needle).length - 1

    if (!fs.existsSync(CHROME)) {
        console.log('  ⚠ Chrome tidak ditemukan — [RENDER] dilewati (bukan fail)')
    } else {
        const domList = await renderDom('/dashboard/guru/ulangan', guru1.token)
        const title = `${U} Ulangan Batch`
        // Hitung heading card (h3) — bukan kemunculan string mentah: judul juga
        // muncul di aria-label tombol "Aksi lainnya untuk <judul>" (aksesibilitas).
        const cardCount = countOcc(domList, `>${title}</h3>`)
        check('R1: list guru — card batch muncul PERSIS 1x (1 card, bukan 3)', cardCount === 1,
            `cards=${cardCount} len=${domList.length}`)
        check('R1b: list guru — sel kelas "3 kelas" tampil', domList.includes('3 kelas'))
        check('R1c: list guru — badge "Kelas Paralel" tampil', domList.includes('Kelas Paralel'))
        check('R1d: list guru — filter "Semua Kelas" tampil', domList.includes('Semua Kelas'))

        const domHasil = await renderDom(`/dashboard/guru/ulangan/${examA}?tab=hasil`, guru1.token)
        check('R2: tab hasil — dropdown "Semua Kelas" tampil', domHasil.includes('Semua Kelas'))
        check('R2b: tab hasil — kolom "Kelas" tampil di tabel', domHasil.includes('Kelas'))
        check('R2c: tab hasil — nama siswa B terlihat (submission lintas kelas)', domHasil.includes(`${U} Siswa B`))
        check('R2d: tab hasil — nama kelas B terlihat (kolom kelas terisi)', domHasil.includes(`${U} 9B`))
    }

    // ---------- HASIL ----------
    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL E2E BATCH UNIFICATION =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'E2E-BATCH-UNIFICATION: PASS ✅' : 'E2E-BATCH-UNIFICATION: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : null
    const delBy = (t, col, ids) => ids.length ? supabase.from(t).delete().in(col, ids) : null
    await delBy('exam_answers', 'submission_id', created.submissions)
    await del('exam_submissions', created.submissions)
    await delBy('exam_questions', 'exam_id', created.exams)
    await del('exams', created.exams)
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
    if (proxy) try { proxy.close() } catch { }
    console.log('cleanup selesai')
}

main()
    .catch(async e => {
        console.error('ERROR:', e.message)
        process.exitCode = 1
        if (server) await stopServerSafe(server, BASE).catch(() => { })
    })
    .finally(cleanup)
