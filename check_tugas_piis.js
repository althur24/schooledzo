require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const j = (x) => JSON.stringify(x, null, 1);

async function main() {
    // 1. Sekolah PIIS
    const { data: schools, error: e1 } = await supabase
        .from('schools').select('id, name, code, is_active').ilike('name', '%PIIS%');
    if (e1) { console.error('ERR schools', e1); return; }
    console.log('=== SCHOOLS PIIS ===');
    console.log(j(schools));

    // 2. Cari guru Susilawati (semua sekolah)
    const { data: susi } = await supabase
        .from('users').select('id, username, full_name, role, school_id')
        .ilike('full_name', '%susilawati%');
    console.log('\n=== USERS *susilawati* ===');
    console.log(j(susi));

    for (const school of schools || []) {
        console.log(`\n########## ${school.name} (${school.id}) ##########`);

        // 3. Tahun ajaran
        const { data: years } = await supabase
            .from('academic_years').select('id, name, is_active').eq('school_id', school.id);
        console.log('--- academic_years ---');
        console.log(j(years));
        const activeYears = (years || []).filter(y => y.is_active);
        if (activeYears.length !== 1) console.log(`!!! JUMLAH TAHUN AKTIF = ${activeYears.length}`);
        const activeYear = activeYears[0];
        if (!activeYear) continue;

        // 4. Kelas di tahun aktif + duplikat nama
        const { data: classes } = await supabase
            .from('classes').select('id, name, academic_year_id')
            .eq('academic_year_id', activeYear.id);
        const byName = {};
        (classes || []).forEach(c => { (byName[c.name] = byName[c.name] || []).push(c.id); });
        const dups = Object.entries(byName).filter(([, ids]) => ids.length > 1);
        console.log(`--- kelas tahun aktif (${activeYear.name}): ${(classes || []).length} kelas ---`);
        console.log('nama kelas:', Object.keys(byName).join(', '));
        if (dups.length) {
            console.log('!!! NAMA KELAS DUPLIKAT di tahun aktif:');
            dups.forEach(([n, ids]) => console.log(`   "${n}" -> ${ids.length} baris`));
        }

        // 5. Semua kelas sekolah ini (semua tahun) utk peta year drift
        const yearIds = (years || []).map(y => y.id);
        const { data: allClasses } = await supabase
            .from('classes').select('id, name, academic_year_id').in('academic_year_id', yearIds);
        const classYear = {};
        (allClasses || []).forEach(c => { classYear[c.id] = c.academic_year_id; });

        // 6. Siswa: class_id menunjuk ke tahun mana?
        const { data: students } = await supabase
            .from('students').select('id, class_id').eq('school_id', school.id).limit(3000);
        let nullClass = 0, activeYearCount = 0, otherYear = 0, unknown = 0;
        const otherYearNames = {};
        (students || []).forEach(s => {
            if (!s.class_id) { nullClass++; return; }
            const yid = classYear[s.class_id];
            if (!yid) { unknown++; return; }
            if (yid === activeYear.id) activeYearCount++;
            else {
                otherYear++;
                const yn = (years || []).find(y => y.id === yid)?.name || yid;
                otherYearNames[yn] = (otherYearNames[yn] || 0) + 1;
            }
        });
        console.log(`--- siswa (${(students || []).length} total) ---`);
        console.log(`   class_id NULL: ${nullClass}`);
        console.log(`   class_id -> tahun AKTIF: ${activeYearCount}`);
        console.log(`   class_id -> tahun LAIN: ${otherYear}`, j(otherYearNames));
        console.log(`   class_id -> kelas tak dikenal: ${unknown}`);

        // 7. Enrollments di tahun aktif
        const { count: enrActive } = await supabase
            .from('student_enrollments').select('id', { count: 'exact', head: true })
            .eq('academic_year_id', activeYear.id).eq('status', 'ACTIVE');
        console.log(`--- student_enrollments ACTIVE di tahun aktif: ${enrActive} ---`);

        // 8. TA + tugas di tahun aktif utk sekolah ini
        const { data: tas } = await supabase
            .from('teaching_assignments')
            .select('id, teacher_id, subject_id, class_id')
            .eq('academic_year_id', activeYear.id);
        const taIds = (tas || []).map(t => t.id);
        let asgCount = 0;
        if (taIds.length) {
            const { count } = await supabase
                .from('assignments').select('id', { count: 'exact', head: true })
                .in('teaching_assignment_id', taIds);
            asgCount = count;
        }
        console.log(`--- TA tahun aktif: ${taIds.length}, assignments di TA tsb: ${asgCount} ---`);
    }

    // 9. Detail Susilawati: TA + tugas yg dia buat
    if (susi && susi.length) {
        const { data: teacherRows } = await supabase
            .from('teachers').select('id, user_id, school_id').in('user_id', susi.map(u => u.id));
        console.log('\n=== TEACHER RECORDS susilawati ===');
        console.log(j(teacherRows));
        for (const t of teacherRows || []) {
            const { data: tas } = await supabase
                .from('teaching_assignments')
                .select('id, academic_year_id, class_id, subject_id, classes(name), subjects(name)')
                .eq('teacher_id', t.id);
            console.log(`\n--- TA milik teacher ${t.id} ---`);
            console.log(j(tas));
            const taIds = (tas || []).map(x => x.id);
            if (taIds.length) {
                const { data: asgs } = await supabase
                    .from('assignments')
                    .select('id, title, type, due_date, created_at, teaching_assignment_id')
                    .in('teaching_assignment_id', taIds)
                    .order('created_at', { ascending: false }).limit(15);
                console.log(`--- assignments dia (terbaru, max 15): ${(asgs || []).length} ---`);
                console.log(j(asgs));
            }
        }
    }
}

main().catch(e => console.error('FATAL', e));
