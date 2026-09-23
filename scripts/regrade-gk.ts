/**
 * scripts/regrade-gk.ts — regrade retro-aktif soal objektif (fokus Ganda Kompleks).
 *
 * Latar: sebelum fix 2026-09-22, gradeAnswer hanya menerima kunci GK format JSON
 * array & case-sensitive, dan skor dibulatkan ke integer. Submission lama yang
 * terkena bug ("siswa benar tapi disalahkan", skor 1/3 poin jadi 0) dinilai ulang
 * di sini dengan logika grading yang baru (gradeAnswer + parseAnswerLetters dari
 * src/lib/questionTypeUtils — SATU sumber kebenaran, bukan salinan).
 *
 * Yang dilakukan:
 *  - quiz_submissions      : re-grade jawaban objektif di kolom answers (JSONB),
 *                            recompute total_score.
 *  - exam_submissions      : re-grade baris exam_answers (objektif saja), recompute
 *                            total_score.
 *  - official_exam_submissions : idem, tabel official_exam_*.
 *  - Jawaban isian singkat & essay TIDAK disentuh (nilai koreksi guru tetap).
 *  - Laporkan kunci GK yang tak bisa diparse + soal PG yang kuncinya multi-huruf
 *    (indikasi salah tipe — TIDAK di-auto-convert, keputusan guru).
 *
 * WAJIB jalankan migrasi 20260922023328_gk_grading_mode_decimal_scores.sql
 * (prod + staging) lebih dulu — script mengecek keberadaan kolom gk_grading_mode.
 *
 * Jalankan:
 *   npx tsx scripts/regrade-gk.ts              # DRY-RUN (default) — hanya laporan
 *   npx tsx scripts/regrade-gk.ts --apply      # tulis ke DB
 *   ENV_FILE=.env.staging npx tsx scripts/regrade-gk.ts --apply
 */

import { createClient } from '@supabase/supabase-js'
import { gradeAnswer, parseAnswerLetters, needsManualGrading } from '../src/lib/questionTypeUtils'

// ── Env guard (paritas loadtest/e2e/helpers.cjs loadEnvGuarded) ──
const envFile = process.env.ENV_FILE || '.env.local'
require('dotenv').config({ path: envFile })
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const isStagingFile = envFile.includes('staging')
const urlHasStaging = SUPABASE_URL.includes('vkkgnredrfqqraonynte')
const urlHasProd = SUPABASE_URL.includes('veohqmrydavkokfiqvjj')
if (!SERVICE_KEY) throw new Error(`[ENV] SUPABASE_SERVICE_ROLE_KEY kosong di ${envFile} — ABORT.`)
if (isStagingFile && !urlHasStaging) throw new Error(`[ENV GUARD] ${envFile} aktif tapi URL bukan staging. ABORT.`)
if (!isStagingFile && urlHasStaging) throw new Error(`[ENV GUARD] ${envFile} (production) menunjuk STAGING. ABORT.`)
if (isStagingFile && urlHasProd) throw new Error(`[ENV GUARD] ${envFile} (staging) berisi URL PRODUCTION. ABORT sebelum menyentuh DB prod.`)

const APPLY = process.argv.includes('--apply')
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ── Helper: fetch semua baris (PostgREST memotong di 1000 — paritas fetchAllRows) ──
async function fetchAllRows<T = any>(query: any, pageSize = 1000, maxPages = 200): Promise<T[]> {
    const all: T[] = []
    for (let page = 0; page < maxPages; page++) {
        const { data, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1)
        if (error) throw error
        all.push(...(data || []))
        if ((data || []).length < pageSize) break
    }
    return all
}

async function fetchIn<T = any>(table: string, column: string, ids: string[], select: string): Promise<T[]> {
    const out: T[] = []
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        out.push(...await fetchAllRows<T>(supabase.from(table).select(select).in(column, chunk).order('id')))
    }
    return out
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Cek jawaban isian cocok kunci — logika yang SAMA dengan gradeAnswer versi
 * baru (koma-split + NFKC + rapatkan spasi + case-insensitive). Dipisah agar
 * regrade bisa memakai pencocokan baru untuk data yang dinilai salah oleh
 * pencocokan lama (trim+lowercase saja).
 */
function matchesShortAnswer(studentAnswer: string, correctAnswer: string | null): boolean {
    if (!correctAnswer) return false
    const std = (t: string) => t.normalize('NFKC').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
    return correctAnswer.split(',').map(std).includes(std(studentAnswer))
}

type GradableQ = {
    id: string
    question_type: string
    correct_answer: string | null
    options: string[] | null
    points: number | null
    gk_grading_mode?: 'PROPORTIONAL' | 'ALL_OR_NOTHING' | null
}

