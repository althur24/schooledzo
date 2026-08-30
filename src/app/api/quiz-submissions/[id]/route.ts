import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound } from '@/lib/tenantGuard'

// GET single submission
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
            .from('quiz_submissions')
            .select(`
                *,
                quiz:quizzes(
                    id,
                    title,
                    questions:quiz_questions(*),
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
        if (tenantMismatch((data as any)?.quiz?.teaching_assignment?.academic_year?.school_id, schoolId)) {
            return notFound()
        }

        // S3 Security Fix: IDOR protection — SISWA can only access their own quiz submission
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students').select('id').eq('user_id', user.id).single()
            if (!student || (data as any)?.student?.id !== student.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching quiz submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update submission (Teacher Grading)
export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const params = await context.params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const id = params.id
        const { answers, total_score, is_graded } = await request.json()

        // Submission lengkap (untuk guard & notifikasi) — fetch sekali untuk semua role
        const { data: sub } = await supabase
            .from('quiz_submissions')
            .select(`
                submitted_at, is_graded, max_score,
                quiz:quizzes(
                    id, title,
                    teaching_assignment:teaching_assignments(
                        teacher_id,
                        subject:subjects(name),
                        academic_year:academic_years(school_id)
                    )
                ),
                student:students(user_id)
            `)
            .eq('id', id)
            .single()

        if (!sub) {
            return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
        }

        // Guard integritas: hanya submission yang SUDAH dikumpulkan yang boleh
        // dinilai — nilai koreksi guru pada attempt yang masih berjalan akan
        // tertimpa begitu siswa menekan submit (processExisting menulis ulang
        // total_score/is_graded).
        if (!sub.submitted_at) {
            return NextResponse.json({ error: 'Kuis ini belum dikumpulkan siswa — tidak bisa dinilai' }, { status: 400 })
        }

        // Validasi skor: wajib number, tidak negatif, tidak melebihi max, tidak null
        // (null/negatif menghasilkan NaN di rekap & analitik).
        if (typeof total_score !== 'number' || !Number.isFinite(total_score) || total_score < 0) {
            return NextResponse.json({ error: 'Nilai tidak valid' }, { status: 400 })
        }
        if (total_score > (sub.max_score || 0)) {
            return NextResponse.json({ error: 'Total score exceeds max score' }, { status: 400 })
        }

        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()

            const quizTa = (sub.quiz as any)?.teaching_assignment
            if (!teacher || (Array.isArray(quizTa) ? quizTa[0] : quizTa)?.teacher_id !== teacher.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        } else if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        } else {
            // Role Admin: tenant guard
            const quizTa = (sub.quiz as any)?.teaching_assignment
            const ta = Array.isArray(quizTa) ? quizTa[0] : quizTa
            const subSchoolId = Array.isArray(ta?.academic_year) ? ta?.academic_year?.[0]?.school_id : ta?.academic_year?.school_id
            if (tenantMismatch(subSchoolId, schoolId)) {
                return notFound()
            }
        }

        const { data, error } = await supabase
            .from('quiz_submissions')
            .update({
                answers,
                total_score,
                is_graded
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error

        // Notifikasi "Nilai Keluar" saat koreksi manual selesai (is_graded false → true).
        // Jalur submit hanya memberi notif untuk kuis yang auto-graded — tanpa ini
        // kuis berisi essay/isian tidak pernah memberi tahu siswa nilainya sudah keluar.
        if (is_graded === true && sub.is_graded !== true) {
            const studentUserId = (sub.student as any)?.user_id
            const quiz = Array.isArray(sub.quiz) ? (sub.quiz as any)[0] : (sub.quiz as any)
            if (studentUserId && quiz) {
                try {
                    const subjectName = (Array.isArray(quiz.teaching_assignment) ? quiz.teaching_assignment[0] : quiz.teaching_assignment)?.subject?.name || ''
                    await supabase.from('notifications').insert({
                        user_id: studentUserId,
                        type: 'NILAI_KELUAR',
                        title: `Nilai Keluar: ${quiz.title}`,
                        message: `${subjectName} — Nilai: ${total_score}/${sub.max_score}`,
                        link: '/dashboard/siswa/kuis'
                    })
                } catch (notifError) {
                    console.error('Error sending graded-result notification:', notifError)
                }
            }
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating quiz submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
