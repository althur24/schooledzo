import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET riwayat perubahan nilai untuk satu sel penilaian
// ?source=ASSIGNMENT|QUIZ&ref_id=<id>&student_id=<id>
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const source = request.nextUrl.searchParams.get('source')
        const refId = request.nextUrl.searchParams.get('ref_id')
        const studentId = request.nextUrl.searchParams.get('student_id')

        if (!source || !refId || !studentId) {
            return NextResponse.json({ error: 'Parameter tidak lengkap' }, { status: 400 })
        }

        let query = supabase
            .from('grade_history')
            .select('id, old_score, new_score, max_score, changed_by, changed_at')
            .eq('source', source)
            .eq('ref_id', refId)
            .eq('student_id', studentId)
            .order('changed_at', { ascending: false })
            .limit(50)

        // Tenant scope: hanya riwayat milik sekolah caller
        if (schoolId) query = query.eq('school_id', schoolId)

        const { data, error } = await query
        if (error) throw error

        // Nama pengubah (users.full_name) — dijoin manual agar query utama ringan
        const changerIds = [...new Set((data || []).map(h => h.changed_by).filter(Boolean))]
        let changerNames: Record<string, string> = {}
        if (changerIds.length > 0) {
            const { data: users } = await supabase
                .from('users')
                .select('id, full_name')
                .in('id', changerIds)
            changerNames = Object.fromEntries((users || []).map(u => [u.id, u.full_name]))
        }

        const result = (data || []).map(h => ({
            ...h,
            changed_by_name: h.changed_by ? (changerNames[h.changed_by] || null) : null
        }))

        return NextResponse.json(result)
    } catch (error) {
        console.error('Error fetching grade history:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
