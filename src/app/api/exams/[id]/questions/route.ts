import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { triggerHOTSAnalysis, triggerBulkHOTSAnalysis, isAIReviewEnabled, type TriggerHOTSInput } from '@/lib/triggerHOTS'

// GET questions for exam
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
            .from('exam_questions')
            .select('*')
            .eq('exam_id', id)
            .order('order_index', { ascending: true })

        if (error) throw error

        let questions = data || []

        // Enrich returned questions with admin review data
        if (user.role === 'GURU') {
            const returnedIds = questions.filter((q: any) => q.status === 'returned').map((q: any) => q.id)
            if (returnedIds.length > 0) {
                const { data: adminReviews } = await supabase
                    .from('admin_reviews').select('*')
                    .eq('question_source', 'exam').in('question_id', returnedIds)
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

        // C2 Security Fix: Strip correct_answer for students unless exam is already submitted
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()

            let hasSubmitted = false
            if (student) {
                const { data: submission } = await supabase
                    .from('exam_submissions')
                    .select('is_submitted')
                    .eq('exam_id', id)
                    .eq('student_id', student.id)
                    .single()
                hasSubmitted = !!submission?.is_submitted
            }

            if (!hasSubmitted) {
                questions = questions.map(({ correct_answer, ...rest }) => rest)
            }
        }

        return NextResponse.json(questions)
    } catch (error) {
        console.error('Error fetching exam questions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST add questions to exam
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
        const { questions } = body

        if (!questions || !Array.isArray(questions)) {
            return NextResponse.json({ error: 'Questions array required' }, { status: 400 })
        }

        // Check AI review status ONCE before any insert
        const aiEnabled = await isAIReviewEnabled(schoolId)

        // Get current max order
        const { data: existing } = await supabase
            .from('exam_questions')
            .select('order_index')
            .eq('exam_id', id)
            .order('order_index', { ascending: false })
            .limit(1)

        let startOrder = (existing?.[0]?.order_index ?? -1) + 1

        const questionsToInsert = questions.map((q: any, idx: number) => ({
            exam_id: id,
            question_text: q.question_text,
            question_type: q.question_type || 'MULTIPLE_CHOICE',
            options: q.options,
            correct_answer: q.correct_answer,
            difficulty: q.difficulty || 'MEDIUM',
            points: q.points || 1,
            order_index: startOrder + idx,
            image_url: q.image_url || null,
            passage_text: q.passage_text || null,
            passage_audio_url: q.passage_audio_url || null,
            teacher_hots_claim: q.teacher_hots_claim || false,
            text_direction: q.text_direction || 'ltr',
            // Set initial status: approved from bank, 'draft' for AI review, 'approved' if AI off
            status: q.bank_status === 'approved' ? 'approved' : (aiEnabled ? 'draft' : 'approved')
        }))

        const { data, error } = await supabase
            .from('exam_questions')
            .insert(questionsToInsert)
            .select()

        if (error) throw error

        // Trigger HOTS analysis only for questions NOT already approved from bank soal
        if (data && data.length > 0 && aiEnabled) {
            // Track which indices came from bank soal (already analyzed)
            const bankIndices = new Set(questions.map((q: any, i: number) => q.bank_status === 'approved' ? i : -1).filter((i: number) => i >= 0))
            const questionsNeedingAnalysis = data.filter((_: any, i: number) => !bankIndices.has(i))
            if (questionsNeedingAnalysis.length > 0) {
                const { data: exam } = await supabase
                    .from('exams')
                    .select('teaching_assignment:teaching_assignments(subject:subjects(name), class:classes(school_level))')
                    .eq('id', id).single()
                const ta = exam?.teaching_assignment as any
                const subjectName = ta?.subject?.name || ''
                const gradeBand = ta?.class?.school_level || 'SMP'
                const hotsInputs: TriggerHOTSInput[] = questionsNeedingAnalysis.map((q: any) => ({
                    questionId: q.id,
                    questionSource: 'exam' as const,
                    questionText: q.question_text,
                    questionType: q.question_type,
                    options: q.options,
                    correctAnswer: q.correct_answer,
                    teacherDifficulty: q.difficulty,
                    teacherHotsClaim: q.teacher_hots_claim || false,
                    subjectName,
                    gradeBand,
                    examId: id
                }))
                console.log(`[HOTS] Triggering analysis for ${hotsInputs.length} exam questions`)
                triggerBulkHOTSAnalysis(hotsInputs)
            }
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error adding exam questions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update questions
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
        const { question_id, question_text, question_type, options, correct_answer, difficulty, points, image_url, passage_text, passage_audio_url, teacher_hots_claim, text_direction } = body

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
        if (passage_text !== undefined) updateData.passage_text = passage_text
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
            .from('exam_questions')
            .update(updateData)
            .eq('id', question_id)
            .eq('exam_id', id)
            .select()
            .single()

        if (error) throw error

        // Re-trigger HOTS analysis (fire-and-forget)
        if (data && aiEnabled) {
            const { data: exam } = await supabase.from('exams')
                .select('teaching_assignment:teaching_assignments(subject:subjects(name), class:classes(school_level))')
                .eq('id', id).single()
            const ta = exam?.teaching_assignment as any
            triggerHOTSAnalysis({
                questionId: data.id, questionSource: 'exam',
                questionText: data.question_text, questionType: data.question_type,
                options: data.options, correctAnswer: data.correct_answer,
                teacherDifficulty: data.difficulty, teacherHotsClaim: data.teacher_hots_claim || false,
                subjectName: ta?.subject?.name || '', gradeBand: ta?.class?.school_level || 'SMP',
                examId: id
            }).catch(err => console.error('HOTS re-analysis error:', err))
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating exam question:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE question
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
                .from('exam_questions')
                .delete()
                .eq('id', questionId)
                .eq('exam_id', id)

            if (error) throw error
        } else {
            // Delete all questions for this exam
            const { error } = await supabase
                .from('exam_questions')
                .delete()
                .eq('exam_id', id)

            if (error) throw error
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting exam question:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
