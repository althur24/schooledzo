import { supabaseAdmin } from './supabase'

/**
 * Catat perubahan nilai ke grade_history (append-only audit trail).
 * Sengaja tidak melempar error — kegagalan audit tidak boleh menggagalkan penilaian.
 */
export async function logGradeChange(params: {
    schoolId: string | null
    source: 'ASSIGNMENT' | 'QUIZ' | 'EXAM' | 'OFFICIAL_EXAM'
    refId: string            // assignment_id / quiz_id / exam_id
    refTitle?: string | null // snapshot judul — tetap terbaca walau item dihapus
    studentId: string
    oldScore: number | null  // null = penilaian pertama
    newScore: number
    maxScore?: number | null
    changedBy: string        // users.id
}) {
    try {
        // Nilai tidak berubah → tidak ada yang perlu dicatat.
        // Compare SETELAH round-2: skor desimal menghasilkan debu float
        // (0.1+0.2 ≠ 0.3) yang memicu false-positive "perubahan" audit.
        if (params.oldScore !== null && Math.round(params.oldScore * 100) === Math.round((params.newScore ?? 0) * 100)) return

        await supabaseAdmin.from('grade_history').insert({
            school_id: params.schoolId,
            source: params.source,
            ref_id: params.refId,
            ref_title: params.refTitle || null,
            student_id: params.studentId,
            old_score: params.oldScore,
            new_score: params.newScore,
            max_score: params.maxScore ?? null,
            changed_by: params.changedBy
        })
    } catch (error) {
        console.error('logGradeChange gagal (nilai tetap tersimpan):', error)
    }
}
