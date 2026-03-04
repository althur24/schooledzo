import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { BatchPromotionRequest, BatchPromotionResult } from '@/lib/types'

/**
 * POST /api/batch/promote
 * Batch promote students to next grade
 */
export async function POST(request: NextRequest) {
    try {
        // Verify authentication
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // Only admins can perform batch operations
        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
        }

        const body: BatchPromotionRequest = await request.json()
        const { academic_year_from, academic_year_to, class_mappings, student_ids } = body

        // Validation
        if (!academic_year_from || !academic_year_to || !class_mappings || class_mappings.length === 0) {
            return NextResponse.json({
                error: 'Required fields: academic_year_from, academic_year_to, class_mappings'
            }, { status: 400 })
        }

        // Verify academic years exist
        const { data: yearFrom, error: yearFromError } = await supabase
            .from('academic_years')
            .select('id, name')
            .eq('id', academic_year_from)
            .single()

        if (yearFromError || !yearFrom) {
            return NextResponse.json({ error: 'Source academic year not found' }, { status: 404 })
        }

        const { data: yearTo, error: yearToError } = await supabase
            .from('academic_years')
            .select('id, name')
            .eq('id', academic_year_to)
            .single()

        if (yearToError || !yearTo) {
            return NextResponse.json({ error: 'Target academic year not found' }, { status: 404 })
        }

        // Verify all class mappings are valid
        const fromClassIds = class_mappings.map(m => m.from_class_id)
        const toClassIds = class_mappings.map(m => m.to_class_id)

        const { data: fromClasses, error: fromClassError } = await supabase
            .from('classes')
            .select('id, name')
            .in('id', fromClassIds)

        if (fromClassError || fromClasses.length !== fromClassIds.length) {
            return NextResponse.json({ error: 'Some source classes not found' }, { status: 404 })
        }

        const { data: toClasses, error: toClassError } = await supabase
            .from('classes')
            .select('id, name')
            .in('id', toClassIds)

        if (toClassError || toClasses.length !== toClassIds.length) {
            return NextResponse.json({ error: 'Some target classes not found' }, { status: 404 })
        }

        // Get students to promote
        let query = supabase
            .from('students')
            .select(`
                id,
                user:users!students_user_id_fkey(full_name),
                class_id,
                enrollments:student_enrollments!student_enrollments_student_id_fkey(
                    id,
                    class_id,
                    academic_year_id,
                    status
                )
            `)
            .in('class_id', fromClassIds)

        // Filter by specific students if provided
        if (student_ids && student_ids.length > 0) {
            query = query.in('id', student_ids)
        }

        const { data: students, error: studentsError } = await query

        if (studentsError) {
            return NextResponse.json({
                error: 'Failed to fetch students',
                details: studentsError.message
            }, { status: 500 })
        }

        if (!students || students.length === 0) {
            return NextResponse.json({
                error: 'No students found matching criteria'
            }, { status: 404 })
        }

        // Process each student promotion
        const result: BatchPromotionResult = {
            success: true,
            promoted_count: 0,
            failed_count: 0,
            errors: []
        }

        const now = new Date().toISOString()

        for (const student of students) {
            try {
                // Find active enrollment
                const activeEnrollment = student.enrollments?.find((e: any) =>
                    e.status === 'ACTIVE' && e.academic_year_id === academic_year_from
                )

                if (!activeEnrollment) {
                    result.failed_count++
                    const userName = (student.user as { full_name?: string } | null)?.full_name || 'Unknown'
                    result.errors.push({
                        student_id: student.id,
                        student_name: userName,
                        error: 'No active enrollment in source academic year'
                    })
                    continue
                }

                // Find target class from mapping
                const mapping = class_mappings.find(m => m.from_class_id === student.class_id)
                if (!mapping) {
                    result.failed_count++
                    const userName = (student.user as { full_name?: string } | null)?.full_name || 'Unknown'
                    result.errors.push({
                        student_id: student.id,
                        student_name: userName,
                        error: 'No class mapping found'
                    })
                    continue
                }

                // 1. End current enrollment
                const { error: endError } = await supabase
                    .from('student_enrollments')
                    .update({
                        status: 'PROMOTED',
                        ended_at: now,
                        updated_at: now,
                        notes: `Batch promoted to ${yearTo.name}`
                    })
                    .eq('id', activeEnrollment.id)

                if (endError) throw endError

                // 2. Create new enrollment
                const { error: createError } = await supabase
                    .from('student_enrollments')
                    .insert({
                        student_id: student.id,
                        class_id: mapping.to_class_id,
                        academic_year_id: academic_year_to,
                        status: 'ACTIVE',
                        notes: `Batch promoted from ${yearFrom.name}`
                    })

                if (createError) throw createError

                // 3. Update student's current class
                const { error: updateError } = await supabase
                    .from('students')
                    .update({ class_id: mapping.to_class_id })
                    .eq('id', student.id)

                if (updateError) throw updateError

                result.promoted_count++

            } catch (error: any) {
                result.failed_count++
                const userName = (student.user as { full_name?: string } | null)?.full_name || 'Unknown'
                result.errors.push({
                    student_id: student.id,
                    student_name: userName,
                    error: error.message || 'Unknown error'
                })
            }
        }

        // Determine overall success
        result.success = result.failed_count === 0

        return NextResponse.json(result)

    } catch (error: any) {
        console.error('Error in batch promotion:', error)
        return NextResponse.json({
            error: 'Internal server error',
            details: error.message
        }, { status: 500 })
    }
}
