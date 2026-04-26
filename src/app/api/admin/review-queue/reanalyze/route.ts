import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { triggerHOTSAnalysis, type TriggerHOTSInput } from '@/lib/triggerHOTS'

export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { question_id, question_source } = body

        if (!question_id || !question_source) {
            return NextResponse.json({ error: 'question_id and question_source are required' }, { status: 400 })
        }

        const tableMap: Record<string, string> = {
            'bank': 'question_bank',
            'quiz': 'quiz_questions',
            'exam': 'exam_questions',
            'official_exam': 'official_exam_questions'
        }
        
        const tableName = tableMap[question_source]
        if (!tableName) {
            return NextResponse.json({ error: 'Invalid question source' }, { status: 400 })
        }

        // Fetch question details
        let query = supabase.from(tableName).select('*').eq('id', question_id).single()
        
        if (question_source === 'quiz') {
            query = supabase.from(tableName).select(`
                *,
                quiz:quizzes(
                    teaching_assignment:teaching_assignments(
                        subject:subjects(name),
                        class:classes(school_level)
                    )
                )
            `).eq('id', question_id).single()
        } else if (question_source === 'exam') {
            query = supabase.from(tableName).select(`
                *,
                exam:exams(
                    teaching_assignment:teaching_assignments(
                        subject:subjects(name),
                        class:classes(school_level)
                    )
                )
            `).eq('id', question_id).single()
        }

        const { data: question, error: fetchError } = await query

        if (fetchError || !question) {
            return NextResponse.json({ error: 'Question not found' }, { status: 404 })
        }

        let subjectName = ''
        let gradeBand = 'SMP'
        
        if (question_source === 'quiz') {
            const ta = Array.isArray(question.quiz?.teaching_assignment) 
                ? question.quiz?.teaching_assignment[0] 
                : question.quiz?.teaching_assignment
            subjectName = ta?.subject?.name || ''
            gradeBand = ta?.class?.school_level || 'SMP'
        } else if (question_source === 'exam') {
            const ta = Array.isArray(question.exam?.teaching_assignment) 
                ? question.exam?.teaching_assignment[0] 
                : question.exam?.teaching_assignment
            subjectName = ta?.subject?.name || ''
            gradeBand = ta?.class?.school_level || 'SMP'
        }

        const hotsInput: TriggerHOTSInput = {
            questionId: question.id,
            questionSource: question_source as any,
            questionText: question.question_text,
            questionType: question.question_type,
            options: question.options,
            correctAnswer: question.correct_answer,
            teacherDifficulty: question.difficulty,
            teacherHotsClaim: question.teacher_hots_claim || false,
            subjectName,
            gradeBand,
            quizId: question.quiz_id,
            examId: question.exam_id,
            officialExamId: question.official_exam_id
        }

        // We delete the old FAILED ai_review record inside triggerHOTSAnalysis, so we can just call it
        try {
            await triggerHOTSAnalysis(hotsInput)
            
            // Re-fetch the newly created ai_review to return it
            const { data: aiReview } = await supabase
                .from('ai_reviews')
                .select('*')
                .eq('question_id', question_id)
                .single()
                
            return NextResponse.json({ success: true, ai_review: aiReview })
        } catch (analysisError: any) {
            console.error('Re-analysis failed:', analysisError)
            return NextResponse.json({ 
                error: analysisError.message || 'AI analysis failed again',
                needs_reanalysis: true
            }, { status: 500 })
        }

    } catch (error: any) {
        console.error('Error in reanalyze endpoint:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
