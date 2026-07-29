import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'

export async function GET(request: NextRequest) {
    try {
        // Security Check
        const apiKey = request.headers.get('x-api-key')
        if (apiKey !== process.env.EXTERNAL_API_SECRET) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const teacherId = request.nextUrl.searchParams.get('teacher_id')
        const classId = request.nextUrl.searchParams.get('class_id')
        const academicYearId = request.nextUrl.searchParams.get('academic_year_id')
        const schoolId = request.nextUrl.searchParams.get('school_id')
        if (!schoolId) {
            return NextResponse.json({ error: 'school_id parameter is required' }, { status: 400 })
        }

        // 1. Scope sekolah via inner join berjenjang (pola sama seperti KPI content) —
        // tanpa mematerialisasi daftar TA (ratusan–1000+ id → URL overflow 16KB).
        // Head-count untuk mempertahankan kontrak lama: tidak ada TA yang cocok -> [].
        let taCountQuery = supabase
            .from('teaching_assignments')
            .select('id, academic_year:academic_years!inner(school_id)', { count: 'exact', head: true })
            .eq('academic_year.school_id', schoolId)
        if (teacherId) taCountQuery = taCountQuery.eq('teacher_id', teacherId)
        if (classId) taCountQuery = taCountQuery.eq('class_id', classId)
        if (academicYearId) taCountQuery = taCountQuery.eq('academic_year_id', academicYearId)
        const { count: taCount } = await taCountQuery
        if (!taCount) return NextResponse.json([])

        // 2. Query `assignmentGrades` yang lama dihapus: hasilnya tidak pernah dipakai
        // (dead code — agregasi memakai gradesRes di bawah), dan nested .in() tanpa
        // !inner memang tidak berfungsi seperti yang diragukan komentar lamanya.

        // A. Fetch the assessment *containers* (scoped by school + optional filters)
        const TA_JOIN = 'teaching_assignment:teaching_assignments!inner(academic_year:academic_years!inner(school_id))'
        const scopeQuery = (query: any) => {
            query = query.eq('teaching_assignment.academic_year.school_id', schoolId)
            if (teacherId) query = query.eq('teaching_assignment.teacher_id', teacherId)
            if (classId) query = query.eq('teaching_assignment.class_id', classId)
            if (academicYearId) query = query.eq('teaching_assignment.academic_year_id', academicYearId)
            return query
        }

        const assignments = await fetchAllRows(scopeQuery(
            supabase.from('assignments').select(`id, teaching_assignment_id, title, type, ${TA_JOIN}`)
        ))
        const quizzes = await fetchAllRows(scopeQuery(
            supabase.from('quizzes').select(`id, teaching_assignment_id, title, ${TA_JOIN}`)
        ))
        const exams = await fetchAllRows(scopeQuery(
            supabase.from('exams').select(`id, teaching_assignment_id, title, ${TA_JOIN}`)
        ))

        const assignmentIds = assignments.map(a => a.id)
        const quizIds = quizzes.map(q => q.id)
        const examIds = exams.map(e => e.id)

        // B. Fetch Scores — batchedIn per 100 id (batas URL) + fetchAllRows per chunk
        // (100 kontainer × puluhan siswa bisa >1000 baris per chunk). Dibungkus { data }
        // agar kode agregasi di bawah tidak berubah. Embed grades memakai !inner supaya
        // filter submission.assignment_id benar-benar diterapkan PostgREST ke parent rows.
        const batchedFetchAll = <T,>(column: string, ids: string[], buildQuery: (chunk: string[]) => any) =>
            batchedIn<T>(column, ids, async (chunk) => ({ data: await fetchAllRows<T>(buildQuery(chunk)), error: null }))

        const [gradesRes, quizSubRes, examSubRes] = await Promise.all([
            (async () => ({ data: await batchedFetchAll('assignment_id', assignmentIds, (chunk) =>
                supabase.from('grades').select('score, submission:student_submissions!inner(student_id, assignment_id)').in('submission.assignment_id', chunk)) }))(),
            (async () => ({ data: await batchedFetchAll('quiz_id', quizIds, (chunk) =>
                supabase.from('quiz_submissions').select('total_score, student_id, quiz_id').in('quiz_id', chunk)) }))(),
            (async () => ({ data: await batchedFetchAll('exam_id', examIds, (chunk) =>
                supabase.from('exam_submissions').select('total_score, student_id, exam_id').in('exam_id', chunk)) }))()
        ])

        // C. Aggregate
        const studentPerformance: Record<string, any> = {}

        // Process Assignments (C1)
        gradesRes.data?.forEach((g: any) => {
            const studentId = g.submission?.student_id
            const assignment = assignments?.find(a => a.id === g.submission?.assignment_id)
            if (!studentId || !assignment) return

            if (!studentPerformance[studentId]) studentPerformance[studentId] = { student_id: studentId, c1_assignments: [], c2_quizzes: [], c3_exams: [] }

            studentPerformance[studentId].c1_assignments.push({
                title: assignment.title,
                type: assignment.type,
                score: g.score,
                ta_id: assignment.teaching_assignment_id
            })
        })

        // Process Quizzes (C2)
        quizSubRes.data?.forEach((q: any) => {
            const studentId = q.student_id
            const quiz = quizzes?.find(z => z.id === q.quiz_id)
            if (!studentId || !quiz) return

            if (!studentPerformance[studentId]) studentPerformance[studentId] = { student_id: studentId, c1_assignments: [], c2_quizzes: [], c3_exams: [] }

            studentPerformance[studentId].c2_quizzes.push({
                title: quiz.title,
                score: q.total_score,
                ta_id: quiz.teaching_assignment_id
            })
        })

        // Process Exams (C3)
        examSubRes.data?.forEach((e: any) => {
            const studentId = e.student_id
            const exam = exams?.find(x => x.id === e.exam_id)
            if (!studentId || !exam) return

            if (!studentPerformance[studentId]) studentPerformance[studentId] = { student_id: studentId, c1_assignments: [], c2_quizzes: [], c3_exams: [] }

            studentPerformance[studentId].c3_exams.push({
                title: exam.title,
                score: e.total_score,
                ta_id: exam.teaching_assignment_id
            })
        })

        // Calculate Averages
        const aggregated = Object.values(studentPerformance).map(student => {
            const avg = (arr: any[]) => arr.length > 0 ? arr.reduce((a, b) => a + b.score, 0) / arr.length : 0

            return {
                student_id: student.student_id,
                averages: {
                    assignments: parseFloat(avg(student.c1_assignments).toFixed(2)),
                    quizzes: parseFloat(avg(student.c2_quizzes).toFixed(2)),
                    exams: parseFloat(avg(student.c3_exams).toFixed(2))
                },
                details: {
                    assignments: student.c1_assignments.length,
                    quizzes: student.c2_quizzes.length,
                    exams: student.c3_exams.length
                }
            }
        })

        return NextResponse.json({
            meta: {
                total_students: aggregated.length,
                filters: { teacherId, classId, academicYearId }
            },
            data: aggregated
        })

    } catch (error) {
        console.error('Error fetching student performance KPI:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
