import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound, resolveExamSchoolId } from '@/lib/tenantGuard'
import { triggerHOTSAnalysis, triggerBulkHOTSAnalysis, isAIReviewEnabled, type TriggerHOTSInput } from '@/lib/triggerHOTS'
import { validateCorrectAnswer } from '@/lib/questionTypeUtils'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'
import { syncQuestionsToBank } from '@/lib/questionBankSync'
import { canManageExam } from '@/lib/teacherScope'
import { syncDraftExamQuestions } from '@/lib/examBatch'

/**
 * Mirror soal ke sibling batch (draft) setelah mutasi sukses.
 * Kegagalan sync tidak boleh menggagalkan simpan guru — cukup dilog.
 */
async function syncBatchDraft(examId: string): Promise<void> {
    try {
        const result = await syncDraftExamQuestions(examId)
        if (result.failed.length > 0) {
            console.error(`[questions] draft-sync gagal untuk ${result.failed.length}/${result.total} sibling exam ${examId}`)
        }
    } catch (e) {
        console.error('[questions] draft-sync error:', e)
    }
}

// GET questions for exam
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // Tenant guard: exam harus milik sekolah caller (IDOR lintas sekolah —
        // paritas dengan /api/quizzes/[id]/questions). Cek sebelum soal dikirim.
        if (tenantMismatch(await resolveExamSchoolId(id), schoolId)) {
            return notFound()
        }

        // SISWA di luar kelas target tidak boleh membaca soal (integritas
        // ulangan — sebelumnya siswa sekelas lain bisa membaca soal lebih awal)
        if (user.role === 'SISWA') {
            const { data: examTa } = await supabase
                .from('exams')
                .select('teaching_assignment:teaching_assignments(class_id)')
                .eq('id', id)
                .single()
            const taClassId = (examTa?.teaching_assignment as any)?.class_id

            const { data: student } = await supabase
                .from('students')
                .select('id, class_id')
                .eq('user_id', user.id)
                .single()

            if (!student || !taClassId || student.class_id !== taClassId) {
                return notFound()
            }
        }

        const { data, error } = await supabase
            .from('exam_questions')
            .select('*')
            .eq('exam_id', id)
            .order('order_index', { ascending: true })

        if (error) throw error

        let questions = data || []

        // Enrich returned questions with admin review data
        if (user.role === 'GURU') {
            const returnedIds = questions.filter((q: any) => q.status === 'returned').map((q: any) => q.id)
            if (returnedIds.length > 0) {
                const { data: adminReviews } = await supabase
                    .from('admin_reviews').select('*')
                    .eq('question_source', 'exam').in('question_id', returnedIds)
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

        // C2 Security Fix: Strip correct_answer for students unless exam is already submitted
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()

            let hasSubmitted = false
            if (student) {
                const { data: submission } = await supabase
                    .from('exam_submissions')
                    .select('is_submitted')
                    .eq('exam_id', id)
                    .eq('student_id', student.id)
                    .single()
                hasSubmitted = !!submission?.is_submitted
            }

            if (!hasSubmitted) {
                questions = questions.map(({ correct_answer, ...rest }) => rest)
            }
        }

        return NextResponse.json(questions)
    } catch (error) {
        console.error('Error fetching exam questions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST add questions to exam
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: examForYear } = await supabase
            .from('exams')
            .select('teaching_assignment_id, teaching_assignment:teaching_assignments(teacher_id)')
            .eq('id', id)
            .single()
        if (examForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(examForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        // Kepemilikan: hanya ADMIN atau guru pemilik TA yang boleh mengelola soal ulangan ini
        const taTeacherId = (examForYear?.teaching_assignment as any)?.teacher_id
        if (!(await canManageExam(user, taTeacherId))) {
            return NextResponse.json({ error: 'Anda tidak memiliki akses ke ulangan ini' }, { status: 403 })
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
                    .from('exam_questions')
                    .update({ order_index: r.order_index })
                    .eq('id', r.id)
                    .eq('exam_id', id)
                if (updErr) throw updErr
                updated++
            }
            await syncBatchDraft(id)
            return NextResponse.json({ updated })
        }

        const { questions } = body

        if (!questions || !Array.isArray(questions)) {
            return NextResponse.json({ error: 'Questions array required' }, { status: 400 })
        }

        // Validate correct_answer for objective question types
        for (const q of questions) {
            const v = validateCorrectAnswer(q.question_type || 'MULTIPLE_CHOICE', q.correct_answer, q.options)
            if (!v.valid) return NextResponse.json({ error: v.error }, { status: 400 })
        }

        // Check AI review status ONCE before any insert
        const aiEnabled = await isAIReviewEnabled(schoolId)

        // Get current max order
        const { data: existing } = await supabase
            .from('exam_questions')
            .select('order_index')
            .eq('exam_id', id)
            .order('order_index', { ascending: false })
            .limit(1)

        let startOrder = (existing?.[0]?.order_index ?? -1) + 1

        const questionsToInsert = questions.map((q: any, idx: number) => ({
            exam_id: id,
            question_text: q.question_text,
            question_type: q.question_type || 'MULTIPLE_CHOICE',
            options: q.options,
            correct_answer: q.correct_answer,
            difficulty: q.difficulty || 'MEDIUM',
            points: q.points || 1,
            order_index: startOrder + idx,
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
            .from('exam_questions')
            .insert(questionsToInsert)
            .select()

        if (error) throw error

        // --- Auto-sync to question_bank (Fire and Forget) ---
        // Fetch exam data to get title, subject_id, teacher_id
        const { data: examData } = await supabase
            .from('exams')
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

        if (examData && examData.teaching_assignment && data && data.length > 0) {
            const ta = examData.teaching_assignment as any
            const subjectName = ta?.subject?.name || ''
            const gradeBand = ta?.class?.school_level || 'SMP'
            const teacherId = ta.teacher_id
            const subjectId = ta.subject_id

            // Trigger HOTS analysis only for questions NOT already approved from bank soal
            if (aiEnabled) {
                // Track which indices came from bank soal (already analyzed)
                const bankIndices = new Set(questions.map((q: any, i: number) => q.bank_status === 'approved' ? i : -1).filter((i: number) => i >= 0))
                const questionsNeedingAnalysis = data.filter((_: any, i: number) => !bankIndices.has(i))
                if (questionsNeedingAnalysis.length > 0) {
                    const hotsInputs: TriggerHOTSInput[] = questionsNeedingAnalysis.map((q: any) => ({
                        questionId: q.id,
                        questionSource: 'exam' as const,
                        questionText: q.question_text,
                        questionType: q.question_type,
                        options: q.options,
                        correctAnswer: q.correct_answer,
                        teacherDifficulty: q.difficulty,
                        teacherHotsClaim: q.teacher_hots_claim || false,
                        subjectName,
                        gradeBand,
                        examId: id
                    }))
                    console.log(`[HOTS] Triggering analysis for ${hotsInputs.length} exam questions`)
                    triggerBulkHOTSAnalysis(hotsInputs)
                }
            }

            // Sync to bank — hanya soal baru; soal yang diambil dari bank tidak disalin balik
            const fromBankIndices = new Set<number>(
                questions.map((q: any, i: number) => (q.bank_status ? i : -1)).filter((i: number) => i >= 0)
            )
            const newQuestions = (data as any[]).filter((_: any, i: number) => !fromBankIndices.has(i))
            syncQuestionsToBank({
                teacherId,
                subjectId,
                sourceType: 'exam',
                sourceId: id,
                sourceName: examData.title,
                questions: newQuestions
            })
        }

        await syncBatchDraft(id)

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error adding exam questions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update questions
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: examForYear } = await supabase
            .from('exams')
            .select('teaching_assignment_id, teaching_assignment:teaching_assignments(teacher_id)')
            .eq('id', id)
            .single()
        if (examForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(examForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        // Kepemilikan: hanya ADMIN atau guru pemilik TA yang boleh mengelola soal ulangan ini
        const taTeacherId = (examForYear?.teaching_assignment as any)?.teacher_id
        if (!(await canManageExam(user, taTeacherId))) {
            return NextResponse.json({ error: 'Anda tidak memiliki akses ke ulangan ini' }, { status: 403 })
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
            .from('exam_questions')
            .update(updateData)
            .eq('id', question_id)
            .eq('exam_id', id)
            .select()
            .single()

        if (error) throw error

        // Re-trigger HOTS analysis (fire-and-forget) — hanya bila konten berubah
        if (data && aiEnabled && contentChanged) {
            const { data: exam } = await supabase.from('exams')
                .select('teaching_assignment:teaching_assignments(subject:subjects(name), class:classes(school_level))')
                .eq('id', id).single()
            const ta = exam?.teaching_assignment as any
            triggerHOTSAnalysis({
                questionId: data.id, questionSource: 'exam',
                questionText: data.question_text, questionType: data.question_type,
                options: data.options, correctAnswer: data.correct_answer,
                teacherDifficulty: data.difficulty, teacherHotsClaim: data.teacher_hots_claim || false,
                subjectName: ta?.subject?.name || '', gradeBand: ta?.class?.school_level || 'SMP',
                examId: id
            }).catch(err => console.error('HOTS re-analysis error:', err))
        }

        await syncBatchDraft(id)

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating exam question:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE question
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: examForYear } = await supabase
            .from('exams')
            .select('teaching_assignment_id, teaching_assignment:teaching_assignments(teacher_id)')
            .eq('id', id)
            .single()
        if (examForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(examForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        // Kepemilikan: hanya ADMIN atau guru pemilik TA yang boleh mengelola soal ulangan ini
        const taTeacherId = (examForYear?.teaching_assignment as any)?.teacher_id
        if (!(await canManageExam(user, taTeacherId))) {
            return NextResponse.json({ error: 'Anda tidak memiliki akses ke ulangan ini' }, { status: 403 })
        }

        const questionId = request.nextUrl.searchParams.get('question_id')

        if (questionId) {
            // Delete single question
            const { error } = await supabase
                .from('exam_questions')
                .delete()
                .eq('id', questionId)
                .eq('exam_id', id)

            if (error) throw error
        } else {
            // Delete all questions for this exam
            const { error } = await supabase
                .from('exam_questions')
                .delete()
                .eq('exam_id', id)

            if (error) throw error
        }

        await syncBatchDraft(id)

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting exam question:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
