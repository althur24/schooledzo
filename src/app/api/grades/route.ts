import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch } from '@/lib/tenantGuard'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { logGradeChange } from '@/lib/gradeHistory'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'
import { mergeRemedialScores } from '@/lib/remedialScore'

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
                } else if (schoolId) {
                    // Tenant guard: tahun ajaran dari client harus milik sekolah caller
                    const { data: reqYear } = await supabase
                        .from('academic_years')
                        .select('school_id')
                        .eq('id', filterYearId)
                        .single()
                    if (tenantMismatch((reqYear as any)?.school_id, schoolId)) {
                        return NextResponse.json([])
                    }
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
                // Tiebreaker unik — paginasi fetchAllRows tanpa order stabil bisa
                // melewatkan/duplikasi baris diam-diam (graded_at tidak unik)
                .order('id', { ascending: false })
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
                        is_remedial,
                        remedial_for_id,
                        remedial_score_policy,
                        remedial_max_score,
                        teaching_assignment_id,
                        teaching_assignment:teaching_assignments!inner(
                            subject:subjects(id, name)
                        )
                    )
                `)
                .not('submitted_at', 'is', null)
                // Order + tiebreaker unik WAJIB sebelum fetchAllRows — paginasi
                // tanpa order stabil bisa melewatkan/duplikasi baris diam-diam.
                .order('id')
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
                        is_remedial,
                        remedial_for_id,
                        remedial_score_policy,
                        remedial_max_score,
                        teaching_assignment_id,
                        teaching_assignment:teaching_assignments!inner(
                            subject:subjects(id, name)
                        )
                    )
                `)
                .not('submitted_at', 'is', null)
                // Order + tiebreaker unik WAJIB sebelum fetchAllRows — paginasi
                // tanpa order stabil bisa melewatkan/duplikasi baris diam-diam.
                .order('id')
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
                        quiz_id: quiz?.id,
                        remedial_for_id: quiz?.remedial_for_id || null,
                        is_remedial: quiz?.is_remedial || false,
                        policy: quiz?.remedial_score_policy,
                        cap: quiz?.remedial_max_score,
                        grade_type: 'KUIS',
                        score: Math.round(score * 10) / 10,
                        subject: { name: subject?.name || '-' },
                        graded_at: qs.submitted_at
                    }
                })

            // Remedial merge: nilai remedial MENGGANTIKAN (bukan menambah) nilai
            // kuis asli — sesuai kebijakan remedial (HIGHEST/AVERAGE/CAP, lihat
            // src/lib/remedialScore.ts). Tanpa ini siswa yang lulus remedial
            // tercatat 2 nilai KUIS di rekap/rapor.
            const quizGroups = new Map<string, any[]>()
            for (const m of mappedQuizzes) {
                const base = m.remedial_for_id || m.quiz_id
                const key = `${m.student_id}:${base}`
                if (!quizGroups.has(key)) quizGroups.set(key, [])
                quizGroups.get(key)!.push(m)
            }
            const mergedQuizzes = Array.from(quizGroups.values()).map(group => {
                const original = group.find(m => !m.is_remedial) || group[0]
                const final = mergeRemedialScores(group.map(m => ({ score: m.score, isRemedial: m.is_remedial, policy: m.policy, cap: m.cap })))
                return { ...original, score: final !== null ? Math.round(final * 10) / 10 : original.score }
            })
            allGrades.push(...mergedQuizzes)

            const mappedExams = examSubmissions
                .map((es: any) => {
                    const exam = es.exam
                    const subject = exam?.teaching_assignment?.subject
                    const score = es.max_score > 0 ? (es.total_score / es.max_score) * 100 : 0
                    return {
                        id: es.id,
                        student_id: es.student_id,
                        subject_id: subject?.id,
                        exam_id: exam?.id,
                        remedial_for_id: exam?.remedial_for_id || null,
                        is_remedial: exam?.is_remedial || false,
                        policy: exam?.remedial_score_policy,
                        cap: exam?.remedial_max_score,
                        grade_type: 'ULANGAN',
                        score: Math.round(score * 10) / 10,
                        subject: { name: subject?.name || '-' },
                        graded_at: es.submitted_at
                    }
                })

            // Remedial merge (ULANGAN) — GAP FIX: section ini sebelumnya tidak
            // pernah merge, siswa remedial tercatat 2 nilai di rekap/rapor.
            // Kebijakan mengikuti ujian remedial (HIGHEST/AVERAGE/CAP).
            const examGroups = new Map<string, any[]>()
            for (const m of mappedExams) {
                const base = m.remedial_for_id || m.exam_id
                const key = `${m.student_id}:${base}`
                if (!examGroups.has(key)) examGroups.set(key, [])
                examGroups.get(key)!.push(m)
            }
            const mergedExams = Array.from(examGroups.values()).map(group => {
                const original = group.find(m => !m.is_remedial) || group[0]
                const final = mergeRemedialScores(group.map(m => ({ score: m.score, isRemedial: m.is_remedial, policy: m.policy, cap: m.cap })))
                return { ...original, score: final !== null ? Math.round(final * 10) / 10 : original.score }
            })
            allGrades.push(...mergedExams)

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
                        is_remedial,
                        remedial_for_id,
                        remedial_score_policy,
                        remedial_max_score,
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
                        exam_id: exam?.id,
                        remedial_for_id: exam?.remedial_for_id || null,
                        is_remedial: exam?.is_remedial || false,
                        policy: exam?.remedial_score_policy,
                        cap: exam?.remedial_max_score,
                        grade_type: exam?.exam_type || 'UTS', // 'UTS' or 'UAS'
                        score: Math.round(score * 10) / 10,
                        subject: { name: subject?.name || '-' },
                        graded_at: os.submitted_at
                    }
                })

            // Remedial merge (UTS/UAS): nilai remedial MENGGANTIKAN nilai asli
            // per (siswa, ujian dasar) sesuai kebijakan (HIGHEST/AVERAGE/CAP).
            const officialGroups = new Map<string, any[]>()
            for (const m of mappedOfficial) {
                const base = m.remedial_for_id || m.exam_id
                const key = `${m.student_id}:${base}`
                if (!officialGroups.has(key)) officialGroups.set(key, [])
                officialGroups.get(key)!.push(m)
            }
            const mergedOfficial = Array.from(officialGroups.values()).map(group => {
                const original = group.find(m => !m.is_remedial) || group[0]
                const final = mergeRemedialScores(group.map(m => ({ score: m.score, isRemedial: m.is_remedial, policy: m.policy, cap: m.cap })))
                return { ...original, score: final !== null ? Math.round(final * 10) / 10 : original.score }
            })
            allGrades.push(...mergedOfficial)

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
// Menerima submission_id (penilaian submission online) ATAU
// assignment_id + student_id (penilaian offline: submission placeholder
// dibuat otomatis bila siswa belum punya submission).
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const labels = await getMenuLabelsForSchool(schoolId)

        const { submission_id, assignment_id, student_id, score, feedback } = await request.json()

        if ((!submission_id && !(assignment_id && student_id)) || score === undefined) {
            return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 })
        }

        const numScore = parseInt(score)
        if (isNaN(numScore) || numScore < 0 || numScore > 100) {
            return NextResponse.json({ error: 'Nilai harus antara 0 dan 100' }, { status: 400 })
        }

        // H2 Security Fix: Verify this teacher owns the teaching assignment
        const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        let resolvedSubmissionId = submission_id

        // Konteks untuk audit trail (grade_history)
        let auditRefId: string | null = null
        let auditRefTitle: string | null = null
        let auditStudentId: string | null = null

        // Fail-closed: GURU tanpa row teachers tidak boleh memberi nilai
        if (!teacher) {
            return NextResponse.json({ error: 'Data guru tidak ditemukan' }, { status: 403 })
        }

        if (submission_id) {
            const { data: submission } = await supabase
                .from('student_submissions')
                .select('student_id, assignment:assignments(id, title, teaching_assignment:teaching_assignments(teacher_id))')
                .eq('id', submission_id)
                .single()

            const assignmentTeacherId = (submission?.assignment as any)?.teaching_assignment?.teacher_id
            if (assignmentTeacherId && assignmentTeacherId !== teacher.id) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses untuk menilai submission ini' }, { status: 403 })
            }

            auditRefId = (submission?.assignment as any)?.id || null
            auditRefTitle = (submission?.assignment as any)?.title || null
            auditStudentId = (submission as any)?.student_id || null
        } else {
            // Jalur offline: verifikasi kepemilikan assignment
            const { data: assignment } = await supabase
                .from('assignments')
                .select('title, submission_mode, teaching_assignment:teaching_assignments(teacher_id)')
                .eq('id', assignment_id)
                .single()

            if (!assignment) {
                return NextResponse.json({ error: `${labels.tugas} tidak ditemukan` }, { status: 404 })
            }

            // Penilaian tanpa submission hanya untuk tugas bertipe offline —
            // tugas online tetap dinilai murni dari submission siswa.
            if ((assignment as any).submission_mode !== 'OFFLINE') {
                return NextResponse.json({ error: 'Penilaian langsung hanya tersedia untuk tugas offline' }, { status: 400 })
            }

            const assignmentTeacherId = (assignment as any)?.teaching_assignment?.teacher_id
            if (teacher && assignmentTeacherId && assignmentTeacherId !== teacher.id) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses untuk menilai tugas ini' }, { status: 403 })
            }

            auditRefId = assignment_id
            auditRefTitle = (assignment as any).title || null
            auditStudentId = student_id

            // Find-or-create submission placeholder (is_offline) untuk siswa ini
            const { data: existingSub } = await supabase
                .from('student_submissions')
                .select('id')
                .eq('assignment_id', assignment_id)
                .eq('student_id', student_id)
                .single()

            if (existingSub) {
                resolvedSubmissionId = existingSub.id
            } else {
                const { data: newSub, error: subError } = await supabase
                    .from('student_submissions')
                    .insert({
                        assignment_id,
                        student_id,
                        answers: null,
                        is_offline: true
                    })
                    .select('id')
                    .single()

                if (subError) throw subError
                resolvedSubmissionId = newSub.id
            }
        }

        // Check if grade exists - Use regular client here since it's user action
        const { data: existing } = await supabase // Use admin to ensure teacher can grade
            .from('grades')
            .select('id, score')
            .eq('submission_id', resolvedSubmissionId)
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
                .insert({ submission_id: resolvedSubmissionId, score: numScore, feedback })
                .select()
                .single()

            if (error) throw error
            gradeData = data
        }

        // Audit trail: catat perubahan nilai (nilai sama tidak dicatat — diff di helper)
        if (auditRefId && auditStudentId) {
            await logGradeChange({
                schoolId,
                source: 'ASSIGNMENT',
                refId: auditRefId,
                refTitle: auditRefTitle,
                studentId: auditStudentId,
                oldScore: existing?.score ?? null,
                newScore: numScore,
                maxScore: 100,
                changedBy: user.id
            })
        }

        // Send notification to student
        try {
            const { data: submission } = await supabase
                .from('student_submissions')
                .select(`
                    student:students(user_id),
                    assignment:assignments(title, teaching_assignment:teaching_assignments(subject:subjects(name)))
                `)
                .eq('id', resolvedSubmissionId)
                .single()

            const studentData = submission?.student as any
            if (studentData?.user_id) {
                const assignmentTitle = (submission?.assignment as any)?.title || labels.tugas
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
