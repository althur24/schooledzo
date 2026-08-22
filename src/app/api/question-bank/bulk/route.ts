import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// POST aksi massal pada bank soal milik guru:
//   { action: 'add_tags',    ids: string[], tags: string[] }
//   { action: 'remove_tags', ids: string[], tags: string[] }
//   { action: 'set_tags',    ids: string[], tags: string[] }
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { action, ids, tags } = await request.json()

        if (!['add_tags', 'remove_tags', 'set_tags'].includes(action)) {
            return NextResponse.json({ error: 'Aksi tidak dikenal' }, { status: 400 })
        }
        if (!Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: 'Pilih minimal satu soal' }, { status: 400 })
        }
        if (action !== 'set_tags' && (!Array.isArray(tags) || tags.length === 0)) {
            return NextResponse.json({ error: 'Tag diperlukan' }, { status: 400 })
        }

        const cleanTags = (Array.isArray(tags) ? tags : [])
            .map((t: unknown) => String(t ?? '').trim())
            .filter(Boolean)
            .slice(0, 20)

        const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()
        if (!teacher) {
            return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })
        }

        // Pastikan hanya soal milik guru ini yang tersentuh
        const { data: owned, error: fetchError } = await supabase
            .from('question_bank')
            .select('id, tags')
            .in('id', ids)
            .eq('teacher_id', teacher.id)
        if (fetchError) throw fetchError
        if (!owned || owned.length === 0) {
            return NextResponse.json({ error: 'Soal tidak ditemukan' }, { status: 404 })
        }

        for (const row of owned) {
            let next: string[]
            const current = (row as { tags?: string[] | null }).tags || []
            if (action === 'add_tags') {
                next = [...new Set([...current, ...cleanTags])]
            } else if (action === 'remove_tags') {
                const remove = new Set(cleanTags)
                next = current.filter((t) => !remove.has(t))
            } else {
                next = [...new Set(cleanTags)]
            }

            const { error } = await supabase
                .from('question_bank')
                .update({ tags: next.length > 0 ? next : null })
                .eq('id', (row as { id: string }).id)
            if (error) throw error
        }

        return NextResponse.json({ success: true, updated: owned.length })
    } catch (error) {
        console.error('Error bulk updating question bank:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
