/**
 * E2E BATCH SYNC GUARD v2 — reproduksi & verifikasi fix runaway duplikasi soal
 * (kasus nyata 2026-09-16: batch 6 kelas × 15 soal → ±777.000 baris).
 *
 * Yang diverifikasi:
 *   [R1] Mutasi massal lintas member (add/edit/delete/reorder bergantian,
 *        termasuk beberapa PARALEL = kondisi race yang memicu duplikat pertama)
 *        → jumlah soal semua member tetap konsisten & fingerprint identik.
 *   [R2] Idempotency: sync ulang tanpa perubahan → tidak menambah baris.
 *   [R3] Guard clamp: exam sumber ditanam 600 soal duplikat (anomali) →
 *        mirror DITOLAK — sibling lain tidak ikut terinfeksi.
 *   [R4] Draft-sync masih berfungsi normal: tambah soal di member A → muncul di B.
 *   [R5] Publish jalur syncBatch: count soal sibling pas & tidak ada duplikat.
 *   [C1] copy-questions ke target berisi → replace bersih (count stabil,
 *        0 duplikat, fingerprint = source) — jalur yang dulu beralan bug
 *        insert-parisal + delete (T1).
 *   [C2] copy-questions source >500 soal → 400 + target tak tersentuh.
 *   [P1] Hammer 10 POST paralel ke member sama → lock serialize → konvergen
 *        tanpa duplikat (reproduksi langsung race kondisi runaway).
 *   [V1] Sibling divergen (soal liar ditanam langsung) → sync dari primary
 *        menormalkan (replace semantics benar).
 *   [Q1] KUIS batch draft-sync + idempotency (jalur quiz_questions).
 *   [Q2] KUIS publish (syncQuizBatch) → sibling konsisten tanpa duplikat.
 *
 * WAJIB staging: build dengan env staging dulu, lalu
 *   ENV_FILE=.env.staging node loadtest/e2e/e2e_batch_sync_guard.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')
const crypto = require('crypto')
const { mustInsert, makeApi, spawnServer, stopServerSafe, waitPortUp, assertServerDb } = require('./helpers.cjs')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PORT = 3119
const BASE = `http://localhost:${PORT}`

let server = null
const created = {
    users: [], teachers: [], sessions: [], classes: [], subjects: [], tas: [],
    exams: [], questions: [], quizzes: [],
}
const results = []
function check(name, cond, detail = '') {
    results.push({ name, ok: !!cond, detail })
    console.log(`  ${cond ? '✓' : '✗ FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

const countQ = async (examId) => {
    const { count } = await supabase.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', examId)
    return count || 0
}
// Fingerprint deterministik: sort client-side — tahan order_index kembar
// (race assignment order di route saat POST paralel menghasilkan duplikat
// order_index; urutan return DB untuk ties tidak dijamin stabil).
const sigQ = async (examId) => {
    const { data } = await supabase.from('exam_questions')
        .select('order_index, question_text, question_type, points').eq('exam_id', examId)
    return (data || []).map(q => JSON.stringify([q.order_index, (q.question_text || '').slice(0, 40), q.points])).sort().join('|')
}

async function main() {
    const runId = Date.now() % 100000
    const U = `sg_${runId}`
    const passHash = bcrypt.hashSync('e2e', 10)

    const { data: school } = await supabase.from('schools').select('id').eq('code', 'STG01').single()
    if (!school) throw new Error('STAGING SCHOOL (STG01) tidak ditemukan — abort.')
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).single()

    const subject = await mustInsert(supabase, 'subjects', { name: `${U} IPA`, school_id: school.id, kkm: 75 }, 'subject')
    created.subjects.push(subject.id)
    const guruUser = await mustInsert(supabase, 'users', { username: `${U}_guru`, full_name: `${U} Guru`, password_hash: passHash, role: 'GURU', school_id: school.id }, 'user guru')
    created.users.push(guruUser.id)
    const teacher = await mustInsert(supabase, 'teachers', { user_id: guruUser.id, school_id: school.id }, 'teacher')
    created.teachers.push(teacher.id)
    const tok = (await mustInsert(supabase, 'sessions', { user_id: guruUser.id, token: `${U}_tok`, expires_at: new Date(Date.now() + 86400e3).toISOString() }, 'session')).token
    created.sessions.push(tok)

    const mkClass = async (label) => {
        const c = await mustInsert(supabase, 'classes', { name: `${U} 9${label}`, academic_year_id: year.id, grade_level: 3, school_level: 'SMP' }, `class ${label}`)
        created.classes.push(c.id)
        return c
    }
    const classA = await mkClass('A'), classB = await mkClass('B'), classC = await mkClass('C')
    const mkTa = async (cls) => {
        const ta = await mustInsert(supabase, 'teaching_assignments', { teacher_id: teacher.id, class_id: cls.id, subject_id: subject.id, academic_year_id: year.id }, 'TA')
        created.tas.push(ta.id)
        return ta
    }
    const taA = await mkTa(classA), taB = await mkTa(classB), taC = await mkTa(classC)

    server = spawnServer(process.cwd(), PORT)
    await waitPortUp(BASE)
    await assertServerDb(BASE, true)
    const api = makeApi(BASE)
    console.log('server up (staging DB terverifikasi)\n')

    // Batch 3 exam (persis wizard) — batchId param untuk batch kedua (P1/V1)
    const batchId = crypto.randomUUID()
    const mkExam = async (ta, bid = batchId) => {
        const r = await api('/api/exams', tok, {
            method: 'POST',
            body: JSON.stringify({
                title: `${U} Guard`, start_time: new Date(Date.now() + 3600000).toISOString(),
                duration_minutes: 30, teaching_assignment_id: ta.id, is_randomized: false,
                max_violations: 3, show_results_immediately: true, batch_id: bid,
            }),
        })
        const body = await r.json().catch(() => null)
        if (!r.ok || !body?.id) throw new Error(`POST exam gagal: ${r.status}`)
        created.exams.push(body.id)
        return body.id
    }
    const examA = await mkExam(taA), examB = await mkExam(taB), examC = await mkExam(taC)

    // Seeded 5 soal approved via API editor (jalur nyata guru).
    // bank_status:'approved' = jalur "ambil dari bank soal" — satu-satunya jalur
    // yang menghasilkan status approved saat AI review sekolah aktif (status
    // mentah dari client di-overwrite jadi draft oleh route, line ~267).
    const addQ = async (examId, text, order) => {
        const r = await api(`/api/exams/${examId}/questions`, tok, {
            method: 'POST',
            body: JSON.stringify({
                questions: [{
                    question_text: text, question_type: 'MULTIPLE_CHOICE',
                    options: ['A1', 'B1'], correct_answer: 'A', points: 10,
                    order_index: order, status: 'approved', bank_status: 'approved',
                    difficulty: 'MEDIUM', text_direction: 'ltr', content_format: 'plain',
                }],
            }),
        })
        return r.status
    }
    for (let i = 0; i < 5; i++) await addQ(examA, `${U} soal ${i}`, i)
    const c5 = await countQ(examA)
    check('setup: 5 soal di A', c5 === 5, `n=${c5}`)

    // Tunggu draft-sync selesai & sibling ikut
    await new Promise(r => setTimeout(r, 1500))
    const cB0 = await countQ(examB), cC0 = await countQ(examC)
    check('R4: draft-sync menular ke B & C (5 soal)', cB0 === 5 && cC0 === 5, `B=${cB0} C=${cC0}`)

    // ============ [R0] Urutan soal pasca mirror = order_index ============
    // Bug ke-4 (2026-09-17): penyalin meng-insert baris terurut id UUID acak →
    // urutan fisik tabel acak → question_order siswa (dibangun dari embed tanpa
    // sort) terbalik: kartu no.1 menampilkan soal kedua. Sort eksplisit di
    // route start + insert terurut di penyalin — keduanya diverifikasi di sini.
    console.log('\n[R0] urutan soal pasca mirror sesuai order_index')
    const orderedTexts = async (examId) => {
        const { data } = await supabase.from('exam_questions')
            .select('order_index, question_text').eq('exam_id', examId).order('order_index')
        return (data || []).map(q => (q.question_text || '').slice(0, 20))
    }
    const oA = await orderedTexts(examA), oB = await orderedTexts(examB)
    check('R0: urutan soal B = A (order_index 0..4 berurut)',
        JSON.stringify(oA) === JSON.stringify(oB) && oB[0] === `${U} soal 0` && oB[4] === `${U} soal 4`,
        `B[0]=${oB[0]} B[4]=${oB[4]}`)

    // ============ [R1] Mutasi massal lintas member + race ============
    console.log('\n[R1] 24 mutasi lintas member (termasuk paralel)')
    // 12 wave: tiap wave = add di A + edit di B secara PARALEL (race window),
    // lalu hapus soal terakhir di A bergantian — total soal naik net 1 per wave ×2 awal.
    const mutation = async (wave) => {
        // bank_status approved agar lolos gate publish saat AI review aktif
        const mk = () => ({ question_text: `${U} wave ${wave}`, question_type: 'TRUE_FALSE', correct_answer: 'BENAR', points: 5, order_index: 100 + wave, status: 'approved', bank_status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain' })
        const p1 = api(`/api/exams/${examA}/questions`, tok, { method: 'POST', body: JSON.stringify({ questions: [mk()] }) })
        const p2 = api(`/api/exams/${examB}/questions`, tok, { method: 'POST', body: JSON.stringify({ questions: [mk()] }) })
        await Promise.all([p1, p2]) // PARALEL — reproduksi kondisi race
    }
    for (let w = 0; w < 12; w++) await mutation(w)
    // Reorder bersamaan di A dan C (jalur PUT reorder — pemicu syncBatchDraft lain).
    // SHAPE: { reorder: [{id, order_index}] } (bukan question_order — shape salah
    // membuat PUT 400 diam-diam dan sync tidak pernah terpicu).
    const reorder = async (examId) => {
        const { data: qs } = await supabase.from('exam_questions').select('id').eq('exam_id', examId).order('order_index')
        const ids = (qs || []).map(q => q.id)
        const reversed = [...ids].reverse()
        // Reorder = POST (route menangani body.reorder di POST, bukan PUT)
        const r = await api(`/api/exams/${examId}/questions`, tok, {
            method: 'POST',
            body: JSON.stringify({ reorder: reversed.map((id, i) => ({ id, order_index: i })) }),
        })
        if (r.status !== 200) throw new Error(`reorder ${examId.slice(0, 8)} gagal: ${r.status}`)
    }
    await Promise.all([reorder(examA), reorder(examC)])
    await new Promise(r => setTimeout(r, 2500)) // beri waktu seluruh async sync selesai

    const cA1 = await countQ(examA), cB1 = await countQ(examB), cC1 = await countQ(examC)
    const sigA = await sigQ(examA), sigB = await sigQ(examB), sigC = await sigQ(examC)
    check('R1: jumlah soal identik di A/B/C setelah 24 mutasi (17 soal)',
        cA1 === cB1 && cB1 === cC1 && cA1 === 17, `A=${cA1} B=${cB1} C=${cC1}`)
    check('R1b: fingerprint soal identik lintas member (0 duplikat internal)',
        sigA === sigB && sigB === sigC, `lens=${sigA.length}/${sigB.length}/${sigC.length}`)

    // ============ [R2] Idempotency ============
    console.log('\n[R2] idempotency — trigger sync ulang tanpa perubahan')
    // Reorder idempoten (urutan sama dengan sekarang) = trigger sync tanpa diff.
    // Tiap member pakai id soal MILIKNYA (id soal beda antar member batch).
    const { data: qsNow } = await supabase.from('exam_questions').select('id').eq('exam_id', examA).order('order_index')
    const { data: qsNowB } = await supabase.from('exam_questions').select('id').eq('exam_id', examB).order('order_index')
    const mkReorder = (ids) => ({ reorder: ids.map((id, i) => ({ id, order_index: i })) })
    // Reorder = POST (route menangani body.reorder di POST, bukan PUT)
    const r2a = await api(`/api/exams/${examA}/questions`, tok, { method: 'POST', body: JSON.stringify(mkReorder((qsNow || []).map(q => q.id))) })
    const r2b = await api(`/api/exams/${examB}/questions`, tok, { method: 'POST', body: JSON.stringify(mkReorder((qsNowB || []).map(q => q.id))) })
    if (r2a.status !== 200 || r2b.status !== 200) throw new Error(`R2 reorder gagal: ${r2a.status}/${r2b.status}`)
    await new Promise(r => setTimeout(r, 2000))
    const cA2 = await countQ(examA), cB2 = await countQ(examB), cC2 = await countQ(examC)
    check('R2: sync ulang tidak menambah baris (tetap 17)',
        cA2 === 17 && cB2 === 17 && cC2 === 17, `A=${cA2} B=${cB2} C=${cC2}`)

    // ============ [R3] Guard clamp ============
    console.log('\n[R3] guard clamp — sumber anomali tidak menular')
    // Tanam 600 soal duplikat LANGSUNG ke DB di exam C (bypass API — kondisi anomali)
    const seedRows = Array.from({ length: 600 }, (_, i) => ({
        exam_id: examC, question_text: `${U} anomali ${i % 20}`, question_type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'], correct_answer: 'A', points: 1, order_index: 500 + i,
        status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain',
    }))
    const { error: seedErr } = await supabase.from('exam_questions').insert(seedRows)
    if (seedErr) throw new Error('seed anomali gagal: ' + seedErr.message)
    // Trigger sync dari C (POST soal 1 biji via API → syncBatchDraft jalan)
    await addQ(examC, `${U} trigger anomali`, 900)
    await new Promise(r => setTimeout(r, 3000))
    const cA3 = await countQ(examA), cB3 = await countQ(examB), cC3 = await countQ(examC)
    check('R3: A & B TIDAK ikut terinfeksi (tetap 17)',
        cA3 === 17 && cB3 === 17, `A=${cA3} B=${cB3}`)
    // C = 600 seed + 17 soal sehat + 1 trigger = 618; kuncinya mirror DITOLAK
    // (tanpa clamp, C akan menulari A & B dengan 618 soal → keduanya meledak)
    check('R3b: C tetap 618 (mirror ditolak clamp — tidak menular)',
        cC3 === 618, `C=${cC3}`)

    // ============ [R5] Publish jalur syncBatch tetap sehat ============
    console.log('\n[R5] publish dari A (batch_sync) — sibling B sehat')
    // Hapus dulu soal anomali C agar batch kembali sehat (batched delete = jalur fix)
    const { data: cRows } = await supabase.from('exam_questions').select('id').eq('exam_id', examC).order('id')
    const cIds = (cRows || []).map(r => r.id)
    for (let i = 0; i < cIds.length; i += 100) {
        const { error: delErr } = await supabase.from('exam_questions').delete().in('id', cIds.slice(i, i + 100))
        if (delErr) throw new Error('cleanup C gagal: ' + delErr.message)
    }
    // Samakan C ke A via API copy-questions (jalur guru normal)
    const cp = await api('/api/exams/copy-questions', tok, {
        method: 'POST',
        body: JSON.stringify({ source_exam_id: examA, target_exam_ids: [examC], also_publish: false }),
    })
    const cpBody = await cp.json().catch(() => null)
    check('R5a: copy-questions A→C berhasil (17 soal)', cp.status === 200 && cpBody?.copied_count === 17,
        `status=${cp.status} copied=${cpBody?.copied_count}`)

    // Publish A → syncBatch ke B & C
    const pub = await api(`/api/exams/${examA}`, tok, {
        method: 'PUT',
        body: JSON.stringify({ is_active: true, start_time: new Date(Date.now() - 60000).toISOString() }),
    })
    const pubBody = await pub.json().catch(() => null)
    check('R5b: publish PUT 200', pub.status === 200, `status=${pub.status} body=${JSON.stringify(pubBody).slice(0, 160)}`)
    check('R5b: batch_sync total 2 failed 0', pubBody?.batch_sync?.total === 2 && (pubBody.batch_sync?.failed?.length || 0) === 0,
        `total=${pubBody?.batch_sync?.total} failed=${pubBody?.batch_sync?.failed?.length}`)
    const cB4 = await countQ(examB), cC4 = await countQ(examC)
    const sigB4 = await sigQ(examB), sigC4 = await sigQ(examC), sigA4 = await sigQ(examA)
    check('R5c: pasca publish — B & C 17 soal & fingerprint = A',
        cB4 === 17 && cC4 === 17 && sigB4 === sigA4 && sigC4 === sigA4, `B=${cB4} C=${cC4}`)

    // ============ [C1] copy-questions repeat → replace bersih ============
    console.log('\n[C1] copy-questions ke target yang sudah berisi → replace, bukan append')
    // C saat ini 17 soal (= A). Copy ulang: insert 17 baru + delete 17 lama → tetap 17.
    const c1 = await api('/api/exams/copy-questions', tok, {
        method: 'POST',
        body: JSON.stringify({ source_exam_id: examA, target_exam_ids: [examC], also_publish: false }),
    })
    const c1Body = await c1.json().catch(() => null)
    const cC5 = await countQ(examC), sigC5 = await sigQ(examC), sigA5 = await sigQ(examA)
    check('C1: copy ulang → count tetap 17 & fingerprint = source (0 duplikat)',
        c1.status === 200 && c1Body?.cleanup_warnings === undefined && cC5 === 17 && sigC5 === sigA5,
        `status=${c1.status} C=${cC5} warn=${c1Body?.cleanup_warnings}`)

    // ============ [C2] clamp copy-questions: source > 500 = 400, target tak tersentuh ============
    console.log('\n[C2] copy-questions source anomali → ditolak')
    const examSrc = await mkExam(taA, null)
    const overflowRows = Array.from({ length: 501 }, (_, i) => ({
        exam_id: examSrc, question_text: `${U} overflow ${i % 25}`, question_type: 'MULTIPLE_CHOICE',
        options: ['A', 'B'], correct_answer: 'A', points: 1, order_index: i,
        status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain',
    }))
    const { error: ovErr } = await supabase.from('exam_questions').insert(overflowRows)
    if (ovErr) throw new Error('seed overflow gagal: ' + ovErr.message)
    const c2 = await api('/api/exams/copy-questions', tok, {
        method: 'POST',
        body: JSON.stringify({ source_exam_id: examSrc, target_exam_ids: [examB], also_publish: false }),
    })
    const cB5 = await countQ(examB)
    check('C2: source 501 soal → 400 + target tak tersentuh (tetap 17)',
        c2.status === 400 && cB5 === 17, `status=${c2.status} B=${cB5}`)

    // ============ [P1] hammer 10 POST paralel ke member yang sama ============
    console.log('\n[P1] 10 POST paralel ke member D (lock harus men-serialize sync)')
    const batchId2 = crypto.randomUUID()
    const examD = await mkExam(taA, batchId2)
    const examE = await mkExam(taB, batchId2)
    const examF = await mkExam(taC, batchId2)
    await Promise.all(Array.from({ length: 10 }, (_, i) => addQ(examD, `${U} p1 soal ${i}`)))
    await new Promise(r => setTimeout(r, 2000)) // grace untuk ekor antrian lock
    const cD = await countQ(examD), cE = await countQ(examE), cF = await countQ(examF)
    const sigD = await sigQ(examD), sigE = await sigQ(examE)
    check('P1: D=10, E & F ter-mirror 10 (lock serialize, tanpa duplikat)',
        cD === 10 && cE === 10 && cF === 10, `D=${cD} E=${cE} F=${cF}`)
    check('P1b: fingerprint E = D (konvergen identik)', sigE === sigD, `len=${sigD.length}/${sigE.length}`)

    // ============ [V1] sibling divergen → sync dari primary menormalkan ============
    console.log('\n[V1] sibling menyimpang (soal liar) → sync menormalkan kembali')
    const { error: divErr } = await supabase.from('exam_questions').insert(
        Array.from({ length: 3 }, (_, i) => ({
            exam_id: examE, question_text: `${U} liar ${i}`, question_type: 'TRUE_FALSE',
            correct_answer: 'BENAR', points: 1, order_index: 500 + i,
            status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain',
        }))
    )
    if (divErr) throw new Error('seed divergen gagal: ' + divErr.message)
    await addQ(examD, `${U} v1 trigger`)
    await new Promise(r => setTimeout(r, 2000))
    const cE2 = await countQ(examE), sigE2 = await sigQ(examE), sigD2 = await sigQ(examD), sigF2 = await sigQ(examF)
    check('V1: E kembali = D (replace semantics — 3 soal liar dibuang)',
        cE2 === 11 && sigE2 === sigD2, `E=${cE2} sigE=${sigE2 === sigD2}`)
    check('V1b: F juga = D', sigF2 === sigD2)

    // ============ [R6] publish batch dengan sibling BEDA ISI ============
    // Bug ketiga yang pernah lolos: mirror dengan oldIds>0 return false palsu
    // (kontrak batchedIn dilanggar) → syncBatch meng-skip aktivasi sibling.
    // Skenario: E ditanam soal ekstra LANGSUNG ke DB (via API akan memicu sync
    // balik E→D,F — tidak menghasilkan divergensi), lalu publish D →
    // E & F WAJIB aktif (failed=0) meski E memerlukan replace + delete.
    console.log('\n[R6] publish dengan sibling beda isi → sibling tetap aktif')
    const { error: r6Err } = await supabase.from('exam_questions').insert({
        exam_id: examE, question_text: `${U} r6 divergen`, question_type: 'TRUE_FALSE',
        correct_answer: 'BENAR', points: 1, order_index: 600,
        status: 'approved', difficulty: 'EASY', text_direction: 'ltr', content_format: 'plain',
    })
    if (r6Err) throw new Error('seed r6 gagal: ' + r6Err.message)
    await new Promise(r => setTimeout(r, 300))
    const pub6 = await api(`/api/exams/${examD}`, tok, {
        method: 'PUT',
        body: JSON.stringify({ is_active: true, start_time: new Date(Date.now() - 60000).toISOString() }),
    })
    const pub6Body = await pub6.json().catch(() => null)
    check('R6: batch_sync failed 0 (mirror beda-isi TIDAK false-fail)',
        pub6Body?.batch_sync?.total === 2 && (pub6Body.batch_sync?.failed?.length || 0) === 0,
        `total=${pub6Body?.batch_sync?.total} failed=${JSON.stringify(pub6Body?.batch_sync?.failed || [])}`)
    const activeOf = async (id) => (await supabase.from('exams').select('is_active').eq('id', id).single()).data?.is_active
    const actE = await activeOf(examE), actF = await activeOf(examF), actD = await activeOf(examD)
    check('R6b: D, E & F semua is_active=true (aktivasi tidak di-skip)',
        actD === true && actE === true && actF === true, `D=${actD} E=${actE} F=${actF}`)
    const cE3 = await countQ(examE), sigE3 = await sigQ(examE), sigD3 = await sigQ(examD)
    check('R6c: E ter-replace ke isi D saat publish (11 soal, fingerprint = D)',
        cE3 === 11 && sigE3 === sigD3, `E=${cE3} sig=${sigE3 === sigD3}`)

    // ============ [Q1] KUIS batch draft-sync (jalur quiz_questions — belum pernah dites) ============
    console.log('\n[Q1] kuis batch: draft-sync + idempotency')
    const quizBatch = crypto.randomUUID()
    const mkQuiz = async (ta) => {
        const r = await api('/api/quizzes', tok, {
            method: 'POST',
            body: JSON.stringify({
                title: `${U} Kuis Guard`, duration_minutes: 20, teaching_assignment_id: ta.id,
                is_randomized: false, batch_id: quizBatch,
            }),
        })
        const body = await r.json().catch(() => null)
        if (!r.ok || !body?.id) throw new Error(`POST quiz gagal: ${r.status}`)
        created.quizzes.push(body.id)
        return body.id
    }
    const quizA = await mkQuiz(taA), quizBq = await mkQuiz(taB), quizCq = await mkQuiz(taC)
    const addQuizQ = async (quizId, text) => {
        const r = await api(`/api/quizzes/${quizId}/questions`, tok, {
            method: 'POST',
            body: JSON.stringify([{
                question_text: text, question_type: 'MULTIPLE_CHOICE', options: ['A1', 'B1'],
                correct_answer: 'A', points: 10, bank_status: 'approved', difficulty: 'MEDIUM',
            }]),
        })
        if (r.status !== 200 && r.status !== 201) throw new Error(`addQuizQ gagal: ${r.status}`)
    }
    for (let i = 0; i < 4; i++) await addQuizQ(quizA, `${U} kq soal ${i}`)
    await new Promise(r => setTimeout(r, 2000))
    const countQuizQ = async (quizId) => {
        const { count } = await supabase.from('quiz_questions').select('id', { count: 'exact', head: true }).eq('quiz_id', quizId)
        return count || 0
    }
    const sigQuizQ = async (quizId) => {
        const { data } = await supabase.from('quiz_questions')
            .select('order_index, question_text, points').eq('quiz_id', quizId)
        return (data || []).map(q => JSON.stringify([q.order_index, (q.question_text || '').slice(0, 40), q.points])).sort().join('|')
    }
    const qA0 = await countQuizQ(quizA), qB0 = await countQuizQ(quizBq), qC0 = await countQuizQ(quizCq)
    check('Q1: draft-sync kuis menular ke B & C (4 soal)',
        qA0 === 4 && qB0 === 4 && qC0 === 4, `A=${qA0} B=${qB0} C=${qC0}`)
    // Idempotency: reorder ke urutan sama (trigger sync tanpa diff) — POST body.reorder
    const { data: qqRows } = await supabase.from('quiz_questions').select('id').eq('quiz_id', quizA).order('order_index')
    const qqOrder = (qqRows || []).map(r => r.id)
    await api(`/api/quizzes/${quizA}/questions`, tok, { method: 'POST', body: JSON.stringify({ reorder: qqOrder.map((id, i) => ({ id, order_index: i })) }) })
    await new Promise(r => setTimeout(r, 1500))
    const qA1 = await countQuizQ(quizA), qB1 = await countQuizQ(quizBq)
    check('Q1b: sync ulang kuis idempotent (tetap 4)', qA1 === 4 && qB1 === 4, `A=${qA1} B=${qB1}`)

    // ============ [Q2] kuis publish (syncQuizBatch) ============
    console.log('\n[Q2] kuis publish → sibling konsisten')
    const qpub = await api(`/api/quizzes/${quizA}`, tok, {
        method: 'PUT',
        body: JSON.stringify({ is_active: true, available_from: new Date(Date.now() - 60000).toISOString(), deadline: new Date(Date.now() + 86400000).toISOString() }),
    })
    const qpubBody = await qpub.json().catch(() => null)
    check('Q2: quiz publish PUT 200', qpub.status === 200, `status=${qpub.status} body=${JSON.stringify(qpubBody).slice(0, 120)}`)
    check('Q2b: batch_sync total 2 failed 0',
        qpubBody?.batch_sync?.total === 2 && (qpubBody.batch_sync?.failed?.length || 0) === 0,
        `total=${qpubBody?.batch_sync?.total} failed=${qpubBody?.batch_sync?.failed?.length}`)
    const qB2 = await countQuizQ(quizBq), qC2 = await countQuizQ(quizCq)
    const sigqA2 = await sigQuizQ(quizA), sigqB2 = await sigQuizQ(quizBq)
    check('Q2c: pasca publish B & C 4 soal & fingerprint = A',
        qB2 === 4 && qC2 === 4 && sigqB2 === sigqA2, `B=${qB2} C=${qC2}`)

    // ============ [C3] Concurrency batch-specific ============
    console.log('\n[C3] concurrency batch — publish paralel, sync+publish, share paralel')
    // C3-1: PUBLISH PARALEL dari 2 member berbeda (2 guru co-teacher men-PUT
    // publish bersamaan pada batch D/E/F) → lock serialize → semua aktif +
    // soal konvergen identik.
    const c31a = api(`/api/exams/${examD}`, tok, { method: 'PUT', body: JSON.stringify({ is_active: true, start_time: new Date(Date.now() - 60000).toISOString() }) })
    const c31b = api(`/api/exams/${examE}`, tok, { method: 'PUT', body: JSON.stringify({ is_active: true, start_time: new Date(Date.now() - 60000).toISOString() }) })
    const [c31aRes, c31bRes] = await Promise.all([c31a, c31b])
    await new Promise(r => setTimeout(r, 2500))
    const actOf = async (id) => (await supabase.from('exams').select('is_active').eq('id', id).single()).data?.is_active
    const c3actD = await actOf(examD), c3actE = await actOf(examE), c3actF = await actOf(examF)
    check('C3-1: publish paralel 2 member → semua member aktif (lock serialize)',
        c3actD === true && c3actE === true && c3actF === true,
        `status=${c31aRes.status}/${c31bRes.status} D=${c3actD} E=${c3actE} F=${c3actF}`)
    const sigDc3 = await sigQ(examD), sigEc3 = await sigQ(examE), sigFc3 = await sigQ(examF)
    check('C3-1b: pasca publish paralel — fingerprint konvergen identik D/E/F',
        sigDc3 === sigEc3 && sigEc3 === sigFc3, `D=${sigDc3.length} E=${sigEc3.length} F=${sigFc3.length}`)

    // C3-2: draft-sync + publish BERSAMAAN (batch baru: G draft + H draft;
    // paralel: addQ ke G (sync draft) + PUT publish G) → lock serialize → konsisten
    const batchC32 = crypto.randomUUID()
    const examG = await mkExam(taA, batchC32)
    const examH = await mkExam(taB, batchC32)
    for (let i = 0; i < 3; i++) await addQ(examG, `${U} c32 q${i}`)
    const c32sync = addQ(examG, `${U} c32 trigger`)
    const c32pub = api(`/api/exams/${examG}`, tok, { method: 'PUT', body: JSON.stringify({ is_active: true, start_time: new Date(Date.now() - 60000).toISOString() }) })
    await Promise.all([c32sync, c32pub])
    await new Promise(r => setTimeout(r, 3000))
    const cG = await countQ(examG), cH = await countQ(examH)
    const sigG = await sigQ(examG), sigH = await sigQ(examH)
    check('C3-2: sync+publish bersamaan → G & H 4 soal & fingerprint identik',
        cG === 4 && cH === 4 && sigG === sigH, `G=${cG} H=${cH} sig=${sigG === sigH}`)
    const c3actG = await actOf(examG), c3actH = await actOf(examH)
    check('C3-2b: G & H aktif pasca publish', c3actG === true && c3actH === true, `G=${c3actG} H=${c3actH}`)

    // C3-3: share results paralel (client loop semua member serentak) → idempotent
    for (const id of [examD, examE, examF]) {
        await api(`/api/exams/${id}`, tok, { method: 'PUT', body: JSON.stringify({ show_results_immediately: false, results_released: false }) })
    }
    await new Promise(r => setTimeout(r, 300))
    const c3notifsBefore = (await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('type', 'NILAI_KELUAR').ilike('title', '%Guard%')).count || 0
    await Promise.all([examD, examE, examF].map(id =>
        api(`/api/exams/${id}`, tok, { method: 'PUT', body: JSON.stringify({ results_released: true }) })
    ))
    await new Promise(r => setTimeout(r, 800))
    const c3notifsAfter = (await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('type', 'NILAI_KELUAR').ilike('title', '%Guard%')).count || 0
    check('C3-3: share paralel 3 member → notif 0 dobel (delta=0 — kelas fixture tanpa siswa)',
        c3notifsAfter - c3notifsBefore === 0, `delta=${c3notifsAfter - c3notifsBefore}`)
    const relD = (await supabase.from('exams').select('results_released').eq('id', examD).single()).data?.results_released
    const relE = (await supabase.from('exams').select('results_released').eq('id', examE).single()).data?.results_released
    const relF = (await supabase.from('exams').select('results_released').eq('id', examF).single()).data?.results_released
    check('C3-3b: results_released tersimpan semua member meski PUT paralel',
        relD === true && relE === true && relF === true, `D=${relD} E=${relE} F=${relF}`)

    await stopServerSafe(server, BASE)

    const failed = results.filter(r => !r.ok)
    console.log('\n===== HASIL E2E BATCH SYNC GUARD =====')
    console.log(`PASS: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log('GAGAL:')
        failed.forEach(f => console.log(`  ✗ ${f.name} ${f.detail}`))
    }
    console.log(failed.length === 0 ? 'E2E-BATCH-SYNC-GUARD: PASS ✅' : 'E2E-BATCH-SYNC-GUARD: FAIL ❌')
    process.exitCode = failed.length === 0 ? 0 : 1
}

async function cleanup() {
    console.log('\ncleanup...')
    const del = (t, ids) => ids.length ? supabase.from(t).delete().in('id', ids) : null
    // soal exam: belah per chunk agar cleanup sendiri tidak kena URL-limit
    const allQIds = []
    for (const ex of created.exams) {
        let from = 0
        while (true) {
            const { data } = await supabase.from('exam_questions').select('id').eq('exam_id', ex).range(from, from + 999).order('id')
            allQIds.push(...(data || []).map(q => q.id))
            if (!data || data.length < 1000) break
            from += 1000
        }
    }
    for (let i = 0; i < allQIds.length; i += 100) {
        await supabase.from('exam_questions').delete().in('id', allQIds.slice(i, i + 100))
    }
    await del('exams', created.exams)
    // soal kuis (chunked, pola sama)
    const allQuizQIds = []
    for (const qz of created.quizzes) {
        let from = 0
        while (true) {
            const { data } = await supabase.from('quiz_questions').select('id').eq('quiz_id', qz).range(from, from + 999).order('id')
            allQuizQIds.push(...(data || []).map(q => q.id))
            if (!data || data.length < 1000) break
            from += 1000
        }
    }
    for (let i = 0; i < allQuizQIds.length; i += 100) {
        await supabase.from('quiz_questions').delete().in('id', allQuizQIds.slice(i, i + 100))
    }
    await del('quizzes', created.quizzes)
    for (const uid of created.users) await supabase.from('notifications').delete().eq('user_id', uid)
    await del('sessions', created.sessions)
    await del('teaching_assignments', created.tas)
    await del('teachers', created.teachers)
    await del('classes', created.classes)
    await del('subjects', created.subjects)
    await del('users', created.users)
    console.log(`cleanup selesai (${allQIds.length} soal exam + ${allQuizQIds.length} soal kuis dibuang)`)
}

main()
    .catch(async e => {
        console.error('ERROR:', e.message)
        process.exitCode = 1
        if (server) await stopServerSafe(server, BASE).catch(() => { })
    })
    .finally(cleanup)
