import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// M2: Service Role Key required — analytics needs cross-table reads that RLS blocks for anon role.
// Access restricted to ADMIN only.
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper: batch .in() queries to avoid URL overflow (max ~100 UUIDs per request)
async function batchedIn<T>(table: string, column: string, ids: string[], select: string): Promise<T[]> {
    if (ids.length === 0) return []
    const BATCH = 100
    const results: T[] = []
    for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH)
        const { data, error } = await supabase.from(table).select(select).in(column, chunk)
        if (error) throw error
        if (data) results.push(...(data as T[]))
    }
    return results
}
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
            .select('id, name, kkm')
            .eq('school_id', schoolId)
            .order('name')

        if (subjectsError) throw subjectsError

        // Get all students (used for name/nis lookups in the result)
        const { data: students, error: studentsError } = await supabase
            .from('students')
            .select('id, nis, class_id, user:users!students_user_id_fkey(full_name)')
            .eq('school_id', schoolId)

        if (studentsError) throw studentsError

        // SOURCE OF TRUTH for "who was in which class during this year": student_enrollments.
        // We must NOT use students.class_id (current class) here, otherwise students who have
        // since been promoted/graduated disappear from their old class's historical analytics.
        const yearClassIds = classes?.map(c => c.id) || []
        const { data: enrollments, error: enrollError } = yearClassIds.length > 0
            ? await supabase
                .from('student_enrollments')
                .select('student_id, class_id')
                .eq('academic_year_id', academicYearId)
                .in('class_id', yearClassIds)
            : { data: [] as any[], error: null }

        if (enrollError) throw enrollError

        // classRoster: class_id -> Set(student_id) enrolled in that class this year
        // studentClassByYear: student_id -> class_id (for official-exam attribution)
        const classRoster = new Map<string, Set<string>>()
        const studentClassByYear = new Map<string, string>()
        ;(enrollments || []).forEach((e: any) => {
            if (!e.class_id || !e.student_id) return
            if (!classRoster.has(e.class_id)) classRoster.set(e.class_id, new Set())
            classRoster.get(e.class_id)!.add(e.student_id)
            studentClassByYear.set(e.student_id, e.class_id)
        })

        // Get teaching assignments for this academic year (scoped by school via academic_year)
        const { data: teachingAssignments, error: taError } = await supabase
            .from('teaching_assignments')
            .select('id, class_id, subject_id')
            .eq('academic_year_id', academicYearId)

        if (taError) throw taError

        const taIds = teachingAssignments?.map(ta => ta.id) || []

        if (taIds.length === 0) {
            return NextResponse.json([])
        }

        // Get all assignments (scoped by school's TAs) — batched to avoid URL overflow
        const assignments = await batchedIn<{id: string, teaching_assignment_id: string}>('assignments', 'teaching_assignment_id', taIds, 'id, teaching_assignment_id')

        const assignmentIds = assignments.map(a => a.id)

        // Get student submissions for tugas — batched
        const studentSubmissions = await batchedIn<{id: string, student_id: string, assignment_id: string}>('student_submissions', 'assignment_id', assignmentIds, 'id, student_id, assignment_id')

        const submissionIds = studentSubmissions.map(s => s.id)

        // Get grades for student submissions — batched
        const grades = await batchedIn<{id: string, submission_id: string, score: number}>('grades', 'submission_id', submissionIds, 'id, submission_id, score')

        // Get quizzes (scoped by school's TAs)
        const { data: quizzes, error: quizzesError } = await supabase
            .from('quizzes')
            .select('id, teaching_assignment_id')
            .in('teaching_assignment_id', taIds)

        const quizIds = quizzes?.map(q => q.id) || []

        // Get quiz submissions (scoped by school's quizzes)
        const { data: quizSubmissions, error: qsError } = quizIds.length > 0
            ? await supabase
                .from('quiz_submissions')
                .select('id, student_id, quiz_id, total_score, max_score, submitted_at')
                .in('quiz_id', quizIds)
                .not('submitted_at', 'is', null)
            : { data: [] as any[], error: null }

        // Get exams (scoped by school's TAs)
        const { data: exams, error: examsError } = await supabase
            .from('exams')
            .select('id, teaching_assignment_id')
            .in('teaching_assignment_id', taIds)

        const examIds = exams?.map(e => e.id) || []

        // Get exam submissions (scoped by school's exams)
        const { data: examSubmissions, error: esError } = examIds.length > 0
            ? await supabase
                .from('exam_submissions')
                .select('id, student_id, exam_id, total_score, max_score, submitted_at, is_submitted')
                .in('exam_id', examIds)
                .eq('is_submitted', true)
            : { data: [] as any[], error: null }

        // Get official exams (UTS/UAS) for this academic year
        const { data: officialExams } = await supabase
            .from('official_exams')
            .select('id, subject_id, target_class_ids')
            .eq('school_id', schoolId)
            .eq('academic_year_id', academicYearId)

        const officialExamIds = officialExams?.map(oe => oe.id) || []

        // Get all official exam submissions (only submitted ones)
        const { data: officialExamSubmissions } = officialExamIds.length > 0
            ? await supabase
                .from('official_exam_submissions')
                .select('id, student_id, exam_id, total_score, max_score, is_submitted')
                .in('exam_id', officialExamIds)
                .eq('is_submitted', true)
            : { data: [] as any[] }

        // Get all granular KKM
        const subjectIds = subjects?.map(s => s.id) || []
        const { data: subjectKkms } = subjectIds.length > 0
            ? await supabase
                .from('subject_kkm')
                .select('subject_id, school_level, grade_level, kkm')
                .in('subject_id', subjectIds)
            : { data: [] as any[] }

        const getKkm = (subjectId: string, schoolLevel: string, gradeLevel: number, fallback: number = 75) => {
            if (!schoolLevel || !gradeLevel) return fallback
            const match = subjectKkms?.find(sk => 
                sk.subject_id === subjectId && 
                sk.school_level === schoolLevel && 
                sk.grade_level === gradeLevel
            )
            return match?.kkm || fallback
        }

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

            // Year-aware membership: was this student enrolled in this class this year?
            if (!classRoster.get(ta.class_id)?.has(sub.student_id)) return

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

            // Year-aware membership: was this student enrolled in this class this year?
            if (!classRoster.get(ta.class_id)?.has(qs.student_id)) return

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

            // Year-aware membership: was this student enrolled in this class this year?
            if (!classRoster.get(ta.class_id)?.has(es.student_id)) return

            addGrade(ta.class_id, ta.subject_id, es.student_id, examScore)
        })

        // Process official exam (UTS/UAS) submissions
        officialExamSubmissions?.forEach(os => {
            const score = os.max_score > 0
                ? (os.total_score / os.max_score) * 100
                : os.total_score

            if (score === null || score === undefined) return

            const officialExam = officialExams?.find(oe => oe.id === os.exam_id)
            if (!officialExam) return

            // Resolve the student's class IN THIS YEAR (not their current class), so a
            // student who has since moved up is still attributed to the right class.
            const studentClass = studentClassByYear.get(os.student_id)
            if (!studentClass) return

            // Only process if the student's class that year is among the exam's target classes
            if (!officialExam.target_class_ids?.includes(studentClass)) return

            // Attribute the grade to that class + the exam's subject
            addGrade(studentClass, officialExam.subject_id, os.student_id, score)
        })

        // Build result
        const result = classes?.map(cls => {
            // Total students = how many were enrolled in this class THIS year (year-aware).
            const totalStudents = classRoster.get(cls.id)?.size || 0

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

                const kkm = getKkm(sub.id, (cls as any).school_level, (cls as any).grade_level, sub.kkm)
                const passCount = studentAverages.filter(sa => (sa.average || 0) >= kkm).length
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
                total_students: totalStudents,
                subjects: subjectAverages
            }
        }) || []

        return NextResponse.json(result)
    } catch (error) {
        console.error('Error fetching analytics:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
