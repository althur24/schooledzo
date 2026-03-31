import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET notifications for current user
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const unreadOnly = request.nextUrl.searchParams.get('unread') === 'true'
        const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20')

        // Fix #4: Auto-cleanup — delete notifications older than 30 days (lazy cleanup)
        try {
            const thirtyDaysAgo = new Date()
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
            await supabase
                .from('notifications')
                .delete()
                .eq('user_id', user.id)
                .eq('is_read', true)
                .lt('created_at', thirtyDaysAgo.toISOString())
        } catch (cleanupError) {
            console.error('Notification cleanup error:', cleanupError)
        }

        // Auto-cleanup: Remove "Dijadwalkan" notifications for exams that are NOT published
        try {
            const { data: userDijadwalkanNotifs } = await supabase
                .from('notifications')
                .select('id, title')
                .eq('user_id', user.id)
                .eq('type', 'UJIAN_RESMI')
                .ilike('title', '%Dijadwalkan%')

            if (userDijadwalkanNotifs && userDijadwalkanNotifs.length > 0) {
                // Get all active official exams for this school
                const { data: activeExams } = await supabase
                    .from('official_exams')
                    .select('title')
                    .eq('school_id', schoolId)
                    .eq('is_active', true)

                const activeExamTitles = new Set((activeExams || []).map((e: any) => e.title))

                // Find notifications that reference exams that are NOT active
                const staleNotifIds = userDijadwalkanNotifs
                    .filter(n => !activeExamTitles.has(n.title.replace(/^.*Dijadwalkan:\s*/, '')))
                    .map(n => n.id)

                if (staleNotifIds.length > 0) {
                    await supabase
                        .from('notifications')
                        .delete()
                        .in('id', staleNotifIds)
                }
            }
        } catch (staleCleanupError) {
            console.error('Stale exam notification cleanup error:', staleCleanupError)
        }

        // Fix #5: Deadline reminder — check for assignments due within 24 hours
        if (user.role === 'SISWA') {
            try {
                // Get student's class
                const { data: student } = await supabase
                    .from('students')
                    .select('class_id')
                    .eq('user_id', user.id)
                    .single()

                if (student) {
                    // Get teaching assignments for student's class
                    const { data: tas } = await supabase
                        .from('teaching_assignments')
                        .select('id')
                        .eq('class_id', student.class_id)

                    if (tas && tas.length > 0) {
                        const taIds = tas.map(t => t.id)
                        const now = new Date()
                        const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

                        // Find assignments with deadline within 24 hours
                        const { data: urgentAssignments } = await supabase
                            .from('assignments')
                            .select('id, title, deadline, teaching_assignment_id')
                            .in('teaching_assignment_id', taIds)
                            .gt('deadline', now.toISOString())
                            .lte('deadline', in24h.toISOString())

                        if (urgentAssignments && urgentAssignments.length > 0) {
                            for (const assignment of urgentAssignments) {
                                // Check if student already submitted
                                const { data: existingSub } = await supabase
                                    .from('submissions')
                                    .select('id')
                                    .eq('assignment_id', assignment.id)
                                    .eq('student_id', student.class_id) // just need to check by user
                                    .limit(1)

                                // Check if reminder already sent (within last 24h)
                                const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
                                const { data: existingReminder } = await supabase
                                    .from('notifications')
                                    .select('id')
                                    .eq('user_id', user.id)
                                    .eq('type', 'DEADLINE_REMINDER')
                                    .ilike('title', `%${assignment.title}%`)
                                    .gt('created_at', twentyFourHoursAgo.toISOString())
                                    .limit(1)

                                if ((!existingSub || existingSub.length === 0) && (!existingReminder || existingReminder.length === 0)) {
                                    const deadlineStr = new Date(assignment.deadline).toLocaleString('id-ID')
                                    await supabase.from('notifications').insert({
                                        user_id: user.id,
                                        type: 'DEADLINE_REMINDER',
                                        title: `⏰ Deadline Segera: ${assignment.title}`,
                                        message: `Tugas ini harus dikumpulkan sebelum ${deadlineStr}`,
                                        link: '/dashboard/siswa/tugas'
                                    })
                                }
                            }
                        }
                    }
                }
            } catch (deadlineError) {
                console.error('Deadline reminder error:', deadlineError)
                // Don't block the main notification fetch
            }

            // Fix #6: UTS/UAS Reminder — check for exams starting within 24 hours
            try {
                // We re-fetch student class if not available in this scope, but we do have it from above (nested try)
                // To be safe and isolated:
                const { data: student } = await supabase
                    .from('students')
                    .select('class_id')
                    .eq('user_id', user.id)
                    .single()

                if (student) {
                    const now = new Date()
                    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
                    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

                    const { data: officialExams } = await supabase
                        .from('official_exams')
                        .select('id, title, exam_type, start_time, target_class_ids, subject:subjects(name)')
                        .eq('school_id', schoolId)
                        .eq('is_active', true) // Only remind if it's already an active (approved) exam
                        .gt('start_time', now.toISOString())
                        .lte('start_time', in24h.toISOString())

                    if (officialExams && officialExams.length > 0) {
                        for (const exam of officialExams) {
                            if (!exam.target_class_ids?.includes(student.class_id)) continue

                            // Check if ANY notification for this exam was already sent recently (any type)
                            const { data: existing } = await supabase
                                .from('notifications')
                                .select('id')
                                .eq('user_id', user.id)
                                .ilike('title', `%${exam.title}%`)
                                .gt('created_at', twentyFourHoursAgo.toISOString())
                                .limit(1)

                            if (!existing || existing.length === 0) {
                                const label = exam.exam_type === 'UTS' ? 'UTS' : 'UAS'
                                const startStr = new Date(exam.start_time).toLocaleString('id-ID')
                                await supabase.from('notifications').insert({
                                    user_id: user.id,
                                    type: 'EXAM_REMINDER',
                                    title: `⏰ ${label} Segera: ${exam.title}`,
                                    message: `${(exam as any).subject?.name || ''} — Mulai: ${startStr}`,
                                    link: '/dashboard/siswa/uts-uas'
                                })
                            }
                        }
                    }
                }
            } catch (examReminderError) {
                console.error('UTS/UAS reminder error:', examReminderError)
            }

            // Fix #7: Proactive Initial Notification for Scheduled Exams
            // Ensures students who didn't get the POST /api/official-exams push notification (e.g. exams made before the update, or missed)
            // will still see "UTS/UAS Dijadwalkan" when they log in to their dashboard.
            try {
                const { data: student } = await supabase
                    .from('students')
                    .select('class_id')
                    .eq('user_id', user.id)
                    .single()

                if (student) {
                    const now = new Date()
                    const { data: scheduledExams } = await supabase
                        .from('official_exams')
                        .select('id, title, exam_type, start_time, target_class_ids, subject:subjects(name)')
                        .eq('school_id', schoolId)
                        .eq('is_active', true)
                        .gt('start_time', now.toISOString())

                    if (scheduledExams && scheduledExams.length > 0) {
                        for (const exam of scheduledExams) {
                            if (!exam.target_class_ids?.includes(student.class_id)) continue

                            // Check if ANY notification for this exam already exists (any type)
                            const { data: existingInit } = await supabase
                                .from('notifications')
                                .select('id')
                                .eq('user_id', user.id)
                                .ilike('title', `%${exam.title}%`)
                                .limit(1)

                            if (!existingInit || existingInit.length === 0) {
                                const label = exam.exam_type === 'UTS' ? 'UTS' : 'UAS'
                                const startStr = new Date(exam.start_time).toLocaleString('id-ID')
                                await supabase.from('notifications').insert({
                                    user_id: user.id,
                                    type: 'UJIAN_RESMI',
                                    title: `📅 ${label} Dijadwalkan: ${exam.title}`,
                                    message: `${(exam as any).subject?.name || ''} — Dimulai pada: ${startStr}`,
                                    link: '/dashboard/siswa/uts-uas'
                                })
                            }
                        }
                    }
                }
            } catch (initReminderError) {
                console.error('Proactive scheduled exam notification error:', initReminderError)
            }
        }

        // Teacher UTS/UAS Reminders
        if (user.role === 'GURU') {
            try {
                const { data: teacher } = await supabase
                    .from('teachers')
                    .select('id')
                    .eq('user_id', user.id)
                    .single()

                if (teacher) {
                    const { data: activeYear } = await supabase
                        .from('academic_years')
                        .select('id')
                        .eq('is_active', true)
                        .eq('school_id', schoolId)
                        .single()

                    if (activeYear) {
                        const { data: assignments } = await supabase
                            .from('teaching_assignments')
                            .select('subject_id, class_id')
                            .eq('teacher_id', teacher.id)
                            .eq('academic_year_id', activeYear.id)

                        if (assignments && assignments.length > 0) {
                            const now = new Date()
                            const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
                            const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
                            const subjectIds = [...new Set(assignments.map(a => a.subject_id))]
                            const classIds = [...new Set(assignments.map(a => a.class_id))]

                            const { data: upcomingExams } = await supabase
                                .from('official_exams')
                                .select('id, title, exam_type, start_time, target_class_ids, subject_id, subject:subjects(name)')
                                .eq('school_id', schoolId)
                                .eq('is_active', true)
                                .in('subject_id', subjectIds)
                                .gt('start_time', now.toISOString())
                                .lte('start_time', in24h.toISOString())

                            if (upcomingExams) {
                                for (const exam of upcomingExams) {
                                    if (!exam.target_class_ids?.some((cid: string) => classIds.includes(cid))) continue

                                    const { data: existing } = await supabase
                                        .from('notifications')
                                        .select('id')
                                        .eq('user_id', user.id)
                                        .ilike('title', `%${exam.title}%`)
                                        .gt('created_at', twentyFourHoursAgo.toISOString())
                                        .limit(1)

                                    if (!existing || existing.length === 0) {
                                        const label = exam.exam_type === 'UTS' ? 'UTS' : 'UAS'
                                        const startStr = new Date(exam.start_time).toLocaleString('id-ID')
                                        await supabase.from('notifications').insert({
                                            user_id: user.id,
                                            type: 'EXAM_REMINDER',
                                            title: `⏰ ${label} Segera: ${exam.title}`,
                                            message: `${(exam as any).subject?.name || ''} — Mulai: ${startStr}`,
                                            link: '/dashboard/guru/uts-uas'
                                        })
                                    }
                                }
                            }

                            // Teacher "Dimulai" — notify when exam start_time has arrived
                            const { data: startedExams } = await supabase
                                .from('official_exams')
                                .select('id, title, exam_type, start_time, end_time, target_class_ids, subject_id, subject:subjects(name)')
                                .eq('school_id', schoolId)
                                .eq('is_active', true)
                                .in('subject_id', subjectIds)
                                .lte('start_time', now.toISOString())
                                .gt('end_time', now.toISOString())

                            if (startedExams) {
                                for (const exam of startedExams) {
                                    if (!exam.target_class_ids?.some((cid: string) => classIds.includes(cid))) continue

                                    const label = exam.exam_type === 'UTS' ? 'UTS' : 'UAS'
                                    const dimulaiTitle = `🔔 ${label} Dimulai: ${exam.title}`

                                    const { data: existingDimulai } = await supabase
                                        .from('notifications')
                                        .select('id')
                                        .eq('user_id', user.id)
                                        .eq('title', dimulaiTitle)
                                        .eq('type', 'UJIAN_RESMI')
                                        .limit(1)

                                    if (!existingDimulai || existingDimulai.length === 0) {
                                        const startStr = new Date(exam.start_time).toLocaleString('id-ID')
                                        await supabase.from('notifications').insert({
                                            user_id: user.id,
                                            type: 'UJIAN_RESMI',
                                            title: dimulaiTitle,
                                            message: `${(exam as any).subject?.name || ''} — Siswa sedang mengerjakan sejak ${startStr}`,
                                            link: '/dashboard/guru/uts-uas'
                                        })
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (teacherReminderError) {
                console.error('Teacher exam reminder error:', teacherReminderError)
            }
        }

        let query = supabase
            .from('notifications')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(limit)

        if (unreadOnly) {
            query = query.eq('is_read', false)
        }

        const { data, error } = await query

        if (error) throw error

        // Get unread count
        const { count } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('is_read', false)

        return NextResponse.json({
            notifications: data || [],
            unreadCount: count || 0
        })
    } catch (error) {
        console.error('Error fetching notifications:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST create notification (for internal use / triggers)
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // C4 Security Fix: Only teachers and admins can create notifications
        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await request.json()
        const { user_ids, type, title, message, link } = body

        if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
            return NextResponse.json({ error: 'user_ids required' }, { status: 400 })
        }

        if (!type || !title) {
            return NextResponse.json({ error: 'type and title required' }, { status: 400 })
        }

        // Create notifications for all target users
        const notifications = user_ids.map((uid: string) => ({
            user_id: uid,
            type,
            title,
            message: message || null,
            link: link || null
        }))

        const { data, error } = await supabase
            .from('notifications')
            .insert(notifications)
            .select()

        if (error) throw error

        return NextResponse.json({ success: true, count: data?.length || 0 })
    } catch (error) {
        console.error('Error creating notifications:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT mark as read
export async function PUT(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const body = await request.json()
        const { notification_id, mark_all } = body

        if (mark_all) {
            // Mark all as read
            const { error } = await supabase
                .from('notifications')
                .update({ is_read: true })
                .eq('user_id', user.id)
                .eq('is_read', false)

            if (error) throw error

            return NextResponse.json({ success: true })
        }

        if (!notification_id) {
            return NextResponse.json({ error: 'notification_id required' }, { status: 400 })
        }

        // Mark single notification as read
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', notification_id)
            .eq('user_id', user.id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error updating notification:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
