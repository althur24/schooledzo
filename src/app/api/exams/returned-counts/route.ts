import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { supabaseAdmin as supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get this teacher's ID
        const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (!teacher) {
            return NextResponse.json([])
        }

        // Get all exams for this teacher's teaching assignments
        const { data: assignments } = await supabase
            .from('teaching_assignments')
            .select('id')
            .eq('teacher_id', teacher.id)

        if (!assignments || assignments.length === 0) {
            return NextResponse.json([])
        }

        const assignmentIds = assignments.map(a => a.id)

        // Get exams with returned questions
        const { data: exams, error } = await supabase
            .from('exams')
            .select(`
                id,
                title,
                questions:exam_questions(id, status)
            `)
            .in('teaching_assignment_id', assignmentIds)

        if (error) {
            console.error('Error fetching returned exam counts:', error)
            return NextResponse.json({ error: 'Database error' }, { status: 500 })
        }

        const returnedSummary = (exams || [])
            .map(e => {
                const returnedQuestions = (e.questions || []).filter((question: any) => question.status === 'returned')
                return {
                    examId: e.id,
                    title: e.title,
                    returnedCount: returnedQuestions.length
                }
            })
            .filter(e => e.returnedCount > 0)

        return NextResponse.json(returnedSummary)
    } catch (error) {
        console.error('Error in returned summary:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
