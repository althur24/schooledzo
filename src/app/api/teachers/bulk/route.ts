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

        // Strip leading apostrophes from username/NIP — Excel users prefix ' to force
        // text format, and it would otherwise end up in the login username & password
        payload.forEach((item: any) => {
            if (item.username) item.username = String(item.username).trim().replace(/^'+/, '')
            if (item.nip) item.nip = String(item.nip).trim().replace(/^'+/, '')
        })

        const results = []

        const schoolCode = await getSchoolCode(schoolId || '')
        if (!schoolCode) {
            return NextResponse.json({ error: 'Data sekolah tidak valid' }, { status: 400 })
        }

        // BATCH OPTIMIZATION: Pre-fetch all existing usernames in ONE query
        const suffixedUsernames = payload.filter((item: any) => item.username).map((item: any) => `${String(item.username).trim()}.${schoolCode}`)
        const { data: existingUsers } = await supabase
            .from('users')
            .select('username')
            .in('username', suffixedUsernames)
        const existingUsernames = new Set(existingUsers?.map(u => u.username) || [])

        // Track usernames used within this batch (clean message instead of raw DB constraint error)
        const usedInBatch = new Set<string>()

        // PARALLEL OPTIMIZATION: Hash ALL passwords at once (~150ms total instead of N × 150ms)
        // Password optional: empty -> fall back to NIP (or username) as the initial password.
        // must_change_password=true already forces a change on first login.
        const passwordHashes = await Promise.all(
            payload.map((item: any) => {
                const fallback = (item.nip ? String(item.nip).trim() : '') || (item.username ? String(item.username).trim() : '')
                const pw = item.password ? String(item.password) : fallback
                return pw ? hashPassword(pw) : Promise.resolve('')
            })
        )

        // Process sequentially (inserts need IDs from previous steps)
        for (let i = 0; i < payload.length; i++) {
            const item = payload[i]
            const { full_name, gender, nip, username } = item

            if (!full_name) {
                results.push({ item, success: false, error: 'Nama Lengkap harus diisi' })
                continue
            }

            if (!username || !String(username).trim()) {
                results.push({ item, success: false, error: 'Username harus diisi' })
                continue
            }

            // Password optional — empty falls back to NIP/username (hashed above)

            try {
                const suffixedUsername = `${String(username).trim()}.${schoolCode}`

                // Check existing username from pre-fetched set + current batch
                if (existingUsernames.has(suffixedUsername) || usedInBatch.has(suffixedUsername)) {
                    results.push({ item, success: false, error: `Username '${suffixedUsername}' sudah digunakan` })
                    continue
                }
                usedInBatch.add(suffixedUsername)

                // Use pre-computed hash (already done in parallel above)
                const password_hash = passwordHashes[i]

                // Create user
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

                // Create teacher record
                // Gender: accept L/Laki-laki/P/Perempuan (case-insensitive)
                const genderNorm = String(gender || '').trim().toLowerCase()
                const mappedGender = ['l', 'laki-laki'].includes(genderNorm) ? 'L'
                    : ['p', 'perempuan'].includes(genderNorm) ? 'P' : null

                const { error: teacherError } = await supabase
                    .from('teachers')
                    .insert({
                        user_id: newUser.id,
                        nip: nip || null,
                        gender: mappedGender,
                        school_id: schoolId
                    })

                if (teacherError) {
                    await supabase.from('users').delete().eq('id', newUser.id)
                    throw teacherError
                }

                results.push({ item, success: true })
            } catch (err: any) {
                console.error(`Error processing teacher ${username}:`, err)
                results.push({ item, success: false, error: err.message || 'Terjadi kesalahan sistem' })
            }
        }

        return NextResponse.json({ results })
    } catch (error) {
        console.error('Error in bulk teacher upload:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
