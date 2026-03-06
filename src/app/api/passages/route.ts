import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { triggerBulkHOTSAnalysis, type TriggerHOTSInput } from '@/lib/triggerHOTS'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET - List passages for teacher
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get teacher
        const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (!teacher) {
            return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const subjectId = searchParams.get('subject_id')

        let query = supabase
            .from('question_passages')
            .select(`
                *,
                subject:subjects(id, name),
                questions:question_bank(id, question_text, question_type, options, correct_answer, difficulty, order_in_passage, status, teacher_hots_claim)
            `)
            .eq('teacher_id', teacher.id)
            .order('created_at', { ascending: false })

        if (subjectId) {
            query = query.eq('subject_id', subjectId)
        }

        const { data, error } = await query

        if (error) throw error

        // Sort questions by order_in_passage and fetch admin_reviews
        let adminReviewMap = new Map()
        const questionIds = data?.flatMap(p => p.questions?.map((q: any) => q.id) || []) || []

        if (questionIds.length > 0) {
            const { data: adminReviews } = await supabase
                .from('admin_reviews')
                .select('*')
                .eq('question_source', 'bank')
                .in('question_id', questionIds)
                .order('created_at', { ascending: false })

            adminReviews?.forEach((r: any) => {
                if (!adminReviewMap.has(r.question_id)) {
                    adminReviewMap.set(r.question_id, r)
                }
            })
        }

        const result = data?.map(p => ({
            ...p,
            questions: p.questions
                ?.sort((a: any, b: any) => (a.order_in_passage || 0) - (b.order_in_passage || 0))
                .map((q: any) => ({
                    ...q,
                    admin_review: adminReviewMap.get(q.id) || null
                }))
        }))

        return NextResponse.json(result || [])
    } catch (error) {
        console.error('Error fetching passages:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST - Create passage with questions
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (!teacher) {
            return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })
        }

        const { title, passage_text, subject_id, questions, audio_url } = await request.json()

        if (!passage_text && !audio_url) {
            return NextResponse.json({ error: 'Teks bacaan atau audio listening diperlukan' }, { status: 400 })
        }

        if (!questions || questions.length === 0) {
            return NextResponse.json({ error: 'At least one question required' }, { status: 400 })
        }

        // Create passage
        const { data: passage, error: passageError } = await supabase
            .from('question_passages')
            .insert({
                title,
                passage_text,
                audio_url: audio_url || null,
                subject_id: subject_id || null,
                teacher_id: teacher.id
            })
            .select()
            .single()

        if (passageError) throw passageError

        // Create questions linked to passage
        const questionsToInsert = questions.map((q: any, idx: number) => ({
            question_text: q.question_text,
            question_type: q.question_type,
            options: q.options,
            correct_answer: q.correct_answer,
            difficulty: q.difficulty || 'MEDIUM',
            subject_id: subject_id || null,
            teacher_id: teacher.id,
            passage_id: passage.id,
            order_in_passage: idx + 1,
            teacher_hots_claim: Boolean(q.teacher_hots_claim)
        }))

        const { data: insertedQuestions, error: questionsError } = await supabase
            .from('question_bank')
            .insert(questionsToInsert)
            .select()

        if (questionsError) throw questionsError

        // Trigger HOTS analysis for each saved question (fire-and-forget)
        if (insertedQuestions && insertedQuestions.length > 0) {
            // Get subject name for rubric matching
            let subjectName = ''
            if (subject_id) {
                const { data: subjectData } = await supabase
                    .from('subjects').select('name').eq('id', subject_id).single()
                subjectName = subjectData?.name || ''
            }

            const hotsInputs: TriggerHOTSInput[] = insertedQuestions.map((q: any) => ({
                questionId: q.id,
                questionSource: 'bank' as const,
                questionText: q.question_text,
                questionType: q.question_type,
                options: q.options,
                correctAnswer: q.correct_answer,
                teacherDifficulty: q.difficulty,
                teacherHotsClaim: Boolean(q.teacher_hots_claim),
                subjectName
            }))
            triggerBulkHOTSAnalysis(hotsInputs)
        }

        // Return created passage with questions
        const { data: result } = await supabase
            .from('question_passages')
            .select(`
                *,
                subject:subjects(id, name),
                questions:question_bank(id, question_text, question_type, difficulty, order_in_passage)
            `)
            .eq('id', passage.id)
            .single()

        return NextResponse.json(result)
    } catch (error) {
        console.error('Error creating passage:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT - Update passage
export async function PUT(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (!teacher) {
            return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const id = searchParams.get('id')
        const { title, passage_text, subject_id, questions, audio_url } = await request.json()

        if (!id) {
            return NextResponse.json({ error: 'Passage ID required' }, { status: 400 })
        }

        // Update passage info
        const { data: passage, error: passageError } = await supabase
            .from('question_passages')
            .update({
                title,
                passage_text,
                audio_url: audio_url !== undefined ? (audio_url || null) : undefined,
                subject_id: subject_id || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single()

        if (passageError) throw passageError

        // If questions provided, replace all questions
        if (questions && questions.length > 0) {
            // Delete old questions
            await supabase
                .from('question_bank')
                .delete()
                .eq('passage_id', id)

            // Insert new questions
            const questionsToInsert = questions.map((q: any, idx: number) => ({
                question_text: q.question_text,
                question_type: q.question_type,
                options: q.options,
                correct_answer: q.correct_answer,
                difficulty: q.difficulty || 'MEDIUM',
                subject_id: subject_id || null,
                teacher_id: teacher.id,
                passage_id: id,
                order_in_passage: idx + 1,
                teacher_hots_claim: Boolean(q.teacher_hots_claim)
            }))

            const { data: updatedQuestions, error: questionsError } = await supabase
                .from('question_bank')
                .insert(questionsToInsert)
                .select()

            if (questionsError) throw questionsError

            // Trigger HOTS analysis for newly added or updated questions
            if (updatedQuestions && updatedQuestions.length > 0) {
                let subjectName = ''
                if (subject_id) {
                    const { data: subjectData } = await supabase
                        .from('subjects').select('name').eq('id', subject_id).single()
                    subjectName = subjectData?.name || ''
                }

                const hotsInputs: TriggerHOTSInput[] = updatedQuestions.map((q: any) => ({
                    questionId: q.id,
                    questionSource: 'bank' as const,
                    questionText: q.question_text,
                    questionType: q.question_type,
                    options: q.options,
                    correctAnswer: q.correct_answer,
                    teacherDifficulty: q.difficulty,
                    teacherHotsClaim: Boolean(q.teacher_hots_claim),
                    subjectName
                }))
                triggerBulkHOTSAnalysis(hotsInputs)
            }
        }

        // Return updated passage with questions
        const { data: result } = await supabase
            .from('question_passages')
            .select(`
                *,
                subject:subjects(id, name),
                questions:question_bank(id, question_text, question_type, options, correct_answer, difficulty, order_in_passage)
            `)
            .eq('id', id)
            .single()

        return NextResponse.json(result)
    } catch (error) {
        console.error('Error updating passage:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE - Delete passage and its questions
export async function DELETE(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const id = searchParams.get('id')

        if (!id) {
            return NextResponse.json({ error: 'Passage ID required' }, { status: 400 })
        }

        // Delete questions first (or they'll be orphaned if ON DELETE SET NULL)
        await supabase
            .from('question_bank')
            .delete()
            .eq('passage_id', id)

        // Delete passage
        const { error } = await supabase
            .from('question_passages')
            .delete()
            .eq('id', id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting passage:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
