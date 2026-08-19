/**
 * autoCloseExpired.ts — penutupan paksa submission yang kedaluwarsa.
 *
 * Dua pemakaian:
 *  1. Endpoint write (save/submit) — siswa mengirim data lewat batas + grace:
 *     jawaban yang dikirim diabaikan, submission ditutup dengan jawaban tersimpan.
 *  2. Sweep aktif scheduler (closeExpiredSubmissions) — menutup submission yatim
 *     yang browser-nya mati/offline, tanpa menunggu guru buka monitor.
 *
 * Semua penutupan idempoten (update bersyarat is_submitted=false / submitted_at IS NULL)
 * dan sunyi (tanpa notifikasi — mengikuti perilaku lazy sweep yang sudah ada).
 * submitted_at dicatat sebagai batas efektif (endsAt), bukan waktu penutupan,
 * supaya rekap jujur: siswa dianggap mengumpulkan tepat di batas waktunya.
 */

import { supabaseAdmin as supabase } from './supabase'
import { getExamQuestionsForGrading } from './examQuestionsCache'
import { needsManualGrading } from './questionTypeUtils'
import { resolveWindowExpiry, resolveQuizExpiry, isSweepDue } from './examExpiry'
import { logError } from './logError'

const DISCOVERY_LIMIT = 500 // batas atas kandidat per tipe per tick — tick tidak pernah raksasa
const CHUNK = 50            // penutupan paralel per chunk, menjaga DB saat massal (TO 1000 siswa)

const closedAtIso = (endsAt?: number | null) =>
    new Date(endsAt && Number.isFinite(endsAt) ? endsAt : Date.now()).toISOString()

export interface CloseResult {
    totalScore: number
    isGraded: boolean
}

/** Ulangan: tutup satu submission dengan jawaban tersimpan di exam_answers. */
export async function forceCloseExamSubmission(submissionId: string, examId: string, endsAt?: number | null): Promise<CloseResult | null> {
    try {
        const { data: answers } = await supabase
            .from('exam_answers').select('points_earned').eq('submission_id', submissionId)
        const totalScore = (answers || []).reduce((s, a) => s + (a.points_earned || 0), 0)
        const examQuestions = await getExamQuestionsForGrading('exam_questions', examId)
        const hasEssays = examQuestions.some(q => needsManualGrading(q.question_type))
        const isGraded = !hasEssays
        await supabase
            .from('exam_submissions')
            .update({
                is_submitted: true,
                submitted_at: closedAtIso(endsAt),
                total_score: totalScore,
                is_graded: isGraded
            })
            .eq('id', submissionId)
            .eq('is_submitted', false) // idempoten — aman dipanggil berulang/paralel
        return { totalScore, isGraded }
    } catch (e) {
        logError('forceCloseExamSubmission', e)
        return null
    }
}

/** UTS/UAS: tutup satu submission dengan jawaban tersimpan di official_exam_answers. */
export async function forceCloseOfficialSubmission(submissionId: string, examId: string, endsAt?: number | null): Promise<CloseResult | null> {
    try {
        const { data: answers } = await supabase
            .from('official_exam_answers').select('points_earned').eq('submission_id', submissionId)
        const totalScore = (answers || []).reduce((s: number, a: any) => s + (a.points_earned || 0), 0)
        const examQuestions = await getExamQuestionsForGrading('official_exam_questions', examId)
        const hasEssays = examQuestions.some(q => needsManualGrading(q.question_type))
        const isGraded = !hasEssays
        await supabase
            .from('official_exam_submissions')
            .update({
                is_submitted: true,
                submitted_at: closedAtIso(endsAt),
                total_score: totalScore,
                is_graded: isGraded
            })
            .eq('id', submissionId)
            .eq('is_submitted', false)
        return { totalScore, isGraded }
    } catch (e) {
        logError('forceCloseOfficialSubmission', e)
        return null
    }
}

/** Kuis: tutup satu submission dengan jawaban tersimpan di kolom answers (JSONB). */
export async function forceCloseQuizSubmission(submissionId: string, endsAt?: number | null): Promise<CloseResult | null> {
    try {
        const { data: sub } = await supabase
            .from('quiz_submissions').select('id, quiz_id, answers').eq('id', submissionId).single()
        if (!sub) return null
        const stored: any[] = Array.isArray(sub.answers) ? sub.answers : []
        const questions = await getExamQuestionsForGrading('quiz_questions', sub.quiz_id)
        const qMap = new Map(questions.map(q => [q.id, q]))
        let totalScore = 0
        stored.forEach(a => {
            const q = qMap.get(a.question_id)
            if (!q) return
            totalScore += a.score || 0 // jawaban kuis sudah dinilai saat disimpan
        })
        // maxScore = total seluruh soal (selaras lazy sweep kuis yang sudah ada)
        const maxScore = questions.reduce((acc, q) => acc + (q.points || 1), 0)
        const isGraded = !questions.some(q => needsManualGrading(q.question_type))
        await supabase
            .from('quiz_submissions')
            .update({
                submitted_at: closedAtIso(endsAt),
                total_score: totalScore,
                max_score: maxScore,
                is_graded: isGraded
            })
            .eq('id', submissionId)
            .is('submitted_at', null) // idempoten
        return { totalScore, isGraded }
    } catch (e) {
        logError('forceCloseQuizSubmission', e)
        return null
    }
}

