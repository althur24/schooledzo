import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { fetchAllRows } from '@/lib/fetchAllRows'

/**
 * POST /api/admin/diagnostics/repair-enrollments
 * Repair enrollments that have mismatched academic_year_id
 * (enrollment year differs from the class's year)
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        // Find all enrollments where the enrollment's academic_year_id
        // doesn't match the class's academic_year_id
        // fetchAllRows: enrollment ACTIVE lintas sekolah bisa >1000 baris —
        // query biasa terpotong diam-diam sehingga repair tidak lengkap.
        const enrollments = await fetchAllRows(supabase
            .from('student_enrollments')
            .select(`
                id,
                academic_year_id,
                class_id,
                status,
                enrollment_class:classes!student_enrollments_class_id_fkey(id, academic_year_id)
            `)
            .eq('status', 'ACTIVE')
            .order('id'))

        const mismatched = enrollments.filter((e: any) => {
            if (!e.enrollment_class) return false
            return e.academic_year_id !== e.enrollment_class.academic_year_id
        })

        if (mismatched.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No mismatched enrollments found',
                repaired: 0
            })
        }

        // Repair: update enrollment academic_year_id to match class's academic_year_id
        let repaired = 0
        const errors: string[] = []

        for (const enrollment of mismatched) {
            const correctYearId = (enrollment as any).enrollment_class.academic_year_id
            const { error: updateError } = await supabase
                .from('student_enrollments')
                .update({ academic_year_id: correctYearId })
                .eq('id', enrollment.id)

            if (updateError) {
                errors.push(`Failed to repair enrollment ${enrollment.id}: ${updateError.message}`)
            } else {
                repaired++
            }
        }

        return NextResponse.json({
            success: true,
            message: `Repaired ${repaired} of ${mismatched.length} mismatched enrollments`,
            repaired,
            total_mismatched: mismatched.length,
            errors: errors.length > 0 ? errors : undefined
        })

    } catch (error: any) {
        console.error('Repair error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
