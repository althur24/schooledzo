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
            title: 'Review Soal',
            description: 'Review kualitas soal HOTS',
            icon: ShieldDone,
            href: '/dashboard/admin/review-soal',
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
                    {menuItems.map((item, i) => (
                        <Link
                            key={i}
                            href={item.href}
                        >
                            <Card className="h-full border border-slate-200 hover:border-emerald-500 hover:shadow-md active:scale-95 transition-all group cursor-pointer bg-white dark:bg-surface-dark">
                                <div className="flex items-start gap-4">
                                    {/* Duotone Icon Container with unique colors per function */}
                                    <div className={`flex-shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 shadow-sm ${item.href.includes('tahun-ajaran') ? 'bg-indigo-50 dark:bg-indigo-900/10 group-hover:bg-indigo-500 text-indigo-500 dark:text-indigo-400 group-hover:text-white' :
                                        item.href.includes('/kelas') ? 'bg-cyan-50 dark:bg-cyan-900/10 group-hover:bg-cyan-500 text-cyan-500 dark:text-cyan-400 group-hover:text-white' :
                                            item.href.includes('mapel') ? 'bg-blue-50 dark:bg-blue-900/10 group-hover:bg-blue-500 text-blue-500 dark:text-blue-400 group-hover:text-white' :
                                                item.href.includes('/guru') ? 'bg-emerald-50 dark:bg-emerald-900/10 group-hover:bg-emerald-500 text-emerald-500 dark:text-emerald-400 group-hover:text-white' :
                                                    item.href.includes('siswa') ? 'bg-violet-50 dark:bg-violet-900/10 group-hover:bg-violet-500 text-violet-500 dark:text-violet-400 group-hover:text-white' :
                                                        item.href.includes('penugasan') ? 'bg-teal-50 dark:bg-teal-900/10 group-hover:bg-teal-500 text-teal-500 dark:text-teal-400 group-hover:text-white' :
                                                            item.href.includes('rekap-nilai') ? 'bg-green-50 dark:bg-green-900/10 group-hover:bg-green-500 text-green-500 dark:text-green-400 group-hover:text-white' :
                                                                'bg-slate-50 dark:bg-slate-800 group-hover:bg-slate-600 text-slate-500 dark:text-slate-400 group-hover:text-white'
                                        }`}>
                                        <item.icon
                                            set="bold"
                                            primaryColor="currentColor"
                                            size={28} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-lg font-bold text-slate-800 dark:text-white group-hover:text-emerald-600 transition-colors mb-1">
                                            {item.title}
                                        </h3>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
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
        </div>
    )
}
