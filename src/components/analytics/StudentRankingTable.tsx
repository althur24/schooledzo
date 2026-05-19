'use client'

import { Card } from '@/components/ui'
import { StudentRankItem } from './AssessmentAnalytics'
import { Trophy, AlertTriangle } from 'lucide-react'

interface StudentRankingTableProps {
    data: StudentRankItem[]
    kkm: number | null
    showViolations?: boolean
}

function getRankBadge(rank: number) {
    if (rank === 1) return <span className="text-lg">🥇</span>
    if (rank === 2) return <span className="text-lg">🥈</span>
    if (rank === 3) return <span className="text-lg">🥉</span>
    return <span className="text-xs font-bold text-slate-400">{rank}</span>
}

export default function StudentRankingTable({ data, kkm, showViolations }: StudentRankingTableProps) {
    if (data.length === 0) return null

    return (
        <Card padding="p-5">
            <div className="flex items-center gap-2 mb-4">
                <Trophy className="w-4 h-4 text-amber-500" />
                <h4 className="text-sm font-bold text-slate-800">🏆 Peringkat Siswa</h4>
            </div>

            <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full min-w-[500px]">
                    <thead>
                        <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                            <th className="text-center py-2.5 w-12">#</th>
                            <th className="text-left py-2.5">Siswa</th>
                            <th className="text-center py-2.5">Nilai</th>
                            <th className="text-center py-2.5">Persentase</th>
                            {data[0]?.duration !== undefined && (
                                <th className="text-center py-2.5">Durasi</th>
                            )}
                            {showViolations && (
                                <th className="text-center py-2.5">Pelanggaran</th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((s, idx) => {
                            const rank = idx + 1
                            const belowKkm = kkm !== null && s.percentage < kkm

                            return (
                                <tr
                                    key={idx}
                                    className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                                        rank <= 3 ? 'bg-amber-50/30' : ''
                                    } ${belowKkm ? 'bg-rose-50/30' : ''}`}
                                >
                                    <td className="text-center py-2.5 w-12">
                                        {getRankBadge(rank)}
                                    </td>
                                    <td className="py-2.5">
                                        <p className="text-xs font-semibold text-slate-700">{s.name}</p>
                                        <p className="text-[10px] text-slate-400">{s.nis}</p>
                                    </td>
                                    <td className="text-center py-2.5">
                                        <span className="text-xs font-bold text-slate-700">
                                            {s.score}/{s.maxScore}
                                        </span>
                                    </td>
                                    <td className="text-center py-2.5">
                                        <div className="inline-flex items-center gap-1.5">
                                            {/* Mini progress bar */}
                                            <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all"
                                                    style={{
                                                        width: `${Math.min(s.percentage, 100)}%`,
                                                        backgroundColor: s.percentage >= 80 ? '#22c55e'
                                                            : s.percentage >= 60 ? '#3b82f6'
                                                            : s.percentage >= 40 ? '#f59e0b'
                                                            : '#ef4444'
                                                    }}
                                                />
                                            </div>
                                            <span className={`text-xs font-bold ${
                                                belowKkm ? 'text-rose-500' : 'text-slate-700'
                                            }`}>
                                                {s.percentage.toFixed(1)}%
                                            </span>
                                        </div>
                                    </td>
                                    {s.duration !== undefined && (
                                        <td className="text-center py-2.5">
                                            <span className="text-[11px] text-slate-500 font-mono">
                                                {s.duration.toFixed(1)}m
                                            </span>
                                        </td>
                                    )}
                                    {showViolations && (
                                        <td className="text-center py-2.5">
                                            {(s.violations || 0) > 0 ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">
                                                    <AlertTriangle className="w-3 h-3" />
                                                    {s.violations}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] text-slate-300">—</span>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </Card>
    )
}
