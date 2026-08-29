import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { resolveAssignmentSchoolId, tenantMismatch } from '@/lib/tenantGuard'
import { fetchAllRows } from '@/lib/fetchAllRows'

// GET submissions for an assignment
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const assignmentId = request.nextUrl.searchParams.get('assignment_id')
        const studentId = request.nextUrl.searchParams.get('student_id')
        const allYears = request.nextUrl.searchParams.get('all_years')
        const includeMissing = request.nextUrl.searchParams.get('include_missing')

        let query = supabase
            .from('student_submissions')
            .select(`
        *,
        student:students(
          id,
          nis,
           user:users!students_user_id_fkey(full_name)
        ),
        assignment:assignments!inner(
          id,
          title,
          type,
          teaching_assignment:teaching_assignments!inner(
            academic_year_id,
            subject:subjects(name)
          )
        ),
        grade:grades(*)
      `)
            .order('submitted_at', { ascending: false })
            // Tiebreaker stabil untuk paginasi fetchAllRows (submitted_at banyak duplikat/NULL)
            .order('id', { ascending: false })

        if (assignmentId) {
            // Tenant guard: tugas harus milik sekolah caller (param client dipercaya)
            if (tenantMismatch(await resolveAssignmentSchoolId(assignmentId), schoolId)) {
                return NextResponse.json([])
            }
            query = query.eq('assignment_id', assignmentId)
        }
        if (studentId) {
            query = query.eq('student_id', studentId)
        }

        // S6 Security Fix: Auto-scope to student's own submissions for SISWA role
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students').select('id').eq('user_id', user.id).single()
            if (student) {
                query = query.eq('student_id', student.id)
            } else {
                return NextResponse.json([])
            }
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
                // Inner join filter replaces the old two-hop .in(list): hundreds of TA ids
                // overflow the 16KB header limit at larger schools and break this endpoint
                query = query.eq('assignment.teaching_assignment.academic_year_id', activeYear.id)

                // STRICT FILTERING FOR GURU: only submissions to own teaching assignments
                if (user.role === 'GURU') {
                    const { data: teacher } = await supabase
                        .from('teachers')
                        .select('id')
                        .eq('user_id', user.id)
                        .single()

                    if (teacher) {
                        query = query.eq('assignment.teaching_assignment.teacher_id', teacher.id)
                    } else {
                        return NextResponse.json([])
                    }
                }
            } else {
                // No active year: return empty instead of leaking content across years
                return NextResponse.json([])
            }
        }

        // fetchAllRows: guru/admin tanpa assignment_id mendapat semua submission
        // tahun aktif — query biasa terpotong diam-diam di 1000 baris.
        const data = await fetchAllRows(query)

        if (assignmentId && includeMissing === 'true') {
            const { data: assignmentInfo } = await supabase
                .from('assignments')
                .select('teaching_assignment:teaching_assignments(class_id, academic_year_id)')
                .eq('id', assignmentId).single()
            
            const classId = (assignmentInfo?.teaching_assignment as any)?.class_id
            const yearId = (assignmentInfo?.teaching_assignment as any)?.academic_year_id
            
            let missingStudents: any[] = []
            
            if (classId && yearId) {
                const { data: enrollments } = await supabase
                    .from('student_enrollments')
                    .select('student:students(id, nis, user:users!students_user_id_fkey(full_name))')
                    .eq('class_id', classId)
                    .eq('academic_year_id', yearId)
                
                const submittedIds = new Set(data.map((s: any) => s.student_id))
                
                if (enrollments) {
                    missingStudents = enrollments
                        .filter((e: any) => !submittedIds.has(e.student?.id))
                        .map((e: any) => e.student)
                }
            }
            
            return NextResponse.json({ submissions: data, missing_students: missingStudents })
        }

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

        const { assignment_id, answers, attachments } = await request.json()

        if (!assignment_id) {
            return NextResponse.json({ error: 'Assignment ID diperlukan' }, { status: 400 })
        }

        // Auto-detect late submission
        let isLate = false
        if (assignment_id) {
            const { data: assignment } = await supabase
                .from('assignments')
                .select('due_date')
                .eq('id', assignment_id)
                .single()
            
            if (assignment?.due_date && new Date() > new Date(assignment.due_date)) {
                isLate = true
            }
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
                .update({ 
                    answers, 
                    attachments,
                    is_late: isLate,
                    submitted_at: new Date().toISOString() 
                })
                .eq('id', existing.id)
                .select()
                .single()

            if (error) throw error
            return NextResponse.json(data)
        }

        // Create new
        const { data, error } = await supabase
            .from('student_submissions')
            .insert({ 
                assignment_id, 
                student_id: student.id, 
                answers,
                attachments,
                is_late: isLate
            })
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
