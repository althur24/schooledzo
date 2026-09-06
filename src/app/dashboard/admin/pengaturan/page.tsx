'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { Toast } from '@/components/ui/Toast'
import { useSchoolLabels, useSchoolLabelsRefresh } from '@/contexts/LabelsContext'
import { DEFAULT_MENU_LABELS, MAX_MENU_LABEL_LENGTH, MENU_LABEL_KEYS, MenuLabels } from '@/lib/labels'
import { Setting } from 'react-iconly'

/**
 * Pengaturan sekolah — ADMIN only.
 *
 * 1. Nama Menu: kustomisasi istilah "Tugas", "Kuis", "Ulangan", "UTS", "UAS"
 *    per sekolah. Hanya mengubah TEKS tampilan (navigasi, judul halaman, tab
 *    nilai, notifikasi) — nilai di database tetap canonical. Kosongkan input
 *    untuk kembali ke default.
 * 2. Fitur: toggle AI Review, Tutorial Guru, Generate Soal AI (dipindah dari
 *    halaman utama dashboard admin).
 */

const LABEL_FIELDS: Array<{ key: keyof MenuLabels; description: string }> = [
    { key: 'tugas', description: 'Menu navigasi & judul halaman tugas' },
    { key: 'kuis', description: 'Menu navigasi & judul halaman kuis' },
    { key: 'ulangan', description: 'Menu navigasi & judul halaman ulangan harian' },
    { key: 'uts', description: 'Sebutan ujian tengah semester' },
    { key: 'uas', description: 'Sebutan ujian akhir semester' },
]

const FIELD_LABELS: Record<keyof MenuLabels, string> = {
    tugas: 'Tugas',
    kuis: 'Kuis',
    ulangan: 'Ulangan',
    uts: 'UTS',
    uas: 'UAS',
}

type ToastState = { message: string; type: 'success' | 'error' } | null

