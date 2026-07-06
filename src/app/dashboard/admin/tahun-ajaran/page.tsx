'use client'

import { useEffect, useState } from 'react'
import { Modal, Button, PageHeader, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import Link from 'next/link'
import {
    Calendar, Plus, TickSquare as CheckCircle, TimeCircle as Clock,
    Play as PlayCircle, Danger as AlertTriangle, Delete as Trash2, Edit,
    ArrowRight, Document as GraduationCap, ChevronDown
} from 'react-iconly'
import { Loader2, Copy, Sparkles, RefreshCw, ExternalLink, ChevronUp } from 'lucide-react'
import { AcademicYear, AcademicYearStatus } from '@/lib/types'

interface FormData {
    name: string
    start_date: string
    end_date: string
    status: AcademicYearStatus
    is_active: boolean
}

interface RelatedData {
    classes: { count: number; names: string[] }
    teaching_assignments: number
    student_enrollments: number
    materials: number
    assignments: number
    quizzes: number
    exams: number
    submissions: number
    quiz_submissions: number
    exam_submissions: number
    total: number
}

interface StepStatus {
    completed: boolean
    loading: boolean
    detail: string
}

const defaultFormData: FormData = {
    name: '',
    start_date: '',
    end_date: '',
    status: 'PLANNED',
    is_active: false
}

export default function TahunAjaranPage() {
    const [years, setYears] = useState<AcademicYear[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [showCompleteModal, setShowCompleteModal] = useState(false)
    const [completingYear, setCompletingYear] = useState<AcademicYear | null>(null)
    const [editingYear, setEditingYear] = useState<AcademicYear | null>(null)
    const [formData, setFormData] = useState<FormData>(defaultFormData)
    const [saving, setSaving] = useState(false)

    // Delete confirmation states
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [showFinalDeleteModal, setShowFinalDeleteModal] = useState(false)
    const [deletingYear, setDeletingYear] = useState<AcademicYear | null>(null)
    const [relatedData, setRelatedData] = useState<RelatedData | null>(null)
    const [loadingRelated, setLoadingRelated] = useState(false)
    const [deleting, setDeleting] = useState(false)

    // === Pergantian Tahun Wizard States ===
    const [showWizard, setShowWizard] = useState(false)
    const [steps, setSteps] = useState<StepStatus[]>([
        { completed: false, loading: false, detail: '' },
        { completed: false, loading: false, detail: '' },
        { completed: false, loading: false, detail: '' },
        { completed: false, loading: false, detail: '' },
    ])
    const [wizardCompletingYear, setWizardCompletingYear] = useState(false)
    const [newYearName, setNewYearName] = useState('')
    const [creatingYear, setCreatingYear] = useState(false)
    const [copyingAssignments, setCopyingAssignments] = useState(false)
    const [copyResult, setCopyResult] = useState<{ copied: number; skipped: number; total: number } | null>(null)
    const [sourceYearId, setSourceYearId] = useState<string>('')
    const [copyingWali, setCopyingWali] = useState(false)
    const [copyWaliResult, setCopyWaliResult] = useState<{ copied: number; skipped: number; total: number } | null>(null)
    const [copyingClasses, setCopyingClasses] = useState(false)
    const [activeYearClassCount, setActiveYearClassCount] = useState<number | null>(null)

    // Wizard confirmation modal states
    const [showWizardCompleteModal, setShowWizardCompleteModal] = useState(false)
    const [wizardRelatedData, setWizardRelatedData] = useState<RelatedData | null>(null)
    const [loadingWizardRelated, setLoadingWizardRelated] = useState(false)
    const [wizardChecklist, setWizardChecklist] = useState<boolean[]>([false, false, false, false])
    const [showWizardCreateModal, setShowWizardCreateModal] = useState(false)
    const [wizardCreateChecklist, setWizardCreateChecklist] = useState<boolean[]>([false, false, false])

    const activeYear = years.find(y => y.is_active)
    const completedYears = years.filter(y => y.status === 'COMPLETED').sort((a, b) =>
        new Date(b.end_date || b.created_at).getTime() - new Date(a.end_date || a.created_at).getTime()
    )
    const lastCompletedYear = completedYears[0]

    const fetchYears = async () => {
        try {
            const res = await fetch('/api/academic-years')
            const data = await res.json()
            setYears(Array.isArray(data) ? data : [])
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchYears() }, [])

    // Auto-detect wizard status
    useEffect(() => {
        if (loading || years.length === 0) return
        detectStepStatuses()
    }, [years, loading])

    const detectStepStatuses = async () => {
        const newSteps = [...steps]
        const hasCompletedYear = completedYears.length > 0
        const hasActiveYear = !!activeYear

        newSteps[0] = {
            completed: hasCompletedYear,
            loading: false,
            detail: hasCompletedYear
                ? `✅ ${lastCompletedYear?.name} sudah diselesaikan`
                : hasActiveYear
                    ? `⏳ ${activeYear?.name} masih aktif`
                    : '⚠️ Tidak ada tahun ajaran'
        }

        // Check if classes exist in active year
        let classCount = 0
        if (hasActiveYear) {
            try {
                const classRes = await fetch(`/api/classes?academic_year_id=${activeYear?.id}`)
                const classData = await classRes.json()
                classCount = Array.isArray(classData) ? classData.length : 0
                setActiveYearClassCount(classCount)
            } catch {
                setActiveYearClassCount(0)
            }
        }

        newSteps[1] = {
            completed: hasActiveYear && hasCompletedYear,
            loading: false,
            detail: hasActiveYear && hasCompletedYear
                ? `✅ ${activeYear?.name} sudah aktif`
                : hasActiveYear && !hasCompletedYear
                    ? `⏳ Selesaikan tahun lama dulu`
                    : '⬜ Buat tahun ajaran baru'
        }

        if (hasActiveYear && hasCompletedYear) {
            try {
                const enrollRes = await fetch(`/api/students?enrollment_year_id=${activeYear?.id}`)
                const enrollData = await enrollRes.json()
                const enrollCount = Array.isArray(enrollData) ? enrollData.length : 0
                newSteps[2] = {
                    completed: enrollCount > 0, loading: false,
                    detail: enrollCount > 0
                        ? `✅ ${enrollCount} siswa sudah terdaftar di ${activeYear?.name}`
                        : '⬜ Proses kenaikan kelas dari tahun sebelumnya'
                }
            } catch {
                newSteps[2] = { completed: false, loading: false, detail: '⬜ Proses kenaikan kelas jika belum' }
            }
        } else if (hasActiveYear) {
            newSteps[2] = { completed: false, loading: false, detail: '⏳ Selesaikan langkah 1 & 2 dulu' }
        } else {
            newSteps[2] = { completed: false, loading: false, detail: '⏳ Buat tahun ajaran baru dulu' }
        }

        if (hasActiveYear) {
            try {
                const taRes = await fetch(`/api/teaching-assignments?academic_year_id=${activeYear?.id}`)
                const taData = await taRes.json()
                const count = Array.isArray(taData) ? taData.length : 0
                newSteps[3] = {
                    completed: count > 0, loading: false,
                    detail: count > 0
                        ? `✅ ${count} penugasan sudah ada di ${activeYear?.name}`
                        : '⬜ Belum ada penugasan — salin dari tahun lalu'
                }
            } catch {
                newSteps[3] = { completed: false, loading: false, detail: '⬜ Cek penugasan mengajar' }
            }
        } else {
            newSteps[3] = { completed: false, loading: false, detail: '⏳ Buat tahun ajaran baru dulu' }
        }

        setSteps(newSteps)
    }

    // === CRUD Handlers ===
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const url = editingYear ? `/api/academic-years/${editingYear.id}` : '/api/academic-years'
            const method = editingYear ? 'PUT' : 'POST'

            // Force active if it's the very first academic year being created
            const isFirstYear = years.length === 0 && !editingYear;
            const finalStatus = isFirstYear ? 'ACTIVE' : formData.status;

            const submitData = {
                ...formData,
                status: finalStatus,
                is_active: finalStatus === 'ACTIVE'
            }

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(submitData)
            })

            if (res.ok) {
                setShowModal(false)
                setEditingYear(null)
                setFormData(defaultFormData)
                fetchYears()
            }
        } finally {
            setSaving(false)
        }
    }

    const handleComplete = async () => {
        if (!completingYear) return
        setSaving(true)
        try {
            const res = await fetch(`/api/academic-years/${completingYear.id}/complete`, { method: 'PUT' })
            if (res.ok) {
                setShowCompleteModal(false)
                setCompletingYear(null)
                fetchYears()
            }
        } finally {
            setSaving(false)
        }
    }

    const openDeleteConfirm = async (year: AcademicYear) => {
        setDeletingYear(year)
        setRelatedData(null)
        setShowDeleteModal(true)
        setLoadingRelated(true)
        try {
            const res = await fetch(`/api/academic-years/${year.id}/related`)
            const data = await res.json()
            setRelatedData(data)
        } catch (error) {
            console.error('Error fetching related data:', error)
        } finally {
            setLoadingRelated(false)
        }
    }

    const proceedToFinalConfirm = () => {
        setShowDeleteModal(false)
        setShowFinalDeleteModal(true)
    }

    const executeDelete = async () => {
        if (!deletingYear) return
        setDeleting(true)
        try {
            const res = await fetch(`/api/academic-years/${deletingYear.id}`, { method: 'DELETE' })
            if (res.ok) {
                setShowFinalDeleteModal(false)
                setDeletingYear(null)
                setRelatedData(null)
                fetchYears()
            } else {
                const error = await res.json()
                alert('Gagal menghapus: ' + (error.error || 'Terjadi kesalahan'))
            }
        } catch (error) {
            console.error('Error deleting:', error)
            alert('Gagal menghapus tahun ajaran')
        } finally {
            setDeleting(false)
        }
    }

    const cancelDelete = () => {
        setShowDeleteModal(false)
        setShowFinalDeleteModal(false)
        setDeletingYear(null)
        setRelatedData(null)
    }

    const openEdit = (year: AcademicYear) => {
        setEditingYear(year)
        setFormData({
            name: year.name,
            start_date: year.start_date || '',
            end_date: year.end_date || '',
            status: year.status || (year.is_active ? 'ACTIVE' : 'PLANNED'),
            is_active: year.is_active
        })
        setShowModal(true)
    }

    const openAdd = () => {
        setEditingYear(null)
        setFormData(defaultFormData)
        setShowModal(true)
    }

    const openComplete = (year: AcademicYear) => {
        setCompletingYear(year)
        setShowCompleteModal(true)
    }

    // === Wizard Handlers ===
    const openWizardCompleteModal = async () => {
        if (!activeYear) return
        setShowWizardCompleteModal(true)
        setWizardChecklist([false, false, false, false])
        setLoadingWizardRelated(true)
        try {
            const res = await fetch(`/api/academic-years/${activeYear.id}/related`)
            const data = await res.json()
            setWizardRelatedData(data)
        } catch { setWizardRelatedData(null) }
        finally { setLoadingWizardRelated(false) }
    }

    const executeWizardComplete = async () => {
        if (!activeYear) return
        setWizardCompletingYear(true)
        try {
            const res = await fetch(`/api/academic-years/${activeYear.id}/complete`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }
            })
            if (res.ok) {
                setShowWizardCompleteModal(false)
                await fetchData()
            } else { const err = await res.json(); alert(`Error: ${err.error}`) }
        } catch { alert('Terjadi error') } finally { setWizardCompletingYear(false) }
    }

    const allCompleteChecked = wizardChecklist.every(Boolean)

    const openWizardCreateModal = () => {
        if (!newYearName) { alert('Pilih nama tahun ajaran baru'); return }
        setWizardCreateChecklist([false, false, false])
        setShowWizardCreateModal(true)
    }

    const executeWizardCreate = async () => {
        setCreatingYear(true)
        try {
            const startDate = new Date()
            const endDate = new Date(startDate)
            endDate.setFullYear(endDate.getFullYear() + 1)

            const res = await fetch('/api/academic-years', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newYearName,
                    start_date: startDate.toISOString().split('T')[0],
                    end_date: endDate.toISOString().split('T')[0],
                    status: 'ACTIVE', is_active: true
                })
            })
            if (res.ok) {
                // Fetch fresh data from API (not stale React state)
                const updatedYears: AcademicYear[] = await (await fetch('/api/academic-years')).json()
                const newYear = updatedYears.find((y: AcademicYear) => y.is_active)
                const fromYear = updatedYears
                    .filter((y: AcademicYear) => y.status === 'COMPLETED')
                    .sort((a, b) => new Date(b.end_date || b.created_at).getTime() - new Date(a.end_date || a.created_at).getTime())[0]

                if (fromYear && newYear) {
                    try {
                        const copyRes = await fetch('/api/classes/copy-classes', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ from_year_id: fromYear.id, to_year_id: newYear.id })
                        })
                        const copyData = await copyRes.json()
                        if (copyRes.ok && copyData.copied > 0) {
                            console.log(`Auto-copied ${copyData.copied} classes to new year`)
                        } else if (!copyRes.ok) {
                            alert(`Tahun baru berhasil dibuat, tapi gagal menyalin kelas: ${copyData.error || 'Unknown error'}. Silakan salin kelas secara manual.`)
                        }
                    } catch (e) {
                        console.error('Auto-copy classes failed:', e)
                        alert('Tahun baru berhasil dibuat, tapi gagal menyalin kelas secara otomatis. Silakan salin kelas secara manual dari menu Wizard.')
                    }
                } else {
                    console.warn('No completed year found to copy classes from')
                }

                setShowWizardCreateModal(false)
                await fetchData()
                setNewYearName('')
            } else { const err = await res.json(); alert(`Error: ${err.error}`) }
        } catch { alert('Terjadi error') } finally { setCreatingYear(false) }
    }

    const allCreateChecked = wizardCreateChecklist.every(Boolean)

    const handleCopyAssignments = async () => {
        const fromId = sourceYearId || lastCompletedYear?.id
        if (!fromId || !activeYear) { alert('Tidak ada tahun sumber atau tahun aktif'); return }
        setCopyingAssignments(true)
        setCopyResult(null)
        try {
            const res = await fetch('/api/teaching-assignments/copy-assignments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from_year_id: fromId, to_year_id: activeYear.id })
            })
            const data = await res.json()
            if (res.ok) {
                setCopyResult({ copied: data.copied, skipped: data.skipped, total: data.total })
                await detectStepStatuses()
            } else { alert(`Error: ${data.error}`) }
        } catch { alert('Terjadi error') } finally { setCopyingAssignments(false) }
    }

    const handleCopyWaliKelas = async () => {
        const fromId = sourceYearId || lastCompletedYear?.id
        if (!fromId || !activeYear) { alert('Tidak ada tahun sumber atau tahun aktif'); return }
        setCopyingWali(true)
        setCopyWaliResult(null)
        try {
            // copy-classes with copy_homeroom=true will copy wali kelas assignments
            const res = await fetch('/api/classes/copy-classes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from_year_id: fromId, to_year_id: activeYear.id, copy_homeroom: true })
            })
            const data = await res.json()
            if (res.ok) {
                // For classes that already exist, update their homeroom_teacher_id
                const { data: sourceClasses } = await fetch(`/api/classes?academic_year_id=${fromId}`).then(r => r.json()).then(classes => ({ data: classes })).catch(() => ({ data: [] }))
                const { data: targetClasses } = await fetch(`/api/classes?academic_year_id=${activeYear.id}`).then(r => r.json()).then(classes => ({ data: classes })).catch(() => ({ data: [] }))

                let updatedCount = 0
                if (Array.isArray(sourceClasses) && Array.isArray(targetClasses)) {
                    for (const src of sourceClasses) {
                        if (!src.homeroom_teacher_id) continue
                        const target = targetClasses.find((t: any) =>
                            t.name === src.name && t.grade_level === src.grade_level && t.school_level === src.school_level
                        )
                        if (target && target.homeroom_teacher_id !== src.homeroom_teacher_id) {
                            const updateRes = await fetch(`/api/classes/${target.id}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    name: target.name,
                                    academic_year_id: target.academic_year_id,
                                    grade_level: target.grade_level,
                                    school_level: target.school_level,
                                    homeroom_teacher_id: src.homeroom_teacher_id
                                })
                            })
                            if (updateRes.ok) updatedCount++
                        }
                    }
                }

                const totalCopied = (data.copied || 0) + updatedCount
                setCopyWaliResult({
                    copied: totalCopied,
                    skipped: (sourceClasses?.length || 0) - totalCopied,
                    total: sourceClasses?.length || 0
                })
            } else { alert(`Error: ${data.error}`) }
        } catch { alert('Terjadi error') } finally { setCopyingWali(false) }
    }

    const fetchData = async () => { await fetchYears() }

    const getYearNameOptions = () => {
        const currentYear = new Date().getFullYear()
        const existingNames = years.map(y => y.name)
        const options: string[] = []
        for (let y = currentYear + 5; y >= currentYear - 1; y--) {
            const name = `${y}/${y + 1}`
            if (!existingNames.includes(name)) options.push(name)
        }
        return options
    }

    const getStatusBadge = (year: AcademicYear) => {
        const status = year.status || (year.is_active ? 'ACTIVE' : 'PLANNED')
        switch (status) {
            case 'ACTIVE':
                return (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-full text-xs font-bold border border-emerald-200 dark:border-emerald-800">
                        <PlayCircle set="bold" primaryColor="currentColor" size={12} />
                        Aktif
                    </span>
                )
            case 'COMPLETED':
                return (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 rounded-full text-xs font-bold border border-slate-200 dark:border-slate-700">
                        <CheckCircle set="bold" primaryColor="currentColor" size={12} />
                        Selesai
                    </span>
                )
            default:
                return (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-full text-xs font-bold border border-amber-200 dark:border-amber-800">
                        <Clock set="bold" primaryColor="currentColor" size={12} />
                        Direncanakan
                    </span>
                )
        }
    }

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '-'
        return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
    }

    const allStepsCompleted = steps.every(s => s.completed)
    const stepsCompletedCount = steps.filter(s => s.completed).length

    return (
        <div className="space-y-6">
            <PageHeader
                title="Tahun Ajaran"
                subtitle="Kelola tahun ajaran dan proses pergantian tahun"
                backHref="/dashboard/admin"
                icon={<div className="text-amber-500"><Calendar set="bold" primaryColor="currentColor" size={24} /></div>}
                action={
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => setShowWizard(!showWizard)}>
                            <RefreshCw className={`w-4 h-4 mr-1 ${showWizard ? 'animate-spin' : ''}`} />
                            Pergantian Tahun
                            {showWizard
                                ? <ChevronUp className="w-4 h-4 ml-1" />
                                : <ChevronDown set="bold" primaryColor="currentColor" size={16} />
                            }
                        </Button>
                        <Button onClick={openAdd} icon={<Plus set="bold" primaryColor="currentColor" size={20} />}>
                            Tambah
                        </Button>
                    </div>
                }
            />

            {/* ═══════════════════════════════════════
                PERGANTIAN TAHUN WIZARD (Collapsible)
               ═══════════════════════════════════════ */}
            {showWizard && (
                <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
                    {/* Status Overview */}
                    <Card className={`border-2 ${allStepsCompleted ? 'border-green-500/30 bg-green-50/50 dark:bg-green-900/10' : 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10'}`}>
                        <div className="flex items-center gap-4">
                            <div className={`flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center ${allStepsCompleted ? 'bg-green-100 dark:bg-green-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                                {allStepsCompleted
                                    ? <Sparkles className="w-6 h-6 text-green-600 dark:text-green-400" />
                                    : <RefreshCw className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                                }
                            </div>
                            <div className="flex-1">
                                <h2 className="text-base font-bold text-text-main dark:text-white">
                                    {allStepsCompleted ? '🎉 Pergantian Selesai!' : 'Proses Pergantian Tahun Ajaran'}
                                </h2>
                                <p className="text-sm text-text-secondary">{stepsCompletedCount} dari 4 langkah selesai</p>
                            </div>
                        </div>
                        <div className="mt-3 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${allStepsCompleted ? 'bg-green-500' : 'bg-amber-500'}`}
                                style={{ width: `${(stepsCompletedCount / 4) * 100}%` }}
                            />
                        </div>
                    </Card>

                    {/* Step 1: Complete Old Year */}
                    <Card className={`border-l-4 ${steps[0].completed ? 'border-l-green-500' : 'border-l-primary'}`}>
                        <div className="flex items-start gap-3">
                            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${steps[0].completed ? 'bg-green-500' : 'bg-primary'}`}>
                                {steps[0].completed ? <CheckCircle set="bold" primaryColor="currentColor" size={16} /> : '1'}
                            </div>
                            <div className="flex-1">
                                <h3 className="text-sm font-bold text-text-main dark:text-white">Selesaikan Tahun Ajaran Lama</h3>
                                <p className="text-xs text-text-secondary mt-0.5">{steps[0].detail}</p>
                                {!steps[0].completed && activeYear && (
                                    <div className="space-y-2 mt-2">
                                        <div className="flex items-center gap-2">
                                            <span className="px-3 py-1 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400">
                                                📅 {activeYear.name}
                                            </span>
                                            <Button onClick={openWizardCompleteModal}>
                                                ⚠️ Selesaikan Tahun Ini
                                            </Button>
                                        </div>
                                        <p className="text-[10px] text-amber-600 dark:text-amber-400">⚠️ Pastikan semua nilai sudah diinput dan rapor sudah dicetak sebelum melanjutkan.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>

                    {/* Step 2: Create New Year */}
                    <Card className={`border-l-4 ${steps[1].completed ? 'border-l-green-500' : steps[0].completed ? 'border-l-primary' : 'border-l-slate-300 opacity-60'}`}>
                        <div className="flex items-start gap-3">
                            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${steps[1].completed ? 'bg-green-500' : steps[0].completed ? 'bg-primary' : 'bg-gray-400'}`}>
                                {steps[1].completed ? <CheckCircle set="bold" primaryColor="currentColor" size={16} /> : '2'}
                            </div>
                            <div className="flex-1">
                                <h3 className="text-sm font-bold text-text-main dark:text-white">Buat & Aktifkan Tahun Baru</h3>
                                <p className="text-xs text-text-secondary mt-0.5">{steps[1].detail}</p>
                                {steps[1].completed && activeYearClassCount !== null && activeYearClassCount > 0 && (
                                    <p className="text-[10px] text-green-600 dark:text-green-400 mt-0.5">📋 {activeYearClassCount} kelas tersedia di tahun baru</p>
                                )}
                                {steps[1].completed && (activeYearClassCount === 0 || activeYearClassCount === null) && (
                                    <div className="mt-2">
                                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mb-1">⚠️ Belum ada kelas di tahun baru</p>
                                        <Button
                                            onClick={async () => {
                                                const fromId = sourceYearId || lastCompletedYear?.id
                                                if (!fromId || !activeYear) { alert('Tidak ada tahun sumber'); return }
                                                setCopyingClasses(true)
                                                try {
                                                    const res = await fetch('/api/classes/copy-classes', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ from_year_id: fromId, to_year_id: activeYear.id })
                                                    })
                                                    const data = await res.json()
                                                    if (res.ok) {
                                                        alert(`✅ ${data.copied} kelas berhasil disalin!`)
                                                        await detectStepStatuses()
                                                    } else {
                                                        alert(`Gagal: ${data.error}`)
                                                    }
                                                } catch { alert('Terjadi error') } finally { setCopyingClasses(false) }
                                            }}
                                            disabled={copyingClasses}
                                        >
                                            {copyingClasses ? 'Menyalin...' : '📋 Salin Kelas dari Tahun Lama'}
                                        </Button>
                                    </div>
                                )}
                                {steps[0].completed && !steps[1].completed && (
                                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                                        <select
                                            value={newYearName}
                                            onChange={(e) => setNewYearName(e.target.value)}
                                            className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white min-w-[150px]"
                                        >
                                            <option value="">Pilih tahun...</option>
                                            {getYearNameOptions().map(name => (
                                                <option key={name} value={name}>📅 {name}</option>
                                            ))}
                                        </select>
                                        <Button onClick={openWizardCreateModal} disabled={!newYearName}>
                                            Buat & Aktifkan →
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>

                    {/* Step 3: Kenaikan Kelas */}
                    <Card className={`border-l-4 ${steps[2].completed ? 'border-l-green-500' : steps[1].completed ? 'border-l-primary' : 'border-l-slate-300 opacity-60'}`}>
                        <div className="flex items-start gap-3">
                            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${steps[2].completed ? 'bg-green-500' : steps[1].completed ? 'bg-primary' : 'bg-gray-400'}`}>
                                {steps[2].completed ? <CheckCircle set="bold" primaryColor="currentColor" size={16} /> : '3'}
                            </div>
                            <div className="flex-1">
                                <h3 className="text-sm font-bold text-text-main dark:text-white">Proses Kenaikan Kelas</h3>
                                <p className="text-xs text-text-secondary mt-0.5">{steps[2].detail}</p>
                                {steps[1].completed && (
                                    <Link href="/dashboard/admin/kenaikan-kelas" className="inline-block mt-2">
                                        <Button variant="secondary">
                                            <GraduationCap set="bold" primaryColor="currentColor" size={14} />
                                            <span className="ml-1">Buka Kenaikan Kelas</span>
                                            <ExternalLink className="w-3 h-3 ml-1" />
                                        </Button>
                                    </Link>
                                )}
                            </div>
                        </div>
                    </Card>

                    {/* Step 4: Copy Assignments & Wali Kelas */}
                    <Card className={`border-l-4 ${steps[3].completed ? 'border-l-green-500' : steps[1].completed ? 'border-l-primary' : 'border-l-slate-300 opacity-60'}`}>
                        <div className="flex items-start gap-3">
                            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${steps[3].completed ? 'bg-green-500' : steps[1].completed ? 'bg-primary' : 'bg-gray-400'}`}>
                                {steps[3].completed ? <CheckCircle set="bold" primaryColor="currentColor" size={16} /> : '4'}
                            </div>
                            <div className="flex-1">
                                <h3 className="text-sm font-bold text-text-main dark:text-white">Salin Penugasan & Wali Kelas</h3>
                                <p className="text-xs text-text-secondary mt-0.5">{steps[3].detail}</p>
                                {steps[1].completed && (
                                    <div className="space-y-3 mt-2">
                                        {/* Source year selector */}
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs text-text-secondary">Dari:</span>
                                            <select
                                                value={sourceYearId || lastCompletedYear?.id || ''}
                                                onChange={(e) => setSourceYearId(e.target.value)}
                                                className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white min-w-[140px]"
                                            >
                                                {completedYears.map(y => (
                                                    <option key={y.id} value={y.id}>📅 {y.name}</option>
                                                ))}
                                            </select>
                                            <ArrowRight set="bold" primaryColor="currentColor" size={16} />
                                            <span className="px-3 py-1.5 bg-green-50 dark:bg-green-900/20 rounded-lg text-xs font-medium text-green-600 dark:text-green-400">
                                                {activeYear?.name}
                                            </span>
                                        </div>

                                        {/* Copy Penugasan */}
                                        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-bold text-text-main dark:text-white">📖 Penugasan Mengajar</span>
                                                <Button size="sm" onClick={handleCopyAssignments} disabled={copyingAssignments}>
                                                    {copyingAssignments
                                                        ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Menyalin...</>
                                                        : <><Copy className="w-3 h-3 mr-1" /> Salin Penugasan</>
                                                    }
                                                </Button>
                                            </div>
                                            {copyResult && (
                                                <div className={`p-2 rounded-lg border text-xs ${copyResult.copied > 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200'}`}>
                                                    ✅ {copyResult.copied} disalin, {copyResult.skipped} sudah ada (dari {copyResult.total} total)
                                                </div>
                                            )}
                                        </div>

                                        {/* Copy Wali Kelas */}
                                        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-bold text-text-main dark:text-white">🤝 Wali Kelas</span>
                                                <Button size="sm" onClick={handleCopyWaliKelas} disabled={copyingWali}>
                                                    {copyingWali
                                                        ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Menyalin...</>
                                                        : <><Copy className="w-3 h-3 mr-1" /> Salin Wali Kelas</>
                                                    }
                                                </Button>
                                            </div>
                                            {copyWaliResult && (
                                                <div className={`p-2 rounded-lg border text-xs ${copyWaliResult.copied > 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200'}`}>
                                                    ✅ {copyWaliResult.copied} wali kelas disalin (dari {copyWaliResult.total} kelas)
                                                </div>
                                            )}
                                        </div>

                                        <Link href="/dashboard/admin/penugasan" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                                            Buka halaman Penugasan <ExternalLink className="w-3 h-3" />
                                        </Link>
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            {/* ═══════════════════════════════
                TABLE: Daftar Tahun Ajaran
               ═══════════════════════════════ */}
            <Card className="overflow-hidden p-0">
                {loading ? (
                    <div className="p-12 flex justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                ) : years.length === 0 ? (
                    <div className="p-6">
                        <EmptyState
                            icon={<div className="text-secondary"><Calendar set="bold" primaryColor="currentColor" size={48} /></div>}
                            title="Belum Ada Tahun Ajaran"
                            description="Tambahkan tahun ajaran untuk memulai"
                            action={<Button onClick={openAdd}>Tambah Tahun Ajaran</Button>}
                        />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Nama</th>
                                    <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Periode</th>
                                    <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Status</th>
                                    <th className="px-6 py-4 text-right text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-secondary/20 dark:divide-white/5">
                                {years.map((year) => (
                                    <tr key={year.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                        <td className="px-6 py-4 text-text-main dark:text-white font-medium">{year.name}</td>
                                        <td className="px-6 py-4 text-text-secondary text-sm">
                                            {formatDate(year.start_date)} - {formatDate(year.end_date)}
                                        </td>
                                        <td className="px-6 py-4">{getStatusBadge(year)}</td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {(year.status === 'ACTIVE' || year.is_active) && (
                                                    <button
                                                        onClick={() => openComplete(year)}
                                                        className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50 text-xs font-medium transition-colors"
                                                    >
                                                        Selesaikan
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => openEdit(year)}
                                                    className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 flex items-center justify-center transition-colors"
                                                >
                                                    <Edit set="bold" primaryColor="currentColor" size={16} />
                                                </button>
                                                <button
                                                    onClick={() => openDeleteConfirm(year)}
                                                    className="w-8 h-8 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500/20 flex items-center justify-center transition-colors"
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
                )}
            </Card>

            {/* ════════════════════════
                MODALS (unchanged)
               ════════════════════════ */}

            {/* Add/Edit Modal */}
            <Modal open={showModal} onClose={() => setShowModal(false)} title={editingYear ? '✏️ Edit Tahun Ajaran' : '➕ Tambah Tahun Ajaran'}>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Nama Tahun Ajaran</label>
                        {editingYear ? (
                            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                                placeholder="Contoh: 2024/2025" required />
                        ) : (
                            <select value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all" required>
                                <option value="">Pilih tahun ajaran...</option>
                                {(() => {
                                    const currentYear = new Date().getFullYear()
                                    const existingNames = years.map(y => y.name)
                                    const options = []
                                    for (let y = currentYear + 5; y >= 2020; y--) {
                                        const name = `${y}/${y + 1}`
                                        if (!existingNames.includes(name)) options.push(<option key={name} value={name}>📅 {name}</option>)
                                    }
                                    return options
                                })()}
                            </select>
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tanggal Mulai</label>
                        <input type="date" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all" />
                        <p className="text-xs text-text-secondary mt-2">Tanggal selesai akan otomatis terisi saat tahun ajaran diselesaikan.</p>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Status</label>
                        {editingYear?.status === 'ACTIVE' || editingYear?.status === 'COMPLETED' ? (
                            <div className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-400">
                                {editingYear.status === 'ACTIVE' ? '▶️ Aktif' : '✅ Selesai'} (tidak dapat diubah dari sini)
                            </div>
                        ) : years.length === 0 && !editingYear ? (
                            <div className="space-y-2">
                                <div className="w-full px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-2">
                                    <PlayCircle set="bold" size={20} />
                                    Akan di-set menjadi Aktif otomatis
                                </div>
                                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                    Karena belum ada tahun ajaran di sistem, tahun ajaran pertama ini akan langsung diaktifkan.
                                </p>
                            </div>
                        ) : (
                            <div className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-400">
                                🕐 Direncanakan
                            </div>
                        )}
                        {years.length > 0 && !(editingYear?.status === 'ACTIVE' || editingYear?.status === 'COMPLETED') && (
                            <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                                <p className="text-xs text-blue-700 dark:text-blue-300">
                                    💡 Untuk <strong>mengaktifkan</strong> tahun ajaran, gunakan tombol <strong>&quot;Pergantian Tahun&quot;</strong> di atas.
                                    Ini memastikan semua langkah (selesaikan tahun lama, kenaikan kelas, salin penugasan) dilakukan dengan benar.
                                </p>
                            </div>
                        )}
                    </div>
                    <div className="flex gap-3 pt-2">
                        <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Batal</Button>
                        <Button type="submit" loading={saving} className="flex-1">Simpan Perubahan</Button>
                    </div>
                </form>
            </Modal>

            {/* Complete Confirmation Modal */}
            <Modal open={showCompleteModal} onClose={() => setShowCompleteModal(false)} title="⚠️ Selesaikan Tahun Ajaran">
                <div className="space-y-4">
                    <p className="text-text-main dark:text-white">
                        Apakah Anda yakin ingin menyelesaikan tahun ajaran <strong>{completingYear?.name}</strong>?
                    </p>
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 rounded-xl">
                        <p className="text-sm text-amber-800 dark:text-amber-200"><strong>Perhatian:</strong> Setelah diselesaikan:</p>
                        <ul className="text-sm text-amber-700 dark:text-amber-300 mt-2 list-disc list-inside space-y-1">
                            <li>Status akan berubah menjadi &quot;Selesai&quot;</li>
                            <li>Tanggal selesai akan diset ke hari ini</li>
                            <li>Tidak ada tahun ajaran aktif sampai Anda membuat yang baru</li>
                        </ul>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <Button type="button" variant="secondary" onClick={() => setShowCompleteModal(false)} className="flex-1">Batal</Button>
                        <Button onClick={handleComplete} loading={saving} className="flex-1">Ya, Selesaikan</Button>
                    </div>
                </div>
            </Modal>

            {/* Delete Modal Step 1 */}
            <Modal open={showDeleteModal} onClose={cancelDelete} title="⚠️ Hapus Tahun Ajaran">
                <div className="space-y-4">
                    <p className="text-text-main dark:text-white">
                        Anda akan menghapus tahun ajaran <strong className="text-red-600">{deletingYear?.name}</strong>
                    </p>
                    {loadingRelated ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-8 h-8 text-primary animate-spin" />
                            <span className="ml-2 text-text-secondary">Memuat data terkait...</span>
                        </div>
                    ) : relatedData && relatedData.total > 0 ? (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-xl">
                            <div className="flex items-start gap-2 mb-3">
                                <AlertTriangle set="bold" primaryColor="currentColor" size={20} />
                                <p className="text-sm font-bold text-red-800 dark:text-red-200">Data berikut akan TERHAPUS PERMANEN:</p>
                            </div>
                            <ul className="text-sm text-red-700 dark:text-red-300 space-y-1 ml-7">
                                {relatedData.classes.count > 0 && <li>📚 {relatedData.classes.count} kelas</li>}
                                {relatedData.teaching_assignments > 0 && <li>👨‍🏫 {relatedData.teaching_assignments} penugasan</li>}
                                {relatedData.student_enrollments > 0 && <li>📝 {relatedData.student_enrollments} enrollment</li>}
                                {relatedData.materials > 0 && <li>📖 {relatedData.materials} materi</li>}
                                {relatedData.assignments > 0 && <li>📋 {relatedData.assignments} tugas</li>}
                                {relatedData.quizzes > 0 && <li>❓ {relatedData.quizzes} kuis</li>}
                                {relatedData.exams > 0 && <li>📝 {relatedData.exams} ulangan</li>}
                                {(relatedData.submissions + relatedData.quiz_submissions + relatedData.exam_submissions) > 0 && (
                                    <li className="border-t border-red-200 dark:border-red-700 pt-1 mt-1">📊 {relatedData.submissions + relatedData.quiz_submissions + relatedData.exam_submissions} submission/nilai</li>
                                )}
                            </ul>
                        </div>
                    ) : (
                        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4 rounded-xl">
                            <p className="text-sm text-green-700 dark:text-green-300">✅ Tidak ada data terkait yang akan terhapus.</p>
                        </div>
                    )}
                    <div className="flex gap-3 pt-2">
                        <Button type="button" variant="secondary" onClick={cancelDelete} className="flex-1">Batal</Button>
                        <Button onClick={proceedToFinalConfirm} className="flex-1 bg-red-600 hover:bg-red-700 text-white border-0" disabled={loadingRelated}>Lanjutkan Hapus</Button>
                    </div>
                </div>
            </Modal>

            {/* Delete Modal Step 2 */}
            <Modal open={showFinalDeleteModal} onClose={cancelDelete} title="🚨 Konfirmasi Akhir">
                <div className="space-y-4">
                    <div className="bg-red-100 dark:bg-red-900/30 border-2 border-red-500 p-6 rounded-xl text-center flex flex-col items-center">
                        <div className="text-red-600 mb-4"><AlertTriangle set="bold" primaryColor="currentColor" size={64} /></div>
                        <p className="text-lg font-bold text-red-800 dark:text-red-200 mb-2">APAKAH ANDA YAKIN?</p>
                        <p className="text-text-main dark:text-white">Menghapus <strong className="text-red-600">{deletingYear?.name}</strong></p>
                        {relatedData && relatedData.total > 0 && (
                            <p className="text-sm text-red-600 dark:text-red-400 mt-2 font-bold">{relatedData.total} data akan DIHAPUS PERMANEN</p>
                        )}
                    </div>
                    <p className="text-sm text-text-secondary text-center">Tindakan ini <strong>TIDAK DAPAT DIBATALKAN</strong></p>
                    <div className="flex gap-3 pt-2">
                        <Button type="button" variant="secondary" onClick={cancelDelete} className="flex-1">Batalkan</Button>
                        <Button onClick={executeDelete} loading={deleting} className="flex-1 bg-red-600 hover:bg-red-700 text-white border-0">Ya, Hapus Sekarang</Button>
                    </div>
                </div>
            </Modal>

            {/* ═══════════════════════════════════════
                WIZARD: Complete Year Confirmation Modal
               ═══════════════════════════════════════ */}
            <Modal open={showWizardCompleteModal} onClose={() => setShowWizardCompleteModal(false)} title="⚠️ Selesaikan Tahun Ajaran">
                <div className="space-y-4">
                    <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 p-4 rounded-xl text-center">
                        <div className="text-amber-500 mb-2"><AlertTriangle set="bold" primaryColor="currentColor" size={40} /></div>
                        <p className="text-base font-bold text-amber-800 dark:text-amber-200">
                            Anda akan menyelesaikan tahun ajaran <span className="text-red-600">{activeYear?.name}</span>
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">Tindakan ini tidak dapat dibatalkan</p>
                    </div>

                    {/* Impact Data */}
                    {loadingWizardRelated ? (
                        <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
                            <span className="text-sm text-text-secondary">Memuat data terkait...</span>
                        </div>
                    ) : wizardRelatedData && wizardRelatedData.total > 0 && (
                        <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-xl">
                            <p className="text-xs font-bold text-text-main dark:text-white mb-2">📊 Data di tahun ini:</p>
                            <div className="grid grid-cols-3 gap-2 text-center">
                                {wizardRelatedData.classes.count > 0 && (
                                    <div className="bg-white dark:bg-slate-900 p-2 rounded-lg">
                                        <p className="text-lg font-bold text-primary">{wizardRelatedData.classes.count}</p>
                                        <p className="text-[10px] text-text-secondary">Kelas</p>
                                    </div>
                                )}
                                {wizardRelatedData.student_enrollments > 0 && (
                                    <div className="bg-white dark:bg-slate-900 p-2 rounded-lg">
                                        <p className="text-lg font-bold text-primary">{wizardRelatedData.student_enrollments}</p>
                                        <p className="text-[10px] text-text-secondary">Siswa</p>
                                    </div>
                                )}
                                {wizardRelatedData.teaching_assignments > 0 && (
                                    <div className="bg-white dark:bg-slate-900 p-2 rounded-lg">
                                        <p className="text-lg font-bold text-primary">{wizardRelatedData.teaching_assignments}</p>
                                        <p className="text-[10px] text-text-secondary">Penugasan</p>
                                    </div>
                                )}
                            </div>
                            <p className="text-[10px] text-text-secondary mt-2 text-center">Data ini akan tetap tersimpan tetapi tahun ajaran akan berstatus &quot;Selesai&quot;</p>
                        </div>
                    )}

                    {/* Checklist */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 rounded-xl space-y-3">
                        <p className="text-sm font-bold text-text-main dark:text-white">✅ Pastikan hal berikut sebelum melanjutkan:</p>
                        {[
                            'Semua nilai siswa sudah diinput oleh guru',
                            'Rapor sudah dicetak / diekspor',
                            'Data penting sudah di-backup jika perlu',
                            'Saya yakin ingin menyelesaikan tahun ajaran ini'
                        ].map((label, i) => (
                            <label key={i} className="flex items-start gap-3 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={wizardChecklist[i]}
                                    onChange={() => {
                                        const updated = [...wizardChecklist]
                                        updated[i] = !updated[i]
                                        setWizardChecklist(updated)
                                    }}
                                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                                />
                                <span className={`text-sm ${wizardChecklist[i] ? 'text-green-600 dark:text-green-400 font-medium' : 'text-text-secondary'}`}>
                                    {label}
                                </span>
                            </label>
                        ))}
                    </div>

                    <div className="flex gap-3 pt-2">
                        <Button type="button" variant="secondary" onClick={() => setShowWizardCompleteModal(false)} className="flex-1">Batal</Button>
                        <Button
                            onClick={executeWizardComplete}
                            loading={wizardCompletingYear}
                            disabled={!allCompleteChecked}
                            className={`flex-1 ${allCompleteChecked ? 'bg-amber-500 hover:bg-amber-600' : 'bg-gray-300 cursor-not-allowed'} text-white border-0`}
                        >
                            {allCompleteChecked ? '✅ Ya, Selesaikan Sekarang' : `Centang semua (${wizardChecklist.filter(Boolean).length}/4)`}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* ═══════════════════════════════════════
                WIZARD: Create Year Confirmation Modal
               ═══════════════════════════════════════ */}
            <Modal open={showWizardCreateModal} onClose={() => setShowWizardCreateModal(false)} title="📅 Aktifkan Tahun Ajaran Baru">
                <div className="space-y-4">
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border-2 border-emerald-300 dark:border-emerald-700 p-4 rounded-xl text-center">
                        <p className="text-base font-bold text-emerald-800 dark:text-emerald-200">
                            Tahun ajaran <span className="text-primary">{newYearName}</span> akan dibuat dan langsung diaktifkan
                        </p>
                    </div>

                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 rounded-xl">
                        <p className="text-xs text-amber-800 dark:text-amber-200"><strong>⚠️ Yang akan terjadi:</strong></p>
                        <ul className="text-xs text-amber-700 dark:text-amber-300 mt-1.5 space-y-1 list-disc list-inside">
                            <li>Tahun ajaran baru akan menjadi tahun aktif</li>
                            <li>Semua fitur (tugas, kuis, ulangan) akan merujuk ke tahun ini</li>
                            <li>Anda masih perlu memproses kenaikan kelas dan penugasan (langkah 3 & 4)</li>
                        </ul>
                    </div>

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 rounded-xl space-y-3">
                        <p className="text-sm font-bold text-text-main dark:text-white">✅ Konfirmasi:</p>
                        {[
                            `Tahun ajaran lama sudah diselesaikan`,
                            `Nama tahun ajaran "${newYearName}" sudah benar`,
                            'Saya siap untuk melanjutkan proses pergantian tahun'
                        ].map((label, i) => (
                            <label key={i} className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={wizardCreateChecklist[i]}
                                    onChange={() => {
                                        const updated = [...wizardCreateChecklist]
                                        updated[i] = !updated[i]
                                        setWizardCreateChecklist(updated)
                                    }}
                                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary"
                                />
                                <span className={`text-sm ${wizardCreateChecklist[i] ? 'text-green-600 dark:text-green-400 font-medium' : 'text-text-secondary'}`}>
                                    {label}
                                </span>
                            </label>
                        ))}
                    </div>

                    <div className="flex gap-3 pt-2">
                        <Button type="button" variant="secondary" onClick={() => setShowWizardCreateModal(false)} className="flex-1">Batal</Button>
                        <Button
                            onClick={executeWizardCreate}
                            loading={creatingYear}
                            disabled={!allCreateChecked}
                            className={`flex-1 ${allCreateChecked ? '' : 'bg-gray-300 cursor-not-allowed border-0'}`}
                        >
                            {allCreateChecked ? `🚀 Buat & Aktifkan ${newYearName}` : `Centang semua (${wizardCreateChecklist.filter(Boolean).length}/3)`}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}
