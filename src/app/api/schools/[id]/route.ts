import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * GET /api/schools/[id]
 * Returns a single school with counts (SUPER_ADMIN only)
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const { data: school, error } = await supabase
            .from('schools')
            .select('*')
            .eq('id', id)
            .single()

        if (error) throw error

        // Get counts
        const [students, teachers, classes] = await Promise.all([
            supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', id),
            supabase.from('teachers').select('id', { count: 'exact', head: true }).eq('school_id', id),
            supabase.from('classes').select('id', { count: 'exact', head: true })
                .in('academic_year_id',
                    (await supabase.from('academic_years').select('id').eq('school_id', id)).data?.map(a => a.id) || []
                )
        ])

        return NextResponse.json({
            ...school,
            student_count: students.count || 0,
            teacher_count: teachers.count || 0,
            class_count: classes.count || 0,
        })
    } catch (error) {
        console.error('Error fetching school:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

/**
 * PUT /api/schools/[id]
 * Update school details (SUPER_ADMIN only)
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await request.json()
        const { name, code, address, phone, email, school_level, is_active, max_students, max_teachers } = body

        const updateData: Record<string, unknown> = {}
        if (name !== undefined) updateData.name = name
        if (code !== undefined) updateData.code = code
        if (address !== undefined) updateData.address = address
        if (phone !== undefined) updateData.phone = phone
        if (email !== undefined) updateData.email = email
        if (school_level !== undefined) updateData.school_level = school_level
        if (is_active !== undefined) updateData.is_active = is_active
        if (max_students !== undefined) updateData.max_students = max_students
        if (max_teachers !== undefined) updateData.max_teachers = max_teachers

        const { data, error } = await supabase
            .from('schools')
            .update(updateData)
            .eq('id', id)
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating school:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
