'use client'

import { use } from 'react'
import ExamMonitorPage from '@/components/exam/ExamMonitorPage'

// Monitor live UTS/UAS. ?type=ulangan tetap diarahkan ke mode ulangan untuk
// backward-compat (link lama / PWA ter-cache sebelum monitor ulangan pindah rute).
export default function GuruUtsUasMonitorPage({ params, searchParams }: {
    params: Promise<{ id: string }>
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const { id: examId } = use(params)
    const spRaw = use(searchParams ?? Promise.resolve({}))
    const isUlangan = (spRaw as { type?: string } | undefined)?.type === 'ulangan'
    // backHref eksplisit ke detail editor (paritas guru/ulangan/[id]/monitor).
    // Tanpa ini default ExamMonitorPage = '/dashboard/guru/ulangan' → guru UTS/UAS
    // klik "Kembali" ke list ulangan (salah rute). ?type=ulangan legacy tetap
    // di-redirect ke detail ulangan.
    const backHref = isUlangan
        ? `/dashboard/guru/ulangan/${examId}`
        : `/dashboard/guru/uts-uas/${examId}`
    return <ExamMonitorPage examId={examId} mode={isUlangan ? 'ulangan' : 'official'} backHref={backHref} />
}
