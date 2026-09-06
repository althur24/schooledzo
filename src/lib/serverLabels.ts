/**
 * Pembaca label menu kustom sekolah di sisi server.
 *
 * Dipakai oleh job notifikasi (notificationJobs, examBatch, autoPublish,
 * checkEndedExams, teacherNotifyBuffer) dan route API yang menyusun pesan
 * user-facing. Membaca JSONB schools.settings.menu_labels mengikuti pattern
 * isAIReviewEnabled di triggerHOTS.ts.
 *
 * Cache per sekolah (TTL 5 menit) supaya job notifikasi massal (ratusan user
 * per sekolah tiap 10 menit) tidak menghajar query schools berulang kali.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase'
import { MenuLabels, DEFAULT_MENU_LABELS, resolveMenuLabels } from '@/lib/labels'

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { labels: MenuLabels; expires: number }>()

/**
 * Label menu kustom sekolah. schoolId null (SUPER_ADMIN / tanpa konteks
 * sekolah) → default. Error baca DB → default (label hanya kosmetik,
 * tidak boleh menggagalkan job).
 */
export async function getMenuLabelsForSchool(schoolId: string | null): Promise<MenuLabels> {
    if (!schoolId) return DEFAULT_MENU_LABELS

    const hit = cache.get(schoolId)
    if (hit && hit.expires > Date.now()) return hit.labels

    try {
        const { data } = await supabase
            .from('schools')
            .select('settings')
            .eq('id', schoolId)
            .single()
        const settings = (data?.settings ?? null) as Record<string, unknown> | null
        const labels = resolveMenuLabels(settings?.menu_labels)
        cache.set(schoolId, { labels, expires: Date.now() + CACHE_TTL_MS })
        return labels
    } catch {
        return DEFAULT_MENU_LABELS
    }
}

/** Hapus cache label — dipanggil setelah PUT school-settings agar langsung konsisten. */
export function invalidateSchoolLabelsCache(schoolId?: string) {
    if (schoolId) cache.delete(schoolId)
    else cache.clear()
}
