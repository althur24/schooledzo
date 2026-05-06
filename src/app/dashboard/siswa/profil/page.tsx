'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader } from '@/components/ui'
import Card from '@/components/ui/Card'
import { User, Lock, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react'

export default function ProfilSiswaPage() {
    const { user } = useAuth()

    // Password Form State
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [showPassword, setShowPassword] = useState({ current: false, new: false, confirm: false })

    // Status State
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setSuccess('')

        if (newPassword.length < 6) {
            setError('Password baru minimal 6 karakter')
            return
        }

        if (newPassword !== confirmPassword) {
            setError('Konfirmasi password tidak cocok')
            return
        }

        if (currentPassword === newPassword) {
            setError('Password baru tidak boleh sama dengan password lama')
            return
        }

        setLoading(true)
        try {
            const res = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
            })

            const data = await res.json()

            if (!res.ok) {
                setError(data.error || 'Gagal mengubah password')
                setLoading(false)
                return
            }

            setSuccess('Password berhasil diperbarui!')
            setCurrentPassword('')
            setNewPassword('')
            setConfirmPassword('')

            // Clear success message after 5 seconds
            setTimeout(() => setSuccess(''), 5000)

        } catch (err) {
            setError('Terjadi kesalahan jaringan')
        } finally {
            setLoading(false)
        }
    }

    if (!user) return null

    return (
        <div className="space-y-6">
            <PageHeader
                title="Profil Saya"
                subtitle="Kelola informasi akun dan keamanan Anda"
                icon={<div className="text-violet-500"><User className="w-6 h-6" /></div>}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">

                {/* Info Card */}
                <div className="lg:col-span-1 border-none shadow-none">
                    <Card className="p-6">
                        <div className="text-center mb-6">
                            <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-3xl font-bold shadow-lg shadow-violet-500/30 mx-auto mb-4">
                                {user.full_name?.[0] || user.username?.[0] || '?'}
                            </div>
                            <h2 className="text-xl font-bold text-slate-800 dark:text-white">{user.full_name}</h2>
                            <p className="text-emerald-500 font-medium text-sm mt-1">{user.role}</p>
                        </div>

                        <div className="space-y-4">
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
                                <p className="text-xs text-text-secondary mb-1">Username Login (NIS)</p>
                                <p className="font-mono font-medium text-slate-800 dark:text-slate-200">{user.username}</p>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* Password Form Card */}
                <div className="lg:col-span-2">
                    <Card className="p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                                <Lock className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Ubah Password</h3>
                                <p className="text-sm text-text-secondary">Pastikan akun Anda tetap aman dengan password yang kuat</p>
                            </div>
                        </div>

                        {error && (
                            <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30 text-sm flex gap-3">
                                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {success && (
                            <div className="mb-6 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/10 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30 text-sm flex gap-3">
                                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                                <span>{success}</span>
                            </div>
                        )}

                        <form onSubmit={handlePasswordChange} className="space-y-5 max-w-md">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5 ml-1">
                                    Password Saat Ini
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword.current ? "text" : "password"}
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm"
                                        placeholder="Masukkan password saat ini"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword({ ...showPassword, current: !showPassword.current })}
                                        className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 hover:text-emerald-500"
                                    >
                                        {showPassword.current ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5 ml-1">
                                    Password Baru
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword.new ? "text" : "password"}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        minLength={6}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm"
                                        placeholder="Minimal 6 karakter"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword({ ...showPassword, new: !showPassword.new })}
                                        className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 hover:text-emerald-500"
                                    >
                                        {showPassword.new ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5 ml-1">
                                    Konfirmasi Password Baru
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword.confirm ? "text" : "password"}
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        minLength={6}
                                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm"
                                        placeholder="Ketik ulang password baru"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword({ ...showPassword, confirm: !showPassword.confirm })}
                                        className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 hover:text-emerald-500"
                                    >
                                        {showPassword.confirm ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-3 px-6 mt-6 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Menyimpan...' : 'Perbarui Password'}
                            </button>
                        </form>
                    </Card>
                </div>
            </div>
        </div>
    )
}
