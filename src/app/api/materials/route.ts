import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// M2: Service Role Key required because app uses custom auth (not Supabase Auth),
// so RLS policies depending on auth.uid() won't work. Role checks enforce authorization.
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET all materials
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const teachingAssignmentId = request.nextUrl.searchParams.get('teaching_assignment_id')
        const allYears = request.nextUrl.searchParams.get('all_years')

        let query = supabase
            .from('materials')
            .select(`
        *,
          teaching_assignment:teaching_assignments(
          id,
          academic_year_id,
          teacher:teachers(id, user:users(full_name)),
          subject:subjects(id, name),
          class:classes(name),
          academic_year:academic_years(id, name, is_active)
        )
      `)
            .order('created_at', { ascending: false })

        if (teachingAssignmentId) {
            query = query.eq('teaching_assignment_id', teachingAssignmentId)
        } else if (allYears !== 'true') {
            // Filter by active year
            const { data: activeYear } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .single()

            if (activeYear) {
                const { data: taIds } = await supabase
                    .from('teaching_assignments')
                    .select('id')
                    .eq('academic_year_id', activeYear.id)

                if (taIds && taIds.length > 0) {
                    query = query.in('teaching_assignment_id', taIds.map(t => t.id))
                } else {
                    return NextResponse.json([])
                }
            }
        }

        const { data, error } = await query

        if (error) throw error

        return NextResponse.json(data)
    } catch (error: any) {
        console.error('Error fetching materials:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST new material
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { teaching_assignment_id, title, description, type, content_url, content_text } = await request.json()

        if (!teaching_assignment_id || !title || !type) {
            return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 })
        }

        // Use supabase to bypass RLS for insert
        const { data, error } = await supabase
            .from('materials')
            .insert({ teaching_assignment_id, title, description, type, content_url, content_text })
            .select()
            .single()

        if (error) {
            console.error('Supabase Insert Error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }



        return NextResponse.json(data)
    } catch (error: any) {
        console.error('Error creating material:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
