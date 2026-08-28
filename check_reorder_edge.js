/**
 * check_reorder_edge.js — uji edge-case endpoint reorder (fixture SENDIRI).
 *
 * PENTING: versi lama memakai kuis PRODUKSI milik guru acak (bisa 403 karena
 * bukan pemilik) dan mengubah soal asli. Versi ini membuat 2 kuis fixture milik
 * satu guru e2e_ yang sama, sehingga skenario lintas-kuis bisa diuji tanpa
 * menyentuh data produksi. Cleanup otomatis di finally.
 *
 * Skenario:
 *  (a) payload berisi id soal milik kuis LAIN → baris milik kuis lain TIDAK berubah
 *  (b) reorder parsial (hanya 2 soal ditukar) → hanya 2 itu berubah, sisanya utuh
 *  (c) payload berisi id yang tidak ada → tidak ada baris berubah, tidak error aneh
 *      (PERILAKU API: mengembalikan updated=1 walau id fiktif — updated menghitung
 *       PERCOBAAN, bukan baris terpengaruh. Follow-up terpisah: API sebaiknya
 *       menolak id asing atau mengembalikan updated=0.)
 *  (d) restore semua perubahan + cleanup fixture
 *
 * Pakai: node check_reorder_edge.js  (server harus jalan di BASE_URL)
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
const created = { users: [], teachers: [], tas: [], classes: [], subjects: [], quizzes: [], quizQuestions: [], sessions: [] };

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
        { ...subjT, id: undefined, name: `${U} Mapel Edge`, school_id: school.id }, 'subject fixture');
    created.subjects.push(subject.id);

    const classT = await template('classes');
    const klass = await mustInsert(supabase, 'classes',
        { ...classT, id: undefined, name: `${U} Kelas Edge`, academic_year_id: year.id }, 'class fixture');
    created.classes.push(klass.id);

    const passHash = bcrypt.hashSync('e2e-pass', 10);
    const guruUser = await mustInsert(supabase, 'users',
        { username: `${U}_guru`, full_name: 'E2E Guru Edge', password_hash: passHash, role: 'GURU', school_id: school.id }, 'guru fixture');
    created.users.push(guruUser.id);

    const teachT = await template('teachers');
    const teacher = await mustInsert(supabase, 'teachers',
        { ...teachT, id: undefined, user_id: guruUser.id, nip: `e2ee${runId}` }, 'teacher fixture');
    created.teachers.push(teacher.id);

    const taT = await template('teaching_assignments');
    const ta = await mustInsert(supabase, 'teaching_assignments',
        { ...taT, id: undefined, teacher_id: teacher.id, subject_id: subject.id, class_id: klass.id, academic_year_id: year.id }, 'TA fixture');
    created.tas.push(ta.id);

    // Dua kuis milik guru fixture yang sama
    const quizT = await template('quizzes');
    async function makeQuiz(title) {
        const q = await mustInsert(supabase, 'quizzes', {
            ...quizT, id: undefined, created_at: undefined, title: `[TEST] ${title}`,
            teaching_assignment_id: ta.id, is_active: false, duration_minutes: 30, deadline: null,
            is_remedial: false, allowed_student_ids: [],
        }, `quiz fixture ${title}`);
        created.quizzes.push(q.id);
        return q;
    }
    const quizA = await makeQuiz(`${U} Kuis Edge A`);
    const quizB = await makeQuiz(`${U} Kuis Edge B`);

    const qT = await template('quiz_questions');
    if (!qT) throw new Error('Tidak ada baris sumber di quiz_questions untuk template soal');
    async function makeQuestions(parentId, tag) {
        const rows = [];
        for (let i = 1; i <= 3; i++) {
            const q = await mustInsert(supabase, 'quiz_questions', {
                ...qT, id: undefined, created_at: undefined, quiz_id: parentId,
                question_text: `[TEST] ${U} ${tag} soal ${i}`, order_index: i,
                question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 10,
            }, `quiz_questions ${tag} #${i}`);
            created.quizQuestions.push(q.id);
            rows.push({ id: q.id, order_index: i });
        }
        return rows;
    }
    const qsA = await makeQuestions(quizA.id, 'A');
    const qsB = await makeQuestions(quizB.id, 'B');

    const guruToken = await makeSession(supabase, guruUser.id, created);
    return { U, quizA, quizB, qsA, qsB, guruToken };
}

async function main() {
    const fx = await setupFixtures();
    console.log(`Fixture OK: 2 kuis milik guru e2e (${fx.qsA.length} + ${fx.qsB.length} soal)`);

    const a0 = fx.qsA[0], a1 = fx.qsA[1];
    const foreign = fx.qsB[0];
    const foreignBefore = foreign.order_index;

    // (a) reorder kuis A: tukar 2 soal pertamanya + selundupkan id milik kuis B
    const resA = await api(`/api/quizzes/${fx.quizA.id}/questions`, fx.guruToken, {
        method: 'POST',
        body: JSON.stringify({ reorder: [
            { id: a0.id, order_index: a1.order_index },
            { id: a1.id, order_index: a0.order_index },
            { id: foreign.id, order_index: 999 }
        ] })
    });
    ok(resA.ok, `(a) POST diterima — status ${resA.status}`);

    const { data: foreignAfter } = await supabase.from('quiz_questions').select('order_index').eq('id', foreign.id).single();
    ok(foreignAfter?.order_index === foreignBefore, `(a) soal milik kuis lain TIDAK berubah (tetap ${foreignBefore})`);

    const { data: a0After } = await supabase.from('quiz_questions').select('order_index').eq('id', a0.id).single();
    const { data: a1After } = await supabase.from('quiz_questions').select('order_index').eq('id', a1.id).single();
    ok(a0After?.order_index === a1.order_index && a1After?.order_index === a0.order_index, '(a) 2 soal kuis A benar-benar tertukar');

    // (b) verifikasi soal kuis A lainnya tidak tersentuh
    const { data: restA } = await supabase.from('quiz_questions').select('id, order_index').eq('quiz_id', fx.quizA.id);
    const beforeMap = new Map(fx.qsA.map(q => [q.id, q.order_index]));
    const touchedOthers = (restA || []).filter(q => q.id !== a0.id && q.id !== a1.id && q.order_index !== beforeMap.get(q.id));
    ok(touchedOthers.length === 0, `(b) soal lain di kuis A utuh (${touchedOthers.length} berubah)`);

    // (c) id yang tidak ada sama sekali
    // CATATAN: updated=1 untuk id fiktif adalah perilaku API yang membingungkan —
    // updated menghitung PERCOBAAN update, bukan baris yang benar-benar berubah.
    // Follow-up terpisah: endpoint sebaiknya menolak id asing (400) atau updated=0.
    const resC = await api(`/api/quizzes/${fx.quizA.id}/questions`, fx.guruToken, {
        method: 'POST',
        body: JSON.stringify({ reorder: [{ id: '00000000-0000-0000-0000-000000000000', order_index: 12345 }] })
    });
    const bodyC = await resC.json().catch(() => null);
    ok(resC.ok && bodyC?.updated === 1, `(c) id fiktif → 200 updated=1 (perilaku terdokumentasi: updated = percobaan, bukan baris)`);
    const { data: afterC } = await supabase.from('quiz_questions').select('id').eq('quiz_id', fx.quizA.id).eq('order_index', 12345);
    ok((afterC || []).length === 0, '(c) tidak ada baris yang benar-benar berubah oleh id fiktif');

    // (d) restore kuis A
    const resD = await api(`/api/quizzes/${fx.quizA.id}/questions`, fx.guruToken, {
        method: 'POST',
        body: JSON.stringify({ reorder: [
            { id: a0.id, order_index: a0.order_index },
            { id: a1.id, order_index: a1.order_index }
        ] })
    });
    const { data: restored } = await supabase.from('quiz_questions').select('id, order_index').eq('quiz_id', fx.quizA.id);
    const allRestored = (restored || []).every(q => q.order_index === beforeMap.get(q.id));
    ok(resD.ok && allRestored, '(d) kuis A kembali persis seperti semula');
}

async function cleanup() {
    try {
        const del = async (table, ids) => { if (ids.length) await supabase.from(table).delete().in('id', ids) };
        if (created.sessions.length) await supabase.from('sessions').delete().in('token', created.sessions);
        await del('quiz_questions', created.quizQuestions);
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
        console.log(failures === 0 ? '\nSEMUA PASS' : `\n${failures} FAIL`);
        process.exit(failures === 0 ? 0 : 1);
    });
