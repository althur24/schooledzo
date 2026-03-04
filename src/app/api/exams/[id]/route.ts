import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET single exam
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
            .from('exams')
            .select(`
                *,
                teaching_assignment:teaching_assignments(
                    id,
                    teacher:teachers(id, user:users(full_name)),
                    subject:subjects(id, name),
                    class:classes(id, name, school_level, grade_level)
                )
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update exam
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
        const { title, description, start_time, duration_minutes, is_randomized, is_active, max_violations } = body

        let finalIsActive = is_active
        let isPendingPublish = false
        let isUnderReview = false

        // If trying to publish, check question statuses first
        if (is_active === true) {
            const { data: questions } = await supabase
                .from('exam_questions')
                .select('status')
                .eq('exam_id', id)

            if (questions && questions.length > 0) {
                const allApproved = questions.every(q => q.status === 'approved')
                if (!allApproved) {
                    finalIsActive = false // Don't publish yet
                    isPendingPublish = true
                    isUnderReview = true
                }
            }
        }

        const updateData: any = { updated_at: new Date().toISOString() }

        if (title !== undefined) updateData.title = title
        if (description !== undefined) updateData.description = description
        if (start_time !== undefined) updateData.start_time = start_time
        if (duration_minutes !== undefined) updateData.duration_minutes = duration_minutes
        if (is_randomized !== undefined) updateData.is_randomized = is_randomized
        if (finalIsActive !== undefined) updateData.is_active = finalIsActive

        // Update pending_publish status if we tried to publish
        if (is_active !== undefined) {
            updateData.pending_publish = isPendingPublish
        }

        if (max_violations !== undefined) updateData.max_violations = max_violations

        const { data, error } = await supabase
            .from('exams')
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

        if (error) throw error

        // If exam was just activated (NOT under review), send notifications
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
                        const startDate = new Date(data.start_time).toLocaleString('id-ID')
                        await supabase.from('notifications').insert(
                            enrollments.map((e: any) => ({
                                user_id: e.student.user_id,
                                type: 'ULANGAN_BARU',
                                title: `Ulangan Baru: ${data.title}`,
                                message: `${subjectName} - Mulai: ${startDate}`,
                                link: '/dashboard/siswa/ulangan'
                            }))
                        )
                    }
                }
            } catch (notifError) {
                console.error('Error sending exam notifications:', notifError)
            }
        }
        if (isUnderReview) {
            return NextResponse.json({ ...data, _status: 'under_review' })
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE exam
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
            .from('exams')
            .delete()
            .eq('id', id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
