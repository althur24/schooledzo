import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound } from '@/lib/tenantGuard'

// GET single exam submission with questions and answers
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const params = await context.params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const id = params.id

        const { data, error } = await supabase
            .from('exam_submissions')
            .select(`
                *,
                exam:exams(
                    id,
                    title,
                    show_results_immediately,
                    results_released,
                    questions:exam_questions(*),
                    teaching_assignment:teaching_assignments(academic_year:academic_years(school_id))
                ),
                student:students(
                    id,
                    nis,
                    user:users!students_user_id_fkey(full_name)
                )
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        // Tenant guard: submission harus milik sekolah caller (IDOR lintas sekolah)
        if (tenantMismatch((data as any)?.exam?.teaching_assignment?.academic_year?.school_id, schoolId)) {
            return notFound()
        }

        // S2 Security Fix: IDOR protection — SISWA can only access their own submission
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students').select('id').eq('user_id', user.id).single()
            if (!student || (data as any)?.student?.id !== student.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        }

        // Check visibility for SISWA
        const examObj = (data as any)?.exam || {}
        const showImmediately = examObj.show_results_immediately ?? true
        const isReleased = examObj.results_released || false
        const isHidden = user.role === 'SISWA' && !showImmediately && !isReleased

        // K1 Security Fix: kunci jawaban (correct_answer di exam_questions) hanya boleh
        // terlihat oleh guru/admin, ATAU siswa yang SUDAH submit dan hasilnya boleh
        // dilihat. Sebelumnya embed exam_questions(*) membocorkan kunci ke siswa
        // yang masih mengerjakan (show_results_immediately default true).
        const canSeeAnswerKeys = user.role !== 'SISWA' || ((data as any)?.is_submitted && !isHidden)
        const responseDataRaw: any = data
        if (!canSeeAnswerKeys && responseDataRaw?.exam?.questions) {
            responseDataRaw.exam.questions = responseDataRaw.exam.questions.map((q: any) => {
                const { correct_answer, ...rest } = q
                return rest
            })
        }

        // Fetch answers from exam_answers table
        const { data: examAnswers, error: answersError } = await supabase
            .from('exam_answers')
            .select('*')
            .eq('submission_id', id)

        if (answersError) throw answersError

        // K1 lanjutan: is_correct/score jawaban juga dirahasiakan dari siswa yang
        // BELUM submit (mirror versi official) — jangan sampai jadi oracle
        // benar/salah saat ujian masih berjalan.
        const hideAnswers = user.role === 'SISWA' && (!(data as any)?.is_submitted || isHidden)

        // Map exam_answers to the format the frontend expects
        const answers = (examAnswers || []).map(a => ({
            question_id: a.question_id,
            answer: a.answer,
            is_correct: hideAnswers ? undefined : a.is_correct,
            score: hideAnswers ? undefined : a.points_earned,
            feedback: hideAnswers ? '' : (a.feedback || '')
        }))

        const responseData = {
            ...data,
            answers,
            results_hidden: isHidden
        }

        if (isHidden) {
            responseData.total_score = null
            responseData.max_score = null
        }

        return NextResponse.json(responseData)
    } catch (error) {
        console.error('Error fetching exam submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update exam submission (Teacher Grading)
export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const params = await context.params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const id = params.id
        const { answers, is_graded } = await request.json()

        // Verify teacher owns the teaching assignment for this exam (ADMIN bypass)
        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()

            const { data: submissionData } = await supabase
                .from('exam_submissions')
                .select('exam:exams(teaching_assignment:teaching_assignments(teacher_id))')
                .eq('id', id)
                .single()

            const assignmentTeacherId = (submissionData?.exam as any)?.teaching_assignment?.teacher_id
            if (!teacher || assignmentTeacherId !== teacher.id) {
                return NextResponse.json({ error: 'Forbidden: You do not have access to grade this class' }, { status: 403 })
            }
        } else if (user.role === 'ADMIN') {
            // K2 Security Fix: scope sekolah untuk admin — exams tidak punya school_id,
            // scope diperoleh via TA pemilik → teachers.school_id
            const { data: submissionData } = await supabase
                .from('exam_submissions')
                .select('exam:exams(teaching_assignment:teaching_assignments(teacher_id, teacher:teachers(school_id)))')
                .eq('id', id)
                .single()
            const ta = (submissionData?.exam as any)?.teaching_assignment as any
            const taTeacher = Array.isArray(ta?.teacher) ? ta.teacher[0] : ta?.teacher
            if (taTeacher?.school_id && schoolId && taTeacher.school_id !== schoolId) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        }

        // BATCH UPDATE: Update all exam_answers scores at once instead of one-by-one
        if (answers && Array.isArray(answers) && answers.length > 0) {
            const updates = answers.map((ans: any) => ({
                submission_id: id,
                question_id: ans.question_id,
                points_earned: Math.round(ans.score ?? ans.points_earned ?? 0),
                // Preserve existing fields by including them
                answer: ans.answer,
                is_correct: ans.is_correct,
                feedback: ans.feedback || null
            }))

            await supabase
                .from('exam_answers')
                .upsert(updates, { onConflict: 'submission_id,question_id' })
        }

        // Recalculate total score server-side (prevent client manipulation)
        const { data: allAnswers } = await supabase
            .from('exam_answers')
            .select('points_earned')
            .eq('submission_id', id)

        const totalScore = allAnswers?.reduce((sum, a) => sum + (a.points_earned || 0), 0) || 0

        // Update the submission record with server-calculated total_score and is_graded
        const { data, error } = await supabase
            .from('exam_submissions')
            .update({
                total_score: totalScore,
                is_graded
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating exam submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

