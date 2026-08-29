import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound, resolveQuizSchoolId } from '@/lib/tenantGuard'
import { triggerHOTSAnalysis, triggerBulkHOTSAnalysis, isAIReviewEnabled, type TriggerHOTSInput } from '@/lib/triggerHOTS'
import { validateCorrectAnswer } from '@/lib/questionTypeUtils'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'
import { syncQuestionsToBank } from '@/lib/questionBankSync'
import { syncDraftQuizQuestions } from '@/lib/examBatch'

/**
 * Mirror soal ke sibling batch (draft) setelah mutasi sukses.
 * Kegagalan sync tidak boleh menggagalkan simpan guru — cukup dilog.
 */
async function syncBatchDraft(quizId: string): Promise<void> {
    try {
        const result = await syncDraftQuizQuestions(quizId)
        if (result.failed.length > 0) {
            console.error(`[questions] draft-sync gagal untuk ${result.failed.length}/${result.total} sibling quiz ${quizId}`)
        }
    } catch (e) {
        console.error('[questions] draft-sync error:', e)
    }
}

// GET questions for a quiz
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // Tenant guard: kuis harus milik sekolah caller (IDOR lintas sekolah)
        if (tenantMismatch(await resolveQuizSchoolId(id), schoolId)) {
            return notFound()
        }

        const { data, error } = await supabase
            .from('quiz_questions')
            .select('*')
            .eq('quiz_id', id)
            .order('order_index')

        if (error) throw error

        let questions = data || []

        // Enrich returned questions with admin review data
        if (user.role === 'GURU') {
            const returnedIds = questions.filter((q: any) => q.status === 'returned').map((q: any) => q.id)
            if (returnedIds.length > 0) {
                const { data: adminReviews } = await supabase
                    .from('admin_reviews').select('*')
                    .eq('question_source', 'quiz').in('question_id', returnedIds)
                    .order('created_at', { ascending: false })
                const reviewMap = new Map()
                adminReviews?.forEach((r: any) => {
                    if (!reviewMap.has(r.question_id)) reviewMap.set(r.question_id, r)
                })
                questions = questions.map((q: any) => ({
                    ...q, admin_review: reviewMap.get(q.id) || null
                }))
            }
        }

        // C1 Security Fix: Strip correct_answer for students unless quiz is already submitted
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()

            let hasSubmitted = false
            if (student) {
                const { data: submission } = await supabase
                    .from('quiz_submissions')
                    .select('submitted_at')
                    .eq('quiz_id', id)
                    .eq('student_id', student.id)
                    .single()
                hasSubmitted = !!submission?.submitted_at
            }

            if (!hasSubmitted) {
                questions = questions.map(({ correct_answer, ...rest }) => rest)
            }
        }

        return NextResponse.json(questions)
    } catch (error) {
        console.error('Error fetching questions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST add question to quiz
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Tenant guard: kuis harus milik sekolah caller + guru pemilik TA-nya
        // (sebelumnya sama sekali tanpa cek kepemilikan — soal kuis sekolah
        // lain bisa dibaca/ditambah/diubah/dihapus guru mana pun)
        if (tenantMismatch(await resolveQuizSchoolId(id), schoolId)) {
            return notFound()
        }
        {
            const { data: teacher } = await supabase
                .from('teachers').select('id').eq('user_id', user.id).single()
            const { data: quizTa } = await supabase
                .from('quizzes')
                .select('teaching_assignment:teaching_assignments(teacher_id)')
                .eq('id', id)
                .single()
            if (!teacher || (quizTa?.teaching_assignment as any)?.teacher_id !== teacher.id) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke kuis ini' }, { status: 403 })
            }
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: quizForYear } = await supabase
            .from('quizzes')
            .select('teaching_assignment_id')
            .eq('id', id)
            .single()
        if (quizForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(quizForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        const body = await request.json()

        // Reorder action: { reorder: [{ id, order_index }] } — batch update urutan soal
        if (body && !Array.isArray(body) && Array.isArray(body.reorder)) {
            const items = body.reorder.filter((r: any) => r && typeof r.id === 'string' && Number.isFinite(r.order_index))
            if (items.length === 0) {
                return NextResponse.json({ error: 'Payload reorder tidak valid' }, { status: 400 })
            }
            let updated = 0
            for (const r of items) {
                const { error: updErr } = await supabase
                    .from('quiz_questions')
                    .update({ order_index: r.order_index })
                    .eq('id', r.id)
                    .eq('quiz_id', id)
                if (updErr) throw updErr
                updated++
            }
            await syncBatchDraft(id)
            return NextResponse.json({ updated })
        }

        // Check AI review status ONCE before any insert
        const aiEnabled = await isAIReviewEnabled(schoolId)

        // Validate correct_answer for objective question types (bulk)
        if (Array.isArray(body)) {
            for (const q of body) {
                const v = validateCorrectAnswer(q.question_type || 'MULTIPLE_CHOICE', q.correct_answer, q.options)
                if (!v.valid) return NextResponse.json({ error: v.error }, { status: 400 })
            }
        }

        // Handle bulk insert
        if (Array.isArray(body)) {
            const questions = body.map((q: any, idx: number) => ({
                quiz_id: id,
                question_text: q.question_text,
                question_type: q.question_type,
                options: q.options || null,
                correct_answer: q.correct_answer || null,
                difficulty: q.difficulty || 'MEDIUM',
                points: q.points || 10,
                order_index: q.order_index ?? idx,
                image_url: q.image_url || null,
                passage_text: q.passage_text || null,
                passage_audio_url: q.passage_audio_url || null,
                teacher_hots_claim: q.teacher_hots_claim || false,
                text_direction: q.text_direction || 'ltr',
                content_format: q.content_format || 'plain',
                tags: Array.isArray(q.tags) && q.tags.length > 0 ? q.tags : null,
                // Set initial status: approved from bank, 'draft' for AI review, 'approved' if AI off
                status: q.bank_status === 'approved' ? 'approved' : (aiEnabled ? 'draft' : 'approved')
            }))

            const { data, error } = await supabase
                .from('quiz_questions')
                .insert(questions)
                .select()

            if (error) throw error

            // --- Auto-sync to question_bank (Fire and Forget) ---
            // Fetch quiz data to get title, subject_id, teacher_id
            const { data: quizData } = await supabase
                .from('quizzes')
                .select(`
                    title,
                    teaching_assignment:teaching_assignments(
                        teacher_id,
                        subject_id,
                        subject:subjects(name),
                        class:classes(school_level)
                    )
                `)
                .eq('id', id)
                .single()

            if (quizData && quizData.teaching_assignment && data && data.length > 0) {
                const ta = quizData.teaching_assignment as any
                const subjectName = ta?.subject?.name || ''
                const gradeBand = ta?.class?.school_level || 'SMP'
                const teacherId = ta.teacher_id
                const subjectId = ta.subject_id

                // Trigger HOTS analysis only for questions NOT already approved from bank soal
                console.log(`[HOTS-DEBUG] Inserted ${data?.length} questions. Body bank_status values:`, body.map((q: any) => q.bank_status))
                if (aiEnabled) {
                    // Track which indices came from bank soal (already analyzed)
                    const bankIndices = new Set(body.map((q: any, i: number) => q.bank_status === 'approved' ? i : -1).filter((i: number) => i >= 0))
                    const questionsNeedingAnalysis = data.filter((_: any, i: number) => !bankIndices.has(i))
                    console.log(`[HOTS-DEBUG] bankIndices: ${JSON.stringify([...bankIndices])}, needsAnalysis: ${questionsNeedingAnalysis.length}`)
                    if (questionsNeedingAnalysis.length > 0) {
                        const hotsInputs: TriggerHOTSInput[] = questionsNeedingAnalysis.map((q: any) => ({
                            questionId: q.id,
                            questionSource: 'quiz' as const,
                            questionText: q.question_text,
                            questionType: q.question_type,
                            options: q.options,
                            correctAnswer: q.correct_answer,
                            teacherDifficulty: q.difficulty,
                            teacherHotsClaim: q.teacher_hots_claim || false,
                            subjectName,
                            gradeBand,
                            quizId: id
                        }))
                        console.log(`[HOTS] Triggering analysis for ${hotsInputs.length} quiz questions`)
                        triggerBulkHOTSAnalysis(hotsInputs)
                    }
                }

                // Sync to bank — hanya soal baru; soal yang diambil dari bank tidak disalin balik
                const fromBankIdx = new Set<number>(
                    body.map((q: any, i: number) => (q.bank_status ? i : -1)).filter((i: number) => i >= 0)
                )
                const newQuestions = (data as any[]).filter((_: any, i: number) => !fromBankIdx.has(i))
                syncQuestionsToBank({
                    teacherId,
                    subjectId,
                    sourceType: 'quiz',
                    sourceId: id,
                    sourceName: quizData.title,
                    questions: newQuestions
                })
            }

            await syncBatchDraft(id)

            return NextResponse.json(data)
        }

        // Single insert
        const { question_text, question_type, options, correct_answer, difficulty, points, order_index, image_url, passage_text, passage_audio_url, teacher_hots_claim, content_format, tags } = body

        // Validate correct_answer for objective types (single insert)
        const v = validateCorrectAnswer(question_type || 'MULTIPLE_CHOICE', correct_answer, options)
        if (!v.valid) return NextResponse.json({ error: v.error }, { status: 400 })

        const { data, error } = await supabase
            .from('quiz_questions')
            .insert({
                quiz_id: id,
                question_text,
                question_type,
                options: options || null,
                correct_answer: correct_answer || null,
                difficulty: difficulty || 'MEDIUM',
                points: points || 10,
                order_index: order_index || 0,
                image_url: image_url || null,
                passage_text: passage_text || null,
                passage_audio_url: passage_audio_url || null,
                teacher_hots_claim: teacher_hots_claim || false,
                text_direction: body.text_direction || 'ltr',
                content_format: content_format || 'plain',
                tags: Array.isArray(tags) && tags.length > 0 ? tags : null,
                // Set initial status based on AI review setting
                status: aiEnabled ? 'draft' : 'approved'
            })
            .select()
            .single()

        if (error) throw error

        // --- Auto-sync to question_bank (Fire and Forget) ---
        // Fetch quiz data to get title, subject_id, teacher_id
        const { data: quizData } = await supabase
            .from('quizzes')
            .select(`
                title,
                teaching_assignment:teaching_assignments(
                    teacher_id,
                    subject_id,
                    subject:subjects(name),
                    class:classes(school_level)
                )
            `)
            .eq('id', id)
            .single()

        if (quizData && quizData.teaching_assignment && data) {
            const ta = quizData.teaching_assignment as any
            const subjectName = ta?.subject?.name || ''
            const gradeBand = ta?.class?.school_level || 'SMP'
            const teacherId = ta.teacher_id
            const subjectId = ta.subject_id

            // Trigger HOTS analysis for single question (fire-and-forget)
            if (aiEnabled) {
                triggerHOTSAnalysis({
                    questionId: data.id,
                    questionSource: 'quiz',
                    questionText: data.question_text,
                    questionType: data.question_type,
                    options: data.options,
                    correctAnswer: data.correct_answer,
                    teacherDifficulty: data.difficulty,
                    teacherHotsClaim: data.teacher_hots_claim || false,
                    subjectName,
                    gradeBand,
                    quizId: id
                }).catch(err => console.error('HOTS trigger error:', err))
            }

            // Sync to bank — hanya soal baru; soal yang diambil dari bank tidak disalin balik
            if (!body.bank_status) {
                syncQuestionsToBank({
                    teacherId,
                    subjectId,
                    sourceType: 'quiz',
                    sourceId: id,
                    sourceName: quizData.title,
                    questions: [data]
                })
            }
        }

        await syncBatchDraft(id)

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error adding question:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update question
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Tenant guard: kuis harus milik sekolah caller + guru pemilik TA-nya
        // (sebelumnya sama sekali tanpa cek kepemilikan — soal kuis sekolah
        // lain bisa dibaca/ditambah/diubah/dihapus guru mana pun)
        if (tenantMismatch(await resolveQuizSchoolId(id), schoolId)) {
            return notFound()
        }
        {
            const { data: teacher } = await supabase
                .from('teachers').select('id').eq('user_id', user.id).single()
            const { data: quizTa } = await supabase
                .from('quizzes')
                .select('teaching_assignment:teaching_assignments(teacher_id)')
                .eq('id', id)
                .single()
            if (!teacher || (quizTa?.teaching_assignment as any)?.teacher_id !== teacher.id) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke kuis ini' }, { status: 403 })
            }
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: quizForYear } = await supabase
            .from('quizzes')
            .select('teaching_assignment_id')
            .eq('id', id)
            .single()
        if (quizForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(quizForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        const body = await request.json()
        const { question_id, question_text, question_type, options, correct_answer, difficulty, points, image_url, passage_text, passage_audio_url, teacher_hots_claim, text_direction, content_format, tags } = body

        if (!question_id) {
            return NextResponse.json({ error: 'question_id required' }, { status: 400 })
        }

        // Validate correct_answer for objective types (edit flow always sends question_type)
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
        if (points !== undefined) updateData.points = points
        if (image_url !== undefined) updateData.image_url = image_url
        if (passage_text !== undefined) updateData.passage_text = passage_text
        if (passage_audio_url !== undefined) updateData.passage_audio_url = passage_audio_url
        if (teacher_hots_claim !== undefined) updateData.teacher_hots_claim = teacher_hots_claim
        if (text_direction !== undefined) updateData.text_direction = text_direction
        if (content_format !== undefined) updateData.content_format = content_format
        if (tags !== undefined) updateData.tags = Array.isArray(tags) && tags.length > 0 ? tags : null

        // Reset status & re-trigger HOTS hanya bila konten soal berubah.
        // Perubahan poin semata tidak menyentuh status (menghindari publish terblokir).
        const contentChanged = [question_text, question_type, options, correct_answer, passage_text, passage_audio_url, image_url, content_format, text_direction, difficulty].some(v => v !== undefined)
        const aiEnabled = await isAIReviewEnabled(schoolId)
        if (contentChanged) {
            if (aiEnabled) {
                updateData.status = 'ai_reviewing'
            } else {
                updateData.status = 'approved'
            }
        }

        const { data, error } = await supabase
            .from('quiz_questions')
            .update(updateData)
            .eq('id', question_id)
            .eq('quiz_id', id)
            .select()
            .single()

        if (error) throw error

        // Re-trigger HOTS analysis (fire-and-forget) — hanya bila konten berubah
        if (data && aiEnabled && contentChanged) {
            const { data: quiz } = await supabase.from('quizzes')
                .select('teaching_assignment:teaching_assignments(subject:subjects(name), class:classes(school_level))')
                .eq('id', id).single()
            const ta = quiz?.teaching_assignment as any
            triggerHOTSAnalysis({
                questionId: data.id, questionSource: 'quiz',
                questionText: data.question_text, questionType: data.question_type,
                options: data.options, correctAnswer: data.correct_answer,
                teacherDifficulty: data.difficulty, teacherHotsClaim: data.teacher_hots_claim || false,
                subjectName: ta?.subject?.name || '', gradeBand: ta?.class?.school_level || 'SMP',
                quizId: id
            }).catch(err => console.error('HOTS re-analysis error:', err))
        }

        await syncBatchDraft(id)

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating quiz question:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE question(s)
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Tenant guard: kuis harus milik sekolah caller + guru pemilik TA-nya
        // (sebelumnya sama sekali tanpa cek kepemilikan — soal kuis sekolah
        // lain bisa dibaca/ditambah/diubah/dihapus guru mana pun)
        if (tenantMismatch(await resolveQuizSchoolId(id), schoolId)) {
            return notFound()
        }
        {
            const { data: teacher } = await supabase
                .from('teachers').select('id').eq('user_id', user.id).single()
            const { data: quizTa } = await supabase
                .from('quizzes')
                .select('teaching_assignment:teaching_assignments(teacher_id)')
                .eq('id', id)
                .single()
            if (!teacher || (quizTa?.teaching_assignment as any)?.teacher_id !== teacher.id) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke kuis ini' }, { status: 403 })
            }
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: quizForYear } = await supabase
            .from('quizzes')
            .select('teaching_assignment_id')
            .eq('id', id)
            .single()
        if (quizForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(quizForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        const questionId = request.nextUrl.searchParams.get('question_id')

        if (questionId) {
            // Delete single question
            const { error } = await supabase
                .from('quiz_questions')
                .delete()
                .eq('id', questionId)
                .eq('quiz_id', id)

            if (error) throw error
        } else {
            // Delete all questions for this quiz
            const { error } = await supabase
                .from('quiz_questions')
                .delete()
                .eq('quiz_id', id)

            if (error) throw error
        }

        await syncBatchDraft(id)

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting questions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
