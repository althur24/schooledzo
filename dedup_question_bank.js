/**
 * dedup_question_bank.js — bersihkan duplikat di question_bank.
 *
 * Grup duplikat = (teacher_id, subject_id, teks+opsi+kunci jawaban ternormalisasi).
 * Termasuk baris ber-passage: salinan standalone (exam/quiz) dari soal bacaan ikut dihapus
 * bila ada kembaran 'manual'-nya.
 *
 * Aturan per grup:
 * - KEEP: baris 'manual' paling awal; kalau tidak ada manual, baris paling awal.
 * - HAPUS: semua salinan exam/quiz selain yang disimpan.
 * - HAPUS: duplikat manual non-passage selain yang disimpan (double-submit).
 * - Duplikat manual BER-passage hanya DILAPORKAN (tidak dihapus — konservatif).
 *
 * Default: DRY-RUN. Terapkan dengan: node dedup_question_bank.js --apply
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const APPLY = process.argv.includes('--apply');

const normText = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
function stableStringify(v) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    return JSON.stringify(v);
}
const contentKey = (q) => `${q.teacher_id}|${q.subject_id || ''}|${normText(q.question_text)}|${stableStringify(q.options)}|${stableStringify(q.correct_answer)}`;

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
    const rows = await fetchAll(
        supabase.from('question_bank')
            .select('id, teacher_id, subject_id, question_text, options, correct_answer, source_type, source_name, passage_id, created_at')
            .order('created_at', { ascending: true })
    );
    console.log(`Total baris question_bank: ${rows.length}`);

    const { data: teachers } = await supabase
        .from('teachers').select('id, school_id, schools(name), user:users(full_name)');
    const tInfo = Object.fromEntries((teachers || []).map(t => [t.id, {
        school: t.schools?.name || t.school_id,
        name: t.user?.full_name || '?'
    }]));

    const groups = new Map();
    for (const r of rows) {
        const k = contentKey(r);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
    }

    const toDelete = [];
    const perSchool = {};
    let dupGroups = 0, passageManualDups = 0;
    for (const arr of groups.values()) {
        if (arr.length < 2) continue;

        arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const manuals = arr.filter(r => r.source_type === 'manual');
        const syncs = arr.filter(r => r.source_type !== 'manual');
        const keep = manuals[0] || syncs[0];

        const drop = [];
        // salinan exam/quiz: hapus semua kecuali yg disimpan (kalau tidak ada manual)
        syncs.forEach(r => { if (r.id !== keep.id) drop.push(r); });
        // duplikat manual non-passage: hapus selain yg disimpan
        if (manuals.length > 1) {
            manuals.slice(1).forEach(r => {
                if (!r.passage_id) drop.push(r);
                else passageManualDups++;
            });
        }
        if (drop.length === 0) continue;

        dupGroups++;
        toDelete.push(...drop.map(r => r.id));
        const info = tInfo[keep.teacher_id] || { school: '?', name: '?' };
        perSchool[info.school] = perSchool[info.school] || { groups: 0, rows: 0 };
        perSchool[info.school].groups++;
        perSchool[info.school].rows += drop.length;
        console.log(`\n[${info.school}] ${info.name} | "${String(keep.question_text).slice(0, 70)}" | ${arr.length}x${keep.passage_id ? ' (bacaan)' : ''}`);
        console.log(`   KEEP : ${keep.source_type} (${keep.source_name || '-'}) ${keep.created_at}`);
        drop.forEach(r => console.log(`   HAPUS: ${r.source_type} (${r.source_name || '-'}) ${r.created_at}${r.passage_id ? ' [ber-passage]' : ''}`));
        if (manuals.length > 1 && manuals.slice(1).some(r => r.passage_id)) {
            console.log(`   CATATAN: ${manuals.length - 1} duplikat manual ber-passage TIDAK dihapus (cek manual)`);
        }
    }

    console.log(`\n===== RINGKASAN =====`);
    console.log(`Grup duplikat: ${dupGroups}, baris yang akan dihapus: ${toDelete.length}`);
    if (passageManualDups > 0) console.log(`Duplikat manual ber-passage (hanya dilaporkan): ${passageManualDups}`);
    Object.entries(perSchool).forEach(([s, v]) => console.log(`   ${s}: ${v.groups} grup, ${v.rows} baris`));

    if (!APPLY) {
        console.log('\nDRY-RUN — tidak ada yang dihapus. Jalankan dengan --apply untuk menerapkan.');
        return;
    }

    for (let i = 0; i < toDelete.length; i += 100) {
        const chunk = toDelete.slice(i, i + 100);
        const { error } = await supabase.from('question_bank').delete().in('id', chunk);
        if (error) { console.error('ERR delete chunk', i, error); return; }
    }
    console.log(`\n>>> TERHAPUS ${toDelete.length} baris duplikat.`);
}

main().catch(e => console.error('FATAL', e));
