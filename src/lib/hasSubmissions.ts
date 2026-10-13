import { supabaseAdmin as supabase } from '@/lib/supabase'

/**
 * Cek apakah exam sudah memiliki submission yang pernah dimulai (started_at IS NOT NULL).
 * Satu sumber kebenaran untuk lock-settings logic di seluruh route API.
 *
 * Trigger: started_at IS NOT NULL = siswa pernah membuka ujian (apa pun outcome-nya —
 * submit normal, force-submit pelanggaran, sweep, atau ditinggalkan).
 * Pilihan ini lebih aman daripada is_submitted=true karena mencegah perubahan
 * settings mid-exam saat siswa sedang aktif mengerjakan.
 *
 * Query: count-only (head: true) — lightweight, tidak fetch baris.
 */
export async function hasStartedSubmissions(
    table: 'exam_submissions' | 'official_exam_submissions',
    examId: string
): Promise<{ hasSubmissions: boolean; count: number }> {
    const { count, error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('exam_id', examId)
        .not('started_at', 'is', null)

    if (error) {
        console.error(`[hasStartedSubmissions] error checking ${table}:`, error)
        // Fail-safe: bila query error, anggap ADA submission (lock) — lebih aman
        // daripada membuka lock karena query gagal.
        return { hasSubmissions: true, count: 0 }
    }

    const n = count || 0
    return { hasSubmissions: n > 0, count: n }
}
