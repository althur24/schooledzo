/**
 * check_create_roles.js — uji E2E fitur "guru & admin bisa buat ulangan/UTS/UAS (sinkron)".
 * Skenario:
 *  (a) guru buat UTS dalam scope → 200, created_by = guru
 *  (b) guru buat UTS di luar scope → 403
 *  (c) admin buat ulangan pada TA guru → muncul di daftar guru (draft, creator_role ADMIN)
 *  (d) guru pemilik edit + isi soal + publish draft buatan admin → 200; siswa kelas itu bisa mulai & soal sampai
 *  (e) admin publish ulangan untuk guru → 200
 *  (f) guru B (bukan pemilik) edit/soal di ulangan guru A → 403
 *  (g) guru melihat draft UTS di daftar; guru B tidak melihatnya
 *  (h) cleanup
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { assertMin, makeSession, makeApi } = require('./loadtest/e2e/helpers.cjs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const api = makeApi(BASE_URL);
const iso = (ms) => new Date(ms).toISOString();
const created = { exams: [], official: [], sessions: [] };

async function main() {
    const NOW = Date.now();
    // TA dari tahun AKTIF yang kelasnya punya siswa (via students.class_id ATAU enrollment tahun tsb)
    const { data: tas } = await supabase
        .from('teaching_assignments')
        .select('id, teacher_id, subject_id, class_id, academic_year_id, teacher:teachers(user_id, school_id), academic_year:academic_years!inner(is_active)')
        .eq('academic_year.is_active', true)
        .limit(20);
    let ta = null, student = null;
    for (const cand of tas || []) {
        const { data: st } = await supabase.from('students').select('id, user_id, class_id').eq('class_id', cand.class_id).limit(1).maybeSingle();
        if (st) { ta = cand; student = st; break; }
        const { data: en } = await supabase.from('student_enrollments').select('student:students(id, user_id, class_id)').eq('class_id', cand.class_id).eq('academic_year_id', cand.academic_year_id).eq('status', 'ACTIVE').limit(1).maybeSingle();
        const enStudent = en?.student ? (Array.isArray(en.student) ? en.student[0] : en.student) : null;
        if (enStudent) { ta = cand; student = enStudent; break; }
    }
    if (!ta) throw new Error('Tidak ada TA aktif dengan siswa di kelasnya');
    const guruAUserId = ta.teacher.user_id;

    // Guru lain (bukan pemilik TA ini) — WAJIB sekolah yang sama, supaya test (g)
    // tidak lolos trivially hanya karena beda sekolah (scope multi-tenant)
    const { data: otherTeacher } = await supabase
        .from('teachers')
        .select('user_id')
        .eq('school_id', ta.teacher.school_id)
        .neq('user_id', guruAUserId)
        .limit(1)
        .maybeSingle();
    if (!otherTeacher) throw new Error('Guru kedua (sekolah sama, bukan pemilik TA) tidak ditemukan');

    // Admin dari sekolah yang sama dengan guru TA (scope multi-tenant berlaku)
    const { data: admin } = await supabase.from('users').select('id').eq('role', 'ADMIN').eq('school_id', ta.teacher.school_id).limit(1).maybeSingle();

    const guruAToken = await makeSession(supabase, guruAUserId, created);
    const guruBToken = await makeSession(supabase, otherTeacher.user_id, created);
    const adminToken = admin ? await makeSession(supabase, admin.id, created) : null;

    // (a) guru buat UTS dalam scope
    console.log('\n=== UTS/UAS oleh guru ===');
    const resA = await api('/api/official-exams', guruAToken, {
        method: 'POST',
        body: JSON.stringify({
            exam_type: 'UTS', title: '[TEST] UTS oleh Guru', subject_id: ta.subject_id,
            start_time: iso(NOW + 3600000), duration_minutes: 60,
            target_class_ids: [ta.class_id], academic_year_id: ta.academic_year_id
        })
    });
    const bodyA = await resA.json();
    ok(resA.ok && bodyA.created_by === guruAUserId, `(a) guru buat UTS dalam scope → ${resA.status}, created_by = guru`);
    if (bodyA.id) created.official.push(bodyA.id);

    // (b) guru buat UTS di luar scope (kelas yang tidak diajar — sekolah SAMA,
    // supaya 403 benar-benar karena scope TA, bukan karena beda sekolah)
    // classes tidak punya school_id — scope sekolah lewat academic_years
    const { data: schoolClasses } = await supabase
        .from('classes')
        .select('id, academic_year:academic_years!inner(school_id)')
        .eq('academic_year.school_id', ta.teacher.school_id)
        .neq('id', ta.class_id)
        .limit(10);
    const { data: guruATas } = await supabase.from('teaching_assignments').select('class_id').eq('teacher_id', ta.teacher_id);
    const guruAClassIds = new Set((guruATas || []).map(x => x.class_id));
    const otherClass = (schoolClasses || []).find(c => !guruAClassIds.has(c.id));
    if (!otherClass) throw new Error('Tidak ada kelas lain di sekolah yang sama yang tidak diajar guru A — test (b) tidak bisa dibedakan dari (a)');
    const resB = await api('/api/official-exams', guruAToken, {
        method: 'POST',
        body: JSON.stringify({
            exam_type: 'UTS', title: '[TEST] UTS luar scope', subject_id: ta.subject_id,
            start_time: iso(NOW + 3600000), duration_minutes: 60,
            target_class_ids: [otherClass.id], academic_year_id: ta.academic_year_id
        })
    });
    ok(resB.status === 403, `(b) guru buat UTS di luar scope → 403 (dapat ${resB.status})`);

    // (g) draft UTS tampil di daftar guru A, tidak di guru B
    const listA = await (await api('/api/official-exams', guruAToken)).json();
    ok(Array.isArray(listA) && listA.some(e => e.id === bodyA.id && !e.is_active), '(g) draft UTS tampil di daftar guru pemilik scope');
    const listB = await (await api('/api/official-exams', guruBToken)).json();
    ok(Array.isArray(listB) && !listB.some(e => e.id === bodyA.id), '(g) draft UTS TIDAK tampil di guru lain di luar scope');

    // (c) admin buat ulangan pada TA guru A
    console.log('\n=== Ulangan oleh admin untuk guru ===');
    if (!adminToken) { console.log('SKIP (c-f): user ADMIN tidak ditemukan'); }
    else {
        const resC = await api('/api/exams', adminToken, {
            method: 'POST',
            body: JSON.stringify({
                title: '[TEST] Ulangan buatan Admin', start_time: iso(NOW - 60000),
                duration_minutes: 45, teaching_assignment_id: ta.id
            })
        });
        const bodyC = await resC.json();
        ok(resC.ok && bodyC.created_by === admin.id, `(c) admin buat ulangan di TA guru → ${resC.status}, created_by = admin`);
        if (bodyC.id) created.exams.push(bodyC.id);

        // muncul di daftar guru A sebagai draft + creator_role ADMIN
        const guruExams = await (await api('/api/exams', guruAToken)).json();
        const found = Array.isArray(guruExams) ? guruExams.find(e => e.id === bodyC.id) : null;
        ok(!!found && found.is_active === false, '(c) draft buatan admin TAMPIL di daftar ulangan guru terkait');
        ok(found?.creator_role === 'ADMIN', `(c) creator_role = ADMIN (badge "Dibuatkan Admin") — dapat ${found?.creator_role}`);

        // (f) guru B tidak boleh edit/kelola soal ulangan guru A
        const resF1 = await api(`/api/exams/${bodyC.id}`, guruBToken, { method: 'PUT', body: JSON.stringify({ title: 'Dibajak guru B' }) });
        ok(resF1.status === 403, `(f) guru B edit ulangan guru A → 403 (dapat ${resF1.status})`);
        const resF2 = await api(`/api/exams/${bodyC.id}/questions`, guruBToken, {
            method: 'POST',
            body: JSON.stringify({ questions: [{ question_text: 'Soal bajakan', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 10 }] })
        });
        ok(resF2.status === 403, `(f) guru B menambah soal ke ulangan guru A → 403 (dapat ${resF2.status})`);

        // (d) guru A melengkapi & publish draft buatan admin
        const resD1 = await api(`/api/exams/${bodyC.id}`, guruAToken, { method: 'PUT', body: JSON.stringify({ description: 'Dilengkapi oleh guru pemilik' }) });
        ok(resD1.ok, `(d) guru pemilik edit draft buatan admin → ${resD1.status}`);
        const resD2 = await api(`/api/exams/${bodyC.id}/questions`, guruAToken, {
            method: 'POST',
            body: JSON.stringify({ questions: [{ question_text: '2 + 2 = ?', question_type: 'MULTIPLE_CHOICE', options: ['3', '4', '5', '6'], correct_answer: '4', points: 100 }] })
        });
        ok(resD2.ok, `(d) guru pemilik menambah soal → ${resD2.status}`);
        // simulasikan review AI/admin selesai tepat sebelum publish (AI berjalan async
        // dan bisa memindahkan status ke admin_review — set approved lagi sebagai final).
        // CATATAN: bypass status='approved' via service-role disengaja untuk test ini.
        // Artinya PASS di sini TIDAK membuktikan jalur admin-review produksi benar —
        // TODO: test terpisah untuk alur publish via admin review yang sesungguhnya.
        await supabase.from('exam_questions').update({ status: 'approved' }).eq('exam_id', bodyC.id);
        let resD3 = await api(`/api/exams/${bodyC.id}`, guruAToken, { method: 'PUT', body: JSON.stringify({ is_active: true }) });
        let bodyD3 = await resD3.json().catch(() => ({}));
        if (bodyD3.pending_publish) {
            // jalur admin-review: simulasikan persetujuan admin lalu publish ulang
            await supabase.from('exam_questions').update({ status: 'approved' }).eq('exam_id', bodyC.id);
            resD3 = await api(`/api/exams/${bodyC.id}`, guruAToken, { method: 'PUT', body: JSON.stringify({ is_active: true }) });
            bodyD3 = await resD3.json().catch(() => ({}));
        }
        ok(resD3.ok && bodyD3.is_active === true, `(d) guru pemilik publish draft buatan admin → ${resD3.status} (is_active=${bodyD3.is_active})`);

        // siswa kelas itu: soal sampai + bisa mulai
        if (student) {
            const sToken = await makeSession(supabase, student.user_id, created);
            const qRes = await api(`/api/exams/${bodyC.id}/questions`, sToken);
            const qs = await qRes.json();
            ok(qRes.ok && Array.isArray(qs) && qs.length > 0, '(d) soal sampai ke siswa kelas sasaran');
            const startRes = await api('/api/exam-submissions', sToken, { method: 'POST', body: JSON.stringify({ exam_id: bodyC.id }) });
            ok(startRes.ok, `(d) siswa bisa mulai ulangan yang dipublish guru → ${startRes.status}`);
        } else {
            console.log('SKIP (d-siswa): tidak ada siswa di kelas TA');
        }

        // (e) admin publish ulangan untuk guru
        const resE = await api('/api/exams', adminToken, {
            method: 'POST',
            body: JSON.stringify({
                title: '[TEST] Ulangan dipublish admin', start_time: iso(NOW + 3600000),
                duration_minutes: 45, teaching_assignment_id: ta.id
            })
        });
        const bodyE = await resE.json();
        if (bodyE.id) created.exams.push(bodyE.id);
        await api(`/api/exams/${bodyE.id}/questions`, adminToken, {
            method: 'POST',
            body: JSON.stringify({ questions: [{ question_text: '1 + 1 = ?', question_type: 'MULTIPLE_CHOICE', options: ['1', '2', '3', '4'], correct_answer: '2', points: 100 }] })
        });
        await supabase.from('exam_questions').update({ status: 'approved' }).eq('exam_id', bodyE.id);
        let resE2 = await api(`/api/exams/${bodyE.id}`, adminToken, { method: 'PUT', body: JSON.stringify({ is_active: true }) });
        let bodyE2 = await resE2.json().catch(() => ({}));
        if (bodyE2.pending_publish) {
            await supabase.from('exam_questions').update({ status: 'approved' }).eq('exam_id', bodyE.id);
            resE2 = await api(`/api/exams/${bodyE.id}`, adminToken, { method: 'PUT', body: JSON.stringify({ is_active: true }) });
            bodyE2 = await resE2.json().catch(() => ({}));
        }
        ok(resE2.ok && bodyE2.is_active === true, `(e) admin menambah soal + publish ulangan untuk guru → ${resE2.status} (is_active=${bodyE2.is_active})`);
    }

    console.log(failures === 0 ? '\nSEMUA PASS' : `\n${failures} FAIL`);
}

main()
    .catch(e => { console.error('FATAL:', e.message); failures++; })
    .finally(async () => {
        try {
            for (const id of created.exams) {
                await supabase.from('exam_submissions').delete().eq('exam_id', id);
                await supabase.from('exam_questions').delete().eq('exam_id', id);
            }
            for (const id of created.official) {
                await supabase.from('official_exam_submissions').delete().eq('exam_id', id);
                await supabase.from('official_exam_questions').delete().eq('exam_id', id);
            }
            if (created.exams.length) await supabase.from('exams').delete().in('id', created.exams);
            if (created.official.length) await supabase.from('official_exams').delete().in('id', created.official);
            if (created.sessions.length) await supabase.from('sessions').delete().in('token', created.sessions);
            console.log('Cleanup: semua data uji dihapus');
        } catch (e) { console.error('Cleanup error:', e.message); }
        process.exit(failures === 0 ? 0 : 1);
    });
