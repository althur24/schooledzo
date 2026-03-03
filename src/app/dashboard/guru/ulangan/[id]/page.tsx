'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import SmartText from '@/components/SmartText'
// Dynamic imports for heavy components (mathlive 5.6MB, AI modal 724 lines)
const MathTextarea = dynamic(() => import('@/components/MathTextarea'), {
    ssr: false,
    loading: () => <textarea placeholder="Memuat editor..." className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main" rows={3} readOnly />
})
const PreviewModal = dynamic(() => import('@/components/PreviewModal'), { ssr: false })
const RapihAIModal = dynamic(() => import('@/components/RapihAIModal'), { ssr: false })
// import { PenLine, WandSparkles, FolderOpen, Plus } from 'lucide-react'
import { Edit, Discovery, Folder, Plus, Setting, Upload, Danger, InfoCircle, Document, TickSquare, CloseSquare, Delete } from 'react-iconly'
import { Loader2, Eye, Brain } from 'lucide-react'
import QuestionImageUpload from '@/components/QuestionImageUpload'
import { Modal, PageHeader, Button, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'

interface ExamQuestion {
    id?: string
    question_text: string
    question_type: 'ESSAY' | 'MULTIPLE_CHOICE'
    options: string[] | null
    correct_answer: string | null
    points: number
    order_index: number
    image_url?: string | null
    passage_text?: string | null
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD'
    status?: string
    teacher_hots_claim?: boolean
}

interface Exam {
    id: string
    title: string
    description: string | null
    start_time: string
    duration_minutes: number
    is_active: boolean
    pending_publish: boolean
    is_randomized: boolean
    max_violations: number
    teaching_assignment: {
        subject: { id: string; name: string }
        class: { name: string }
    }
}

type Mode = 'list' | 'manual' | 'clean' | 'ai' | 'bank'

export default function EditExamPage() {
    const params = useParams()
    const examId = params.id as string

    const [exam, setExam] = useState<Exam | null>(null)
    const [questions, setQuestions] = useState<ExamQuestion[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [mode, setMode] = useState<Mode>('list')
    const [showAddDropdown, setShowAddDropdown] = useState(false)

    // Manual mode state
    const [manualForm, setManualForm] = useState<ExamQuestion>({
        question_text: '',
        question_type: 'MULTIPLE_CHOICE',
        options: ['', '', '', ''],
        correct_answer: '',
        points: 10,
        order_index: 0,
        teacher_hots_claim: false
    })

    // Passage mode state
    const [isPassageMode, setIsPassageMode] = useState(false)
    const [passageText, setPassageText] = useState('')
    const [passageQuestions, setPassageQuestions] = useState<ExamQuestion[]>([{
        question_text: '', question_type: 'MULTIPLE_CHOICE', options: ['', '', '', ''], correct_answer: '', points: 10, order_index: 0
    }])

    // Calculate total points
    const totalPoints = questions.reduce((sum, q) => sum + (q.points || 0), 0)
    const getDefaultPoints = () => Math.floor(100 / (questions.length + 1))



    // Bank Soal mode state
    const [bankQuestions, setBankQuestions] = useState<any[]>([])
    const [bankPassages, setBankPassages] = useState<any[]>([])
    const [bankLoading, setBankLoading] = useState(false)
    const [selectedBankIds, setSelectedBankIds] = useState<Set<string>>(new Set())

    // Edit mode state
    const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
    const [editQuestionForm, setEditQuestionForm] = useState<ExamQuestion | null>(null)

    // Bulk selection state for delete
    const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set())
    const [isBulkSelectMode, setIsBulkSelectMode] = useState(false)

    const [showPublishConfirm, setShowPublishConfirm] = useState(false)
    const [showPreview, setShowPreview] = useState(false)
    const [publishing, setPublishing] = useState(false)
    const [showSuccessModal, setShowSuccessModal] = useState(false)
    const [alertInfo, setAlertInfo] = useState<{ type: 'info' | 'warning' | 'error' | 'success', title: string, message: string } | null>(null)

    // Edit settings state
    const [showEditSettings, setShowEditSettings] = useState(false)
    const [editForm, setEditForm] = useState({
        title: '',
        description: '',
        start_time: '',
        duration_minutes: 60,
        max_violations: 3,
        is_randomized: true
    })
    const [savingSettings, setSavingSettings] = useState(false)

    const fetchExam = useCallback(async () => {
        try {
            const [examRes, questionsRes] = await Promise.all([
                fetch(`/api/exams/${examId}`),
                fetch(`/api/exams/${examId}/questions`)
            ])
            const examData = await examRes.json()
            const questionsData = await questionsRes.json()
            setExam(examData)
            setQuestions(Array.isArray(questionsData) ? questionsData : [])
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }, [examId])

    useEffect(() => {
        fetchExam()
    }, [fetchExam])

    const handlePublishClick = () => {
        if (questions.length === 0) {
            setAlertInfo({ type: 'warning', title: 'Belum Ada Soal', message: 'Minimal harus ada 1 soal untuk mempublish ulangan!' })
            return
        }
        setShowPublishConfirm(true)
    }

    const confirmPublish = async () => {
        setPublishing(true)
        try {
            const res = await fetch(`/api/exams/${examId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: true })
            })
            if (res.ok) {
                const data = await res.json()
                setShowPublishConfirm(false)

                if (data._status === 'under_review') {
                    setAlertInfo({ type: 'info', title: '🔍 Ulangan Dalam Review', message: 'Ulangan berhasil disimpan! Ada soal yang masih dalam proses review. Ulangan akan otomatis terpublish ke siswa setelah semua soal disetujui.' })
                } else {
                    setShowSuccessModal(true)
                }

                fetchExam()
            } else {
                throw new Error('Gagal mempublish ulangan')
            }
        } catch (error) {
            console.error('Error publishing:', error)
            setAlertInfo({ type: 'error', title: 'Gagal Publish', message: 'Terjadi kesalahan saat mempublish ulangan. Coba lagi.' })
        } finally {
            setPublishing(false)
        }
    }

    const openEditSettings = () => {
        if (exam) {
            // Format datetime for input, localized
            const startTime = new Date(exam.start_time)
            startTime.setMinutes(startTime.getMinutes() - startTime.getTimezoneOffset());
            const formattedTime = startTime.toISOString().slice(0, 16)

            setEditForm({
                title: exam.title,
                description: exam.description || '',
                start_time: formattedTime,
                duration_minutes: exam.duration_minutes,
                max_violations: exam.max_violations,
                is_randomized: exam.is_randomized
            })
            setShowEditSettings(true)
        }
    }

    const handleSaveSettings = async () => {
        if (!editForm.title || !editForm.start_time) {
            setAlertInfo({ type: 'warning', title: 'Form Tidak Lengkap', message: 'Judul dan waktu mulai wajib diisi!' })
            return
        }
        setSavingSettings(true)
        try {
            const res = await fetch(`/api/exams/${examId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: editForm.title,
                    description: editForm.description,
                    start_time: new Date(editForm.start_time).toISOString(),
                    duration_minutes: editForm.duration_minutes,
                    max_violations: editForm.max_violations,
                    is_randomized: editForm.is_randomized
                })
            })
            if (res.ok) {
                setShowEditSettings(false)
                fetchExam()
            } else {
                setAlertInfo({ type: 'error', title: 'Gagal Menyimpan', message: 'Gagal menyimpan pengaturan ulangan. Coba lagi.' })
            }
        } catch (error) {
            console.error('Error saving settings:', error)
            setAlertInfo({ type: 'error', title: 'Gagal Menyimpan', message: 'Gagal menyimpan pengaturan ulangan. Coba lagi.' })
        } finally {
            setSavingSettings(false)
        }
    }

    const handleAddManualQuestion = async () => {
        // Passage mode: save all passage questions at once
        if (isPassageMode) {
            if (!passageText.trim() || passageQuestions.length === 0) return
            const hasQuestion = passageQuestions.some(q => q.question_text.trim())
            if (!hasQuestion) return
            setSaving(true)
            try {
                const questionsToSave = passageQuestions
                    .filter(q => q.question_text.trim())
                    .map((q, idx) => ({
                        question_text: q.question_text,
                        question_type: q.question_type,
                        options: q.question_type === 'MULTIPLE_CHOICE' ? q.options : null,
                        correct_answer: q.correct_answer || null,
                        points: q.points || 10,
                        order_index: questions.length + idx,
                        passage_text: passageText
                    }))
                await fetch(`/api/exams/${examId}/questions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ questions: questionsToSave })
                })
                setPassageText('')
                setPassageQuestions([{ question_text: '', question_type: 'MULTIPLE_CHOICE', options: ['', '', '', ''], correct_answer: '', points: 10, order_index: 0 }])
                setIsPassageMode(false)
                setMode('list')
                fetchExam()
            } finally {
                setSaving(false)
            }
            return
        }

        // Normal single-question mode
        if (!manualForm.question_text) return
        setSaving(true)
        try {
            await fetch(`/api/exams/${examId}/questions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    questions: [{
                        ...manualForm,
                        order_index: questions.length,
                        options: manualForm.question_type === 'MULTIPLE_CHOICE' ? manualForm.options : null
                    }]
                })
            })
            setManualForm({
                question_text: '',
                question_type: 'MULTIPLE_CHOICE',
                options: ['', '', '', ''],
                correct_answer: '',
                points: 10,
                order_index: 0,
                teacher_hots_claim: false
            })
            setMode('list')
            fetchExam()
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteQuestion = async (questionId: string) => {
        if (!confirm('Hapus soal ini?')) return
        await fetch(`/api/exams/${examId}/questions?question_id=${questionId}`, { method: 'DELETE' })
        fetchExam()
    }

    const handleSaveEdit = async () => {
        if (!editQuestionForm || !editingQuestionId) return
        setSaving(true)
        try {
            await fetch(`/api/exams/${examId}/questions`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: editingQuestionId,
                    question_text: editQuestionForm.question_text,
                    options: editQuestionForm.options,
                    correct_answer: editQuestionForm.correct_answer
                })
            })
            setEditingQuestionId(null)
            setEditQuestionForm(null)
            fetchExam()
        } finally {
            setSaving(false)
        }
    }

    const handleBulkDelete = async () => {
        if (selectedQuestionIds.size === 0) return
        if (!confirm(`Hapus ${selectedQuestionIds.size} soal yang dipilih?`)) return
        try {
            for (const qId of selectedQuestionIds) {
                await fetch(`/api/exams/${examId}/questions?question_id=${qId}`, { method: 'DELETE' })
            }
            setSelectedQuestionIds(new Set())
            setIsBulkSelectMode(false)
            fetchExam()
        } catch (error) {
            console.error('Bulk delete error:', error)
        }
    }

    const handleSaveResults = async (results: ExamQuestion[]) => {
        if (results.length === 0) return
        setSaving(true)
        try {
            const newQuestions = results.map((q, idx) => ({
                question_text: q.question_text,
                question_type: q.question_type,
                options: q.options || null,
                correct_answer: q.correct_answer || null,
                difficulty: q.difficulty || 'MEDIUM',
                points: q.points || 10,
                order_index: questions.length + idx,
                passage_text: q.passage_text || null,
                teacher_hots_claim: q.teacher_hots_claim || false,
            }))

            const res = await fetch(`/api/exams/${examId}/questions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ questions: newQuestions })
            })

            if (!res.ok) {
                const text = await res.text()
                let errData
                try {
                    errData = JSON.parse(text)
                } catch {
                    errData = { error: text }
                }
                console.error('Error saving AI questions:', errData, res.status)
                setAlertInfo({ type: 'error', title: 'Gagal Menyimpan', message: 'Gagal menyimpan soal: ' + (errData.error || 'Server error') })
                return
            }

            setMode('list')
            await fetchExam()
        } catch (err) {
            console.error('Error saving AI results:', err)
            setAlertInfo({ type: 'error', title: 'Gagal Menyimpan', message: 'Gagal menyimpan soal. Cek koneksi internet.' })
        } finally {
            setSaving(false)
        }
    }

    const handleSaveToBank = async (results: ExamQuestion[]) => {
        if (results.length === 0) return
        try {
            const subjectId = exam?.teaching_assignment?.subject?.id || null

            // Separate passage questions from standalone questions
            const passageGroups = new Map<string, any[]>()
            const standaloneQuestions: any[] = []

            results.forEach(q => {
                if (q.passage_text) {
                    const key = q.passage_text
                    if (!passageGroups.has(key)) passageGroups.set(key, [])
                    passageGroups.get(key)!.push(q)
                } else {
                    standaloneQuestions.push(q)
                }
            })

            const promises = []

            // Save standalone questions to question bank
            if (standaloneQuestions.length > 0) {
                promises.push(
                    fetch('/api/question-bank', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(standaloneQuestions.map(q => ({
                            question_text: q.question_text,
                            question_type: q.question_type,
                            options: q.options || null,
                            correct_answer: q.correct_answer || null,
                            difficulty: q.difficulty || 'MEDIUM',
                            subject_id: subjectId,
                            tags: null
                        })))
                    }).then(res => {
                        if (!res.ok) throw new Error('Gagal menyimpan soal mandiri ke Bank Soal.')
                    })
                )
            }

            // Save passage-based questions as passages
            for (const [passageText, pQuestions] of passageGroups) {
                promises.push(
                    fetch('/api/passages', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            title: passageText.substring(0, 50) + '...',
                            passage_text: passageText,
                            subject_id: subjectId,
                            questions: pQuestions.map(q => ({
                                question_text: q.question_text,
                                question_type: q.question_type,
                                options: q.options || null,
                                correct_answer: q.correct_answer || null,
                                difficulty: q.difficulty || 'MEDIUM'
                            }))
                        })
                    }).then(res => {
                        if (!res.ok) throw new Error('Gagal menyimpan bacaan ke Bank Soal.')
                    })
                )
            }

            await Promise.all(promises)

        } catch (error) {
            console.error('Error saving to bank:', error)
            setAlertInfo({ type: 'error', title: 'Gagal', message: 'Gagal menyimpan ke Bank Soal.' })
        }
    }

    const formatDateTime = (dateString: string) => {
        return new Date(dateString).toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        })
    }

    if (loading) {
        return <div className="text-center text-text-secondary py-12 flex justify-center"><div className="animate-spin text-primary"><Loader2 className="w-10 h-10" /></div></div>
    }

    if (!exam) {
        return <div className="text-center text-text-secondary py-8">Ulangan tidak ditemukan</div>
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={exam.title}
                subtitle={`${exam.teaching_assignment?.class?.name} • ${exam.teaching_assignment?.subject?.name}`}
                backHref="/dashboard/guru/ulangan"
                action={
                    <div className="flex items-center gap-3">
                        <Button
                            variant="secondary"
                            onClick={() => setShowPreview(true)}
                            disabled={questions.length === 0}
                        >
                            <Eye className="w-4 h-4 mr-1" />
                            Preview
                        </Button>
                        <Button variant="secondary" onClick={openEditSettings} icon={
                            <Setting set="bold" primaryColor="currentColor" size={20} />
                        }>
                            Pengaturan
                        </Button>
                        {!exam.is_active && (
                            <Button
                                onClick={handlePublishClick}
                                disabled={questions.length === 0}
                                icon={
                                    <Upload set="bold" primaryColor="currentColor" size={20} />
                                }
                            >
                                Publish Ulangan
                            </Button>
                        )}
                        <div className="flex items-center gap-4 border-l border-secondary/20 pl-4">
                            <div className="text-right">
                                <p className={`text-2xl font-bold ${totalPoints > 100 ? 'text-red-500' : totalPoints === 100 ? 'text-green-500' : 'text-amber-500'}`}>
                                    {totalPoints}
                                </p>
                                <p className="text-xs text-text-secondary">Total Poin</p>
                            </div>
                            <div className="text-right">
                                <p className="text-2xl font-bold text-primary">{questions.length}</p>
                                <p className="text-xs text-text-secondary">Soal</p>
                            </div>
                        </div>
                    </div>
                }
            />

            {/* Points Warning */}
            {totalPoints !== 100 && questions.length > 0 && (
                <div className={`px-4 py-3 rounded-xl flex items-center justify-between ${totalPoints > 100 ? 'bg-red-500/10 border border-red-200 dark:border-red-500/30' : 'bg-amber-500/10 border border-amber-200 dark:border-amber-500/30'}`}>
                    <div className="flex items-center gap-2">
                        <span>{totalPoints > 100 ? <Danger set="bold" primaryColor="currentColor" size={20} /> : <InfoCircle set="bold" primaryColor="currentColor" size={20} />}</span>
                        <span className={totalPoints > 100 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-amber-600 dark:text-amber-400 font-medium'}>
                            {totalPoints > 100
                                ? `Total poin melebihi 100 (${totalPoints}). Kurangi poin beberapa soal.`
                                : `Total poin: ${totalPoints}/100. Disarankan total = 100.`
                            }
                        </span>
                    </div>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                            const pointPerQuestion = Math.floor(100 / questions.length)
                            const remainder = 100 - (pointPerQuestion * questions.length)
                            const balanced = questions.map((q, idx) => ({
                                ...q,
                                points: pointPerQuestion + (idx < remainder ? 1 : 0)
                            }))
                            setQuestions(balanced)
                            balanced.forEach(async (q) => {
                                if (q.id) {
                                    await fetch(`/api/exams/${examId}/questions`, {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ question_id: q.id, points: q.points })
                                    })
                                }
                            })
                        }}
                    >
                        Seimbangkan Poin
                    </Button>
                </div>
            )}

            {/* Mode Tabs */}
            {mode === 'list' && (
                <div className="relative inline-block">
                    <button
                        onClick={() => setShowAddDropdown(!showAddDropdown)}
                        className="flex items-center gap-2 px-5 py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 active:scale-95 transition-all shadow-md shadow-primary/20 cursor-pointer"
                    >
                        <Plus set="bold" primaryColor="currentColor" size={20} />
                        Tambah Soal
                    </button>
                    {showAddDropdown && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowAddDropdown(false)} />
                            <div className="absolute left-0 top-full mt-2 z-50 w-64 bg-white rounded-xl shadow-xl border border-gray-200 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                <button
                                    onClick={() => {
                                        setManualForm({
                                            ...manualForm,
                                            points: getDefaultPoints(),
                                            question_text: '',
                                            correct_answer: '',
                                            options: ['', '', '', '']
                                        })
                                        setMode('manual')
                                        setShowAddDropdown(false)
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors cursor-pointer"
                                >
                                    <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                                        <Edit set="bold" primaryColor="currentColor" size={16} />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-sm font-semibold text-text-main">Manual</div>
                                        <div className="text-xs text-text-secondary">Ketik soal satu per satu</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => { setMode('clean'); setShowAddDropdown(false) }}
                                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-purple-50 transition-colors cursor-pointer"
                                >
                                    <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                                        <Discovery set="bold" primaryColor="currentColor" size={16} />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-sm font-semibold text-text-main">Rapih AI</div>
                                        <div className="text-xs text-text-secondary">Rapikan, generate, atau upload soal</div>
                                    </div>
                                </button>
                                <button
                                    onClick={async () => {
                                        setShowAddDropdown(false)
                                        setMode('bank')
                                        setBankLoading(true)
                                        try {
                                            const subjectId = exam?.teaching_assignment?.subject?.id || ''
                                            const [questionsRes, passagesRes] = await Promise.all([
                                                fetch(`/api/question-bank?subject_id=${subjectId}`),
                                                fetch(`/api/passages?subject_id=${subjectId}`)
                                            ])
                                            const questionsData = await questionsRes.json()
                                            const passagesData = await passagesRes.json()
                                            setBankQuestions(Array.isArray(questionsData) ? questionsData : [])
                                            setBankPassages(Array.isArray(passagesData) ? passagesData : [])
                                        } catch (e) {
                                            console.error(e)
                                        } finally {
                                            setBankLoading(false)
                                        }
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-emerald-50 transition-colors cursor-pointer"
                                >
                                    <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                                        <Folder set="bold" primaryColor="currentColor" size={16} />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-sm font-semibold text-text-main">Bank Soal</div>
                                        <div className="text-xs text-text-secondary">Pilih dari soal tersimpan</div>
                                    </div>
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Question List */}
            {mode === 'list' && (
                <div className="space-y-4">
                    {/* "Under Review" Banner */}
                    {exam?.pending_publish && (
                        <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                            <div className="flex gap-3">
                                <div className="mt-0.5 rounded-full bg-amber-100 dark:bg-amber-800 p-2 text-amber-600 dark:text-amber-400 shrink-0">
                                    <Brain size={20} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-amber-800 dark:text-amber-300">Ulangan Sedang Direview</h3>
                                    <p className="text-sm text-amber-700/80 dark:text-amber-400/80 mt-1">
                                        Anda telah mempublikasi ulangan ini, tetapi ada soal yang masih menunggu persetujuan (oleh AI atau Admin). Ulangan akan otomatis terkirim ke siswa segera setelah semua soal disetujui.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Bulk Selection Toolbar */}
                    {questions.length > 0 && !exam?.is_active && !exam?.pending_publish && (
                        <div className="flex items-center justify-between bg-white dark:bg-surface-dark rounded-xl p-3 border border-secondary/20">
                            <div className="flex items-center gap-3">
                                <Button
                                    variant={isBulkSelectMode ? 'primary' : 'secondary'}
                                    onClick={() => {
                                        setIsBulkSelectMode(!isBulkSelectMode)
                                        setSelectedQuestionIds(new Set())
                                    }}
                                    className="text-sm"
                                >
                                    {isBulkSelectMode ? '✓ Mode Pilih Aktif' : '☐ Pilih Beberapa'}
                                </Button>
                                {isBulkSelectMode && (
                                    <>
                                        <Button
                                            variant="secondary"
                                            onClick={() => {
                                                if (selectedQuestionIds.size === questions.length) {
                                                    setSelectedQuestionIds(new Set())
                                                } else {
                                                    setSelectedQuestionIds(new Set(questions.map(q => q.id || '')))
                                                }
                                            }}
                                            className="text-sm"
                                        >
                                            {selectedQuestionIds.size === questions.length ? 'Batal Pilih Semua' : 'Pilih Semua'}
                                        </Button>
                                        <span className="text-sm text-text-secondary">
                                            {selectedQuestionIds.size} dipilih
                                        </span>
                                    </>
                                )}
                            </div>
                            {isBulkSelectMode && selectedQuestionIds.size > 0 && (
                                <Button
                                    onClick={handleBulkDelete}
                                    className="bg-red-500 hover:bg-red-600 text-white text-sm"
                                >
                                    <Delete set="bold" primaryColor="currentColor" size={16} /> Hapus {selectedQuestionIds.size} Soal
                                </Button>
                            )}
                        </div>
                    )}

                    {questions.length === 0 ? (
                        <EmptyState
                            icon={<div className="text-secondary"><Document set="bold" primaryColor="currentColor" size={48} /></div>}
                            title="Belum Ada Soal"
                            description="Pilih salah satu metode di atas untuk menambahkan soal."
                        />
                    ) : (
                        questions.map((q, idx) => (
                            <Card key={q.id || idx} className={`p-5 ${selectedQuestionIds.has(q.id || '') ? 'ring-2 ring-primary' : ''}`}>
                                <div className="flex items-start gap-5">
                                    {/* Checkbox for bulk select */}
                                    {isBulkSelectMode && (
                                        <input
                                            type="checkbox"
                                            checked={selectedQuestionIds.has(q.id || '')}
                                            onChange={(e) => {
                                                const newSet = new Set(selectedQuestionIds)
                                                e.target.checked ? newSet.add(q.id || '') : newSet.delete(q.id || '')
                                                setSelectedQuestionIds(newSet)
                                            }}
                                            className="w-5 h-5 mt-1 rounded bg-secondary/10 border-secondary/30 text-primary focus:ring-primary cursor-pointer"
                                        />
                                    )}
                                    <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-lg flex-shrink-0">
                                        {idx + 1}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-3">
                                            <span className={`px-2.5 py-1 text-xs font-bold rounded-full border ${q.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-500/20 dark:text-blue-400' : 'bg-orange-500/10 text-orange-600 border-orange-200 dark:border-orange-500/20 dark:text-orange-400'}`}>
                                                {q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 'Essay'}
                                            </span>
                                            {q.passage_text && (
                                                <span className="px-2 py-0.5 text-xs rounded-full bg-teal-500/20 text-teal-600 dark:text-teal-400">
                                                    📖 Passage
                                                </span>
                                            )}
                                            {q.status === 'approved' && <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">✅</span>}
                                            {q.status === 'admin_review' && <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">⚠️ Review</span>}
                                            {q.status === 'returned' && <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">❌ Returned</span>}
                                            {q.status === 'ai_reviewing' && <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 animate-pulse">🤖</span>}
                                        </div>

                                        {/* Passage text if exists */}
                                        {q.passage_text && (
                                            <div className="mb-3 p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg overflow-hidden">
                                                <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-1 flex items-center gap-1"><Document set="bold" primaryColor="currentColor" size={12} /> Bacaan:</p>
                                                <p className="text-sm text-text-main dark:text-white whitespace-pre-wrap break-all" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{q.passage_text}</p>
                                            </div>
                                        )}

                                        <SmartText text={q.question_text} className="prose dark:prose-invert max-w-none text-text-main dark:text-white mb-4" />
                                        {/* Display question image if exists */}
                                        {q.image_url && (
                                            <div className="mb-4">
                                                <img src={q.image_url} alt="Gambar soal" className="max-h-60 rounded-xl border border-secondary/20" />
                                            </div>
                                        )}
                                        {q.question_type === 'MULTIPLE_CHOICE' && q.options && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                                {q.options.map((opt, optIdx) => (
                                                    <div key={optIdx} className={`px-4 py-3 rounded-xl border flex items-center gap-3 ${q.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-500/10 border-green-200 text-green-700 dark:border-green-500/30 dark:text-green-400' : 'bg-secondary/5 border-transparent text-text-secondary'}`}>
                                                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${q.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-500 text-white' : 'bg-secondary/20 text-text-secondary'}`}>
                                                            {String.fromCharCode(65 + optIdx)}
                                                        </span>
                                                        <SmartText text={opt} as="span" />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-3 items-end border-l border-secondary/10 pl-5">
                                        {/* Points edit input */}
                                        <div className="flex flex-col items-center">
                                            <div className="flex items-center gap-1.5">
                                                <input
                                                    type="number"
                                                    value={q.points}
                                                    onChange={(e) => {
                                                        const newPoints = parseInt(e.target.value) || 1
                                                        const updated = questions.map((question, i) =>
                                                            i === idx ? { ...question, points: newPoints } : question
                                                        )
                                                        setQuestions(updated)
                                                    }}
                                                    onBlur={async (e) => {
                                                        if (q.id) {
                                                            try {
                                                                const currentPoints = parseInt(e.target.value) || 1
                                                                await fetch(`/api/exams/${examId}/questions`, {
                                                                    method: 'PUT',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ question_id: q.id, points: currentPoints })
                                                                })
                                                            } catch (error) {
                                                                console.error('Failed to update points:', error)
                                                            }
                                                        }
                                                    }}
                                                    className="w-16 px-2 py-1.5 bg-secondary/5 border border-secondary/20 rounded-lg text-text-main dark:text-white text-center font-bold focus:outline-none focus:ring-2 focus:ring-primary"
                                                    min={1}
                                                    max={100}
                                                    disabled={exam?.is_active}
                                                />
                                            </div>
                                            <span className="text-[10px] uppercase font-bold text-text-secondary mt-1">Poin</span>
                                        </div>

                                        <div className="w-full h-px bg-secondary/10 my-1"></div>

                                        {/* Image upload button */}
                                        <QuestionImageUpload
                                            imageUrl={q.image_url}
                                            onImageChange={async (url) => {
                                                if (q.id) {
                                                    await fetch(`/api/exams/${examId}/questions`, {
                                                        method: 'PUT',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ question_id: q.id, image_url: url })
                                                    })
                                                    fetchExam()
                                                }
                                            }}
                                            disabled={exam?.is_active}
                                        />

                                        {/* Edit Button */}
                                        <button
                                            onClick={() => {
                                                setEditingQuestionId(q.id || null)
                                                setEditQuestionForm(q)
                                            }}
                                            className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                                            disabled={exam?.is_active}
                                            title="Edit soal"
                                        >
                                            <Edit set="bold" primaryColor="currentColor" size={20} />
                                        </button>

                                        <button
                                            onClick={() => q.id && handleDeleteQuestion(q.id)}
                                            className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                                            disabled={exam?.is_active}
                                        >
                                            <Delete set="bold" primaryColor="currentColor" size={20} />
                                        </button>
                                    </div>
                                </div>
                            </Card>
                        ))
                    )}
                </div>
            )
            }

            {/* Edit Question Modal */}
            {
                editingQuestionId && editQuestionForm && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-xl font-bold text-text-main dark:text-white flex items-center gap-2"><Edit set="bold" primaryColor="currentColor" size={24} /> Edit Soal</h2>
                                <Button
                                    variant="ghost"
                                    icon={<>✕</>}
                                    onClick={() => {
                                        setEditingQuestionId(null)
                                        setEditQuestionForm(null)
                                    }}
                                />
                            </div>

                            <div className="space-y-4">
                                {/* Question Text */}
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Teks Soal</label>
                                    <textarea
                                        value={editQuestionForm.question_text}
                                        onChange={(e) => setEditQuestionForm({ ...editQuestionForm, question_text: e.target.value })}
                                        className="w-full px-4 py-3 bg-secondary/5 border border-secondary/30 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                                        rows={4}
                                        placeholder="Masukkan teks soal..."
                                    />
                                </div>

                                {/* Passage Text (if exists) */}
                                {editQuestionForm.passage_text && (
                                    <div className="p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg">
                                        <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-1">📖 Bacaan (read-only):</p>
                                        <p className="text-sm text-text-main dark:text-white line-clamp-3">{editQuestionForm.passage_text}</p>
                                    </div>
                                )}

                                {/* Options for Multiple Choice */}
                                {editQuestionForm.question_type === 'MULTIPLE_CHOICE' && editQuestionForm.options && (
                                    <div>
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pilihan Jawaban</label>
                                        <div className="space-y-2">
                                            {editQuestionForm.options.map((opt, optIdx) => (
                                                <div key={optIdx} className="flex items-center gap-2">
                                                    <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${editQuestionForm.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300'}`}>
                                                        {String.fromCharCode(65 + optIdx)}
                                                    </span>
                                                    <input
                                                        type="text"
                                                        value={opt}
                                                        onChange={(e) => {
                                                            const newOptions = [...editQuestionForm.options!]
                                                            newOptions[optIdx] = e.target.value
                                                            setEditQuestionForm({ ...editQuestionForm, options: newOptions })
                                                        }}
                                                        className="flex-1 px-4 py-2 bg-secondary/5 border border-secondary/30 rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                                        placeholder={`Pilihan ${String.fromCharCode(65 + optIdx)}`}
                                                    />
                                                    <button
                                                        onClick={() => setEditQuestionForm({ ...editQuestionForm, correct_answer: String.fromCharCode(65 + optIdx) })}
                                                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${editQuestionForm.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300 hover:bg-green-500/20'}`}
                                                    >
                                                        {editQuestionForm.correct_answer === String.fromCharCode(65 + optIdx) ? '✓ Benar' : 'Set Benar'}
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Essay correct answer */}
                                {editQuestionForm.question_type === 'ESSAY' && (
                                    <div>
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kunci Jawaban (opsional)</label>
                                        <textarea
                                            value={editQuestionForm.correct_answer || ''}
                                            onChange={(e) => setEditQuestionForm({ ...editQuestionForm, correct_answer: e.target.value })}
                                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/30 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                                            rows={3}
                                            placeholder="Kunci jawaban essay..."
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-secondary/20">
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        setEditingQuestionId(null)
                                        setEditQuestionForm(null)
                                    }}
                                >
                                    Batal
                                </Button>
                                <Button
                                    onClick={handleSaveEdit}
                                    disabled={saving || !editQuestionForm.question_text}
                                >
                                    {saving ? '⏳ Menyimpan...' : '💾 Simpan Perubahan'}
                                </Button>
                            </div>
                        </Card>
                    </div>
                )
            }

            {/* Manual Mode */}
            {
                mode === 'manual' && (
                    <Card className="p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-text-main dark:text-white">✏️ Tambah Soal Manual</h2>
                            <Button variant="secondary" onClick={() => { setMode('list'); setIsPassageMode(false) }} className="!p-2 aspect-square rounded-full">✕</Button>
                        </div>
                        <div className="space-y-6">
                            {/* Type selector: PG / Essay / Passage */}
                            <div>
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe Soal</label>
                                <div className="flex gap-2">
                                    <button onClick={() => { setIsPassageMode(false); setManualForm({ ...manualForm, question_type: 'MULTIPLE_CHOICE', options: ['', '', '', ''] }) }} className={`flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all ${!isPassageMode && manualForm.question_type === 'MULTIPLE_CHOICE' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>Pilihan Ganda</button>
                                    <button onClick={() => { setIsPassageMode(false); setManualForm({ ...manualForm, question_type: 'ESSAY', options: null, correct_answer: null }) }} className={`flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all ${!isPassageMode && manualForm.question_type === 'ESSAY' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>Essay</button>
                                    <button onClick={() => setIsPassageMode(true)} className={`flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all ${isPassageMode ? 'bg-teal-500 text-white shadow-lg shadow-teal-500/30' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>📖 Passage</button>
                                </div>
                            </div>

                            {/* === PASSAGE MODE === */}
                            {isPassageMode ? (
                                <div className="space-y-6">
                                    {/* Passage text */}
                                    <div>
                                        <label className="block text-sm font-bold text-teal-700 dark:text-teal-400 mb-2">📖 Teks Bacaan (Passage)</label>
                                        <textarea
                                            value={passageText}
                                            onChange={(e) => setPassageText(e.target.value)}
                                            className="w-full px-4 py-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-300 dark:border-teal-700 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-h-[120px]"
                                            placeholder="Tulis teks bacaan / passage di sini..."
                                        />
                                    </div>

                                    {/* Questions under this passage */}
                                    <div>
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-3">Soal-soal untuk Passage ini ({passageQuestions.length})</label>
                                        <div className="space-y-4">
                                            {passageQuestions.map((pq, pqIdx) => (
                                                <div key={pqIdx} className="p-4 border border-secondary/20 rounded-xl bg-secondary/5">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <span className="text-sm font-bold text-text-main dark:text-white">Soal {pqIdx + 1}</span>
                                                        <div className="flex items-center gap-2">
                                                            <select
                                                                value={pq.question_type}
                                                                onChange={(e) => {
                                                                    const updated = [...passageQuestions]
                                                                    updated[pqIdx] = {
                                                                        ...updated[pqIdx],
                                                                        question_type: e.target.value as 'MULTIPLE_CHOICE' | 'ESSAY',
                                                                        options: e.target.value === 'MULTIPLE_CHOICE' ? ['', '', '', ''] : null,
                                                                        correct_answer: e.target.value === 'MULTIPLE_CHOICE' ? '' : null
                                                                    }
                                                                    setPassageQuestions(updated)
                                                                }}
                                                                className="text-xs px-2 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-secondary/30 text-text-main dark:text-white"
                                                            >
                                                                <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                                                                <option value="ESSAY">Essay</option>
                                                            </select>
                                                            {passageQuestions.length > 1 && (
                                                                <button
                                                                    onClick={() => setPassageQuestions(passageQuestions.filter((_, i) => i !== pqIdx))}
                                                                    className="text-red-500 hover:text-red-700 text-sm font-bold px-2"
                                                                >✕</button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <textarea
                                                        value={pq.question_text}
                                                        onChange={(e) => {
                                                            const updated = [...passageQuestions]
                                                            updated[pqIdx] = { ...updated[pqIdx], question_text: e.target.value }
                                                            setPassageQuestions(updated)
                                                        }}
                                                        className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-secondary/20 rounded-lg text-text-main dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                                        rows={2}
                                                        placeholder="Tulis pertanyaan..."
                                                    />
                                                    {pq.question_type === 'MULTIPLE_CHOICE' && (
                                                        <div className="mt-3 space-y-2">
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {['A', 'B', 'C', 'D'].map((letter, optIdx) => (
                                                                    <input
                                                                        key={letter}
                                                                        type="text"
                                                                        value={pq.options?.[optIdx] || ''}
                                                                        onChange={(e) => {
                                                                            const updated = [...passageQuestions]
                                                                            const newOpts = [...(updated[pqIdx].options || ['', '', '', ''])]
                                                                            newOpts[optIdx] = e.target.value
                                                                            updated[pqIdx] = { ...updated[pqIdx], options: newOpts }
                                                                            setPassageQuestions(updated)
                                                                        }}
                                                                        className="px-3 py-1.5 bg-white dark:bg-zinc-800 border border-secondary/20 rounded-lg text-sm text-text-main dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                                                                        placeholder={`Opsi ${letter}`}
                                                                    />
                                                                ))}
                                                            </div>
                                                            <div className="flex gap-2 mt-2">
                                                                <span className="text-xs text-text-secondary mt-1">Jawaban:</span>
                                                                {['A', 'B', 'C', 'D'].map((letter) => (
                                                                    <button
                                                                        key={letter}
                                                                        onClick={() => {
                                                                            const updated = [...passageQuestions]
                                                                            updated[pqIdx] = { ...updated[pqIdx], correct_answer: letter }
                                                                            setPassageQuestions(updated)
                                                                        }}
                                                                        className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${pq.correct_answer === letter ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}
                                                                    >{letter}</button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => setPassageQuestions([...passageQuestions, { question_text: '', question_type: 'MULTIPLE_CHOICE', options: ['', '', '', ''], correct_answer: '', points: 10, order_index: 0 }])}
                                            className="mt-3 w-full py-2 border-2 border-dashed border-teal-300 dark:border-teal-700 rounded-xl text-sm font-bold text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                                        >
                                            + Tambah Soal Passage
                                        </button>
                                    </div>

                                    <div className="flex gap-3 pt-6 border-t border-secondary/10">
                                        <Button variant="secondary" onClick={() => { setMode('list'); setIsPassageMode(false) }} className="flex-1">Batal</Button>
                                        <Button
                                            onClick={handleAddManualQuestion}
                                            disabled={saving || !passageText.trim() || !passageQuestions.some(q => q.question_text.trim())}
                                            loading={saving}
                                            className="flex-1 !bg-teal-600 hover:!bg-teal-700"
                                        >
                                            {saving ? 'Menyimpan...' : `Simpan Passage + ${passageQuestions.filter(q => q.question_text.trim()).length} Soal`}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                /* === NORMAL MODE (PG / Essay) === */
                                <>
                                    <div>
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pertanyaan</label>
                                        <MathTextarea
                                            value={manualForm.question_text}
                                            onChange={(val) => setManualForm({ ...manualForm, question_text: val })}
                                            placeholder="Tulis pertanyaan..."
                                            rows={3}
                                        />
                                    </div>
                                    {manualForm.question_type === 'MULTIPLE_CHOICE' && (
                                        <>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {['A', 'B', 'C', 'D'].map((letter, idx) => (
                                                    <div key={letter}>
                                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Opsi {letter}</label>
                                                        <div className="relative">
                                                            <div className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-secondary/20 flex items-center justify-center text-xs font-bold text-text-secondary">{letter}</div>
                                                            <input type="text" value={manualForm.options?.[idx] || ''} onChange={(e) => { const newOptions = [...(manualForm.options || ['', '', '', ''])]; newOptions[idx] = e.target.value; setManualForm({ ...manualForm, options: newOptions }) }} className="w-full pl-12 pr-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm" placeholder={`Jawaban ${letter}`} />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div>
                                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kunci Jawaban</label>
                                                <div className="flex gap-3">
                                                    {['A', 'B', 'C', 'D'].map((letter) => (
                                                        <button key={letter} onClick={() => setManualForm({ ...manualForm, correct_answer: letter })} className={`w-12 h-12 rounded-xl font-bold transition-all ${manualForm.correct_answer === letter ? 'bg-green-500 text-white shadow-lg shadow-green-500/30 scale-110' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>{letter}</button>
                                                    ))}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tingkat Kesulitan <span className="text-red-500">*</span></label>
                                            <select
                                                value={manualForm.difficulty || ''}
                                                onChange={(e) => setManualForm({ ...manualForm, difficulty: e.target.value as any })}
                                                className={`w-full px-3 py-2 bg-secondary/5 border rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary ${!manualForm.difficulty ? 'border-red-300 dark:border-red-700' : 'border-secondary/30'}`}
                                            >
                                                <option value="">-- Pilih Kesulitan --</option>
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
                                    {/* HOTS Toggle */}
                                    <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                        <input
                                            type="checkbox"
                                            id="hots-claim-ulangan"
                                            checked={manualForm.teacher_hots_claim || false}
                                            onChange={e => setManualForm({ ...manualForm, teacher_hots_claim: e.target.checked })}
                                            className="w-5 h-5 accent-emerald-600 rounded"
                                        />
                                        <label htmlFor="hots-claim-ulangan" className="flex-1 cursor-pointer">
                                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">🧠 Klaim HOTS</p>
                                            <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">Centang jika soal ini membutuhkan kemampuan berpikir tingkat tinggi (Analisis, Evaluasi, atau Kreasi)</p>
                                        </label>
                                    </div>
                                    <div className="flex gap-3 pt-6 border-t border-secondary/10">
                                        <Button variant="secondary" onClick={() => setMode('list')} className="flex-1">Batal</Button>
                                        <Button onClick={handleAddManualQuestion} disabled={saving || !manualForm.question_text || !manualForm.difficulty || (manualForm.question_type === 'MULTIPLE_CHOICE' && !manualForm.correct_answer)} loading={saving} className="flex-1">{saving ? 'Menyimpan...' : 'Tambah Soal'}</Button>
                                    </div>
                                </>
                            )}
                        </div>
                    </Card>
                )
            }

            {/* Rapih AI Mode (All-in-One) */}
            <RapihAIModal
                visible={mode === 'clean'}
                onClose={() => setMode('list')}
                onSaveResults={handleSaveResults}
                onSaveToBank={handleSaveToBank}
                saving={saving}
                targetLabel="Ulangan"
            />

            {/* Bank Soal Mode */}
            {
                mode === 'bank' && (
                    <Card className="p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-text-main dark:text-white">🗃️ Ambil dari Bank Soal</h2>
                            <Button variant="ghost" icon={<>✕</>} onClick={() => { setMode('list'); setSelectedBankIds(new Set()) }} />
                        </div>

                        {bankLoading ? (
                            <div className="flex justify-center py-12">
                                <div className="animate-spin text-3xl text-primary">⏳</div>
                            </div>
                        ) : bankQuestions.length === 0 && bankPassages.length === 0 ? (
                            <EmptyState
                                icon="🗃️"
                                title="Bank Soal Kosong"
                                description="Belum ada soal tersimpan untuk mata pelajaran ini."
                            />
                        ) : (
                            <>
                                <p className="text-sm text-text-secondary dark:text-zinc-400 mb-4">Pilih soal yang ingin ditambahkan ke ulangan ini:</p>

                                {/* Passages Section */}
                                {bankPassages.length > 0 && (
                                    <div className="mb-6">
                                        <h3 className="text-md font-bold text-text-main dark:text-white mb-3 flex items-center gap-2">
                                            📖 Passage ({bankPassages.length})
                                        </h3>
                                        <div className="space-y-3">
                                            {bankPassages.map((p: any) => (
                                                <div key={p.id} className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-xl overflow-hidden">
                                                    <div
                                                        className="p-4 cursor-pointer hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-colors"
                                                        onClick={() => {
                                                            const passageQuestionIds = (p.questions || []).map((q: any) => q.id)
                                                            const allSelected = passageQuestionIds.every((id: string) => selectedBankIds.has(id))
                                                            const newSet = new Set(selectedBankIds)
                                                            if (allSelected) {
                                                                passageQuestionIds.forEach((id: string) => newSet.delete(id))
                                                            } else {
                                                                passageQuestionIds.forEach((id: string) => newSet.add(id))
                                                            }
                                                            setSelectedBankIds(newSet)
                                                        }}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={(p.questions || []).length > 0 && (p.questions || []).every((q: any) => selectedBankIds.has(q.id))}
                                                                readOnly
                                                                className="w-5 h-5 rounded bg-teal-100 border-teal-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                                                            />
                                                            <div className="flex-1">
                                                                <h4 className="font-bold text-text-main dark:text-white">{p.title || 'Untitled Passage'}</h4>
                                                                <span className="text-xs text-teal-600 dark:text-teal-400">{p.questions?.length || 0} soal terkait</span>
                                                            </div>
                                                        </div>
                                                        <p className="text-sm text-text-secondary dark:text-zinc-400 mt-2 line-clamp-2">{p.passage_text}</p>
                                                    </div>
                                                    {/* Questions inside passage */}
                                                    {(p.questions || []).length > 0 && (
                                                        <div className="border-t border-teal-200 dark:border-teal-700 px-4 py-2 bg-white/50 dark:bg-black/10 space-y-2">
                                                            {p.questions.map((q: any, idx: number) => (
                                                                <label
                                                                    key={q.id}
                                                                    className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer text-sm ${selectedBankIds.has(q.id) ? 'bg-teal-100 dark:bg-teal-800/30' : 'hover:bg-teal-50 dark:hover:bg-teal-900/20'}`}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={selectedBankIds.has(q.id)}
                                                                        onChange={(e) => {
                                                                            const newSet = new Set(selectedBankIds)
                                                                            e.target.checked ? newSet.add(q.id) : newSet.delete(q.id)
                                                                            setSelectedBankIds(newSet)
                                                                        }}
                                                                        className="mt-0.5 w-4 h-4 rounded bg-teal-100 border-teal-300 text-teal-600 focus:ring-teal-500"
                                                                    />
                                                                    <span className="w-5 h-5 rounded-full bg-teal-500 text-white text-xs flex items-center justify-center font-bold flex-shrink-0">{idx + 1}</span>
                                                                    <span className="flex-1 text-text-main dark:text-white">{q.question_text}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Individual Questions Section - Only questions without passage_id */}
                                {bankQuestions.filter((q: any) => q.passage_id == null).length > 0 && (
                                    <div className="mb-4">
                                        <h3 className="text-md font-bold text-text-main dark:text-white mb-3">❓ Soal Mandiri ({bankQuestions.filter((q: any) => q.passage_id == null).length})</h3>
                                        <div className="space-y-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                                            {bankQuestions.filter((q: any) => q.passage_id == null).map((q: any) => (
                                                <label
                                                    key={q.id}
                                                    className={`flex items-start gap-3 p-4 rounded-xl cursor-pointer transition-all border ${selectedBankIds.has(q.id)
                                                        ? 'bg-primary/10 border-primary'
                                                        : 'bg-secondary/5 border-transparent hover:bg-secondary/10'
                                                        }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedBankIds.has(q.id)}
                                                        onChange={(e) => {
                                                            const newSet = new Set(selectedBankIds)
                                                            if (e.target.checked) {
                                                                newSet.add(q.id)
                                                            } else {
                                                                newSet.delete(q.id)
                                                            }
                                                            setSelectedBankIds(newSet)
                                                        }}
                                                        className="mt-1 w-5 h-5 rounded bg-secondary/10 border-secondary/30 text-primary focus:ring-primary"
                                                    />
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                            <span className={`px-2 py-0.5 text-xs rounded ${q.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'}`}>
                                                                {q.question_type === 'MULTIPLE_CHOICE' ? 'PG' : 'Essay'}
                                                            </span>
                                                            <span className={`px-2 py-0.5 text-xs rounded ${q.difficulty === 'EASY' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                                                                q.difficulty === 'HARD' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400' : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'
                                                                }`}>
                                                                {q.difficulty === 'EASY' ? 'Mudah' : q.difficulty === 'HARD' ? 'Sulit' : 'Sedang'}
                                                            </span>
                                                        </div>
                                                        <p className="text-text-main dark:text-white text-sm">{q.question_text}</p>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-3 pt-4 border-t border-secondary/20 mt-4">
                                    <Button
                                        variant="secondary"
                                        onClick={() => {
                                            const allQuestionIds = [
                                                ...bankQuestions.filter((q: any) => q.passage_id == null).map((q: any) => q.id),
                                                ...bankPassages.flatMap((p: any) => (p.questions || []).map((q: any) => q.id))
                                            ]
                                            if (selectedBankIds.size === allQuestionIds.length) {
                                                setSelectedBankIds(new Set())
                                            } else {
                                                setSelectedBankIds(new Set(allQuestionIds))
                                            }
                                        }}
                                    >
                                        Pilih Semua
                                    </Button>
                                    <Button
                                        onClick={async () => {
                                            if (selectedBankIds.size === 0) return
                                            setSaving(true)
                                            try {
                                                // Collect selected questions from both individual and passages
                                                // For passage questions, include the passage_text
                                                const passageQuestionsWithText = bankPassages.flatMap((p: any) =>
                                                    (p.questions || []).map((q: any) => ({
                                                        ...q,
                                                        passage_text: p.passage_text
                                                    }))
                                                )
                                                const standaloneQuestions = bankQuestions.filter((q: any) => q.passage_id == null)
                                                const allBankQuestions = [
                                                    ...standaloneQuestions,
                                                    ...passageQuestionsWithText
                                                ]
                                                const selectedQuestions = allBankQuestions
                                                    .filter((q: any) => selectedBankIds.has(q.id))
                                                    .map((q: any, idx: number) => ({
                                                        question_text: q.question_text,
                                                        question_type: q.question_type,
                                                        options: q.options,
                                                        correct_answer: q.correct_answer,
                                                        difficulty: q.difficulty || 'MEDIUM',
                                                        points: 10,
                                                        order_index: questions.length + idx,
                                                        passage_text: q.passage_text || null,
                                                        teacher_hots_claim: q.teacher_hots_claim || false,
                                                        // Inherit approved status from bank soal (skip re-review)
                                                        bank_status: q.status
                                                    }))

                                                await fetch(`/api/exams/${examId}/questions`, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ questions: selectedQuestions })
                                                })

                                                setSelectedBankIds(new Set())
                                                setMode('list')
                                                fetchExam()
                                            } finally {
                                                setSaving(false)
                                            }
                                        }}
                                        disabled={saving || selectedBankIds.size === 0}
                                        loading={saving}
                                        className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600"
                                    >
                                        {saving ? 'Menyimpan...' : `Tambahkan ${selectedBankIds.size} Soal ke Ulangan`}
                                    </Button>
                                </div>
                            </>
                        )}
                    </Card>
                )
            }

            {/* Publish Confirmation Modal */}
            <Modal
                open={showPublishConfirm}
                onClose={() => setShowPublishConfirm(false)}
                title="🚀 Publish Ulangan?"
                maxWidth="sm"
            >
                <div className="text-center py-4">
                    <div className="w-20 h-20 bg-green-500/10 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <p className="text-text-secondary mb-8">Setelah dipublish, siswa bisa melihat ulangan ini dan dapat mulai mengerjakan sesuai jadwal. Pastikan soal sudah benar!</p>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={() => setShowPublishConfirm(false)} className="flex-1">Batal</Button>
                        <Button onClick={confirmPublish} loading={publishing} className="flex-1">Ya, Publish</Button>
                    </div>
                </div>
            </Modal>

            {/* Edit Settings Modal */}
            <Modal
                open={showEditSettings}
                onClose={() => setShowEditSettings(false)}
                title="⚙️ Pengaturan Ulangan"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Ulangan</label>
                        <input
                            type="text"
                            value={editForm.title}
                            onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Deskripsi</label>
                        <textarea
                            value={editForm.description}
                            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            rows={3}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Waktu Mulai</label>
                            <input
                                type="datetime-local"
                                value={editForm.start_time}
                                onChange={(e) => setEditForm({ ...editForm, start_time: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Durasi (menit)</label>
                            <input
                                type="number"
                                value={editForm.duration_minutes}
                                onChange={(e) => setEditForm({ ...editForm, duration_minutes: parseInt(e.target.value) || 60 })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Max Pelanggaran</label>
                        <input
                            type="number"
                            value={editForm.max_violations}
                            onChange={(e) => setEditForm({ ...editForm, max_violations: parseInt(e.target.value) || 3 })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <p className="text-xs text-text-secondary mt-1">Siswa akan auto-submit jika keluar tab melebihi batas ini</p>
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/10">
                        <input
                            type="checkbox"
                            id="edit-randomize"
                            checked={editForm.is_randomized}
                            onChange={(e) => setEditForm({ ...editForm, is_randomized: e.target.checked })}
                            className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary"
                        />
                        <label htmlFor="edit-randomize" className="text-sm font-medium text-text-main dark:text-white cursor-pointer select-none">Acak urutan soal per siswa</label>
                    </div>
                    <div className="flex gap-3 pt-6 border-t border-secondary/10 mt-2">
                        <Button variant="secondary" onClick={() => setShowEditSettings(false)} className="flex-1">Batal</Button>
                        <Button onClick={handleSaveSettings} loading={savingSettings} className="flex-1">Simpan Perubahan</Button>
                    </div>
                </div>
            </Modal>

            {/* Success Publish Modal */}
            <Modal
                title="Status Publikasi"
                open={showSuccessModal}
                onClose={() => setShowSuccessModal(false)}
            >
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto mb-4">
                        <TickSquare set="bold" primaryColor="currentColor" size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Ulangan Berhasil Dipublish!</h3>
                    <p className="text-sm text-text-secondary dark:text-zinc-400 mb-6">
                        Siswa sekarang dapat melihat dan mengerjakan ulangan ini melalui dashboard mereka.
                    </p>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={() => setShowSuccessModal(false)} className="flex-1 justify-center">
                            Tutup
                        </Button>
                    </div>
                </div>
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

            {/* Custom Alert Modal (replaces browser alert) */}
            {alertInfo && (
                <Modal open={!!alertInfo} onClose={() => setAlertInfo(null)} title="">
                    <div className="text-center py-2">
                        <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${alertInfo.type === 'success' ? 'bg-green-100 dark:bg-green-500/20' :
                            alertInfo.type === 'info' ? 'bg-blue-100 dark:bg-blue-500/20' :
                                alertInfo.type === 'warning' ? 'bg-amber-100 dark:bg-amber-500/20' :
                                    'bg-red-100 dark:bg-red-500/20'
                            }`}>
                            <span className="text-2xl">
                                {alertInfo.type === 'success' ? '✅' :
                                    alertInfo.type === 'info' ? '🔍' :
                                        alertInfo.type === 'warning' ? '⚠️' : '❌'}
                            </span>
                        </div>
                        <h3 className={`text-lg font-bold mb-2 ${alertInfo.type === 'success' ? 'text-green-700 dark:text-green-400' :
                            alertInfo.type === 'info' ? 'text-blue-700 dark:text-blue-400' :
                                alertInfo.type === 'warning' ? 'text-amber-700 dark:text-amber-400' :
                                    'text-red-700 dark:text-red-400'
                            }`}>{alertInfo.title}</h3>
                        <p className="text-text-secondary dark:text-zinc-400 text-sm mb-6 leading-relaxed">{alertInfo.message}</p>
                        <Button onClick={() => setAlertInfo(null)} className="px-8">
                            Mengerti
                        </Button>
                    </div>
                </Modal>
            )}
        </div >
    )
}
