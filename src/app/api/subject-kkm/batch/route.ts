import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// POST /api/subject-kkm/batch
// Batch update multiple KKM entries for a subject
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { subject_id, kkm_data } = body

        if (!subject_id || !Array.isArray(kkm_data)) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
        }

        const upsertData = kkm_data.map((item: any) => ({
            subject_id,
            school_level: item.school_level,
            grade_level: item.grade_level,
            kkm: item.kkm,
            school_id: schoolId
        }))

        const { data, error } = await supabase
            .from('subject_kkm')
            .upsert(upsertData, { onConflict: 'subject_id,school_level,grade_level' })
            .select()

        if (error) {
            console.error('Error batch updating subject_kkm:', error)
            return NextResponse.json({ error: 'Failed to batch update subject KKM' }, { status: 500 })
        }

        return NextResponse.json(data)
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
