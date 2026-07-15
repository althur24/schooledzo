import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { hashPassword } from '@/lib/auth'
import { getSchoolContextOrError, isErrorResponse, getSchoolCode } from '@/lib/schoolContext'

// GET student by ID
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        let query = supabase
            .from('students')
            .select(`
                *,
                user:users!students_user_id_fkey(id, username, full_name),
                class:classes(id, name, school_level)
            `)
            .eq('id', id)
        if (schoolId) query = query.eq('school_id', schoolId)
        const { data: student, error } = await query.single()

        if (error || !student) {
            return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })
        }

        return NextResponse.json(student)
    } catch (error) {
        console.error('Error fetching student:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
// PUT update student
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

        const { password, full_name, nis, class_id, gender, angkatan, entry_year, school_level, status, wali_password } = await request.json()

        // Get student with current user info (scoped by school)
        let studentQuery = supabase
            .from('students')
            .select('user_id, parent_user_id, nis')
            .eq('id', id)
        if (schoolId) studentQuery = studentQuery.eq('school_id', schoolId)
        const { data: student } = await studentQuery.single()

        if (!student) {
            return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })
        }

        // Get current username for .wali logic
        const { data: currentUser } = await supabase
            .from('users')
            .select('username')
            .eq('id', student.user_id)
            .single()

        const currentUsername = currentUser?.username || ''

        const schoolCode = await getSchoolCode(schoolId || '')
        if (!schoolCode) {
            return NextResponse.json({ error: 'Data sekolah tidak valid' }, { status: 400 })
        }

        // If NIS is being changed, check for username collisions
        const isNisChanging = nis !== undefined && nis !== student.nis
        const newUsername = isNisChanging ? `${nis.trim()}.${schoolCode}` : currentUsername

        if (isNisChanging && newUsername) {
            const { data: existingUser } = await supabase
                .from('users')
                .select('id')
                .eq('username', newUsername)
                .neq('id', student.user_id) // Exclude current user
                .single()

            if (existingUser) {
                return NextResponse.json({ error: 'NIS (Username) sudah digunakan oleh akun lain' }, { status: 400 })
            }
        }


        // Update user
        const userUpdate: Record<string, string | boolean> = {}
        if (isNisChanging && newUsername) userUpdate.username = newUsername
        if (full_name) userUpdate.full_name = full_name
        if (password) {
            userUpdate.password_hash = await hashPassword(password)
            userUpdate.must_change_password = true
        }

        if (Object.keys(userUpdate).length > 0) {
            const { error: userError } = await supabase
                .from('users')
                .update(userUpdate)
                .eq('id', student.user_id)

            if (userError) throw userError
        }

        // Handle .wali user lifecycle
        const studentUpdate: Record<string, string | number | null> = {}
        const waliUsername = `${newUsername}.wali`

        // Check if current parent_user_id is actually the .wali user
        let isCurrentWaliUser = false
        if (student.parent_user_id) {
            const { data: currentParent } = await supabase
                .from('users')
                .select('username')
                .eq('id', student.parent_user_id)
                .single()

            if (currentParent?.username?.endsWith('.wali')) {
                isCurrentWaliUser = true
            }
        }


        if (wali_password) {
            if (isCurrentWaliUser) {
                // .wali user exists → update password (and username if student username/NIS changed)
                const waliUpdate: Record<string, string | boolean> = {
                    password_hash: await hashPassword(wali_password),
                    must_change_password: true
                }
                if (isNisChanging) {
                    waliUpdate.username = waliUsername
                }
                if (full_name) {
                    waliUpdate.full_name = `Orang Tua - ${full_name}`
                }
                const { error: waliUpdateError } = await supabase
                    .from('users')
                    .update(waliUpdate)
                    .eq('id', student.parent_user_id)

                if (waliUpdateError) throw new Error(`Gagal update password wali: ${waliUpdateError.message}`)
            } else {
                // No .wali user yet → create one
                const { data: existingWali } = await supabase
                    .from('users')
                    .select('id')
                    .eq('username', waliUsername)
                    .single()

                if (existingWali) {
                    return NextResponse.json({ error: `Username ${waliUsername} sudah ada` }, { status: 400 })
                }

                const wali_hash = await hashPassword(wali_password)
                const { data: waliUser, error: waliError } = await supabase
                    .from('users')
                    .insert({
                        username: waliUsername,
                        password_hash: wali_hash,
                        full_name: `Orang Tua - ${full_name || newUsername}`,
                        role: 'WALI',
                        school_id: schoolId
                    })
                    .select('id')
                    .single()

                if (waliError) {
                    console.error('Error creating wali user:', waliError)
                    throw new Error(`Gagal membuat akun wali: ${waliError.message}`)
                }

                if (waliUser) {
                    studentUpdate.parent_user_id = waliUser.id
                }
            }
        } else if (isNisChanging && student.parent_user_id && isCurrentWaliUser) {
            // NIS changed but no wali_password updating → rename .wali username if parent exists and is a .wali user
            const { error: waliRenameError } = await supabase
                .from('users')
                .update({ username: waliUsername })
                .eq('id', student.parent_user_id)

            if (waliRenameError) {
                console.error('Error renaming wali user:', waliRenameError)
            }
        }

        // Update student fields
        if (nis !== undefined) studentUpdate.nis = nis
        if (class_id !== undefined) studentUpdate.class_id = class_id
        if (gender !== undefined) studentUpdate.gender = gender === 'L' || gender === 'P' ? gender : null
        if (angkatan !== undefined) studentUpdate.angkatan = angkatan
        if (entry_year !== undefined) studentUpdate.entry_year = entry_year
        if (school_level !== undefined) studentUpdate.school_level = school_level
        if (status !== undefined) studentUpdate.status = status

        if (Object.keys(studentUpdate).length > 0) {
            const { error: studentError } = await supabase
                .from('students')
                .update(studentUpdate)
                .eq('id', id)

            if (studentError) throw studentError
        }

        // Fetch updated data
        const { data: updatedStudent, error } = await supabase
            .from('students')
            .select(`
        *,
        user:users!students_user_id_fkey(id, username, full_name, role),
        class:classes(id, name)
      `)
            .eq('id', id)
            .single()

        if (error) throw error

        return NextResponse.json(updatedStudent)
    } catch (error) {
        console.error('Error updating student:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE student (transactional via RPC)
export async function DELETE(
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

        // Validate student exists and belongs to school
        let checkQuery = supabase
            .from('students')
            .select('id')
            .eq('id', id)
        if (schoolId) checkQuery = checkQuery.eq('school_id', schoolId)
        const { data: student } = await checkQuery.single()

        if (!student) {
            return NextResponse.json({ error: 'Siswa tidak ditemukan' }, { status: 404 })
        }

        // Call transactional RPC — atomic: all-or-nothing
        // SUPER_ADMIN passes null schoolId to skip school scope check in RPC
        const { data: rpcResult, error: rpcError } = await supabase.rpc('delete_student', {
            p_student_id: id,
            p_school_id: schoolId || null
        })

        if (rpcError) {
            console.error('RPC delete_student failed:', rpcError)
            return NextResponse.json({
                error: `Gagal menghapus siswa: ${rpcError.message}`
            }, { status: 500 })
        }

        return NextResponse.json(rpcResult || { success: true })
    } catch (error: any) {
        console.error('Error deleting student:', error)
        return NextResponse.json({
            error: error?.message || 'Server error'
        }, { status: 500 })
    }
}

