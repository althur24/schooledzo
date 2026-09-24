import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound } from '@/lib/tenantGuard'
import { archivedYearResponse } from '@/lib/academicYear'
import { R2_PUBLIC_BASE_URL, deleteR2Object } from '@/lib/r2'

// Best-effort: hapus file PDF materi dari storage. Upload baru ada di R2,
// file lama di Supabase Storage bucket materials. Gagal hapus file tidak
// membatalkan penghapusan materi (object yatim lebih aman daripada row hidup
// tanpa file).
//
// Guard file-bersama: POST /api/materials menerima content_url arbitrary —
// dua row bisa sah menunjuk URL yang sama (duplikat manual). File hanya
// dihapus bila TIDAK ada row lain yang mereferensikannya.
async function cleanupMaterialFile(contentUrl: string | null | undefined) {
    if (!contentUrl) return
    try {
        const { count } = await supabase
            .from('materials')
            .select('id', { count: 'exact', head: true })
            .eq('content_url', contentUrl)
        if ((count || 0) > 0) return // masih dipakai row lain — jangan hapus file

        if (contentUrl.startsWith(`${R2_PUBLIC_BASE_URL}/`)) {
            const key = decodeURIComponent(contentUrl.substring(R2_PUBLIC_BASE_URL.length + 1))
            if (key) await deleteR2Object(key)
            return
        }
        const marker = '/storage/v1/object/public/materials/'
        const idx = contentUrl.indexOf(marker)
        if (idx === -1) return
        const storagePath = decodeURIComponent(contentUrl.substring(idx + marker.length))
        if (storagePath) {
            await supabase.storage.from('materials').remove([storagePath])
        }
    } catch (err) {
        console.error('Error cleaning up material file:', err)
    }
}

// DELETE material
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (!['GURU', 'ADMIN'].includes(user.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Ownership + archived year check in one query
        const { data: material, error: fetchError } = await supabase
            .from('materials')
            .select(`
                id,
                type,
                content_url,
                teaching_assignment:teaching_assignments(
                    teacher:teachers(user_id, school_id),
                    academic_year:academic_years(status)
                )
            `)
            .eq('id', id)
            .single()

        if (fetchError || !material) {
            // PGRST116 = no rows found; anything else is a real query failure
            if (fetchError && fetchError.code !== 'PGRST116') throw fetchError
            return NextResponse.json({ error: 'Materi tidak ditemukan' }, { status: 404 })
        }

        const ta: any = material.teaching_assignment
        const ownerUserId = Array.isArray(ta?.teacher) ? ta.teacher[0]?.user_id : ta?.teacher?.user_id

        // Guru hanya boleh menghapus materi dari penugasan miliknya sendiri
        if (user.role === 'GURU' && ownerUserId !== user.id) {
            return NextResponse.json({ error: 'Anda tidak berhak menghapus materi ini' }, { status: 403 })
        }

        // Tenant guard: materi harus milik sekolah caller (ADMIN dulu lolos tanpa cek)
        const taSchoolId = Array.isArray(ta?.teacher) ? ta.teacher[0]?.school_id : ta?.teacher?.school_id
        if (tenantMismatch(taSchoolId, schoolId)) {
            return notFound()
        }

        const yearStatus = Array.isArray(ta?.academic_year) ? ta.academic_year[0]?.status : ta?.academic_year?.status
        if (yearStatus === 'COMPLETED') return archivedYearResponse()

        const { error } = await supabase
            .from('materials')
            .delete()
            .eq('id', id)

        if (error) throw error

        // File PDF hanya di-upload untuk type PDF — cleanup setelah row hilang
        if (material.type === 'PDF') {
            await cleanupMaterialFile(material.content_url)
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting material:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
