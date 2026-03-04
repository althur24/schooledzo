import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET teaching assignments for current logged-in user
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        console.log('[My TA] User ID:', user.id)

        // Get teacher record for current user
        const { data: teacher, error: teacherError } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle()

        if (teacherError) {
            console.error('[My TA] Teacher query error:', teacherError)
            return NextResponse.json({
                error: 'Teacher query failed',
                details: teacherError.message
            }, { status: 500 })
        }

        if (!teacher) {
            console.log('[My TA] No teacher record found')
            return NextResponse.json([])
        }

        console.log('[My TA] Teacher ID:', teacher.id)

        const allYears = request.nextUrl.searchParams.get('all_years')
        const academicYearId = request.nextUrl.searchParams.get('academic_year_id')

        // Auto-filter by active year if no specific year requested
        let filterYearId = academicYearId
        if (!filterYearId && allYears !== 'true') {
            const { data: activeYear } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .single()
            if (activeYear) filterYearId = activeYear.id
        }

        // Get teaching assignments for this teacher
        let assignmentsQuery = supabase
            .from('teaching_assignments')
            .select(`
                id,
                teacher_id,
                subject:subjects(id, name),
                class:classes(id, name),
                academic_year:academic_years(id, name, is_active)
            `)
            .eq('teacher_id', teacher.id)

        if (filterYearId) {
            assignmentsQuery = assignmentsQuery.eq('academic_year_id', filterYearId)
        }

        const { data: assignments, error: assignmentsError } = await assignmentsQuery

        if (assignmentsError) {
            console.error('[My TA] Assignments query error:', assignmentsError)
            return NextResponse.json({
                error: 'Assignments query failed',
                details: assignmentsError.message,
                hint: assignmentsError.hint,
                code: assignmentsError.code
            }, { status: 500 })
        }

        console.log('[My TA] Found assignments:', assignments?.length || 0)

        return NextResponse.json(assignments || [])
    } catch (error: any) {
        console.error('[My TA] Unexpected error:', error)
        return NextResponse.json({
            error: 'Server error',
            message: error?.message || 'Unknown error',
            stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
        }, { status: 500 })
    }
}
