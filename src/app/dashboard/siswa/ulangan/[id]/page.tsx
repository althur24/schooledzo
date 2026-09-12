'use client'

import { useParams } from 'next/navigation'
import { ExamRunner } from '@/components/exam/runner'
import type { ExamRunnerConfig } from '@/components/exam/runner'
import { useSchoolLabels } from '@/contexts/LabelsContext'

/**
 * Halaman pengerjaan ulangan siswa — wrapper tipis untuk ExamRunner.
 * Seluruh perilaku & tampilan ruang ujian ada di src/components/exam/runner;
 * halaman hanya menyediakan config (endpoint, storage, route, label).
 *
 * JANGAN menambahkan markup soal di sini — ubah ExamRunnerView agar preview
 * guru/admin dan UTS/UAS ikut konsisten (rule "Ruang Ujian = ExamRunner").
 */
export default function TakeExamPage() {
    const params = useParams()
    const examId = params.id as string
    const labels = useSchoolLabels()

    const config: ExamRunnerConfig = {
        examApiBase: '/api/exams',
        submissionApi: '/api/exam-submissions',
        storagePrefix: 'exam',
        listRoute: '/dashboard/siswa/ulangan',
        resultRoute: (id) => `/dashboard/siswa/ulangan/${id}/hasil`,
        resolveLabel: () => labels.ulangan,
        fallbackLabel: labels.ulangan,
    }

    return <ExamRunner examId={examId} config={config} />
}
