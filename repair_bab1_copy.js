/**
 * repair_bab1_copy.js — kembalikan soal yang hilang di sibling multi-kelas PIIS.
 *
 * Aturan keamanan:
 * - Hanya INSERT ke ujian yang jumlah soalnya 0 (tidak pernah menghapus apa pun).
 * - Sumber = ujian dalam grup (guru + judul sama, dibuat berdekatan) dengan soal terbanyak.
 * - Tidak menyentuh is_active — guru tetap yang publish sendiri.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const SCHOOL = 'd09b79ad-aa01-4950-afb7-4fb5112c1df7';
const YEAR = 'e8d07504-cb9f-4ff3-8615-4b10cb3ca6a0';

async function main() {
    // 1. Semua TA tahun aktif PIIS
    const { data: tas } = await supabase
        .from('teaching_assignments')
        .select('id, teacher_id, class_id, classes(name)')
        .eq('academic_year_id', YEAR);
    const taById = Object.fromEntries((tas || []).map(t => [t.id, t]));

    // 2. Semua exams tahun aktif (inner join — .in() ratusan TA id overflow header 16KB)
    const { data: exams, error } = await supabase
        .from('exams')
        .select('id, title, teaching_assignment_id, created_at, is_active, teaching_assignment:teaching_assignments!inner(academic_year_id)')
        .eq('teaching_assignment.academic_year_id', YEAR)
        .order('created_at', { ascending: true });
    if (error) { console.error('ERR exams', error); return; }
    console.log(`Total exams tahun aktif PIIS: ${(exams || []).length}`);

    // 3. Hitung soal per exam
    const counts = {};
    for (const e of exams || []) {
        const { count } = await supabase
            .from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', e.id);
        counts[e.id] = count || 0;
    }

    // 4. Grup multi-kelas: guru + judul (dinormalisasi) + dibuat berdekatan (<= 10 mnt)
    const groups = [];
    for (const e of exams || []) {
        const ta = taById[e.teaching_assignment_id];
        const key = `${ta?.teacher_id}|${(e.title || '').trim().toLowerCase()}`;
        const t = new Date(e.created_at).getTime();
        const g = groups.find(g => g.key === key && Math.abs(g.lastT - t) <= 10 * 60 * 1000);
        if (g) { g.exams.push(e); g.lastT = t; }
        else groups.push({ key, lastT: t, exams: [e] });
    }

    // 5. Per grup: salin dari ujian tersibuk ke yang kosong
    let fixed = 0;
    for (const g of groups) {
        if (g.exams.length < 2) continue;
        const byCount = [...g.exams].sort((a, b) =>
            (counts[b.id] - counts[a.id]) || (new Date(a.created_at) - new Date(b.created_at)));
        const source = byCount[0];
        const srcCount = counts[source.id];
        const empties = g.exams.filter(e => counts[e.id] === 0 && e.id !== source.id);

        console.log(`\nGrup "${source.title}" (${g.exams.length} ujian):`);
        g.exams.forEach(e =>
            console.log(`   [${taById[e.teaching_assignment_id]?.classes?.name}] soal=${counts[e.id]} aktif=${e.is_active}`));

        if (srcCount === 0) { console.log('   -> sumber 0 soal, tidak ada yang bisa disalin. SKIP'); continue; }
        if (empties.length === 0) { console.log('   -> tidak ada sibling kosong. OK'); continue; }

        const { data: srcQuestions } = await supabase
            .from('exam_questions').select('*').eq('exam_id', source.id);

        for (const target of empties) {
            const targetClass = taById[target.teaching_assignment_id]?.classes?.name;
            // Verifikasi ulang tepat sebelum insert (masih 0 soal)
            const { count: nowCount } = await supabase
                .from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', target.id);
            if ((nowCount || 0) > 0) { console.log(`   -> [${targetClass}] sudah terisi ${nowCount}, SKIP`); continue; }

            const rows = srcQuestions.map(q => {
                const { id, exam_id, created_at, ...rest } = q;
                return { ...rest, exam_id: target.id };
            });
            const { error: insErr } = await supabase.from('exam_questions').insert(rows);
            if (insErr) {
                console.error(`   !! GAGAL salin ke [${targetClass}]:`, insErr.message);
                continue;
            }
            console.log(`   -> DISALIN ${rows.length} soal ke [${targetClass}]`);
            fixed++;
        }
    }
    console.log(`\nSelesai. ${fixed} ujian diperbaiki.`);
}

main().catch(e => console.error('FATAL', e));
