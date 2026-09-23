/**
 * simulasi_ulangan_monitor.js — buat 1 ulangan SIMULASI yang sedang berlangsung
 * untuk SSA SCHOOL, guru turi.guru, lengkap dengan soal + submission siswa
 * (sebagian working, sebagian submitted) agar halaman Monitor Live bisa dicek.
 *
 * Output ID disimpan ke simulasi_monitor_cleanup.json untuk penghapusan nanti.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SSA_SCHOOL_ID = 'f128ce1c-8014-41a8-9183-75e2e823fce1';
const TURI_USER_ID = 'bb0f771d-f54a-41ac-aff1-1e1f83a26138'; // full_name: turi.guru

async function main() {
    // 1. Teacher record
    const { data: teacher, error: tErr } = await sb
        .from('teachers').select('id, school_id').eq('user_id', TURI_USER_ID).single();
    if (tErr || !teacher) throw new Error('Teacher turi.guru tidak ditemukan: ' + tErr?.message);
    if (teacher.school_id !== SSA_SCHOOL_ID) throw new Error('turi.guru bukan guru SSA');
    console.log(`Teacher: ${teacher.id}`);

    // 2. Tahun ajaran aktif SSA
    const { data: activeYear } = await sb
        .from('academic_years').select('id, name')
        .eq('school_id', SSA_SCHOOL_ID).eq('is_active', true)
        .order('created_at', { ascending: false }).limit(1).single();
    if (!activeYear) throw new Error('SSA tidak punya tahun ajaran aktif');
    console.log(`Tahun aktif: ${activeYear.name}`);

    // 3. Teaching assignment turi di tahun aktif — pilih yang rosternya terbanyak
    const { data: tas } = await sb
        .from('teaching_assignments')
        .select('id, class_id, subject_id, class:classes(name), subject:subjects(name)')
        .eq('teacher_id', teacher.id)
        .eq('academic_year_id', activeYear.id);
    if (!tas?.length) throw new Error('turi.guru tidak punya teaching assignment di tahun aktif');

    let chosen = null, chosenRoster = [];
    for (const ta of tas) {
        const { data: roster } = await sb
            .from('student_enrollments')
            .select('student_id')
            .eq('class_id', ta.class_id)
            .eq('academic_year_id', activeYear.id)
            .eq('status', 'ACTIVE');
        if ((roster?.length || 0) > chosenRoster.length) {
            chosen = ta;
            chosenRoster = roster || [];
        }
    }
    const className = Array.isArray(chosen.class) ? chosen.class[0]?.name : chosen.class?.name;
    const subjectName = Array.isArray(chosen.subject) ? chosen.subject[0]?.name : chosen.subject?.name;
    console.log(`TA dipilih: ${subjectName} @ ${className} — roster ${chosenRoster.length} siswa`);
    if (chosenRoster.length < 3) throw new Error('Roster terlalu kecil untuk simulasi');

    // 4. Buat ulangan — sedang berlangsung: mulai 15 menit lalu, durasi 120 menit
    const now = Date.now();
    const startTime = new Date(now - 15 * 60000);
    const { data: exam, error: eErr } = await sb
        .from('exams')
        .insert({
            title: 'SIMULASI MONITOR — Ulangan Live Test',
            description: 'Ulangan simulasi untuk mengetes halaman Monitor Live guru & admin. Aman dihapus.',
            start_time: startTime.toISOString(),
            duration_minutes: 120,
            teaching_assignment_id: chosen.id,
            is_active: true,
            is_randomized: false,
            max_violations: 3,
            show_results_immediately: true
        })
        .select()
        .single();
    if (eErr) throw new Error('Gagal buat exam: ' + eErr.message);
    console.log(`\nExam dibuat: ${exam.id}`);
    console.log(`  mulai: ${startTime.toISOString()} | berakhir: ${new Date(startTime.getTime() + 120 * 60000).toISOString()}`);

    // 5. Buat 10 soal PG @ 10 poin (max_score 100)
    const questionsPayload = Array.from({ length: 10 }, (_, i) => ({
        exam_id: exam.id,
        question_text: `[SIMULASI] Soal nomor ${i + 1}: Berapakah ${i + 2} × ${i + 3}?`,
        question_type: 'MULTIPLE_CHOICE',
        options: [
            String((i + 2) * (i + 3) - 1),
            String((i + 2) * (i + 3)),
            String((i + 2) * (i + 3) + 1),
            String((i + 2) * (i + 3) + 2)
        ],
        correct_answer: 'B',
        points: 10,
        order_index: i + 1
    }));
    const { data: questions, error: qErr } = await sb
        .from('exam_questions').insert(questionsPayload).select('id');
    if (qErr) throw new Error('Gagal buat soal: ' + qErr.message);
    const questionIds = questions.map(q => q.id);
    const maxScore = 100;
    console.log(`10 soal dibuat (max_score ${maxScore})`);

    // 6. Submissions: ~40% submitted, ~30% working (1 dg pelanggaran), sisanya belum mulai
    const n = chosenRoster.length;
    const nSubmitted = Math.max(2, Math.round(n * 0.4));
    const nWorking = Math.max(2, Math.round(n * 0.3));
    const submittedStudents = chosenRoster.slice(0, nSubmitted);
    const workingStudents = chosenRoster.slice(nSubmitted, nSubmitted + nWorking);
    const notStartedCount = n - nSubmitted - nWorking;

    const submissions = [];
    const answers = [];

    const mkSubmission = (studentId, startedMinAgo, isSubmitted, score, violation) => {
        const started = new Date(now - startedMinAgo * 60000);
        const sub = {
            exam_id: exam.id,
            student_id: studentId,
            question_order: questionIds,
            max_score: maxScore,
            started_at: started.toISOString(),
            is_submitted: isSubmitted,
            violation_count: violation ? 1 : 0,
            violations_log: violation
                ? [{ type: 'TAB_SWITCH', timestamp: new Date(now - 3 * 60000).toISOString() }]
                : []
        };
        if (isSubmitted) {
            sub.submitted_at = new Date(started.getTime() + 20 * 60000).toISOString();
            sub.total_score = score;
            sub.is_graded = true;
        }
        return sub;
    };

    submittedStudents.forEach((s, i) => {
        const correct = 5 + (i % 6); // skor bervariasi 50–100
        submissions.push(mkSubmission(s.student_id, 25 + i, true, correct * 10, false));
    });
    workingStudents.forEach((s, i) => {
        submissions.push(mkSubmission(s.student_id, 5 + i * 3, false, null, i === 0)); // siswa pertama working → 1 pelanggaran
    });

    const { data: insertedSubs, error: sErr } = await sb
        .from('exam_submissions').insert(submissions).select('id, student_id, is_submitted');
    if (sErr) throw new Error('Gagal buat submissions: ' + sErr.message);

    // 7. Jawaban: submitted → semua 10 soal (skor sesuai); working → 3–6 soal terjawab
    for (const sub of insertedSubs) {
        const isWorking = !sub.is_submitted;
        const idx = insertedSubs.indexOf(sub);
        const answerCount = isWorking ? 3 + (idx % 4) : 10;
        const correctTarget = isWorking ? Math.min(2, answerCount) : Math.max(5, (submissions[idx].total_score || 50) / 10);
        for (let q = 0; q < answerCount; q++) {
            const correct = q < correctTarget;
            answers.push({
                submission_id: sub.id,
                question_id: questionIds[q],
                answer: correct ? 'B' : 'A',
                is_correct: correct,
                points_earned: correct ? 10 : 0
            });
        }
    }
    const { error: aErr } = await sb.from('exam_answers').insert(answers);
    if (aErr) throw new Error('Gagal buat answers: ' + aErr.message);

    console.log(`\nSubmissions: ${insertedSubs.length} (${nSubmitted} submitted, ${nWorking} working, ${notStartedCount} belum mulai)`);
    console.log(`Jawaban: ${answers.length} baris | 1 siswa working punya 1 pelanggaran TAB_SWITCH`);

    // 8. Simpan ID untuk cleanup
    const cleanup = {
        exam_id: exam.id,
        question_ids: questionIds,
        submission_ids: insertedSubs.map(s => s.id)
    };
    fs.writeFileSync('simulasi_monitor_cleanup.json', JSON.stringify(cleanup, null, 2));

    console.log('\n===== CARA CEK =====');
    console.log(`GURU  : login sebagai turi.guru → /dashboard/guru/ulangan → kartu "SIMULASI MONITOR" → tombol Monitor Live`);
    console.log(`        atau langsung: /dashboard/guru/uts-uas/${exam.id}/monitor?type=ulangan`);
    console.log(`ADMIN : /dashboard/admin/uts-uas → tab "Ulangan" → kartu SIMULASI MONITOR → Monitor`);
    console.log(`\nCleanup: minta saya hapus dengan file simulasi_monitor_cleanup.json`);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
