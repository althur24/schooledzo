import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound } from '@/lib/tenantGuard'
import { getTeacherScope, canTeachStudentSubmission } from '@/lib/teacherScope'
import { logError } from '@/lib/logError'

// GET submission detail with answers
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx

        const { data: submission, error } = await supabase
            .from('official_exam_submissions')
            .select(`
                *,
                student:students(id, nis, user:users!students_user_id_fkey(full_name)),
                exam:official_exams(id, title, exam_type, duration_minutes, show_results_immediately, results_released, school_id, subject:subjects(name))
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        // Tenant guard: submission harus milik sekolah caller (IDOR lintas sekolah)
        if (tenantMismatch((submission as any)?.exam?.school_id, ctx.schoolId)) {
            return notFound()
        }

        // S4 Security Fix: IDOR protection — SISWA can only access their own official exam submission
        if (ctx.user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students').select('id').eq('user_id', ctx.user.id).single()
            if (!student || (submission as any)?.student?.id !== student.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        }

        // Check visibility for SISWA
        const examObj = (submission as any)?.exam || {}
        const showImmediately = examObj.show_results_immediately ?? true
        const isReleased = examObj.results_released || false
        const isHidden = ctx.user.role === 'SISWA' && !showImmediately && !isReleased

        // K1 Security Fix: kunci jawaban hanya boleh terlihat guru/admin, ATAU siswa
        // yang SUDAH submit dan hasilnya boleh dilihat. Sebelumnya strip hanya
        // berbasis visibility setting — siswa yang masih mengerjakan ujian dengan
        // show_results_immediately=true (default) bisa membaca correct_answer.
        const hideKeys = ctx.user.role === 'SISWA' && (!(submission as any)?.is_submitted || isHidden)

        // Fetch answers
        const { data: answers } = await supabase
            .from('official_exam_answers')
            .select(`
                *,
                question:official_exam_questions(id, question_text, question_type, options, correct_answer, points)
            `)
            .eq('submission_id', id)

        const processedAnswers = hideKeys
            ? (answers || []).map((a: any) => ({
                ...a,
                is_correct: undefined,
                points_earned: undefined,
                question: a.question ? { ...a.question, correct_answer: undefined } : a.question
            }))
            : (answers || [])

        const responseData: any = { ...submission, answers: processedAnswers, results_hidden: isHidden }
        if (isHidden) {
            responseData.total_score = null
            responseData.max_score = null
        }

        return NextResponse.json(responseData)
    } catch (error) {
        logError('Error fetching official exam submission', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT grade essay answers (Admin or Guru)
export async function PUT(
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

        // K2 Security Fix: verifikasi akses guru/admin — sebelumnya PUT grading ini
        // tidak punya verifikasi sama sekali (guru manapun lintas sekolah bisa mengubah nilai).
        // GURU: scope per-submission — harus mengajar mapel ini di kelas SISWA pemilik
        // submission (bukan semua kelas target); ADMIN satu sekolah.
        const { data: subForAuth } = await supabase
            .from('official_exam_submissions')
            .select('is_submitted, student:students(class_id), exam:official_exams(school_id, subject_id, target_class_ids, academic_year_id)')
            .eq('id', id)
            .single()
        if (!subForAuth) {
            return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
        }
        // Guard integritas: hanya submission yang SUDAH dikumpulkan yang boleh
        // dinilai — nilai koreksi guru pada attempt yang masih berjalan akan
        // tertimpa autosave/submit siswa berikutnya. Paritas guard quiz-submissions/[id].
        if (!subForAuth.is_submitted) {
            return NextResponse.json({ error: 'Ujian ini belum dikumpulkan siswa — tidak bisa dinilai' }, { status: 400 })
        }
        const authExam: any = Array.isArray(subForAuth?.exam) ? subForAuth.exam[0] : subForAuth?.exam || {}
        if (user.role === 'GURU') {
            const authStudent: any = Array.isArray(subForAuth?.student) ? subForAuth.student[0] : subForAuth?.student
            const scope = await getTeacherScope(user.id, authExam.academic_year_id)
            if (!canTeachStudentSubmission(scope, authExam.subject_id, authStudent?.class_id)) {
                return NextResponse.json({ error: 'Anda tidak mengajar kelas siswa ini' }, { status: 403 })
            }
        } else if (authExam.school_id && schoolId && authExam.school_id !== schoolId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await request.json()
        const { grades } = body // Array of { answer_id, points_earned }

        if (!grades || !Array.isArray(grades)) {
            return NextResponse.json({ error: 'grades array required' }, { status: 400 })
        }

        // BATCH UPDATE: Update all scores in parallel with submission_id safety filter
        await Promise.all(grades.map((grade: any) =>
            supabase
                .from('official_exam_answers')
                .update({ points_earned: Math.round(grade.points_earned) })
                .eq('id', grade.answer_id)
                .eq('submission_id', id)
        ))

        // Recalculate total score
        const { data: allAnswers } = await supabase
            .from('official_exam_answers')
            .select('points_earned')
            .eq('submission_id', id)

        const totalScore = allAnswers?.reduce((sum: number, a: any) => sum + (a.points_earned || 0), 0) || 0

        // Update submission with new total and mark as graded
        const { data: updatedSubmission, error } = await supabase
            .from('official_exam_submissions')
            .update({
                total_score: totalScore,
                is_graded: true
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(updatedSubmission)
    } catch (error) {
        console.error('Error grading official exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
