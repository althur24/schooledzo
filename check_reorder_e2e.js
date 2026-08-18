/**
 * check_reorder_e2e.js — uji E2E endpoint reorder (Fase 3b EDITOR_SOAL_UPGRADE_PLAN)
 * terhadap server yang sedang berjalan (default http://localhost:3100).
 *
 * Skenario per endpoint (quizzes & exams):
 *  (a) POST { reorder: [...] } sebagai GURU → order_index berubah & GET kembali berurutan baru
 *  (b) POST reorder sebagai SISWA → 401 Unauthorized
 *  (c) POST payload reorder kosong sebagai GURU → 400
 *  (d) restore urutan semula + verifikasi
 *  (e) cleanup: hapus sesi uji
 *
 * Pakai: node check_reorder_e2e.js  (server harus sudah jalan di BASE_URL)
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

function makeToken() {
    return require('crypto').randomBytes(32).toString('hex');
}

async function createTestSession(userId) {
    const token = makeToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('sessions').insert({ user_id: userId, token, expires_at: expires });
    if (error) throw new Error('Gagal buat sesi uji: ' + error.message);
    return token;
}

const api = (path, token, opts = {}) =>
    fetch(`${BASE_URL}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Cookie: `session_token=${token}`, ...(opts.headers || {}) }
    });

async function pickTarget(table, parentTable, fk) {
    // Cari parent dengan >= 3 soal dan tahun ajaran tidak COMPLETED
    const { data: rows } = await supabase.from(table).select(`id, ${fk}, order_index`).order(fk).order('order_index');
    const byParent = {};
    (rows || []).forEach(r => { (byParent[r[fk]] = byParent[r[fk]] || []).push(r); });
    const candidates = Object.entries(byParent).filter(([, qs]) => qs.length >= 3);
    for (const [parentId, qs] of candidates) {
        const { data: parent } = await supabase.from(parentTable).select('id, teaching_assignment_id').eq('id', parentId).single();
        if (!parent) continue;
        if (parent.teaching_assignment_id) {
            const { data: ta } = await supabase.from('teaching_assignments').select('academic_year_id').eq('id', parent.teaching_assignment_id).single();
            if (ta?.academic_year_id) {
                const { data: yr } = await supabase.from('academic_years').select('status').eq('id', ta.academic_year_id).single();
                if (yr?.status === 'COMPLETED') continue; // endpoint memblokir tahun arsip — lewati
            }
        }
        return { parentId, questions: qs };
    }
    return null;
}

async function testEndpoint({ label, apiPath, table, parentTable, fk, guruToken, siswaToken }) {
    console.log(`\n=== ${label} (${apiPath}) ===`);
    const target = await pickTarget(table, parentTable, fk);
    if (!target) { console.log(`SKIP  tidak ada ${parentTable} dengan >= 3 soal di tahun aktif`); return; }
    const { parentId, questions } = target;
    console.log(`Target ${parentTable}: ${parentId} (${questions.length} soal)`);

    const path = apiPath.replace(':id', parentId);
    const original = questions.map(q => ({ id: q.id, order_index: q.order_index }));
    const reversed = [...original].reverse().map((q, i) => ({ id: q.id, order_index: original[i].order_index }));

    // (a) reorder sebagai GURU — urutan dibalik
    const resA = await api(path, guruToken, { method: 'POST', body: JSON.stringify({ reorder: reversed }) });
    const bodyA = await resA.json().catch(() => null);
    ok(resA.ok && bodyA?.updated === reversed.length, `(a) POST reorder diterima — status ${resA.status}, updated=${bodyA?.updated}`);

    const getA = await api(path, guruToken);
    const afterA = await getA.json();
    const expectedIds = [...original].reverse().map(q => q.id);
    const actualIds = afterA.map(q => q.id);
    ok(JSON.stringify(actualIds) === JSON.stringify(expectedIds), '(a) GET kembali dengan urutan baru (terbalik)');

    // (b) reorder sebagai SISWA → 401
    const resB = await api(path, siswaToken, { method: 'POST', body: JSON.stringify({ reorder: original }) });
    ok(resB.status === 401, `(b) POST reorder sebagai SISWA ditolak — status ${resB.status}`);

    // (c) payload reorder kosong sebagai GURU → 400
    const resC = await api(path, guruToken, { method: 'POST', body: JSON.stringify({ reorder: [] }) });
    ok(resC.status === 400, `(c) payload reorder kosong ditolak — status ${resC.status}`);

    // (d) restore urutan semula
    const resD = await api(path, guruToken, { method: 'POST', body: JSON.stringify({ reorder: original }) });
    ok(resD.ok, `(d) restore urutan semula — status ${resD.status}`);
    const getD = await api(path, guruToken);
    const afterD = await getD.json();
    ok(JSON.stringify(afterD.map(q => q.id)) === JSON.stringify(original.map(q => q.id)), '(d) GET mengonfirmasi urutan kembali seperti semula');
}

async function main() {
    // Ambil satu user GURU dan satu SISWA
    const { data: guru } = await supabase.from('users').select('id, username').eq('role', 'GURU').limit(1).single();
    const { data: siswa } = await supabase.from('users').select('id, username').eq('role', 'SISWA').limit(1).single();
    if (!guru || !siswa) throw new Error('User GURU/SISWA tidak ditemukan');
    console.log(`GURU uji: ${guru.username} | SISWA uji: ${siswa.username}`);

    const guruToken = await createTestSession(guru.id);
    const siswaToken = await createTestSession(siswa.id);

    try {
        await testEndpoint({
            label: 'KUIS', apiPath: '/api/quizzes/:id/questions',
            table: 'quiz_questions', parentTable: 'quizzes', fk: 'quiz_id',
            guruToken, siswaToken
        });
        await testEndpoint({
            label: 'ULANGAN', apiPath: '/api/exams/:id/questions',
            table: 'exam_questions', parentTable: 'exams', fk: 'exam_id',
            guruToken, siswaToken
        });
    } finally {
        // (e) cleanup sesi uji
        await supabase.from('sessions').delete().in('token', [guruToken, siswaToken]);
        console.log('\nCleanup: sesi uji dihapus');
    }

    console.log(failures === 0 ? '\nSEMUA PASS' : `\n${failures} FAIL`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
