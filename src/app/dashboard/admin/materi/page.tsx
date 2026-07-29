'use client'

import { useEffect, useState } from 'react'
import { Modal, Button, EmptyState, PageHeader, Toast, type ToastType } from '@/components/ui'
import Card from '@/components/ui/Card'
import ClassChipsSelector from '@/components/ClassChipsSelector'
import { Document as BookOpen, User, Delete as Trash2, Video, Paper as FileText, Plus, Download, TickSquare as CheckCircle } from 'react-iconly'
import { Loader2, Search, CheckSquare } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
    formatToOfflineMaterial,
    saveMaterialOffline,
    getAllOfflineMaterials,
    removeMaterialOffline
} from '@/lib/offlineMateri'

interface Teacher {
    id: string
    nip: string | null
    user: { id: string; username: string; full_name: string | null }
}

interface Assignment {
    id: string
    teacher_id: string
    subject: { id: string; name: string } | null
    class: { id: string; name: string } | null
}

interface Material {
    id: string
    title: string
    description: string | null
    type: string
    content_url: string | null
    content_text: string | null
    created_at: string
    teaching_assignment: {
        id: string
        teacher: { id: string; user: { full_name: string } } | null
        subject: { id: string; name: string } | null
        class: { name: string } | null
    } | null
}