export default function AdminPengaturanPage() {
    const { user } = useAuth()
    const router = useRouter()
    const activeLabels = useSchoolLabels()
    const refreshLabels = useSchoolLabelsRefresh()

    const [form, setForm] = useState<MenuLabels>(DEFAULT_MENU_LABELS)
    const [saving, setSaving] = useState(false)
    const [loaded, setLoaded] = useState(false)
    const [toast, setToast] = useState<ToastState>(null)

    const [aiReviewEnabled, setAiReviewEnabled] = useState(true)
    const [aiToggleLoading, setAiToggleLoading] = useState(false)
    const [tutorialEnabled, setTutorialEnabled] = useState(false)
    const [tutorialToggleLoading, setTutorialToggleLoading] = useState(false)
    const [aiGenerateEnabled, setAiGenerateEnabled] = useState(false)
    const [aiGenerateToggleLoading, setAiGenerateToggleLoading] = useState(false)

    useEffect(() => {
        if (user && user.role !== 'ADMIN') {
            router.replace('/dashboard')
        }
    }, [user, router])

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await fetch('/api/school-settings')
                if (res.ok) {
                    const data = await res.json()
                    setForm({ ...DEFAULT_MENU_LABELS, ...data.menu_labels })
                    setAiReviewEnabled(data.ai_review_enabled !== false)
                    setTutorialEnabled(data.tutorial_enabled === true)
                    setAiGenerateEnabled(data.ai_generate_enabled === true)
                }
            } catch (err) {
                console.error('Error fetching settings:', err)
            } finally {
                setLoaded(true)
            }
        }
        if (user) fetchSettings()
    }, [user])

    const handleSaveLabels = async () => {
        setSaving(true)
        try {
            const res = await fetch('/api/school-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    menu_labels: {
                        tugas: form.tugas,
                        kuis: form.kuis,
                        ulangan: form.ulangan,
                        uts: form.uts,
                        uas: form.uas,
                    }
                })
            })
            const data = await res.json()
            if (res.ok) {
                setForm({ ...DEFAULT_MENU_LABELS, ...data.menu_labels })
                await refreshLabels()
                setToast({ message: 'Nama menu berhasil disimpan', type: 'success' })
            } else {
                setToast({ message: data.error || 'Gagal menyimpan pengaturan', type: 'error' })
            }
        } catch (err) {
            console.error('Error saving menu labels:', err)
            setToast({ message: 'Gagal menyimpan pengaturan', type: 'error' })
        } finally {
            setSaving(false)
        }
    }

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

    const handleToggleTutorial = async () => {
        setTutorialToggleLoading(true)
        try {
            const res = await fetch('/api/school-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tutorial_enabled: !tutorialEnabled })
            })
            if (res.ok) {
                setTutorialEnabled(!tutorialEnabled)
            }
        } catch (err) {
            console.error('Error toggling tutorial:', err)
        } finally {
            setTutorialToggleLoading(false)
        }
    }

    const handleToggleAIGenerate = async () => {
        setAiGenerateToggleLoading(true)
        try {
            const res = await fetch('/api/school-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ai_generate_enabled: !aiGenerateEnabled })
            })
            if (res.ok) {
                setAiGenerateEnabled(!aiGenerateEnabled)
            }
        } catch (err) {
            console.error('Error toggling AI generate:', err)
        } finally {
            setAiGenerateToggleLoading(false)
        }
    }

    const inputClass = "w-full px-4 py-3 rounded-xl border border-[#E8F0E6] dark:border-zinc-700 bg-white dark:bg-zinc-800 text-text-main dark:text-white placeholder-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"

    return (
        <div className="space-y-8">
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}

            <PageHeader
                title="Pengaturan"
                subtitle="Kustomisasi istilah & fitur untuk sekolah Anda"
                icon={<Setting set="bold" primaryColor="currentColor" size={24} />}
            />

            {/* Section: Nama Menu */}
            <div className="bg-white dark:bg-surface-dark rounded-2xl border border-slate-200 dark:border-primary/10 p-6">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-1">🏷️ Nama Menu</h2>
                <p className="text-sm text-slate-500 dark:text-zinc-400 mb-6">
                    Ubah istilah yang dipakai di seluruh aplikasi — menu navigasi siswa &amp; guru, judul halaman,
                    tab nilai, dan notifikasi. Kosongkan untuk kembali ke default.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {LABEL_FIELDS.map(({ key, description }) => (
                        <div key={key}>
                            <label htmlFor={`label-${key}`} className="block text-sm font-bold text-slate-700 dark:text-zinc-300 mb-1.5">
                                Default: &quot;{DEFAULT_MENU_LABELS[key]}&quot;
                                {activeLabels[key] !== DEFAULT_MENU_LABELS[key] && (
                                    <span className="ml-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                        Aktif: &quot;{activeLabels[key]}&quot;
                                    </span>
                                )}
                            </label>
                            <input
                                id={`label-${key}`}
                                type="text"
                                value={form[key]}
                                maxLength={MAX_MENU_LABEL_LENGTH}
                                placeholder={DEFAULT_MENU_LABELS[key]}
                                onChange={(e) => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                                className={inputClass}
                            />
                            <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1.5">
                                {description} • maks. {MAX_MENU_LABEL_LENGTH} karakter
                            </p>
                        </div>
                    ))}
                </div>

                <div className="flex items-center gap-3 mt-6">
                    <button
                        onClick={handleSaveLabels}
                        disabled={saving || !loaded}
                        className="px-5 py-2.5 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving ? 'Menyimpan...' : 'Simpan Nama Menu'}
                    </button>
                    <button
                        onClick={() => setForm(DEFAULT_MENU_LABELS)}
                        disabled={saving}
                        className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-text-secondary dark:text-zinc-300 font-bold text-sm hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                    >
                        Kembalikan Form ke Default
                    </button>
                </div>
            </div>

            {/* Section: Fitur */}
            <div className="bg-white dark:bg-surface-dark rounded-2xl border border-slate-200 dark:border-primary/10 p-6">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4">⚙️ Pengaturan Fitur</h2>

                {/* AI Review Toggle */}
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

                {/* Tutorial Toggle */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-700 mt-3">
                    <div className="flex-1">
                        <p className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            🎓 Tutorial Guru
                        </p>
                        <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
                            {tutorialEnabled
                                ? 'Guru dapat mengakses tutorial interaktif untuk mempelajari fitur-fitur aplikasi.'
                                : 'Tutorial interaktif untuk guru dinonaktifkan.'}
                        </p>
                    </div>
                    <button
                        onClick={handleToggleTutorial}
                        disabled={tutorialToggleLoading}
                        className={`relative ml-4 w-14 h-7 rounded-full transition-all duration-300 flex-shrink-0 ${tutorialEnabled
                                ? 'bg-emerald-500 hover:bg-emerald-600'
                                : 'bg-slate-300 dark:bg-zinc-600 hover:bg-slate-400'
                            } ${tutorialToggleLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                        <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300 ${tutorialEnabled ? 'translate-x-7' : 'translate-x-0'
                            }`} />
                    </button>
                </div>

                {/* Generate Soal AI Toggle */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-700 mt-3">
                    <div className="flex-1">
                        <p className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            ✨ Generate Soal AI
                        </p>
                        <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
                            {aiGenerateEnabled
                                ? 'Guru dapat membuat soal otomatis dari materi melalui tab "Generate AI" di Rapih AI.'
                                : 'Tab "Generate AI" di Rapih AI disembunyikan dari guru. Rapikan Soal & Upload Dokumen tetap tersedia.'}
                        </p>
                    </div>
                    <button
                        onClick={handleToggleAIGenerate}
                        disabled={aiGenerateToggleLoading}
                        className={`relative ml-4 w-14 h-7 rounded-full transition-all duration-300 flex-shrink-0 ${aiGenerateEnabled
                                ? 'bg-emerald-500 hover:bg-emerald-600'
                                : 'bg-slate-300 dark:bg-zinc-600 hover:bg-slate-400'
                            } ${aiGenerateToggleLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                        <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300 ${aiGenerateEnabled ? 'translate-x-7' : 'translate-x-0'
                            }`} />
                    </button>
                </div>
            </div>
        </div>
    )
}
