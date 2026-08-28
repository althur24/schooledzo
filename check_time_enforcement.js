/**
 * check_time_enforcement.js — uji E2E penegakan batas waktu di server
 * (TIME_ENFORCEMENT_UPGRADE_PLAN Fase 6). Server harus jalan di BASE_URL
 * dengan scheduler aktif (sweep tiap 1 menit).
 *
 * Skenario: save/submit tepat waktu, dalam grace, lewat grace (perilaku
 * AUTO-COLLECT: jawaban terakhir yang dikirim DIKUMPULKAN lalu submission
 * ditutup paksa — lihat src/lib/autoCloseExpired.ts), semantik jendela global,
 * soft/hard reset, kontrak server_time/ends_at, sweep aktif, deadline kuis.
 * Data uji dibuat & dihapus sendiri.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { assertMin, mustInsert, makeSession, makeApi } = require('./loadtest/e2e/helpers.cjs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

const api = makeApi(BASE_URL);

const iso = (ms) => new Date(ms).toISOString();
const created = { exams: [], official: [], quizzes: [], examSubs: [], officialSubs: [], quizSubs: [], sessions: [] };

// Kloning baris induk (exam/official/quiz) agar tidak menyentuh data asli
async function cloneRow(table, overrides, match) {
    let q = supabase.from(table).select('*');
    if (match) q = q.eq(match.col, match.val);
    const { data: src, error } = await q.limit(1).maybeSingle();
    if (error || !src) throw new Error(`Tidak ada baris sumber di ${table}`);
    const row = { ...src };
    delete row.id;
    delete row.created_at;
    Object.assign(row, overrides);
    const { data, error: insErr } = await supabase.from(table).insert(row).select().single();
    if (insErr) throw new Error(`Gagal kloning ${table}: ` + insErr.message);
    return data;
}

async function cloneQuestion(srcTable, fk, parentId, overrides = {}) {
    const { data: src } = await supabase.from(srcTable).select('*').limit(1).single();
    if (!src) throw new Error(`Tidak ada soal di ${srcTable}`);
    const q = { ...src };
    delete q.id;
    delete q.created_at;
    q[fk] = parentId;
    // overrides penting untuk determinisme: template .limit(1) tanpa .order()
    // bisa memilih baris berbeda antar run (kunci/poin/tipe soal acak)
    Object.assign(q, overrides);
    const { data, error } = await supabase.from(srcTable).insert(q).select().single();
    if (error) throw new Error(`Gagal kloning soal ${srcTable}: ` + error.message);
    return data;
}

async function main() {
    const NOW = Date.now();
    const { data: guru } = await supabase.from('users').select('id').eq('role', 'GURU').limit(1).single();
    const { data: siswaUsers } = await supabase.from('users').select('id').eq('role', 'SISWA').limit(5);
    if (!guru || !siswaUsers?.length) throw new Error('User uji kurang');
    const guruToken = await makeSession(supabase, guru.id, created);
    const siswaTokens = [];
    for (const u of siswaUsers) siswaTokens.push(await makeSession(supabase, u.id, created));
    const { data: students } = await supabase.from('students').select('id, user_id, class_id, school_id').in('user_id', siswaUsers.map(u => u.id));
    // skenario memakai students[0..3] — fail-fast kalau kurang agar tidak TypeError di tengah
    assertMin(students?.length || 0, 4, 'siswa uji (skenario timer butuh 4 siswa)');

    // ===== ULANGAN =====
    console.log('\n=== ULANGAN (exams) ===');
    // Exam A: jendela terbuka (mulai 3 mnt lalu, durasi 10 mnt → sisa ~7 mnt)
    // Kloning dari exam sumber yang kelasnya benar-benar punya siswa (agar lolos start gate)
    let examA = null, starter = null, starterToken = null;
    const { data: srcExams } = await supabase.from('exams').select('*, teaching_assignment:teaching_assignments(class_id)').limit(15);
    for (const src of srcExams || []) {
        const classId = (Array.isArray(src.teaching_assignment) ? src.teaching_assignment[0] : src.teaching_assignment)?.class_id;
        if (!classId) continue;
        const { data: st } = await supabase.from('students').select('id, user_id, class_id').eq('class_id', classId).limit(1).single();
        if (!st) continue;
        const row = { ...src };
        delete row.id; delete row.created_at; delete row.teaching_assignment;
        Object.assign(row, { title: '[TEST] Timer A', is_active: true, start_time: iso(NOW - 3 * 60000), duration_minutes: 10, is_remedial: false, allowed_student_ids: [] });
        const { data: newExam, error } = await supabase.from('exams').insert(row).select().single();
        if (error) { console.error('Gagal kloning exam A:', error.message); continue; }
        examA = newExam;
        starter = st;
        starterToken = await makeSession(supabase, st.user_id, created);
        // simpan SUMBER yang benar-benar di-clone (soal dikloning terpisah di bawah)
        break;
    }
    if (!examA) throw new Error('Tidak bisa menyiapkan exam A');
    created.exams.push(examA.id);
    const qA = await cloneQuestion('exam_questions', 'exam_id', examA.id);
    const winEndA = new Date(examA.start_time).getTime() + 10 * 60000;
    let subA = null;

    if (starter && starterToken) {
        // (1) kontrak start: server_time + ends_at = windowEnd (bukan started_at + durasi)
        const res1 = await api('/api/exam-submissions', starterToken, { method: 'POST', body: JSON.stringify({ exam_id: examA.id }) });
        subA = await res1.json();
        ok(res1.ok && !!subA.server_time && !!subA.ends_at, `(1) start 200 + kontrak server_time/ends_at ada`);
        ok(subA.ends_at && Math.abs(new Date(subA.ends_at).getTime() - winEndA) < 2000, `(1) ends_at == windowEnd (jendela global, bukan started_at+durasi)`);

        // (2) save tepat waktu diterima
        const res2 = await api('/api/exam-submissions', starterToken, { method: 'PUT', body: JSON.stringify({ submission_id: subA.id, answers: [{ question_id: qA.id, answer: 'A' }] }) });
        ok(res2.ok, `(2) save tepat waktu → ${res2.status}`);

        // (3) submit tepat waktu diterima
        const res3 = await api('/api/exam-submissions', starterToken, { method: 'PUT', body: JSON.stringify({ submission_id: subA.id, answers: [{ question_id: qA.id, answer: 'A' }], submit: true }) });
        ok(res3.ok, `(3) submit tepat waktu → ${res3.status}`);
    } else {
        console.log('SKIP (1-3): tidak ada siswa dengan kelas yang cocok untuk start gate');
        const s = await mustInsert(supabase, 'exam_submissions',
            { exam_id: examA.id, student_id: students[0].id, started_at: iso(NOW), max_score: 10 }, 'subA (jalur skip)');
        subA = s;
    }
    if (subA?.id) created.examSubs.push(subA.id);

    // Exam B: jendela berakhir 5 mnt lalu (lewat grace 60 dtk).
    // is_active FALSE supaya scheduler sweep TIDAK pernah menyentuh submission di
    // exam ini (sweep hanya memproses exam aktif — autoCloseExpired.ts) → skenario
    // (4)/(5) deterministik, tidak race dengan sweep. Gate is_active hanya berlaku
    // untuk MEMULAI sesi baru (POST), bukan PUT pada submission yang sudah ada.
    const examB = await cloneRow('exams', { title: '[TEST] Timer B', is_active: false, start_time: iso(NOW - 10 * 60000), duration_minutes: 5, is_remedial: false, allowed_student_ids: [] });
    created.exams.push(examB.id);
    // Skenario (7)/(8) reset oleh GURU PEMILIK TA examB — bukan guru acak.
    // (Route kini menegakkan kepemilikan TA; guru acak hanya kebetulan lolos
    // di DB satu-guru dan akan 403 di DB multi-guru.)
    let ownerBToken = null;
    if (examB.teaching_assignment_id) {
        const { data: taOwner } = await supabase
            .from('teaching_assignments')
            .select('teacher:teachers(user_id)')
            .eq('id', examB.teaching_assignment_id)
            .maybeSingle();
        const ownerUserId = (Array.isArray(taOwner?.teacher) ? taOwner.teacher[0] : taOwner?.teacher)?.user_id;
        if (ownerUserId) ownerBToken = await makeSession(supabase, ownerUserId, created);
    }
    if (!ownerBToken) throw new Error('Tidak bisa menemukan guru pemilik TA examB untuk skenario reset (7)/(8)');
    // Kunci ('B') & poin ditetapkan eksplisit supaya penilaian deterministik
    const qB = await cloneQuestion('exam_questions', 'exam_id', examB.id, {
        question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'B', points: 10,
    });

    // Submission B1: punya 1 jawaban lama (salah, 0 poin), lalu kirim jawaban BENAR lewat grace.
    // Perilaku AUTO-COLLECT (src/lib/autoCloseExpired.ts): jawaban yang dikirim lewat
    // grace DI-UPsert (menang per soal) supaya jawaban offline terselamatkan,
    // dinilai ulang, lalu submission ditutup paksa.
    const { data: subB1 } = await supabase.from('exam_submissions').insert({ exam_id: examB.id, student_id: students[0].id, started_at: iso(NOW - 9 * 60000), max_score: 10 }).select().single();
    created.examSubs.push(subB1.id);
    await supabase.from('exam_answers').insert({ submission_id: subB1.id, question_id: qB.id, answer: 'A', is_correct: false, points_earned: 0 });
    const tokB1 = siswaTokens[siswaUsers.findIndex(u => u.id === students[0].user_id)];

    const res4 = await api('/api/exam-submissions', tokB1, { method: 'PUT', body: JSON.stringify({ submission_id: subB1.id, answers: [{ question_id: qB.id, answer: 'B' }] }) });
    const body4 = await res4.json();
    ok(res4.status === 409 && body4.code === 'TIME_EXPIRED' && body4.force_submitted === true, `(4) save lewat grace → 409 TIME_EXPIRED + force_submitted (dapat ${res4.status})`);
    const { data: ansB1 } = await supabase.from('exam_answers').select('answer, is_correct, points_earned').eq('submission_id', subB1.id);
    ok(ansB1.length === 1 && ansB1[0].answer === 'B' && ansB1[0].is_correct === true && ansB1[0].points_earned === 10, '(4) jawaban terakhir terselamatkan (upsert menang per soal) + dinilai ulang');
    const { data: subB1After } = await supabase.from('exam_submissions').select('is_submitted, total_score').eq('id', subB1.id).single();
    ok(subB1After.is_submitted === true && subB1After.total_score === 10, `(4) submission ditutup paksa dgn skor jujur (score=${subB1After.total_score})`);

    // Submission B2 (siswa lain): submit lewat grace membawa jawaban → jawaban ikut
    // terselamatkan (auto-collect) & dinilai — salah = 0 poin, bukan dibuang
    const { data: subB2 } = await supabase.from('exam_submissions').insert({ exam_id: examB.id, student_id: students[1].id, started_at: iso(NOW - 9 * 60000), max_score: 10 }).select().single();
    created.examSubs.push(subB2.id);
    const tokB2 = siswaTokens[siswaUsers.findIndex(u => u.id === students[1].user_id)];
    const res5 = await api('/api/exam-submissions', tokB2, { method: 'PUT', body: JSON.stringify({ submission_id: subB2.id, answers: [{ question_id: qB.id, answer: 'A' }], submit: true }) });
    ok(res5.status === 409, `(5) submit lewat grace → 409 (dapat ${res5.status})`);
    const { data: ansB2 } = await supabase.from('exam_answers').select('answer, is_correct, points_earned').eq('submission_id', subB2.id);
    ok(ansB2.length === 1 && ansB2[0].answer === 'A' && ansB2[0].is_correct === false && ansB2[0].points_earned === 0, '(5) jawaban yang dibawa submit lewat grace terselamatkan & dinilai (salah = 0 poin)');
    const { data: subB2After } = await supabase.from('exam_submissions').select('is_submitted, total_score').eq('id', subB2.id).single();
    ok(subB2After.is_submitted === true && subB2After.total_score === 0, `(5) submission ditutup paksa (score=${subB2After.total_score})`);

    // (6) submit DALAM grace: jendela berakhir 30 dtk lalu — waktu dihitung segar saat
    // tes berjalan (bukan sejak skrip mulai), agar tidak terlewat grace 60 dtk
    const now6 = Date.now();
    const examC = await cloneRow('exams', { title: '[TEST] Timer C', is_active: true, start_time: iso(now6 - 90 * 1000), duration_minutes: 1, is_remedial: false, allowed_student_ids: [] });
    created.exams.push(examC.id);
    const qC = await cloneQuestion('exam_questions', 'exam_id', examC.id);
    const { data: subC } = await supabase.from('exam_submissions').insert({ exam_id: examC.id, student_id: students[2].id, started_at: iso(now6 - 90 * 1000), max_score: 10 }).select().single();
    created.examSubs.push(subC.id);
    const tokC = siswaTokens[siswaUsers.findIndex(u => u.id === students[2].user_id)];
    const res6 = await api('/api/exam-submissions', tokC, { method: 'PUT', body: JSON.stringify({ submission_id: subC.id, answers: [{ question_id: qC.id, answer: 'A' }], submit: true }) });
    ok(res6.ok, `(6) submit dalam grace (±30 dtk setelah jendela) → ${res6.status} diterima`);

    // (7) soft reset setelah jendela tutup → 400 (subB1 sudah tertutup)
    const res7 = await api('/api/exam-submissions', ownerBToken, { method: 'PUT', body: JSON.stringify({ submission_id: subB1.id, reset_attempt: 'soft' }) });
    ok(res7.status === 400, `(7) soft reset pasca-jendela → 400 (dapat ${res7.status})`);

    // (8) hard reset pasca-jendela → override durasi penuh, siswa bisa menulis lagi
    const res8 = await api('/api/exam-submissions', ownerBToken, { method: 'PUT', body: JSON.stringify({ submission_id: subB1.id, reset_attempt: 'hard' }) });
    const body8 = await res8.json();
    ok(res8.ok && body8.effective_ends_at, `(8) hard reset → ${res8.status} + effective_ends_at ada`);
    // bandingkan dengan waktu SEGAR saat request dibuat — bukan NOW awal main(),
    // karena persiapan fixture di atas bisa makan waktu > toleransi 30 dtk
    const t8 = Date.now();
    const overrideMs = body8.effective_ends_at ? new Date(body8.effective_ends_at).getTime() : 0;
    ok(Math.abs(overrideMs - (t8 + 5 * 60000)) < 30000, '(8) override ≈ now + durasi (durasi penuh baru)');
    const res8b = await api('/api/exam-submissions', tokB1, { method: 'PUT', body: JSON.stringify({ submission_id: subB1.id, answers: [{ question_id: qB.id, answer: 'B' }] }) });
    ok(res8b.ok, `(8) save setelah hard reset (jendela lama sudah lewat) → ${res8b.status} diterima`);

    // (16) lazy sweep GET ulangan (view guru) — rumus helper baru
    const examE = await cloneRow('exams', { title: '[TEST] Timer E', is_active: true, start_time: iso(NOW - 10 * 60000), duration_minutes: 5, is_remedial: false, allowed_student_ids: [] });
    created.exams.push(examE.id);
    const { data: subE } = await supabase.from('exam_submissions').insert({ exam_id: examE.id, student_id: students[1].id, started_at: iso(NOW - 9 * 60000), max_score: 10 }).select().single();
    created.examSubs.push(subE.id);
    const res16 = await api(`/api/exam-submissions?exam_id=${examE.id}`, guruToken);
    const { data: subEAfter } = await supabase.from('exam_submissions').select('is_submitted').eq('id', subE.id).single();
    ok(res16.ok && subEAfter.is_submitted === true, '(16) lazy sweep GET ulangan (guru) menutup submission kedaluwarsa');

    // (17) lazy sweep GET UTS/UAS — clone dari exam sekolah siswa & pakai token SISWA pemilik
    // (GET men-scope per sekolah + role; sweep jalan untuk GURU/ADMIN/SISWA pada data yang terlihat)
    const offB = await cloneRow('official_exams', { title: '[TEST] Timer UTS B', is_active: true, start_time: iso(NOW - 2 * 3600000), duration_minutes: 30 }, { col: 'school_id', val: students[1].school_id });
    created.official.push(offB.id);
    const { data: subOB } = await supabase.from('official_exam_submissions').insert({ exam_id: offB.id, student_id: students[1].id, started_at: iso(NOW - 110 * 60000), max_score: 10 }).select().single();
    created.officialSubs.push(subOB.id);
    const res17 = await api(`/api/official-exam-submissions?exam_id=${offB.id}`, tokB2);
    const { data: subOBAfter } = await supabase.from('official_exam_submissions').select('is_submitted').eq('id', subOB.id).single();
    ok(res17.ok && subOBAfter.is_submitted === true, '(17) lazy sweep GET UTS/UAS menutup submission kedaluwarsa');

    // (9+18) sweep aktif scheduler: submission yatim kedaluwarsa pada exam DAN kuis AKTIF
    const examD = await cloneRow('exams', { title: '[TEST] Timer D', is_active: true, start_time: iso(NOW - 10 * 60000), duration_minutes: 5, is_remedial: false, allowed_student_ids: [] });
    created.exams.push(examD.id);
    const { data: subD } = await supabase.from('exam_submissions').insert({ exam_id: examD.id, student_id: students[3]?.id || students[0].id, started_at: iso(NOW - 9 * 60000), max_score: 10 }).select().single();
    created.examSubs.push(subD.id);
    const quizD = await cloneRow('quizzes', { title: '[TEST] Timer Kuis D', is_active: true, duration_minutes: 5, deadline: null, is_remedial: false, allowed_student_ids: [] });
    created.quizzes.push(quizD.id);
    const { data: subQD } = await supabase.from('quiz_submissions').insert({ quiz_id: quizD.id, student_id: students[1].id, started_at: iso(NOW - 10 * 60000), answers: [] }).select().single();
    created.quizSubs.push(subQD.id);
    console.log('(9+18) menunggu tick sweep (maks ~75 dtk)...');
    let sweptExam = false, sweptQuiz = false;
    for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 5000));
        if (!sweptExam) {
            const { data: chk } = await supabase.from('exam_submissions').select('is_submitted').eq('id', subD.id).single();
            sweptExam = chk?.is_submitted === true;
        }
        if (!sweptQuiz) {
            const { data: chk } = await supabase.from('quiz_submissions').select('submitted_at').eq('id', subQD.id).single();
            sweptQuiz = !!chk?.submitted_at;
        }
        if (sweptExam && sweptQuiz) break;
    }
    ok(sweptExam, '(9) sweep aktif menutup submission ulangan yatim kedaluwarsa');
    ok(sweptQuiz, '(18) sweep aktif menutup submission kuis yatim kedaluwarsa (cabang discovery kuis)');

    // ===== KUIS =====
    console.log('\n=== KUIS ===');
    // (10) per-student kedaluwarsa (durasi 30 mnt, mulai 1 jam lalu, tanpa deadline).
    // is_active FALSE supaya scheduler sweep tidak menutup subQ duluan (race) —
    // gate is_active/deadline hanya menggerbang sesi BARU, bukan attempt berjalan.
    const quizA = await cloneRow('quizzes', { title: '[TEST] Timer Kuis A', is_active: false, duration_minutes: 30, deadline: null, is_remedial: false, allowed_student_ids: [] });
    created.quizzes.push(quizA.id);
    const qQuizA = await cloneQuestion('quiz_questions', 'quiz_id', quizA.id);
    const { data: subQ } = await supabase.from('quiz_submissions').insert({ quiz_id: quizA.id, student_id: students[0].id, started_at: iso(NOW - 60 * 60000), answers: [] }).select().single();
    created.quizSubs.push(subQ.id);
    const res10 = await api('/api/quiz-submissions', tokB1, { method: 'POST', body: JSON.stringify({ quiz_id: quizA.id, answers: [{ question_id: qQuizA.id, answer: 'A' }] }) });
    const body10 = await res10.json();
    ok(res10.status === 409 && body10.code === 'TIME_EXPIRED', `(10) kuis per-student kedaluwarsa → 409 (dapat ${res10.status})`);

    // (11) deadline menggerbang sesi BARU
    const quizB = await cloneRow('quizzes', { title: '[TEST] Timer Kuis B', is_active: true, duration_minutes: 30, deadline: iso(NOW - 60000), is_remedial: false, allowed_student_ids: [] });
    created.quizzes.push(quizB.id);
    const res11 = await api('/api/quiz-submissions', tokB1, { method: 'POST', body: JSON.stringify({ quiz_id: quizB.id, answers: [] }) });
    ok(res11.status === 400, `(11) mulai kuis lewat deadline → 400 (dapat ${res11.status})`);

    // (12) kontrak GET kuis: header x-server-time + ends_at per item
    const res12 = await api(`/api/quiz-submissions?quiz_id=${quizA.id}&student_id=${students[0].id}`, tokB1);
    const items12 = await res12.json();
    ok(!!res12.headers.get('x-server-time'), '(12) header x-server-time ada');
    ok(Array.isArray(items12) && items12[0]?.ends_at, '(12) item punya ends_at dari server');

    // (15) re-submit kuis yang sudah terkumpul → 400 (anti-timpa, selaras ulangan/UTS-UAS)
    const quizC = await cloneRow('quizzes', { title: '[TEST] Timer Kuis C', is_active: true, duration_minutes: 30, deadline: null, is_remedial: false, allowed_student_ids: [] });
    created.quizzes.push(quizC.id);
    const { data: subQC } = await supabase.from('quiz_submissions').insert({ quiz_id: quizC.id, student_id: students[0].id, started_at: iso(Date.now()), answers: [], submitted_at: iso(Date.now()) }).select().single();
    created.quizSubs.push(subQC.id);
    const res15 = await api('/api/quiz-submissions', tokB1, { method: 'POST', body: JSON.stringify({ quiz_id: quizC.id, answers: [], submit: true }) });
    ok(res15.status === 400, `(15) re-submit kuis yang sudah terkumpul → 400 (dapat ${res15.status})`);

    // (19) lazy sweep GET kuis (view guru)
    const quizE = await cloneRow('quizzes', { title: '[TEST] Timer Kuis E', is_active: true, duration_minutes: 5, deadline: null, is_remedial: false, allowed_student_ids: [] });
    created.quizzes.push(quizE.id);
    const { data: subQE } = await supabase.from('quiz_submissions').insert({ quiz_id: quizE.id, student_id: students[2].id, started_at: iso(NOW - 10 * 60000), answers: [] }).select().single();
    created.quizSubs.push(subQE.id);
    const res19 = await api(`/api/quiz-submissions?quiz_id=${quizE.id}`, guruToken);
    const { data: subQEAfter } = await supabase.from('quiz_submissions').select('submitted_at').eq('id', subQE.id).single();
    ok(res19.ok && !!subQEAfter?.submitted_at, '(19) lazy sweep GET kuis (guru) menutup submission kedaluwarsa');

    // ===== UTS/UAS =====
    console.log('\n=== UTS/UAS (official exams) ===');
    const offA = await cloneRow('official_exams', { title: '[TEST] Timer UTS', is_active: true, start_time: iso(NOW - 2 * 3600000), duration_minutes: 30 });
    created.official.push(offA.id);
    const qOff = await cloneQuestion('official_exam_questions', 'exam_id', offA.id);
    const { data: subO } = await supabase.from('official_exam_submissions').insert({ exam_id: offA.id, student_id: students[0].id, started_at: iso(NOW - 110 * 60000), max_score: 10 }).select().single();
    created.officialSubs.push(subO.id);
    const res13 = await api('/api/official-exam-submissions', tokB1, { method: 'PUT', body: JSON.stringify({ submission_id: subO.id, answers: [{ question_id: qOff.id, answer: 'A' }] }) });
    const body13 = await res13.json();
    ok(res13.status === 409 && body13.code === 'TIME_EXPIRED', `(13) UTS/UAS save lewat grace → 409 (dapat ${res13.status})`);

    // (14) hard reset oleh ADMIN satu sekolah dengan offA → override dihormati.
    // (Route kini menegakkan scope sekolah; admin acak beda sekolah akan 403.)
    let adminAToken = null;
    {
        const { data: adminA } = await supabase.from('users').select('id').eq('role', 'ADMIN').eq('school_id', offA.school_id).limit(1).maybeSingle();
        if (adminA) adminAToken = await makeSession(supabase, adminA.id, created);
    }
    if (adminAToken) {
        const res14 = await api('/api/official-exam-submissions', adminAToken, { method: 'PUT', body: JSON.stringify({ submission_id: subO.id, reset_attempt: 'hard' }) });
        const body14 = await res14.json();
        ok(res14.ok && body14.effective_ends_at, `(14) hard reset UTS/UAS oleh admin → ${res14.status}`);
        const res14b = await api('/api/official-exam-submissions', tokB1, { method: 'PUT', body: JSON.stringify({ submission_id: subO.id, answers: [{ question_id: qOff.id, answer: 'A' }] }) });
        ok(res14b.ok, `(14) save setelah hard reset → ${res14b.status} diterima`);
    } else {
        console.log('SKIP (14): admin sekolah exam tidak ditemukan');
    }

    console.log(failures === 0 ? '\nSEMUA PASS' : `\n${failures} FAIL`);
}

main()
    .catch(e => { console.error('FATAL:', e.message); failures++; })
    .finally(async () => {
        // Cleanup semua data uji
        try {
            if (created.examSubs.length) await supabase.from('exam_answers').delete().in('submission_id', created.examSubs);
            if (created.officialSubs.length) await supabase.from('official_exam_answers').delete().in('submission_id', created.officialSubs);
            if (created.examSubs.length) await supabase.from('exam_submissions').delete().in('id', created.examSubs);
            if (created.officialSubs.length) await supabase.from('official_exam_submissions').delete().in('id', created.officialSubs);
            if (created.quizSubs.length) await supabase.from('quiz_submissions').delete().in('id', created.quizSubs);
            for (const id of created.exams) await supabase.from('exam_questions').delete().eq('exam_id', id);
            for (const id of created.official) await supabase.from('official_exam_questions').delete().eq('exam_id', id);
            for (const id of created.quizzes) await supabase.from('quiz_questions').delete().eq('quiz_id', id);
            if (created.exams.length) await supabase.from('exams').delete().in('id', created.exams);
            if (created.official.length) await supabase.from('official_exams').delete().in('id', created.official);
            if (created.quizzes.length) await supabase.from('quizzes').delete().in('id', created.quizzes);
            if (created.sessions.length) await supabase.from('sessions').delete().in('token', created.sessions);
            console.log('Cleanup: semua data uji dihapus');
        } catch (e) {
            console.error('Cleanup error:', e.message);
        }
        process.exit(failures === 0 ? 0 : 1);
    });
