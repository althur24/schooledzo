'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Modal, PageHeader, Button } from '@/components/ui'
import AssessmentAnalytics from '@/components/analytics/AssessmentAnalytics'
import { useSchoolLabels } from '@/contexts/LabelsContext'

interface ExamSubmission {
    id: string
    started_at: string
    submitted_at: string | null
    is_submitted: boolean
    total_score: number
    merged_from_remedial?: boolean
    max_score: number
    is_graded: boolean
    violation_count: number
    violations_log: Array<{ type: string; timestamp: string }>
    student: {
        id: string
        nis: string
        user: { full_name: string }
    }
}

interface Exam {
    id: string
    title: string
    description: string | null
    start_time: string
    duration_minutes: number
    max_violations: number
    teaching_assignment: {
        subject: { name: string }
        class: { name: string }
    }
}

export default function GuruExamHasilPage() {
    const params = useParams()
    const examId = params.id as string
    const labels = useSchoolLabels()

    const [exam, setExam] = useState<Exam | null>(null)
    const [submissions, setSubmissions] = useState<ExamSubmission[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedSubmission, setSelectedSubmission] = useState<ExamSubmission | null>(null)

    const fetchData = useCallback(async () => {
        try {
            const [examRes, subsRes] = await Promise.all([
                fetch(`/api/exams/${examId}`),
                fetch(`/api/exam-submissions?exam_id=${examId}`)
            ])
            const examData = await examRes.json()
            const subsData = await subsRes.json()

            setExam(examData)
            setSubmissions(Array.isArray(subsData) ? subsData : [])
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }, [examId])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    const getScoreColor = (score: number, max: number) => {
        const percentage = (score / max) * 100
        if (percentage >= 80) return 'text-green-400 bg-green-500/20'
        if (percentage >= 60) return 'text-yellow-400 bg-yellow-500/20'
        return 'text-red-400 bg-red-500/20'
    }

    const formatDuration = (start: string, end: string | null) => {
        if (!start || !end) return '-'
        const startTime = new Date(start).getTime()
        const endTime = new Date(end).getTime()
        if (isNaN(startTime) || isNaN(endTime)) return '-'
        const diff = Math.abs(endTime - startTime)
        const mins = Math.floor(diff / 60000)
        const secs = Math.floor((diff % 60000) / 1000)
        return `${mins}m ${secs}s`
    }

    const calculateStats = () => {
        const submitted = submissions.filter(s => s.is_submitted)
        if (submitted.length === 0) return { avg: 0, highest: 0, lowest: 0, count: 0 }

        const scores = submitted.map(s => (s.total_score / s.max_score) * 100)
        return {
            avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
            highest: Math.round(Math.max(...scores)),
            lowest: Math.round(Math.min(...scores)),
            count: submitted.length
        }
    }

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <div className="animate-spin text-3xl text-primary">⏳</div>
            </div>
        )
    }

    if (!exam) {
        return (
            <div className="text-center py-8">
                <p className="text-text-secondary">{labels.ulangan} tidak ditemukan</p>
            </div>
        )
    }

    const stats = calculateStats()

    return (
        <div className="space-y-6">
            <PageHeader
                title={`📊 Hasil: ${exam.title}`}
                subtitle={`${exam.teaching_assignment?.class?.name} • ${exam.teaching_assignment?.subject?.name}`}
                backHref="/dashboard/guru/ulangan"
            />

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-4 text-center shadow-sm">
                    <p className="text-2xl md:text-3xl font-bold text-purple-600 dark:text-purple-400">{stats.count}</p>
                    <p className="text-xs text-text-secondary dark:text-zinc-400">Mengumpulkan</p>
                </div>
                <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-4 text-center shadow-sm">
                    <p className="text-2xl md:text-3xl font-bold text-blue-600 dark:text-blue-400">{stats.avg}%</p>
                    <p className="text-xs text-text-secondary dark:text-zinc-400">Rata-rata</p>
                </div>
                <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-4 text-center shadow-sm">
                    <p className="text-2xl md:text-3xl font-bold text-green-600 dark:text-green-400">{stats.highest}%</p>
                    <p className="text-xs text-text-secondary dark:text-zinc-400">Tertinggi</p>
                </div>
                <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-4 text-center shadow-sm">
                    <p className="text-2xl md:text-3xl font-bold text-red-600 dark:text-red-400">{stats.lowest}%</p>
                    <p className="text-xs text-text-secondary dark:text-zinc-400">Terendah</p>
                </div>
            </div>

            {/* Analytics Dashboard */}
            {submissions.filter(s => s.is_submitted).length > 0 && (
                <AssessmentAnalytics
                    assessmentId={examId}
                    assessmentType="exam"
                />
            )}

            {/* Submissions Table */}
            <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-secondary/20 dark:border-white/10 bg-secondary/5 dark:bg-black/10">
                                <th className="text-left p-4 text-text-secondary dark:text-zinc-400 font-medium">Siswa</th>
                                <th className="text-center p-4 text-text-secondary dark:text-zinc-400 font-medium">Status</th>
                                <th className="text-center p-4 text-text-secondary dark:text-zinc-400 font-medium">Nilai</th>
                                <th className="text-center p-4 text-text-secondary dark:text-zinc-400 font-medium">Durasi</th>
                                <th className="text-center p-4 text-text-secondary dark:text-zinc-400 font-medium">Pelanggaran</th>
                                <th className="text-center p-4 text-text-secondary dark:text-zinc-400 font-medium">Status Koreksi</th>
                                <th className="text-center p-4 text-text-secondary dark:text-zinc-400 font-medium">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-secondary/20 dark:divide-white/10">
                            {submissions.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-8 text-center text-text-secondary dark:text-zinc-400">
                                        Belum ada siswa yang mengerjakan
                                    </td>
                                </tr>
                            ) : (
                                submissions.map((sub) => (
                                    <tr key={sub.id} className="hover:bg-secondary/10 dark:hover:bg-white/5">
                                        <td className="p-4">
                                            <p className="text-text-main dark:text-white font-medium">{sub.student?.user?.full_name}</p>
                                            <p className="text-xs text-text-secondary dark:text-zinc-500">{sub.student?.nis}</p>
                                        </td>
                                        <td className="p-4 text-center">
                                            {sub.is_submitted ? (
                                                <span className="px-2 py-1 bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 rounded-full text-xs">✓ Selesai</span>
                                            ) : (
                                                <span className="px-2 py-1 bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 rounded-full text-xs">⏳ Mengerjakan</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-center">
                                            {sub.is_submitted ? (
                                                <span
                                                    className={`px-3 py-1 rounded-full font-bold ${getScoreColor(sub.total_score, sub.max_score)}`}
                                                    title={sub.merged_from_remedial ? 'Nilai tergabung dengan remedial sesuai kebijakan nilai remedial — nilai mentah ujian asli tidak berubah' : undefined}
                                                >
                                                    {sub.total_score}/{sub.max_score}
                                                    {sub.merged_from_remedial && ' ⤴'}
                                                </span>
                                            ) : (
                                                <span className="text-text-secondary dark:text-zinc-500">-</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-center text-text-secondary dark:text-zinc-300 text-sm">
                                            {formatDuration(sub.started_at, sub.submitted_at)}
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className={`px-2 py-1 rounded ${sub.violation_count > 0 ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400' : 'bg-secondary/10 text-text-secondary dark:text-zinc-400'}`}>
                                                {sub.violation_count}
                                            </span>
                                        </td>
                                        <td className="p-4 text-center">
                                            {sub.is_submitted ? (
                                                sub.is_graded ? (
                                                    <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">
                                                        Selesai Dinilai
                                                    </span>
                                                ) : (
                                                    <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded-full animate-pulse">
                                                        Perlu Koreksi
                                                    </span>
                                                )
                                            ) : (
                                                <span className="text-text-secondary dark:text-zinc-500 text-xs">-</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-center">
                                            {sub.is_submitted ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <Link href={`/dashboard/guru/ulangan/${examId}/hasil/${sub.id}`}>
                                                        <Button
                                                            size="sm"
                                                            variant={sub.is_graded ? 'ghost' : 'primary'}
                                                            className={!sub.is_graded ? 'bg-gradient-to-r from-blue-600 to-cyan-600' : ''}
                                                        >
                                                            {sub.is_graded ? 'Lihat' : 'Koreksi'}
                                                        </Button>
                                                    </Link>
                                                    <button
                                                        onClick={() => setSelectedSubmission(sub)}
                                                        className="px-3 py-1 bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-500/30 transition-colors text-sm"
                                                    >
                                                        Detail
                                                    </button>
                                                </div>
                                            ) : (
                                                <span className="text-text-secondary dark:text-zinc-500 text-xs">Mengerjakan</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Submission Detail Modal */}
            <Modal
                open={!!selectedSubmission}
                onClose={() => setSelectedSubmission(null)}
                title="Detail Submission"
                maxWidth="lg"
            >
                {selectedSubmission && (
                    <div className="space-y-4">
                        <div className="bg-secondary/10 rounded-xl p-4">
                            <p className="text-sm text-text-secondary dark:text-zinc-400">Siswa</p>
                            <p className="text-lg font-bold text-text-main dark:text-white">{selectedSubmission.student?.user?.full_name}</p>
                            <p className="text-sm text-text-secondary dark:text-zinc-500">NIS: {selectedSubmission.student?.nis}</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-secondary/10 rounded-xl p-4 text-center">
                                <p className="text-sm text-text-secondary dark:text-zinc-400">Nilai</p>
                                <p className={`text-xl md:text-2xl font-bold ${getScoreColor(selectedSubmission.total_score, selectedSubmission.max_score).split(' ')[0]}`}>
                                    {selectedSubmission.total_score}/{selectedSubmission.max_score}
                                </p>
                            </div>
                            <div className="bg-secondary/10 rounded-xl p-4 text-center">
                                <p className="text-sm text-text-secondary dark:text-zinc-400">Pelanggaran</p>
                                <p className={`text-xl md:text-2xl font-bold ${selectedSubmission.violation_count > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                    {selectedSubmission.violation_count}
                                </p>
                            </div>
                        </div>

                        <div className="bg-secondary/10 rounded-xl p-4">
                            <p className="text-sm text-text-secondary dark:text-zinc-400 mb-2">Waktu</p>
                            <div className="text-sm text-text-main dark:text-zinc-300 space-y-1">
                                <p>Mulai: {new Date(selectedSubmission.started_at).toLocaleString('id-ID')}</p>
                                <p>Selesai: {selectedSubmission.submitted_at ? new Date(selectedSubmission.submitted_at).toLocaleString('id-ID') : '-'}</p>
                                <p>Durasi: {formatDuration(selectedSubmission.started_at, selectedSubmission.submitted_at)}</p>
                            </div>
                        </div>

                        {selectedSubmission.violations_log && selectedSubmission.violations_log.length > 0 && (
                            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
                                <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-2">⚠️ Log Pelanggaran</p>
                                <div className="space-y-1 text-sm">
                                    {selectedSubmission.violations_log.map((v, idx) => (
                                        <div key={idx} className="flex justify-between text-text-main dark:text-zinc-300">
                                            <span>{v.type}</span>
                                            <span className="text-text-secondary dark:text-zinc-500">{new Date(v.timestamp).toLocaleTimeString('id-ID')}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </Modal>
        </div>
    )
}
