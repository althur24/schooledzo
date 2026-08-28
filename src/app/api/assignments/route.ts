import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'

// batchedIn per 100 id (batas URL) + fetchAllRows per chunk: satu chunk 100 id
// bisa mengandung >1000 baris submissions yang otherwise terpotong diam-diam.
function batchedFetchAll<T>(column: string, ids: string[], buildQuery: (chunk: string[]) => any): Promise<T[]> {
    return batchedIn<T>(column, ids, async (chunk) => ({ data: await fetchAllRows<T>(buildQuery(chunk)), error: null }))
}

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
        teaching_assignment:teaching_assignments!inner(
          id,
          academic_year_id,
          teacher:teachers(id, user:users(full_name)),
          subject:subjects(name),
          class:classes(id, name),
          academic_year:academic_years(id, name, is_active)
        )
      `)
            .order('created_at', { ascending: false })
            // Tiebreaker stabil untuk paginasi fetchAllRows (created_at bisa identik)
            .order('id', { ascending: false })

        if (teachingAssignmentId) {
            query = query.eq('teaching_assignment_id', teachingAssignmentId)
        } else if (allYears !== 'true') {
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

                if (user.role === 'GURU') {
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
                } else if (user.role === 'SISWA') {
                    const { data: student } = await supabase
                        .from('students')
                        .select('class_id')
                        .eq('user_id', user.id)
                        .single()

                    if (student?.class_id) {
                        query = query.eq('teaching_assignment.class_id', student.class_id)
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

        // fetchAllRows: ADMIN mendapat seluruh tugas tahun aktif sekolah —
        // query biasa terpotong diam-diam di 1000 baris.
        const data = await fetchAllRows(query)

        // Fetch submission counts for all assignments
        if (data && data.length > 0) {
            const assignmentIds = data.map((a: any) => a.id)
            const subData = await batchedFetchAll<any>(
                'assignment_id', assignmentIds,
                (chunk) => supabase
                    .from('student_submissions')
                    .select('id, assignment_id, grade:grades(id)')
                    .in('assignment_id', chunk)
                    .order('id')
            )

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

        // Block writes to archived (COMPLETED) academic years
        const yearStatus = await getYearStatusByTA(teaching_assignment_id)
        if (yearStatus === 'COMPLETED') return archivedYearResponse()

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
