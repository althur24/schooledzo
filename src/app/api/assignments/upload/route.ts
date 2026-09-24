import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { presignR2PutUrl, publicR2Url, safeFileExt } from '@/lib/r2'

// Presign upload lampiran instruksi tugas (GURU saja) ke Cloudflare R2 (pola
// /api/materials/upload): client PUT langsung ke R2 dengan progress — file
// tidak transit server. Validasi ukuran 10MB tetap di client (FileUpload).
// Upload baru ke R2, file lama tetap disajikan dari Supabase Storage.

// Strict tanpa fallback anon (selaras src/lib/supabase.ts): fail-fast bila env hilang.
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY tidak ditemukan — upload butuh service key, jangan fallback ke anon.')
}
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
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
            return NextResponse.json({ error: 'File required' }, { status: 400 })
        }

        // Paritas dengan route lama: tipe yang tak dikenal browser ditolak
        if (!contentType || !ALLOWED_MIME_TYPES.includes(contentType)) {
            return NextResponse.json({ error: `Tipe file tidak didukung: ${contentType || '(kosong)'}. Gunakan PDF, Gambar, atau Dokumen Office.` }, { status: 400 })
        }

        // Generate distinctive path with school and teacher isolation
        const fileExt = safeFileExt(filename, 'pdf')
        const uniqueId = Math.random().toString(36).substring(2, 15)
        const timestamp = Date.now()
        const schoolPrefix = schoolId || 'global'

        const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        // Fail-closed (pola H2): GURU tanpa row teachers tidak boleh upload
        if (!teacher) {
            return NextResponse.json({ error: 'Data guru tidak ditemukan' }, { status: 403 })
        }

        // Path {school}/tugas-instruksi/{teacher}/ — sama seperti era Supabase
        // Storage, mudah diaudit/dibersihkan.
        const storagePath = `${schoolPrefix}/tugas-instruksi/${teacher.id}/${timestamp}-${uniqueId}.${fileExt}`

        const signedUrl = await presignR2PutUrl(storagePath, contentType)

        return NextResponse.json({
            url: publicR2Url(storagePath),
            path: storagePath,
            filename: storagePath,
            signedUrl
        })

    } catch (error: unknown) {
        console.error('Assignment Attachment Upload Presign Error:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
