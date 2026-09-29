import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { presignR2PutUrl, publicR2Url, safeFileExt } from '@/lib/r2'

// Presign upload file jawaban tugas siswa ke Cloudflare R2 (pola
// /api/materials/upload): client PUT langsung ke R2 dengan progress — file
// tidak transit server. Validasi ukuran 10MB tetap di client (FileUpload).
// File lama tetap disajikan dari Supabase Storage (URL tersimpan penuh di DB).

// Strict tanpa fallback anon (guard di dalam createAdminClient, selaras
// src/lib/supabase.ts) + ber-hardening timeout. Route ini juga membaca tabel
// students — anon kini diblokir RLS.
const supabase = createAdminClient()

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

        if (user.role !== 'SISWA') {
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

        // Generate distinctive path with school and student isolation
        const fileExt = safeFileExt(filename, 'pdf')
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

        const signedUrl = await presignR2PutUrl(storagePath, contentType)

        return NextResponse.json({
            url: publicR2Url(storagePath),
            path: storagePath,
            filename: storagePath,
            signedUrl
        })

    } catch (error: unknown) {
        console.error('Submission Upload Presign Error:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
