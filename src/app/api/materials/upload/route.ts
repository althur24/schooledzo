import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// M2: Service Role Key required for Storage signed URL generation (Storage API requires admin privileges)
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { filename, contentType } = await request.json()

        if (!filename) {
            return NextResponse.json({ error: 'Filename required' }, { status: 400 })
        }

        // Generate distinctive path with school isolation
        const fileExt = filename.split('.').pop() || 'pdf'
        const uniqueId = Math.random().toString(36).substring(2, 15)
        const timestamp = Date.now()
        const schoolPrefix = schoolId || 'global'
        const storagePath = `${schoolPrefix}/${timestamp}-${uniqueId}.${fileExt}`

        console.log(`Generating signed upload URL for: ${storagePath}`)

        // Create Signed Upload URL
        const { data, error } = await supabase.storage
            .from('materials')
            .createSignedUploadUrl(storagePath)

        if (error) {
            console.error('Signed URL Error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // Return path and token/signedUrl
        // data contains { signedUrl, token, path }
        return NextResponse.json({
            path: data.path,
            token: data.token,
            signedUrl: data.signedUrl
        })

    } catch (error: any) {
        console.error('Server Error:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
