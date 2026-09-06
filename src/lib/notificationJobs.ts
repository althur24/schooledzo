import { supabaseAdmin as supabase } from './supabase'
import { logError } from './logError'
import { fetchAllRows } from './fetchAllRows'
import { AuthUser } from './types'
import { getMenuLabelsForSchool } from './serverLabels'

/**
 * Proactive notification jobs (deadline reminders, exam reminders, cleanups).
 *
 * Dipindahkan dari GET /api/notifications: route itu dipolling tiap 60 detik per
 * user, sehingga 13+ query proaktif ikut berjalan di setiap poll (±220 q/s saat
 * 1000 user aktif). Kini dijalankan terjadwal oleh src/lib/scheduler.ts hanya
 * untuk user dengan sesi aktif.
 *
 * Konsekuensi: notifikasi proaktif muncul maks. ~10 menit setelah kondisi
 * terpenuhi (sebelumnya ≤ 60 detik). Notifikasi yang dibuat via POST tetap instan.
 */

type Counter = { inserts: number }

// Auto-cleanup: Remove "Dijadwalkan" notifications for exams that are NOT published
async function cleanupStaleExamNotifications(user: AuthUser) {
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
                .eq('school_id', user.school_id)
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
        logError('Stale exam notification cleanup error', staleCleanupError)
    }
}

// Deadline reminder — check for assignments/quizzes due within 24 hours (SISWA)
async function sendDeadlineReminders(user: AuthUser, counter: Counter) {
    try {
        const labels = await getMenuLabelsForSchool(user.school_id)
        // Get student's id + class
        const { data: student } = await supabase
            .from('students')
            .select('id, class_id')
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
                // (kecuali tugas offline — tidak ada yang harus dikumpulkan siswa)
                const { data: urgentAssignments } = await supabase
                    .from('assignments')
                    .select('id, title, due_date, teaching_assignment_id')
                    .in('teaching_assignment_id', taIds)
                    .neq('submission_mode', 'OFFLINE')
                    .gt('due_date', now.toISOString())
                    .lte('due_date', in24h.toISOString())

                if (urgentAssignments && urgentAssignments.length > 0) {
                    for (const assignment of urgentAssignments) {
                        // Check if student already submitted (student_submissions.student_id = students.id)
                        const { data: existingSub } = await supabase
                            .from('student_submissions')
                            .select('id')
                            .eq('assignment_id', assignment.id)
                            .eq('student_id', student.id)
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
                            const deadlineStr = new Date(assignment.due_date).toLocaleString('id-ID')
                            await supabase.from('notifications').insert({
                                user_id: user.id,
                                type: 'DEADLINE_REMINDER',
                                title: `⏰ Deadline Segera: ${assignment.title}`,
                                message: `${labels.tugas} ini harus dikumpulkan sebelum ${deadlineStr}`,
                                link: '/dashboard/siswa/tugas'
                            })
                            counter.inserts++
                        }
                    }
                }

                // Kuis dengan deadline dalam 24 jam (siswa belum mengerjakan)
                // (kecuali kuis offline — tidak ada yang harus dikerjakan siswa)
                const { data: urgentQuizzes } = await supabase
                    .from('quizzes')
                    .select('id, title, deadline, is_remedial, allowed_student_ids')
                    .in('teaching_assignment_id', taIds)
                    .eq('is_active', true)
                    .neq('submission_mode', 'OFFLINE')
                    .not('deadline', 'is', null)
                    .gt('deadline', now.toISOString())
                    .lte('deadline', in24h.toISOString())

                if (urgentQuizzes && urgentQuizzes.length > 0) {
                    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
                    for (const quiz of urgentQuizzes) {
                        // Remedial: hanya siswa terdaftar yang diingatkan — siswa
                        // lain di kelas tidak melihat (dan tidak bisa mengerjakan)
                        // kuis remedial ini.
                        if ((quiz as any).is_remedial && Array.isArray((quiz as any).allowed_student_ids) && (quiz as any).allowed_student_ids.length > 0) {
                            if (!(quiz as any).allowed_student_ids.includes((student as any).id)) continue
                        }
                        // Skip jika siswa sudah MENGUMPULKAN — cukup membuka kuis
                        // (attempt berjalan) TIDAK boleh meniadakan reminder:
                        // siswa yang buka lalu pergi justru yang paling perlu diingatkan.
                        const { data: existingQuizSub } = await supabase
                            .from('quiz_submissions')
                            .select('id, submitted_at')
                            .eq('quiz_id', quiz.id)
                            .eq('student_id', student.id)
                            .limit(1)

                        const hasSubmitted = (existingQuizSub || []).some(s => s.submitted_at != null)

                        // Skip jika reminder untuk kuis ini sudah dikirim dalam 24 jam terakhir
                        const { data: existingQuizReminder } = await supabase
                            .from('notifications')
                            .select('id')
                            .eq('user_id', user.id)
                            .eq('type', 'DEADLINE_REMINDER')
                            .ilike('title', `%${quiz.title}%`)
                            .gt('created_at', twentyFourHoursAgo.toISOString())
                            .limit(1)

                        if (!hasSubmitted && (!existingQuizReminder || existingQuizReminder.length === 0)) {
                            const deadlineStr = new Date(quiz.deadline).toLocaleString('id-ID')
                            await supabase.from('notifications').insert({
                                user_id: user.id,
                                type: 'DEADLINE_REMINDER',
                                title: `⏰ Deadline Segera: ${quiz.title}`,
                                message: `${labels.kuis} ini harus dikerjakan sebelum ${deadlineStr}`,
                                link: '/dashboard/siswa/kuis'
                            })
                            counter.inserts++
                        }
                    }
                }
            }
        }
    } catch (deadlineError) {
        logError('Deadline reminder error', deadlineError)
        // Don't block other jobs
    }
}

