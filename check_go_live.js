/**
 * check_go_live.js — verifikasi akhir sebelum push (400 siswa ujian hari ini).
 * 1. Drift students.class_id per sekolah (gerbang 403 baru di start endpoint).
 * 2. Konsistensi enrollment ACTIVE vs class_id (jalur UTS/UAS).
 * 3. Ujian berjadwal HARI INI di PIIS: status publish + jumlah soal.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function fetchAll(query) {
    const out = [];
    for (let page = 0; page < 50; page++) {
        const { data, error } = await query.range(page * 1000, (page + 1) * 1000 - 1);
        if (error) throw error;
        out.push(...(data || []));
        if ((data || []).length < 1000) break;
    }
    return out;
}

async function main() {
    const { data: schools } = await supabase.from('schools').select('id, name').eq('is_active', true);
    const now = new Date();

    for (const school of schools || []) {
        console.log(`\n########## ${school.name} ##########`);
        const { data: years } = await supabase
            .from('academic_years').select('id, name, is_active').eq('school_id', school.id);
        const activeYear = (years || []).find(y => y.is_active);
        if (!activeYear) { console.log('  !! tidak ada tahun aktif'); continue; }
        console.log(`  tahun aktif: ${activeYear.name}`);

        const { data: classes } = await supabase
            .from('classes').select('id, academic_year_id').in('academic_year_id', (years || []).map(y => y.id));
        const classYear = Object.fromEntries((classes || []).map(c => [c.id, c.academic_year_id]));

        const students = await fetchAll(
            supabase.from('students').select('id, class_id').eq('school_id', school.id)
        );
        let nullClass = 0, active = 0, otherYear = 0, unknown = 0;
        (students || []).forEach(s => {
            if (!s.class_id) { nullClass++; return; }
            const yid = classYear[s.class_id];
            if (!yid) { unknown++; return; }
            if (yid === activeYear.id) active++; else otherYear++;
        });
        const flag = (otherYear > 0 || unknown > 0) ? '  ❌❌ BAHAYA: siswa akan DITOLAK 403 oleh gerbang kelas baru!' : '  ✅ aman untuk gerbang 403';
        console.log(`  siswa=${students.length} | class NULL=${nullClass} | thn aktif=${active} | thn lain=${otherYear} | unknown=${unknown}`);
        console.log(flag);

        // Konsistensi enrollment ACTIVE vs class_id (jalur UTS/UAS enrollment-first)
        const enr = await fetchAll(
            supabase.from('student_enrollments')
                .select('student_id, class_id')
                .eq('academic_year_id', activeYear.id).eq('status', 'ACTIVE')
        );
        const enrMap = Object.fromEntries((enr || []).map(e => [e.student_id, e.class_id]));
        let mismatch = 0, noEnr = 0;
        (students || []).forEach(s => {
            if (!s.class_id) return;
            if (!enrMap[s.id]) { noEnr++; return; }
            if (enrMap[s.id] !== s.class_id) mismatch++;
        });
        console.log(`  enrollment ACTIVE=${(enr || []).length} | tanpa enrollment=${noEnr} | BEDA dgn class_id=${mismatch}`);
    }

    // Ujian berjadwal hari ini (semua sekolah)
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    console.log(`\n########## UJIAN BERJADWAL HARI INI (${todayStart.toISOString().slice(0, 10)}) ##########`);
    const { data: exams } = await supabase
        .from('exams')
        .select('id, title, is_active, start_time, duration_minutes, teaching_assignment:teaching_assignments!inner(academic_year_id, classes(name), subjects(name))')
        .gte('start_time', todayStart.toISOString())
        .lte('start_time', todayEnd.toISOString());
    if (!exams || exams.length === 0) console.log('  (tidak ada ulangan reguler hari ini)');
    for (const e of exams || []) {
        const { count } = await supabase.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', e.id);
        const status = e.is_active ? '✅ TERBIT' : '❌ DRAFT (siswa TIDAK bisa lihat!)';
        console.log(`  ${status} | "${e.title}" [${e.teaching_assignment?.classes?.name} - ${e.teaching_assignment?.subjects?.name}] mulai=${e.start_time} soal=${count}`);
    }

    const { data: oexams } = await supabase
        .from('official_exams')
        .select('id, title, exam_type, is_active, start_time, target_class_ids, school_id')
        .gte('start_time', todayStart.toISOString())
        .lte('start_time', todayEnd.toISOString());
    for (const e of oexams || []) {
        const { count } = await supabase.from('official_exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', e.id);
        const status = e.is_active ? '✅ TERBIT' : '❌ DRAFT';
        console.log(`  ${status} | [${e.exam_type}] "${e.title}" mulai=${e.start_time} target=${(e.target_class_ids || []).length} kelas soal=${count}`);
    }
    if (!oexams || oexams.length === 0) console.log('  (tidak ada UTS/UAS hari ini)');
}

main().catch(e => console.error('FATAL', e));
