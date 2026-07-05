import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// PUT update subject
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

        const { name, level } = await request.json()
        
        const updateData: any = { name }
        if (level !== undefined) updateData.level = level

        let updateQuery = supabase
            .from('subjects')
            .update(updateData)
            .eq('id', id)
        if (schoolId) updateQuery = updateQuery.eq('school_id', schoolId)
        const { data, error } = await updateQuery
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating subject:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE subject
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

        // Clean up related data before deleting subject
        // 1. Set schedule_entries.subject_id to null where this subject is used
        await supabase
            .from('schedule_entries')
            .update({ subject_id: null })
            .eq('subject_id', id)

        // 2. Delete subject_kkm entries
        await supabase
            .from('subject_kkm')
            .delete()
            .eq('subject_id', id)

        let deleteQuery = supabase
            .from('subjects')
            .delete()
            .eq('id', id)
        if (schoolId) deleteQuery = deleteQuery.eq('school_id', schoolId)
        const { error } = await deleteQuery

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting subject:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
