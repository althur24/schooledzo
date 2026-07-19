import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'

// GET single assignment
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
            .from('assignments')
            .select(`
                *,
                teaching_assignment:teaching_assignments(
                    id,
                    class:classes(id, name, school_level, grade_level),
                    subject:subjects(id, name, kkm),
                    teacher:teachers(id, user:users(full_name))
                )
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching assignment:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE assignment
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // H2 Security Fix: Verify ownership
        const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (teacher) {
            const { data: assignment } = await supabase
                .from('assignments')
                .select('teaching_assignment:teaching_assignments(teacher_id)')
                .eq('id', id)
                .single()

            const assignmentTeacherId = (assignment as any)?.teaching_assignment?.teacher_id
            if (assignmentTeacherId && assignmentTeacherId !== teacher.id) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses untuk menghapus tugas ini' }, { status: 403 })
            }
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: assignmentForYear } = await supabase
            .from('assignments')
            .select('teaching_assignment_id')
            .eq('id', id)
            .single()
        if (assignmentForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(assignmentForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        const { error } = await supabase
            .from('assignments')
            .delete()
            .eq('id', id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting assignment:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT (update) assignment
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // H2 Security Fix: Verify ownership
        const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (teacher) {
            const { data: assignment } = await supabase
                .from('assignments')
                .select('teaching_assignment:teaching_assignments(teacher_id)')
                .eq('id', id)
                .single()

            const assignmentTeacherId = (assignment as any)?.teaching_assignment?.teacher_id
            if (assignmentTeacherId && assignmentTeacherId !== teacher.id) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses untuk mengubah tugas ini' }, { status: 403 })
            }
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: assignmentForYear } = await supabase
            .from('assignments')
            .select('teaching_assignment_id')
            .eq('id', id)
            .single()
        if (assignmentForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(assignmentForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        const { title, description, type, due_date } = await request.json()

        if (!title || !type) {
            return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('assignments')
            .update({ title, description, type, due_date })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating assignment:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
