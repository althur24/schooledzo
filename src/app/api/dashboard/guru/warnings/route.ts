import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

const DEFAULT_KKM = 75

export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: teacher, error: teacherError } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (teacherError || !teacher) {
            return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })
        }

        const teacherId = teacher.id

        // 1. Get Homeroom Classes (only from active academic year)
        const { data: allHomeroomClasses } = await supabase
            .from('classes')
            .select('id, name, academic_year:academic_years(is_active)')
            .eq('homeroom_teacher_id', teacherId)

        // Filter to active year only
        const homeroomClasses = (allHomeroomClasses || []).filter((c: any) => {
            const ay = Array.isArray(c.academic_year) ? c.academic_year[0] : c.academic_year
            return ay?.is_active === true
        })

        // 2. Get Teaching Assignments
        const { data: directAssignments } = await supabase
            .from('teaching_assignments')
            .select(`
                id, 
                class_id, 
                subject:subjects(id, name, kkm), 
                class:classes(id, name),
                academic_year:academic_years(is_active)
            `)
            .eq('teacher_id', teacherId)

        // Filter active assignments only
        const activeDirectAssignments = (directAssignments || []).filter((ta: any) => {
            const arr = Array.isArray(ta.academic_year) ? ta.academic_year[0] : ta.academic_year
            return arr?.is_active === true
        })

        // Gather all relevant class IDs
        const hrClassIds = (homeroomClasses || []).map(c => c.id)
        const taClassIds = activeDirectAssignments.map(ta => ta.class_id)
        const allRelevantClassIds = Array.from(new Set([...hrClassIds, ...taClassIds]))

        if (allRelevantClassIds.length === 0) {
            return NextResponse.json({ teachingWarnings: [], homeroomWarnings: [] })
        }

        // 3. Get Students in relevant classes
        const { data: students } = await supabase
            .from('students')
            .select(`
                id, class_id, 
                user:users!students_user_id_fkey(full_name),
                class:classes(name)
            `)
            .in('class_id', allRelevantClassIds)
            .eq('status', 'ACTIVE')

        if (!students || students.length === 0) {
            return NextResponse.json({ teachingWarnings: [], homeroomWarnings: [] })
        }
        const studentIds = students.map(s => s.id)

        // 4. Get ALL Teaching Assignments for these classes to know all subjects for HR students
        const { data: allAssignments } = await supabase
            .from('teaching_assignments')
            .select(`
                id, class_id,
                subject:subjects(id, name, kkm),
                academic_year:academic_years(is_active)
            `)
            .in('class_id', allRelevantClassIds)

        const activeAllAssignments = (allAssignments || []).filter((ta: any) => {
            const arr = Array.isArray(ta.academic_year) ? ta.academic_year[0] : ta.academic_year
            return arr?.is_active === true
        })
        const allTaIds = activeAllAssignments.map(ta => ta.id)

        // 5. Get Submissions Data
        // - Quizzes
        const { data: quizzes } = await supabase.from('quizzes').select('id, title, teaching_assignment_id').in('teaching_assignment_id', allTaIds)
        const quizIds = (quizzes || []).map(q => q.id)
        let quizSubs: any[] = []
        if (quizIds.length > 0) {
            const { data } = await supabase
                .from('quiz_submissions')
                .select('quiz_id, student_id, total_score, max_score')
                .in('quiz_id', quizIds)
                .in('student_id', studentIds)
                .not('submitted_at', 'is', null)
            quizSubs = data || []
        }

        // - Exams
        const { data: exams } = await supabase.from('exams').select('id, title, teaching_assignment_id').in('teaching_assignment_id', allTaIds)
        const examIds = (exams || []).map(e => e.id)
        let examSubs: any[] = []
        if (examIds.length > 0) {
            const { data } = await supabase
                .from('exam_submissions')
                .select('exam_id, student_id, total_score')
                .in('exam_id', examIds)
                .in('student_id', studentIds)
                .eq('is_submitted', true)
            examSubs = data || []
        }

        // - Tugas
        const { data: tasks } = await supabase.from('assignments').select('id, teaching_assignment_id').in('teaching_assignment_id', allTaIds)
        const taskIds = (tasks || []).map(t => t.id)
        let taskSubsWithGrades: any[] = []
        if (taskIds.length > 0) {
            const { data: submissions } = await supabase
                .from('student_submissions')
                .select('id, student_id, assignment_id')
                .in('assignment_id', taskIds)
                .in('student_id', studentIds)

            if (submissions && submissions.length > 0) {
                const subIds = submissions.map(s => s.id)
                const { data: gradesData } = await supabase
                    .from('grades')
                    .select('submission_id, score')
                    .in('submission_id', subIds)

                // Merge grades with submissions
                taskSubsWithGrades = submissions.map(sub => {
                    const grade = (gradesData || []).find(g => g.submission_id === sub.id)
                    return { ...sub, score: grade ? grade.score : null }
                }).filter(sub => sub.score !== null)
            }
        }

        // 6. Aggregate Data
        // A helper to lookup a student's grades for a SPECIFIC teaching assignment (Mapel in a class)
        const getScoresForTAAndStudent = (taId: string, studentId: string) => {
            const scores: number[] = []

            // Quizzes
            const relatedQuizzes = (quizzes || []).filter(q => q.teaching_assignment_id === taId).map(q => q.id)
            for (const qs of quizSubs.filter(s => s.student_id === studentId && relatedQuizzes.includes(s.quiz_id))) {
                if (qs.max_score > 0) scores.push((qs.total_score / qs.max_score) * 100)
            }
            // Exams
            const relatedExams = (exams || []).filter(e => e.teaching_assignment_id === taId).map(e => e.id)
            for (const es of examSubs.filter(s => s.student_id === studentId && relatedExams.includes(s.exam_id))) {
                scores.push(es.total_score || 0)
            }
            // Tasks
            const relatedTasks = (tasks || []).filter(t => t.teaching_assignment_id === taId).map(t => t.id)
            for (const ts of taskSubsWithGrades.filter(s => s.student_id === studentId && relatedTasks.includes(s.assignment_id))) {
                scores.push(ts.score || 0)
            }

            return scores
        }

        const teachingWarnings: any[] = []
        const homeroomWarnings: any[] = []

        // Helper to unwrap Array items from Supabase joins
        const unwrap = (val: any) => Array.isArray(val) ? val[0] : val

        // Process Teaching Warnings
        for (const ta of activeDirectAssignments) {
            const classStudents = students.filter(s => s.class_id === ta.class_id)
            for (const student of classStudents) {
                const scores = getScoresForTAAndStudent(ta.id, student.id)
                if (scores.length > 0) {
                    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
                    const subjectKkm = unwrap(ta.subject)?.kkm || DEFAULT_KKM
                    if (avg < subjectKkm) {
                        teachingWarnings.push({
                            student_id: student.id,
                            student_name: unwrap(student.user)?.full_name || 'Tanpa Nama',
                            class_name: unwrap(ta.class)?.name || 'Tanpa Kelas',
                            subject_name: unwrap(ta.subject)?.name || 'Tanpa Mapel',
                            avg_score: Math.round(avg),
                            score_count: scores.length,
                            teaching_assignment_id: ta.id,
                            kkm: subjectKkm
                        })
                    }
                }
            }
        }

        // Process Homeroom Warnings
        for (const hrClass of (homeroomClasses || [])) {
            const classStudents = students.filter(s => s.class_id === hrClass.id)
            // Get all mapels (TAs) for this class
            const classTAs = activeAllAssignments.filter(ta => ta.class_id === hrClass.id)

            for (const student of classStudents) {
                for (const ta of classTAs) {
                    const scores = getScoresForTAAndStudent(ta.id, student.id)
                    if (scores.length > 0) {
                        const avg = scores.reduce((a, b) => a + b, 0) / scores.length
                        const subjectKkm = unwrap(ta.subject)?.kkm || DEFAULT_KKM
                        if (avg < subjectKkm) {
                            homeroomWarnings.push({
                                student_id: student.id,
                                student_name: unwrap(student.user)?.full_name || 'Tanpa Nama',
                                class_name: hrClass.name,
                                subject_name: unwrap(ta.subject)?.name || 'Tanpa Mapel',
                                avg_score: Math.round(avg),
                                score_count: scores.length,
                                kkm: subjectKkm
                            })
                        }
                    }
                }
            }
        }

        // Sort by lowest scores first
        teachingWarnings.sort((a, b) => a.avg_score - b.avg_score)
        homeroomWarnings.sort((a, b) => a.avg_score - b.avg_score)

        // Build "My Classes" grouped data (reuses already-fetched data, no extra queries)
        const classMap = new Map<string, { class_id: string; class_name: string; subjects: string[]; isHomeroom: boolean }>()

        for (const ta of activeDirectAssignments) {
            const cls = unwrap(ta.class)
            const subj = unwrap(ta.subject)
            if (!cls) continue
            const existing = classMap.get(cls.id)
            if (existing) {
                if (subj?.name && !existing.subjects.includes(subj.name)) {
                    existing.subjects.push(subj.name)
                }
            } else {
                classMap.set(cls.id, {
                    class_id: cls.id,
                    class_name: cls.name,
                    subjects: subj?.name ? [subj.name] : [],
                    isHomeroom: hrClassIds.includes(cls.id)
                })
            }
        }

        // Include homeroom-only classes (not in teaching assignments)
        for (const hrClass of (homeroomClasses || [])) {
            if (!classMap.has(hrClass.id)) {
                classMap.set(hrClass.id, {
                    class_id: hrClass.id,
                    class_name: hrClass.name,
                    subjects: [],
                    isHomeroom: true
                })
            } else {
                classMap.get(hrClass.id)!.isHomeroom = true
            }
        }

        const myClasses = Array.from(classMap.values()).sort((a, b) => a.class_name.localeCompare(b.class_name))

        return NextResponse.json({
            kkm: DEFAULT_KKM,
            teachingWarnings,
            homeroomWarnings,
            myClasses
        })
    } catch (error: any) {
        console.error('Error fetching dashboard warnings:', error)
        return NextResponse.json({ error: 'Server error', details: error.message }, { status: 500 })
    }
}
