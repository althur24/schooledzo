import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound } from '@/lib/tenantGuard'
import { archivedYearResponse } from '@/lib/academicYear'

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

        // Ownership + archived year check in one query
        const { data: material, error: fetchError } = await supabase
            .from('materials')
            .select(`
                id,
                teaching_assignment:teaching_assignments(
                    teacher:teachers(user_id, school_id),
                    academic_year:academic_years(status)
                )
            `)
            .eq('id', id)
            .single()

        if (fetchError || !material) {
            // PGRST116 = no rows found; anything else is a real query failure
            if (fetchError && fetchError.code !== 'PGRST116') throw fetchError
            return NextResponse.json({ error: 'Materi tidak ditemukan' }, { status: 404 })
        }

        const ta: any = material.teaching_assignment
        const ownerUserId = Array.isArray(ta?.teacher) ? ta.teacher[0]?.user_id : ta?.teacher?.user_id

        // Guru hanya boleh menghapus materi dari penugasan miliknya sendiri
        if (user.role === 'GURU' && ownerUserId !== user.id) {
            return NextResponse.json({ error: 'Anda tidak berhak menghapus materi ini' }, { status: 403 })
        }

        // Tenant guard: materi harus milik sekolah caller (ADMIN dulu lolos tanpa cek)
        const taSchoolId = Array.isArray(ta?.teacher) ? ta.teacher[0]?.school_id : ta?.teacher?.school_id
        if (tenantMismatch(taSchoolId, schoolId)) {
            return notFound()
        }

        const yearStatus = Array.isArray(ta?.academic_year) ? ta.academic_year[0]?.status : ta?.academic_year?.status
        if (yearStatus === 'COMPLETED') return archivedYearResponse()

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
