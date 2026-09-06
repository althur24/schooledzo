import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { resolveMenuLabels, sanitizeMenuLabelsInput } from '@/lib/labels'
import { invalidateSchoolLabelsCache } from '@/lib/serverLabels'

/**
 * GET /api/school-settings
 * Returns the settings JSONB for the current user's school.
 * Accessible by all authenticated roles (SISWA/WALI juga — label menu
 * dipakai navigasi siswa; settings ini tidak berisi data sensitif).
 */
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { schoolId } = ctx

        if (!schoolId) {
            // SUPER_ADMIN / tanpa konteks sekolah → default (client butuh bentuk respons konsisten)
            return NextResponse.json({
                ai_review_enabled: true,
                tutorial_enabled: false,
                ai_generate_enabled: false,
                menu_labels: resolveMenuLabels(null),
            })
        }

        const { data, error } = await supabase
            .from('schools')
            .select('settings')
            .eq('id', schoolId)
            .single()

        if (error) throw error

        // Return settings with defaults
        const settings = (data?.settings || {}) as Record<string, unknown>
        return NextResponse.json({
            ai_review_enabled: settings.ai_review_enabled !== false, // default true
            tutorial_enabled: settings.tutorial_enabled === true, // default false
            ai_generate_enabled: settings.ai_generate_enabled === true, // default false — hanya admin yang bisa menyalakan
            ...settings,
            menu_labels: resolveMenuLabels(settings.menu_labels), // resolved — selalu lengkap & bersih
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
 *
 * Khusus menu_labels: diganti seluruhnya (bukan merge per-key) — string
 * kosong berarti kembali ke default. Validasi via sanitizeMenuLabelsInput.
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

        // Validasi menu_labels SEBELUM menyentuh DB — tipe salah → 400.
        let sanitizedMenuLabels: Partial<import('@/lib/labels').MenuLabels> | null = null
        const hasMenuLabels = body && typeof body === 'object' && 'menu_labels' in body
        if (hasMenuLabels) {
            const result = sanitizeMenuLabelsInput(body.menu_labels)
            if (!result.ok) {
                return NextResponse.json({ error: result.error }, { status: 400 })
            }
            sanitizedMenuLabels = result.labels
        }

        // Get current settings
        const { data: current } = await supabase
            .from('schools')
            .select('settings')
            .eq('id', schoolId)
            .single()

        // Merge new settings into existing
        const mergedSettings: Record<string, unknown> = {
            ...(current?.settings || {}),
        }
        if (body && typeof body === 'object') {
            for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
                if (key !== 'menu_labels') mergedSettings[key] = value
            }
        }
        // menu_labels: replace seluruhnya. Semua label kosong → hapus key (default).
        if (hasMenuLabels) {
            if (sanitizedMenuLabels && Object.keys(sanitizedMenuLabels).length > 0) {
                mergedSettings.menu_labels = sanitizedMenuLabels
            } else {
                delete mergedSettings.menu_labels
            }
        }

        const { data, error } = await supabase
            .from('schools')
            .update({ settings: mergedSettings })
            .eq('id', schoolId)
            .select('settings')
            .single()

        if (error) throw error

        // Label cache server (job notifikasi) bisa basi setelah update — invalidate.
        invalidateSchoolLabelsCache(schoolId)

        const settings = (data?.settings || {}) as Record<string, unknown>
        return NextResponse.json({
            ai_review_enabled: settings.ai_review_enabled !== false,
            tutorial_enabled: settings.tutorial_enabled === true,
            ai_generate_enabled: settings.ai_generate_enabled === true,
            ...settings,
            menu_labels: resolveMenuLabels(settings.menu_labels),
        })
    } catch (error) {
        console.error('Error updating school settings:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
