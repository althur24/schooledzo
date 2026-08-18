/**
 * check_reorder_edge.js — uji edge-case endpoint reorder:
 *  (a) payload berisi id soal milik kuis LAIN → baris milik kuis lain TIDAK berubah
 *  (b) reorder parsial (hanya 2 soal ditukar) → hanya 2 itu berubah, sisanya utuh
 *  (c) payload berisi id yang tidak ada → tidak ada baris berubah, tidak error aneh
 *  (d) restore semua perubahan + cleanup sesi
 *
 * Pakai: node check_reorder_edge.js  (server harus jalan di BASE_URL)
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

let failures = 0;
const ok = (cond, label) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
    if (!cond) failures++;
};

const api = (path, token, opts = {}) =>
    fetch(`${BASE_URL}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Cookie: `session_token=${token}`, ...(opts.headers || {}) }
    });

async function main() {
    const { data: guru } = await supabase.from('users').select('id, username').eq('role', 'GURU').limit(1).single();
    if (!guru) throw new Error('User GURU tidak ditemukan');
    const token = require('crypto').randomBytes(32).toString('hex');
    await supabase.from('sessions').insert({ user_id: guru.id, token, expires_at: new Date(Date.now() + 3600000).toISOString() });

    try {
        // Dua kuis berbeda, masing-masing >= 2 soal, tahun aktif
        const { data: rows } = await supabase.from('quiz_questions').select('id, quiz_id, order_index').order('quiz_id').order('order_index');
        const byQuiz = {};
        (rows || []).forEach(r => { (byQuiz[r.quiz_id] = byQuiz[r.quiz_id] || []).push(r); });
        const candidates = Object.entries(byQuiz).filter(([, qs]) => qs.length >= 2);
        let quizA = null, quizB = null;
        for (const [quizId, qs] of candidates) {
            const { data: quiz } = await supabase.from('quizzes').select('teaching_assignment_id').eq('id', quizId).single();
            if (quiz?.teaching_assignment_id) {
                const { data: ta } = await supabase.from('teaching_assignments').select('academic_year_id').eq('id', quiz.teaching_assignment_id).single();
                if (ta?.academic_year_id) {
                    const { data: yr } = await supabase.from('academic_years').select('status').eq('id', ta.academic_year_id).single();
                    if (yr?.status === 'COMPLETED') continue;
                }
            }
            if (!quizA) quizA = { quizId, qs }; else if (!quizB) { quizB = { quizId, qs }; break; }
        }
        if (!quizA || !quizB) { console.log('SKIP: kurang dari 2 kuis yang memenuhi syarat'); return; }
        console.log(`Kuis A: ${quizA.quizId} (${quizA.qs.length} soal) | Kuis B: ${quizB.quizId} (${quizB.qs.length} soal)`);

        const a0 = quizA.qs[0], a1 = quizA.qs[1];
        const foreign = quizB.qs[0];
        const foreignBefore = foreign.order_index;

        // (a) reorder kuis A: tukar 2 soal pertamanya + selundupkan id milik kuis B
        const resA = await api(`/api/quizzes/${quizA.quizId}/questions`, token, {
            method: 'POST',
            body: JSON.stringify({ reorder: [
                { id: a0.id, order_index: a1.order_index },
                { id: a1.id, order_index: a0.order_index },
                { id: foreign.id, order_index: 999 }
            ] })
        });
        ok(resA.ok, `(a) POST diterima — status ${resA.status}`);

        const { data: foreignAfter } = await supabase.from('quiz_questions').select('order_index').eq('id', foreign.id).single();
        ok(foreignAfter?.order_index === foreignBefore, `(a) soal milik kuis lain TIDAK berubah (tetap ${foreignBefore})`);

        const { data: a0After } = await supabase.from('quiz_questions').select('order_index').eq('id', a0.id).single();
        const { data: a1After } = await supabase.from('quiz_questions').select('order_index').eq('id', a1.id).single();
        ok(a0After?.order_index === a1.order_index && a1After?.order_index === a0.order_index, '(a) 2 soal kuis A benar-benar tertukar');

        // (b) verifikasi soal kuis A lainnya tidak tersentuh
        const { data: restA } = await supabase.from('quiz_questions').select('id, order_index').eq('quiz_id', quizA.quizId);
        const beforeMap = new Map(quizA.qs.map(q => [q.id, q.order_index]));
        const touchedOthers = (restA || []).filter(q => q.id !== a0.id && q.id !== a1.id && q.order_index !== beforeMap.get(q.id));
        ok(touchedOthers.length === 0, `(b) soal lain di kuis A utuh (${touchedOthers.length} berubah)`);

        // (c) id yang tidak ada sama sekali
        const resC = await api(`/api/quizzes/${quizA.quizId}/questions`, token, {
            method: 'POST',
            body: JSON.stringify({ reorder: [{ id: '00000000-0000-0000-0000-000000000000', order_index: 12345 }] })
        });
        const bodyC = await resC.json().catch(() => null);
        ok(resC.ok && bodyC?.updated === 1, `(c) id fiktif → 200 updated=1 (tidak ada baris berubah — updated menghitung percobaan, bukan baris)`);
        const { data: afterC } = await supabase.from('quiz_questions').select('id').eq('quiz_id', quizA.quizId).eq('order_index', 12345);
        ok((afterC || []).length === 0, '(c) tidak ada baris yang benar-benar berubah oleh id fiktif');

        // (d) restore kuis A
        const resD = await api(`/api/quizzes/${quizA.quizId}/questions`, token, {
            method: 'POST',
            body: JSON.stringify({ reorder: [
                { id: a0.id, order_index: a0.order_index },
                { id: a1.id, order_index: a1.order_index }
            ] })
        });
        const { data: restored } = await supabase.from('quiz_questions').select('id, order_index').eq('quiz_id', quizA.quizId);
        const allRestored = (restored || []).every(q => q.order_index === beforeMap.get(q.id));
        ok(resD.ok && allRestored, '(d) kuis A kembali persis seperti semula');
    } finally {
        await supabase.from('sessions').delete().eq('token', token);
        console.log('\nCleanup: sesi uji dihapus');
    }

    console.log(failures === 0 ? '\nSEMUA PASS' : `\n${failures} FAIL`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
