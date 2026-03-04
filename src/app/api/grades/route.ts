import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

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

            // Get teaching assignment IDs for the target academic year
            let taIds: string[] | null = null
            if (allYears !== 'true') {
                let filterYearId = academicYearId
                if (!filterYearId) {
                    let yearQuery = supabase
                        .from('academic_years')
                        .select('id')
                        .eq('is_active', true)
                    if (schoolId) yearQuery = yearQuery.eq('school_id', schoolId)
                    const { data: activeYear } = await yearQuery.single()
                    if (activeYear) filterYearId = activeYear.id
                }

                if (filterYearId) {
                    let taQuery = supabase
                        .from('teaching_assignments')
                        .select('id')
                        .eq('academic_year_id', filterYearId)
                    if (schoolId) taQuery = taQuery.eq('school_id', schoolId)
                    const { data: tas } = await taQuery
                    taIds = tas?.map(t => t.id) || []
                }
            } else {
                // allYears = true: still scope to this school's teaching assignments
                if (schoolId) {
                    const { data: tas } = await supabase
                        .from('teaching_assignments')
                        .select('id')
                        .eq('school_id', schoolId)
                    taIds = tas?.map(t => t.id) || []
                }
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
                    submission:student_submissions(
                        id,
                        student_id,
                        assignment:assignments(
                            id,
                            title,
                            type,
                            teaching_assignment_id,
                            teaching_assignment:teaching_assignments(
                                subject:subjects(id, name)
                            )
                        )
                    )
                `)
                .order('graded_at', { ascending: false })

            // 2. Fetch Quiz Grades (KUIS)
            let quizQuery = supabase
                .from('quiz_submissions')
                .select(`
                    id,
                    student_id,
                    total_score,
                    max_score,
                    submitted_at,
                    quiz:quizzes(
                        id,
                        title,
                        teaching_assignment_id,
                        teaching_assignment:teaching_assignments(
                            subject:subjects(id, name)
                        )
                    )
                `)
                .not('submitted_at', 'is', null)

            // 3. Fetch Exam Grades (ULANGAN)
            let examQuery = supabase
                .from('exam_submissions')
                .select(`
                    id,
                    student_id,
                    total_score,
                    max_score,
                    submitted_at,
                    exam:exams(
                        id,
                        title,
                        teaching_assignment_id,
                        teaching_assignment:teaching_assignments(
                            subject:subjects(id, name)
                        )
                    )
                `)
                .not('submitted_at', 'is', null)

            // Filter by student_id if provided
            const studentId = request.nextUrl.searchParams.get('student_id')
            if (studentId) {
                // For grades (TUGAS), the relation makes it tricky to filter directly in one go efficiently without inner join syntax limitations in raw PostgREST via Supabase JS sometimes.
                // But we can try !inner if supported or just filter in memory for simplicity if data isn't huge, OR use the 'student_submissions' filter.
                // Actually 'grades' has 'submission_id'. 'student_submissions' has 'student_id'.
                // We can't easily filter top-level 'grades' by 'submission.student_id' in simple query builder without complex syntax.
                // Let's filter in-memory for consistency with existing structure, usually fine for school scale.
                // OPTIMIZATION: Filter Quiz/Exam directly as they have student_id column.

                quizQuery = quizQuery.eq('student_id', studentId)
                examQuery = examQuery.eq('student_id', studentId)
            }

            const { data: assignmentGrades, error: gradesError } = await assignmentQuery
            const { data: quizSubmissions, error: quizzesError } = await quizQuery
            const { data: examSubmissions, error: examsError } = await examQuery

            if (!gradesError && assignmentGrades) {
                const mappedAssignments = assignmentGrades
                    .filter((g: any) => {
                        if (studentId && g.submission?.student_id !== studentId) return false
                        if (!taIds) return true // all_years
                        const taId = g.submission?.assignment?.teaching_assignment_id
                        return taId && taIds.includes(taId)
                    })
                    .map((g: any) => {
                        const submission = g.submission
                        const assignment = submission?.assignment
                        const subject = assignment?.teaching_assignment?.subject
                        return {
                            id: g.id,
                            student_id: submission?.student_id,
                            subject_id: subject?.id,
                            grade_type: assignment?.type || 'TUGAS',
                            score: g.score,
                            subject: { name: subject?.name || '-' },
                            graded_at: g.graded_at
                        }
                    })
                allGrades.push(...mappedAssignments)
            }

            if (!quizzesError && quizSubmissions) {
                const mappedQuizzes = quizSubmissions
                    .filter((qs: any) => {
                        if (!taIds) return true
                        const taId = qs.quiz?.teaching_assignment_id
                        return taId && taIds.includes(taId)
                    })
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
            }

            if (!examsError && examSubmissions) {
                const mappedExams = examSubmissions
                    .filter((es: any) => {
                        if (!taIds) return true
                        const taId = es.exam?.teaching_assignment_id
                        return taId && taIds.includes(taId)
                    })
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
            }

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
                .update({ score, feedback, graded_at: new Date().toISOString() })
                .eq('id', existing.id)
                .select()
                .single()

            if (error) throw error
            gradeData = data
        } else {
            // Create new grade
            const { data, error } = await supabase
                .from('grades')
                .insert({ submission_id, score, feedback })
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
                    message: `${subjectName} - Nilai: ${score}`,
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
