import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // Only GURU and ADMIN can monitor
        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const examId = request.nextUrl.searchParams.get('exam_id')
        if (!examId) {
            return NextResponse.json({ error: 'exam_id required' }, { status: 400 })
        }

        // 1. Fetch Exam Details
        const { data: exam, error: examError } = await supabase
            .from('official_exams')
            .select(`
                id, title, exam_type, duration_minutes, start_time, is_active, max_violations, subject_id, target_class_ids,
                subject:subjects(name)
            `)
            .eq('id', examId)
            .single()

        if (examError || !exam) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }

        // Fetch question count for this exam
        const { count: totalQuestions } = await supabase
            .from('official_exam_questions')
            .select('id', { count: 'exact', head: true })
            .eq('exam_id', examId)

        const examData: any = {
            ...exam,
            subject_name: Array.isArray(exam.subject) ? exam.subject[0]?.name : (exam.subject as any)?.name || 'Unknown Subject',
            total_questions: totalQuestions || 0
        }

        // 2. Fetch target classes info
        const { data: classesData } = await supabase
            .from('classes')
            .select('id, name')
            .in('id', exam.target_class_ids || [])

        examData.target_classes = classesData || []

        // 3. For GURU: Verify they teach this subject in at least one of these classes
        // (Admins can see everything)
        let allowedClassIds = exam.target_class_ids || []
        
        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()

            if (!teacher) {
                return NextResponse.json({ error: 'Teacher profile not found' }, { status: 404 })
            }

            const { data: activeYear } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .single()

            const { data: assignments } = await supabase
                .from('teaching_assignments')
                .select('class_id')
                .eq('teacher_id', teacher.id)
                .eq('academic_year_id', activeYear?.id || '')
                .eq('subject_id', exam.subject_id)

            const teacherClassIds = assignments?.map(a => a.class_id) || []
            
            // Intersection of exam's target classes and classes the teacher actually teaches for this subject
            allowedClassIds = (exam.target_class_ids || []).filter((id: string) => teacherClassIds.includes(id))

            if (allowedClassIds.length === 0) {
                return NextResponse.json({ error: 'You do not teach any classes for this exam' }, { status: 403 })
            }
        }

        // 4. Fetch all students in the allowed target classes
        const { data: students } = await supabase
            .from('students')
            .select(`
                id, nis, class_id,
                user:users!students_user_id_fkey(full_name),
                class:classes(name)
            `)
            .in('class_id', allowedClassIds)

        if (!students || students.length === 0) {
            return NextResponse.json({
                exam: examData,
                students: [],
                summary: { total_target_students: 0, not_started: 0, working: 0, submitted: 0 }
            })
        }

        // 5. Fetch submissions for these students
        const studentIds = students.map(s => s.id)
        const { data: submissions } = await supabase
            .from('official_exam_submissions')
            .select(`
                id, student_id, is_submitted, is_graded, violation_count, started_at, submitted_at,
                total_score, max_score,
                answers:official_exam_answers(count)
            `)
            .eq('exam_id', examId)
            .in('student_id', studentIds)

        // Map submissions for quick lookup
        const submissionMap = new Map()
        if (submissions) {
            submissions.forEach(sub => {
                // The answers relation returns an array with a single object containing the count if we use `count` aggregate
                // But Supabase JS client syntax for join count aggregate `relation(count)` returns it in a specific format
                // In JS client v2, we usually have to query it separately or handle the result structure
                // For simplicity, let's just query the answer counts separately if there are submissions
                submissionMap.set(sub.student_id, sub)
            })
        }

        // Fetch answer counts per submission using batched queries to avoid 1000-row limit
        const submissionIds = submissions?.map(s => s.id) || []
        const answerCounts = new Map()
        if (submissionIds.length > 0) {
            // Query count for each submission individually using Promise.all
            // This is more reliable than fetching all rows (which hits Supabase 1000-row limit)
            const countPromises = submissionIds.map(async (subId) => {
                const { count } = await supabase
                    .from('official_exam_answers')
                    .select('id', { count: 'exact', head: true })
                    .eq('submission_id', subId)
                return { subId, count: count || 0 }
            })
            const counts = await Promise.all(countPromises)
            counts.forEach(({ subId, count }) => answerCounts.set(subId, count))
        }

        const now = new Date()
        const nowTime = now.getTime()
        const durationMs = exam.duration_minutes * 60 * 1000

        // Server-side auto-submit: detect and submit expired but unsubmitted entries
        const expiredSubmissionIds: string[] = []
        if (submissions) {
            for (const sub of submissions) {
                if (!sub.is_submitted) {
                    const startedTime = new Date(sub.started_at).getTime()
                    const endTarget = startedTime + durationMs
                    if (nowTime > endTarget) {
                        expiredSubmissionIds.push(sub.id)
                    }
                }
            }
        }

        // Auto-submit all expired submissions
        if (expiredSubmissionIds.length > 0) {
            // Check if exam has essays
            const { data: examQuestions } = await supabase
                .from('official_exam_questions')
                .select('question_type')
                .eq('exam_id', examId)
            const hasEssays = examQuestions?.some(q => q.question_type === 'ESSAY') || false

            for (const subId of expiredSubmissionIds) {
                const sub = submissions!.find(s => s.id === subId)
                if (!sub) continue // Safety check

                // Calculate score from existing answers
                const { data: existingAnswers } = await supabase
                    .from('official_exam_answers')
                    .select('points_earned')
                    .eq('submission_id', subId)
                const totalScore = existingAnswers?.reduce((sum, a) => sum + (a.points_earned || 0), 0) || 0

                const startedTime = new Date(sub.started_at).getTime()
                const expectedSubmittedAt = new Date(startedTime + durationMs).toISOString()

                await supabase
                    .from('official_exam_submissions')
                    .update({
                        is_submitted: true,
                        submitted_at: expectedSubmittedAt,
                        total_score: totalScore,
                        is_graded: !hasEssays
                    })
                    .eq('id', subId)

                // Update local data so the response reflects the change
                sub.is_submitted = true
                sub.submitted_at = expectedSubmittedAt
                sub.total_score = totalScore
                sub.is_graded = !hasEssays
            }
        }

        let notStartedCount = 0
        let workingCount = 0
        let submittedCount = 0

        // 6. Assemble the final student progress list
        const processedStudents = students.map(student => {
            const sub = submissionMap.get(student.id)
            let status = 'not_started'
            let timeRemainingSec = null
            
            if (sub) {
                if (sub.is_submitted) {
                    status = 'submitted'
                    submittedCount++
                } else {
                    status = 'working'
                    workingCount++
                    
                    const startedTime = new Date(sub.started_at).getTime()
                    const endTarget = startedTime + durationMs
                    timeRemainingSec = Math.max(0, Math.floor((endTarget - nowTime) / 1000))
                }
            } else {
                notStartedCount++
            }

            const answeredCount = sub ? (answerCounts.get(sub.id) || 0) : 0

            return {
                student_id: student.id,
                submission_id: sub?.id || null,
                student_name: Array.isArray(student.user) ? student.user[0]?.full_name : (student.user as any)?.full_name || 'Tanpa Nama',
                nis: student.nis || '-',
                class_name: Array.isArray(student.class) ? student.class[0]?.name : (student.class as any)?.name || '-',
                status,
                answered_count: answeredCount,
                total_questions: examData.total_questions,
                violation_count: sub?.violation_count || 0,
                started_at: sub?.started_at || null,
                submitted_at: sub?.submitted_at || null,
                time_remaining_seconds: timeRemainingSec,
                total_score: sub?.total_score ?? null,
                max_score: sub?.max_score ?? null,
                is_graded: sub?.is_graded ?? false
            }
        })

        return NextResponse.json({
            exam: examData,
            students: processedStudents,
            summary: {
                total_target_students: students.length,
                not_started: notStartedCount,
                working: workingCount,
                submitted: submittedCount
            }
        })

    } catch (error) {
        console.error('Error in monitor API:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
