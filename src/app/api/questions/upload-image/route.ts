import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { presignR2PutUrl, publicR2Url, safeFileExt } from '@/lib/r2'

// Presign upload gambar soal/opsi ke Cloudflare R2 (pola /api/materials/upload):
// client PUT langsung ke R2. Validasi ukuran 5MB pindah ke client
// (uploadQuestionImage di src/lib/questionImage.ts). File lama tetap
// disajikan dari Supabase Storage (URL tersimpan penuh di DB).

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { filename, contentType } = await request.json()

        if (!filename) {
            return NextResponse.json({ error: 'File diperlukan' }, { status: 400 })
        }

        // Paritas dengan route lama: tipe yang tak dikenal browser ditolak
        if (!contentType || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
            return NextResponse.json({ error: 'Format file tidak didukung. Gunakan JPG, PNG, GIF, atau WebP.' }, { status: 400 })
        }

        // Generate unique key with school isolation
        const timestamp = Date.now()
        const ext = safeFileExt(filename, 'jpg')
        const schoolPrefix = schoolId || 'global'
        const key = `question-images/${schoolPrefix}/${timestamp}-${Math.random().toString(36).substring(7)}.${ext}`

        const signedUrl = await presignR2PutUrl(key, contentType)

        return NextResponse.json({
            url: publicR2Url(key),
            path: key,
            filename: key,
            signedUrl
        })
    } catch (error) {
        console.error('Error presigning question image upload:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
