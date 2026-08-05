require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const SCHOOL = 'd09b79ad-aa01-4950-afb7-4fb5112c1df7';
const YEAR = 'e8d07504-cb9f-4ff3-8615-4b10cb3ca6a0';
const j = (x) => JSON.stringify(x, null, 1);

async function main() {
    // 1. Kelas 9.x di tahun aktif
    const { data: classes } = await supabase
        .from('classes').select('id, name').eq('academic_year_id', YEAR).in('name', ['9.1', '9.2', '9.3', '9.4', '9.5']);
    const classById = Object.fromEntries((classes || []).map(c => [c.id, c.name]));
    console.log('=== kelas 9.x ===');
    console.log(j(classById));

    // 2. TA utk kelas2 tsb
    const { data: tas } = await supabase
        .from('teaching_assignments')
        .select('id, class_id, teacher_id, subjects(name), teachers(user:users(full_name))')
        .eq('academic_year_id', YEAR).in('class_id', Object.keys(classById));
    const taById = Object.fromEntries((tas || []).map(t => [t.id, t]));
    console.log(`\n=== TA kelas 9.x: ${(tas || []).length} ===`);

    // 3. Exams utk TA2 tsb + jumlah soal
    const { data: exams } = await supabase
        .from('exams')
        .select('id, title, teaching_assignment_id, is_active, created_at')
        .in('teaching_assignment_id', Object.keys(taById))
        .order('created_at', { ascending: false });
    console.log(`\n=== exams kelas 9.x: ${(exams || []).length} ===`);
    for (const e of exams || []) {
        const { count } = await supabase
            .from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', e.id);
        const ta = taById[e.teaching_assignment_id];
        const guru = ta?.teachers?.user?.full_name || '?';
        const mapel = ta?.subjects?.name || '?';
        const kelas = classById[ta?.class_id] || '?';
        console.log(`  [${kelas}] "${e.title}" | ${mapel} | ${guru} | soal=${count} | aktif=${e.is_active} | dibuat=${e.created_at}`);
        console.log(`      id=${e.id}`);
    }

    // 4. Duplikat di question_bank utk semua guru PIIS
    const { data: teachers } = await supabase
        .from('teachers').select('id, user:users(full_name)').eq('school_id', SCHOOL);
    const tIds = (teachers || []).map(t => t.id);
    const tName = Object.fromEntries((teachers || []).map(t => [t.id, t.user?.full_name || '?']));

    const { data: bank } = await supabase
        .from('question_bank')
        .select('id, teacher_id, question_text, source_type, source_name, created_at')
        .in('teacher_id', tIds);
    console.log(`\n=== question_bank PIIS total: ${(bank || []).length} baris ===`);

    const groups = {};
    (bank || []).forEach(q => {
        const key = `${q.teacher_id}||${(q.question_text || '').trim().toLowerCase().slice(0, 120)}`;
        (groups[key] = groups[key] || []).push(q);
    });
    const dups = Object.entries(groups).filter(([, arr]) => arr.length > 1);
    console.log(`grup duplikat (teks sama, guru sama): ${dups.length}`);
    dups.slice(0, 15).forEach(([key, arr]) => {
        console.log(`\n  GURU: ${tName[arr[0].teacher_id]} | "${arr[0].question_text.slice(0, 80)}" | ${arr.length}x`);
        arr.forEach(q => console.log(`     - source=${q.source_type} (${q.source_name || '-'}) dibuat=${q.created_at}`));
    });
}

main().catch(e => console.error('FATAL', e));
