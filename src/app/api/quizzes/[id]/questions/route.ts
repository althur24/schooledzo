import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { triggerHOTSAnalysis, triggerBulkHOTSAnalysis, isAIReviewEnabled, type TriggerHOTSInput } from '@/lib/triggerHOTS'

// GET questions for a quiz
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const { data, error } = await supabase
            .from('quiz_questions')
            .select('*')
            .eq('quiz_id', id)
            .order('order_index')

        if (error) throw error

        let questions = data || []

        // Enrich returned questions with admin review data
        if (user.role === 'GURU') {
            const returnedIds = questions.filter((q: any) => q.status === 'returned').map((q: any) => q.id)
            if (returnedIds.length > 0) {
                const { data: adminReviews } = await supabase
                    .from('admin_reviews').select('*')
                    .eq('question_source', 'quiz').in('question_id', returnedIds)
                    .order('created_at', { ascending: false })
                const reviewMap = new Map()
                adminReviews?.forEach((r: any) => {
                    if (!reviewMap.has(r.question_id)) reviewMap.set(r.question_id, r)
                })
                questions = questions.map((q: any) => ({
                    ...q, admin_review: reviewMap.get(q.id) || null
                }))
            }
        }

        // C1 Security Fix: Strip correct_answer for students unless quiz is already submitted
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()

            let hasSubmitted = false
            if (student) {
                const { data: submission } = await supabase
                    .from('quiz_submissions')
                    .select('submitted_at')
                    .eq('quiz_id', id)
                    .eq('student_id', student.id)
                    .single()
                hasSubmitted = !!submission?.submitted_at
            }

            if (!hasSubmitted) {
                questions = questions.map(({ correct_answer, ...rest }) => rest)
            }
        }

        return NextResponse.json(questions)
    } catch (error) {
        console.error('Error fetching questions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST add question to quiz
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()

        // Check AI review status ONCE before any insert
        const aiEnabled = await isAIReviewEnabled(schoolId)

        // Handle bulk insert
        if (Array.isArray(body)) {
            const questions = body.map((q: any, idx: number) => ({
                quiz_id: id,
                question_text: q.question_text,
                question_type: q.question_type,
                options: q.options || null,
                correct_answer: q.correct_answer || null,
                difficulty: q.difficulty || 'MEDIUM',
                points: q.points || 10,
                order_index: q.order_index ?? idx,
                image_url: q.image_url || null,
                passage_text: q.passage_text || null,
                passage_audio_url: q.passage_audio_url || null,
                teacher_hots_claim: q.teacher_hots_claim || false,
                text_direction: q.text_direction || 'ltr',
                // Set initial status: approved from bank, 'draft' for AI review, 'approved' if AI off
                status: q.bank_status === 'approved' ? 'approved' : (aiEnabled ? 'draft' : 'approved')
            }))

            const { data, error } = await supabase
                .from('quiz_questions')
                .insert(questions)
                .select()

            if (error) throw error

            // Trigger HOTS analysis only for questions NOT already approved from bank soal
            console.log(`[HOTS-DEBUG] Inserted ${data?.length} questions. Body bank_status values:`, body.map((q: any) => q.bank_status))
            if (data && data.length > 0 && aiEnabled) {
                // Track which indices came from bank soal (already analyzed)
                const bankIndices = new Set(body.map((q: any, i: number) => q.bank_status === 'approved' ? i : -1).filter((i: number) => i >= 0))
                const questionsNeedingAnalysis = data.filter((_: any, i: number) => !bankIndices.has(i))
                console.log(`[HOTS-DEBUG] bankIndices: ${JSON.stringify([...bankIndices])}, needsAnalysis: ${questionsNeedingAnalysis.length}`)
                if (questionsNeedingAnalysis.length > 0) {
                    const { data: quiz } = await supabase
                        .from('quizzes')
                        .select('teaching_assignment:teaching_assignments(subject:subjects(name), class:classes(school_level))')
                        .eq('id', id).single()
                    const ta = quiz?.teaching_assignment as any
                    const subjectName = ta?.subject?.name || ''
                    const gradeBand = ta?.class?.school_level || 'SMP'
                    const hotsInputs: TriggerHOTSInput[] = questionsNeedingAnalysis.map((q: any) => ({
                        questionId: q.id,
                        questionSource: 'quiz' as const,
                        questionText: q.question_text,
                        questionType: q.question_type,
                        options: q.options,
                        correctAnswer: q.correct_answer,
                        teacherDifficulty: q.difficulty,
                        teacherHotsClaim: q.teacher_hots_claim || false,
                        subjectName,
                        gradeBand,
                        quizId: id
                    }))
                    console.log(`[HOTS] Triggering analysis for ${hotsInputs.length} quiz questions`)
                    triggerBulkHOTSAnalysis(hotsInputs)
                }
            }

            return NextResponse.json(data)
        }

        // Single insert
        const { question_text, question_type, options, correct_answer, difficulty, points, order_index, image_url, passage_text, passage_audio_url, teacher_hots_claim } = body

        const { data, error } = await supabase
            .from('quiz_questions')
            .insert({
                quiz_id: id,
                question_text,
                question_type,
                options: options || null,
                correct_answer: correct_answer || null,
                difficulty: difficulty || 'MEDIUM',
                points: points || 10,
                order_index: order_index || 0,
                image_url: image_url || null,
                passage_text: passage_text || null,
                passage_audio_url: passage_audio_url || null,
                teacher_hots_claim: teacher_hots_claim || false,
                text_direction: body.text_direction || 'ltr',
                // Set initial status based on AI review setting
                status: aiEnabled ? 'draft' : 'approved'
            })
            .select()
            .single()

        if (error) throw error

        // Trigger HOTS analysis for single question (fire-and-forget)
        if (data && aiEnabled) {
            const { data: quiz } = await supabase
                .from('quizzes')
                .select('teaching_assignment:teaching_assignments(subject:subjects(name), class:classes(school_level))')
                .eq('id', id).single()
            const ta = quiz?.teaching_assignment as any
            triggerHOTSAnalysis({
                questionId: data.id,
                questionSource: 'quiz',
                questionText: data.question_text,
                questionType: data.question_type,
                options: data.options,
                correctAnswer: data.correct_answer,
                teacherDifficulty: data.difficulty,
                teacherHotsClaim: data.teacher_hots_claim || false,
                subjectName: ta?.subject?.name || '',
                gradeBand: ta?.class?.school_level || 'SMP',
                quizId: id
            }).catch(err => console.error('HOTS trigger error:', err))
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error adding question:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update question
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { question_id, question_text, question_type, options, correct_answer, difficulty, points, image_url, passage_audio_url, teacher_hots_claim, text_direction } = body

        if (!question_id) {
            return NextResponse.json({ error: 'question_id required' }, { status: 400 })
        }

        const updateData: any = {}
        if (question_text !== undefined) updateData.question_text = question_text
        if (question_type !== undefined) updateData.question_type = question_type
        if (options !== undefined) updateData.options = options
        if (correct_answer !== undefined) updateData.correct_answer = correct_answer
        if (difficulty !== undefined) updateData.difficulty = difficulty
        if (points !== undefined) updateData.points = points
        if (image_url !== undefined) updateData.image_url = image_url
        if (passage_audio_url !== undefined) updateData.passage_audio_url = passage_audio_url
        if (teacher_hots_claim !== undefined) updateData.teacher_hots_claim = teacher_hots_claim
        if (text_direction !== undefined) updateData.text_direction = text_direction

        // Reset status & re-trigger HOTS (same logic as bank soal PUT)
        const aiEnabled = await isAIReviewEnabled(schoolId)
        if (aiEnabled) {
            updateData.status = 'ai_reviewing'
        } else {
            updateData.status = 'approved'
        }

        const { data, error } = await supabase
            .from('quiz_questions')
            .update(updateData)
            .eq('id', question_id)
            .eq('quiz_id', id)
            .select()
            .single()

        if (error) throw error

        // Re-trigger HOTS analysis (fire-and-forget)
        if (data && aiEnabled) {
            const { data: quiz } = await supabase.from('quizzes')
                .select('teaching_assignment:teaching_assignments(subject:subjects(name), class:classes(school_level))')
                .eq('id', id).single()
            const ta = quiz?.teaching_assignment as any
            triggerHOTSAnalysis({
                questionId: data.id, questionSource: 'quiz',
                questionText: data.question_text, questionType: data.question_type,
                options: data.options, correctAnswer: data.correct_answer,
                teacherDifficulty: data.difficulty, teacherHotsClaim: data.teacher_hots_claim || false,
                subjectName: ta?.subject?.name || '', gradeBand: ta?.class?.school_level || 'SMP',
                quizId: id
            }).catch(err => console.error('HOTS re-analysis error:', err))
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating quiz question:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE question(s)
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const questionId = request.nextUrl.searchParams.get('question_id')

        if (questionId) {
            // Delete single question
            const { error } = await supabase
                .from('quiz_questions')
                .delete()
                .eq('id', questionId)
                .eq('quiz_id', id)

            if (error) throw error
        } else {
            // Delete all questions for this quiz
            const { error } = await supabase
                .from('quiz_questions')
                .delete()
                .eq('quiz_id', id)

            if (error) throw error
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting questions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
