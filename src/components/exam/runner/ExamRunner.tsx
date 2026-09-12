'use client'

import { useExamRunner } from './useExamRunner'
import { ExamRunnerView } from './ExamRunnerView'
import type { ExamRunnerConfig } from './types'

/**
 * Ruang ujian siswa — satu komponen untuk semua tipe ujian (ulangan, UTS/UAS).
 * Halaman hanya menyediakan ExamRunnerConfig; seluruh perilaku dan tampilan
 * tinggal pakai. Preview guru/admin memakai ExamRunnerView langsung (mode
 * preview) dengan state dari useExamPreviewState.
 */
export default function ExamRunner({ examId, config }: { examId: string; config: ExamRunnerConfig }) {
    const state = useExamRunner(examId, config)
    return <ExamRunnerView state={state} mode="live" />
}
