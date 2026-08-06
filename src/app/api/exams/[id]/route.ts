import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { isAIReviewEnabled } from '@/lib/triggerHOTS'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'
import { syncExamBatch } from '@/lib/examBatch'

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
                    subject:subjects(id, name, kkm),
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

        // Block writes to archived (COMPLETED) academic years
        const { data: examForYear } = await supabase
            .from('exams')
            .select('teaching_assignment_id, results_released')
            .eq('id', id)
            .single()
        if (examForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(examForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
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
                .select('id, status')
                .eq('exam_id', id)

            if (!questions || questions.length === 0) {
                return NextResponse.json({ error: 'Tidak bisa mempublikasikan ulangan tanpa soal. Tambahkan minimal 1 soal terlebih dahulu.' }, { status: 400 })
            }
            if (questions.length > 0) {
                if (!aiEnabled) {
                    // AI Review OFF — auto-approve any non-approved questions
                    const nonApproved = questions.filter(q => q.status !== 'approved')
                    if (nonApproved.length > 0) {
                        await supabase.from('exam_questions')
                            .update({ status: 'approved' })
                            .in('id', nonApproved.map(q => q.id))
                    }
                } else {
                    // AI Review ON — block publish while questions are still processing or returned.
                    // (The previous "auto-recover stuck after 3 min" used updated_at, which doesn't
                    //  exist on exam_questions and isn't written by any status update, so it never
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
                        const startDate = new Date(data.start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
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

        // Notify students when results are released ("Bagikan Hasil" — only on the false→true transition)
        if (results_released === true && !examForYear?.results_released && data?.teaching_assignment?.class_id) {
            try {
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
                                type: 'NILAI_KELUAR',
                                title: `Nilai Keluar: ${data.title}`,
                                message: `${subjectName} — Hasil ulangan sudah bisa dilihat`,
                                link: '/dashboard/siswa/ulangan'
                            }))
                        )
                    }
                }
            } catch (notifError) {
                console.error('Error sending results-released notifications:', notifError)
            }
        }
        // Sinkronkan kelas satu batch (multi-kelas) bila ulangan baru saja diaktifkan
        let batchSync: { total: number, failed: string[] } | null = null
        if (finalIsActive === true && data?.batch_id) {
            try {
                batchSync = await syncExamBatch(id)
            } catch (batchError) {
                console.error('Batch sync error (exam):', batchError)
                batchSync = { total: -1, failed: [] }
            }
        }

        return NextResponse.json({ ...data, batch_sync: batchSync })
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

        // Block writes to archived (COMPLETED) academic years
        const { data: examForYear } = await supabase
            .from('exams')
            .select('teaching_assignment_id')
            .eq('id', id)
            .single()
        if (examForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(examForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
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
