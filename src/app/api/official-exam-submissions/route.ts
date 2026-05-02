import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET official exam submissions
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const examId = request.nextUrl.searchParams.get('exam_id')
        const studentId = request.nextUrl.searchParams.get('student_id')
        const classId = request.nextUrl.searchParams.get('class_id')

        let query = supabase
            .from('official_exam_submissions')
            .select(`
                id, exam_id, student_id, started_at, submitted_at, is_submitted,
                total_score, max_score, violation_count, violations_log, is_graded, created_at,
                student:students(id, nis, class_id, user:users!students_user_id_fkey(full_name)),
                exam:official_exams(
                    id, title, exam_type, duration_minutes, is_active, subject_id,
                    show_results_immediately, results_released,
                    subject:subjects(id, name, kkm)
                )
            `)
            .order('created_at', { ascending: false })

        if (examId) {
            query = query.eq('exam_id', examId)
        }
        if (studentId) {
            query = query.eq('student_id', studentId)
        }

        const { data, error } = await query
        if (error) throw error

        let result = data || []

        // Role-based filtering
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()
            if (student) {
                result = result.filter((s: any) => s.student_id === student.id)
            } else {
                result = []
            }
        } else if (user.role === 'GURU') {
            // Guru can only see submissions of students in their assigned classes for their subjects
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

                const { data: assignments } = await supabase
                    .from('teaching_assignments')
                    .select('subject_id, class_id')
                    .eq('teacher_id', teacher.id)
                    .eq('academic_year_id', activeYear?.id || '')

                if (assignments && assignments.length > 0) {
                    const teacherClassIds = [...new Set(assignments.map(a => a.class_id))]
                    const teacherSubjectIds = [...new Set(assignments.map(a => a.subject_id))]

                    result = result.filter((sub: any) => {
                        const studentClassId = sub.student?.class_id
                        const examSubjectId = sub.exam?.subject_id
                        return teacherClassIds.includes(studentClassId) &&
                               teacherSubjectIds.includes(examSubjectId)
                    })
                } else {
                    result = []
                }
            } else {
                result = []
            }
        }

        // Additional class filter
        if (classId) {
            result = result.filter((sub: any) => sub.student?.class_id === classId)
        }

        // If filtering by examId and the user is ADMIN/GURU, fetch remedial submissions and merge by highest score
        if (examId && (user.role === 'GURU' || user.role === 'ADMIN')) {
            const { data: remedials } = await supabase
                .from('official_exams')
                .select('id')
                .eq('remedial_for_id', examId)

            if (remedials && remedials.length > 0) {
                const remedialIds = remedials.map(r => r.id)
                const { data: remedialSubmissions } = await supabase
                    .from('official_exam_submissions')
                    .select(`
                        *,
                        student:students(id, nis, class_id, user:users!students_user_id_fkey(full_name)),
                        exam:official_exams(
                            id, title, exam_type, duration_minutes, is_active, subject_id,
                            show_results_immediately, results_released,
                            subject:subjects(id, name, kkm)
                        )
                    `)
                    .in('exam_id', remedialIds)

                if (remedialSubmissions && remedialSubmissions.length > 0) {
                    const studentHighestSubmissions = new Map<string, any>()

                    // Add all original submissions first
                    result.forEach((sub: any) => {
                        studentHighestSubmissions.set(sub.student?.id, sub)
                    })

                    // Overwrite if remedial score is higher or equal
                    remedialSubmissions.forEach((sub: any) => {
                        const studentId = sub.student?.id
                        if (!studentId) return

                        const existing = studentHighestSubmissions.get(studentId)
                        const currentScore = ((sub.total_score || 0) / (sub.max_score || 1))
                        const existingScore = existing ? ((existing.total_score || 0) / (existing.max_score || 1)) : -1

                        if (currentScore >= existingScore) {
                            studentHighestSubmissions.set(studentId, sub)
                        }
                    })

                    result = Array.from(studentHighestSubmissions.values())
                    // Sort by submitted_at again just in case (using created_at as backup if needed)
                    result.sort((a: any, b: any) => {
                        const dateA = a.submitted_at ? new Date(a.submitted_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
                        const dateB = b.submitted_at ? new Date(b.submitted_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
                        return dateB - dateA;
                    });
                }
            }
        }

        // Apply visibility rules for SISWA
        if (user.role === 'SISWA') {
            result = result.map((sub: any) => {
                const examObj = sub.exam || {}
                const showImmediately = examObj.show_results_immediately ?? true
                const isReleased = examObj.results_released || false
                const isHidden = !showImmediately && !isReleased

                if (isHidden) {
                    return {
                        ...sub,
                        total_score: null,
                        max_score: null,
                        results_hidden: true
                    }
                }
                return { ...sub, results_hidden: false }
            })
        }

        return NextResponse.json(result)
    } catch (error) {
        console.error('Error fetching official exam submissions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST start official exam (student creates submission)
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'SISWA') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { exam_id } = await request.json()
        if (!exam_id) {
            return NextResponse.json({ error: 'exam_id required' }, { status: 400 })
        }

        // Get student record
        const { data: student } = await supabase
            .from('students')
            .select('id, class_id')
            .eq('user_id', user.id)
            .single()

        if (!student) {
            return NextResponse.json({ error: 'Student not found' }, { status: 404 })
        }

        // Check if exam exists and is active
        const { data: exam } = await supabase
            .from('official_exams')
            .select('*, official_exam_questions(id)')
            .eq('id', exam_id)
            .single()

        if (!exam) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }
        if (!exam.is_active) {
            return NextResponse.json({ error: 'Ujian belum dibuka' }, { status: 400 })
        }

        // Check if student's class is in target_class_ids
        if (!exam.target_class_ids?.includes(student.class_id)) {
            return NextResponse.json({ error: 'Anda tidak terdaftar dalam ujian ini' }, { status: 403 })
        }

        // C3 Hotfix: Remedial guard
        if (exam.is_remedial && exam.allowed_student_ids && exam.allowed_student_ids.length > 0) {
            if (!exam.allowed_student_ids.includes(student.id)) {
                return NextResponse.json({ error: 'Anda tidak terdaftar untuk ujian remedial ini' }, { status: 403 })
            }
        }

        // Check start time
        const now = new Date()
        const startTime = new Date(exam.start_time)
        if (now < startTime) {
            return NextResponse.json({ error: 'Ujian belum dimulai' }, { status: 400 })
        }

        // Check if already submitted
        const { data: existingSubmission } = await supabase
            .from('official_exam_submissions')
            .select('id, is_submitted, question_order, started_at, violation_count, max_score')
            .eq('exam_id', exam_id)
            .eq('student_id', student.id)
            .single()

        if (existingSubmission?.is_submitted) {
            return NextResponse.json({ error: 'Anda sudah mengumpulkan ujian ini' }, { status: 400 })
        }

        if (existingSubmission) {
            return NextResponse.json(existingSubmission)
        }

        // Create randomized question order if enabled
        const questionIds = exam.official_exam_questions.map((q: any) => q.id)
        const questionOrder = exam.is_randomized
            ? questionIds.sort(() => Math.random() - 0.5)
            : questionIds

        // Calculate max score
        const { data: questions } = await supabase
            .from('official_exam_questions')
            .select('points')
            .eq('exam_id', exam_id)

        const maxScore = questions?.reduce((sum: number, q: any) => sum + (q.points || 10), 0) || 0

        // Create new submission
        const { data: submission, error } = await supabase
            .from('official_exam_submissions')
            .insert({
                exam_id,
                student_id: student.id,
                question_order: questionOrder,
                max_score: maxScore,
                started_at: new Date().toISOString()
            })
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(submission)
    } catch (error) {
        console.error('Error starting official exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update submission (save answers, submit, log violations)
export async function PUT(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        const body = await request.json()
        const { submission_id, answers, submit, violation, reset_attempt } = body

        if (!submission_id) {
            return NextResponse.json({ error: 'submission_id required' }, { status: 400 })
        }

        // Get current submission
        const { data: currentSubmission } = await supabase
            .from('official_exam_submissions')
            .select('*, exam:official_exams(max_violations, show_results_immediately, results_released)')
            .eq('id', submission_id)
            .single()

        if (!currentSubmission) {
            return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
        }

        // Handle reset attempt (Admin only) — must be checked BEFORE the is_submitted guard
        if (reset_attempt) {
            if (user.role !== 'ADMIN') {
                return NextResponse.json({ error: 'Hanya admin yang dapat mereset attempt siswa' }, { status: 403 })
            }

            if (!currentSubmission.is_submitted) {
                return NextResponse.json({ error: 'Submission belum di-submit, tidak perlu di-reset' }, { status: 400 })
            }

            if (reset_attempt === 'hard') {
                // Delete existing answers for Hard Reset
                const { error: deleteAnswersError } = await supabase
                    .from('official_exam_answers')
                    .delete()
                    .eq('submission_id', submission_id)

                if (deleteAnswersError) throw deleteAnswersError
            }

            const updateData: any = {
                is_submitted: false,
                submitted_at: null,
                violation_count: 0,
                violations_log: [],
                total_score: 0,
                is_graded: false
            }

            // Hard reset: fresh timer
            if (reset_attempt === 'hard') {
                updateData.started_at = new Date().toISOString()
            }

            const { data: resetSubmission, error: resetError } = await supabase
                .from('official_exam_submissions')
                .update(updateData)
                .eq('id', submission_id)
                .select()
                .single()

            if (resetError) throw resetError

            return NextResponse.json({
                reset_success: true,
                message: reset_attempt === 'hard' 
                    ? 'Hard reset berhasil. Jawaban dihapus dan timer di-reset.' 
                    : 'Soft reset berhasil. Siswa dapat melanjutkan dengan sisa waktu.',
                submission: resetSubmission
            })
        }

        // Verify ownership for SISWA
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()
            if (!student || currentSubmission.student_id !== student.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        } else if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        if (currentSubmission.is_submitted) {
            return NextResponse.json({ error: 'Already submitted' }, { status: 400 })
        }

        // Handle violation logging
        if (violation) {
            const currentViolations = currentSubmission.violations_log || []
            
            // Server-side deduplication (3 second gap)
            if (currentViolations.length > 0) {
                const lastViolation = currentViolations[currentViolations.length - 1]
                const lastTime = new Date(lastViolation.timestamp).getTime()
                const now = new Date().getTime()
                if (now - lastTime < 3000) {
                    return NextResponse.json({
                        violation_count: currentSubmission.violation_count,
                        max_violations: currentSubmission.exam?.max_violations || 3
                    }) // Ignore duplicate
                }
            }

            const newViolationCount = currentSubmission.violation_count + 1
            const maxViolations = currentSubmission.exam?.max_violations || 3

            await supabase
                .from('official_exam_submissions')
                .update({
                    violation_count: newViolationCount,
                    violations_log: [...currentViolations, {
                        type: violation.type,
                        timestamp: new Date().toISOString()
                    }]
                })
                .eq('id', submission_id)

            // Force submit if max violations exceeded
            if (newViolationCount >= maxViolations) {
                const { data: existingAnswers } = await supabase
                    .from('official_exam_answers')
                    .select('*, question:official_exam_questions(correct_answer, points, question_type)')
                    .eq('submission_id', submission_id)

                let totalScore = 0
                let hasEssays = false
                existingAnswers?.forEach((ans: any) => {
                    const q = Array.isArray(ans.question) ? ans.question[0] : ans.question
                    if (ans.answer === q?.correct_answer) {
                        totalScore += q?.points || 10
                    }
                    if (q?.question_type === 'ESSAY') hasEssays = true
                })

                const { data: examQuestions } = await supabase
                    .from('official_exam_questions')
                    .select('question_type')
                    .eq('exam_id', currentSubmission.exam_id)
                hasEssays = hasEssays || (examQuestions?.some((q: any) => q.question_type === 'ESSAY') || false)

                await supabase
                    .from('official_exam_submissions')
                    .update({
                        is_submitted: true,
                        submitted_at: new Date().toISOString(),
                        total_score: totalScore,
                        is_graded: !hasEssays
                    })
                    .eq('id', submission_id)

                return NextResponse.json({
                    force_submitted: true,
                    message: 'Ujian otomatis dikumpulkan karena pelanggaran melebihi batas'
                })
            }

            return NextResponse.json({
                violation_count: newViolationCount,
                max_violations: maxViolations
            })
        }

        // Handle saving answers
        if (answers && Array.isArray(answers) && answers.length > 0) {
            const { data: allQuestions } = await supabase
                .from('official_exam_questions')
                .select('id, correct_answer, points, question_type')
                .eq('exam_id', currentSubmission.exam_id)

            const questionMap = new Map<string, { correct_answer: string; points: number; question_type: string }>()
            allQuestions?.forEach((q: any) => questionMap.set(q.id, q))

            const gradedAnswers = answers.map((ans: { question_id: string; answer: string }) => {
                const question = questionMap.get(ans.question_id)
                const isCorrect = question?.correct_answer === ans.answer
                const pointsEarned = isCorrect ? (question?.points || 10) : 0

                return {
                    submission_id,
                    question_id: ans.question_id,
                    answer: ans.answer,
                    is_correct: isCorrect,
                    points_earned: pointsEarned
                }
            })

            const { error: upsertError } = await supabase
                .from('official_exam_answers')
                .upsert(gradedAnswers, {
                    onConflict: 'submission_id,question_id'
                })

            if (upsertError) throw upsertError
        }

        // Handle final submission
        if (submit) {
            const { data: allAnswers } = await supabase
                .from('official_exam_answers')
                .select('points_earned')
                .eq('submission_id', submission_id)

            const totalScore = allAnswers?.reduce((sum: number, a: any) => sum + (a.points_earned || 0), 0) || 0

            const { data: examQuestions } = await supabase
                .from('official_exam_questions')
                .select('question_type')
                .eq('exam_id', currentSubmission.exam_id)

            const hasEssays = examQuestions?.some((q: any) => q.question_type === 'ESSAY') || false

            const { data: updatedSubmission, error } = await supabase
                .from('official_exam_submissions')
                .update({
                    is_submitted: true,
                    submitted_at: new Date().toISOString(),
                    total_score: totalScore,
                    is_graded: !hasEssays
                })
                .eq('id', submission_id)
                .select()
                .single()

            if (error) throw error

            const examConfig = currentSubmission.exam || {}
            const showImmediately = examConfig.show_results_immediately ?? true
            const isReleased = examConfig.results_released || false
            const isHidden = !showImmediately && !isReleased

            const responseData = { ...updatedSubmission, results_hidden: isHidden }
            if (isHidden) {
                responseData.total_score = null
                responseData.max_score = null
            }

            return NextResponse.json(responseData)
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error updating official exam submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
