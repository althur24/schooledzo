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

        // Strip leading apostrophes from NIS/username — Excel users prefix ' to force
        // text format, and it would otherwise end up in the login username & password
        payload.forEach((item: any) => {
            if (item.nis) item.nis = String(item.nis).trim().replace(/^'+/, '')
            if (item.username) item.username = String(item.username).trim().replace(/^'+/, '')
        })

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
                .select('id, name, academic_year_id')
                .in('academic_year_id', yearIds)
            : { data: [] as any[], error: null }

        // Fetch active academic year once for enrollment creation (+ angkatan default)
        const { data: activeYear } = await supabase
            .from('academic_years')
            .select('id, name')
            .eq('is_active', true)
            .eq('school_id', schoolId)
            .single()

        if (classesError) throw classesError

        // Create a lookup map for classes (case-insensitive).
        // Class names repeat across years — insert in two passes so classes from the
        // ACTIVE year always win over same-named classes from older years.
        const classMap = new Map<string, string>()
        const activeYearId = activeYear?.id
        classesData?.forEach(c => {
            if (c.academic_year_id !== activeYearId) classMap.set(c.name.trim().toLowerCase(), c.id)
        })
        classesData?.forEach(c => {
            if (c.academic_year_id === activeYearId) classMap.set(c.name.trim().toLowerCase(), c.id)
        })

        // Default angkatan = start year of the active academic year ("2026/2027" -> "2026")
        const defaultAngkatan = activeYear?.name?.match(/\d{4}/)?.[0] || null

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
        // Password optional: empty -> fall back to NIS (or explicit username) as the initial password.
        // must_change_password=true already forces a change on first login.
        const passwordHashes = await Promise.all(
            payload.map((item: any) => {
                const fallback = (item.nis ? String(item.nis).trim() : '') || (item.username ? String(item.username).trim() : '')
                const pw = item.password ? String(item.password) : fallback
                return pw ? hashPassword(pw) : Promise.resolve('')
            })
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

            // Password optional — empty falls back to NIS/username (hashed above)

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
                // Gender: accept L/Laki-laki/P/Perempuan (case-insensitive)
                const genderNorm = String(gender || '').trim().toLowerCase()
                const mappedGender = ['l', 'laki-laki'].includes(genderNorm) ? 'L'
                    : ['p', 'perempuan'].includes(genderNorm) ? 'P' : null

                // Angkatan: normalize "26/27" or "2026/2027" -> start year "2026"; otherwise as-is
                const angkatanRaw = String(angkatan || '').trim()
                const angkatanMatch = angkatanRaw.match(/^(\d{2,4})\s*\/\s*\d{2,4}$/)
                const mappedAngkatan = angkatanMatch
                    ? (angkatanMatch[1].length === 2 ? `20${angkatanMatch[1]}` : angkatanMatch[1])
                    : angkatanRaw || null

                const { data: newStudent, error: studentError } = await supabase
                    .from('students')
                    .insert({
                        user_id: newUser.id,
                        nis: nis ? String(nis) : null,
                        class_id: mapped_class_id,
                        school_id: schoolId,
                        gender: mappedGender,
                        angkatan: mappedAngkatan || defaultAngkatan,
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

                results.push({ item, success: true, no_class: !mapped_class_id })
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
