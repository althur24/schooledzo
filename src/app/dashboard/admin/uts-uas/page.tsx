'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Modal, PageHeader, Button, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import { Plus, ChevronDown } from 'react-iconly'
import { Loader2, FileText, Clock, Users, CheckCircle, Edit3, Trash2, GraduationCap, BookOpen, BarChart3, Activity } from 'lucide-react'

interface OfficialExam {
    id: string
    exam_type: 'UTS' | 'UAS'
    title: string
    description: string | null
    start_time: string
    duration_minutes: number
    is_active: boolean
    is_randomized: boolean
    max_violations: number
    target_class_ids: string[]
    question_count: number
    created_at: string
    subject: { id: string; name: string }
    academic_year: { id: string; name: string; is_active: boolean }
}

interface Subject {
    id: string
    name: string
}

interface ClassItem {
    id: string
    name: string
    school_level: string | null
    grade_level: number | null
}

export default function AdminUtsUasPage() {
    const router = useRouter()
    const [exams, setExams] = useState<OfficialExam[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [classes, setClasses] = useState<ClassItem[]>([])
    const [loading, setLoading] = useState(true)
    const [showCreate, setShowCreate] = useState(false)
    const [creating, setCreating] = useState(false)
    const [filterType, setFilterType] = useState<string>('')
    const [filterSubject, setFilterSubject] = useState<string>('')
    const [submissionCounts, setSubmissionCounts] = useState<Record<string, { submitted: number; total: number }>>({})

    // Toast & confirm dialog
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
    const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type })
        setTimeout(() => setToast(null), 3000)
    }

    const [form, setForm] = useState({
        exam_type: 'UTS' as 'UTS' | 'UAS',
        title: '',
        description: '',
        subject_id: '',
        start_time: '',
        duration_minutes: 90,
        is_randomized: true,
        max_violations: 3,
        show_results_immediately: true,
        target_class_ids: [] as string[]
    })

    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        try {
            const [examsRes, subjectsRes, classesRes] = await Promise.all([
                fetch('/api/official-exams'),
                fetch('/api/subjects'),
                fetch('/api/classes')
            ])
            const examsData = await examsRes.json()
            const subjectsData = await subjectsRes.json()
            const classesData = await classesRes.json()

            setExams(Array.isArray(examsData) ? examsData : [])
            setSubjects(Array.isArray(subjectsData) ? subjectsData : [])
            setClasses(Array.isArray(classesData) ? classesData : [])

            // Fetch submission counts for each exam
            const examsList = Array.isArray(examsData) ? examsData : []
            const counts: Record<string, { submitted: number; total: number }> = {}
            await Promise.all(examsList.map(async (exam: OfficialExam) => {
                try {
                    const res = await fetch(`/api/official-exam-submissions?exam_id=${exam.id}`)
                    if (res.ok) {
                        const subs = await res.json()
                        const subsArr = Array.isArray(subs) ? subs : []
                        counts[exam.id] = {
                            submitted: subsArr.filter((s: any) => s.is_submitted).length,
                            total: subsArr.length
                        }
                    }
                } catch { }
            }))
            setSubmissionCounts(counts)
        } catch (error) {
            console.error('Error fetching data:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleCreate = async () => {
        if (!form.subject_id || !form.title || !form.start_time || form.target_class_ids.length === 0) return
        setCreating(true)
        try {
            const localDate = new Date(form.start_time)
            const res = await fetch('/api/official-exams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    start_time: localDate.toISOString()
                })
            })
            if (res.ok) {
                const newExam = await res.json()
                setShowCreate(false)
                setForm({
                    exam_type: 'UTS',
                    title: '',
                    description: '',
                    subject_id: '',
                    start_time: '',
                    duration_minutes: 90,
                    is_randomized: true,
                    max_violations: 3,
                    show_results_immediately: true,
                    target_class_ids: []
                })
                router.push(`/dashboard/admin/uts-uas/${newExam.id}`)
            }
        } finally {
            setCreating(false)
        }
    }

    const handleDelete = (id: string) => {
        setConfirmDialog({
            title: 'Hapus Ujian',
            message: 'Hapus ujian ini? Semua soal dan submission akan dihapus.',
            onConfirm: async () => {
                const res = await fetch(`/api/official-exams/${id}`, { method: 'DELETE' })
                if (res.ok) {
                    showToast('Ujian berhasil dihapus', 'success')
                } else {
                    showToast('Gagal menghapus ujian', 'error')
                }
                fetchData()
                setConfirmDialog(null)
            }
        })
    }

    const toggleClassSelection = (classId: string) => {
        setForm(prev => ({
            ...prev,
            target_class_ids: prev.target_class_ids.includes(classId)
                ? prev.target_class_ids.filter(id => id !== classId)
                : [...prev.target_class_ids, classId]
        }))
    }

    const selectAllClasses = () => {
        setForm(prev => ({
            ...prev,
            target_class_ids: classes.map(c => c.id)
        }))
    }

    const selectByLevel = (level: string) => {
        const levelClasses = classes.filter(c => c.school_level === level)
        setForm(prev => ({
            ...prev,
            target_class_ids: levelClasses.map(c => c.id)
        }))
    }

    const getExamStatus = (exam: OfficialExam) => {
        const now = new Date()
        const startTime = new Date(exam.start_time)
        const endTime = new Date(startTime.getTime() + exam.duration_minutes * 60000)

        if (now > endTime) return { label: 'Selesai', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
        if (!exam.is_active) return { label: 'Draft', color: 'bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-500/20 dark:text-amber-400' }
        if (now < startTime) return { label: 'Terjadwal', color: 'bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-500/20 dark:text-blue-400' }
        if (now >= startTime && now <= endTime) return { label: 'Berlangsung', color: 'bg-green-500/10 text-green-600 border-green-200 dark:border-green-500/20 dark:text-green-400' }
        return { label: 'Selesai', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
    }

    const formatDateTime = (dateString: string) => {
        return new Date(dateString).toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        })
    }

    const filteredExams = exams.filter(e => {
        if (filterType && e.exam_type !== filterType) return false
        if (filterSubject && e.subject?.id !== filterSubject) return false
        return true
    })

    // Group classes by school_level for the selection UI
    const classesByLevel = classes.reduce((acc, c) => {
        const level = c.school_level || 'Lainnya'
        if (!acc[level]) acc[level] = []
        acc[level].push(c)
        return acc
    }, {} as Record<string, ClassItem[]>)

    return (
        <div className="space-y-6">
            <PageHeader
                title="UTS / UAS"
                subtitle="Kelola Ujian Tengah Semester & Ujian Akhir Semester"
                icon={<div className="text-indigo-500"><GraduationCap className="w-6 h-6" /></div>}
                backHref="/dashboard/admin"
                action={
                    <Button onClick={() => setShowCreate(true)} icon={
                        <div className="text-white"><Plus set="bold" primaryColor="currentColor" size={20} /></div>
                    }>
                        Buat Ujian
                    </Button>
                }
            />

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="px-4 py-2 bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                >
                    <option value="">Semua Tipe</option>
                    <option value="UTS">UTS</option>
                    <option value="UAS">UAS</option>
                </select>
                <select
                    value={filterSubject}
                    onChange={(e) => setFilterSubject(e.target.value)}
                    className="px-4 py-2 bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                >
                    <option value="">Semua Mapel</option>
                    {subjects.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
            </div>

            {/* Exam List */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                </div>
            ) : filteredExams.length === 0 ? (
                <EmptyState
                    icon={<div className="text-indigo-400"><GraduationCap className="w-12 h-12" /></div>}
                    title="Belum Ada Ujian"
                    description="Buat ujian UTS atau UAS baru untuk kelas-kelas Anda."
                    action={<Button onClick={() => setShowCreate(true)}>Buat Ujian Sekarang</Button>}
                />
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredExams.map((exam) => {
                        const status = getExamStatus(exam)
                        const counts = submissionCounts[exam.id]
                        return (
                            <Card key={exam.id} padding="p-5" className="group hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all">
                                <div className="flex flex-col h-full gap-3">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${status.color}`}>{status.label}</span>
                                                <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${exam.exam_type === 'UTS'
                                                    ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                                                    : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                                                    }`}>
                                                    {exam.exam_type}
                                                </span>
                                            </div>
                                            <h3 className="font-bold text-text-main dark:text-white text-lg group-hover:text-primary transition-colors line-clamp-2">{exam.title}</h3>
                                        </div>
                                        <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                                            <GraduationCap className="w-5 h-5" />
                                        </div>
                                    </div>

                                    <p className="text-sm text-text-secondary dark:text-zinc-400 line-clamp-1">{exam.description || 'Tidak ada deskripsi'}</p>

                                    <div className="space-y-2 pt-3 border-t border-secondary/10">
                                        <div className="flex items-center justify-between text-xs text-text-secondary">
                                            <span>Mata Pelajaran</span>
                                            <span className="px-2 py-1 bg-primary/10 rounded font-bold text-primary">{exam.subject?.name}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-text-secondary">
                                            <span>Kelas Target</span>
                                            <span className="font-bold text-text-main dark:text-white flex items-center gap-1">
                                                <Users className="w-3.5 h-3.5" /> {exam.target_class_ids?.length || 0} kelas
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-text-secondary">
                                            <span>Soal & Durasi</span>
                                            <div className="flex gap-3">
                                                <span className="flex items-center gap-1 font-medium">
                                                    <FileText className="w-3.5 h-3.5" /> {exam.question_count}
                                                </span>
                                                <span className="flex items-center gap-1 font-medium">
                                                    <Clock className="w-3.5 h-3.5" /> {exam.duration_minutes}m
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-text-secondary">
                                            <span>Jadwal</span>
                                            <span className="font-medium">{formatDateTime(exam.start_time)}</span>
                                        </div>
                                        {counts && (
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-text-secondary">Pengumpulan</span>
                                                <span className="font-bold text-primary">{counts.submitted} terkumpul</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex gap-2 mt-auto pt-3">
                                        {status.label === 'Berlangsung' && (
                                            <Link href={`/dashboard/admin/uts-uas/${exam.id}/monitor`} className="flex-1">
                                                <Button variant="outline" size="sm" className="w-full justify-center text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-900/20 whitespace-nowrap gap-1.5">
                                                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                                                    Monitor Live
                                                </Button>
                                            </Link>
                                        )}
                                        {status.label === 'Selesai' && (
                                            <Link href={`/dashboard/admin/uts-uas/${exam.id}#hasil`} className="flex-1">
                                                <Button variant="outline" size="sm" className="w-full justify-center text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:border-emerald-900/50 dark:hover:bg-emerald-900/20">
                                                    <BarChart3 className="w-4 h-4 mr-1" /> Hasil
                                                </Button>
                                            </Link>
                                        )}
                                        <Link href={`/dashboard/admin/uts-uas/${exam.id}`} className="flex-1">
                                            <Button variant="outline" size="sm" className="w-full justify-center border-primary/20 text-primary hover:bg-primary/5">
                                                <Edit3 className="w-4 h-4 mr-1" /> Detail
                                            </Button>
                                        </Link>
                                        <Button
                                            variant="outline" size="sm"
                                            onClick={() => handleDelete(exam.id)}
                                            className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200 dark:border-red-900/30"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* Create Modal */}
            <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Buat Ujian Baru">
                <div className="space-y-4">
                    {/* Exam Type */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe Ujian</label>
                        <div className="grid grid-cols-2 gap-3">
                            {(['UTS', 'UAS'] as const).map(type => (
                                <label key={type} className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all font-bold ${form.exam_type === type ? 'border-primary bg-primary/5 text-primary' : 'border-secondary/20 hover:border-primary/50 text-text-main dark:text-white'}`}>
                                    <input type="radio" name="exam_type" checked={form.exam_type === type} onChange={() => setForm({ ...form, exam_type: type })} className="hidden" />
                                    {type === 'UTS' ? <BookOpen className="w-5 h-5" /> : <GraduationCap className="w-5 h-5" />}
                                    {type}
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Subject */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Mata Pelajaran</label>
                        <div className="relative">
                            <select
                                value={form.subject_id}
                                onChange={(e) => setForm({ ...form, subject_id: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
                            >
                                <option value="">Pilih mata pelajaran...</option>
                                {subjects.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary"><ChevronDown set="bold" primaryColor="currentColor" size={20} /></div>
                        </div>
                    </div>

                    {/* Title */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Ujian</label>
                        <input
                            type="text"
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            placeholder={`Contoh: ${form.exam_type} Matematika Semester 1`}
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Deskripsi (Opsional)</label>
                        <textarea
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            rows={2}
                            placeholder="Materi yang diujikan..."
                        />
                    </div>

                    {/* Target Classes */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">
                            Kelas Target ({form.target_class_ids.length} terpilih)
                        </label>
                        <div className="flex flex-wrap gap-2 mb-3">
                            <button onClick={selectAllClasses} className="text-xs px-3 py-1.5 bg-primary/10 text-primary font-bold rounded-lg hover:bg-primary/20 transition-colors">
                                Pilih Semua
                            </button>
                            {Object.keys(classesByLevel).map(level => (
                                <button key={level} onClick={() => selectByLevel(level)} className="text-xs px-3 py-1.5 bg-secondary/10 text-text-secondary font-bold rounded-lg hover:bg-secondary/20 transition-colors">
                                    Semua {level}
                                </button>
                            ))}
                            <button onClick={() => setForm(prev => ({ ...prev, target_class_ids: [] }))} className="text-xs px-3 py-1.5 bg-red-500/10 text-red-500 font-bold rounded-lg hover:bg-red-500/20 transition-colors">
                                Reset
                            </button>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-1 pr-2 custom-scrollbar">
                            {Object.entries(classesByLevel).map(([level, levelClasses]) => (
                                <div key={level}>
                                    <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1 mt-2">{level}</p>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {levelClasses.map(c => {
                                            const selected = form.target_class_ids.includes(c.id)
                                            return (
                                                <button
                                                    key={c.id}
                                                    onClick={() => toggleClassSelection(c.id)}
                                                    className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${selected
                                                        ? 'bg-primary text-white shadow-sm'
                                                        : 'bg-secondary/5 text-text-secondary hover:bg-secondary/10 border border-secondary/10'
                                                        }`}
                                                >
                                                    {c.name}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Time & Duration */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Waktu Mulai</label>
                            <input
                                type="datetime-local"
                                value={form.start_time}
                                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Durasi (menit)</label>
                            <input
                                type="number"
                                value={form.duration_minutes}
                                onChange={(e) => setForm({ ...form, duration_minutes: parseInt(e.target.value) || 90 })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                min={5} max={300}
                            />
                        </div>
                    </div>

                    {/* Options */}
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/10">
                            <input type="checkbox" id="randomize_official" checked={form.is_randomized} onChange={(e) => setForm({ ...form, is_randomized: e.target.checked })} className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary" />
                            <label htmlFor="randomize_official" className="text-sm font-medium text-text-main dark:text-white cursor-pointer select-none">Acak urutan soal per siswa</label>
                        </div>
                        <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/10">
                            <input
                                type="checkbox"
                                id="showResultsOfficial"
                                checked={form.show_results_immediately}
                                onChange={(e) => setForm({ ...form, show_results_immediately: e.target.checked })}
                                className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary"
                            />
                            <label htmlFor="showResultsOfficial" className="text-sm font-medium text-text-main dark:text-white cursor-pointer select-none flex flex-col">
                                <span>Tampilkan Hasil Langsung</span>
                                <span className="text-xs text-text-secondary font-normal mt-0.5">Jika dimatikan, siswa baru bisa melihat nilai setelah Anda klik "Bagikan Hasil"</span>
                            </label>
                        </div>
                    </div>

                    {/* Max Violations */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Maksimal Pelanggaran</label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                value={form.max_violations}
                                onChange={(e) => setForm({ ...form, max_violations: parseInt(e.target.value) || 3 })}
                                className="w-24 px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-center font-bold"
                                min={1} max={10}
                            />
                            <p className="text-xs text-text-secondary">Ujian otomatis dikumpulkan jika siswa melebihi batas pelanggaran (pindah tab, dll)</p>
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-secondary/10 mt-2">
                        <Button variant="secondary" onClick={() => setShowCreate(false)} className="flex-1">Batal</Button>
                        <Button
                            onClick={handleCreate}
                            loading={creating}
                            disabled={!form.subject_id || !form.title || !form.start_time || form.target_class_ids.length === 0}
                            className="flex-1"
                        >
                            Buat & Tambah Soal
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Toast */}
            {toast && (
                <div className={`fixed bottom-6 right-6 z-[200] px-5 py-3 rounded-xl shadow-2xl text-white font-medium text-sm flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-300 ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
                    <span>{toast.type === 'success' ? '✅' : '❌'}</span>
                    {toast.message}
                    <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
                </div>
            )}

            {/* Confirm Dialog */}
            {confirmDialog && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-white dark:bg-surface-dark rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="w-16 h-16 mx-auto bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mb-4">
                            <Trash2 className="w-7 h-7" />
                        </div>
                        <h3 className="text-lg font-bold text-text-main dark:text-white mb-2">{confirmDialog.title}</h3>
                        <p className="text-text-secondary mb-6">{confirmDialog.message}</p>
                        <div className="flex gap-3">
                            <button onClick={() => setConfirmDialog(null)} className="flex-1 py-3 bg-gray-200 dark:bg-slate-700 text-text-main dark:text-white rounded-xl font-bold hover:bg-gray-300 transition-colors">Batal</button>
                            <button onClick={confirmDialog.onConfirm} className="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors">Hapus</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
