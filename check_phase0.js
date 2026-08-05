/**
 * check_phase0.js — pre-check + verifikasi migrasi 019.
 *   node check_phase0.js          → pre-check (aman dijalankan kapan saja)
 * Setelah migrasi diapply, skrip ini juga memverifikasi kolom batch_id sudah ada.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function main() {
    // 1. Sekolah dengan >1 tahun aktif (harus 0 sebelum unique index dibuat)
    const { data: years, error } = await supabase
        .from('academic_years').select('id, name, school_id, is_active').eq('is_active', true);
    if (error) { console.error('ERR', error); return; }
    const perSchool = {};
    (years || []).forEach(y => { (perSchool[y.school_id] = perSchool[y.school_id] || []).push(y.name); });
    const violators = Object.entries(perSchool).filter(([, names]) => names.length > 1);
    if (violators.length) {
        console.log('❌ ADA sekolah dengan >1 tahun aktif — unique index AKAN GAGAL:');
        violators.forEach(([sid, names]) => console.log(`   ${sid}: ${names.join(', ')}`));
    } else {
        console.log('✅ Pre-check OK: setiap sekolah maksimal 1 tahun aktif. Migrasi aman dijalankan.');
    }

    // 2. Verifikasi kolom batch_id (setelah migrasi)
    const { error: e1 } = await supabase.from('exams').select('batch_id').limit(1);
    const { error: e2 } = await supabase.from('quizzes').select('batch_id').limit(1);
    console.log(`exams.batch_id: ${e1 ? '❌ belum ada' : '✅ ada'} | quizzes.batch_id: ${e2 ? '❌ belum ada' : '✅ ada'}`);
}

main().catch(e => console.error('FATAL', e));
