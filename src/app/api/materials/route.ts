import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { archivedYearResponse } from '@/lib/academicYear'

// M2: Service Role Key required because app uses custom auth (not Supabase Auth),
// so RLS policies depending on auth.uid() won't work. Role checks enforce authorization.
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET all materials
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const teachingAssignmentId = request.nextUrl.searchParams.get('teaching_assignment_id')
        const allYears = request.nextUrl.searchParams.get('all_years')

        let query = supabase
            .from('materials')
            .select(`
        *,
          teaching_assignment:teaching_assignments!inner(
          id,
          academic_year_id,
          teacher:teachers(id, user:users(full_name)),
          subject:subjects(id, name),
          class:classes(name),
          academic_year:academic_years(id, name, is_active)
        )
      `)
            .order('created_at', { ascending: false })

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
            } else {
                // No active year: return empty instead of leaking content across years
                return NextResponse.json([])
            }
        }

        const { data, error } = await query

        if (error) throw error

        return NextResponse.json(data)
    } catch (error: any) {
        console.error('Error fetching materials:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST new material (supports one or many teaching assignments)
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (!['GURU', 'ADMIN'].includes(user.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { title, description, type, content_url, content_text } = body

        // Accept teaching_assignment_ids[] (new) or legacy single teaching_assignment_id
        const taIds: string[] = Array.isArray(body.teaching_assignment_ids) && body.teaching_assignment_ids.length > 0
            ? body.teaching_assignment_ids
            : body.teaching_assignment_id ? [body.teaching_assignment_id] : []

        if (taIds.length === 0 || !title || !type) {
            return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 })
        }

        // Verify every assignment exists, belongs to this school, and is not in an archived year
        const { data: tas, error: taError } = await supabase
            .from('teaching_assignments')
            .select('id, class_id, subject:subjects(name), teacher:teachers(user_id), academic_year:academic_years(school_id, status)')
            .in('id', taIds)

        if (taError) throw taError

        const foundIds = new Set((tas || []).map((t: any) => t.id))
        if (foundIds.size !== taIds.length) {
            return NextResponse.json({ error: 'Penugasan tidak valid' }, { status: 400 })
        }
        for (const ta of tas || []) {
            const year = (ta as any).academic_year
            if (schoolId && year?.school_id !== schoolId) {
                return NextResponse.json({ error: 'Penugasan bukan milik sekolah Anda' }, { status: 403 })
            }
            if (year?.status === 'COMPLETED') return archivedYearResponse()
        }

        // One material row per class (teaching assignment)
        const rows = taIds.map((taId) => ({
            teaching_assignment_id: taId,
            title,
            description,
            type,
            content_url,
            content_text
        }))

        const { data, error } = await supabase
            .from('materials')
            .insert(rows)
            .select()

        if (error) {
            console.error('Supabase Insert Error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // Notify students in all target classes about the new material
        try {
            const classIds = [...new Set((tas || []).map((t: any) => t.class_id).filter(Boolean))]
            if (classIds.length > 0 && schoolId) {
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
                        .in('class_id', classIds)

                    const userIds = [...new Set(
                        (enrollments || [])
                            .map((e: any) => (Array.isArray(e.student) ? e.student[0]?.user_id : e.student?.user_id))
                            .filter(Boolean)
                    )] as string[]

                    if (userIds.length > 0) {
                        const subjectName = (tas?.[0] as any)?.subject?.name || ''
                        await supabase.from('notifications').insert(
                            userIds.map(uid => ({
                                user_id: uid,
                                type: 'MATERI_BARU',
                                title: `Materi Baru: ${title}`,
                                message: subjectName,
                                link: '/dashboard/siswa/materi'
                            }))
                        )
                    }
                }
            }

            // Confirmation notification for the uploader (guru/admin) — record in the bell
            await supabase.from('notifications').insert({
                user_id: user.id,
                type: 'SYSTEM',
                title: `Materi Terkirim: ${title}`,
                message: `Berhasil dibagikan ke ${classIds.length} kelas`,
                link: user.role === 'ADMIN' ? '/dashboard/admin/materi' : '/dashboard/guru/materi'
            })

            // If an ADMIN uploaded on behalf of teachers, notify the TA owners too
            if (user.role === 'ADMIN') {
                const ownerIds = [...new Set(
                    (tas || [])
                        .map((t: any) => (Array.isArray(t.teacher) ? t.teacher[0]?.user_id : t.teacher?.user_id))
                        .filter(Boolean)
                )] as string[]
                const subjectName = (tas?.[0] as any)?.subject?.name || ''
                if (ownerIds.length > 0) {
                    await supabase.from('notifications').insert(
                        ownerIds.map(uid => ({
                            user_id: uid,
                            type: 'SYSTEM',
                            title: `Admin menambahkan materi: ${title}`,
                            message: `${subjectName} — dibagikan ke ${classIds.length} kelas oleh admin`,
                            link: '/dashboard/guru/materi'
                        }))
                    )
                }
            }
        } catch (notifError) {
            // Jangan gagalkan request utama kalau notifikasi gagal
            console.error('Error sending material notifications:', notifError)
        }

        return NextResponse.json({ created: data?.length || 0, items: data })
    } catch (error: any) {
        console.error('Error creating material:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
