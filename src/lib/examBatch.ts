import { supabaseAdmin } from './supabase'

/**
 * examBatch — sinkronisasi soal + status terbit untuk ujian/kuis multi-kelas
 * yang diikat kolom `batch_id` di database.
 *
 * Menggantikan linkage URL/sessionStorage (hilang saat tab tertutup).
 * Pola per sibling: insert-first (kegagalan insert tidak menghapus soal lama),
 * bersihkan soal lama setelah insert sukses, lalu terbitkan sibling.
 */

export interface BatchSyncResult {
    total: number
    failed: string[]
}

async function syncBatch(
    table: 'exams' | 'quizzes',
    questionsTable: 'exam_questions' | 'quiz_questions',
    fkColumn: 'exam_id' | 'quiz_id',
    primaryId: string
): Promise<BatchSyncResult> {
    const { data: primary } = await supabaseAdmin
        .from(table).select('id, batch_id').eq('id', primaryId).single()
    if (!primary?.batch_id) return { total: 0, failed: [] }

    const { data: siblings } = await supabaseAdmin
        .from(table).select('id').eq('batch_id', primary.batch_id).neq('id', primaryId)
    const siblingIds = (siblings || []).map(s => s.id as string)
    if (siblingIds.length === 0) return { total: 0, failed: [] }

    const { data: sourceQuestions, error: srcErr } = await supabaseAdmin
        .from(questionsTable).select('*').eq(fkColumn, primaryId)
    if (srcErr) throw srcErr
    // Primary tanpa soal = semua sibling gagal (caller sudah menjaga publish 0 soal,
    // ini pelindung ganda)
    if (!sourceQuestions || sourceQuestions.length === 0) {
        return { total: siblingIds.length, failed: siblingIds }
    }

    const failed: string[] = []
    for (const targetId of siblingIds) {
        try {
            const rows = sourceQuestions.map((q: any) => {
                const { id, created_at, ...rest } = q
                delete rest[fkColumn]
                return { ...rest, [fkColumn]: targetId }
            })

            // Snapshot soal lama target (dibersihkan setelah insert sukses)
            const { data: oldRows, error: fetchOldError } = await supabaseAdmin
                .from(questionsTable).select('id').eq(fkColumn, targetId)
            if (fetchOldError) {
                console.error(`[batch] fetch old questions gagal untuk ${targetId}:`, fetchOldError)
                failed.push(targetId)
                continue
            }
            const oldIds = (oldRows || []).map((r: any) => r.id)

            const { error: insertError } = await supabaseAdmin
                .from(questionsTable).insert(rows)
            if (insertError) {
                console.error(`[batch] insert soal gagal untuk ${targetId}:`, insertError)
                failed.push(targetId)
                continue
            }

            if (oldIds.length > 0) {
                const { error: deleteError } = await supabaseAdmin
                    .from(questionsTable).delete().in('id', oldIds)
                if (deleteError) {
                    // Tidak fatal: target punya soal ganda sementara, bukan kehilangan soal
                    console.error(`[batch] cleanup soal lama gagal untuk ${targetId}:`, deleteError)
                }
            }

            const { error: pubError } = await supabaseAdmin
                .from(table)
                .update({ is_active: true, updated_at: new Date().toISOString() })
                .eq('id', targetId)
            if (pubError) {
                console.error(`[batch] aktivasi gagal untuk ${targetId}:`, pubError)
                failed.push(targetId)
                continue
            }
        } catch (e) {
            console.error(`[batch] error tak terduga untuk ${targetId}:`, e)
            failed.push(targetId)
        }
    }

    return { total: siblingIds.length, failed }
}

export async function syncExamBatch(primaryExamId: string): Promise<BatchSyncResult> {
    return syncBatch('exams', 'exam_questions', 'exam_id', primaryExamId)
}

export async function syncQuizBatch(primaryQuizId: string): Promise<BatchSyncResult> {
    return syncBatch('quizzes', 'quiz_questions', 'quiz_id', primaryQuizId)
}
