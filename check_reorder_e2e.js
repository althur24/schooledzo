/**
 * check_reorder_e2e.js — uji E2E endpoint reorder (Fase 3b EDITOR_SOAL_UPGRADE_PLAN).
 *
 * PENTING: versi lama memakai quiz/exam PRODUKSI milik guru acak (hampir pasti
 * 403 karena bukan pemilik) dan mengubah urutan soal asli. Versi ini membuat
 * fixture SENDIRI (guru + TA + quiz + exam + soal ber-prefix e2e_), sehingga:
 *  - kepemilikan pasti lolos canManageExam
 *  - tidak menyentuh data produksi
 *  - cleanup otomatis di finally (tidak perlu restore manual)
 *
 * Skenario per endpoint (quizzes & exams):
 *  (a) POST { reorder: [...] } sebagai GURU → order_index berubah & GET kembali berurutan baru
 *  (b) POST reorder sebagai SISWA → 401 Unauthorized
 *  (c) POST payload reorder kosong sebagai GURU → 400
 *  (d) reorder balik ke urutan semula + verifikasi
 *
 * Pakai: node check_reorder_e2e.js  (server harus sudah jalan di BASE_URL)
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const { mustInsert, makeSession, makeApi } = require('./loadtest/e2e/helpers.cjs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

let failures = 0;
const ok = (cond, label) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
    if (!cond) failures++;
};

const api = makeApi(BASE_URL);
const created = { users: [], teachers: [], tas: [], classes: [], subjects: [], exams: [], quizzes: [], examQuestions: [], quizQuestions: [], sessions: [] };

async function template(table) {
    const { data } = await supabase.from(table).select('*').limit(1);
    return data && data[0] ? data[0] : null;
}

async function setupFixtures() {
    const runId = Date.now() % 100000;
    const U = `e2e_${runId}`;

    const { data: school } = await supabase.from('schools').select('id').limit(1).single();
    if (!school) throw new Error('Tidak ada school untuk fixture');
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).limit(1).maybeSingle();
    if (!year) throw new Error('Tidak ada tahun ajaran aktif untuk fixture');

    const subjT = await template('subjects');
    const subject = await mustInsert(supabase, 'subjects',
        { ...subjT, id: undefined, name: `${U} Mapel Reorder`, school_id: school.id }, 'subject fixture');
    created.subjects.push(subject.id);

    const classT = await template('classes');
    const klass = await mustInsert(supabase, 'classes',
        { ...classT, id: undefined, name: `${U} Kelas Reorder`, academic_year_id: year.id }, 'class fixture');
    created.classes.push(klass.id);

    const passHash = bcrypt.hashSync('e2e-pass', 10);
    const guruUser = await mustInsert(supabase, 'users',
        { username: `${U}_guru`, full_name: 'E2E Guru Reorder', password_hash: passHash, role: 'GURU', school_id: school.id }, 'guru fixture');
    const siswaUser = await mustInsert(supabase, 'users',
        { username: `${U}_siswa`, full_name: 'E2E Siswa Reorder', password_hash: passHash, role: 'SISWA', school_id: school.id }, 'siswa fixture');
    created.users.push(guruUser.id, siswaUser.id);

    const teachT = await template('teachers');
    const teacher = await mustInsert(supabase, 'teachers',
        { ...teachT, id: undefined, user_id: guruUser.id, nip: `e2er${runId}` }, 'teacher fixture');
    created.teachers.push(teacher.id);

    const taT = await template('teaching_assignments');
    const ta = await mustInsert(supabase, 'teaching_assignments',
        { ...taT, id: undefined, teacher_id: teacher.id, subject_id: subject.id, class_id: klass.id, academic_year_id: year.id }, 'TA fixture');
    created.tas.push(ta.id);

    // Exam (ulangan) + quiz milik TA fixture — tahun AKTIF supaya lolos blokir arsip
    const examT = await template('exams');
    const exam = await mustInsert(supabase, 'exams', {
        ...examT, id: undefined, created_at: undefined, title: `[TEST] ${U} Ulangan Reorder`,
        teaching_assignment_id: ta.id, is_active: false, is_remedial: false, allowed_student_ids: [],
    }, 'exam fixture');
    created.exams.push(exam.id);

    const quizT = await template('quizzes');
    const quiz = await mustInsert(supabase, 'quizzes', {
        ...quizT, id: undefined, created_at: undefined, title: `[TEST] ${U} Kuis Reorder`,
        teaching_assignment_id: ta.id, is_active: false, duration_minutes: 30, deadline: null, is_remedial: false, allowed_student_ids: [],
    }, 'quiz fixture');
    created.quizzes.push(quiz.id);

    // Soal: kloning template soal pertama, jadikan 4 soal per parent
    async function makeQuestions(qTable, fk, parentId, registry) {
        const qT = await template(qTable);
        if (!qT) throw new Error(`Tidak ada baris sumber di ${qTable} untuk template soal`);
        const ids = [];
        for (let i = 1; i <= 4; i++) {
            const q = await mustInsert(supabase, qTable, {
                ...qT, id: undefined, created_at: undefined, [fk]: parentId,
                question_text: `[TEST] ${U} soal ${i}`, order_index: i,
                question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 10,
            }, `${qTable} #${i}`);
            registry.push(q.id);
            ids.push(q.id);
        }
        return ids;
    }
    const examQIds = await makeQuestions('exam_questions', 'exam_id', exam.id, created.examQuestions);
    const quizQIds = await makeQuestions('quiz_questions', 'quiz_id', quiz.id, created.quizQuestions);

    const guruToken = await makeSession(supabase, guruUser.id, created);
    const siswaToken = await makeSession(supabase, siswaUser.id, created);

    return { U, exam: { id: exam.id, qIds: examQIds }, quiz: { id: quiz.id, qIds: quizQIds }, guruToken, siswaToken };
}

async function testEndpoint({ label, apiPath, table, fk, parentId, qIds, guruToken, siswaToken }) {
    console.log(`\n=== ${label} (${apiPath}) ===`);
    const path = apiPath.replace(':id', parentId);
    // urutan semula: qIds[i] bercorong order_index i+1
    const original = qIds.map((id, i) => ({ id, order_index: i + 1 }));
    const reversed = [...original].reverse().map((q, i) => ({ id: q.id, order_index: original[i].order_index }));

    // (a) reorder sebagai GURU pemilik fixture — urutan dibalik
    const resA = await api(path, guruToken, { method: 'POST', body: JSON.stringify({ reorder: reversed }) });
    const bodyA = await resA.json().catch(() => null);
    ok(resA.ok && bodyA?.updated === reversed.length, `(a) POST reorder diterima — status ${resA.status}, updated=${bodyA?.updated}`);

    const getA = await api(path, guruToken);
    const afterA = await getA.json();
    const expectedIds = [...qIds].reverse();
    const actualIds = (Array.isArray(afterA) ? afterA : []).map(q => q.id);
    ok(JSON.stringify(actualIds) === JSON.stringify(expectedIds), '(a) GET kembali dengan urutan baru (terbalik)');

    // (b) reorder sebagai SISWA → 401
    const resB = await api(path, siswaToken, { method: 'POST', body: JSON.stringify({ reorder: original }) });
    ok(resB.status === 401, `(b) POST reorder sebagai SISWA ditolak — status ${resB.status}`);

    // (c) payload reorder kosong sebagai GURU → 400
    const resC = await api(path, guruToken, { method: 'POST', body: JSON.stringify({ reorder: [] }) });
    ok(resC.status === 400, `(c) payload reorder kosong ditolak — status ${resC.status}`);

    // (d) kembalikan urutan semula (fixture dihapus saat cleanup — ini verifikasi API, bukan wajib)
    const resD = await api(path, guruToken, { method: 'POST', body: JSON.stringify({ reorder: original }) });
    ok(resD.ok, `(d) reorder balik ke urutan semula — status ${resD.status}`);
    const getD = await api(path, guruToken);
    const afterD = await getD.json();
    ok(JSON.stringify((Array.isArray(afterD) ? afterD : []).map(q => q.id)) === JSON.stringify(qIds), '(d) GET mengonfirmasi urutan kembali seperti semula');
}

async function main() {
    const fx = await setupFixtures();
    console.log(`Fixture OK: guru e2e + exam (${fx.exam.qIds.length} soal) + quiz (${fx.quiz.qIds.length} soal)`);

    await testEndpoint({
        label: 'KUIS', apiPath: '/api/quizzes/:id/questions',
        table: 'quiz_questions', fk: 'quiz_id', parentId: fx.quiz.id, qIds: fx.quiz.qIds,
        guruToken: fx.guruToken, siswaToken: fx.siswaToken,
    });
    await testEndpoint({
        label: 'ULANGAN', apiPath: '/api/exams/:id/questions',
        table: 'exam_questions', fk: 'exam_id', parentId: fx.exam.id, qIds: fx.exam.qIds,
        guruToken: fx.guruToken, siswaToken: fx.siswaToken,
    });

    console.log(failures === 0 ? '\nSEMUA PASS' : `\n${failures} FAIL`);
}

async function cleanup() {
    try {
        const del = async (table, ids) => { if (ids.length) await supabase.from(table).delete().in('id', ids) };
        if (created.sessions.length) await supabase.from('sessions').delete().in('token', created.sessions);
        await del('exam_questions', created.examQuestions);
        await del('quiz_questions', created.quizQuestions);
        await del('exams', created.exams);
        await del('quizzes', created.quizzes);
        await del('teaching_assignments', created.tas);
        await del('teachers', created.teachers);
        await del('users', created.users);
        await del('classes', created.classes);
        await del('subjects', created.subjects);
        console.log('Cleanup: semua fixture dihapus');
    } catch (e) {
        console.error('Cleanup error (sisa fixture ber-prefix e2e_ mungkin masih ada — cek manual):', e.message);
    }
}

main()
    .catch(e => { console.error('FATAL:', e.message); failures++; })
    .finally(async () => {
        await cleanup();
        process.exit(failures === 0 ? 0 : 1);
    });
