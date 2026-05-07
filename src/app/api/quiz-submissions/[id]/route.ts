import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET single submission
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
            .from('quiz_submissions')
            .select(`
                *,
                quiz:quizzes(
                    id,
                    title,
                    questions:quiz_questions(*)
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

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching quiz submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update submission (Teacher Grading)
export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const params = await context.params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const id = params.id
        const { answers, total_score, is_graded } = await request.json()

        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()
            
            // Get submission -> quiz -> teaching_assignment
            const { data: sub } = await supabase
                .from('quiz_submissions')
                .select('max_score, quiz:quizzes(teaching_assignment:teaching_assignments(teacher_id))')
                .eq('id', id)
                .single()
            
            if (!teacher || (sub?.quiz as any)?.teaching_assignment?.teacher_id !== teacher.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }

            if (total_score > (sub?.max_score || 0)) {
                return NextResponse.json({ error: 'Total score exceeds max score' }, { status: 400 })
            }
        } else if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        } else {
            // Role Admin, only check max score
            const { data: sub } = await supabase
                .from('quiz_submissions')
                .select('max_score')
                .eq('id', id)
                .single()

            if (total_score > (sub?.max_score || 0)) {
                return NextResponse.json({ error: 'Total score exceeds max score' }, { status: 400 })
            }
        }

        const { data, error } = await supabase
            .from('quiz_submissions')
            .update({
                answers,
                total_score,
                is_graded
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating quiz submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
