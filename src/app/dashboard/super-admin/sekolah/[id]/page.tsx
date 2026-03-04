'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface SchoolDetail {
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
    settings: Record<string, unknown>
    student_count: number
    teacher_count: number
    class_count: number
}

export default function SekolahDetailPage() {
    const params = useParams()
    const router = useRouter()
    const schoolId = params.id as string
    const [school, setSchool] = useState<SchoolDetail | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const fetchSchool = async () => {
            try {
                const res = await fetch(`/api/schools/${schoolId}`)
                if (res.ok) {
                    const data = await res.json()
                    setSchool(data)
                } else {
                    router.push('/dashboard/super-admin/sekolah')
                }
            } catch (err) {
                console.error('Failed to fetch school:', err)
            } finally {
                setLoading(false)
            }
        }
        fetchSchool()
    }, [schoolId, router])

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <svg className="animate-spin w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            </div>
        )
    }

    if (!school) {
        return (
            <div className="text-center py-20 text-text-secondary">
                Sekolah tidak ditemukan
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Back + Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={() => router.back()}
                    className="p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl transition-colors"
                >
                    <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold text-text-main dark:text-white">{school.name}</h1>
                    <p className="text-text-secondary text-sm">{school.code} • {school.school_level || '-'}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${school.is_active
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                    {school.is_active ? 'Aktif' : 'Nonaktif'}
                </span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
                <StatCard label="Siswa" value={school.student_count} max={school.max_students} icon="👨‍🎓" />
                <StatCard label="Guru" value={school.teacher_count} max={school.max_teachers} icon="👩‍🏫" />
                <StatCard label="Kelas" value={school.class_count} icon="📚" />
            </div>

            {/* Info Card */}
            <div className="bg-white dark:bg-surface-dark rounded-2xl border border-[#E8F0E6] dark:border-primary/10 p-6 space-y-4">
                <h2 className="text-lg font-bold text-text-main dark:text-white">Informasi Sekolah</h2>

                <div className="grid gap-4 md:grid-cols-2">
                    <InfoRow label="Alamat" value={school.address} icon="📍" />
                    <InfoRow label="Email" value={school.email} icon="📧" />
                    <InfoRow label="Telepon" value={school.phone} icon="📞" />
                    <InfoRow label="Jenjang" value={school.school_level} icon="🏫" />
                    <InfoRow label="Maks. Siswa" value={school.max_students?.toString()} icon="👥" />
                    <InfoRow label="Maks. Guru" value={school.max_teachers?.toString()} icon="👤" />
                    <InfoRow label="Terdaftar" value={new Date(school.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} icon="📅" />
                </div>
            </div>
        </div>
    )
}

function StatCard({ label, value, max, icon }: { label: string; value: number; max?: number; icon: string }) {
    const percentage = max ? Math.min((value / max) * 100, 100) : null

    return (
        <div className="bg-white dark:bg-surface-dark rounded-2xl border border-[#E8F0E6] dark:border-primary/10 p-5">
            <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{icon}</span>
                <span className="text-sm text-text-secondary font-medium">{label}</span>
            </div>
            <p className="text-2xl font-bold text-text-main dark:text-white">
                {value.toLocaleString()}
                {max && <span className="text-sm font-normal text-text-secondary"> / {max.toLocaleString()}</span>}
            </p>
            {percentage !== null && (
                <div className="mt-2 h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all ${percentage > 90 ? 'bg-red-500' : percentage > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${percentage}%` }}
                    />
                </div>
            )}
        </div>
    )
}

function InfoRow({ label, value, icon }: { label: string; value: string | null | undefined; icon: string }) {
    return (
        <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
            <span className="text-base mt-0.5">{icon}</span>
            <div>
                <p className="text-xs text-text-secondary font-medium">{label}</p>
                <p className="text-sm text-text-main dark:text-white font-medium">{value || '-'}</p>
            </div>
        </div>
    )
}
