'use client'

import { useState } from 'react'
import { FileDown } from 'lucide-react'
import { Button } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'
import type { AnalyticsData } from '../AssessmentAnalytics'
import type { ExamAnalyticsMeta } from './ExamAnalyticsPDF'

export type PDFMetaInput = Omit<ExamAnalyticsMeta, 'schoolName'>

interface PDFDownloadButtonProps {
    assessmentId: string
    assessmentType: 'quiz' | 'exam' | 'official-exam'
    classId?: string
    /** Merge analitik SEMUA member batch ulangan multi-kelas (mode "Semua Kelas") */
    batchId?: string
    meta: PDFMetaInput
    disabled?: boolean
    label?: string
    className?: string
}

function sanitizeFileName(s: string): string {
    return s.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'Laporan'
}

export default function PDFDownloadButton({
    assessmentId,
    assessmentType,
    classId,
    batchId,
    meta,
    disabled,
    label = 'Unduh PDF',
    className,
}: PDFDownloadButtonProps) {
    const { user } = useAuth()
    const [loading, setLoading] = useState(false)

    const handleClick = async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (classId) params.set('class_id', classId)
            if (batchId) params.set('batch_id', batchId)
            const qs = params.toString()
            const res = await fetch(`/api/analytics/${assessmentType}/${assessmentId}${qs ? `?${qs}` : ''}`)
            if (!res.ok) throw new Error('Gagal memuat data analitik')
            const data: AnalyticsData = await res.json()
            if (!data.classOverview.submitted) {
                throw new Error('Belum ada pengumpulan yang bisa dilaporkan')
            }

            const [{ pdf }, { default: ExamAnalyticsPDF }] = await Promise.all([
                import('@react-pdf/renderer'),
                import('./ExamAnalyticsPDF'),
            ])

            const fullMeta: ExamAnalyticsMeta = {
                ...meta,
                schoolName: user?.school_name || 'LMS',
            }

            const blob = await pdf(<ExamAnalyticsPDF data={data} meta={fullMeta} />).toBlob()

            const fileName = `Analitik_${sanitizeFileName(meta.typeLabel)}_${sanitizeFileName(meta.title)}${meta.className ? `_${sanitizeFileName(meta.className)}` : ''}.pdf`
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = fileName
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
        } catch (err: any) {
            alert(err?.message || 'Gagal membuat PDF')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Button
            onClick={handleClick}
            loading={loading}
            disabled={disabled}
            size="sm"
            className={`bg-emerald-500 hover:bg-emerald-600 text-white ${className || ''}`}
            icon={<FileDown className="w-4 h-4" />}
        >
            {label}
        </Button>
    )
}