// UTS/UAS Reminder — check for exams starting within 24 hours (SISWA)
async function sendExamReminders(user: AuthUser, counter: Counter) {
    try {
        const labels = await getMenuLabelsForSchool(user.school_id)
        const { data: student } = await supabase
            .from('students')
            .select('id, class_id')
            .eq('user_id', user.id)
            .single()

        if (student) {
            const now = new Date()
            const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
            const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

            const { data: officialExams } = await supabase
                .from('official_exams')
                .select('id, title, exam_type, start_time, target_class_ids, is_remedial, allowed_student_ids, subject:subjects(name)')
                .eq('school_id', user.school_id)
                .eq('is_active', true) // Only remind if it's already an active (approved) exam
                .gt('start_time', now.toISOString())
                .lte('start_time', in24h.toISOString())

            if (officialExams && officialExams.length > 0) {
                for (const exam of officialExams) {
                    if (!exam.target_class_ids?.includes(student.class_id)) continue
                    // Remedial: hanya siswa terdaftar yang diingatkan — siswa
                    // lain di kelas target tidak ikut ujian remedial.
                    if ((exam as any).is_remedial && Array.isArray((exam as any).allowed_student_ids) && (exam as any).allowed_student_ids.length > 0) {
                        if (!(exam as any).allowed_student_ids.includes((student as any).id)) continue
                    }

                    // Check if ANY notification for this exam was already sent recently (any type)
                    const { data: existing } = await supabase
                        .from('notifications')
                        .select('id')
                        .eq('user_id', user.id)
                        .ilike('title', `%${exam.title}%`)
                        .gt('created_at', twentyFourHoursAgo.toISOString())
                        .limit(1)

                    if (!existing || existing.length === 0) {
                        const label = exam.exam_type === 'UTS' ? labels.uts : labels.uas
                        const startStr = new Date(exam.start_time).toLocaleString('id-ID')
                        await supabase.from('notifications').insert({
                            user_id: user.id,
                            type: 'EXAM_REMINDER',
                            title: `⏰ ${label} Segera: ${exam.title}`,
                            message: `${(exam as any).subject?.name || ''} — Mulai: ${startStr}`,
                            link: '/dashboard/siswa/ulangan'
                        })
                        counter.inserts++
                    }
                }
            }
        }
    } catch (examReminderError) {
        logError('UTS/UAS reminder error', examReminderError)
    }
}

