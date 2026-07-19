import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getPendingEnrollmentInfo, notifyAllTeachers } from '@/lib/academicYear'

// GET all academic years
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN' && user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let query = supabase
            .from('academic_years')
            .select('*')
            .order('created_at', { ascending: false })

        if (schoolId) query = query.eq('school_id', schoolId)

        const { data, error } = await query
        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching academic years:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST new academic year
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { name, start_date, end_date, status, is_active } = await request.json()

        if (!name) {
            return NextResponse.json({ error: 'Nama tahun ajaran harus diisi' }, { status: 400 })
        }

        const finalStatus = status || (is_active ? 'ACTIVE' : 'PLANNED')
        const finalIsActive = is_active || status === 'ACTIVE'

        // If setting as active, deactivate others in the SAME school
        let warning: { pendingCount: number } | null = null
        let deactivatedNames: string[] = []
        if (finalIsActive) {
            // Count students still pending kenaikan kelas in the year being
            // replaced. Warning only — activation is NOT blocked.
            const pending = await getPendingEnrollmentInfo(schoolId)
            if (pending.pendingCount > 0) {
                warning = { pendingCount: pending.pendingCount }
            }

            let deactivateQuery = supabase
                .from('academic_years')
                .update({ is_active: false, status: 'COMPLETED' })
                .eq('is_active', true)

            if (schoolId) deactivateQuery = deactivateQuery.eq('school_id', schoolId)

            const { data: deactivated } = await deactivateQuery.select('name')
            deactivatedNames = (deactivated || []).map((y: { name: string }) => y.name)
        }

        const { data, error } = await supabase
            .from('academic_years')
            .insert({
                name,
                start_date: start_date || null,
                end_date: end_date || null,
                status: finalStatus,
                is_active: finalIsActive,
                school_id: schoolId
            })
            .select()
            .single()

        if (error) throw error

        // Notify all teachers when the new year is activated
        if (finalIsActive) {
            const completedNote = deactivatedNames.length > 0
                ? ` Tahun ajaran ${deactivatedNames.join(', ')} telah diselesaikan.`
                : ''
            await notifyAllTeachers(schoolId, {
                type: 'TAHUN_AJARAN',
                title: '📅 Tahun Ajaran Baru Aktif',
                message: `Tahun ajaran ${data.name} sekarang aktif.${completedNote}`,
                link: '/dashboard/guru'
            })
        }

        return NextResponse.json(warning ? { ...data, warning } : data)
    } catch (error) {
        console.error('Error creating academic year:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
