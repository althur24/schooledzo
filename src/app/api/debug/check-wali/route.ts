import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let usersQuery = supabase
            .from('users')
            .select('id, username, full_name, role')
            .like('username', '%.wali')
        if (schoolId) usersQuery = usersQuery.eq('school_id', schoolId)
        const { data: users, error: userError } = await usersQuery

        let studentsQuery = supabase
            .from('students')
            .select('id, user_id, parent_user_id, status, user:users!students_user_id_fkey(username)')
        if (schoolId) studentsQuery = studentsQuery.eq('school_id', schoolId)
        const { data: students, error: studentError } = await studentsQuery

        return NextResponse.json({
            users: users || [],
            students: students || [],
            userError,
            studentError
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message })
    }
}

