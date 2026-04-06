import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET submission detail with answers
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx

        const { data: submission, error } = await supabase
            .from('official_exam_submissions')
            .select(`
                *,
                student:students(id, nis, user:users!students_user_id_fkey(full_name)),
                exam:official_exams(id, title, exam_type, duration_minutes, show_results_immediately, results_released, subject:subjects(name))
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        // Check visibility for SISWA
        const examObj = (submission as any)?.exam || {}
        const showImmediately = examObj.show_results_immediately ?? true
        const isReleased = examObj.results_released || false
        const isHidden = ctx.user.role === 'SISWA' && !showImmediately && !isReleased

        // Fetch answers
        const { data: answers } = await supabase
            .from('official_exam_answers')
            .select(`
                *,
                question:official_exam_questions(id, question_text, question_type, options, correct_answer, points)
            `)
            .eq('submission_id', id)

        const processedAnswers = isHidden
            ? (answers || []).map((a: any) => ({
                ...a,
                is_correct: undefined,
                points_earned: undefined,
                question: a.question ? { ...a.question, correct_answer: undefined } : a.question
            }))
            : (answers || [])

        const responseData: any = { ...submission, answers: processedAnswers, results_hidden: isHidden }
        if (isHidden) {
            responseData.total_score = null
            responseData.max_score = null
        }

        return NextResponse.json(responseData)
    } catch (error) {
        console.error('Error fetching official exam submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT grade essay answers (Admin or Guru)
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'ADMIN' && user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { grades } = body // Array of { answer_id, points_earned }

        if (!grades || !Array.isArray(grades)) {
            return NextResponse.json({ error: 'grades array required' }, { status: 400 })
        }

        // Update each answer's score
        for (const grade of grades) {
            await supabase
                .from('official_exam_answers')
                .update({ points_earned: grade.points_earned })
                .eq('id', grade.answer_id)
                .eq('submission_id', id)
        }

        // Recalculate total score
        const { data: allAnswers } = await supabase
            .from('official_exam_answers')
            .select('points_earned')
            .eq('submission_id', id)

        const totalScore = allAnswers?.reduce((sum: number, a: any) => sum + (a.points_earned || 0), 0) || 0

        // Update submission with new total and mark as graded
        const { data: updatedSubmission, error } = await supabase
            .from('official_exam_submissions')
            .update({
                total_score: totalScore,
                is_graded: true
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(updatedSubmission)
    } catch (error) {
        console.error('Error grading official exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
