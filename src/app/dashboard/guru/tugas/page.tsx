'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Modal, PageHeader, Button, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import MultiClassSelector from '@/components/MultiClassSelector'
import { Edit as PenTool, Calendar, TimeCircle as Clock, Plus, ChevronDown, Paper, Activity, Search, Delete, Danger, Edit } from 'react-iconly'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

interface TeachingAssignment {
    id: string
    subject: { id: string; name: string }
    class: { id: string; name: string }
}

interface Assignment {
    id: string
    title: string
    description: string | null
    type: string
    due_date: string | null
    created_at: string
    teaching_assignment: TeachingAssignment
    submissions?: { count: number }[]
    need_grading_count?: number
}

export default function TugasPage() {
    const { user } = useAuth()
    const [assignments, setAssignments] = useState<Assignment[]>([])
    const [teachingAssignments, setTeachingAssignments] = useState<TeachingAssignment[]>([])
    const [studentCounts, setStudentCounts] = useState<Record<string, number>>({})
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
    const [formData, setFormData] = useState({
        teaching_assignment_ids: [] as string[],
        title: '',
        description: '',
        type: 'TUGAS',
        due_date: ''
    })
    const [saving, setSaving] = useState(false)

    // Filter, Search, & Pagination
    const [searchQuery, setSearchQuery] = useState('')
    const [filterClass, setFilterClass] = useState('')
    const [filterSubject, setFilterSubject] = useState('')
    const [currentPage, setCurrentPage] = useState(1)
    const itemsPerPage = 10

    const fetchData = async () => {
        try {
            const [taRes, assignmentsRes, yearsRes] = await Promise.all([
                fetch('/api/my-teaching-assignments'),
                fetch('/api/assignments'),
                fetch('/api/academic-years')
            ])
            const [taData, assignmentsData, yearsData] = await Promise.all([
                taRes.json(),
                assignmentsRes.json(),
                yearsRes.json()
            ])

            const taArray = Array.isArray(taData) ? taData : []
            const assignmentsArray = Array.isArray(assignmentsData) ? assignmentsData : []

            // Get active academic year and fetch students with enrollment
            const activeYear = Array.isArray(yearsData) ? yearsData.find((y: any) => y.is_active) : null
            if (activeYear) {
                try {
                    const studentsRes = await fetch(`/api/students?enrollment_year_id=${activeYear.id}`)
                    const studentsData = await studentsRes.json()
                    const studentsArray = Array.isArray(studentsData) ? studentsData : []
                    const counts: Record<string, number> = {}
                    studentsArray.forEach((s: any) => {
                        const classId = s.class?.id || s.class_id
                        if (classId) counts[classId] = (counts[classId] || 0) + 1
                    })
                    setStudentCounts(counts)
                } catch (e) {
                    console.error('Error fetching students:', e)
                }
            }

            const myAssignments = assignmentsArray.sort((a: Assignment, b: Assignment) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

            setTeachingAssignments(taArray)
            setAssignments(myAssignments)
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (user) fetchData()
    }, [user])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            // Convert local datetime-local string to UTC for backend
            let formattedDueDate = null;
            if (formData.due_date) {
                const localDate = new Date(formData.due_date);
                formattedDueDate = localDate.toISOString();
            }

            if (editingId) {
                const res = await fetch(`/api/assignments/${editingId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        teaching_assignment_id: formData.teaching_assignment_ids[0],
                        title: formData.title,
                        description: formData.description,
                        type: formData.type,
                        due_date: formattedDueDate
                    })
                })
            } else {
                const results = await Promise.allSettled(
                    formData.teaching_assignment_ids.map(taId =>
                        fetch('/api/assignments', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                teaching_assignment_id: taId,
                                title: formData.title,
                                description: formData.description,
                                type: formData.type,
                                due_date: formattedDueDate
                            })
                        })
                    )
                )
                const failed = results.filter(r => r.status === 'rejected').length
                if (failed > 0) {
                    alert(`${results.length - failed} tugas berhasil dibuat, ${failed} gagal.`)
                }
            }
            
            setShowModal(false)
            setEditingId(null)
            setFormData({ teaching_assignment_ids: [], title: '', description: '', type: 'TUGAS', due_date: '' })
            fetchData()
        } finally {
            setSaving(false)
        }
    }

    const openEditModal = (assignment: Assignment) => {
        setEditingId(assignment.id)

        let localDueStr = '';
        if (assignment.due_date) {
            const d = new Date(assignment.due_date);
            // Adjust to local timezone for datetime-local input
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            localDueStr = d.toISOString().slice(0, 16);
        }

        setFormData({
            teaching_assignment_ids: [assignment.teaching_assignment.id],
            title: assignment.title,
            description: assignment.description || '',
            type: assignment.type,
            due_date: localDueStr
        })
        setShowModal(true)
    }

    const handleDelete = async () => {
        if (!deleteConfirmId) return
        setSaving(true)
        try {
            await fetch(`/api/assignments/${deleteConfirmId}`, { method: 'DELETE' })
            setDeleteConfirmId(null)
            fetchData()
        } finally {
            setSaving(false)
        }
    }

    // Filter and Pagination Data
    const filteredAssignments = assignments.filter((a) => {
        const matchQuery = a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (a.description || '').toLowerCase().includes(searchQuery.toLowerCase())
        const matchClass = filterClass ? a.teaching_assignment.class.name === filterClass : true
        const matchSubject = filterSubject ? a.teaching_assignment.subject.name === filterSubject : true
        return matchQuery && matchClass && matchSubject
    })

    const totalPages = Math.ceil(filteredAssignments.length / itemsPerPage)
    const paginatedAssignments = filteredAssignments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

    const uniqueClasses = Array.from(new Set(teachingAssignments.map(ta => ta.class.name))).sort()
    const uniqueSubjects = Array.from(new Set(teachingAssignments.map(ta => ta.subject.name))).sort()

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1)
    }, [searchQuery, filterClass, filterSubject])

    return (
        <div className="space-y-6">
            <PageHeader
                title="Tugas"
                subtitle="Buat dan kelola tugas siswa"
                icon={<div className="text-amber-500"><PenTool set="bold" primaryColor="currentColor" size={24} /></div>}
                backHref="/dashboard/guru"
                action={
                    <Button onClick={() => setShowModal(true)} icon={
                        <div className="text-white"><Plus set="bold" primaryColor="currentColor" size={20} /></div>
                    }>
                        Buat Tugas
                    </Button>
                }
            />

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary">
                        <Search set="light" primaryColor="currentColor" size={20} />
                    </div>
                    <input
                        type="text"
                        placeholder="Cari tugas, PR, ulangan..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl focus:outline-none focus:border-primary/50 text-sm"
                    />
                </div>
                <div className="relative w-full sm:w-48">
                    <select
                        value={filterClass}
                        onChange={(e) => setFilterClass(e.target.value)}
                        className="w-full pl-4 pr-10 py-3 bg-secondary/5 border border-secondary/20 rounded-xl focus:outline-none focus:border-primary/50 text-sm appearance-none"
                    >
                        <option value="">Semua Kelas</option>
                        {uniqueClasses.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none">
                        <ChevronDown set="light" primaryColor="currentColor" size={16} />
                    </div>
                </div>
                <div className="relative w-full sm:w-48">
                    <select
                        value={filterSubject}
                        onChange={(e) => setFilterSubject(e.target.value)}
                        className="w-full pl-4 pr-10 py-3 bg-secondary/5 border border-secondary/20 rounded-xl focus:outline-none focus:border-primary/50 text-sm appearance-none"
                    >
                        <option value="">Semua Mapel</option>
                        {uniqueSubjects.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none">
                        <ChevronDown set="light" primaryColor="currentColor" size={16} />
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="p-12 flex justify-center">
                    <div className="animate-spin text-primary"><Loader2 className="w-10 h-10" /></div>
                </div>
            ) : filteredAssignments.length === 0 ? (
                <EmptyState
                    icon={<div className="text-secondary"><Paper set="bold" primaryColor="currentColor" size={48} /></div>}
                    title="Tidak Ada Tugas"
                    description={searchQuery || filterClass || filterSubject ? "Tidak ada tugas yang cocok dengan filter pencarian" : "Buat tugas baru untuk siswa Anda"}
                    action={!searchQuery && !filterClass && !filterSubject ? <Button onClick={() => setShowModal(true)}>Buat Tugas</Button> : <Button variant="secondary" onClick={() => { setSearchQuery(''); setFilterClass(''); setFilterSubject(''); }}>Reset Filter</Button>}
                />
            ) : (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4">
                        {paginatedAssignments.map((assignment) => {
                            const now = new Date()
                            const dueDate = assignment.due_date ? new Date(assignment.due_date) : null
                            const isOverdue = dueDate && dueDate < now
                            const isNearing = dueDate && (dueDate.getTime() - now.getTime() < 3 * 24 * 60 * 60 * 1000) && !isOverdue

                            const borderClass = isOverdue ? 'border-red-500/50 hover:border-red-500 bg-red-50/10 dark:bg-red-900/5' : isNearing ? 'border-amber-500/50 hover:border-amber-500 bg-amber-50/10 dark:bg-amber-900/5' : 'hover:border-primary/30'
                            const submitCount = assignment.submissions?.[0]?.count || 0
                            const classId = (assignment.teaching_assignment as any)?.class?.id
                            const totalStudents = classId ? (studentCounts[classId] || 0) : 0

                            return (
                                <Card key={assignment.id} className={`group transition-all hover:shadow-md ${borderClass}`}>
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
                                                    {assignment.type}
                                                </span>
                                                <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20">
                                                    {assignment.teaching_assignment?.class?.name}
                                                </span>
                                                <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-green-500/10 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-500/20">
                                                    {assignment.teaching_assignment?.subject?.name}
                                                </span>
                                                {isOverdue && (
                                                    <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 flex items-center gap-1">
                                                        <Danger set="bold" primaryColor="currentColor" size={12} /> Overdue
                                                    </span>
                                                )}
                                                {(assignment.need_grading_count || 0) > 0 && (
                                                    <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20 flex items-center gap-1">
                                                        <Danger set="bold" primaryColor="currentColor" size={12} /> Perlu Dikoreksi: {assignment.need_grading_count}
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="text-xl font-bold text-text-main dark:text-white mb-1 group-hover:text-primary transition-colors">{assignment.title}</h3>
                                            <p className="text-sm text-text-secondary dark:text-zinc-400 mb-3 line-clamp-2">
                                                {assignment.description || 'Tidak ada deskripsi'}
                                            </p>
                                            <div className="flex items-center flex-wrap gap-4 text-xs text-text-secondary dark:text-zinc-500">
                                                <div className="flex items-center gap-1.5">
                                                    <Calendar set="bold" primaryColor="currentColor" size={16} />
                                                    <span>Dibuat: {new Date(assignment.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                </div>
                                                <div className={`flex items-center gap-1.5 ${isOverdue ? 'text-red-500 font-medium' : isNearing ? 'text-amber-500 font-medium' : ''}`}>
                                                    <Clock set="bold" primaryColor="currentColor" size={16} />
                                                    <span>Deadline: {assignment.due_date ? new Date(assignment.due_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 font-medium text-primary">
                                                    <Paper set="bold" primaryColor="currentColor" size={16} />
                                                    <span>{submitCount}/{totalStudents} mengumpulkan</span>
                                                </div>
                                                {totalStudents > 0 && (
                                                    <div className="w-24 bg-secondary/20 rounded-full h-1.5 overflow-hidden self-center">
                                                        <div
                                                            className={`h-full rounded-full transition-all duration-500 ${submitCount >= totalStudents ? 'bg-green-500' : submitCount > 0 ? 'bg-primary' : 'bg-secondary/30'}`}
                                                            style={{ width: `${Math.min(100, totalStudents > 0 ? (submitCount / totalStudents) * 100 : 0)}%` }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2 min-w-[120px]">
                                            <Link href={`/dashboard/guru/tugas/${assignment.id}/hasil`}>
                                                {(assignment.need_grading_count || 0) > 0 ? (
                                                    <Button variant="primary" size="sm" className="w-full justify-center bg-orange-500 hover:bg-orange-600 text-white border-orange-500">
                                                        <span className="text-white"><Edit set="bold" primaryColor="currentColor" size={16} /></span> Koreksi ({assignment.need_grading_count})
                                                    </Button>
                                                ) : (
                                                    <Button variant="secondary" size="sm" className="w-full justify-center">
                                                        <span className="text-secondary"><Activity set="bold" primaryColor="currentColor" size={16} /></span> Hasil
                                                    </Button>
                                                )}
                                            </Link>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => openEditModal(assignment)}
                                                className="w-full justify-center"
                                            >
                                                <span className="text-secondary"><PenTool set="bold" primaryColor="currentColor" size={16} /></span> Edit
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => setDeleteConfirmId(assignment.id)}
                                                className="w-full justify-center text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200 dark:border-red-900/30"
                                            >
                                                <span className="text-red-500"><Delete set="bold" primaryColor="currentColor" size={16} /></span> Hapus
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
                            )
                        })}
                    </div>
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 pt-4">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                            >
                                Sebelumnya
                            </Button>
                            <span className="text-sm text-text-secondary px-4">
                                Halaman {currentPage} dari {totalPages}
                            </span>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                            >
                                Selanjutnya
                            </Button>
                        </div>
                    )}
                </div>
            )}

            <Modal
                open={showModal}
                onClose={() => { setShowModal(false); setEditingId(null); setFormData({ teaching_assignment_ids: [], title: '', description: '', type: 'TUGAS', due_date: '' }) }}
                title={editingId ? "Edit Tugas" : "Buat Tugas Baru"}
            >
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kelas & Mata Pelajaran</label>
                        <MultiClassSelector
                            teachingAssignments={teachingAssignments}
                            selectedIds={formData.teaching_assignment_ids}
                            onChange={(ids) => setFormData({ ...formData, teaching_assignment_ids: ids })}
                            mode={editingId ? 'single' : 'multi'}
                            disabled={!!editingId}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Tugas</label>
                        <input
                            type="text"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            placeholder="Contoh: Tugas Matematika Bab 1"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Deskripsi (Opsional)</label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50 min-h-[100px]"
                            placeholder="Jelaskan detail tugas di sini..."
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe</label>
                            <div className="relative">
                                <select
                                    value={formData.type}
                                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                    className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
                                >
                                    <option value="TUGAS">Tugas</option>
                                    <option value="PR">PR</option>
                                    <option value="PROYEK">Proyek</option>
                                    <option value="LATIHAN">Latihan</option>
                                </select>
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary"><ChevronDown set="bold" primaryColor="currentColor" size={20} /></div>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Batas Waktu (Deadline)</label>
                            <input
                                type="datetime-local"
                                value={formData.due_date}
                                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-secondary/10 mt-4">
                        <Button type="button" variant="secondary" onClick={() => { setShowModal(false); setEditingId(null); setFormData({ teaching_assignment_ids: [], title: '', description: '', type: 'TUGAS', due_date: '' }) }} className="flex-1">
                            Batal
                        </Button>
                        <Button type="submit" loading={saving} disabled={formData.teaching_assignment_ids.length === 0 || !formData.title} className="flex-1">
                            {editingId ? 'Simpan Perubahan' : 'Buat Tugas'}
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* Custom Delete Modal */}
            <Modal
                open={!!deleteConfirmId}
                onClose={() => setDeleteConfirmId(null)}
                title="Konfirmasi Hapus"
            >
                <div className="space-y-4">
                    <p className="text-text-main dark:text-slate-300">
                        Apakah Anda yakin ingin menghapus tugas ini? Data siswa yang sudah mengumpulkan juga akan terhapus.
                    </p>
                    <div className="flex gap-3 pt-2">
                        <Button variant="secondary" onClick={() => setDeleteConfirmId(null)} className="flex-1">Batal</Button>
                        <Button
                            onClick={handleDelete}
                            loading={saving}
                            className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                        >
                            Ya, Hapus
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}
