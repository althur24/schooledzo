'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Card } from '@/components/ui'
import { ScoreDistItem } from './AssessmentAnalytics'

interface ScoreDistributionChartProps {
    data: ScoreDistItem[]
}

const COLORS = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
    '#3b82f6', '#8b5cf6'
]

export default function ScoreDistributionChart({ data }: ScoreDistributionChartProps) {
    const maxCount = Math.max(...data.map(d => d.count), 1)

    return (
        <Card padding="p-5">
            <h4 className="text-sm font-bold text-slate-800 mb-4">📊 Distribusi Nilai</h4>
            <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis
                            dataKey="range"
                            tick={{ fontSize: 10, fill: '#64748b' }}
                            tickLine={false}
                            axisLine={{ stroke: '#e2e8f0' }}
                        />
                        <YAxis
                            allowDecimals={false}
                            tick={{ fontSize: 10, fill: '#64748b' }}
                            tickLine={false}
                            axisLine={false}
                            domain={[0, maxCount + 1]}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: '#fff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '12px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                                fontSize: '12px'
                            }}
                            formatter={(value: number = 0) => [`${value} siswa`, 'Jumlah']}
                            labelFormatter={(label) => `Rentang: ${label}`}
                        />
                        <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={40}>
                            {data.map((_, index) => (
                                <Cell key={index} fill={COLORS[index]} fillOpacity={0.85} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
    )
}
