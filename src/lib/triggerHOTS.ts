/**
 * HOTS Analysis Trigger
 * 
 * Fire-and-forget helper to trigger AI HOTS analysis after saving questions.
 * This runs asynchronously so it doesn't block the save response.
 */

import { analyzeQuestion, type HOTSAnalysisInput } from '@/lib/hotsQC'
import { determineRouting } from '@/lib/routingRules'
import { supabaseAdmin as supabase } from '@/lib/supabase'

export interface TriggerHOTSInput {
    questionId: string
    questionSource: 'bank' | 'quiz' | 'exam'
    questionText: string
    questionType: string
    options?: string[] | null
    correctAnswer?: string | null
    teacherDifficulty?: string
    teacherHotsClaim?: boolean
    subjectName?: string
    gradeBand?: string
    quizId?: string
    examId?: string
}

/**
 * Trigger HOTS analysis for a single question (fire-and-forget)
 * This updates the question status and saves the AI review in the background.
 */
export async function triggerHOTSAnalysis(input: TriggerHOTSInput): Promise<void> {
    const tableName = input.questionSource === 'bank' ? 'question_bank'
        : input.questionSource === 'quiz' ? 'quiz_questions'
            : 'exam_questions'

    try {
        console.log(`[HOTS-DEBUG] triggerHOTSAnalysis called for ${input.questionSource}/${input.questionId}, table=${tableName}`)
        // 1. Set status to 'ai_reviewing'
        await supabase
            .from(tableName)
            .update({ status: 'ai_reviewing' })
            .eq('id', input.questionId)

        // 2. Run AI analysis
        const analysisInput: HOTSAnalysisInput = {
            question_text: input.questionText,
            question_type: input.questionType,
            options: input.options || null,
            correct_answer: input.correctAnswer || null,
            teacher_difficulty: input.teacherDifficulty,
            teacher_hots_claim: input.teacherHotsClaim || false,
            subject_name: input.subjectName,
            grade_band: input.gradeBand
        }

        const result = await analyzeQuestion(analysisInput)

        if (!result.success || !result.data) {
            console.error(`HOTS analysis failed for ${input.questionSource}/${input.questionId}:`, result.error)
            // Revert to draft on failure
            await supabase
                .from(tableName)
                .update({ status: 'draft' })
                .eq('id', input.questionId)
            return
        }

        const aiData = result.data

        // 3. Save AI review
        await supabase.from('ai_reviews').insert({
            question_source: input.questionSource,
            question_id: input.questionId,
            primary_bloom_level: aiData.primary_bloom_level,
            secondary_bloom_levels: aiData.secondary_bloom_levels,
            hots_flag: aiData.hots.flag,
            hots_strength: aiData.hots.strength,
            hots_signals: aiData.hots.signals,
            boundedness: aiData.boundedness,
            difficulty_score: aiData.difficulty.score_1_10,
            difficulty_label: aiData.difficulty.label,
            difficulty_reasons: aiData.difficulty.reasons,
            clarity_score: aiData.quality.clarity_score_0_100,
            ambiguity_flags: aiData.quality.ambiguity_flags,
            missing_info_flags: aiData.quality.missing_info_flags,
            grade_fit_flags: aiData.quality.grade_fit_flags,
            subject_match_score: aiData.alignment.subject_match_score_0_100,
            suggested_edits: aiData.suggested_edits,
            bloom_confidence: aiData.confidence.bloom,
            hots_confidence: aiData.confidence.hots,
            difficulty_confidence: aiData.confidence.difficulty,
            boundedness_confidence: aiData.confidence.boundedness,
            full_json_report: aiData,
            model_version: aiData.model_version
        })

        // 4. Determine routing
        const routing = determineRouting({
            aiResult: aiData,
            teacherDifficulty: input.teacherDifficulty,
            teacherHotsClaim: input.teacherHotsClaim
        })

        // 5. Update final status
        const newStatus = routing.action === 'auto_approve' ? 'approved' : 'admin_review'
        await supabase
            .from(tableName)
            .update({ status: newStatus })
            .eq('id', input.questionId)

        // 6. Notify teacher and admin about HOTS analysis results
        try {
            let teacherUserId: string | null = null

            // Get teacher user_id from any question source
            if (input.questionSource === 'bank') {
                const { data: q } = await supabase
                    .from('question_bank')
                    .select('teacher:teachers(user_id)')
                    .eq('id', input.questionId)
                    .single()
                teacherUserId = (q as any)?.teacher?.user_id || null
            } else {
                const sourceTable = input.questionSource === 'quiz' ? 'quiz_questions' : 'exam_questions'
                const parentJoin = input.questionSource === 'quiz'
                    ? 'quiz:quizzes(teaching_assignment:teaching_assignments(teacher:teachers(user_id)))'
                    : 'exam:exams(teaching_assignment:teaching_assignments(teacher:teachers(user_id)))'
                const { data: q } = await supabase
                    .from(sourceTable)
                    .select(parentJoin)
                    .eq('id', input.questionId)
                    .single()
                const parent = input.questionSource === 'quiz' ? (q as any)?.quiz : (q as any)?.exam
                const ta = parent?.teaching_assignment
                const taObj = Array.isArray(ta) ? ta[0] : ta
                const teacher = taObj?.teacher
                const teacherObj = Array.isArray(teacher) ? teacher[0] : teacher
                teacherUserId = teacherObj?.user_id || null
                console.log(`[NOTIF-DEBUG] triggerHOTS teacher lookup: parent=${JSON.stringify(parent)?.slice(0, 200)}, teacherUserId=${teacherUserId}`)
            }

            // Notify teacher if question needs admin review
            if (teacherUserId && newStatus === 'admin_review') {
                const sourceLabel = input.questionSource === 'quiz' ? 'kuis' : input.questionSource === 'exam' ? 'ulangan' : 'bank soal'
                await supabase.from('notifications').insert({
                    user_id: teacherUserId,
                    type: 'HOTS_REVIEW',
                    title: '🤖 Analisis AI selesai — soal perlu review admin',
                    message: `Soal ${sourceLabel} Anda telah dianalisis AI dan diteruskan ke admin untuk review. Alasan: ${routing.reasons?.join(', ') || 'Perlu verifikasi manual'}`,
                    link: input.questionSource === 'bank' ? '/dashboard/guru/bank-soal' : input.questionSource === 'quiz' ? '/dashboard/guru/kuis' : '/dashboard/guru/ulangan'
                })
            }

            // Notify same-school admins when questions need review
            if (newStatus === 'admin_review') {
                // Determine school_id from the question's teacher
                let questionSchoolId: string | null = null
                if (input.questionSource === 'bank') {
                    const { data: q } = await supabase
                        .from('question_bank')
                        .select('teacher:teachers(school_id)')
                        .eq('id', input.questionId)
                        .single()
                    questionSchoolId = (q as any)?.teacher?.school_id || null
                } else {
                    const sourceTable = input.questionSource === 'quiz' ? 'quiz_questions' : 'exam_questions'
                    const parentJoin = input.questionSource === 'quiz'
                        ? 'quiz:quizzes(teaching_assignment:teaching_assignments(academic_year:academic_years(school_id)))'
                        : 'exam:exams(teaching_assignment:teaching_assignments(academic_year:academic_years(school_id)))'
                    const { data: q } = await supabase
                        .from(sourceTable)
                        .select(parentJoin)
                        .eq('id', input.questionId)
                        .single()
                    const parent = input.questionSource === 'quiz' ? (q as any)?.quiz : (q as any)?.exam
                    const ta = parent?.teaching_assignment
                    const taObj = Array.isArray(ta) ? ta[0] : ta
                    const ay = taObj?.academic_year
                    const ayObj = Array.isArray(ay) ? ay[0] : ay
                    questionSchoolId = ayObj?.school_id || null
                }

                // Only notify admins from the same school
                let adminQuery = supabase
                    .from('users')
                    .select('id')
                    .eq('role', 'ADMIN')
                if (questionSchoolId) {
                    adminQuery = adminQuery.eq('school_id', questionSchoolId)
                }
                const { data: admins } = await adminQuery

                if (admins?.length) {
                    const sourceLabel = input.questionSource === 'quiz' ? 'kuis' : input.questionSource === 'exam' ? 'ulangan' : 'bank soal'
                    await supabase.from('notifications').insert(
                        admins.map(a => ({
                            user_id: a.id,
                            type: 'HOTS_REVIEW',
                            title: '⚠️ Soal baru perlu review',
                            message: `Soal dari ${sourceLabel} perlu ditinjau. Alasan: ${routing.reasons?.join(', ') || 'Perlu verifikasi manual'}`,
                            link: '/dashboard/admin/review-soal'
                        }))
                    )
                }
            }
        } catch (notifErr) {
            console.error('Notification error:', notifErr)
        }

        console.log(`HOTS analysis complete for ${input.questionSource}/${input.questionId}: ${newStatus}`)

        // If the final status is approved, and it belongs to a quiz/exam, check if we need to auto-publish
        if (newStatus === 'approved' && (input.questionSource === 'quiz' || input.questionSource === 'exam')) {
            import('./autoPublish').then(({ checkAndAutoPublish }) => {
                checkAndAutoPublish(input.questionSource as 'quiz' | 'exam', input.quizId || input.examId || '').catch(console.error)
            }).catch(console.error)
        }

    } catch (error) {
        console.error(`HOTS analysis error for ${input.questionSource}/${input.questionId}:`, error)
        // Revert to approved on error (don't block question usage)
        await supabase
            .from(tableName)
            .update({ status: 'approved' })
            .eq('id', input.questionId)

        // Check for auto-publish even on error back-off
        if (input.questionSource === 'quiz' || input.questionSource === 'exam') {
            import('./autoPublish').then(({ checkAndAutoPublish }) => {
                checkAndAutoPublish(input.questionSource as 'quiz' | 'exam', input.quizId || input.examId || '').catch(console.error)
            }).catch(console.error)
        }
    }
}

/**
 * Trigger HOTS analysis for multiple questions (fire-and-forget).
 * Processes each question individually and in parallel (max 3 concurrent).
 */
export function triggerBulkHOTSAnalysis(questions: TriggerHOTSInput[]): void {
    // Fire and forget — don't await
    processBulk(questions).catch(err => {
        console.error('Bulk HOTS analysis error:', err)
    })
}

async function processBulk(questions: TriggerHOTSInput[]): Promise<void> {
    // Process in batches of 3 to avoid overloading the API
    const batchSize = 3
    for (let i = 0; i < questions.length; i += batchSize) {
        const batch = questions.slice(i, i + batchSize)
        await Promise.allSettled(batch.map(q => triggerHOTSAnalysis(q)))
    }
}
