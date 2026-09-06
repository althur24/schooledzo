import { supabaseAdmin as supabase } from '@/lib/supabase'
import { syncExamBatch, syncQuizBatch } from '@/lib/examBatch'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'

export async function checkAndAutoPublish(
    source: 'quiz' | 'exam',
    parentId: string
): Promise<boolean> {
    try {
        console.log(`[autoPublish] Checking ${source} with ID: ${parentId}`)

        // 1. Get the parent (quiz or exam)
        const table = source === 'quiz' ? 'quizzes' : 'exams'
        const { data: parent, error: parentError } = await supabase
            .from(table)
            .select(`
                *,
                teaching_assignment:teaching_assignments(
                    class_id,
                    subject:subjects(name),
                    class:classes(school_id)
                )
            `)
            .eq('id', parentId)
            .single()

        if (parentError || !parent) {
            console.error(`[autoPublish] Parent not found:`, parentError)
            return false
        }

        // If not pending publish, no need to do anything
        if (!parent.pending_publish) {
            console.log(`[autoPublish] Parent is not pending_publish (value: ${JSON.stringify(parent.pending_publish)}). is_active=${parent.is_active}. Skipping.`)
            return false
        }

        // If already active, shouldn't happen but defensive check
        if (parent.is_active) {
            console.log(`[autoPublish] Parent is already active. Skipping.`)
            return false
        }

        // 2. Check all questions
        const questionTable = source === 'quiz' ? 'quiz_questions' : 'exam_questions'
        const foreignKey = source === 'quiz' ? 'quiz_id' : 'exam_id'

        const { data: questions, error: questionsError } = await supabase
            .from(questionTable)
            .select('status')
            .eq(foreignKey, parentId)

        if (questionsError) {
            console.error(`[autoPublish] Error fetching questions:`, questionsError)
            return false
        }

        if (!questions || questions.length === 0) {
            console.log(`[autoPublish] No questions found. Cannot publish.`)
            return false
        }

        // 3. Are all approved?
        const allApproved = questions.every(q => q.status === 'approved')

        if (!allApproved) {
            console.log(`[autoPublish] Not all questions approved. Statuses:`, questions.map(q => q.status))
            return false
        }

        // 4. All approved and pending_publish -> Auto Publish!
        console.log(`[autoPublish] All questions approved! Publishing ${source}...`)
        console.log(`[autoPublish] Current parent state: is_active=${parent.is_active}, pending_publish=${parent.pending_publish}`)

        const { data: updatedDoc, error: updateError } = await supabase
            .from(table)
            .update({
                is_active: true,
                pending_publish: false,
                updated_at: new Date().toISOString()
            })
            .eq('id', parentId)
            .eq('pending_publish', true) // Prevent race condition: only update if STILL pending
            .select('id')

        if (updateError) {
            console.error(`[autoPublish] Error updating ${source}:`, updateError)
            return false
        }

        console.log(`[autoPublish] Update result: updatedDoc=${JSON.stringify(updatedDoc)}`)

        // If no row was updated, it means another concurrent request already published it!
        // This silently succeeds without sending duplicate notifications.
        if (!updatedDoc || updatedDoc.length === 0) {
            console.log(`[autoPublish] ${source} already published by concurrent request. Skipping notification.`)
            return true
        }

        // Verify the update actually took effect
        const { data: verifyDoc } = await supabase.from(table).select('is_active, pending_publish').eq('id', parentId).single()
        console.log(`[autoPublish] VERIFY after update: is_active=${verifyDoc?.is_active}, pending_publish=${verifyDoc?.pending_publish}`)

        // 5. Send notifications
        await sendPublishNotifications(source, parent)

        // 6. Sinkronkan kelas satu batch (multi-kelas) bila ada — menutup celah
        //    pending-review yang dulu hanya menerbitkan kelas utama
        if ((parent as any).batch_id) {
            try {
                const syncResult = source === 'quiz' ? await syncQuizBatch(parentId) : await syncExamBatch(parentId)
                console.log(`[autoPublish] Batch sync: total=${syncResult.total}, failed=${syncResult.failed.length}`)
            } catch (batchError) {
                console.error('[autoPublish] Batch sync error:', batchError)
            }
        }

        return true
    } catch (error) {
        console.error(`[autoPublish] Unexpected error:`, error)
        return false
    }
}

