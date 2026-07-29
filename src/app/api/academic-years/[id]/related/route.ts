import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET related data for an academic year (for deletion preview)
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Verify year belongs to this school
        if (schoolId) {
            const { data: yearCheck } = await supabase
                .from('academic_years')
                .select('id')
                .eq('id', id)
                .eq('school_id', schoolId)
                .single()
            if (!yearCheck) {
                return NextResponse.json({ error: 'Tahun ajaran tidak ditemukan' }, { status: 404 })
            }
        }

        // Get all related data counts
        const [
            classesRes,
            teachingAssignmentsRes,
            enrollmentsRes
        ] = await Promise.all([
            // Classes in this academic year
            supabase
                .from('classes')
                .select('id, name', { count: 'exact' })
                .eq('academic_year_id', id),

            // Teaching assignments in this academic year
            supabase
                .from('teaching_assignments')
                .select('id', { count: 'exact' })
                .eq('academic_year_id', id),

            // Student enrollments in this academic year
            supabase
                .from('student_enrollments')
                .select('id', { count: 'exact' })
                .eq('academic_year_id', id)
        ])

        // Nested counts via inner-join filters — NOT .in(id lists): hundreds of
        // teaching-assignment ids overflow the 16KB header limit at larger schools
        const [materialsRes, assignmentsRes, quizzesRes, examsRes] = await Promise.all([
            supabase.from('materials')
                .select('id, teaching_assignment:teaching_assignments!inner(academic_year_id)', { count: 'exact', head: true })
                .eq('teaching_assignment.academic_year_id', id),
            supabase.from('assignments')
                .select('id, teaching_assignment:teaching_assignments!inner(academic_year_id)', { count: 'exact', head: true })
                .eq('teaching_assignment.academic_year_id', id),
            supabase.from('quizzes')
                .select('id, teaching_assignment:teaching_assignments!inner(academic_year_id)', { count: 'exact', head: true })
                .eq('teaching_assignment.academic_year_id', id),
            supabase.from('exams')
                .select('id, teaching_assignment:teaching_assignments!inner(academic_year_id)', { count: 'exact', head: true })
                .eq('teaching_assignment.academic_year_id', id)
        ])

        const materialsCount = materialsRes.count || 0
        const assignmentsCount = assignmentsRes.count || 0
        const quizzesCount = quizzesRes.count || 0
        const examsCount = examsRes.count || 0

        const [subRes, qSubRes, eSubRes] = await Promise.all([
            supabase.from('student_submissions')
                .select('id, assignment:assignments!inner(teaching_assignment:teaching_assignments!inner(academic_year_id))', { count: 'exact', head: true })
                .eq('assignment.teaching_assignment.academic_year_id', id),
            supabase.from('quiz_submissions')
                .select('id, quiz:quizzes!inner(teaching_assignment:teaching_assignments!inner(academic_year_id))', { count: 'exact', head: true })
                .eq('quiz.teaching_assignment.academic_year_id', id),
            supabase.from('exam_submissions')
                .select('id, exam:exams!inner(teaching_assignment:teaching_assignments!inner(academic_year_id))', { count: 'exact', head: true })
                .eq('exam.teaching_assignment.academic_year_id', id)
        ])

        const submissionsCount = subRes.count || 0
        const quizSubmissionsCount = qSubRes.count || 0
        const examSubmissionsCount = eSubRes.count || 0

        return NextResponse.json({
            classes: {
                count: classesRes.count || 0,
                names: classesRes.data?.map(c => c.name) || []
            },
            teaching_assignments: teachingAssignmentsRes.count || 0,
            student_enrollments: enrollmentsRes.count || 0,
            materials: materialsCount,
            assignments: assignmentsCount,
            quizzes: quizzesCount,
            exams: examsCount,
            submissions: submissionsCount,
            quiz_submissions: quizSubmissionsCount,
            exam_submissions: examSubmissionsCount,
            total: (classesRes.count || 0) +
                (teachingAssignmentsRes.count || 0) +
                (enrollmentsRes.count || 0) +
                materialsCount + assignmentsCount + quizzesCount + examsCount +
                submissionsCount + quizSubmissionsCount + examSubmissionsCount
        })
    } catch (error) {
        console.error('Error fetching related data:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
