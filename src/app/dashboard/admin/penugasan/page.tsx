'use client'

import { useEffect, useState } from 'react'
import { Modal, Button, PageHeader, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import { AssignmentWizard } from '@/components/AssignmentWizard'
import {
    Document as BookOpen, AddUser as UserPlus, User, Delete as Trash2, Edit,
    InfoCircle as AlertCircle, ChevronDown, ChevronUp, Home as School, ChevronRight
} from 'react-iconly'
import { Loader2, X, HeartHandshake, Save, Check, Copy } from 'lucide-react'
import { AcademicYear, Class, Subject } from '@/lib/types'

interface Teacher {
    id: string
    nip: string | null
    user: { id: string; username: string; full_name: string | null }
}

interface TeacherGrouped {
    teacher: {
        id: string
        nip: string | null
        name: string
    }
    subjects: Array<{
        subject: { id: string; name: string }
        classes: Array<{ id: string; name: string; school_level: string; grade_level: number }>
    }>
    total_classes: number
    assignment_ids: string[]
}

interface ExistingAssignment {
    teacher_id: string
    subject_id: string
    class_id: string
    teacher_name?: string
}

export default function PenugasanPage() {
    const [teacherGroups, setTeacherGroups] = useState<TeacherGrouped[]>([])
    const [teachers, setTeachers] = useState<Teacher[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [classes, setClasses] = useState<Class[]>([])
    const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
    const [selectedYearId, setSelectedYearId] = useState<string>('')
    const [loading, setLoading] = useState(true)
    const [showWizard, setShowWizard] = useState(false)
    const [editMode, setEditMode] = useState<{
        teacherId: string
        subjectId: string
        selectedClassIds: string[]
    } | undefined>(undefined)
    const [expandedTeachers, setExpandedTeachers] = useState<Set<string>>(new Set())
    const [deleting, setDeleting] = useState<string | null>(null)
    const [searchTeacher, setSearchTeacher] = useState('')
    const [showUnassignedModal, setShowUnassignedModal] = useState(false)
    const [activeTab, setActiveTab] = useState<'mengajar' | 'wali'>('mengajar')
    const [waliKelasMap, setWaliKelasMap] = useState<Record<string, string>>({})
    const [savingWali, setSavingWali] = useState<string | null>(null)
    const [editingWali, setEditingWali] = useState<Set<string>>(new Set())
    const [copyingClasses, setCopyingClasses] = useState(false)
    // Track the "saved" state per class (what the DB actually has)
    const [savedWaliMap, setSavedWaliMap] = useState<Record<string, string>>({})

    const fetchData = async () => {
        try {
            setLoading(true)
            const [teachersRes, subjectsRes, classesRes, yearsRes] = await Promise.all([
                fetch('/api/teachers'),
                fetch('/api/subjects'),
                fetch('/api/classes'),
                fetch('/api/academic-years')
            ])
            const [teachersData, subjectsData, classesData, yearsData] = await Promise.all([
                teachersRes.json(),
                subjectsRes.json(),
                classesRes.json(),
                yearsRes.json()
            ])
            setTeachers(teachersData)
            setSubjects(subjectsData)
            setClasses(classesData)
            setAcademicYears(yearsData)

            // Set default to active year
            const activeYear = yearsData.find((y: AcademicYear) => y.is_active)
            if (activeYear && !selectedYearId) {
                setSelectedYearId(activeYear.id)
            }
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchAssignments = async () => {
        if (!selectedYearId) return
        try {
            const res = await fetch(`/api/teaching-assignments/by-teacher?academic_year_id=${selectedYearId}`)
            const data = await res.json()
            setTeacherGroups(Array.isArray(data) ? data : [])
        } catch (error) {
            console.error('Error fetching assignments:', error)
            setTeacherGroups([])
        }
    }

    useEffect(() => { fetchData() }, [])
    useEffect(() => {
        if (selectedYearId) fetchAssignments()
    }, [selectedYearId])

    // Initialize wali kelas map when classes load
    useEffect(() => {
        const map: Record<string, string> = {}
        const saved: Record<string, string> = {}
        classes.forEach((cls: any) => {
            if (cls.homeroom_teacher?.id) {
                map[cls.id] = cls.homeroom_teacher.id
                saved[cls.id] = cls.homeroom_teacher.id
            }
        })
        setWaliKelasMap(map)
        setSavedWaliMap(saved)
        // Classes that already have a wali assigned start in "locked" (non-editing) mode
        setEditingWali(new Set())
    }, [classes])

    const handleSaveWali = async (classId: string) => {
        setSavingWali(classId)
        try {
            const teacherId = waliKelasMap[classId] || null
            const cls = classes.find(c => c.id === classId)
            if (!cls) return

            await fetch(`/api/classes/${classId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: cls.name,
                    academic_year_id: cls.academic_year_id,
                    grade_level: cls.grade_level,
                    school_level: cls.school_level,
                    homeroom_teacher_id: teacherId
                })
            })
            // Update saved state to reflect the new DB truth
            setSavedWaliMap(prev => {
                const next = { ...prev }
                if (teacherId) {
                    next[classId] = teacherId
                } else {
                    delete next[classId]
                }
                return next
            })
            // Exit editing mode for this class
            setEditingWali(prev => {
                const next = new Set(prev)
                next.delete(classId)
                return next
            })
        } catch (error) {
            console.error('Error saving wali kelas:', error)
        } finally {
            setSavingWali(null)
        }
    }

    const handleCancelEditWali = (classId: string) => {
        // Revert to saved value
        setWaliKelasMap(prev => ({
            ...prev,
            [classId]: savedWaliMap[classId] || ''
        }))
        setEditingWali(prev => {
            const next = new Set(prev)
            next.delete(classId)
            return next
        })
    }

    // Get teachers already assigned as wali in OTHER classes
    const getAssignedTeacherIds = (currentClassId: string): Set<string> => {
        const assigned = new Set<string>()
        Object.entries(waliKelasMap).forEach(([classId, teacherId]) => {
            if (classId !== currentClassId && teacherId) {
                assigned.add(teacherId)
            }
        })
        return assigned
    }

    // Calculate stats
    const totalSlots = classes.length * subjects.length
    const assignedCount = teacherGroups.reduce((sum, g) => sum + g.total_classes, 0)
    const unassignedTeachers = teacherGroups.filter(g => g.total_classes === 0)

    // Build existing assignments for conflict detection
    const existingAssignments: ExistingAssignment[] = teacherGroups.flatMap(group =>
        group.subjects.flatMap(subj =>
            subj.classes.map(cls => ({
                teacher_id: group.teacher.id,
                subject_id: subj.subject.id,
                class_id: cls.id,
                teacher_name: group.teacher.name
            }))
        )
    )

    // Calculate unassigned class+subject slots
    const assignedSlots = new Set(
        existingAssignments.map(a => `${a.class_id}-${a.subject_id}`)
    )
    const unassignedSlots = classes.flatMap(cls =>
        subjects.map(subj => ({
            classId: cls.id,
            className: cls.name,
            schoolLevel: cls.school_level,
            subjectId: subj.id,
            subjectName: subj.name
        }))
    ).filter(slot => !assignedSlots.has(`${slot.classId}-${slot.subjectId}`))

    const toggleExpanded = (teacherId: string) => {
        const newExpanded = new Set(expandedTeachers)
        if (newExpanded.has(teacherId)) {
            newExpanded.delete(teacherId)
        } else {
            newExpanded.add(teacherId)
        }
        setExpandedTeachers(newExpanded)
    }

    const handleEdit = (teacherId: string, subjectId: string) => {
        const group = teacherGroups.find(g => g.teacher.id === teacherId)
        const subjectData = group?.subjects.find(s => s.subject.id === subjectId)
        if (subjectData) {
            setEditMode({
                teacherId,
                subjectId,
                selectedClassIds: subjectData.classes.map(c => c.id)
            })
            setShowWizard(true)
        }
    }

    const handleDeleteSubject = async (teacherId: string, subjectId: string) => {
        if (!confirm('Hapus semua penugasan untuk mapel ini?')) return
        setDeleting(`${teacherId}-${subjectId}`)
        try {
            await fetch('/api/teaching-assignments/bulk', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    teacher_id: teacherId,
                    subject_id: subjectId,
                    academic_year_id: selectedYearId
                })
            })
            fetchAssignments()
        } finally {
            setDeleting(null)
        }
    }

    const handleDeleteAll = async (teacherId: string) => {
        if (!confirm('Hapus SEMUA penugasan untuk guru ini?')) return
        setDeleting(teacherId)
        try {
            await fetch('/api/teaching-assignments/bulk', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    teacher_id: teacherId,
                    academic_year_id: selectedYearId
                })
            })
            fetchAssignments()
        } finally {
            setDeleting(null)
        }
    }

    const openAddNew = (preSelectedTeacherId?: string) => {
        if (preSelectedTeacherId) {
            // Pre-select teacher and skip to step 2
            setEditMode({
                teacherId: preSelectedTeacherId,
                subjectId: '',
                selectedClassIds: []
            })
        } else {
            setEditMode(undefined)
        }
        setShowWizard(true)
    }

    // Copy classes from another year to the selected year
    const handleCopyClasses = async () => {
        if (!selectedYearId) return
        // Find the most recent completed year, or any other year that has classes
        const otherYears = academicYears.filter(y => y.id !== selectedYearId)
        const sourceYear = otherYears.find(y => y.status === 'COMPLETED') || otherYears[0]
        if (!sourceYear) { alert('Tidak ada tahun ajaran lain untuk disalin'); return }

        setCopyingClasses(true)
        try {
            const res = await fetch('/api/classes/copy-classes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from_year_id: sourceYear.id, to_year_id: selectedYearId })
            })
            const data = await res.json()
            if (res.ok && data.copied > 0) {
                // Refresh classes
                const classesRes = await fetch('/api/classes')
                const classesData = await classesRes.json()
                setClasses(classesData)
            } else if (res.ok && data.copied === 0) {
                alert('Semua kelas sudah ada di tahun ini')
            } else {
                alert(`Error: ${data.error}`)
            }
        } catch { alert('Terjadi error') } finally { setCopyingClasses(false) }
    }

    // Filter classes for active year
    const filteredClasses = classes.filter((c: any) =>
        !selectedYearId || c.academic_year_id === selectedYearId
    )

    return (
        <div className="space-y-6">
            <PageHeader
                title="Penugasan"
                subtitle="Assign guru ke kelas, mata pelajaran, dan wali kelas"
                backHref="/dashboard/admin"
                icon={<div className="text-teal-500"><BookOpen set="bold" primaryColor="currentColor" size={24} /></div>}
                action={
                    activeTab === 'mengajar' ? (
                        <Button onClick={() => openAddNew()} icon={<UserPlus set="bold" primaryColor="currentColor" size={16} />}>
                            Tambah Penugasan
                        </Button>
                    ) : undefined
                }
            />

            {/* Tab Navigation */}
            <div className="flex gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-1.5">
                <button
                    onClick={() => setActiveTab('mengajar')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'mengajar'
                        ? 'bg-white dark:bg-surface-dark text-primary shadow-md'
                        : 'text-text-secondary hover:text-text-main dark:hover:text-white'
                        }`}
                >
                    <BookOpen set="bold" primaryColor="currentColor" size={16} />
                    Penugasan Mengajar
                </button>
                <button
                    onClick={() => setActiveTab('wali')}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'wali'
                        ? 'bg-white dark:bg-surface-dark text-primary shadow-md'
                        : 'text-text-secondary hover:text-text-main dark:hover:text-white'
                        }`}
                >
                    <HeartHandshake className="w-4 h-4" />
                    Wali Kelas
                </button>
            </div>

            {activeTab === 'mengajar' && (<>
                {/* Year Filter & Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Year Selector */}
                    <Card className="p-4">
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">
                            Tahun Ajaran
                        </label>
                        <div className="relative">
                            <select
                                value={selectedYearId}
                                onChange={(e) => setSelectedYearId(e.target.value)}
                                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 appearance-none"
                            >
                                <option value="">Pilih Tahun</option>
                                {academicYears.map((y) => (
                                    <option key={y.id} value={y.id}>
                                        {y.name} {y.is_active && '(Aktif)'}
                                    </option>
                                ))}
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">▼</div>
                        </div>
                    </Card>

                    {/* Stats */}
                    <Card className="p-4 bg-gradient-to-br from-blue-500/10 to-blue-600/5">
                        <div className="text-sm text-text-secondary dark:text-zinc-400">Total Guru</div>
                        <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{teacherGroups.length}</div>
                    </Card>

                    <Card className="p-4 bg-gradient-to-br from-green-500/10 to-green-600/5">
                        <div className="text-sm text-text-secondary dark:text-zinc-400">Penugasan</div>
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">{assignedCount}</div>
                    </Card>

                    {/* Clickable Card - Unassigned Slots */}
                    <button
                        onClick={() => setShowUnassignedModal(true)}
                        disabled={unassignedSlots.length === 0}
                        className="text-left p-4 bg-gradient-to-br from-red-500/10 to-red-600/5 rounded-2xl border border-red-500/20 hover:border-red-500/40 hover:shadow-lg hover:shadow-red-500/10 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm text-text-secondary dark:text-zinc-400">Kelas Belum Ada Guru</div>
                                <div className="text-2xl font-bold text-red-600 dark:text-red-400">{unassignedSlots.length}</div>
                            </div>
                            <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center group-hover:bg-red-500/20 transition-colors">
                                <ChevronRight set="bold" primaryColor="currentColor" size={20} />
                            </div>
                        </div>
                        {unassignedSlots.length > 0 && (
                            <div className="text-xs text-red-500/70 mt-1">Klik untuk lihat detail →</div>
                        )}
                    </button>
                </div>

                {/* Unassigned Slots Modal */}
                {showUnassignedModal && (
                    <div className="fixed inset-0 bg-background-dark/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
                        <div className="bg-white dark:bg-surface-dark border border-secondary/20 dark:border-white/5 rounded-3xl p-6 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h2 className="text-xl font-bold text-text-main dark:text-white">🚨 Kelas Belum Ada Guru</h2>
                                    <p className="text-sm text-text-secondary dark:text-zinc-400">{unassignedSlots.length} slot kelas-mapel belum diassign</p>
                                </div>
                                <button
                                    onClick={() => setShowUnassignedModal(false)}
                                    className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-text-secondary hover:text-primary-dark transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            <div className="overflow-y-auto flex-1 space-y-2">
                                {subjects.map(subject => {
                                    const unassignedForSubject = unassignedSlots.filter(s => s.subjectId === subject.id)
                                    if (unassignedForSubject.length === 0) return null

                                    return (
                                        <div key={subject.id} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="font-bold text-text-main dark:text-white flex items-center gap-2">
                                                    <BookOpen set="bold" primaryColor="currentColor" size={16} />
                                                    {subject.name}
                                                </span>
                                                <span className="text-xs text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full">
                                                    {unassignedForSubject.length} kelas kosong
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {unassignedForSubject.map(slot => (
                                                    <span
                                                        key={`${slot.classId}-${slot.subjectId}`}
                                                        className={`px-2 py-1 rounded-lg text-xs font-medium ${slot.schoolLevel === 'SMP'
                                                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                                                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                                            }`}
                                                    >
                                                        {slot.className}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            <div className="pt-4 border-t border-slate-200 dark:border-slate-700 mt-4">
                                <Button onClick={() => { setShowUnassignedModal(false); openAddNew() }} className="w-full">
                                    <UserPlus set="bold" primaryColor="currentColor" size={16} />
                                    Mulai Assign Guru
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Search Bar */}
                <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    </div>
                    <input
                        type="text"
                        placeholder="Cari nama guru..."
                        value={searchTeacher}
                        onChange={(e) => setSearchTeacher(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 text-sm shadow-sm"
                    />
                </div>

                {/* Teacher Cards */}
                <Card className="overflow-hidden p-0">
                    {loading ? (
                        <div className="p-12 flex justify-center">
                            <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        </div>
                    ) : !selectedYearId ? (
                        <div className="p-6">
                            <EmptyState
                                icon={<div className="text-teal-200"><BookOpen set="bold" primaryColor="currentColor" size={48} /></div>}
                                title="Pilih Tahun Ajaran"
                                description="Pilih tahun ajaran untuk melihat penugasan"
                            />
                        </div>
                    ) : teacherGroups.length === 0 ? (
                        <div className="p-6">
                            <EmptyState
                                icon={<div className="text-teal-200"><School set="bold" primaryColor="currentColor" size={48} /></div>}
                                title="Belum Ada Guru"
                                description="Tambahkan guru terlebih dahulu"
                            />
                        </div>
                    ) : (
                        <div className="divide-y divide-secondary/10">
                            {teacherGroups.filter(group => {
                                if (!searchTeacher.trim()) return true
                                return group.teacher.name.toLowerCase().includes(searchTeacher.toLowerCase())
                            }).map((group) => {
                                const isExpanded = expandedTeachers.has(group.teacher.id)
                                const hasAssignments = group.total_classes > 0

                                return (
                                    <div key={group.teacher.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                        {/* Teacher Header */}
                                        <div className="flex items-center gap-4 p-4">
                                            <div
                                                onClick={() => hasAssignments && toggleExpanded(group.teacher.id)}
                                                className={`flex-1 flex items-center gap-4 ${hasAssignments ? 'cursor-pointer' : ''}`}
                                            >
                                                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-white ${hasAssignments
                                                    ? 'bg-gradient-to-r from-indigo-500 to-violet-500'
                                                    : 'bg-amber-500'
                                                    }`}>
                                                    {group.teacher.name[0]?.toUpperCase() || <User set="bold" primaryColor="currentColor" size={20} />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-bold text-text-main dark:text-white">
                                                        {group.teacher.name}
                                                    </div>
                                                    <div className="text-sm text-text-secondary dark:text-zinc-400">
                                                        {hasAssignments ? (
                                                            <span>
                                                                {group.subjects.length} mapel • {group.total_classes} kelas
                                                            </span>
                                                        ) : (
                                                            <span className="text-amber-600 dark:text-amber-400">
                                                                ⚠️ Belum ada penugasan
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            {hasAssignments ? (
                                                <button
                                                    onClick={() => toggleExpanded(group.teacher.id)}
                                                    className="p-2.5 bg-primary/10 hover:bg-primary/20 rounded-xl transition-all"
                                                >
                                                    {isExpanded
                                                        ? <ChevronUp set="bold" primaryColor="currentColor" size={20} />
                                                        : <ChevronDown set="bold" primaryColor="currentColor" size={20} />
                                                    }
                                                </button>
                                            ) : (
                                                <Button size="sm" onClick={() => openAddNew(group.teacher.id)}>
                                                    Assign
                                                </Button>
                                            )}
                                        </div>

                                        {/* Expanded Details */}
                                        {isExpanded && hasAssignments && (
                                            <div className="px-4 pb-4 space-y-3">
                                                {group.subjects.map((subj) => (
                                                    <div
                                                        key={subj.subject.id}
                                                        className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3"
                                                    >
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className="px-3 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-full text-xs font-bold border border-green-500/20">
                                                                📖 {subj.subject.name}
                                                            </span>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    onClick={() => handleEdit(group.teacher.id, subj.subject.id)}
                                                                    className="p-2 rounded-lg bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 transition-colors"
                                                                    title="Edit"
                                                                >
                                                                    <Edit set="bold" primaryColor="currentColor" size={16} />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteSubject(group.teacher.id, subj.subject.id)}
                                                                    disabled={deleting === `${group.teacher.id}-${subj.subject.id}`}
                                                                    className="p-2 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                                                                    title="Hapus"
                                                                >
                                                                    <Trash2 set="bold" primaryColor="currentColor" size={16} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {subj.classes.map((cls) => (
                                                                <span
                                                                    key={cls.id}
                                                                    className={`px-2 py-1 rounded-lg text-xs font-medium ${cls.school_level === 'SMP'
                                                                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                                                                        : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                                                        }`}
                                                                >
                                                                    {cls.name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}

                                                {/* Action Buttons */}
                                                <div className="flex justify-between items-center pt-3">
                                                    <button
                                                        onClick={() => openAddNew(group.teacher.id)}
                                                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary to-teal-500 text-white rounded-xl shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 hover:scale-[1.02] transition-all font-bold text-sm"
                                                    >
                                                        <BookOpen set="bold" primaryColor="currentColor" size={16} />
                                                        + Tambah Mapel Lain
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteAll(group.teacher.id)}
                                                        disabled={deleting === group.teacher.id}
                                                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                                                    >
                                                        <Trash2 set="bold" primaryColor="currentColor" size={16} />
                                                        Hapus Semua
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </Card>

                {/* Assignment Wizard */}
                <AssignmentWizard
                    open={showWizard}
                    onClose={() => {
                        setShowWizard(false)
                        setEditMode(undefined)
                    }}
                    onSuccess={fetchAssignments}
                    teachers={teachers}
                    subjects={subjects}
                    classes={classes}
                    existingAssignments={existingAssignments}
                    academicYearId={selectedYearId}
                    editMode={editMode}
                />
            </>)}

            {/* ===== WALI KELAS TAB ===== */}
            {activeTab === 'wali' && (
                <>
                    {/* Year Selector for Wali Kelas */}
                    <Card className="p-4">
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">
                            Tahun Ajaran
                        </label>
                        <div className="relative">
                            <select
                                value={selectedYearId}
                                onChange={(e) => setSelectedYearId(e.target.value)}
                                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 appearance-none"
                            >
                                <option value="">Pilih Tahun</option>
                                {academicYears.map((y) => (
                                    <option key={y.id} value={y.id}>
                                        {y.name} {y.is_active && '(Aktif)'}
                                    </option>
                                ))}
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">▼</div>
                        </div>
                    </Card>

                    <Card className="overflow-hidden p-0">
                        {loading ? (
                            <div className="p-12 flex justify-center">
                                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                            </div>
                        ) : !selectedYearId ? (
                            <div className="p-6">
                                <EmptyState
                                    icon={<HeartHandshake className="w-12 h-12 text-teal-200" />}
                                    title="Pilih Tahun Ajaran"
                                    description="Pilih tahun ajaran untuk mengatur wali kelas"
                                />
                            </div>
                        ) : filteredClasses.length === 0 ? (
                            <div className="p-6">
                                <EmptyState
                                    icon={<div className="text-teal-200"><School set="bold" primaryColor="currentColor" size={48} /></div>}
                                    title="Belum Ada Kelas di Tahun Ini"
                                    description="Salin kelas dari tahun ajaran sebelumnya agar bisa mengatur wali kelas"
                                    action={
                                        <Button onClick={handleCopyClasses} loading={copyingClasses}>
                                            <Copy className="w-4 h-4 mr-1" />
                                            Salin Kelas dari Tahun Sebelumnya
                                        </Button>
                                    }
                                />
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-200 dark:divide-slate-700">
                                {/* Header */}
                                <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 bg-slate-50 dark:bg-slate-800/50">
                                    <div className="col-span-4 text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Kelas</div>
                                    <div className="col-span-5 text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Wali Kelas</div>
                                    <div className="col-span-3 text-sm font-bold text-text-main dark:text-white uppercase tracking-wider text-right">Aksi</div>
                                </div>

                                {filteredClasses.map((cls: any) => {
                                    const currentWali = waliKelasMap[cls.id] || ''
                                    const savedVal = savedWaliMap[cls.id] || ''
                                    const hasSavedWali = !!savedVal
                                    const isEditing = editingWali.has(cls.id)
                                    const hasChanged = currentWali !== savedVal
                                    const isSaving = savingWali === cls.id
                                    const assignedElsewhere = getAssignedTeacherIds(cls.id)

                                    // Find the teacher object for display
                                    const assignedTeacher = currentWali
                                        ? teachers.find(t => t.id === currentWali)
                                        : null

                                    // Determine if row is in "locked" (view) mode
                                    const isLocked = hasSavedWali && !isEditing

                                    return (
                                        <div key={cls.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 px-4 md:px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors items-center">
                                            {/* Class info */}
                                            <div className="md:col-span-4 flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white ${cls.school_level === 'SMP'
                                                    ? 'bg-gradient-to-br from-blue-500 to-blue-600'
                                                    : 'bg-gradient-to-br from-emerald-500 to-emerald-600'
                                                    }`}>
                                                    {cls.grade_level || '?'}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-text-main dark:text-white">{cls.name}</div>
                                                    <div className="text-xs text-text-secondary">
                                                        {cls.school_level || '-'} • Tingkat {cls.grade_level || '-'}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Teacher display / dropdown */}
                                            <div className="md:col-span-5">
                                                {isLocked ? (
                                                    // Locked state: show teacher name as badge
                                                    <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl">
                                                        <div className="w-7 h-7 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 flex items-center justify-center text-white text-xs font-bold">
                                                            {(assignedTeacher?.user?.full_name || '?')[0]?.toUpperCase()}
                                                        </div>
                                                        <div className="flex-1">
                                                            <span className="text-sm font-bold text-text-main dark:text-white">
                                                                {assignedTeacher?.user?.full_name || assignedTeacher?.user?.username || '-'}
                                                            </span>
                                                            {assignedTeacher?.nip && (
                                                                <span className="text-xs text-text-secondary ml-1.5">({assignedTeacher.nip})</span>
                                                            )}
                                                        </div>
                                                        <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                                                    </div>
                                                ) : (
                                                    // Editing state: show dropdown
                                                    <div className="relative">
                                                        <select
                                                            value={currentWali}
                                                            onChange={(e) => setWaliKelasMap(prev => ({
                                                                ...prev,
                                                                [cls.id]: e.target.value
                                                            }))}
                                                            className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 appearance-none transition-colors ${hasChanged
                                                                ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/30 text-slate-900 dark:text-white'
                                                                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white'
                                                                }`}
                                                        >
                                                            <option value="">— Belum ada wali kelas —</option>
                                                            {teachers
                                                                .filter(t => !assignedElsewhere.has(t.id) || t.id === currentWali)
                                                                .sort((a, b) => (a.user.full_name || a.user.username).localeCompare(b.user.full_name || b.user.username))
                                                                .map((t) => (
                                                                    <option key={t.id} value={t.id}>
                                                                        {t.user.full_name || t.user.username} {t.nip ? `(${t.nip})` : ''}
                                                                    </option>
                                                                ))}
                                                        </select>
                                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">▼</div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Action buttons */}
                                            <div className="md:col-span-3 flex justify-end gap-2">
                                                {isLocked ? (
                                                    // Locked: show Edit button
                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        onClick={() => setEditingWali(prev => new Set(prev).add(cls.id))}
                                                        icon={<Edit set="bold" primaryColor="currentColor" size={16} />}
                                                    >
                                                        Edit
                                                    </Button>
                                                ) : (
                                                    // Editing: show Save + Cancel
                                                    <>
                                                        {hasSavedWali && (
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                onClick={() => handleCancelEditWali(cls.id)}
                                                                icon={<X className="w-4 h-4" />}
                                                            >
                                                                Batal
                                                            </Button>
                                                        )}
                                                        <Button
                                                            size="sm"
                                                            onClick={() => handleSaveWali(cls.id)}
                                                            loading={isSaving}
                                                            disabled={!hasChanged && !(!savedVal && !currentWali)}
                                                            variant={hasChanged ? 'primary' : 'secondary'}
                                                            icon={<Save className="w-4 h-4" />}
                                                        >
                                                            Simpan
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </Card>
                </>
            )}
        </div>
    )
}
