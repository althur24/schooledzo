import { supabaseAdmin } from './supabase'
import { IN_BATCH_SIZE } from './batchedIn'
import { fetchAllRows } from './fetchAllRows'

/**
 * Agregasi statistik jawaban per submission untuk monitor guru:
 * jumlah soal terjawab + total poin — untuk SEMUA submission satu ujian.
 *
 * Jalur utama: RPC `exam_answer_counts` / `official_exam_answer_counts`
 * (satu query agregasi ber-index di sisi DB). Tanpa ini, monitor mem-fetch
 * seluruh baris jawaban (1.000 siswa × 50 soal = 50.000+ baris per poll,
 * per guru, tiap 15 detik) — bottleneck terbesar saat ulangan serentak.
 *
 * Fallback: batched scan gaya lama (benar, hanya berat) dipakai bila RPC
 * belum ada di database (kode deploy sebelum migrasi) — deploy-order-safe.
 */

export interface AnswerStats {
    count: number
    points: number
}

export async function getAnswerStats(
    kind: 'exam' | 'official',
    examId: string,
    submissionIds: string[]
): Promise<Map<string, AnswerStats>> {
    const stats = new Map<string, AnswerStats>()

    // Jalur utama: agregasi DB-side (1 request, tak bergantung jumlah baris)
    const rpcName = kind === 'exam' ? 'exam_answer_counts' : 'official_exam_answer_counts'
    const { data: agg, error: rpcError } = await supabaseAdmin.rpc(rpcName, { p_exam_id: examId })

    if (!rpcError && Array.isArray(agg)) {
        for (const row of agg) {
            if (!row?.submission_id) continue
            stats.set(row.submission_id, {
                count: Number(row.answered_count) || 0,
                // Round-2: SUM float8 atas nilai round-2 bisa berdebu float
                // (33.33+33.33+33.34 → 100.00000000000001). Tanpa ini, jalur
                // monitor lazy auto-close menulis total_score berdebu ke DB —
                // berbeda dari jalur submit/force-close yang semuanya round-2.
                points: Math.round((Number(row.points_sum) || 0) * 100) / 100
            })
        }
        return stats
    }

    if (rpcError) {
        // PGRST202 = function tidak ditemukan → migrasi RPC belum di-push.
        // Error lain pun tidak boleh mematikan monitor — jalankan fallback.
        console.error(`[monitor] RPC ${rpcName} gagal (${rpcError.code ?? 'unknown'}), memakai fallback scan:`, rpcError.message)
    }

    // Fallback: scan ter-batch gaya lama (dipakai submissionIds, batch 100
    // sesuai batas URL; fetchAllRows per chunk untuk batas 1000 baris).
    const table = kind === 'exam' ? 'exam_answers' : 'official_exam_answers'
    if (submissionIds.length === 0) return stats

    const chunks: string[][] = []
    for (let i = 0; i < submissionIds.length; i += IN_BATCH_SIZE) {
        chunks.push(submissionIds.slice(i, i + IN_BATCH_SIZE))
    }
    await Promise.all(chunks.map(async (chunk) => {
        // .order('id') WAJIB sebelum fetchAllRows — paginasi range() tanpa
        // order stabil bisa melewatkan/duplikat baris (aturan CLAUDE.md).
        const rows = await fetchAllRows<{ submission_id: string; points_earned: number | null }>(
            supabaseAdmin
                .from(table)
                .select('submission_id, points_earned')
                .in('submission_id', chunk)
                .order('id')
        )
        for (const a of rows) {
            const prev = stats.get(a.submission_id) || { count: 0, points: 0 }
            prev.count += 1
            // Skor bisa desimal (GK proporsional) — round 2 desimal anti debu float
            prev.points = Math.round((prev.points + (Number(a.points_earned) || 0)) * 100) / 100
            stats.set(a.submission_id, prev)
        }
    }))

    return stats
}
