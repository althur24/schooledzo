import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// Helper: send notification to teacher when student submits exam
async function notifyTeacherExamSubmission(examId: string, studentName: string, isForceSubmit: boolean = false) {
    try {
        const { data: exam } = await supabase
            .from('exams')
            .select(`
                title,
                teaching_assignment:teaching_assignments(
                    teacher:teachers(user_id)
                )
            `)
            .eq('id', examId)
            .single()

        const teacherUserId = (exam?.teaching_assignment as any)?.teacher?.user_id
        if (teacherUserId) {
            await supabase.from('notifications').insert({
                user_id: teacherUserId,
                type: 'SUBMISSION_ULANGAN',
                title: isForceSubmit ? 'Ulangan Dikumpulkan Otomatis' : 'Ulangan Dikumpulkan',
                message: isForceSubmit
                    ? `${studentName} ulangan "${exam?.title}" dikumpulkan otomatis karena pelanggaran`
                    : `${studentName} telah mengumpulkan ulangan "${exam?.title}"`,
                link: `/dashboard/guru/ulangan`
            })
        }
    } catch (notifError) {
        console.error('Error sending exam submission notification:', notifError)
    }
}

// GET exam submissions
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const examId = request.nextUrl.searchParams.get('exam_id')
        const studentId = request.nextUrl.searchParams.get('student_id')
        const allYears = request.nextUrl.searchParams.get('all_years')

        // Lazy Sweep: Auto-close expired submissions if examId is provided (Teacher View)
        if (examId && user.role === 'GURU') {
            try {
                const { data: examData } = await supabase
                    .from('exams')
                    .select('duration_minutes, start_time')
                    .eq('id', examId)
                    .single()

                if (examData) {
                    const { data: inProgress } = await supabase
                        .from('exam_submissions')
                        .select('id, started_at')
                        .eq('exam_id', examId)
                        .eq('is_submitted', false)

                    if (inProgress && inProgress.length > 0) {
                        const now = Date.now()
                        const durationMs = (examData.duration_minutes || 0) * 60000
                        const bufferMs = 2 * 60000 // 2 min buffer

                        // Filter expired
                        const expired = inProgress.filter(sub => {
                            const start = new Date(sub.started_at).getTime()
                            return now > (start + durationMs + bufferMs)
                        })

                        // Process expired
                        if (expired.length > 0) {
                            console.log(`[Auto-Close] Found ${expired.length} expired exam submissions for exam ${examId}`)

                            // Process in parallel
                            await Promise.all(expired.map(async (sub) => {
                                // Calculate score
                                const { data: answers } = await supabase
                                    .from('exam_answers')
                                    .select('points_earned')
                                    .eq('submission_id', sub.id)

                                const score = answers?.reduce((sum, a) => sum + (a.points_earned || 0), 0) || 0

                                // force close
                                await supabase
                                    .from('exam_submissions')
                                    .update({
                                        is_submitted: true,
                                        submitted_at: new Date().toISOString(),
                                        total_score: score,
                                        violations_log: undefined // optional: log auto-close reason?
                                    })
                                    .eq('id', sub.id)
                            }))
                        }
                    }
                }
            } catch (sweepError) {
                console.error('Lazy sweep error:', sweepError)
                // Continue even if sweep fails
            }
        }

        let query = supabase
            .from('exam_submissions')
            .select(`
                id, exam_id, student_id, started_at, submitted_at, is_submitted,
                total_score, max_score, violation_count, violations_log, is_graded, created_at,
                student:students(id, nis, user:users!students_user_id_fkey(full_name)),
                exam:exams(
                    id, 
                    title, 
                    duration_minutes,
                    teaching_assignment:teaching_assignments(
                        academic_year_id,
                        subject:subjects(id, name),
                        class:classes(id, name)
                    )
                )
            `)
            .order('created_at', { ascending: false })

        if (examId) {
            query = query.eq('exam_id', examId)
        }
        if (studentId) {
            query = query.eq('student_id', studentId)
        }

        // Filter by active year when no specific exam is requested
        if (!examId && allYears !== 'true') {
            const { data: activeYear } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .single()

            if (activeYear) {
                const { data: taIds } = await supabase
                    .from('teaching_assignments')
                    .select('id')
                    .eq('academic_year_id', activeYear.id)

                if (taIds && taIds.length > 0) {
                    const { data: examIds } = await supabase
                        .from('exams')
                        .select('id')
                        .in('teaching_assignment_id', taIds.map(t => t.id))

                    if (examIds && examIds.length > 0) {
                        query = query.in('exam_id', examIds.map(e => e.id))
                    } else {
                        return NextResponse.json([])
                    }
                } else {
                    return NextResponse.json([])
                }
            }
        }

        const { data, error } = await query

        if (error) throw error

        let finalData = data || []

        // If filtering by examId and the user is a teacher, fetch remedial submissions and merge by highest score
        if (examId && user.role === 'GURU') {
            const { data: remedials } = await supabase
                .from('exams')
                .select('id')
                .eq('remedial_for_id', examId)

            if (remedials && remedials.length > 0) {
                const remedialIds = remedials.map(r => r.id)
                const { data: remedialSubmissions } = await supabase
                    .from('exam_submissions')
                    .select(`
                        *,
                        student:students(id, nis, user:users!students_user_id_fkey(full_name)),
                        exam:exams(
                            id, 
                            title, 
                            duration_minutes,
                            teaching_assignment:teaching_assignments(
                                academic_year_id,
                                subject:subjects(id, name),
                                class:classes(id, name)
                            )
                        )
                    `)
                    .in('exam_id', remedialIds)

                if (remedialSubmissions && remedialSubmissions.length > 0) {
                    const studentHighestSubmissions = new Map<string, any>()

                    // Add all original submissions first
                    finalData.forEach((sub: any) => {
                        studentHighestSubmissions.set(sub.student.id, sub)
                    })

                    // Overwrite if remedial score is higher or equal
                    remedialSubmissions.forEach((sub: any) => {
                        const existing = studentHighestSubmissions.get(sub.student.id)
                        const currentScore = ((sub.total_score || 0) / (sub.max_score || 1))
                        const existingScore = existing ? ((existing.total_score || 0) / (existing.max_score || 1)) : -1

                        if (currentScore >= existingScore) {
                            studentHighestSubmissions.set(sub.student.id, sub)
                        }
                    })

                    finalData = Array.from(studentHighestSubmissions.values())
                    // Sort by submitted_at again just in case (using created_at as backup if needed)
                    finalData.sort((a: any, b: any) => {
                        const dateA = a.submitted_at ? new Date(a.submitted_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
                        const dateB = b.submitted_at ? new Date(b.submitted_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
                        return dateB - dateA;
                    });
                }
            }
        }

        return NextResponse.json(finalData)
    } catch (error) {
        console.error('Error fetching exam submissions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST start exam (create submission)
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
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (!student) {
            return NextResponse.json({ error: 'Student not found' }, { status: 404 })
        }

        // Check if exam exists and is active
        const { data: exam } = await supabase
            .from('exams')
            .select('*, exam_questions(id)')
            .eq('id', exam_id)
            .single()

        if (!exam) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }

        if (!exam.is_active) {
            return NextResponse.json({ error: 'Ulangan belum dibuka' }, { status: 400 })
        }

        // Check start time
        const now = new Date()
        const startTime = new Date(exam.start_time)
        if (now < startTime) {
            return NextResponse.json({ error: 'Ulangan belum dimulai' }, { status: 400 })
        }

        // Check if already submitted
        const { data: existingSubmission } = await supabase
            .from('exam_submissions')
            .select('id, is_submitted, question_order, started_at, violation_count, max_score')
            .eq('exam_id', exam_id)
            .eq('student_id', student.id)
            .single()

        if (existingSubmission?.is_submitted) {
            return NextResponse.json({ error: 'Anda sudah mengumpulkan ulangan ini' }, { status: 400 })
        }

        if (existingSubmission) {
            // Return existing submission with all data needed for resume
            return NextResponse.json(existingSubmission)
        }

        // Create randomized question order if enabled
        const questionIds = exam.exam_questions.map((q: any) => q.id)
        const questionOrder = exam.is_randomized
            ? questionIds.sort(() => Math.random() - 0.5)
            : questionIds

        // Calculate max score
        const { data: questions } = await supabase
            .from('exam_questions')
            .select('points')
            .eq('exam_id', exam_id)

        const maxScore = questions?.reduce((sum, q) => sum + (q.points || 1), 0) || 0

        // Create new submission
        const { data: submission, error } = await supabase
            .from('exam_submissions')
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
        console.error('Error starting exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update submission (submit answers, log violations)
export async function PUT(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const body = await request.json()
        const { submission_id, answers, submit, violation, reset_attempt } = body

        if (!submission_id) {
            return NextResponse.json({ error: 'submission_id required' }, { status: 400 })
        }

        // Get current submission
        const { data: currentSubmission } = await supabase
            .from('exam_submissions')
            .select('*, exam:exams(max_violations)')
            .eq('id', submission_id)
            .single()

        if (!currentSubmission) {
            return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
        }

        // C3 Security Fix: Verify SISWA ownership — only the student who owns this submission can modify it
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

        // Handle Reset Attempt (Soft & Hard)
        if (reset_attempt) {
            if (user.role !== 'GURU' && user.role !== 'ADMIN') {
                return NextResponse.json({ error: 'Tidak punya izin untuk melakukan reset' }, { status: 403 })
            }
            if (!currentSubmission.is_submitted) {
                return NextResponse.json({ error: 'Submission ini belum dikumpulkan/di-submit' }, { status: 400 })
            }

            // Jika hard reset, hapus semua jawaban yang tersimpan
            if (reset_attempt === 'hard') {
                await supabase
                    .from('exam_answers')
                    .delete()
                    .eq('submission_id', submission_id)
            }

            const updateData: any = {
                is_submitted: false,
                submitted_at: null,
                violation_count: 0,
                violations_log: [],
                total_score: 0,
                is_graded: false
            }

            // Jika hard reset, perbarui started_at agar mendapat full timer kembali
            if (reset_attempt === 'hard') {
                updateData.started_at = new Date().toISOString()
            }

            const { data, error } = await supabase
                .from('exam_submissions')
                .update(updateData)
                .eq('id', submission_id)
                .select()
                .single()

            if (error) throw error

            return NextResponse.json({
                reset_success: true,
                message: reset_attempt === 'hard'
                    ? 'Hard reset berhasil. Jawaban dikosongkan dan timer diulang.'
                    : 'Soft reset berhasil. Siswa dapat melanjutkan dengan sisa waktu.',
                submission: data
            })
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
                .from('exam_submissions')
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
                // Auto submit with current answers
                const { data: existingAnswers } = await supabase
                    .from('exam_answers')
                    .select('*, question:exam_questions(correct_answer, points, question_type)')
                    .eq('submission_id', submission_id)

                let totalScore = 0
                let hasEssays = false
                existingAnswers?.forEach(ans => {
                    const q = Array.isArray(ans.question) ? ans.question[0] : (ans.question as any);
                    if (ans.answer === q?.correct_answer) {
                        totalScore += q?.points || 1
                    }
                    if (q?.question_type === 'ESSAY') {
                        hasEssays = true
                    }
                })

                // Also check if there are unanswered essays in the exam
                const { data: examQuestions } = await supabase
                    .from('exam_questions')
                    .select('question_type')
                    .eq('exam_id', currentSubmission.exam_id)
                hasEssays = hasEssays || (examQuestions?.some(q => q.question_type === 'ESSAY') || false)

                await supabase
                    .from('exam_submissions')
                    .update({
                        is_submitted: true,
                        submitted_at: new Date().toISOString(),
                        total_score: totalScore,
                        is_graded: !hasEssays
                    })
                    .eq('id', submission_id)

                // Notify teacher about force submission
                await notifyTeacherExamSubmission(currentSubmission.exam_id, user.full_name || 'Siswa', true)

                return NextResponse.json({
                    force_submitted: true,
                    message: 'Ulangan otomatis dikumpulkan karena pelanggaran melebihi batas'
                })
            }

            return NextResponse.json({
                violation_count: newViolationCount,
                max_violations: maxViolations
            })
        }

        // Handle saving/submitting answers
        if (answers && Array.isArray(answers) && answers.length > 0) {
            // BATCH OPTIMIZATION: Fetch ALL exam questions in 1 query instead of N
            const { data: allQuestions } = await supabase
                .from('exam_questions')
                .select('id, correct_answer, points, question_type')
                .eq('exam_id', currentSubmission.exam_id)

            // Build a lookup map for instant grading
            const questionMap = new Map<string, { correct_answer: string; points: number; question_type: string }>()
            allQuestions?.forEach(q => questionMap.set(q.id, q))

            // Grade all answers in memory
            const gradedAnswers = answers.map((ans: { question_id: string; answer: string }) => {
                const question = questionMap.get(ans.question_id)
                const isCorrect = question?.correct_answer === ans.answer
                const pointsEarned = isCorrect ? (question?.points || 1) : 0

                return {
                    submission_id,
                    question_id: ans.question_id,
                    answer: ans.answer,
                    is_correct: isCorrect,
                    points_earned: pointsEarned
                }
            })

            // BATCH UPSERT: 1 query instead of N
            const { error: upsertError } = await supabase
                .from('exam_answers')
                .upsert(gradedAnswers, {
                    onConflict: 'submission_id,question_id'
                })

            if (upsertError) {
                console.error('Error batch upserting answers:', upsertError)
                throw upsertError
            }
        }

        // Handle final submission
        if (submit) {
            // Fetch all saved answers to compute final score
            const { data: allAnswers } = await supabase
                .from('exam_answers')
                .select('points_earned')
                .eq('submission_id', submission_id)

            const totalScore = allAnswers?.reduce((sum, a) => sum + (a.points_earned || 0), 0) || 0

            // Check if there are essay questions in the exam
            const { data: examQuestions } = await supabase
                .from('exam_questions')
                .select('question_type')
                .eq('exam_id', currentSubmission.exam_id)

            const hasEssays = examQuestions?.some(q => q.question_type === 'ESSAY') || false;
            const isGraded = !hasEssays

            const { data: updatedSubmission, error } = await supabase
                .from('exam_submissions')
                .update({
                    is_submitted: true,
                    submitted_at: new Date().toISOString(),
                    total_score: totalScore,
                    is_graded: isGraded
                })
                .eq('id', submission_id)
                .select()
                .single()

            if (error) throw error

            // Notify teacher about exam submission
            await notifyTeacherExamSubmission(currentSubmission.exam_id, user.full_name || 'Siswa')

            return NextResponse.json(updatedSubmission)
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error updating exam submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
