import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET submissions for an assignment
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const assignmentId = request.nextUrl.searchParams.get('assignment_id')
        const studentId = request.nextUrl.searchParams.get('student_id')
        const allYears = request.nextUrl.searchParams.get('all_years')

        let query = supabase
            .from('student_submissions')
            .select(`
        *,
        student:students(
          id,
          nis,
           user:users!students_user_id_fkey(full_name)
        ),
        assignment:assignments(
          id,
          title,
          type,
          teaching_assignment:teaching_assignments(
            academic_year_id,
            subject:subjects(name)
          )
        ),
        grade:grades(*)
      `)
            .order('submitted_at', { ascending: false })

        if (assignmentId) {
            query = query.eq('assignment_id', assignmentId)
        }
        if (studentId) {
            query = query.eq('student_id', studentId)
        }

        // Filter by active year when no specific assignment is requested
        if (!assignmentId && allYears !== 'true') {
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
                    // Get assignment IDs for active year's TAs
                    const { data: assignmentIds } = await supabase
                        .from('assignments')
                        .select('id')
                        .in('teaching_assignment_id', taIds.map(t => t.id))

                    if (assignmentIds && assignmentIds.length > 0) {
                        query = query.in('assignment_id', assignmentIds.map(a => a.id))
                    } else {
                        return NextResponse.json([])
                    }
                } else {
                    return NextResponse.json([])
                }
            }
        }

        const { data, error } = await query

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching submissions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST new submission (for students)
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'SISWA') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { assignment_id, answers } = await request.json()

        if (!assignment_id) {
            return NextResponse.json({ error: 'Assignment ID diperlukan' }, { status: 400 })
        }

        // Get student record
        const { data: student } = await supabase
            .from('students')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (!student) {
            return NextResponse.json({ error: 'Student not found' }, { status: 404 })
        }

        // Check for existing submission
        const { data: existing } = await supabase
            .from('student_submissions')
            .select('id')
            .eq('assignment_id', assignment_id)
            .eq('student_id', student.id)
            .single()

        if (existing) {
            // Update existing
            const { data, error } = await supabase
                .from('student_submissions')
                .update({ answers, submitted_at: new Date().toISOString() })
                .eq('id', existing.id)
                .select()
                .single()

            if (error) throw error
            return NextResponse.json(data)
        }

        // Create new
        const { data, error } = await supabase
            .from('student_submissions')
            .insert({ assignment_id, student_id: student.id, answers })
            .select()
            .single()

        if (error) throw error

        // Notify the teacher about new submission
        try {
            const { data: assignment } = await supabase
                .from('assignments')
                .select(`
                    title,
                    teaching_assignment:teaching_assignments(
                        teacher:teachers(user_id)
                    )
                `)
                .eq('id', assignment_id)
                .single()

            const teacherUserId = (assignment?.teaching_assignment as any)?.teacher?.user_id
            if (teacherUserId) {
                await supabase.from('notifications').insert({
                    user_id: teacherUserId,
                    type: 'SUBMISSION_BARU',
                    title: `Submission Baru`,
                    message: `${user.full_name} telah mengumpulkan ${assignment?.title}`,
                    link: '/dashboard/guru/nilai'
                })
            }
        } catch (notifError) {
            console.error('Error sending submission notification:', notifError)
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error creating submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
