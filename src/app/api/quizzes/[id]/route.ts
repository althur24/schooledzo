import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { syncQuizBatch } from '@/lib/examBatch'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

import { isAIReviewEnabled } from '@/lib/triggerHOTS'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'

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
                    academic_year_id,
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

        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()
            
            const { data: quiz } = await supabase
                .from('quizzes')
                .select('teaching_assignment:teaching_assignments(teacher_id)')
                .eq('id', id)
                .single()
            
            if (!teacher || (quiz?.teaching_assignment as any)?.teacher_id !== teacher.id) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke kuis ini' }, { status: 403 })
            }
        } else if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: quizForYear } = await supabase
            .from('quizzes')
            .select('teaching_assignment_id')
            .eq('id', id)
            .single()
        if (quizForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(quizForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        const body = await request.json()
        const { title, description, duration_minutes, is_randomized, is_active, deadline } = body


        let finalIsActive = is_active
        let finalPendingPublish = false

        // If trying to publish, check question statuses first
        if (is_active === true) {
            const aiEnabled = await isAIReviewEnabled(schoolId)

            const { data: questions } = await supabase
                .from('quiz_questions')
                .select('id, status')
                .eq('quiz_id', id)

            if (!questions || questions.length === 0) {
                return NextResponse.json({ error: 'Tidak bisa mempublikasikan kuis tanpa soal. Tambahkan minimal 1 soal terlebih dahulu.' }, { status: 400 })
            }
            if (questions.length > 0) {
                if (!aiEnabled) {
                    // AI Review OFF — auto-approve any non-approved questions
                    const nonApproved = questions.filter(q => q.status !== 'approved')
                    if (nonApproved.length > 0) {
                        await supabase.from('quiz_questions')
                            .update({ status: 'approved' })
                            .in('id', nonApproved.map(q => q.id))
                    }
                } else {
                    // AI Review ON — block publish while questions are still processing or returned.
                    // (The previous "auto-recover stuck after 3 min" used updated_at, which doesn't
                    //  exist on quiz_questions and isn't written by any status update, so it never
                    //  worked. Admin can move a truly-stuck question to admin_review manually.)
                    // Check statuses
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

        // Construct update object dynamically to avoid overwriting with null/undefined
        const updateData: any = {
            updated_at: new Date().toISOString()
        }

        if (title !== undefined) updateData.title = title
        if (description !== undefined) updateData.description = description
        if (duration_minutes !== undefined) updateData.duration_minutes = duration_minutes
        if (is_randomized !== undefined) updateData.is_randomized = is_randomized
        if (is_active !== undefined) updateData.is_active = finalIsActive
        if (deadline !== undefined) updateData.deadline = deadline || null

        // Set pending_publish correctly when explicitly publishing
        if (is_active !== undefined) {
            updateData.pending_publish = finalPendingPublish
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

        // If quiz was just published (truly active), send notifications to students
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
                    // Check if this is a remedial quiz with specific allowed students
                    if (data.is_remedial && data.allowed_student_ids && data.allowed_student_ids.length > 0) {
                        // Send targeted notifications to remedial students only
                        const { data: students } = await supabase
                            .from('students')
                            .select('user_id')
                            .in('id', data.allowed_student_ids)

                        if (students && students.length > 0) {
                            const subjectName = data.teaching_assignment.subject?.name || ''
                            await supabase.from('notifications').insert(
                                students.map((s: any) => ({
                                    user_id: s.user_id,
                                    type: 'REMEDIAL',
                                    title: `Remedial Kuis: ${data.title}`,
                                    message: `${subjectName} - ${data.duration_minutes || 0} menit. Segera kerjakan!`,
                                    link: '/dashboard/siswa/kuis'
                                }))
                            )
                        }
                    } else {
                        // Regular quiz: notify all students in the class
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
                }
            } catch (notifError) {
                console.error('Error sending quiz notifications:', notifError)
            }
        }
        // Sinkronkan kelas satu batch (multi-kelas) bila kuis baru saja diaktifkan
        let batchSync: { total: number, failed: string[] } | null = null
        if (finalIsActive === true && data?.batch_id) {
            try {
                batchSync = await syncQuizBatch(id)
            } catch (batchError) {
                console.error('Batch sync error (quiz):', batchError)
                batchSync = { total: -1, failed: [] }
            }
        }

        return NextResponse.json({ ...data, batch_sync: batchSync })
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

        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()
            
            const { data: quiz } = await supabase
                .from('quizzes')
                .select('teaching_assignment:teaching_assignments(teacher_id)')
                .eq('id', id)
                .single()
            
            if (!teacher || (quiz?.teaching_assignment as any)?.teacher_id !== teacher.id) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke kuis ini' }, { status: 403 })
            }
        } else if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: quizForYear } = await supabase
            .from('quizzes')
            .select('teaching_assignment_id')
            .eq('id', id)
            .single()
        if (quizForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(quizForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
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
