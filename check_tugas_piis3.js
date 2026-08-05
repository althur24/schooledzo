require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const SCHOOL = 'd09b79ad-aa01-4950-afb7-4fb5112c1df7';
const ACTIVE_YEAR = 'e8d07504-cb9f-4ff3-8615-4b10cb3ca6a0';

async function main() {
    // Semua assignments tahun aktif sekolah PIIS, via inner join (cara yg sama dgn API)
    const { data, error } = await supabase
        .from('assignments')
        .select('id, type, created_at, teaching_assignment:teaching_assignments!inner(academic_year_id, teacher:teachers(user:users(full_name)))')
        .eq('teaching_assignment.academic_year_id', ACTIVE_YEAR)
        .order('created_at', { ascending: false });

    if (error) { console.error('ERR', error); return; }
    console.log(`Total assignments tahun aktif: ${data.length}`);

    const perType = {};
    const perTeacherType = {};
    for (const a of data) {
        perType[a.type] = (perType[a.type] || 0) + 1;
        const guru = a.teaching_assignment?.teacher?.user?.full_name || '?';
        perTeacherType[guru] = perTeacherType[guru] || {};
        perTeacherType[guru][a.type] = (perTeacherType[guru][a.type] || 0) + 1;
    }
    console.log('\nPer type:');
    console.log(JSON.stringify(perType, null, 1));
    console.log('\nPer guru (type -> jumlah):');
    Object.entries(perTeacherType).forEach(([g, t]) => {
        console.log(`  ${g}: ${JSON.stringify(t)}`);
    });
}

main().catch(e => console.error('FATAL', e));
