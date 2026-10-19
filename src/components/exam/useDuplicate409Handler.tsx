'use client'

import { useState, useCallback, type ReactNode } from 'react'
import DuplicateConfirmDialog, { type DuplicateConfirmHit } from './DuplicateConfirmDialog'

interface DuplicateConflict {
    hits: DuplicateConfirmHit[]
    retry: () => void
}

/**
 * Handler reusable untuk 409 DUPLICATE_TITLE dari server response.
 *
 * Pre-flight `useDuplicateGuard` hanya cover ulangan (exams). Untuk official_exams
 * (UTS/UAS), server guard 409 adalah PRIMARY UX (bukan backstop). Hook ini menangkap
 * 409 dari POST /api/official-exams & /api/official-exams/duplicate, menampilkan
 * DuplicateConfirmDialog (reuse komponen existing), dan menawarkan retry dgn
 * `force_duplicate: true`.
 *
 * Penggunaan:
 *   const { handle409, dialog } = useDuplicate409Handler(labels.uts/uas)
 *   // Di handler POST:
 *   if (!res.ok) {
 *       const err = await res.json().catch(() => ({}))
 *       if (handle409(err, () => retryPostWithForceDuplicate())) return
 *       alert(err?.error || 'Gagal')
 *       return
 *   }
 *   // Di JSX:
 *   {dialog}
 */
export function useDuplicate409Handler(ulanganLabel: string) {
    const [pending, setPending] = useState<DuplicateConflict | null>(null)

    const handle409 = useCallback((errData: unknown, retry: () => void): boolean => {
        if (!errData || typeof errData !== 'object') return false
        const err = errData as { error?: string; existing?: { title?: string; subjectName?: string; className?: string; isActive?: boolean | null; submissionCount?: number } }
        if (err.error !== 'DUPLICATE_TITLE' || !err.existing) return false
        setPending({
            hits: [{
                className: err.existing.subjectName || err.existing.className || null,
                existingTitle: err.existing.title || '',
                isActive: err.existing.isActive ?? null,
            }],
            retry,
        })
        return true
    }, [])

    const handleConfirm = useCallback(() => {
        if (!pending) return
        pending.retry()
        setPending(null)
    }, [pending])

    const handleClose = useCallback(() => {
        setPending(null)
    }, [])

    const dialog: ReactNode = pending ? (
        <DuplicateConfirmDialog
            open
            onClose={handleClose}
            onConfirm={handleConfirm}
            hits={pending.hits}
            ulanganLabel={ulanganLabel}
        />
    ) : null

    return { handle409, dialog }
}
