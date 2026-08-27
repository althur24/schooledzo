import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { gradeAnswer, isAutoGradeable, needsManualGrading } from '@/lib/questionTypeUtils'
import { getExamQuestionsForGrading } from '@/lib/examQuestionsCache'
import { resolveQuizExpiry, isWriteAllowed, isSweepDue, endsAtIso } from '@/lib/examExpiry'
import { forceCloseQuizSubmission } from '@/lib/autoCloseExpired'

// Helper function for sending notifications
async function sendQuizSubmissionNotification(quizId: string, userFullName: string) {
    try {
        const { data: quiz } = await supabase
            .from('quizzes')
            .select(`
                title,
                teaching_assignment:teaching_assignments(
                    teacher:teachers(user_id)
                )
            `)
            .eq('id', quizId)
            .single()

        const teacherUserId = (quiz?.teaching_assignment as any)?.teacher?.user_id
        if (teacherUserId) {
            await supabase.from('notifications').insert({
                user_id: teacherUserId,
                type: 'SUBMISSION_KUIS',
                title: 'Kuis Dikumpulkan',
                message: `${userFullName} telah mengumpulkan kuis "${quiz?.title}"`,
                link: `/dashboard/guru/kuis`
            })
        }
    } catch (notifError) {
        console.error('Error sending quiz submission notification:', notifError)
    }
}

