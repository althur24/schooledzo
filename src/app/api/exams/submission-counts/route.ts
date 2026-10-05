import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * Hitungan pengumpulan SEMUA ulangan se-sekolah (tahun ajaran aktif) dalam
 * SATU request — pengganti pola N+1 halaman admin yang mem-fetch
 * /api/exam-submissions?exam_id=... per ujian (±540 request/load di PIIS,
 * 5 Okt 2026) hanya untuk 2 angka per card.
 *
 * Sumber angka: RPC fn_exam_submission_counts (migrasi 20261005070300) —
 * GROUP BY di DB, hasil ±ratusan baris kecil berapa pun ukuran tabel.
 * Kontrak angka identik dengan definisi lama:
 *   total     = semua baris submission exam itu
 *   submitted = baris dengan is_submitted = true
 *
 * Cache in-memory per sekolah TTL 30 dtk (paritas grading-overview): satu
 * admin = satu query DB per ~30 detik WALAUPUN beberapa orang membuka
 * halaman bersamaan. Trade-off yang diterima eksplisit:
 *   1. Angka badge bisa basi maks 30 dtk (sama dengan pola grading-overview
 *      yang dipakai badge sidebar guru).
 *   2. Jalur ini TIDAK menjalankan lazy-sweep auto-close seperti jalur lama
 *      (GET per-exam). Fungsi sweep tetap berjalan dari: scheduler in-process
 *      (tiap 60 dtk), monitor, dan detail ujian — penutupan submission
 *      kedaluwarsa hanya bergeser maksimal ±60 dtk, angka akan menyusul
 *      saat cache expire.
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

        const { data, error } = await supabase.rpc('fn_exam_submission_counts', {
            p_school_id: schoolId,
            p_academic_year_id: activeYearId,
        })
        if (error) throw error

        // { [exam_id]: { total, submitted } } — lookup O(1) di halaman
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
        console.error('Error fetching exam submission counts:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
