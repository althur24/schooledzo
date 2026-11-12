/**
 * E2E staging: KONKURENSI & INVARIANT fitur Susulan.
 *
 * Tujuan: membuktikan bahwa saat BANYAK siswa mengerjakan bersamaan
 * (dan guru membuka susulan massal bersamaan), tidak ada:
 *  - submission ganda per (exam,siswa)
 *  - baris "sudah submit tapi belum mulai"
 *  - nilai melebihi cap / cap fail-open
 *  - jawaban silang antar siswa
 *  - grant yang termakan/tertimpa race
 *
 * Fase:
 *  A. Setup 1 ulangan berakhir + 20 siswa.
 *  B. 5 request batch PARALEL untuk siswa yang sama → tetap 1 baris/siswa.
 *  C. Grant vs start PARALEL → tiap siswa berakhir di state sah.
 *  D. Semua siswa autosave+submit SERENTAK → skor per siswa benar & capped.
 *  E. copy-questions saat grant pending (poin diubah) → max_score ter-refresh
 *     (regresi D1: cache grading).
 *  F. copy-questions saat ada yang sedang mengerjakan → 409 (guard D2).
 *  G. Invariant query 1–8 → 0 pelanggaran.
 *
 * PRASYARAT: migrasi susulan sudah di-push ke STAGING, build + next start
 * dengan env .env.staging. Jalankan:
 *   ENV_FILE=.env.staging node scripts/e2e-susulan-concurrency-staging.cjs
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const P = 'escc_'
const PASS = 'Concur123!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2'
const N_STUDENTS = Number(process.env.N_STUDENTS || 20)
const CLEANUP_ONLY = process.env.CLEANUP_ONLY === '1'

let pass = 0, fail = 0
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`) }
}

async function login(username, password = PASS) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    })
    if (!res.ok) throw new Error(`login ${username}: ${res.status}`)
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
    return setCookies.map(c => c.split(';')[0]).join('; ')
}

const api = (cookie, path, options = {}) => fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) },
})

const ins = async (table, row) => {
    const { data, error } = await supabase.from(table).insert(row).select().single()
    if (error || !data) throw new Error(`insert ${table}: ${JSON.stringify(error)}`)
    return data
}

async function preClean() {
    const like = `${P}%`
    const { data: exams } = await supabase.from('exams').select('id').like('title', like)
    const examIds = (exams || []).map(e => e.id)
    if (examIds.length) {
        const { data: subs } = await supabase.from('exam_submissions').select('id').in('exam_id', examIds)
        for (const s of subs || []) await supabase.from('exam_answers').delete().eq('submission_id', s.id)
        await supabase.from('exam_submissions').delete().in('exam_id', examIds)
        await supabase.from('exam_questions').delete().in('exam_id', examIds)
        await supabase.from('exams').delete().in('id', examIds)
    }
    await supabase.from('grade_history').delete().like('ref_title', like)
    const { data: users } = await supabase.from('users').select('id').like('username', like)
    const userIds = (users || []).map(u => u.id)
    if (userIds.length) {
        const { data: students } = await supabase.from('students').select('id').in('user_id', userIds)
        for (const s of students || []) {
            await supabase.from('student_enrollments').delete().eq('student_id', s.id)
            await supabase.from('students').delete().eq('id', s.id)
        }
        const { data: teachers } = await supabase.from('teachers').select('id').in('user_id', userIds)
        for (const t of teachers || []) {
            await supabase.from('teaching_assignments').delete().eq('teacher_id', t.id)
            await supabase.from('teachers').delete().eq('id', t.id)
        }
        await supabase.from('sessions').delete().in('user_id', userIds)
        await supabase.from('notifications').delete().in('user_id', userIds)
        await supabase.from('users').delete().in('id', userIds)
    }
    const { data: classes } = await supabase.from('classes').select('id').like('name', like)
    if (classes?.length) await supabase.from('classes').delete().in('id', classes.map(c => c.id))
}

async function main() {
    if (CLEANUP_ONLY) {
        await preClean()
        console.log('CLEANUP_ONLY selesai.')
        return
    }

    await preClean()
    const hash = await bcrypt.hash(PASS, 10)
    const uname = (s) => `${P}${s}`

    const guruU = await ins('users', { username: uname('guru'), password_hash: hash, full_name: 'Guru Concur', role: 'GURU', school_id: SCHOOL })
    const guru = await ins('teachers', { user_id: guruU.id, school_id: SCHOOL })
    const kelas = await ins('classes', { name: `${P}kelas`, grade_level: 8, school_level: 'SMP', academic_year_id: YEAR })
    const ta = await ins('teaching_assignments', { teacher_id: guru.id, subject_id: SUBJECT, class_id: kelas.id, academic_year_id: YEAR })

    const students = []
    for (let i = 0; i < N_STUDENTS; i++) {
        const u = await ins('users', { username: uname(`s${i}`), password_hash: hash, full_name: `Concur Siswa ${i}`, role: 'SISWA', school_id: SCHOOL })
        const s = await ins('students', {
            user_id: u.id, nis: `${Date.now()}${i}`.slice(-9), class_id: kelas.id,
            school_id: SCHOOL, school_level: 'SMP', status: 'ACTIVE',
        })
        await ins('student_enrollments', {
            student_id: s.id, class_id: kelas.id, academic_year_id: YEAR, status: 'ACTIVE',
            enrolled_at: new Date(Date.now() - 40 * 86400000).toISOString(),
        })
        students.push({ user: u, student: s })
    }

    const exam = await ins('exams', {
        teaching_assignment_id: ta.id, title: `${P}Ulangan Concur`,
        start_time: new Date(Date.now() - 3 * 3600000).toISOString(),
        duration_minutes: 60, is_active: true, max_violations: 3,
        show_results_immediately: true, is_randomized: false,
    })
    const Q_POINTS = 10
    const Q_COUNT = 10
    const questions = []
    for (let i = 0; i < Q_COUNT; i++) {
        questions.push(await ins('exam_questions', {
            exam_id: exam.id, question_text: `${P}soal ${i + 1}`,
            question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'],
            correct_answer: 'A', points: Q_POINTS, order_index: i, status: 'approved',
            difficulty: 'EASY', content_format: 'plain',
        }))
    }
    const correctPayload = questions.map(q => ({ question_id: q.id, answer: 'A' }))

    const guruCookie = await login(uname('guru'))
    const studentCookies = []
    for (let i = 0; i < N_STUDENTS; i++) studentCookies.push(await login(uname(`s${i}`)))

    console.log('\nB. Batch grant paralel (race)')
    {
        const ids = students.map(s => s.student.id)
        // 5 request batch bersamaan untuk siswa yang sama — uji idempotensi & anti dup.
        const results = await Promise.all(Array.from({ length: 5 }, () =>
            api(guruCookie, '/api/exam-submissions/susulan', {
                method: 'POST',
                body: JSON.stringify({ exam_id: exam.id, student_ids: ids, max_percent: 70 }),
            }).then(r => r.json())))
        check('semua request batch 200', results.every(r => r.success === true), JSON.stringify(results[0] || {}).slice(0, 160))

        const { data: rows } = await supabase.from('exam_submissions')
            .select('student_id, started_at, is_submitted, susulan_max_percent')
            .eq('exam_id', exam.id)
        check('tepat 1 baris per siswa', (rows || []).length === N_STUDENTS, `rows=${(rows || []).length}`)
        check('semua placeholder cap 70', (rows || []).every(r => r.started_at === null && r.is_submitted === false && r.susulan_max_percent === 70))
    }

    console.log('\nC. Grant vs start paralel')
    {
        // Setengah siswa: guru perpanjang cap (grant ulang) BERSAMAAN dengan siswa start.
        const half = students.slice(0, Math.floor(N_STUDENTS / 2))
        await Promise.all(half.map(async (s) => {
            // Gunakan indeks siswa asli (bukan indeks potongan) agar cookie cocok.
            const si = students.findIndex(x => x.student.id === s.student.id)
            const [startRes] = await Promise.all([
                api(studentCookies[si], '/api/exam-submissions', { method: 'POST', body: JSON.stringify({ exam_id: exam.id }) }),
                api(guruCookie, '/api/exam-submissions/susulan', { method: 'POST', body: JSON.stringify({ exam_id: exam.id, student_ids: [s.student.id], max_percent: 55 }) }),
            ])
            const body = await startRes.json()
            check(`start race siswa ${si} → state sah`, startRes.ok || startRes.status === 409 || startRes.status === 400, `status=${startRes.status} ${JSON.stringify(body).slice(0, 120)}`)
        }))
        const { data: rows } = await supabase.from('exam_submissions')
            .select('student_id, started_at, is_submitted').eq('exam_id', exam.id)
        check('tidak ada "submitted tanpa started_at"', (rows || []).every(r => !(r.is_submitted && !r.started_at)))
        check('jumlah baris tetap 1/siswa', (rows || []).length === N_STUDENTS, `rows=${(rows || []).length}`)
        check('minimal satu siswa benar-benar mulai', (rows || []).some(r => !!r.started_at), `started=${(rows || []).filter(r => r.started_at).length}`)
    }

    console.log('\nD. Submit serentak + cap')
    {
        // Semua siswa submit jawaban benar semua secara bersamaan.
        await Promise.all(students.map(async (s, i) => {
            const { data: sub } = await supabase.from('exam_submissions')
                .select('id, started_at').eq('exam_id', exam.id).eq('student_id', s.student.id).maybeSingle()
            if (!sub?.started_at) return
            await api(studentCookies[i], '/api/exam-submissions', {
                method: 'PUT',
                body: JSON.stringify({ submission_id: sub.id, answers: correctPayload, submit: true }),
            })
        }))
        const { data: subs } = await supabase.from('exam_submissions')
            .select('id, student_id, is_submitted, total_score, max_score, susulan_max_percent, started_at')
            .eq('exam_id', exam.id)
        const submitted = (subs || []).filter(s => s.is_submitted)
        check('siswa yang submit punya skor', submitted.length > 0, `submitted=${submitted.length}`)
        // Cap dicek terhadap susulan_max_percent masing-masing baris (fase C bisa
        // mengubah cap sebagian siswa via race re-grant → cap per-siswa berbeda).
        check('semua nilai ≤ cap (per baris)', submitted.every(s => {
            const cap = (s.susulan_max_percent ?? 100) / 100 * (s.max_score || 0)
            return (s.total_score || 0) <= cap + 0.01
        }), JSON.stringify(submitted.map(s => ({ t: s.total_score, m: s.max_score, c: s.susulan_max_percent }))))

        // Skor konsisten per KOHORT cap (kap bisa berbeda antar siswa karena race
        // fase C) — siswa dengan cap sama & jawaban sama harus dapat skor sama.
        const byCap = new Map()
        let mixed = false
        for (const s of submitted) {
            const cap = s.susulan_max_percent ?? 100
            if (!byCap.has(cap)) byCap.set(cap, new Set())
            byCap.get(cap).add(s.total_score)
        }
        for (const set of byCap.values()) if (set.size > 1) mixed = true
        check('skor konsisten dalam kohort cap (tidak silang)', !mixed, JSON.stringify([...byCap.entries()].map(([c, set]) => ({ cap: c, scores: [...set] }))))
        check('max_score = 100 (10 soal × 10)', submitted.every(s => s.max_score === Q_POINTS * Q_COUNT))
    }

    console.log('\nE. copy-questions saat grant pending → max_score ter-refresh (D1)')
    {
        // Ujian baru, 1 siswa, grant pending, lalu ubah poin soal via copy-questions.
        const exam2 = await ins('exams', {
            teaching_assignment_id: ta.id, title: `${P}Ulangan Copy`,
            start_time: new Date(Date.now() - 3 * 3600000).toISOString(),
            duration_minutes: 60, is_active: true, max_violations: 3,
            show_results_immediately: true, is_randomized: false,
        })
        for (let i = 0; i < 5; i++) {
            await ins('exam_questions', {
                exam_id: exam2.id, question_text: `${P}copy soal ${i + 1}`,
                question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'],
                correct_answer: 'A', points: 10, order_index: i, status: 'approved',
                difficulty: 'EASY', content_format: 'plain',
            })
        }
        const g = await api(guruCookie, '/api/exam-submissions/susulan', {
            method: 'POST', body: JSON.stringify({ exam_id: exam2.id, student_id: students[0].student.id, max_percent: 50 }),
        })
        const gBody = await g.json()
        check('grant exam2 200', g.ok && gBody.success === true, JSON.stringify(gBody).slice(0, 120))

        // Sumber poin 20/soal (max 100) → copy ke exam2.
        const src = await ins('exams', {
            teaching_assignment_id: ta.id, title: `${P}Sumber Copy`,
            start_time: new Date(Date.now() - 3 * 3600000).toISOString(),
            duration_minutes: 60, is_active: true, max_violations: 3,
            show_results_immediately: true, is_randomized: false,
        })
        for (let i = 0; i < 5; i++) {
            await ins('exam_questions', {
                exam_id: src.id, question_text: `${P}src soal ${i + 1}`,
                question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'],
                correct_answer: 'A', points: 20, order_index: i, status: 'approved',
                difficulty: 'EASY', content_format: 'plain',
            })
        }
        const copyRes = await api(guruCookie, '/api/exams/copy-questions', {
            method: 'POST',
            body: JSON.stringify({ source_exam_id: src.id, target_exam_ids: [exam2.id] }),
        })
        check('copy-questions saat grant pending 200', copyRes.ok, `status=${copyRes.status}`)

        const { data: ph } = await supabase.from('exam_submissions')
            .select('max_score, started_at, is_submitted').eq('exam_id', exam2.id).eq('student_id', students[0].student.id).maybeSingle()
        check('max_score placeholder ter-refresh ke 100', ph?.max_score === 100 && ph?.started_at === null, JSON.stringify(ph))
    }

    console.log('\nF. copy-questions saat ada yang SEDANG mengerjakan → 409 (D2)')
    {
        // Fase D sudah submit semua → tidak lagi "sedang dikerjakan" (by design).
        // Buat ulangan baru + 1 submission berjalan (started_at terisi, belum submit).
        const exam3 = await ins('exams', {
            teaching_assignment_id: ta.id, title: `${P}Ulangan Sedang`,
            start_time: new Date(Date.now() - 3 * 3600000).toISOString(),
            duration_minutes: 60, is_active: true, max_violations: 3,
            show_results_immediately: true, is_randomized: false,
        })
        for (let i = 0; i < 3; i++) {
            await ins('exam_questions', {
                exam_id: exam3.id, question_text: `${P}busy soal ${i + 1}`,
                question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'],
                correct_answer: 'A', points: 10, order_index: i, status: 'approved',
                difficulty: 'EASY', content_format: 'plain',
            })
        }
        await ins('exam_submissions', {
            exam_id: exam3.id, student_id: students[0].student.id,
            started_at: new Date(Date.now() - 10 * 60000).toISOString(),
            is_submitted: false, max_score: 30, total_score: 0, is_graded: false,
        })
        const res = await api(guruCookie, '/api/exams/copy-questions', {
            method: 'POST',
            body: JSON.stringify({ source_exam_id: exam.id, target_exam_ids: [exam3.id] }),
        })
        check('copy ke exam yang sedang dikerjakan ditolak 409', res.status === 409, `status=${res.status}`)

        // Kontrol: target yang semua submission-nya sudah submit TIDAK diblokir.
        // (Pakai exam4 terpisah — menyalin ke `exam` akan menghapus question_id
        // yang dirujuk jawaban siswa, sehingga invariant G6 jadi tidak valid.)
        const exam4 = await ins('exams', {
            teaching_assignment_id: ta.id, title: `${P}Ulangan Selesai`,
            start_time: new Date(Date.now() - 3 * 3600000).toISOString(),
            duration_minutes: 60, is_active: true, max_violations: 3,
            show_results_immediately: true, is_randomized: false,
        })
        for (let i = 0; i < 3; i++) {
            await ins('exam_questions', {
                exam_id: exam4.id, question_text: `${P}done soal ${i + 1}`,
                question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'],
                correct_answer: 'A', points: 10, order_index: i, status: 'approved',
                difficulty: 'EASY', content_format: 'plain',
            })
        }
        await ins('exam_submissions', {
            exam_id: exam4.id, student_id: students[1].student.id,
            started_at: new Date(Date.now() - 30 * 60000).toISOString(),
            submitted_at: new Date(Date.now() - 20 * 60000).toISOString(),
            is_submitted: true, max_score: 30, total_score: 30, is_graded: true,
        })
        const resDone = await api(guruCookie, '/api/exams/copy-questions', {
            method: 'POST',
            body: JSON.stringify({ source_exam_id: exam3.id, target_exam_ids: [exam4.id] }),
        })
        check('copy ke exam yang semua sudah submit tetap boleh (200)', resDone.ok, `status=${resDone.status}`)
    }

    console.log('\nG. Invariant query (0 pelanggaran)')
    {
        // 1. submission ganda
        const { data: dup } = await supabase.from('exam_submissions').select('exam_id, student_id').eq('exam_id', exam.id)
        const seen = new Map()
        let dupCount = 0
        for (const r of dup || []) {
            const k = `${r.exam_id}|${r.student_id}`
            if (seen.has(k)) dupCount++
            seen.set(k, true)
        }
        check('G1 tidak ada submission ganda', dupCount === 0, `dup=${dupCount}`)

        // 2. submitted tanpa started_at
        const { data: badSubmit } = await supabase.from('exam_submissions')
            .select('id').eq('exam_id', exam.id).is('started_at', null).eq('is_submitted', true)
        check('G2 tidak ada submitted tanpa started_at', (badSubmit || []).length === 0)

        // 3. cap fail-open
        const { data: failOpen } = await supabase.from('exam_submissions')
            .select('id').eq('exam_id', exam.id).not('susulan_granted_at', 'is', null)
            .lt('susulan_max_percent', 100).or('max_score.is.null,max_score.lte.0')
        check('G3 tidak ada cap tanpa patokan max_score', (failOpen || []).length === 0)

        // 4. nilai melebihi cap
        const { data: over } = await supabase.from('exam_submissions')
            .select('id, total_score, max_score, susulan_max_percent')
            .eq('exam_id', exam.id).eq('is_submitted', true)
            .lt('susulan_max_percent', 100)
        const violated = (over || []).filter(s => (s.max_score || 0) > 0 && (s.total_score || 0) > (s.susulan_max_percent / 100) * s.max_score + 0.01)
        check('G4 tidak ada nilai melebihi cap', violated.length === 0, JSON.stringify(violated.slice(0, 3)))

        // 5. jawaban nyasar ke soal ujian lain (hanya exam fase D yang berjawaban)
        const { data: subs2 } = await supabase.from('exam_submissions')
            .select('id').eq('exam_id', exam.id).eq('is_submitted', true)
        const subIds = (subs2 || []).map(s => s.id)
        const qIds = new Set(questions.map(q2 => q2.id))
        let orphan = 0
        for (let i = 0; i < subIds.length; i += 100) {
            const { data: ans } = await supabase.from('exam_answers').select('question_id').in('submission_id', subIds.slice(i, i + 100))
            for (const a of ans || []) if (!qIds.has(a.question_id)) orphan++
        }
        check('G5 tidak ada jawaban soal dari ujian lain', orphan === 0, `orphan=${orphan}`)

        // 6. total_score = min(rekap jawaban, cap) — baris submitted fase D.
        // (Nilai sengaja di-cap, jadi bisa < rekap mentah; di atas rekap = bug.)
        let mismatch = 0
        for (let i = 0; i < subIds.length; i += 50) {
            const chunk = subIds.slice(i, i + 50)
            for (const sid of chunk) {
                const { data: ans } = await supabase.from('exam_answers').select('points_earned').eq('submission_id', sid)
                const recalc = Math.round((ans || []).reduce((s, a) => s + (a.points_earned || 0), 0) * 100) / 100
                const { data: sub } = await supabase.from('exam_submissions').select('total_score, max_score, susulan_max_percent, is_submitted').eq('id', sid).single()
                if (!sub?.is_submitted) continue
                const capped = Math.min(recalc, ((sub.susulan_max_percent ?? 100) / 100) * (sub.max_score || 0))
                const expected = Math.round(capped * 100) / 100
                if (Math.abs((sub.total_score || 0) - expected) > 0.02) mismatch++
            }
        }
        check('G6 total_score = min(rekap jawaban, cap)', mismatch === 0, `mismatch=${mismatch}`)
    }

    if (process.env.KEEP_FIXTURE === '1') {
        console.log('\n=== FIXTURE DIPERTAHANKAN ===')
        console.log(`Guru: ${uname('guru')} / ${PASS} · Exam: ${exam.id}`)
    } else {
        console.log('\nCleanup fixture...')
        await preClean()
        console.log('Cleanup selesai.')
    }
}

main()
    .then(() => {
        console.log(`\n=== SUSULAN CONCURRENCY: ${pass} PASS, ${fail} FAIL ===`)
        process.exit(fail > 0 ? 1 : 0)
    })
    .catch(async (e) => {
        console.error('FATAL:', e)
        try { await preClean() } catch { }
        process.exit(1)
    })
