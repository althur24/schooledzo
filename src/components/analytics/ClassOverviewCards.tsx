'use client'

import { ClassOverview } from './AssessmentAnalytics'
import { TrendingUp, TrendingDown, Users, Target, Award, BarChart2 } from 'lucide-react'

interface ClassOverviewCardsProps {
    data: ClassOverview
}

export default function ClassOverviewCards({ data }: ClassOverviewCardsProps) {
    const ms = data.maxScore || 0
    const cards = [
        {
            label: 'Rata-Rata',
            value: `${data.avgRawScore}/${ms}`,
            icon: <BarChart2 className="w-5 h-5" />,
            color: 'bg-blue-50 text-blue-600 border-blue-200',
            iconBg: 'bg-blue-100'
        },
        {
            label: 'Nilai Tertinggi',
            value: `${data.highestRawScore}/${ms}`,
            icon: <TrendingUp className="w-5 h-5" />,
            color: 'bg-emerald-50 text-emerald-600 border-emerald-200',
            iconBg: 'bg-emerald-100'
        },
        {
            label: 'Nilai Terendah',
            value: `${data.lowestRawScore}/${ms}`,
            icon: <TrendingDown className="w-5 h-5" />,
            color: 'bg-rose-50 text-rose-600 border-rose-200',
            iconBg: 'bg-rose-100'
        },
        {
            label: 'Median',
            value: `${data.medianRaw}/${ms}`,
            icon: <Target className="w-5 h-5" />,
            color: 'bg-violet-50 text-violet-600 border-violet-200',
            iconBg: 'bg-violet-100'
        },
        {
            label: 'Partisipasi',
            value: `${data.submitted}/${data.totalStudents}`,
            icon: <Users className="w-5 h-5" />,
            color: 'bg-amber-50 text-amber-600 border-amber-200',
            iconBg: 'bg-amber-100'
        },
        {
            label: data.kkm ? `Lulus (KKM ${data.kkm})` : 'Std. Deviasi',
            value: data.kkm ? `${data.passRate.toFixed(1)}%` : data.stdDev.toFixed(1),
            icon: <Award className="w-5 h-5" />,
            color: data.kkm
                ? 'bg-teal-50 text-teal-600 border-teal-200'
                : 'bg-slate-50 text-slate-600 border-slate-200',
            iconBg: data.kkm ? 'bg-teal-100' : 'bg-slate-100'
        }
    ]

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {cards.map((card, i) => (
                <div
                    key={i}
                    className={`rounded-xl border p-3.5 ${card.color} transition-all hover:shadow-sm`}
                >
                    <div className={`w-8 h-8 rounded-lg ${card.iconBg} flex items-center justify-center mb-2`}>
                        {card.icon}
                    </div>
                    <p className="text-lg font-bold leading-tight">{card.value}</p>
                    <p className="text-[11px] font-medium opacity-70 mt-0.5 leading-tight">{card.label}</p>
                </div>
            ))}
        </div>
    )
}
