import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET all academic years
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN' && user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let query = supabase
            .from('academic_years')
            .select('*')
            .order('created_at', { ascending: false })

        if (schoolId) query = query.eq('school_id', schoolId)

        const { data, error } = await query
        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching academic years:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST new academic year
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { name, start_date, end_date, status, is_active } = await request.json()

        if (!name) {
            return NextResponse.json({ error: 'Nama tahun ajaran harus diisi' }, { status: 400 })
        }

        const finalStatus = status || (is_active ? 'ACTIVE' : 'PLANNED')
        const finalIsActive = is_active || status === 'ACTIVE'

        // If setting as active, deactivate others in the SAME school
        if (finalIsActive) {
            // Check if old active year has pending (unprocessed) enrollments
            let activeYearQuery = supabase
                .from('academic_years')
                .select('id, name')
                .eq('is_active', true)
            if (schoolId) activeYearQuery = activeYearQuery.eq('school_id', schoolId)
            const { data: currentActiveYear } = await activeYearQuery.maybeSingle()

            if (currentActiveYear) {
                const { count: pendingCount } = await supabase
                    .from('student_enrollments')
                    .select('id', { count: 'exact', head: true })
                    .eq('academic_year_id', currentActiveYear.id)
                    .eq('status', 'ACTIVE')

                if (pendingCount && pendingCount > 0) {
                    return NextResponse.json({
                        error: `Tahun ${currentActiveYear.name} masih memiliki ${pendingCount} siswa yang belum diproses kenaikan kelasnya. Selesaikan proses kenaikan kelas terlebih dahulu, atau gunakan Wizard Pergantian Tahun.`
                    }, { status: 400 })
                }
            }

            let deactivateQuery = supabase
                .from('academic_years')
                .update({ is_active: false, status: 'COMPLETED' })
                .eq('is_active', true)

            if (schoolId) deactivateQuery = deactivateQuery.eq('school_id', schoolId)

            await deactivateQuery
        }

        const { data, error } = await supabase
            .from('academic_years')
            .insert({
                name,
                start_date: start_date || null,
                end_date: end_date || null,
                status: finalStatus,
                is_active: finalIsActive,
                school_id: schoolId
            })
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error creating academic year:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
