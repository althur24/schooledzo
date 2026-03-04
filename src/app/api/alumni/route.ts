import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const school_level = searchParams.get('school_level')
        const angkatan = searchParams.get('angkatan')
        const search = searchParams.get('search')

        let query = supabase
            .from('students')
            .select(`
                *,
                user:users!students_user_id_fkey(id, username, full_name, role),
                enrollments:student_enrollments!student_enrollments_student_id_fkey(
                    id,
                    status,
                    ended_at,
                    notes,
                    class:classes!student_enrollments_class_id_fkey(id, name, grade_level, school_level),
                    academic_year:academic_years!student_enrollments_academic_year_id_fkey(id, name)
                )
            `)
            .eq('status', 'GRADUATED')
            .eq('school_id', schoolId)
            .order('created_at', { ascending: false })

        if (school_level) {
            query = query.eq('school_level', school_level)
        }
        if (angkatan) {
            query = query.eq('angkatan', angkatan)
        }

        const { data, error } = await query

        if (error) {
            console.error('Supabase query error:', error)
            throw error
        }

        // Process and flatten the data
        let formattedData = (data || []).map((student: any) => {
            const graduationEnrollment = (student.enrollments || []).find((e: any) => e.status === 'GRADUATED') ||
                (student.enrollments || []).sort((a: any, b: any) =>
                    new Date(b.ended_at || 0).getTime() - new Date(a.ended_at || 0).getTime()
                )[0]

            return {
                ...student,
                graduation_info: graduationEnrollment ? {
                    ended_at: graduationEnrollment.ended_at,
                    notes: graduationEnrollment.notes,
                    class: graduationEnrollment.class,
                    academic_year: graduationEnrollment.academic_year
                } : null,
                enrollments: undefined
            }
        })

        // Server-side search filtering (by name or NIS)
        if (search) {
            const q = search.toLowerCase()
            formattedData = formattedData.filter((s: any) =>
                s.user?.full_name?.toLowerCase().includes(q) ||
                s.nis?.toLowerCase().includes(q) ||
                s.user?.username?.toLowerCase().includes(q)
            )
        }

        return NextResponse.json(formattedData)
    } catch (error) {
        console.error('Error fetching alumni:', error)
        return NextResponse.json({ error: 'Failed to fetch alumni' }, { status: 500 })
    }
}
