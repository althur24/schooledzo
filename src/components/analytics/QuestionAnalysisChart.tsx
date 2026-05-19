'use client'

import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Card } from '@/components/ui'
import { QuestionAnalysisItem } from './AssessmentAnalytics'
import { ChevronDown } from 'lucide-react'

interface QuestionAnalysisChartProps {
    data: QuestionAnalysisItem[]
}

function getDifficultyColor(rate: number): string {
    if (rate >= 80) return '#22c55e'      // Easy — green
    if (rate >= 60) return '#3b82f6'      // Medium — blue
    if (rate >= 40) return '#f59e0b'      // Hard — amber
    return '#ef4444'                       // Very Hard — red
}

function getDifficultyLabel(rate: number): string {
    if (rate >= 80) return 'Mudah'
    if (rate >= 60) return 'Sedang'
    if (rate >= 40) return 'Sulit'
    return 'Sangat Sulit'
}

export default function QuestionAnalysisChart({ data }: QuestionAnalysisChartProps) {
    const [expandedQ, setExpandedQ] = useState<number | null>(null)

    const chartData = data.map(q => ({
        name: `S${q.questionIndex}`,
        correctRate: q.correctRate,
        questionIndex: q.questionIndex
    }))

    return (
        <Card padding="p-5">
            <h4 className="text-sm font-bold text-slate-800 mb-4">🎯 Analisis Per Soal</h4>

            {/* Difficulty Bar Chart */}
            <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis
                            dataKey="name"
                            tick={{ fontSize: 10, fill: '#64748b' }}
                            tickLine={false}
                            axisLine={{ stroke: '#e2e8f0' }}
                        />
                        <YAxis
                            tick={{ fontSize: 10, fill: '#64748b' }}
                            tickLine={false}
                            axisLine={false}
                            domain={[0, 100]}
                            tickFormatter={(v) => `${v}%`}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: '#fff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '12px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                                fontSize: '12px'
                            }}
                            formatter={(value: number = 0) => [`${value.toFixed(1)}%`, 'Benar']}
                            labelFormatter={(label) => `Soal ${label.replace('S', '')}`}
                        />
                        <Bar dataKey="correctRate" radius={[6, 6, 0, 0]} maxBarSize={32}>
                            {chartData.map((entry, index) => (
                                <Cell key={index} fill={getDifficultyColor(entry.correctRate)} fillOpacity={0.85} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3 px-1">
                {[
                    { label: 'Mudah (≥80%)', color: '#22c55e' },
                    { label: 'Sedang (60-79%)', color: '#3b82f6' },
                    { label: 'Sulit (40-59%)', color: '#f59e0b' },
                    { label: 'Sangat Sulit (<40%)', color: '#ef4444' },
                ].map(l => (
                    <div key={l.label} className="flex items-center gap-1.5 text-[10px] text-slate-500">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
                        {l.label}
                    </div>
                ))}
            </div>

            {/* Expandable Question Details */}
            <div className="mt-4 space-y-1.5 max-h-[300px] overflow-y-auto">
                {data.map((q) => (
                    <div key={q.questionIndex} className="rounded-lg border border-slate-100 overflow-hidden">
                        <button
                            onClick={() => setExpandedQ(expandedQ === q.questionIndex ? null : q.questionIndex)}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 transition-colors text-left"
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs font-bold text-slate-400 shrink-0">S{q.questionIndex}</span>
                                <span
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                                    style={{
                                        backgroundColor: getDifficultyColor(q.correctRate) + '20',
                                        color: getDifficultyColor(q.correctRate)
                                    }}
                                >
                                    {q.correctRate.toFixed(0)}% • {getDifficultyLabel(q.correctRate)}
                                </span>
                                <span className="text-xs text-slate-500 truncate">
                                    {q.questionType === 'ESSAY' ? '(Esai)' : ''}
                                </span>
                            </div>
                            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${expandedQ === q.questionIndex ? 'rotate-180' : ''}`} />
                        </button>

                        {expandedQ === q.questionIndex && q.optionDistribution && (
                            <div className="px-3 pb-3 pt-1 bg-slate-50/50 space-y-1.5">
                                {q.optionDistribution.map(opt => {
                                    const total = q.optionDistribution!.reduce((s, o) => s + o.count, 0)
                                    const pct = total > 0 ? (opt.count / total) * 100 : 0
                                    return (
                                        <div key={opt.option} className="flex items-center gap-2">
                                            <span className={`text-xs font-bold w-5 text-center ${opt.isCorrect ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                {opt.option}
                                            </span>
                                            <div className="flex-1 h-4 bg-slate-200 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all duration-500"
                                                    style={{
                                                        width: `${pct}%`,
                                                        backgroundColor: opt.isCorrect ? '#22c55e' : '#94a3b8',
                                                        minWidth: opt.count > 0 ? '8px' : '0'
                                                    }}
                                                />
                                            </div>
                                            <span className="text-[10px] text-slate-500 w-12 text-right">
                                                {opt.count} ({pct.toFixed(0)}%)
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </Card>
    )
}
