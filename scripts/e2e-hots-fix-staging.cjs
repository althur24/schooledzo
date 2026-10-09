/**
 * E2E staging: HOTS fix verification — BUG 10, 6, 7 + exam regression.
 *
 * PRASYARAT (urutan WAJIB — NEXT_PUBLIC_* ter-inline saat BUILD):
 *   1. set -a; source .env.staging; set +a; npm run build
 *   2. set -a; source .env.staging; set +a; UV_THREADPOOL_SIZE=16 npx next start -p 3457
 *   3. ENV_FILE=.env.staging node scripts/e2e-hots-fix-staging.cjs
 *
 * Testing 3 bug fix:
 *  [A] BUG 10: FAILED ai_review record tersimpan (primary_bloom_level NULL, bukan 0)
 *  [B] BUG 6: question_bank baru → status 'draft' saat AI ON (bukan DB default 'approved')
 *  [C] BUG 7: review queue menampilkan ai_review data (ORDER BY + keep-first)
 *  [D] Exam regression: soal exam baru → status 'draft' (tidak regresi)
 *
 * GEMINI_API_KEY staging invalid → HOTS akan gagal → sempurna untuk test BUG 10.
 *
 * Cleanup penuh di akhir (semua baris ber-prefix lthots_).
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.staging' })
const { createClient } = require('@supabase/supabase-js')
const bcrypt = require('bcrypt')

const BASE = process.env.E2E_BASE || 'http://localhost:3457'
const PASS = 'Lthots1234!'
const SCHOOL = '63e125e8-b0fe-43aa-a2e6-fe4a16e46fda'
const YEAR = '228189ac-55c5-470b-88cf-033c040144fb'
const SUBJECT = 'e2152481-75b7-47da-ace6-3fae4a46a1e2'
const CLASS = '7da71f34-b051-4aa9-ab4d-967ae741f61c'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ok : ${name}`) }
    else { fail++; console.log(`  FAIL: ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}

async function login(username) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASS }),
    })
    if (!res.ok) throw new Error(`login ${username} gagal: ${res.status}`)
    const cookie = res.headers.get('set-cookie')?.split(';')[0]
    return cookie
}

async function api(method, path, body, cookie) {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    })
    let data = null
    try { data = await res.json() } catch {}
    return { status: res.status, data }
}

async function main() {
    console.log('═══ SEED ══')
    // Idempoten: bersihkan sisa run sebelumnya
    {
        const { data: olds } = await supabase.from('users').select('id').like('username', 'lthots_%')
        for (const x of (olds || [])) {
            const { data: t } = await supabase.from('teachers').select('id').eq('user_id', x.id).maybeSingle()
            if (t) {
                const { data: tas } = await supabase.from('teaching_assignments').select('id').eq('teacher_id', t.id)
                for (const a of (tas || [])) {
                    const { data: exams } = await supabase.from('exams').select('id').eq('teaching_assignment_id', a.id)
                    for (const e of (exams || [])) {
                        await supabase.from('exam_questions').delete().eq('exam_id', e.id)
                        await supabase.from('exams').delete().eq('id', e.id)
                    }
                    await supabase.from('teaching_assignments').delete().eq('id', a.id)
                }
                const { data: bqs } = await supabase.from('question_bank').select('id').eq('teacher_id', t.id)
                for (const q of (bqs || [])) {
                    await supabase.from('ai_reviews').delete().eq('question_id', q.id)
                    await supabase.from('admin_reviews').delete().eq('question_id', q.id)
                }
                await supabase.from('question_bank').delete().eq('teacher_id', t.id)
                await supabase.from('teachers').delete().eq('id', t.id)
            }
            await supabase.from('sessions').delete().eq('user_id', x.id)
            await supabase.from('notifications').delete().eq('user_id', x.id)
            await supabase.from('users').delete().eq('id', x.id)
        }
    }

    const passHash = await bcrypt.hash(PASS, 10)
    const { data: guruU } = await supabase.from('users')
        .insert({ username: 'lthots_guru', full_name: 'Lthots Guru', password_hash: passHash, role: 'GURU', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    const { data: adminU } = await supabase.from('users')
        .insert({ username: 'lthots_admin', full_name: 'Lthots Admin', password_hash: passHash, role: 'ADMIN', school_id: SCHOOL, must_change_password: false, is_locked: false })
        .select('id').single()
    const { data: teacher } = await supabase.from('teachers')
        .insert({ user_id: guruU.id, school_id: SCHOOL })
        .select('id').single()
    const { data: ta } = await supabase.from('teaching_assignments')
        .insert({ teacher_id: teacher.id, subject_id: SUBJECT, class_id: CLASS, academic_year_id: YEAR })
        .select('id').single()
    console.log('seed ok')

    // Verify AI review is enabled for staging school
    const { data: school } = await supabase.from('schools').select('settings').eq('id', SCHOOL).single()
    const aiEnabled = school?.settings?.ai_review_enabled !== false
    check('AI review enabled di staging school', aiEnabled, school?.settings)

    const guru = await login('lthots_guru')
    const admin = await login('lthots_admin')
    check('login guru + admin', true)

    try {
        // ═══ [A] BUG 10: FAILED ai_review record tersimpan ═══
        console.log('\n═══ [A] BUG 10: FAILED ai_review record ══')

        // POST single question ke question_bank — triggers HOTS (fire-and-forget)
        const { status: qbSt, data: qbData } = await api('POST', '/api/question-bank', {
            subject_id: SUBJECT,
            question_text: 'lthots_Berapakah hasil dari 7 dikali 8 jika ditambah 10?',
            question_type: 'MULTIPLE_CHOICE',
            options: ['56', '66', '76', '46'],
            correct_answer: 'B',
            difficulty: 'EASY',
            teacher_hots_claim: false,
        }, guru)
        check('POST /api/question-bank 200/201', qbSt === 200 || qbSt === 201, qbData)
        const qbQid = qbData?.id
        check('question bank id returned', !!qbQid, qbQid)

        // Tunggu HOTS gagal (Gemini key invalid di staging)
        // triggerHOTSAnalysis: set 'ai_reviewing' → call Gemini → fail → set 'admin_review' + insert FAILED
        // Bulk delay tidak berlaku (single question) — should complete in ~5-8s
        console.log('  menunggu HOTS gagal (8 dtk)...')
        await new Promise(r => setTimeout(r, 8000))

        // Check question status
        const { data: qbQ } = await supabase.from('question_bank').select('status').eq('id', qbQid).single()
        check('question status = admin_review (HOTS fallback)', qbQ?.status === 'admin_review', qbQ?.status)

        // Check ai_review record — INI TEST UTAMA BUG 10
        const { data: aiReview } = await supabase.from('ai_reviews')
            .select('*').eq('question_id', qbQid).eq('question_source', 'bank')
            .order('created_at', { ascending: false }).limit(1)
        const failedReview = (aiReview || [])[0]
        check('FAILED ai_review record EXISTS (BUG 10 fix)', !!failedReview, failedReview)
        check('model_version = FAILED', failedReview?.model_version === 'FAILED', failedReview?.model_version)
        check('primary_bloom_level IS NULL (bukan 0)', failedReview?.primary_bloom_level === null, failedReview?.primary_bloom_level)
        check('hots_strength = S0', failedReview?.hots_strength === 'S0', failedReview?.hots_strength)
        check('full_json_report.needs_reanalysis = true', failedReview?.full_json_report?.needs_reanalysis === true, failedReview?.full_json_report)

        // ═══ [B] BUG 6: question_bank status = 'draft' saat AI ON ═══
        console.log('\n═══ [B] BUG 6: question_bank status draft ══')

        // POST question — cek status SEGERA (sebelum HOTS sempat jalan)
        const { status: qb2St, data: qb2Data } = await api('POST', '/api/question-bank', {
            subject_id: SUBJECT,
            question_text: 'lthots_Soal kedua untuk test status draft — jalan cepat sebelum HOTS',
            question_type: 'MULTIPLE_CHOICE',
            options: ['A', 'B', 'C', 'D'],
            correct_answer: 'A',
            difficulty: 'MEDIUM',
        }, guru)
        check('POST /api/question-bank (2nd) 200/201', qb2St === 200 || qb2St === 201, qb2Data)
        const qb2Qid = qb2Data?.id

        // Cek status SEGERA — harus 'draft' atau 'ai_reviewing' (HOTS mungkin sudah mulai),
        // yang penting BUKAN 'approved' (DB default sebelum BUG 6 fix)
        const { data: qb2Q } = await supabase.from('question_bank').select('status').eq('id', qb2Qid).single()
        check('status = draft/ai_reviewing SEGERA setelah insert (BUG 6 fix — bukan approved)', qb2Q?.status === 'draft' || qb2Q?.status === 'ai_reviewing', qb2Q?.status)

        // Tunggu HOTS, lalu cek status berubah ke 'admin_review' (fallback)
        console.log('  menunggu HOTS gagal (8 dtk)...')
        await new Promise(r => setTimeout(r, 8000))
        const { data: qb2Q2 } = await supabase.from('question_bank').select('status').eq('id', qb2Qid).single()
        check('status = admin_review setelah HOTS gagal', qb2Q2?.status === 'admin_review', qb2Q2?.status)

        // ═══ [C] BUG 7: review queue menampilkan ai_review data ═══
        console.log('\n═══ [C] BUG 7: review queue ai_review data ══')

        // GET review queue sebagai admin — filter admin_review
        const { status: rqSt, data: rqData } = await api('GET', '/api/admin/review-queue?status=admin_review&limit=100', null, admin)
        check('GET /api/admin/review-queue 200', rqSt === 200, rqSt)

        // Cari question kita di review queue
        const rqItem = (rqData?.data || []).find((q) => q.id === qbQid)
        check('question ditemukan di review queue', !!rqItem, rqItem?.id)

        // ai_review harus ada dan berisi data FAILED
        check('ai_review tidak null di review queue (BUG 7 fix)', !!rqItem?.ai_review, rqItem?.ai_review)
        check('ai_review.model_version = FAILED di review queue', rqItem?.ai_review?.model_version === 'FAILED', rqItem?.ai_review?.model_version)

        // ═══ [D] Exam regression: soal exam baru → status 'draft' ═══
        console.log('\n═══ [D] Exam regression: status draft ══')

        // Create exam
        const now = new Date()
        const iso = (h) => new Date(now.getTime() + h * 3600e3).toISOString()
        const { status: exSt, data: exData } = await api('POST', '/api/exams', {
            title: 'lthots_Exam Test',
            teaching_assignment_id: ta.id,
            duration_minutes: 30,
            max_violations: 3,
            start_time: iso(1),
            window_end_time: iso(3),
        }, guru)
        check('POST /api/exams 200/201', exSt === 200 || exSt === 201, exData)
        const examId = exData?.id

        // Add questions
        const { status: eqSt, data: eqData } = await api('POST', `/api/exams/${examId}/questions`, {
            questions: [
                { question_text: 'lthots_Exam soal 1', question_type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C', 'D'], correct_answer: 'A', points: 10, difficulty: 'EASY' },
                { question_text: 'lthots_Exam soal 2', question_type: 'ESSAY', correct_answer: 'jawaban', points: 10, difficulty: 'HARD' },
            ]
        }, guru)
        check('POST exam questions 200/201', eqSt === 200 || eqSt === 201, eqData)

        // Check exam question status — harus 'draft' (AI ON, bukan dari bank)
        if (eqData && Array.isArray(eqData)) {
            for (const q of eqData) {
                const { data: eq } = await supabase.from('exam_questions').select('status').eq('id', q.id).single()
                check(`exam question "${q.question_text?.slice(0, 20)}..." status = draft/ai_reviewing (bukan approved)`, eq?.status === 'draft' || eq?.status === 'ai_reviewing', eq?.status)
            }
        }

        // Exam edit regression: edit soal → status reset ke 'ai_reviewing'
        if (eqData?.[0]?.id) {
            const { status: editSt } = await api('PUT', `/api/exams/${examId}/questions`, {
                question_id: eqData[0].id,
                question_text: 'lthots_Exam soal 1 EDITED — konten berubah',
                question_type: 'MULTIPLE_CHOICE',
                options: ['A', 'B', 'C', 'D'],
                correct_answer: 'A',
            }, guru)
            check('PUT exam question (edit) 200', editSt === 200, editSt)

            const { data: editedQ } = await supabase.from('exam_questions').select('status').eq('id', eqData[0].id).single()
            check('edited exam question status = ai_reviewing (HOTS re-trigger)', editedQ?.status === 'ai_reviewing' || editedQ?.status === 'admin_review', editedQ?.status)
        }

        // Publish gate regression: publish harus ditolak/blocked saat ada soal draft/ai_reviewing
        const { status: pubSt, data: pubData } = await api('PUT', `/api/exams/${examId}`, { is_active: true }, guru)
        check('publish gate blocks saat soal processing (400 atau pending)', pubSt === 400 || (pubData && pubData.is_active === false), { status: pubSt, data: pubData })

    } finally {
        // ═══ CLEANUP ═══
        console.log('\n═══ CLEANUP ══')
        const { data: olds } = await supabase.from('users').select('id').like('username', 'lthots_%')
        for (const x of (olds || [])) {
            const { data: t } = await supabase.from('teachers').select('id').eq('user_id', x.id).maybeSingle()
            if (t) {
                const { data: tas } = await supabase.from('teaching_assignments').select('id').eq('teacher_id', t.id)
                for (const a of (tas || [])) {
                    const { data: exams } = await supabase.from('exams').select('id').eq('teaching_assignment_id', a.id)
                    for (const e of (exams || [])) {
                        const { data: eqs } = await supabase.from('exam_questions').select('id').eq('exam_id', e.id)
                        for (const eq of (eqs || [])) {
                            await supabase.from('ai_reviews').delete().eq('question_id', eq.id)
                        }
                        await supabase.from('exam_questions').delete().eq('exam_id', e.id)
                        await supabase.from('exams').delete().eq('id', e.id)
                    }
                    await supabase.from('teaching_assignments').delete().eq('id', a.id)
                }
                const { data: bqs } = await supabase.from('question_bank').select('id').eq('teacher_id', t.id)
                for (const q of (bqs || [])) {
                    await supabase.from('ai_reviews').delete().eq('question_id', q.id)
                    await supabase.from('admin_reviews').delete().eq('question_id', q.id)
                }
                await supabase.from('question_bank').delete().eq('teacher_id', t.id)
                await supabase.from('teachers').delete().eq('id', t.id)
            }
            await supabase.from('sessions').delete().eq('user_id', x.id)
            await supabase.from('notifications').delete().eq('user_id', x.id)
            await supabase.from('users').delete().eq('id', x.id)
        }
        console.log('cleanup ok')
    }

    console.log(`\n═══ HASIL: ${pass} pass, ${fail} fail ═══`)
    process.exit(fail > 0 ? 1 : 0)
}

main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
