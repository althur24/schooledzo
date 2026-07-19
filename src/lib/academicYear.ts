import { supabaseAdmin } from './supabase'
import { NextResponse } from 'next/server'

// Academic year helpers shared by API routes

export interface ActiveAcademicYear {
    id: string
    name: string
}

/**
 * Get the currently active academic year for a school.
 * Returns null when no year is active (e.g. right after a year is completed).
 */
export async function getActiveAcademicYear(schoolId: string | null): Promise<ActiveAcademicYear | null> {
    let query = supabaseAdmin
        .from('academic_years')
        .select('id, name')
        .eq('is_active', true)
    if (schoolId) query = query.eq('school_id', schoolId)
    const { data } = await query.maybeSingle()
    return data || null
}

/**
 * Count students whose enrollment is still ACTIVE (not yet processed for
 * kenaikan kelas) in the year being replaced when a new year is activated:
 * the currently active year, or the most recently COMPLETED year.
 */
export async function getPendingEnrollmentInfo(
    schoolId: string | null,
    excludeYearId?: string
): Promise<{ pendingCount: number; sourceYearName: string | null }> {
    let sourceYear: ActiveAcademicYear | null = null

    // Year being replaced: the current active year (if any)
    let activeQuery = supabaseAdmin
        .from('academic_years')
        .select('id, name')
        .eq('is_active', true)
    if (schoolId) activeQuery = activeQuery.eq('school_id', schoolId)
    if (excludeYearId) activeQuery = activeQuery.neq('id', excludeYearId)
    const { data: currentActive } = await activeQuery.maybeSingle()
    sourceYear = currentActive

    if (!sourceYear) {
        // Fallback: the most recently completed year
        let completedQuery = supabaseAdmin
            .from('academic_years')
            .select('id, name')
            .eq('status', 'COMPLETED')
            .order('created_at', { ascending: false })
            .limit(1)
        if (schoolId) completedQuery = completedQuery.eq('school_id', schoolId)
        if (excludeYearId) completedQuery = completedQuery.neq('id', excludeYearId)
        const { data: lastCompleted } = await completedQuery.maybeSingle()
        sourceYear = lastCompleted
    }

    if (!sourceYear) return { pendingCount: 0, sourceYearName: null }

    const { count } = await supabaseAdmin
        .from('student_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('academic_year_id', sourceYear.id)
        .eq('status', 'ACTIVE')

    return { pendingCount: count || 0, sourceYearName: sourceYear.name }
}

/**
 * Send a notification to all teachers (role GURU) of a school.
 * Best-effort: errors are logged, not thrown.
 */
export async function notifyAllTeachers(    schoolId: string | null,
    notification: { type: string; title: string; message?: string; link?: string }
): Promise<void> {
    try {
        let query = supabaseAdmin
            .from('users')
            .select('id')
            .eq('role', 'GURU')
        if (schoolId) query = query.eq('school_id', schoolId)
        const { data: teachers, error } = await query

        if (error) throw error
        if (!teachers || teachers.length === 0) return

        const rows = teachers.map(t => ({
            user_id: t.id,
            type: notification.type,
            title: notification.title,
            message: notification.message || null,
            link: notification.link || null
        }))

        const { error: insertError } = await supabaseAdmin.from('notifications').insert(rows)
        if (insertError) throw insertError
    } catch (error) {
        console.error('Error notifying teachers:', error)
    }
}

/**
 * Get the status of an academic year by its id. Returns null if not found.
 */
export async function getYearStatusById(yearId: string): Promise<string | null> {
    const { data } = await supabaseAdmin
        .from('academic_years')
        .select('status')
        .eq('id', yearId)
        .maybeSingle()
    return data?.status || null
}

/**
 * Get the status of the academic year that owns a teaching assignment.
 */
export async function getYearStatusByTA(teachingAssignmentId: string): Promise<string | null> {
    const { data } = await supabaseAdmin
        .from('teaching_assignments')
        .select('academic_year_id')
        .eq('id', teachingAssignmentId)
        .maybeSingle()
    if (!data?.academic_year_id) return null
    return getYearStatusById(data.academic_year_id)
}

/**
 * Standard 403 response for write attempts on a COMPLETED (archived) year.
 * Archived content stays readable but must not be modified.
 */
export function archivedYearResponse(): NextResponse {
    return NextResponse.json(
        { error: 'Tahun ajaran ini sudah Selesai — konten arsip tidak dapat diubah.' },
        { status: 403 }
    )
}
