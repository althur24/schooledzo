import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

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

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

// Upload lampiran instruksi tugas (GURU saja).
// Bucket sama dengan submission siswa ("submissions", publik) — dipisah
// path {school}/tugas-instruksi/{teacher}/ agar mudah diaudit/dibersihkan.
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

        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            return NextResponse.json({ error: `Tipe file tidak didukung: ${file.type}. Gunakan PDF, Gambar, atau Dokumen Office.` }, { status: 400 })
        }

        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: 'File terlalu besar. Maksimal 10MB.' }, { status: 400 })
        }

        // Generate distinctive path with school and teacher isolation
        const fileExt = file.name.split('.').pop() || 'pdf'
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

        const storagePath = `${schoolPrefix}/tugas-instruksi/${teacher.id}/${timestamp}-${uniqueId}.${fileExt}`

        // Convert File to Buffer for server-side upload
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        const { error } = await supabase.storage
            .from('submissions')
            .upload(storagePath, buffer, {
                contentType: file.type,
                upsert: false
            })

        if (error) {
            console.error('Assignment Attachment Upload Error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        const { data: publicUrlData } = supabase.storage
            .from('submissions')
            .getPublicUrl(storagePath)

        return NextResponse.json({
            url: publicUrlData.publicUrl,
            filename: storagePath,
            originalName: file.name,
            size: file.size,
            type: file.type
        })

    } catch (error: any) {
        console.error('Assignment Attachment Upload Error:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
