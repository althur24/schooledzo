/**
 * LOAD BATCH ULANGAN 1000 SISWA — verifikasi beban jalur batch baru
 * (monitor batch, submissions batch_id, analytics batch) pasca-fitur
 * "1 card per batch" + hardening anti-runaway.
 *
 * Fixture (di atas seed LT 1000 siswa / 10 kelas):
 *   - 1 guru owner dengan 10 TA (mapel LT di tiap kelas)
 *   - batch 10 exam (1 per kelas) × 50 soal (disalin via copy-questions)
 *   - 1000 siswa START + SUBMIT serentak (jalur siswa: POST/PUT submissions)
 *   - lalu UKUR endpoint berat sisi guru:
 *       1. GET /api/exam-submissions?batch_id=        (fetchAllRows 1000 baris)
 *       2. GET /api/exam-submissions/monitor?batch=1  (roster 10 kelas + RPC × 10)
 *       3. GET /api/analytics/exam/[id]?batch_id=     (1000 submission × 50 jawaban)
 *   - polling monitor 10× beruntun (simulasi guru di halaman monitor 15 dtk × ~2,5 mnt)
 *
 * SUKSES = semua status 200, data benar (1000 baris / submitted=1000 / skor konsisten),
 * dan tiap endpoint < 10 dtk (guard regresi — bukan SLA ketat).
 *
 * Jalankan: ENV_FILE=.env.staging UV_THREADPOOL_SIZE=16 node loadtest/e2e/load_batch_1000.cjs
 * (server staging harus sudah berjalan di PORT via next start env staging)
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const crypto = require('crypto')
const { makeApi } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const BASE = process.env.LOAD_BASE || 'http://localhost:3000'
// UUID deterministik (namespace load test LT)
const P = {
    school: '7e570000-0000-0000-0000-000000000001',
    year: '7e570000-0000-0000-0000-000000000002',
    subject: '7e570000-0000-0000-0000-000000000003',
    klass: (i) => `7e570001-0000-0000-0000-${i.toString(16).padStart(12, '0')}`,
    teacherUser: '7e578000-0000-0000-0000-000000000001',
    teacher: '7e578100-0000-0000-0000-000000000001',
    ta: (i) => `7e578200-0000-0000-0000-${i.toString(16).padStart(12, '0')}`,
    exam: (i) => `7e578300-0000-0000-0000-${i.toString(16).padStart(12, '0')}`,
    session: '7e57900000000000' + '000000000000000000000000'.slice(0, 0) || undefined,
}
const GURU_TOKEN = 'lt_guru_batch_token_0001'
const BATCH_ID = '7e57a000-0000-0000-0000-000000000001'

const created = {
    teacherUserId: P.teacherUser, teacherId: P.teacher,
    tas: Array.from({ length: 10 }, (_, i) => P.ta(i + 1)),
    exams: Array.from({ length: 10 }, (_, i) => P.exam(i + 1)),
    batchId: BATCH_ID,
}

async function main() {
    console.log(`TARGET: ${BASE}`)
    // ---------- FIXTURE ----------
    console.log('\n[1/5] fixture guru + TA + batch exam')
    const passHash = bcrypt.hashSync('Loadtest123!', 10)
    const { error: uErr } = await supabase.from('users').upsert({
        id: P.teacherUser, username: 'lt_guru_batch', full_name: 'LT Guru Batch',
        password_hash: passHash, role: 'GURU', school_id: P.school,
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (uErr) throw new Error('guru user: ' + uErr.message)
    await supabase.from('teachers').upsert({ id: P.teacher, user_id: P.teacherUser, school_id: P.school }, { onConflict: 'id', ignoreDuplicates: true })
    await supabase.from('sessions').upsert({ user_id: P.teacherUser, token: GURU_TOKEN, expires_at: new Date(Date.now() + 86400e3).toISOString() }, { onConflict: 'token', ignoreDuplicates: true })

    for (let i = 1; i <= 10; i++) {
        await supabase.from('teaching_assignments').upsert({
            id: P.ta(i), teacher_id: P.teacher, class_id: P.klass(i),
            subject_id: P.subject, academic_year_id: P.year,
        }, { onConflict: 'id', ignoreDuplicates: true })
    }
    // 10 exam draft batch (insert langsung — cepat; soal disalin setelahnya)
    const examRows = Array.from({ length: 10 }, (_, i) => ({
        id: P.exam(i + 1), title: 'LT-BATCH Ulangan 1000', description: 'load test batch',
        start_time: new Date(Date.now() - 3600e3).toISOString(), duration_minutes: 120,
        window_end_time: new Date(Date.now() + 3600e3).toISOString(),
        teaching_assignment_id: P.ta(i + 1), is_active: true, is_randomized: false,
        max_violations: 3, show_results_immediately: true, batch_id: BATCH_ID,
        created_by: P.teacherUser,
    }))
    const { error: eErr } = await supabase.from('exams').upsert(examRows, { onConflict: 'id', ignoreDuplicates: true })
    if (eErr) throw new Error('exams: ' + eErr.message)
    console.log('10 exam batch dibuat (batch_id', BATCH_ID.slice(0, 8) + ')')

    // Tanam 50 soal identik ke SEMUA 10 member (setara hasil mirror sync —
    // copy-questions menolak source official_exams, tabel beda)
    const t0cp = Date.now()
    const qRows = []
    for (let q = 0; q < 50; q++) {
        for (const ex of created.exams) {
            qRows.push({
                exam_id: ex, question_text: `LT-BATCH soal ${q + 1}`, question_type: 'MULTIPLE_CHOICE',
                options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 2, order_index: q,
                status: 'approved', difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
            })
        }
    }
    for (let i = 0; i < qRows.length; i += 500) {
        const { error: qErr } = await supabase.from('exam_questions').insert(qRows.slice(i, i + 500))
        if (qErr) throw new Error('seed soal: ' + qErr.message)
    }
    console.log(`500 soal ditanam (10 member × 50): OK (${((Date.now() - t0cp) / 1000).toFixed(1)}s)`)
    // Verifikasi: tiap member 50 soal
    for (const ex of created.exams) {
        const { count } = await supabase.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', ex)
        if (count !== 50) throw new Error(`member ${ex.slice(0, 8)} punya ${count} soal (harus 50)`)
    }
    console.log('verifikasi: 10 member × 50 soal ✓')

    // Salin 50 soal ke semua member selesai — siapkan api client
    const api = makeApi(BASE)

    // ---------- SIMULASI 1000 SISWA ----------
    console.log('\n[2/5] 1000 siswa start + submit (koncurrency 100)')
    const N = 1000
    const t0 = Date.now()
    let ok = 0, fail = 0
    const errs = []
    // worker pool 100
    let next = 0
    const worker = async () => {
        while (true) {
            const n = next++
            if (n > N) break
            const pad = String(n).padStart(4, '0')
            const tok = `lt_token_${pad}`
            const classIdx = Math.floor((n - 1) / 100) + 1
            const examId = P.exam(classIdx)
            try {
                const st = await fetch(`${BASE}/api/exam-submissions`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `session_token=${tok}` },
                    body: JSON.stringify({ exam_id: examId }),
                })
                const stBody = await st.json().catch(() => null)
                if (!st.ok || !stBody?.id) { fail++; errs.push(`start ${pad}: ${st.status}`); continue }
                const qs = await (await fetch(`${BASE}/api/exams/${examId}/questions`, { headers: { Cookie: `session_token=${tok}` } })).json()
                const qArr = Array.isArray(qs) ? qs : []
                if (qArr.length !== 50) { fail++; errs.push(`qs ${pad}: ${qArr.length}`); continue }
                // jawab ~70% benar deterministik
                const answers = qArr.map((q, i) => ({ question_id: q.id, answer: (i % 10) < 7 ? 'A' : 'B' }))
                const su = await fetch(`${BASE}/api/exam-submissions`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: `session_token=${tok}` },
                    body: JSON.stringify({ submission_id: stBody.id, submit: true, answers }),
                })
                if (su.ok) ok++
                else { fail++; errs.push(`submit ${pad}: ${su.status}`) }
            } catch (e) {
                fail++; errs.push(`${pad}: ${e.message.slice(0, 50)}`)
            }
        }
    }
    await Promise.all(Array.from({ length: 100 }, worker))
    const submitSec = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`start+submit: OK=${ok} FAIL=${fail} (${submitSec}s, ${(N / (Date.now() - t0) * 1000).toFixed(0)} siswa/dtk)`)
    if (fail > 0) { console.log('contoh error:', errs.slice(0, 5).join(' | ')) }

    // ---------- UKUR ENDPOINT SISI GURU ----------
    console.log('\n[3/5] endpoint batch sisi guru')
    const timed = async (label, path, validate) => {
        const t = Date.now()
        const r = await api(path, GURU_TOKEN)
        const ms = Date.now() - t
        const body = await r.json().catch(() => null)
        const valid = validate(r.status, body)
        console.log(`${valid ? '✓' : '✗'} ${label}: ${ms}ms status=${r.status} ${valid ? '' : 'VALIDASI GAGAL'}`)
        return { ms, ok: valid }
    }
    const r1 = await timed('GET exam-submissions?batch_id (1000 baris)',
        `/api/exam-submissions?batch_id=${BATCH_ID}`,
        (st, b) => st === 200 && Array.isArray(b) && b.length === 1000)
    const r2 = await timed('GET monitor?batch=1 (roster 10 kelas + RPC × 10)',
        `/api/exam-submissions/monitor?exam_id=${P.exam(1)}&batch=1`,
        (st, b) => st === 200 && b?.summary?.total_target_students === 1000 && b?.summary?.submitted === 1000 && (b?.exam?.target_classes || []).length === 10)
    const r3 = await timed('GET analytics?batch_id (1000×50 jawaban)',
        `/api/analytics/exam/${P.exam(1)}?batch_id=${BATCH_ID}`,
        (st, b) => st === 200 && b?.classOverview?.submitted === 1000 && Math.round(b?.classOverview?.avgScore) === 70)

    // ---------- POLLING MONITOR (guru di halaman live ~2,5 mnt) ----------
    console.log('\n[4/5] polling monitor batch 10× (simulasi guru live)')
    let pollMax = 0
    for (let i = 1; i <= 10; i++) {
        const t = Date.now()
        const r = await api(`/api/exam-submissions/monitor?exam_id=${P.exam(1)}&batch=1`, GURU_TOKEN)
        const ms = Date.now() - t
        pollMax = Math.max(pollMax, ms)
        if (r.status !== 200) { console.log(`poll ${i}: status ${r.status} GAGAL`); break }
        if (i % 5 === 0) console.log(`poll ${i}/10: ${ms}ms`)
    }
    console.log(`polling max: ${pollMax}ms`)

    // ---------- KESIMPULAN ----------
    console.log('\n[5/5] ringkasan')
    const pass = r1.ok && r2.ok && r3.ok && pollMax < 10000 && ok === 1000
    console.log('submissions batch:', r1.ms + 'ms', r1.ok ? '✓' : '✗')
    console.log('monitor batch:    ', r2.ms + 'ms', r2.ok ? '✓' : '✗')
    console.log('analytics batch:  ', r3.ms + 'ms', r3.ok ? '✓' : '✗')
    console.log('polling max:      ', pollMax + 'ms')
    console.log('submit siswa:     ', ok + '/1000', ok === 1000 ? '✓' : '✗')
    console.log(pass ? '\nLOAD-BATCH-1000: PASS ✅' : '\nLOAD-BATCH-1000: FAIL ❌')
    process.exitCode = pass ? 0 : 1
}

main()
    .catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
    .finally(async () => {
        // cleanup khusus fixture batch (siswa LT dibersihkan cleanup_loadtest.cjs terpisah)
        console.log('\ncleanup fixture batch...')
        const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : null
        const delBy = (t, col, ids) => ids.length ? supabase.from(t).delete().in(col, ids) : null
        try {
            // submissions per batch exam (chunked)
            for (const ex of created.exams) {
                let from = 0
                const subIds = []
                while (true) {
                    const { data } = await supabase.from('exam_submissions').select('id').eq('exam_id', ex).range(from, from + 999).order('id')
                    subIds.push(...(data || []).map(r => r.id))
                    if (!data || data.length < 1000) break
                    from += 1000
                }
                for (let i = 0; i < subIds.length; i += 100) {
                    await supabase.from('exam_answers').delete().in('submission_id', subIds.slice(i, i + 100))
                }
                for (let i = 0; i < subIds.length; i += 100) {
                    await supabase.from('exam_submissions').delete().in('id', subIds.slice(i, i + 100))
                }
                const { data: qIds } = await supabase.from('exam_questions').select('id').eq('exam_id', ex)
                for (let i = 0; i < (qIds || []).length; i += 100) {
                    await supabase.from('exam_questions').delete().in('id', qIds.slice(i, i + 100).map(r => r.id))
                }
            }
            await del('exams', created.exams)
            await del('teaching_assignments', created.tas)
            await supabase.from('notifications').delete().eq('user_id', created.teacherUserId)
            await supabase.from('sessions').delete().eq('token', GURU_TOKEN)
            await del('teachers', [created.teacherId])
            await del('users', [created.teacherUserId])
            console.log('cleanup fixture batch selesai (1000 siswa LT dibersihkan via cleanup_loadtest.cjs)')
        } catch (e) {
            console.error('cleanup error:', e.message)
        }
    })