const summary = {
    quiz: { submissions: 0, changed: 0, answersRegaded: 0, deltaTotal: 0 },
    exam: { submissions: 0, changed: 0, answersRegaded: 0, deltaTotal: 0 },
    official: { submissions: 0, changed: 0, answersRegaded: 0, deltaTotal: 0 },
}
const unparseableGkKeys: { table: string; id: string; correct_answer: string | null }[] = []
const mcMultiLetterKeys: { table: string; id: string; correct_answer: string | null }[] = []

/** Muat soal per assessment + catat anomali kunci. */
async function loadQuestions(table: 'quiz_questions' | 'exam_questions' | 'official_exam_questions', fk: 'quiz_id' | 'exam_id', ids: string[]): Promise<Map<string, GradableQ>> {
    const map = new Map<string, GradableQ>()
    for (let i = 0; i < ids.length; i += 100) {
        const rows = await fetchAllRows<any>(
            supabase.from(table)
                .select('id, question_type, correct_answer, options, points, gk_grading_mode')
                .in(fk, ids.slice(i, i + 100))
        )
        for (const q of rows) {
            map.set(q.id, q)
            if (q.question_type === 'MULTIPLE_ANSWER' && parseAnswerLetters(q.correct_answer).length === 0) {
                unparseableGkKeys.push({ table, id: q.id, correct_answer: q.correct_answer })
            }
            if (q.question_type === 'MULTIPLE_CHOICE' && q.correct_answer && q.correct_answer.includes(',')) {
                mcMultiLetterKeys.push({ table, id: q.id, correct_answer: q.correct_answer })
            }
        }
    }
    return map
}

async function regradeQuizzes() {
    console.log('\n══ KUIS (quiz_submissions) ══')
    const subs = await fetchAllRows<any>(
        supabase.from('quiz_submissions')
            .select('id, quiz_id, answers, total_score')
            .not('submitted_at', 'is', null)
            .order('id')
    )
    summary.quiz.submissions = subs.length

    const quizIds = [...new Set(subs.map(s => s.quiz_id).filter(Boolean))]
    const qByQuiz = new Map<string, Map<string, GradableQ>>()
    for (const qid of quizIds) {
        qByQuiz.set(qid, await loadQuestions('quiz_questions', 'quiz_id', [qid]))
    }

    let sampleShown = 0
    for (const sub of subs) {
        const qmap = qByQuiz.get(sub.quiz_id)
        const answers: any[] = Array.isArray(sub.answers) ? sub.answers : []
        if (!qmap || answers.length === 0) continue

        let total = 0
        let changed = false
        let regraded = 0
        const newAnswers = answers.map(a => {
            const q = qmap.get(a?.question_id)
            if (!q) return a
            if (needsManualGrading(q.question_type)) {
                // Isian singkat dari rescue-path lama (dinilai otomatis salah):
                // 0 + is_correct=false padahal cocok kunci → koreksi poin penuh.
                if (q.question_type === 'SHORT_ANSWER'
                    && a.is_correct === false
                    && (a.score ?? 0) === 0
                    && a.answer
                    && matchesShortAnswer(a.answer, q.correct_answer)) {
                    const full = q.points || 1
                    total += full
                    changed = true
                    console.log(`  [isian-fix quiz] ${sub.id}: "${String(a.answer).slice(0, 40)}" cocok kunci → ${full} poin`)
                    return { ...a, is_correct: true, score: full }
                }
                // Isian/essay lain: nilai koreksi guru tidak tersentuh
                total += typeof a.score === 'number' ? a.score : 0
                return a
            }
            const g = gradeAnswer(q.question_type, a.answer ?? '', q.correct_answer, q.options, q.points || 1, q.gk_grading_mode ?? 'PROPORTIONAL')
            total += g.pointsEarned
            regraded++
            if (a.is_correct !== g.isCorrect || a.score !== g.pointsEarned) {
                changed = true
                if (sampleShown < 5) {
                    sampleShown++
                    console.log(`  [contoh] quiz_sub ${sub.id} soal ${q.id}: ${q.question_type} ${a.is_correct ? 'benar' : 'salah'}(${a.score}) → ${g.isCorrect ? 'benar' : 'salah'}(${g.pointsEarned})`)
                }
            }
            return { ...a, is_correct: g.isCorrect, score: g.pointsEarned }
        })
        total = round2(total)
        if (!changed && total !== sub.total_score) changed = true
        if (!changed) continue

        summary.quiz.changed++
        summary.quiz.answersRegaded += regraded
        summary.quiz.deltaTotal += total - (sub.total_score || 0)
        if (APPLY) {
            const { error } = await supabase
                .from('quiz_submissions')
                .update({ answers: newAnswers, total_score: total })
                .eq('id', sub.id)
            if (error) console.error(`  GAGAL quiz_sub ${sub.id}: ${error.message}`)
        }
    }
}

