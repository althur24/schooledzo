'use client'

import { useState, useCallback, type ReactNode } from 'react'
import { preflightDuplicateExam, checkDuplicatesInMemory, type DuplicateExamHit, type ExamListRow } from '@/lib/examDuplicateCheck'
import DuplicateConfirmDialog from './DuplicateConfirmDialog'

export interface DuplicateGuardResult {
    proceed: boolean
    /** true bila user sudah konfirmasi override — kirim force_duplicate: true di POST */
    forceDuplicate: boolean
}

/**
 * Guard duplikat-judul reusable untuk semua handler POST /api/exams
 * (create, Salin/Pakai Ulang, batch member).
 *
 * Alur:
 *   const dup = useDuplicateGuard(labels.ulangan)
 *   ...
 *   // Bila list page punya exams in-memory → pass untuk NOL fetch tambahan:
 *   const { proceed, forceDuplicate } = await dup.guard(taIds, title, exams)
 *   // Bila tidak (halaman [id] tanpa list) → omit arg → fallback fetch per-TA
 *   const { proceed, forceDuplicate } = await dup.guard(taIds, title)
 *   if (!proceed) return            // user batal
 *   // POST /api/exams dengan force_duplicate: forceDuplicate
 *
 *   // render di bawah JSX:
 *   {dup.dialog}
 *
 * Pre-flight: exam list in-memory (nol request) bila disupply; fallback fetch
 * per-TA bila tidak. Server guard 409 adalah backstop anti race.
 */
export function useDuplicateGuard(ulanganLabel: string) {
    const [pending, setPending] = useState<{
        hits: DuplicateExamHit[]
        resolve: (r: DuplicateGuardResult) => void
    } | null>(null)

    const guard = useCallback(
        async (taIds: string[], title: string, existingExams?: ExamListRow[]): Promise<DuplicateGuardResult> => {
            const hits = existingExams
                ? checkDuplicatesInMemory(existingExams, taIds, title)
                : await preflightDuplicateExam(taIds, title)
            if (hits.length === 0) return { proceed: true, forceDuplicate: false }
            return new Promise<DuplicateGuardResult>((resolve) => {
                setPending({ hits, resolve })
            })
        },
        [],
    )

    const handleConfirm = useCallback(() => {
        if (!pending) return
        pending.resolve({ proceed: true, forceDuplicate: true })
        setPending(null)
    }, [pending])

    const handleClose = useCallback(() => {
        if (!pending) return
        pending.resolve({ proceed: false, forceDuplicate: false })
        setPending(null)
    }, [pending])

    const dialog: ReactNode = pending ? (
        <DuplicateConfirmDialog
            open
            onClose={handleClose}
            onConfirm={handleConfirm}
            hits={pending.hits.map((h) => ({
                className: h.className,
                existingTitle: h.existing.title,
                isActive: h.existing.isActive,
            }))}
            ulanganLabel={ulanganLabel}
        />
    ) : null

    return { guard, dialog }
}
