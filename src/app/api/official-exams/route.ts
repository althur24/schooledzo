import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { checkEndedOfficialExams } from '@/lib/checkEndedExams'
import { logError } from '@/lib/logError'
import { getTeacherScope, canTeachScope } from '@/lib/teacherScope'

// GET all official exams (UTS/UAS)
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // Fire-and-forget: check for ended exams and notify teachers
        if (schoolId) {
            checkEndedOfficialExams(schoolId).catch(err =>
                console.error('checkEndedOfficialExams error:', err)
            )
        }

        const examType = request.nextUrl.searchParams.get('exam_type')
        const subjectId = request.nextUrl.searchParams.get('subject_id')

        let query = supabase
            .from('official_exams')
            .select(`
                *,
                subject:subjects(id, name, kkm),
                academic_year:academic_years(id, name, is_active),
                official_exam_questions(id)
            `)
            .eq('school_id', schoolId)
            .order('created_at', { ascending: false })

        // Filter by active year by default (tahan kasus 2 tahun aktif: ambil terbaru + peringatan)
        const { data: activeYears } = await supabase
            .from('academic_years')
            .select('id')
            .eq('is_active', true)
            .eq('school_id', schoolId)
            .order('created_at', { ascending: false })
            .limit(2)
        if ((activeYears || []).length > 1) {
            console.warn(`[official-exams] Sekolah ${schoolId} punya ${activeYears!.length} tahun aktif — pakai yang terbaru`)
        }
        const activeYear = activeYears?.[0] || null

        if (activeYear) {
            query = query.eq('academic_year_id', activeYear.id)
        } else {
            // No active year: return empty instead of leaking content across years
            // (sebelumnya jatuh ke SEMUA tahun — ujian tahun lalu tiba-tiba muncul)
            return NextResponse.json([])
        }

        if (examType) {
            query = query.eq('exam_type', examType)
        }
        if (subjectId) {
            query = query.eq('subject_id', subjectId)
        }

        const { data, error } = await query
        if (error) throw error

        let result = data || []

        // Role-based filtering
        if (user.role === 'SISWA') {
            // Kelas siswa: utamakan enrollment ACTIVE di tahun aktif (selaras jalur
            // notifikasi), fallback ke students.class_id
            const { data: student } = await supabase
                .from('students')
                .select('id, class_id')
                .eq('user_id', user.id)
                .single()

            let studentClassId = student?.class_id || null
            if (student && activeYear) {
                const { data: enrollment } = await supabase
                    .from('student_enrollments')
                    .select('class_id')
                    .eq('student_id', student.id)
                    .eq('academic_year_id', activeYear.id)
                    .eq('status', 'ACTIVE')
                    .maybeSingle()
                if (enrollment?.class_id) studentClassId = enrollment.class_id
            }

            if (studentClassId) {
                result = result.filter((exam: any) =>
                    exam.target_class_ids?.includes(studentClassId)
                )
            } else {
                result = []
            }
            // Only show PUBLISHED (is_active) exams to students
            // Unpublished (draft) exams must never be visible to students
            result = result.filter((exam: any) => {
                if (!exam.is_active) return false
                
                // Remedial visibility rule
                if (exam.is_remedial && exam.allowed_student_ids && exam.allowed_student_ids.length > 0) {
                    return student ? exam.allowed_student_ids.includes(student.id) : false
                }
                return true
            })
        } else if (user.role === 'GURU') {
            // Get teacher's teaching assignments (subject_id + class_id combos)
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()

            if (teacher) {
                const { data: assignments } = await supabase
                    .from('teaching_assignments')
                    .select('subject_id, class_id')
                    .eq('teacher_id', teacher.id)
                    .eq('academic_year_id', activeYear?.id || '')

                if (assignments && assignments.length > 0) {
                    const teacherSubjectIds = [...new Set(assignments.map(a => a.subject_id))]
                    const teacherClassIds = [...new Set(assignments.map(a => a.class_id))]

                    result = result.filter((exam: any) =>
                        teacherSubjectIds.includes(exam.subject_id) &&
                        exam.target_class_ids?.some((cid: string) => teacherClassIds.includes(cid))
                    )
                } else {
                    result = []
                }
            } else {
                result = []
            }
            // Guru melihat SEMUA ujian dalam scope mapel×kelas-nya — termasuk draft.
            // Draft buatan admin untuk guru harus tampil agar bisa dilengkapi & dipublish guru.
        }
        // ADMIN sees everything (no filter)

        // Label pembuat (untuk badge "Dibuatkan Admin" di daftar guru)
        let roleMap = new Map<string, string>()
        const creatorIds = [...new Set(result.map((e: any) => e.created_by).filter(Boolean))] as string[]
        if (creatorIds.length > 0) {
            const { data: creators } = await supabase.from('users').select('id, role').in('id', creatorIds)
            roleMap = new Map((creators || []).map((c: any) => [c.id, c.role]))
        }

        // Add question count
        const examsWithCount = result.map((exam: any) => ({
            ...exam,
            question_count: exam.official_exam_questions?.length || 0,
            official_exam_questions: undefined,
            creator_role: exam.created_by ? roleMap.get(exam.created_by) || null : null
        }))

        return NextResponse.json(examsWithCount)
    } catch (error) {
        logError('Error fetching official exams', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST create new official exam
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN' && user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const {
            exam_type, title, description, subject_id,
            start_time, duration_minutes, window_end_time, is_randomized,
            max_violations, target_class_ids, academic_year_id,
            show_results_immediately
        } = body

        if (!exam_type || !title || !subject_id || !start_time || !target_class_ids?.length) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // Validasi jendela waktu: jam tutup harus setelah jam buka
        if (window_end_time && new Date(window_end_time) <= new Date(start_time)) {
            return NextResponse.json({ error: 'Jam tutup jendela waktu harus setelah jam buka' }, { status: 400 })
        }

        // Use provided academic_year_id or fall back to active year
        let yearId = academic_year_id
        if (!yearId) {
            const { data: activeYear } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .single()
            yearId = activeYear?.id
        }

        if (!yearId) {
            return NextResponse.json({ error: 'No active academic year found' }, { status: 400 })
        }

        // GURU hanya boleh membuat untuk mapel & kelas yang diajar di tahun tsb (scope ketat);
        // ADMIN tidak dibatasi (boleh membuat untuk guru mana pun)
        if (user.role === 'GURU') {
            const scope = await getTeacherScope(user.id, yearId)
            if (!canTeachScope(scope, subject_id, target_class_ids)) {
                return NextResponse.json({ error: 'Anda hanya dapat membuat ujian untuk mapel dan kelas yang Anda ajar' }, { status: 403 })
            }
        }

        const { data, error } = await supabase
            .from('official_exams')
            .insert({
                school_id: schoolId,
                academic_year_id: yearId,
                subject_id,
                exam_type,
                title,
                description: description || null,
                start_time,
                duration_minutes: duration_minutes || 90,
                window_end_time: window_end_time || null,
                is_randomized: is_randomized ?? true,
                max_violations: max_violations || 3,
                target_class_ids,
                created_by: user.id,
                is_active: false,
                show_results_immediately: show_results_immediately ?? true
            })
            .select(`
                *,
                subject:subjects(id, name, kkm),
                academic_year:academic_years(id, name)
            `)
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error creating official exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
