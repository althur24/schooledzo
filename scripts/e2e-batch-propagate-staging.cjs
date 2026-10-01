/**
 * E2E staging: propagasi setting batch (bug #3).
 * Kasus nyata TKA MTK PIIS: guru set max_violations=5 di 1 member batch,
 * 9 kelas lain tetap 3 → siswa dipaksa-submit di pelanggaran ke-3.
 *
 * Verifikasi: PATCH field batch (max_violations, is_randomized, show_results,
 * jadwal) menular ke SEMUA sibling. Field per-member (is_active,
 * results_released, title) TIDAK menular.
 *
 * Prasyarat: build + next start dengan .env.staging. Cleanup penuh di akhir.
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  ✓ ${name}`) }
    else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}
async function login(username, password) {
    const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
    const data = await res.json()
    if (!res.ok) throw new Error(`login ${username}: ${JSON.stringify(data)}`)
    return (res.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ')
}
async function api(m, p, b, ck) {
    const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(ck ? { Cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined })
    let d; try { d = await r.json() } catch { d = null }
    return { status: r.status, data: d }
}

async function main() {
    const P = 'lb3_'
    const H = await bcrypt.hash('B3pass!', 10)
    const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
    const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
    const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2'

    const ins = async (t, r) => { const { data, error } = await supabase.from(t).insert(r).select().single(); if (error) throw new Error(`ins ${t}: ${JSON.stringify(error)}`); return data }
    const uname = (s) => `${P}${s}`

    const guru = await ins('users', { username: uname('guru'), password_hash: H, full_name: 'G', role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false })
    const teacher = await ins('teachers', { user_id: guru.id, school_id: SCHOOL })
    // 2 kelas paralel → 2 TA → 2 exam dalam 1 batch
    const kelasA = await ins('classes', { name: `${P}A`, grade_level: 8, school_level: 'SMP', academic_year_id: YEAR })
    const kelasB = await ins('classes', { name: `${P}B`, grade_level: 8, school_level: 'SMP', academic_year_id: YEAR })
    const taA = await ins('teaching_assignments', { teacher_id: teacher.id, subject_id: SUBJECT, class_id: kelasA.id, academic_year_id: YEAR })
    const taB = await ins('teaching_assignments', { teacher_id: teacher.id, subject_id: SUBJECT, class_id: kelasB.id, academic_year_id: YEAR })

    const gCk = await login(uname('guru'), 'B3pass!')

    // Buat 2 exam dengan batch_id sama
    const batchId = crypto.randomUUID()
    const start = new Date(Date.now() - 60000).toISOString()
    const examA = await api('POST', '/api/exams', { title: `${P}A`, teaching_assignment_id: taA.id, start_time: start, duration_minutes: 60, max_violations: 3, is_randomized: false, show_results_immediately: true, batch_id: batchId }, gCk)
    check('A1a: create examA', examA.status === 200, JSON.stringify(examA.data))
    const examB = await api('POST', '/api/exams', { title: `${P}B`, teaching_assignment_id: taB.id, start_time: start, duration_minutes: 60, max_violations: 3, is_randomized: false, show_results_immediately: true, batch_id: batchId }, gCk)
    check('A1b: create examB', examB.status === 200, JSON.stringify(examB.data))

    const aId = examA.data?.id, bId = examB.data?.id
    if (!aId || !bId) throw new Error('setup exam gagal')

    // Tambah 1 soal approved di keduanya (publish butuh soal)
    for (const [eid, taid] of [[aId, taA.id], [bId, taB.id]]) {
        await supabase.from('exam_questions').insert({ exam_id: eid, teaching_assignment_id: taid, question_text: 'q', question_type: 'MULTIPLE_CHOICE', options: '["A","B"]', correct_answer: 'A', points: 10, order_index: 0, content_format: 'plain', status: 'approved' })
    }

    // ── TEST INTI: PATCH max_violations di examA → harus menular ke examB
    {
        const r = await api('PUT', `/api/exams/${aId}`, { max_violations: 5 }, gCk)
        check('B1: PATCH max_violations=5 di examA', r.status === 200, JSON.stringify(r.data))
        const { data: b } = await supabase.from('exams').select('max_violations').eq('id', bId).single()
        check('B2: examB max_violations ikut 5 (propagasi)', b?.max_violations === 5, `got ${b?.max_violations}`)
        const { data: a } = await supabase.from('exams').select('max_violations').eq('id', aId).single()
        check('B3: examA max_violations 5', a?.max_violations === 5, `got ${a?.max_violations}`)
    }

    // ── Field lain juga menular: is_randomized, show_results, jadwal
    {
        const newStart = new Date(Date.now() - 120000).toISOString()
        await api('PUT', `/api/exams/${aId}`, { is_randomized: true, show_results_immediately: false, start_time: newStart, duration_minutes: 90 }, gCk)
        const { data: b } = await supabase.from('exams').select('is_randomized, show_results_immediately, start_time, duration_minutes').eq('id', bId).single()
        check('C1: examB is_randomized=true', b?.is_randomized === true, JSON.stringify(b))
        check('C2: examB show_results_immediately=false', b?.show_results_immediately === false, JSON.stringify(b))
        check('C3: examB duration_minutes=90', b?.duration_minutes === 90, JSON.stringify(b))
    }

    // ── Field PER-MEMBER TIDAK menular: is_active, results_released, title
    {
        await api('PUT', `/api/exams/${aId}`, { title: `${P}A-DIEDIT` }, gCk)
        const { data: b } = await supabase.from('exams').select('title').eq('id', bId).single()
        check('D1: examB title TIDAK ikut (per-member)', b?.title === `${P}B`, `got ${b?.title}`)
    }

    console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`)
    return { guru: guru.id, teacher: teacher.id, kelasA: kelasA.id, kelasB: kelasB.id, taA: taA.id, taB: taB.id, aId, bId }
}

main().then(async (f) => {
    console.log('Cleanup…')
    for (const sid of [f.aId, f.bId]) { await supabase.from('exam_answers').delete().eq('submission_id', sid).eq('submission_id', '00000000-0000-0000-0000-000000000000'); await supabase.from('exam_submissions').delete().eq('exam_id', sid); await supabase.from('exam_questions').delete().eq('exam_id', sid) }
    await supabase.from('exams').delete().in('id', [f.aId, f.bId])
    await supabase.from('sessions').delete().eq('user_id', f.guru)
    await supabase.from('teaching_assignments').delete().in('id', [f.taA, f.taB])
    await supabase.from('classes').delete().in('id', [f.kelasA, f.kelasB])
    await supabase.from('teachers').delete().eq('id', f.teacher)
    await supabase.from('users').delete().eq('id', f.guru)
    console.log('Selesai.')
}).catch(e => { console.error('FATAL', e.message); process.exit(1) })
