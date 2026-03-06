import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET all assignments
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const teachingAssignmentId = request.nextUrl.searchParams.get('teaching_assignment_id')
        const allYears = request.nextUrl.searchParams.get('all_years')

        let query = supabase
            .from('assignments')
            .select(`
        *,
        teaching_assignment:teaching_assignments(
          id,
          academic_year_id,
          teacher:teachers(id, user:users(full_name)),
          subject:subjects(name),
          class:classes(id, name),
          academic_year:academic_years(id, name, is_active)
        )
      `)
            .order('created_at', { ascending: false })

        if (teachingAssignmentId) {
            query = query.eq('teaching_assignment_id', teachingAssignmentId)
        } else if (allYears !== 'true') {
            // Filter by active year
            const { data: activeYear } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .single()

            if (activeYear) {
                let taQuery = supabase
                    .from('teaching_assignments')
                    .select('id')
                    .eq('academic_year_id', activeYear.id)

                if (user.role === 'GURU') {
                    const { data: teacher } = await supabase
                        .from('teachers')
                        .select('id')
                        .eq('user_id', user.id)
                        .single()

                    if (teacher) {
                        taQuery = taQuery.eq('teacher_id', teacher.id)
                    } else {
                        return NextResponse.json([])
                    }
                }

                const { data: taIds } = await taQuery

                if (taIds && taIds.length > 0) {
                    query = query.in('teaching_assignment_id', taIds.map(t => t.id))
                } else {
                    return NextResponse.json([])
                }
            }
        }

        const { data, error } = await query

        if (error) throw error

        // Fetch submission counts for all assignments
        if (data && data.length > 0) {
            const assignmentIds = data.map((a: any) => a.id)
            const { data: subData } = await supabase
                .from('student_submissions')
                .select('id, assignment_id, grade:grades(id)')
                .in('assignment_id', assignmentIds)

            // Count submissions and ungarded ones per assignment
            const countMap: Record<string, { total: number, ungraded: number }> = {}
            if (subData) {
                for (const s of subData) {
                    const aId = s.assignment_id
                    if (!countMap[aId]) countMap[aId] = { total: 0, ungraded: 0 }
                    countMap[aId].total++
                    if (!s.grade || s.grade.length === 0) {
                        countMap[aId].ungraded++
                    }
                }
            }

            // Merge counts into assignments
            const enriched = data.map((a: any) => ({
                ...a,
                submissions: [{ count: countMap[a.id]?.total || 0 }],
                need_grading_count: countMap[a.id]?.ungraded || 0
            }))

            return NextResponse.json(enriched)
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching assignments:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST new assignment
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { teaching_assignment_id, title, description, type, due_date } = await request.json()

        if (!teaching_assignment_id || !title || !type) {
            return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('assignments')
            .insert({ teaching_assignment_id, title, description, type, due_date })
            .select()
            .single()

        if (error) throw error

        // Send notifications to all students in the class
        try {
            // Get the teaching assignment to find the class
            const { data: ta } = await supabase
                .from('teaching_assignments')
                .select('class_id, subject:subjects(name)')
                .eq('id', teaching_assignment_id)
                .single()

            if (ta?.class_id) {
                // Get the active academic year
                const { data: activeYear } = await supabase
                    .from('academic_years')
                    .select('id')
                    .eq('is_active', true)
                    .eq('school_id', schoolId)
                    .single()

                if (activeYear) {
                    const { data: enrollments } = await supabase
                        .from('student_enrollments')
                        .select('student:students(user_id)')
                        .eq('academic_year_id', activeYear.id)
                        .eq('class_id', ta.class_id)

                    if (enrollments && enrollments.length > 0) {
                        const userIds = enrollments.map((e: any) => e.student.user_id)
                        const notifType = type === 'TUGAS' ? 'TUGAS_BARU' : 'TUGAS_BARU'
                        const subjectName = (ta.subject as any)?.name || ''

                        await supabase.from('notifications').insert(
                            userIds.map((uid: string) => ({
                                user_id: uid,
                                type: notifType,
                                title: `${type === 'TUGAS' ? 'Tugas' : 'Ulangan'} Baru: ${title}`,
                                message: `${subjectName}${due_date ? ` - Deadline: ${new Date(due_date).toLocaleDateString('id-ID')}` : ''}`,
                                link: '/dashboard/siswa/tugas'
                            }))
                        )
                    }
                }
            }
        } catch (notifError) {
            console.error('Error sending notifications:', notifError)
            // Don't fail the request if notification fails
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error creating assignment:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
