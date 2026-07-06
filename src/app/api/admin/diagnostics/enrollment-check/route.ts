import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * GET /api/admin/diagnostics/enrollment-check
 * Debug: check enrollment data for a given academic year
 */
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const yearId = searchParams.get('year_id')

        if (!yearId) {
            return NextResponse.json({ error: 'year_id required' }, { status: 400 })
        }

        // Get all enrollments in this year
        const { data: enrollments, error } = await supabase
            .from('student_enrollments')
            .select(`
                id,
                status,
                class_id,
                academic_year_id,
                student:students!student_enrollments_student_id_fkey(
                    id,
                    user:users!students_user_id_fkey(full_name)
                ),
                enrollment_class:classes!student_enrollments_class_id_fkey(id, name, grade_level, school_level, academic_year_id)
            `)
            .eq('academic_year_id', yearId)
            .limit(100)

        if (error) throw error

        // Get classes in this year
        const { data: classes } = await supabase
            .from('classes')
            .select('id, name, grade_level, school_level, academic_year_id')
            .eq('academic_year_id', yearId)

        return NextResponse.json({
            year_id: yearId,
            enrollment_count: enrollments?.length || 0,
            class_count: classes?.length || 0,
            enrollments: (enrollments || []).map(e => ({
                id: e.id,
                status: e.status,
                class_id: e.class_id,
                student_name: (e.student as any)?.user?.full_name || 'unknown',
                enrollment_class: e.enrollment_class ? {
                    id: (e.enrollment_class as any).id,
                    name: (e.enrollment_class as any).name,
                    grade_level: (e.enrollment_class as any).grade_level,
                    school_level: (e.enrollment_class as any).school_level,
                    academic_year_id: (e.enrollment_class as any).academic_year_id
                } : null
            })),
            classes_in_year: classes || []
        })
    } catch (error: any) {
        console.error('Diagnostic error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
