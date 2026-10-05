import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * Hitungan pengumpulan SEMUA UTS/UAS se-sekolah (tahun ajaran aktif) dalam
 * SATU request — pengganti pola N+1 halaman admin yang mem-fetch
 * /api/official-exam-submissions?exam_id=... per ujian. Paritas
 * /api/exams/submission-counts (lihat header di sana untuk kontrak angka,
 * cache, dan trade-off sweep).
 */
const CACHE_TTL_MS = 30_000
const countsCache = new Map<string, { at: number; body: unknown }>()

export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        if (!schoolId) {
            return NextResponse.json({})
        }

        const cached = countsCache.get(schoolId)
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
            return NextResponse.json(cached.body)
        }

        const { data: activeYears } = await supabase
            .from('academic_years')
            .select('id')
            .eq('is_active', true)
            .eq('school_id', schoolId)
            .order('created_at', { ascending: false })
            .limit(1)
        const activeYearId = activeYears?.[0]?.id
        if (!activeYearId) {
            return NextResponse.json({})
        }

        const { data, error } = await supabase.rpc('fn_official_exam_submission_counts', {
            p_school_id: schoolId,
            p_academic_year_id: activeYearId,
        })
        if (error) throw error

        const body: Record<string, { total: number; submitted: number }> = {}
        for (const row of data || []) {
            body[row.exam_id] = {
                total: Number(row.total),
                submitted: Number(row.submitted),
            }
        }

        countsCache.set(schoolId, { at: Date.now(), body })
        return NextResponse.json(body)
    } catch (error) {
        console.error('Error fetching official exam submission counts:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