async function regradeTableAnswers(
    label: 'exam' | 'official',
    subTable: 'exam_submissions' | 'official_exam_submissions',
    ansTable: 'exam_answers' | 'official_exam_answers',
    qTable: 'exam_questions' | 'official_exam_questions',
) {
    console.log(`\n══ ${label.toUpperCase()} (${subTable}) ══`)
    const subs = await fetchAllRows<any>(
        supabase.from(subTable)
            .select('id, exam_id, total_score')
            .eq('is_submitted', true)
            .order('id')
    )
    summary[label].submissions = subs.length

    const examIds = [...new Set(subs.map(s => s.exam_id).filter(Boolean))]
    const qByExam = new Map<string, Map<string, GradableQ>>()
    for (const eid of examIds) {
        qByExam.set(eid, await loadQuestions(qTable, 'exam_id', [eid]))
    }

    // Jawaban per submission (batch .in chunk 100, fetchAllRows per chunk)
    const subIds = subs.map(s => s.id)
    const allAnswers = await fetchIn<any>(ansTable, 'submission_id', subIds,
        'id, submission_id, question_id, answer, is_correct, points_earned')
    const ansBySub = new Map<string, any[]>()
    for (const a of allAnswers) {
        if (!ansBySub.has(a.submission_id)) ansBySub.set(a.submission_id, [])
        ansBySub.get(a.submission_id)!.push(a)
    }

    let sampleShown = 0
    const pendingUpdates: { id: string; points_earned: number; is_correct: boolean }[] = []
    const pendingTotals: { id: string; total_score: number }[] = []
    // Isian singkat ter-auto-grade salah oleh kode lama (jalur autosave/force-close
    // exam+official dulu menilai SEMUA jawaban): 0 + is_correct=false padahal jawaban
    // cocok kunci → koreksi ke poin penuh. Flag stale (guru sudah nilai >0 tapi
    // is_correct masih false) → netralkan flag saja (nilai guru tak disentuh).
    let shortFixed = 0, flagsNeutralized = 0

    for (const sub of subs) {
        const qmap = qByExam.get(sub.exam_id)
        const answers = ansBySub.get(sub.id) || []
        if (!qmap || answers.length === 0) continue

        let total = 0
        let changed = false
        let regraded = 0
        for (const a of answers) {
            const q = qmap.get(a.question_id)
            if (!q) { total += a.points_earned || 0; continue }
            if (needsManualGrading(q.question_type)) {
                // Isian singkat: koreksi kasus auto-grade salah (kode lama)
                if (q.question_type === 'SHORT_ANSWER'
                    && a.is_correct === false
                    && (a.points_earned ?? 0) === 0
                    && a.answer
                    && matchesShortAnswer(a.answer, q.correct_answer)) {
                    const full = q.points || (label === 'official' ? 10 : 1)
                    total += full
                    changed = true
                    shortFixed++
                    pendingUpdates.push({ id: a.id, points_earned: full, is_correct: true })
                    if (sampleShown < 8) {
                        sampleShown++
                        console.log(`  [isian-fix] ${subTable} ${sub.id}: "${String(a.answer).slice(0, 40)}" cocok kunci → ${full} poin (dulu 0/salah)`)
                    }
                    continue
                }
                // Flag stale: guru sudah memberi nilai >0 tapi is_correct masih
                // false (preserve dari auto-grade lama) → netralkan
                if (a.is_correct === false && (a.points_earned ?? 0) > 0) {
                    changed = true
                    flagsNeutralized++
                    pendingUpdates.push({ id: a.id, points_earned: a.points_earned as number, is_correct: true })
                    continue
                }
                // Essay / isian lain: nilai koreksi guru tidak tersentuh
                total += a.points_earned || 0
                continue
            }
            const g = gradeAnswer(q.question_type, a.answer ?? '', q.correct_answer, q.options, q.points || (label === 'official' ? 10 : 1), q.gk_grading_mode ?? 'PROPORTIONAL')
            total += g.pointsEarned
            regraded++
            if (a.is_correct !== g.isCorrect || a.points_earned !== g.pointsEarned) {
                changed = true
                if (sampleShown < 8) {
                    sampleShown++
                    console.log(`  [contoh] ${subTable} ${sub.id} soal ${q.id}: ${q.question_type} ${a.is_correct ? 'benar' : a.is_correct === false ? 'salah' : '?'}(${a.points_earned}) → ${g.isCorrect ? 'benar' : 'salah'}(${g.pointsEarned})`)
                }
                pendingUpdates.push({ id: a.id, points_earned: g.pointsEarned, is_correct: g.isCorrect })
            }
        }
        total = round2(total)
        if (!changed && total !== sub.total_score) changed = true
        if (!changed) continue

        summary[label].changed++
        summary[label].answersRegaded += regraded
        summary[label].deltaTotal += total - (sub.total_score || 0)
        pendingTotals.push({ id: sub.id, total_score: total })
    }

    if (shortFixed > 0 || flagsNeutralized > 0) {
        console.log(`  [${label}] isian terkoreksi: ${shortFixed} | flag stale dinetralkan: ${flagsNeutralized}`)
    }

    if (APPLY) {
        // Update baris jawaban yang berubah saja (tanpa menyentuh answer/feedback —
        // update selektif per kolom, bukan upsert partial yang menimpa NULL)
        for (let i = 0; i < pendingUpdates.length; i += 50) {
            const results = await Promise.all(pendingUpdates.slice(i, i + 50).map(u =>
                supabase.from(ansTable).update({ points_earned: u.points_earned, is_correct: u.is_correct }).eq('id', u.id)
            ))
            const failed = results.find(r => r.error)
            if (failed?.error) console.error(`  GAGAL update ${ansTable}: ${failed.error.message}`)
        }
        for (const t of pendingTotals) {
            const { error } = await supabase.from(subTable).update({ total_score: t.total_score }).eq('id', t.id)
            if (error) console.error(`  GAGAL update total ${subTable} ${t.id}: ${error.message}`)
        }
    }
}

