/**
 * Auto-notify teachers when official exams (UTS/UAS) end.
 *
 * Checks for exams where:
 *   - is_active = true
 *   - end time (start_time + duration_minutes) has passed
 *
 * Sends a one-time notification to all relevant subject teachers.
 * Uses a unique notification `link` per exam to avoid duplicates.
 *
 * This is a fire-and-forget helper — call it from GET /api/official-exams
 * so it triggers whenever admin/guru opens the UTS/UAS page.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase'

export async function checkEndedOfficialExams(schoolId: string): Promise<void> {
    try {
        const now = new Date()

        // Get all active official exams for this school
        const { data: activeExams } = await supabase
            .from('official_exams')
            .select('id, title, exam_type, start_time, duration_minutes, window_end_time, subject_id, target_class_ids, school_id, subject:subjects(name)')
            .eq('school_id', schoolId)
            .eq('is_active', true)

        if (!activeExams || activeExams.length === 0) return

        // Filter exams whose end time has passed
        // (mode jendela → jam tutup; mode serentak → start + durasi)
        const endedExams = activeExams.filter(exam => {
            const endTime = exam.window_end_time
                ? new Date(exam.window_end_time).getTime()
                : new Date(new Date(exam.start_time).getTime() + exam.duration_minutes * 60 * 1000)
            return now > endTime
        })

        if (endedExams.length === 0) return

        // Get active academic year
        const { data: activeYear } = await supabase
            .from('academic_years')
            .select('id')
            .eq('is_active', true)
            .eq('school_id', schoolId)
            .single()

        if (!activeYear) return

        for (const exam of endedExams) {
            // Check if notification already sent for this exam (deduplicate by link)
            const notifLink = `/dashboard/guru/uts-uas/${exam.id}/hasil`
            const { data: existingNotif } = await supabase
                .from('notifications')
                .select('id')
                .eq('type', 'UJIAN_SELESAI')
                .eq('link', notifLink)
                .limit(1)

            if (existingNotif && existingNotif.length > 0) continue // Already notified

            // Find teachers who teach this subject in target classes
            if (!exam.target_class_ids?.length) continue

            const { data: assignments } = await supabase
                .from('teaching_assignments')
                .select('teacher:teachers(user_id)')
                .eq('subject_id', exam.subject_id)
                .in('class_id', exam.target_class_ids)
                .eq('academic_year_id', activeYear.id)

            if (!assignments || assignments.length === 0) continue

            const teacherUserIds = [...new Set(
                assignments.map((a: any) => {
                    const t = Array.isArray(a.teacher) ? a.teacher[0] : a.teacher
                    return t?.user_id
                }).filter(Boolean)
            )]

            if (teacherUserIds.length === 0) continue

            const examLabel = exam.exam_type === 'UTS' ? 'UTS' : 'UAS'
            const subjectName = (exam.subject as any)?.name || ''

            await supabase.from('notifications').insert(
                teacherUserIds.map(uid => ({
                    user_id: uid,
                    type: 'UJIAN_SELESAI',
                    title: `✅ ${examLabel} Selesai: ${exam.title}`,
                    message: `${subjectName} — Ujian telah berakhir. Silakan cek hasil dan koreksi essay siswa.`,
                    link: notifLink
                }))
            )

            console.log(`[NOTIF] Sent exam-ended notifications for ${exam.title} to ${teacherUserIds.length} teachers`)

            // Auto-deactivate the exam
            await supabase
                .from('official_exams')
                .update({ is_active: false })
                .eq('id', exam.id)
            
            console.log(`[EXAM] Deactivated ended official exam: ${exam.title}`)
        }
    } catch (error) {
        console.error('Error in checkEndedOfficialExams:', error)
    }
}
