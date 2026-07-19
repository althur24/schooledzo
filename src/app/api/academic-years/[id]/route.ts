import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getPendingEnrollmentInfo, notifyAllTeachers } from '@/lib/academicYear'

// GET single academic year
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let query = supabase
            .from('academic_years')
            .select('*')
            .eq('id', id)
        if (schoolId) query = query.eq('school_id', schoolId)
        const { data, error } = await query.single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching academic year:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update academic year
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { name, start_date, end_date, status, is_active } = await request.json()

        // Sync status and is_active
        const finalStatus = status || (is_active ? 'ACTIVE' : undefined)
        const finalIsActive = is_active !== undefined ? is_active : (status === 'ACTIVE')

        // Only treat as "activation" when the year was NOT already active —
        // editing the currently active year must not re-trigger side effects
        let wasActive = false
        if (finalIsActive) {
            const { data: current } = await supabase
                .from('academic_years')
                .select('is_active')
                .eq('id', id)
                .single()
            wasActive = current?.is_active === true
        }

        // If newly set as active, deactivate others in same school first
        let warning: { pendingCount: number } | null = null
        if (finalIsActive && !wasActive) {
            // Count students still pending kenaikan kelas in the year being
            // replaced. Warning only — activation is NOT blocked.
            const pending = await getPendingEnrollmentInfo(schoolId, id)
            if (pending.pendingCount > 0) {
                warning = { pendingCount: pending.pendingCount }
            }

            let deactivateQuery = supabase
                .from('academic_years')
                .update({ is_active: false, status: 'COMPLETED' })
                .neq('id', id)
                .eq('is_active', true)
            if (schoolId) deactivateQuery = deactivateQuery.eq('school_id', schoolId)
            await deactivateQuery
        }

        // Build update object with only provided fields
        const updateData: Record<string, any> = {}
        if (name !== undefined) updateData.name = name
        if (start_date !== undefined) updateData.start_date = start_date
        if (end_date !== undefined) updateData.end_date = end_date
        if (finalStatus !== undefined) updateData.status = finalStatus
        if (finalIsActive !== undefined) updateData.is_active = finalIsActive

        let updateQuery = supabase
            .from('academic_years')
            .update(updateData)
            .eq('id', id)
        if (schoolId) updateQuery = updateQuery.eq('school_id', schoolId)
        const { data, error } = await updateQuery
            .select()
            .single()

        if (error) throw error

        // Notify all teachers when a year is newly activated via this endpoint
        if (finalIsActive && !wasActive) {
            await notifyAllTeachers(schoolId, {
                type: 'TAHUN_AJARAN',
                title: '📅 Tahun Ajaran Baru Aktif',
                message: `Tahun ajaran ${data.name} sekarang aktif.`,
                link: '/dashboard/guru'
            })
        }

        return NextResponse.json(warning ? { ...data, warning } : data)
    } catch (error) {
        console.error('Error updating academic year:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE academic year with cascade
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Verify ownership: check year belongs to school
        if (schoolId) {
            const { data: yearCheck } = await supabase
                .from('academic_years')
                .select('id')
                .eq('id', id)
                .eq('school_id', schoolId)
                .single()
            if (!yearCheck) {
                return NextResponse.json({ error: 'Tahun ajaran tidak ditemukan' }, { status: 404 })
            }
        }

        // Atomic cascade delete via RPC (migration 017):
        // all related rows are removed in a single DB transaction —
        // a failure anywhere rolls back everything, no orphan data.
        const { data: result, error } = await supabase.rpc('delete_academic_year_cascade', { p_year_id: id })

        if (error) {
            // PGRST202 = function not found → migration 017 not applied yet
            if ((error as any).code === 'PGRST202') {
                return NextResponse.json({
                    error: 'Fitur hapus tahun belum siap: jalankan migrasi 017_delete_year_rpc.sql di Supabase SQL Editor terlebih dahulu.'
                }, { status: 503 })
            }
            throw error
        }

        return NextResponse.json({ success: true, ...(result || {}) })
    } catch (error) {
        console.error('Error deleting academic year:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
