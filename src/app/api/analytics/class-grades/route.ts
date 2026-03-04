import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// M2: Service Role Key required — analytics needs cross-table reads that RLS blocks for anon role.
// Access restricted to ADMIN only.
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET analytics data per class per subject
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const academicYearId = request.nextUrl.searchParams.get('academic_year_id')

        if (!academicYearId) {
            return NextResponse.json({ error: 'academic_year_id required' }, { status: 400 })
        }

        // Get all classes for this academic year
        const { data: classes, error: classesError } = await supabase
            .from('classes')
            .select('id, name, school_level, grade_level')
            .eq('academic_year_id', academicYearId)
            .order('name')

        if (classesError) throw classesError

        // Get all subjects
        const { data: subjects, error: subjectsError } = await supabase
            .from('subjects')
            .select('id, name')
            .eq('school_id', schoolId)
            .order('name')

        if (subjectsError) throw subjectsError

        // Get all students with their classes
        const { data: students, error: studentsError } = await supabase
            .from('students')
            .select('id, nis, class_id, user:users!students_user_id_fkey(full_name)')
            .eq('school_id', schoolId)

        if (studentsError) throw studentsError

        // Get teaching assignments for this academic year
        const { data: teachingAssignments, error: taError } = await supabase
            .from('teaching_assignments')
            .select('id, class_id, subject_id')
            .eq('academic_year_id', academicYearId)

        if (taError) throw taError

        // Get all assignments
        const { data: assignments, error: assignmentsError } = await supabase
            .from('assignments')
            .select('id, teaching_assignment_id')

        if (assignmentsError) throw assignmentsError

        // Get student submissions for tugas
        const { data: studentSubmissions, error: ssError } = await supabase
            .from('student_submissions')
            .select('id, student_id, assignment_id')

        // Get grades for student submissions (tugas)
        const { data: grades, error: gradesError } = await supabase
            .from('grades')
            .select('id, submission_id, score')

        // Get quiz submissions (submitted ones only - submitted_at is not null)
        const { data: quizSubmissions, error: qsError } = await supabase
            .from('quiz_submissions')
            .select('id, student_id, quiz_id, total_score, max_score, submitted_at')
            .not('submitted_at', 'is', null)

        // Get quizzes to map to teaching assignments
        const { data: quizzes, error: quizzesError } = await supabase
            .from('quizzes')
            .select('id, teaching_assignment_id')

        // Get exam submissions (submitted ones)
        const { data: examSubmissions, error: esError } = await supabase
            .from('exam_submissions')
            .select('id, student_id, exam_id, total_score, max_score, submitted_at, is_submitted')
            .eq('is_submitted', true)

        // Get exams to map to teaching assignments
        const { data: exams, error: examsError } = await supabase
            .from('exams')
            .select('id, teaching_assignment_id')



        // Build a map: class_id -> subject_id -> student grades
        const classSubjectGrades: Record<string, Record<string, { student_id: string; scores: number[] }[]>> = {}

        // Initialize structure
        classes?.forEach(cls => {
            classSubjectGrades[cls.id] = {}
            subjects?.forEach(sub => {
                classSubjectGrades[cls.id][sub.id] = []
            })
        })

        // Helper to add grade
        const addGrade = (classId: string, subjectId: string, studentId: string, score: number) => {
            if (!classSubjectGrades[classId]) return
            if (!classSubjectGrades[classId][subjectId]) {
                classSubjectGrades[classId][subjectId] = []
            }

            let studentGrades = classSubjectGrades[classId][subjectId].find(s => s.student_id === studentId)
            if (!studentGrades) {
                studentGrades = { student_id: studentId, scores: [] }
                classSubjectGrades[classId][subjectId].push(studentGrades)
            }
            if (score !== null && score !== undefined) {
                studentGrades.scores.push(score)
            }
        }

        // Process tugas (assignment) submissions with grades
        studentSubmissions?.forEach(sub => {
            // Find the grade for this submission
            const grade = grades?.find(g => g.submission_id === sub.id)
            if (!grade || grade.score === null || grade.score === undefined) return

            const assignment = assignments?.find(a => a.id === sub.assignment_id)
            if (!assignment) return

            const ta = teachingAssignments?.find(t => t.id === assignment.teaching_assignment_id)
            if (!ta) return

            const student = students?.find(s => s.id === sub.student_id)
            if (!student || student.class_id !== ta.class_id) return

            addGrade(ta.class_id, ta.subject_id, sub.student_id, grade.score)
        })

        // Process quiz submissions
        quizSubmissions?.forEach(qs => {
            // Calculate percentage score (total_score / max_score * 100)
            const quizScore = qs.max_score > 0
                ? (qs.total_score / qs.max_score) * 100
                : qs.total_score

            if (quizScore === null || quizScore === undefined) return

            const quiz = quizzes?.find(q => q.id === qs.quiz_id)
            if (!quiz) return

            const ta = teachingAssignments?.find(t => t.id === quiz.teaching_assignment_id)
            if (!ta) return

            const student = students?.find(s => s.id === qs.student_id)
            if (!student || student.class_id !== ta.class_id) return

            addGrade(ta.class_id, ta.subject_id, qs.student_id, quizScore)
        })

        // Process exam submissions
        examSubmissions?.forEach(es => {
            // Calculate percentage score (total_score / max_score * 100)
            const examScore = es.max_score > 0
                ? (es.total_score / es.max_score) * 100
                : es.total_score

            if (examScore === null || examScore === undefined) return

            const exam = exams?.find(e => e.id === es.exam_id)
            if (!exam) return

            const ta = teachingAssignments?.find(t => t.id === exam.teaching_assignment_id)
            if (!ta) return

            const student = students?.find(s => s.id === es.student_id)
            if (!student || student.class_id !== ta.class_id) return

            addGrade(ta.class_id, ta.subject_id, es.student_id, examScore)
        })

        // Build result
        const result = classes?.map(cls => {
            const classStudents = students?.filter(s => s.class_id === cls.id) || []

            const subjectAverages = subjects?.map(sub => {
                const studentGrades = classSubjectGrades[cls.id]?.[sub.id] || []

                // Calculate average for each student, then overall average
                const studentAverages = studentGrades.map(sg => {
                    const avg = sg.scores.length > 0
                        ? sg.scores.reduce((a, b) => a + b, 0) / sg.scores.length
                        : null
                    return {
                        student_id: sg.student_id,
                        average: avg
                    }
                }).filter(sa => sa.average !== null)

                const overallAvg = studentAverages.length > 0
                    ? studentAverages.reduce((a, b) => a + (b.average || 0), 0) / studentAverages.length
                    : null

                const passCount = studentAverages.filter(sa => (sa.average || 0) >= 75).length
                const failCount = studentAverages.length - passCount

                // Get student details for this subject
                const studentDetails = studentGrades.map(sg => {
                    const student = students?.find(s => s.id === sg.student_id)
                    const avg = sg.scores.length > 0
                        ? sg.scores.reduce((a, b) => a + b, 0) / sg.scores.length
                        : null
                    return {
                        student_id: sg.student_id,
                        student_name: (student?.user as any)?.full_name || '-',
                        student_nis: student?.nis || '-',
                        average: avg,
                        grade_count: sg.scores.length
                    }
                }).sort((a, b) => (a.student_name || '').localeCompare(b.student_name || ''))

                return {
                    subject_id: sub.id,
                    subject_name: sub.name,
                    average: overallAvg,
                    student_count: studentAverages.length,
                    pass_count: passCount,
                    fail_count: failCount,
                    students: studentDetails
                }
            }) || []

            return {
                class_id: cls.id,
                class_name: cls.name,
                school_level: (cls as any).school_level,
                grade_level: (cls as any).grade_level,
                total_students: classStudents.length,
                subjects: subjectAverages
            }
        }) || []

        return NextResponse.json(result)
    } catch (error) {
        console.error('Error fetching analytics:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
