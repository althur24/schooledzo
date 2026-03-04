import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * PUT /api/students/:id/graduate
 * Graduate a student (mark as completed education)
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        // Verify authentication
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // Only admins can graduate students
        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
        }

        const { notes, academic_year_id } = await request.json()

        // Get current student data with active enrollment (scoped by school)
        let studentQuery = supabase
            .from('students')
            .select(`
                *,
                class:classes(name, grade_level, school_level),
                enrollments:student_enrollments!student_enrollments_student_id_fkey(
                    id,
                    class_id,
                    academic_year_id,
                    status
                )
            `)
            .eq('id', id)
        if (schoolId) studentQuery = studentQuery.eq('school_id', schoolId)
        const { data: student, error: studentError } = await studentQuery.single()

        if (studentError || !student) {
            return NextResponse.json({ error: 'Student not found' }, { status: 404 })
        }

        // Find active enrollment
        const activeEnrollment = academic_year_id
            ? (student.enrollments as any[])?.find((e: any) => e.status === 'ACTIVE' && e.academic_year_id === academic_year_id)
            : (student.enrollments as any[])?.find((e: any) => e.status === 'ACTIVE')

        if (!activeEnrollment) {
            return NextResponse.json({
                error: 'No active enrollment found for this student'
            }, { status: 400 })
        }

        const now = new Date().toISOString()

        // 1. End current enrollment as GRADUATED
        const { error: endEnrollmentError } = await supabase
            .from('student_enrollments')
            .update({
                status: 'GRADUATED',
                ended_at: now,
                updated_at: now,
                notes: notes || 'Successfully graduated'
            })
            .eq('id', activeEnrollment.id)

        if (endEnrollmentError) {
            return NextResponse.json({
                error: 'Failed to update enrollment',
                details: endEnrollmentError.message
            }, { status: 500 })
        }

        // 2. Update student status and remove class assignment
        const { error: updateStudentError } = await supabase
            .from('students')
            .update({
                class_id: null,
                status: 'GRADUATED'
            })
            .eq('id', id)

        if (updateStudentError) {
            return NextResponse.json({
                error: 'Failed to update student status',
                details: updateStudentError.message
            }, { status: 500 })
        }

        const studentClass = student.class as { name?: string; school_level?: string } | null
        return NextResponse.json({
            success: true,
            message: `Student graduated successfully from ${studentClass?.name || 'class'}`,
            graduation_level: studentClass?.school_level
        })

    } catch (error: any) {
        console.error('Error graduating student:', error)
        return NextResponse.json({
            error: 'Internal server error',
            details: error.message
        }, { status: 500 })
    }
}
