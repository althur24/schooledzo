import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { logError } from '@/lib/logError'

// GET notifications for current user
// Route ini dipolling tiap 60 detik per user — harus ringan.
// Optimasi beban (hasil load test: p95 429ms @50 VU, satu-satunya endpoint
// gagal threshold di semua tier):
//  - session via micro-cache 30 dtk (validateSessionCached) → 0 query setelah
//    poll pertama; lock/logout tetap dihormati via invalidasi di deleteSession
//  - daftar + hitung unread dijalankan PARALEL (dulu sekuensial 2 round-trip)
// Semua logika proaktif (cleanup, deadline reminder, exam reminder) berjalan di
// background scheduler: src/lib/scheduler.ts → src/lib/notificationJobs.ts
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request, { cachedSession: true })
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        const unreadOnly = request.nextUrl.searchParams.get('unread') === 'true'
        const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20')

        let query = supabase
            .from('notifications')
            .select('id, type, title, message, link, is_read, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(limit)

        if (unreadOnly) {
            query = query.eq('is_read', false)
        }

        const [listRes, countRes] = await Promise.all([
            query,
            supabase
                .from('notifications')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .eq('is_read', false)
        ])

        if (listRes.error) throw listRes.error

        return NextResponse.json({
            notifications: listRes.data || [],
            unreadCount: countRes.count || 0
        })
    } catch (error) {
        logError('Error fetching notifications', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST create notification (for internal use / triggers)
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // C4 Security Fix: Only teachers and admins can create notifications
        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await request.json()
        const { user_ids, type, title, message, link } = body

        if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
            return NextResponse.json({ error: 'user_ids required' }, { status: 400 })
        }

        if (!type || !title) {
            return NextResponse.json({ error: 'type and title required' }, { status: 400 })
        }

        // Tenant guard: penerima harus user sekolah caller — tanpa ini
        // guru/admin bisa mengirim pesan ke user sekolah lain (social engineering)
        if (schoolId) {
            const badTargets: string[] = []
            for (let i = 0; i < user_ids.length; i += 100) {
                const chunk = user_ids.slice(i, i + 100)
                const { data: targetUsers } = await supabase
                    .from('users').select('id, school_id').in('id', chunk)
                for (const u of (targetUsers || []) as any[]) {
                    if (u.school_id && u.school_id !== schoolId) badTargets.push(u.id)
                }
            }
            if (badTargets.length > 0) {
                return NextResponse.json({ error: 'Penerima di luar sekolah Anda' }, { status: 403 })
            }
        }

        // Create notifications for all target users
        const notifications = user_ids.map((uid: string) => ({
            user_id: uid,
            type,
            title,
            message: message || null,
            link: link || null
        }))

        const { data, error } = await supabase
            .from('notifications')
            .insert(notifications)
            .select()

        if (error) throw error

        return NextResponse.json({ success: true, count: data?.length || 0 })
    } catch (error) {
        logError('Error creating notifications', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT mark as read
export async function PUT(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const body = await request.json()
        const { notification_id, mark_all } = body

        if (mark_all) {
            // Mark all as read
            const { error } = await supabase
                .from('notifications')
                .update({ is_read: true })
                .eq('user_id', user.id)
                .eq('is_read', false)

            if (error) throw error

            return NextResponse.json({ success: true })
        }

        if (!notification_id) {
            return NextResponse.json({ error: 'notification_id required' }, { status: 400 })
        }

        // Mark single notification as read
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', notification_id)
            .eq('user_id', user.id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        logError('Error updating notification', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
