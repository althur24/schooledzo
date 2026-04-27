import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET subjects (filtered by teacher assignments for GURU role)
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // If user is a teacher, only return their assigned subjects
        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()

            if (teacher) {
                const { data: assignments, error } = await supabase
                    .from('teaching_assignments')
                    .select('subject:subjects(id, name, level)')
                    .eq('teacher_id', teacher.id)

                if (error) throw error

                const subjectMap = new Map<string, { id: string; name: string }>()
                assignments?.forEach((a: any) => {
                    const subj = Array.isArray(a.subject) ? a.subject[0] : a.subject
                    if (subj) subjectMap.set(subj.id, subj)
                })

                const subjects = Array.from(subjectMap.values()).sort((a, b) => a.name.localeCompare(b.name))
                return NextResponse.json(subjects)
            }

            return NextResponse.json([])
        }

        // Admin or SUPER_ADMIN: return all subjects (scoped to school)
        let query = supabase
            .from('subjects')
            .select('*, teaching_assignments(count)')
            .order('name')

        if (schoolId) query = query.eq('school_id', schoolId)

        const { data, error } = await query
        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error fetching subjects:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST new subject
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { name, level } = await request.json()

        if (!name) return NextResponse.json({ error: 'Nama mata pelajaran harus diisi' }, { status: 400 })

        const { data, error } = await supabase
            .from('subjects')
            .insert({ name, level: level || 'UMUM', school_id: schoolId })
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error creating subject:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update subject (e.g. KKM)
export async function PUT(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { schoolId } = ctx

        const { id, name, kkm, level } = await request.json()
        if (!id) return NextResponse.json({ error: 'ID mata pelajaran harus diisi' }, { status: 400 })

        const updateData: any = {}
        if (name !== undefined) updateData.name = name
        if (kkm !== undefined) updateData.kkm = kkm
        if (level !== undefined) updateData.level = level

        let query = supabase
            .from('subjects')
            .update(updateData)
            .eq('id', id)

        if (schoolId) query = query.eq('school_id', schoolId)

        const { data, error } = await query.select().single()

        if (error) throw error
        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating subject:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
