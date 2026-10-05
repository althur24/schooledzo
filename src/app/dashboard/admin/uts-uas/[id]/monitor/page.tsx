'use client'

import { use } from 'react'
import ExamMonitorPage from '@/components/exam/ExamMonitorPage'

/**
 * Monitor live admin — kini wrapper tipis di atas komponen bersama
 * ExamMonitorPage (dulu: salinan mandiri ~600 baris yang tertinggal
 * perbaikan guru: pause polling saat tab hidden, dedup fetch KKM,
 * guard badge LIVE). Fitur khas admin dipertahankan via props:
 * filter status + rute kembali ke detail/list admin.
 */
export default function AdminUtsUasMonitorPage({ params, searchParams }: {
    params: Promise<{ id: string }>
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const { id: examId } = use(params)
    const spRaw = use(searchParams ?? Promise.resolve({}))
    const isUlangan = (spRaw as { type?: string } | undefined)?.type === 'ulangan'
    // Ulangan batch multi-kelas: monitor SEMUA kelas member sekaligus (mirror UTS/UAS)
    const isBatch = isUlangan && (spRaw as { batch?: string } | undefined)?.batch === '1'
    // Kembali ke tab Ulangan di halaman list (tab kini hidup di URL — tanpa
    // ?tab=ulangan admin akan jatuh ke tab UTS/UAS lagi)
    const backHref = isUlangan ? '/dashboard/admin/uts-uas?tab=ulangan' : `/dashboard/admin/uts-uas/${examId}`

    return (
        <ExamMonitorPage
            examId={examId}
            mode={isUlangan ? 'ulangan' : 'official'}
            batch={isBatch}
            backHref={backHref}
            enableStatusFilter
        />
    )
}
