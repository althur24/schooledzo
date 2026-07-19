import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getYearStatusById, archivedYearResponse } from '@/lib/academicYear'

// DELETE teaching assignment
export async function DELETE(
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

        // Block writes to archived (COMPLETED) academic years
        const { data: taForYear } = await supabase
            .from('teaching_assignments')
            .select('academic_year_id')
            .eq('id', id)
            .single()
        if (taForYear?.academic_year_id) {
            const yearStatus = await getYearStatusById(taForYear.academic_year_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        let deleteQuery = supabase
            .from('teaching_assignments')
            .delete()
            .eq('id', id)
        const { error } = await deleteQuery

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting teaching assignment:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
