import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'

/**
 * GET /api/schools/public
 * Public endpoint — returns list of active schools for login dropdown.
 * No authentication required.
 */
export async function GET() {
    try {
        const { data, error } = await supabase
            .from('schools')
            .select('id, name, code, logo_url')
            .eq('is_active', true)
            .order('name')

        if (error) throw error

        return NextResponse.json(data || [])
    } catch (error) {
        console.error('Error fetching public schools:', error)
        return NextResponse.json([], { status: 200 }) // Return empty array, don't expose error
    }
}
