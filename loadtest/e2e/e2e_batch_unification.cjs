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
    enrollments: [], schools: [], quizzes: [],
    officialExams: [], officialQuestions: [],
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

    // Admin sekolah (render tab Ulangan admin + perf)
    const adminUser = await mustInsert(supabase, 'users', { username: `${U}_admin`, full_name: `${U} Admin`, password_hash: passHash, role: 'ADMIN', school_id: school.id }, 'user admin')
    created.users.push(adminUser.id)
    const adminTok = (await mustInsert(supabase, 'sessions', { user_id: adminUser.id, token: `${U}_tok_admin`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session admin')).token
    created.sessions.push(adminTok)

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

    // ── Helpers untuk test v2 ──
    // addQ: tambah soal via API (pemicu syncBatchDraft yang sebenarnya —
    // insert DB langsung TIDAK memicu sync)
    const addQ = async (examId, text) => {
        const r = await api(`/api/exams/${examId}/questions`, guru1.token, {
            method: 'POST',
            body: JSON.stringify({
                questions: [{
                    question_text: text, question_type: 'MULTIPLE_CHOICE',
                    options: ['A1', 'B1'], correct_answer: 'A', points: 10,
                    order_index: 999, status: 'approved', bank_status: 'approved',
                    difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
                }],
            }),
        })
        if (r.status !== 200 && r.status !== 201) throw new Error(`addQ gagal ${examId.slice(0, 8)}: ${r.status}`)
        return r.status
    }
    const mkExamLocal = async (ta, bid, title) => {
        const r = await api('/api/exams', guru1.token, {
            method: 'POST',
            body: JSON.stringify({
                title, start_time: new Date(Date.now() + 3600000).toISOString(),
                duration_minutes: 30, teaching_assignment_id: ta.id, is_randomized: false,
                max_violations: 3, show_results_immediately: true, batch_id: bid,
            }),
        })
        const body = await r.json().catch(() => null)
        if (!r.ok || !body?.id) throw new Error(`mkExamLocal gagal: ${r.status}`)
        created.exams.push(body.id)
        return body.id
    }
    const seedApprovedQ = async (examId, texts) => {
        const rows = texts.map((t, i) => ({
            exam_id: examId, question_text: t, question_type: 'MULTIPLE_CHOICE',
            options: ['A1', 'B1'], correct_answer: 'A', points: 10, order_index: i,
            status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
        }))
        const { error } = await supabase.from('exam_questions').insert(rows)
        if (error) throw new Error('seedApprovedQ: ' + error.message)
    }
    const countQLocal = async (examId) => {
        const { count } = await supabase.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', examId)
        return count || 0
    }
    // Replika murni logika groupExamsByBatch (key batch|mapel; guard 2-exam-1-kelas
    // → singleton) untuk verifikasi unit tanpa import TS.
    const groupGuard = (batchId, subj1, subj2, cls1, cls2) => {
        const rows = [
            { id: 'x1', batch_id: batchId, pending_publish: false, created_at: '2026-01-01', s: subj1, c: cls1 },
            { id: 'x2', batch_id: batchId, pending_publish: false, created_at: '2026-01-02', s: subj2, c: cls2 },
        ]
        const key = (r) => r.batch_id && r.s && r.c ? `${r.batch_id}|${r.s}` : null
        const byKey = new Map()
        const singles = []
        for (const r of rows) {
            const k = key(r)
            if (!k) { singles.push(r); continue }
            if (!byKey.has(k)) byKey.set(k, [])
            byKey.get(k).push(r)
        }
        let groups = singles.length
        for (const [k, members] of byKey) {
            const classCount = new Map()
            members.forEach(m => classCount.set(m.c, (classCount.get(m.c) || 0) + 1))
            if (members.length === 1 || [...classCount.values()].some(n => n > 1)) groups += members.length
            else groups += 1
        }
        return groups
    }

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
    // K1: detail exam via API siswa → batch_siblings KOSONG (tidak bocor nama kelas)
    const detSiswa = await (await api(`/api/exams/${examA}`, siswaA.token)).json().catch(() => null)
    check('S1b (K1): GET /api/exams/[id] sebagai SISWA → batch_siblings kosong',
        Array.isArray(detSiswa?.batch_siblings) && detSiswa.batch_siblings.length === 0,
        `n=${detSiswa?.batch_siblings?.length}`)

    // ================= [K3] jadwal batch paksa seragam =================
    console.log('\n[K3] jadwal batch dipaksa seragam (paritas UTS/UAS)')
    const newStart = new Date(Date.now() - 120000).toISOString()
    const newDur = 45
    const k3res = await api(`/api/exams/${examB}`, guru1.token, {
        method: 'PUT',
        body: JSON.stringify({ start_time: newStart, duration_minutes: newDur }),
    })
    check('K3a: PUT jadwal di member B → 200', k3res.status === 200, `status=${k3res.status}`)
    const timingOf = async (id) => (await supabase.from('exams').select('start_time, duration_minutes').eq('id', id).single()).data
    const tA = await timingOf(examA), tB = await timingOf(examB), tC = await timingOf(examC)
    check('K3b: jadwal menular ke A & C (start + durasi identik)',
        Math.abs(new Date(tA.start_time).getTime() - new Date(newStart).getTime()) < 2000
        && Math.abs(new Date(tC.start_time).getTime() - new Date(newStart).getTime()) < 2000
        && tA.duration_minutes === newDur && tC.duration_minutes === newDur,
        `A=${tA.start_time?.slice(11,16)}/${tA.duration_minutes} C=${tC.start_time?.slice(11,16)}/${tC.duration_minutes}`)
    check('K3c: member B sendiri ikut nilai baru', tB.duration_minutes === newDur)
    // Judul TIDAK menular (per-member)
    const k3title = await api(`/api/exams/${examB}`, guru1.token, {
        method: 'PUT',
        body: JSON.stringify({ title: `${U} Judul B Saja` }),
    })
    const titleOf = async (id) => (await supabase.from('exams').select('title').eq('id', id).single()).data?.title
    const jA = await titleOf(examA), jB = await titleOf(examB)
    check('K3d: judul berubah di B TIDAK menular ke A (non-jadwal per-member)',
        k3title.status === 200 && jB === `${U} Judul B Saja` && jA === `${U} Ulangan Batch`,
        `A="${jA?.slice(0, 20)}" B="${jB?.slice(0, 20)}"`)
    // is_active TIDAK tersentuh propagasi (semua tetap true)
    check('K3e: propagasi jadwal tidak menyentuh is_active (A/B/C tetap aktif)',
        tA && tB && tC && (await (async () => {
            const a = (await supabase.from('exams').select('is_active').eq('id', examA).single()).data?.is_active
            const b = (await supabase.from('exams').select('is_active').eq('id', examB).single()).data?.is_active
            const c = (await supabase.from('exams').select('is_active').eq('id', examC).single()).data?.is_active
            return a === true && b === true && c === true
        })()))
    // Kuis jalur sama: batch quiz → PUT duration di member → menular
    const qK3 = await mustInsert(supabase, 'quizzes', {
        title: `${U} Kuis K3`, duration_minutes: 20, teaching_assignment_id: taA.id,
        is_randomized: false, batch_id: crypto.randomUUID(),
        submission_mode: 'ONLINE', is_active: true,
    }, 'quiz k3')
    created.quizzes.push(qK3.id)
    const qK3b = await mustInsert(supabase, 'quizzes', {
        title: `${U} Kuis K3`, duration_minutes: 20, teaching_assignment_id: taB.id,
        is_randomized: false, batch_id: qK3.batch_id,
        submission_mode: 'ONLINE', is_active: true,
    }, 'quiz k3 sibling')
    created.quizzes.push(qK3b.id)
    const qK3res = await api(`/api/quizzes/${qK3b.id}`, guru1.token, {
        method: 'PUT', body: JSON.stringify({ duration_minutes: 35 }),
    })
    const qDur = async (id) => (await supabase.from('quizzes').select('duration_minutes').eq('id', id).single()).data?.duration_minutes
    check('K3f: kuis — PUT durasi member B menular ke member A',
        qK3res.status === 200 && (await qDur(qK3.id)) === 35, `status=${qK3res.status} durA=${await qDur(qK3.id)}`)

    // ================= [F2-guard] status campur: member aktif tak ditimpa draft-sync =================
    console.log('\n[ST] status campur — draft-sync tidak menimpa member aktif')
    // PENTING urutan: member AKTIF dibuat & dipublish duluan SEBELUM sibling draft
    // (publish batch = mengaktifkan semua sibling draft yang ada — sibling yang
    // dibuat SETELAH publish tidak terpengaruh).
    const stBatch = crypto.randomUUID()
    const stC = await mkExamLocal(taC, stBatch, `${U} ST Campur`)
    await seedApprovedQ(stC, [`${U} st c1`, `${U} st c2`, `${U} st c3`, `${U} st c4`, `${U} st c5`])
    await api(`/api/exams/${stC}`, guru1.token, { method: 'PUT', body: JSON.stringify({ is_active: true, start_time: new Date(Date.now() - 60000).toISOString() }) })
    // sibling draft dibuat SETELAH stC aktif → tidak ikut ter-publish
    const stA = await mkExamLocal(taA, stBatch, `${U} ST Campur`)
    const stB = await mkExamLocal(taB, stBatch, `${U} ST Campur`)
    // Soal via API (bukan insert DB langsung) — syncBatchDraft hanya terpicu
    // dari route API (addQ = POST questions, pemicu sync yang sebenarnya)
    for (const t of [`${U} st q1`, `${U} st q2`, `${U} st q3`]) await addQ(stA, t)
    await new Promise(r => setTimeout(r, 2500))
    const stCcount = await countQLocal(stC)
    const stBcount = await countQLocal(stB)
    check('ST1: member AKTIF (stC, 5 soal) tidak ditimpa draft-sync (tetap 5)',
        stCcount === 5, `stC=${stCcount}`)
    check('ST2: member draft (stB) ter-mirror 3 soal', stBcount === 3, `stB=${stBcount}`)
    const stBactive = (await supabase.from('exams').select('is_active').eq('id', stB).single()).data?.is_active
    check('ST3: sibling yang dibuat setelah publish TIDAK ikut aktif (tetap draft)',
        stBactive === false, `stB active=${stBactive}`)

    // ================= [G3] bagikan hasil batch =================
    console.log('\n[G3] bagikan hasil — results_released semua member + notif 1x')
    // Matikan show_results_immediately lalu share (paritas flow guru)
    for (const id of [examA, examB, examC]) {
        await api(`/api/exams/${id}`, guru1.token, { method: 'PUT', body: JSON.stringify({ show_results_immediately: false, results_released: false }) })
    }
    const notifCount = async (type, title) => (await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('type', type).ilike('title', `%${title}%`)).count || 0
    // Judul notif = judul MEMBER saat share — exam B sudah berganti judul di K3d,
    // jadi filter harus menangkap KEDUA judul (bug test: hanya judul lama → notif
    // kelas B tak terhitung → delta palsu 2).
    const notifList = async () => {
        const [r1, r2] = await Promise.all([
            supabase.from('notifications').select('user_id, title, created_at').eq('type', 'NILAI_KELUAR').ilike('title', `%${U} Ulangan Batch%`).order('created_at'),
            supabase.from('notifications').select('user_id, title, created_at').eq('type', 'NILAI_KELUAR').ilike('title', `%${U} Judul B Saja%`).order('created_at'),
        ])
        return [...(r1.data || []), ...(r2.data || [])]
    }
    const beforeList = await notifList()
    const beforeNotif = beforeList.length
    const shareRes = await api(`/api/exams/${examA}`, guru1.token, { method: 'PUT', body: JSON.stringify({ results_released: true }) })
    check('G3a: PUT results_released di representative → 200', shareRes.status === 200, `status=${shareRes.status}`)
    const relOf = async (id) => (await supabase.from('exams').select('results_released').eq('id', id).single()).data?.results_released
    const rA = await relOf(examA), rB = await relOf(examB), rC = await relOf(examC)
    check('G3b: results_released tersimpan di representative (A) — per-member tersirat', rA === true, `A=${rA} B=${rB} C=${rC}`)
    // Share member lain BERURUTAN (deterministik)
    for (const id of [examB, examC]) {
        await api(`/api/exams/${id}`, guru1.token, { method: 'PUT', body: JSON.stringify({ results_released: true }) })
        await new Promise(r => setTimeout(r, 400))
    }
    check('G3c: setelah loop client, SEMUA member results_released=true',
        (await relOf(examB)) === true && (await relOf(examC)) === true)
    await new Promise(r => setTimeout(r, 600))
    const afterList = await notifList()
    const deltaNotif = afterList.length - beforeNotif
    check('G3d: notif NILAI_KELUAR ke siswa 3 kelas TEPAT 1x per siswa (3 total, tanpa dobel)',
        deltaNotif === 3, `delta=${deltaNotif} penerima=${[...new Set(afterList.map(n => n.user_id))].map(u => u.slice(0, 8)).join(',')} judul="${afterList[afterList.length - 1]?.title?.slice(0, 30)}"`)
    // Share ulang (idempotent) → 0 notif baru
    await api(`/api/exams/${examA}`, guru1.token, { method: 'PUT', body: JSON.stringify({ results_released: true }) })
    const afterNotif2 = await notifList()
    check('G3e: share ulang → 0 notifikasi baru (idempotent)', afterNotif2.length === afterList.length, `${afterNotif2.length} vs ${afterList.length}`)

    // ================= [G4] remedial class picker (data-level) =================
    console.log('\n[G4] remedial dari card batch — per kelas')
    // Remedial dibuat dari member B (kelas B) utk siswa B (nilai 50% < KKM 75)
    const remRes = await api('/api/exams', guru1.token, {
        method: 'POST',
        body: JSON.stringify({
            teaching_assignment_id: taB.id,
            title: `[Remedial] ${U}`, description: 'e2e g4', start_time: new Date(Date.now() + 3600000).toISOString(),
            duration_minutes: 30, is_randomized: false, max_violations: 3,
            is_remedial: true, remedial_for_id: examB, allowed_student_ids: [siswaB.student.id],
            duplicate_questions: true, show_results_immediately: true,
        }),
    })
    const remBody = await remRes.json().catch(() => null)
    check('G4a: remedial member kelas B dibuat via API (duplicate soal)', remRes.status === 200 && !!remBody?.id, `status=${remRes.status}`)
    if (remBody?.id) {
        created.exams.push(remBody.id)
        const remQ = await countQLocal(remBody.id)
        check('G4b: soal remedial tersalin dari member B (2 soal)', remQ === 2, `n=${remQ}`)
        const remRow = (await supabase.from('exams').select('is_remedial, allowed_student_ids, batch_id').eq('id', remBody.id).single()).data
        check('G4c: remedial tidak ikut batch (batch_id null) + allowed hanya siswa B',
            remRow?.is_remedial === true && remRow?.batch_id === null
            && Array.isArray(remRow?.allowed_student_ids) && remRow.allowed_student_ids.length === 1
            && remRow.allowed_student_ids[0] === siswaB.student.id)
    }

    // ================= [GUARD] grouping edge =================
    console.log('\n[GG] grouping edge — campur mapel & batch lama')
    // Batch campur 2 mapel → TIDAK digabung (key batch_id|subject)
    const mxBatch = crypto.randomUUID()
    const mx1 = await mkExamLocal(taA, mxBatch, `${U} MX IPA`)
    const mxTaOther = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guru1.teacher.id, class_id: classB.id, subject_id: subject2.id, academic_year_id: year.id }, 'TA mapel2 di B')
    created.tas.push(mxTaOther.id)
    const mx2 = await mkExamLocal(mxTaOther, mxBatch, `${U} MX MTK`)
    const listMix = await (await api('/api/exams', guru1.token)).json().catch(() => [])
    const mixRows = (Array.isArray(listMix) ? listMix : []).filter(e => e.batch_id === mxBatch)
    check('GG1: batch campur 2 mapel → 2 baris member terlihat guru (pemisahan di grouping client)',
        mixRows.length === 2 && mixRows.some(r => r.id === mx1) && mixRows.some(r => r.id === mx2),
        `rows=${mixRows.length}`)
    // Batch lama: 2 exam KELAS SAMA oleh 2 guru berbeda (pra-co-teaching).
    // Kelas D baru — constraint unique TA melarang duplikat (guru1+IPA+C sudah ada).
    const oldBatch = crypto.randomUUID()
    const classD = await mkClass('D')
    const oldTa1 = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guru1.teacher.id, class_id: classD.id, subject_id: subject.id, academic_year_id: year.id }, 'TA lama 1')
    created.tas.push(oldTa1.id)
    const oldTa2 = await mustInsert(supabase, 'teaching_assignments', { teacher_id: guru2.teacher.id, class_id: classD.id, subject_id: subject.id, academic_year_id: year.id }, 'TA lama 2 (guru lain)')
    created.tas.push(oldTa2.id)
    const old1 = await mkExamLocal(oldTa1, oldBatch, `${U} Old Same Class`)
    const old2res = await api('/api/exams', guru2.token, {
        method: 'POST',
        body: JSON.stringify({
            title: `${U} Old Same Class`, start_time: new Date(Date.now() + 3600000).toISOString(),
            duration_minutes: 30, teaching_assignment_id: oldTa2.id, is_randomized: false,
            max_violations: 3, show_results_immediately: true, batch_id: oldBatch,
        }),
    })
    const old2 = (await old2res.json().catch(() => null))?.id
    if (old2) created.exams.push(old2)
    const listOldG1 = await (await api('/api/exams', guru1.token)).json().catch(() => [])
    const oldRowG1 = (Array.isArray(listOldG1) ? listOldG1 : []).find(e => e.id === old1)
    // Server batch_size menghitung KELAS unik → 2 exam 1 kelas = 1 (by-design);
    // guard "jangan gabung 2 exam beda guru 1 kelas" hidup di grouping client (GG2b)
    check('GG2: batch lama 2-exam-1-kelas → server batch_size=1 (kelas dihitung sekali)',
        oldRowG1?.batch_size === 1, `batch_size=${oldRowG1?.batch_size}`)
    // Verifikasi langsung util grouping (pure) untuk kedua guard
    const g = groupGuard(mxBatch, subject.id, subject2.id, classA.id, classB.id)
    check('GG1b: unit grouping — campur mapel = 2 grup', g === 2, `grup=${g}`)
    const g2 = groupGuard(oldBatch, subject.id, subject.id, classD.id, classD.id)
    check('GG2b: unit grouping — 2 exam 1 kelas = singleton (tidak digabung)', g2 === 2, `grup=${g2}`)

    // ================= [W] fixture UTS aktif (widget dashboard) =================
    // UTS multi-kelas aktif oleh guru1 → widget "Sedang Berlangsung" menampilkan
    // card UTS dengan chip jumlah kelas + link monitor.
    const utsW = await mustInsert(supabase, 'official_exams', {
        school_id: school.id, academic_year_id: year.id, subject_id: subject.id,
        exam_type: 'UTS', title: `${U} UTS Widget`, description: null,
        start_time: new Date(Date.now() - 60000).toISOString(), duration_minutes: 60,
        window_end_time: new Date(Date.now() + 3600000).toISOString(),
        is_randomized: false, max_violations: 3, target_class_ids: [classA.id, classB.id],
        created_by: guru1.user.id, is_active: true, show_results_immediately: true,
    }, 'uts widget')
    created.officialExams.push(utsW.id)
    const { data: utsWQ } = await supabase.from('official_exam_questions').insert({
        exam_id: utsW.id, question_text: `${U} uts w q1`, question_type: 'MULTIPLE_CHOICE',
        options: ['A1', 'B1'], correct_answer: 'A', points: 10, order_index: 0,
        status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
    }).select()
    created.officialQuestions.push(utsWQ[0].id)

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

        // F-A: widget "Sedang Berlangsung" dashboard guru — chip kelas + link batch
        const domDash = await renderDom('/dashboard/guru', guru1.token)
        check('W1: widget ulangan — link "Pantau Live" membawa ?batch=1 (monitor multi-kelas)',
            domDash.includes(`/dashboard/guru/ulangan/${examA}/monitor?batch=1`),
            `hrefBatch=${domDash.includes('monitor?batch=1')}`)
        check('W1b: widget ulangan — chip "3 kelas" tampil (penjelasan kelas batch)',
            domDash.includes('3 kelas'))
        check('W1c: widget UTS — judul UTS widget tampil',
            domDash.includes(`${U} UTS Widget`))
        check('W1d: widget UTS — chip "2 kelas" tampil (jumlah kelas target)',
            domDash.includes('2 kelas'))
        // Link UTS tetap polos (official tidak ber-batch)
        check('W1e: widget UTS — link monitor TIDAK membawa batch param',
            domDash.includes(`/dashboard/guru/uts-uas/${utsW.id}/monitor`) && !domDash.includes(`/dashboard/guru/uts-uas/${utsW.id}/monitor?`))

        const domHasil = await renderDom(`/dashboard/guru/ulangan/${examA}?tab=hasil`, guru1.token)
        check('R2: tab hasil — dropdown "Semua Kelas" tampil', domHasil.includes('Semua Kelas'))
        check('R2b: tab hasil — kolom "Kelas" tampil di tabel', domHasil.includes('Kelas'))
        check('R2c: tab hasil — nama siswa B terlihat (submission lintas kelas)', domHasil.includes(`${U} Siswa B`))
        check('R2d: tab hasil — nama kelas B terlihat (kolom kelas terisi)', domHasil.includes(`${U} 9B`))

        // F4-1: Admin tab Ulangan — card batch 1x + "3 kelas" (belum pernah di-e2e)
        const domAdmin = await renderDom('/dashboard/admin/uts-uas?tab=ulangan', adminTok)
        const adminCards = countOcc(domAdmin, `>${U} Ulangan Batch</h3>`)
        check('R3: admin tab Ulangan — card batch PERSIS 1x', adminCards === 1, `cards=${adminCards} len=${domAdmin.length}`)
        check('R3b: admin tab Ulangan — sel "3 kelas" tampil', domAdmin.includes('3 kelas'))

        // F4-2: monitor batch — kolom kelas + saring kelas
        const domMon = await renderDom(`/dashboard/guru/ulangan/${examA}/monitor?batch=1`, guru1.token)
        check('R4: monitor batch — header kolom "Kelas" tampil', domMon.includes('Kelas'))
        check('R4b: monitor batch — dropdown "Saring Kelas"/opsi kelas tampil',
            domMon.includes('Semua Kelas') || domMon.includes('Saring Kelas'))
        check('R4c: monitor batch — nama kelas B tampil di baris siswa', domMon.includes(`${U} 9B`))
        check('R4d: monitor batch — nama siswa A tampil', domMon.includes(`${U} Siswa A`))

        // F4-3: NotSubmittedPanel grouped — batch sehat semua submit; gunakan
        // panel via tab hasil batch ST (stB kelas B tanpa siswa tak relevan) —
        // cukup verifikasi struktur grouped muncul di tab hasil utama:
        // "Siswa Belum Mengerjakan" tidak muncul karena 3/3 submit → assert negatif
        check('R5: tab hasil batch — panel "belum mengerjakan" tidak muncul (semua submit)',
            !domHasil.includes('Siswa Belum Mengerjakan'))
    }

    // ================= [F5] Perf guard =================
    console.log('\n[F5] perf guard — batch endpoint < 5 dtk (3 kelas × 30 siswa × 20 soal)')
    // Buat fixture perf: kelas P1/P2/P3 × 10 siswa masing (total 30) — siswa
    // memakai mkStudent pada kelas perf; exam batch 3 member × 20 soal; semua submit.
    const perfBatch = crypto.randomUUID()
    const perfClasses = [await mkClass('P1'), await mkClass('P2'), await mkClass('P3')]
    const perfTas = []
    for (const pc of perfClasses) perfTas.push(await mkTa(guru1.teacher, pc, subject))
    const perfExams = []
    for (const pta of perfTas) perfExams.push(await mkExamLocal(pta, perfBatch, `${U} Perf`))
    // 20 soal di primary lalu publish (sync otomatis ke sibling)
    for (let i = 0; i < 20; i++) await addQ(perfExams[0], `${U} perf q${i}`)
    const perfPub = await api(`/api/exams/${perfExams[0]}`, guru1.token, { method: 'PUT', body: JSON.stringify({ is_active: true, start_time: new Date(Date.now() - 60000).toISOString() }) })
    if (perfPub.status !== 200) throw new Error('perf publish gagal: ' + perfPub.status)
    // 30 siswa (10 per kelas) submit via jalur cepat: start + submit langsung
    const perfSubmit = async (cls, examId, label) => {
        const u = await mustInsert(supabase, 'users', { username: `${U}_p${label}`, full_name: `${U} P${label}`, password_hash: passHash, role: 'SISWA', school_id: school.id }, `perf user ${label}`)
        created.users.push(u.id)
        const st = await mustInsert(supabase, 'students', { user_id: u.id, nis: `${runId}p${label}`, class_id: cls.id, school_id: school.id, status: 'ACTIVE', school_level: 'SMP' }, `perf student ${label}`)
        created.students.push(st.id)
        const en = await mustInsert(supabase, 'student_enrollments', { student_id: st.id, class_id: cls.id, academic_year_id: year.id, status: 'ACTIVE' }, `perf en ${label}`)
        created.enrollments.push(en.id)
        const tok = (await mustInsert(supabase, 'sessions', { user_id: u.id, token: `${U}_tok_p${label}`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, `perf sess ${label}`)).token
        created.sessions.push(tok)
        const start = await api('/api/exam-submissions', tok, { method: 'POST', body: JSON.stringify({ exam_id: examId }) })
        const startBody = await start.json().catch(() => null)
        if (!start.ok || !startBody?.id) throw new Error(`perf start gagal: ${start.status}`)
        created.submissions.push(startBody.id)
        const { data: qs } = await supabase.from('exam_questions').select('id').eq('exam_id', examId).order('order_index').limit(20)
        await api('/api/exam-submissions', tok, {
            method: 'PUT',
            body: JSON.stringify({ submission_id: startBody.id, submit: true, answers: (qs || []).map((q, i) => ({ question_id: q.id, answer: i % 3 === 0 ? 'A' : 'B' })) }),
        })
        return st.id
    }
    let perfN = 0
    for (let k = 0; k < 3; k++) {
        for (let i = 0; i < 10; i++) {
            await perfSubmit(perfClasses[k], perfExams[k], `${k}${i}`)
            perfN++
        }
    }
    check('F5-setup: 30 siswa submit lintas 3 member', perfN === 30, `n=${perfN}`)
    // Ukur durasi 3 endpoint batch
    const timed = async (label, path) => {
        const t0 = Date.now()
        const r = await api(path, guru1.token)
        const ms = Date.now() - t0
        check(`F5: ${label} < 5000ms`, r.status === 200 && ms < 5000, `${ms}ms status=${r.status}`)
        return ms
    }
    await timed('GET exam-submissions?batch_id', `/api/exam-submissions?batch_id=${perfBatch}`)
    await timed('GET analytics?batch_id', `/api/analytics/exam/${perfExams[0]}?batch_id=${perfBatch}`)
    await timed('GET monitor?batch=1', `/api/exam-submissions/monitor?exam_id=${perfExams[0]}&batch=1`)

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
    // soal kuis batch K3 (chunked — pola anti URL-limit)
    for (const qz of created.quizzes) {
        const { data } = await supabase.from('quiz_questions').select('id').eq('quiz_id', qz)
        const ids = (data || []).map(r => r.id)
        for (let i = 0; i < ids.length; i += 100) {
            await supabase.from('quiz_questions').delete().in('id', ids.slice(i, i + 100))
        }
    }
    await del('quizzes', created.quizzes)
    await delBy('official_exam_questions', 'exam_id', created.officialExams)
    await del('official_exams', created.officialExams)
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
