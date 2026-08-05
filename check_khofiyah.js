require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const j = (x) => JSON.stringify(x, null, 1);

async function main() {
    // 1. Cari user Khofiyah (semua sekolah)
    const { data: users } = await supabase
        .from('users').select('id, username, full_name, role, school_id, schools(name)')
        .ilike('full_name', '%khofiyah%');
    console.log('=== USER *khofiyah* ===');
    console.log(j(users));
    if (!users || users.length === 0) return;

    // 2. Teacher records
    const { data: teachers } = await supabase
        .from('teachers').select('id, user_id, school_id').in('user_id', users.map(u => u.id));
    console.log('\n=== TEACHER RECORDS ===');
    console.log(j(teachers));

    for (const t of teachers || []) {
        // 3. TA miliknya
        const { data: tas } = await supabase
            .from('teaching_assignments')
            .select('id, academic_year_id, class_id, subjects(name), classes(name)')
            .eq('teacher_id', t.id);
        const taById = Object.fromEntries((tas || []).map(x => [x.id, x]));

        // 4. Exams miliknya
        const { data: exams } = await supabase
            .from('exams')
            .select('id, title, teaching_assignment_id, is_active, start_time, duration_minutes, created_at')
            .in('teaching_assignment_id', Object.keys(taById))
            .order('created_at', { ascending: false });
        console.log(`\n=== EXAMS Khofiyah (teacher ${t.id}): ${(exams || []).length} ===`);
        for (const e of exams || []) {
            const { count } = await supabase
                .from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', e.id);
            const { count: draftCount } = await supabase
                .from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', e.id).neq('status', 'approved');
            const ta = taById[e.teaching_assignment_id];
            console.log(`  "${e.title}" | kelas=${ta?.classes?.name} | mapel=${ta?.subjects?.name}`);
            console.log(`     aktif=${e.is_active} | mulai=${e.start_time} | durasi=${e.duration_minutes}mnt | soal=${count} (non-approved=${draftCount}) | dibuat=${e.created_at}`);
            console.log(`     id=${e.id}`);
        }

        // 5. Waktu server sekarang utk perbandingan start_time
        console.log('\nWaktu sekarang (UTC):', new Date().toISOString());
    }
}

main().catch(e => console.error('FATAL', e));
