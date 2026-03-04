import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * GET /api/schools
 * Returns list of all schools with counts (SUPER_ADMIN only)
 */
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        // Get all schools
        const { data: schools, error } = await supabase
            .from('schools')
            .select('*')
            .order('name')

        if (error) throw error

        // Get counts per school
        const enriched = await Promise.all((schools || []).map(async (school) => {
            const [students, teachers, classes] = await Promise.all([
                supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', school.id),
                supabase.from('teachers').select('id', { count: 'exact', head: true }).eq('school_id', school.id),
                supabase.from('classes').select('id', { count: 'exact', head: true })
                    .in('academic_year_id',
                        (await supabase.from('academic_years').select('id').eq('school_id', school.id)).data?.map(a => a.id) || []
                    )
            ])

            return {
                ...school,
                student_count: students.count || 0,
                teacher_count: teachers.count || 0,
                class_count: classes.count || 0,
            }
        }))

        return NextResponse.json(enriched)
    } catch (error) {
        console.error('Error fetching schools:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

/**
 * POST /api/schools
 * Create a new school (SUPER_ADMIN only)
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await request.json()
        const { name, code, address, phone, email, school_level, max_students, max_teachers } = body

        if (!name || !code) {
            return NextResponse.json({ error: 'name and code are required' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('schools')
            .insert({
                name,
                code,
                address: address || null,
                phone: phone || null,
                email: email || null,
                school_level: school_level || null,
                max_students: max_students || 500,
                max_teachers: max_teachers || 50,
                is_active: true,
                settings: {}
            })
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error creating school:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
