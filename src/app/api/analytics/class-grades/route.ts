import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { mergeRemedialScores } from '@/lib/remedialScore'
import { round2 } from '@/lib/formatScore'
import { enrollmentClassAt, EnrollmentInterval } from '@/lib/enrollmentClassAt'

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
                .order('id')
        )

        // SOURCE OF TRUTH for "who was in which class during this year": student_enrollments.
        // We must NOT use students.class_id (current class) here, otherwise students who have
        // since been promoted/graduated disappear from their old class's historical analytics.
        const yearClassIds = classes?.map(c => c.id) || []
        const enrollments: any[] = yearClassIds.length > 0
            ? await fetchAllRows(
                supabase
                    .from('student_enrollments')
                    .select('student_id, class_id, status, enrolled_at, ended_at, created_at, updated_at')
                    .eq('academic_year_id', academicYearId)
                    .in('class_id', yearClassIds)
                    .order('id')
            )
            : []

        // classRoster: class_id -> Set(student_id) enrolled in that class this year
        // (tugas/kuis/ulangan dinilai di kelas TA-nya — historis per item).
        // enrollmentByStudent: student_id -> baris interval (atribusi UTS/UAS
        // per kelas yang berlaku SAAT ujian dimulai, bukan last-wins acak).
        const classRoster = new Map<string, Set<string>>()
        const enrollmentByStudent = new Map<string, EnrollmentInterval[]>()
        ;(enrollments || []).forEach((e: any) => {
            if (!e.class_id || !e.student_id) return
            if (!classRoster.has(e.class_id)) classRoster.set(e.class_id, new Set())
            classRoster.get(e.class_id)!.add(e.student_id)
            if (!enrollmentByStudent.has(e.student_id)) enrollmentByStudent.set(e.student_id, [])
            enrollmentByStudent.get(e.student_id)!.push(e)
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
        const assignments = await batchedIn<{id: string, type?: string, teaching_assignment_id: string}>(
            'teaching_assignment_id', taIds,
            (chunk) => supabase.from('assignments').select('id, teaching_assignment_id').in('teaching_assignment_id', chunk)
        )

        const assignmentIds = assignments.map(a => a.id)

        // Get student submissions for tugas — batched + paged per chunk
        // (100 assignment × puluhan siswa bisa >1000 baris per chunk)
        const studentSubmissions = await batchedFetchAll<{id: string, student_id: string, assignment_id: string}>(
            'assignment_id', assignmentIds,
            (chunk) => supabase.from('student_submissions').select('id, student_id, assignment_id').in('assignment_id', chunk).order('id')
        )

        const submissionIds = studentSubmissions.map(s => s.id)

        // Get grades for student submissions — batched (≤1 grade per submission, chunk stays small)
        const grades = await batchedIn<{id: string, submission_id: string, score: number}>(
            'submission_id', submissionIds,
            (chunk) => supabase.from('grades').select('id, submission_id, score').in('submission_id', chunk).order('id')
        )

        // Get quizzes (scoped by year's TAs) — inner join instead of .in(taIds):
        // ratusan TA id overflow limit 16KB header (pola Fase 1)
        // (is_remedial/remedial_for_id/policy/cap untuk merge nilai remedial)
        const { data: quizzes } = await supabase
            .from('quizzes')
            .select('id, teaching_assignment_id, is_remedial, remedial_for_id, remedial_score_policy, remedial_max_score, teaching_assignment:teaching_assignments!inner(academic_year_id)')
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
                .order('id')
        )

        // Get exams (scoped by year's TAs) — inner join, pola sama seperti quizzes
        // (is_remedial/remedial_for_id/policy/cap untuk merge nilai remedial)
        const { data: exams } = await supabase
            .from('exams')
            .select('id, teaching_assignment_id, is_remedial, remedial_for_id, remedial_score_policy, remedial_max_score, teaching_assignment:teaching_assignments!inner(academic_year_id)')
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
                .order('id')
        )

        // Get official exams (UTS/UAS) for this academic year
        // (is_remedial + remedial_for_id + policy/cap dibutuhkan untuk merge nilai remedial)
        const { data: officialExams } = await supabase
            .from('official_exams')
            .select('id, subject_id, target_class_ids, start_time, is_remedial, remedial_for_id, remedial_score_policy, remedial_max_score, exam_type')
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
                .order('id')
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

        // Build a map: class_id -> subject_id -> student grades (PER KATEGORI).
        // Rumus SATU dengan halaman Rekap Nilai (paritas pipeline /api/grades):
        // rata-rata per kategori (TUGAS/KUIS/ULANGAN/UTS/UAS) dulu, lalu rata-rata
        // antar kategori — BUKAN campur semua nilai jadi satu timbunan (dulu:
        // 10 tugas 90 + 1 ulangan 50 → 86.36 vs rekap 70 untuk siswa yang sama).
        // Kategori kosong dikecualikan (bobot dinormalisasi ke kategori yang ada).
        const classSubjectGrades: Record<string, Record<string, { student_id: string; categoryScores: Record<string, number[]> }[]>> = {}

        // Initialize structure
        classes?.forEach(cls => {
            classSubjectGrades[cls.id] = {}
            subjects?.forEach(sub => {
                classSubjectGrades[cls.id][sub.id] = []
            })
        })

        // Helper to add grade — skor di-round2 di input (paritas /api/grades
        // yang membulatkan tiap skor sebelum merge, mencegah flip KKM antar halaman)
        const addGrade = (classId: string, subjectId: string, studentId: string, category: string, score: number) => {
            if (!classSubjectGrades[classId]) return
            if (!classSubjectGrades[classId][subjectId]) {
                classSubjectGrades[classId][subjectId] = []
            }

            let studentGrades = classSubjectGrades[classId][subjectId].find(s => s.student_id === studentId)
            if (!studentGrades) {
                studentGrades = { student_id: studentId, categoryScores: {} }
                classSubjectGrades[classId][subjectId].push(studentGrades)
            }
            if (score !== null && score !== undefined && Number.isFinite(score)) {
                if (!studentGrades.categoryScores[category]) studentGrades.categoryScores[category] = []
                studentGrades.categoryScores[category].push(round2(score))
            }
        }

        // Rata-rata seorang siswa utk satu mapel = mean dari rata-rata kategori
        // yang ada (paritas rumus Rekap Nilai: tugas/kuis/ulangan/UTS/UAS bobot sama)
        const studentCategoryAverage = (sg: { categoryScores: Record<string, number[]> }): number | null => {
            const categoryAvgs: number[] = []
            for (const scores of Object.values(sg.categoryScores)) {
                if (scores.length > 0) {
                    categoryAvgs.push(scores.reduce((a, b) => a + b, 0) / scores.length)
                }
            }
            return categoryAvgs.length > 0
                ? categoryAvgs.reduce((a, b) => a + b, 0) / categoryAvgs.length
                : null
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

            // Paritas /api/grades: ulangan offline (type='ULANGAN') masuk kategori
            // ULANGAN, bukan TUGAS — sama seperti yang dilihat halaman Rekap.
            const tugasCategory = assignment.type === 'ULANGAN' ? 'ULANGAN' : 'TUGAS'
            addGrade(ta.class_id, ta.subject_id, sub.student_id, tugasCategory, grade.score)
        })

        // Process quiz submissions — remedial merge: nilai remedial MENGGANTIKAN
        // nilai asli per (siswa, kuis dasar) sesuai kebijakan (HIGHEST/AVERAGE/CAP).
        // GAP FIX: sebelumnya tidak pernah merge → siswa remedial menyumbang 2 skor.
        const quizBest = new Map<string, { scores: any[] }>()
        quizSubmissions?.forEach(qs => {
            const quiz = quizzes?.find(q => q.id === qs.quiz_id)
            if (!quiz) return

            const quizScore = qs.max_score > 0
                ? (qs.total_score / qs.max_score) * 100
                : qs.total_score
            if (quizScore === null || quizScore === undefined) return

            const baseQuizId = (quiz as any).remedial_for_id || quiz.id
            const key = `${qs.student_id}:${baseQuizId}`
            const entry = quizBest.get(key) || { scores: [] as any[] }
            entry.scores.push({
                score: quizScore,
                isRemedial: !!(quiz as any).is_remedial,
                policy: (quiz as any).remedial_score_policy,
                cap: (quiz as any).remedial_max_score,
            })
            quizBest.set(key, entry)
        })
        quizBest.forEach((entry, key) => {
            const [studentId, baseQuizId] = key.split(':')
            const quiz = quizzes?.find(q => q.id === baseQuizId)
            if (!quiz) return

            const ta = teachingAssignments?.find(t => t.id === quiz.teaching_assignment_id)
            if (!ta) return

            // Year-aware membership: was this student enrolled in this class this year?
            if (!classRoster.get(ta.class_id)?.has(studentId)) return

            const final = mergeRemedialScores(entry.scores)
            if (final === null) return
            addGrade(ta.class_id, ta.subject_id, studentId, 'KUIS', final)
        })

        // Process exam submissions — remedial merge, pola sama dengan kuis di atas.
        // GAP FIX: sebelumnya tidak pernah merge.
        const examBest = new Map<string, { scores: any[] }>()
        examSubmissions?.forEach(es => {
            const exam = exams?.find(e => e.id === es.exam_id)
            if (!exam) return

            const examScore = es.max_score > 0
                ? (es.total_score / es.max_score) * 100
                : es.total_score
            if (examScore === null || examScore === undefined) return

            const baseExamId = (exam as any).remedial_for_id || exam.id
            const key = `${es.student_id}:${baseExamId}`
            const entry = examBest.get(key) || { scores: [] as any[] }
            entry.scores.push({
                score: examScore,
                isRemedial: !!(exam as any).is_remedial,
                policy: (exam as any).remedial_score_policy,
                cap: (exam as any).remedial_max_score,
            })
            examBest.set(key, entry)
        })
        examBest.forEach((entry, key) => {
            const [studentId, baseExamId] = key.split(':')
            const exam = exams?.find(e => e.id === baseExamId)
            if (!exam) return

            const ta = teachingAssignments?.find(t => t.id === exam.teaching_assignment_id)
            if (!ta) return

            // Year-aware membership: was this student enrolled in this class this year?
            if (!classRoster.get(ta.class_id)?.has(studentId)) return

            const final = mergeRemedialScores(entry.scores)
            if (final === null) return
            addGrade(ta.class_id, ta.subject_id, studentId, 'ULANGAN', final)
        })

        // Process official exam (UTS/UAS) submissions.
        // Remedial merge: nilai remedial MENGGANTIKAN nilai asli per (siswa,
        // ujian dasar) sesuai kebijakan (HIGHEST/AVERAGE/CAP — helper terpusat).
        // Tanpa ini siswa remedial menyumbang 2 skor UTS/UAS ke rata-rata kelas.
        const officialGroups = new Map<string, { scores: any[] }>()
        officialExamSubmissions?.forEach(os => {
            const officialExam = officialExams?.find(oe => oe.id === os.exam_id)
            if (!officialExam) return

            const score = os.max_score > 0
                ? (os.total_score / os.max_score) * 100
                : os.total_score
            if (score === null || score === undefined) return

            const baseExamId = (officialExam as any).remedial_for_id || officialExam.id
            const key = `${os.student_id}:${baseExamId}`
            const entry = officialGroups.get(key) || { scores: [] as any[] }
            entry.scores.push({
                score,
                isRemedial: !!(officialExam as any).is_remedial,
                policy: (officialExam as any).remedial_score_policy,
                cap: (officialExam as any).remedial_max_score,
            })
            officialGroups.set(key, entry)
        })
        officialGroups.forEach((entry, key) => {
            const [studentId, baseExamId] = key.split(':')
            const baseExam = officialExams?.find(oe => oe.id === baseExamId)
            if (!baseExam) return

            // Resolve the student's class IN THIS YEAR at the time the base exam
            // started (enrollmentClassAt — interval enrolled_at..ended_at), so a
            // student who has since moved up / pindah kelas mid-year tetap
            // teratribusi ke kelas yang benar (deterministik, bukan last-wins).
            const studentRows = enrollmentByStudent.get(studentId)
            const studentClass = studentRows
                ? enrollmentClassAt(studentRows, baseExam.start_time)?.class_id
                : null
            if (!studentClass) return

            // Only process if the student's class that year is among the exam's target classes
            if (!baseExam.target_class_ids?.includes(studentClass)) return

            const final = mergeRemedialScores(entry.scores)
            if (final === null) return

            // Attribute the grade to that class + the exam's subject.
            // Kategori = exam_type (UTS/UAS) — paritas /api/grades.
            addGrade(studentClass, baseExam.subject_id, studentId, baseExam.exam_type || 'UTS', final)
        })

        // Build result
        const result = classes?.map(cls => {
            // Total students = how many were enrolled in this class THIS year (year-aware).
            const totalStudents = classRoster.get(cls.id)?.size || 0

            const subjectAverages = subjects?.map(sub => {
                const studentGrades = classSubjectGrades[cls.id]?.[sub.id] || []

                // Calculate average for each student, then overall average
                // Banding passCount dari avg MENTAH (keadilan batas KKM);
                // output average/students round-2 (kontrak presisi tunggal).
                const studentAverages = studentGrades.map(sg => {
                    const avg = studentCategoryAverage(sg)
                    return {
                        student_id: sg.student_id,
                        average: avg
                    }
                }).filter(sa => sa.average !== null)

                const overallAvg = studentAverages.length > 0
                    ? round2(studentAverages.reduce((a, b) => a + (b.average || 0), 0) / studentAverages.length)
                    : null

                const kkm = getKkm(sub.id, (cls as any).school_level, (cls as any).grade_level, sub.kkm)
                const passCount = studentAverages.filter(sa => (sa.average || 0) >= kkm).length
                const failCount = studentAverages.length - passCount

                // Get student details for this subject
                const studentDetails = studentGrades.map(sg => {
                    const student = students?.find(s => s.id === sg.student_id)
                    const avg = studentCategoryAverage(sg)
                    const gradeCount = Object.values(sg.categoryScores)
                        .reduce((sum, scores) => sum + scores.length, 0)
                    return {
                        student_id: sg.student_id,
                        student_name: (student?.user as any)?.full_name || '-',
                        student_nis: student?.nis || '-',
                        average: avg !== null ? round2(avg) : null,
                        grade_count: gradeCount
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
