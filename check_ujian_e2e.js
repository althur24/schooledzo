require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const YEAR_PIIS = 'e8d07504-cb9f-4ff3-8615-4b10cb3ca6a0';

async function main() {
    // 1. Ujian AKTIF tapi 0 soal — terlihat siswa tapi kosong (fatal UX)
    const { data: exams } = await supabase
        .from('exams')
        .select('id, title, is_active, start_time, duration_minutes, teaching_assignment:teaching_assignments!inner(academic_year_id, class_id, classes(name), subjects(name))')
        .eq('teaching_assignment.academic_year_id', YEAR_PIIS);
    console.log(`PIIS: total exams tahun aktif = ${(exams || []).length}`);
    let activeZero = 0, activeDraftQ = 0;
    for (const e of exams || []) {
        if (!e.is_active) continue;
        const { count } = await supabase.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', e.id);
        const { count: draft } = await supabase.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', e.id).neq('status', 'approved');
        if ((count || 0) === 0) {
            activeZero++;
            console.log(`  !! AKTIF tapi 0 soal: "${e.title}" [${e.teaching_assignment?.classes?.name}] mulai=${e.start_time}`);
        } else if ((draft || 0) > 0) {
            activeDraftQ++;
            console.log(`  ?? AKTIF dgn ${draft} soal non-approved (dari ${count}): "${e.title}" [${e.teaching_assignment?.classes?.name}]`);
        }
    }
    console.log(`>>> aktif 0 soal: ${activeZero}, aktif dgn soal non-approved: ${activeDraftQ}`);

    // 2. Ujian yang dijadwalkan sudah lewat tapi masih draft (kandidat keluhan "ga muncul")
    const now = new Date().toISOString();
    const pastDraft = (exams || []).filter(e => !e.is_active && e.start_time && e.start_time < now);
    console.log(`\nDraft dgn jadwal sudah lewat: ${pastDraft.length}`);
    pastDraft.forEach(e => console.log(`  - "${e.title}" [${e.teaching_assignment?.classes?.name}] mulai=${e.start_time}`));

    // 3. UTS/UAS (official_exams) di PIIS
    const { data: oe, error: oeErr } = await supabase
        .from('official_exams').select('*').limit(50);
    if (oeErr) { console.log('\nofficial_exams error:', oeErr.message); return; }
    console.log(`\n=== official_exams (semua sekolah): ${(oe || []).length} ===`);
    for (const x of oe || []) {
        const { count } = await supabase.from('official_exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', x.id);
        console.log(`  "${x.title}" | tipe=${x.exam_type} | aktif=${x.is_active} | mulai=${x.start_time} | target_kelas=${JSON.stringify(x.target_class_ids?.length ?? x.target_class_ids)} | soal=${count} | id=${x.id}`);
    }
}

main().catch(e => console.error('FATAL', e));
