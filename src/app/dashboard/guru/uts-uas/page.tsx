'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import { Loader2, GraduationCap, FileText, Clock, Users, BookOpen } from 'lucide-react'

interface OfficialExam {
    id: string
    exam_type: 'UTS' | 'UAS'
    title: string
    description: string | null
    start_time: string
    duration_minutes: number
    is_active: boolean
    question_count: number
    target_class_ids: string[]
    subject: { id: string; name: string }
}

export default function GuruUtsUasPage() {
    const [exams, setExams] = useState<OfficialExam[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchExams()
    }, [])

    const fetchExams = async () => {
        try {
            const res = await fetch('/api/official-exams')
            const data = await res.json()
            setExams(Array.isArray(data) ? data : [])
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const getExamStatus = (exam: OfficialExam) => {
        const now = new Date()
        const startTime = new Date(exam.start_time)
        const endTime = new Date(startTime.getTime() + exam.duration_minutes * 60000)

        if (now < startTime) return { label: 'Terjadwal', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' }
        if (now >= startTime && now <= endTime) return { label: 'Berlangsung', color: 'bg-green-500/10 text-green-600 dark:text-green-400' }
        return { label: 'Selesai', color: 'bg-secondary/10 text-text-secondary' }
    }

    const formatDateTime = (dateString: string) => {
        return new Date(dateString).toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        })
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="UTS / UAS"
                subtitle="Lihat hasil ujian resmi untuk mata pelajaran Anda"
                icon={<div className="text-indigo-500"><GraduationCap className="w-6 h-6" /></div>}
                backHref="/dashboard/guru"
            />

            {/* Info card */}
            <Card padding="p-4" className="bg-gradient-to-r from-indigo-500/5 to-purple-500/5 border-indigo-200/50 dark:border-indigo-500/20">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600">
                        <BookOpen className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-bold text-text-main dark:text-white text-sm">Hanya Baca & Koreksi Essay</h3>
                        <p className="text-xs text-text-secondary">Anda hanya melihat ujian yang sesuai dengan mata pelajaran yang Anda ajar. Untuk soal essay, Anda dapat melakukan koreksi manual.</p>
                    </div>
                </div>
            </Card>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                </div>
            ) : exams.length === 0 ? (
                <EmptyState
                    icon={<div className="text-indigo-400"><GraduationCap className="w-12 h-12" /></div>}
                    title="Belum Ada Ujian"
                    description="Ujian UTS/UAS yang terkait dengan mata pelajaran Anda akan muncul di sini."
                />
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {exams.map(exam => {
                        const status = getExamStatus(exam)
                        const isLive = status.label === 'Berlangsung'
                        const targetHref = isLive 
                            ? `/dashboard/guru/uts-uas/${exam.id}/monitor`
                            : `/dashboard/guru/uts-uas/${exam.id}/hasil`

                        return (
                            <Link key={exam.id} href={targetHref}>
                                <Card padding="p-5" className={`group hover:shadow-lg transition-all cursor-pointer h-full ${
                                    isLive 
                                    ? 'hover:border-red-500/50 hover:shadow-red-500/10 border-red-500/20 bg-gradient-to-br from-red-500/5 to-transparent' 
                                    : 'hover:border-primary/50 hover:shadow-primary/5'
                                }`}>
                                    <div className="flex flex-col h-full gap-3">
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${status.color}`}>
                                                    {isLive ? (
                                                        <span className="flex items-center gap-1.5">
                                                            <span className="relative flex h-2 w-2">
                                                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                                            </span>
                                                            {status.label}
                                                        </span>
                                                    ) : status.label}
                                                </span>
                                                <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${exam.exam_type === 'UTS' ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'}`}>
                                                    {exam.exam_type}
                                                </span>
                                            </div>
                                            {isLive && (
                                                <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-1 rounded border border-red-200 uppercase tracking-wider">
                                                    Pantau Live ➔
                                                </span>
                                            )}
                                        </div>

                                        <h3 className={`font-bold text-lg transition-colors ${isLive ? 'text-red-700 dark:text-red-400 group-hover:text-red-600' : 'text-text-main dark:text-white group-hover:text-primary'}`}>{exam.title}</h3>
                                        <p className="text-sm text-text-secondary line-clamp-1">{exam.description || 'Tidak ada deskripsi'}</p>

                                        <div className="space-y-2 pt-3 border-t border-secondary/10 mt-auto">
                                            <div className="flex items-center justify-between text-xs text-text-secondary">
                                                <span>Mata Pelajaran</span>
                                                <span className="font-bold text-primary">{exam.subject?.name}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-text-secondary">
                                                <span>Kelas Target</span>
                                                <span className="font-medium flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {exam.target_class_ids?.length || 0}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-text-secondary">
                                                <span>Soal & Durasi</span>
                                                <div className="flex gap-3">
                                                    <span className="flex items-center gap-1 font-medium"><FileText className="w-3.5 h-3.5" /> {exam.question_count}</span>
                                                    <span className="flex items-center gap-1 font-medium"><Clock className="w-3.5 h-3.5" /> {exam.duration_minutes}m</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-text-secondary">
                                                <span>Mulai</span>
                                                <span className="font-medium">{formatDateTime(exam.start_time)}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-text-secondary pb-1">
                                                <span>Berakhir</span>
                                                <span className="font-medium text-red-500 dark:text-red-400">
                                                    {formatDateTime(new Date(new Date(exam.start_time).getTime() + exam.duration_minutes * 60000).toISOString())}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            </Link>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