async function main() {
    const modeLabel = APPLY ? 'APPLY (menulis ke database!)' : 'DRY-RUN (tambah --apply untuk menulis)'
    console.log('╔══════════════════════════════════════════════════════════╗')
    console.log('║  REGRADE GANDA KOMPLEKS & SOAL OBJEKTIF                   ║')
    console.log(`║  env  : ${envFile.padEnd(47)}║`)
    console.log(`║  mode : ${modeLabel.slice(0, 47).padEnd(47)}║`)
    console.log('╚══════════════════════════════════════════════════════════╝')

    // Guard: migrasi harus sudah jalan (kolom gk_grading_mode ada)
    const { error: probeErr } = await supabase
        .from('quiz_questions')
        .select('id, gk_grading_mode')
        .limit(1)
    if (probeErr && /gk_grading_mode|PGRST204|column/i.test(probeErr.message)) {
        throw new Error(`[GUARD] Kolom gk_grading_mode belum ada — jalankan migrasi 20260922023328_gk_grading_mode_decimal_scores.sql (prod + staging) dulu. (${probeErr.message})`)
    }

    await regradeQuizzes()
    await regradeTableAnswers('exam', 'exam_submissions', 'exam_answers', 'exam_questions')
    await regradeTableAnswers('official', 'official_exam_submissions', 'official_exam_answers', 'official_exam_questions')

    console.log(`\n══ RINGKASAN ${APPLY ? '(APPLIED)' : '(DRY-RUN)'} ══`)
    for (const [label, s] of Object.entries(summary)) {
        console.log(`${label.padEnd(9)}: ${s.submissions} submission terkumpul, ${s.changed} berubah, ${s.answersRegaded} jawaban objektif dinilai ulang, Δtotal=${round2(s.deltaTotal)}`)
    }
    if (unparseableGkKeys.length > 0) {
        console.log(`\n⚠ ${unparseableGkKeys.length} kunci GK tak bisa diparse (dibiarkan, guru perlu perbaiki manual):`)
        unparseableGkKeys.slice(0, 10).forEach(k => console.log(`  - ${k.table} ${k.id}: ${JSON.stringify(k.correct_answer)}`))
        if (unparseableGkKeys.length > 10) console.log(`  … dan ${unparseableGkKeys.length - 10} lainnya`)
    }
    if (mcMultiLetterKeys.length > 0) {
        console.log(`\n⚠ ${mcMultiLetterKeys.length} soal PILIHAN GANDA berkunci multi-huruf (kemungkinan salah tipe — tinjau manual, TIDAK di-auto-convert):`)
        mcMultiLetterKeys.slice(0, 10).forEach(k => console.log(`  - ${k.table} ${k.id}: ${JSON.stringify(k.correct_answer)}`))
        if (mcMultiLetterKeys.length > 10) console.log(`  … dan ${mcMultiLetterKeys.length - 10} lainnya`)
    }
    if (!APPLY) {
        console.log('\nIni DRY-RUN — tidak ada data yang ditulis. Jalankan ulang dengan --apply untuk mengeksekusi.')
    }
}

main().catch(err => {
    console.error('\n[FATAL]', err)
    process.exit(1)
})
