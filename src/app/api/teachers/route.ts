import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { hashPassword } from '@/lib/auth'
import { getSchoolContextOrError, isErrorResponse, getSchoolCode } from '@/lib/schoolContext'

// GET all teachers
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { schoolId } = ctx

        let query = supabase
            .from('teachers')
            .select(`
        *,
        user:users(id, username, full_name, role, must_change_password),
        teaching_assignments(id)
      `)
            .order('created_at', { ascending: false })

        // School filter
        if (schoolId) query = query.eq('school_id', schoolId)

        const { data, error } = await query
        if (error) throw error

        return NextResponse.json(data)
    } catch (error: any) {
        console.error('Error fetching teachers:', error.message)
        return NextResponse.json({ error: 'Server error', details: error.message }, { status: 500 })
    }
}

// POST new teacher (creates user + teacher record)
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user: authUser, schoolId } = ctx

        if (authUser.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { username, password, full_name, nip, gender } = await request.json()

        if (!username || !password) {
            return NextResponse.json({ error: 'Username dan password harus diisi' }, { status: 400 })
        }

        const schoolCode = await getSchoolCode(schoolId || '')
        if (!schoolCode) {
            return NextResponse.json({ error: 'Data sekolah tidak valid' }, { status: 400 })
        }

        const suffixedUsername = `${username.trim()}.${schoolCode}`

        // Check if username already exists (globally unique)
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('username', suffixedUsername)
            .single()

        if (existingUser) {
            return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 400 })
        }

        const password_hash = await hashPassword(password)

        // Create user with school_id
        const { data: newUser, error: userError } = await supabase
            .from('users')
            .insert({
                username: suffixedUsername,
                password_hash,
                full_name,
                role: 'GURU',
                school_id: schoolId,
                must_change_password: true
            })
            .select()
            .single()

        if (userError) throw userError

        // Create teacher record with school_id
        const { data: teacher, error: teacherError } = await supabase
            .from('teachers')
            .insert({
                user_id: newUser.id,
                nip,
                gender,
                school_id: schoolId
            })
            .select(`
        *,
        user:users(id, username, full_name, role)
      `)
            .single()

        if (teacherError) {
            await supabase.from('users').delete().eq('id', newUser.id)
            throw teacherError
        }

        return NextResponse.json(teacher)
    } catch (error) {
        console.error('Error creating teacher:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
