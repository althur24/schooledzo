'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, Modal, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { TrendingUp, Calendar, BarChart3, School, BookOpen, GraduationCap } from 'lucide-react'

interface AcademicYear {
    id: string
    name: string
    start_date: string | null
    end_date: string | null
    status: 'PLANNED' | 'ACTIVE' | 'COMPLETED'
    is_active: boolean
}

interface StudentGrade {
    student_id: string
    student_name: string
    student_nis: string
    average: number | null
    grade_count: number
}

interface SubjectAnalytics {
    subject_id: string
    subject_name: string
    average: number | null
    student_count: number
    pass_count: number
    fail_count: number
    students: StudentGrade[]
}

interface ClassAnalytics {
    class_id: string
    class_name: string
    school_level: 'SMP' | 'SMA' | null
    grade_level: number | null
    total_students: number
    subjects: SubjectAnalytics[]
}

export default function AnalitikPage() {
    const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
    const [selectedYear, setSelectedYear] = useState('')
    const [loading, setLoading] = useState(true)
    const [loadingData, setLoadingData] = useState(false)
    const [classData, setClassData] = useState<ClassAnalytics[]>([])

    // School level filter and class search
    const [schoolLevelFilter, setSchoolLevelFilter] = useState<'SMP' | 'SMA' | null>(null)
    const [classSearch, setClassSearch] = useState('')

    // Modal state for student grades
    const [showModal, setShowModal] = useState(false)
    const [selectedClass, setSelectedClass] = useState<ClassAnalytics | null>(null)
    const [selectedSubject, setSelectedSubject] = useState<SubjectAnalytics | null>(null)

    useEffect(() => {
        fetchAcademicYears()
    }, [])

    const fetchAcademicYears = async () => {
        try {
            const res = await fetch('/api/academic-years')
            const data = await res.json()
            const years = Array.isArray(data) ? data : []
            setAcademicYears(years)

            // Auto select active year (check both is_active and status)
            const activeYear = years.find((y: AcademicYear) => y.is_active || y.status === 'ACTIVE')
            if (activeYear) {
                setSelectedYear(activeYear.id)
            }
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (selectedYear) {
            fetchAnalytics()
        } else {
            setClassData([])
        }
    }, [selectedYear])

    const fetchAnalytics = async () => {
        setLoadingData(true)
        try {
            const res = await fetch(`/api/analytics/class-grades?academic_year_id=${selectedYear}`)
            const data = await res.json()
            setClassData(Array.isArray(data) ? data : [])
        } catch (error) {
            console.error('Error:', error)
            setClassData([])
        } finally {
            setLoadingData(false)
        }
    }

    const handleSubjectClick = (cls: ClassAnalytics, subject: SubjectAnalytics) => {
        setSelectedClass(cls)
        setSelectedSubject(subject)
        setShowModal(true)
    }

    const getScoreColor = (score: number | null) => {
        if (score === null) return 'text-text-secondary dark:text-zinc-500'
        if (score >= 80) return 'text-green-700 dark:text-green-400'
        if (score >= 70) return 'text-amber-700 dark:text-amber-400'
        if (score >= 60) return 'text-orange-700 dark:text-orange-400'
        return 'text-red-700 dark:text-red-400'
    }

    const getBarColor = (score: number) => {
        if (score >= 80) return '#22c55e'
        if (score >= 70) return '#f59e0b'
        if (score >= 60) return '#f97316'
        return '#ef4444'
    }

    const getScoreBgColor = (score: number | null) => {
        if (score === null) return 'bg-secondary/10 border-secondary/20'
        if (score >= 80) return 'bg-green-100 border-green-200 dark:bg-green-900/20 dark:border-green-900/40'
        if (score >= 70) return 'bg-amber-100 border-amber-200 dark:bg-amber-900/20 dark:border-amber-900/40'
        if (score >= 60) return 'bg-orange-100 border-orange-200 dark:bg-orange-900/20 dark:border-orange-900/40'
        return 'bg-red-100 border-red-200 dark:bg-red-900/20 dark:border-red-900/40'
    }

    const formatScore = (score: number | null) => {
        if (score === null) return '-'
        return score.toFixed(1)
    }

    // Calculate overall stats
    const overallStats = {
        totalClasses: classData.length,
        totalSubjectsWithGrades: classData.reduce((acc, cls) =>
            acc + cls.subjects.filter(s => s.average !== null).length, 0
        ),
        overallAverage: (() => {
            const allAverages = classData.flatMap(cls =>
                cls.subjects.filter(s => s.average !== null).map(s => s.average as number)
            )
            return allAverages.length > 0
                ? allAverages.reduce((a, b) => a + b, 0) / allAverages.length
                : null
        })()
    }


    // Calculate SMP statistics (MP1, MP2, MP3)
    const smpStats = [1, 2, 3].map(grade => {
        const smpClasses = classData.filter(cls => cls.school_level === 'SMP' && cls.grade_level === grade)
        const allAverages = smpClasses.flatMap(cls =>
            cls.subjects.filter(s => s.average !== null).map(s => s.average as number)
        )
        return {
            grade,
            label: `MP${grade}`,
            fullLabel: `MP${grade} (Kelas ${6 + grade})`,
            classCount: smpClasses.length,
            average: allAverages.length > 0
                ? allAverages.reduce((a, b) => a + b, 0) / allAverages.length
                : null
        }
    })

    // Calculate SMA statistics (MA1, MA2, MA3)
    const smaStats = [1, 2, 3].map(grade => {
        const smaClasses = classData.filter(cls => cls.school_level === 'SMA' && cls.grade_level === grade)
        const allAverages = smaClasses.flatMap(cls =>
            cls.subjects.filter(s => s.average !== null).map(s => s.average as number)
        )
        return {
            grade,
            label: `MA${grade}`,
            fullLabel: `MA${grade} (Kelas ${9 + grade})`,
            classCount: smaClasses.length,
            average: allAverages.length > 0
                ? allAverages.reduce((a, b) => a + b, 0) / allAverages.length
                : null
        }
    })

    // SMP chart data
    const smpChartData = smpStats
        .filter(s => s.average !== null && s.classCount > 0)
        .map(s => ({
            name: s.label,
            fullName: s.fullLabel,
            average: Math.round((s.average || 0) * 10) / 10,
            classCount: s.classCount
        }))

    // SMA chart data
    const smaChartData = smaStats
        .filter(s => s.average !== null && s.classCount > 0)
        .map(s => ({
            name: s.label,
            fullName: s.fullLabel,
            average: Math.round((s.average || 0) * 10) / 10,
            classCount: s.classCount
        }))

    // Filter classData by school level and search
    const filteredClassData = classData.filter(cls => {
        const matchesSchool = !schoolLevelFilter || cls.school_level === schoolLevelFilter
        const matchesSearch = !classSearch || cls.class_name.toLowerCase().includes(classSearch.toLowerCase())
        return matchesSchool && matchesSearch
    })

    // Prepare chart data - Class comparison (filtered by school level)
    const classChartData = filteredClassData.map(cls => {
        const subjectsWithGrades = cls.subjects.filter(s => s.average !== null)
        const classAvg = subjectsWithGrades.length > 0
            ? subjectsWithGrades.reduce((sum, s) => sum + (s.average || 0), 0) / subjectsWithGrades.length
            : 0
        return {
            name: cls.class_name,
            average: Math.round(classAvg * 10) / 10
        }
    }).filter(c => c.average > 0).sort((a, b) => b.average - a.average)

    // Prepare chart data - Subject averages
    const subjectChartData = (() => {
        const subjectMap: Record<string, { name: string; scores: number[] }> = {}
        filteredClassData.forEach(cls => {
            cls.subjects.forEach(sub => {
                if (sub.average !== null) {
                    if (!subjectMap[sub.subject_id]) {
                        subjectMap[sub.subject_id] = { name: sub.subject_name, scores: [] }
                    }
                    subjectMap[sub.subject_id].scores.push(sub.average)
                }
            })
        })
        return Object.values(subjectMap).map(sub => ({
            name: sub.name.length > 15 ? sub.name.substring(0, 15) + '...' : sub.name,
            fullName: sub.name,
            average: Math.round((sub.scores.reduce((a, b) => a + b, 0) / sub.scores.length) * 10) / 10
        })).sort((a, b) => b.average - a.average)
    })()

    return (
        <div className="space-y-6">
            <PageHeader
                title="Analitik"
                subtitle="Performa per kelas dan mata pelajaran"
                backHref="/dashboard/admin"
                icon={<TrendingUp className="w-8 h-8 text-primary" />}
            />

            {/* Filter Tahun Ajaran */}
            <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-4">
                    <label className="text-sm font-bold text-text-main dark:text-white">Tahun Ajaran:</label>
                    <select
                        value={selectedYear}
                        onChange={(e) => setSelectedYear(e.target.value)}
                        className="px-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                        disabled={loading}
                    >
                        <option value="">Pilih Tahun Ajaran</option>
                        {academicYears.map(y => (
                            <option key={y.id} value={y.id}>
                                {y.name} {y.is_active && '(Aktif)'}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Filter Jenjang dan Pencarian Kelas */}
            {selectedYear && classData.length > 0 && (
                <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-4">
                        {/* Filter Jenjang */}
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-bold text-text-main dark:text-white whitespace-nowrap">
                                Jenjang:
                            </label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setSchoolLevelFilter(null)}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${!schoolLevelFilter
                                        ? 'bg-primary text-white'
                                        : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'
                                        }`}
                                >
                                    Semua
                                </button>
                                <button
                                    onClick={() => setSchoolLevelFilter('SMP')}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${schoolLevelFilter === 'SMP'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                                        }`}
                                >
                                    SMP
                                </button>
                                <button
                                    onClick={() => setSchoolLevelFilter('SMA')}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${schoolLevelFilter === 'SMA'
                                        ? 'bg-green-600 text-white'
                                        : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50'
                                        }`}
                                >
                                    SMA
                                </button>
                            </div>
                        </div>

                        {/* Pencarian Kelas */}
                        <div className="flex items-center gap-2 flex-1 max-w-xs">
                            <label className="text-sm font-bold text-text-main dark:text-white whitespace-nowrap">
                                Cari Kelas:
                            </label>
                            <input
                                type="text"
                                value={classSearch}
                                onChange={(e) => setClassSearch(e.target.value)}
                                placeholder="VII-A, X-B..."
                                className="flex-1 px-4 py-2 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>

                        {/* Reset */}
                        {(schoolLevelFilter || classSearch) && (
                            <button
                                onClick={() => {
                                    setSchoolLevelFilter(null)
                                    setClassSearch('')
                                }}
                                className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-main dark:hover:text-white transition-colors"
                            >
                                Reset Filter
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Content */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin text-primary"><TrendingUp className="w-8 h-8" /></div>
                </div>
            ) : !selectedYear ? (
                <EmptyState
                    icon={<Calendar className="w-12 h-12 text-secondary" />}
                    title="Pilih Tahun Ajaran"
                    description="Pilih tahun ajaran untuk melihat analitik"
                />
            ) : loadingData ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin text-primary"><TrendingUp className="w-8 h-8" /></div>
                </div>
            ) : classData.length === 0 ? (
                <EmptyState
                    icon={<BarChart3 className="w-12 h-12 text-secondary" />}
                    title="Belum Ada Data"
                    description="Belum ada data kelas untuk tahun ajaran ini"
                />
            ) : (
                <>
                    {/* Overall Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-5 shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                                    <School className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs text-text-secondary dark:text-zinc-400">Total Kelas</p>
                                    <p className="text-2xl font-bold text-text-main dark:text-white">{overallStats.totalClasses}</p>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-5 shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                                    <BookOpen className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs text-text-secondary dark:text-zinc-400">Mapel dengan Nilai</p>
                                    <p className="text-2xl font-bold text-text-main dark:text-white">{overallStats.totalSubjectsWithGrades}</p>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-5 shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 flex items-center justify-center">
                                    <BarChart3 className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs text-text-secondary dark:text-zinc-400">Rata-rata</p>
                                    <p className={`text-2xl font-bold ${getScoreColor(overallStats.overallAverage)}`}>
                                        {formatScore(overallStats.overallAverage)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* SMP Section - Only show if there's SMP data */}
                    {smpStats.some(s => s.classCount > 0) && (!schoolLevelFilter || schoolLevelFilter === 'SMP') && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full">
                                    <School className="w-4 h-4" />
                                    <span className="text-sm font-bold">SMP</span>
                                </div>
                                <h3 className="text-lg font-bold text-text-main dark:text-white">Analitik SMP (Sekolah Menengah Pertama)</h3>
                            </div>

                            {/* SMP Stats Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {smpStats.map((stat) => (
                                    <div
                                        key={stat.label}
                                        className={`bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-5 shadow-sm ${stat.classCount === 0 ? 'opacity-50' : ''}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.grade === 1 ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' :
                                                stat.grade === 2 ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400' :
                                                    'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                                                }`}>
                                                <BarChart3 className="w-5 h-5" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-xs font-bold text-text-secondary dark:text-zinc-400">
                                                        {stat.fullLabel}
                                                    </p>
                                                    <span className="text-[10px] text-text-secondary dark:text-zinc-500">
                                                        ({stat.classCount} kelas)
                                                    </span>
                                                </div>
                                                <p className={`text-2xl font-bold ${stat.average !== null ? getScoreColor(stat.average) : 'text-text-secondary dark:text-zinc-500'}`}>
                                                    {formatScore(stat.average)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* SMP Bar Chart */}
                            {smpChartData.length > 0 && (
                                <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-5 shadow-sm">
                                    <h4 className="text-md font-bold text-text-main dark:text-white mb-4 flex items-center gap-2">
                                        <BarChart3 className="w-5 h-5" />
                                        Perbandingan SMP
                                    </h4>
                                    <div className="h-48" style={{ minWidth: 0, minHeight: 150, position: 'relative' }}>
                                        <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={150}>
                                            <BarChart data={smpChartData} layout="vertical" margin={{ left: 20, right: 30 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis type="number" domain={[0, 100]} stroke="#64748b" fontSize={12} />
                                                <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={12} width={80} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                                                    labelStyle={{ color: '#1e293b', fontWeight: 'bold' }}
                                                    formatter={(value, name, props: any) => {
                                                        const count = props?.payload?.classCount || 0
                                                        return [`${value} (${count} kelas)`, 'Rata-rata']
                                                    }}
                                                />
                                                <Bar dataKey="average" radius={[0, 4, 4, 0]}>
                                                    {smpChartData.map((entry, index) => (
                                                        <Cell
                                                            key={`cell-smp-${index}`}
                                                            fill={
                                                                entry.name === 'MP1' ? '#3b82f6' :
                                                                    entry.name === 'MP2' ? '#06b6d4' :
                                                                        '#6366f1'
                                                            }
                                                        />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* SMA Section - Only show if there's SMA data */}
                    {smaStats.some(s => s.classCount > 0) && (!schoolLevelFilter || schoolLevelFilter === 'SMA') && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">
                                    <GraduationCap className="w-4 h-4" />
                                    <span className="text-sm font-bold">SMA</span>
                                </div>
                                <h3 className="text-lg font-bold text-text-main dark:text-white">Analitik SMA (Sekolah Menengah Atas)</h3>
                            </div>

                            {/* SMA Stats Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {smaStats.map((stat) => (
                                    <div
                                        key={stat.label}
                                        className={`bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-5 shadow-sm ${stat.classCount === 0 ? 'opacity-50' : ''}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.grade === 1 ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' :
                                                stat.grade === 2 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' :
                                                    'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400'
                                                }`}>
                                                <BarChart3 className="w-5 h-5" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-xs font-bold text-text-secondary dark:text-zinc-400">
                                                        {stat.fullLabel}
                                                    </p>
                                                    <span className="text-[10px] text-text-secondary dark:text-zinc-500">
                                                        ({stat.classCount} kelas)
                                                    </span>
                                                </div>
                                                <p className={`text-2xl font-bold ${stat.average !== null ? getScoreColor(stat.average) : 'text-text-secondary dark:text-zinc-500'}`}>
                                                    {formatScore(stat.average)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* SMA Bar Chart */}
                            {smaChartData.length > 0 && (
                                <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-5 shadow-sm">
                                    <h4 className="text-md font-bold text-text-main dark:text-white mb-4 flex items-center gap-2">
                                        <BarChart3 className="w-5 h-5" />
                                        Perbandingan SMA
                                    </h4>
                                    <div className="h-48" style={{ minWidth: 0, minHeight: 150, position: 'relative' }}>
                                        <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={150}>
                                            <BarChart data={smaChartData} layout="vertical" margin={{ left: 20, right: 30 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                <XAxis type="number" domain={[0, 100]} stroke="#64748b" fontSize={12} />
                                                <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={12} width={80} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                                                    labelStyle={{ color: '#1e293b', fontWeight: 'bold' }}
                                                    formatter={(value, name, props: any) => {
                                                        const count = props?.payload?.classCount || 0
                                                        return [`${value} (${count} kelas)`, 'Rata-rata']
                                                    }}
                                                />
                                                <Bar dataKey="average" radius={[0, 4, 4, 0]}>
                                                    {smaChartData.map((entry, index) => (
                                                        <Cell
                                                            key={`cell-sma-${index}`}
                                                            fill={
                                                                entry.name === 'MA1' ? '#22c55e' :
                                                                    entry.name === 'MA2' ? '#10b981' :
                                                                        '#14b8a6'
                                                            }
                                                        />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Charts Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Bar Chart - Class Comparison */}
                        {classChartData.length > 0 && (
                            <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-5 shadow-sm">
                                <h3 className="text-lg font-bold text-text-main dark:text-white mb-4 flex items-center gap-2">
                                    <BarChart3 className="w-5 h-5" />
                                    Perbandingan Rata-rata Kelas
                                    {schoolLevelFilter && (
                                        <span className="text-sm font-normal text-primary ml-2">({schoolLevelFilter})</span>
                                    )}
                                </h3>
                                <div style={{ height: Math.max(250, classChartData.length * 35), minWidth: 0, position: 'relative' }}>
                                    <ResponsiveContainer width="100%" height="100%" minWidth={200}>
                                        <BarChart data={classChartData} layout="vertical" margin={{ left: 20, right: 30 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                            <XAxis type="number" domain={[0, 100]} stroke="#64748b" fontSize={12} />
                                            <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={12} width={80} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                                                labelStyle={{ color: '#1e293b', fontWeight: 'bold' }}
                                                formatter={(value) => [`${value}`, 'Rata-rata']}
                                            />
                                            <Bar dataKey="average" radius={[0, 4, 4, 0]}>
                                                {classChartData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={getBarColor(entry.average)} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {/* Bar Chart - Subject Averages */}
                        {subjectChartData.length > 0 && (
                            <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-5 shadow-sm">
                                <h3 className="text-lg font-bold text-text-main dark:text-white mb-4 flex items-center gap-2">
                                    <BookOpen className="w-5 h-5" />
                                    Rata-rata per Mata Pelajaran
                                    {schoolLevelFilter && (
                                        <span className="text-sm font-normal text-primary ml-2">({schoolLevelFilter})</span>
                                    )}
                                </h3>
                                <div style={{ height: Math.max(250, subjectChartData.length * 35), minWidth: 0, position: 'relative' }}>
                                    <ResponsiveContainer width="100%" height="100%" minWidth={200}>
                                        <BarChart data={subjectChartData} layout="vertical" margin={{ left: 20, right: 30 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                            <XAxis type="number" domain={[0, 100]} stroke="#64748b" fontSize={12} />
                                            <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={11} width={100} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                                                labelStyle={{ color: '#1e293b', fontWeight: 'bold' }}
                                                formatter={(value, _name, props) => [`${value}`, (props?.payload as any)?.fullName || 'Mapel']}
                                            />
                                            <Bar dataKey="average" radius={[0, 4, 4, 0]}>
                                                {subjectChartData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={getBarColor(entry.average)} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Class Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredClassData.map(cls => (
                            <div key={cls.class_id} className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                                {/* Class Header */}
                                <div className="p-4 border-b border-secondary/10 bg-gradient-to-r from-primary/5 to-secondary/5">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                                            <School className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-text-main dark:text-white">{cls.class_name}</h3>
                                            <p className="text-xs text-text-secondary dark:text-zinc-400">{cls.total_students} siswa</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Subject Averages */}
                                <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                                    {cls.subjects.filter(s => s.student_count > 0).length === 0 ? (
                                        <p className="text-sm text-text-secondary dark:text-zinc-500 text-center py-4">
                                            Belum ada nilai
                                        </p>
                                    ) : (
                                        cls.subjects
                                            .filter(s => s.student_count > 0)
                                            .sort((a, b) => ((b.average || 0) - (a.average || 0)))
                                            .map(subject => (
                                                <button
                                                    key={subject.subject_id}
                                                    onClick={() => handleSubjectClick(cls, subject)}
                                                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all hover:scale-[1.01] ${getScoreBgColor(subject.average)}`}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium text-text-main dark:text-white">{subject.subject_name}</span>
                                                        <span className="text-xs text-text-secondary dark:text-zinc-400">({subject.student_count})</span>
                                                    </div>
                                                    <span className={`font-bold ${getScoreColor(subject.average)}`}>
                                                        {formatScore(subject.average)}
                                                    </span>
                                                </button>
                                            ))
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Legend */}
                    <div className="bg-secondary/5 border border-secondary/20 rounded-xl p-4">
                        <p className="text-sm text-text-secondary dark:text-zinc-400">
                            <strong className="text-text-main dark:text-white">Keterangan:</strong> Klik pada mata pelajaran untuk melihat daftar siswa.
                            Warna: <span className="text-green-600 dark:text-green-400">≥80</span> |
                            <span className="text-amber-600 dark:text-amber-400"> 70-79</span> |
                            <span className="text-orange-600 dark:text-orange-400"> 60-69</span> |
                            <span className="text-red-600 dark:text-red-400"> &lt;60</span>
                        </p>
                    </div>
                </>
            )
            }

            {/* Student Grades Modal */}
            <Modal
                open={showModal}
                onClose={() => setShowModal(false)}
                title={`${selectedSubject?.subject_name || ''} - ${selectedClass?.class_name || ''}`}
                maxWidth="lg"
            >
                {selectedSubject && (
                    <div className="space-y-4">
                        {/* Summary */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="bg-secondary/10 rounded-lg p-4 text-center">
                                <p className="text-xs text-text-secondary dark:text-zinc-400">Rata-rata</p>
                                <p className={`text-xl font-bold ${getScoreColor(selectedSubject.average)}`}>
                                    {formatScore(selectedSubject.average)}
                                </p>
                            </div>
                            <div className="bg-secondary/10 rounded-lg p-4 text-center">
                                <p className="text-xs text-text-secondary dark:text-zinc-400">Jumlah Siswa</p>
                                <p className="text-xl font-bold text-text-main dark:text-white">{selectedSubject.student_count}</p>
                            </div>
                            <div className="bg-green-100 dark:bg-green-900/20 rounded-lg p-4 text-center">
                                <p className="text-xs text-text-secondary dark:text-zinc-400">Lulus (≥KKM)</p>
                                <p className="text-xl font-bold text-green-700 dark:text-green-400">{selectedSubject.pass_count}</p>
                            </div>
                            <div className="bg-red-100 dark:bg-red-900/20 rounded-lg p-4 text-center">
                                <p className="text-xs text-text-secondary dark:text-zinc-400">Tidak Lulus</p>
                                <p className="text-xl font-bold text-red-700 dark:text-red-400">{selectedSubject.fail_count}</p>
                            </div>
                        </div>

                        {/* Student List */}
                        <div className="max-h-80 overflow-y-auto rounded-lg border border-secondary/20">
                            <table className="w-full">
                                <thead className="bg-secondary/10 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-sm font-bold text-text-main dark:text-white">No</th>
                                        <th className="px-4 py-3 text-left text-sm font-bold text-text-main dark:text-white">Nama Siswa</th>
                                        <th className="px-4 py-3 text-left text-sm font-bold text-text-main dark:text-white">NIS</th>
                                        <th className="px-4 py-3 text-center text-sm font-bold text-text-main dark:text-white">Jumlah Nilai</th>
                                        <th className="px-4 py-3 text-center text-sm font-bold text-text-main dark:text-white">Rata-rata</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-secondary/10">
                                    {selectedSubject.students
                                        .sort((a, b) => (b.average || 0) - (a.average || 0))
                                        .map((student, idx) => (
                                            <tr key={student.student_id} className="hover:bg-secondary/5">
                                                <td className="px-4 py-3 text-text-secondary dark:text-zinc-400">{idx + 1}</td>
                                                <td className="px-4 py-3 text-text-main dark:text-white font-medium">{student.student_name}</td>
                                                <td className="px-4 py-3 text-text-secondary dark:text-zinc-400">{student.student_nis}</td>
                                                <td className="px-4 py-3 text-center text-text-secondary dark:text-zinc-400">{student.grade_count}</td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`font-bold ${getScoreColor(student.average)}`}>
                                                        {formatScore(student.average)}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Modal>
        </div >
    )
}
