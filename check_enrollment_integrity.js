/**
 * check_enrollment_integrity.js — deteksi dini masalah enrollment (read-only).
 *
 * Deteksi:
 *  A. Siswa non-GRADUATED tanpa enrollment ACTIVE sama sekali
 *     (korban pola "close tanpa insert" — tidak muncul di monitor live).
 *  B. Enrollment di tahun ajaran AKTIF yang statusnya bukan ACTIVE
 *     (kasus insiden 20 Jul 2026: enrollment tahun baru berstatus PROMOTED).
 *  C. Mismatch students.class_id vs kelas pada enrollment ACTIVE.
 *
 * Jalankan: node check_enrollment_integrity.js
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Ambil SEMUA baris (PostgREST default cap 1000)
async function fetchAll(query) {
    const out = [];
    let from = 0;
    for (;;) {
        const { data, error } = await query.range(from, from + 999);
        if (error) throw error;
        out.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }
    return out;
}

async function main() {
    const nameOf = new Map(); // student_id -> nama

    const students = await fetchAll(supabase.from('students')
        .select('id, class_id, status, school_id, user:users!students_user_id_fkey(full_name)'));
    for (const s of students) nameOf.set(s.id, s.user?.full_name || '?');
    console.log(`Total siswa: ${students.length}`);

    const enrollments = await fetchAll(supabase.from('student_enrollments')
        .select('id, student_id, class_id, academic_year_id, status, class:classes!student_enrollments_class_id_fkey(name, academic_year_id)'));

    const years = await fetchAll(supabase.from('academic_years')
        .select('id, name, is_active, school_id'));
    const activeYearBySchool = new Map();
    for (const y of years) if (y.is_active) activeYearBySchool.set(y.school_id, y);
    const activeYearIds = new Set([...activeYearBySchool.values()].map(y => y.id));

    let issues = 0;

    // A. Siswa non-GRADUATED tanpa enrollment ACTIVE
    console.log('\n== A. Siswa non-GRADUATED tanpa enrollment ACTIVE ==');
    const activeByStudent = new Map();
    for (const e of enrollments) {
        if (e.status === 'ACTIVE') activeByStudent.set(e.student_id, e);
    }
    const noActive = students.filter(s => s.status !== 'GRADUATED' && !activeByStudent.has(s.id));
    if (!noActive.length) console.log('   bersih ✓');
    for (const s of noActive) {
        issues++;
        console.log(`   ❌ ${nameOf.get(s.id)} (${s.id}) status=${s.status}`);
    }

    // B. Enrollment tahun aktif berstatus non-ACTIVE
    console.log('\n== B. Enrollment di tahun ajaran aktif berstatus non-ACTIVE ==');
    const badYear = enrollments.filter(e => activeYearIds.has(e.academic_year_id) && e.status !== 'ACTIVE');
    if (!badYear.length) console.log('   bersih ✓');
    for (const e of badYear) {
        issues++;
        console.log(`   ❌ ${nameOf.get(e.student_id)} — kelas ${e.class?.name} status=${e.status}`);
    }

    // C. Mismatch students.class_id vs enrollment ACTIVE
    console.log('\n== C. Mismatch students.class_id vs enrollment ACTIVE ==');
    let mismatches = 0;
    for (const s of students) {
        const act = activeByStudent.get(s.id);
        if (act && s.class_id && act.class_id !== s.class_id) {
            issues++; mismatches++;
            console.log(`   ❌ ${nameOf.get(s.id)} — students.class_id=${s.class_id} enrollment.class=${act.class?.name} (${act.class_id})`);
        }
    }
    if (!mismatches) console.log('   bersih ✓');

    console.log(`\n=== SELESAI: ${issues} temuan ===`);
    process.exit(issues ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
