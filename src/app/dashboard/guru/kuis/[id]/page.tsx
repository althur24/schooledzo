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
import { Edit, Discovery, Folder, Plus, Upload, Danger, InfoCircle, TickSquare, CloseSquare, Delete, Document, Search } from 'react-iconly'
import { Loader2, Eye, Brain } from 'lucide-react'
import QuestionImageUpload from '@/components/QuestionImageUpload'
import { PageHeader, Button, Modal, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'

interface QuizQuestion {
    id?: string
    question_text: string
    question_type: 'ESSAY' | 'MULTIPLE_CHOICE'
    options: string[] | null
    correct_answer: string | null
    points: number
    order_index: number
    image_url?: string | null
    passage_text?: string | null
    passage_audio_url?: string | null
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD'
    status?: string
    teacher_hots_claim?: boolean
    text_direction?: 'ltr' | 'rtl'
}

interface Quiz {
    id: string
    title: string
    description: string | null
    is_active: boolean
    pending_publish: boolean
    teaching_assignment: {
        subject: { id: string; name: string }
        class: { name: string }
    }
    questions: QuizQuestion[]
}

type Mode = 'list' | 'manual' | 'clean' | 'ai' | 'bank'

export default function EditQuizPage() {
    const params = useParams()
    const quizId = params.id as string

    const [quiz, setQuiz] = useState<Quiz | null>(null)
    const [questions, setQuestions] = useState<QuizQuestion[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [mode, setMode] = useState<Mode>('list')
    const [showAddDropdown, setShowAddDropdown] = useState(false)

    // Manual mode state
    const [manualForm, setManualForm] = useState<QuizQuestion>({
        question_text: '',
        question_type: 'MULTIPLE_CHOICE',
        options: ['', '', '', ''],
        correct_answer: '',
        difficulty: undefined as any,
        points: 10,
        order_index: 0,
        teacher_hots_claim: false,
        text_direction: 'ltr'
    })

    // Passage mode state
    const [isPassageMode, setIsPassageMode] = useState(false)
    const [passageText, setPassageText] = useState('')
    const [passageAudioUrl, setPassageAudioUrl] = useState('')
    const [uploadingAudio, setUploadingAudio] = useState(false)
    const [passageQuestions, setPassageQuestions] = useState<QuizQuestion[]>([{
        question_text: '', question_type: 'MULTIPLE_CHOICE', options: ['', '', '', ''], correct_answer: '', points: 10, order_index: 0, text_direction: 'ltr'
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
    const [editForm, setEditForm] = useState<QuizQuestion | null>(null)

    // Bulk selection state for delete
    const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set())
    const [isBulkSelectMode, setIsBulkSelectMode] = useState(false)

    const [showPublishConfirm, setShowPublishConfirm] = useState(false)
    const [showPreview, setShowPreview] = useState(false)
    const [publishing, setPublishing] = useState(false)
    const [showSuccessModal, setShowSuccessModal] = useState(false)
    const [alertInfo, setAlertInfo] = useState<{ type: 'info' | 'warning' | 'error' | 'success', title: string, message: string } | null>(null)
    const [aiReviewEnabled, setAiReviewEnabled] = useState(true)

    const fetchQuiz = useCallback(async () => {
        try {
            const res = await fetch(`/api/quizzes/${quizId}`)
            const data = await res.json()
            setQuiz(data)
            setQuestions(data.questions || [])
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }, [quizId])

    useEffect(() => {
        fetchQuiz()
    }, [fetchQuiz])

    useEffect(() => {
        fetch('/api/school-settings').then(r => r.ok ? r.json() : null).then(d => {
            if (d) setAiReviewEnabled(d.ai_review_enabled !== false)
        }).catch(() => { })
    }, [])

    const handlePublishClick = () => {
        if (questions.length === 0) {
            setAlertInfo({ type: 'warning', title: 'Belum Ada Soal', message: 'Minimal harus ada 1 soal untuk mempublish kuis!' })
            return
        }
        setShowPublishConfirm(true)
    }

    const confirmPublish = async () => {
        setPublishing(true)
        try {
            const res = await fetch(`/api/quizzes/${quizId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: true })
            })

            if (res.ok) {
                const data = await res.json()
                setShowPublishConfirm(false)

                if (data._status === 'under_review') {
                    setAlertInfo({ type: 'info', title: '🔍 Kuis Dalam Review', message: 'Kuis berhasil disimpan! Ada soal yang masih dalam proses review (oleh AI atau Admin). Kuis akan otomatis terpublish ke siswa setelah semua soal disetujui.' })
                } else {
                    setShowSuccessModal(true)
                }

                fetchQuiz()
            } else {
                throw new Error('Gagal mempublish kuis')
            }
        } catch (error) {
            console.error('Error publishing:', error)
            setAlertInfo({ type: 'error', title: 'Gagal Publish', message: 'Terjadi kesalahan saat mempublish kuis. Coba lagi.' })
        } finally {
            setPublishing(false)
        }
    }

    const handleAddManualQuestion = async () => {
        // Passage mode: save all passage questions at once
        if (isPassageMode) {
            if ((!passageText.trim() && !passageAudioUrl) || passageQuestions.length === 0) return
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
                        passage_text: passageText,
                        passage_audio_url: passageAudioUrl || null,
                        teacher_hots_claim: q.teacher_hots_claim || false,
                        text_direction: q.text_direction || 'ltr'
                    }))
                await fetch(`/api/quizzes/${quizId}/questions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(questionsToSave)
                })
                setPassageText('')
                setPassageAudioUrl('')
                setPassageQuestions([{ question_text: '', question_type: 'MULTIPLE_CHOICE', options: ['', '', '', ''], correct_answer: '', points: 10, order_index: 0, text_direction: 'ltr' }])
                setIsPassageMode(false)
                setMode('list')
                fetchQuiz()
            } finally {
                setSaving(false)
            }
            return
        }

        // Normal single-question mode
        if (!manualForm.question_text) return
        setSaving(true)
        try {
            await fetch(`/api/quizzes/${quizId}/questions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...manualForm,
                    order_index: questions.length,
                    options: manualForm.question_type === 'MULTIPLE_CHOICE' ? manualForm.options : null
                })
            })
            setManualForm({
                question_text: '',
                question_type: 'MULTIPLE_CHOICE',
                options: ['', '', '', ''],
                correct_answer: '',
                difficulty: undefined as any,
                points: 10,
                order_index: 0,
                teacher_hots_claim: false,
                text_direction: 'ltr'
            })
            setMode('list')
            fetchQuiz()
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteQuestion = async (questionId: string) => {
        if (!confirm('Hapus soal ini?')) return
        await fetch(`/api/quizzes/${quizId}/questions?question_id=${questionId}`, { method: 'DELETE' })
        fetchQuiz()
    }

    const handleSaveEdit = async () => {
        if (!editForm || !editingQuestionId) return
        setSaving(true)
        try {
            await fetch(`/api/quizzes/${quizId}/questions`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: editingQuestionId,
                    question_text: editForm.question_text,
                    question_type: editForm.question_type,
                    options: editForm.options,
                    correct_answer: editForm.correct_answer,
                    difficulty: editForm.difficulty,
                    points: editForm.points,
                    image_url: editForm.image_url,
                    teacher_hots_claim: editForm.teacher_hots_claim || false,
                    text_direction: editForm.text_direction || 'ltr'
                })
            })
            setEditingQuestionId(null)
            setEditForm(null)
            fetchQuiz()
        } finally {
            setSaving(false)
        }
    }

    const handleBulkDelete = async () => {
        if (selectedQuestionIds.size === 0) return
        if (!confirm(`Hapus ${selectedQuestionIds.size} soal yang dipilih?`)) return

        await Promise.all(
            Array.from(selectedQuestionIds).map(qId =>
                fetch(`/api/quizzes/${quizId}/questions?question_id=${qId}`, { method: 'DELETE' })
            )
        )
        setSelectedQuestionIds(new Set())
        setIsBulkSelectMode(false)
        fetchQuiz()
    }

    const handleSaveAIResults = async (results: QuizQuestion[]) => {
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

            const res = await fetch(`/api/quizzes/${quizId}/questions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newQuestions)
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
            await fetchQuiz()
        } catch (err) {
            console.error('Error saving AI results:', err)
            setAlertInfo({ type: 'error', title: 'Gagal Menyimpan', message: 'Gagal menyimpan soal. Cek koneksi internet.' })
        } finally {
            setSaving(false)
        }
    }

    const handleSaveToBank = async (results: QuizQuestion[]) => {
        if (results.length === 0) return
        try {
            const subjectId = quiz?.teaching_assignment?.subject?.id || null

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

            // Collect audio URLs per passage group
            const passageAudioMap = new Map<string, string>()
            results.forEach(q => {
                if (q.passage_text && (q as any).passage_audio_url) {
                    passageAudioMap.set(q.passage_text, (q as any).passage_audio_url)
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
                            audio_url: passageAudioMap.get(passageText) || null,
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

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <div className="animate-spin text-primary"><Loader2 className="w-10 h-10" /></div>
            </div>
        )
    }

    if (!quiz) {
        return (
            <EmptyState
                icon={<div className="text-secondary"><Search set="bold" primaryColor="currentColor" size={48} /></div>}
                title="Kuis tidak ditemukan"
                description="Kuis yang Anda cari tidak tersedia."
            />
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <PageHeader
                title={quiz.title}
                subtitle={`${quiz.teaching_assignment?.class?.name} • ${quiz.teaching_assignment?.subject?.name}`}
                {...(mode === 'list'
                    ? { backHref: '/dashboard/guru/kuis' }
                    : { onBack: () => { setMode('list') } }
                )}
                action={
                    <div className="flex items-center gap-4">
                        <Button
                            variant="secondary"
                            onClick={() => setShowPreview(true)}
                            disabled={questions.length === 0}
                        >
                            <Eye className="w-4 h-4 mr-1" />
                            Preview
                        </Button>
                        {!quiz.is_active && !quiz.pending_publish && (
                            <Button
                                onClick={handlePublishClick}
                                disabled={questions.length === 0}
                                className="bg-gradient-to-r from-green-500 to-emerald-600 text-white flex items-center gap-2"
                            >
                                <Upload set="bold" primaryColor="currentColor" size={20} />
                                Publish Kuis
                            </Button>
                        )}
                        <div className="flex items-center gap-4">
                            <div className="text-right">
                                <p className={`text-2xl font-bold ${totalPoints > 100 ? 'text-red-400' : totalPoints === 100 ? 'text-green-400' : 'text-amber-400'}`}>
                                    {totalPoints}
                                </p>
                                <p className="text-xs text-text-secondary dark:text-zinc-400">Total Poin</p>
                            </div>
                            <div className="text-right">
                                <p className="text-2xl font-bold text-primary">{questions.length}</p>
                                <p className="text-xs text-text-secondary dark:text-zinc-400">Soal</p>
                            </div>
                        </div>
                    </div>
                }
            />

            {/* Points Warning */}
            {totalPoints !== 100 && questions.length > 0 && (
                <div className={`px-4 py-3 rounded-xl flex items-center justify-between ${totalPoints > 100 ? 'bg-red-500/20 border border-red-500/30' : 'bg-amber-500/20 border border-amber-500/30'}`}>
                    <div className="flex items-center gap-2">
                        <span>{totalPoints > 100 ? <Danger set="bold" primaryColor="currentColor" size={20} /> : <InfoCircle set="bold" primaryColor="currentColor" size={20} />}</span>
                        <span className={totalPoints > 100 ? 'text-red-400' : 'text-amber-400'}>
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
                            // Update in database
                            balanced.forEach(async (q) => {
                                if (q.id) {
                                    await fetch(`/api/quizzes/${quizId}/questions`, {
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
                                            const subjectId = quiz?.teaching_assignment?.subject?.id || ''
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
                    {/* Simplified Selection Toolbar */}
                    {/* "Under Review" Banner */}
                    {quiz?.pending_publish && (
                        <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                            <div className="flex gap-3">
                                <div className="mt-0.5 rounded-full bg-amber-100 dark:bg-amber-800 p-2 text-amber-600 dark:text-amber-400 shrink-0">
                                    <Brain size={20} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-amber-800 dark:text-amber-300">Kuis Sedang Direview</h3>
                                    <p className="text-sm text-amber-700/80 dark:text-amber-400/80 mt-1">
                                        Anda telah mempublikasi kuis ini, tetapi ada soal yang masih menunggu persetujuan (oleh AI atau Admin). Kuis akan otomatis terkirim ke siswa segera setelah semua soal disetujui.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {questions.length > 0 && !quiz?.is_active && !quiz?.pending_publish && (
                        <div className="flex items-center justify-between">
                            <Button
                                variant={isBulkSelectMode ? 'ghost' : 'outline'}
                                onClick={() => {
                                    setIsBulkSelectMode(!isBulkSelectMode)
                                    setSelectedQuestionIds(new Set())
                                }}
                                className={`text-sm gap-2 transition-all ${isBulkSelectMode
                                    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                                    : 'border-2 border-primary/20 hover:border-primary text-primary font-bold bg-primary/5 hover:bg-primary/10'
                                    }`}
                            >
                                {isBulkSelectMode ? (
                                    <><CloseSquare set="bold" primaryColor="currentColor" size={16} /> Batal</>
                                ) : (
                                    <><TickSquare set="bold" primaryColor="currentColor" size={16} /> Pilih Soal</>
                                )}
                            </Button>

                            {isBulkSelectMode && selectedQuestionIds.size > 0 && (
                                <div className="flex items-center gap-3 animate-in fade-in slide-in-from-right-4 duration-200">
                                    <span className="text-sm font-medium text-text-secondary">
                                        {selectedQuestionIds.size} dipilih
                                    </span>
                                    <Button
                                        onClick={handleBulkDelete}
                                        className="bg-red-500 hover:bg-red-600 text-white text-sm flex items-center gap-1"
                                        size="sm"
                                    >
                                        <Delete set="bold" primaryColor="currentColor" size={16} /> Hapus
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {questions.length === 0 ? (
                        <EmptyState
                            icon={<div className="text-secondary"><Document set="bold" primaryColor="currentColor" size={48} /></div>}
                            title="Belum ada soal"
                            description="Mulai tambahkan soal menggunakan salah satu menu di atas."
                        />
                    ) : (() => {
                        // Group audio passage questions together
                        type DisplayItem =
                            | { type: 'standalone'; question: typeof questions[0]; originalIndex: number }
                            | { type: 'audio_group'; audioUrl: string; passageText?: string | null; items: { question: typeof questions[0]; originalIndex: number }[] }

                        const displayItems: DisplayItem[] = []
                        const audioGroupMap = new Map<string, DisplayItem & { type: 'audio_group' }>()

                        questions.forEach((q, idx) => {
                            if (q.passage_audio_url) {
                                const key = q.passage_audio_url
                                if (!audioGroupMap.has(key)) {
                                    const group: DisplayItem & { type: 'audio_group' } = { type: 'audio_group', audioUrl: q.passage_audio_url, passageText: q.passage_text, items: [] }
                                    audioGroupMap.set(key, group)
                                    displayItems.push(group)
                                }
                                audioGroupMap.get(key)!.items.push({ question: q, originalIndex: idx })
                            } else {
                                displayItems.push({ type: 'standalone', question: q, originalIndex: idx })
                            }
                        })

                        const renderQuestionCard = (q: typeof questions[0], idx: number, isInGroup: boolean) => (
                            <div key={q.id || idx} className={`${isInGroup ? 'p-4' : ''}`}>
                                <div className="flex items-start gap-4">
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
                                    <div className={`w-8 h-8 rounded-full ${isInGroup ? 'bg-violet-500/20 text-violet-400' : 'bg-cyan-500/20 text-cyan-400'} flex items-center justify-center font-bold text-sm shrink-0`}>
                                        {idx + 1}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className={`px-2 py-0.5 text-xs rounded-full ${q.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'}`}>
                                                {q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 'Essay'}
                                            </span>
                                            {!isInGroup && q.passage_text && (
                                                <span className="px-2 py-0.5 text-xs rounded-full bg-teal-500/20 text-teal-400 flex items-center gap-1">
                                                    <Document set="bold" primaryColor="currentColor" size={10} /> Passage
                                                </span>
                                            )}
                                            {q.status === 'approved' && <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 flex items-center gap-1"><TickSquare set="bold" primaryColor="currentColor" size={10} /></span>}
                                            {aiReviewEnabled && q.status === 'admin_review' && <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 flex items-center gap-1"><InfoCircle set="bold" primaryColor="currentColor" size={10} /> Review</span>}
                                            {q.status === 'returned' && <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 flex items-center gap-1"><CloseSquare set="bold" primaryColor="currentColor" size={10} /> Returned</span>}
                                            {aiReviewEnabled && q.status === 'ai_reviewing' && <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 animate-pulse flex items-center gap-1"><Discovery set="bold" primaryColor="currentColor" size={10} /></span>}
                                        </div>

                                        {/* Show passage only for standalone (non-grouped) questions */}
                                        {!isInGroup && (q.passage_text || q.passage_audio_url) && (
                                            <div className="mb-3 p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg overflow-hidden">
                                                {q.passage_audio_url && (
                                                    <>
                                                        <p className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-1">🎧 Listening:</p>
                                                        <audio controls controlsList="nodownload" className="w-full mb-2" src={q.passage_audio_url} />
                                                    </>
                                                )}
                                                {q.passage_text && (
                                                    <>
                                                        <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-1 flex items-center gap-1"><Document set="bold" primaryColor="currentColor" size={12} /> Bacaan:</p>
                                                        <p className="text-sm text-text-main dark:text-white whitespace-pre-wrap break-all" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{q.passage_text}</p>
                                                    </>
                                                )}
                                            </div>
                                        )}

                                        <div dir={q.text_direction || 'ltr'}>
                                            <SmartText text={q.question_text} className={`text-text-main dark:text-white mb-2 ${q.text_direction === 'rtl' ? 'text-right' : ''}`} />
                                        </div>

                                        {q.image_url && (
                                            <div className="mb-3">
                                                <img src={q.image_url} alt="Gambar soal" className="max-h-40 rounded-lg border border-secondary/30" />
                                            </div>
                                        )}

                                        {q.question_type === 'MULTIPLE_CHOICE' && q.options && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm" dir={q.text_direction || 'ltr'}>
                                                {q.options.map((opt, optIdx) => (
                                                    <div key={optIdx} className={`px-3 py-2 rounded-lg border ${q.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-500/30' : 'bg-secondary/5 text-text-main dark:text-zinc-300 border-secondary/20'}`}>
                                                        <span className="font-bold mr-2">{String.fromCharCode(65 + optIdx)}.</span>
                                                        <SmartText text={opt} as="span" />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-2 items-end pl-4 border-l border-white/5">
                                        <div className="flex items-center gap-1">
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
                                                onBlur={async () => {
                                                    if (q.id) {
                                                        await fetch(`/api/quizzes/${quizId}/questions`, {
                                                            method: 'PUT',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ question_id: q.id, points: q.points })
                                                        })
                                                    }
                                                }}
                                                className="w-14 px-2 py-1 bg-secondary/5 border border-secondary/30 rounded text-text-main dark:text-white text-center text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                                min={1}
                                                max={100}
                                                disabled={quiz?.is_active}
                                            />
                                            <span className="text-xs text-text-secondary dark:text-zinc-500">poin</span>
                                        </div>

                                        <QuestionImageUpload
                                            imageUrl={q.image_url}
                                            onImageChange={async (url) => {
                                                if (q.id) {
                                                    await fetch(`/api/quizzes/${quizId}/questions`, {
                                                        method: 'PUT',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ question_id: q.id, image_url: url })
                                                    })
                                                    fetchQuiz()
                                                }
                                            }}
                                            disabled={quiz?.is_active}
                                        />

                                        <button
                                            onClick={() => {
                                                setEditingQuestionId(q.id || null)
                                                setEditForm(q)
                                            }}
                                            className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors"
                                            disabled={quiz?.is_active}
                                            title="Edit soal"
                                        >
                                            <Edit set="bold" primaryColor="currentColor" size={20} />
                                        </button>

                                        <button
                                            onClick={() => q.id && handleDeleteQuestion(q.id)}
                                            className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                                            disabled={quiz?.is_active}
                                        >
                                            <Delete set="bold" primaryColor="currentColor" size={20} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )

                        return displayItems.map((item, itemIdx) => {
                            if (item.type === 'audio_group') {
                                return (
                                    <div key={`audio-group-${itemIdx}`} className="border-2 border-violet-300 dark:border-violet-700 rounded-2xl overflow-hidden bg-surface-light dark:bg-surface-dark">
                                        {/* Audio header — shown once */}
                                        <div className="p-4 bg-violet-50 dark:bg-violet-900/20 border-b border-violet-200 dark:border-violet-700">
                                            <p className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-2">🎧 Listening — {item.items.length} soal</p>
                                            <audio controls controlsList="nodownload" className="w-full mb-2" src={item.audioUrl} />
                                            {item.passageText && (
                                                <>
                                                    <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-1 flex items-center gap-1 mt-2"><Document set="bold" primaryColor="currentColor" size={12} /> Bacaan:</p>
                                                    <p className="text-sm text-text-main dark:text-white whitespace-pre-wrap break-all" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{item.passageText}</p>
                                                </>
                                            )}
                                        </div>
                                        {/* Individual questions */}
                                        <div className="divide-y divide-violet-100 dark:divide-violet-800">
                                            {item.items.map(({ question, originalIndex }) =>
                                                renderQuestionCard(question, originalIndex, true)
                                            )}
                                        </div>
                                    </div>
                                )
                            } else {
                                return (
                                    <Card key={item.question.id || item.originalIndex} className={`p-4 ${selectedQuestionIds.has(item.question.id || '') ? 'ring-2 ring-primary' : ''}`}>
                                        {renderQuestionCard(item.question, item.originalIndex, false)}
                                    </Card>
                                )
                            }
                        })
                    })()}
                </div>
            )}

            {/* Edit Question Modal */}
            {editingQuestionId && editForm && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-text-main dark:text-white flex items-center gap-2"><Edit set="bold" primaryColor="currentColor" size={24} /> Edit Soal</h2>
                            <Button
                                variant="ghost"
                                icon={<>✕</>}
                                onClick={() => {
                                    setEditingQuestionId(null)
                                    setEditForm(null)
                                }}
                            />
                        </div>

                        <div className="space-y-4">
                            {/* Question Text */}
                            <div className="flex items-center gap-4">
                                <div className="flex-1">
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe Soal</label>
                                    <select 
                                        value={editForm.question_type} 
                                        onChange={(e) => {
                                            const type = e.target.value as 'MULTIPLE_CHOICE' | 'ESSAY'
                                            if (type === 'ESSAY') {
                                                if (confirm('Beralih ke Essay akan menghapus opsi dan kunci jawaban yang ada saat ini. Lanjutkan?')) {
                                                    setEditForm({ ...editForm, question_type: type, options: null, correct_answer: null })
                                                }
                                            } else {
                                                setEditForm({ ...editForm, question_type: type, options: editForm.options || ['', '', '', ''], correct_answer: '' })
                                            }
                                        }}
                                        className="w-full px-4 py-2 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                    >
                                        <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                                        <option value="ESSAY">Essay</option>
                                    </select>
                                </div>
                                <div className="flex-1">
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Arah Teks</label>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setEditForm({ ...editForm, text_direction: 'ltr' })}
                                            className={`flex-1 py-1.5 rounded-xl text-sm font-bold transition-all border ${editForm.text_direction !== 'rtl' ? 'bg-primary text-white border-primary' : 'bg-secondary/5 text-text-main dark:text-white border-secondary/20'}`}
                                        >
                                            Kiri ke Kanan
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setEditForm({ ...editForm, text_direction: 'rtl' })}
                                            className={`flex-1 py-1.5 rounded-xl text-sm font-bold transition-all border ${editForm.text_direction === 'rtl' ? 'bg-primary text-white border-primary' : 'bg-secondary/5 text-text-main dark:text-white border-secondary/20'}`}
                                        >
                                            Arab (RTL)
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Question Text */}
                            <div>
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Teks Soal</label>
                                <div dir={editForm.text_direction || 'ltr'}>
                                    <textarea
                                        value={editForm.question_text}
                                        onChange={(e) => setEditForm({ ...editForm, question_text: e.target.value })}
                                        className="w-full px-4 py-3 bg-secondary/5 border border-secondary/30 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                                        rows={4}
                                        placeholder="Masukkan teks soal..."
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Gambar Soal (Opsional)</label>
                                <div className="flex items-start gap-4">
                                    <QuestionImageUpload
                                        imageUrl={editForm.image_url}
                                        onImageChange={(url) => setEditForm({ ...editForm, image_url: url })}
                                        disabled={false}
                                    />
                                    {editForm.image_url && (
                                        <div className="flex-1 bg-secondary/5 rounded-xl border border-secondary/20 p-2 text-center">
                                            <img src={editForm.image_url} className="max-h-40 mx-auto rounded-lg" alt="Preview" />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Passage Text / Audio (if exists) */}
                            {(editForm.passage_text || (editForm as any).passage_audio_url) && (
                                <div className="p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg">
                                    {(editForm as any).passage_audio_url && (
                                        <>
                                            <p className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-1">🎧 Audio (read-only):</p>
                                            <audio controls controlsList="nodownload" className="w-full mb-2" src={(editForm as any).passage_audio_url} />
                                        </>
                                    )}
                                    {editForm.passage_text && (
                                        <>
                                            <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-1 flex items-center gap-1"><Document set="bold" primaryColor="currentColor" size={12} /> Bacaan (read-only):</p>
                                            <p className="text-sm text-text-main dark:text-white line-clamp-3">{editForm.passage_text}</p>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Options for Multiple Choice */}
                            {editForm.question_type === 'MULTIPLE_CHOICE' && editForm.options && (
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pilihan Jawaban</label>
                                    <div className="space-y-2">
                                        {editForm.options.map((opt, optIdx) => (
                                            <div key={optIdx} className="flex items-center gap-2">
                                                <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${editForm.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300'}`}>
                                                    {String.fromCharCode(65 + optIdx)}
                                                </span>
                                                <input
                                                    dir={editForm.text_direction || 'ltr'}
                                                    type="text"
                                                    value={opt}
                                                    onChange={(e) => {
                                                        const newOptions = [...editForm.options!]
                                                        newOptions[optIdx] = e.target.value
                                                        setEditForm({ ...editForm, options: newOptions })
                                                    }}
                                                    className={`flex-1 px-4 py-2 bg-secondary/5 border border-secondary/30 rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary ${editForm.text_direction === 'rtl' ? 'text-right' : ''}`}
                                                    placeholder={`Pilihan ${String.fromCharCode(65 + optIdx)}`}
                                                />
                                                <button
                                                    onClick={() => setEditForm({ ...editForm, correct_answer: String.fromCharCode(65 + optIdx) })}
                                                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${editForm.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300 hover:bg-green-500/20'}`}
                                                >
                                                    {editForm.correct_answer === String.fromCharCode(65 + optIdx) ? '✓ Benar' : 'Set Benar'}
                                                </button>
                                                {editForm.options!.length > 2 && (
                                                    <button
                                                        onClick={() => {
                                                            const newOptions = [...editForm.options!]
                                                            newOptions.splice(optIdx, 1)
                                                            let newCorrectAnswer = editForm.correct_answer
                                                            if (newCorrectAnswer) {
                                                                const charCode = newCorrectAnswer.charCodeAt(0) - 65
                                                                if (charCode === optIdx) newCorrectAnswer = ''
                                                                else if (charCode > optIdx) newCorrectAnswer = String.fromCharCode(charCode + 65 - 1)
                                                            }
                                                            setEditForm({ ...editForm, options: newOptions, correct_answer: newCorrectAnswer })
                                                        }}
                                                        className="px-3 py-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        {editForm.options.length < 6 && (
                                            <button
                                                onClick={() => setEditForm({ ...editForm, options: [...editForm.options!, ''] })}
                                                className="mt-2 text-sm text-primary font-bold hover:underline flex items-center gap-1"
                                            >
                                                <Plus set="bold" primaryColor="currentColor" size={16} /> Tambah Opsi
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Essay correct answer */}
                            {editForm.question_type === 'ESSAY' && (
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kunci Jawaban (opsional)</label>
                                    <textarea
                                        value={editForm.correct_answer || ''}
                                        onChange={(e) => setEditForm({ ...editForm, correct_answer: e.target.value })}
                                        className={`w-full px-4 py-3 bg-secondary/5 border border-secondary/30 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none ${editForm.text_direction === 'rtl' ? 'text-right' : ''}`}
                                        rows={3}
                                        dir={editForm.text_direction || 'ltr'}
                                        placeholder="Kunci jawaban essay..."
                                    />
                                </div>
                            )}

                            <div className="flex items-center gap-4">
                                <div className="flex-1">
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tingkat Kesulitan</label>
                                    <select 
                                        className="w-full px-4 py-2 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                        value={editForm.difficulty || 'MEDIUM'}
                                        onChange={e => setEditForm({ ...editForm, difficulty: e.target.value as any })}
                                    >
                                        <option value="EASY">Mudah</option>
                                        <option value="MEDIUM">Sedang</option>
                                        <option value="HARD">Sulit</option>
                                    </select>
                                </div>
                                <div className="flex-1">
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Poin Soal</label>
                                    <input 
                                        type="number" 
                                        className="w-full px-4 py-2 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                        value={editForm.points}
                                        onChange={e => setEditForm({ ...editForm, points: Number(e.target.value) || 1 })}
                                        min={1}
                                    />
                                </div>
                            </div>

                            {/* HOTS Toggle */}
                            {aiReviewEnabled && (
                                <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl">
                                    <input
                                        type="checkbox"
                                        id="hots-edit-kuis"
                                        checked={editForm.teacher_hots_claim || false}
                                        onChange={e => setEditForm({ ...editForm, teacher_hots_claim: e.target.checked })}
                                        className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500"
                                    />
                                    <label htmlFor="hots-edit-kuis" className="flex-1 cursor-pointer">
                                        <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">🧠 Klaim HOTS</p>
                                        <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">Tandai soal ini sebagai Higher Order Thinking Skills</p>
                                    </label>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-secondary/20">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setEditingQuestionId(null)
                                    setEditForm(null)
                                }}
                            >
                                Batal
                            </Button>
                            <Button
                                onClick={handleSaveEdit}
                                disabled={saving || !editForm.question_text}
                            >
                                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Menyimpan...</> : <><TickSquare set="bold" primaryColor="currentColor" size={16} /> Simpan Perubahan</>}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {/* Manual Mode */}
            {mode === 'manual' && (
                <Card className="p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold text-text-main dark:text-white">✏️ Tambah Soal Manual</h2>
                        <Button variant="ghost" icon={<>✕</>} onClick={() => { setMode('list'); setIsPassageMode(false) }} />
                    </div>

                    <div className="space-y-6">
                        {/* Type selector: PG / Essay / Passage */}
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe Soal</label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setIsPassageMode(false); setManualForm({ ...manualForm, question_type: 'MULTIPLE_CHOICE', options: manualForm.options || ['', '', '', ''], correct_answer: '' }) }}
                                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${!isPassageMode && manualForm.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300 hover:bg-secondary/20'}`}
                                >
                                    Pilihan Ganda
                                </button>
                                <button
                                    onClick={() => { setIsPassageMode(false); setManualForm({ ...manualForm, question_type: 'ESSAY', options: null, correct_answer: null }) }}
                                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${!isPassageMode && manualForm.question_type === 'ESSAY' ? 'bg-amber-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300 hover:bg-secondary/20'}`}
                                >
                                    Essay
                                </button>
                                <button
                                    onClick={() => setIsPassageMode(true)}
                                    className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isPassageMode ? 'bg-teal-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300 hover:bg-secondary/20'}`}
                                >
                                    📖 Passage
                                </button>
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

                                {/* Audio Upload for Listening */}
                                <div>
                                    <label className="block text-sm font-bold text-violet-700 dark:text-violet-400 mb-2">🎧 Audio Listening (Opsional)</label>
                                    {passageAudioUrl ? (
                                        <div className="p-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-300 dark:border-violet-700 rounded-xl space-y-3">
                                            <audio controls className="w-full" src={passageAudioUrl} />
                                            <button
                                                onClick={() => setPassageAudioUrl('')}
                                                className="text-sm text-red-500 hover:text-red-700 font-medium"
                                            >
                                                ✕ Hapus Audio
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            <input
                                                type="file"
                                                accept="audio/*"
                                                onChange={async (e) => {
                                                    const file = e.target.files?.[0]
                                                    if (!file) return
                                                    if (file.size > 25 * 1024 * 1024) {
                                                        setAlertInfo({ type: 'error', title: 'File Terlalu Besar', message: 'Maksimal ukuran audio 25MB.' })
                                                        return
                                                    }
                                                    setUploadingAudio(true)
                                                    try {
                                                        const formData = new FormData()
                                                        formData.append('file', file)
                                                        const res = await fetch('/api/audio/upload', {
                                                            method: 'POST',
                                                            body: formData
                                                        })
                                                        if (!res.ok) {
                                                            const err = await res.json()
                                                            throw new Error(err.error || 'Upload gagal')
                                                        }
                                                        const { url } = await res.json()
                                                        setPassageAudioUrl(url)
                                                    } catch (err: any) {
                                                        console.error('Audio upload error:', err)
                                                        setAlertInfo({ type: 'error', title: 'Gagal Upload', message: err.message || 'Gagal mengupload audio.' })
                                                    } finally {
                                                        setUploadingAudio(false)
                                                        e.target.value = ''
                                                    }
                                                }}
                                                className="hidden"
                                                id="passage-audio-upload"
                                                disabled={uploadingAudio}
                                            />
                                            <label
                                                htmlFor="passage-audio-upload"
                                                className={`flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed border-violet-300 dark:border-violet-700 rounded-xl text-sm font-medium transition-colors cursor-pointer ${uploadingAudio ? 'opacity-50 cursor-wait' : 'text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20'}`}
                                            >
                                                {uploadingAudio ? (
                                                    <><Loader2 className="w-4 h-4 animate-spin" /> Mengupload...</>
                                                ) : (
                                                    <>🎵 Upload Audio (MP3, WAV, M4A, OGG — maks 25MB)</>
                                                )}
                                            </label>
                                        </div>
                                    )}
                                    <p className="text-xs text-text-secondary dark:text-zinc-500 mt-1">
                                        Siswa akan mendengar audio ini sebelum menjawab soal-soal di bawah.
                                    </p>
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
                                                                        options: e.target.value === 'MULTIPLE_CHOICE' ? (updated[pqIdx].options || ['', '', '', '']) : null,
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
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-xs text-text-secondary">Arah Teks:</span>
                                                    <div className="flex gap-1">
                                                        <button type="button" onClick={() => { const updated = [...passageQuestions]; updated[pqIdx] = { ...updated[pqIdx], text_direction: 'ltr' }; setPassageQuestions(updated) }} className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${pq.text_direction !== 'rtl' ? 'bg-primary text-white' : 'bg-secondary/10 text-text-secondary'}`}>LTR</button>
                                                        <button type="button" onClick={() => { const updated = [...passageQuestions]; updated[pqIdx] = { ...updated[pqIdx], text_direction: 'rtl' }; setPassageQuestions(updated) }} className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${pq.text_direction === 'rtl' ? 'bg-primary text-white' : 'bg-secondary/10 text-text-secondary'}`}>RTL</button>
                                                    </div>
                                                </div>
                                                <textarea
                                                    dir={pq.text_direction || 'ltr'}
                                                    value={pq.question_text}
                                                    onChange={(e) => {
                                                        const updated = [...passageQuestions]
                                                        updated[pqIdx] = { ...updated[pqIdx], question_text: e.target.value }
                                                        setPassageQuestions(updated)
                                                    }}
                                                    className={`w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-secondary/20 rounded-lg text-text-main dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 ${pq.text_direction === 'rtl' ? 'text-right' : ''}`}
                                                    rows={2}
                                                    placeholder="Tulis pertanyaan..."
                                                />
                                                {pq.question_type === 'MULTIPLE_CHOICE' && (
                                                    <div className="mt-3 space-y-2">
                                                        <div className="space-y-2">
                                                            {(pq.options || ['','','','']).map((_, optIdx) => { const letter = String.fromCharCode(65 + optIdx); return (
                                                                <div key={letter} className="flex gap-2">
                                                                    <div className="relative flex-1">
                                                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-secondary/20 flex items-center justify-center text-xs font-bold text-text-secondary">{letter}</div>
                                                                        <input
                                                                            type="text"
                                                                            value={pq.options?.[optIdx] || ''}
                                                                            onChange={(e) => {
                                                                                const updated = [...passageQuestions]
                                                                                const newOpts = [...(updated[pqIdx].options || ['', '', '', ''])]
                                                                                newOpts[optIdx] = e.target.value
                                                                                updated[pqIdx] = { ...updated[pqIdx], options: newOpts }
                                                                                setPassageQuestions(updated)
                                                                            }}
                                                                            className="w-full pl-10 pr-3 py-1.5 bg-white dark:bg-zinc-800 border border-secondary/20 rounded-lg text-sm text-text-main dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                                                                            placeholder={`Opsi ${letter}`}
                                                                        />
                                                                    </div>
                                                                    {(pq.options || []).length > 2 && (
                                                                        <button
                                                                            onClick={() => {
                                                                                const updated = [...passageQuestions]
                                                                                const newOpts = [...(updated[pqIdx].options || ['', '', '', ''])]
                                                                                newOpts.splice(optIdx, 1)
                                                                                let newCorrectAnswer = updated[pqIdx].correct_answer
                                                                                if (newCorrectAnswer) {
                                                                                    const charCode = newCorrectAnswer.charCodeAt(0) - 65
                                                                                    if (charCode === optIdx) newCorrectAnswer = ''
                                                                                    else if (charCode > optIdx) newCorrectAnswer = String.fromCharCode(charCode + 65 - 1)
                                                                                }
                                                                                updated[pqIdx] = { ...updated[pqIdx], options: newOpts, correct_answer: newCorrectAnswer }
                                                                                setPassageQuestions(updated)
                                                                            }}
                                                                            className="px-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                                                                        >
                                                                            ✕
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )})}
                                                        </div>
                                                        {(pq.options || []).length < 6 && (
                                                            <button
                                                                onClick={() => {
                                                                    const updated = [...passageQuestions]
                                                                    const newOpts = [...(updated[pqIdx].options || ['', '', '', ''])]
                                                                    newOpts.push('')
                                                                    updated[pqIdx] = { ...updated[pqIdx], options: newOpts }
                                                                    setPassageQuestions(updated)
                                                                }}
                                                                className="text-xs text-primary font-bold hover:underline flex items-center gap-1 mt-1"
                                                            >
                                                                <Plus set="bold" primaryColor="currentColor" size={14} /> Tambah Opsi
                                                            </button>
                                                        )}
                                                        <div className="flex gap-2 mt-2">
                                                            <span className="text-xs text-text-secondary mt-1">Jawaban:</span>
                                                            {(pq.options || ['','','','']).map((_, optIdx) => { const letter = String.fromCharCode(65 + optIdx); return (
                                                                <button
                                                                    key={letter}
                                                                    onClick={() => {
                                                                        const updated = [...passageQuestions]
                                                                        updated[pqIdx] = { ...updated[pqIdx], correct_answer: letter }
                                                                        setPassageQuestions(updated)
                                                                    }}
                                                                    className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${pq.correct_answer === letter ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}
                                                                >{letter}</button>
                                                            )})}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* HOTS Toggle */}
                                                {aiReviewEnabled && (
                                                    <div className="mt-3 flex items-center gap-3 p-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-lg">
                                                        <input
                                                            type="checkbox"
                                                            id={`hots-passage-kuis-${pqIdx}`}
                                                            checked={pq.teacher_hots_claim || false}
                                                            onChange={e => {
                                                                const updated = [...passageQuestions]
                                                                updated[pqIdx] = { ...updated[pqIdx], teacher_hots_claim: e.target.checked }
                                                                setPassageQuestions(updated)
                                                            }}
                                                            className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                                                        />
                                                        <label htmlFor={`hots-passage-kuis-${pqIdx}`} className="cursor-pointer">
                                                            <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">🧠 Klaim HOTS</p>
                                                        </label>
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

                                <div className="flex gap-3 pt-4">
                                    <Button variant="secondary" onClick={() => { setMode('list'); setIsPassageMode(false) }} className="flex-1">Batal</Button>
                                    <Button
                                        onClick={handleAddManualQuestion}
                                        disabled={saving || (!passageText.trim() && !passageAudioUrl) || !passageQuestions.some(q => q.question_text.trim())}
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
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-bold text-text-main dark:text-white">Pertanyaan</label>
                                        <div className="flex gap-1">
                                            <button type="button" onClick={() => setManualForm({ ...manualForm, text_direction: 'ltr' })} className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors ${manualForm.text_direction !== 'rtl' ? 'bg-primary text-white' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>LTR</button>
                                            <button type="button" onClick={() => setManualForm({ ...manualForm, text_direction: 'rtl' })} className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors ${manualForm.text_direction === 'rtl' ? 'bg-primary text-white' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>Arab (RTL)</button>
                                        </div>
                                    </div>
                                    <div dir={manualForm.text_direction || 'ltr'}>
                                        <MathTextarea
                                            value={manualForm.question_text}
                                            onChange={(val) => setManualForm({ ...manualForm, question_text: val })}
                                            placeholder="Tulis pertanyaan..."
                                            rows={3}
                                        />
                                    </div>
                                </div>

                                {manualForm.question_type === 'MULTIPLE_CHOICE' && (
                                    <>
                                        <div className="grid grid-cols-2 gap-3">
                                            {(manualForm.options || ['','','','']).map((_, idx) => { const letter = String.fromCharCode(65 + idx); return (
                                                <div key={letter} className="flex flex-col">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <label className="text-sm font-bold text-text-main dark:text-white">Opsi {letter}</label>
                                                        {(manualForm.options || []).length > 2 && (
                                                            <button
                                                                onClick={() => {
                                                                    const newOpts = [...(manualForm.options || ['', '', '', ''])]
                                                                    newOpts.splice(idx, 1)
                                                                    let newCorrectAnswer = manualForm.correct_answer
                                                                    if (newCorrectAnswer) {
                                                                        const charCode = newCorrectAnswer.charCodeAt(0) - 65
                                                                        if (charCode === idx) newCorrectAnswer = ''
                                                                        else if (charCode > idx) newCorrectAnswer = String.fromCharCode(charCode + 65 - 1)
                                                                    }
                                                                    setManualForm({ ...manualForm, options: newOpts, correct_answer: newCorrectAnswer })
                                                                }}
                                                                className="text-xs font-bold text-red-500 hover:text-red-700"
                                                            >✕ Hapus</button>
                                                        )}
                                                    </div>
                                                    <input
                                                        type="text"
                                                        value={manualForm.options?.[idx] || ''}
                                                        onChange={(e) => {
                                                            const newOptions = [...(manualForm.options || ['', '', '', ''])]
                                                            newOptions[idx] = e.target.value
                                                            setManualForm({ ...manualForm, options: newOptions })
                                                        }}
                                                        className="w-full px-3 py-2 bg-secondary/5 border border-secondary/30 rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                                    />
                                                </div>
                                            )})}
                                        </div>
                                        {(manualForm.options || []).length < 6 && (
                                            <button
                                                onClick={() => {
                                                    const newOpts = [...(manualForm.options || ['', '', '', ''])]
                                                    newOpts.push('')
                                                    setManualForm({ ...manualForm, options: newOpts })
                                                }}
                                                className="mt-2 text-sm text-primary font-bold hover:underline flex items-center gap-1"
                                            >
                                                <Plus set="bold" primaryColor="currentColor" size={16} /> Tambah Opsi
                                            </button>
                                        )}
                                        <div>
                                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kunci Jawaban</label>
                                            <div className="flex gap-2">
                                                {(manualForm.options || ['','','','']).map((_, idx) => { const letter = String.fromCharCode(65 + idx); return (
                                                    <button
                                                        key={letter}
                                                        onClick={() => setManualForm({ ...manualForm, correct_answer: letter })}
                                                        className={`w-12 h-12 rounded-lg font-bold transition-colors ${manualForm.correct_answer === letter ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300 hover:bg-secondary/20'}`}
                                                    >{letter}</button>
                                                )})}
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
                                        <input
                                            type="number"
                                            value={manualForm.points}
                                            onChange={(e) => setManualForm({ ...manualForm, points: parseInt(e.target.value) || 10 })}
                                            className="w-full px-3 py-2 bg-secondary/5 border border-secondary/30 rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                            min={1}
                                        />
                                    </div>
                                </div>

                                {/* HOTS Toggle */}
                                {aiReviewEnabled && (
                                    <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                        <input
                                            type="checkbox"
                                            id="hots-claim-kuis"
                                            checked={manualForm.teacher_hots_claim || false}
                                            onChange={e => setManualForm({ ...manualForm, teacher_hots_claim: e.target.checked })}
                                            className="w-5 h-5 accent-emerald-600 rounded"
                                        />
                                        <label htmlFor="hots-claim-kuis" className="flex-1 cursor-pointer">
                                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">🧠 Klaim HOTS</p>
                                            <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">Centang jika soal ini membutuhkan kemampuan berpikir tingkat tinggi (Analisis, Evaluasi, atau Kreasi)</p>
                                        </label>
                                    </div>
                                )}

                                <div className="flex gap-3 pt-4">
                                    <Button variant="secondary" onClick={() => setMode('list')} className="flex-1">
                                        Batal
                                    </Button>
                                    <Button
                                        onClick={handleAddManualQuestion}
                                        disabled={saving || !manualForm.question_text || !manualForm.difficulty || (manualForm.question_type === 'MULTIPLE_CHOICE' && !manualForm.correct_answer)}
                                        loading={saving}
                                        className="flex-1"
                                    >
                                        {saving ? 'Menyimpan...' : 'Tambah Soal'}
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </Card>
            )}

            {/* Rapih AI Mode (All-in-One) */}
            <RapihAIModal
                visible={mode === 'clean'}
                onClose={() => setMode('list')}
                onSaveResults={handleSaveAIResults}
                onSaveToBank={handleSaveToBank}
                saving={saving}
                targetLabel="Kuis"
                aiReviewEnabled={aiReviewEnabled}
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
                                <p className="text-sm text-text-secondary dark:text-zinc-400 mb-4">Pilih soal yang ingin ditambahkan ke kuis ini:</p>

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
                                                            // Toggle all questions in this passage
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
                                                                    <SmartText text={q.question_text} as="span" className="flex-1 text-text-main dark:text-white" />
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
                                                        <SmartText text={q.question_text} className="text-text-main dark:text-white text-sm" />
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
                                                        passage_text: p.passage_text,
                                                        passage_audio_url: p.audio_url || null
                                                    }))
                                                )
                                                // Filter bankQuestions to only include standalone questions (no passage_id)
                                                // to avoid duplicates with passageQuestionsWithText
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
                                                        passage_audio_url: q.passage_audio_url || null,
                                                        teacher_hots_claim: q.teacher_hots_claim || false,
                                                        // Inherit approved status from bank soal (skip re-review)
                                                        bank_status: q.status
                                                    }))

                                                await fetch(`/api/quizzes/${quizId}/questions`, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify(selectedQuestions)
                                                })

                                                setSelectedBankIds(new Set())
                                                setMode('list')
                                                fetchQuiz()
                                            } finally {
                                                setSaving(false)
                                            }
                                        }}
                                        disabled={saving || selectedBankIds.size === 0}
                                        loading={saving}
                                        className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600"
                                    >
                                        {saving ? 'Menyimpan...' : `Tambahkan ${selectedBankIds.size} Soal ke Kuis`}
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
                title="Publish Kuis Ini?"
            >
                <div className="text-center">
                    <div className="w-16 h-16 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <p className="text-text-secondary mb-6">
                        Setelah dipublish, siswa akan langsung bisa melihat dan mengerjakan kuis ini. Pastikan semua soal sudah benar.
                    </p>
                    <div className="flex gap-3">
                        <Button
                            variant="secondary"
                            onClick={() => setShowPublishConfirm(false)}
                            disabled={publishing}
                            className="flex-1"
                        >
                            Batal
                        </Button>
                        <Button
                            onClick={confirmPublish}
                            disabled={publishing}
                            loading={publishing}
                            className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600"
                        >
                            Ya, Publish
                        </Button>
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
                    <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Kuis Berhasil Dipublish!</h3>
                    <p className="text-sm text-text-secondary dark:text-zinc-400 mb-6">
                        Siswa sekarang dapat melihat dan mengerjakan kuis ini melalui dashboard mereka.
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
                title={quiz.title}
                description={quiz.description}
                durationMinutes={30}
                questions={questions}
                type="kuis"
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
