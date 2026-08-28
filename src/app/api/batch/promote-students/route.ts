import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * POST /api/batch/promote-students
 * Process a full kenaikan-kelas batch in a single server-side RPC transaction.
 *
 * Replaces the previous client-side per-student loop that called
 * /api/students/:id/promote repeatedly (which could leave a half-processed
 * batch if interrupted, and had incomplete rollback).
 *
 * Body:
 *   targets:     [{ student_id, to_class_id, from_academic_year_id?, enrollment_status?, note? }]
 *   graduations: [{ student_id, note? }]
 *   notes?:      string  (global note fallback)
 *
 * Each student is promoted/graduated inside its own sub-transaction by the RPC,
 * so no student is ever left half-processed, and a single student's failure
 * does not roll back the others (it is reported in `errors`).
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // Only admins can run kenaikan kelas
        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
        }

        const body = await request.json()
        const targets: any[] = Array.isArray(body?.targets) ? body.targets : []
        const graduations: any[] = Array.isArray(body?.graduations) ? body.graduations : []
        const notes: string | null = typeof body?.notes === 'string' ? body.notes : null

        // Must have something to do
        if (targets.length === 0 && graduations.length === 0) {
            return NextResponse.json({ error: 'Tidak ada siswa untuk diproses' }, { status: 400 })
        }

        // Validate each target has the required fields
        for (const t of targets) {
            if (!t.student_id || !t.to_class_id) {
                return NextResponse.json({
                    error: 'Setiap target wajib memiliki student_id dan to_class_id'
                }, { status: 400 })
            }
        }
        for (const g of graduations) {
            if (!g.student_id) {
                return NextResponse.json({ error: 'Setiap graduation wajib memiliki student_id' }, { status: 400 })
            }
        }

        // ---- Multi-tenant scoping ----
        // (SUPER_ADMIN bypasses; ADMIN may only touch their own school's data.)
        // classes has no direct school_id -> scope via the academic_years.school_id chain.
        const classIds = [...new Set(targets.map(t => t.to_class_id).filter(Boolean))]
        const studentIds = [...new Set([
            ...targets.map(t => t.student_id),
            ...graduations.map(g => g.student_id)
        ].filter(Boolean))]

        if (schoolId) {
            // Students must belong to this school
            if (studentIds.length > 0) {
                const { count, error } = await supabase
                    .from('students')
                    .select('id', { count: 'exact', head: true })
                    .eq('school_id', schoolId)
                    .in('id', studentIds)
                if (error || count !== studentIds.length) {
                    return NextResponse.json({
                        error: 'Beberapa siswa bukan milik sekolah Anda'
                    }, { status: 403 })
                }
            }
            // Classes must belong to one of this school's academic years
            if (classIds.length > 0) {
                const { data: schoolYears, error: yearError } = await supabase
                    .from('academic_years')
                    .select('id')
                    .eq('school_id', schoolId)
                if (yearError) {
                    return NextResponse.json({ error: 'Gagal memvalidasi tahun ajaran' }, { status: 500 })
                }
                const yearIds = (schoolYears || []).map(y => y.id)
                const { count: classCount, error: classError } = await supabase
                    .from('classes')
                    .select('id', { count: 'exact', head: true })
                    .in('id', classIds)
                    .in('academic_year_id', yearIds.length ? yearIds : ['00000000-0000-0000-0000-000000000000'])
                if (classError || classCount !== classIds.length) {
                    return NextResponse.json({
                        error: 'Beberapa kelas tujuan bukan milik sekolah Anda'
                    }, { status: 403 })
                }
            }
        }

        // ---- Run the transactional RPC ----
        const { data, error } = await supabase.rpc('promote_students_batch', {
            p_targets: targets,
            p_graduations: graduations,
            p_notes: notes
        })

        if (error) {
            console.error('promote_students_batch RPC error:', error)
            return NextResponse.json({
                error: 'Gagal memproses kenaikan kelas',
                details: error.message
            }, { status: 500 })
        }

        // `data` is the JSONB object returned by the RPC
        return NextResponse.json({
            success: true,
            promoted: data?.promoted ?? 0,
            graduated: data?.graduated ?? 0,
            failed: data?.failed ?? 0,
            errors: data?.errors ?? [],
            already_done: data?.already_done ?? 0,
            already_done_students: data?.already_done_students ?? []
        })
    } catch (error: any) {
        console.error('Error in batch promote-students:', error)
        return NextResponse.json({
            error: 'Internal server error',
            details: error.message
        }, { status: 500 })
    }
}
