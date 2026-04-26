import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { isAIReviewEnabled } from '@/lib/triggerHOTS'

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
        const { title, description, start_time, duration_minutes, is_randomized, is_active, max_violations, show_results_immediately, results_released } = body


        let finalIsActive = is_active
        let finalPendingPublish = false

        // If trying to publish, check question statuses first
        if (is_active === true) {
            const aiEnabled = await isAIReviewEnabled(schoolId)

            const { data: questions } = await supabase
                .from('exam_questions')
                .select('id, status, updated_at')
                .eq('exam_id', id)

            if (questions && questions.length > 0) {
                if (!aiEnabled) {
                    // AI Review OFF — auto-approve any non-approved questions
                    const nonApproved = questions.filter(q => q.status !== 'approved')
                    if (nonApproved.length > 0) {
                        await supabase.from('exam_questions')
                            .update({ status: 'approved' })
                            .in('id', nonApproved.map(q => q.id))
                    }
                } else {
                    // AI Review ON — auto-recover stuck questions (> 3 minutes in ai_reviewing/draft)
                    const THREE_MINUTES = 3 * 60 * 1000
                    const now = Date.now()
                    const stuckQuestions = questions.filter(q => {
                        if (q.status !== 'ai_reviewing' && q.status !== 'draft') return false
                        const updatedAt = q.updated_at ? new Date(q.updated_at).getTime() : 0
                        return (now - updatedAt) > THREE_MINUTES
                    })

                    if (stuckQuestions.length > 0) {
                        console.log(`[exam-publish] Auto-recovering ${stuckQuestions.length} stuck questions to admin_review`)
                        await supabase.from('exam_questions')
                            .update({ status: 'admin_review', updated_at: new Date().toISOString() })
                            .in('id', stuckQuestions.map(q => q.id))
                        
                        // Re-fetch after fix
                        const { data: refreshed } = await supabase
                            .from('exam_questions')
                            .select('id, status, updated_at')
                            .eq('exam_id', id)
                        if (refreshed) {
                            questions.length = 0
                            questions.push(...refreshed)
                        }
                    }

                    // Check statuses after potential auto-recovery
                    const statuses = {
                        draft: questions.filter(q => q.status === 'draft').length,
                        ai_reviewing: questions.filter(q => q.status === 'ai_reviewing').length,
                        admin_review: questions.filter(q => q.status === 'admin_review').length,
                        returned: questions.filter(q => q.status === 'returned').length,
                        approved: questions.filter(q => q.status === 'approved').length,
                    }
                    
                    const stillProcessing = statuses.draft + statuses.ai_reviewing
                    const returned = statuses.returned
                    const needsReview = statuses.admin_review
                    
                    if (stillProcessing > 0 || returned > 0) {
                        const parts: string[] = []
                        if (stillProcessing > 0)
                            parts.push(`${stillProcessing} soal masih diproses AI`)
                        if (returned > 0)
                            parts.push(`${returned} soal dikembalikan admin`)
                        
                        return NextResponse.json({
                            error: `Gagal mempublikasikan: ${parts.join(', ')}. Perbaiki atau tunggu proses AI selesai sebelum mempublikasikan.`,
                            _status: 'blocked',
                            statusBreakdown: statuses
                        }, { status: 400 })
                    }
                    
                    if (needsReview > 0) {
                        // Publish requested, but needs admin review.
                        finalIsActive = false
                        finalPendingPublish = true
                    }
                }
            }
        }

        const updateData: any = { updated_at: new Date().toISOString() }

        if (title !== undefined) updateData.title = title
        if (description !== undefined) updateData.description = description
        if (start_time !== undefined) updateData.start_time = start_time
        if (duration_minutes !== undefined) updateData.duration_minutes = duration_minutes
        if (is_randomized !== undefined) updateData.is_randomized = is_randomized
        if (is_active !== undefined) updateData.is_active = finalIsActive
        if (show_results_immediately !== undefined) updateData.show_results_immediately = show_results_immediately
        if (results_released !== undefined) updateData.results_released = results_released

        // Set pending_publish correctly when explicitly publishing
        if (is_active !== undefined) {
            updateData.pending_publish = finalPendingPublish
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

        // If exam was just activated (truly active), send notifications
        if (finalIsActive === true && data?.teaching_assignment?.class_id) {
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
