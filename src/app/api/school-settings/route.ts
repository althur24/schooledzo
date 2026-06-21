import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * GET /api/school-settings
 * Returns the settings JSONB for the current user's school.
 * Accessible by ADMIN and GURU.
 */
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (!['ADMIN', 'GURU'].includes(user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        if (!schoolId) {
            return NextResponse.json({ error: 'No school context' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('schools')
            .select('settings')
            .eq('id', schoolId)
            .single()

        if (error) throw error

        // Return settings with defaults
        const settings = data?.settings || {}
        return NextResponse.json({
            ai_review_enabled: settings.ai_review_enabled !== false, // default true
            tutorial_enabled: settings.tutorial_enabled === true, // default false
            ...settings
        })
    } catch (error) {
        console.error('Error fetching school settings:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

/**
 * PUT /api/school-settings
 * Merge-update the settings JSONB for the current user's school.
 * ADMIN only.
 */
export async function PUT(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Only ADMIN can update settings' }, { status: 403 })
        }

        if (!schoolId) {
            return NextResponse.json({ error: 'No school context' }, { status: 400 })
        }

        const body = await request.json()

        // Get current settings
        const { data: current } = await supabase
            .from('schools')
            .select('settings')
            .eq('id', schoolId)
            .single()

        // Merge new settings into existing
        const mergedSettings = {
            ...(current?.settings || {}),
            ...body
        }

        const { data, error } = await supabase
            .from('schools')
            .update({ settings: mergedSettings })
            .eq('id', schoolId)
            .select('settings')
            .single()

        if (error) throw error

        const settings = data?.settings || {}
        return NextResponse.json({
            ai_review_enabled: settings.ai_review_enabled !== false,
            tutorial_enabled: settings.tutorial_enabled === true,
            ...settings
        })
    } catch (error) {
        console.error('Error updating school settings:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
