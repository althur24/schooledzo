import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET answers for a specific exam submission
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // Check visibility: look up the submission's exam to get visibility settings
        const { data: submission } = await supabase
            .from('exam_submissions')
            .select('exam:exams(show_results_immediately, results_released)')
            .eq('id', id)
            .single()

        const examObj = (submission as any)?.exam || {}
        const showImmediately = examObj.show_results_immediately ?? true
        const isReleased = examObj.results_released || false
        const isHidden = user.role === 'SISWA' && !showImmediately && !isReleased

        const { data, error } = await supabase
            .from('exam_answers')
            .select(`
                id,
                question_id,
                answer,
                is_correct,
                points_earned
            `)
            .eq('submission_id', id)
            .order('created_at', { ascending: true })

        if (error) throw error

        // Strip score data if results are hidden
        const responseData = isHidden
            ? (data || []).map(a => ({ id: a.id, question_id: a.question_id, answer: a.answer }))
            : (data || [])

        return NextResponse.json(responseData)
    } catch (error) {
        console.error('Error fetching exam answers:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
