import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { hashPassword } from '@/lib/auth'
import { getSchoolContextOrError, isErrorResponse, getSchoolCode } from '@/lib/schoolContext'

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

        // Fetch all classes to map class names to IDs (scoped via academic year)
        // classes don't have school_id directly - scope via academic_years
        const { data: schoolYears } = await supabase
            .from('academic_years')
            .select('id')
            .eq('school_id', schoolId)
        const yearIds = schoolYears?.map(y => y.id) || []

        const { data: classesData, error: classesError } = yearIds.length > 0
            ? await supabase
                .from('classes')
                .select('id, name')
                .in('academic_year_id', yearIds)
            : { data: [] as any[], error: null }

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

        const schoolCode = await getSchoolCode(schoolId || '')
        if (!schoolCode) {
            return NextResponse.json({ error: 'Data sekolah tidak valid' }, { status: 400 })
        }

        // BATCH OPTIMIZATION: Pre-fetch all existing usernames in ONE query
        // NIS is used as username if no explicit username provided
        const resolvedUsernames = payload.map((item: any) => {
            const explicitUsername = item.username ? String(item.username).trim() : ''
            const nis = item.nis ? String(item.nis).trim() : ''
            const baseUsername = explicitUsername || nis // fallback to NIS
            return baseUsername ? `${baseUsername}.${schoolCode}` : ''
        }).filter(Boolean)

        const { data: existingUsers } = await supabase
            .from('users')
            .select('username')
            .in('username', resolvedUsernames)
        const existingUsernames = new Set(existingUsers?.map(u => u.username) || [])

        // Track usernames added within this batch to detect duplicates
        const usedInBatch = new Set<string>()

        // PARALLEL OPTIMIZATION: Hash ALL passwords at once (~150ms total instead of 50 × 150ms = 7.5s)
        const passwordHashes = await Promise.all(
            payload.map((item: any) =>
                item.password ? hashPassword(String(item.password)) : Promise.resolve('')
            )
        )

        // Process sequentially (inserts need IDs from previous steps)
        for (let i = 0; i < payload.length; i++) {
            const item = payload[i]
            const { full_name, gender, nis, angkatan, kelas, username, password } = item

            // Resolve username: explicit username > NIS
            const baseUsername = (username ? String(username).trim() : '') || (nis ? String(nis).trim() : '')
            const resolvedUsername = baseUsername ? `${baseUsername}.${schoolCode}` : ''

            if (!full_name) {
                results.push({ item, success: false, error: 'Nama Lengkap harus diisi' })
                continue
            }

            if (!resolvedUsername) {
                results.push({ item, success: false, error: 'NIS atau Username harus diisi (NIS akan digunakan sebagai username login)' })
                continue
            }

            if (!password) {
                results.push({ item, success: false, error: 'Password harus diisi' })
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
                // Check existing username from pre-fetched set + current batch
                if (existingUsernames.has(resolvedUsername) || usedInBatch.has(resolvedUsername)) {
                    results.push({ item, success: false, error: `Username/NIS '${resolvedUsername}' sudah digunakan` })
                    continue
                }
                usedInBatch.add(resolvedUsername)

                // Use pre-computed hash (already done in parallel above)
                const password_hash = passwordHashes[i]

                // Create user (username = NIS or explicit username)
                const { data: newUser, error: userError } = await supabase
                    .from('users')
                    .insert({
                        username: resolvedUsername,
                        password_hash,
                        full_name: String(full_name),
                        role: 'SISWA',
                        school_id: schoolId,
                        must_change_password: true
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
