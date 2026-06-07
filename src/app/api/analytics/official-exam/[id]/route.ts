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

// ─── GET /api/analytics/official-exam/[id] ──────────────────────
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const { id: examId } = await params

        // Optional class_id filter (multi-class support)
        const classIdFilter = request.nextUrl.searchParams.get('class_id')

        // 1) Fetch official exam details
        const { data: exam, error: examError } = await supabase
            .from('official_exams')
            .select(`
                id, title, exam_type, duration_minutes, target_class_ids,
                subject:subjects(id, name, kkm)
            `)
            .eq('id', examId)
            .single()

        if (examError || !exam) {
            return NextResponse.json({ error: 'Official exam not found' }, { status: 404 })
        }

        const subjectId = (exam.subject as any)?.id
        const targetClassIds = exam.target_class_ids || []
        
        let kkm = (exam.subject as any)?.kkm ?? 75
        
        // Resolve KKM based on target class (use classIdFilter if available, else first target class)
        const classToResolve = classIdFilter || (targetClassIds.length > 0 ? targetClassIds[0] : null)
        if (subjectId && classToResolve) {
            const { data: cls } = await supabase
                .from('classes')
                .select('school_level, grade_level')
                .eq('id', classToResolve)
                .single()
                
            if (cls?.school_level && cls?.grade_level) {
                kkm = await resolveKkm(subjectId, cls.school_level, cls.grade_level)
            }
        }

        // 2) Fetch all questions
        const { data: questions } = await supabase
            .from('official_exam_questions')
            .select('id, question_text, question_type, options, correct_answer, points, order_index')
            .eq('exam_id', examId)
            .order('order_index', { ascending: true })

        const allQuestions = questions || []
        const totalMaxScore = allQuestions.reduce((sum, q) => sum + (q.points || 0), 0)

        // 3) Fetch all submitted submissions
        const { data: submissions } = await supabase
            .from('official_exam_submissions')
            .select(`
                id, student_id, started_at, submitted_at, total_score, max_score,
                violation_count, is_submitted,
                student:students(id, nis, class_id, user:users!students_user_id_fkey(full_name))
            `)
            .eq('exam_id', examId)
            .eq('is_submitted', true)

        let allSubmissions = submissions || []

        // Filter by class if specified
        if (classIdFilter) {
            allSubmissions = allSubmissions.filter(s => (s.student as any)?.class_id === classIdFilter)
        }

        // 4) Fetch all answers (normalized table)
        const submissionIds = allSubmissions.map(s => s.id)
        let allAnswers: any[] = []
        if (submissionIds.length > 0) {
            const { data: answers } = await supabase
                .from('official_exam_answers')
                .select('submission_id, question_id, answer, is_correct, points_earned')
                .in('submission_id', submissionIds)
            allAnswers = answers || []
        }

        // 5) Count total students (across targeted classes or filtered class)
        let totalStudentsInClass = 0
        const classIdsToCount = classIdFilter ? [classIdFilter] : targetClassIds
        if (classIdsToCount.length > 0) {
            const { count } = await supabase
                .from('students')
                .select('id', { count: 'exact', head: true })
                .in('class_id', classIdsToCount)
            totalStudentsInClass = count || 0
        }

        // ── Empty state ──
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

        const scoreDistribution = buildScoreDistribution(percentages)

        // ── questionAnalysis ──
        const questionAnalysis = allQuestions.map((q, idx) => {
            const answersForQ = allAnswers.filter(a => a.question_id === q.id)
            const totalAnswered = answersForQ.length
            const correctCount = answersForQ.filter(a => a.is_correct === true).length
            const correctRate = totalAnswered > 0 ? (correctCount / totalAnswered) * 100 : 0
            const avgScoreQ = totalAnswered > 0
                ? answersForQ.reduce((sum: number, a: any) => sum + (a.points_earned ?? 0), 0) / totalAnswered
                : 0

            let optionDistribution: { option: string; count: number; isCorrect: boolean }[] | undefined
            if (q.question_type === 'MULTIPLE_CHOICE' && q.options) {
                optionDistribution = (q.options as string[]).map((_: string, optIdx: number) => {
                    const letter = String.fromCharCode(65 + optIdx)
                    return {
                        option: letter,
                        count: answersForQ.filter(a => a.answer?.toUpperCase() === letter).length,
                        isCorrect: q.correct_answer?.toUpperCase() === letter
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
                const duration = (new Date(s.submitted_at!).getTime() - new Date(s.started_at).getTime()) / 60000
                const max = s.max_score || totalMaxScore || 1
                return {
                    studentName: (s.student as any)?.user?.full_name || 'Unknown',
                    duration: Math.round(duration * 100) / 100,
                    score: Math.round((s.total_score / max) * 100 * 100) / 100
                }
            })

        // ── performanceHeatmap ──
        const performanceHeatmap = allSubmissions.map(s => {
            const student = s.student as any
            const max = s.max_score || totalMaxScore || 1
            const studentAnswers = allAnswers.filter(a => a.submission_id === s.id)

            return {
                studentName: student?.user?.full_name || 'Unknown',
                studentNis: student?.nis || '',
                totalScore: Math.round((s.total_score / max) * 100 * 100) / 100,
                answers: allQuestions.map((q, idx) => {
                    const ans = studentAnswers.find(a => a.question_id === q.id)
                    return {
                        questionIndex: idx + 1,
                        isCorrect: ans ? (ans.is_correct ?? null) : null,
                        scoreEarned: ans?.points_earned ?? 0,
                        maxPoints: q.points || 0,
                        questionType: q.question_type as 'MULTIPLE_CHOICE' | 'ESSAY'
                    }
                })
            }
        }).sort((a, b) => b.totalScore - a.totalScore)

        // ── studentRanking (includes violations) ──
        const studentRanking = allSubmissions.map(s => {
            const student = s.student as any
            const max = s.max_score || totalMaxScore || 1
            const pct = (s.total_score / max) * 100

            let duration: number | undefined
            if (s.started_at && s.submitted_at) {
                duration = Math.round(
                    (new Date(s.submitted_at!).getTime() - new Date(s.started_at).getTime()) / 60000 * 100
                ) / 100
            }

            return {
                name: student?.user?.full_name || 'Unknown',
                nis: student?.nis || '',
                score: s.total_score,
                maxScore: max,
                percentage: Math.round(pct * 100) / 100,
                duration,
                violations: s.violation_count || 0
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
        console.error('Error in official-exam analytics:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
