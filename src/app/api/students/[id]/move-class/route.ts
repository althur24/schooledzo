import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * POST /api/students/:id/move-class
 * Move a student to a different class (mid-year transfer or admin correction).
 * Atomically closes old ACTIVE enrollment (TRANSFERRED_OUT) + creates new ACTIVE
 * in target class + syncs students.class_id. Works same-year and cross-year.
 *
 * Body: { to_class_id: string }
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { to_class_id } = await request.json()

        if (!to_class_id) {
            return NextResponse.json({ error: 'to_class_id wajib diisi' }, { status: 400 })
        }

        // Validate student exists + school scope
        let checkQuery = supabase.from('students').select('id').eq('id', id)
        if (schoolId) checkQuery = checkQuery.eq('school_id', schoolId)
        const { data: student } = await checkQuery.single()
        if (!student) {
            return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })
        }

        // Validate target class exists + belongs to school (via academic_year chain)
        if (schoolId) {
            const { data: schoolYears } = await supabase
                .from('academic_years').select('id').eq('school_id', schoolId)
            const yearIds = (schoolYears || []).map(y => y.id)
            const { count } = await supabase
                .from('classes').select('id', { count: 'exact', head: true })
                .eq('id', to_class_id)
                .in('academic_year_id', yearIds.length ? yearIds : ['00000000-0000-0000-0000-000000000000'])
            if (count !== 1) {
                return NextResponse.json({ error: 'Kelas tujuan tidak ditemukan di sekolah Anda' }, { status: 403 })
            }
        }

        // Call transactional RPC
        const { data: rpcResult, error: rpcError } = await supabase.rpc('move_student_to_class', {
            p_student_id: id,
            p_to_class_id: to_class_id,
            p_school_id: schoolId || null,
            p_notes: null
        })

        if (rpcError) {
            console.error('RPC move_student_to_class failed:', rpcError)
            return NextResponse.json({ error: rpcError.message }, { status: 500 })
        }

        return NextResponse.json(rpcResult || { success: true })
    } catch (error: any) {
        console.error('Error moving student:', error)
        return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
    }
}
