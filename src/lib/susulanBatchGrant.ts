/**
 * susulanBatchGrant.ts — buka Susulan untuk BANYAK siswa sekaligus.
 *
 * Dipakai tombol "Buka Susulan" di Monitor Live. Logika per siswa TETAP
 * memakai grantSusulan (satu sumber aturan: tenant, roster, remedial, tahun
 * ajaran, ujian harus berakhir, anti race). Helper ini hanya:
 *  - memvalidasi input & membatasi jumlah (anti timeout),
 *  - menjalankan per siswa dengan concurrency kecil,
 *  - mengelompokkan hasil (dibuka / diperpanjang / dilewati / gagal).
 */

import {
    resolveSusulanGrantContext,
    grantSusulanWithContext,
    type SusulanAuthContext,
    type SusulanKind,
} from './susulanGrant'
import { sanitizeSusulanMaxPercent } from './susulan'

export const SUSULAN_BATCH_MAX = 200
const CONCURRENCY = 5

export interface SusulanBatchItemOk {
    student_id: string
    submission_id: string
    expires_at: string
    max_percent: number
}
export interface SusulanBatchItemReason {
    student_id: string
    reason: string
}

export type SusulanBatchResult =
    | {
        success: true
        max_percent: number
        opened: SusulanBatchItemOk[]
        updated: SusulanBatchItemOk[]
        skipped: SusulanBatchItemReason[]
        failed: SusulanBatchItemReason[]
        opened_count: number
        updated_count: number
        skipped_count: number
        failed_count: number
    }
    | { success: false; status: number; error: string }

/**
 * Jalankan fn untuk tiap item dengan concurrency terbatas. `fn` WAJIB menangani
 * error-nya sendiri (tidak melempar) — kalau tetap melempar, exception
 * ditangkap di sini agar satu item gagal tidak menggugurkan seluruh batch.
 */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let idx = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (idx < items.length) {
            const current = items[idx++]
            try {
                await fn(current)
            } catch (e) {
                console.error('[susulanBatch] item gagal tak terduga:', e)
            }
        }
    })
    await Promise.all(workers)
}

export async function grantSusulanBatch(
    kind: SusulanKind,
    params: { examId: string; studentIds: unknown; maxPercent: unknown },
    ctx: SusulanAuthContext,
): Promise<SusulanBatchResult> {
    const examId = params.examId
    if (!examId || typeof examId !== 'string') {
        return { success: false, status: 400, error: 'exam_id wajib diisi' }
    }

    if (!Array.isArray(params.studentIds)) {
        return { success: false, status: 400, error: 'student_ids harus berupa array' }
    }
    // Dedup + buang nilai kosong (client bisa kirim duplikat dari pilih-semua).
    const studentIds = [...new Set(
        params.studentIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
    )]
    if (studentIds.length === 0) {
        return { success: false, status: 400, error: 'Tidak ada siswa yang dipilih' }
    }
    if (studentIds.length > SUSULAN_BATCH_MAX) {
        return {
            success: false,
            status: 400,
            error: `Maksimal ${SUSULAN_BATCH_MAX} siswa per sekali proses. Pilih sebagian dulu.`,
        }
    }

    const maxPercent = sanitizeSusulanMaxPercent(params.maxPercent)
    if (maxPercent === null) {
        return { success: false, status: 400, error: 'Persen nilai susulan tidak valid (1-100)' }
    }

    // Resolve konteks ujian SEKALI (exam, scope guru, status tahun, max_score)
    // — bukan per siswa. Menghindari ±1.800 query untuk batch 200 siswa.
    const resolved = await resolveSusulanGrantContext(kind, examId, ctx)
    if (!resolved.ok) {
        return { success: false, status: resolved.status, error: resolved.error }
    }
    const context = resolved.context

    const opened: SusulanBatchItemOk[] = []
    const updated: SusulanBatchItemOk[] = []
    const skipped: SusulanBatchItemReason[] = []
    const failed: SusulanBatchItemReason[] = []

    await mapLimit(studentIds, CONCURRENCY, async (studentId) => {
        const result = await grantSusulanWithContext(kind, context, { examId, studentId, maxPercent }, ctx)
        if (result.ok) {
            const item: SusulanBatchItemOk = {
                student_id: studentId,
                submission_id: result.submissionId,
                expires_at: result.expiresAt,
                max_percent: result.maxPercent,
            }
            if (result.created) opened.push(item)
            else updated.push(item)
            return
        }
        // 5xx = kegagalan sistem (boleh dicoba ulang); 4xx = aturan bisnis
        // (sudah mulai/selesai, bukan kelas guru, remedial, tahun selesai) → dilewati.
        const entry: SusulanBatchItemReason = { student_id: studentId, reason: result.error }
        if (result.status >= 500) failed.push(entry)
        else skipped.push(entry)
    })

    return {
        success: true,
        max_percent: maxPercent,
        opened,
        updated,
        skipped,
        failed,
        opened_count: opened.length,
        updated_count: updated.length,
        skipped_count: skipped.length,
        failed_count: failed.length,
    }
}
