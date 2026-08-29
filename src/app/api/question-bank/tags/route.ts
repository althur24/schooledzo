import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch } from '@/lib/tenantGuard'
import { fetchAllRows } from '@/lib/fetchAllRows'

// GET daftar tag unik milik guru (untuk autocomplete input tag & filter tag)
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let teacherId: string | null = null
        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()
            if (!teacher) {
                return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })
            }
            teacherId = teacher.id
        } else {
            // Admin bisa lihat tag milik guru tertentu via ?teacher_id=
            teacherId = request.nextUrl.searchParams.get('teacher_id')
        }

        // Embed !inner: filter teacher.school_id diterapkan PostgREST ke parent
        // rows — bebas batas URL utk sekolah dengan ratusan guru.
        let query = supabase.from('question_bank').select('tags, teacher:teachers!inner(school_id)')
        if (teacherId) {
            query = query.eq('teacher_id', teacherId)
            // Tenant guard: guru yang diminta harus sekolah caller (ADMIN ?teacher_id=)
            if (schoolId) {
                const { data: t } = await supabase
                    .from('teachers').select('school_id').eq('id', teacherId).single()
                if (tenantMismatch((t as any)?.school_id, schoolId)) return NextResponse.json([])
            }
        } else if (schoolId) {
            // ADMIN tanpa teacher_id: scope ke guru sekolah caller
            // (sebelumnya mengembalikan tag semua sekolah)
            query = query.eq('teacher.school_id', schoolId)
        }

        const rows = await fetchAllRows(query)

        const tagCount = new Map<string, number>()
        for (const r of rows || []) {
            for (const t of (r as { tags?: string[] | null }).tags || []) {
                const tag = String(t).trim()
                if (tag) tagCount.set(tag, (tagCount.get(tag) || 0) + 1)
            }
        }

        // Urut berdasarkan frekuensi pemakaian, lalu alfabetis
        const tags = [...tagCount.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([tag, count]) => ({ tag, count }))

        return NextResponse.json(tags)
    } catch (error) {
        console.error('Error fetching question bank tags:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
