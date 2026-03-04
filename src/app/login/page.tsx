'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

interface SchoolOption {
    id: string
    name: string
    code: string
    logo_url: string | null
}

export default function LoginPage() {
    const router = useRouter()
    const { login } = useAuth()
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    // School selector state
    const [schools, setSchools] = useState<SchoolOption[]>([])
    const [selectedSchoolId, setSelectedSchoolId] = useState<string>('')
    const [isSuperAdmin, setIsSuperAdmin] = useState(false)
    const [schoolsLoading, setSchoolsLoading] = useState(true)

    // Fetch available schools on mount
    useEffect(() => {
        const fetchSchools = async () => {
            try {
                const res = await fetch('/api/schools/public')
                if (res.ok) {
                    const data = await res.json()
                    setSchools(data)
                    if (data.length === 1) {
                        setSelectedSchoolId(data[0].id)
                    }
                }
            } catch (err) {
                console.error('Failed to fetch schools:', err)
            } finally {
                setSchoolsLoading(false)
            }
        }
        fetchSchools()
    }, [])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        // Super Admin logs in without school_id
        const schoolId = isSuperAdmin ? undefined : selectedSchoolId || undefined
        const result = await login(username, password, schoolId)

        if (result.success) {
            router.push('/dashboard')
            router.refresh()
        } else {
            setError(result.error || 'Login gagal')
        }

        setLoading(false)
    }

    return (
        <div className="min-h-screen flex items-center justify-center overflow-hidden relative p-4" style={{
            backgroundColor: '#E0F7FA',
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='120' height='120' viewBox='0 0 120 120' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cpath d='M10 10h16v20H10V10zm2 2v16h12V12H12z' fill='%2300C885' fill-opacity='0.25'/%3E%3Cpath d='M14 16h8v2h-8v-2zm0 4h8v2h-8v-2zm0 4h6v2h-6v-2z' fill='%2300C885' fill-opacity='0.3'/%3E%3Cpath d='M40 70l15-15 4 4-15 15z' fill='%2326A69A' fill-opacity='0.3'/%3E%3Cpath d='M58 58l-3 3-3-3 3-3 3 3z' fill='%2300C885' fill-opacity='0.4'/%3E%3Cpath d='M80 20h20v6H80v-6zm2 20h16v2H82v-2zm-12-8h40v2H70v-2z' fill='%234DB6AC' fill-opacity='0.2'/%3E%3Ccircle cx='90' cy='90' r='10' stroke='%2300C885' stroke-width='2' stroke-opacity='0.25'/%3E%3Cpath d='M100 100l-8-8' stroke='%2300C885' stroke-width='2' stroke-opacity='0.25'/%3E%3Cpath d='M20 90h20v4H20v-4zm0-10h20v4H20v-4zm-4-10h28v30H16V70z' fill='%2380CBC4' fill-opacity='0.2'/%3E%3Cpath d='M50 10l5 10h-10z' fill='%23009688' fill-opacity='0.2'/%3E%3Cpath d='M60 40h20v4H60v-4z' fill='%2300C885' fill-opacity='0.15' transform='rotate(-45 70 42)'/%3E%3C/g%3E%3C/svg%3E")`
        }}>
            <div className="relative w-full max-w-md">
                {/* Subtle glow behind card */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-emerald-400/20 rounded-full blur-3xl pointer-events-none"></div>
                <div className="relative bg-white/95 dark:bg-surface-dark/95 backdrop-blur-xl border border-white/50 dark:border-white/5 rounded-3xl shadow-2xl shadow-slate-300/50 dark:shadow-none p-8 sm:p-10 ring-1 ring-black/5">
                    {/* Logo/Title */}
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl overflow-hidden mb-6 shadow-lg shadow-emerald-500/20 ring-4 ring-white dark:ring-surface-dark transform rotate-3 hover:rotate-6 transition-transform">
                            <img src="/logoedzo.png" alt="EDZO Logo" className="w-full h-full object-cover" />
                        </div>
                        <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-2 tracking-tight">LMS Sekolah</h1>
                        <p className="text-slate-500 dark:text-slate-400">Selamat datang kembali!</p>
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="mb-6 p-4 rounded-xl bg-red-50 text-red-600 border border-red-100 text-sm flex items-center gap-3 animate-pulse">
                            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            <span className="font-medium">{error}</span>
                        </div>
                    )}

                    {/* Login Form */}
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* School Selector */}
                        {!isSuperAdmin && (
                            <div>
                                <label className="block text-sm font-bold text-slate-700 dark:text-white mb-2 ml-1">
                                    Sekolah
                                </label>
                                <div className="relative group">
                                    <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                        </svg>
                                    </span>
                                    {schoolsLoading ? (
                                        <div className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-400 font-medium text-sm">
                                            Memuat daftar sekolah...
                                        </div>
                                    ) : schools.length === 0 ? (
                                        <div className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-400 font-medium text-sm">
                                            Belum ada sekolah terdaftar
                                        </div>
                                    ) : (
                                        <select
                                            value={selectedSchoolId}
                                            onChange={(e) => setSelectedSchoolId(e.target.value)}
                                            className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium appearance-none cursor-pointer"
                                            required
                                        >
                                            <option value="">— Pilih Sekolah —</option>
                                            {schools.map((school) => (
                                                <option key={school.id} value={school.id}>
                                                    {school.name}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Username */}
                        <div>
                            <label className="block text-sm font-bold text-slate-700 dark:text-white mb-2 ml-1">
                                Username
                            </label>
                            <div className="relative group">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                </span>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                                    placeholder="Masukkan username Anda"
                                    required
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div>
                            <label className="block text-sm font-bold text-slate-700 dark:text-white mb-2 ml-1">
                                Password
                            </label>
                            <div className="relative group">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                </span>
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-12 pr-12 py-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                                    placeholder="Masukkan password Anda"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 hover:text-emerald-500 transition-colors"
                                >
                                    {showPassword ? (
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                        </svg>
                                    ) : (
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                        </svg>
                                    )}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading || (!isSuperAdmin && !selectedSchoolId && schools.length > 0)}
                            className="w-full py-4 px-6 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 transition-all duration-300 transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                        >
                            {loading ? (
                                <>
                                    <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Memverifikasi...
                                </>
                            ) : (
                                <>
                                    <span>Masuk ke Dashboard</span>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                                    </svg>
                                </>
                            )}
                        </button>
                    </form>

                    {/* Footer */}
                    <div className="mt-6 space-y-3">
                        <p className="text-center text-sm text-slate-500">
                            Lupa password? <a href="#" className="font-bold text-emerald-500 hover:underline">Hubungi Admin</a>
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                setIsSuperAdmin(!isSuperAdmin)
                                setSelectedSchoolId('')
                                setError('')
                            }}
                            className="w-full text-center text-xs text-slate-400 hover:text-emerald-500 transition-colors cursor-pointer py-1"
                        >
                            {isSuperAdmin ? '← Kembali ke login sekolah' : 'Login sebagai Super Admin →'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
