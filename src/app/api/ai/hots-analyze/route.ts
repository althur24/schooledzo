import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { analyzeQuestion, type HOTSAnalysisInput } from '@/lib/hotsQC'
import { determineRouting, type RoutingInput } from '@/lib/routingRules'
import { isAIReviewEnabled } from '@/lib/triggerHOTS'
import { canManageExam, getTeacherScope } from '@/lib/teacherScope'

/**
 * POST /api/ai/hots-analyze
 *
 * Analyze a question for HOTS/Bloom's Taxonomy quality.
 * Can be called standalone or automatically after question save.
 *
 * Body:
 * {
 *   question_id: string,         // UUID of the question
 *   question_source: 'bank' | 'quiz' | 'exam',
 *   question_text: string,
 *   question_type: string,
 *   options?: string[],
 *   correct_answer?: string,
 *   teacher_difficulty?: string,
 *   teacher_hots_claim?: boolean,
 *   subject_name?: string,
 *   grade_band?: string           // 'SMP' or 'SMA'
 * }
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const body = await request.json()
        const {
            question_id,
            question_source,
            question_text,
            question_type,
            options,
            correct_answer,
            teacher_difficulty,
            teacher_hots_claim,
            subject_name,
            grade_band
        } = body

        if (!question_id || !question_source || !question_text) {
            return NextResponse.json(
                { error: 'question_id, question_source, dan question_text diperlukan' },
                { status: 400 }
            )
        }

        if (!['bank', 'quiz', 'exam'].includes(question_source)) {
            return NextResponse.json(
                { error: 'question_source harus bank, quiz, atau exam' },
                { status: 400 }
            )
        }

        // Role guard: route ini mengubah status soal orang lain dan memicu
        // biaya AI — sebelumnya terbuka untuk semua role (termasuk SISWA).
        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Ownership guard: soal harus milik guru pemilik (atau admin sekolah
        // yang sama). Tanpa ini, user sekolah mana pun bisa memicu analisis
        // (dan mengubah status) soal milik guru lain.
        if (question_source === 'exam') {
            const { data: q } = await supabase
                .from('exam_questions')
                .select('exam:exams(teaching_assignment:teaching_assignments(teacher_id))')
                .eq('id', question_id)
                .single()
            const examRow = Array.isArray(q?.exam) ? q.exam[0] : q?.exam
            const ta = Array.isArray(examRow?.teaching_assignment) ? examRow.teaching_assignment[0] : examRow?.teaching_assignment
            const taTeacherId = (ta as any)?.teacher_id ?? null
            if (!q || !taTeacherId) {
                return NextResponse.json({ error: 'Soal tidak ditemukan' }, { status: 404 })
            }
            if (!(await canManageExam(user, taTeacherId))) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke soal ini' }, { status: 403 })
            }
        } else if (question_source === 'quiz') {
            const { data: q } = await supabase
                .from('quiz_questions')
                .select('quiz:quizzes(teaching_assignment:teaching_assignments(teacher_id))')
                .eq('id', question_id)
                .single()
            const quizRow = Array.isArray(q?.quiz) ? q.quiz[0] : q?.quiz
            const ta = Array.isArray(quizRow?.teaching_assignment) ? quizRow.teaching_assignment[0] : quizRow?.teaching_assignment
            const taTeacherId = (ta as any)?.teacher_id ?? null
            if (!q || !taTeacherId) {
                return NextResponse.json({ error: 'Soal tidak ditemukan' }, { status: 404 })
            }
            if (!(await canManageExam(user, taTeacherId))) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke soal ini' }, { status: 403 })
            }
        } else {
            // bank: ownership via question_bank.teacher_id (guru) atau
            // sekolah terverifikasi via teacher/subject (admin). Bank tanpa
            // keduanya tidak bisa diverifikasi → tolak (konservatif).
            const { data: q } = await supabase
                .from('question_bank')
                .select('teacher_id, subject:subjects(school_id)')
                .eq('id', question_id)
                .single()
            if (!q) {
                return NextResponse.json({ error: 'Soal tidak ditemukan' }, { status: 404 })
            }
            if (user.role === 'GURU') {
                const scope = await getTeacherScope(user.id)
                if (!scope || q.teacher_id !== scope.teacherId) {
                    return NextResponse.json({ error: 'Anda tidak memiliki akses ke soal ini' }, { status: 403 })
                }
            } else {
                let ownerSchoolId: string | null = null
                if (q.teacher_id) {
                    const { data: t } = await supabase.from('teachers').select('school_id').eq('id', q.teacher_id).single()
                    ownerSchoolId = (t as any)?.school_id ?? null
                }
                if (!ownerSchoolId) {
                    const subj = Array.isArray(q.subject) ? q.subject[0] : q.subject
                    ownerSchoolId = (subj as any)?.school_id ?? null
                }
                if (!ownerSchoolId || ownerSchoolId !== schoolId) {
                    return NextResponse.json({ error: 'Anda tidak memiliki akses ke soal ini' }, { status: 403 })
                }
            }
        }

        // Check if AI review is enabled for this school
        const aiEnabled = await isAIReviewEnabled(schoolId)
        if (!aiEnabled) {
            return NextResponse.json({
                success: false,
                error: 'AI Review dinonaktifkan untuk sekolah ini',
                status: 'disabled'
            }, { status: 403 })
        }

        // 1. Update question status to 'ai_reviewing'
        const tableName = question_source === 'bank' ? 'question_bank'
            : question_source === 'quiz' ? 'quiz_questions'
                : 'exam_questions'

        await supabase
            .from(tableName)
            .update({ status: 'ai_reviewing' })
            .eq('id', question_id)

        // 2. Run AI analysis
        const analysisInput: HOTSAnalysisInput = {
            question_text,
            question_type: question_type || 'MULTIPLE_CHOICE',
            options: options || null,
            correct_answer: correct_answer || null,
            teacher_difficulty,
            teacher_hots_claim: teacher_hots_claim || false,
            subject_name,
            grade_band
        }

        const analysisResult = await analyzeQuestion(analysisInput)

        if (!analysisResult.success || !analysisResult.data) {
            // AI failed — set status back to draft
            await supabase
                .from(tableName)
                .update({ status: 'draft' })
                .eq('id', question_id)

            return NextResponse.json({
                success: false,
                error: analysisResult.error || 'AI analysis failed',
                status: 'draft'
            }, { status: 500 })
        }

        const aiData = analysisResult.data

        // 3. Save AI review to database
        const { error: reviewError } = await supabase
            .from('ai_reviews')
            .insert({
                question_source,
                question_id,
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

        if (reviewError) {
            console.error('Error saving AI review:', reviewError)
            // Non-fatal: still proceed with routing
        }

        // 4. Determine routing (auto-approve or admin queue)
        const routingInput: RoutingInput = {
            aiResult: aiData,
            teacherDifficulty: teacher_difficulty,
            teacherHotsClaim: teacher_hots_claim
        }

        const routingDecision = determineRouting(routingInput)

        // 5. Update question status based on routing
        const newStatus = routingDecision.action === 'auto_approve'
            ? 'approved'
            : 'admin_review'

        await supabase
            .from(tableName)
            .update({ status: newStatus })
            .eq('id', question_id)

        // 6. Return response
        return NextResponse.json({
            success: true,
            status: newStatus,
            analysis: {
                bloom_level: aiData.primary_bloom_level,
                hots: aiData.hots,
                boundedness: aiData.boundedness,
                difficulty: aiData.difficulty,
                quality: aiData.quality,
                confidence: aiData.confidence
            },
            routing: {
                action: routingDecision.action,
                reasons: routingDecision.reasons,
                priority: routingDecision.priority
            }
        })

    } catch (error: any) {
        console.error('HOTS analyze error:', error)
        return NextResponse.json(
            { error: error?.message || 'Server error' },
            { status: 500 }
        )
    }
}
