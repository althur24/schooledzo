import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound } from '@/lib/tenantGuard'
import { getYearStatusById, archivedYearResponse } from '@/lib/academicYear'

// PUT update class
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { name, academic_year_id, grade_level, school_level, homeroom_teacher_id } = await request.json()

        // Validate grade_level if provided
        if (grade_level !== null && grade_level !== undefined) {
            if (![1, 2, 3].includes(grade_level)) {
                return NextResponse.json({ error: 'Tingkat kelas harus 1, 2, atau 3' }, { status: 400 })
            }
        }

        // Validate school_level if provided
        if (school_level !== null && school_level !== undefined) {
            if (!['SMP', 'SMA'].includes(school_level)) {
                return NextResponse.json({ error: 'Jenjang sekolah harus SMP atau SMA' }, { status: 400 })
            }
        }

        // Block writes to archived (COMPLETED) academic years + tenant guard
        const { data: classForYear } = await supabase
            .from('classes')
            .select('academic_year_id, school_id')
            .eq('id', id)
            .single()
        // Tenant guard: kelas harus milik sekolah caller
        if (tenantMismatch((classForYear as any)?.school_id, schoolId)) {
            return notFound()
        }
        if (classForYear?.academic_year_id) {
            const yearStatus = await getYearStatusById(classForYear.academic_year_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        // Anti-duplikat: nama + tingkat + jenjang harus unik per tahun ajaran (kecuali kelas ini sendiri)
        const finalYearId = academic_year_id ?? classForYear?.academic_year_id
        if (name && finalYearId) {
            let dupQuery = supabase
                .from('classes')
                .select('id, name')
                .eq('name', name)
                .eq('academic_year_id', finalYearId)
                .neq('id', id)
            if (grade_level === null || grade_level === undefined) dupQuery = dupQuery.is('grade_level', null)
            else dupQuery = dupQuery.eq('grade_level', grade_level)
            if (school_level === null || school_level === undefined) dupQuery = dupQuery.is('school_level', null)
            else dupQuery = dupQuery.eq('school_level', school_level)
            const { data: duplicate } = await dupQuery.maybeSingle()
            if (duplicate) {
                return NextResponse.json({ error: `Kelas "${name}" sudah ada di tahun ajaran ini` }, { status: 409 })
            }
        }

        const updateData: Record<string, unknown> = { name, academic_year_id, grade_level, school_level }
        // Allow setting or clearing homeroom_teacher_id
        if (homeroom_teacher_id !== undefined) {
            updateData.homeroom_teacher_id = homeroom_teacher_id || null
        }

        let updateQuery = supabase
            .from('classes')
            .update(updateData)
            .eq('id', id)
        const { data, error } = await updateQuery
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating class:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE class
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Block writes to archived (COMPLETED) academic years + tenant guard
        const { data: classForYear } = await supabase
            .from('classes')
            .select('academic_year_id, school_id')
            .eq('id', id)
            .single()
        // Tenant guard: kelas harus milik sekolah caller
        if (tenantMismatch((classForYear as any)?.school_id, schoolId)) {
            return notFound()
        }
        if (classForYear?.academic_year_id) {
            const yearStatus = await getYearStatusById(classForYear.academic_year_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        let deleteQuery = supabase
            .from('classes')
            .delete()
            .eq('id', id)
        const { error } = await deleteQuery

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting class:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
