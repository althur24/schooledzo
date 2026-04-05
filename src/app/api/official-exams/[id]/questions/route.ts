import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { triggerBulkHOTSAnalysis, isAIReviewEnabled, type TriggerHOTSInput } from '@/lib/triggerHOTS'

// GET questions for an official exam
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        const { data, error } = await supabase
            .from('official_exam_questions')
            .select('*')
            .eq('exam_id', id)
            .order('order_index', { ascending: true })

        if (error) throw error

        let questions = data || []

        // Strip correct_answer for students unless exam is already submitted
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()

            let hasSubmitted = false
            if (student) {
                const { data: submission } = await supabase
                    .from('official_exam_submissions')
                    .select('is_submitted')
                    .eq('exam_id', id)
                    .eq('student_id', student.id)
                    .single()
                hasSubmitted = !!submission?.is_submitted
            }

            if (!hasSubmitted) {
                questions = questions.map(({ correct_answer, ...rest }: any) => rest)
            }
        }

        return NextResponse.json(questions)
    } catch (error) {
        console.error('Error fetching official exam questions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST add questions (single or batch)
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const questions = Array.isArray(body) ? body : (Array.isArray(body.questions) ? body.questions : [body])

        // Get current max order_index
        const { data: existing } = await supabase
            .from('official_exam_questions')
            .select('order_index')
            .eq('exam_id', id)
            .order('order_index', { ascending: false })
            .limit(1)

        let nextIndex = (existing?.[0]?.order_index ?? -1) + 1

        const questionsToInsert = questions.map((q: any, i: number) => ({
            exam_id: id,
            question_text: q.question_text,
            question_type: q.question_type || 'MULTIPLE_CHOICE',
            options: q.options || null,
            correct_answer: q.correct_answer || null,
            points: q.points || 10,
            order_index: q.order_index ?? (nextIndex + i),
            difficulty: q.difficulty || null,
            passage_text: q.passage_text || null,
            passage_audio_url: q.passage_audio_url || null,
            image_url: q.image_url || null,
            teacher_hots_claim: q.teacher_hots_claim || false,
            text_direction: q.text_direction || 'ltr',
            // If question came from bank soal and is already approved, inherit that status
            ...(q.bank_status === 'approved' ? { status: 'approved' } : {})
        }))

        const { data, error } = await supabase
            .from('official_exam_questions')
            .insert(questionsToInsert)
            .select()

        if (error) throw error

        // Trigger HOTS analysis for questions NOT already approved from bank soal
        if (data && data.length > 0) {
            const bankIndices = new Set(questions.map((q: any, i: number) => q.bank_status === 'approved' ? i : -1).filter((i: number) => i >= 0))
            const questionsNeedingAnalysis = data.filter((_: any, i: number) => !bankIndices.has(i))

            if (questionsNeedingAnalysis.length > 0) {
                const aiEnabled = await isAIReviewEnabled(schoolId)
                if (aiEnabled) {
                    // Get exam subject/level info for HOTS context
                    const { data: exam } = await supabase
                        .from('official_exams')
                        .select('subject:subjects(name), target_levels')
                        .eq('id', id).single()
                    const subjectName = (exam?.subject as any)?.name || ''
                    const gradeBand = (exam as any)?.target_levels?.[0] || 'SMP'

                    const hotsInputs: TriggerHOTSInput[] = questionsNeedingAnalysis.map((q: any) => ({
                        questionId: q.id,
                        questionSource: 'official_exam' as const,
                        questionText: q.question_text,
                        questionType: q.question_type,
                        options: q.options,
                        correctAnswer: q.correct_answer,
                        teacherDifficulty: q.difficulty,
                        teacherHotsClaim: q.teacher_hots_claim || false,
                        subjectName,
                        gradeBand,
                        officialExamId: id
                    }))
                    console.log(`[HOTS] Triggering analysis for ${hotsInputs.length} official exam questions`)
                    triggerBulkHOTSAnalysis(hotsInputs)
                } else {
                    // AI Review OFF — direct approve
                    const ids = questionsNeedingAnalysis.map((q: any) => q.id)
                    await supabase.from('official_exam_questions').update({ status: 'approved' }).in('id', ids)
                }
            }
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error adding official exam questions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update a single question
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        await params // exam id — not needed for question update, but required by route
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { question_id, ...updates } = body

        if (!question_id) {
            return NextResponse.json({ error: 'question_id required' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('official_exam_questions')
            .update(updates)
            .eq('id', question_id)
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating official exam question:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE a question
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { question_id } = await request.json()

        if (!question_id) {
            return NextResponse.json({ error: 'question_id required' }, { status: 400 })
        }

        const { error } = await supabase
            .from('official_exam_questions')
            .delete()
            .eq('id', question_id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting official exam question:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
