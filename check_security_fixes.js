/**
 * check_security_fixes.js — uji E2E perbaikan keamanan K1/K2/K3 pada
 * ulangan (exams) & UTS/UAS (official_exams):
 *
 *  K1: GET /api/{exam,official-exam}-submissions/[id] sebagai SISWA yang masih
 *      mengerjakan → correct_answer TIDAK bocor (undefined/null).
 *  K2: PUT koleksi sebagai GURU lain (bukan pemilik TA) → 403;
 *      PUT grading [id] UTS/UAS sebagai guru lain → 403.
 *  K3: POST ganda bersamaan (race double-POST) → hanya 1 submission (UNIQUE),
 *      kedua request tetap dapat respons valid (resume).
 *
 * Semua fixture dibuat sendiri (prefix [TEST]/e2e_) & dihapus di finally.
 * Pakai: node check_security_fixes.js  (server harus jalan di BASE_URL)
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const { mustInsert, makeSession, makeApi } = require('./loadtest/e2e/helpers.cjs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const api = makeApi(BASE_URL);
const iso = (ms) => new Date(ms).toISOString();
const created = {
    users: [], teachers: [], tas: [], classes: [], subjects: [], exams: [], official: [],
    examQuestions: [], officialQuestions: [], examSubs: [], officialSubs: [], sessions: []
};

async function template(table) {
    const { data } = await supabase.from(table).select('*').limit(1);
    return data && data[0] ? data[0] : null;
}

// Fixture: guru pemilik + guru lain + siswa, TA + exam + official exam aktif
async function setupFixtures() {
    const runId = Date.now() % 100000;
    const U = `sec_${runId}`;
    const NOW = Date.now();

    const { data: school } = await supabase.from('schools').select('id').limit(1).single();
    const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', school.id).eq('is_active', true).limit(1).maybeSingle();
    if (!school || !year) throw new Error('school/tahun ajaran aktif tidak ditemukan');

    const subjT = await template('subjects');
    const subject = await mustInsert(supabase, 'subjects', { ...subjT, id: undefined, name: `${U} Mapel`, school_id: school.id }, 'subject');
    created.subjects.push(subject.id);
    const classT = await template('classes');
    const klass = await mustInsert(supabase, 'classes', { ...classT, id: undefined, name: `${U} Kelas`, academic_year_id: year.id }, 'class');
    created.classes.push(klass.id);

    const passHash = bcrypt.hashSync('sec-pass', 10);
    const mkUser = (role, name) => mustInsert(supabase, 'users',
        { username: `${U}_${name}`, full_name: `Sec ${name}`, password_hash: passHash, role, school_id: school.id }, `user ${name}`);
    const guruOwner = await mkUser('GURU', 'owner');
    const guruLain = await mkUser('GURU', 'lain');
    const siswa = await mkUser('SISWA', 'siswa');
    created.users.push(guruOwner.id, guruLain.id, siswa.id);

    const teachT = await template('teachers');
    const mkTeacher = (uid, nip) => mustInsert(supabase, 'teachers', { ...teachT, id: undefined, user_id: uid, nip }, `teacher ${nip}`);
    const ownerTeacher = await mkTeacher(guruOwner.id, `sec${runId}a`);
    const lainTeacher = await mkTeacher(guruLain.id, `sec${runId}b`);
    created.teachers.push(ownerTeacher.id, lainTeacher.id);

    const taT = await template('teaching_assignments');
    const ta = await mustInsert(supabase, 'teaching_assignments',
        { ...taT, id: undefined, teacher_id: ownerTeacher.id, subject_id: subject.id, class_id: klass.id, academic_year_id: year.id }, 'TA');
    created.tas.push(ta.id);

    const studT = await template('students');
    const student = await mustInsert(supabase, 'students', { ...studT, id: undefined, user_id: siswa.id, nis: `sec${runId}`, class_id: klass.id }, 'student');
    // students tidak masuk registry delete-by-id di cleanup (dihapus via user cascade? tidak) — daftar manual
    created.students = created.students || [];

    // Ulangan milik guruOwner — jendela terbuka
    const examT = await template('exams');
    const exam = await mustInsert(supabase, 'exams', {
        ...examT, id: undefined, created_at: undefined, title: `[TEST] ${U} Ulangan`,
        teaching_assignment_id: ta.id, is_active: true, is_randomized: false,
        start_time: iso(NOW - 60000), duration_minutes: 60, is_remedial: false, allowed_student_ids: [],
    }, 'exam');
    created.exams.push(exam.id);

    // UTS milik guruOwner — jendela terbuka, target kelas fixture
    const offT = await template('official_exams');
    const official = await mustInsert(supabase, 'official_exams', {
        ...offT, id: undefined, created_at: undefined, title: `[TEST] ${U} UTS`,
        school_id: school.id, subject_id: subject.id, academic_year_id: year.id,
        exam_type: 'UTS', is_active: true, is_randomized: false,
        start_time: iso(NOW - 60000), duration_minutes: 60, is_remedial: false,
        allowed_student_ids: null, target_class_ids: [klass.id], created_by: guruOwner.id,
    }, 'official exam');
    created.official.push(official.id);

    // Soal kunci 'A' untuk keduanya
    const mkQ = async (table, fk, parentId, registry) => {
        const qT = await template(table);
        if (!qT) throw new Error(`template ${table} kosong`);
        const q = await mustInsert(supabase, table, {
            ...qT, id: undefined, created_at: undefined, [fk]: parentId,
            question_text: `[TEST] ${U} soal 1`, question_type: 'MULTIPLE_CHOICE',
            options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 10, order_index: 1,
        }, `${table} #1`);
        registry.push(q.id);
        return q;
    };
    const examQ = await mkQ('exam_questions', 'exam_id', exam.id, created.examQuestions);
    const offQ = await mkQ('official_exam_questions', 'exam_id', official.id, created.officialQuestions);

    const siswaToken = await makeSession(supabase, siswa.id, created);
    const ownerToken = await makeSession(supabase, guruOwner.id, created);
    const lainToken = await makeSession(supabase, guruLain.id, created);

    return { student, siswaToken, ownerToken, lainToken, exam, official, examQ, offQ, U };
}

async function main() {
    const fx = await setupFixtures();

    // ============ K3: race double-POST ============
    console.log('\n=== K3: race double-POST (ulangan & UTS/UAS) ===');
    const [s1, s2] = await Promise.all([
        api('/api/exam-submissions', fx.siswaToken, { method: 'POST', body: JSON.stringify({ exam_id: fx.exam.id }) }),
        api('/api/exam-submissions', fx.siswaToken, { method: 'POST', body: JSON.stringify({ exam_id: fx.exam.id }) }),
    ]);
    const b1 = await s1.json().catch(() => null), b2 = await s2.json().catch(() => null);
    ok((s1.ok || s1.status === 400) && (s2.ok || s2.status === 400), `K3 ulangan: kedua POST paralel tidak 500 (${s1.status}/${s2.status})`);
    ok(b1?.id && b2?.id && b1.id === b2.id, `K3 ulangan: kedua request resolve ke submission yang SAMA (id ${b1?.id?.slice(0, 8)} == ${b2?.id?.slice(0, 8)})`);
    const { count: examSubCount } = await supabase.from('exam_submissions').select('id', { count: 'exact', head: true }).eq('exam_id', fx.exam.id).eq('student_id', fx.student.id);
    ok(examSubCount === 1, `K3 ulangan: tepat 1 baris submission di DB (dapat ${examSubCount})`);
    if (b1?.id) created.examSubs.push(b1.id);

    const [o1, o2] = await Promise.all([
        api('/api/official-exam-submissions', fx.siswaToken, { method: 'POST', body: JSON.stringify({ exam_id: fx.official.id }) }),
        api('/api/official-exam-submissions', fx.siswaToken, { method: 'POST', body: JSON.stringify({ exam_id: fx.official.id }) }),
    ]);
    const ob1 = await o1.json().catch(() => null), ob2 = await o2.json().catch(() => null);
    ok((o1.ok || o1.status === 400) && (o2.ok || o2.status === 400), `K3 UTS/UAS: kedua POST paralel tidak 500 (${o1.status}/${o2.status})`);
    ok(ob1?.id && ob2?.id && ob1.id === ob2.id, `K3 UTS/UAS: kedua request resolve ke submission yang SAMA`);
    const { count: offSubCount } = await supabase.from('official_exam_submissions').select('id', { count: 'exact', head: true }).eq('exam_id', fx.official.id).eq('student_id', fx.student.id);
    ok(offSubCount === 1, `K3 UTS/UAS: tepat 1 baris submission di DB (dapat ${offSubCount})`);
    if (ob1?.id) created.officialSubs.push(ob1.id);

    // ============ K1: kunci jawaban tidak bocor saat masih mengerjakan ============
    console.log('\n=== K1: kunci jawaban ter-strip untuk siswa in-progress ===');
    // ulangan: siswa belum submit (submission dari K3 masih terbuka)
    const r1 = await api(`/api/exam-submissions/${b1.id}`, fx.siswaToken);
    const d1 = await r1.json().catch(() => null);
    const examQs = d1?.exam?.questions || [];
    const leak1 = examQs.some(q => q.correct_answer !== undefined && q.correct_answer !== null);
    ok(r1.ok && examQs.length > 0 && !leak1, `K1 ulangan: GET [id] in-progress — correct_answer ter-strip (${examQs.length} soal, bocor=${leak1})`);
    // jawab 1 soal dulu, lalu GET lagi — kunci tetap tidak boleh bocor
    await api('/api/exam-submissions', fx.siswaToken, { method: 'PUT', body: JSON.stringify({ submission_id: b1.id, answers: [{ question_id: fx.examQ.id, answer: 'B' }] }) });
    const r1b = await api(`/api/exam-submissions/${b1.id}`, fx.siswaToken);
    const d1b = await r1b.json().catch(() => null);
    const leak1b = (d1b?.exam?.questions || []).some(q => q.correct_answer !== undefined && q.correct_answer !== null);
    ok(r1b.ok && !leak1b, 'K1 ulangan: setelah menjawab 1 soal (belum submit), kunci tetap ter-strip');

    // UTS/UAS: GET [id] in-progress
    const r2 = await api(`/api/official-exam-submissions/${ob1.id}`, fx.siswaToken);
    const d2 = await r2.json().catch(() => null);
    const leak2 = (d2?.answers || []).some(a => a?.question?.correct_answer !== undefined && a?.question?.correct_answer !== null);
    ok(r2.ok && !leak2, `K1 UTS/UAS: GET [id] in-progress — correct_answer ter-strip (bocor=${leak2})`);
    // jawab dulu lalu GET — jawaban yang tersimpan ikut embed soal, kunci harus tetap strip
    await api('/api/official-exam-submissions', fx.siswaToken, { method: 'PUT', body: JSON.stringify({ submission_id: ob1.id, answers: [{ question_id: fx.offQ.id, answer: 'B' }] }) });
    const r2b = await api(`/api/official-exam-submissions/${ob1.id}`, fx.siswaToken);
    const d2b = await r2b.json().catch(() => null);
    const leak2b = (d2b?.answers || []).some(a => a?.question?.correct_answer !== undefined && a?.question?.correct_answer !== null);
    ok(r2b.ok && !leak2b, 'K1 UTS/UAS: setelah autosave (belum submit), kunci tetap ter-strip');
    // guru pemilik BOLEH lihat kunci (untuk grading)
    const r2c = await api(`/api/official-exam-submissions/${ob1.id}`, fx.ownerToken);
    const d2c = await r2c.json().catch(() => null);
    const ownerSeesKey = (d2c?.answers || []).some(a => a?.question?.correct_answer !== undefined && a?.question?.correct_answer !== null);
    ok(r2c.ok && ownerSeesKey, 'K1 UTS/UAS: guru pemilik tetap MELIHAT kunci (untuk grading)');

    // ============ K2: guru lain ditolak ============
    console.log('\n=== K2: otorisasi guru pemilik ===');
    // PUT koleksi ulangan oleh guru lain → 403
    const g1 = await api('/api/exam-submissions', fx.lainToken, { method: 'PUT', body: JSON.stringify({ submission_id: b1.id, violation: { type: 'TAB_SWITCH' } }) });
    ok(g1.status === 403, `K2 ulangan: PUT violation oleh guru lain → 403 (dapat ${g1.status})`);
    // PUT koleksi UTS/UAS oleh guru lain → 403
    const g2 = await api('/api/official-exam-submissions', fx.lainToken, { method: 'PUT', body: JSON.stringify({ submission_id: ob1.id, violation: { type: 'TAB_SWITCH' } }) });
    ok(g2.status === 403, `K2 UTS/UAS: PUT violation oleh guru lain → 403 (dapat ${g2.status})`);
    // PUT grading [id] UTS/UAS oleh guru lain → 403
    const g3 = await api(`/api/official-exam-submissions/${ob1.id}`, fx.lainToken, { method: 'PUT', body: JSON.stringify({ grades: [{ answer_id: '00000000-0000-0000-0000-000000000000', points_earned: 5 }] }) });
    ok(g3.status === 403, `K2 UTS/UAS: PUT grading [id] oleh guru lain → 403 (dapat ${g3.status})`);
    // PUT grading [id] ulangan oleh guru lain → 403
    const g4 = await api(`/api/exam-submissions/${b1.id}`, fx.lainToken, { method: 'PUT', body: JSON.stringify({ answers: [], is_graded: true }) });
    ok(g4.status === 403, `K2 ulangan: PUT grading [id] oleh guru lain → 403 (dapat ${g4.status})`);
    // guru pemilik tetap BOLEH (positive control) — submit siswa dulu supaya grading relevan
    await api('/api/exam-submissions', fx.siswaToken, { method: 'PUT', body: JSON.stringify({ submission_id: b1.id, submit: true }) });
    const g5 = await api(`/api/exam-submissions/${b1.id}`, fx.ownerToken, { method: 'PUT', body: JSON.stringify({ is_graded: true }) });
    ok(g5.ok, `K2 ulangan: guru pemilik PUT grading [id] → ${g5.status} (positive control)`);

    console.log(failures === 0 ? '\nSEMUA PASS' : `\n${failures} FAIL`);
}

async function cleanup() {
    try {
        const del = async (table, ids, col = 'id') => { if (ids.length) await supabase.from(table).delete().in(col, ids) };
        if (created.sessions.length) await supabase.from('sessions').delete().in('token', created.sessions);
        if (created.examSubs.length) {
            await supabase.from('exam_answers').delete().in('submission_id', created.examSubs);
            await supabase.from('exam_submissions').delete().in('id', created.examSubs);
        }
        if (created.officialSubs.length) {
            await supabase.from('official_exam_answers').delete().in('submission_id', created.officialSubs);
            await supabase.from('official_exam_submissions').delete().in('id', created.officialSubs);
        }
        await del('exam_questions', created.examQuestions);
        await del('official_exam_questions', created.officialQuestions);
        await del('exams', created.exams);
        await del('official_exams', created.official);
        await del('teaching_assignments', created.tas);
        await del('teachers', created.teachers);
        // students milik user fixture — hapus via user_id
        for (const uid of created.users) await supabase.from('students').delete().eq('user_id', uid);
        for (const uid of created.users) await supabase.from('notifications').delete().eq('user_id', uid);
        await del('users', created.users);
        await del('classes', created.classes);
        await del('subjects', created.subjects);
        console.log('Cleanup: semua fixture keamanan dihapus');
    } catch (e) {
        console.error('Cleanup error (sisa fixture ber-prefix sec_/ [TEST] mungkin ada — cek manual):', e.message);
    }
}

main()
    .catch(e => { console.error('FATAL:', e.message); failures++; })
    .finally(async () => {
        await cleanup();
        process.exit(failures === 0 ? 0 : 1);
    });
