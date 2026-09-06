import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'

// M2: Service Role Key required — analytics needs cross-table reads that RLS blocks for anon role.
// Access restricted to ADMIN only.
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// batchedIn per 100 id (batas URL) + fetchAllRows per chunk: satu chunk 100 id bisa
// berisi >1000 baris (100 kuis × puluhan siswa) yang otherwise terpotong diam-diam.
function batchedFetchAll<T>(column: string, ids: string[], buildQuery: (chunk: string[]) => any): Promise<T[]> {
    return batchedIn<T>(column, ids, async (chunk) => ({ data: await fetchAllRows<T>(buildQuery(chunk)), error: null }))
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
        // fetchAllRows: sekolah besar punya >1000 siswa — query biasa terpotong diam-diam
        const students = await fetchAllRows<any>(
            supabase
                .from('students')
                .select('id, nis, class_id, user:users!students_user_id_fkey(full_name)')
                .eq('school_id', schoolId)
        )

        // SOURCE OF TRUTH for "who was in which class during this year": student_enrollments.
        // We must NOT use students.class_id (current class) here, otherwise students who have
        // since been promoted/graduated disappear from their old class's historical analytics.
        const yearClassIds = classes?.map(c => c.id) || []
        const enrollments: any[] = yearClassIds.length > 0
            ? await fetchAllRows(
                supabase
                    .from('student_enrollments')
                    .select('student_id, class_id')
                    .eq('academic_year_id', academicYearId)
                    .in('class_id', yearClassIds)
            )
            : []

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
        const assignments = await batchedIn<{id: string, teaching_assignment_id: string}>(
            'teaching_assignment_id', taIds,
            (chunk) => supabase.from('assignments').select('id, teaching_assignment_id').in('teaching_assignment_id', chunk)
        )

        const assignmentIds = assignments.map(a => a.id)

        // Get student submissions for tugas — batched + paged per chunk
        // (100 assignment × puluhan siswa bisa >1000 baris per chunk)
        const studentSubmissions = await batchedFetchAll<{id: string, student_id: string, assignment_id: string}>(
            'assignment_id', assignmentIds,
            (chunk) => supabase.from('student_submissions').select('id, student_id, assignment_id').in('assignment_id', chunk)
        )

        const submissionIds = studentSubmissions.map(s => s.id)

        // Get grades for student submissions — batched (≤1 grade per submission, chunk stays small)
        const grades = await batchedIn<{id: string, submission_id: string, score: number}>(
            'submission_id', submissionIds,
            (chunk) => supabase.from('grades').select('id, submission_id, score').in('submission_id', chunk)
        )

        // Get quizzes (scoped by year's TAs) — inner join instead of .in(taIds):
        // ratusan TA id overflow limit 16KB header (pola Fase 1)
        const { data: quizzes } = await supabase
            .from('quizzes')
            .select('id, teaching_assignment_id, teaching_assignment:teaching_assignments!inner(academic_year_id)')
            .eq('teaching_assignment.academic_year_id', academicYearId)

        const quizIds = (quizzes || []).map(q => q.id)

        // Get quiz submissions (scoped by year's quizzes) — batched + paged per chunk
        const quizSubmissions = await batchedFetchAll<any>(
            'quiz_id', quizIds,
            (chunk) => supabase
                .from('quiz_submissions')
                .select('id, student_id, quiz_id, total_score, max_score, submitted_at')
                .in('quiz_id', chunk)
                .not('submitted_at', 'is', null)
        )

        // Get exams (scoped by year's TAs) — inner join, pola sama seperti quizzes
        const { data: exams } = await supabase
            .from('exams')
            .select('id, teaching_assignment_id, teaching_assignment:teaching_assignments!inner(academic_year_id)')
            .eq('teaching_assignment.academic_year_id', academicYearId)

        const examIds = (exams || []).map(e => e.id)

        // Get exam submissions (scoped by year's exams) — batched + paged per chunk
        const examSubmissions = await batchedFetchAll<any>(
            'exam_id', examIds,
            (chunk) => supabase
                .from('exam_submissions')
                .select('id, student_id, exam_id, total_score, max_score, submitted_at, is_submitted')
                .in('exam_id', chunk)
                .eq('is_submitted', true)
        )

        // Get official exams (UTS/UAS) for this academic year
        // (is_remedial + remedial_for_id dibutuhkan untuk merge nilai remedial)
        const { data: officialExams } = await supabase
            .from('official_exams')
            .select('id, subject_id, target_class_ids, is_remedial, remedial_for_id')
            .eq('school_id', schoolId)
            .eq('academic_year_id', academicYearId)

        const officialExamIds = officialExams?.map(oe => oe.id) || []

        // Get all official exam submissions (only submitted ones) — batched + paged per chunk
        const officialExamSubmissions = await batchedFetchAll<any>(
            'exam_id', officialExamIds,
            (chunk) => supabase
                .from('official_exam_submissions')
                .select('id, student_id, exam_id, total_score, max_score, is_submitted')
                .in('exam_id', chunk)
                .eq('is_submitted', true)
        )

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

        // Process official exam (UTS/UAS) submissions.
        // Remedial merge: nilai remedial MENGGANTIKAN nilai asli per (siswa,
        // ujian dasar) — diambil yang tertinggi (pola sama dengan /api/grades).
        // Tanpa ini siswa remedial menyumbang 2 skor UTS/UAS ke rata-rata kelas.
        const officialBest = new Map<string, { studentId: string, baseExamId: string, score: number }>()
        officialExamSubmissions?.forEach(os => {
            const officialExam = officialExams?.find(oe => oe.id === os.exam_id)
            if (!officialExam) return

            const score = os.max_score > 0
                ? (os.total_score / os.max_score) * 100
                : os.total_score
            if (score === null || score === undefined) return

            const baseExamId = (officialExam as any).remedial_for_id || officialExam.id
            const key = `${os.student_id}:${baseExamId}`
            const prev = officialBest.get(key)
            if (!prev || score > prev.score) {
                officialBest.set(key, { studentId: os.student_id, baseExamId, score })
            }
        })
        officialBest.forEach(({ studentId, baseExamId, score }) => {
            const baseExam = officialExams?.find(oe => oe.id === baseExamId)
            if (!baseExam) return

            // Resolve the student's class IN THIS YEAR (not their current class), so a
            // student who has since moved up is still attributed to the right class.
            const studentClass = studentClassByYear.get(studentId)
            if (!studentClass) return

            // Only process if the student's class that year is among the exam's target classes
            if (!baseExam.target_class_ids?.includes(studentClass)) return

            // Attribute the grade to that class + the exam's subject
            addGrade(studentClass, baseExam.subject_id, studentId, score)
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
