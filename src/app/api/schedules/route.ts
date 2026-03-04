import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET schedules (filter by class_id, academic_year_id)
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const classId = request.nextUrl.searchParams.get('class_id')
        const academicYearId = request.nextUrl.searchParams.get('academic_year_id')
        const currentOnly = request.nextUrl.searchParams.get('current') === 'true'

        let query = supabase
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
            .order('effective_from', { ascending: false })

        if (classId) query = query.eq('class_id', classId)
        if (academicYearId) query = query.eq('academic_year_id', academicYearId)

        // Current only: get the latest active schedule per class
        if (currentOnly) {
            query = query
                .eq('is_active', true)
                .lte('effective_from', new Date().toISOString().split('T')[0])
                .limit(1)
        }

        const { data, error } = await query
        if (error) throw error

        return NextResponse.json(data || [])
    } catch (error) {
        console.error('Error fetching schedules:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST create new schedule with entries (admin only)
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { class_id, academic_year_id, effective_from, notes, entries } = await request.json()

        if (!class_id || !academic_year_id || !entries || !Array.isArray(entries)) {
            return NextResponse.json({ error: 'class_id, academic_year_id, dan entries harus diisi' }, { status: 400 })
        }

        // Deactivate previous active schedule for this class + year
        await supabase
            .from('schedules')
            .update({ is_active: false })
            .eq('class_id', class_id)
            .eq('academic_year_id', academic_year_id)
            .eq('is_active', true)

        // Create schedule header
        const { data: schedule, error: scheduleError } = await supabase
            .from('schedules')
            .insert({
                class_id,
                academic_year_id,
                effective_from: effective_from || new Date().toISOString().split('T')[0],
                notes: notes || null,
                is_active: true,
                created_by: user.id
            })
            .select()
            .single()

        if (scheduleError) throw scheduleError

        // Insert entries
        if (entries.length > 0) {
            const entriesToInsert = entries.map((e: any) => ({
                schedule_id: schedule.id,
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

        // Fetch complete schedule with relations
        const { data: fullSchedule } = await supabase
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
            .eq('id', schedule.id)
            .single()

        return NextResponse.json(fullSchedule)
    } catch (error) {
        console.error('Error creating schedule:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
