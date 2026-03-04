import { NextRequest, NextResponse } from 'next/server'
import { supabase, supabaseAdmin } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET all quizzes (filtered by teacher)
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const teachingAssignmentId = request.nextUrl.searchParams.get('teaching_assignment_id')
        const allYears = request.nextUrl.searchParams.get('all_years')

        let query = supabase
            .from('quizzes')
            .select(`
                *,
                teaching_assignment:teaching_assignments(
                    id,
                    academic_year_id,
                    subject:subjects(id, name, kkm),
                    class:classes(id, name, school_level, grade_level),
                    teacher:teachers(id, user:users(full_name)),
                    academic_year:academic_years(id, name, is_active)
                ),
                questions:quiz_questions(count)
            `)
            .order('created_at', { ascending: false })

        if (teachingAssignmentId) {
            query = query.eq('teaching_assignment_id', teachingAssignmentId)
        } else if (allYears !== 'true') {
            // Filter by active year: get active year's teaching assignment IDs
            const { data: activeYear } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .single()

            if (activeYear) {
                const { data: taIds } = await supabase
                    .from('teaching_assignments')
                    .select('id')
                    .eq('academic_year_id', activeYear.id)

                if (taIds && taIds.length > 0) {
                    query = query.in('teaching_assignment_id', taIds.map(t => t.id))
                } else {
                    return NextResponse.json([])
                }
            }
        }

        const { data, error } = await query

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching quizzes:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST create new quiz
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { title, description, start_time, duration_minutes, teaching_assignment_id, is_randomized, max_violations, is_remedial, remedial_for_id, allowed_student_ids, duplicate_questions, questions } = body

        if (!title || duration_minutes === undefined || !teaching_assignment_id) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // Create quiz (default: draft/inactive until published)
        const { data: quiz, error } = await supabaseAdmin
            .from('quizzes')
            .insert({
                title,
                description,
                start_time,
                duration_minutes,
                teaching_assignment_id,
                is_active: false,
                is_randomized: is_randomized ?? true,
                is_remedial: is_remedial || false,
                remedial_for_id: remedial_for_id || null,
                allowed_student_ids: allowed_student_ids || null
            })
            .select()
            .single()

        if (error) throw error

        // Add questions if provided
        if (questions && questions.length > 0) {
            const questionsWithQuizId = questions.map((q: any, idx: number) => ({
                quiz_id: quiz.id,
                question_text: q.question_text,
                question_type: q.question_type,
                options: q.options || null,
                correct_answer: q.correct_answer || null,
                points: q.points || 10,
                order_index: idx
            }))

            const { error: questionsError } = await supabaseAdmin
                .from('quiz_questions')
                .insert(questionsWithQuizId)

            if (questionsError) throw questionsError
        }

        // Handle question duplication if requested for Remedial
        if (is_remedial && remedial_for_id && duplicate_questions) {
            const { data: originalQuestions, error: fetchError } = await supabaseAdmin
                .from('quiz_questions')
                .select('*')
                .eq('quiz_id', remedial_for_id)

            if (!fetchError && originalQuestions && originalQuestions.length > 0) {
                const newQuestions = originalQuestions.map((q: any) => ({
                    quiz_id: quiz.id,
                    question_text: q.question_text,
                    question_type: q.question_type,
                    options: q.options,
                    correct_answer: q.correct_answer,
                    points: q.points,
                    order_index: q.order_index
                }))
                const { error: duplicateError } = await supabaseAdmin.from('quiz_questions').insert(newQuestions)
                if (duplicateError) throw duplicateError
            }
        }
        // Send notifications to remedial students
        if (is_remedial && allowed_student_ids && allowed_student_ids.length > 0) {
            try {
                const { data: students } = await supabase
                    .from('students')
                    .select('user_id')
                    .in('id', allowed_student_ids)

                if (students && students.length > 0) {
                    await supabase.from('notifications').insert(
                        students.map((s: any) => ({
                            user_id: s.user_id,
                            type: 'REMEDIAL',
                            title: `Remedial Kuis: ${title}`,
                            message: 'Guru telah membuat kuis remedial untuk Anda. Segera kerjakan!',
                            link: '/dashboard/siswa/kuis'
                        }))
                    )
                }
            } catch (notifError) {
                console.error('Error sending remedial notification:', notifError)
            }
        }

        return NextResponse.json(quiz)
    } catch (error) {
        console.error('Error creating quiz:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
