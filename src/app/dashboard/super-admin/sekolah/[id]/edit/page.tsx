'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function EditSekolahPage() {
    const params = useParams()
    const router = useRouter()
    const schoolId = params.id as string
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [originalCode, setOriginalCode] = useState('')
    const [logoUrl, setLogoUrl] = useState<string | null>(null)
    const [logoUploading, setLogoUploading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [form, setForm] = useState({
        name: '',
        code: '',
        address: '',
        phone: '',
        email: '',
        school_level: 'BOTH',
        max_students: 500,
        max_teachers: 50,
        is_active: true,
    })

    useEffect(() => {
        const fetchSchool = async () => {
            try {
                const res = await fetch(`/api/schools/${schoolId}`)
                if (res.ok) {
                    const data = await res.json()
                    setForm({
                        name: data.name || '',
                        code: (data.code || '').toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                        address: data.address || '',
                        phone: data.phone || '',
                        email: data.email || '',
                        school_level: data.school_level || 'BOTH',
                        max_students: data.max_students || 500,
                        max_teachers: data.max_teachers || 50,
                        is_active: data.is_active ?? true,
                    })
                    setOriginalCode((data.code || '').toLowerCase().replace(/[^a-z0-9-]/g, '-'))
                    setLogoUrl(data.logo_url || null)
                } else {
                    router.push('/dashboard/super-admin/sekolah')
                }
            } catch {
                setError('Gagal memuat data sekolah')
            } finally {
                setLoading(false)
            }
        }
        fetchSchool()
    }, [schoolId, router])

    const handleSubmit = async () => {
        if (!form.name || !form.code || saving) return

        // Jika kode berubah, tampilkan konfirmasi native browser
        if (form.code !== originalCode) {
            const confirmed = window.confirm(
                `⚠️ PERINGATAN: Anda mengubah kode sekolah dari "${originalCode}" menjadi "${form.code}".\n\nDampak:\n• Semua username guru, siswa, dan orang tua akan otomatis diubah.\n• Pengguna harus login menggunakan username baru.\n\nLanjutkan?`
            )
            if (!confirmed) return
        }

        setError('')
        setSuccess('')
        setSaving(true)

        try {
            const res = await fetch(`/api/schools/${schoolId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form)
            })

            const data = await res.json()

            if (!res.ok) {
                setError(data.error || 'Gagal menyimpan perubahan')
            } else {
                if (data.updated_usernames !== undefined && form.code !== originalCode) {
                    setSuccess(`Perubahan berhasil disimpan! ${data.updated_usernames} username akun telah otomatis disesuaikan.`)
                } else {
                    setSuccess('Perubahan berhasil disimpan!')
                }
                setTimeout(() => router.push(`/dashboard/super-admin/sekolah/${schoolId}`), 2000)
            }
        } catch {
            setError('Terjadi kesalahan server')
        }

        setSaving(false)
    }

    const updateForm = (field: string, value: string | number | boolean) => {
        setForm(prev => ({ ...prev, [field]: value }))
    }

    const handleLogoUpload = async (file: File) => {
        setLogoUploading(true)
        setError('')

        try {
            const formData = new FormData()
            formData.append('logo', file)

            const res = await fetch(`/api/schools/${schoolId}/logo`, {
                method: 'POST',
                body: formData
            })

            const data = await res.json()

            if (!res.ok) {
                setError(data.error || 'Gagal upload logo')
            } else {
                setLogoUrl(data.logo_url)
                setSuccess('Logo berhasil diupload!')
                setTimeout(() => setSuccess(''), 3000)
            }
        } catch {
            setError('Gagal upload logo')
        }

        setLogoUploading(false)
    }

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

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={() => router.back()}
                    className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <div>
                    <h1 className="text-2xl font-bold text-text-main dark:text-white">Edit Sekolah</h1>
                    <p className="text-sm text-text-secondary">{form.name}</p>
                </div>
            </div>

            {/* Messages */}
            {error && (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 text-sm font-medium">
                    {error}
                </div>
            )}
            {success && (
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 text-sm font-medium">
                    ✅ {success}
                </div>
            )}

            {/* Form */}
            <div className="bg-white dark:bg-surface-dark rounded-2xl border border-[#E8F0E6] dark:border-primary/10 p-6 space-y-5">
                {/* Status Toggle */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-white/5">
                    <div>
                        <p className="font-bold text-text-main dark:text-white">Status Sekolah</p>
                        <p className="text-xs text-text-secondary">Nonaktifkan jika sekolah tidak lagi berlangganan</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => updateForm('is_active', !form.is_active)}
                        className={`relative w-12 h-6 rounded-full transition-colors ${form.is_active ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                    >
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.is_active ? 'left-6' : 'left-0.5'}`} />
                    </button>
                </div>

                {/* Logo Upload */}
                <div>
                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Logo Sekolah</label>
                    <div className="flex items-center gap-5">
                        {/* Preview */}
                        <div className="flex-shrink-0 w-24 h-24 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-700 border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center overflow-hidden">
                            {logoUrl ? (
                                <img src={logoUrl} alt="Logo" className="w-full h-full object-contain p-2" />
                            ) : (
                                <span className="text-3xl">🏫</span>
                            )}
                        </div>
                        {/* Upload */}
                        <div className="flex-1">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                                className="hidden"
                                onChange={e => {
                                    const file = e.target.files?.[0]
                                    if (file) handleLogoUpload(file)
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={logoUploading}
                                className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-text-main dark:text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
                            >
                                {logoUploading ? 'Mengupload...' : logoUrl ? '🔄 Ganti Logo' : '📤 Upload Logo'}
                            </button>
                            <p className="text-xs text-text-secondary mt-1.5">PNG, JPG, WebP, SVG • Maks 2MB</p>
                        </div>
                    </div>
                </div>

                {/* Nama */}
                <div>
                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Nama Sekolah *</label>
                    <input
                        type="text"
                        value={form.name}
                        onChange={e => updateForm('name', e.target.value)}
                        required
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                </div>

                {/* Kode */}
                <div>
                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kode Sekolah *</label>
                    <input
                        type="text"
                        value={form.code}
                        onChange={e => updateForm('code', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                        required
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all font-mono"
                    />
                </div>

                {/* 2 columns */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jenjang</label>
                        <select
                            value={form.school_level}
                            onChange={e => updateForm('school_level', e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        >
                            <option value="SMP">SMP</option>
                            <option value="SMA">SMA/SMK</option>
                            <option value="BOTH">SMP + SMA</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Telepon</label>
                        <input
                            type="text"
                            value={form.phone}
                            onChange={e => updateForm('phone', e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        />
                    </div>
                </div>

                {/* Email */}
                <div>
                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Email</label>
                    <input
                        type="email"
                        value={form.email}
                        onChange={e => updateForm('email', e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                </div>

                {/* Alamat */}
                <div>
                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Alamat</label>
                    <textarea
                        value={form.address}
                        onChange={e => updateForm('address', e.target.value)}
                        rows={2}
                        className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none"
                    />
                </div>

                {/* Kuota */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Maks Siswa</label>
                        <input
                            type="number"
                            value={form.max_students}
                            onChange={e => updateForm('max_students', parseInt(e.target.value) || 0)}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Maks Guru</label>
                        <input
                            type="number"
                            value={form.max_teachers}
                            onChange={e => updateForm('max_teachers', parseInt(e.target.value) || 0)}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        />
                    </div>
                </div>

                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={saving || !form.name || !form.code}
                    className="w-full py-3 px-6 bg-primary hover:bg-primary-dark text-white font-bold rounded-xl shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {saving ? (
                        <>
                            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Menyimpan...
                        </>
                    ) : (
                        '💾 Simpan Perubahan'
                    )}
                </button>
            </div>
        </div>
    )
}
