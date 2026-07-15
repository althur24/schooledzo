import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// POST /api/students/bulk-delete
// Body: { student_ids: string[] }
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { student_ids } = await request.json()

        if (!Array.isArray(student_ids) || student_ids.length === 0) {
            return NextResponse.json({ error: 'student_ids harus berupa array yang tidak kosong' }, { status: 400 })
        }

        if (student_ids.length > 100) {
            return NextResponse.json({ error: 'Maksimal 100 siswa per batch' }, { status: 400 })
        }

        // Call batch RPC
        const { data: rpcResult, error: rpcError } = await supabase.rpc('delete_students_batch', {
            p_student_ids: student_ids,
            p_school_id: schoolId || null
        })

        if (rpcError) {
            console.error('RPC delete_students_batch failed:', rpcError)
            return NextResponse.json({
                error: `Gagal menghapus siswa: ${rpcError.message}`
            }, { status: 500 })
        }

        return NextResponse.json(rpcResult || { deleted: 0, failed: 0, errors: [] })
    } catch (error: any) {
        console.error('Error bulk deleting students:', error)
        return NextResponse.json({
            error: error?.message || 'Server error'
        }, { status: 500 })
    }
}
