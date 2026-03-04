import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET submissions (for teacher or student)
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const quizId = request.nextUrl.searchParams.get('quiz_id')
        const studentId = request.nextUrl.searchParams.get('student_id')
        const allYears = request.nextUrl.searchParams.get('all_years')

        // Lazy Sweep: Auto-close expired submissions if quizId is provided (Teacher View)
        if (quizId && user.role === 'GURU') {
            try {
                const { data: quizData } = await supabase
                    .from('quizzes')
                    .select('duration_minutes, start_time') // Assuming start_time exists or handled by creation date? 
                    // Quiz usually doesn't have fixed start_time like Exam, 
                    // but it has duration. Expiration is based on started_at + duration.
                    .eq('id', quizId)
                    .single()

                if (quizData) {
                    // Fetch questions for grading
                    const { data: questions } = await supabase
                        .from('quiz_questions')
                        .select('*')
                        .eq('quiz_id', quizId)

                    if (questions) {
                        const { data: inProgress } = await supabase
                            .from('quiz_submissions')
                            .select('id, started_at, answers')
                            .eq('quiz_id', quizId)
                            .is('submitted_at', null)

                        if (inProgress && inProgress.length > 0) {
                            const now = Date.now()
                            const durationMs = (quizData.duration_minutes || 0) * 60000
                            const bufferMs = 2 * 60000 // 2 min buffer

                            // Filter expired
                            const expired = inProgress.filter(sub => {
                                const start = new Date(sub.started_at).getTime()
                                return now > (start + durationMs + bufferMs)
                            })

                            if (expired.length > 0) {
                                console.log(`[Auto-Close] Found ${expired.length} expired quiz submissions for quiz ${quizId}`)

                                await Promise.all(expired.map(async (sub) => {
                                    // Grade answers
                                    let totalScore = 0
                                    const subAnswers = Array.isArray(sub.answers) ? sub.answers : []

                                    const gradedAnswers = subAnswers.map((ans: any) => {
                                        const q = questions.find(q => q.id === ans.question_id)
                                        if (!q) return ans

                                        if (q.question_type === 'MULTIPLE_CHOICE') {
                                            const isCorrect = ans.answer?.toUpperCase() === q.correct_answer?.toUpperCase()
                                            const score = isCorrect ? q.points : 0
                                            totalScore += score
                                            return { ...ans, is_correct: isCorrect, score }
                                        }
                                        return ans
                                    })

                                    const examMaxScore = questions.reduce((acc, q) => acc + q.points, 0)

                                    await supabase
                                        .from('quiz_submissions')
                                        .update({
                                            answers: gradedAnswers,
                                            submitted_at: new Date().toISOString(),
                                            total_score: totalScore,
                                            max_score: examMaxScore,
                                            is_graded: true
                                        })
                                        .eq('id', sub.id)
                                }))
                            }
                        }
                    }
                }
            } catch (sweepError) {
                console.error('Lazy sweep error:', sweepError)
            }
        }

        let query = supabase
            .from('quiz_submissions')
            .select(`
                *,
                quiz:quizzes(
                    id,
                    title,
                    teaching_assignment:teaching_assignments(
                        academic_year_id,
                        subject:subjects(name)
                    )
                ),
                student:students(
                    id,
                    nis,
                    user:users!students_user_id_fkey(full_name)
                )
            `)
            .order('submitted_at', { ascending: false })

        if (quizId) {
            query = query.eq('quiz_id', quizId)
        }
        if (studentId) {
            query = query.eq('student_id', studentId)
        }

        // H1 Security Fix: Auto-scope to student's own submissions for SISWA role
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()
            if (student) {
                query = query.eq('student_id', student.id)
            } else {
                return NextResponse.json([])
            }
        }

        // Filter by active year when no specific quiz is requested
        if (!quizId && allYears !== 'true') {
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
                    const { data: quizIds } = await supabase
                        .from('quizzes')
                        .select('id')
                        .in('teaching_assignment_id', taIds.map(t => t.id))

                    if (quizIds && quizIds.length > 0) {
                        query = query.in('quiz_id', quizIds.map(q => q.id))
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

        // If filtering by quizId and the user is a teacher, fetch remedial submissions and merge by highest score
        if (quizId && user.role === 'GURU') {
            const { data: remedials } = await supabase
                .from('quizzes')
                .select('id')
                .eq('remedial_for_id', quizId)

            if (remedials && remedials.length > 0) {
                const remedialIds = remedials.map(r => r.id)
                const { data: remedialSubmissions } = await supabase
                    .from('quiz_submissions')
                    .select(`
                        *,
                        quiz:quizzes(
                            id,
                            title,
                            teaching_assignment:teaching_assignments(
                                academic_year_id,
                                subject:subjects(name)
                            )
                        ),
                        student:students(
                            id,
                            nis,
                            user:users!students_user_id_fkey(full_name)
                        )
                    `)
                    .in('quiz_id', remedialIds)

                if (remedialSubmissions && remedialSubmissions.length > 0) {
                    // Merge based on student.id
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
                    // Sort by submitted_at again just in case
                    finalData.sort((a: any, b: any) => {
                        const dateA = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
                        const dateB = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
                        return dateB - dateA;
                    });
                }
            }
        }

        return NextResponse.json(finalData)
    } catch (error) {
        console.error('Error fetching quiz submissions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST submit quiz (for student)
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'SISWA') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { quiz_id, answers, started_at, submit } = await request.json()

        if (!quiz_id) {
            return NextResponse.json({ error: 'Quiz ID diperlukan' }, { status: 400 })
        }

        // Get student
        const { data: student } = await supabase
            .from('students')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (!student) {
            return NextResponse.json({ error: 'Student not found' }, { status: 404 })
        }

        // Get quiz questions for auto-grading
        const { data: questions } = await supabase
            .from('quiz_questions')
            .select('*')
            .eq('quiz_id', quiz_id)

        if (!questions) {
            return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
        }

        // Check if already submitted or exists
        const { data: existing } = await supabase
            .from('quiz_submissions')
            .select('id, answers')
            .eq('quiz_id', quiz_id)
            .eq('student_id', student.id)
            .single()

        // Determine which answers to process
        // If submitting existing attempt with no new answers, use existing answers
        let answersToProcess = answers
        if (existing && submit && (!answers || !Array.isArray(answers) || answers.length === 0)) {
            answersToProcess = existing.answers || []
        }

        // Auto-grade multiple choice and calculate scores
        let totalScore = 0
        let maxScore = 0
        // Check if there are any essay questions in the quiz
        // If there's an essay, the quiz can NEVER be fully auto-graded
        const hasEssays = questions.some(q => q.question_type === 'ESSAY')
        let allGraded = !hasEssays
        let gradedAnswers: any[] = []

        // Only process answers if they exist
        if (answersToProcess && Array.isArray(answersToProcess) && answersToProcess.length > 0) {
            gradedAnswers = answersToProcess.map((ans: { question_id: string; answer: string }) => {
                const question = questions.find(q => q.id === ans.question_id)
                if (!question) return ans

                maxScore += question.points

                if (question.question_type === 'MULTIPLE_CHOICE') {
                    const isCorrect = ans.answer?.toUpperCase() === question.correct_answer?.toUpperCase()
                    const score = isCorrect ? question.points : 0
                    totalScore += score
                    return {
                        ...ans,
                        is_correct: isCorrect,
                        score
                    }
                } else {
                    // Essay needs manual grading
                    return {
                        ...ans,
                        is_correct: null,
                        score: null
                    }
                }
            })
        }

        if (existing) {
            // If just saving progress (no submit flag), update answers only
            if (!submit) {
                const updateData: any = {}
                if (answers && answers.length > 0) {
                    updateData.answers = gradedAnswers
                }
                if (Object.keys(updateData).length > 0) {
                    await supabase
                        .from('quiz_submissions')
                        .update(updateData)
                        .eq('id', existing.id)
                }
                return NextResponse.json({ id: existing.id, saved: true })
            }

            // Final submission — set submitted_at
            const { data, error } = await supabase
                .from('quiz_submissions')
                .update({
                    answers: gradedAnswers,
                    submitted_at: new Date().toISOString(),
                    total_score: totalScore,
                    max_score: maxScore,
                    is_graded: allGraded
                })
                .eq('id', existing.id)
                .select()
                .single()

            if (error) throw error

            // Notify (Logic extracted to avoid duplication, but kept inline for now)
            try {
                const { data: quiz } = await supabase
                    .from('quizzes')
                    .select(`
                        title,
                        teaching_assignment:teaching_assignments(
                            teacher:teachers(user_id)
                        )
                    `)
                    .eq('id', quiz_id)
                    .single()

                const teacherUserId = (quiz?.teaching_assignment as any)?.teacher?.user_id
                if (teacherUserId) {
                    await supabase.from('notifications').insert({
                        user_id: teacherUserId,
                        type: 'SUBMISSION_KUIS',
                        title: 'Kuis Dikumpulkan',
                        message: `${user.full_name} telah mengumpulkan kuis "${quiz?.title}"`,
                        link: `/dashboard/guru/kuis`
                    })
                }
            } catch (notifError) {
                console.error('Error sending quiz submission notification:', notifError)
            }

            return NextResponse.json(data)
        }

        // Create new submission
        const insertData: any = {
            quiz_id,
            student_id: student.id,
            started_at: started_at || new Date().toISOString(),
            answers: gradedAnswers,
        }

        // Only mark as submitted if submit flag is true
        if (submit) {
            insertData.submitted_at = new Date().toISOString()
            insertData.total_score = totalScore
            insertData.max_score = maxScore
            insertData.is_graded = allGraded
        }

        const { data, error } = await supabase
            .from('quiz_submissions')
            .insert(insertData)
            .select()
            .single()

        if (error) throw error

        // Notify for new submission if submitted
        if (submit) {
            try {
                const { data: quiz } = await supabase
                    .from('quizzes')
                    .select(`
                        title,
                        teaching_assignment:teaching_assignments(
                            teacher:teachers(user_id)
                        )
                    `)
                    .eq('id', quiz_id)
                    .single()

                const teacherUserId = (quiz?.teaching_assignment as any)?.teacher?.user_id
                if (teacherUserId) {
                    await supabase.from('notifications').insert({
                        user_id: teacherUserId,
                        type: 'SUBMISSION_KUIS',
                        title: 'Kuis Dikumpulkan',
                        message: `${user.full_name} telah mengumpulkan kuis "${quiz?.title}"`,
                        link: `/dashboard/guru/kuis`
                    })
                }
            } catch (notifError) {
                console.error('Error sending quiz submission notification:', notifError)
            }
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error submitting quiz:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
