'use client'

import { use } from 'react'
import ExamMonitorPage from '@/components/exam/ExamMonitorPage'

// Monitor live ulangan harian — kini hidup di halaman ulangan sendiri
// (sebelumnya di-hosting di rute uts-uas dengan ?type=ulangan).
// ?batch=1 → monitor SEMUA kelas member batch multi-kelas (mirror UTS/UAS).
export default function GuruUlanganMonitorPage({ params, searchParams }: {
    params: Promise<{ id: string }>
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const { id } = use(params)
    const sp = use(searchParams ?? Promise.resolve({}))
    const batch = (sp as { batch?: string } | undefined)?.batch === '1'
    return <ExamMonitorPage examId={id} mode="ulangan" batch={batch} />
}
