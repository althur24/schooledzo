'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Modal, Button, PageHeader, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import { Voice as Megaphone, Plus, Edit as Pencil, Delete as Trash2, Calendar, TimeCircle as Clock } from 'react-iconly'
import { Loader2 } from 'lucide-react'

interface Class {
    id: string
    name: string
    academic_year?: { id: string; name: string; is_active: boolean | null; status: string | null } | { id: string; name: string; is_active: boolean | null; status: string | null }[]
}

interface Announcement {
    id: string
    title: string
    content: string
    is_global: boolean
    class_ids: string[]
    published_at: string
    expires_at: string | null
    is_active: boolean
    created_by_user?: { id: string; full_name: string }
}

export default function AdminPengumumanPage() {
    const [announcements, setAnnouncements] = useState<Announcement[]>([])
    const [classes, setClasses] = useState<Class[]>([])
    const [loading, setLoading] = useState(true)
    const [showCreate, setShowCreate] = useState(false)
    const [showEdit, setShowEdit] = useState(false)
    const [saving, setSaving] = useState(false)
    const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null)

    const [form, setForm] = useState({
        title: '',
        content: '',
        is_global: true,
        class_ids: [] as string[],
        expires_at: ''
    })

    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        try {
            const [announcementsRes, classesRes] = await Promise.all([
                fetch('/api/announcements'),
                fetch('/api/classes')
            ])

            if (announcementsRes.ok) {
                const data = await announcementsRes.json()
                setAnnouncements(Array.isArray(data) ? data : [])
            }

            if (classesRes.ok) {
                const data = await classesRes.json()
                // Hanya kelas tahun ajaran AKTIF — tanpa ini kelas senama dari
                // tahun lama (hasil Salin Kelas) tampil dobel di pemilih kelas
                const list = (Array.isArray(data) ? data : []).filter((c: Class) => {
                    const ay = Array.isArray(c.academic_year) ? c.academic_year[0] : c.academic_year
                    return ay?.is_active === true || ay?.status === 'ACTIVE'
                })
                setClasses(list)
            }
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const resetForm = () => {
        setForm({
            title: '',
            content: '',
            is_global: true,
            class_ids: [],
            expires_at: ''
        })
    }

    const handleCreate = async () => {
        if (!form.title || !form.content) return
        setSaving(true)
        try {
            const res = await fetch('/api/announcements', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    expires_at: form.expires_at || null
                })
            })
            if (res.ok) {
                setShowCreate(false)
                resetForm()
                fetchData()
            }
        } finally {
            setSaving(false)
        }
    }

    const handleEdit = (announcement: Announcement) => {
        setEditingAnnouncement(announcement)
        setForm({
            title: announcement.title,
            content: announcement.content,
            is_global: announcement.is_global,
            class_ids: announcement.class_ids || [],
            expires_at: announcement.expires_at ? announcement.expires_at.slice(0, 16) : ''
        })
        setShowEdit(true)
    }

    const handleUpdate = async () => {
        if (!editingAnnouncement || !form.title || !form.content) return
        setSaving(true)
        try {
            const res = await fetch(`/api/announcements/${editingAnnouncement.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    expires_at: form.expires_at || null
                })
            })
            if (res.ok) {
                setShowEdit(false)
                setEditingAnnouncement(null)
                resetForm()
                fetchData()
            }
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Hapus pengumuman ini?')) return
        await fetch(`/api/announcements/${id}`, { method: 'DELETE' })
        fetchData()
    }

    const handleToggleActive = async (announcement: Announcement) => {
        await fetch(`/api/announcements/${announcement.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: !announcement.is_active })
        })
        fetchData()
    }

    const toggleClassSelection = (classId: string) => {
        setForm(prev => ({
            ...prev,
            class_ids: prev.class_ids.includes(classId)
                ? prev.class_ids.filter(id => id !== classId)
                : [...prev.class_ids, classId]
        }))
    }

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    const getClassNames = (classIds: string[]) => {
        if (!classIds || classIds.length === 0) return '-'
        return classIds
            .map(id => classes.find(c => c.id === id)?.name || '?')
            .join(', ')
    }

    // Form fields JSX - reused in both modals
    const formFields = (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul</label>
                <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="Judul pengumuman..."
                />
            </div>
            <div>
                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Isi Pengumuman</label>
                <textarea
                    value={form.content}
                    onChange={(e) => setForm(prev => ({ ...prev, content: e.target.value }))}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 min-h-[120px]"
                    placeholder="Tulis isi pengumuman..."
                />
            </div>
            <div>
                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Target Penerima</label>
                <div className="flex gap-2 mb-3">
                    <button
                        type="button"
                        onClick={() => setForm(prev => ({ ...prev, is_global: true, class_ids: [] }))}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${form.is_global
                            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                    >
                        🌐 Semua Kelas
                    </button>
                    <button
                        type="button"
                        onClick={() => setForm(prev => ({ ...prev, is_global: false }))}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${!form.is_global
                            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                    >
                        🎯 Pilih Kelas
                    </button>
                </div>
                {!form.is_global && (
                    <div className="flex flex-wrap gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/10">
                        {classes.length === 0 ? (
                            <p className="text-sm text-text-secondary">Tidak ada kelas tersedia</p>
                        ) : (
                            classes.map(cls => (
                                <button
                                    type="button"
                                    key={cls.id}
                                    onClick={() => toggleClassSelection(cls.id)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${form.class_ids.includes(cls.id)
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-emerald-500 hover:text-emerald-500'
                                        }`}
                                >
                                    {cls.name}
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>
            <div>
                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kadaluarsa (Opsional)</label>
                <input
                    type="datetime-local"
                    value={form.expires_at}
                    onChange={(e) => setForm(prev => ({ ...prev, expires_at: e.target.value }))}
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <p className="text-xs text-text-secondary mt-1">Kosongkan jika tidak ada batas waktu</p>
            </div>
        </div>
    )

    return (
        <div className="space-y-6 pb-24 lg:pb-0">
            <PageHeader
                title="Pengumuman"
                subtitle="Kelola pengumuman sekolah"
                icon={<div className="text-amber-500"><Megaphone set="bold" primaryColor="currentColor" size={24} /></div>}
                backHref="/dashboard/admin"
                action={
                    <Button onClick={() => setShowCreate(true)} icon={<Plus set="bold" primaryColor="currentColor" size={20} />}>
                        Buat Pengumuman
                    </Button>
                }
            />

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : announcements.length === 0 ? (
                <EmptyState
                    icon={<div className="text-orange-200"><Megaphone set="bold" primaryColor="currentColor" size={48} /></div>}
                    title="Belum Ada Pengumuman"
                    description="Buat pengumuman pertama untuk siswa Anda."
                    action={<Button onClick={() => setShowCreate(true)}>Buat Pengumuman</Button>}
                />
            ) : (
                <div className="space-y-4">
                    {announcements.map((announcement) => (
                        <Card key={announcement.id} className="p-5">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                                        <h3 className="font-bold text-text-main dark:text-white text-lg">{announcement.title}</h3>
                                        {announcement.is_global ? (
                                            <span className="px-2 py-0.5 bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 text-xs rounded-full font-medium">
                                                🌐 Semua Kelas
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-xs rounded-full font-medium">
                                                🎯 {announcement.class_ids?.length || 0} Kelas
                                            </span>
                                        )}
                                        {!announcement.is_active && (
                                            <span className="px-2 py-0.5 bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 text-xs rounded-full font-medium">
                                                Nonaktif
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-text-secondary dark:text-zinc-400 text-sm mb-3 whitespace-pre-wrap line-clamp-3">
                                        {announcement.content}
                                    </p>
                                    <div className="flex items-center gap-4 text-xs text-text-secondary">
                                        <div className="flex items-center gap-1">
                                            <Calendar set="bold" primaryColor="currentColor" size={12} />
                                            <span>{formatDate(announcement.published_at)}</span>
                                        </div>
                                        {!announcement.is_global && (
                                            <span>📍 {getClassNames(announcement.class_ids)}</span>
                                        )}
                                        {announcement.expires_at && (
                                            <div className="flex items-center gap-1 text-red-400">
                                                <Clock set="bold" primaryColor="currentColor" size={12} />
                                                <span>Expired: {formatDate(announcement.expires_at)}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => handleToggleActive(announcement)}
                                    >
                                        {announcement.is_active ? '🔕' : '🔔'}
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => handleEdit(announcement)}
                                    >
                                        <Pencil set="bold" primaryColor="currentColor" size={16} />
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => handleDelete(announcement.id)}
                                        className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                    >
                                        <Trash2 set="bold" primaryColor="currentColor" size={16} />
                                    </Button>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {/* Create Modal */}
            <Modal
                open={showCreate}
                onClose={() => { setShowCreate(false); resetForm() }}
                title="Buat Pengumuman Baru"
            >
                {formFields}
                <div className="flex gap-3 pt-6 border-t border-secondary/10 mt-4">
                    <Button variant="secondary" onClick={() => { setShowCreate(false); resetForm() }} className="flex-1">
                        Batal
                    </Button>
                    <Button
                        onClick={handleCreate}
                        loading={saving}
                        disabled={!form.title || !form.content || (!form.is_global && form.class_ids.length === 0)}
                        className="flex-1"
                    >
                        Publikasikan
                    </Button>
                </div>
            </Modal>

            {/* Edit Modal */}
            <Modal
                open={showEdit}
                onClose={() => { setShowEdit(false); setEditingAnnouncement(null); resetForm() }}
                title="Edit Pengumuman"
            >
                {formFields}
                <div className="flex gap-3 pt-6 border-t border-secondary/10 mt-4">
                    <Button variant="secondary" onClick={() => { setShowEdit(false); setEditingAnnouncement(null); resetForm() }} className="flex-1">
                        Batal
                    </Button>
                    <Button
                        onClick={handleUpdate}
                        loading={saving}
                        disabled={!form.title || !form.content || (!form.is_global && form.class_ids.length === 0)}
                        className="flex-1"
                    >
                        Simpan Perubahan
                    </Button>
                </div>
            </Modal>
        </div>
    )
}
