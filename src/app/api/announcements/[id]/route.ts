import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// PUT /api/announcements/[id] - Update announcement
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(req)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json()
        const { title, content, is_global, class_ids, expires_at, is_active } = body

        const updateData: Record<string, any> = {}
        if (title !== undefined) updateData.title = title
        if (content !== undefined) updateData.content = content
        if (is_global !== undefined) {
            updateData.is_global = is_global
            if (is_global) updateData.class_ids = []
        }
        if (class_ids !== undefined) updateData.class_ids = class_ids
        if (expires_at !== undefined) updateData.expires_at = expires_at
        if (is_active !== undefined) updateData.is_active = is_active

        let updateQuery = supabase
            .from('announcements')
            .update(updateData)
            .eq('id', id)
        if (schoolId) updateQuery = updateQuery.eq('school_id', schoolId)
        const { data, error } = await updateQuery
            .select()
            .single()

        if (error) {
            console.error('Error updating announcement:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

// DELETE /api/announcements/[id] - Delete announcement
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(req)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let deleteQuery = supabase
            .from('announcements')
            .delete()
            .eq('id', id)
        if (schoolId) deleteQuery = deleteQuery.eq('school_id', schoolId)
        const { error } = await deleteQuery

        if (error) {
            console.error('Error deleting announcement:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

