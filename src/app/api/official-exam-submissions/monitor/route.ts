import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { needsManualGrading } from '@/lib/questionTypeUtils'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { getExamQuestionsForGrading } from '@/lib/examQuestionsCache'
import { getAnswerStats } from '@/lib/monitorAnswerStats'
import { resolveWindowExpiry, isSweepDue, endsAtIso } from '@/lib/examExpiry'

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
                id, title, exam_type, duration_minutes, start_time, window_end_time, is_active, max_violations, subject_id, target_class_ids,
                subject:subjects(id, name, kkm, school_id)
            `)
            .eq('id', examId)
            .single()

        if (examError || !exam) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }

        // Tenant guard: exam harus milik sekolah user. Anchor via subject
        // (school_id NOT NULL; official_exams tidak punya kolom school_id).
        // 404 agar keberadaan exam lintas-sekolah tidak bocor.
        const subjectTenantAny = exam.subject as any
        const subjectTenant = Array.isArray(subjectTenantAny) ? subjectTenantAny[0] : subjectTenantAny
        if (!subjectTenant || subjectTenant.school_id !== schoolId) {
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
            subject_kkm: Array.isArray(exam.subject) ? exam.subject[0]?.kkm : (exam.subject as any)?.kkm || 75,
            total_questions: totalQuestions || 0
        }

        // 2. Fetch target classes info
        const { data: classesData } = await supabase
            .from('classes')
            .select('id, name, school_level, grade_level')
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

        // 4. Fetch students enrolled in the allowed target classes (year-aware).
        //    target_class_ids are unique per academic year, and enrollment records persist
        //    after promotion/graduation — so this returns the correct roster even for past
        //    exams. students.class_id (current) would drop students who have since moved up.
        // fetchAllRows: roster seangkatan/sekolah bisa >1000 baris — query biasa
        // terpotong diam-diam pada limit 1000 baris PostgREST
        const rosterEnrollments = await fetchAllRows(
            supabase
                .from('student_enrollments')
                .select(`
                    class_id,
                    student:students!student_enrollments_student_id_fkey(
                        id, nis,
                        user:users!students_user_id_fkey(full_name)
                    ),
                    class:classes!student_enrollments_class_id_fkey(id, name)
                `)
                .in('class_id', allowedClassIds)
        )

        const seenStudent = new Set<string>()
        const students: any[] = []
        for (const e of (rosterEnrollments || [])) {
            const s = e.student as any
            if (!s || seenStudent.has(s.id)) continue
            seenStudent.add(s.id)
            students.push({
                id: s.id,
                nis: s.nis,
                class_id: e.class_id,
                user: s.user,
                class: e.class
            })
        }

        if (!students || students.length === 0) {
            return NextResponse.json({
                exam: examData,
                students: [],
                summary: { total_target_students: 0, not_started: 0, working: 0, submitted: 0 }
            })
        }

        // 5. Fetch submissions for these students
        const studentIds = students.map(s => s.id)
        // batchedIn: ratusan–1088 student id dalam satu .in() membuat URL >16KB
        // dan PostgREST menolak dengan 500 — pecah per 100 id
        const submissions = await batchedIn('student_id', studentIds, (chunk) =>
            supabase
                .from('official_exam_submissions')
                .select(`
                    id, student_id, is_submitted, is_graded, violation_count, started_at, submitted_at, timer_override_until,
                    total_score, max_score
                `)
                .eq('exam_id', examId)
                .in('student_id', chunk)
        )

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

        // 5. Answer stats per submission — satu agregasi DB-side (RPC ber-index)
        //    menggantikan scan seluruh baris official_exam_answers: 1.000 siswa
        //    × 50 soal = 50.000+ baris + puluhan request PostgREST PER POLL sebelumnya.
        const submissionIds = submissions?.map(s => s.id) || []
        const answerStats = await getAnswerStats('official', examId, submissionIds)

        const now = new Date()
        const nowTime = now.getTime()

        // Server-side auto-submit: detect and submit expired but unsubmitted entries
        // Satu sumber kebenaran: mode serentak / jendela + override (src/lib/examExpiry.ts)
        const expiredSubmissionIds: string[] = []
        if (submissions) {
            for (const sub of submissions) {
                if (!sub.is_submitted) {
                    const expiry = resolveWindowExpiry(
                        { start_time: exam.start_time, duration_minutes: exam.duration_minutes, window_end_time: exam.window_end_time },
                        { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
                    )
                    if (isSweepDue(expiry, nowTime)) {
                        expiredSubmissionIds.push(sub.id)
                    }
                }
            }
        }

        // Auto-submit all expired submissions
        if (expiredSubmissionIds.length > 0) {
            // Soal dari cache in-memory (TTL 10 mnt) — sama dengan jalur autosave/submit
            const examQuestions = await getExamQuestionsForGrading('official_exam_questions', examId)
            const hasEssays = examQuestions.some(q => needsManualGrading(q.question_type)) || false

            // Update paralel per chunk 50 — menggantikan loop sekuensial
            // (SELECT answers + UPDATE per siswa = N+1 query saat massal).
            // Skor diambil dari agregasi RPC (answerStats), bukan SELECT per siswa.
            const CHUNK = 50
            for (let i = 0; i < expiredSubmissionIds.length; i += CHUNK) {
                await Promise.all(expiredSubmissionIds.slice(i, i + CHUNK).map(async (subId) => {
                    const sub = submissions!.find(s => s.id === subId)
                    if (!sub) return

                    const totalScore = answerStats.get(subId)?.points || 0

                    const expiry = resolveWindowExpiry(
                        { start_time: exam.start_time, duration_minutes: exam.duration_minutes, window_end_time: exam.window_end_time },
                        { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
                    )
                    const expectedSubmittedAt = endsAtIso(expiry) || new Date(sub.started_at).toISOString()

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
                }))
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

                    // Satu sumber kebenaran: mode serentak / jendela + override hard reset
                    const expiry = resolveWindowExpiry(
                        { start_time: exam.start_time, duration_minutes: exam.duration_minutes, window_end_time: exam.window_end_time },
                        { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
                    )
                    const endTarget = expiry.limited ? expiry.endAt : null
                    timeRemainingSec = endTarget !== null
                        ? Math.max(0, Math.floor((endTarget - nowTime) / 1000))
                        : null
                }
            } else {
                notStartedCount++
            }

            const answeredCount = sub ? (answerStats.get(sub.id)?.count || 0) : 0

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
