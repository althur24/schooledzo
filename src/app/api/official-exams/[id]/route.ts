import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET single official exam
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx

        const { data, error } = await supabase
            .from('official_exams')
            .select(`
                *,
                subject:subjects(id, name),
                academic_year:academic_years(id, name, is_active),
                creator:users!official_exams_created_by_fkey(full_name)
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        // Resolve target class names
        if (data?.target_class_ids?.length > 0) {
            const { data: classes } = await supabase
                .from('classes')
                .select('id, name, school_level, grade_level')
                .in('id', data.target_class_ids)

            ;(data as any).target_classes = classes || []
        } else {
            ;(data as any).target_classes = []
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching official exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update official exam
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const {
            title, description, start_time, duration_minutes,
            is_randomized, is_active, max_violations,
            target_class_ids, subject_id
        } = body

        const updateData: any = { updated_at: new Date().toISOString() }
        if (title !== undefined) updateData.title = title
        if (description !== undefined) updateData.description = description
        if (start_time !== undefined) updateData.start_time = start_time
        if (duration_minutes !== undefined) updateData.duration_minutes = duration_minutes
        if (is_randomized !== undefined) updateData.is_randomized = is_randomized
        if (is_active !== undefined) updateData.is_active = is_active
        if (max_violations !== undefined) updateData.max_violations = max_violations
        if (target_class_ids !== undefined) updateData.target_class_ids = target_class_ids
        if (subject_id !== undefined) updateData.subject_id = subject_id

        const { data, error } = await supabase
            .from('official_exams')
            .update(updateData)
            .eq('id', id)
            .select(`
                *,
                subject:subjects(id, name),
                academic_year:academic_years(id, name)
            `)
            .single()

        if (error) throw error

        // If just activated, send notifications to all target students
        if (is_active === true && data) {
            try {
                const { data: activeYear } = await supabase
                    .from('academic_years')
                    .select('id')
                    .eq('is_active', true)
                    .eq('school_id', data.school_id)
                    .single()

                if (activeYear && data.target_class_ids?.length > 0) {
                    const { data: enrollments } = await supabase
                        .from('student_enrollments')
                        .select('student:students(user_id)')
                        .eq('academic_year_id', activeYear.id)
                        .in('class_id', data.target_class_ids)

                    if (enrollments && enrollments.length > 0) {
                        const subjectName = (data as any).subject?.name || ''
                        const startDate = new Date(data.start_time).toLocaleString('id-ID')
                        const examLabel = data.exam_type === 'UTS' ? 'UTS' : 'UAS'

                        // Dedup: find students who already have a notification for this exam
                        const userIds = enrollments.map((e: any) => e.student.user_id).filter(Boolean)
                        const { data: existingNotifs } = await supabase
                            .from('notifications')
                            .select('user_id')
                            .in('user_id', userIds)
                            .ilike('title', `%${data.title}%`)

                        const alreadyNotified = new Set((existingNotifs || []).map((n: any) => n.user_id))
                        const toNotify = userIds.filter((uid: string) => !alreadyNotified.has(uid))

                        if (toNotify.length > 0) {
                            await supabase.from('notifications').insert(
                                toNotify.map((uid: string) => ({
                                    user_id: uid,
                                    type: 'UJIAN_RESMI',
                                    title: `🔔 ${examLabel} Sekarang Aktif: ${data.title}`,
                                    message: `${subjectName} — Silakan kerjakan pada: ${startDate}`,
                                    link: '/dashboard/siswa/uts-uas'
                                }))
                            )
                        }
                    }
                }
            } catch (notifError) {
                console.error('Error sending official exam notifications:', notifError)
            }
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating official exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE official exam
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Cascade: delete related records first (foreign key constraints)
        // 1. Delete submission answers (if table exists)
        try {
            const { data: subs } = await supabase
                .from('official_exam_submissions')
                .select('id')
                .eq('exam_id', id)
            if (subs && subs.length > 0) {
                const subIds = subs.map(s => s.id)
                await supabase
                    .from('official_exam_answers')
                    .delete()
                    .in('submission_id', subIds)
            }
        } catch { }

        // 2. Delete submissions
        await supabase
            .from('official_exam_submissions')
            .delete()
            .eq('exam_id', id)

        // 3. Delete questions
        await supabase
            .from('official_exam_questions')
            .delete()
            .eq('exam_id', id)

        // 4. Delete the exam itself
        const { error } = await supabase
            .from('official_exams')
            .delete()
            .eq('id', id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting official exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