// Helper: notify student their quiz result is out (auto-graded only)
async function sendQuizResultNotification(quizId: string, studentUserId: string, totalScore: number, maxScore: number) {
    try {
        const { data: quiz } = await supabase
            .from('quizzes')
            .select(`
                title,
                teaching_assignment:teaching_assignments(
                    subject:subjects(name)
                )
            `)
            .eq('id', quizId)
            .single()

        const subjectName = (quiz?.teaching_assignment as any)?.subject?.name || ''
        await supabase.from('notifications').insert({
            user_id: studentUserId,
            type: 'NILAI_KELUAR',
            title: `Nilai Keluar: ${quiz?.title}`,
            message: `${subjectName} — Nilai: ${totalScore}/${maxScore}`,
            link: '/dashboard/siswa/kuis'
        })
    } catch (notifError) {
        console.error('Error sending quiz result notification:', notifError)
    }
}

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
                    .select('duration_minutes, deadline')
                    .eq('id', quizId)
                    .single()

                if (quizData) {
                    const { data: inProgress } = await supabase
                        .from('quiz_submissions')
                        .select('id, started_at')
                        .eq('quiz_id', quizId)
                        .is('submitted_at', null)

                    // Satu sumber kebenaran: min(started_at + durasi, deadline) — src/lib/examExpiry.ts
                    const withExpiry = (inProgress || []).map(sub => ({
                        sub,
                        expiry: resolveQuizExpiry(
                            { deadline: quizData.deadline, duration_minutes: quizData.duration_minutes },
                            { started_at: sub.started_at }
                        )
                    }))
                    const expired = withExpiry.filter(x => isSweepDue(x.expiry))

                    if (expired.length > 0) {
                        console.log(`[Auto-Close] Found ${expired.length} expired quiz submissions for quiz ${quizId}`)
                        await Promise.all(expired.map(x =>
                            forceCloseQuizSubmission(x.sub.id, x.expiry.limited ? x.expiry.endAt : null)
                        ))
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
                quiz:quizzes!inner(
                    id,
                    title,
                    duration_minutes,
                    deadline,
                    teaching_assignment:teaching_assignments!inner(
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
                // Inner join filter replaces the old two-hop .in(list): hundreds of TA ids
                // overflow the 16KB header limit at larger schools and break this endpoint
                query = query.eq('quiz.teaching_assignment.academic_year_id', activeYear.id)
            } else {
                // No active year: return empty instead of leaking content across years
                return NextResponse.json([])
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

        // Lampirkan ends_at (batas efektif, dihitung server) per submission —
        // client countdown ke nilai ini; server_time dikirim via header untuk koreksi jam HP.
        const serverTimeIso = new Date().toISOString()
        finalData = finalData.map((s: any) => {
            const qz = Array.isArray(s.quiz) ? s.quiz[0] : s.quiz
            const expiry = resolveQuizExpiry(
                { deadline: qz?.deadline ?? null, duration_minutes: qz?.duration_minutes ?? null },
                { started_at: s.started_at }
            )
            return { ...s, ends_at: endsAtIso(expiry) }
        })

        return NextResponse.json(finalData, { headers: { 'x-server-time': serverTimeIso } })
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

        const { quiz_id, answers, submit } = await request.json()

        if (!quiz_id) {
            return NextResponse.json({ error: 'Quiz ID diperlukan' }, { status: 400 })
        }

        // Student + quiz di-fetch PARALEL (independen) — memangkas 1 round-trip DB
        // per request di hot path autosave 1000 siswa
        const [studentRes, quizRes] = await Promise.all([
            supabase.from('students').select('id').eq('user_id', user.id).single(),
            supabase.from('quizzes').select('deadline, duration_minutes, is_remedial, allowed_student_ids, available_from').eq('id', quiz_id).single()
        ])
        const student = studentRes.data
        const quiz = quizRes.data

        if (!student) {
            return NextResponse.json({ error: 'Student not found' }, { status: 404 })
        }

        if (!quiz) {
            return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
        }

        // Remedial guard
        if (quiz.is_remedial && quiz.allowed_student_ids && quiz.allowed_student_ids.length > 0) {
            if (!quiz.allowed_student_ids.includes(student.id)) {
                return NextResponse.json({ error: 'Anda tidak terdaftar untuk kuis remedial ini' }, { status: 403 })
            }
        }

        // Soal dari cache in-memory (TTL 10 mnt) — tanpa ini setiap autosave mem-fetch ulang
        // SELURUH soal (termasuk teks HTML/passage besar) dari database per siswa per simpan
        const questions = await getExamQuestionsForGrading('quiz_questions', quiz_id)

        // Check if already submitted or exists
        const { data: existing } = await supabase
            .from('quiz_submissions')
            .select('id, answers, started_at, submitted_at')
            .eq('quiz_id', quiz_id)
            .eq('student_id', student.id)
            .single()

        // Deadline hanya menggerbang sesi BARU. Attempt yang sudah berjalan ditangani
        // enforcement di bawah — jawaban tersimpan tidak boleh hilang hanya karena
        // deadline lewat di tengah jalan (siswa punya grace 60 dtk untuk flush terakhir).
        // available_from (jam buka jendela) juga hanya menggerbang sesi BARU.
        if (!existing) {
            if (quiz.available_from && new Date() < new Date(quiz.available_from)) {
                return NextResponse.json({ error: 'Kuis belum dibuka' }, { status: 400 })
            }
            if (quiz.deadline && new Date() > new Date(quiz.deadline)) {
                return NextResponse.json({ error: 'Kuis sudah melewati deadline' }, { status: 400 })
            }
        }

        // Attempt yang sudah dikumpulkan tidak boleh ditimpa ulang (selaras ulangan/UTS-UAS)
        if (existing?.submitted_at) {
            return NextResponse.json({ error: 'Kuis sudah dikumpulkan' }, { status: 400 })
        }

        // Penegakan batas waktu di server untuk attempt berjalan:
        // endAt = min(started_at + durasi, deadline). Lewat endAt + grace → submission
        // ditutup paksa, TAPI jawaban yang dikirim ikut di-merge (menang per soal)
        // supaya jawaban yang diketik saat offline tidak hilang.
        if (existing) {
            const expiry = resolveQuizExpiry(
                { deadline: quiz.deadline, duration_minutes: quiz.duration_minutes },
                { started_at: existing.started_at }
            )
            if (!isWriteAllowed(expiry)) {
                await forceCloseQuizSubmission(existing.id, expiry.limited ? expiry.endAt : null, answers)
                return NextResponse.json({
                    code: 'TIME_EXPIRED',
                    force_submitted: true,
                    message: 'Waktu pengerjaan sudah berakhir. Jawaban terakhirmu otomatis dikumpulkan.'
                }, { status: 409 })
            }
        }

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
        const hasManualGrading = questions.some(q => needsManualGrading(q.question_type))
        let allGraded = !hasManualGrading
        let gradedAnswers: any[] = []

        // Only process answers if they exist
        if (answersToProcess && Array.isArray(answersToProcess) && answersToProcess.length > 0) {
            gradedAnswers = answersToProcess.map((ans: { question_id: string; answer: string }) => {
                const question = questions.find(q => q.id === ans.question_id)
                if (!question) return ans

                maxScore += question.points

                if (isAutoGradeable(question.question_type)) {
                    const graded = gradeAnswer(
                        question.question_type,
                        ans.answer,
                        question.correct_answer,
                        question.options,
                        question.points || 1
                    )
                    totalScore += graded.pointsEarned
                    return {
                        ...ans,
                        is_correct: graded.isCorrect,
                        score: graded.pointsEarned
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
            const contractExpiry = resolveQuizExpiry(
                { deadline: quiz.deadline, duration_minutes: quiz.duration_minutes },
                { started_at: existing.started_at }
            )
            const contract = { server_time: new Date().toISOString(), ends_at: endsAtIso(contractExpiry) }

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
                return NextResponse.json({ id: existing.id, saved: true, ...contract })
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

            // Notify
            await sendQuizSubmissionNotification(quiz_id, user.full_name || 'Siswa')
            if (allGraded) await sendQuizResultNotification(quiz_id, user.id, totalScore, maxScore)

            return NextResponse.json({ ...data, ...contract })
        }

        // Create new submission — started_at otoritatif server (jangan percaya jam HP siswa)
        const insertData: any = {
            quiz_id,
            student_id: student.id,
            started_at: new Date().toISOString(),
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
            await sendQuizSubmissionNotification(quiz_id, user.full_name || 'Siswa')
            if (allGraded) await sendQuizResultNotification(quiz_id, user.id, totalScore, maxScore)
        }

        const insertExpiry = resolveQuizExpiry(
            { deadline: quiz.deadline, duration_minutes: quiz.duration_minutes },
            { started_at: data.started_at }
        )
        return NextResponse.json({ ...data, server_time: new Date().toISOString(), ends_at: endsAtIso(insertExpiry) })
    } catch (error) {
        console.error('Error submitting quiz:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