async function sendPublishNotifications(source: 'quiz' | 'exam', parent: any) {
    try {
        const classData = parent.teaching_assignment?.class as any
        const schoolId = Array.isArray(classData) ? classData[0]?.school_id : classData?.school_id
        const labels = await getMenuLabelsForSchool(schoolId ?? null)
        const titleType = source === 'quiz' ? labels.kuis : labels.ulangan
        const link = source === 'quiz' ? '/dashboard/siswa/kuis' : '/dashboard/siswa/ulangan'
        const typeEnum = source === 'quiz' ? 'KUIS_BARU' : 'ULANGAN_BARU'

        // Notify Guru
        if (parent.teaching_assignment_id) {
            const { data: ta, error: taError } = await supabase
                .from('teaching_assignments')
                .select('teacher:teachers(user_id)')
                .eq('id', parent.teaching_assignment_id)
                .single()

            console.log(`[autoPublish-NOTIF] ta query result:`, JSON.stringify(ta), 'error:', taError)
            const teacherData = ta?.teacher as any
            const teacherUserId = Array.isArray(teacherData) ? teacherData[0]?.user_id : teacherData?.user_id
            console.log(`[autoPublish-NOTIF] teacherUserId=${teacherUserId}`)

            if (teacherUserId) {
                const { error: insertErr } = await supabase.from('notifications').insert({
                    user_id: teacherUserId,
                    type: 'SYSTEM',
                    title: `✅ ${titleType} Selesai Direview & Dipublikasikan`,
                    message: `${titleType} "${parent.title}" telah selesai di review dan sudah di publish.`,
                    link: source === 'quiz' ? `/dashboard/guru/kuis/${parent.id}` : `/dashboard/guru/ulangan/${parent.id}`
                })
                console.log(`[autoPublish-NOTIF] guru notification insert error:`, insertErr)
            }
        } else {
            console.log(`[autoPublish-NOTIF] No teaching_assignment_id on parent`)
        }

        // Notify Students
        if (parent.teaching_assignment?.class_id) {
            // Derive school_id from the teaching assignment's class
            const classData = parent.teaching_assignment.class as any
            const schoolId = Array.isArray(classData) ? classData[0]?.school_id : classData?.school_id

            // Remedial: notifikasi HANYA ke siswa terdaftar (allowed_student_ids) —
            // bukan seluruh kelas. Tanpa ini judul "[Remedial] ..." bocor ke
            // seluruh kelas dan non-peserta dapat spam untuk kuis yang tidak
            // bisa mereka kerjakan.
            if ((parent as any).is_remedial && Array.isArray((parent as any).allowed_student_ids) && (parent as any).allowed_student_ids.length > 0) {
                const { data: remedialStudents } = await supabase
                    .from('students')
                    .select('user_id')
                    .in('id', (parent as any).allowed_student_ids)

                if (remedialStudents && remedialStudents.length > 0) {
                    const subjectName = parent.teaching_assignment.subject?.name || ''
                    const startDate = parent.start_time ? ` Mulai: ${new Date(parent.start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}` : ''

                    await supabase.from('notifications').insert(
                        remedialStudents.map((s: any) => ({
                            user_id: s.user_id || '',
                            type: typeEnum,
                            title: `${titleType} Remedial: ${parent.title}`,
                            message: `${subjectName} - ${parent.duration_minutes || 0} menit.${startDate}`,
                            link
                        }))
                    )
                }
                return
            }

            let yearQuery = supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)

            if (schoolId) {
                yearQuery = yearQuery.eq('school_id', schoolId)
            }

            const { data: activeYears } = await yearQuery.order('created_at', { ascending: false }).limit(2)
            if ((activeYears || []).length > 1) {
                console.warn(`[autoPublish] Sekolah punya ${activeYears!.length} tahun aktif — pakai yang terbaru`)
            }
            const activeYear = activeYears?.[0] || null

            if (activeYear) {
                const { data: enrollments } = await supabase
                    .from('student_enrollments')
                    .select('student:students(user_id)')
                    .eq('academic_year_id', activeYear.id)
                    .eq('class_id', parent.teaching_assignment.class_id)

                if (enrollments && enrollments.length > 0) {
                    const subjectName = parent.teaching_assignment.subject?.name || ''
                    const startDate = parent.start_time ? ` Mulai: ${new Date(parent.start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}` : ''

                    await supabase.from('notifications').insert(
                        enrollments.map((e) => {
                            const studentData = e.student as any
                            const studentUserId = Array.isArray(studentData) ? studentData[0]?.user_id : studentData?.user_id

                            return {
                                user_id: studentUserId || '',
                                type: typeEnum,
                                title: `${titleType} Baru: ${parent.title}`,
                                message: `${subjectName} - ${parent.duration_minutes || 0} menit.${startDate}`,
                                link
                            }
                        })
                    )
                }
            }
        }
    } catch (error) {
        console.error(`[autoPublish] Error sending notifications:`, error)
    }
}
