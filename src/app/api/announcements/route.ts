import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { fetchAllRows } from '@/lib/fetchAllRows'

// GET /api/announcements - Fetch announcements
export async function GET(req: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(req)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const { searchParams } = new URL(req.url)
        const classId = searchParams.get('class_id')
        const limit = parseInt(searchParams.get('limit') || '20')

        let query = supabase
            .from('announcements')
            .select(`
                *,
                created_by_user:users!announcements_created_by_fkey(id, full_name)
            `)
            .eq('is_active', true)
            .order('published_at', { ascending: false })
            .limit(limit)

        // School filter
        if (schoolId) query = query.eq('school_id', schoolId)

        // Filter by class for students
        if (user.role === 'SISWA' && classId) {
            query = query.or(`is_global.eq.true,class_ids.cs.{${classId}}`)
        }

        // Filter expired announcements
        query = query.or('expires_at.is.null,expires_at.gt.now()')

        const { data, error } = await query

        if (error) {
            console.error('Error fetching announcements:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json(data || [])
    } catch (error) {
        console.error('Error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

// POST /api/announcements - Create announcement (Admin only)
export async function POST(req: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(req)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await req.json()
        const { title, content, is_global, class_ids, expires_at } = body

        if (!title || !content) {
            return NextResponse.json({ error: 'Title and content are required' }, { status: 400 })
        }

        // Validate class_ids belong to this school
        if (!is_global && class_ids && class_ids.length > 0 && schoolId) {
            const { data: validClasses } = await supabase
                .from('classes')
                .select('id, academic_year:academic_years!inner(school_id)')
                .in('id', class_ids)

            const invalidIds = class_ids.filter((cid: string) =>
                !validClasses?.some((vc: any) => vc.id === cid && vc.academic_year?.school_id === schoolId)
            )
            if (invalidIds.length > 0) {
                return NextResponse.json({ error: 'Beberapa kelas tidak ditemukan di sekolah ini' }, { status: 400 })
            }
        }

        const { data, error } = await supabase
            .from('announcements')
            .insert({
                title,
                content,
                is_global: is_global || false,
                class_ids: is_global ? [] : (class_ids || []),
                created_by: user.id,
                expires_at: expires_at || null,
                is_active: true,
                school_id: schoolId
            })
            .select()
            .single()

        if (error) {
            console.error('Error creating announcement:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // Send notifications to students (scoped to same school)
        try {
            let studentsQuery = supabase
                .from('students')
                .select('user_id, class_id')

            if (schoolId) studentsQuery = studentsQuery.eq('school_id', schoolId)

            if (!is_global && class_ids && class_ids.length > 0) {
                studentsQuery = studentsQuery.in('class_id', class_ids)
            }

            // fetchAllRows: sekolah besar punya >1000 siswa — query biasa terpotong
            // diam-diam dan sebagian siswa tidak menerima notifikasi pengumuman
            const students = await fetchAllRows(studentsQuery)

            if (students && students.length > 0) {
                const notifications = students.map(student => ({
                    user_id: student.user_id,
                    type: 'PENGUMUMAN',
                    title: `📢 ${title}`,
                    message: content.length > 100 ? content.substring(0, 100) + '...' : content,
                    link: '/dashboard/siswa'
                }))

                await supabase.from('notifications').insert(notifications)
            }
        } catch (notifError) {
            console.error('Error sending notifications:', notifError)
        }

        return NextResponse.json(data, { status: 201 })
    } catch (error) {
        console.error('Error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
