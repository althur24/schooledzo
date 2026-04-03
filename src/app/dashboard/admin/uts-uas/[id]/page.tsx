'use client'

import { useEffect, useState, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Button, Modal, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import SmartText from '@/components/SmartText'
import { Edit, Discovery, Folder, Plus, Delete, Document } from 'react-iconly'
import {
    Loader2, ArrowLeft, Trash2, Save, Eye, EyeOff,
    Settings, FileText, BarChart3, Sparkles,
    ChevronUp, ChevronDown as ChevronDownIcon, CheckCircle, Download, RotateCcw
} from 'lucide-react'
import * as XLSX from 'xlsx'
import QuestionImageUpload from '@/components/QuestionImageUpload'

const MathTextarea = dynamic(() => import('@/components/MathTextarea'), {
    ssr: false,
    loading: () => <textarea placeholder="Memuat editor..." className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main" rows={3} readOnly />
})
const PreviewModal = dynamic(() => import('@/components/PreviewModal'), { ssr: false })
const RapihAIModal = dynamic(() => import('@/components/RapihAIModal'), { ssr: false })

interface ExamDetail {
    id: string; exam_type: 'UTS' | 'UAS'; title: string; description: string | null
    start_time: string; duration_minutes: number; is_active: boolean; is_randomized: boolean
    max_violations: number; target_class_ids: string[]
    subject: { id: string; name: string }
    target_classes: { id: string; name: string; school_level: string; grade_level: number }[]
    academic_year: { id: string; name: string }
}

interface Question {
    id: string; question_text: string; question_type: 'MULTIPLE_CHOICE' | 'ESSAY'
    options: string[] | null; correct_answer: string | null; points: number
    order_index: number; difficulty: string | null; passage_text: string | null
    passage_audio_url?: string | null; image_url?: string | null; status?: string
    teacher_hots_claim?: boolean
}

type TabType = 'soal' | 'pengaturan' | 'hasil'
type SoalMode = 'list' | 'manual' | 'clean' | 'bank'

export default function AdminUtsUasDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: examId } = use(params)
    const router = useRouter()

    const [exam, setExam] = useState<ExamDetail | null>(null)
    const [questions, setQuestions] = useState<Question[]>([])
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<TabType>('soal')
    const [saving, setSaving] = useState(false)
    const [soalMode, setSoalMode] = useState<SoalMode>('list')
    const [showAddDropdown, setShowAddDropdown] = useState(false)
    const [showPreview, setShowPreview] = useState(false)

    // Toast & confirm dialog (replacing browser alerts)
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null)
    const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

    const showToast = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
        setToast({ message, type })
        setTimeout(() => setToast(null), 3000)
    }

    // Manual form
    const [manualForm, setManualForm] = useState<Question>({
        id: '', question_text: '', question_type: 'MULTIPLE_CHOICE',
        options: ['', '', '', ''], correct_answer: '', points: 10,
        order_index: 0, difficulty: 'MEDIUM', passage_text: null, teacher_hots_claim: false
    })

    // Passage mode
    const [isPassageMode, setIsPassageMode] = useState(false)
    const [passageText, setPassageText] = useState('')
    const [passageAudioUrl, setPassageAudioUrl] = useState('')
    const [uploadingAudio, setUploadingAudio] = useState(false)
    const [passageQuestions, setPassageQuestions] = useState<Question[]>([{
        id: '', question_text: '', question_type: 'MULTIPLE_CHOICE', options: ['', '', '', ''],
        correct_answer: '', points: 10, order_index: 0, difficulty: null, passage_text: null
    }])

    // Bank Soal
    const [bankQuestions, setBankQuestions] = useState<any[]>([])
    const [bankPassages, setBankPassages] = useState<any[]>([])
    const [bankLoading, setBankLoading] = useState(false)
    const [selectedBankIds, setSelectedBankIds] = useState<Set<string>>(new Set())

    // Inline edit
    const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
    const [editQuestionForm, setEditQuestionForm] = useState<Question | null>(null)

    // Bulk select
    const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set())
    const [isBulkSelectMode, setIsBulkSelectMode] = useState(false)

    // Rapih AI
    const [rapihSaving, setRapihSaving] = useState(false)

    // Settings
    const [allClasses, setAllClasses] = useState<{ id: string; name: string; school_level: string }[]>([])
    const [settingsForm, setSettingsForm] = useState({
        title: '', description: '', start_time: '',
        duration_minutes: 90, is_randomized: true, max_violations: 3,
        target_class_ids: [] as string[]
    })
    const [settingsSaving, setSettingsSaving] = useState(false)

    // Results
    const [submissions, setSubmissions] = useState<any[]>([])
    const [resultsLoading, setResultsLoading] = useState(false)
    const [resultsClassFilter, setResultsClassFilter] = useState('')
    const [resettingId, setResettingId] = useState<string | null>(null)
    const [resetMenuId, setResetMenuId] = useState<string | null>(null)

    // AI Review setting
    const [aiReviewEnabled, setAiReviewEnabled] = useState(false)

    // Helpers
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 0), 0)
    const getDefaultPoints = () => Math.floor(100 / (questions.length + 1))

    const fetchExam = useCallback(async () => {
        try {
            const res = await fetch(`/api/official-exams/${examId}`)
            const data = await res.json()
            setExam(data)
            setSettingsForm({
                title: data.title || '',
                description: data.description || '',
                start_time: data.start_time ? new Date(new Date(data.start_time).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '',
                duration_minutes: data.duration_minutes || 90,
                is_randomized: data.is_randomized ?? true,
                max_violations: data.max_violations || 3,
                target_class_ids: data.target_class_ids || []
            })
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }, [examId])

    const fetchQuestions = useCallback(async () => {
        try {
            const res = await fetch(`/api/official-exams/${examId}/questions`)
            const data = await res.json()
            setQuestions(Array.isArray(data) ? data : [])
        } catch (error) {
            console.error('Error:', error)
        }
    }, [examId])

    useEffect(() => {
        fetchExam()
        fetchQuestions()
        fetch('/api/classes').then(r => r.json()).then(d => setAllClasses(Array.isArray(d) ? d : [])).catch(() => {})
        fetch('/api/school-settings').then(r => r.ok ? r.json() : null).then(d => {
            if (d) setAiReviewEnabled(d.ai_review_enabled !== false)
        }).catch(() => {})
    }, [fetchExam, fetchQuestions])

    const fetchResults = async () => {
        setResultsLoading(true)
        try {
            let url = `/api/official-exam-submissions?exam_id=${examId}`
            if (resultsClassFilter) url += `&class_id=${resultsClassFilter}`
            const res = await fetch(url)
            const data = await res.json()
            setSubmissions(Array.isArray(data) ? data : [])
        } catch (error) { console.error('Error:', error) }
        finally { setResultsLoading(false) }
    }

    useEffect(() => {
        if (activeTab === 'hasil') fetchResults()
    }, [activeTab, resultsClassFilter])

    const handleResetAttempt = async (submissionId: string, studentName: string, mode: 'soft' | 'hard') => {
        const confirmMsg = mode === 'soft'
            ? `Soft Reset: Izinkan "${studentName}" melanjutkan ujian?\n\nTimer tetap berjalan dan pelanggaran di-reset. Jawaban yang sudah tersimpan tetap ada.`
            : `Hard Reset: Mulai ulang ujian untuk "${studentName}"?\n\nSiswa akan mendapat durasi penuh baru, TETAPI SEMUA JAWABAN AKAN DIHAPUS.`;
            
        if (!confirm(confirmMsg)) {
            setResetMenuId(null)
            return
        }
        
        setResettingId(submissionId)
        setResetMenuId(null)
        try {
            const res = await fetch('/api/official-exam-submissions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ submission_id: submissionId, reset_attempt: mode })
            })
            if (res.ok) {
                showToast(mode === 'hard' ? `Hard Reset untuk ${studentName} berhasil` : `Soft Reset untuk ${studentName} berhasil`, 'success')
                fetchResults()
            } else {
                const err = await res.json()
                showToast(err.error || 'Gagal mereset attempt', 'error')
            }
        } catch {
            showToast('Gagal mereset attempt', 'error')
        } finally {
            setResettingId(null)
        }
    }

    // Close dropdown on outside click
    useEffect(() => {
        if (!resetMenuId) return
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            if (!target.closest('[data-reset-menu]')) {
                setResetMenuId(null)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [resetMenuId])

    const handleDownloadExcel = () => {
        if (!exam || submissions.length === 0) return

        const formattedData = submissions.map((sub: any, index: number) => {
            const maxScore = sub.max_score || 1
            const percentage = Math.round((sub.total_score / maxScore) * 100)
            
            let status = 'Mengerjakan'
            if (sub.is_submitted) {
                status = sub.is_graded ? 'Selesai' : 'Perlu Koreksi'
            }

            return {
                'No': index + 1,
                'Nama Siswa': sub.student?.user?.full_name || '-',
                'NIS': sub.student?.nis || '-',
                'Kelas': allClasses.find(c => c.id === sub.student?.class_id)?.name || '-',
                'Skor': sub.total_score || 0,
                'Max Skor': sub.max_score || 0,
                'Persentase': `${percentage}%`,
                'Pelanggaran': sub.violation_count || 0,
                'Status': status,
                'Waktu Submit': sub.submitted_at ? new Date(sub.submitted_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'
            }
        })

        const ws = XLSX.utils.json_to_sheet(formattedData)
        
        // Auto-width columns
        const colWidths = [
            { wch: 5 },  // No
            { wch: 30 }, // Nama
            { wch: 15 }, // NIS
            { wch: 15 }, // Kelas
            { wch: 10 }, // Skor
            { wch: 10 }, // Max
            { wch: 15 }, // Persentase
            { wch: 15 }, // Pelanggaran
            { wch: 15 }, // Status
            { wch: 20 }, // Waktu
        ]
        ws['!cols'] = colWidths

        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, "Hasil_Ujian")

        const filterClassName = resultsClassFilter 
            ? allClasses.find(c => c.id === resultsClassFilter)?.name?.replace(/ /g, '_') || 'Filter'
            : 'Semua_Kelas'

        const fileName = `Hasil_${exam.exam_type}_${exam.title.replace(/ /g, '_')}_${filterClassName}.xlsx`
        
        XLSX.writeFile(wb, fileName)
    }

    // Publish / Unpublish
    const handleToggleActive = async () => {
        if (!exam) return
        const newActive = !exam.is_active
        if (newActive && questions.length === 0) { showToast('Tambahkan soal dulu!', 'warning'); return }
        setSaving(true)
        try {
            const res = await fetch(`/api/official-exams/${examId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: newActive })
            })
            if (res.ok) {
                const updated = await res.json()
                setExam(prev => prev ? { ...prev, is_active: updated.is_active } : null)
            }
        } finally { setSaving(false) }
    }

    // Add question manually (normal + passage)
    const handleAddManualQuestion = async () => {
        if (isPassageMode) {
            if ((!passageText.trim() && !passageAudioUrl) || passageQuestions.length === 0) return
            setSaving(true)
            try {
                const questionsToSave = passageQuestions.filter(q => q.question_text.trim()).map((q, idx) => ({
                    question_text: q.question_text, question_type: q.question_type,
                    options: q.question_type === 'MULTIPLE_CHOICE' ? q.options : null,
                    correct_answer: q.correct_answer || null, points: q.points || 10,
                    order_index: questions.length + idx, passage_text: passageText,
                    passage_audio_url: passageAudioUrl || null, teacher_hots_claim: q.teacher_hots_claim || false
                }))
                await fetch(`/api/official-exams/${examId}/questions`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ questions: questionsToSave })
                })
                setPassageText(''); setPassageAudioUrl('')
                setPassageQuestions([{ id: '', question_text: '', question_type: 'MULTIPLE_CHOICE', options: ['', '', '', ''], correct_answer: '', points: 10, order_index: 0, difficulty: null, passage_text: null }])
                setIsPassageMode(false); setSoalMode('list'); fetchQuestions()
            } finally { setSaving(false) }
            return
        }
        if (!manualForm.question_text) return
        setSaving(true)
        try {
            await fetch(`/api/official-exams/${examId}/questions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_text: manualForm.question_text, question_type: manualForm.question_type,
                    options: manualForm.question_type === 'MULTIPLE_CHOICE' ? manualForm.options : null,
                    correct_answer: manualForm.correct_answer || null, points: manualForm.points,
                    difficulty: manualForm.difficulty, teacher_hots_claim: manualForm.teacher_hots_claim || false,
                    order_index: questions.length
                })
            })
            setManualForm({ id: '', question_text: '', question_type: 'MULTIPLE_CHOICE', options: ['', '', '', ''], correct_answer: '', points: 10, order_index: 0, difficulty: 'MEDIUM', passage_text: null, teacher_hots_claim: false })
            setSoalMode('list'); fetchQuestions()
        } finally { setSaving(false) }
    }

    // Delete question
    const handleDeleteQuestion = (questionId: string) => {
        setConfirmDialog({
            title: 'Hapus Soal',
            message: 'Yakin ingin menghapus soal ini?',
            onConfirm: async () => {
                await fetch(`/api/official-exams/${examId}/questions`, {
                    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question_id: questionId })
                })
                fetchQuestions()
                setConfirmDialog(null)
            }
        })
    }

    // Bulk delete
    const handleBulkDelete = async () => {
        if (selectedQuestionIds.size === 0) return
        setConfirmDialog({
            title: 'Hapus Soal',
            message: `Yakin ingin menghapus ${selectedQuestionIds.size} soal?`,
            onConfirm: async () => {
                for (const qId of selectedQuestionIds) {
                    await fetch(`/api/official-exams/${examId}/questions`, {
                        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ question_id: qId })
                    })
                }
                setSelectedQuestionIds(new Set()); setIsBulkSelectMode(false); fetchQuestions()
                setConfirmDialog(null)
            }
        })
    }

    // Edit question
    const handleSaveEdit = async () => {
        if (!editQuestionForm || !editingQuestionId) return
        setSaving(true)
        try {
            await fetch(`/api/official-exams/${examId}/questions`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: editingQuestionId, question_text: editQuestionForm.question_text,
                    options: editQuestionForm.options, correct_answer: editQuestionForm.correct_answer,
                    teacher_hots_claim: editQuestionForm.teacher_hots_claim || false,
                    image_url: editQuestionForm.image_url || null
                })
            })
            setEditingQuestionId(null); setEditQuestionForm(null); fetchQuestions()
        } finally { setSaving(false) }
    }

    // Rapih AI save handlers
    const handleRapihSaveToExam = async (results: any[]) => {
        setRapihSaving(true)
        try {
            const newQuestions = results.map((q: any, idx: number) => ({
                question_text: q.question_text, question_type: q.question_type,
                options: q.options || null, correct_answer: q.correct_answer || null,
                difficulty: q.difficulty || 'MEDIUM', points: q.points || 10,
                order_index: questions.length + idx, passage_text: q.passage_text || null,
                teacher_hots_claim: q.teacher_hots_claim || false,
            }))
            const res = await fetch(`/api/official-exams/${examId}/questions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ questions: newQuestions })
            })
            if (res.ok) { setSoalMode('list'); fetchQuestions() }
        } finally { setRapihSaving(false) }
    }

    const handleRapihSaveToBank = async (results: any[]) => {
        setRapihSaving(true)
        try {
            const subjectId = exam?.subject?.id || null
            const standalone = results.filter((q: any) => !q.passage_text)
            if (standalone.length > 0) {
                await fetch('/api/question-bank', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(standalone.map((q: any) => ({
                        question_text: q.question_text, question_type: q.question_type,
                        options: q.options || null, correct_answer: q.correct_answer || null,
                        difficulty: q.difficulty || 'MEDIUM', subject_id: subjectId, tags: null
                    })))
                })
            }
        } finally { setRapihSaving(false) }
    }

    // Save settings
    const handleSaveSettings = async () => {
        setSettingsSaving(true)
        try {
            const localDate = new Date(settingsForm.start_time)
            const res = await fetch(`/api/official-exams/${examId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: settingsForm.title, description: settingsForm.description,
                    start_time: localDate.toISOString(), duration_minutes: settingsForm.duration_minutes,
                    is_randomized: settingsForm.is_randomized, max_violations: settingsForm.max_violations,
                    target_class_ids: settingsForm.target_class_ids
                })
            })
            if (res.ok) {
                const updated = await res.json()
                setExam(prev => prev ? { ...prev, ...updated } : null)
                showToast('Pengaturan berhasil disimpan!', 'success')
            }
        } finally { setSettingsSaving(false) }
    }

    // Balance points
    const handleBalancePoints = () => {
        const pointPerQ = Math.floor(100 / questions.length)
        const remainder = 100 - (pointPerQ * questions.length)
        const balanced = questions.map((q, idx) => ({ ...q, points: pointPerQ + (idx < remainder ? 1 : 0) }))
        setQuestions(balanced)
        balanced.forEach(async (q) => {
            if (q.id) {
                await fetch(`/api/official-exams/${examId}/questions`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question_id: q.id, points: q.points })
                })
            }
        })
    }

    if (loading) {
        return <div className="flex justify-center py-20"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>
    }

    if (!exam) {
        return <div className="text-center py-20 text-text-secondary">Ujian tidak ditemukan</div>
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <button onClick={() => router.push('/dashboard/admin/uts-uas')} className="flex items-center gap-1 text-sm text-text-secondary hover:text-primary mb-2 transition-colors">
                        <ArrowLeft className="w-4 h-4" /> Kembali
                    </button>
                    <div className="flex items-center gap-3">
                        <span className={`px-3 py-1 text-sm font-bold rounded-full ${exam.exam_type === 'UTS' ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'}`}>{exam.exam_type}</span>
                        <h1 className="text-2xl font-bold text-text-main dark:text-white">{exam.title}</h1>
                    </div>
                    <p className="text-sm text-text-secondary mt-1">{exam.subject?.name} • {exam.target_classes?.length || 0} kelas • {questions.length} soal ({totalPoints} poin)</p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={() => setShowPreview(true)} disabled={questions.length === 0}><Eye className="w-4 h-4 mr-1" /> Preview</Button>
                    <Button onClick={handleToggleActive} loading={saving} className={exam.is_active ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-green-500 hover:bg-green-600 text-white'}>
                        {exam.is_active ? <><EyeOff className="w-4 h-4 mr-1" /> Tarik (Draft)</> : <><Eye className="w-4 h-4 mr-1" /> Publish</>}
                    </Button>
                    <div className="flex items-center gap-4 border-l border-secondary/20 pl-4">
                        <div className="text-right">
                            <p className={`text-2xl font-bold ${totalPoints > 100 ? 'text-red-500' : totalPoints === 100 ? 'text-green-500' : 'text-amber-500'}`}>{totalPoints}</p>
                            <p className="text-xs text-text-secondary">Total Poin</p>
                        </div>
                        <div className="text-right">
                            <p className="text-2xl font-bold text-primary">{questions.length}</p>
                            <p className="text-xs text-text-secondary">Soal</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Points Warning */}
            {totalPoints !== 100 && questions.length > 0 && (
                <div className={`px-4 py-3 rounded-xl flex items-center justify-between ${totalPoints > 100 ? 'bg-red-500/10 border border-red-200 dark:border-red-500/30' : 'bg-amber-500/10 border border-amber-200 dark:border-amber-500/30'}`}>
                    <span className={totalPoints > 100 ? 'text-red-600 dark:text-red-400 font-medium text-sm' : 'text-amber-600 dark:text-amber-400 font-medium text-sm'}>
                        {totalPoints > 100 ? `⚠️ Total poin melebihi 100 (${totalPoints}). Kurangi poin beberapa soal.` : `ℹ️ Total poin: ${totalPoints}/100. Disarankan total = 100.`}
                    </span>
                    <Button size="sm" variant="secondary" onClick={handleBalancePoints}>Seimbangkan Poin</Button>
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-secondary/5 p-1 rounded-xl border border-secondary/10">
                {([{ key: 'soal' as TabType, label: 'Soal', icon: FileText }, { key: 'pengaturan' as TabType, label: 'Pengaturan', icon: Settings }, { key: 'hasil' as TabType, label: 'Hasil', icon: BarChart3 }]).map(tab => (
                    <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === tab.key ? 'bg-white dark:bg-surface-dark text-primary shadow-sm' : 'text-text-secondary hover:text-text-main'}`}>
                        <tab.icon className="w-4 h-4" /> {tab.label}
                    </button>
                ))}
            </div>

            {/* ===== TAB: SOAL ===== */}
            {activeTab === 'soal' && (
                <div className="space-y-4">
                    {/* Dropdown Tambah Soal */}
                    {soalMode === 'list' && (
                        <div className="relative inline-block">
                            <button onClick={() => setShowAddDropdown(!showAddDropdown)} className="flex items-center gap-2 px-5 py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 active:scale-95 transition-all shadow-md shadow-primary/20 cursor-pointer">
                                <Plus set="bold" primaryColor="currentColor" size={20} /> Tambah Soal
                            </button>
                            {showAddDropdown && (<>
                                <div className="fixed inset-0 z-40" onClick={() => setShowAddDropdown(false)} />
                                <div className="absolute left-0 top-full mt-2 z-50 w-64 bg-white dark:bg-surface-dark rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                    <button onClick={() => { setManualForm({ ...manualForm, points: getDefaultPoints(), question_text: '', correct_answer: '', options: ['', '', '', ''] }); setSoalMode('manual'); setShowAddDropdown(false) }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer">
                                        <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0"><Edit set="bold" primaryColor="currentColor" size={16} /></div>
                                        <div className="text-left"><div className="text-sm font-semibold text-text-main dark:text-white">Manual</div><div className="text-xs text-text-secondary">Ketik soal satu per satu</div></div>
                                    </button>
                                    <button onClick={() => { setSoalMode('clean'); setShowAddDropdown(false) }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors cursor-pointer">
                                        <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0"><Discovery set="bold" primaryColor="currentColor" size={16} /></div>
                                        <div className="text-left"><div className="text-sm font-semibold text-text-main dark:text-white">Rapih AI</div><div className="text-xs text-text-secondary">Rapikan, generate, atau upload soal</div></div>
                                    </button>
                                    <button onClick={async () => { setShowAddDropdown(false); setSoalMode('bank'); setBankLoading(true); try { const subjectId = exam?.subject?.id || ''; const [qR, pR] = await Promise.all([fetch(`/api/question-bank?subject_id=${subjectId}`), fetch(`/api/passages?subject_id=${subjectId}`)]); setBankQuestions(Array.isArray(await qR.json()) ? await [] : []); const qData = await fetch(`/api/question-bank?subject_id=${subjectId}`).then(r => r.json()); const pData = await fetch(`/api/passages?subject_id=${subjectId}`).then(r => r.json()); setBankQuestions(Array.isArray(qData) ? qData : []); setBankPassages(Array.isArray(pData) ? pData : []) } catch(e) { console.error(e) } finally { setBankLoading(false) } }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors cursor-pointer">
                                        <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0"><Folder set="bold" primaryColor="currentColor" size={16} /></div>
                                        <div className="text-left"><div className="text-sm font-semibold text-text-main dark:text-white">Bank Soal</div><div className="text-xs text-text-secondary">Pilih dari soal tersimpan</div></div>
                                    </button>
                                </div>
                            </>)}
                        </div>
                    )}

                    {/* Bulk Selection Toolbar */}
                    {soalMode === 'list' && questions.length > 0 && !exam?.is_active && (
                        <div className="flex items-center justify-between bg-white dark:bg-surface-dark rounded-xl p-3 border border-secondary/20">
                            <div className="flex items-center gap-3">
                                <Button variant={isBulkSelectMode ? 'primary' : 'secondary'} onClick={() => { setIsBulkSelectMode(!isBulkSelectMode); setSelectedQuestionIds(new Set()) }} className="text-sm">
                                    {isBulkSelectMode ? '✓ Mode Pilih Aktif' : '☐ Pilih Beberapa'}
                                </Button>
                                {isBulkSelectMode && (<>
                                    <Button variant="secondary" onClick={() => { selectedQuestionIds.size === questions.length ? setSelectedQuestionIds(new Set()) : setSelectedQuestionIds(new Set(questions.map(q => q.id))) }} className="text-sm">
                                        {selectedQuestionIds.size === questions.length ? 'Batal Pilih Semua' : 'Pilih Semua'}
                                    </Button>
                                    <span className="text-sm text-text-secondary">{selectedQuestionIds.size} dipilih</span>
                                </>)}
                            </div>
                            {isBulkSelectMode && selectedQuestionIds.size > 0 && (
                                <Button onClick={handleBulkDelete} className="bg-red-500 hover:bg-red-600 text-white text-sm">
                                    <Delete set="bold" primaryColor="currentColor" size={16} /> Hapus {selectedQuestionIds.size} Soal
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Question List */}
                    {soalMode === 'list' && (questions.length === 0 ? (
                        <EmptyState icon={<div className="text-secondary"><Document set="bold" primaryColor="currentColor" size={48} /></div>} title="Belum Ada Soal" description="Pilih salah satu metode di atas untuk menambahkan soal." />
                    ) : (
                        <div className="space-y-4">
                            {questions.map((q, idx) => (
                                <Card key={q.id} className={`p-5 ${selectedQuestionIds.has(q.id) ? 'ring-2 ring-primary' : ''}`}>
                                    <div className="flex items-start gap-5">
                                        {isBulkSelectMode && (<input type="checkbox" checked={selectedQuestionIds.has(q.id)} onChange={(e) => { const s = new Set(selectedQuestionIds); e.target.checked ? s.add(q.id) : s.delete(q.id); setSelectedQuestionIds(s) }} className="w-5 h-5 mt-1 rounded bg-secondary/10 border-secondary/30 text-primary focus:ring-primary cursor-pointer" />)}
                                        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-lg flex-shrink-0">{idx + 1}</div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-3">
                                                <span className={`px-2.5 py-1 text-xs font-bold rounded-full border ${q.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-500/20' : 'bg-orange-500/10 text-orange-600 border-orange-200 dark:border-orange-500/20'}`}>{q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 'Essay'}</span>
                                                {q.passage_text && <span className="px-2 py-0.5 text-xs rounded-full bg-teal-500/20 text-teal-600 dark:text-teal-400">📖 Passage</span>}
                                                {q.status === 'approved' && <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">✅</span>}
                                                {q.difficulty && <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/10 text-text-secondary font-medium">{q.difficulty}</span>}
                                            </div>
                                            {q.passage_text && (<div className="mb-3 p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg overflow-hidden"><p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-1">📖 Bacaan:</p><p className="text-sm text-text-main dark:text-white whitespace-pre-wrap line-clamp-3">{q.passage_text}</p></div>)}
                                            <SmartText text={q.question_text} className="prose dark:prose-invert max-w-none text-text-main dark:text-white mb-4" />
                                            {q.image_url && (
                                                <div className="mb-4">
                                                    <img src={q.image_url} alt="Gambar soal" className="max-h-60 rounded-xl border border-secondary/20" />
                                                </div>
                                            )}
                                            {q.question_type === 'MULTIPLE_CHOICE' && q.options && (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                                    {q.options.map((opt: string, optIdx: number) => (
                                                        <div key={optIdx} className={`px-4 py-3 rounded-xl border flex items-center gap-3 ${q.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-500/10 border-green-200 text-green-700 dark:border-green-500/30 dark:text-green-400' : 'bg-secondary/5 border-transparent text-text-secondary'}`}>
                                                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${q.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-500 text-white' : 'bg-secondary/20 text-text-secondary'}`}>{String.fromCharCode(65 + optIdx)}</span>
                                                            <SmartText text={opt} as="span" />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-3 items-end border-l border-secondary/10 pl-5">
                                            <div className="flex flex-col items-center">
                                                <input type="number" value={q.points} onChange={(e) => { const v = parseInt(e.target.value) || 1; setQuestions(questions.map((qq, i) => i === idx ? { ...qq, points: v } : qq)) }} onBlur={async (e) => { if (q.id) { await fetch(`/api/official-exams/${examId}/questions`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question_id: q.id, points: parseInt(e.target.value) || 1 }) }) } }} className="w-16 px-2 py-1.5 bg-secondary/5 border border-secondary/20 rounded-lg text-text-main dark:text-white text-center font-bold focus:outline-none focus:ring-2 focus:ring-primary" min={1} max={100} disabled={exam?.is_active} />
                                                <span className="text-[10px] uppercase font-bold text-text-secondary mt-1">Poin</span>
                                            </div>
                                            <div className="w-full h-px bg-secondary/10 my-1"></div>
                                            <QuestionImageUpload
                                                imageUrl={q.image_url}
                                                onImageChange={async (url) => {
                                                    if (q.id) {
                                                        await fetch(`/api/official-exams/${examId}/questions`, {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ question_id: q.id, image_url: url })
                                                        })
                                                        fetchQuestions()
                                                    }
                                                }}
                                                disabled={exam?.is_active}
                                            />
                                            <button onClick={() => { setEditingQuestionId(q.id); setEditQuestionForm(q) }} className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors" disabled={exam?.is_active} title="Edit soal">
                                                <Edit set="bold" primaryColor="currentColor" size={20} />
                                            </button>
                                            <button onClick={() => handleDeleteQuestion(q.id)} className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors" disabled={exam?.is_active}>
                                                <Delete set="bold" primaryColor="currentColor" size={20} />
                                            </button>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    ))}
                </div>
            )}

            {/* ===== TAB: PENGATURAN ===== */}
            {activeTab === 'pengaturan' && (
                <Card padding="p-6" className="space-y-5">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Ujian</label>
                        <input type="text" value={settingsForm.title} onChange={(e) => setSettingsForm({ ...settingsForm, title: e.target.value })} className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Deskripsi</label>
                        <textarea value={settingsForm.description} onChange={(e) => setSettingsForm({ ...settingsForm, description: e.target.value })} className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" rows={3} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Waktu Mulai</label>
                            <input type="datetime-local" value={settingsForm.start_time} onChange={(e) => setSettingsForm({ ...settingsForm, start_time: e.target.value })} className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Durasi (menit)</label>
                            <input type="number" value={settingsForm.duration_minutes} onChange={(e) => setSettingsForm({ ...settingsForm, duration_minutes: parseInt(e.target.value) || 90 })} min={5} max={300} className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Max Pelanggaran (auto-submit)</label>
                        <input type="number" value={settingsForm.max_violations} onChange={(e) => setSettingsForm({ ...settingsForm, max_violations: parseInt(e.target.value) || 3 })} min={1} max={10} className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" />
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/10">
                        <input type="checkbox" id="settings_randomize" checked={settingsForm.is_randomized} onChange={(e) => setSettingsForm({ ...settingsForm, is_randomized: e.target.checked })} className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary" />
                        <label htmlFor="settings_randomize" className="text-sm font-medium text-text-main dark:text-white cursor-pointer">Acak urutan soal per siswa</label>
                    </div>

                    {/* Target classes */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kelas Target ({settingsForm.target_class_ids.length} terpilih)</label>
                        <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                            {allClasses.map(c => {
                                const selected = settingsForm.target_class_ids.includes(c.id)
                                return (
                                    <button
                                        key={c.id}
                                        onClick={() => setSettingsForm(prev => ({
                                            ...prev,
                                            target_class_ids: selected
                                                ? prev.target_class_ids.filter(id => id !== c.id)
                                                : [...prev.target_class_ids, c.id]
                                        }))}
                                        className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${selected ? 'bg-primary text-white' : 'bg-secondary/5 text-text-secondary hover:bg-secondary/10'}`}
                                    >
                                        {c.name}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div className="pt-4 border-t border-secondary/10">
                        <Button onClick={handleSaveSettings} loading={settingsSaving} icon={<Save className="w-4 h-4" />}>
                            Simpan Pengaturan
                        </Button>
                    </div>
                </Card>
            )}

            {/* ===== TAB: HASIL ===== */}
            {activeTab === 'hasil' && (
                <div className="space-y-4">
                    {/* Class/Action Bar */}
                    <div className="flex justify-between items-center bg-white dark:bg-surface-dark border border-secondary/20 p-3 rounded-xl shadow-sm">
                        <div className="flex gap-3 items-center">
                            <select
                                value={resultsClassFilter}
                                onChange={(e) => setResultsClassFilter(e.target.value)}
                                className="px-4 py-2 bg-secondary/5 border border-secondary/20 rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm font-bold"
                            >
                                <option value="">Semua Kelas</option>
                                {(exam.target_classes || []).map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                            <span className="text-sm font-medium text-text-secondary border-l border-secondary/20 pl-3">{submissions.length} submission</span>
                        </div>
                        {submissions.length > 0 && (
                            <Button onClick={handleDownloadExcel} className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm" icon={<Download className="w-4 h-4 ml-1" />}>
                                Download Excel
                            </Button>
                        )}
                    </div>

                    {resultsLoading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                    ) : submissions.length === 0 ? (
                        <Card padding="p-8" className="text-center">
                            <BarChart3 className="w-12 h-12 text-text-secondary/50 mx-auto mb-3" />
                            <p className="text-text-secondary">Belum ada submission untuk ujian ini.</p>
                        </Card>
                    ) : (
                        <Card padding="p-0" className="overflow-hidden">
                            <table className="w-full">
                                <thead className="bg-secondary/5">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-text-main dark:text-white">No</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-text-main dark:text-white">Nama Siswa</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white">Skor</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white">Pelanggaran</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white">Status</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white">Waktu Submit</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-secondary/10">
                                    {[...submissions].sort((a, b) => (a.student?.user?.full_name || '').localeCompare(b.student?.user?.full_name || '')).map((sub: any, idx: number) => {
                                        const percentage = sub.max_score > 0 ? Math.round((sub.total_score / sub.max_score) * 100) : 0
                                        return (
                                            <tr key={sub.id} className="hover:bg-secondary/5">
                                                <td className="px-4 py-3 text-sm text-text-secondary">{idx + 1}</td>
                                                <td className="px-4 py-3 text-sm font-medium text-text-main dark:text-white">
                                                    {sub.student?.user?.full_name || '-'}
                                                    <span className="text-xs text-text-secondary ml-2">{sub.student?.nis}</span>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`font-bold text-sm ${percentage >= 75 ? 'text-green-600' : percentage >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                                                        {sub.total_score}/{sub.max_score} ({percentage}%)
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`text-xs font-medium ${sub.violation_count > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                                        {sub.violation_count}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {sub.is_submitted ? (
                                                        sub.is_graded ? (
                                                            <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 font-bold">Selesai</span>
                                                        ) : (
                                                            <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 font-bold">Perlu Koreksi</span>
                                                        )
                                                    ) : (
                                                        <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 font-bold">Mengerjakan</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-center text-xs text-text-secondary">
                                                    {sub.submitted_at ? new Date(sub.submitted_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {sub.is_submitted && exam?.is_active ? (
                                                        <div className="relative inline-block text-left" data-reset-menu>
                                                            <button
                                                                onClick={() => setResetMenuId(resetMenuId === sub.id ? null : sub.id)}
                                                                disabled={resettingId === sub.id}
                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 rounded-lg hover:bg-orange-200 dark:hover:bg-orange-500/30 transition-colors text-xs font-bold disabled:opacity-50"
                                                            >
                                                                {resettingId === sub.id ? (
                                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                ) : (
                                                                    <RotateCcw className="w-3.5 h-3.5" />
                                                                )}
                                                                Izinkan Ulang
                                                                <ChevronDownIcon className="w-3.5 h-3.5 ml-1" />
                                                            </button>
                                                            {resetMenuId === sub.id && (
                                                                <div className="absolute right-0 z-50 mt-2 w-56 origin-top-right rounded-xl bg-white dark:bg-surface-dark shadow-xl ring-1 ring-black ring-opacity-5 border border-secondary/20 focus:outline-none overflow-hidden">
                                                                    <div className="p-1.5">
                                                                        <button
                                                                            onClick={() => handleResetAttempt(sub.id, sub.student?.user?.full_name || 'Siswa', 'soft')}
                                                                            className="w-full text-left px-3 py-2.5 hover:bg-secondary/10 rounded-lg transition-colors flex flex-col mb-1"
                                                                        >
                                                                            <span className="font-bold text-text-main dark:text-white flex items-center gap-1.5 text-xs">
                                                                                <RotateCcw className="w-3.5 h-3.5 text-blue-500" /> Soft Reset
                                                                            </span>
                                                                            <span className="text-text-secondary mt-0.5 text-[10px] leading-tight">Lanjutkan, timer tetap berjalan & jawaban aman</span>
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handleResetAttempt(sub.id, sub.student?.user?.full_name || 'Siswa', 'hard')}
                                                                            className="w-full text-left px-3 py-2.5 hover:bg-red-500/10 rounded-lg transition-colors flex flex-col"
                                                                        >
                                                                            <span className="font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5 text-xs">
                                                                                <RotateCcw className="w-3.5 h-3.5" /> Hard Reset
                                                                            </span>
                                                                            <span className="text-red-600/70 dark:text-red-400/80 mt-0.5 text-[10px] leading-tight">Mulai dari awal (Jawaban dihapus, timer penuh)</span>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-text-secondary text-xs">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </Card>
                    )}
                </div>
            )}

            {/* Manual Mode - Inline Card */}
            {soalMode === 'manual' && (
                <Card className="p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold text-text-main dark:text-white">✏️ Tambah Soal Manual</h2>
                        <Button variant="ghost" onClick={() => { setSoalMode('list'); setIsPassageMode(false) }}>✕</Button>
                    </div>
                    <div className="space-y-5">
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe Soal</label>
                            <div className="flex gap-2">
                                <button onClick={() => { setIsPassageMode(false); setManualForm({ ...manualForm, question_type: 'MULTIPLE_CHOICE', options: ['', '', '', ''] }) }} className={`flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all ${!isPassageMode && manualForm.question_type === 'MULTIPLE_CHOICE' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>Pilihan Ganda</button>
                                <button onClick={() => { setIsPassageMode(false); setManualForm({ ...manualForm, question_type: 'ESSAY', options: null, correct_answer: null }) }} className={`flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all ${!isPassageMode && manualForm.question_type === 'ESSAY' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>Essay</button>
                                <button onClick={() => setIsPassageMode(true)} className={`flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all ${isPassageMode ? 'bg-teal-500 text-white shadow-lg shadow-teal-500/30' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>📖 Passage</button>
                            </div>
                        </div>

                        {isPassageMode ? (
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-bold text-teal-700 dark:text-teal-400 mb-2">📖 Teks Bacaan (Passage)</label>
                                    <textarea value={passageText} onChange={(e) => setPassageText(e.target.value)} className="w-full px-4 py-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-300 dark:border-teal-700 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-h-[120px]" placeholder="Tulis teks bacaan / passage di sini..." />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-violet-700 dark:text-violet-400 mb-2">🎧 Audio Listening (Opsional)</label>
                                    {passageAudioUrl ? (
                                        <div className="p-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-300 dark:border-violet-700 rounded-xl space-y-3">
                                            <audio controls className="w-full" src={passageAudioUrl} />
                                            <button onClick={() => setPassageAudioUrl('')} className="text-sm text-red-500 hover:text-red-700 font-medium">✕ Hapus Audio</button>
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            <input type="file" accept="audio/*" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 25*1024*1024) { showToast('Maks 25MB', 'error'); return }; setUploadingAudio(true); try { const fd = new FormData(); fd.append('file', file); const res = await fetch('/api/audio/upload', { method: 'POST', body: fd }); if (!res.ok) throw new Error('Upload gagal'); const { url } = await res.json(); setPassageAudioUrl(url) } catch(err: any) { showToast(err.message, 'error') } finally { setUploadingAudio(false); e.target.value = '' } }} className="hidden" id="uts-passage-audio" disabled={uploadingAudio} />
                                            <label htmlFor="uts-passage-audio" className={`flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed border-violet-300 dark:border-violet-700 rounded-xl text-sm font-medium transition-colors cursor-pointer ${uploadingAudio ? 'opacity-50 cursor-wait' : 'text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20'}`}>
                                                {uploadingAudio ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengupload...</> : <>🎵 Upload Audio (maks 25MB)</>}
                                            </label>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-3">Soal-soal untuk Passage ini ({passageQuestions.length})</label>
                                    <div className="space-y-4">
                                        {passageQuestions.map((pq, pqIdx) => (
                                            <div key={pqIdx} className="p-4 border border-secondary/20 rounded-xl bg-secondary/5">
                                                <div className="flex items-center justify-between mb-3">
                                                    <span className="text-sm font-bold text-text-main dark:text-white">Soal {pqIdx + 1}</span>
                                                    <div className="flex items-center gap-2">
                                                        <select value={pq.question_type} onChange={(e) => { const u = [...passageQuestions]; u[pqIdx] = { ...u[pqIdx], question_type: e.target.value as any, options: e.target.value === 'MULTIPLE_CHOICE' ? ['','','',''] : null, correct_answer: e.target.value === 'MULTIPLE_CHOICE' ? '' : null }; setPassageQuestions(u) }} className="text-xs px-2 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-secondary/30 text-text-main dark:text-white">
                                                            <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                                                            <option value="ESSAY">Essay</option>
                                                        </select>
                                                        {passageQuestions.length > 1 && <button onClick={() => setPassageQuestions(passageQuestions.filter((_, i) => i !== pqIdx))} className="text-red-500 hover:text-red-700 text-sm font-bold px-2">✕</button>}
                                                    </div>
                                                </div>
                                                <textarea value={pq.question_text} onChange={(e) => { const u = [...passageQuestions]; u[pqIdx] = { ...u[pqIdx], question_text: e.target.value }; setPassageQuestions(u) }} className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-secondary/20 rounded-lg text-text-main dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" rows={2} placeholder="Tulis pertanyaan..." />
                                                {pq.question_type === 'MULTIPLE_CHOICE' && (
                                                    <div className="mt-3 space-y-2">
                                                        <div className="grid grid-cols-2 gap-2">
                                                            {(pq.options || ['','','','']).map((_, optIdx) => { const letter = String.fromCharCode(65 + optIdx); return (
                                                                <input key={letter} type="text" value={pq.options?.[optIdx] || ''} onChange={(e) => { const u = [...passageQuestions]; const newOpts = [...(u[pqIdx].options || ['','','',''])]; newOpts[optIdx] = e.target.value; u[pqIdx] = { ...u[pqIdx], options: newOpts }; setPassageQuestions(u) }} className="px-3 py-1.5 bg-white dark:bg-zinc-800 border border-secondary/20 rounded-lg text-sm text-text-main dark:text-white" placeholder={`Opsi ${letter}`} />
                                                            )})}
                                                        </div>
                                                        <div className="flex gap-2 mt-2">
                                                            <span className="text-xs text-text-secondary mt-1">Jawaban:</span>
                                                            {(pq.options || ['','','','']).map((_, optIdx) => { const letter = String.fromCharCode(65 + optIdx); return (
                                                                <button key={letter} onClick={() => { const u = [...passageQuestions]; u[pqIdx] = { ...u[pqIdx], correct_answer: letter }; setPassageQuestions(u) }} className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${pq.correct_answer === letter ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>{letter}</button>
                                                            )})}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={() => setPassageQuestions([...passageQuestions, { id: '', question_text: '', question_type: 'MULTIPLE_CHOICE', options: ['','','',''], correct_answer: '', points: 10, order_index: 0, difficulty: null, passage_text: null }])} className="mt-3 w-full py-2 border-2 border-dashed border-teal-300 dark:border-teal-700 rounded-xl text-sm font-bold text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors">+ Tambah Soal Passage</button>
                                </div>
                                <div className="flex gap-3 pt-6 border-t border-secondary/10">
                                    <Button variant="secondary" onClick={() => { setSoalMode('list'); setIsPassageMode(false) }} className="flex-1">Batal</Button>
                                    <Button onClick={handleAddManualQuestion} disabled={saving || (!passageText.trim() && !passageAudioUrl) || !passageQuestions.some(q => q.question_text.trim())} loading={saving} className="flex-1 !bg-teal-600 hover:!bg-teal-700">{saving ? 'Menyimpan...' : `Simpan Passage + ${passageQuestions.filter(q => q.question_text.trim()).length} Soal`}</Button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pertanyaan</label>
                                    <MathTextarea value={manualForm.question_text} onChange={(val: string) => setManualForm({ ...manualForm, question_text: val })} placeholder="Tulis pertanyaan..." rows={3} />
                                </div>
                                {manualForm.question_type === 'MULTIPLE_CHOICE' && (
                                    <>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {(manualForm.options || ['','','','']).map((_, idx) => { const letter = String.fromCharCode(65 + idx); return (
                                                <div key={letter}>
                                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Opsi {letter}</label>
                                                    <div className="relative">
                                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-secondary/20 flex items-center justify-center text-xs font-bold text-text-secondary">{letter}</div>
                                                        <input type="text" value={manualForm.options?.[idx] || ''} onChange={(e) => { const o = [...(manualForm.options || ['','','',''])]; o[idx] = e.target.value; setManualForm({ ...manualForm, options: o }) }} className="w-full pl-12 pr-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm" placeholder={`Jawaban ${letter}`} />
                                                    </div>
                                                </div>
                                            )})}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kunci Jawaban</label>
                                        <div className="flex gap-3">
                                                {(manualForm.options || ['','','','']).map((_, idx) => { const letter = String.fromCharCode(65 + idx); return (
                                                    <button key={letter} onClick={() => setManualForm({ ...manualForm, correct_answer: letter })} className={`w-12 h-12 rounded-xl font-bold transition-all ${manualForm.correct_answer === letter ? 'bg-green-500 text-white shadow-lg shadow-green-500/30 scale-110' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>{letter}</button>
                                                )})}
                                            </div>
                                        </div>
                                    </>
                                )}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tingkat Kesulitan <span className="text-red-500">*</span></label>
                                        <select value={manualForm.difficulty || ''} onChange={(e) => setManualForm({ ...manualForm, difficulty: e.target.value as any })} className={`w-full px-3 py-2 bg-secondary/5 border rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary ${!manualForm.difficulty ? 'border-red-300' : 'border-secondary/30'}`}>
                                            <option value="">-- Pilih --</option>
                                            <option value="EASY">Mudah</option>
                                            <option value="MEDIUM">Sedang</option>
                                            <option value="HARD">Sulit</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Poin</label>
                                        <input type="number" value={manualForm.points} onChange={(e) => setManualForm({ ...manualForm, points: parseInt(e.target.value) || 10 })} className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary font-bold text-center" min={1} />
                                    </div>
                                </div>
                                {aiReviewEnabled && (
                                    <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                        <input type="checkbox" id="hots-uts" checked={manualForm.teacher_hots_claim || false} onChange={e => setManualForm({ ...manualForm, teacher_hots_claim: e.target.checked })} className="w-5 h-5 accent-emerald-600 rounded" />
                                        <label htmlFor="hots-uts" className="flex-1 cursor-pointer">
                                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">🧠 Klaim HOTS</p>
                                            <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">Centang jika soal ini membutuhkan kemampuan berpikir tingkat tinggi</p>
                                        </label>
                                    </div>
                                )}
                                <div className="flex gap-3 pt-6 border-t border-secondary/10">
                                    <Button variant="secondary" onClick={() => setSoalMode('list')} className="flex-1">Batal</Button>
                                    <Button onClick={handleAddManualQuestion} disabled={saving || !manualForm.question_text || !manualForm.difficulty || (manualForm.question_type === 'MULTIPLE_CHOICE' && !manualForm.correct_answer)} loading={saving} className="flex-1">{saving ? 'Menyimpan...' : 'Tambah Soal'}</Button>
                                </div>
                            </>
                        )}
                    </div>
                </Card>
            )}

            {/* Rapih AI Mode */}
            <RapihAIModal
                visible={soalMode === 'clean'}
                onClose={() => setSoalMode('list')}
                onSaveResults={handleRapihSaveToExam}
                onSaveToBank={handleRapihSaveToBank}
                saving={rapihSaving}
                targetLabel="UTS/UAS"
                aiReviewEnabled={aiReviewEnabled}
                showBankSoal={false}
            />

            {/* Bank Soal Mode */}
            {soalMode === 'bank' && (
                <Card className="p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold text-text-main dark:text-white">🗃️ Ambil dari Bank Soal</h2>
                        <Button variant="ghost" onClick={() => { setSoalMode('list'); setSelectedBankIds(new Set()) }}>✕</Button>
                    </div>
                    {bankLoading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                    ) : bankQuestions.length === 0 && bankPassages.length === 0 ? (
                        <EmptyState icon="🗃️" title="Bank Soal Kosong" description="Belum ada soal tersimpan untuk mata pelajaran ini." />
                    ) : (
                        <>
                            <p className="text-sm text-text-secondary dark:text-zinc-400 mb-4">Pilih soal yang ingin ditambahkan:</p>
                            {bankPassages.length > 0 && (
                                <div className="mb-6">
                                    <h3 className="text-md font-bold text-text-main dark:text-white mb-3">📖 Passage ({bankPassages.length})</h3>
                                    <div className="space-y-3">
                                        {bankPassages.map((p: any) => (
                                            <div key={p.id} className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-xl overflow-hidden">
                                                <div className="p-4 cursor-pointer hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-colors" onClick={() => { const ids = (p.questions || []).map((q: any) => q.id); const all = ids.every((id: string) => selectedBankIds.has(id)); const s = new Set(selectedBankIds); if (all) ids.forEach((id: string) => s.delete(id)); else ids.forEach((id: string) => s.add(id)); setSelectedBankIds(s) }}>
                                                    <div className="flex items-center gap-3">
                                                        <input type="checkbox" checked={(p.questions||[]).length > 0 && (p.questions||[]).every((q: any) => selectedBankIds.has(q.id))} readOnly className="w-5 h-5 rounded bg-teal-100 border-teal-300 text-teal-600" />
                                                        <div className="flex-1">
                                                            <h4 className="font-bold text-text-main dark:text-white">{p.title || 'Untitled'}</h4>
                                                            <span className="text-xs text-teal-600 dark:text-teal-400">{p.questions?.length || 0} soal</span>
                                                        </div>
                                                    </div>
                                                    <p className="text-sm text-text-secondary mt-2 line-clamp-2">{p.passage_text}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {bankQuestions.filter((q: any) => q.passage_id == null).length > 0 && (
                                <div className="mb-4">
                                    <h3 className="text-md font-bold text-text-main dark:text-white mb-3">❓ Soal Mandiri ({bankQuestions.filter((q: any) => q.passage_id == null).length})</h3>
                                    <div className="space-y-3 max-h-72 overflow-y-auto pr-2">
                                        {bankQuestions.filter((q: any) => q.passage_id == null).map((q: any) => (
                                            <label key={q.id} className={`flex items-start gap-3 p-4 rounded-xl cursor-pointer transition-all border ${selectedBankIds.has(q.id) ? 'bg-primary/10 border-primary' : 'bg-secondary/5 border-transparent hover:bg-secondary/10'}`}>
                                                <input type="checkbox" checked={selectedBankIds.has(q.id)} onChange={(e) => { const s = new Set(selectedBankIds); e.target.checked ? s.add(q.id) : s.delete(q.id); setSelectedBankIds(s) }} className="mt-1 w-5 h-5 rounded" />
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className={`px-2 py-0.5 text-xs rounded ${q.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{q.question_type === 'MULTIPLE_CHOICE' ? 'PG' : 'Essay'}</span>
                                                    </div>
                                                    <p className="text-text-main dark:text-white text-sm">{q.question_text}</p>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="flex gap-3 pt-4 border-t border-secondary/20 mt-4">
                                <Button variant="secondary" onClick={() => { const all = [...bankQuestions.filter((q: any) => q.passage_id == null).map((q: any) => q.id), ...bankPassages.flatMap((p: any) => (p.questions||[]).map((q: any) => q.id))]; selectedBankIds.size === all.length ? setSelectedBankIds(new Set()) : setSelectedBankIds(new Set(all)) }}>Pilih Semua</Button>
                                <Button onClick={async () => { if (selectedBankIds.size === 0) return; setSaving(true); try { const pQs = bankPassages.flatMap((p: any) => (p.questions||[]).map((q: any) => ({ ...q, passage_text: p.passage_text, passage_audio_url: p.audio_url || null }))); const all = [...bankQuestions.filter((q: any) => q.passage_id == null), ...pQs]; const sel = all.filter((q: any) => selectedBankIds.has(q.id)).map((q: any, idx: number) => ({ question_text: q.question_text, question_type: q.question_type, options: q.options, correct_answer: q.correct_answer, difficulty: q.difficulty || 'MEDIUM', points: 10, order_index: questions.length + idx, passage_text: q.passage_text || null, passage_audio_url: q.passage_audio_url || null, teacher_hots_claim: q.teacher_hots_claim || false })); await fetch(`/api/official-exams/${examId}/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questions: sel }) }); setSelectedBankIds(new Set()); setSoalMode('list'); fetchQuestions() } finally { setSaving(false) } }} disabled={saving || selectedBankIds.size === 0} loading={saving} className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600">{saving ? 'Menyimpan...' : `Tambahkan ${selectedBankIds.size} Soal`}</Button>
                            </div>
                        </>
                    )}
                </Card>
            )}

            {/* Edit Question Modal */}
            <Modal open={!!editingQuestionId} onClose={() => { setEditingQuestionId(null); setEditQuestionForm(null) }} title="✏️ Edit Soal">
                {editQuestionForm && (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pertanyaan</label>
                            <MathTextarea value={editQuestionForm.question_text} onChange={(val: string) => setEditQuestionForm({ ...editQuestionForm, question_text: val })} placeholder="Tulis pertanyaan..." rows={3} />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Gambar Soal (Opsional)</label>
                            <div className="flex items-start gap-4">
                                <QuestionImageUpload
                                    imageUrl={editQuestionForm.image_url}
                                    onImageChange={(url) => setEditQuestionForm({ ...editQuestionForm, image_url: url })}
                                    disabled={false}
                                />
                                {editQuestionForm.image_url && (
                                    <div className="flex-1 bg-secondary/5 rounded-xl border border-secondary/20 p-2 text-center">
                                        <img src={editQuestionForm.image_url} className="max-h-40 mx-auto rounded-lg" alt="Preview" />
                                    </div>
                                )}
                            </div>
                        </div>
                        {editQuestionForm.question_type === 'MULTIPLE_CHOICE' && editQuestionForm.options && (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {(editQuestionForm.options || ['','','','']).map((_, idx) => { const letter = String.fromCharCode(65 + idx); return (
                                        <div key={letter}>
                                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Opsi {letter}</label>
                                            <input type="text" value={editQuestionForm.options?.[idx] || ''} onChange={(e) => { const o = [...(editQuestionForm.options || [])]; o[idx] = e.target.value; setEditQuestionForm({ ...editQuestionForm, options: o }) }} className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm" placeholder={`Opsi ${letter}`} />
                                        </div>
                                    )})}
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kunci Jawaban</label>
                                    <div className="flex gap-3 mt-2">
                                        {(editQuestionForm.options || ['','','','']).map((_, idx) => { const letter = String.fromCharCode(65 + idx); return (
                                            <button key={letter} onClick={() => setEditQuestionForm({ ...editQuestionForm, correct_answer: letter })} className={`w-12 h-12 rounded-xl font-bold transition-all ${editQuestionForm.correct_answer === letter ? 'bg-green-500 text-white shadow-lg shadow-green-500/30 scale-110' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>{letter}</button>
                                        )})}
                                    </div>
                                </div>
                            </>
                        )}
                        {aiReviewEnabled && (
                            <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                <input type="checkbox" id="hots-edit" checked={editQuestionForm.teacher_hots_claim || false} onChange={e => setEditQuestionForm({ ...editQuestionForm, teacher_hots_claim: e.target.checked })} className="w-5 h-5 accent-emerald-600 rounded" />
                                <label htmlFor="hots-edit" className="cursor-pointer"><p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">🧠 Klaim HOTS</p></label>
                            </div>
                        )}
                        <div className="flex gap-3 pt-4 border-t border-secondary/10">
                            <Button variant="secondary" onClick={() => { setEditingQuestionId(null); setEditQuestionForm(null) }} className="flex-1">Batal</Button>
                            <Button onClick={handleSaveEdit} loading={saving} disabled={!editQuestionForm.question_text} className="flex-1">Simpan Perubahan</Button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Preview Modal */}
            <PreviewModal
                open={showPreview}
                onClose={() => setShowPreview(false)}
                title={exam.title}
                description={exam.description}
                durationMinutes={exam.duration_minutes}
                questions={questions}
                type="ulangan"
            />

            {/* Toast Notification */}
            {toast && (
                <div className={`fixed bottom-6 right-6 z-[200] px-5 py-3 rounded-xl shadow-2xl text-white font-medium text-sm flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-300 ${
                    toast.type === 'success' ? 'bg-green-500' : toast.type === 'error' ? 'bg-red-500' : 'bg-amber-500'
                }`}>
                    <span>{toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : '⚠️'}</span>
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
                            <button onClick={() => setConfirmDialog(null)} className="flex-1 py-3 bg-gray-200 dark:bg-slate-700 text-text-main dark:text-white rounded-xl font-bold hover:bg-gray-300 transition-colors">
                                Batal
                            </button>
                            <button onClick={confirmDialog.onConfirm} className="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors">
                                Hapus
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
