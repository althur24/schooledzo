import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// POST - Bulk create assignments
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { teacher_id, subject_id, academic_year_id, class_ids } = body

        if (!teacher_id || !subject_id || !academic_year_id || !class_ids?.length) {
            return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 })
        }

        // Check for existing assignments to avoid duplicates
        const { data: existingAssignments } = await supabase
            .from('teaching_assignments')
            .select('class_id')
            .eq('teacher_id', teacher_id)
            .eq('subject_id', subject_id)
            .eq('academic_year_id', academic_year_id)
            .in('class_id', class_ids)

        const existingClassIds = new Set(existingAssignments?.map(a => a.class_id) || [])
        const newClassIds = class_ids.filter((id: string) => !existingClassIds.has(id))

        if (newClassIds.length === 0) {
            return NextResponse.json({
                message: 'Semua kelas sudah ter-assign',
                created: 0
            })
        }

        // Create new assignments
        const newAssignments = newClassIds.map((classId: string) => ({
            teacher_id,
            subject_id,
            academic_year_id,
            class_id: classId
        }))

        const { data, error } = await supabase
            .from('teaching_assignments')
            .insert(newAssignments)
            .select()

        if (error) throw error

        return NextResponse.json({
            message: `${data?.length || 0} penugasan berhasil dibuat`,
            created: data?.length || 0,
            skipped: class_ids.length - newClassIds.length,
            assignments: data
        })
    } catch (error) {
        console.error('Error bulk creating assignments:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE - Bulk delete assignments
export async function DELETE(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { teacher_id, subject_id, academic_year_id, assignment_ids } = body

        if (!teacher_id && !assignment_ids?.length) {
            return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 })
        }

        let deleteQuery = supabase.from('teaching_assignments').delete()

        // Option 1: Delete by assignment IDs (for specific deletions)
        if (assignment_ids?.length) {
            deleteQuery = deleteQuery.in('id', assignment_ids)
        }
        // Option 2: Delete by teacher + optional subject + academic year
        else {
            deleteQuery = deleteQuery.eq('teacher_id', teacher_id)

            if (academic_year_id) {
                deleteQuery = deleteQuery.eq('academic_year_id', academic_year_id)
            }

            if (subject_id) {
                deleteQuery = deleteQuery.eq('subject_id', subject_id)
            }
        }

        const { error, count } = await deleteQuery

        if (error) throw error

        return NextResponse.json({
            message: 'Penugasan berhasil dihapus',
            deleted: count || 0
        })
    } catch (error) {
        console.error('Error bulk deleting assignments:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
