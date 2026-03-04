import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET single schedule with entries
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const { data, error } = await supabase
            .from('schedules')
            .select(`
                *,
                class:classes(id, name, grade_level, school_level),
                academic_year:academic_years(id, name, is_active),
                created_by_user:users!created_by(full_name),
                entries:schedule_entries(
                    *,
                    subject:subjects(id, name),
                    teacher:teachers(id, user:users(full_name))
                )
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching schedule:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update schedule (replace entries)
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

        const { effective_from, notes, entries, is_active } = await request.json()

        // Update schedule header
        const updateData: any = { updated_at: new Date().toISOString() }
        if (effective_from !== undefined) updateData.effective_from = effective_from
        if (notes !== undefined) updateData.notes = notes
        if (is_active !== undefined) updateData.is_active = is_active

        const { error: updateError } = await supabase
            .from('schedules')
            .update(updateData)
            .eq('id', id)

        if (updateError) throw updateError

        // Replace entries if provided
        if (entries && Array.isArray(entries)) {
            // Delete old entries
            await supabase.from('schedule_entries').delete().eq('schedule_id', id)

            // Insert new entries
            if (entries.length > 0) {
                const entriesToInsert = entries.map((e: any) => ({
                    schedule_id: id,
                    day_of_week: e.day_of_week,
                    period: e.period,
                    time_start: e.time_start,
                    time_end: e.time_end,
                    subject_id: e.subject_id || null,
                    teacher_id: e.teacher_id || null,
                    room: e.room || null
                }))

                const { error: entriesError } = await supabase
                    .from('schedule_entries')
                    .insert(entriesToInsert)

                if (entriesError) throw entriesError
            }
        }

        // Fetch updated schedule
        const { data } = await supabase
            .from('schedules')
            .select(`
                *,
                class:classes(id, name),
                academic_year:academic_years(id, name),
                entries:schedule_entries(
                    *,
                    subject:subjects(id, name),
                    teacher:teachers(id, user:users(full_name))
                )
            `)
            .eq('id', id)
            .single()

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating schedule:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE schedule
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

        const { error } = await supabase.from('schedules').delete().eq('id', id)
        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting schedule:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
