import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'
import { getTeacherScope, ownsTeachingAssignment } from '@/lib/teacherScope'
import { getBatchSizes } from '@/lib/examBatch'

// GET all exams
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const teachingAssignmentId = request.nextUrl.searchParams.get('teaching_assignment_id')
        const allYears = request.nextUrl.searchParams.get('all_years')

        let query = supabase
            .from('exams')
            .select(`
                *,
                teaching_assignment:teaching_assignments!inner(
                    id,
                    academic_year_id,
                    teacher:teachers(id, user:users(full_name)),
                    subject:subjects(id, name, kkm),
                    class:classes(id, name, school_level, grade_level),
                    academic_year:academic_years(id, name, is_active)
                ),
                exam_questions(id)
            `)
            .order('created_at', { ascending: false })

        if (teachingAssignmentId) {
            query = query.eq('teaching_assignment_id', teachingAssignmentId)
        } else if (allYears !== 'true') {
            // Filter by active year — via inner join (NOT .in(list): hundreds of TA ids
            // overflow the 16KB header limit at larger schools and break this endpoint)
            // Tahan kasus 2 tahun aktif: ambil terbaru + peringatan (index DB mencegah sisanya)
            const { data: activeYears } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .order('created_at', { ascending: false })
                .limit(2)
            if ((activeYears || []).length > 1) {
                console.warn(`[exams] Sekolah ${schoolId} punya ${activeYears!.length} tahun aktif — pakai yang terbaru`)
            }
            const activeYear = activeYears?.[0] || null

            if (activeYear) {
                query = query.eq('teaching_assignment.academic_year_id', activeYear.id)

                // STRICT FILTERING FOR SISWA
                if (user.role === 'SISWA') {
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
                // ADMIN: active-year filter above is sufficient
            } else {
                // No active year: return empty instead of leaking content across years
                return NextResponse.json([])
            }
        }

        const { data, error } = await query

        if (error) throw error

        // Label pembuat (untuk badge "Dibuatkan Admin" di daftar guru)
        let roleMap = new Map<string, string>()
        const creatorIds = [...new Set((data || []).map((e: any) => e.created_by).filter(Boolean))] as string[]
        if (creatorIds.length > 0) {
            const { data: creators } = await supabase.from('users').select('id, role').in('id', creatorIds)
            roleMap = new Map((creators || []).map((c: any) => [c.id, c.role]))
        }

        // Ukuran batch (untuk badge "N Kelas Paralel" di daftar guru)
        const batchIds = [...new Set((data || []).map((e: any) => e.batch_id).filter(Boolean))] as string[]
        const batchSizes = await getBatchSizes('exams', batchIds)

        // Add question count
        const examsWithCount = data?.map(exam => ({
            ...exam,
            question_count: exam.exam_questions?.length || 0,
            exam_questions: undefined,
            creator_role: exam.created_by ? roleMap.get(exam.created_by) || null : null,
            batch_size: exam.batch_id ? batchSizes.get(exam.batch_id) || 1 : 1
        }))

        return NextResponse.json(examsWithCount)
    } catch (error) {
        console.error('Error fetching exams:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST create new exam
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { title, description, start_time, duration_minutes, window_end_time, teaching_assignment_id, is_randomized, max_violations, is_remedial, remedial_for_id, allowed_student_ids, duplicate_questions, duplicate_from_exam_id, show_results_immediately, batch_id } = body

        if (!title || !start_time || duration_minutes === undefined || !teaching_assignment_id) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // Validasi jendela waktu: jam tutup harus setelah jam buka
        if (window_end_time && new Date(window_end_time) <= new Date(start_time)) {
            return NextResponse.json({ error: 'Jam tutup jendela waktu harus setelah jam buka' }, { status: 400 })
        }

        // Validasi TA + kepemilikan: ADMIN boleh TA mana pun di sekolahnya (buat untuk guru);
        // GURU hanya boleh TA miliknya sendiri (pengetatan — sebelumnya tidak dicek).
        const { data: ta } = await supabase
            .from('teaching_assignments')
            .select('id, teacher_id, teacher:teachers(school_id)')
            .eq('id', teaching_assignment_id)
            .single()
        if (!ta) {
            return NextResponse.json({ error: 'Teaching assignment tidak ditemukan' }, { status: 404 })
        }
        if (user.role === 'ADMIN') {
            const taSchoolId = (ta.teacher as any)?.school_id
            if (schoolId && taSchoolId && taSchoolId !== schoolId) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        } else {
            const scope = await getTeacherScope(user.id)
            if (!ownsTeachingAssignment(scope, ta.teacher_id)) {
                return NextResponse.json({ error: 'Anda hanya dapat membuat ulangan untuk penugasan Anda sendiri' }, { status: 403 })
            }
        }

        // Block writes to archived (COMPLETED) academic years
        const yearStatus = await getYearStatusByTA(teaching_assignment_id)
        if (yearStatus === 'COMPLETED') return archivedYearResponse()

        const { data, error } = await supabase
            .from('exams')
            .insert({
                title,
                description,
                start_time,
                duration_minutes,
                window_end_time: window_end_time || null,
                teaching_assignment_id,
                is_active: false,
                is_randomized: is_randomized || false,
                max_violations: max_violations || 3,
                is_remedial: is_remedial || false,
                remedial_for_id: remedial_for_id || null,
                allowed_student_ids: allowed_student_ids || null,
                show_results_immediately: show_results_immediately ?? true,
                batch_id: batch_id || null,
                created_by: user.id
            })
            .select()
            .single()

        if (error) throw error

        // Handle question duplication: remedial (salin dari exam sumber remedial)
        // atau duplikasi biasa (duplicate_from_exam_id, meniru official-exams/duplicate)
        const duplicateSourceId = duplicate_from_exam_id || (is_remedial ? remedial_for_id : null)
        if (duplicate_questions && duplicateSourceId) {
            const { data: originalQuestions, error: fetchError } = await supabase
                .from('exam_questions')
                .select('*')
                .eq('exam_id', duplicateSourceId)

            if (fetchError) {
                console.error('Error fetching source questions for duplicate:', fetchError)
                await supabase.from('exams').delete().eq('id', data.id)
                return NextResponse.json({ error: 'Gagal membaca soal sumber. Duplikasi dibatalkan.' }, { status: 500 })
            }

            if (originalQuestions && originalQuestions.length > 0) {
                const newQuestions = originalQuestions.map((q: any) => ({
                    exam_id: data.id,
                    question_text: q.question_text,
                    question_type: q.question_type,
                    options: q.options,
                    correct_answer: q.correct_answer,
                    points: q.points,
                    order_index: q.order_index,
                    difficulty: q.difficulty,
                    passage_text: q.passage_text,
                    passage_audio_url: q.passage_audio_url,
                    image_url: q.image_url,
                    status: q.status, // Inherit approval status
                    teacher_hots_claim: q.teacher_hots_claim,
                    text_direction: q.text_direction,
                    content_format: q.content_format
                }))
                const { error: duplicateError } = await supabase.from('exam_questions').insert(newQuestions)
                if (duplicateError) {
                    console.error('Error inserting duplicated questions:', duplicateError)
                    await supabase.from('exams').delete().eq('id', data.id)
                    return NextResponse.json({ error: 'Gagal menyalin soal. Duplikasi dibatalkan.' }, { status: 500 })
                }
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
                    const startDate = new Date(start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
                    await supabase.from('notifications').insert(
                        students.map((s: any) => ({
                            user_id: s.user_id,
                            type: 'REMEDIAL',
                            title: `Remedial Ulangan: ${title}`,
                            message: `Ulangan remedial telah dibuat untuk Anda. Mulai: ${startDate}`,
                            link: '/dashboard/siswa/ulangan'
                        }))
                    )
                }
            } catch (notifError) {
                console.error('Error sending remedial notification:', notifError)
            }
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error creating exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
