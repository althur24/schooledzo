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

        const classIds = classesRes.data?.map(c => c.id) || []
        const taIds = teachingAssignmentsRes.data?.map(ta => ta.id) || []

        // Get nested counts based on classes and teaching assignments
        let materialsCount = 0
        let assignmentsCount = 0
        let quizzesCount = 0
        let examsCount = 0
        let submissionsCount = 0
        let quizSubmissionsCount = 0
        let examSubmissionsCount = 0

        if (taIds.length > 0) {
            const [materialsRes, assignmentsRes, quizzesRes, examsRes] = await Promise.all([
                supabase.from('materials').select('id', { count: 'exact' }).in('teaching_assignment_id', taIds),
                supabase.from('assignments').select('id', { count: 'exact' }).in('teaching_assignment_id', taIds),
                supabase.from('quizzes').select('id', { count: 'exact' }).in('teaching_assignment_id', taIds),
                supabase.from('exams').select('id', { count: 'exact' }).in('teaching_assignment_id', taIds)
            ])

            materialsCount = materialsRes.count || 0
            assignmentsCount = assignmentsRes.count || 0
            quizzesCount = quizzesRes.count || 0
            examsCount = examsRes.count || 0

            // Get assignment IDs for submissions
            const assignmentIds = assignmentsRes.data?.map(a => a.id) || []
            const quizIds = quizzesRes.data?.map(q => q.id) || []
            const examIds = examsRes.data?.map(e => e.id) || []

            if (assignmentIds.length > 0) {
                const subRes = await supabase.from('student_submissions').select('id', { count: 'exact' }).in('assignment_id', assignmentIds)
                submissionsCount = subRes.count || 0
            }

            if (quizIds.length > 0) {
                const qSubRes = await supabase.from('quiz_submissions').select('id', { count: 'exact' }).in('quiz_id', quizIds)
                quizSubmissionsCount = qSubRes.count || 0
            }

            if (examIds.length > 0) {
                const eSubRes = await supabase.from('exam_submissions').select('id', { count: 'exact' }).in('exam_id', examIds)
                examSubmissionsCount = eSubRes.count || 0
            }
        }

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
