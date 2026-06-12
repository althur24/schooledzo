import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { resolveKkm } from '@/lib/resolveKkm'

// ─── Shared helpers ─────────────────────────────────────────────
function median(arr: number[]): number {
    if (arr.length === 0) return 0
    const sorted = [...arr].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2
}

function stdDev(arr: number[], avg: number): number {
    if (arr.length === 0) return 0
    return Math.sqrt(arr.reduce((sum, v) => sum + (v - avg) ** 2, 0) / arr.length)
}

function buildScoreDistribution(percentages: number[]) {
    const ranges = [
        '0-10', '11-20', '21-30', '31-40', '41-50',
        '51-60', '61-70', '71-80', '81-90', '91-100'
    ]
    return ranges.map(r => {
        const [min, max] = r.split('-').map(Number)
        return {
            range: r,
            count: percentages.filter(p => p >= min && p <= max).length
        }
    })
}

// ─── GET /api/analytics/quiz/[id] ───────────────────────────────
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        // Only teachers and admins can view analytics
        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const { id: quizId } = await params

        // 1) Fetch quiz details + teaching assignment
        const { data: quiz, error: quizError } = await supabase
            .from('quizzes')
            .select(`
                id, title, duration_minutes,
                teaching_assignment:teaching_assignments(
                    class:classes(id, name, school_level, grade_level),
                    subject:subjects(id, name, kkm)
                )
            `)
            .eq('id', quizId)
            .single()

        if (quizError || !quiz) {
            return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
        }

        const ta = quiz.teaching_assignment as any
        const classId = ta?.class?.id
        const subjectId = ta?.subject?.id
        const schoolLevel = ta?.class?.school_level
        const gradeLevel = ta?.class?.grade_level
        
        let kkm = ta?.subject?.kkm ?? 75
        if (subjectId && schoolLevel && gradeLevel) {
            kkm = await resolveKkm(subjectId, schoolLevel, gradeLevel)
        }

        // 2) Fetch all questions for this quiz
        const { data: questions } = await supabase
            .from('quiz_questions')
            .select('id, question_text, question_type, options, correct_answer, points, order_index')
            .eq('quiz_id', quizId)
            .order('order_index', { ascending: true })

        const allQuestions = questions || []
        const totalMaxScore = allQuestions.reduce((sum, q) => sum + (q.points || 0), 0)

        // 3) Fetch all submitted quiz submissions
        const { data: submissions } = await supabase
            .from('quiz_submissions')
            .select(`
                id, student_id, started_at, submitted_at, total_score, max_score, answers,
                student:students(id, nis, user:users!students_user_id_fkey(full_name))
            `)
            .eq('quiz_id', quizId)
            .not('submitted_at', 'is', null)

        const allSubmissions = submissions || []

        // 4) Fetch all students in the class (for participation count)
        let totalStudentsInClass = 0
        if (classId) {
            const { count } = await supabase
                .from('students')
                .select('id', { count: 'exact', head: true })
                .eq('class_id', classId)
            totalStudentsInClass = count || 0
        }

        // ── If no submissions, return empty analytics ──
        if (allSubmissions.length === 0) {
            return NextResponse.json({
                classOverview: {
                    totalStudents: totalStudentsInClass,
                    submitted: 0,
                    avgScore: 0, highestScore: 0, lowestScore: 0,
                    median: 0, stdDev: 0, passRate: 0, kkm,
                    maxScore: totalMaxScore,
                    avgRawScore: 0, highestRawScore: 0, lowestRawScore: 0, medianRaw: 0
                },
                scoreDistribution: buildScoreDistribution([]),
                questionAnalysis: [],
                timeAnalysis: [],
                performanceHeatmap: [],
                studentRanking: [],
                totalQuestions: allQuestions.length
            })
        }

        // ── Compute percentages ──
        const percentages = allSubmissions.map(s => {
            const max = s.max_score || totalMaxScore || 1
            return (s.total_score / max) * 100
        })

        // ── Compute raw scores ──
        const rawScores = allSubmissions.map(s => s.total_score)
        const avgRaw = rawScores.reduce((a, b) => a + b, 0) / rawScores.length
        const highestRaw = Math.max(...rawScores)
        const lowestRaw = Math.min(...rawScores)
        const medRaw = median(rawScores)

        const avg = percentages.reduce((a, b) => a + b, 0) / percentages.length
        const med = median(percentages)
        const sd = stdDev(percentages, avg)
        const highest = Math.max(...percentages)
        const lowest = Math.min(...percentages)
        const passRate = kkm
            ? (percentages.filter(p => p >= kkm).length / percentages.length) * 100
            : 0

        // ── classOverview ──
        const classOverview = {
            totalStudents: totalStudentsInClass,
            submitted: allSubmissions.length,
            avgScore: Math.round(avg * 100) / 100,
            highestScore: Math.round(highest * 100) / 100,
            lowestScore: Math.round(lowest * 100) / 100,
            median: Math.round(med * 100) / 100,
            stdDev: Math.round(sd * 100) / 100,
            passRate: Math.round(passRate * 100) / 100,
            kkm,
            maxScore: totalMaxScore,
            avgRawScore: Math.round(avgRaw * 100) / 100,
            highestRawScore: highestRaw,
            lowestRawScore: lowestRaw,
            medianRaw: Math.round(medRaw * 100) / 100
        }

        // ── scoreDistribution ──
        const scoreDistribution = buildScoreDistribution(percentages)

        // ── questionAnalysis ──
        // Quiz answers are JSONB: { question_id, answer, is_correct, score }
        const questionAnalysis = allQuestions.map((q, idx) => {
            // Collect all student answers for this question
            const answersForQ = allSubmissions
                .map(s => {
                    const answers = Array.isArray(s.answers) ? s.answers : []
                    return answers.find((a: any) => a.question_id === q.id) as any
                })
                .filter(Boolean)

            const totalAnswered = answersForQ.length
            const correctCount = answersForQ.filter((a: any) => a.is_correct === true).length
            const correctRate = totalAnswered > 0 ? (correctCount / totalAnswered) * 100 : 0
            const avgScoreQ = totalAnswered > 0
                ? answersForQ.reduce((sum: number, a: any) => sum + (a.score ?? 0), 0) / totalAnswered
                : 0

            // Option distribution for MC / TRUE_FALSE / MULTIPLE_ANSWER
            let optionDistribution: { option: string; count: number; isCorrect: boolean }[] | undefined
            if (q.question_type === 'MULTIPLE_CHOICE' && q.options) {
                optionDistribution = (q.options as string[]).map((opt: string, optIdx: number) => {
                    const letter = String.fromCharCode(65 + optIdx)
                    return {
                        option: letter,
                        count: answersForQ.filter((a: any) =>
                            a.answer?.toUpperCase() === letter
                        ).length,
                        isCorrect: q.correct_answer?.toUpperCase() === letter
                    }
                })
            } else if (q.question_type === 'TRUE_FALSE') {
                optionDistribution = ['BENAR', 'SALAH'].map(val => ({
                    option: val,
                    count: answersForQ.filter((a: any) => a.answer?.toUpperCase() === val).length,
                    isCorrect: q.correct_answer?.toUpperCase() === val
                }))
            } else if (q.question_type === 'MULTIPLE_ANSWER' && q.options) {
                optionDistribution = (q.options as string[]).map((opt: string, optIdx: number) => {
                    const letter = String.fromCharCode(65 + optIdx)
                    let correctLetters: string[] = []
                    try { correctLetters = JSON.parse(q.correct_answer || '[]') } catch {}
                    return {
                        option: letter,
                        count: answersForQ.filter((a: any) => {
                            try { return JSON.parse(a.answer || '[]').includes(letter) } catch { return false }
                        }).length,
                        isCorrect: correctLetters.includes(letter)
                    }
                })
            }

            return {
                questionIndex: idx + 1,
                questionText: q.question_text,
                questionType: q.question_type,
                correctRate: Math.round(correctRate * 100) / 100,
                avgScore: Math.round(avgScoreQ * 100) / 100,
                maxPoints: q.points || 0,
                optionDistribution
            }
        })

        // ── timeAnalysis ──
        const timeAnalysis = allSubmissions
            .filter(s => s.started_at && s.submitted_at)
            .map(s => {
                const start = new Date(s.started_at).getTime()
                const end = new Date(s.submitted_at).getTime()
                const durationMinutes = (end - start) / 60000
                const max = s.max_score || totalMaxScore || 1
                const scorePercent = (s.total_score / max) * 100

                return {
                    studentName: (s.student as any)?.user?.full_name || 'Unknown',
                    duration: Math.round(durationMinutes * 100) / 100,
                    score: Math.round(scorePercent * 100) / 100
                }
            })

        // ── performanceHeatmap ──
        const performanceHeatmap = allSubmissions.map(s => {
            const student = s.student as any
            const answers = Array.isArray(s.answers) ? s.answers : []
            const max = s.max_score || totalMaxScore || 1

            return {
                studentName: student?.user?.full_name || 'Unknown',
                studentNis: student?.nis || '',
                totalScore: Math.round((s.total_score / max) * 100 * 100) / 100,
                answers: allQuestions.map((q, idx) => {
                    const ans = answers.find((a: any) => a.question_id === q.id) as any
                    return {
                        questionIndex: idx + 1,
                        isCorrect: ans ? (ans.is_correct ?? null) : null,
                        scoreEarned: ans?.score ?? 0,
                        maxPoints: q.points || 0,
                        questionType: q.question_type
                    }
                })
            }
        }).sort((a, b) => b.totalScore - a.totalScore)

        // ── studentRanking ──
        const studentRanking = allSubmissions.map(s => {
            const student = s.student as any
            const max = s.max_score || totalMaxScore || 1
            const pct = (s.total_score / max) * 100

            let duration: number | undefined
            if (s.started_at && s.submitted_at) {
                duration = Math.round(
                    (new Date(s.submitted_at).getTime() - new Date(s.started_at).getTime()) / 60000 * 100
                ) / 100
            }

            return {
                name: student?.user?.full_name || 'Unknown',
                nis: student?.nis || '',
                score: s.total_score,
                maxScore: max,
                percentage: Math.round(pct * 100) / 100,
                duration
            }
        }).sort((a, b) => b.percentage - a.percentage)

        return NextResponse.json({
            classOverview,
            scoreDistribution,
            questionAnalysis,
            timeAnalysis,
            performanceHeatmap,
            studentRanking,
            totalQuestions: allQuestions.length
        })
    } catch (error) {
        console.error('Error in quiz analytics:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
