'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/ui'
import Card from '@/components/ui/Card'
import { TickSquare, TimeCircle, Danger, Calendar } from 'react-iconly'

interface ExamResult {
    id: string
    total_score: number | null
    max_score: number | null
    results_hidden?: boolean
    violation_count: number
    started_at: string
    submitted_at: string
    exam: {
        title: string
        duration_minutes: number
        teaching_assignment: {
            subject: { name: string }
            class: { name: string }
        }
    }
}

interface Answer {
    id: string
    answer: string
    is_correct: boolean
    points_earned: number
    question: {
        question_text: string
        question_type: string
        options: string[] | null
        correct_answer: string | null
        points: number
    }
}

export default function ExamResultPage() {
    const params = useParams()
    const examId = params.id as string
    const [result, setResult] = useState<ExamResult | null>(null)
    const [answers, setAnswers] = useState<Answer[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchResult()
    }, [examId])

    const fetchResult = async () => {
        try {
            const res = await fetch(`/api/exam-submissions?exam_id=${examId}`)
            const data = await res.json()

            if (Array.isArray(data) && data.length > 0) {
                setResult(data[0])
            }
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const formatDuration = (start: string, end: string) => {
        const diff = new Date(end).getTime() - new Date(start).getTime()
        const mins = Math.floor(diff / 60000)
        const secs = Math.floor((diff % 60000) / 1000)
        return `${mins} menit ${secs} detik`
    }

    const getGradeColor = (percentage: number) => {
        if (percentage >= 80) return 'from-green-500 to-emerald-500'
        if (percentage >= 60) return 'from-blue-500 to-cyan-500'
        if (percentage >= 40) return 'from-yellow-500 to-amber-500'
        return 'from-red-500 to-rose-500'
    }

    if (loading) {
        return <div className="text-center text-text-secondary py-8">Memuat hasil...</div>
    }

    if (!result) {
        return (
            <div className="text-center text-text-secondary py-8">
                <p>Hasil tidak ditemukan</p>
                <Link href="/dashboard/siswa/ulangan" className="text-primary underline mt-2 inline-block">
                    Kembali
                </Link>
            </div>
        )
    }

    const maxScore = result.max_score || 1
    const percentage = result.results_hidden ? 0 : Math.round(((result.total_score || 0) / maxScore) * 100)

    return (
        <div className="space-y-6 max-w-3xl mx-auto">
            <PageHeader
                title="Hasil Ulangan"
                subtitle={result.exam?.title}
                backHref="/dashboard/siswa/ulangan"
            />

            {/* Score Card or Hidden State */}
            {result.results_hidden ? (
                <div className="bg-gradient-to-r from-slate-500 to-slate-700 p-8 rounded-2xl text-white text-center shadow-lg">
                    <div className="w-16 h-16 mx-auto bg-white/20 rounded-full flex items-center justify-center mb-4">
                        <TimeCircle set="bold" size={32} primaryColor="currentColor" />
                    </div>
                    <p className="text-xl font-bold mb-2">Menunggu Hasil</p>
                    <p className="opacity-90">Nilai akan muncul setelah guru membagikan hasil.</p>
                </div>
            ) : (
                <div className={`bg-gradient-to-r ${getGradeColor(percentage)} p-6 rounded-2xl text-white text-center shadow-lg`}>
                    <p className="text-lg opacity-90 mb-2 font-medium">{result.exam?.teaching_assignment?.subject?.name}</p>
                    <p className="text-6xl font-bold mb-2">{result.total_score}<span className="text-3xl opacity-80">/{result.max_score}</span></p>
                    <p className="text-2xl font-bold">{percentage}%</p>
                    <p className="mt-4 text-lg font-medium bg-white/20 inline-block px-4 py-1 rounded-full backdrop-blur-sm">
                        {percentage >= 80 ? '🎉 Excellent!' : percentage >= 60 ? '👍 Good Job!' : percentage >= 40 ? '💪 Keep Trying!' : '📚 Need More Study'}
                    </p>
                </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="text-center">
                    <div className="flex justify-center mb-2 text-primary">
                        <TimeCircle set="bold" primaryColor="currentColor" size={24} />
                    </div>
                    <p className="text-2xl font-bold text-text-main dark:text-white">{formatDuration(result.started_at, result.submitted_at)}</p>
                    <p className="text-sm text-text-secondary">Waktu Pengerjaan</p>
                </Card>
                <Card className="text-center">
                    <div className="flex justify-center mb-2 text-primary">
                        <Calendar set="bold" primaryColor="currentColor" size={24} />
                    </div>
                    <p className="text-2xl font-bold text-text-main dark:text-white">{result.exam?.duration_minutes} menit</p>
                    <p className="text-sm text-text-secondary">Batas Waktu</p>
                </Card>
                <Card className={`text-center ${result.violation_count > 0 ? 'border-red-500/50 bg-red-50 dark:bg-red-900/10' : ''}`}>
                    <div className={`flex justify-center mb-2 ${result.violation_count > 0 ? 'text-red-500' : 'text-green-500'}`}>
                        <Danger set="bold" primaryColor="currentColor" size={24} />
                    </div>
                    <p className={`text-2xl font-bold ${result.violation_count > 0 ? 'text-red-500' : 'text-green-500'}`}>{result.violation_count}</p>
                    <p className="text-sm text-text-secondary">Pelanggaran</p>
                </Card>
            </div>

            {/* Completion notice */}
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-center gap-3">
                <div className="text-green-500 flex"><TickSquare set="bold" size="large" primaryColor="currentColor" /></div>
                <div>
                    <p className="text-green-600 dark:text-green-400 font-bold">Ulangan Selesai</p>
                    <p className="text-sm text-text-secondary">Dikumpulkan pada {new Date(result.submitted_at).toLocaleString('id-ID')}</p>
                </div>
            </div>

            <Link
                href="/dashboard/siswa/ulangan"
                className="block w-full text-center px-6 py-3 bg-primary/10 text-primary-dark dark:text-primary rounded-xl hover:bg-primary/20 transition-colors font-bold"
            >
                ← Kembali ke Daftar Ulangan
            </Link>
        </div>
    )
}
