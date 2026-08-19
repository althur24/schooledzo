/**
 * check_student_journey.js — memastikan SOAL BENAR-BENAR SAMPAI ke murid setelah
 * perubahan timer enforcement. Simulasi perjalanan penuh siswa di 3 alur:
 *   buka detail → daftar soal tiba utuh (jumlah & isi) → mulai → jawab → simpan → kumpul.
 * Data uji dibuat & dihapus sendiri. Server harus jalan di BASE_URL.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const api = (path, token, opts = {}) =>
    fetch(`${BASE_URL}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Cookie: `session_token=${token}`, ...(opts.headers || {}) }
    });
const iso = (ms) => new Date(ms).toISOString();
const created = { exams: [], official: [], quizzes: [], examSubs: [], officialSubs: [], quizSubs: [], sessions: [] };

async function makeSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    await supabase.from('sessions').insert({ user_id: userId, token, expires_at: iso(Date.now() + 3600000) });
    created.sessions.push(token);
    return token;
}

// Kloning 1 soal sumber menjadi soal uji milik parent baru
async function cloneQuestions(srcTable, fk, srcParentId, newParentId) {
    const { data: srcQs } = await supabase.from(srcTable).select('*').eq(fk, srcParentId).order('order_index').limit(3);
    if (!srcQs?.length) throw new Error(`Soal sumber kosong di ${srcTable}`);
    const out = [];
    for (const s of srcQs) {
        const q = { ...s };
        delete q.id; delete q.created_at;
        q[fk] = newParentId;
        const { data, error } = await supabase.from(srcTable).insert(q).select().single();
        if (error) throw new Error(`Gagal kloning soal: ` + error.message);
        out.push(data);
    }
    return out;
}

function assertQuestionsUsable(qs, label) {
    ok(Array.isArray(qs) && qs.length > 0, `${label}: soal tiba (n=${qs?.length ?? 0})`);
    const usable = (qs || []).every(q => q.id && q.question_text && q.question_type);
    ok(usable, `${label}: setiap soal punya id + teks + tipe`);
}

async function main() {
    const NOW = Date.now();
    const { data: siswaUsers } = await supabase.from('users').select('id').eq('role', 'SISWA').limit(3);
    const { data: students } = await supabase.from('students').select('id, user_id, class_id, school_id').in('user_id', siswaUsers.map(u => u.id));
    if (!students?.length) throw new Error('students tidak ditemukan');

    // ===== ULANGAN: perjalanan penuh =====
    console.log('\n=== ULANGAN: perjalanan siswa ===');
    let exam = null, student = null, token = null;
    const { data: srcExams } = await supabase.from('exams').select('*, teaching_assignment:teaching_assignments(class_id)').limit(15);
    for (const src of srcExams || []) {
        const classId = (Array.isArray(src.teaching_assignment) ? src.teaching_assignment[0] : src.teaching_assignment)?.class_id;
        if (!classId) continue;
        const { data: st } = await supabase.from('students').select('id, user_id, class_id, school_id').eq('class_id', classId).limit(1).maybeSingle();
        if (!st) continue;
        const row = { ...src };
        delete row.id; delete row.created_at; delete row.teaching_assignment;
        Object.assign(row, { title: '[TEST] Journey Ulangan', is_active: true, start_time: iso(NOW - 60000), duration_minutes: 60, is_remedial: false, allowed_student_ids: [] });
        const { data: newExam, error } = await supabase.from('exams').insert(row).select().single();
        if (error) continue;
        exam = newExam; student = st; token = await makeSession(st.user_id);
        break;
    }
    if (!exam) throw new Error('Tidak bisa menyiapkan exam journey');
    created.exams.push(exam.id);
    const qsExam = await cloneQuestions('exam_questions', 'exam_id', srcExams.find(e => e.teaching_assignment)?.id || exam.id, exam.id);

    // 1. Siswa membuka halaman: detail + daftar soal
    const dRes = await api(`/api/exams/${exam.id}`, token);
    const detail = await dRes.json();
    ok(dRes.ok && detail.id === exam.id, 'ulangan: detail ujian tiba');
    const qRes = await api(`/api/exams/${exam.id}/questions`, token);
    const questions = await qRes.json();
    assertQuestionsUsable(questions, 'ulangan');
    // siswa belum submit → correct_answer harus ter-strip
    ok(questions.length > 0 && questions[0].correct_answer === undefined, 'ulangan: kunci jawaban ter-strip untuk siswa');

    // 2. Mulai → 3. jawab & autosave → 4. kumpul
    const sRes = await api('/api/exam-submissions', token, { method: 'POST', body: JSON.stringify({ exam_id: exam.id }) });
    const sub = await sRes.json();
    ok(sRes.ok && !!sub.id && !!sub.ends_at, 'ulangan: mulai → submission + ends_at');
    created.examSubs.push(sub.id);
    const saveRes = await api('/api/exam-submissions', token, { method: 'PUT', body: JSON.stringify({ submission_id: sub.id, answers: [{ question_id: questions[0].id, answer: 'A' }] }) });
    ok(saveRes.ok, 'ulangan: autosave jawaban diterima');
    const submRes = await api('/api/exam-submissions', token, { method: 'PUT', body: JSON.stringify({ submission_id: sub.id, answers: [{ question_id: questions[0].id, answer: 'A' }], submit: true }) });
    ok(submRes.ok, 'ulangan: kumpul diterima');
    const { data: savedAns } = await supabase.from('exam_answers').select('answer').eq('submission_id', sub.id);
    ok(savedAns.length === 1 && savedAns[0].answer === 'A', 'ulangan: jawaban terekam di server');

    // ===== KUIS: perjalanan penuh =====
    console.log('\n=== KUIS: perjalanan siswa ===');
    const { data: srcQuiz } = await supabase.from('quizzes').select('*').limit(1).single();
    const qRow = { ...srcQuiz };
    delete qRow.id; delete qRow.created_at;
    Object.assign(qRow, { title: '[TEST] Journey Kuis', is_active: true, duration_minutes: 30, deadline: null, is_remedial: false, allowed_student_ids: [] });
    const { data: quiz } = await supabase.from('quizzes').insert(qRow).select().single();
    created.quizzes.push(quiz.id);
    await cloneQuestions('quiz_questions', 'quiz_id', srcQuiz.id, quiz.id);
    const token2 = await makeSession(students[1].user_id);

    const qzRes = await api(`/api/quizzes/${quiz.id}`, token2);
    const quizDetail = await qzRes.json();
    assertQuestionsUsable(quizDetail.questions, 'kuis');
    ok(quizDetail.questions[0].correct_answer === undefined, 'kuis: kunci jawaban ter-strip untuk siswa');

    const listRes = await api(`/api/quiz-submissions?quiz_id=${quiz.id}&student_id=${students[1].id}`, token2);
    ok(listRes.ok && !!listRes.headers.get('x-server-time'), 'kuis: cek attempt + x-server-time');
    const startQ = await api('/api/quiz-submissions', token2, { method: 'POST', body: JSON.stringify({ quiz_id: quiz.id, answers: [] }) });
    const startQData = await startQ.json();
    ok(startQ.ok && !!startQData.id && !!startQData.ends_at, 'kuis: mulai → submission + ends_at (server authoritative)');
    created.quizSubs.push(startQData.id);
    const saveQ = await api('/api/quiz-submissions', token2, { method: 'POST', body: JSON.stringify({ quiz_id: quiz.id, answers: [{ question_id: quizDetail.questions[0].id, answer: 'A' }] }) });
    const saveQData = await saveQ.json();
    ok(saveQ.ok && saveQData.saved === true, 'kuis: save-progress diterima');
    const submQ = await api('/api/quiz-submissions', token2, { method: 'POST', body: JSON.stringify({ quiz_id: quiz.id, answers: [{ question_id: quizDetail.questions[0].id, answer: 'A' }], submit: true }) });
    ok(submQ.ok, 'kuis: kumpul diterima');

    // ===== UTS/UAS: perjalanan penuh =====
    console.log('\n=== UTS/UAS: perjalanan siswa ===');
    const st3 = students[2];
    const { data: srcOff } = await supabase.from('official_exams').select('*').eq('school_id', st3.school_id).limit(1).maybeSingle();
    if (!srcOff) throw new Error('official exam sumber tidak ada');
    const oRow = { ...srcOff };
    delete oRow.id; delete oRow.created_at;
    Object.assign(oRow, { title: '[TEST] Journey UTS', is_active: true, start_time: iso(NOW - 60000), duration_minutes: 60, is_remedial: false, allowed_student_ids: null, target_class_ids: [st3.class_id] });
    const { data: offExam, error: offErr } = await supabase.from('official_exams').insert(oRow).select().single();
    if (offErr) throw new Error('gagal clone official: ' + offErr.message);
    created.official.push(offExam.id);
    await cloneQuestions('official_exam_questions', 'exam_id', srcOff.id, offExam.id);
    const token3 = await makeSession(st3.user_id);

    const offQRes = await api(`/api/official-exams/${offExam.id}/questions`, token3);
    const offQuestions = await offQRes.json();
    assertQuestionsUsable(offQuestions, 'uts/uas');
    const startO = await api('/api/official-exam-submissions', token3, { method: 'POST', body: JSON.stringify({ exam_id: offExam.id }) });
    const startOData = await startO.json();
    ok(startO.ok && !!startOData.id && !!startOData.ends_at, 'uts/uas: mulai → submission + ends_at');
    created.officialSubs.push(startOData.id);
    const saveO = await api('/api/official-exam-submissions', token3, { method: 'PUT', body: JSON.stringify({ submission_id: startOData.id, answers: [{ question_id: offQuestions[0].id, answer: 'A' }] }) });
    ok(saveO.ok, 'uts/uas: autosave diterima');
    const submO = await api('/api/official-exam-submissions', token3, { method: 'PUT', body: JSON.stringify({ submission_id: startOData.id, answers: [{ question_id: offQuestions[0].id, answer: 'A' }], submit: true }) });
    ok(submO.ok, 'uts/uas: kumpul diterima');

    console.log(failures === 0 ? '\nSEMUA PASS — soal sampai ke murid di 3 alur' : `\n${failures} FAIL`);
}

main()
    .catch(e => { console.error('FATAL:', e.message); failures++; })
    .finally(async () => {
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
        } catch (e) { console.error('Cleanup error:', e.message); }
        process.exit(failures === 0 ? 0 : 1);
    });
