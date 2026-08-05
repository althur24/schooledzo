require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const j = (x) => JSON.stringify(x, null, 1);
const SCHOOL = 'd09b79ad-aa01-4950-afb7-4fb5112c1df7';

async function main() {
    // 0. Semua sekolah (lihat penamaan)
    const { data: allSchools } = await supabase.from('schools').select('id, name, code, is_active');
    console.log('=== SEMUA SEKOLAH ===');
    console.log(j(allSchools));

    // 1. Sekolah Susilawati
    const { data: school } = await supabase.from('schools').select('*').eq('id', SCHOOL).single();
    console.log('\n=== SEKOLAH SUSILAWATI ===');
    console.log(j(school));

    // 2. Tahun ajaran sekolah ini
    const { data: years } = await supabase
        .from('academic_years').select('id, name, is_active').eq('school_id', SCHOOL);
    console.log('\n--- academic_years ---');
    console.log(j(years));
    const activeYears = (years || []).filter(y => y.is_active);
    console.log(`>>> tahun aktif: ${activeYears.length}`);
    const activeYear = activeYears[0];

    // 3. Semua kelas sekolah ini per tahun
    const yearIds = (years || []).map(y => y.id);
    const { data: allClasses } = await supabase
        .from('classes').select('id, name, academic_year_id').in('academic_year_id', yearIds);
    const byYear = {};
    (allClasses || []).forEach(c => {
        const yn = (years || []).find(y => y.id === c.academic_year_id)?.name || c.academic_year_id;
        (byYear[yn] = byYear[yn] || []).push(c.name);
    });
    console.log('\n--- kelas per tahun ---');
    Object.entries(byYear).forEach(([yn, names]) => console.log(`  ${yn}: ${names.sort().join(', ')}`));

    // duplikat nama di tahun aktif
    if (activeYear) {
        const act = (allClasses || []).filter(c => c.academic_year_id === activeYear.id);
        const cnt = {};
        act.forEach(c => cnt[c.name] = (cnt[c.name] || 0) + 1);
        const dups = Object.entries(cnt).filter(([, n]) => n > 1);
        if (dups.length) console.log('!!! DUPLIKAT nama kelas tahun aktif:', j(dups));
    }

    // 4. Siswa: class_id -> tahun mana
    const classYear = {};
    (allClasses || []).forEach(c => { classYear[c.id] = c.academic_year_id; });
    const { data: students } = await supabase
        .from('students').select('id, class_id').eq('school_id', SCHOOL).limit(3000);
    let nullClass = 0, inActive = 0, other = 0, unknown = 0;
    const otherNames = {};
    (students || []).forEach(s => {
        if (!s.class_id) { nullClass++; return; }
        const yid = classYear[s.class_id];
        if (!yid) { unknown++; return; }
        if (activeYear && yid === activeYear.id) inActive++;
        else {
            other++;
            const yn = (years || []).find(y => y.id === yid)?.name || yid;
            otherNames[yn] = (otherNames[yn] || 0) + 1;
        }
    });
    console.log(`\n--- siswa (${(students || []).length}) ---`);
    console.log(`   class_id NULL: ${nullClass} | tahun aktif: ${inActive} | tahun lain: ${other} ${j(otherNames)} | unknown: ${unknown}`);

    // 5. Enrollments tahun aktif
    if (activeYear) {
        const { count: enr } = await supabase
            .from('student_enrollments').select('id', { count: 'exact', head: true })
            .eq('academic_year_id', activeYear.id).eq('status', 'ACTIVE');
        console.log(`--- enrollments ACTIVE tahun aktif: ${enr} ---`);
    }

    // 6. Simulasi query siswa utk tugas Susilawati:
    //    assignments join TA, filter TA.year = activeYear & TA.class_id = student.class_id
    if (activeYear) {
        const herTAyear = 'e8d07504-cb9f-4ff3-8615-4b10cb3ca6a0';
        console.log(`\n>>> tahun TA Susilawati (${herTAyear}) == tahun aktif? ${herTAyear === activeYear.id}`);
        // siswa per kelas di tahun TA-nya (7.1 s/d 9.5)
        const { data: herTAs } = await supabase
            .from('teaching_assignments').select('class_id')
            .eq('teacher_id', '5ae19ed5-2d7d-4a0e-8c62-6a64e11f1d2d');
        const herClassIds = [...new Set((herTAs || []).map(t => t.class_id))];
        const { data: studsInHerClasses } = await supabase
            .from('students').select('id, class_id').in('class_id', herClassIds);
        console.log(`>>> siswa dgn class_id di kelas2 TA Susilawati: ${(studsInHerClasses || []).length}`);
    }

    // 7. Tipe assignments sekolah ini (semua guru, tahun aktif) — seberapa banyak PROYEK/PR vs TUGAS
    if (activeYear) {
        const { data: tas } = await supabase
            .from('teaching_assignments').select('id').eq('academic_year_id', activeYear.id);
        const taIds = (tas || []).map(t => t.id);
        if (taIds.length) {
            const { data: asgs } = await supabase
                .from('assignments').select('type').in('teaching_assignment_id', taIds);
            const tc = {};
            (asgs || []).forEach(a => tc[a.type] = (tc[a.type] || 0) + 1);
            console.log(`\n--- semua assignments tahun aktif sekolah ini, per type ---`);
            console.log(j(tc));
        }
    }
}

main().catch(e => console.error('FATAL', e));
