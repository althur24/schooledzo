'use client'

import { useState, useEffect } from 'react'

interface School {
    id: string
    name: string
    code: string
    logo_url: string | null
    address: string | null
    phone: string | null
    email: string | null
    school_level: string | null
    is_active: boolean
    max_students: number
    max_teachers: number
    created_at: string
    student_count: number
    teacher_count: number
    class_count: number
}

export default function SekolahListPage() {
    const [schools, setSchools] = useState<School[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')

    useEffect(() => {
        fetchSchools()
    }, [])

    const fetchSchools = async () => {
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

    const filteredSchools = schools.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.code.toLowerCase().includes(search.toLowerCase())
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-text-main dark:text-white">Manajemen Sekolah</h1>
                    <p className="text-text-secondary text-sm mt-1">Kelola semua sekolah yang terdaftar</p>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <svg className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                    type="text"
                    placeholder="Cari sekolah..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-white dark:bg-surface-dark border border-[#E8F0E6] dark:border-primary/10 rounded-xl text-text-main dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
            </div>

            {/* School Cards */}
            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <svg className="animate-spin w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                </div>
            ) : filteredSchools.length === 0 ? (
                <div className="text-center py-16 text-text-secondary">
                    {search ? 'Tidak ada sekolah yang cocok' : 'Belum ada sekolah terdaftar'}
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {filteredSchools.map((school) => (
                        <a key={school.id} href={`/dashboard/super-admin/sekolah/${school.id}`} className="bg-white dark:bg-surface-dark rounded-2xl border border-[#E8F0E6] dark:border-primary/10 p-6 hover:shadow-lg transition-shadow cursor-pointer block">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-xl">
                                        🏫
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-text-main dark:text-white text-lg">{school.name}</h3>
                                        <p className="text-xs text-text-secondary">{school.code} • {school.school_level || '-'}</p>
                                    </div>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold ${school.is_active
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                    }`}>
                                    {school.is_active ? 'Aktif' : 'Nonaktif'}
                                </span>
                            </div>

                            <div className="grid grid-cols-3 gap-3 mb-4">
                                <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-3 text-center">
                                    <p className="text-lg font-bold text-text-main dark:text-white">{school.student_count || 0}</p>
                                    <p className="text-xs text-text-secondary">Siswa</p>
                                </div>
                                <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-3 text-center">
                                    <p className="text-lg font-bold text-text-main dark:text-white">{school.teacher_count || 0}</p>
                                    <p className="text-xs text-text-secondary">Guru</p>
                                </div>
                                <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-3 text-center">
                                    <p className="text-lg font-bold text-text-main dark:text-white">{school.class_count || 0}</p>
                                    <p className="text-xs text-text-secondary">Kelas</p>
                                </div>
                            </div>

                            {school.address && (
                                <p className="text-xs text-text-secondary truncate mb-2">📍 {school.address}</p>
                            )}
                            {school.email && (
                                <p className="text-xs text-text-secondary truncate">📧 {school.email}</p>
                            )}
                        </a>
                    ))}
                </div>
            )}
        </div>
    )
}
