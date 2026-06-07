import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET /api/subject-kkm
// Fetch KKM data for a specific subject (or all if subject_id not provided)
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // GET is read-only, allow GURU access for dynamic KKM resolution on their pages
        if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN' && user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const subjectId = request.nextUrl.searchParams.get('subject_id')

        let query = supabase
            .from('subject_kkm')
            .select('*')
            .eq('school_id', schoolId)

        if (subjectId) {
            query = query.eq('subject_id', subjectId)
        }

        const { data, error } = await query

        if (error) {
            console.error('Error fetching subject_kkm:', error)
            return NextResponse.json({ error: 'Failed to fetch subject KKM' }, { status: 500 })
        }

        return NextResponse.json(data)
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

// PUT /api/subject-kkm
// Update a specific KKM entry
export async function PUT(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { subject_id, school_level, grade_level, kkm } = body

        if (!subject_id || !school_level || grade_level === undefined || kkm === undefined) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('subject_kkm')
            .upsert({
                subject_id,
                school_level,
                grade_level,
                kkm,
                school_id: schoolId
            }, { onConflict: 'subject_id,school_level,grade_level' })
            .select()
            .single()

        if (error) {
            console.error('Error updating subject_kkm:', error)
            return NextResponse.json({ error: 'Failed to update subject KKM' }, { status: 500 })
        }

        return NextResponse.json(data)
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
