import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch } from '@/lib/tenantGuard'
import { getYearStatusById, archivedYearResponse } from '@/lib/academicYear'

// GET all teaching assignments
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const academicYearId = request.nextUrl.searchParams.get('academic_year_id')
        const allYears = request.nextUrl.searchParams.get('all_years')

        // Auto-filter by active year if no specific year requested
        let filterYearId = academicYearId
        let schoolYearIds: string[] | null = null
        if (!filterYearId && allYears !== 'true') {
            let yearQuery = supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
            if (schoolId) yearQuery = yearQuery.eq('school_id', schoolId)
            const { data: activeYear } = await yearQuery.single()
            if (activeYear) filterYearId = activeYear.id
        }

        // Tenant guard: tahun ajaran dari client harus milik sekolah caller
        if (filterYearId && schoolId) {
            const { data: reqYear } = await supabase
                .from('academic_years')
                .select('school_id')
                .eq('id', filterYearId)
                .single()
            if (tenantMismatch((reqYear as any)?.school_id, schoolId)) {
                return NextResponse.json([])
            }
        }

        // all_years=true: tetap scope ke tahun ajaran sekolah caller —
        // sebelumnya tanpa filter sama sekali (bocor TA semua sekolah)
        if (!filterYearId && allYears === 'true' && schoolId) {
            const { data: schoolYears } = await supabase
                .from('academic_years')
                .select('id')
                .eq('school_id', schoolId)
            schoolYearIds = schoolYears?.map((y: any) => y.id) || []
        }

        // No active year: return empty instead of leaking assignments across years
        if (!filterYearId && allYears !== 'true') {
            return NextResponse.json([])
        }

        let query = supabase
            .from('teaching_assignments')
            .select(`
        *,
        teacher:teachers(
          id,
          nip,
          user:users(id, username, full_name)
        ),
        subject:subjects(*),
        class:classes(*),
        academic_year:academic_years(*)
      `)
            .order('created_at', { ascending: false })

        if (filterYearId) {
            query = query.eq('academic_year_id', filterYearId)
        } else if (schoolYearIds) {
            query = query.in('academic_year_id', schoolYearIds)
        }

        const { data, error } = await query

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching teaching assignments:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST new teaching assignment
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { teacher_id, subject_id, class_id, academic_year_id } = await request.json()

        if (!teacher_id || !subject_id || !class_id || !academic_year_id) {
            return NextResponse.json({ error: 'Semua field harus diisi' }, { status: 400 })
        }

        // Block writes to archived (COMPLETED) academic years
        const yearStatus = await getYearStatusById(academic_year_id)
        if (yearStatus === 'COMPLETED') return archivedYearResponse()

        // Guard: kelas harus benar-benar milik tahun ajaran penugasan — tanpa ini
        // admin bisa memilih kelas tahun lama yang bernama sama (insiden CIS
        // 8 Jul 2026: 17 TA tahun baru menunjuk kelas tahun lama → semua materi/
        // tugas/kuis guru kelas itu tidak pernah muncul di siswa). Paritas dengan
        // guard di route bulk.
        const { data: validClass } = await supabase
            .from('classes')
            .select('id, school_id')
            .eq('id', class_id)
            .eq('academic_year_id', academic_year_id)
            .maybeSingle()
        if (!validClass) {
            return NextResponse.json({ error: 'Kelas tidak ditemukan pada tahun ajaran yang dipilih' }, { status: 400 })
        }
        if (tenantMismatch(validClass.school_id, schoolId)) {
            return NextResponse.json({ error: 'Kelas bukan milik sekolah Anda' }, { status: 403 })
        }

        // Check for duplicate
        const { data: existing } = await supabase
            .from('teaching_assignments')
            .select('id')
            .eq('teacher_id', teacher_id)
            .eq('subject_id', subject_id)
            .eq('class_id', class_id)
            .eq('academic_year_id', academic_year_id)
            .single()

        if (existing) {
            return NextResponse.json({ error: 'Penugasan sudah ada' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('teaching_assignments')
            .insert({ teacher_id, subject_id, class_id, academic_year_id })
            .select(`
        *,
        teacher:teachers(
          id,
          nip,
          user:users(id, username, full_name)
        ),
        subject:subjects(*),
        class:classes(*),
        academic_year:academic_years(*)
      `)
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error creating teaching assignment:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
