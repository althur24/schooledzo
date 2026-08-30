import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'

const DEFAULT_KKM = 75

// batchedIn per 100 id (batas URL) + fetchAllRows per chunk: satu chunk 100 id bisa
// berisi >1000 baris (100 kuis × puluhan siswa) yang otherwise terpotong diam-diam.
function batchedFetchAll<T>(column: string, ids: string[], buildQuery: (chunk: string[]) => any): Promise<T[]> {
    return batchedIn<T>(column, ids, async (chunk) => ({ data: await fetchAllRows<T>(buildQuery(chunk)), error: null }))
}

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
            .select('id, name, school_level, grade_level, academic_year:academic_years(is_active)')
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
                class:classes(id, name, school_level, grade_level),
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
                class:classes(id, name, school_level, grade_level),
                academic_year:academic_years(is_active)
            `)
            .in('class_id', allRelevantClassIds)

        const activeAllAssignments = (allAssignments || []).filter((ta: any) => {
            const arr = Array.isArray(ta.academic_year) ? ta.academic_year[0] : ta.academic_year
            return arr?.is_active === true
        })
        const allTaIds = activeAllAssignments.map(ta => ta.id)

        // 5. Get Submissions Data
        // Satu query dengan .in(quizIds).in(studentIds) membawa ratusan id per kolom
        // untuk guru multi-kelas → URL overflow. Dipisah: batch per 100 id pada kolom
        // pertama, filter siswa di JS (pola yang sama seperti rantai tugas di bawah).
        const studentSet = new Set(studentIds)

        // - Quizzes (batched: guru multi-kelas × mapel menghasilkan puluhan TA id —
        //   .in() polos bisa overflow limit URL)
        const quizzes = await batchedIn<any>(
            'teaching_assignment_id', allTaIds,
            (chunk) => supabase.from('quizzes').select('id, title, teaching_assignment_id, is_remedial, remedial_for_id').in('teaching_assignment_id', chunk)
        )
        const quizIds = quizzes.map(q => q.id)
        const allQuizSubs = await batchedFetchAll<{ quiz_id: string; student_id: string; total_score: number; max_score: number }>(
            'quiz_id', quizIds,
            (chunk) => supabase
                .from('quiz_submissions')
                .select('quiz_id, student_id, total_score, max_score')
                .in('quiz_id', chunk)
                .not('submitted_at', 'is', null)
        )
        let quizSubs: { quiz_id: string; student_id: string; total_score: number; max_score: number }[] = allQuizSubs.filter(s => studentSet.has(s.student_id))

        // Remedial merge — selaras rekap (api/grades): nilai remedial MENGGANTIKAN
        // nilai kuis asli (skor tertinggi per siswa per kuis asli), bukan
        // double-count yang membuat siswa lulus-remedial tetap muncul di warning.
        const remedialOf = new Map(quizzes.map(q => [q.id, q.remedial_for_id || null]))
        const quizScoreGroups = new Map<string, { quiz_id: string; student_id: string; pct: number }>()
        for (const s of quizSubs) {
            const base = remedialOf.get(s.quiz_id) || s.quiz_id
            const key = `${s.student_id}:${base}`
            const pct = s.max_score > 0 ? (s.total_score / s.max_score) * 100 : 0
            const existing = quizScoreGroups.get(key)
            if (!existing || pct > existing.pct) {
                quizScoreGroups.set(key, { quiz_id: base, student_id: s.student_id, pct })
            }
        }
        quizSubs = Array.from(quizScoreGroups.values()).map(g => ({
            quiz_id: g.quiz_id,
            student_id: g.student_id,
            total_score: g.pct,
            max_score: 100,
        }))

        // - Exams (batched, alasan sama)
        const exams = await batchedIn<any>(
            'teaching_assignment_id', allTaIds,
            (chunk) => supabase.from('exams').select('id, title, teaching_assignment_id').in('teaching_assignment_id', chunk)
        )
        const examIds = exams.map(e => e.id)
        const allExamSubs = await batchedFetchAll<{ exam_id: string; student_id: string; total_score: number; max_score: number }>(
            'exam_id', examIds,
            (chunk) => supabase
                .from('exam_submissions')
                .select('exam_id, student_id, total_score, max_score')
                .in('exam_id', chunk)
                .eq('is_submitted', true)
        )
        const examSubs = allExamSubs.filter(s => studentSet.has(s.student_id))

        // - Tugas (batched, alasan sama)
        const tasks = await batchedIn<any>(
            'teaching_assignment_id', allTaIds,
            (chunk) => supabase.from('assignments').select('id, teaching_assignment_id').in('teaching_assignment_id', chunk)
        )
        const taskIds = tasks.map(t => t.id)
        let taskSubsWithGrades: any[] = []
        if (taskIds.length > 0) {
            // Batched to avoid URL overflow — a teacher with many classes yields many
            // assignment_ids / submission_ids that exceed Supabase's URL limit and make
            // the grades query silently fail (=> tugas not counted).
            const allSubs = await batchedFetchAll<{ id: string; student_id: string; assignment_id: string }>(
                'assignment_id', taskIds,
                (chunk) => supabase.from('student_submissions').select('id, student_id, assignment_id').in('assignment_id', chunk)
            )
            const submissions = allSubs.filter(s => studentSet.has(s.student_id))

            if (submissions.length > 0) {
                const subIds = submissions.map(s => s.id)
                const gradesData = await batchedIn<{ submission_id: string; score: number }>(
                    'submission_id', subIds,
                    (chunk) => supabase.from('grades').select('submission_id, score').in('submission_id', chunk)
                )

                // Merge grades with submissions
                taskSubsWithGrades = submissions.map(sub => {
                    const grade = gradesData.find(g => g.submission_id === sub.id)
                    return { ...sub, score: grade ? grade.score : null }
                }).filter(sub => sub.score !== null)
            }
        }

        // 6. Aggregate Data
        // A helper to lookup a student's grades for a SPECIFIC teaching assignment (Mapel in a class)
        const getScoresForTAAndStudent = (taId: string, studentId: string) => {
            const scores: number[] = []

            // Quizzes (sudah di-merge remedial di atas: satu entri per kuis asli, skor terbaik)
            const relatedQuizzes = quizzes.filter(q => q.teaching_assignment_id === taId).map(q => q.id)
            for (const qs of quizSubs.filter(s => s.student_id === studentId && relatedQuizzes.includes(s.quiz_id))) {
                if (qs.max_score > 0) scores.push((qs.total_score / qs.max_score) * 100)
            }
            // Exams — normalize to percentage (total_score is raw points; max_score varies per exam)
            const relatedExams = exams.filter(e => e.teaching_assignment_id === taId).map(e => e.id)
            for (const es of examSubs.filter(s => s.student_id === studentId && relatedExams.includes(s.exam_id))) {
                const raw = es.total_score || 0
                // max_score 0/null → poin mentah TIDAK boleh dicampur dengan skala
                // persen (15 poin ≠ 15%) — skip entry daripada merusak rata-rata.
                if (es.max_score > 0) scores.push((raw / es.max_score) * 100)
            }
            // Tasks
            const relatedTasks = tasks.filter(t => t.teaching_assignment_id === taId).map(t => t.id)
            for (const ts of taskSubsWithGrades.filter(s => s.student_id === studentId && relatedTasks.includes(s.assignment_id))) {
                scores.push(ts.score || 0)
            }

            return scores
        }

        // Batch fetch all subject KKM for the school to avoid N+1
        const { data: allSubjectKkms } = await supabase
            .from('subject_kkm')
            .select('subject_id, school_level, grade_level, kkm')
            .eq('school_id', schoolId)
            
        const getKkm = (subjectId: string, schoolLevel: string, gradeLevel: number, fallbackKkm: number) => {
            if (!schoolLevel || !gradeLevel) return fallbackKkm || DEFAULT_KKM
            const granular = allSubjectKkms?.find(k => k.subject_id === subjectId && k.school_level === schoolLevel && k.grade_level === gradeLevel)
            return granular ? granular.kkm : (fallbackKkm || DEFAULT_KKM)
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
                    const subject = unwrap(ta.subject)
                    const cls = unwrap(ta.class)
                    const subjectKkm = getKkm(subject?.id, cls?.school_level, cls?.grade_level, subject?.kkm)
                    if (avg < subjectKkm) {
                        teachingWarnings.push({
                            student_id: student.id,
                            student_name: unwrap(student.user)?.full_name || 'Tanpa Nama',
                            class_id: ta.class_id,
                            class_name: cls?.name || 'Tanpa Kelas',
                            subject_name: subject?.name || 'Tanpa Mapel',
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
                        const subject = unwrap(ta.subject)
                        const cls = unwrap(ta.class) || hrClass // fallback to hrClass if class relation is missing in TA
                        const subjectKkm = getKkm(subject?.id, cls?.school_level, cls?.grade_level, subject?.kkm)
                        if (avg < subjectKkm) {
                            homeroomWarnings.push({
                                student_id: student.id,
                                student_name: unwrap(student.user)?.full_name || 'Tanpa Nama',
                                class_id: hrClass.id,
                                class_name: hrClass.name,
                                subject_name: subject?.name || 'Tanpa Mapel',
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
            teachingWarnings,
            homeroomWarnings,
            myClasses
        })
    } catch (error: any) {
        console.error('Error fetching dashboard warnings:', error)
        return NextResponse.json({ error: 'Server error', details: error.message }, { status: 500 })
    }
}