// Proactive Initial Notification for Scheduled Exams (SISWA)
// Ensures students who didn't get the POST /api/official-exams push notification
// (e.g. exams made before the update, or missed) will still see "UTS/UAS Dijadwalkan".
async function sendScheduledExamNotifications(user: AuthUser, counter: Counter) {
    try {
        const labels = await getMenuLabelsForSchool(user.school_id)
        const { data: student } = await supabase
            .from('students')
            .select('id, class_id')
            .eq('user_id', user.id)
            .single()

        if (student) {
            const now = new Date()
            const { data: scheduledExams } = await supabase
                .from('official_exams')
                .select('id, title, exam_type, start_time, target_class_ids, is_remedial, allowed_student_ids, subject:subjects(name)')
                .eq('school_id', user.school_id)
                .eq('is_active', true)
                .gt('start_time', now.toISOString())

            if (scheduledExams && scheduledExams.length > 0) {
                for (const exam of scheduledExams) {
                    if (!exam.target_class_ids?.includes(student.class_id)) continue
                    // Remedial: hanya siswa terdaftar yang diberi tahu — siswa
                    // lain di kelas target tidak ikut ujian remedial.
                    if ((exam as any).is_remedial && Array.isArray((exam as any).allowed_student_ids) && (exam as any).allowed_student_ids.length > 0) {
                        if (!(exam as any).allowed_student_ids.includes((student as any).id)) continue
                    }

                    // Check if ANY notification for this exam already exists (any type)
                    const { data: existingInit } = await supabase
                        .from('notifications')
                        .select('id')
                        .eq('user_id', user.id)
                        .ilike('title', `%${exam.title}%`)
                        .limit(1)

                    if (!existingInit || existingInit.length === 0) {
                        const label = exam.exam_type === 'UTS' ? labels.uts : labels.uas
                        const startStr = new Date(exam.start_time).toLocaleString('id-ID')
                        await supabase.from('notifications').insert({
                            user_id: user.id,
                            type: 'UJIAN_RESMI',
                            title: `📅 ${label} Dijadwalkan: ${exam.title}`,
                            message: `${(exam as any).subject?.name || ''} — Dimulai pada: ${startStr}`,
                            link: '/dashboard/siswa/ulangan'
                        })
                        counter.inserts++
                    }
                }
            }
        }
    } catch (initReminderError) {
        logError('Proactive scheduled exam notification error', initReminderError)
    }
}

// Teacher UTS/UAS Reminders (GURU)
async function sendTeacherExamReminders(user: AuthUser, counter: Counter) {
    try {
        const labels = await getMenuLabelsForSchool(user.school_id)
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
                .eq('school_id', user.school_id)
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
                        .eq('school_id', user.school_id)
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
                                const label = exam.exam_type === 'UTS' ? labels.uts : labels.uas
                                const startStr = new Date(exam.start_time).toLocaleString('id-ID')
                                await supabase.from('notifications').insert({
                                    user_id: user.id,
                                    type: 'EXAM_REMINDER',
                                    title: `⏰ ${label} Segera: ${exam.title}`,
                                    message: `${(exam as any).subject?.name || ''} — Mulai: ${startStr}`,
                                    link: '/dashboard/guru/ulangan'
                                })
                                counter.inserts++
                            }
                        }
                    }

                    // Teacher "Dimulai" — notify when exam start_time has arrived
                    // dan window pengerjaan belum lewat. official_exams tidak punya
                    // kolom end_time — window = window_end_time (mode jendela)
                    // ?? start_time + duration_minutes (mode serentak).
                    const { data: startedExams } = await supabase
                        .from('official_exams')
                        .select('id, title, exam_type, start_time, duration_minutes, window_end_time, target_class_ids, subject_id, subject:subjects(name)')
                        .eq('school_id', user.school_id)
                        .eq('is_active', true)
                        .in('subject_id', subjectIds)
                        .lte('start_time', now.toISOString())

                    if (startedExams) {
                        for (const exam of startedExams) {
                            if (!exam.target_class_ids?.some((cid: string) => classIds.includes(cid))) continue

                            const windowEndMs = exam.window_end_time
                                ? new Date(exam.window_end_time).getTime()
                                : new Date(exam.start_time).getTime() + (exam.duration_minutes || 0) * 60000
                            if (now.getTime() > windowEndMs) continue

                            const label = exam.exam_type === 'UTS' ? labels.uts : labels.uas
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
                                    link: '/dashboard/guru/ulangan'
                                })
                                counter.inserts++
                            }
                        }
                    }
                }
            }
        }
    } catch (teacherReminderError) {
        logError('Teacher exam reminder error', teacherReminderError)
    }
}

