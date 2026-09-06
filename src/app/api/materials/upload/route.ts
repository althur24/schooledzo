import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { presignR2PutUrl, publicR2Url } from '@/lib/r2'

// Upload materi via presigned PUT ke Cloudflare R2 (src/lib/r2.ts fail-fast
// saat env R2 hilang). Cek role & school context tidak berubah dari versi
// Supabase Storage sebelumnya — file lama tetap disajikan dari Supabase.

export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (!['GURU', 'ADMIN'].includes(user.role)) {
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
        const storagePath = `materials/${schoolPrefix}/${timestamp}-${uniqueId}.${fileExt}`

        const signedUrl = await presignR2PutUrl(storagePath, contentType || 'application/octet-stream')

        return NextResponse.json({
            path: storagePath,
            signedUrl,
            publicUrl: publicR2Url(storagePath)
        })

    } catch (error: unknown) {
        console.error('Server Error:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
