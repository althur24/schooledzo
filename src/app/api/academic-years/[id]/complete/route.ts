import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// PUT - Complete/End an academic year
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get the current academic year (scoped by school)
        let fetchQuery = supabase
            .from('academic_years')
            .select('*')
            .eq('id', id)
        if (schoolId) fetchQuery = fetchQuery.eq('school_id', schoolId)
        const { data: currentYear, error: fetchError } = await fetchQuery.single()

        if (fetchError) throw fetchError

        if (!currentYear) {
            return NextResponse.json({ error: 'Tahun ajaran tidak ditemukan' }, { status: 404 })
        }

        // Update the academic year to COMPLETED
        let updateQuery = supabase
            .from('academic_years')
            .update({
                status: 'COMPLETED',
                is_active: false,
                end_date: new Date().toISOString().split('T')[0]
            })
            .eq('id', id)
        if (schoolId) updateQuery = updateQuery.eq('school_id', schoolId)
        const { data, error } = await updateQuery
            .select()
            .single()

        if (error) throw error

        return NextResponse.json({
            success: true,
            message: `Tahun ajaran ${data.name} berhasil diselesaikan`,
            data
        })
    } catch (error) {
        console.error('Error completing academic year:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
