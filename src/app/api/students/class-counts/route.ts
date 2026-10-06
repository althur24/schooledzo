import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch } from '@/lib/tenantGuard'

/**
 * Jumlah siswa AKTIF per kelas dalam SATU request — pengganti fetch roster
 * penuh (1.000+ siswa full-embed user/kelas) yang sebelumnya hanya dipakai
 * untuk counts[classId]++ di halaman guru (ulangan/kuis/tugas).
 *
 * Sumber angka: RPC fn_class_student_counts (migrasi 20261005070300) —
 * GROUP BY class_id atas student_enrollments ber-status ACTIVE pada tahun
 * ajaran yang diminta. Kontrak identik dengan hitungan lama di halaman
 * (status=ACTIVE per enrollment_year_id).
 *
 * Guard: GURU/ADMIN (dipakai halaman guru), tahun ajaran wajib milik
 * sekolah caller (mirror tenant-guard cabang enrollment /api/students).
 */
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role === 'SISWA') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const enrollmentYearId = request.nextUrl.searchParams.get('enrollment_year_id')
        if (!enrollmentYearId) {
            return NextResponse.json({ error: 'enrollment_year_id wajib diisi' }, { status: 400 })
        }

        // Tenant guard: tahun ajaran harus milik sekolah caller (param client
        // dipercaya hanya setelah diverifikasi — paritas /api/students).
        const { data: enrollYear } = await supabase
            .from('academic_years')
            .select('school_id')
            .eq('id', enrollmentYearId)
            .single()
        if (tenantMismatch((enrollYear as { school_id?: string } | null)?.school_id, schoolId)) {
            return NextResponse.json({})
        }

        const { data, error } = await supabase.rpc('fn_class_student_counts', {
            p_academic_year_id: enrollmentYearId,
        })
        if (error) throw error

        // { [class_id]: jumlah siswa aktif }
        const body: Record<string, number> = {}
        for (const row of data || []) {
            body[row.class_id] = Number(row.student_count)
        }
        return NextResponse.json(body)
    } catch (error) {
        console.error('Error fetching class student counts:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
