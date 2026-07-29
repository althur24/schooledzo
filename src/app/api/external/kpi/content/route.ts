import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/fetchAllRows'

export async function GET(request: NextRequest) {
    try {
        // Security Check
        const apiKey = request.headers.get('x-api-key')
        if (apiKey !== process.env.EXTERNAL_API_SECRET) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const teacherId = request.nextUrl.searchParams.get('teacher_id')
        const academicYearId = request.nextUrl.searchParams.get('academic_year_id')
        const month = request.nextUrl.searchParams.get('month') // Optional filter by month (1-12)
        const schoolId = request.nextUrl.searchParams.get('school_id')
        if (!schoolId) {
            return NextResponse.json({ error: 'school_id parameter is required' }, { status: 400 })
        }

        // Base filter setup
        const applyFilters = (query: any, tablePrefix: string = '') => {
            if (teacherId) {
                // This is tricky because materials/exams link to teaching_assignment, not teacher directly
                // We need to filter by teaching_assignment.teacher_id
                // But Supabase simple filtering doesn't support deep filtering easily on count
                // So we might need to fetch teaching_assignments for this teacher first
            }
            return query
        }

        // Scope sekolah via inner join berjenjang (terbukti di PostgREST deployment ini):
        // teaching_assignments!inner(academic_year:academic_years!inner(school_id)).
        // Tidak perlu materialisasi daftar TA (ratusan–1000+ id → URL overflow 16KB).
        // Catatan: blok getCount()/Promise.all yang lama dihapus — hasilnya tidak pernah
        // dipakai (dead code; respons dibangun dari 4 query di bawah).
        const TA_JOIN = 'teaching_assignment:teaching_assignments!inner(academic_year:academic_years!inner(school_id))'
        const scopeQuery = (query: any) => {
            query = query.eq('teaching_assignment.academic_year.school_id', schoolId)
            if (teacherId) query = query.eq('teaching_assignment.teacher_id', teacherId)
            return query
        }
        // Embed join di-strip agar bentuk baris `details` identik dengan sebelumnya
        const stripJoin = (rows: any[]) => rows.map(({ teaching_assignment, ...rest }) => rest)

        // A1: Materials
        const matData = stripJoin(await fetchAllRows(scopeQuery(
            supabase.from('materials').select(`id, teaching_assignment_id, created_at, type, ${TA_JOIN}`)
        )))

        // A2: Assignments (Tugas)
        const assData = stripJoin(await fetchAllRows(scopeQuery(
            supabase.from('assignments').select(`id, teaching_assignment_id, created_at, due_date, ${TA_JOIN}`).eq('type', 'TUGAS')
        )))

        // A3: Exams
        const examData = stripJoin(await fetchAllRows(scopeQuery(
            supabase.from('exams').select(`id, teaching_assignment_id, created_at, start_time, ${TA_JOIN}`)
        )))

        // A4: Quizzes
        const quizData = stripJoin(await fetchAllRows(scopeQuery(
            supabase.from('quizzes').select(`id, teaching_assignment_id, created_at, ${TA_JOIN}`)
        )))

        return NextResponse.json({
            teacher_id: teacherId || 'all',
            kpi_metrics: {
                a1_materials: {
                    count: matData?.length || 0,
                    details: matData
                },
                a2_assignments: {
                    count: assData?.length || 0,
                    details: assData
                },
                a3_exams: {
                    count: examData?.length || 0,
                    details: examData
                },
                a4_quizzes: {
                    count: quizData?.length || 0,
                    details: quizData
                }
            }
        })
    } catch (error) {
        console.error('Error fetching content KPI:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
