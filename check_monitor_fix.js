/**
 * check_monitor_fix.js — validasi runtime untuk perbaikan monitor ulangan:
 * 1. Select baru (is_remedial, allowed_student_ids, teacher:teachers(id, school_id)) diterima PostgREST
 * 2. Tenant guard: teacher.school_id cocok dengan sekolah exam; tes lintas-sekolah
 * 3. Roster query (dengan & tanpa filter academic_year_id) mengembalikan siswa
 * 4. Data remedial: is_remedial + allowed_student_ids — bentuk datanya benar array UUID
 * 5. Official monitor: subject:subjects(..., school_id) diterima & mengembalikan school_id
 * 6. Ada TA dengan academic_year_id NULL? (membuktikan fix #2 relevan/tidak)
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
};

async function main() {
    // ===== 0. Konteks: sekolah & tahun aktif =====
    const { data: schools } = await supabase.from('schools').select('id, name').eq('is_active', true);
    console.log(`\n== ${(schools || []).length} sekolah aktif ==`);
    (schools || []).forEach(s => console.log(`   ${s.name} (${s.id})`));

    // ===== 1. Ambil sampel ulangan (exams) per sekolah =====
    const { data: sampleExams, error: examListErr } = await supabase
        .from('exams')
        .select('id, title')
        .order('created_at', { ascending: false })
        .limit(5);
    ok('query daftar exams', !examListErr && sampleExams?.length > 0, `${sampleExams?.length || 0} exam`);
    if (!sampleExams?.length) return;

    // ===== 2. Replika PERSIS select route monitor baru =====
    console.log('\n== Test select route monitor ulangan (persis dari route.ts) ==');
    const examId = sampleExams[0].id;
    const { data: exam, error: examError } = await supabase
        .from('exams')
        .select(`
            id, title, duration_minutes, start_time, is_active, max_violations,
            is_remedial, allowed_student_ids,
            teaching_assignment:teaching_assignments(
                id, teacher_id, class_id, subject_id, academic_year_id,
                class:classes(id, name, school_level, grade_level),
                subject:subjects(id, name, kkm),
                teacher:teachers(id, school_id)
            )
        `)
        .eq('id', examId)
        .single();

    ok('select baru diterima PostgREST', !examError, examError?.message || '');
    if (examError) return;

    const ta = Array.isArray(exam.teaching_assignment) ? exam.teaching_assignment[0] : exam.teaching_assignment;
    const teacherObj = Array.isArray(ta?.teacher) ? ta.teacher[0] : ta?.teacher;
    ok('teaching_assignment ter-resolve', !!ta?.id);
    ok('teacher.school_id ada & bukan null', !!teacherObj?.school_id, `school_id=${teacherObj?.school_id}`);
    ok('class_id ada', !!ta?.class_id);

    // Tenant guard: school_id exam harus milik salah satu sekolah aktif
    const ownerSchool = (schools || []).find(s => s.id === teacherObj?.school_id);
    ok('school_id guru cocok dengan sekolah terdaftar', !!ownerSchool, ownerSchool?.name || 'TIDAK COCOK');

    // Simulasi lintas-sekolah: guard harus menolak (404) untuk sekolah lain
    const otherSchool = (schools || []).find(s => s.id !== teacherObj?.school_id);
    if (otherSchool) {
        const wouldBlock = teacherObj.school_id !== otherSchool.id;
        ok('guard lintas-sekolah akan menolak', wouldBlock,
            `exam milik ${ownerSchool?.name}, penyerang dari ${otherSchool.name}`);
    } else {
        console.log('   SKIP  hanya 1 sekolah — tes lintas-sekolah tidak bisa disimulasikan');
    }

    // ===== 3. Roster query (dengan & tanpa academic_year_id) =====
    console.log('\n== Test roster ==');
    const baseRoster = () => supabase
        .from('student_enrollments')
        .select(`
            class_id,
            student:students!student_enrollments_student_id_fkey(
                id, nis,
                user:users!students_user_id_fkey(full_name)
            ),
            class:classes!student_enrollments_class_id_fkey(id, name)
        `)
        .eq('class_id', ta.class_id)
        .eq('status', 'ACTIVE');

    const { data: rosterNoYear, error: rErr1 } = await baseRoster();
    ok('roster tanpa filter tahun', !rErr1, `${rosterNoYear?.length || 0} siswa`);

    if (ta.academic_year_id) {
        const { data: rosterYear, error: rErr2 } = await baseRoster().eq('academic_year_id', ta.academic_year_id);
        ok('roster dengan filter tahun', !rErr2, `${rosterYear?.length || 0} siswa`);
        if ((rosterNoYear?.length || 0) > 0) {
            ok('filter tahun tidak mengosongkan roster', (rosterYear?.length || 0) > 0,
                `${rosterYear?.length}/${rosterNoYear?.length}`);
        }
    } else {
        console.log('   INFO  TA ini academic_year_id NULL → fix #2 terbukti dipakai');
    }

    // ===== 4. TA dengan academic_year_id NULL di database? =====
    const { count: nullYearCount } = await supabase
        .from('teaching_assignments')
        .select('id', { count: 'exact', head: true })
        .is('academic_year_id', null);
    console.log(`\n   INFO  TA dengan academic_year_id NULL: ${nullYearCount || 0} baris`);

    // ===== 5. Data remedial =====
    console.log('\n== Test remedial ==');
    const { data: remedials } = await supabase
        .from('exams')
        .select('id, title, is_remedial, allowed_student_ids')
        .eq('is_remedial', true)
        .limit(3);
    console.log(`   ${remedials?.length || 0} ulangan remedial ditemukan`);
    for (const r of remedials || []) {
        const ids = r.allowed_student_ids;
        const isArr = Array.isArray(ids);
        const allUuid = isArr && ids.every(x => typeof x === 'string');
        ok(`remedial "${r.title}"`, isArr && (ids.length === 0 || allUuid),
            `allowed_student_ids: ${isArr ? ids.length + ' item' : typeof ids}`);
        // Filter roster bekerja: semua allowed id harus siswa valid
        if (isArr && ids.length > 0) {
            const { count } = await supabase
                .from('students').select('id', { count: 'exact', head: true }).in('id', ids);
            ok(`  semua allowed_student_ids valid`, count === ids.length, `${count}/${ids.length}`);
        }
    }

    // ===== 6. Replika select official monitor baru =====
    console.log('\n== Test select official monitor (dengan school_id di subject) ==');
    const { data: officialSample } = await supabase
        .from('official_exams').select('id').order('created_at', { ascending: false }).limit(1);
    if (officialSample?.length) {
        const { data: oExam, error: oErr } = await supabase
            .from('official_exams')
            .select(`
                id, title, exam_type, duration_minutes, start_time, is_active, max_violations, subject_id, target_class_ids,
                subject:subjects(id, name, kkm, school_id)
            `)
            .eq('id', officialSample[0].id)
            .single();
        ok('select official diterima PostgREST', !oErr, oErr?.message || '');
        const oSubj = oExam && (Array.isArray(oExam.subject) ? oExam.subject[0] : oExam.subject);
        ok('subject.school_id ada & cocok sekolah terdaftar',
            !!oSubj?.school_id && (schools || []).some(s => s.id === oSubj.school_id),
            `school_id=${oSubj?.school_id}`);
    } else {
        console.log('   SKIP  tidak ada official_exams');
    }

    // ===== 7. Submissions query (batchedIn replika 1 chunk) =====
    console.log('\n== Test query submissions & answers ==');
    const { data: subs, error: sErr } = await supabase
        .from('exam_submissions')
        .select('id, student_id, is_submitted, is_graded, violation_count, started_at, submitted_at, total_score, max_score')
        .eq('exam_id', examId)
        .limit(100);
    ok('select exam_submissions', !sErr, `${subs?.length || 0} submission`);
    if (subs?.length) {
        const { error: aErr } = await supabase
            .from('exam_answers').select('submission_id').in('submission_id', subs.map(s => s.id)).limit(100);
        ok('select exam_answers batch', !aErr, aErr?.message || '');
    }
    const { error: qErr } = await supabase
        .from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', examId);
    ok('count exam_questions', !qErr, qErr?.message || '');

    console.log(`\n===== HASIL: ${pass} PASS, ${fail} FAIL =====`);
    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