/** Jalankan semua job notifikasi untuk satu user. Mengembalikan jumlah notifikasi yang dibuat. */
export async function runNotificationJobsForUser(user: AuthUser, counter: Counter = { inserts: 0 }): Promise<number> {
    await cleanupStaleExamNotifications(user)
    if (user.role === 'SISWA') {
        await sendDeadlineReminders(user, counter)
        await sendExamReminders(user, counter)
        await sendScheduledExamNotifications(user, counter)
    }
    if (user.role === 'GURU') {
        await sendTeacherExamReminders(user, counter)
    }
    return counter.inserts
}

const JOB_NAME = 'notification_jobs'
const LOCK_MAX_AGE_MS = 9 * 60 * 1000 // scheduler berjalan tiap 10 mnt; lock dianggap basi setelah 9 mnt
const CONCURRENCY = 10

/**
 * Klaim lock lalu jalankan job untuk semua user dengan sesi aktif.
 * Aman multi-replica: hanya satu instance yang memenangkan klaim atomik.
 */
export async function runNotificationJobsForActiveUsers() {
    // 1. Klaim lock atomik — instance lain yang kalah klaim langsung keluar
    const lockStaleBefore = new Date(Date.now() - LOCK_MAX_AGE_MS).toISOString()
    const { data: claimed, error: claimError } = await supabase
        .from('cron_runs')
        .update({ last_run_at: new Date().toISOString() })
        .eq('job', JOB_NAME)
        .lt('last_run_at', lockStaleBefore)
        .select('job')

    if (claimError) {
        logError('Cron lock error', claimError)
        return
    }
    if (!claimed || claimed.length === 0) return

    const t0 = Date.now()

    // 2. Cleanup global (pengganti cleanup per-user): hapus notifikasi terbaca > 30 hari — 1 query untuk semua user
    try {
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        await supabase
            .from('notifications')
            .delete()
            .eq('is_read', true)
            .lt('created_at', thirtyDaysAgo.toISOString())
    } catch (cleanupError) {
        logError('Notification cleanup error', cleanupError)
    }

    // 3. Ambil user dengan sesi aktif (mirror validateSession: user terkunci diskip)
    //    Wajib fetchAllRows: PostgREST diam-diam memotong ke 1000 baris — saat TO
    //    dengan >1000 sesi aktif, user sisanya akan terlewat dari job reminder.
    let sessions
    try {
        sessions = await fetchAllRows(
            supabase
                .from('sessions')
                .select('user:users(id, username, full_name, role, school_id, must_change_password, is_locked)')
                .gt('expires_at', new Date().toISOString())
        )
    } catch (sessionsError) {
        logError('Scheduler sessions fetch error', sessionsError)
        return
    }

    const seen = new Set<string>()
    const users: AuthUser[] = []
    for (const s of sessions || []) {
        const u = (Array.isArray(s.user) ? s.user[0] : s.user) as AuthUser | null
        if (u && !u.is_locked && !seen.has(u.id)) {
            seen.add(u.id)
            users.push(u)
        }
    }

    // 4. Proses per user dengan konkurensi terbatas
    let totalInserts = 0
    for (let i = 0; i < users.length; i += CONCURRENCY) {
        const results = await Promise.all(users.slice(i, i + CONCURRENCY).map(async (u) => {
            try {
                return await runNotificationJobsForUser(u)
            } catch (userError) {
                logError(`Notification jobs error for user ${u.id}`, userError)
                return 0
            }
        }))
        totalInserts += results.reduce((sum, n) => sum + n, 0)
    }

    console.log(`[jobs] ${JOB_NAME}: ${users.length} active users, ${totalInserts} notifications created, ${Math.round((Date.now() - t0) / 1000)}s`)
}
