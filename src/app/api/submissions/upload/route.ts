import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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

export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'SISWA') {
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

        // Generate distinctive path with school and student isolation
        const fileExt = file.name.split('.').pop() || 'pdf'
        const uniqueId = Math.random().toString(36).substring(2, 15)
        const timestamp = Date.now()
        const schoolPrefix = schoolId || 'global'
        
        // Get student id for folder structure
        const { data: student } = await supabase
            .from('students')
            .select('id')
            .eq('user_id', user.id)
            .single()
            
        const studentFolder = student ? student.id : 'unknown'
        
        const storagePath = `${schoolPrefix}/tugas/${studentFolder}/${timestamp}-${uniqueId}.${fileExt}`

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
            console.error('Submission Upload Error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // Generate public URL for viewing
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
        console.error('Submission Upload Error:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
