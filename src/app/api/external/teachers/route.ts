import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
    try {
        // Security Check
        const apiKey = request.headers.get('x-api-key')
        if (apiKey !== process.env.EXTERNAL_API_SECRET) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100')
        const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0')
        const schoolId = request.nextUrl.searchParams.get('school_id')

        let query = supabase
            .from('teachers')
            .select(`
                id,
                nip,
                created_at,
                user:users(
                    id,
                    username,
                    full_name
                )
            `, { count: 'exact' })
            .range(offset, offset + limit - 1)
            .order('created_at', { ascending: false })

        if (schoolId) {
            query = query.eq('school_id', schoolId)
        }

        const { data: teachers, error, count } = await query

        if (error) throw error

        // Transform data to flatten structure if needed, or return as is
        const formattedTeachers = (teachers as any[]).map(t => ({
            id: t.id,
            nip: t.nip,
            user_id: t.user?.id,
            full_name: t.user?.full_name,
            username: t.user?.username,
            created_at: t.created_at
        }))

        return NextResponse.json({
            data: formattedTeachers,
            meta: {
                total: count,
                limit,
                offset
            }
        })
    } catch (error) {
        console.error('Error fetching teachers:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
