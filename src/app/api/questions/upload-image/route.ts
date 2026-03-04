import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const formData = await request.formData()
        const file = formData.get('file') as File

        if (!file) {
            return NextResponse.json({ error: 'File diperlukan' }, { status: 400 })
        }

        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        if (!allowedTypes.includes(file.type)) {
            return NextResponse.json({ error: 'Format file tidak didukung. Gunakan JPG, PNG, GIF, atau WebP.' }, { status: 400 })
        }

        // Validate file size (max 5MB)
        const maxSize = 5 * 1024 * 1024
        if (file.size > maxSize) {
            return NextResponse.json({ error: 'Ukuran file maksimal 5MB' }, { status: 400 })
        }

        // Generate unique filename with school isolation
        const timestamp = Date.now()
        const ext = file.name.split('.').pop()
        const schoolPrefix = schoolId || 'global'
        const filename = `question-images/${schoolPrefix}/${timestamp}-${Math.random().toString(36).substring(7)}.${ext}`

        // Convert to buffer
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        // Upload to Supabase Storage
        const { data, error } = await supabase.storage
            .from('uploads')
            .upload(filename, buffer, {
                contentType: file.type,
                upsert: false
            })

        if (error) {
            console.error('Upload error:', error)
            return NextResponse.json({ error: 'Gagal upload file' }, { status: 500 })
        }

        // Get public URL
        const { data: urlData } = supabase.storage
            .from('uploads')
            .getPublicUrl(filename)

        return NextResponse.json({
            url: urlData.publicUrl,
            filename: filename
        })
    } catch (error) {
        console.error('Error uploading question image:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
