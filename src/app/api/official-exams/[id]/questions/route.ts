import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { triggerBulkHOTSAnalysis, isAIReviewEnabled, type TriggerHOTSInput } from '@/lib/triggerHOTS'
import { validateCorrectAnswer } from '@/lib/questionTypeUtils'
import { logError } from '@/lib/logError'
import { canManageOfficialExam } from '@/lib/teacherScope'
import { invalidateExamQuestions } from '@/lib/examQuestionsCache'

// GET questions for an official exam
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // Scope multi-tenant: verifikasi ujian milik sekolah user
        if (schoolId) {
            const { data: examRow } = await supabase
                .from('official_exams')
                .select('school_id')
                .eq('id', id)
                .single()
            if (examRow?.school_id && examRow.school_id !== schoolId) {
                return NextResponse.json({ error: 'Ujian tidak ditemukan' }, { status: 404 })
            }
        }

        // SISWA: soal hanya boleh dibaca oleh kelas target, saat ujian aktif &
        // sudah dimulai — sebelumnya siswa kelas mana pun di sekolah bisa membaca
        // soal (termasuk draft/pra-jadwal) via API langsung. Pengecualian: siswa
        // yang sudah punya attempt tetap boleh memuat soal (resume setelah ujian
        // ditarik/diakhiri tidak boleh blank). Paritas gate POST attempt.
        if (user.role === 'SISWA') {
            const { data: examScope } = await supabase
                .from('official_exams')
                .select('is_active, start_time, target_class_ids, academic_year_id')
                .eq('id', id)
                .single()
            if (!examScope) {
                return NextResponse.json({ error: 'Ujian tidak ditemukan' }, { status: 404 })
            }

            const { data: student } = await supabase
                .from('students')
                .select('id, class_id')
                .eq('user_id', user.id)
                .single()
            if (!student) {
                return NextResponse.json({ error: 'Ujian tidak ditemukan' }, { status: 404 })
            }

            const { data: mySubmission } = await supabase
                .from('official_exam_submissions')
                .select('id')
                .eq('exam_id', id)
                .eq('student_id', student.id)
                .limit(1)
            const hasAttempt = (mySubmission || []).length > 0

            if (!hasAttempt) {
                // Kelas siswa: utamakan enrollment ACTIVE di tahun ujian (selaras gate attempt)
                let studentClassId = student.class_id
                const { data: enrollment } = await supabase
                    .from('student_enrollments')
                    .select('class_id')
                    .eq('student_id', student.id)
                    .eq('academic_year_id', examScope.academic_year_id)
                    .eq('status', 'ACTIVE')
                    .maybeSingle()
                if (enrollment?.class_id) studentClassId = enrollment.class_id

                const classAllowed = examScope.target_class_ids?.includes(studentClassId)
                const started = examScope.start_time ? new Date(examScope.start_time).getTime() <= Date.now() : true
                if (!classAllowed || !examScope.is_active || !started) {
                    return NextResponse.json({ error: 'Ujian belum tersedia' }, { status: 403 })
                }
            }
        }

        const { data, error } = await supabase
            .from('official_exam_questions')
            .select('*')
            .eq('exam_id', id)
            .order('order_index', { ascending: true })

        if (error) throw error

        let questions = data || []

        // Strip correct_answer for students unless exam is already submitted
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()

            let hasSubmitted = false
            if (student) {
                const { data: submission } = await supabase
                    .from('official_exam_submissions')
                    .select('is_submitted')
                    .eq('exam_id', id)
                    .eq('student_id', student.id)
                    .single()
                hasSubmitted = !!submission?.is_submitted
            }

            if (!hasSubmitted) {
                questions = questions.map(({ correct_answer, ...rest }: any) => rest)
            }
        }

        return NextResponse.json(questions)
    } catch (error) {
        logError('Error fetching official exam questions', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST add questions (single or batch)
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN' && user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Kepemilikan: GURU hanya bila mapel & kelas target ujian ini diajarnya;
        // ADMIN hanya di sekolahnya sendiri (tenant guard di canManageOfficialExam)
        {
            const { data: examScope } = await supabase
                .from('official_exams')
                .select('is_active, subject_id, target_class_ids, academic_year_id, school_id')
                .eq('id', id)
                .single()
            if (!examScope || !(await canManageOfficialExam(user, examScope))) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke ujian ini' }, { status: 403 })
            }

            // Integritas ujian: soal terkunci saat ujian aktif — perubahan kunci
            // jawaban/poin mid-exam menggeser nilai siswa yang belum submit, dan
            // penghapusan soal memutus relasi jawaban tersimpan. Tarik ke draft dulu.
            if (examScope.is_active) {
                return NextResponse.json({ error: 'Ujian sedang aktif — soal terkunci. Tarik ke draft untuk mengubah soal.' }, { status: 409 })
            }
        }

        const body = await request.json()
        const questions = Array.isArray(body) ? body : (Array.isArray(body.questions) ? body.questions : [body])

        // Validate correct_answer for objective question types
        for (const q of questions) {
            const v = validateCorrectAnswer(q.question_type || 'MULTIPLE_CHOICE', q.correct_answer, q.options)
            if (!v.valid) return NextResponse.json({ error: v.error }, { status: 400 })
        }

        // Get current max order_index
        const { data: existing } = await supabase
            .from('official_exam_questions')
            .select('order_index')
            .eq('exam_id', id)
            .order('order_index', { ascending: false })
            .limit(1)

        let nextIndex = (existing?.[0]?.order_index ?? -1) + 1

        const questionsToInsert = questions.map((q: any, i: number) => ({
            exam_id: id,
            question_text: q.question_text,
            question_type: q.question_type || 'MULTIPLE_CHOICE',
            options: q.options || null,
            correct_answer: q.correct_answer || null,
            points: q.points || 10,
            order_index: q.order_index ?? (nextIndex + i),
            difficulty: q.difficulty || null,
            passage_text: q.passage_text || null,
            passage_audio_url: q.passage_audio_url || null,
            image_url: q.image_url || null,
            teacher_hots_claim: q.teacher_hots_claim || false,
            text_direction: q.text_direction || 'ltr',
            content_format: q.content_format || 'plain',
            tags: Array.isArray(q.tags) && q.tags.length > 0 ? q.tags : null,
            // If question came from bank soal and is already approved, inherit that status
            ...(q.bank_status === 'approved' ? { status: 'approved' } : {})
        }))

        const { data, error } = await supabase
            .from('official_exam_questions')
            .insert(questionsToInsert)
            .select()

        if (error) throw error

        invalidateExamQuestions(id)

        // Trigger HOTS analysis for questions NOT already approved from bank soal
        if (data && data.length > 0) {
            const bankIndices = new Set(questions.map((q: any, i: number) => q.bank_status === 'approved' ? i : -1).filter((i: number) => i >= 0))
            const questionsNeedingAnalysis = data.filter((_: any, i: number) => !bankIndices.has(i))

            if (questionsNeedingAnalysis.length > 0) {
                const aiEnabled = await isAIReviewEnabled(schoolId)
                if (aiEnabled) {
                    // Get exam subject/level info for HOTS context
                    const { data: exam } = await supabase
                        .from('official_exams')
                        .select('subject:subjects(name), target_levels')
                        .eq('id', id).single()
                    const subjectName = (exam?.subject as any)?.name || ''
                    const gradeBand = (exam as any)?.target_levels?.[0] || 'SMP'

                    const hotsInputs: TriggerHOTSInput[] = questionsNeedingAnalysis.map((q: any) => ({
                        questionId: q.id,
                        questionSource: 'official_exam' as const,
                        questionText: q.question_text,
                        questionType: q.question_type,
                        options: q.options,
                        correctAnswer: q.correct_answer,
                        teacherDifficulty: q.difficulty,
                        teacherHotsClaim: q.teacher_hots_claim || false,
                        subjectName,
                        gradeBand,
                        officialExamId: id
                    }))
                    console.log(`[HOTS] Triggering analysis for ${hotsInputs.length} official exam questions`)
                    triggerBulkHOTSAnalysis(hotsInputs)
                } else {
                    // AI Review OFF — direct approve
                    const ids = questionsNeedingAnalysis.map((q: any) => q.id)
                    await supabase.from('official_exam_questions').update({ status: 'approved' }).in('id', ids)
                }
            }
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error adding official exam questions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update a single question
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params // dipakai untuk cek scope kepemilikan GURU
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'ADMIN' && user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Kepemilikan: GURU hanya bila mapel & kelas target ujian ini diajarnya;
        // ADMIN hanya di sekolahnya sendiri (tenant guard di canManageOfficialExam)
        {
            const { data: examScope } = await supabase
                .from('official_exams')
                .select('is_active, subject_id, target_class_ids, academic_year_id, school_id')
                .eq('id', id)
                .single()
            if (!examScope || !(await canManageOfficialExam(user, examScope))) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke ujian ini' }, { status: 403 })
            }

            // Integritas ujian: soal terkunci saat ujian aktif — perubahan kunci
            // jawaban/poin mid-exam menggeser nilai siswa yang belum submit, dan
            // penghapusan soal memutus relasi jawaban tersimpan. Tarik ke draft dulu.
            if (examScope.is_active) {
                return NextResponse.json({ error: 'Ujian sedang aktif — soal terkunci. Tarik ke draft untuk mengubah soal.' }, { status: 409 })
            }
        }

        const body = await request.json()
        const { question_id, question_text, question_type, options, correct_answer, difficulty, points, image_url, passage_text, passage_audio_url, teacher_hots_claim, text_direction, content_format, tags } = body

        if (!question_id) {
            return NextResponse.json({ error: 'question_id required' }, { status: 400 })
        }

        // Validate correct_answer for objective types
        if (correct_answer !== undefined && question_type !== undefined) {
            const v = validateCorrectAnswer(question_type, correct_answer, options)
            if (!v.valid) return NextResponse.json({ error: v.error }, { status: 400 })
        }

        // Build filtered update (fix mass-assignment vulnerability — don't spread entire body)
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

        const { data, error } = await supabase
            .from('official_exam_questions')
            .update(updateData)
            .eq('id', question_id)
            .eq('exam_id', id) // IDOR guard: soal harus milik ujian di URL, bukan ujian lain
            .select()
            .maybeSingle()

        if (error) throw error
        if (!data) {
            return NextResponse.json({ error: 'Soal tidak ditemukan di ujian ini' }, { status: 404 })
        }

        invalidateExamQuestions(id)

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating official exam question:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE a question
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params // dipakai untuk cek scope kepemilikan GURU
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'ADMIN' && user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Kepemilikan: GURU hanya bila mapel & kelas target ujian ini diajarnya;
        // ADMIN hanya di sekolahnya sendiri (tenant guard di canManageOfficialExam)
        {
            const { data: examScope } = await supabase
                .from('official_exams')
                .select('is_active, subject_id, target_class_ids, academic_year_id, school_id')
                .eq('id', id)
                .single()
            if (!examScope || !(await canManageOfficialExam(user, examScope))) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke ujian ini' }, { status: 403 })
            }

            // Integritas ujian: soal terkunci saat ujian aktif — perubahan kunci
            // jawaban/poin mid-exam menggeser nilai siswa yang belum submit, dan
            // penghapusan soal memutus relasi jawaban tersimpan. Tarik ke draft dulu.
            if (examScope.is_active) {
                return NextResponse.json({ error: 'Ujian sedang aktif — soal terkunci. Tarik ke draft untuk mengubah soal.' }, { status: 409 })
            }
        }

        const { question_id } = await request.json()

        if (!question_id) {
            return NextResponse.json({ error: 'question_id required' }, { status: 400 })
        }

        const { data: deleted, error } = await supabase
            .from('official_exam_questions')
            .delete()
            .eq('id', question_id)
            .eq('exam_id', id) // IDOR guard: soal harus milik ujian di URL, bukan ujian lain
            .select()

        if (error) throw error
        if (!deleted || deleted.length === 0) {
            return NextResponse.json({ error: 'Soal tidak ditemukan di ujian ini' }, { status: 404 })
        }

        invalidateExamQuestions(id)

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting official exam question:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
