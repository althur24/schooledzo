import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// Diagnostic endpoint to check user's teacher and teaching assignment data
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // H3 Security Fix: Debug routes restricted to ADMIN only
        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        // Get all teachers and find current user (scoped by school)
        let teachersQuery = supabase
            .from('teachers')
            .select(`*, user:users(*)`)
        if (schoolId) teachersQuery = teachersQuery.eq('school_id', schoolId)
        const { data: teachers, error: teachersError } = await teachersQuery

        if (teachersError) throw teachersError

        const myTeacher = teachers?.find((t: any) => t.user?.id === user.id)

        // Get teaching assignments (scoped by school)
        let assignmentsQuery = supabase
            .from('teaching_assignments')
            .select(`
                *,
                teacher:teachers(id, nip),
                subject:subjects(*),
                class:classes(*),
                academic_year:academic_years(*)
            `)
        if (schoolId) assignmentsQuery = assignmentsQuery.eq('school_id', schoolId)
        const { data: assignments, error: assignmentsError } = await assignmentsQuery

        const myAssignments = myTeacher
            ? assignments?.filter((a: any) => a.teacher?.id === myTeacher.id) || []
            : []

        return NextResponse.json({
            user: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                role: user.role
            },
            teacher: myTeacher ? {
                id: myTeacher.id,
                nip: myTeacher.nip,
                user_id: myTeacher.user_id
            } : null,
            teachingAssignments: myAssignments.length,
            assignments: myAssignments.map((a: any) => ({
                id: a.id,
                class: a.class?.name,
                subject: a.subject?.name,
                academic_year: a.academic_year?.year
            })),
            diagnostics: {
                hasTeacherRecord: !!myTeacher,
                hasAssignments: myAssignments.length > 0,
                totalTeachersInDb: teachers?.length || 0,
                totalAssignmentsInDb: assignments?.length || 0
            }
        })
    } catch (error) {
        console.error('Debug error:', error)
        return NextResponse.json({ error: 'Server error', details: String(error) }, { status: 500 })
    }
}
