'use client'

import { useParams } from 'next/navigation'
import { ExamRunner } from '@/components/exam/runner'
import type { ExamRunnerConfig } from '@/components/exam/runner'
import { useSchoolLabels } from '@/contexts/LabelsContext'
import { labelForGradeType } from '@/lib/labels'

/**
 * Halaman pengerjaan UTS/UAS siswa — wrapper tipis untuk ExamRunner.
 * Flow & tampilan kini 1:1 dengan ulangan (audio listening, resume modal,
 * offline timeout, warna primary, dsb.) — perbedaan hanya di config ini.
 */
export default function TakeOfficialExamPage() {
    const params = useParams()
    const examId = params.id as string
    const labels = useSchoolLabels()

    const config: ExamRunnerConfig = {
        examApiBase: '/api/official-exams',
        submissionApi: '/api/official-exam-submissions',
        storagePrefix: 'official_exam',
        listRoute: '/dashboard/siswa/ulangan',
        resultRoute: (id) => `/dashboard/siswa/uts-uas/${id}/hasil`,
        resolveLabel: (exam) => labelForGradeType(exam.exam_type || 'UTS', labels),
        fallbackLabel: 'Ujian',
    }

    return <ExamRunner examId={examId} config={config} />
}
