import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound } from '@/lib/tenantGuard'

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
            .select('exam:exams(show_results_immediately, results_released, teaching_assignment:teaching_assignments(academic_year:academic_years(school_id)))')
            .eq('id', id)
            .single()

        // Tenant guard: submission harus milik sekolah caller (IDOR lintas sekolah)
        if (tenantMismatch((submission as any)?.exam?.teaching_assignment?.academic_year?.school_id, schoolId)) {
            return notFound()
        }

        // S1 Security Fix: IDOR protection — SISWA can only access their own submission's answers
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students').select('id').eq('user_id', user.id).single()
            const { data: sub } = await supabase
                .from('exam_submissions').select('student_id').eq('id', id).single()
            if (!student || !sub || sub.student_id !== student.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        }

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
