import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { hashPassword } from '@/lib/auth'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// PUT update teacher
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

        const { username, password, full_name, nip, gender } = await request.json()

        // Get teacher to find user_id (scoped by school)
        let teacherLookup = supabase
            .from('teachers')
            .select('user_id')
            .eq('id', id)
        if (schoolId) teacherLookup = teacherLookup.eq('school_id', schoolId)
        const { data: teacher } = await teacherLookup.single()

        if (!teacher) {
            return NextResponse.json({ error: 'Guru tidak ditemukan' }, { status: 404 })
        }

        // Update user
        const userUpdate: Record<string, any> = {}
        if (username) userUpdate.username = username
        if (full_name) userUpdate.full_name = full_name
        if (password) {
            userUpdate.password_hash = await hashPassword(password)
            userUpdate.must_change_password = true
        }

        if (Object.keys(userUpdate).length > 0) {
            const { error: userError } = await supabase
                .from('users')
                .update(userUpdate)
                .eq('id', teacher.user_id)

            if (userError) throw userError
        }

        // Update teacher
        const teacherUpdate: Record<string, string | null> = {}
        if (nip !== undefined) teacherUpdate.nip = nip
        if (gender !== undefined) teacherUpdate.gender = gender

        if (Object.keys(teacherUpdate).length > 0) {
            const { error: teacherError } = await supabase
                .from('teachers')
                .update(teacherUpdate)
                .eq('id', id)

            if (teacherError) throw teacherError
        }

        // Fetch updated data
        const { data: updatedTeacher, error } = await supabase
            .from('teachers')
            .select(`
        *,
        user:users(id, username, full_name, role)
      `)
            .eq('id', id)
            .single()

        if (error) throw error

        return NextResponse.json(updatedTeacher)
    } catch (error) {
        console.error('Error updating teacher:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE teacher
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

        // Get teacher to find user_id (scoped by school)
        let teacherLookup = supabase
            .from('teachers')
            .select('user_id')
            .eq('id', id)
        if (schoolId) teacherLookup = teacherLookup.eq('school_id', schoolId)
        const { data: teacher } = await teacherLookup.single()

        if (!teacher) {
            return NextResponse.json({ error: 'Guru tidak ditemukan' }, { status: 404 })
        }

        // Manual cascade cleanup for FKs that reference users(id) WITHOUT ON DELETE CASCADE/SET NULL
        // These would cause a 500 FK constraint error if not cleared first.
        
        // 1. schedules.created_by → REFERENCES users(id) (no ON DELETE action = RESTRICT)
        await supabase.from('schedules').update({ created_by: null }).eq('created_by', teacher.user_id)
        
        // 2. admin_reviews.reviewer_id → REFERENCES users(id) (no ON DELETE action = RESTRICT)
        await supabase.from('admin_reviews').update({ reviewer_id: null }).eq('reviewer_id', teacher.user_id)

        // Now safe to delete the user — cascades to:
        // sessions (ON DELETE CASCADE), teachers (ON DELETE CASCADE),
        // teaching_assignments (ON DELETE CASCADE via teachers),
        // schedules.teacher_id (ON DELETE SET NULL),
        // classes.homeroom_teacher_id (ON DELETE SET NULL),
        // notifications (ON DELETE CASCADE), etc.
        const { error } = await supabase
            .from('users')
            .delete()
            .eq('id', teacher.user_id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting teacher:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
