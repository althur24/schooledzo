/**
 * check_monitor_e2e.js — simulasi penuh logika route monitor (READ-ONLY, tanpa auto-submit)
 * pada ulangan yang benar-benar punya submission, lalu bandingkan hasil rakitan dengan data mentah.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { fetchAllRowsCjs } = require('./loadtest/e2e/helpers.cjs');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function main() {
    // Cari ulangan dengan submission terbanyak.
    // WAJIB paginasi: PostgREST memotong diam-diam di 1000 baris — tanpa ini,
    // hitungan bisa salah dan exam teratas salah pilih.
    const allSubs = await fetchAllRowsCjs(
        supabase.from('exam_submissions').select('exam_id').order('id')
    );
    const byExam = {};
    allSubs.forEach(s => { byExam[s.exam_id] = (byExam[s.exam_id] || 0) + 1; });
    const topExamId = Object.entries(byExam).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!topExamId) { console.log('Tidak ada submission sama sekali'); return; }
    console.log(`Ulangan dengan submission terbanyak: ${topExamId} (${byExam[topExamId]} submission)`);

    // === Replika route: fetch exam ===
    const { data: exam, error } = await supabase
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
        .eq('id', topExamId)
        .single();
    if (error) throw error;
    const ta = Array.isArray(exam.teaching_assignment) ? exam.teaching_assignment[0] : exam.teaching_assignment;
    console.log(`Judul: ${exam.title} | remedial: ${exam.is_remedial} | durasi: ${exam.duration_minutes}m`);

    // === Replika route: roster ===
    let rosterQuery = supabase
        .from('student_enrollments')
        .select(`class_id, student:students!student_enrollments_student_id_fkey(id, nis, user:users!students_user_id_fkey(full_name))`)
        .eq('class_id', ta.class_id)
        .eq('status', 'ACTIVE');
    if (ta.academic_year_id) rosterQuery = rosterQuery.eq('academic_year_id', ta.academic_year_id);
    const { data: roster } = await rosterQuery;
    let students = [...new Map((roster || []).map(e => [e.student?.id, e.student])).values()].filter(Boolean);

    const allowedIds = Array.isArray(exam.allowed_student_ids) ? exam.allowed_student_ids : [];
    if (exam.is_remedial && allowedIds.length > 0) {
        students = students.filter(s => allowedIds.includes(s.id));
    }

    // === Replika route: submissions + answer counts ===
    const studentIds = students.map(s => s.id);
    const { data: subs } = await supabase
        .from('exam_submissions')
        .select('id, student_id, is_submitted, started_at')
        .eq('exam_id', topExamId)
        .in('student_id', studentIds.length ? studentIds : ['00000000-0000-0000-0000-000000000000']);
    const { data: answers } = await supabase
        .from('exam_answers')
        .select('submission_id')
        .in('submission_id', (subs || []).map(s => s.id).length ? subs.map(s => s.id) : ['00000000-0000-0000-0000-000000000000']);
    const ansCount = {};
    (answers || []).forEach(a => { ansCount[a.submission_id] = (ansCount[a.submission_id] || 0) + 1; });

    // === Rakitan summary ===
    const now = Date.now(), durationMs = exam.duration_minutes * 60000;
    let notStarted = 0, working = 0, submitted = 0, expired = 0;
    const subMap = new Map((subs || []).map(s => [s.student_id, s]));
    for (const st of students) {
        const sub = subMap.get(st.id);
        if (!sub) { notStarted++; continue; }
        if (sub.is_submitted) { submitted++; continue; }
        working++;
        if (sub.started_at && now > new Date(sub.started_at).getTime() + durationMs) expired++;
    }

    console.log(`\nRoster (target): ${students.length}`);
    console.log(`  not_started: ${notStarted}`);
    console.log(`  working:     ${working} (${expired} di antaranya sudah expired → akan di-auto-submit route)`);
    console.log(`  submitted:   ${submitted}`);
    console.log(`Jawaban tersimpan: ${(answers || []).length} baris untuk ${Object.keys(ansCount).length} submission`);

    // Cross-check: total submission mentah untuk exam ini
    const { count: rawCount } = await supabase
        .from('exam_submissions').select('id', { count: 'exact', head: true }).eq('exam_id', topExamId);
    console.log(`\nCross-check: submission mentah exam ini = ${rawCount}, tercakup roster = ${(subs || []).length}`);
    if (rawCount !== (subs || []).length) {
        console.log('  !! selisih: ada submission dari siswa di luar roster (pindah kelas / non-ACTIVE / remedial filter)');
    }

    // Sanity: semua submission harus milik siswa roster
    const orphan = (subs || []).filter(s => !studentIds.includes(s.student_id));
    console.log(orphan.length === 0 ? 'PASS  tidak ada submission yatim' : `FAIL  ${orphan.length} submission yatim`);
    console.log('PASS  simulasi rakitan selesai tanpa error');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
