import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { gradeAnswer, needsManualGrading } from '@/lib/questionTypeUtils'

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
                student:students(id, nis, class_id, user:users!students_user_id_fkey(full_name), class:classes(id, school_level, grade_level)),
                exam:official_exams(
                    id, title, exam_type, duration_minutes, is_active, subject_id, school_id,
                    academic_year_id, target_class_ids,
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

        // Scope multi-tenant: submission hanya milik sekolah user
        if (schoolId) {
            result = result.filter((s: any) => (s.exam as any)?.school_id === schoolId)
        }

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
            // A guru sees submissions for official exams they teach: the exam's subject in
            // one of the exam's target classes. target_class_ids are unique per academic
            // year, so this is correct across years — unlike the old check on
            // student.class_id (current class), which dropped students who had moved up.
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()

            if (teacher) {
                const examIds = [...new Set(result.map((s: any) => s.exam_id))]
                const { data: exams } = await supabase
                    .from('official_exams')
                    .select('id, subject_id, target_class_ids')
                    .in('id', examIds.length ? examIds : ['00000000-0000-0000-0000-000000000000'])
                const examById = new Map((exams || []).map((e: any) => [e.id, e]))

                const targetClassIds = [...new Set((exams || []).flatMap((e: any) => e.target_class_ids || []))]
                const { data: taught } = await supabase
                    .from('teaching_assignments')
                    .select('subject_id, class_id')
                    .eq('teacher_id', teacher.id)
                    .in('class_id', targetClassIds.length ? targetClassIds : ['00000000-0000-0000-0000-000000000000'])
                const taughtKey = new Set((taught || []).map((a: any) => `${a.subject_id}|${a.class_id}`))

                result = result.filter((sub: any) => {
                    const ex = examById.get(sub.exam_id)
                    if (!ex) return false
                    return (ex.target_class_ids || []).some((cid: string) =>
                        taughtKey.has(`${ex.subject_id}|${cid}`)
                    )
                })
            } else {
                result = []
            }
        }

        // Additional class filter — resolve the student's class IN THE EXAM'S YEAR via
        // enrollment (not current class_id), so filtering works for past exams too.
        if (classId) {
            const studentIds = [...new Set(result.map((s: any) => s.student_id))]
            const examYears = new Set<string>()
            result.forEach((s: any) => {
                const ex: any = Array.isArray(s.exam) ? s.exam[0] : s.exam
                if (ex?.academic_year_id) examYears.add(ex.academic_year_id)
            })
            const { data: enrollments } = await supabase
                .from('student_enrollments')
                .select('student_id, class_id, academic_year_id')
                .in('student_id', studentIds.length ? studentIds : ['00000000-0000-0000-0000-000000000000'])
                .in('academic_year_id', examYears.size ? [...examYears] : ['00000000-0000-0000-0000-000000000000'])
            const studentYearClass = new Map<string, string>()
            ;(enrollments || []).forEach((e: any) =>
                studentYearClass.set(`${e.student_id}|${e.academic_year_id}`, e.class_id)
            )
            result = result.filter((sub: any) => {
                const ex: any = Array.isArray(sub.exam) ? sub.exam[0] : sub.exam
                const year = ex?.academic_year_id
                const sc = year ? studentYearClass.get(`${sub.student_id}|${year}`) : undefined
                return sc === classId
            })
        }

        // Server-side auto-submit: detect and submit expired but unsubmitted entries
        // This catches submissions where the student's browser closed before auto-submit could fire
        if (user.role === 'GURU' || user.role === 'ADMIN') {
            const now = Date.now()
            const expiredSubs = result.filter((sub: any) => {
                if (sub.is_submitted) return false
                const examObj = Array.isArray(sub.exam) ? sub.exam[0] : sub.exam
                if (!examObj?.duration_minutes || !sub.started_at) return false
                const startedAt = new Date(sub.started_at).getTime()
                const endTime = startedAt + examObj.duration_minutes * 60 * 1000
                return now > endTime
            })

            if (expiredSubs.length > 0) {
                for (const sub of expiredSubs) {
                    const examObj = Array.isArray(sub.exam) ? sub.exam[0] : sub.exam
                    const durationMs = examObj.duration_minutes * 60 * 1000
                    const startedAt = new Date(sub.started_at).getTime()
                    const expectedSubmittedAt = new Date(startedAt + durationMs).toISOString()

                    // Calculate score from existing answers
                    const { data: existingAnswers } = await supabase
                        .from('official_exam_answers')
                        .select('points_earned')
                        .eq('submission_id', sub.id)
                    const totalScore = existingAnswers?.reduce((sum: number, a: any) => sum + (a.points_earned || 0), 0) || 0

                    // Check if exam has essays
                    const { data: examQuestions } = await supabase
                        .from('official_exam_questions')
                        .select('question_type')
                        .eq('exam_id', sub.exam_id)
                    const hasEssays = examQuestions?.some((q: any) => needsManualGrading(q.question_type)) || false

                    await supabase
                        .from('official_exam_submissions')
                        .update({
                            is_submitted: true,
                            submitted_at: expectedSubmittedAt,
                            total_score: totalScore,
                            is_graded: !hasEssays
                        })
                        .eq('id', sub.id)

                    // Update local data so the response reflects the change
                    sub.is_submitted = true
                    sub.submitted_at = expectedSubmittedAt
                    sub.total_score = totalScore
                    sub.is_graded = !hasEssays
                }
            }
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
                        student:students(id, nis, class_id, user:users!students_user_id_fkey(full_name), class:classes(id, school_level, grade_level)),
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
        const { user, schoolId } = ctx

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

        // Check if exam exists
        const { data: exam } = await supabase
            .from('official_exams')
            .select('*, official_exam_questions(id)')
            .eq('id', exam_id)
            .single()

        if (!exam) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }

        // Resume dulu: submission yang sudah berjalan tidak boleh terkunci
        // (mis. auto-deaktivasi saat window lewat, atau reload di tengah ujian)
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

        // === Sesi baru: semua gate wajib lolos ===
        if (!exam.is_active) {
            return NextResponse.json({ error: 'Ujian belum dibuka' }, { status: 400 })
        }

        // Kelas siswa: utamakan enrollment ACTIVE di tahun aktif (selaras jalur notifikasi)
        let studentClassId = student.class_id
        if (schoolId) {
            const { data: activeYears } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .order('created_at', { ascending: false })
                .limit(1)
            const yearId = activeYears?.[0]?.id
            if (yearId) {
                const { data: enrollment } = await supabase
                    .from('student_enrollments')
                    .select('class_id')
                    .eq('student_id', student.id)
                    .eq('academic_year_id', yearId)
                    .eq('status', 'ACTIVE')
                    .maybeSingle()
                if (enrollment?.class_id) studentClassId = enrollment.class_id
            }
        }

        // Check if student's class is in target_class_ids
        if (!exam.target_class_ids?.includes(studentClassId)) {
            return NextResponse.json({ error: 'Anda tidak terdaftar dalam ujian ini' }, { status: 403 })
        }

        // C3 Hotfix: Remedial guard
        if (exam.is_remedial && exam.allowed_student_ids && exam.allowed_student_ids.length > 0) {
            if (!exam.allowed_student_ids.includes(student.id)) {
                return NextResponse.json({ error: 'Anda tidak terdaftar untuk ujian remedial ini' }, { status: 403 })
            }
        }

        // Check start time + window pengerjaan
        const now = new Date()
        const startTime = new Date(exam.start_time)
        if (now < startTime) {
            return NextResponse.json({ error: 'Ujian belum dimulai' }, { status: 400 })
        }
        const endTime = new Date(startTime.getTime() + (exam.duration_minutes || 0) * 60 * 1000)
        if (now > endTime) {
            return NextResponse.json({ error: 'Waktu pengerjaan ujian sudah berakhir' }, { status: 400 })
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
                    if (q) {
                        if (!needsManualGrading(q.question_type)) {
                            const graded = gradeAnswer(
                                q.question_type,
                                ans.answer,
                                q.correct_answer,
                                null,
                                q.points || 10
                            )
                            totalScore += graded.pointsEarned
                        } else {
                            hasEssays = true
                        }
                    }
                })

                const { data: examQuestions } = await supabase
                    .from('official_exam_questions')
                    .select('question_type')
                    .eq('exam_id', currentSubmission.exam_id)
                hasEssays = hasEssays || (examQuestions?.some((q: any) => needsManualGrading(q.question_type)) || false)

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
                .select('id, correct_answer, options, points, question_type')
                .eq('exam_id', currentSubmission.exam_id)

            const questionMap = new Map<string, { correct_answer: string; options: string[] | null; points: number; question_type: string }>()
            allQuestions?.forEach((q: any) => questionMap.set(q.id, q))

            const gradedAnswers = answers.map((ans: { question_id: string; answer: string }) => {
                const question = questionMap.get(ans.question_id)
                
                let isCorrect = false
                let pointsEarned = 0

                if (question) {
                    const graded = gradeAnswer(
                        question.question_type,
                        ans.answer,
                        question.correct_answer,
                        question.options,
                        question.points || 10
                    )
                    isCorrect = graded.isCorrect
                    pointsEarned = graded.pointsEarned
                }

                return {
                    submission_id,
                    question_id: ans.question_id,
                    answer: ans.answer,
                    is_correct: isCorrect,
                    points_earned: Math.round(pointsEarned)
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

            const hasEssays = examQuestions?.some((q: any) => needsManualGrading(q.question_type)) || false

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
