import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * POST /api/classes/copy-classes
 * Duplicate classes from one academic year to another.
 * Creates new classes with the same name, grade_level, school_level
 * but linked to the new academic year.
 * 
 * Body: { from_year_id: string, to_year_id: string, copy_homeroom?: boolean }
 * Returns: { copied: number, skipped: number, total: number, class_mapping: Record<old_id, new_id> }
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { from_year_id, to_year_id, copy_homeroom = true } = await request.json()

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

        // Fetch source classes (scoped by school)
        let sourceQuery = supabase
            .from('classes')
            .select('id, name, grade_level, school_level, homeroom_teacher_id')
            .eq('academic_year_id', from_year_id)
        // classes scoped via academic_year_id (which is already verified above)
        const { data: sourceClasses, error: sourceError } = await sourceQuery
            .order('school_level')
            .order('grade_level')

        if (sourceError) throw sourceError

        if (!sourceClasses || sourceClasses.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No classes found in source year',
                copied: 0,
                skipped: 0,
                total: 0,
                class_mapping: {}
            })
        }

        // Check existing classes in target year
        let existingQuery = supabase
            .from('classes')
            .select('id, name, grade_level, school_level')
            .eq('academic_year_id', to_year_id)
        // classes scoped via academic_year_id (which is already verified above)
        const { data: existingClasses, error: existingError } = await existingQuery

        if (existingError) throw existingError

        const existingKeys = new Set(
            (existingClasses || []).map(c => `${c.name}_${c.grade_level}_${c.school_level}`)
        )

        // Find existing class mapping for already-existing classes (for copy-assignments later)
        const existingMapping: Record<string, string> = {}
        for (const src of sourceClasses) {
            const existing = (existingClasses || []).find(c =>
                c.name === src.name && c.grade_level === src.grade_level && c.school_level === src.school_level
            )
            if (existing) {
                existingMapping[src.id] = existing.id
            }
        }

        // Filter classes that need to be created
        const classesToCreate = sourceClasses
            .filter(c => !existingKeys.has(`${c.name}_${c.grade_level}_${c.school_level}`))
            .map(c => ({
                name: c.name,
                grade_level: c.grade_level,
                school_level: c.school_level,
                academic_year_id: to_year_id,
                ...(copy_homeroom && c.homeroom_teacher_id ? { homeroom_teacher_id: c.homeroom_teacher_id } : {})
            }))

        if (classesToCreate.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'All classes already exist in target year',
                copied: 0,
                skipped: sourceClasses.length,
                total: sourceClasses.length,
                class_mapping: existingMapping
            })
        }

        // Insert new classes
        const { data: newClasses, error: insertError } = await supabase
            .from('classes')
            .insert(classesToCreate)
            .select('id, name, grade_level, school_level')

        if (insertError) throw insertError

        // Build mapping: old class id -> new class id
        const classMapping: Record<string, string> = { ...existingMapping }
        for (const src of sourceClasses) {
            if (classMapping[src.id]) continue // Already mapped from existing
            const newCls = (newClasses || []).find(c =>
                c.name === src.name && c.grade_level === src.grade_level && c.school_level === src.school_level
            )
            if (newCls) {
                classMapping[src.id] = newCls.id
            }
        }

        const fromYear = years.find(y => y.id === from_year_id)
        const toYear = years.find(y => y.id === to_year_id)

        return NextResponse.json({
            success: true,
            message: `${newClasses?.length || 0} kelas berhasil disalin dari ${fromYear?.name} ke ${toYear?.name}`,
            copied: newClasses?.length || 0,
            skipped: sourceClasses.length - (newClasses?.length || 0),
            total: sourceClasses.length,
            class_mapping: classMapping
        })

    } catch (error: any) {
        console.error('Error copying classes:', error)
        return NextResponse.json({ error: 'Server error', details: error.message }, { status: 500 })
    }
}
