import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * PUT /api/students/:id/promote
 * Promote a student to the next class/grade
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

        // Only admins can promote students
        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
        }

        const { to_class_id, to_academic_year_id, from_academic_year_id, notes, enrollment_status = 'PROMOTED' } = await request.json()

        // Validation
        if (!to_class_id || !to_academic_year_id) {
            return NextResponse.json({
                error: 'to_class_id and to_academic_year_id are required'
            }, { status: 400 })
        }

        // Get current student data with enrollments (scoped by school)
        let studentQuery = supabase
            .from('students')
            .select(`
                *,
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

        // Find enrollment: prefer specific year, fallback to any ACTIVE
        let activeEnrollment: any = null
        if (from_academic_year_id) {
            activeEnrollment = (student.enrollments as any[])?.find((e: any) =>
                e.academic_year_id === from_academic_year_id && e.status === 'ACTIVE'
            )
        }
        if (!activeEnrollment) {
            activeEnrollment = (student.enrollments as any[])?.find((e: any) => e.status === 'ACTIVE')
        }

        if (!activeEnrollment) {
            return NextResponse.json({
                error: 'No active enrollment found for this student'
            }, { status: 400 })
        }

        // Verify target class exists (scoped by school)
        let classQuery = supabase
            .from('classes')
            .select('id, name, academic_year_id, school_level')
            .eq('id', to_class_id)
        if (schoolId) classQuery = classQuery.eq('school_id', schoolId)
        const { data: targetClass, error: classError } = await classQuery.single()

        if (classError || !targetClass) {
            return NextResponse.json({ error: 'Target class not found' }, { status: 404 })
        }

        // Verify academic year exists (scoped by school)
        let yearQuery = supabase
            .from('academic_years')
            .select('id, name')
            .eq('id', to_academic_year_id)
        if (schoolId) yearQuery = yearQuery.eq('school_id', schoolId)
        const { data: targetYear, error: yearError } = await yearQuery.single()

        if (yearError || !targetYear) {
            return NextResponse.json({ error: 'Target academic year not found' }, { status: 404 })
        }

        // Transaction: End current enrollment and create new one
        const now = new Date().toISOString()

        const { error: endEnrollmentError } = await supabase
            .from('student_enrollments')
            .update({
                status: enrollment_status,
                ended_at: now,
                updated_at: now,
                notes: notes || (enrollment_status === 'RETAINED' ? 'Tinggal di kelas yang sama' : 'Promoted to next grade')
            })
            .eq('id', activeEnrollment.id)

        if (endEnrollmentError) {
            return NextResponse.json({
                error: 'Failed to end current enrollment',
                details: endEnrollmentError.message
            }, { status: 500 })
        }

        // 2. Create new enrollment
        const { data: newEnrollment, error: createEnrollmentError } = await supabase
            .from('student_enrollments')
            .insert({
                student_id: id,
                class_id: to_class_id,
                academic_year_id: to_academic_year_id,
                status: 'ACTIVE',
                notes: notes || 'Promoted from previous grade'
            })
            .select()
            .single()

        if (createEnrollmentError) {
            // Rollback: Reactivate old enrollment
            await supabase
                .from('student_enrollments')
                .update({ status: 'ACTIVE', ended_at: null })
                .eq('id', activeEnrollment.id)

            return NextResponse.json({
                error: 'Failed to create new enrollment',
                details: createEnrollmentError.message
            }, { status: 500 })
        }

        // 3. Update student's current class and school level
        const { error: updateStudentError } = await supabase
            .from('students')
            .update({
                class_id: to_class_id,
                school_level: targetClass.school_level
            })
            .eq('id', id)

        if (updateStudentError) {
            return NextResponse.json({
                error: 'Failed to update student class',
                details: updateStudentError.message
            }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            message: `Student promoted to ${targetClass.name} (${targetYear.name})`,
            enrollment: newEnrollment
        })

    } catch (error: any) {
        console.error('Error promoting student:', error)
        return NextResponse.json({
            error: 'Internal server error',
            details: error.message
        }, { status: 500 })
    }
}