async function chunkRun<T>(items: T[], fn: (item: T) => Promise<unknown>): Promise<void> {
    for (let i = 0; i < items.length; i += CHUNK) {
        await Promise.all(items.slice(i, i + CHUNK).map(fn))
    }
}

/**
 * Sweep aktif — dipanggil scheduler tiap menit. Hanya menyapu submission dari
 * ujian/kuis yang masih aktif (data historis/tahun arsip tidak disentuh;
 * lazy sweep di route monitor tetap jadi lapisan cadangan untuk itu).
 */
export async function closeExpiredSubmissions(now: number = Date.now()): Promise<{ exams: number; officials: number; quizzes: number }> {
    const result = { exams: 0, officials: 0, quizzes: 0 }

    // ULANGAN (jendela global + override hard reset)
    try {
        const { data: subs, error } = await supabase
            .from('exam_submissions')
            .select('id, exam_id, started_at, timer_override_until, exam:exams!inner(start_time, duration_minutes, is_active)')
            .eq('is_submitted', false)
            .eq('exam.is_active', true)
            .limit(DISCOVERY_LIMIT)
        if (error) throw error
        const due = (subs || []).filter((s: any) =>
            isSweepDue(resolveWindowExpiry(
                { start_time: s.exam?.start_time ?? null, duration_minutes: s.exam?.duration_minutes ?? null },
                { started_at: s.started_at, timer_override_until: s.timer_override_until }
            ), now))
        await chunkRun(due, (s: any) => {
            const expiry = resolveWindowExpiry(
                { start_time: s.exam?.start_time ?? null, duration_minutes: s.exam?.duration_minutes ?? null },
                { started_at: s.started_at, timer_override_until: s.timer_override_until })
            return forceCloseExamSubmission(s.id, s.exam_id, expiry.limited ? expiry.endAt : null)
        })
        result.exams = due.length
    } catch (e) {
        logError('closeExpiredSubmissions(exams)', e)
    }

    // UTS/UAS (jendela global + override hard reset)
    try {
        const { data: subs, error } = await supabase
            .from('official_exam_submissions')
            .select('id, exam_id, started_at, timer_override_until, exam:official_exams!inner(start_time, duration_minutes, is_active)')
            .eq('is_submitted', false)
            .eq('exam.is_active', true)
            .limit(DISCOVERY_LIMIT)
        if (error) throw error
        const due = (subs || []).filter((s: any) =>
            isSweepDue(resolveWindowExpiry(
                { start_time: s.exam?.start_time ?? null, duration_minutes: s.exam?.duration_minutes ?? null },
                { started_at: s.started_at, timer_override_until: s.timer_override_until }
            ), now))
        await chunkRun(due, (s: any) => {
            const expiry = resolveWindowExpiry(
                { start_time: s.exam?.start_time ?? null, duration_minutes: s.exam?.duration_minutes ?? null },
                { started_at: s.started_at, timer_override_until: s.timer_override_until })
            return forceCloseOfficialSubmission(s.id, s.exam_id, expiry.limited ? expiry.endAt : null)
        })
        result.officials = due.length
    } catch (e) {
        logError('closeExpiredSubmissions(officials)', e)
    }

    // KUIS (per-student dibatasi deadline)
    try {
        const { data: subs, error } = await supabase
            .from('quiz_submissions')
            .select('id, started_at, quiz:quizzes!inner(deadline, duration_minutes, is_active)')
            .is('submitted_at', null)
            .eq('quiz.is_active', true)
            .limit(DISCOVERY_LIMIT)
        if (error) throw error
        const due = (subs || []).filter((s: any) =>
            isSweepDue(resolveQuizExpiry(
                { deadline: s.quiz?.deadline ?? null, duration_minutes: s.quiz?.duration_minutes ?? null },
                { started_at: s.started_at }
            ), now))
        await chunkRun(due, (s: any) => {
            const expiry = resolveQuizExpiry(
                { deadline: s.quiz?.deadline ?? null, duration_minutes: s.quiz?.duration_minutes ?? null },
                { started_at: s.started_at })
            return forceCloseQuizSubmission(s.id, expiry.limited ? expiry.endAt : null)
        })
        result.quizzes = due.length
    } catch (e) {
        logError('closeExpiredSubmissions(quizzes)', e)
    }

    const total = result.exams + result.officials + result.quizzes
    if (total > 0) {
        console.log(`[auto-close] exams=${result.exams} officials=${result.officials} quizzes=${result.quizzes}`)
    }
    return result
}
