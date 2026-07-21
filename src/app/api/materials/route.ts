import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { archivedYearResponse } from '@/lib/academicYear'

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
            } else {
                // No active year: return empty instead of leaking content across years
                return NextResponse.json([])
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

// POST new material (supports one or many teaching assignments)
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (!['GURU', 'ADMIN'].includes(user.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { title, description, type, content_url, content_text } = body

        // Accept teaching_assignment_ids[] (new) or legacy single teaching_assignment_id
        const taIds: string[] = Array.isArray(body.teaching_assignment_ids) && body.teaching_assignment_ids.length > 0
            ? body.teaching_assignment_ids
            : body.teaching_assignment_id ? [body.teaching_assignment_id] : []

        if (taIds.length === 0 || !title || !type) {
            return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 })
        }

        // Verify every assignment exists, belongs to this school, and is not in an archived year
        const { data: tas, error: taError } = await supabase
            .from('teaching_assignments')
            .select('id, academic_year:academic_years(school_id, status)')
            .in('id', taIds)

        if (taError) throw taError

        const foundIds = new Set((tas || []).map((t: any) => t.id))
        if (foundIds.size !== taIds.length) {
            return NextResponse.json({ error: 'Penugasan tidak valid' }, { status: 400 })
        }
        for (const ta of tas || []) {
            const year = (ta as any).academic_year
            if (schoolId && year?.school_id !== schoolId) {
                return NextResponse.json({ error: 'Penugasan bukan milik sekolah Anda' }, { status: 403 })
            }
            if (year?.status === 'COMPLETED') return archivedYearResponse()
        }

        // One material row per class (teaching assignment)
        const rows = taIds.map((taId) => ({
            teaching_assignment_id: taId,
            title,
            description,
            type,
            content_url,
            content_text
        }))

        const { data, error } = await supabase
            .from('materials')
            .insert(rows)
            .select()

        if (error) {
            console.error('Supabase Insert Error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ created: data?.length || 0, items: data })
    } catch (error: any) {
        console.error('Error creating material:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
