import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET single quiz with questions
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
            .from('quizzes')
            .select(`
                *,
                teaching_assignment:teaching_assignments(
                    id,
                    subject:subjects(id, name),
                    class:classes(id, name, school_level, grade_level)
                ),
                questions:quiz_questions(*)
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        // Sort questions by order_index
        if (data.questions) {
            data.questions.sort((a: any, b: any) => a.order_index - b.order_index)
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching quiz:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update quiz
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
        const { title, description, duration_minutes, is_randomized, is_active, deadline } = body

        let finalIsActive = is_active
        let isPendingPublish = false
        let isUnderReview = false

        // If trying to publish, check question statuses first
        if (is_active === true) {
            const { data: questions } = await supabase
                .from('quiz_questions')
                .select('status')
                .eq('quiz_id', id)

            if (questions && questions.length > 0) {
                const allApproved = questions.every(q => q.status === 'approved')
                if (!allApproved) {
                    finalIsActive = false // Don't publish yet
                    isPendingPublish = true
                    isUnderReview = true
                }
            }
        }

        // Construct update object dynamically to avoid overwriting with null/undefined
        const updateData: any = {
            updated_at: new Date().toISOString()
        }

        if (title !== undefined) updateData.title = title
        if (description !== undefined) updateData.description = description
        if (duration_minutes !== undefined) updateData.duration_minutes = duration_minutes
        if (is_randomized !== undefined) updateData.is_randomized = is_randomized
        if (finalIsActive !== undefined) updateData.is_active = finalIsActive
        if (deadline !== undefined) updateData.deadline = deadline || null

        // Update pending_publish status if we tried to publish
        if (is_active !== undefined) {
            updateData.pending_publish = isPendingPublish
        }

        const { data, error } = await supabase
            .from('quizzes')
            .update(updateData)
            .eq('id', id)
            .select(`
                *,
                teaching_assignment:teaching_assignments(
                    class_id,
                    subject:subjects(name)
                )
            `)
            .single()

        if (error) {
            console.error('Database update error:', error)
            throw error
        }

        // If quiz was just published (NOT under review), send notifications to students
        if (is_active === true && !isUnderReview && data?.teaching_assignment?.class_id) {
            try {
                // Get the active academic year
                const { data: activeYear } = await supabase
                    .from('academic_years')
                    .select('id')
                    .eq('is_active', true)
                    .eq('school_id', schoolId)
                    .single()

                if (activeYear) {
                    const { data: enrollments } = await supabase
                        .from('student_enrollments')
                        .select('student:students(user_id)')
                        .eq('academic_year_id', activeYear.id)
                        .eq('class_id', data.teaching_assignment.class_id)

                    if (enrollments && enrollments.length > 0) {
                        const subjectName = data.teaching_assignment.subject?.name || ''
                        await supabase.from('notifications').insert(
                            enrollments.map((e: any) => ({
                                user_id: e.student.user_id,
                                type: 'KUIS_BARU',
                                title: `Kuis Baru: ${data.title}`,
                                message: `${subjectName} - ${data.duration_minutes || 0} menit`,
                                link: '/dashboard/siswa/kuis'
                            }))
                        )
                    }
                }
            } catch (notifError) {
                console.error('Error sending quiz notifications:', notifError)
            }
        }
        if (isUnderReview) {
            return NextResponse.json({ ...data, _status: 'under_review' })
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating quiz:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE quiz
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

        const { error } = await supabase
            .from('quizzes')
            .delete()
            .eq('id', id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting quiz:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
