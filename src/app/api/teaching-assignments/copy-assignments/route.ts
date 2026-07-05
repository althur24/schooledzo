import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * POST /api/teaching-assignments/copy-assignments
 * Copy teaching assignments from one academic year to another.
 * Only copies teacher+subject combinations; admin assigns classes manually afterward.
 * 
 * Body: { from_year_id: string, to_year_id: string }
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { from_year_id, to_year_id } = await request.json()

        if (!from_year_id || !to_year_id) {
            return NextResponse.json({ error: 'from_year_id and to_year_id are required' }, { status: 400 })
        }

        if (from_year_id === to_year_id) {
            return NextResponse.json({ error: 'Source and target year cannot be the same' }, { status: 400 })
        }

        // Verify both years exist and belong to this school
        let yearsQuery = supabase
            .from('academic_years')
            .select('id, name')
            .in('id', [from_year_id, to_year_id])
        if (schoolId) yearsQuery = yearsQuery.eq('school_id', schoolId)
        const { data: years, error: yearsError } = await yearsQuery

        if (yearsError) throw yearsError
        if (!years || years.length !== 2) {
            return NextResponse.json({ error: 'One or both academic years not found' }, { status: 404 })
        }

        // Fetch all assignments from source year (scoped by school)
        let sourceQuery = supabase
            .from('teaching_assignments')
            .select('teacher_id, subject_id, class_id')
            .eq('academic_year_id', from_year_id)
        // teaching_assignments scoped via academic_year_id (already verified above)
        const { data: sourceAssignments, error: sourceError } = await sourceQuery

        if (sourceError) throw sourceError

        if (!sourceAssignments || sourceAssignments.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No assignments found in source year',
                copied: 0,
                skipped: 0,
                total: 0
            })
        }

        // Fetch existing assignments in target year to avoid duplicates
        const { data: existingAssignments, error: existingError } = await supabase
            .from('teaching_assignments')
            .select('teacher_id, subject_id, class_id')
            .eq('academic_year_id', to_year_id)

        if (existingError) throw existingError

        // Create a set of existing assignment keys for O(1) lookup
        const existingKeys = new Set(
            (existingAssignments || []).map(a => `${a.teacher_id}_${a.subject_id}_${a.class_id}`)
        )

        // Build class mapping: old year classes -> new year classes (by matching name + grade + school_level)
        let classMapping: Record<string, string> = {}
        const { data: sourceClasses } = await supabase
            .from('classes').select('id, name, grade_level, school_level').eq('academic_year_id', from_year_id)
        const { data: targetClasses } = await supabase
            .from('classes').select('id, name, grade_level, school_level').eq('academic_year_id', to_year_id)
        if (sourceClasses && targetClasses) {
            for (const src of sourceClasses) {
                const match = targetClasses.find((t: any) =>
                    t.name === src.name && t.grade_level === src.grade_level && t.school_level === src.school_level
                )
                if (match) classMapping[src.id] = match.id
            }
        }

        // Get active teacher IDs to filter out locked/inactive teachers
        const teacherIds = [...new Set(sourceAssignments.map(a => a.teacher_id))]
        const { data: activeTeachers } = await supabase
            .from('teachers')
            .select('id, user:users(is_locked)')
            .in('id', teacherIds)

        const activeTeacherIds = new Set(
            (activeTeachers || [])
                .filter((t: any) => {
                    const user = Array.isArray(t.user) ? t.user[0] : t.user
                    return !user?.is_locked
                })
                .map((t: any) => t.id)
        )

        // Filter out duplicates, remap class_ids, and skip inactive teachers
        const newAssignments = sourceAssignments
            .filter(a => classMapping[a.class_id] && activeTeacherIds.has(a.teacher_id))
            .map(a => {
                const mappedClassId = classMapping[a.class_id]
                return {
                    teacher_id: a.teacher_id,
                    subject_id: a.subject_id,
                    class_id: mappedClassId,
                    academic_year_id: to_year_id,
                    school_id: schoolId
                }
            })
            .filter(a => !existingKeys.has(`${a.teacher_id}_${a.subject_id}_${a.class_id}`))

        if (newAssignments.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'All assignments already exist in target year',
                copied: 0,
                skipped: sourceAssignments.length,
                total: sourceAssignments.length
            })
        }

        // Batch insert (Supabase handles up to 1000 rows per insert)
        const batchSize = 500
        let totalCopied = 0

        for (let i = 0; i < newAssignments.length; i += batchSize) {
            const batch = newAssignments.slice(i, i + batchSize)
            const { data, error } = await supabase
                .from('teaching_assignments')
                .insert(batch)
                .select('id')

            if (error) {
                console.error(`Batch insert error at offset ${i}:`, error)
                throw error
            }

            totalCopied += data?.length || 0
        }

        const fromYear = years.find(y => y.id === from_year_id)
        const toYear = years.find(y => y.id === to_year_id)

        return NextResponse.json({
            success: true,
            message: `${totalCopied} penugasan berhasil disalin dari ${fromYear?.name} ke ${toYear?.name}`,
            copied: totalCopied,
            skipped: sourceAssignments.length - totalCopied,
            total: sourceAssignments.length
        })

    } catch (error: any) {
        console.error('Error copying assignments:', error)
        return NextResponse.json({ error: 'Server error', details: error.message }, { status: 500 })
    }
}
