import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound, findExamsOutsideSchool } from '@/lib/tenantGuard'
import { resolveKkm } from '@/lib/resolveKkm'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { getTeacherScope, ownsTeachingAssignment, coTeachesClassSubject } from '@/lib/teacherScope'

/**
 * Batas soal representative untuk analisa per-soal & heatmap. Exam anomali
 * (bekas runaway / import rusak — lihat kasus 2026-09-16) di atas batas ini
 * hanya disajikan statistik siswanya; analisa per-soal di-skip (menyesatkan
 * dan sangat berat diproses). Paritas SOURCE_QUESTIONS_LIMIT examBatch.ts.
 */
const ANALYTICS_QUESTIONS_LIMIT = 500

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

// ─── GET /api/analytics/exam/[id] ───────────────────────────────
// ?batch_id= → merge analitik SEMUA member batch ulangan multi-kelas
// (tab hasil "Semua Kelas"). Batch = 1 exam per kelas dengan soal
// salinan (id beda, order_index sama) — jawaban member dipetakan ke
// soal kanonik (representative) via order_index.
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const { id: examId } = await params
        const batchId = request.nextUrl.searchParams.get('batch_id')

        // 1) Fetch exam details + teaching assignment (representative)
        const { data: exam, error: examError } = await supabase
            .from('exams')
            .select(`
                id, title, duration_minutes,
                teaching_assignment:teaching_assignments(
                    class:classes(id, name, school_level, grade_level),
                    subject:subjects(id, name, kkm),
                    academic_year:academic_years(school_id)
                )
            `)
            .eq('id', examId)
            .single()

        if (examError || !exam) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }

        // Tenant guard: exam harus milik sekolah caller (IDOR lintas sekolah)
        if (tenantMismatch((exam.teaching_assignment as any)?.academic_year?.school_id, schoolId)) {
            return notFound()
        }

        const ta = exam.teaching_assignment as any
        const classId = ta?.class?.id
        const subjectId = ta?.subject?.id
        const schoolLevel = ta?.class?.school_level
        const gradeLevel = ta?.class?.grade_level

        let kkm = ta?.subject?.kkm ?? 75
        if (subjectId && schoolLevel && gradeLevel) {
            kkm = await resolveKkm(subjectId, schoolLevel, gradeLevel)
        }

        // ── Batch mode: resolve member exams (1 per kelas), scope-filtered ──
        // GURU hanya member kelas yang dia ampou (owner/co-teacher); ADMIN
        // semua member se-sekolah. batch_siblings guru sudah scope-filtered
        // di GET /api/exams/[id] — ini lapisan yang sama di sisi analitik.
        let memberIds: string[] = [examId]
        const classNameByMember = new Map<string, string>()
        let memberClassIds: string[] = []
        if (batchId) {
            const { data: members } = await supabase
                .from('exams')
                .select('id, teaching_assignment:teaching_assignments(teacher_id, subject_id, class_id, class:classes(id, name))')
                .eq('batch_id', batchId)
            let visible: any[] = members || []
            if (visible.length > 0) {
                if ((await findExamsOutsideSchool(visible.map(m => m.id), schoolId)).length > 0) {
                    return notFound()
                }
                if (user.role === 'GURU') {
                    const scope = await getTeacherScope(user.id)
                    visible = visible.filter(m => {
                        const mta = Array.isArray(m.teaching_assignment) ? m.teaching_assignment[0] : m.teaching_assignment
                        return ownsTeachingAssignment(scope, mta?.teacher_id)
                            || coTeachesClassSubject(scope, mta?.subject_id, mta?.class_id)
                    })
                }
            }
            if (visible.length === 0) visible = [{ id: examId }]
            memberIds = visible.map(m => m.id)
            memberClassIds = []
            for (const m of visible) {
                const mta = Array.isArray(m.teaching_assignment) ? m.teaching_assignment[0] : m.teaching_assignment
                const cls = Array.isArray(mta?.class) ? mta?.class[0] : mta?.class
                if (cls?.id) {
                    memberClassIds.push(cls.id)
                    if (cls.name) classNameByMember.set(m.id, cls.name)
                }
            }
        }

        // 2) Soal kanonik = soal representative, urut order_index.
        // Batch: soal member adalah salinan (id beda, order sama) — peta
        // question_id → order_index lintas member dipakai untuk menganalisa
        // jawaban siswa semua kelas terhadap soal kanonik.
        const { data: questions } = await supabase
            .from('exam_questions')
            .select('id, question_text, question_type, options, correct_answer, points, order_index')
            .eq('exam_id', examId)
            .order('order_index', { ascending: true })

        const allQuestions = questions || []
        const totalMaxScore = allQuestions.reduce((sum, q) => sum + (q.points || 0), 0)

        // A2 hardening: exam anomali (bekas runaway / import gila) > 500 soal →
        // analisa per-soal & heatmap DI-SKIP (menyesatkan & sangat berat);
        // statistik siswa (rata-rata, distribusi, ranking) tetap disajikan.
        const { count: questionsCount } = await supabase
            .from('exam_questions')
            .select('id', { count: 'exact', head: true })
            .eq('exam_id', examId)
        const skipPerQuestionAnalysis = (questionsCount || 0) > ANALYTICS_QUESTIONS_LIMIT

        // Peta question_id → order_index (representative + semua member)
        const orderIndexByQuestionId = new Map<string, number>()
        for (const q of allQuestions) orderIndexByQuestionId.set(q.id, q.order_index)

        // Posisi kanonik: exact by question id utk jawaban representative
        // (tahan data anomali order_index ganda), fallback via order_index
        // utk jawaban member batch (id soal mereka berbeda).
        const canonicalPosByQuestionId = new Map<string, number>()
        allQuestions.forEach((q, idx) => canonicalPosByQuestionId.set(q.id, idx))
        const canonicalPosByOrderIndex = new Map<number, number>()
        allQuestions.forEach((q, idx) => { if (!canonicalPosByOrderIndex.has(q.order_index)) canonicalPosByOrderIndex.set(q.order_index, idx) })
        const resolveCanonicalPos = (questionId: string): number | undefined => {
            const direct = canonicalPosByQuestionId.get(questionId)
            if (direct !== undefined) return direct
            const oi = orderIndexByQuestionId.get(questionId)
            if (oi === undefined) return undefined
            return canonicalPosByOrderIndex.get(oi)
        }

        // Member "selaras" = jumlah soalnya sama dengan representative — hanya
        // jawaban member selaras yang dipetakan ke analisa per-soal & heatmap.
        // Member tak selaras (sinkronisasi gagal/terpotong) tetap masuk statistik
        // siswa (rata-rata, distribusi, ranking) — angka itu tidak bergantung
        // pemetaan soal.
        const alignedMemberIds = new Set<string>([examId])
        if (batchId && memberIds.length > 1 && !skipPerQuestionAnalysis) {
            // batchedIn + fetchAllRows: member × puluhan soal bisa >1000 baris
            const memberQuestions = await batchedIn<any>('exam_id', memberIds, async (chunk) => ({
                data: await fetchAllRows(
                    supabase
                        .from('exam_questions')
                        .select('id, exam_id, order_index')
                        .in('exam_id', chunk)
                        .order('id')
                ),
                error: null
            }))
            const countByMember = new Map<string, number>()
            for (const q of (memberQuestions || [])) {
                orderIndexByQuestionId.set(q.id, q.order_index)
                countByMember.set(q.exam_id, (countByMember.get(q.exam_id) || 0) + 1)
            }
            for (const m of memberIds) {
                if ((countByMember.get(m) || 0) === allQuestions.length) {
                    alignedMemberIds.add(m)
                }
            }
        }

        // 3) Fetch all submitted exam submissions (SEMUA member saat batch)
        // fetchAllRows: ujian serentak 1000+ peserta — query biasa terpotong
        // diam-diam di 1000 baris sehingga analitik (rata-rata, distribusi,
        // ranking) kehilangan siswa tanpa error. order('id') = tiebreaker stabil.
        const baseSubmissionsQuery = supabase
            .from('exam_submissions')
            .select(`
                id, exam_id, student_id, started_at, submitted_at, total_score, max_score,
                violation_count, is_submitted,
                student:students(id, nis, user:users!students_user_id_fkey(full_name))
            `)
            .eq('is_submitted', true)
            .order('id')
        const allSubmissions = await fetchAllRows(
            (batchId && memberIds.length > 1)
                ? baseSubmissionsQuery.in('exam_id', memberIds)
                : baseSubmissionsQuery.eq('exam_id', examId)
        )

        // 4) Fetch all exam_answers for these submissions (normalized table)
        // batchedIn per 100 submission id (batas URL) + fetchAllRows per chunk:
        // 100 submission × puluhan soal bisa >1000 baris jawaban per chunk
        const submissionIds = allSubmissions.map(s => s.id)
        const allAnswers: any[] = await batchedIn(
            'submission_id', submissionIds,
            async (chunk) => ({
                data: await fetchAllRows(
                    supabase
                        .from('exam_answers')
                        .select('submission_id, question_id, answer, is_correct, points_earned')
                        .in('submission_id', chunk)
                ),
                error: null
            })
        )

        // Exam pemilik submission — dipakai filter jawaban member selaras
        const examIdBySubmission = new Map<string, string>()
        for (const s of allSubmissions) examIdBySubmission.set(s.id, (s as any).exam_id)
        const alignedAnswers = allAnswers.filter(a => {
            const ownerExamId = examIdBySubmission.get(a.submission_id)
            return !!ownerExamId && alignedMemberIds.has(ownerExamId)
        })

        // 5) Total students in class — count by ENROLLMENT. class_id is unique per
        //    (class, academic year) and enrollment records persist after promotion/
        //    graduation, so this stays correct for historical exams. Counting
        //    students.class_id (current) would drop students who have since moved up.
        //    Batch: jumlah enrollment SEMUA kelas member.
        let totalStudentsInClass = 0
        if (batchId && memberClassIds.length > 0) {
            const { count } = await supabase
                .from('student_enrollments')
                .select('id', { count: 'exact', head: true })
                .in('class_id', memberClassIds)
            totalStudentsInClass = count || 0
        } else if (classId) {
            const { count } = await supabase
                .from('student_enrollments')
                .select('id', { count: 'exact', head: true })
                .eq('class_id', classId)
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

        // ── questionAnalysis (from exam_answers table, mapped ke soal kanonik) ──
        // A2 hardening: exam anomali (> ANALYTICS_QUESTIONS_LIMIT soal) → skip
        // analisa per-soal (berat + tidak bermakna); statistik siswa tetap disajikan.
        const questionAnalysis = skipPerQuestionAnalysis ? [] : allQuestions.map((q, idx) => {
            // Jawaban siswa semua kelas untuk posisi soal ini (batch: id soal
            // member berbeda — cocokkan via posisi kanonik)
            const answersForQ = alignedAnswers.filter(a => resolveCanonicalPos(a.question_id) === idx)
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
            } else if (q.question_type === 'TRUE_FALSE') {
                optionDistribution = ['BENAR', 'SALAH'].map(val => ({
                    option: val,
                    count: answersForQ.filter(a => a.answer?.toUpperCase() === val).length,
                    isCorrect: q.correct_answer?.toUpperCase() === val
                }))
            } else if (q.question_type === 'MULTIPLE_ANSWER' && q.options) {
                optionDistribution = (q.options as string[]).map((_: string, optIdx: number) => {
                    const letter = String.fromCharCode(65 + optIdx)
                    let correctLetters: string[] = []
                    try { correctLetters = JSON.parse(q.correct_answer || '[]') } catch {}
                    return {
                        option: letter,
                        count: answersForQ.filter(a => {
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
                const duration = (new Date(s.submitted_at!).getTime() - new Date(s.started_at).getTime()) / 60000
                const max = s.max_score || totalMaxScore || 1
                return {
                    studentName: (s.student as any)?.user?.full_name || 'Unknown',
                    duration: Math.round(duration * 100) / 100,
                    score: Math.round((s.total_score / max) * 100 * 100) / 100
                }
            })

        // ── performanceHeatmap (member selaras — jawaban terpetakan ke kanonik) ──
        // A2 hardening: skip pada exam anomali (paritas questionAnalysis).
        const performanceHeatmap = skipPerQuestionAnalysis ? [] : allSubmissions
            .filter(s => alignedMemberIds.has((s as any).exam_id))
            .map(s => {
                const student = s.student as any
                const max = s.max_score || totalMaxScore || 1
                const studentAnswers = allAnswers.filter(a => a.submission_id === s.id)

                // Peta jawaban member → posisi kanonik (exact id utk representative)
                const answerByPos = new Map<number, any>()
                for (const a of studentAnswers) {
                    const pos = resolveCanonicalPos(a.question_id)
                    if (pos !== undefined) answerByPos.set(pos, a)
                }

                return {
                    studentName: student?.user?.full_name || 'Unknown',
                    studentNis: student?.nis || '',
                    totalScore: Math.round((s.total_score / max) * 100 * 100) / 100,
                    answers: allQuestions.map((q, idx) => {
                        const ans = answerByPos.get(idx)
                        return {
                            questionIndex: idx + 1,
                            isCorrect: ans ? (ans.is_correct ?? null) : null,
                            scoreEarned: ans?.points_earned ?? 0,
                            maxPoints: q.points || 0,
                            questionType: q.question_type
                        }
                    })
                }
            }).sort((a, b) => b.totalScore - a.totalScore)

        // ── studentRanking (includes violations; batch membawa nama kelas) ──
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
                className: classNameByMember.get((s as any).exam_id),
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
        console.error('Error in exam analytics:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
