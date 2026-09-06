import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { resolveKkm } from '@/lib/resolveKkm'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { mergeRemedialScores } from '@/lib/remedialScore'

// batchedIn per 100 id (batas URL) + fetchAllRows per chunk: satu chunk 100 id
// bisa mengandung >1000 baris yang otherwise terpotong diam-diam.
function batchedFetchAll<T>(column: string, ids: string[], buildQuery: (chunk: string[]) => any): Promise<T[]> {
    return batchedIn<T>(column, ids, async (chunk) => ({ data: await fetchAllRows<T>(buildQuery(chunk)), error: null }))
}

// Helper: Supabase single-relation selects sometimes type as array
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrap(val: any): any {
    if (Array.isArray(val)) return val[0] ?? null
    return val
}

// GET: Fetch student performance data for the logged-in teacher.
// Scope: kelas tempat guru mengajar (teaching assignments) + kelas yang diwalikan.
// Untuk kelas wali -> SEMUA mapel; untuk kelas non-wali -> hanya mapel yang diampu guru.
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get teacher ID (scoped by school)
        let teacherQuery = supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
        if (schoolId) teacherQuery = teacherQuery.eq('school_id', schoolId)
        const { data: teacher } = await teacherQuery.single()

        if (!teacher) {
            return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })
        }

        const teacherId = teacher.id

        // 1. Classes where this teacher is wali kelas (active academic year only)
        const { data: homeroomClasses, error: hrError } = await supabase
            .from('classes')
            .select(`
                id, name, grade_level, school_level,
                academic_year:academic_years(id, name, is_active)
            `)
            .eq('homeroom_teacher_id', teacherId)

        if (hrError) throw hrError

        const activeHomeroomClasses = (homeroomClasses || [])
            .map((c: any) => ({ ...c, academic_year: unwrap(c.academic_year) }))
            .filter((c: any) => c.academic_year?.is_active)

        // 2. Classes from teaching assignments (active academic year only)
        const { data: taRows, error: taRowsError } = await supabase
            .from('teaching_assignments')
            .select(`
                class:classes(id, name, grade_level, school_level, academic_year:academic_years(id, name, is_active))
            `)
            .eq('teacher_id', teacherId)

        if (taRowsError) throw taRowsError

        const hrClassIds = new Set(activeHomeroomClasses.map((c: any) => c.id))
        const teachingClassMap = new Map<string, any>()
        for (const row of (taRows || [])) {
            const cls = unwrap((row as any).class)
            if (!cls) continue
            const unwrapped = { ...cls, academic_year: unwrap(cls.academic_year) }
            if (!unwrapped.academic_year?.is_active) continue
            if (!teachingClassMap.has(unwrapped.id)) {
                teachingClassMap.set(unwrapped.id, unwrapped)
            }
        }

        // Union: kelas wali dulu (default), lalu kelas yang hanya diajari
        const allClasses: any[] = [
            ...activeHomeroomClasses.map((c: any) => ({ ...c, isHomeroom: true })),
            ...Array.from(teachingClassMap.values())
                .filter((c: any) => !hrClassIds.has(c.id))
                .map((c: any) => ({ ...c, isHomeroom: false })),
        ]

        if (allClasses.length === 0) {
            return NextResponse.json({ classes: [], students: [] })
        }

        const requestedClassId = request.nextUrl.searchParams.get('class_id')
        const currentClass = (requestedClassId && allClasses.find((c: any) => c.id === requestedClassId)) || allClasses[0]
        const classId = currentClass.id

        // Get students in this class
        const { data: students, error: studentsError } = await supabase
            .from('students')
            .select(`
                id, nis, status,
                user:users!students_user_id_fkey(id, full_name, username)
            `)
            .eq('class_id', classId)
            .eq('status', 'ACTIVE')
            .order('nis', { ascending: true })

        if (studentsError) throw studentsError

        // Get all teaching assignments for this class (to know which subjects)
        const { data: teachingAssignments, error: taError } = await supabase
            .from('teaching_assignments')
            .select(`
                id, teacher_id,
                subject:subjects(id, name, kkm),
                academic_year:academic_years(id, is_active)
            `)
            .eq('class_id', classId)

        if (taError) throw taError

        // Filter to active academic year assignments
        let activeAssignments: any[] = (teachingAssignments || []).filter(
            (ta) => unwrap(ta.academic_year)?.is_active
        )

        // SCOPE MATA PELAJARAN:
        // - Wali kelas kelasnya sendiri -> semua mapel
        // - Guru biasa -> hanya mapel yang diampu di kelas tersebut
        if (!currentClass.isHomeroom) {
            activeAssignments = activeAssignments.filter((ta: any) => ta.teacher_id === teacherId)
        }

        const taIds = activeAssignments.map((ta) => ta.id)

        if (taIds.length === 0 || !students || students.length === 0) {
            return NextResponse.json({
                classes: allClasses,
                current_class_id: classId,
                is_homeroom: currentClass.isHomeroom,
                students: students || [],
                subjects: activeAssignments.map((ta) => unwrap(ta.subject)),
                student_grades: []
            })
        }

        const studentIds = students.map((s) => s.id)

        // Fetch all grades across subjects for these students
        // 1. Assignment submissions + grades
        // fetchAllRows: 40 siswa × banyak tugas setahun bisa >1000 submissions —
        // query biasa terpotong diam-diam di 1000 baris.
        const submissions = await fetchAllRows(supabase
            .from('student_submissions')
            .select(`
                id, student_id, assignment_id, submitted_at,
                assignment:assignments(id, title, teaching_assignment_id, type)
            `)
            .in('student_id', studentIds)
            .order('id'))

        // Filter submissions to only those for this class's teaching assignments
        const relevantSubmissions = submissions.filter((s: any) =>
            taIds.includes(s.assignment?.teaching_assignment_id)
        )

        const submissionIds = relevantSubmissions.map((s: any) => s.id)

        let grades: any[] = []
        if (submissionIds.length > 0) {
            // batchedIn per 100 id (batas URL) + fetchAllRows per chunk
            grades = await batchedFetchAll<any>(
                'submission_id', submissionIds,
                (chunk) => supabase.from('grades').select('*').in('submission_id', chunk).order('id')
            )
        }

        // 2. Quiz submissions (policy/cap untuk merge remedial)
        const quizzes = await fetchAllRows(supabase
            .from('quizzes')
            .select('id, title, teaching_assignment_id, is_remedial, remedial_for_id, remedial_score_policy, remedial_max_score')
            .in('teaching_assignment_id', taIds)
            .order('id'))

        const quizIds = quizzes.map((q: any) => q.id)

        let quizSubmissions: any[] = []
        if (quizIds.length > 0) {
            quizSubmissions = await batchedFetchAll<any>(
                'quiz_id', quizIds,
                (chunk) => supabase
                    .from('quiz_submissions')
                    .select('id, quiz_id, student_id, total_score, max_score, is_graded')
                    .in('quiz_id', chunk)
                    .in('student_id', studentIds)
                    .not('submitted_at', 'is', null)
                    .order('id')
            )
        }

        // 3. Exam submissions (policy/cap untuk merge remedial)
        const exams = await fetchAllRows(supabase
            .from('exams')
            .select('id, title, teaching_assignment_id, is_remedial, remedial_for_id, remedial_score_policy, remedial_max_score')
            .in('teaching_assignment_id', taIds)
            .order('id'))

        const examIds = exams.map((e: any) => e.id)

        let examSubmissions: any[] = []
        if (examIds.length > 0) {
            examSubmissions = await batchedFetchAll<any>(
                'exam_id', examIds,
                (chunk) => supabase
                    .from('exam_submissions')
                    .select('id, exam_id, student_id, total_score, max_score, is_submitted')
                    .in('exam_id', chunk)
                    .in('student_id', studentIds)
                    .eq('is_submitted', true)
                    .order('id')
            )
        }

        // 4. Official exams (UTS/UAS) — fetch by subject IDs in scope for this class
        const subjectIds = activeAssignments
            .map((ta) => unwrap(ta.subject)?.id)
            .filter((id: string | undefined): id is string => !!id)
        const uniqueSubjectIds = [...new Set(subjectIds)]

        let officialExams: any[] = []
        let officialExamSubs: any[] = []
        if (true) {
            const { data: oeData } = await supabase
                .from('official_exams')
                .select('id, title, exam_type, subject_id, target_class_ids, is_remedial, remedial_for_id, remedial_score_policy, remedial_max_score')
                .eq('school_id', schoolId)
                .in('subject_id', uniqueSubjectIds)

            officialExams = (oeData || []).filter((oe: any) =>
                oe.target_class_ids?.includes(classId)
            )

            const oeIds = officialExams.map((oe: any) => oe.id)
            if (oeIds.length > 0) {
                officialExamSubs = await batchedFetchAll<any>(
                    'exam_id', oeIds,
                    (chunk) => supabase
                        .from('official_exam_submissions')
                        .select('id, exam_id, student_id, total_score, max_score, is_submitted, is_graded')
                        .in('exam_id', chunk)
                        .in('student_id', studentIds)
                        .eq('is_submitted', true)
                        .order('id')
                )
            }
        }

        // Build per-student, per-subject grade summary
        const studentGrades = studentIds.map((studentId: string) => {
            const subjectScores: Record<string, {
                subject_id: string
                subject_name: string
                tugas_scores: number[]
                kuis_scores: number[]
                ulangan_scores: number[]
                uts_scores: number[]
                uas_scores: number[]
            }> = {}

            // Initialize subjects
            activeAssignments.forEach((ta) => {
                const subj = unwrap(ta.subject)
                if (subj && !subjectScores[subj.id]) {
                    subjectScores[subj.id] = {
                        subject_id: subj.id,
                        subject_name: subj.name,
                        tugas_scores: [],
                        kuis_scores: [],
                        ulangan_scores: [],
                        uts_scores: [],
                        uas_scores: []
                    }
                }
            })

            // Assignment grades (tugas)
            relevantSubmissions
                .filter((s: any) => s.student_id === studentId)
                .forEach((sub: any) => {
                    const grade = grades.find((g: any) => g.submission_id === sub.id)
                    if (grade) {
                        const ta = activeAssignments.find((a) => a.id === sub.assignment?.teaching_assignment_id)
                        const subj = ta ? unwrap(ta.subject) : null
                        if (subj && subjectScores[subj.id]) {
                            subjectScores[subj.id].tugas_scores.push(grade.score)
                        }
                    }
                })

            // Quiz scores — remedial merge: nilai remedial MENGGANTIKAN nilai
            // asli per kuis dasar sesuai kebijakan (HIGHEST/AVERAGE/CAP).
            // GAP FIX: sebelumnya tidak pernah merge.
            const quizGroups = new Map<string, { scores: any[]; quiz: any }>()
            quizSubmissions
                .filter((qs: any) => qs.student_id === studentId)
                .forEach((qs: any) => {
                    const quiz = (quizzes || []).find((q) => q.id === qs.quiz_id)
                    if (!quiz) return
                    const baseId = quiz.remedial_for_id || quiz.id
                    const entry = quizGroups.get(baseId) || { scores: [] as any[], quiz }
                    entry.scores.push({
                        score: qs.max_score > 0 ? (qs.total_score / qs.max_score) * 100 : 0,
                        isRemedial: !!quiz.is_remedial,
                        policy: quiz.remedial_score_policy,
                        cap: quiz.remedial_max_score,
                    })
                    quizGroups.set(baseId, entry)
                })
            quizGroups.forEach(({ scores, quiz }) => {
                const ta = activeAssignments.find((a) => a.id === quiz.teaching_assignment_id)
                const subj = ta ? unwrap(ta.subject) : null
                if (subj && subjectScores[subj.id]) {
                    const final = mergeRemedialScores(scores)
                    if (final !== null) subjectScores[subj.id].kuis_scores.push(Math.round(final))
                }
            })

            // Exam scores — remedial merge, pola sama dengan kuis.
            // GAP FIX: sebelumnya tidak pernah merge.
            const examGroups = new Map<string, { scores: any[]; exam: any }>()
            examSubmissions
                .filter((es: any) => es.student_id === studentId)
                .forEach((es: any) => {
                    const exam = (exams || []).find((e) => e.id === es.exam_id)
                    if (!exam) return
                    const baseId = exam.remedial_for_id || exam.id
                    const entry = examGroups.get(baseId) || { scores: [] as any[], exam }
                    // Persen (0-100) — konsisten dengan kuis/UTS/UAS dan skala
                    // kebijakan CAP; sebelumnya raw total_score (skala max_score
                    // ujian) sehingga CAP salah menerapkan batas.
                    entry.scores.push({
                        score: es.max_score > 0 ? (es.total_score / es.max_score) * 100 : (es.total_score || 0),
                        isRemedial: !!exam.is_remedial,
                        policy: exam.remedial_score_policy,
                        cap: exam.remedial_max_score,
                    })
                    examGroups.set(baseId, entry)
                })
            examGroups.forEach(({ scores, exam }) => {
                const ta = activeAssignments.find((a) => a.id === exam.teaching_assignment_id)
                const subj = ta ? unwrap(ta.subject) : null
                if (subj && subjectScores[subj.id]) {
                    const final = mergeRemedialScores(scores)
                    if (final !== null) subjectScores[subj.id].ulangan_scores.push(Math.round(final))
                }
            })

            // Official exam scores (UTS/UAS) — remedial merge sesuai kebijakan
            // (HIGHEST/AVERAGE/CAP — helper terpusat). Tanpa ini siswa remedial
            // menyumbang 2 skor UTS/UAS per mata pelajaran.
            const officialGroups = new Map<string, { scores: any[]; oe: any }>()
            officialExamSubs
                .filter((os: any) => os.student_id === studentId && os.is_graded && os.max_score > 0)
                .forEach((os: any) => {
                    const oe = officialExams.find((e: any) => e.id === os.exam_id)
                    if (!oe) return
                    const baseId = oe.remedial_for_id || oe.id
                    const entry = officialGroups.get(baseId) || { scores: [] as any[], oe }
                    entry.scores.push({
                        score: (os.total_score / os.max_score) * 100,
                        isRemedial: !!oe.is_remedial,
                        policy: oe.remedial_score_policy,
                        cap: oe.remedial_max_score,
                    })
                    officialGroups.set(baseId, entry)
                })
            officialGroups.forEach(({ scores, oe }) => {
                const final = mergeRemedialScores(scores)
                if (final === null) return
                const score = Math.round(final)
                if (subjectScores[oe.subject_id]) {
                    if (oe.exam_type === 'UTS') {
                        subjectScores[oe.subject_id].uts_scores.push(score)
                    } else {
                        subjectScores[oe.subject_id].uas_scores.push(score)
                    }
                }
            })

            return {
                student_id: studentId,
                subjects: subjectScores
            }
        })

        return NextResponse.json({
            classes: allClasses,
            current_class_id: classId,
            is_homeroom: currentClass.isHomeroom,
            students: students || [],
            subjects: await Promise.all(
                activeAssignments
                    .map((ta) => unwrap(ta.subject))
                    .filter((s: any, i: number, arr: any[]) => s && arr.findIndex((x: any) => x?.id === s.id) === i)
                    .map(async (subj: any) => {
                        const resolvedKkm = await resolveKkm(subj.id, currentClass.school_level, currentClass.grade_level)
                        return { ...subj, kkm: resolvedKkm }
                    })
            ),
            student_grades: studentGrades,
            // Raw data for detail view
            raw: {
                assignments: relevantSubmissions,
                grades,
                quizzes,
                quiz_submissions: quizSubmissions,
                exams,
                exam_submissions: examSubmissions,
                official_exams: officialExams,
                official_exam_submissions: officialExamSubs
            }
        })
    } catch (error) {
        console.error('Error fetching siswa data:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
