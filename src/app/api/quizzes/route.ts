import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { findTeachingAssignmentsOutsideSchool, findQuizzesOutsideSchool } from '@/lib/tenantGuard'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'
import { getBatchSizes } from '@/lib/examBatch'

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
                teaching_assignment:teaching_assignments!inner(
                    id,
                    academic_year_id,
                    subject:subjects(id, name, kkm),
                    class:classes(id, name, school_level, grade_level),
                    teacher:teachers(id, user:users(full_name)),
                    academic_year:academic_years(id, name, is_active, school_id)
                ),
                questions:quiz_questions(count)
            `)
            .order('created_at', { ascending: false })

        if (teachingAssignmentId) {
            // Tenant guard: TA harus milik sekolah caller (param client dipercaya)
            if ((await findTeachingAssignmentsOutsideSchool([teachingAssignmentId], schoolId)).length > 0) {
                return NextResponse.json([])
            }
            query = query.eq('teaching_assignment_id', teachingAssignmentId)
        } else {
            if (allYears !== 'true') {
                // Filter by active year — via inner join (NOT .in(list): hundreds of TA ids
                // overflow the 16KB header limit at larger schools and break this endpoint)
                const { data: activeYear } = await supabase
                    .from('academic_years')
                    .select('id')
                    .eq('is_active', true)
                    .eq('school_id', schoolId)
                    .single()

                if (activeYear) {
                    query = query.eq('teaching_assignment.academic_year_id', activeYear.id)
                } else {
                    // No active year: return empty instead of leaking content across years
                    return NextResponse.json([])
                }
            } else {
                // all_years lintas tahun ajaran — TETAP scope ke sekolah caller.
                // Tanpa ini endpoint mengembalikan kuis SEMUA sekolah (termasuk draft).
                if (schoolId) {
                    query = query.eq('teaching_assignment.academic_year.school_id', schoolId)
                }
            }

            // Role scoping berlaku untuk SEMUA listing tanpa TA eksplisit —
            // dulu hanya di cabang tahun aktif, membuat all_years=true lolos
            // tanpa filter kelas/teacher sama sekali.
            if (user.role === 'SISWA') {
                // STRICT FILTERING FOR SISWA: hanya kuis kelasnya sendiri
                const { data: student } = await supabase
                    .from('students')
                    .select('class_id')
                    .eq('user_id', user.id)
                    .single()

                if (student?.class_id) {
                    query = query.eq('teaching_assignment.class_id', student.class_id)
                } else {
                    // Student has no valid class -> returns empty list
                    return NextResponse.json([])
                }
            } else if (user.role === 'GURU') {
                // STRICT FILTERING FOR GURU: only own teaching assignments
                const { data: teacher } = await supabase
                    .from('teachers')
                    .select('id')
                    .eq('user_id', user.id)
                    .single()

                if (teacher) {
                    query = query.eq('teaching_assignment.teacher_id', teacher.id)
                } else {
                    return NextResponse.json([])
                }
            }
            // ADMIN/SUPER_ADMIN: scope sekolah di atas sudah cukup
        }

        const { data, error } = await query

        if (error) throw error

        // Ukuran batch (untuk badge "N Kelas Paralel" di daftar guru)
        const batchIds = [...new Set((data || []).map((q: any) => q.batch_id).filter(Boolean))] as string[]
        const batchSizes = await getBatchSizes('quizzes', batchIds)
        const quizzesWithBatch = (data || []).map(quiz => ({
            ...quiz,
            batch_size: quiz.batch_id ? batchSizes.get(quiz.batch_id) || 1 : 1
        }))

        // SISWA: jangan bocorkan allowed_student_ids (daftar "siapa yang remedial")
        if (user.role === 'SISWA') {
            quizzesWithBatch.forEach(q => { delete (q as any).allowed_student_ids })
        }

        return NextResponse.json(quizzesWithBatch)
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
        const { title, description, start_time, deadline, duration_minutes, available_from, teaching_assignment_id, is_randomized, max_violations, is_remedial, remedial_for_id, allowed_student_ids, duplicate_questions, questions, batch_id, submission_mode } = body

        if (!title || duration_minutes === undefined || !teaching_assignment_id) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // Kuis offline: tanpa soal & tanpa alur publish — langsung aktif,
        // nilai diinput manual dari halaman Nilai.
        const isOffline = submission_mode === 'OFFLINE'

        // Validasi jendela waktu kuis: jam tutup (deadline) harus setelah jam buka
        if (available_from && deadline && new Date(deadline) <= new Date(available_from)) {
            return NextResponse.json({ error: 'Batas waktu (deadline) harus setelah jam buka' }, { status: 400 })
        }

        // Block writes to archived (COMPLETED) academic years
        const yearStatus = await getYearStatusByTA(teaching_assignment_id)
        if (yearStatus === 'COMPLETED') return archivedYearResponse()

        // Tenant guard: TA harus milik sekolah caller — tanpa ini guru bisa
        // menanam kuis di sekolah lain (dan lolos semua guard sekolah itu).
        if ((await findTeachingAssignmentsOutsideSchool([teaching_assignment_id], schoolId)).length > 0) {
            return NextResponse.json({ error: 'Teaching assignment tidak valid' }, { status: 403 })
        }

        // Remedial: kuis sumber harus milik sekolah caller DAN TA yang sama —
        // duplicate_questions menyalin seluruh soal + kunci jawaban; tanpa guard
        // ini guru mana pun bisa exfiltrate soal guru/sekolah lain.
        if (remedial_for_id) {
            if ((await findQuizzesOutsideSchool([remedial_for_id], schoolId)).length > 0) {
                return NextResponse.json({ error: 'Kuis sumber remedial tidak valid' }, { status: 403 })
            }
            const { data: srcQuiz } = await supabase
                .from('quizzes')
                .select('teaching_assignment_id')
                .eq('id', remedial_for_id)
                .single()
            if (srcQuiz?.teaching_assignment_id !== teaching_assignment_id) {
                return NextResponse.json({ error: 'Kuis remedial harus berasal dari kelas & mapel yang sama' }, { status: 400 })
            }
        }

        // Create quiz (default: draft/inactive until published; offline langsung aktif)
        const { data: quiz, error } = await supabase
            .from('quizzes')
            .insert({
                title,
                description,
                start_time,
                deadline: deadline || null,
                duration_minutes,
                available_from: available_from || null,
                teaching_assignment_id,
                is_active: isOffline ? true : false,
                is_randomized: is_randomized ?? true,
                is_remedial: is_remedial || false,
                remedial_for_id: remedial_for_id || null,
                allowed_student_ids: allowed_student_ids || null,
                batch_id: batch_id || null,
                submission_mode: isOffline ? 'OFFLINE' : 'ONLINE'
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

            const { error: questionsError } = await supabase
                .from('quiz_questions')
                .insert(questionsWithQuizId)

            if (questionsError) throw questionsError
        }

        // Handle question duplication if requested for Remedial
        if (is_remedial && remedial_for_id && duplicate_questions) {
            const { data: originalQuestions, error: fetchError } = await supabase
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
                const { error: duplicateError } = await supabase.from('quiz_questions').insert(newQuestions)
                if (duplicateError) throw duplicateError
            }
        }
        // NOTE: Remedial notifications are NOT sent here at creation time
        // because the quiz is still in draft (is_active: false).
        // Notifications will be sent when the guru publishes the quiz
        // (PUT /api/quizzes/[id] with is_active: true).

        return NextResponse.json(quiz)
    } catch (error) {
        console.error('Error creating quiz:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
