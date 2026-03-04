'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'

interface SchoolSummary {
    id: string
    name: string
    code: string
    is_active: boolean
    student_count: number
    teacher_count: number
    class_count: number
}

export default function SuperAdminDashboard() {
    const { user } = useAuth()
    const [schools, setSchools] = useState<SchoolSummary[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const fetchSummary = async () => {
            try {
                const res = await fetch('/api/schools')
                if (res.ok) {
                    const data = await res.json()
                    setSchools(data)
                }
            } catch (err) {
                console.error('Failed to fetch schools:', err)
            } finally {
                setLoading(false)
            }
        }
        fetchSummary()
    }, [])

    const totalStudents = schools.reduce((sum, s) => sum + (s.student_count || 0), 0)
    const totalTeachers = schools.reduce((sum, s) => sum + (s.teacher_count || 0), 0)
    const totalClasses = schools.reduce((sum, s) => sum + (s.class_count || 0), 0)
    const activeSchools = schools.filter(s => s.is_active).length

    return (
        <div className="space-y-8">
            {/* Welcome */}
            <div>
                <h1 className="text-3xl font-bold text-text-main dark:text-white">
                    Halo, {user?.full_name || 'Super Admin'} 👋
                </h1>
                <p className="text-text-secondary mt-1">
                    Panel manajemen multi-sekolah
                </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatsCard
                    label="Total Sekolah"
                    value={activeSchools}
                    icon="🏫"
                    color="emerald"
                />
                <StatsCard
                    label="Total Siswa"
                    value={totalStudents}
                    icon="👨‍🎓"
                    color="blue"
                />
                <StatsCard
                    label="Total Guru"
                    value={totalTeachers}
                    icon="👩‍🏫"
                    color="purple"
                />
                <StatsCard
                    label="Total Kelas"
                    value={totalClasses}
                    icon="📚"
                    color="amber"
                />
            </div>

            {/* School List Preview */}
            <div className="bg-white dark:bg-surface-dark rounded-2xl border border-[#E8F0E6] dark:border-primary/10 overflow-hidden">
                <div className="px-6 py-4 border-b border-[#E8F0E6] dark:border-primary/10 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-text-main dark:text-white">Daftar Sekolah</h2>
                    <a href="/dashboard/super-admin/sekolah" className="text-sm text-primary hover:underline font-medium">
                        Lihat semua →
                    </a>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <svg className="animate-spin w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    </div>
                ) : schools.length === 0 ? (
                    <div className="text-center py-12 text-text-secondary">
                        Belum ada sekolah terdaftar
                    </div>
                ) : (
                    <div className="divide-y divide-[#E8F0E6] dark:divide-primary/10">
                        {schools.slice(0, 5).map((school) => (
                            <div key={school.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-lg">
                                        🏫
                                    </div>
                                    <div>
                                        <p className="font-bold text-text-main dark:text-white">{school.name}</p>
                                        <p className="text-xs text-text-secondary">{school.code}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-6 text-sm text-text-secondary">
                                    <span>{school.student_count || 0} siswa</span>
                                    <span>{school.teacher_count || 0} guru</span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${school.is_active
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                        }`}>
                                        {school.is_active ? 'Aktif' : 'Nonaktif'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

function StatsCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
    const colorClasses: Record<string, string> = {
        emerald: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
        blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
        purple: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
        amber: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
    }

    return (
        <div className={`rounded-2xl border p-5 ${colorClasses[color]}`}>
            <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{icon}</span>
                <p className="text-sm font-medium text-text-secondary">{label}</p>
            </div>
            <p className="text-3xl font-bold text-text-main dark:text-white">{value.toLocaleString()}</p>
        </div>
    )
}
