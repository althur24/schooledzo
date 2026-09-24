import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { putR2Object, publicR2Url, deleteR2Object, safeFileExt, R2_PUBLIC_BASE_URL } from '@/lib/r2'

/**
 * POST /api/schools/[id]/logo
 * Upload school logo (SUPER_ADMIN only) — file kecil (maks 2MB) tetap transit
 * server, disimpan ke Cloudflare R2. Accepts multipart/form-data with 'logo'
 * file field.
 *
 * Key SELALU unik per upload (bukan overwrite): custom domain R2 di-cache
 * Cloudflare per ekstensi file — URL sama akan menyajikan logo LAMA sampai
 * edge TTL habis. URL baru = cache key baru = logo langsung terlihat.
 * Object lama dihapus best-effort setelah row ter-update.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: schoolId } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const formData = await request.formData()
        const file = formData.get('logo') as File | null

        if (!file) {
            return NextResponse.json({ error: 'File logo harus dikirim' }, { status: 400 })
        }

        // Validate file type
        const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
        if (!allowedTypes.includes(file.type)) {
            return NextResponse.json({ error: 'Format yang didukung: PNG, JPG, WebP, SVG' }, { status: 400 })
        }

        // Max 2MB
        if (file.size > 2 * 1024 * 1024) {
            return NextResponse.json({ error: 'Ukuran file maksimal 2MB' }, { status: 400 })
        }

        const ext = safeFileExt(file.name, 'png')
        const storagePath = `logos/${schoolId}/${Date.now()}-${Math.random().toString(36).substring(2, 10)}.${ext}`

        // Ambil logo lama SEBELUM update row (untuk cleanup object setelahnya)
        const { data: schoolRow } = await supabase
            .from('schools')
            .select('logo_url')
            .eq('id', schoolId)
            .single()
        const oldLogoUrl = schoolRow?.logo_url || null

        // Upload to R2
        const buffer = Buffer.from(await file.arrayBuffer())
        try {
            await putR2Object(storagePath, buffer, file.type)
        } catch (uploadError) {
            console.error('Error uploading logo to R2:', uploadError)
            return NextResponse.json({ error: 'Gagal upload logo' }, { status: 500 })
        }

        const logo_url = publicR2Url(storagePath)

        // Update school record
        const { error: updateError } = await supabase
            .from('schools')
            .update({ logo_url })
            .eq('id', schoolId)

        if (updateError) throw updateError

        // Best-effort: hapus object logo lama di R2 (URL Supabase lama dibiarkan —
        // bucket uploads masih dipakai file lama lain). Gagal hapus ≠ gagal upload.
        if (oldLogoUrl && oldLogoUrl.startsWith(`${R2_PUBLIC_BASE_URL}/`)) {
            const oldKey = decodeURIComponent(oldLogoUrl.substring(R2_PUBLIC_BASE_URL.length + 1))
            if (oldKey) {
                deleteR2Object(oldKey).catch(err => {
                    console.error('Gagal hapus logo R2 lama:', err)
                })
            }
        }

        return NextResponse.json({ logo_url })
    } catch (error) {
        console.error('Error uploading logo:', error)
        return NextResponse.json({ error: 'Gagal upload logo' }, { status: 500 })
    }
}
