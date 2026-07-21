import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'

// DELETE material
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (!['GURU', 'ADMIN'].includes(user.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: materialForYear } = await supabase
            .from('materials')
            .select('teaching_assignment_id')
            .eq('id', id)
            .single()
        if (materialForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(materialForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        const { error } = await supabase
            .from('materials')
            .delete()
            .eq('id', id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting material:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
