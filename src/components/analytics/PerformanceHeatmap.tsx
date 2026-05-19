'use client'

import { Card } from '@/components/ui'
import { HeatmapStudent } from './AssessmentAnalytics'

interface PerformanceHeatmapProps {
    data: HeatmapStudent[]
    totalQuestions: number
}

function getCellColor(answer: { isCorrect: boolean | null; scoreEarned: number; maxPoints: number; questionType: string }): string {
    if (answer.isCorrect === null && answer.scoreEarned === 0) {
        // Not answered or essay not graded
        return answer.questionType === 'ESSAY' ? '#fef3c7' : '#f1f5f9'
    }
    if (answer.questionType === 'ESSAY') {
        // Essay: gradient based on score ratio
        const ratio = answer.maxPoints > 0 ? answer.scoreEarned / answer.maxPoints : 0
        if (ratio >= 0.8) return '#bbf7d0'
        if (ratio >= 0.5) return '#fef08a'
        if (ratio > 0) return '#fed7aa'
        return '#fef3c7'
    }
    // MC: binary
    return answer.isCorrect ? '#bbf7d0' : '#fecaca'
}

function getCellIcon(answer: { isCorrect: boolean | null; scoreEarned: number; maxPoints: number; questionType: string }): string {
    if (answer.isCorrect === null && answer.scoreEarned === 0) {
        return answer.questionType === 'ESSAY' ? '—' : '·'
    }
    if (answer.questionType === 'ESSAY') {
        const ratio = answer.maxPoints > 0 ? answer.scoreEarned / answer.maxPoints : 0
        if (ratio >= 0.8) return '✓'
        if (ratio > 0) return '△'
        return '—'
    }
    return answer.isCorrect ? '✓' : '✗'
}

export default function PerformanceHeatmap({ data, totalQuestions }: PerformanceHeatmapProps) {
    if (data.length === 0) return null

    return (
        <Card padding="p-5">
            <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-slate-800">🗺️ Heatmap Performa</h4>
                <div className="flex items-center gap-3">
                    {[
                        { color: '#bbf7d0', label: 'Benar' },
                        { color: '#fecaca', label: 'Salah' },
                        { color: '#fef3c7', label: 'Esai/Kosong' },
                    ].map(l => (
                        <div key={l.label} className="flex items-center gap-1 text-[10px] text-slate-500">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: l.color }} />
                            {l.label}
                        </div>
                    ))}
                </div>
            </div>

            <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-max min-w-full border-collapse">
                    <thead>
                        <tr>
                            <th className="sticky left-0 z-10 bg-white text-left px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider min-w-[140px]">
                                Siswa
                            </th>
                            {Array.from({ length: totalQuestions }, (_, i) => (
                                <th
                                    key={i}
                                    className="px-0.5 py-2 text-[10px] font-bold text-slate-400 text-center min-w-[28px]"
                                >
                                    {i + 1}
                                </th>
                            ))}
                            <th className="px-3 py-2 text-[10px] font-bold text-slate-400 text-right min-w-[50px]">
                                Total
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((student, sIdx) => (
                            <tr key={sIdx} className="group hover:bg-slate-50/50">
                                <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-3 py-1.5 border-t border-slate-100">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[9px] font-bold shrink-0">
                                            {sIdx + 1}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[11px] font-semibold text-slate-700 truncate max-w-[100px]">
                                                {student.studentName}
                                            </p>
                                        </div>
                                    </div>
                                </td>
                                {student.answers.map((ans, qIdx) => (
                                    <td key={qIdx} className="px-0.5 py-1.5 border-t border-slate-100">
                                        <div
                                            className="w-6 h-6 mx-auto rounded flex items-center justify-center text-[10px] font-bold transition-transform hover:scale-125 cursor-default"
                                            style={{ backgroundColor: getCellColor(ans) }}
                                            title={`Soal ${qIdx + 1}: ${ans.scoreEarned}/${ans.maxPoints}`}
                                        >
                                            <span style={{
                                                color: ans.isCorrect === true ? '#16a34a'
                                                    : ans.isCorrect === false ? '#dc2626'
                                                    : '#94a3b8'
                                            }}>
                                                {getCellIcon(ans)}
                                            </span>
                                        </div>
                                    </td>
                                ))}
                                <td className="px-3 py-1.5 border-t border-slate-100 text-right">
                                    <span className={`text-xs font-bold ${
                                        student.totalScore >= 80 ? 'text-emerald-600'
                                        : student.totalScore >= 60 ? 'text-blue-600'
                                        : student.totalScore >= 40 ? 'text-amber-600'
                                        : 'text-rose-600'
                                    }`}>
                                        {student.totalScore.toFixed(0)}%
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    )
}
