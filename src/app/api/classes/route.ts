import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getYearStatusById, archivedYearResponse } from '@/lib/academicYear'

// GET all classes
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { schoolId } = ctx

        const url = new URL(request.url)
        const grade_level = url.searchParams.get('grade_level')
        const academic_year_id = url.searchParams.get('academic_year_id')

        let query = supabase
            .from('classes')
            .select(`
        *,
        academic_year:academic_years(*),
        homeroom_teacher:teachers!homeroom_teacher_id(
          id,
          nip,
          user:users(id, full_name, username)
        )
      `)

        // School filter: classes → academic_years.school_id
        // We filter via academic_year's school_id
        if (schoolId) {
            query = query.eq('academic_year.school_id', schoolId)
        }

        if (grade_level) query = query.eq('grade_level', parseInt(grade_level))
        if (academic_year_id) query = query.eq('academic_year_id', academic_year_id)

        const { data, error } = await query
            .order('grade_level', { ascending: true, nullsFirst: false })
            .order('name', { ascending: true })

        if (error) throw error

        // If we filtered by school via academic_year, remove classes with null academic_year
        let filtered = data || []
        if (schoolId) {
            filtered = filtered.filter((c: any) => c.academic_year !== null)
        }

        return NextResponse.json(filtered)
    } catch (error) {
        console.error('Error fetching classes:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST new class
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { name, academic_year_id, grade_level, school_level } = await request.json()

        if (!name || !academic_year_id) {
            return NextResponse.json({ error: 'Nama kelas dan tahun ajaran harus diisi' }, { status: 400 })
        }

        // Block writes to archived (COMPLETED) academic years
        const yearStatus = await getYearStatusById(academic_year_id)
        if (yearStatus === 'COMPLETED') return archivedYearResponse()

        // Verify academic year belongs to this school
        if (schoolId) {
            const { data: ay } = await supabase
                .from('academic_years')
                .select('id')
                .eq('id', academic_year_id)
                .eq('school_id', schoolId)
                .single()

            if (!ay) {
                return NextResponse.json({ error: 'Tahun ajaran tidak valid' }, { status: 400 })
            }
        }

        if (grade_level !== null && grade_level !== undefined) {
            if (![1, 2, 3].includes(grade_level)) {
                return NextResponse.json({ error: 'Tingkat kelas harus 1, 2, atau 3' }, { status: 400 })
            }
        }

        if (school_level !== null && school_level !== undefined) {
            if (!['SMP', 'SMA'].includes(school_level)) {
                return NextResponse.json({ error: 'Jenjang sekolah harus SMP atau SMA' }, { status: 400 })
            }
        }

        const { data, error } = await supabase
            .from('classes')
            .insert({ name, academic_year_id, grade_level, school_level })
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error creating class:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
