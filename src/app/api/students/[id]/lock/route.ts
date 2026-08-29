import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ id: string }> } // Await the params
) {
    try {
        const { id } = await context.params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user: authUser, schoolId } = ctx

        if (authUser.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { is_locked } = await request.json()

        if (typeof is_locked !== 'boolean') {
            return NextResponse.json({ error: 'is_locked flag wajib disertakan dan harus boolean' }, { status: 400 })
        }

        // 1. Get the target student to fetch the `user_id` and `parent_user_id`
        let studentQuery = supabase
            .from('students')
            .select('user_id, parent_user_id')
            .eq('id', id)
        // Filter sekolah hanya bila ada (SUPER_ADMIN schoolId null → eq null salah match)
        if (schoolId) studentQuery = studentQuery.eq('school_id', schoolId)
        const { data: student, error: fetchError } = await studentQuery
            .single()

        if (fetchError || !student) {
            return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })
        }

        // 2. Prepare user IDs to update (Student AND Wali/Guardian if exists)
        const userIdsToUpdate = [student.user_id]
        if (student.parent_user_id) {
            userIdsToUpdate.push(student.parent_user_id)
        }

        // 3. Update the `is_locked` flag for those users
        const { error: updateError } = await supabase
            .from('users')
            .update({ is_locked })
            .in('id', userIdsToUpdate)

        if (updateError) {
            console.error('Lms error locking users:', updateError)
            throw updateError
        }

        return NextResponse.json({ success: true, is_locked, affected_users: userIdsToUpdate.length })

    } catch (error) {
        console.error('Error locking student:', error)
        return NextResponse.json(
            { error: 'Gagal mengubah status blokir akun' },
            { status: 500 }
        )
    }
}
