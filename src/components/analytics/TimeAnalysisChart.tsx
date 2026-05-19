'use client'

import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts'
import { Card } from '@/components/ui'
import { TimeAnalysisItem } from './AssessmentAnalytics'

interface TimeAnalysisChartProps {
    data: TimeAnalysisItem[]
}

export default function TimeAnalysisChart({ data }: TimeAnalysisChartProps) {
    // Skip if less than 2 data points (scatter not meaningful)
    if (data.length < 2) return null

    const maxDuration = Math.max(...data.map(d => d.duration))
    const avgDuration = data.reduce((s, d) => s + d.duration, 0) / data.length

    return (
        <Card padding="p-5">
            <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-slate-800">⏱️ Waktu vs Nilai</h4>
                <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
                    Rata-rata: {avgDuration.toFixed(1)} menit
                </span>
            </div>
            <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 20, left: -5, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                            dataKey="duration"
                            name="Durasi"
                            unit=" mnt"
                            tick={{ fontSize: 10, fill: '#64748b' }}
                            tickLine={false}
                            axisLine={{ stroke: '#e2e8f0' }}
                            domain={[0, Math.ceil(maxDuration * 1.1)]}
                            label={{
                                value: 'Durasi (menit)',
                                position: 'insideBottom',
                                offset: -5,
                                style: { fontSize: 10, fill: '#94a3b8' }
                            }}
                        />
                        <YAxis
                            dataKey="score"
                            name="Nilai"
                            unit="%"
                            tick={{ fontSize: 10, fill: '#64748b' }}
                            tickLine={false}
                            axisLine={false}
                            domain={[0, 105]}
                            label={{
                                value: 'Nilai (%)',
                                angle: -90,
                                position: 'insideLeft',
                                offset: 15,
                                style: { fontSize: 10, fill: '#94a3b8' }
                            }}
                        />
                        <ZAxis range={[40, 40]} />
                        <Tooltip
                            cursor={{ strokeDasharray: '3 3' }}
                            contentStyle={{
                                backgroundColor: '#fff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '12px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                                fontSize: '11px'
                            }}
                            content={({ payload }) => {
                                if (!payload || payload.length === 0) return null
                                const d = payload[0].payload as TimeAnalysisItem
                                return (
                                    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-lg text-xs">
                                        <p className="font-bold text-slate-800">{d.studentName}</p>
                                        <p className="text-slate-500">Durasi: {d.duration.toFixed(1)} menit</p>
                                        <p className="text-slate-500">Nilai: {d.score.toFixed(1)}%</p>
                                    </div>
                                )
                            }}
                        />
                        <Scatter
                            data={data}
                            fill="#10B981"
                            fillOpacity={0.7}
                            stroke="#059669"
                            strokeWidth={1}
                        />
                    </ScatterChart>
                </ResponsiveContainer>
            </div>
        </Card>
    )
}
