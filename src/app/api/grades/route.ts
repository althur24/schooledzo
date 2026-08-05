import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { fetchAllRows } from '@/lib/fetchAllRows'

// Create admin client to bypass RLS
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET all grades (for admin analytics/rekap nilai)
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // Only admin can fetch all grades
        if (user.role === 'ADMIN') {
            const academicYearId = request.nextUrl.searchParams.get('academic_year_id')
            const allYears = request.nextUrl.searchParams.get('all_years')

            // Resolve the DB-side year filter (replaces the old in-memory taIds list):
            // - default: the requested academic year, or the active one
            // - all_years=true: all of this school's academic years
            let filterYearId: string | null = null
            let filterYearIds: string[] | null = null
            if (allYears !== 'true') {
                filterYearId = academicYearId
                if (!filterYearId) {
                    let yearQuery = supabase
                        .from('academic_years')
                        .select('id')
                        .eq('is_active', true)
                    if (schoolId) yearQuery = yearQuery.eq('school_id', schoolId)
                    const { data: activeYear } = await yearQuery.single()
                    if (activeYear) filterYearId = activeYear.id
                }
            } else if (schoolId) {
                // all_years = true: still scope to this school's academic years
                const { data: schoolYears } = await supabase
                    .from('academic_years')
                    .select('id')
                    .eq('school_id', schoolId)
                filterYearIds = schoolYears?.map(y => y.id) || []
            }

            // Apply the year filter on the teaching_assignments embed (!inner join)
            const applyYearFilter = (query: any, taPath: string) => {
                if (filterYearId) return query.eq(`${taPath}.academic_year_id`, filterYearId)
                if (filterYearIds && filterYearIds.length > 0) return query.in(`${taPath}.academic_year_id`, filterYearIds)
                return query
            }

            const allGrades: any[] = []

            // 1. Fetch Assignment Grades (TUGAS)
            let assignmentQuery = supabase
                .from('grades')
                .select(`
                    id,
                    score,
                    feedback,
                    graded_at,
                    submission:student_submissions!inner(
                        id,
                        student_id,
                        assignment:assignments!inner(
                            id,
                            title,
                            type,
                            teaching_assignment_id,
                            teaching_assignment:teaching_assignments!inner(
                                subject:subjects(id, name)
                            )
                        )
                    )
                `)
                .order('graded_at', { ascending: false })
            assignmentQuery = applyYearFilter(assignmentQuery, 'submission.assignment.teaching_assignment')

            // 2. Fetch Quiz Grades (KUIS)
            let quizQuery = supabase
                .from('quiz_submissions')
                .select(`
                    id,
                    student_id,
                    total_score,
                    max_score,
                    submitted_at,
                    quiz:quizzes!inner(
                        id,
                        title,
                        teaching_assignment_id,
                        teaching_assignment:teaching_assignments!inner(
                            subject:subjects(id, name)
                        )
                    )
                `)
                .not('submitted_at', 'is', null)
            quizQuery = applyYearFilter(quizQuery, 'quiz.teaching_assignment')

            // 3. Fetch Exam Grades (ULANGAN)
            let examQuery = supabase
                .from('exam_submissions')
                .select(`
                    id,
                    student_id,
                    total_score,
                    max_score,
                    submitted_at,
                    exam:exams!inner(
                        id,
                        title,
                        teaching_assignment_id,
                        teaching_assignment:teaching_assignments!inner(
                            subject:subjects(id, name)
                        )
                    )
                `)
                .not('submitted_at', 'is', null)
            examQuery = applyYearFilter(examQuery, 'exam.teaching_assignment')

            // Filter by student_id if provided (all four categories now filtered at DB level)
            const studentId = request.nextUrl.searchParams.get('student_id')
            if (studentId) {
                assignmentQuery = assignmentQuery.eq('submission.student_id', studentId)
                quizQuery = quizQuery.eq('student_id', studentId)
                examQuery = examQuery.eq('student_id', studentId)
            }

            // fetchAllRows: rekap setahun penuh bisa jauh melampaui limit 1000 baris
            // PostgREST per request — ambil semua halaman (cap 50.000 baris per kategori)
            const assignmentGrades = await fetchAllRows(assignmentQuery, 1000, 50)
            const quizSubmissions = await fetchAllRows(quizQuery, 1000, 50)
            const examSubmissions = await fetchAllRows(examQuery, 1000, 50)

            const mappedAssignments = assignmentGrades
                .map((g: any) => {
                    const submission = g.submission
                    const assignment = submission?.assignment
                    const subject = assignment?.teaching_assignment?.subject
                    return {
                        id: g.id,
                        student_id: submission?.student_id,
                        subject_id: subject?.id,
                        // Normalize PR/PROYEK/LATIHAN to TUGAS so they count in rekap/rapor
                        grade_type: assignment?.type === 'ULANGAN' ? 'ULANGAN' : 'TUGAS',
                        score: g.score,
                        subject: { name: subject?.name || '-' },
                        graded_at: g.graded_at
                    }
                })
            allGrades.push(...mappedAssignments)

            const mappedQuizzes = quizSubmissions
                .map((qs: any) => {
                    const quiz = qs.quiz
                    const subject = quiz?.teaching_assignment?.subject
                    const score = qs.max_score > 0 ? (qs.total_score / qs.max_score) * 100 : 0
                    return {
                        id: qs.id,
                        student_id: qs.student_id,
                        subject_id: subject?.id,
                        grade_type: 'KUIS',
                        score: Math.round(score * 10) / 10,
                        subject: { name: subject?.name || '-' },
                        graded_at: qs.submitted_at
                    }
                })
            allGrades.push(...mappedQuizzes)

            const mappedExams = examSubmissions
                .map((es: any) => {
                    const exam = es.exam
                    const subject = exam?.teaching_assignment?.subject
                    const score = es.max_score > 0 ? (es.total_score / es.max_score) * 100 : 0
                    return {
                        id: es.id,
                        student_id: es.student_id,
                        subject_id: subject?.id,
                        grade_type: 'ULANGAN',
                        score: Math.round(score * 10) / 10,
                        subject: { name: subject?.name || '-' },
                        graded_at: es.submitted_at
                    }
                })
            allGrades.push(...mappedExams)

            // 4. Fetch Official Exam Grades (UTS / UAS) — scoped to this school only.
            //    Year filter is intentionally NOT applied here (same as before).
            let officialExamQuery = supabase
                .from('official_exam_submissions')
                .select(`
                    id,
                    student_id,
                    total_score,
                    max_score,
                    submitted_at,
                    is_graded,
                    exam:official_exams!inner(
                        id,
                        title,
                        exam_type,
                        subject_id,
                        subject:subjects(id, name),
                        school_id,
                        academic_year_id
                    )
                `)
                .eq('is_submitted', true)
                .not('submitted_at', 'is', null)

            if (schoolId) {
                officialExamQuery = officialExamQuery.eq('exam.school_id', schoolId)
            }
            if (studentId) {
                officialExamQuery = officialExamQuery.eq('student_id', studentId)
            }

            const officialSubmissions = await fetchAllRows(officialExamQuery, 1000, 50)

            const mappedOfficial = officialSubmissions
                .map((os: any) => {
                    const exam = os.exam
                    const subject = exam?.subject
                    const score = os.max_score > 0 ? (os.total_score / os.max_score) * 100 : 0
                    return {
                        id: os.id,
                        student_id: os.student_id,
                        subject_id: subject?.id,
                        grade_type: exam?.exam_type || 'UTS', // 'UTS' or 'UAS'
                        score: Math.round(score * 10) / 10,
                        subject: { name: subject?.name || '-' },
                        graded_at: os.submitted_at
                    }
                })
            allGrades.push(...mappedOfficial)

            return NextResponse.json(allGrades)
        }

        // For non-admin, return empty or limited data
        return NextResponse.json([])
    } catch (error) {
        console.error('Error fetching grades:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST grade a submission (for teachers)
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { submission_id, score, feedback } = await request.json()

        if (!submission_id || score === undefined) {
            return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 })
        }

        const numScore = parseInt(score)
        if (isNaN(numScore) || numScore < 0 || numScore > 100) {
            return NextResponse.json({ error: 'Nilai harus antara 0 dan 100' }, { status: 400 })
        }

        // H2 Security Fix: Verify this teacher owns the submission's teaching assignment
        const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (teacher) {
            const { data: submission } = await supabase
                .from('student_submissions')
                .select('assignment:assignments(teaching_assignment:teaching_assignments(teacher_id))')
                .eq('id', submission_id)
                .single()

            const assignmentTeacherId = (submission?.assignment as any)?.teaching_assignment?.teacher_id
            if (assignmentTeacherId && assignmentTeacherId !== teacher.id) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses untuk menilai submission ini' }, { status: 403 })
            }
        }

        // Check if grade exists - Use regular client here since it's user action
        const { data: existing } = await supabase // Use admin to ensure teacher can grade
            .from('grades')
            .select('id')
            .eq('submission_id', submission_id)
            .single()

        let gradeData

        if (existing) {
            // Update existing grade
            const { data, error } = await supabase
                .from('grades')
                .update({ score: numScore, feedback, graded_at: new Date().toISOString() })
                .eq('id', existing.id)
                .select()
                .single()

            if (error) throw error
            gradeData = data
        } else {
            // Create new grade
            const { data, error } = await supabase
                .from('grades')
                .insert({ submission_id, score: numScore, feedback })
                .select()
                .single()

            if (error) throw error
            gradeData = data
        }

        // Send notification to student
        try {
            const { data: submission } = await supabase
                .from('student_submissions')
                .select(`
                    student:students(user_id),
                    assignment:assignments(title, teaching_assignment:teaching_assignments(subject:subjects(name)))
                `)
                .eq('id', submission_id)
                .single()

            const studentData = submission?.student as any
            if (studentData?.user_id) {
                const assignmentTitle = (submission?.assignment as any)?.title || 'Tugas'
                const subjectName = (submission?.assignment as any)?.teaching_assignment?.subject?.name || ''

                await supabase.from('notifications').insert({
                    user_id: studentData.user_id,
                    type: 'NILAI_KELUAR',
                    title: `Nilai Keluar: ${assignmentTitle}`,
                    message: `${subjectName} - Nilai: ${numScore}`,
                    link: '/dashboard/siswa/nilai'
                })
            }
        } catch (notifError) {
            console.error('Error sending grade notification:', notifError)
        }

        return NextResponse.json(gradeData)
    } catch (error) {
        console.error('Error grading submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
