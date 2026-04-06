import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { checkEndedOfficialExams } from '@/lib/checkEndedExams'

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
                subject:subjects(id, name),
                academic_year:academic_years(id, name, is_active),
                official_exam_questions(id)
            `)
            .eq('school_id', schoolId)
            .order('created_at', { ascending: false })

        // Filter by active year by default
        const { data: activeYear } = await supabase
            .from('academic_years')
            .select('id')
            .eq('is_active', true)
            .eq('school_id', schoolId)
            .single()

        if (activeYear) {
            query = query.eq('academic_year_id', activeYear.id)
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
            // Get student's class_id
            const { data: student } = await supabase
                .from('students')
                .select('class_id')
                .eq('user_id', user.id)
                .single()

            if (student?.class_id) {
                result = result.filter((exam: any) =>
                    exam.target_class_ids?.includes(student.class_id)
                )
            } else {
                result = []
            }
            // Show active exams AND upcoming scheduled exams to students
            result = result.filter((exam: any) => {
                if (exam.is_active) return true
                // Also show upcoming exams (not yet active, but scheduled in the future)
                const endTime = new Date(new Date(exam.start_time).getTime() + exam.duration_minutes * 60 * 1000)
                return endTime > new Date()
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
            // Guru sees active exams + exams that have ended (time-based)
            result = result.filter((exam: any) => {
                if (exam.is_active) return true
                // Also show exams whose time has passed (ended naturally)
                const endTime = new Date(new Date(exam.start_time).getTime() + exam.duration_minutes * 60 * 1000)
                return endTime < new Date()
            })
        }
        // ADMIN sees everything (no filter)

        // Add question count
        const examsWithCount = result.map((exam: any) => ({
            ...exam,
            question_count: exam.official_exam_questions?.length || 0,
            official_exam_questions: undefined
        }))

        return NextResponse.json(examsWithCount)
    } catch (error) {
        console.error('Error fetching official exams:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST create new official exam
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const {
            exam_type, title, description, subject_id,
            start_time, duration_minutes, is_randomized,
            max_violations, target_class_ids, academic_year_id,
            show_results_immediately
        } = body

        if (!exam_type || !title || !subject_id || !start_time || !target_class_ids?.length) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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
                is_randomized: is_randomized ?? true,
                max_violations: max_violations || 3,
                target_class_ids,
                created_by: user.id,
                is_active: false,
                show_results_immediately: show_results_immediately ?? true
            })
            .select(`
                *,
                subject:subjects(id, name),
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
