'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useSchoolLabels } from '@/contexts/LabelsContext'
import { useRouter } from 'next/navigation'
import Card from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import { User, Graph, Edit, Game, TimeCircle, Notification } from 'react-iconly'

interface DashboardData {
    child: {
        id: string
        nis: string
        status: string
        gender: string
        user: { id: string; full_name: string; username: string }
        class: { id: string; name: string; grade_level: number; school_level: string } | null
        grades: any[]
        recentSubmissions: any[]
        recentQuizzes: any[]
        recentExams: any[]
        totalAssignments: number
    } | null
    announcements: any[]
    message?: string
}

export default function WaliDashboardPage() {
    const { user } = useAuth()
    const labels = useSchoolLabels()
    const router = useRouter()
    const [data, setData] = useState<DashboardData | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (user && user.role !== 'WALI') {
            router.replace('/dashboard')
        }
    }, [user, router])

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await fetch('/api/parent/dashboard')
                const json = await res.json()
                if (!json.error) setData(json)
                else console.error('API error:', json.error)
            } catch (err) {
                console.error('Error:', err)
            } finally {
                setLoading(false)
            }
        }
        if (user) fetchData()
    }, [user])

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-text-secondary text-sm">Memuat data anak...</p>
                </div>
            </div>
        )
    }

    if (!data || !data.child) {
        return (
            <div className="space-y-6">
                <PageHeader title="Dashboard Orang Tua" subtitle="Pantau perkembangan akademik anak Anda" />
                <Card className="text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center mx-auto mb-4">
                        <User set="bold" primaryColor="currentColor" size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Belum Ada Anak Terhubung</h3>
                    <p className="text-text-secondary max-w-md mx-auto">
                        {data?.message || 'Akun Anda belum dihubungkan dengan data siswa. Silakan hubungi admin sekolah.'}
                    </p>
                </Card>
                {data && data.announcements.length > 0 && (
                    <AnnouncementSection announcements={data.announcements} />
                )}
            </div>
        )
    }

    const child = data.child

    const avgScore = child.grades.length > 0
        ? Math.round(child.grades.reduce((sum, g) => sum + (g.score || 0), 0) / child.grades.length)
        : null
    const quizAvg = child.recentQuizzes.length > 0
        ? Math.round(child.recentQuizzes.reduce((sum, q) => sum + (q.score || 0), 0) / child.recentQuizzes.length)
        : null
    const examAvg = child.recentExams.length > 0
        ? Math.round(child.recentExams.reduce((sum, e) => sum + (e.score || 0), 0) / child.recentExams.length)
        : null

    return (
        <div className="space-y-6">
            <PageHeader
                title="Dashboard Orang Tua"
                subtitle={`Selamat datang, ${user?.full_name || user?.username}`}
            />

            {/* Child Profile Card */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-500 to-teal-600 p-6 shadow-xl">
                <div className="absolute -right-16 -top-16 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
                <div className="relative flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-white text-2xl font-bold">
                        {child.user.full_name?.[0] || '?'}
                    </div>
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-white">{child.user.full_name}</h2>
                        <div className="flex flex-wrap gap-2 mt-1">
                            <span className="px-2 py-0.5 rounded-full bg-white/20 text-white text-xs font-medium">
                                NIS: {child.nis || '-'}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-white/20 text-white text-xs font-medium">
                                {child.class?.name || 'Belum ada kelas'}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-white/20 text-white text-xs font-medium">
                                {child.gender === 'L' ? '👦 Laki-laki' : child.gender === 'P' ? '👧 Perempuan' : '-'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="text-center py-4">
                    <div className="flex justify-center"><Graph set="bold" primaryColor="#10b981" size={24} /></div>
                    <div className="text-2xl font-bold text-text-main dark:text-white mt-1">{avgScore ?? '-'}</div>
                    <div className="text-[11px] text-text-secondary">Rata² {labels.tugas}</div>
                </Card>
                <Card className="text-center py-4">
                    <div className="flex justify-center"><Game set="bold" primaryColor="#6366f1" size={24} /></div>
                    <div className="text-2xl font-bold text-text-main dark:text-white mt-1">{quizAvg ?? '-'}</div>
                    <div className="text-[11px] text-text-secondary">Rata² {labels.kuis}</div>
                </Card>
                <Card className="text-center py-4">
                    <div className="flex justify-center"><TimeCircle set="bold" primaryColor="#f59e0b" size={24} /></div>
                    <div className="text-2xl font-bold text-text-main dark:text-white mt-1">{examAvg ?? '-'}</div>
                    <div className="text-[11px] text-text-secondary">Rata² {labels.ulangan}</div>
                </Card>
                <Card className="text-center py-4">
                    <div className="flex justify-center"><Edit set="bold" primaryColor="#ef4444" size={24} /></div>
                    <div className="text-2xl font-bold text-text-main dark:text-white mt-1">{child.totalAssignments}</div>
                    <div className="text-[11px] text-text-secondary">Total {labels.tugas}</div>
                </Card>
            </div>

            {/* Graded Assignments */}
            {child.grades.length > 0 && (
                <Card>
                    <h3 className="text-lg font-bold text-text-main dark:text-white mb-4 flex items-center gap-2">
                        <Graph set="bold" primaryColor="currentColor" size={20} />
                        Nilai {labels.tugas}
                    </h3>
                    <div className="space-y-2">
                        {child.grades.map((grade: any) => {
                            const scoreColor = grade.score >= 80 ? 'text-emerald-600' : grade.score >= 60 ? 'text-amber-600' : 'text-red-600'
                            return (
                                <div key={grade.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/5 hover:bg-secondary/10 transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-text-main dark:text-white truncate">{grade.assignment_title}</p>
                                        <p className="text-xs text-text-secondary">{grade.subject_name} • {grade.graded_at ? new Date(grade.graded_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-'}</p>
                                    </div>
                                    <span className={`text-sm font-bold ${scoreColor}`}>{grade.score}</span>
                                </div>
                            )
                        })}
                    </div>
                </Card>
            )}

            {/* Recent Submissions */}
            {child.recentSubmissions.length > 0 && (
                <Card>
                    <h3 className="text-lg font-bold text-text-main dark:text-white mb-4 flex items-center gap-2">
                        <Edit set="bold" primaryColor="currentColor" size={20} />
                        {labels.tugas} Terbaru
                    </h3>
                    <div className="space-y-2">
                        {child.recentSubmissions.map((sub: any) => (
                            <div key={sub.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/5 hover:bg-secondary/10 transition-colors">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-text-main dark:text-white truncate">{sub.title}</p>
                                    <p className="text-xs text-text-secondary">
                                        {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Belum dikumpulkan'}
                                    </p>
                                </div>
                                {sub.score !== null && sub.score !== undefined ? (
                                    <span className={`text-sm font-bold ${sub.score >= 80 ? 'text-emerald-600' : sub.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                        {sub.score}
                                    </span>
                                ) : (
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sub.status === 'SUBMITTED' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {sub.status === 'SUBMITTED' ? 'Menunggu nilai' : 'Belum dinilai'}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Recent Quizzes */}
            {child.recentQuizzes.length > 0 && (
                <Card>
                    <h3 className="text-lg font-bold text-text-main dark:text-white mb-4 flex items-center gap-2">
                        <Game set="bold" primaryColor="currentColor" size={20} />
                        {labels.kuis} Terbaru
                    </h3>
                    <div className="space-y-2">
                        {child.recentQuizzes.map((quiz: any) => (
                            <div key={quiz.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/5 hover:bg-secondary/10 transition-colors">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-text-main dark:text-white truncate">{quiz.title}</p>
                                    <p className="text-xs text-text-secondary">
                                        {quiz.completed_at ? new Date(quiz.completed_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <span className={`text-sm font-bold ${quiz.score >= 80 ? 'text-emerald-600' : quiz.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                        {quiz.score}%
                                    </span>
                                    <p className="text-[10px] text-text-secondary">{quiz.total_score}/{quiz.max_score}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Recent Exams */}
            {child.recentExams.length > 0 && (
                <Card>
                    <h3 className="text-lg font-bold text-text-main dark:text-white mb-4 flex items-center gap-2">
                        <TimeCircle set="bold" primaryColor="currentColor" size={20} />
                        {labels.ulangan} Terbaru
                    </h3>
                    <div className="space-y-2">
                        {child.recentExams.map((exam: any) => (
                            <div key={exam.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/5 hover:bg-secondary/10 transition-colors">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-text-main dark:text-white truncate">{exam.title}</p>
                                    <p className="text-xs text-text-secondary">
                                        {exam.completed_at ? new Date(exam.completed_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <span className={`text-sm font-bold ${exam.score >= 80 ? 'text-emerald-600' : exam.score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                        {exam.score}%
                                    </span>
                                    <p className="text-[10px] text-text-secondary">{exam.total_score}/{exam.max_score}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Announcements */}
            {data.announcements.length > 0 && (
                <AnnouncementSection announcements={data.announcements} />
            )}

            {/* Empty state */}
            {child.grades.length === 0 && child.recentSubmissions.length === 0 && child.recentQuizzes.length === 0 && child.recentExams.length === 0 && (
                <Card className="text-center py-10">
                    <p className="text-text-secondary">Belum ada aktivitas akademik untuk {child.user.full_name}.</p>
                </Card>
            )}
        </div>
    )
}

function AnnouncementSection({ announcements }: { announcements: any[] }) {
    return (
        <Card>
            <h3 className="text-lg font-bold text-text-main dark:text-white mb-4 flex items-center gap-2">
                <Notification set="bold" primaryColor="currentColor" size={20} />
                Pengumuman Sekolah
            </h3>
            <div className="space-y-3">
                {announcements.map((ann: any) => (
                    <div key={ann.id} className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center justify-between mb-1">
                            <h4 className="text-sm font-bold text-blue-700 dark:text-blue-300">{ann.title}</h4>
                            <span className="text-xs text-blue-500">
                                {new Date(ann.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                            </span>
                        </div>
                        <p className="text-xs text-blue-600 dark:text-blue-400 line-clamp-2">{ann.content}</p>
                    </div>
                ))}
            </div>
        </Card>
    )
}
