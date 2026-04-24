'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import Card from '@/components/ui/Card'
import StatsCard from '@/components/ui/StatsCard'
import {
    Calendar, Category, Document, Work, User, AddUser, Chart, Graph,
    Ticket, Notification, ShieldDone, Bookmark
} from 'react-iconly'

interface StatsData {
    totalTeachers: number
    totalStudents: number
    totalClasses: number
    totalSubjects: number
}

interface SchoolInfo {
    name: string
    address: string | null
    phone: string | null
    email: string | null
    school_level: string | null
    logo_url: string | null
}

export default function AdminDashboard() {
    const { user } = useAuth()
    const router = useRouter()
    const [stats, setStats] = useState<StatsData>({
        totalTeachers: 0,
        totalStudents: 0,
        totalClasses: 0,
        totalSubjects: 0
    })
    const [school, setSchool] = useState<SchoolInfo | null>(null)
    const [aiReviewEnabled, setAiReviewEnabled] = useState(true)
    const [aiToggleLoading, setAiToggleLoading] = useState(false)
    const [pendingReviewCount, setPendingReviewCount] = useState(0)

    useEffect(() => {
        if (user && user.role !== 'ADMIN') {
            router.replace('/dashboard')
        }
    }, [user, router])

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [teachersRes, studentsRes, classesRes, subjectsRes] = await Promise.all([
                    fetch('/api/teachers'),
                    fetch('/api/students'),
                    fetch('/api/classes'),
                    fetch('/api/subjects')
                ])
                const [teachers, students, classes, subjects] = await Promise.all([
                    teachersRes.json(),
                    studentsRes.json(),
                    classesRes.json(),
                    subjectsRes.json()
                ])
                setStats({
                    totalTeachers: Array.isArray(teachers) ? teachers.length : 0,
                    totalStudents: Array.isArray(students) ? students.length : 0,
                    totalClasses: Array.isArray(classes) ? classes.length : 0,
                    totalSubjects: Array.isArray(subjects) ? subjects.length : 0
                })
            } catch (error) {
                console.error('Error fetching stats:', error)
            }
        }

        const fetchSchool = async () => {
            try {
                const res = await fetch('/api/schools/public')
                if (res.ok) {
                    const schools = await res.json()
                    const mySchool = schools.find((s: { id: string }) => s.id === user?.school_id)
                    if (mySchool) setSchool(mySchool)
                }
            } catch (err) {
                console.error('Error fetching school info:', err)
            }
        }

        if (user) {
            fetchData()
            fetchSchool()
        }
    }, [user])

    // Fetch pending review count
    useEffect(() => {
        const fetchPendingReview = async () => {
            try {
                const res = await fetch('/api/admin/review-queue?page=1&limit=1&status=admin_review')
                if (res.ok) {
                    const data = await res.json()
                    setPendingReviewCount(data.total || 0)
                }
            } catch (err) {
                console.error('Error fetching review count:', err)
            }
        }
        if (user && user.role === 'ADMIN') fetchPendingReview()
    }, [user])

    // Fetch school settings (AI review toggle)
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await fetch('/api/school-settings')
                if (res.ok) {
                    const data = await res.json()
                    setAiReviewEnabled(data.ai_review_enabled !== false)
                }
            } catch (err) {
                console.error('Error fetching settings:', err)
            }
        }
        if (user) fetchSettings()
    }, [user])

    const handleToggleAIReview = async () => {
        setAiToggleLoading(true)
        try {
            const res = await fetch('/api/school-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ai_review_enabled: !aiReviewEnabled })
            })
            if (res.ok) {
                setAiReviewEnabled(!aiReviewEnabled)
            }
        } catch (err) {
            console.error('Error toggling AI review:', err)
        } finally {
            setAiToggleLoading(false)
        }
    }

    const menuItems = [
        {
            title: 'Tahun Ajaran',
            description: 'Kelola tahun ajaran aktif',
            icon: Calendar,
            href: '/dashboard/admin/tahun-ajaran',
        },
        {
            title: 'Kelas',
            description: 'Kelola daftar kelas',
            icon: Category,
            href: '/dashboard/admin/kelas',
        },
        {
            title: 'Kenaikan Kelas',
            description: 'Proses kenaikan kelas massal',
            icon: Graph,
            href: '/dashboard/admin/kenaikan-kelas',
        },
        {
            title: 'Mata Pelajaran',
            description: 'Kelola daftar mapel',
            icon: Bookmark,
            href: '/dashboard/admin/mapel',
        },
        {
            title: 'Akun Guru',
            description: 'Kelola akun guru',
            icon: Work,
            href: '/dashboard/admin/guru',
        },
        {
            title: 'Akun Siswa',
            description: 'Kelola akun siswa',
            icon: User,
            href: '/dashboard/admin/siswa',
        },
        {
            title: 'Penugasan',
            description: 'Assign guru ke kelas',
            icon: Ticket,
            href: '/dashboard/admin/penugasan',
        },
        {
            title: 'Rekap Nilai',
            description: 'Rekap nilai per kelas',
            icon: Chart,
            href: '/dashboard/admin/rekap-nilai',
        },
        {
            title: 'Analitik',
            description: 'Performa per mapel',
            icon: Graph,
            href: '/dashboard/admin/analitik',
        },
        {
            title: 'UTS/UAS',
            description: 'Kelola ujian tengah & akhir semester',
            icon: Document,
            href: '/dashboard/admin/uts-uas',
        },
        {
            title: 'Review Soal',
            description: pendingReviewCount > 0 ? `${pendingReviewCount} soal menunggu review` : 'Review kualitas soal HOTS',
            icon: ShieldDone,
            href: '/dashboard/admin/review-soal',
            badge: pendingReviewCount,
        },
        {
            title: 'Pengumuman',
            description: 'Kelola pengumuman',
            icon: Notification,
            href: '/dashboard/admin/pengumuman',
        },
        {
            title: 'Jadwal',
            description: 'Kelola jadwal pelajaran',
            icon: Calendar,
            href: '/dashboard/admin/jadwal',
        }
    ]

    return (
        <div className="space-y-8">
            {/* Welcome Section */}
            <div className="relative overflow-hidden rounded-3xl bg-slate-900 text-white p-8 shadow-xl shadow-slate-900/20">
                <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10"></div>
                <div className="absolute -right-20 -top-20 w-80 h-80 bg-emerald-500/20 rounded-full blur-3xl"></div>

                <div className="relative">
                    <h1 className="text-3xl font-bold text-white mb-2 leading-tight">
                        Selamat Datang Admin, {user?.full_name}! 👋
                    </h1>
                    <p className="text-slate-300 text-lg">
                        Panel Administrasi - Kelola seluruh data sekolah
                    </p>
                </div>
            </div>

            {/* Pending Review Alert */}
            {aiReviewEnabled && pendingReviewCount > 0 && (
                <Link href="/dashboard/admin/review-soal">
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-5 flex items-center justify-between hover:shadow-md transition-all group cursor-pointer">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-800/30 flex items-center justify-center text-2xl animate-pulse">
                                ⚠️
                            </div>
                            <div>
                                <h3 className="font-bold text-amber-800 dark:text-amber-300 text-lg">
                                    {pendingReviewCount} Soal Menunggu Review
                                </h3>
                                <p className="text-sm text-amber-600 dark:text-amber-400">
                                    Ada soal dari guru yang perlu ditinjau dan disetujui
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-sm group-hover:translate-x-1 transition-transform">
                            Review Sekarang
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </div>
                    </div>
                </Link>
            )}

            {/* School Profile Card */}
            {school && (
                <div className="bg-white dark:bg-surface-dark rounded-2xl border border-[#E8F0E6] dark:border-primary/10 p-6">
                    <div className="flex items-center gap-6">
                        {/* Logo */}
                        <div className="flex-shrink-0 w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-800/20 border-2 border-emerald-200 dark:border-emerald-700 flex items-center justify-center overflow-hidden">
                            {school.logo_url ? (
                                <img src={school.logo_url} alt={school.name} className="w-full h-full object-contain p-1" />
                            ) : (
                                <span className="text-3xl">🏫</span>
                            )}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                            <h2 className="text-xl font-bold text-text-main dark:text-white">{school.name}</h2>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-sm text-text-secondary">
                                {school.school_level && (
                                    <span className="inline-flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                        {school.school_level === 'BOTH' ? 'SMP + SMA' : school.school_level}
                                    </span>
                                )}
                                {school.address && (
                                    <span className="inline-flex items-center gap-1">📍 {school.address}</span>
                                )}
                                {school.phone && (
                                    <span className="inline-flex items-center gap-1">📞 {school.phone}</span>
                                )}
                                {school.email && (
                                    <span className="inline-flex items-center gap-1">📧 {school.email}</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Stats Grid */}
            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                <StatsCard
                    label="Total Guru"
                    value={stats.totalTeachers}
                    icon={<div className="text-blue-500 flex items-center justify-center"><Work set="bold" primaryColor="currentColor" size={32} /></div>}
                />
                <StatsCard
                    label="Total Siswa"
                    value={stats.totalStudents}
                    icon={<div className="text-emerald-500 flex items-center justify-center"><User set="bold" primaryColor="currentColor" size={32} /></div>}
                />
                <StatsCard
                    label="Total Kelas"
                    value={stats.totalClasses}
                    icon={<div className="text-purple-500 flex items-center justify-center"><Category set="bold" primaryColor="currentColor" size={32} /></div>}
                />
                <StatsCard
                    label="Total Mapel"
                    value={stats.totalSubjects}
                    icon={<div className="text-amber-500 flex items-center justify-center"><Document set="bold" primaryColor="currentColor" size={32} /></div>}
                />
            </div>

            {/* Menu Grid */}
            <div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-6">Menu Kelola</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {menuItems.filter(item => {
                        // Hide Review Soal when AI review is off
                        if (item.href.includes('review-soal') && !aiReviewEnabled) return false
                        return true
                    }).map((item, i) => (
                        <Link
                            key={i}
                            href={item.href}
                        >
                            <Card className={`h-full border hover:shadow-md active:scale-95 transition-all group cursor-pointer bg-white dark:bg-surface-dark ${(item as any).badge > 0 ? 'border-amber-300 dark:border-amber-600 ring-2 ring-amber-200 dark:ring-amber-800/50' : 'border-slate-200 hover:border-emerald-500'}`}>
                                <div className="flex items-start gap-4">
                                    {/* Duotone Icon Container with unique colors per function */}
                                    <div className={`relative flex-shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 shadow-sm ${item.href.includes('tahun-ajaran') ? 'bg-indigo-50 dark:bg-indigo-900/10 group-hover:bg-indigo-500 text-indigo-500 dark:text-indigo-400 group-hover:text-white' :
                                        item.href.includes('/kelas') ? 'bg-cyan-50 dark:bg-cyan-900/10 group-hover:bg-cyan-500 text-cyan-500 dark:text-cyan-400 group-hover:text-white' :
                                            item.href.includes('mapel') ? 'bg-blue-50 dark:bg-blue-900/10 group-hover:bg-blue-500 text-blue-500 dark:text-blue-400 group-hover:text-white' :
                                                item.href.includes('/guru') ? 'bg-emerald-50 dark:bg-emerald-900/10 group-hover:bg-emerald-500 text-emerald-500 dark:text-emerald-400 group-hover:text-white' :
                                                    item.href.includes('siswa') ? 'bg-violet-50 dark:bg-violet-900/10 group-hover:bg-violet-500 text-violet-500 dark:text-violet-400 group-hover:text-white' :
                                                        item.href.includes('penugasan') ? 'bg-teal-50 dark:bg-teal-900/10 group-hover:bg-teal-500 text-teal-500 dark:text-teal-400 group-hover:text-white' :
                                                            item.href.includes('rekap-nilai') ? 'bg-green-50 dark:bg-green-900/10 group-hover:bg-green-500 text-green-500 dark:text-green-400 group-hover:text-white' :
                                                                item.href.includes('uts-uas') ? 'bg-purple-50 dark:bg-purple-900/10 group-hover:bg-purple-500 text-purple-500 dark:text-purple-400 group-hover:text-white' :
                                                                    'bg-slate-50 dark:bg-slate-800 group-hover:bg-slate-600 text-slate-500 dark:text-slate-400 group-hover:text-white'
                                        }`}>
                                        <item.icon
                                            set="bold"
                                            primaryColor="currentColor"
                                            size={28} />
                                        {(item as any).badge > 0 && (
                                            <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] flex items-center justify-center px-1 text-[11px] font-bold text-white bg-red-500 rounded-full shadow-md animate-pulse">
                                                {(item as any).badge}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-lg font-bold text-slate-800 dark:text-white group-hover:text-emerald-600 transition-colors mb-1">
                                            {item.title}
                                        </h3>
                                        <p className={`text-sm ${(item as any).badge > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-500 dark:text-slate-400'}`}>
                                            {item.description}
                                        </p>
                                    </div>
                                    <div className="self-center opacity-0 group-hover:opacity-100 transition-all transform translate-x-[-10px] group-hover:translate-x-0 text-emerald-500">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </div>
                                </div>
                            </Card>
                        </Link>
                    ))}
                </div>
            </div>

            {/* AI Review Toggle Section */}
            <div className="bg-white dark:bg-surface-dark rounded-2xl border border-slate-200 dark:border-primary/10 p-6">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">⚙️ Pengaturan Fitur</h2>
                <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-700">
                    <div className="flex-1">
                        <p className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            🤖 AI Review Soal
                        </p>
                        <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
                            {aiReviewEnabled
                                ? 'Soal yang dibuat guru akan dianalisis AI secara otomatis untuk HOTS, Bloom, dan kualitas.'
                                : 'Soal yang dibuat guru akan langsung disetujui tanpa analisis AI.'}
                        </p>
                    </div>
                    <button
                        onClick={handleToggleAIReview}
                        disabled={aiToggleLoading}
                        className={`relative ml-4 w-14 h-7 rounded-full transition-all duration-300 flex-shrink-0 ${aiReviewEnabled
                                ? 'bg-emerald-500 hover:bg-emerald-600'
                                : 'bg-slate-300 dark:bg-zinc-600 hover:bg-slate-400'
                            } ${aiToggleLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                        <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300 ${aiReviewEnabled ? 'translate-x-7' : 'translate-x-0'
                            }`} />
                    </button>
                </div>
            </div>
        </div>
    )
}