export default function AdminMateriPage() {
    const [teachers, setTeachers] = useState<Teacher[]>([])
    const [assignments, setAssignments] = useState<Assignment[]>([])
    const [materials, setMaterials] = useState<Material[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null)

    // Add material modal
    const [showModal, setShowModal] = useState(false)
    const [formTeacherId, setFormTeacherId] = useState('')
    const [formData, setFormData] = useState({
        teaching_assignment_ids: [] as string[],
        title: '',
        description: '',
        type: 'TEXT',
        content_url: '',
        content_text: ''
    })
    const [file, setFile] = useState<File | null>(null)
    const [videoSource, setVideoSource] = useState<'UPLOAD' | 'YOUTUBE'>('YOUTUBE')
    const [saving, setSaving] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)

    const [deleteTarget, setDeleteTarget] = useState<Material | null>(null)
    const [deleting, setDeleting] = useState(false)
    const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)
    const [successInfo, setSuccessInfo] = useState<{ title: string; classCount: number } | null>(null)

    // Offline Mode (simpan materi ke perangkat)
    const [savedMaterials, setSavedMaterials] = useState<Set<string>>(new Set())
    const [savingStates, setSavingStates] = useState<Record<string, boolean>>({})

    useEffect(() => {
        const loadSaved = async () => {
            const saved = await getAllOfflineMaterials()
            setSavedMaterials(new Set(saved.map(m => m.id)))
        }
        loadSaved()
    }, [])

    const handleToggleOffline = async (material: Material) => {
        const isSaved = savedMaterials.has(material.id)
        if (isSaved) {
            await removeMaterialOffline(material.id)
            setSavedMaterials(prev => { const next = new Set(prev); next.delete(material.id); return next })
            return
        }
        setSavingStates(prev => ({ ...prev, [material.id]: true }))
        try {
            const isPdf = material.type === 'PDF' && material.content_url
            const offlineData = formatToOfflineMaterial(
                material,
                material.teaching_assignment?.subject?.name || 'Lainnya',
                material.teaching_assignment?.class?.name || '',
                !!isPdf
            )
            let blob: Blob | undefined
            if (isPdf && material.content_url) {
                const response = await fetch(material.content_url)
                if (!response.ok) throw new Error('Gagal mengambil file PDF')
                blob = await response.blob()
            }
            await saveMaterialOffline(offlineData, blob)
            setSavedMaterials(prev => { const next = new Set(prev); next.add(material.id); return next })
            setToast({ message: 'Materi disimpan ke perangkat', type: 'success' })
        } catch (error) {
            console.error('Save offline error:', error)
            setToast({ message: 'Gagal menyimpan materi offline', type: 'error' })
        } finally {
            setSavingStates(prev => ({ ...prev, [material.id]: false }))
        }
    }

    const fetchData = async () => {
        try {
            const [teachersRes, assignmentsRes, materialsRes] = await Promise.all([
                fetch('/api/teachers'),
                fetch('/api/teaching-assignments'),
                fetch('/api/materials')
            ])
            const [teachersData, assignmentsData, materialsData] = await Promise.all([
                teachersRes.json(),
                assignmentsRes.json(),
                materialsRes.json()
            ])
            setTeachers(Array.isArray(teachersData) ? teachersData : [])
            setAssignments(Array.isArray(assignmentsData) ? assignmentsData : [])
            setMaterials(Array.isArray(materialsData) ? materialsData : [])
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchData() }, [])

    const materialCountFor = (teacherId: string) =>
        materials.filter(m => m.teaching_assignment?.teacher?.id === teacherId).length

    const subjectsFor = (teacherId: string) => {
        const names = new Set<string>()
        assignments.forEach(a => {
            if (a.teacher_id === teacherId && a.subject?.name) names.add(a.subject.name)
        })
        return [...names]
    }

    const filteredTeachers = teachers
        .filter(t => {
            if (!searchQuery.trim()) return true
            const q = searchQuery.toLowerCase()
            return (t.user.full_name || '').toLowerCase().includes(q) || t.user.username.toLowerCase().includes(q)
        })
        .sort((a, b) => (a.user.full_name || a.user.username).localeCompare(b.user.full_name || b.user.username))

    const teacherMaterials = selectedTeacher
        ? materials.filter(m => m.teaching_assignment?.teacher?.id === selectedTeacher.id)
        : []

    const formAssignments = assignments.filter(a => a.teacher_id === formTeacherId)

    const resetForm = () => {
        setFormTeacherId('')
        setFormData({ teaching_assignment_ids: [], title: '', description: '', type: 'TEXT', content_url: '', content_text: '' })
        setFile(null)
        setVideoSource('YOUTUBE')
    }

    const uploadFile = async (file: File, onProgress: (percent: number) => void): Promise<{ url: string }> => {
        const signRes = await fetch('/api/materials/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, contentType: file.type })
        })

        if (!signRes.ok) {
            const err = await signRes.json()
            throw new Error(err.error || 'Gagal mendapatkan token upload')
        }

        const { path, token } = await signRes.json()

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
            const uploadUrl = `${supabaseUrl}/storage/v1/object/upload/sign/materials/${path}?token=${token}`

            xhr.open('PUT', uploadUrl)
            xhr.setRequestHeader('Content-Type', file.type)

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    onProgress(Math.round((event.loaded / event.total) * 100))
                }
            }

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    const { data: { publicUrl } } = supabase.storage.from('materials').getPublicUrl(path)
                    resolve({ url: publicUrl })
                } else {
                    reject(new Error(`Upload gagal (status ${xhr.status})`))
                }
            }

            xhr.onerror = () => reject(new Error('Masalah jaringan saat upload'))
            xhr.send(file)
        })
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!formTeacherId) {
            setToast({ message: 'Pilih guru terlebih dahulu', type: 'error' })
            return
        }
        if (formData.teaching_assignment_ids.length === 0) {
            setToast({ message: 'Pilih minimal 1 kelas tujuan', type: 'error' })
            return
        }

        setShowModal(false)
        setSaving(true)
        setUploadProgress(0)

        try {
            let finalContentUrl = formData.content_url

            if (formData.type === 'PDF' && file) {
                const { url } = await uploadFile(file, setUploadProgress)
                finalContentUrl = url
            } else if (formData.type === 'VIDEO' && videoSource === 'UPLOAD' && file) {
                const { url } = await uploadFile(file, setUploadProgress)
                finalContentUrl = url
            }

            const res = await fetch('/api/materials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    content_url: finalContentUrl
                })
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Gagal menyimpan materi')

            const classCount = formData.teaching_assignment_ids.length
            setSuccessInfo({ title: formData.title, classCount })
            resetForm()
            fetchData()
        } catch (error: any) {
            setToast({ message: error.message, type: 'error' })
        } finally {
            setSaving(false)
            setUploadProgress(0)
        }
    }

    const confirmDelete = async () => {
        if (!deleteTarget) return
        setDeleting(true)
        try {
            const res = await fetch(`/api/materials/${deleteTarget.id}`, { method: 'DELETE' })
            if (!res.ok) throw new Error('Gagal menghapus materi')
            setToast({ message: 'Materi berhasil dihapus', type: 'success' })
            fetchData()
        } catch (error: any) {
            setToast({ message: error.message, type: 'error' })
        } finally {
            setDeleting(false)
            setDeleteTarget(null)
        }
    }

    const typeBadge = (type: string) => {
        const map: Record<string, { label: string; cls: string }> = {
            TEXT: { label: 'Teks', cls: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20' },
            PDF: { label: 'PDF', cls: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20' },
            VIDEO: { label: 'Video', cls: 'bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20' },
            LINK: { label: 'Link', cls: 'bg-cyan-50 text-cyan-600 border-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:border-cyan-500/20' },
        }
        const t = map[type] || { label: type, cls: 'bg-secondary/10 text-text-secondary border-secondary/20' }
        return <span className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-bold border ${t.cls}`}>{t.label}</span>
    }

    // ─── Detail view: one teacher's materials ───
    if (selectedTeacher) {
        return (
            <div className="space-y-6">
                <PageHeader
                    title={selectedTeacher.user.full_name || selectedTeacher.user.username}
                    subtitle={`${teacherMaterials.length} materi telah dibagikan`}
                    onBack={() => setSelectedTeacher(null)}
                    action={
                        <Button onClick={() => { resetForm(); setFormTeacherId(selectedTeacher.id); setShowModal(true) }} icon={
                            <div className="text-white"><Plus set="bold" primaryColor="currentColor" size={20} /></div>
                        }>
                            Tambah Materi
                        </Button>
                    }
                />

                {teacherMaterials.length === 0 ? (
                    <EmptyState
                        icon={<div className="text-secondary"><BookOpen set="bold" primaryColor="currentColor" size={48} /></div>}
                        title="Belum Ada Materi"
                        description="Guru ini belum membagikan materi apapun"
                        action={<Button onClick={() => { resetForm(); setFormTeacherId(selectedTeacher.id); setShowModal(true) }}>Bantu Input Materi</Button>}
                    />
                ) : (
                    <Card className="overflow-hidden p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-secondary/10 dark:bg-white/5 border-b border-secondary/20">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Judul</th>
                                        <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider whitespace-nowrap">Tipe</th>
                                        <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Mapel</th>
                                        <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Kelas</th>
                                        <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider whitespace-nowrap">Tanggal</th>
                                        <th className="px-6 py-4 text-right text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-secondary/20 dark:divide-white/5">
                                    {teacherMaterials.map((m) => (
                                        <tr key={m.id} className="hover:bg-secondary/5 transition-colors">
                                            <td className="px-6 py-4 font-bold text-text-main dark:text-white">{m.title}</td>
                                            <td className="px-6 py-4">{typeBadge(m.type)}</td>
                                            <td className="px-6 py-4 text-text-secondary">{m.teaching_assignment?.subject?.name || '-'}</td>
                                            <td className="px-6 py-4 text-text-secondary whitespace-nowrap">{m.teaching_assignment?.class?.name || '-'}</td>
                                            <td className="px-6 py-4 text-text-secondary text-sm whitespace-nowrap">
                                                {new Date(m.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    {(m.type === 'PDF' || m.type === 'TEXT') && (
                                                        <button
                                                            onClick={() => handleToggleOffline(m)}
                                                            disabled={savingStates[m.id]}
                                                            className={`w-8 h-8 rounded-lg inline-flex items-center justify-center transition-colors ${savedMaterials.has(m.id)
                                                                ? 'bg-green-500/10 text-green-600 hover:bg-red-500/10 hover:text-red-500'
                                                                : 'bg-secondary/10 text-text-secondary hover:bg-primary/10 hover:text-primary'}`}
                                                            title={savedMaterials.has(m.id) ? 'Tersimpan offline — klik untuk hapus' : 'Simpan offline'}
                                                            aria-label={savedMaterials.has(m.id) ? 'Hapus dari penyimpanan offline' : 'Simpan materi untuk offline'}
                                                        >
                                                            {savingStates[m.id]
                                                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                                                : savedMaterials.has(m.id)
                                                                    ? <CheckSquare className="w-4 h-4" />
                                                                    : <Download set="bold" primaryColor="currentColor" size={16} />}
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => setDeleteTarget(m)}
                                                        className="w-8 h-8 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500/20 inline-flex items-center justify-center transition-colors"
                                                        title="Hapus materi"
                                                        aria-label="Hapus materi"
                                                    >
                                                        <Trash2 set="bold" primaryColor="currentColor" size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                )}

                {renderModal()}
                {renderDeleteModal()}
                {renderOverlays()}
            </div>
        )
    }

    // ─── Main view: teacher cards ───
    return (
        <div className="space-y-6">
            <PageHeader
                title={`Materi${!loading ? ` (${materials.length})` : ''}`}
                subtitle="Materi yang dibagikan guru per mata pelajaran"
                backHref="/dashboard/admin"
                icon={<div className="text-teal-500"><BookOpen set="bold" primaryColor="currentColor" size={24} /></div>}
                action={
                    <Button onClick={() => { resetForm(); setShowModal(true) }} icon={
                        <div className="text-white"><Plus set="bold" primaryColor="currentColor" size={20} /></div>
                    }>
                        Tambah Materi
                    </Button>
                }
            />

            <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary">
                    <Search className="w-5 h-5 text-slate-400" />
                </div>
                <input
                    type="text"
                    placeholder="Cari nama guru..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 text-sm shadow-sm"
                />
            </div>

            {loading ? (
                <div className="p-12 flex justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : filteredTeachers.length === 0 ? (
                <EmptyState
                    icon={<div className="text-secondary"><User set="bold" primaryColor="currentColor" size={48} /></div>}
                    title={teachers.length === 0 ? 'Belum Ada Guru' : 'Guru tidak ditemukan'}
                    description={teachers.length === 0 ? 'Tambahkan guru terlebih dahulu' : `Tidak ada guru yang cocok dengan "${searchQuery}"`}
                />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredTeachers.map((t) => {
                        const count = materialCountFor(t.id)
                        const subjects = subjectsFor(t.id)
                        return (
                            <Card key={t.id} className="group cursor-pointer hover:border-primary/50 transition-all hover:scale-[1.01]">
                                <div onClick={() => setSelectedTeacher(t)}>
                                    <div className="flex items-center gap-4 mb-3">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 flex items-center justify-center text-white font-bold shadow-sm flex-shrink-0">
                                            {(t.user.full_name || t.user.username)[0]?.toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-bold text-text-main dark:text-white truncate group-hover:text-primary transition-colors">
                                                {t.user.full_name || t.user.username}
                                            </h3>
                                            <p className="text-xs text-text-secondary truncate">
                                                {subjects.length > 0 ? subjects.join(', ') : 'Belum ada mapel'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="border-t border-secondary/10 dark:border-white/5 pt-3 flex justify-between items-center text-sm">
                                        <span className={`font-bold ${count > 0 ? 'text-primary' : 'text-text-secondary'}`}>
                                            {count} materi
                                        </span>
                                        <span className="text-primary font-medium group-hover:underline text-xs">Lihat detail →</span>
                                    </div>
                                </div>
                            </Card>
                        )
                    })}
                </div>
            )}

            {renderModal()}
            {renderDeleteModal()}
            {renderOverlays()}
        </div>
    )

    // ─── Shared render helpers ───
    function renderModal() {
        return (
            <Modal
                open={showModal}
                onClose={() => setShowModal(false)}
                title="Tambah Materi (Bantu Guru)"
            >
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">1. Pilih Guru</label>
                        <div className="relative">
                            <select
                                value={formTeacherId}
                                onChange={(e) => {
                                    setFormTeacherId(e.target.value)
                                    setFormData({ ...formData, teaching_assignment_ids: [] })
                                }}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
                                required
                            >
                                <option value="">Pilih guru pemilik materi...</option>
                                {filteredTeachers.map((t) => (
                                    <option key={t.id} value={t.id}>{t.user.full_name || t.user.username}</option>
                                ))}
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">▼</div>
                        </div>
                    </div>

                    {formTeacherId && (
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">2. Mapel & Kelas Tujuan</label>
                            {formAssignments.length === 0 ? (
                                <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3">
                                    Guru ini belum punya penugasan kelas. Atur dulu di menu Penugasan.
                                </p>
                            ) : (
                                <ClassChipsSelector
                                    assignments={formAssignments}
                                    selectedIds={formData.teaching_assignment_ids}
                                    onChange={(ids) => setFormData({ ...formData, teaching_assignment_ids: ids })}
                                />
                            )}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Materi</label>
                        <input
                            type="text"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            placeholder="Contoh: Bab 1 - Pengenalan Aljabar"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Deskripsi Singkat</label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            rows={2}
                            placeholder="Jelaskan sedikit tentang materi ini..."
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe Konten</label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {['TEXT', 'LINK', 'PDF', 'VIDEO'].map((type) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, type })}
                                    className={`py-2 rounded-lg text-sm font-bold transition-all ${formData.type === type
                                        ? 'bg-primary text-white shadow-soft'
                                        : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>

                    {formData.type === 'VIDEO' ? (
                        <div className="space-y-4">
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setVideoSource('YOUTUBE')}
                                    className={`flex-1 py-2 text-xs font-bold rounded-lg border ${videoSource === 'YOUTUBE' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 text-red-600' : 'border-transparent text-text-secondary hover:bg-secondary/5'}`}
                                >
                                    YouTube Link
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setVideoSource('UPLOAD')}
                                    className={`flex-1 py-2 text-xs font-bold rounded-lg border ${videoSource === 'UPLOAD' ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 text-blue-600' : 'border-transparent text-text-secondary hover:bg-secondary/5'}`}
                                >
                                    Upload Video
                                </button>
                            </div>
                            {videoSource === 'YOUTUBE' ? (
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Link YouTube</label>
                                    <input
                                        type="url"
                                        value={formData.content_url || ''}
                                        onChange={(e) => setFormData({ ...formData, content_url: e.target.value })}
                                        className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                        placeholder="https://youtube.com/watch?v=..."
                                    />
                                </div>
                            ) : (
                                <div className="bg-secondary/5 border-2 border-dashed border-secondary/30 rounded-2xl p-6 text-center hover:border-primary/50 transition-colors">
                                    <div className="mb-3 text-secondary flex justify-center"><Video set="bold" primaryColor="currentColor" size={32} /></div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-1 cursor-pointer">
                                        <span>Klik untuk upload Video</span>
                                        <input
                                            type="file"
                                            accept="video/*"
                                            onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
                                            className="hidden"
                                            required={videoSource === 'UPLOAD'}
                                        />
                                    </label>
                                    <p className="text-xs text-text-secondary">{file ? `Terpilih: ${file.name}` : 'Maksimal ukuran 50MB (MP4/WebM)'}</p>
                                </div>
                            )}
                        </div>
                    ) : formData.type === 'PDF' ? (
                        <div className="bg-secondary/5 border-2 border-dashed border-secondary/30 rounded-2xl p-6 text-center hover:border-primary/50 transition-colors">
                            <div className="mb-3 text-secondary flex justify-center"><FileText set="bold" primaryColor="currentColor" size={32} /></div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-1 cursor-pointer">
                                <span>Klik untuk upload PDF</span>
                                <input
                                    type="file"
                                    accept="application/pdf"
                                    onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
                                    className="hidden"
                                    required
                                />
                            </label>
                            <p className="text-xs text-text-secondary">{file ? `Terpilih: ${file.name}` : 'Maksimal ukuran 5MB'}</p>
                        </div>
                    ) : formData.type === 'TEXT' ? (
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Isi Konten</label>
                            <textarea
                                value={formData.content_text || ''}
                                onChange={(e) => setFormData({ ...formData, content_text: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                rows={6}
                                placeholder="Tulis materi di sini..."
                            />
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Link URL</label>
                            <input
                                type="url"
                                value={formData.content_url || ''}
                                onChange={(e) => setFormData({ ...formData, content_url: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                placeholder="https://..."
                            />
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">
                            Batal
                        </Button>
                        <Button type="submit" loading={saving} className="flex-1">
                            Simpan Materi
                        </Button>
                    </div>
                </form>
            </Modal>
        )
    }

    function renderDeleteModal() {
        return (
            <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Hapus Materi">
                <div className="space-y-4">
                    <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/30">
                        <p className="text-sm text-red-800 dark:text-red-300">
                            Hapus materi <strong>{deleteTarget?.title}</strong>? Tindakan ini tidak dapat dibatalkan.
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" className="flex-1" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                            Batal
                        </Button>
                        <button
                            onClick={confirmDelete}
                            disabled={deleting}
                            className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-bold text-sm rounded-xl transition-colors disabled:opacity-60"
                        >
                            {deleting ? 'Menghapus...' : 'Ya, Hapus'}
                        </button>
                    </div>
                </div>
            </Modal>
        )
    }

    function renderOverlays() {
        return (
            <>
                {successInfo && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <div className="bg-white dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                            <div className="w-16 h-16 bg-emerald-500/15 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
                                <CheckCircle set="bold" primaryColor="currentColor" size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Materi Berhasil Dibagikan! 🎉</h3>
                            <p className="text-text-secondary mb-1 text-sm font-bold text-text-main dark:text-white">
                                "{successInfo.title}"
                            </p>
                            <p className="text-text-secondary mb-6 text-sm">
                                Terkirim ke {successInfo.classCount} kelas. Siswa sudah mendapat notifikasi.
                            </p>
                            <Button className="w-full" onClick={() => setSuccessInfo(null)}>
                                Selesai
                            </Button>
                        </div>
                    </div>
                )}

                {saving && uploadProgress === 0 && (
                    <div className="fixed bottom-6 right-6 bg-white dark:bg-surface-dark px-6 py-4 rounded-2xl shadow-2xl border border-secondary/20 z-50 flex items-center gap-3 w-80 animate-in slide-in-from-bottom duration-300">
                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                        <span className="font-bold text-sm text-text-main dark:text-white">Menyimpan materi...</span>
                    </div>
                )}

                {uploadProgress > 0 && (
                    <div className="fixed bottom-6 right-6 bg-white dark:bg-surface-dark px-6 py-4 rounded-2xl shadow-2xl border border-secondary/20 z-50 flex flex-col gap-2 w-80 animate-in slide-in-from-bottom duration-300">
                        <div className="flex items-center justify-between">
                            <span className="font-bold text-sm text-text-main dark:text-white">Uploading...</span>
                            <span className="font-bold text-primary">{uploadProgress}%</span>
                        </div>
                        <div className="w-full bg-secondary/10 rounded-full h-3 overflow-hidden">
                            <div className="bg-primary h-full rounded-full transition-all duration-300 ease-out" style={{ width: `${uploadProgress}%` }}></div>
                        </div>
                    </div>
                )}

                {toast && (
                    <Toast
                        message={toast.message}
                        type={toast.type}
                        onClose={() => setToast(null)}
                    />
                )}
            </>
        )
    }
}
