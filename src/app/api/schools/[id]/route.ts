import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * GET /api/schools/[id]
 * Returns a single school with counts (SUPER_ADMIN only)
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const { data: school, error } = await supabase
            .from('schools')
            .select('*')
            .eq('id', id)
            .single()

        if (error) throw error

        // Get counts
        const [students, teachers, classes] = await Promise.all([
            supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', id),
            supabase.from('teachers').select('id', { count: 'exact', head: true }).eq('school_id', id),
            supabase.from('classes').select('id', { count: 'exact', head: true })
                .in('academic_year_id',
                    (await supabase.from('academic_years').select('id').eq('school_id', id)).data?.map(a => a.id) || []
                )
        ])

        return NextResponse.json({
            ...school,
            student_count: students.count || 0,
            teacher_count: teachers.count || 0,
            class_count: classes.count || 0,
        })
    } catch (error) {
        console.error('Error fetching school:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

/**
 * PUT /api/schools/[id]
 * Update school details (SUPER_ADMIN only)
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await request.json()
        const { name, code, address, phone, email, school_level, is_active, max_students, max_teachers, normalize_usernames } = body

        // Fetch old school code to see if it changed
        const { data: oldSchool } = await supabase
            .from('schools')
            .select('code')
            .eq('id', id)
            .single()
            
        const codeChanged = code !== undefined && oldSchool && oldSchool.code !== code
        const oldCode = oldSchool?.code

        const updateData: Record<string, unknown> = {}
        if (name !== undefined) updateData.name = name
        if (code !== undefined) updateData.code = code
        if (address !== undefined) updateData.address = address
        if (phone !== undefined) updateData.phone = phone
        if (email !== undefined) updateData.email = email
        if (school_level !== undefined) updateData.school_level = school_level
        if (is_active !== undefined) updateData.is_active = is_active
        if (max_students !== undefined) updateData.max_students = max_students
        if (max_teachers !== undefined) updateData.max_teachers = max_teachers

        const { data, error } = await supabase
            .from('schools')
            .update(updateData)
            .eq('id', id)
            .select()
            .single()

        if (error) {
            // Handle duplicate key constraint (e.g. code already used by another school)
            if (error.code === '23505') {
                const field = error.details?.includes('(code)') ? 'Kode sekolah' : 'Data'
                return NextResponse.json({ error: `${field} sudah digunakan oleh sekolah lain` }, { status: 409 })
            }
            throw error
        }

        let updatedUsernamesCount = 0
        const shouldNormalize = (codeChanged && oldCode) || normalize_usernames
        if (shouldNormalize && oldCode) {
            // Fetch ALL users for this school (paginated to bypass Supabase 1000-row limit)
            let allUsers: { id: string; username: string }[] = []
            let page = 0
            const PAGE_SIZE = 1000
            let hasMore = true

            while (hasMore) {
                const { data: batch } = await supabase
                    .from('users')
                    .select('id, username')
                    .eq('school_id', id)
                    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

                const rows = batch || []
                allUsers = allUsers.concat(rows)
                hasMore = rows.length === PAGE_SIZE
                page++
                if (page >= 10) break // safety: max 10k users
            }

            for (const u of allUsers) {
                const username = u.username
                const lowerUsername = username.toLowerCase()
                const lowerOldCode = oldCode.toLowerCase()
                const lowerNewCode = code.toLowerCase()

                let newUsername = username

                // Check for .wali suffix first
                const isWali = lowerUsername.endsWith('.wali')
                // Strip .wali for processing
                const baseWithoutWali = isWali ? username.slice(0, -5) : username // -5 = '.wali'
                const lowerBaseWithoutWali = baseWithoutWali.toLowerCase()

                // Try to find and strip ALL school code suffixes (case-insensitive, iterative)
                // This handles double suffixes like 110401.PIIS.piis → 110401
                let coreUsername = baseWithoutWali
                let lowerCore = coreUsername.toLowerCase()
                let stripped = true
                while (stripped) {
                    stripped = false
                    if (lowerCore.endsWith(`.${lowerOldCode}`)) {
                        coreUsername = coreUsername.slice(0, -(lowerOldCode.length + 1))
                        lowerCore = coreUsername.toLowerCase()
                        stripped = true
                    } else if (lowerCore.endsWith(`.${lowerNewCode}`)) {
                        coreUsername = coreUsername.slice(0, -(lowerNewCode.length + 1))
                        lowerCore = coreUsername.toLowerCase()
                        stripped = true
                    }
                }

                // Rebuild username with new code
                if (isWali) {
                    newUsername = `${coreUsername}.${code}.wali`
                } else {
                    newUsername = `${coreUsername}.${code}`
                }

                if (newUsername !== username) {
                    await supabase.from('users').update({ username: newUsername }).eq('id', u.id)
                    updatedUsernamesCount++
                }
            }
        }

        return NextResponse.json({ ...data, updated_usernames: updatedUsernamesCount })
    } catch (error) {
        console.error('Error updating school:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

/**
 * DELETE /api/schools/[id]
 * Delete a school and ALL its related data (SUPER_ADMIN only)
 * Requires { confirm_name: "Exact School Name" } in body for safety
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await request.json()
        const { confirm_name } = body

        if (!confirm_name) {
            return NextResponse.json({ error: 'Confirmation name is required' }, { status: 400 })
        }

        // 1. Verify exact school name
        const { data: school, error: fetchError } = await supabase
            .from('schools')
            .select('name')
            .eq('id', id)
            .single()

        if (fetchError || !school) {
            return NextResponse.json({ error: 'School not found' }, { status: 404 })
        }

        if (school.name !== confirm_name) {
            return NextResponse.json({ error: 'School name does not match' }, { status: 400 })
        }

        // 2. Perform Cascading Deletes
        // Delete academic years (cascades to classes, teaching_assignments, assignments, exams, submissions, etc.)
        await supabase.from('academic_years').delete().eq('school_id', id)
        
        // Delete other root tables with school_id FK
        await supabase.from('subjects').delete().eq('school_id', id)
        await supabase.from('announcements').delete().eq('school_id', id)
        await supabase.from('question_passages').delete().eq('school_id', id)

        // Delete students and teachers explicitly
        await supabase.from('students').delete().eq('school_id', id)
        await supabase.from('teachers').delete().eq('school_id', id)

        // Delete ALL users belonging to this school (solves users_school_id_fkey constraint)
        // This includes ADMINs, GURUs, and SISWAs
        await supabase.from('users').delete().eq('school_id', id)

        // 3. Delete the school itself
        const { error: deleteError } = await supabase
            .from('schools')
            .delete()
            .eq('id', id)

        if (deleteError) throw deleteError

        return NextResponse.json({ success: true, deleted: school.name })
    } catch (error) {
        console.error('Error deleting school:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
