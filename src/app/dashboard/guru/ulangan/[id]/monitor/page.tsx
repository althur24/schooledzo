'use client'

import { use } from 'react'
import ExamMonitorPage from '@/components/exam/ExamMonitorPage'

// Monitor live ulangan harian — kini hidup di halaman ulangan sendiri
// (sebelumnya di-hosting di rute uts-uas dengan ?type=ulangan)
export default function GuruUlanganMonitorPage({ params }: {
    params: Promise<{ id: string }>
}) {
    const { id } = use(params)
    return <ExamMonitorPage examId={id} mode="ulangan" />
}
