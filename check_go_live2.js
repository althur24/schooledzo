require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const PIIS = 'd09b79ad-aa01-4950-afb7-4fb5112c1df7';
const YEAR = 'e8d07504-cb9f-4ff3-8615-4b10cb3ca6a0';

async function main() {
    // 1. Siswa PIIS yang class_id-nya BUKAN tahun aktif
    const { data: years } = await supabase.from('academic_years').select('id, name').eq('school_id', PIIS);
    const { data: classes } = await supabase.from('classes').select('id, name, academic_year_id')
        .in('academic_year_id', years.map(y => y.id));
    const classById = Object.fromEntries(classes.map(c => [c.id, c]));
    const students = [];
    for (let page = 0; page < 5; page++) {
        const { data } = await supabase.from('students')
            .select('id, nis, class_id, user:users(full_name)').eq('school_id', PIIS)
            .range(page * 1000, (page + 1) * 1000 - 1);
        students.push(...(data || []));
        if ((data || []).length < 1000) break;
    }
    console.log('=== Siswa PIIS dengan class_id bukan tahun aktif ===');
    students.forEach(s => {
        const c = classById[s.class_id];
        if (s.class_id && c && c.academic_year_id !== YEAR) {
            const yearName = years.find(y => y.id === c.academic_year_id)?.name;
            console.log(`  ${s.user?.full_name} (NIS ${s.nis}) -> kelas "${c.name}" tahun ${yearName}`);
        }
    });

    // 2. Jadwal ujian HARI INI dalam WIB (Aug 4 17:00Z - Aug 5 16:59Z)
    console.log('\n=== Ulangan & UTS/UAS mulai HARI INI (WIB) ===');
    const gte = '2026-08-04T17:00:00Z', lte = '2026-08-05T16:59:59Z';
    const { data: exams } = await supabase.from('exams')
        .select('id, title, is_active, start_time, teaching_assignment:teaching_assignments!inner(academic_year_id, classes(name), subjects(name))')
        .gte('start_time', gte).lte('start_time', lte);
    (exams || []).forEach(e => console.log(`  ${e.is_active ? '✅' : '❌DRAFT'} "${e.title}" [${e.teaching_assignment?.classes?.name}] ${e.start_time}`));
    if (!exams?.length) console.log('  (kosong)');
    const { data: oexams } = await supabase.from('official_exams')
        .select('id, title, exam_type, is_active, start_time, target_class_ids, school_id, schools(name)')
        .gte('start_time', gte).lte('start_time', lte);
    (oexams || []).forEach(e => console.log(`  ${e.is_active ? '✅' : '❌DRAFT'} [${e.exam_type}] "${e.title}" (${e.schools?.name}) ${e.start_time}`));
    if (!oexams?.length) console.log('  (kosong)');

    // 3. Detail PRA MAT (ujian terbit terdekat)
    const { data: pra } = await supabase.from('official_exams')
        .select('id, title, exam_type, is_active, start_time, duration_minutes, target_class_ids, school_id, schools(name)')
        .eq('title', 'PRA MAT').order('created_at', { ascending: false }).limit(1);
    if (pra && pra[0]) {
        const p = pra[0];
        console.log(`\n=== Detail "${p.title}" ===`);
        console.log(`  sekolah=${p.schools?.name} | mulai=${p.start_time} (UTC) = ${new Date(p.start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB | durasi=${p.duration_minutes}mnt`);
        const { data: tclasses } = await supabase.from('classes').select('id, name').in('id', p.target_class_ids);
        console.log(`  target kelas: ${(tclasses || []).map(c => c.name).join(', ')}`);
        const { data: qs } = await supabase.from('official_exam_questions').select('status').eq('exam_id', p.id);
        const st = {};
        (qs || []).forEach(q => st[q.status] = (st[q.status] || 0) + 1);
        console.log(`  soal: ${(qs || []).length} (status: ${JSON.stringify(st)})`);
        // siswa di kelas target
        const { count: studs } = await supabase.from('student_enrollments')
            .select('id', { count: 'exact', head: true })
            .eq('academic_year_id', YEAR).eq('status', 'ACTIVE')
            .in('class_id', p.target_class_ids);
        console.log(`  siswa ter-target (enrollment): ${studs}`);
    }
}

main().catch(e => console.error('FATAL', e));
