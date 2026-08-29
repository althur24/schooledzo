import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound } from '@/lib/tenantGuard'
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

        // Block writes to archived (COMPLETED) academic years + tenant guard
        const { data: taForYear } = await supabase
            .from('teaching_assignments')
            .select('academic_year_id, academic_year:academic_years(school_id)')
            .eq('id', id)
            .single()
        // Tenant guard: penugasan harus milik sekolah caller
        if (tenantMismatch((taForYear as any)?.academic_year?.school_id ?? (Array.isArray((taForYear as any)?.academic_year) ? (taForYear as any)?.academic_year?.[0]?.school_id : undefined), schoolId)) {
            return notFound()
        }
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
