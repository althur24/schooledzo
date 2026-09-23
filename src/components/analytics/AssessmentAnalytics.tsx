'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui'
import { Loader2, BarChart3, ChevronDown, ChevronUp } from 'lucide-react'
import ClassOverviewCards from './ClassOverviewCards'
import ScoreDistributionChart from './ScoreDistributionChart'
import QuestionAnalysisChart from './QuestionAnalysisChart'
import TimeAnalysisChart from './TimeAnalysisChart'
import PerformanceHeatmap from './PerformanceHeatmap'
import StudentRankingTable from './StudentRankingTable'
import { formatScore } from '@/lib/formatScore'

// ─── Types ────────────────────────────────────────────────────
export interface ClassOverview {
    totalStudents: number
    submitted: number
    avgScore: number
    highestScore: number
    lowestScore: number
    median: number
    stdDev: number
    passRate: number
    kkm: number | null
    maxScore: number
    avgRawScore: number
    highestRawScore: number
    lowestRawScore: number
    medianRaw: number
}

export interface ScoreDistItem {
    range: string
    count: number
}

export interface QuestionAnalysisItem {
    questionIndex: number
    questionText: string
    questionType: string
    correctRate: number
    /** % siswa yang mendapat kredit APA PUN (skor > 0) — utk GK PROPORTIONAL
     *  menangkap jawaban parsial; MC/TF identik dgn correctRate. */
    partialRate?: number
    avgScore: number
    maxPoints: number
    optionDistribution?: { option: string; count: number; isCorrect: boolean }[]
}

export interface TimeAnalysisItem {
    studentName: string
    duration: number
    score: number
}

export interface HeatmapAnswer {
    questionIndex: number
    isCorrect: boolean | null
    scoreEarned: number
    maxPoints: number
    questionType: string
}

export interface HeatmapStudent {
    studentName: string
    studentNis: string
    totalScore: number
    answers: HeatmapAnswer[]
}

export interface StudentRankItem {
    name: string
    nis: string
    /** Nama kelas — terisi saat merge batch ulangan multi-kelas */
    className?: string
    score: number
    maxScore: number
    percentage: number
    duration?: number
    violations?: number
}

export interface AnalyticsData {
    classOverview: ClassOverview
    scoreDistribution: ScoreDistItem[]
    questionAnalysis: QuestionAnalysisItem[]
    timeAnalysis: TimeAnalysisItem[]
    performanceHeatmap: HeatmapStudent[]
    studentRanking: StudentRankItem[]
    totalQuestions: number
}

// ─── Props ────────────────────────────────────────────────────
interface AssessmentAnalyticsProps {
    assessmentId: string
    assessmentType: 'quiz' | 'exam' | 'official-exam'
    classId?: string // for official-exam multi-class filter
    /** Merge analitik SEMUA member batch ulangan multi-kelas (mode "Semua Kelas") */
    batchId?: string
}

export default function AssessmentAnalytics({
    assessmentId,
    assessmentType,
    classId,
    batchId
}: AssessmentAnalyticsProps) {
    const [data, setData] = useState<AnalyticsData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isExpanded, setIsExpanded] = useState(false)

    useEffect(() => {
        const fetchAnalytics = async () => {
            setLoading(true)
            setError(null)
            try {
                const params = new URLSearchParams()
                if (classId) params.set('class_id', classId)
                if (batchId) params.set('batch_id', batchId)
                const qs = params.toString()
                const res = await fetch(`/api/analytics/${assessmentType}/${assessmentId}${qs ? `?${qs}` : ''}`)
                if (!res.ok) {
                    throw new Error('Gagal memuat data analytics')
                }
                const json = await res.json()
                setData(json)
            } catch (err: any) {
                setError(err.message || 'Terjadi kesalahan')
            } finally {
                setLoading(false)
            }
        }
        fetchAnalytics()
    }, [assessmentId, assessmentType, classId, batchId])

    if (loading) {
        return (
            <Card className="flex items-center justify-center gap-3 py-12">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-sm text-text-secondary">Memuat analytics...</span>
            </Card>
        )
    }

    if (error) {
        return (
            <Card className="py-8 text-center">
                <p className="text-red-500 text-sm">{error}</p>
            </Card>
        )
    }

    if (!data || data.classOverview.submitted === 0) {
        return (
            <Card className="py-8 text-center">
                <BarChart3 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-text-secondary">Belum ada data untuk ditampilkan analytics.</p>
            </Card>
        )
    }

    return (
        <div className="space-y-1">
            {/* Toggle Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-5 py-4 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 hover:shadow-md transition-all group"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-emerald-100 text-emerald-600 group-hover:bg-emerald-200 transition-colors">
                        <BarChart3 className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                        <h3 className="font-bold text-slate-800 text-sm">📊 Analisis Pembelajaran</h3>
                        <p className="text-xs text-slate-500">
                            Rata-rata {formatScore(data.classOverview.avgRawScore)}/{formatScore(data.classOverview.maxScore)} • {data.classOverview.submitted}/{data.classOverview.totalStudents} siswa
                        </p>
                    </div>
                </div>
                <div className="text-slate-400 group-hover:text-slate-600 transition-colors">
                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
            </button>

            {/* Expandable Content */}
            {isExpanded && (
                <div className="space-y-5 pt-4 animate-in slide-in-from-top-2 duration-300">
                    {/* Class Overview Cards */}
                    <ClassOverviewCards data={data.classOverview} />

                    {/* Charts Grid — 2 columns on desktop */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <ScoreDistributionChart data={data.scoreDistribution} />
                        <QuestionAnalysisChart data={data.questionAnalysis} />
                    </div>

                    {/* Time Analysis — full width */}
                    {data.timeAnalysis.length > 0 && (
                        <TimeAnalysisChart data={data.timeAnalysis} />
                    )}

                    {/* Performance Heatmap — full width */}
                    {data.performanceHeatmap.length > 0 && (
                        <PerformanceHeatmap
                            data={data.performanceHeatmap}
                            totalQuestions={data.totalQuestions}
                        />
                    )}

                    {/* Student Ranking Table — full width */}
                    <StudentRankingTable
                        data={data.studentRanking}
                        kkm={data.classOverview.kkm}
                        showViolations={assessmentType !== 'quiz'}
                    />
                </div>
            )}
        </div>
    )
}
