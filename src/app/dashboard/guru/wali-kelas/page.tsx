'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import { PageHeader, Button, EmptyState } from '@/components/ui'
import {
    HeartHandshake, Users, TrendingUp, Award,
    Download, Loader2, ChevronRight, Search
} from 'lucide-react'

interface WaliData {
    classes: any[]
    current_class_id: string
    students: any[]
    subjects: any[]
    student_grades: any[]
}

export default function WaliKelasPage() {
    const { user } = useAuth()
    const router = useRouter()
    const [data, setData] = useState<WaliData | null>(null)
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')

    useEffect(() => {
        if (user && user.role !== 'GURU') {
            router.replace('/dashboard')
        }
    }, [user, router])

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await fetch('/api/wali-kelas')
                const json = await res.json()
                setData(json)
            } catch (error) {
                console.error('Error:', error)
            } finally {
                setLoading(false)
            }
        }
        if (user) fetchData()
    }, [user])

    // Calculate average for a subject's scores
    const calcAvg = (scores: number[]) => {
        if (scores.length === 0) return null
        return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    }

    // Calculate overall average for a student across all subjects
    const calcStudentOverall = (studentGrade: any): number | null => {
        if (!studentGrade?.subjects) return null
        const subjectAvgs: number[] = []
        Object.values(studentGrade.subjects).forEach((subj: any) => {
            const allScores = [...subj.tugas_scores, ...subj.kuis_scores, ...subj.ulangan_scores]
            const avg = calcAvg(allScores)
            if (avg !== null) subjectAvgs.push(avg)
        })
        if (subjectAvgs.length === 0) return null
        return Math.round(subjectAvgs.reduce((a, b) => a + b, 0) / subjectAvgs.length)
    }

    // Export to Excel/CSV
    const handleExport = () => {
        if (!data) return

        const subjects = data.subjects || []
        const headers = ['No', 'NIS', 'Nama Siswa', ...subjects.map((s: any) => s.name), 'Rata-rata']

        const rows = data.students.map((student: any, idx: number) => {
            const studentGrade = data.student_grades?.find((sg: any) => sg.student_id === student.id)
            const overall = calcStudentOverall(studentGrade)

            const subjectScores = subjects.map((subj: any) => {
                if (!studentGrade?.subjects?.[subj.id]) return '-'
                const s = studentGrade.subjects[subj.id]
                const allScores = [...s.tugas_scores, ...s.kuis_scores, ...s.ulangan_scores]
                const avg = calcAvg(allScores)
                return avg !== null ? avg.toString() : '-'
            })

            return [
                (idx + 1).toString(),
                student.nis || '-',
                student.user?.full_name || student.user?.username || '-',
                ...subjectScores,
                overall !== null ? overall.toString() : '-'
            ]
        })

        const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n')
        const className = data.classes?.find((c: any) => c.id === data.current_class_id)?.name || 'kelas'
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `rekap_wali_kelas_${className}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    // Get score color
    const getScoreColor = (score: number | null) => {
        if (score === null) return 'text-text-secondary'
        if (score >= 75) return 'text-green-600 dark:text-green-400'
        if (score >= 60) return 'text-amber-600 dark:text-amber-400'
        return 'text-red-600 dark:text-red-400'
    }

    const getScoreBg = (score: number | null) => {
        if (score === null) return ''
        if (score >= 75) return 'bg-green-50 dark:bg-green-500/10'
        if (score >= 60) return 'bg-amber-50 dark:bg-amber-500/10'
        return 'bg-red-50 dark:bg-red-500/10'
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-60">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!data || !data.classes || data.classes.length === 0) {
        return (
            <div className="space-y-6">
                <PageHeader
                    title="Wali Kelas"
                    subtitle="Anda belum ditunjuk sebagai wali kelas"
                    backHref="/dashboard/guru"
                    icon={<HeartHandshake className="w-6 h-6 text-pink-500" />}
                />
                <Card className="p-6">
                    <EmptyState
                        icon={<HeartHandshake className="w-12 h-12 text-pink-200" />}
                        title="Belum Ada Penugasan"
                        description="Hubungi administrator untuk ditunjuk sebagai wali kelas"
                    />
                </Card>
            </div>
        )
    }

    const currentClass = data.classes.find((c: any) => c.id === data.current_class_id) || data.classes[0]
    const students = data.students || []
    const subjects = data.subjects || []
    const studentGrades = data.student_grades || []

    // Calculate class stats
    const allOveralls = students.map((s: any) => {
        const sg = studentGrades.find((g: any) => g.student_id === s.id)
        return calcStudentOverall(sg)
    }).filter((v: any): v is number => v !== null)

    const classAvg = allOveralls.length > 0
        ? Math.round(allOveralls.reduce((a, b) => a + b, 0) / allOveralls.length)
        : 0
    const tuntasCount = allOveralls.filter(v => v >= 75).length

    // Filter students by search
    const filteredStudents = students.filter((s: any) => {
        if (!searchQuery) return true
        const name = (s.user?.full_name || s.user?.username || '').toLowerCase()
        const nis = (s.nis || '').toLowerCase()
        return name.includes(searchQuery.toLowerCase()) || nis.includes(searchQuery.toLowerCase())
    })

    // Sort students by name
    filteredStudents.sort((a: any, b: any) => {
        const nameA = (a.user?.full_name || a.user?.username || '').toLowerCase()
        const nameB = (b.user?.full_name || b.user?.username || '').toLowerCase()
        return nameA.localeCompare(nameB)
    })

    return (
        <div className="space-y-6">
            <PageHeader
                title={`Wali Kelas — ${currentClass.name}`}
                subtitle={`${students.length} siswa • ${currentClass.academic_year?.name || ''}`}
                backHref="/dashboard/guru"
                icon={<HeartHandshake className="w-6 h-6 text-pink-500" />}
                action={
                    <Button onClick={handleExport} icon={<Download className="w-4 h-4" />} variant="secondary">
                        Export CSV
                    </Button>
                }
            />

            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="p-4 bg-gradient-to-br from-blue-500/10 to-blue-600/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                            <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <div className="text-xl md:text-2xl font-bold text-blue-600 dark:text-blue-400">{students.length}</div>
                            <div className="text-xs text-text-secondary">Siswa</div>
                        </div>
                    </div>
                </Card>

                <Card className="p-4 bg-gradient-to-br from-purple-500/10 to-purple-600/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div>
                            <div className="text-xl md:text-2xl font-bold text-purple-600 dark:text-purple-400">{classAvg || '-'}</div>
                            <div className="text-xs text-text-secondary">Rata-rata Kelas</div>
                        </div>
                    </div>
                </Card>

                <Card className="p-4 bg-gradient-to-br from-green-500/10 to-green-600/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                            <Award className="w-5 h-5 text-green-600 dark:text-green-400" />
                        </div>
                        <div>
                            <div className="text-xl md:text-2xl font-bold text-green-600 dark:text-green-400">{tuntasCount}</div>
                            <div className="text-xs text-text-secondary">Tuntas (≥75)</div>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari siswa berdasarkan nama atau NIS..."
                    className="w-full pl-12 pr-4 py-3 bg-white dark:bg-surface-dark border border-secondary/20 dark:border-white/10 rounded-2xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                />
            </div>

            {/* Grade Table */}
            <Card className="overflow-hidden p-0">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-secondary/10 dark:bg-white/5 border-b border-secondary/20">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-bold text-text-main dark:text-white uppercase tracking-wider sticky left-0 bg-secondary/10 dark:bg-zinc-800 z-10">
                                    No
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-text-main dark:text-white uppercase tracking-wider sticky left-10 bg-secondary/10 dark:bg-zinc-800 z-10 min-w-[180px]">
                                    Nama Siswa
                                </th>
                                {subjects.map((subj: any) => (
                                    <th key={subj.id} className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white uppercase tracking-wider min-w-[80px]">
                                        {subj.name}
                                    </th>
                                ))}
                                <th className="px-4 py-3 text-center text-xs font-bold text-primary uppercase tracking-wider min-w-[80px]">
                                    Rata-rata
                                </th>
                                <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white uppercase tracking-wider w-10">
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-secondary/10 dark:divide-white/5">
                            {filteredStudents.map((student: any, idx: number) => {
                                const studentGrade = studentGrades.find((sg: any) => sg.student_id === student.id)
                                const overall = calcStudentOverall(studentGrade)

                                return (
                                    <tr
                                        key={student.id}
                                        className="hover:bg-secondary/5 transition-colors cursor-pointer group"
                                        onClick={() => router.push(`/dashboard/guru/wali-kelas/${student.id}`)}
                                    >
                                        <td className="px-4 py-3 text-sm text-text-secondary sticky left-0 bg-white dark:bg-surface-dark group-hover:bg-secondary/5 z-10">
                                            {idx + 1}
                                        </td>
                                        <td className="px-4 py-3 sticky left-10 bg-white dark:bg-surface-dark group-hover:bg-secondary/5 z-10">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 flex items-center justify-center text-white text-xs font-bold">
                                                    {(student.user?.full_name || '?')[0]?.toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="text-sm font-bold text-text-main dark:text-white">
                                                        {student.user?.full_name || student.user?.username}
                                                    </div>
                                                    <div className="text-[10px] text-text-secondary">
                                                        {student.nis || '-'}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        {subjects.map((subj: any) => {
                                            const subjData = studentGrade?.subjects?.[subj.id]
                                            let avg: number | null = null
                                            if (subjData) {
                                                const allScores = [...subjData.tugas_scores, ...subjData.kuis_scores, ...subjData.ulangan_scores]
                                                avg = calcAvg(allScores)
                                            }
                                            return (
                                                <td key={subj.id} className={`px-4 py-3 text-center text-sm font-bold ${getScoreColor(avg)} ${getScoreBg(avg)} transition-colors`}>
                                                    {avg !== null ? avg : '-'}
                                                </td>
                                            )
                                        })}
                                        <td className={`px-4 py-3 text-center text-sm font-extrabold ${getScoreColor(overall)}`}>
                                            {overall !== null ? overall : '-'}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <ChevronRight className="w-4 h-4 text-text-secondary group-hover:text-primary transition-colors" />
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                {filteredStudents.length === 0 && (
                    <div className="p-8 text-center">
                        <p className="text-text-secondary">
                            {searchQuery ? 'Tidak ada siswa yang cocok dengan pencarian' : 'Belum ada data siswa di kelas ini'}
                        </p>
                    </div>
                )}
            </Card>

            {/* Legend */}
            <div className="flex items-center gap-6 text-xs text-text-secondary px-2">
                <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-green-500"></span>
                    ≥ 75 (Tuntas)
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                    60-74
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-red-500"></span>
                    &lt; 60
                </span>
            </div>
        </div>
    )
}
