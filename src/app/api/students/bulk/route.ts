import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { hashPassword } from '@/lib/auth'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user: authUser, schoolId } = ctx

        if (authUser.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const payload = await request.json()
        if (!Array.isArray(payload)) {
            return NextResponse.json({ error: 'Payload harus berupa array' }, { status: 400 })
        }

        // Fetch all classes to map class names to IDs
        const { data: classesData, error: classesError } = await supabase
            .from('classes')
            .select('id, name')
            .eq('school_id', schoolId)

        if (classesError) throw classesError

        // Create a lookup map for classes (case-insensitive)
        const classMap = new Map<string, string>()
        classesData?.forEach(c => {
            classMap.set(c.name.trim().toLowerCase(), c.id)
        })

        // Fetch active academic year once for enrollment creation
        const { data: activeYear } = await supabase
            .from('academic_years')
            .select('id')
            .eq('is_active', true)
            .eq('school_id', schoolId)
            .single()

        const results = []

        // Process sequentially
        for (const item of payload) {
            const { full_name, gender, nis, angkatan, kelas, username, password } = item

            if (!username || !password || !full_name) {
                results.push({ item, success: false, error: 'Nama, Username, dan Password harus diisi' })
                continue
            }

            // Map Class Name to ID if provided
            let mapped_class_id = null
            if (kelas) {
                const searchStr = String(kelas).trim().toLowerCase()
                mapped_class_id = classMap.get(searchStr)
                if (!mapped_class_id) {
                    results.push({ item, success: false, error: `Kelas '${kelas}' tidak ditemukan di sistem` })
                    continue
                }
            }

            try {
                // Check existing username
                const { data: existingUser } = await supabase
                    .from('users')
                    .select('id')
                    .eq('username', username)
                    .single()

                if (existingUser) {
                    results.push({ item, success: false, error: 'Username sudah digunakan' })
                    continue
                }

                // Hash password
                const password_hash = await hashPassword(String(password))

                // Create user
                const { data: newUser, error: userError } = await supabase
                    .from('users')
                    .insert({
                        username: String(username),
                        password_hash,
                        full_name: String(full_name),
                        role: 'SISWA',
                        school_id: schoolId
                    })
                    .select()
                    .single()

                if (userError) throw userError

                // Create student record
                const { data: newStudent, error: studentError } = await supabase
                    .from('students')
                    .insert({
                        user_id: newUser.id,
                        nis: nis ? String(nis) : null,
                        class_id: mapped_class_id,
                        school_id: schoolId,
                        gender: gender === 'L' || gender === 'P' ? gender : null,
                        angkatan: angkatan ? String(angkatan) : null,
                        status: 'ACTIVE'
                    })
                    .select('id')
                    .single()

                if (studentError) {
                    // Rollback
                    await supabase.from('users').delete().eq('id', newUser.id)
                    throw studentError
                }

                // Auto-create enrollment for the active academic year
                if (newStudent && mapped_class_id && activeYear) {
                    await supabase
                        .from('student_enrollments')
                        .insert({
                            student_id: newStudent.id,
                            class_id: mapped_class_id,
                            academic_year_id: activeYear.id,
                            status: 'ACTIVE'
                        })
                }

                results.push({ item, success: true })
            } catch (err: any) {
                console.error(`Error processing student ${username}:`, err)
                results.push({ item, success: false, error: err.message || 'Terjadi kesalahan sistem' })
            }
        }

        return NextResponse.json({ results })
    } catch (error) {
        console.error('Error in bulk student upload:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
