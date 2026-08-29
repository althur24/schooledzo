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

        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()
            
            // Get submission -> quiz -> teaching_assignment
            const { data: sub } = await supabase
                .from('quiz_submissions')
                .select('max_score, quiz:quizzes(teaching_assignment:teaching_assignments(teacher_id))')
                .eq('id', id)
                .single()
            
            if (!teacher || (sub?.quiz as any)?.teaching_assignment?.teacher_id !== teacher.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }

            if (total_score > (sub?.max_score || 0)) {
                return NextResponse.json({ error: 'Total score exceeds max score' }, { status: 400 })
            }
        } else if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        } else {
            // Role Admin: tenant guard + only check max score
            const { data: sub } = await supabase
                .from('quiz_submissions')
                .select('max_score, quiz:quizzes(teaching_assignment:teaching_assignments(academic_year:academic_years(school_id)))')
                .eq('id', id)
                .single()

            // Tenant guard: submission harus milik sekolah caller
            const quizTa = (sub?.quiz as any)?.teaching_assignment
            const subSchoolId = Array.isArray(quizTa) ? quizTa[0]?.academic_year?.school_id : quizTa?.academic_year?.school_id
            if (tenantMismatch(subSchoolId, schoolId)) {
                return notFound()
            }

            if (total_score > (sub?.max_score || 0)) {
                return NextResponse.json({ error: 'Total score exceeds max score' }, { status: 400 })
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

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating quiz submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
