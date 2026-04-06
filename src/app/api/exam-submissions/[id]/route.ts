import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET single exam submission with questions and answers
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const params = await context.params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const id = params.id

        const { data, error } = await supabase
            .from('exam_submissions')
            .select(`
                *,
                exam:exams(
                    id,
                    title,
                    show_results_immediately,
                    results_released,
                    questions:exam_questions(*)
                ),
                student:students(
                    id,
                    nis,
                    user:users!students_user_id_fkey(full_name)
                )
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        // Check visibility for SISWA
        const examObj = (data as any)?.exam || {}
        const showImmediately = examObj.show_results_immediately ?? true
        const isReleased = examObj.results_released || false
        const isHidden = user.role === 'SISWA' && !showImmediately && !isReleased

        // Fetch answers from exam_answers table
        const { data: examAnswers, error: answersError } = await supabase
            .from('exam_answers')
            .select('*')
            .eq('submission_id', id)

        if (answersError) throw answersError

        // Map exam_answers to the format the frontend expects
        const answers = (examAnswers || []).map(a => ({
            question_id: a.question_id,
            answer: a.answer,
            is_correct: isHidden ? undefined : a.is_correct,
            score: isHidden ? undefined : a.points_earned,
            feedback: isHidden ? '' : (a.feedback || '')
        }))

        const responseData = {
            ...data,
            answers,
            results_hidden: isHidden
        }

        if (isHidden) {
            responseData.total_score = null
            responseData.max_score = null
        }

        return NextResponse.json(responseData)
    } catch (error) {
        console.error('Error fetching exam submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update exam submission (Teacher Grading)
export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const params = await context.params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const id = params.id
        const { answers, total_score, is_graded } = await request.json()

        // BATCH UPDATE: Update all exam_answers scores at once instead of one-by-one
        if (answers && Array.isArray(answers) && answers.length > 0) {
            const updates = answers.map((ans: any) => ({
                submission_id: id,
                question_id: ans.question_id,
                points_earned: ans.score ?? ans.points_earned ?? 0,
                // Preserve existing fields by including them
                answer: ans.answer,
                is_correct: ans.is_correct,
                feedback: ans.feedback || null
            }))

            await supabase
                .from('exam_answers')
                .upsert(updates, { onConflict: 'submission_id,question_id' })
        }

        // Update the submission record with total_score and is_graded
        const { data, error } = await supabase
            .from('exam_submissions')
            .update({
                total_score,
                is_graded
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating exam submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

