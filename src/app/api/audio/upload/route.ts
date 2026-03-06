import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const AUDIO_MIME_TYPES = [
    'audio/mpeg',    // .mp3
    'audio/mp4',     // .m4a
    'audio/wav',     // .wav
    'audio/ogg',     // .ogg
    'audio/webm',    // .webm
    'audio/aac',     // .aac
    'audio/x-m4a',   // .m4a (alternative)
]

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB

// Ensure the materials bucket allows audio MIME types
async function ensureBucketAllowsAudio() {
    try {
        const { data: bucket } = await supabase.storage.getBucket('materials')
        if (bucket && bucket.allowed_mime_types) {
            const hasAudio = AUDIO_MIME_TYPES.every(t => bucket.allowed_mime_types!.includes(t))
            if (!hasAudio) {
                const updatedTypes = [...new Set([...bucket.allowed_mime_types, ...AUDIO_MIME_TYPES])]
                await supabase.storage.updateBucket('materials', {
                    public: true,
                    allowedMimeTypes: updatedTypes
                })
                console.log('Updated materials bucket to allow audio MIME types')
            }
        }
    } catch (err) {
        console.error('Error updating bucket MIME types:', err)
    }
}

export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const formData = await request.formData()
        const file = formData.get('file') as File | null

        if (!file) {
            return NextResponse.json({ error: 'File required' }, { status: 400 })
        }

        if (!AUDIO_MIME_TYPES.includes(file.type)) {
            return NextResponse.json({ error: `Tipe file tidak didukung: ${file.type}. Gunakan MP3, M4A, WAV, OGG, atau AAC.` }, { status: 400 })
        }

        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: 'File terlalu besar. Maksimal 25MB.' }, { status: 400 })
        }

        // Ensure bucket allows audio before uploading
        await ensureBucketAllowsAudio()

        const fileExt = file.name.split('.').pop() || 'mp3'
        const uniqueId = Math.random().toString(36).substring(2, 15)
        const timestamp = Date.now()
        const schoolPrefix = schoolId || 'global'
        const storagePath = `${schoolPrefix}/audio/${timestamp}-${uniqueId}.${fileExt}`

        // Convert File to Buffer for server-side upload
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        const { error } = await supabase.storage
            .from('materials')
            .upload(storagePath, buffer, {
                contentType: file.type,
                upsert: false
            })

        if (error) {
            console.error('Audio Upload Error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // Generate public URL for playback
        const { data: publicUrlData } = supabase.storage
            .from('materials')
            .getPublicUrl(storagePath)

        return NextResponse.json({
            url: publicUrlData.publicUrl
        })

    } catch (error: any) {
        console.error('Audio Upload Error:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
