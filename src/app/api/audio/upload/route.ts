import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { presignR2PutUrl, publicR2Url, safeFileExt } from '@/lib/r2'

// Presign upload audio listening ke Cloudflare R2 (pola /api/materials/upload):
// client PUT langsung ke R2 — file 25MB tidak transit server. Validasi ukuran
// tetap di client (AudioUploadField + halaman passage). File lama tetap
// disajikan dari Supabase Storage (URL tersimpan penuh di DB).

const AUDIO_MIME_TYPES = [
    'audio/mpeg',    // .mp3
    'audio/mp4',     // .m4a
    'audio/wav',     // .wav
    'audio/ogg',     // .ogg
    'audio/webm',    // .webm
    'audio/aac',     // .aac
    'audio/x-m4a',   // .m4a (alternative)
]

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

        // Paritas dengan route lama: tipe yang tak dikenal browser ditolak
        if (!contentType || !AUDIO_MIME_TYPES.includes(contentType)) {
            return NextResponse.json({ error: `Tipe file tidak didukung: ${contentType || '(kosong)'}. Gunakan MP3, M4A, WAV, OGG, atau AAC.` }, { status: 400 })
        }

        const fileExt = safeFileExt(filename, 'mp3')
        const uniqueId = Math.random().toString(36).substring(2, 15)
        const timestamp = Date.now()
        const schoolPrefix = schoolId || 'global'
        const storagePath = `${schoolPrefix}/audio/${timestamp}-${uniqueId}.${fileExt}`

        const signedUrl = await presignR2PutUrl(storagePath, contentType)

        return NextResponse.json({
            url: publicR2Url(storagePath),
            path: storagePath,
            signedUrl
        })

    } catch (error: unknown) {
        console.error('Audio Upload Presign Error:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
