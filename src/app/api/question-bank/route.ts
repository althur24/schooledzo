import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { triggerHOTSAnalysis, triggerBulkHOTSAnalysis, isAIReviewEnabled, type TriggerHOTSInput } from '@/lib/triggerHOTS'
import { validateCorrectAnswer } from '@/lib/questionTypeUtils'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'

// GET question bank
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const subjectId = request.nextUrl.searchParams.get('subject_id')
        const search = request.nextUrl.searchParams.get('search')
        const filterTeacherId = request.nextUrl.searchParams.get('teacher_id')
        const sourceType = request.nextUrl.searchParams.get('source_type')

        // Get teacher id if user is GURU
        let currentTeacherId = null
        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()

            if (!teacher) {
                return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })
            }
            currentTeacherId = teacher.id
        }

        let query = supabase
            .from('question_bank')
            .select(`
                *,
                subject:subjects(id, name),
                teacher:teachers(id, user:users(full_name))
            `)
            .is('passage_id', null)
            .order('created_at', { ascending: false })

        // Role-based filtering
        if (user.role === 'GURU') {
            query = query.eq('teacher_id', currentTeacherId)
        } else if (user.role === 'ADMIN' && filterTeacherId) {
            query = query.eq('teacher_id', filterTeacherId)
        }

        if (subjectId) {
            query = query.eq('subject_id', subjectId)
        }

        if (sourceType) {
            query = query.eq('source_type', sourceType)
        }

        if (search) {
            query = query.ilike('question_text', `%${search}%`)
        }

        // fetchAllRows: bank soal tumbuh terus — query biasa terpotong diam-diam di 1000
        const data = await fetchAllRows(query)

        // Fetch AI reviews for all questions
        const questionIds = (data || []).map((q: any) => q.id)
        let aiReviewMap = new Map()
        let adminReviewMap = new Map()

        if (questionIds.length > 0) {
            // batchedIn per 100 question id (batas URL) + fetchAllRows per chunk.
            // Setiap question id hanya muncul di satu chunk, dan di dalam chunk urutan
            // created_at DESC terjaga — jadi "latest review per question" tetap identik.
            const aiReviews = await batchedIn(
                'question_id', questionIds,
                async (chunk) => ({
                    data: await fetchAllRows(
                        supabase
                            .from('ai_reviews')
                            .select('*')
                            .eq('question_source', 'bank')
                            .in('question_id', chunk)
                            .order('created_at', { ascending: false })
                    ),
                    error: null
                })
            )

            // Keep only the latest AI review per question
            aiReviews?.forEach((r: any) => {
                if (!aiReviewMap.has(r.question_id)) {
                    aiReviewMap.set(r.question_id, r)
                }
            })

            // Fetch admin reviews (for return reasons)
            const adminReviews = await batchedIn(
                'question_id', questionIds,
                async (chunk) => ({
                    data: await fetchAllRows(
                        supabase
                            .from('admin_reviews')
                            .select('*')
                            .eq('question_source', 'bank')
                            .in('question_id', chunk)
                            .order('created_at', { ascending: false })
                    ),
                    error: null
                })
            )

            // Keep only the latest admin review per question
            adminReviews?.forEach((r: any) => {
                if (!adminReviewMap.has(r.question_id)) {
                    adminReviewMap.set(r.question_id, r)
                }
            })
        }

        // Merge reviews into question data
        const enrichedData = (data || []).map((q: any) => ({
            ...q,
            ai_review: aiReviewMap.get(q.id) || null,
            admin_review: adminReviewMap.get(q.id) || null
        }))

        return NextResponse.json(enrichedData)
    } catch (error) {
        console.error('Error fetching question bank:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update question in bank
export async function PUT(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { question_text, question_type, options, correct_answer, difficulty, subject_id, teacher_hots_claim, image_url, content_format } = body
        const id = request.nextUrl.searchParams.get('id') || body.id

        if (!id) {
            return NextResponse.json({ error: 'ID diperlukan' }, { status: 400 })
        }

        // Validate correct_answer for objective types
        if (correct_answer !== undefined && question_type !== undefined) {
            const v = validateCorrectAnswer(question_type, correct_answer, options)
            if (!v.valid) return NextResponse.json({ error: v.error }, { status: 400 })
        }

        const updateData: any = {}
        if (question_text !== undefined) updateData.question_text = question_text
        if (question_type !== undefined) updateData.question_type = question_type
        if (options !== undefined) updateData.options = options
        if (correct_answer !== undefined) updateData.correct_answer = correct_answer
        if (difficulty !== undefined) updateData.difficulty = difficulty
        if (subject_id !== undefined) updateData.subject_id = subject_id || null
        if (teacher_hots_claim !== undefined) updateData.teacher_hots_claim = teacher_hots_claim
        if (image_url !== undefined) updateData.image_url = image_url || null
        if (content_format !== undefined) updateData.content_format = content_format

        // Check if AI review is enabled
        const aiEnabled = await isAIReviewEnabled(schoolId)
        if (aiEnabled) {
            updateData.status = 'ai_reviewing'
        } else {
            updateData.status = 'approved'
        }

        const { data, error } = await supabase
            .from('question_bank')
            .update(updateData)
            .eq('id', id)
            .select(`
                *,
                subject:subjects(id, name),
                teacher:teachers(id, user:users(full_name))
            `)
            .single()

        if (error) throw error

        // Trigger HOTS re-analysis after edit (fire-and-forget) — only if AI enabled
        if (data && aiEnabled) {
            let subjectName = ''
            if (data.subject_id) {
                const { data: subjectData } = await supabase
                    .from('subjects').select('name').eq('id', data.subject_id).single()
                subjectName = subjectData?.name || ''
            }
            triggerHOTSAnalysis({
                questionId: data.id,
                questionSource: 'bank',
                questionText: data.question_text,
                questionType: data.question_type,
                options: data.options,
                correctAnswer: data.correct_answer,
                teacherDifficulty: data.difficulty,
                teacherHotsClaim: data.teacher_hots_claim || false,
                subjectName
            }).catch(err => console.error('HOTS re-analysis trigger error:', err))
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating question bank:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST add to question bank
export async function POST(request: NextRequest) {
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

        const body = await request.json()

        // Validate correct_answer for objective question types
        const questionsToValidate = Array.isArray(body) ? body : [body]
        for (const q of questionsToValidate) {
            const v = validateCorrectAnswer(q.question_type || 'MULTIPLE_CHOICE', q.correct_answer, q.options)
            if (!v.valid) return NextResponse.json({ error: v.error }, { status: 400 })
        }

        // Handle bulk insert
        if (Array.isArray(body)) {
            const questions = body.map((q: any) => ({
                teacher_id: teacher.id,
                subject_id: q.subject_id || null,
                question_text: q.question_text,
                question_type: q.question_type,
                options: q.options || null,
                correct_answer: q.correct_answer || null,
                difficulty: q.difficulty || 'MEDIUM',
                tags: q.tags || null,
                image_url: q.image_url || null,
                teacher_hots_claim: Boolean(q.teacher_hots_claim),
                content_format: q.content_format || 'plain'
            }))

            const { data, error } = await supabase
                .from('question_bank')
                .insert(questions)
                .select()

            if (error) throw error

            // Trigger HOTS analysis for each saved question (fire-and-forget)
            if (data && data.length > 0) {
                const aiEnabled = await isAIReviewEnabled(schoolId)
                if (aiEnabled) {
                    let subjectName = ''
                    if (data[0]?.subject_id) {
                        const { data: subjectData } = await supabase
                            .from('subjects').select('name').eq('id', data[0].subject_id).single()
                        subjectName = subjectData?.name || ''
                    }
                    const hotsInputs: TriggerHOTSInput[] = data.map((q: any) => ({
                        questionId: q.id,
                        questionSource: 'bank' as const,
                        questionText: q.question_text,
                        questionType: q.question_type,
                        options: q.options,
                        correctAnswer: q.correct_answer,
                        teacherDifficulty: q.difficulty,
                        teacherHotsClaim: q.teacher_hots_claim || false,
                        subjectName
                    }))
                    triggerBulkHOTSAnalysis(hotsInputs)
                } else {
                    // AI Review OFF — direct approve
                    const ids = data.map((q: any) => q.id)
                    await supabase.from('question_bank').update({ status: 'approved' }).in('id', ids)
                }
            }

            return NextResponse.json(data)
        }

        // Single insert
        const { subject_id, question_text, question_type, options, correct_answer, difficulty, tags, teacher_hots_claim, content_format } = body

        const { data, error } = await supabase
            .from('question_bank')
            .insert({
                teacher_id: teacher.id,
                subject_id: subject_id || null,
                question_text,
                question_type,
                options: options || null,
                correct_answer: correct_answer || null,
                difficulty: difficulty || 'MEDIUM',
                tags: tags || null,
                teacher_hots_claim: Boolean(teacher_hots_claim),
                content_format: content_format || 'plain'
            })
            .select()
            .single()

        if (error) throw error

        // Trigger HOTS analysis for single question (fire-and-forget)
        if (data) {
            const aiEnabled = await isAIReviewEnabled(schoolId)
            if (aiEnabled) {
                let subjectName = ''
                if (data.subject_id) {
                    const { data: subjectData } = await supabase
                        .from('subjects').select('name').eq('id', data.subject_id).single()
                    subjectName = subjectData?.name || ''
                }
                triggerHOTSAnalysis({
                    questionId: data.id,
                    questionSource: 'bank',
                    questionText: data.question_text,
                    questionType: data.question_type,
                    options: data.options,
                    correctAnswer: data.correct_answer,
                    teacherDifficulty: data.difficulty,
                    teacherHotsClaim: data.teacher_hots_claim || false,
                    subjectName
                }).catch(err => console.error('HOTS trigger error:', err))
            } else {
                // AI Review OFF — direct approve
                await supabase.from('question_bank').update({ status: 'approved' }).eq('id', data.id)
            }
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error adding to question bank:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE from question bank
export async function DELETE(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const id = request.nextUrl.searchParams.get('id')
        if (!id) {
            return NextResponse.json({ error: 'ID diperlukan' }, { status: 400 })
        }

        const { error } = await supabase
            .from('question_bank')
            .delete()
            .eq('id', id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting from question bank:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
