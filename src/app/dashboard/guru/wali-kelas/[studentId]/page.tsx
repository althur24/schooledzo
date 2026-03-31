'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useParams } from 'next/navigation'
import Card from '@/components/ui/Card'
import { PageHeader, EmptyState } from '@/components/ui'
import {
    HeartHandshake, Loader2, BookOpen, PenTool,
    Brain, Clock, TrendingUp, GraduationCap, FileText
} from 'lucide-react'

export default function WaliKelasStudentDetail() {
    const { user } = useAuth()
    const router = useRouter()
    const params = useParams()
    const studentId = params.studentId as string
    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(true)

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

    const calcAvg = (scores: number[]) => {
        if (scores.length === 0) return null
        return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    }

    const getScoreColor = (score: number | null) => {
        if (score === null) return 'text-text-secondary'
        if (score >= 75) return 'text-green-600 dark:text-green-400'
        if (score >= 60) return 'text-amber-600 dark:text-amber-400'
        return 'text-red-600 dark:text-red-400'
    }

    const getScoreBadgeBg = (score: number | null) => {
        if (score === null) return 'bg-secondary/10 text-text-secondary'
        if (score >= 75) return 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20'
        if (score >= 60) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
        return 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-60">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!data || !data.students) {
        return (
            <div className="space-y-6">
                <PageHeader
                    title="Detail Siswa"
                    subtitle="Data tidak ditemukan"
                    backHref="/dashboard/guru/wali-kelas"
                    icon={<HeartHandshake className="w-6 h-6 text-pink-500" />}
                />
                <Card className="p-6">
                    <EmptyState
                        icon={<HeartHandshake className="w-12 h-12 text-pink-200" />}
                        title="Data Tidak Ditemukan"
                        description="Siswa tidak ditemukan di kelas Anda"
                    />
                </Card>
            </div>
        )
    }

    const student = data.students.find((s: any) => s.id === studentId)
    const studentGrade = data.student_grades?.find((sg: any) => sg.student_id === studentId)
    const subjects = data.subjects || []
    const currentClass = data.classes?.find((c: any) => c.id === data.current_class_id)

    if (!student) {
        return (
            <div className="space-y-6">
                <PageHeader
                    title="Detail Siswa"
                    subtitle="Siswa tidak ditemukan"
                    backHref="/dashboard/guru/wali-kelas"
                    icon={<HeartHandshake className="w-6 h-6 text-pink-500" />}
                />
                <Card className="p-6">
                    <EmptyState
                        icon={<HeartHandshake className="w-12 h-12 text-pink-200" />}
                        title="Siswa Tidak Ditemukan"
                        description="Siswa tidak ditemukan di kelas Anda"
                    />
                </Card>
            </div>
        )
    }

    // Calculate overall
    const subjectAvgs: { name: string; avg: number | null }[] = []
    subjects.forEach((subj: any) => {
        const subjData = studentGrade?.subjects?.[subj.id]
        if (subjData) {
            const allScores = [
                ...subjData.tugas_scores, ...subjData.kuis_scores, ...subjData.ulangan_scores,
                ...(subjData.uts_scores || []), ...(subjData.uas_scores || [])
            ]
            subjectAvgs.push({ name: subj.name, avg: calcAvg(allScores) })
        } else {
            subjectAvgs.push({ name: subj.name, avg: null })
        }
    })

    const validAvgs = subjectAvgs.filter(s => s.avg !== null).map(s => s.avg as number)
    const overallAvg = validAvgs.length > 0
        ? Math.round(validAvgs.reduce((a, b) => a + b, 0) / validAvgs.length)
        : null

    // Calculate ranking
    const allStudentOveralls = data.students.map((s: any) => {
        const sg = data.student_grades?.find((g: any) => g.student_id === s.id)
        if (!sg?.subjects) return { id: s.id, avg: null }
        const avgs: number[] = []
        Object.values(sg.subjects).forEach((subj: any) => {
            const allScores = [
                ...subj.tugas_scores, ...subj.kuis_scores, ...subj.ulangan_scores,
                ...(subj.uts_scores || []), ...(subj.uas_scores || [])
            ]
            const avg = calcAvg(allScores)
            if (avg !== null) avgs.push(avg)
        })
        return {
            id: s.id,
            avg: avgs.length > 0 ? Math.round(avgs.reduce((a: number, b: number) => a + b, 0) / avgs.length) : null
        }
    }).filter((s: any) => s.avg !== null).sort((a: any, b: any) => b.avg - a.avg)

    const ranking = allStudentOveralls.findIndex((s: any) => s.id === studentId) + 1

    const subjectIcons: Record<string, any> = {}
    const iconColors = [
        { icon: BookOpen, bg: 'from-blue-500 to-blue-600', light: 'bg-blue-50 dark:bg-blue-500/10' },
        { icon: PenTool, bg: 'from-amber-500 to-amber-600', light: 'bg-amber-50 dark:bg-amber-500/10' },
        { icon: Brain, bg: 'from-purple-500 to-purple-600', light: 'bg-purple-50 dark:bg-purple-500/10' },
        { icon: Clock, bg: 'from-red-500 to-red-600', light: 'bg-red-50 dark:bg-red-500/10' },
        { icon: TrendingUp, bg: 'from-emerald-500 to-emerald-600', light: 'bg-emerald-50 dark:bg-emerald-500/10' },
    ]

    return (
        <div className="space-y-6">
            <PageHeader
                title={student.user?.full_name || student.user?.username || 'Siswa'}
                subtitle={`${currentClass?.name || '-'} • NIS: ${student.nis || '-'}`}
                backHref="/dashboard/guru/wali-kelas"
                icon={<HeartHandshake className="w-6 h-6 text-pink-500" />}
            />

            {/* Student Summary */}
            <Card className="p-6 bg-gradient-to-br from-pink-50 to-rose-50 dark:from-pink-900/20 dark:to-rose-900/20 border-pink-200/50 dark:border-pink-500/20">
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-pink-500/30">
                        {(student.user?.full_name || '?')[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-text-main dark:text-white">
                            {student.user?.full_name || student.user?.username}
                        </h2>
                        <div className="flex items-center gap-4 mt-1">
                            <span className="text-sm text-text-secondary">
                                NIS: <strong>{student.nis || '-'}</strong>
                            </span>
                            <span className="text-sm text-text-secondary">
                                Kelas: <strong>{currentClass?.name || '-'}</strong>
                            </span>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className={`text-3xl font-extrabold ${getScoreColor(overallAvg)}`}>
                            {overallAvg !== null ? overallAvg : '-'}
                        </div>
                        <div className="text-xs text-text-secondary mt-0.5">Rata-rata</div>
                        {ranking > 0 && (
                            <div className="text-xs text-pink-600 dark:text-pink-400 font-bold mt-1">
                                🏆 Ranking {ranking} dari {allStudentOveralls.length}
                            </div>
                        )}
                    </div>
                </div>
            </Card>

            {/* Per Subject Breakdown */}
            <div className="space-y-4">
                <h3 className="text-lg font-bold text-text-main dark:text-white px-1">
                    📋 Nilai Per Mata Pelajaran
                </h3>

                {subjects.length === 0 ? (
                    <Card className="p-6">
                        <EmptyState
                            icon={<BookOpen className="w-12 h-12 text-blue-200" />}
                            title="Belum Ada Data"
                            description="Belum ada nilai untuk ditampilkan"
                        />
                    </Card>
                ) : (
                    subjects.map((subj: any, idx: number) => {
                        const subjData = studentGrade?.subjects?.[subj.id]
                        const colorSet = iconColors[idx % iconColors.length]
                        const IconComponent = colorSet.icon
                        const allScores = subjData
                            ? [
                                ...subjData.tugas_scores, ...subjData.kuis_scores, ...subjData.ulangan_scores,
                                ...(subjData.uts_scores || []), ...(subjData.uas_scores || [])
                            ]
                            : []
                        const avg = calcAvg(allScores)

                        return (
                            <Card key={subj.id} className="p-0 overflow-hidden">
                                {/* Subject Header */}
                                <div className={`flex items-center justify-between p-4 ${colorSet.light}`}>
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colorSet.bg} flex items-center justify-center`}>
                                            <IconComponent className="w-5 h-5 text-white" />
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-text-main dark:text-white">
                                                {subj.name}
                                            </h4>
                                            <p className="text-xs text-text-secondary">
                                                {allScores.length} nilai tercatat
                                            </p>
                                        </div>
                                    </div>
                                    <div className={`px-4 py-1.5 rounded-full text-lg font-extrabold ${getScoreBadgeBg(avg)}`}>
                                        {avg !== null ? avg : '-'}
                                    </div>
                                </div>

                                {/* Score Breakdown */}
                                {subjData && (
                                <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
                                        {/* Tugas */}
                                        <div className="bg-secondary/5 dark:bg-white/5 rounded-xl p-3">
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <PenTool className="w-3.5 h-3.5 text-amber-500" />
                                                <span className="text-xs font-bold text-text-main dark:text-white">
                                                    Tugas
                                                </span>
                                            </div>
                                            {subjData.tugas_scores.length > 0 ? (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {subjData.tugas_scores.map((score: number, i: number) => (
                                                        <span
                                                            key={i}
                                                            className={`px-2 py-0.5 rounded-lg text-xs font-bold ${getScoreBadgeBg(score)}`}
                                                        >
                                                            {score}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-text-secondary">Belum ada</span>
                                            )}
                                        </div>

                                        {/* Kuis */}
                                        <div className="bg-secondary/5 dark:bg-white/5 rounded-xl p-3">
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <Brain className="w-3.5 h-3.5 text-purple-500" />
                                                <span className="text-xs font-bold text-text-main dark:text-white">
                                                    Kuis
                                                </span>
                                            </div>
                                            {subjData.kuis_scores.length > 0 ? (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {subjData.kuis_scores.map((score: number, i: number) => (
                                                        <span
                                                            key={i}
                                                            className={`px-2 py-0.5 rounded-lg text-xs font-bold ${getScoreBadgeBg(score)}`}
                                                        >
                                                            {score}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-text-secondary">Belum ada</span>
                                            )}
                                        </div>

                                        {/* Ulangan */}
                                        <div className="bg-secondary/5 dark:bg-white/5 rounded-xl p-3">
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <Clock className="w-3.5 h-3.5 text-red-500" />
                                                <span className="text-xs font-bold text-text-main dark:text-white">
                                                    Ulangan
                                                </span>
                                            </div>
                                            {subjData.ulangan_scores.length > 0 ? (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {subjData.ulangan_scores.map((score: number, i: number) => (
                                                        <span
                                                            key={i}
                                                            className={`px-2 py-0.5 rounded-lg text-xs font-bold ${getScoreBadgeBg(score)}`}
                                                        >
                                                            {score}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-text-secondary">Belum ada</span>
                                            )}
                                        </div>

                                        {/* UTS */}
                                        <div className="bg-secondary/5 dark:bg-white/5 rounded-xl p-3">
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <GraduationCap className="w-3.5 h-3.5 text-indigo-500" />
                                                <span className="text-xs font-bold text-text-main dark:text-white">
                                                    UTS
                                                </span>
                                            </div>
                                            {(subjData.uts_scores || []).length > 0 ? (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {subjData.uts_scores.map((score: number, i: number) => (
                                                        <span
                                                            key={i}
                                                            className={`px-2 py-0.5 rounded-lg text-xs font-bold ${getScoreBadgeBg(score)}`}
                                                        >
                                                            {score}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-text-secondary">Belum ada</span>
                                            )}
                                        </div>

                                        {/* UAS */}
                                        <div className="bg-secondary/5 dark:bg-white/5 rounded-xl p-3">
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <FileText className="w-3.5 h-3.5 text-teal-500" />
                                                <span className="text-xs font-bold text-text-main dark:text-white">
                                                    UAS
                                                </span>
                                            </div>
                                            {(subjData.uas_scores || []).length > 0 ? (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {subjData.uas_scores.map((score: number, i: number) => (
                                                        <span
                                                            key={i}
                                                            className={`px-2 py-0.5 rounded-lg text-xs font-bold ${getScoreBadgeBg(score)}`}
                                                        >
                                                            {score}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-text-secondary">Belum ada</span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {!subjData && (
                                    <div className="p-4 text-center text-sm text-text-secondary">
                                        Belum ada nilai untuk mata pelajaran ini
                                    </div>
                                )}
                            </Card>
                        )
                    })
                )}
            </div>
        </div>
    )
}
