require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const Z = '00000000-0000-0000-0000-000000000000';

async function probe(fn, args) {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
        const missing = /Could not find the function|schema cache/.test(error.message);
        console.log(`${fn}: ${missing ? '❌ TIDAK ADA (belum dimigrasi)' : '✅ ADA (error lain: ' + error.message.slice(0, 90) + ')'}`);
    } else {
        console.log(`${fn}: ✅ ADA (jalan normal)`);
    }
}

async function main() {
    await probe('move_student_to_class', { p_student_id: Z, p_to_class_id: Z, p_school_id: null, p_notes: null });
    await probe('delete_student', { p_student_id: Z, p_school_id: null });
    await probe('delete_students_batch', { p_student_ids: [Z], p_school_id: null });
    await probe('delete_academic_year_cascade', { p_year_id: Z });
    await probe('promote_students_batch', { p_targets: [], p_graduations: [], p_notes: null });
}

main().catch(e => console.error('FATAL', e));
