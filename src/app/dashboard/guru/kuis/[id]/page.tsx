'use client'

import { useEffect, useState, useCallback, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import SmartText from '@/components/SmartText'
import { isCorrectOption, validateCorrectAnswer } from '@/lib/questionTypeUtils'
// Dynamic imports for heavy components
const MathTextarea = dynamic(() => import('@/components/MathTextarea'), {
    ssr: false,
    loading: () => <textarea placeholder="Memuat editor..." className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main" rows={3} readOnly />
})
const PreviewModal = dynamic(() => import('@/components/PreviewModal'), { ssr: false })
const RapihAIModal = dynamic(() => import('@/components/RapihAIModal'), { ssr: false })
// Static import for RichTextEditor — previously loaded as a lazy chunk via dynamic(),
// which crashed the whole page white when the chunk no longer existed after a deploy
import RichTextEditor from '@/components/RichTextEditor'
import { plainToHtml } from '@/lib/richTextUtils'
import EditorErrorBoundary from '@/components/EditorErrorBoundary'
import { Edit, Discovery, Folder, Plus, Upload, Danger, InfoCircle, TickSquare, CloseSquare, Delete, Document, Search, User } from 'react-iconly'
import { Loader2, Eye, Brain, GripVertical } from 'lucide-react'
import QuestionImageUpload from '@/components/QuestionImageUpload'
import QuestionOptionsEditor from '@/components/QuestionOptionsEditor'
import { PageHeader, Button, Modal, EmptyState, Toast, type ToastType } from '@/components/ui'
import Card from '@/components/ui/Card'

interface QuizQuestion {
    id?: string
    question_text: string
    question_type: string
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
    admin_review?: any
    content_format?: 'html' | 'plain'
}

interface Quiz {
    id: string
    title: string
    description: string | null
    is_active: boolean
    pending_publish: boolean
    batch_id?: string | null
    teaching_assignment: {
        subject: { id: string; name: string }
        class: { name: string }
    }
    questions: QuizQuestion[]
}

type Mode = 'list' | 'manual' | 'clean' | 'ai' | 'bank'

// Live drag state for pointer-based reorder (see handleDragStart/handleDragMove/handleDragEnd)
interface DragInfo {
    questionId: string
    groupKey: string
    memberIds: string[]       // ids of draggable members in the same group, in visual order
    memberTops: number[]      // document-relative top of each member card at drag start
    memberHeights: number[]
    fromSlot: number          // dragged card's slot among members at drag start
    insertionIndex: number    // k = how many member midpoints are above the dragged center (0..N)
    startDocY: number         // pointer position (document-relative) at drag start
    currentDy: number         // clamped pointer delta from drag start
    height: number            // dragged card height
    top: number               // dragged card document-relative top at drag start
}

function EditQuizPageInner() {
    const params = useParams()
    const searchParams = useSearchParams()
    const quizId = params.id as string
    const highlightId = searchParams.get('highlight')
    const siblingParam = searchParams.get('siblings')

    const [quiz, setQuiz] = useState<Quiz | null>(null)
    const [questions, setQuestions] = useState<QuizQuestion[]>([])
    const [siblingIds, setSiblingIds] = useState<string[]>([])

    // Auto-scroll for deep-linked notifications
    useEffect(() => {
        if (highlightId && questions.length > 0) {
            const el = document.getElementById(`question-${highlightId}`)
            if (el) {
                setTimeout(() => {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 500)
            }
        }
    }, [highlightId, questions])

    // Tutorial events: open dropdown / switch to manual mode
    useEffect(() => {
        const openDropdown = () => setShowAddDropdown(true)
        const clickManual = () => {
            setManualForm(prev => ({
                ...prev,
                points: 10,
                question_text: '',
                options: ['', '', '', ''],
                correct_answer: '',
                difficulty: undefined,
                question_type: 'MULTIPLE_CHOICE',
            }))
            setMode('manual')
            setShowAddDropdown(false)
        }
        const backToList = () => setMode('list')
        window.addEventListener('tutorial:open-quiz-dropdown', openDropdown)
        window.addEventListener('tutorial:click-manual-quiz', clickManual)
        window.addEventListener('tutorial:quiz-back-to-list', backToList)
        return () => {
            window.removeEventListener('tutorial:open-quiz-dropdown', openDropdown)
            window.removeEventListener('tutorial:click-manual-quiz', clickManual)
            window.removeEventListener('tutorial:quiz-back-to-list', backToList)
        }
    }, [])
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
    const [syncFailedCount, setSyncFailedCount] = useState(0)
    const [retryingSync, setRetryingSync] = useState(false)
    const [publishingCheck, setPublishingCheck] = useState(false)
    const [showSuccessModal, setShowSuccessModal] = useState<false | 'published' | 'pending'>(false)
    const [alertInfo, setAlertInfo] = useState<{ type: 'info' | 'warning' | 'error' | 'success', title: string, message: string } | null>(null)
    const [aiReviewEnabled, setAiReviewEnabled] = useState(true)

    // Toast notification (design system)
    const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)
    const showToast = (message: string, type: ToastType = 'success') => setToast({ message, type })

    // Quick-add preset: remembers the last saved type & option count from the manual form
    // (page state only, never persisted). Difficulty & points always follow the question above the "+" button.
    const [quickAddPreset, setQuickAddPreset] = useState<{ question_type: string; optionCount: number } | null>(null)

    // Drag & drop reorder state (pointer-events based, works on touch screens)
    const [dragInfo, setDragInfo] = useState<DragInfo | null>(null)
    const listContainerRef = useRef<HTMLDivElement | null>(null)
    const cardRefs = useRef(new Map<string, HTMLElement>())
    // Drag is disabled while content is locked (published / menunggu review), while editing, or during bulk select
    const dragDisabled = !!quiz?.is_active || !!quiz?.pending_publish || !!editingQuestionId || isBulkSelectMode
    // Passage questions (audio group or passage text) and standalone questions never mix in one drag group
    const getDragGroupKey = (q: QuizQuestion) =>
        q.passage_audio_url ? `audio:${q.passage_audio_url}` : q.passage_text ? 'passage' : 'standalone'

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
        try {
            if (siblingParam) {
                const ids = siblingParam.split(',').filter(Boolean)
                setSiblingIds(ids)
                sessionStorage.setItem(`quiz_siblings_${quizId}`, JSON.stringify(ids))
            } else {
                const stored = sessionStorage.getItem(`quiz_siblings_${quizId}`)
                if (stored) setSiblingIds(JSON.parse(stored))
            }
        } catch {
            // Ignore corrupt or unavailable sessionStorage
        }
    }, [siblingParam, quizId])

    useEffect(() => {
        fetchQuiz()
    }, [fetchQuiz])

    // Auto-poll when questions are being AI-reviewed
    useEffect(() => {
        if (!aiReviewEnabled) return
        const hasPending = questions.some(q => q.status === 'ai_reviewing' || q.status === 'draft')
        if (!hasPending) return
        const interval = setInterval(() => {
            fetchQuiz()
        }, 5000)
        return () => clearInterval(interval)
    }, [aiReviewEnabled, questions, fetchQuiz])

    useEffect(() => {
        fetch('/api/school-settings').then(r => r.ok ? r.json() : null).then(d => {
            if (d) setAiReviewEnabled(d.ai_review_enabled !== false)
        }).catch(() => { })
    }, [])

    const handlePublishClick = async () => {
        // Verifikasi segar ke server — state bisa basi tepat setelah import/simpan soal
        // (klik Publish sebelum list sempat refresh → salah tolak "Belum Ada Soal")
        setPublishingCheck(true)
        try {
            const res = await fetch(`/api/quizzes/${quizId}/questions`)
            const fresh = await res.json().catch(() => [])
            const freshQuestions = Array.isArray(fresh) ? fresh : []
            if (freshQuestions.length === 0) {
                setAlertInfo({ type: 'warning', title: 'Belum Ada Soal', message: 'Minimal harus ada 1 soal untuk mempublish kuis!' })
                return
            }
            // Segarkan state sekalian supaya indikator lain ikut benar
            setQuestions(freshQuestions)
            setShowPublishConfirm(true)
        } catch {
            setAlertInfo({ type: 'error', title: 'Gagal Memuat', message: 'Tidak bisa memeriksa soal. Periksa koneksi lalu coba lagi.' })
        } finally {
            setPublishingCheck(false)
        }
    }

    // Salin soal ke kelas sibling. Return true bila semua target berhasil.
    const syncToSiblings = async (): Promise<boolean> => {
        try {
            const syncRes = await fetch('/api/quizzes/copy-questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_quiz_id: quizId,
                    target_quiz_ids: siblingIds,
                    also_publish: true
                })
            })
            const syncData = await syncRes.json().catch(() => null)
            const failedTargets: string[] = syncData?.failed_targets || []
            if (!syncRes.ok || failedTargets.length > 0) {
                setSyncFailedCount(failedTargets.length || siblingIds.length)
                return false
            }
            sessionStorage.removeItem(`quiz_siblings_${quizId}`)
            setSyncFailedCount(0)
            return true
        } catch (syncError) {
            console.error('Error syncing questions to siblings:', syncError)
            setSyncFailedCount(siblingIds.length)
            return false
        }
    }

    const handleRetrySync = async () => {
        setRetryingSync(true)
        let ok = false
        if (quiz?.batch_id) {
            // Jalur utama: sync-batch di server (sumber kebenaran batch_id di DB)
            try {
                const res = await fetch(`/api/quizzes/${quizId}/sync-batch`, { method: 'POST' })
                const data = await res.json().catch(() => null)
                ok = !!res.ok && !!data && (data.failed?.length || 0) === 0
                if (!ok) setSyncFailedCount(data?.failed?.length || siblingIds.length)
            } catch {
                ok = false
                setSyncFailedCount(siblingIds.length)
            }
        } else {
            ok = await syncToSiblings()
        }
        setRetryingSync(false)
        if (ok) {
            setAlertInfo({ type: 'success', title: 'Berhasil', message: 'Soal berhasil disalin ke semua kelas.' })
            fetchQuiz()
        } else {
            setAlertInfo({ type: 'error', title: 'Masih Gagal', message: 'Penyalinan soal masih gagal. Coba lagi beberapa saat.' })
        }
    }

    const confirmPublish = async () => {
        setPublishing(true)
        try {
            // Fresh-fetch latest question statuses before attempting publish
            await fetchQuiz()

            const res = await fetch(`/api/quizzes/${quizId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: true })
            })

            if (res.ok) {
                const resData = await res.json()

                // Soal menunggu review admin — sibling jangan diterbitkan/disalin dulu
                if (resData?.pending_publish) {
                    setShowPublishConfirm(false)
                    setShowSuccessModal('pending')
                    fetchQuiz()
                    return
                }

                // Sinkronisasi kelas satu batch dilakukan server saat aktivasi (batch_id di DB)
                const batchSync = resData?.batch_sync
                if (batchSync && (batchSync.total ?? 0) > 0) {
                    if (batchSync.failed?.length > 0) {
                        setSyncFailedCount(batchSync.failed.length)
                        setAlertInfo({
                            type: 'error',
                            title: 'Gagal Menyalin Soal',
                            message: `Soal gagal disalin ke ${batchSync.failed.length} kelas. Kuis utama tetap terbit. Gunakan tombol "Salin Ulang Soal" di halaman ini untuk mencoba lagi.`
                        })
                        setShowPublishConfirm(false)
                        fetchQuiz()
                        return
                    }
                    sessionStorage.removeItem(`quiz_siblings_${quizId}`)
                    setSyncFailedCount(0)
                } else if (siblingIds.length > 0) {
                    // Fallback legacy: kuis lama tanpa batch_id disalin via sessionStorage
                    const syncOk = await syncToSiblings()
                    if (!syncOk) {
                        // Linkage sibling dipertahankan — guru retry lewat tombol "Salin Ulang Soal"
                        setAlertInfo({
                            type: 'error',
                            title: 'Gagal Menyalin Soal',
                            message: 'Soal gagal disalin ke beberapa kelas. Kuis utama tetap terbit. Gunakan tombol "Salin Ulang Soal" di halaman ini untuk mencoba lagi.'
                        })
                        setShowPublishConfirm(false)
                        fetchQuiz()
                        return
                    }
                }

                setShowPublishConfirm(false)
                setShowSuccessModal('published')
                fetchQuiz()
            } else {
                let errData
                try {
                    errData = await res.json()
                } catch {
                    // ignore
                }
                // Re-fetch to sync UI with actual DB state
                await fetchQuiz()
                throw new Error(errData?.error || 'Gagal mempublish kuis')
            }
        } catch (error: any) {
            console.error('Error publishing:', error)
            setAlertInfo({ type: 'error', title: 'Gagal Publish', message: error.message || 'Terjadi kesalahan saat mempublish kuis. Coba lagi.' })
            setShowPublishConfirm(false)
        } finally {
            setPublishing(false)
        }
    }

    const handleAddManualQuestion = async (addAnother = false) => {
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
                        options: ['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE'].includes(q.question_type) ? q.options : null,
                        correct_answer: q.correct_answer || null,
                        points: q.points || 10,
                        order_index: questions.length + idx,
                        passage_text: passageText,
                        passage_audio_url: passageAudioUrl || null,
                        teacher_hots_claim: q.teacher_hots_claim || false,
                        text_direction: q.text_direction || 'ltr',
                        content_format: 'html'
                    }))
                const res = await fetch(`/api/quizzes/${quizId}/questions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(questionsToSave)
                })
                if (!res.ok) {
                    // Jangan reset form — guru tidak kehilangan pekerjaannya saat server menolak
                    const errData = await res.json().catch(() => null)
                    setAlertInfo({ type: 'error', title: 'Gagal Menyimpan', message: errData?.error || 'Gagal menyimpan passage. Periksa jawaban benar setiap soal.' })
                    return
                }
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
            const res = await fetch(`/api/quizzes/${quizId}/questions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...manualForm,
                    order_index: questions.length,
                    options: ['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE'].includes(manualForm.question_type) ? manualForm.options : null,
                    content_format: 'html'
                })
            })
            if (!res.ok) {
                const errData = await res.json().catch(() => null)
                throw new Error(errData?.error || 'Gagal menyimpan soal')
            }
            // Remember the teacher's last used type & option count for the next quick-add "+" preset
            setQuickAddPreset({
                question_type: manualForm.question_type,
                optionCount: manualForm.options?.length ?? 4
            })
            if (addAnother) {
                // "Simpan & Tambah Lagi": reset ONLY the question text & correct answer —
                // keep type, option count, difficulty, points (option texts are blanked, count preserved)
                setManualForm(prev => ({
                    ...prev,
                    question_text: '',
                    options: prev.question_type === 'TRUE_FALSE'
                        ? ['Benar', 'Salah']
                        : ['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(prev.question_type)
                            ? (prev.options || []).map(() => '')
                            : null,
                    correct_answer: prev.question_type === 'ESSAY' ? null : ''
                }))
                showToast('Soal tersimpan. Lanjut tambah soal berikutnya.', 'success')
            } else {
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
            }
            fetchQuiz()
        } catch (error) {
            console.error('Error adding question:', error)
            setAlertInfo({ type: 'error', title: 'Gagal Menyimpan', message: error instanceof Error ? error.message : 'Gagal menyimpan soal. Coba lagi.' })
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
                    text_direction: editForm.text_direction || 'ltr',
                    content_format: 'html',
                    passage_text: editForm.passage_text || null,
                    passage_audio_url: (editForm as any).passage_audio_url || null
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
                teacher_hots_claim: q.teacher_hots_claim || false
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

    // === Quick-add "+" ===
    // Build a blank manual form preset from the question right above the clicked "+" button.
    // Type & option count come from the remembered quickAddPreset if the teacher already saved
    // a question via the form; otherwise they follow the source question. Difficulty & points
    // always follow the source question.
    const buildPresetForm = (source: QuizQuestion): QuizQuestion => {
        const type = quickAddPreset?.question_type ?? source.question_type
        let options: string[] | null = null
        if (type === 'MULTIPLE_CHOICE' || type === 'MULTIPLE_ANSWER') {
            const sourceCount = source.options && source.options.length >= 2 ? source.options.length : 4
            const count = quickAddPreset?.optionCount ?? sourceCount
            options = Array.from({ length: count }, () => '')
        } else if (type === 'TRUE_FALSE') {
            options = ['Benar', 'Salah']
        }
        return {
            question_text: '',
            question_type: type,
            options,
            correct_answer: type === 'ESSAY' ? null : '',
            difficulty: source.difficulty,
            points: source.points,
            order_index: 0,
            teacher_hots_claim: false,
            text_direction: source.text_direction || 'ltr'
        }
    }

    const handleQuickAdd = (source: QuizQuestion) => {
        setIsPassageMode(false)
        setManualForm(buildPresetForm(source))
        setMode('manual')
    }

    // === Drag & drop reorder (pointer events) ===
    const setCardRef = (id: string | undefined) => (el: HTMLElement | null) => {
        if (!id) return
        if (el) cardRefs.current.set(id, el)
        else cardRefs.current.delete(id)
    }

    const endDragCleanup = () => {
        setDragInfo(null)
        document.body.style.userSelect = ''
    }

    const handleDragStart = (e: ReactPointerEvent<HTMLElement>, q: QuizQuestion) => {
        if (dragDisabled || !q.id) return
        if (e.pointerType === 'mouse' && e.button !== 0) return
        e.preventDefault()
        const groupKey = getDragGroupKey(q)
        const memberIds = questions.filter(x => x.id && getDragGroupKey(x) === groupKey).map(x => x.id!)
        const tops: number[] = []
        const heights: number[] = []
        for (const id of memberIds) {
            const el = cardRefs.current.get(id)
            if (!el) return // cannot measure a member → abort drag entirely
            const rect = el.getBoundingClientRect()
            tops.push(rect.top + window.scrollY)
            heights.push(rect.height)
        }
        const fromSlot = memberIds.indexOf(q.id)
        if (fromSlot === -1) return
        e.currentTarget.setPointerCapture?.(e.pointerId)
        document.body.style.userSelect = 'none'
        setDragInfo({
            questionId: q.id,
            groupKey,
            memberIds,
            memberTops: tops,
            memberHeights: heights,
            fromSlot,
            insertionIndex: fromSlot,
            startDocY: e.clientY + window.scrollY,
            currentDy: 0,
            height: heights[fromSlot],
            top: tops[fromSlot]
        })
    }

    const handleDragMove = (e: ReactPointerEvent<HTMLElement>) => {
        if (!dragInfo) return
        const docY = e.clientY + window.scrollY
        // Clamp so the dragged card never leaves the vertical span of its own group
        const lastIdx = dragInfo.memberIds.length - 1
        const minDy = dragInfo.memberTops[0] - dragInfo.top
        const maxDy = dragInfo.memberTops[lastIdx] + dragInfo.memberHeights[lastIdx] - (dragInfo.top + dragInfo.height)
        const dy = Math.max(minDy, Math.min(docY - dragInfo.startDocY, maxDy))
        const center = dragInfo.top + dragInfo.height / 2 + dy
        let k = 0
        dragInfo.memberIds.forEach((_, i) => {
            if (center > dragInfo.memberTops[i] + dragInfo.memberHeights[i] / 2) k = i + 1
        })
        if (dy !== dragInfo.currentDy || k !== dragInfo.insertionIndex) {
            setDragInfo({ ...dragInfo, currentDy: dy, insertionIndex: k })
        }
    }

    const handleDragEnd = (e: ReactPointerEvent<HTMLElement>) => {
        if (!dragInfo) return
        const info = dragInfo
        endDragCleanup()
        // Drop outside the question list → cancel, nothing changes
        const container = listContainerRef.current
        if (container) {
            const rect = container.getBoundingClientRect()
            const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
            if (!inside) return
        }
        // Recompute the target slot from the actual pointer-up position (not the last move)
        const lastIdx = info.memberIds.length - 1
        const minDy = info.memberTops[0] - info.top
        const maxDy = info.memberTops[lastIdx] + info.memberHeights[lastIdx] - (info.top + info.height)
        const dy = Math.max(minDy, Math.min(e.clientY + window.scrollY - info.startDocY, maxDy))
        const center = info.top + info.height / 2 + dy
        let toSlot = 0
        info.memberIds.forEach((_, i) => {
            if (center > info.memberTops[i] + info.memberHeights[i] / 2) toSlot = i + 1
        })
        if (toSlot > info.fromSlot) toSlot -= 1
        toSlot = Math.max(0, Math.min(toSlot, lastIdx))
        if (toSlot === info.fromSlot) return
        commitReorder(info, toSlot)
    }

    const handleDragCancel = () => {
        if (dragInfo) endDragCleanup()
    }

    // Reorder only touches order_index of affected questions — everything else stays as-is
    const commitReorder = async (info: DragInfo, toSlot: number) => {
        const memberSet = new Set(info.memberIds)
        const members = info.memberIds.map(id => questions.find(q => q.id === id)!).filter(Boolean)
        const dragged = members.find(m => m.id === info.questionId)
        if (!dragged) return
        const remaining = members.filter(m => m.id !== info.questionId)
        const newMembers = [...remaining.slice(0, toSlot), dragged, ...remaining.slice(toSlot)]
        const memberQueue = [...newMembers]
        const prev = questions
        const next = questions.map(q => (q.id && memberSet.has(q.id)) ? memberQueue.shift()! : q)
        const changed: { id: string; order_index: number }[] = []
        const reordered = next.map((q, i) => {
            if (q.order_index !== i) {
                if (q.id) changed.push({ id: q.id, order_index: i })
                return { ...q, order_index: i }
            }
            return q
        })
        if (changed.length === 0) return
        // Optimistic UI update, then one batch request to the existing reorder endpoint
        setQuestions(reordered)
        try {
            const res = await fetch(`/api/quizzes/${quizId}/questions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reorder: changed })
            })
            if (!res.ok) throw new Error('Gagal menyimpan urutan')
            showToast('Urutan disimpan', 'success')
        } catch (error) {
            console.error('Reorder error:', error)
            setQuestions(prev)
            showToast('Gagal menyimpan urutan. Urutan dikembalikan.', 'error')
        }
    }

    // Live styles: dragged card follows the pointer (no transition, lifted shadow),
    // other members slide to their target slot with a CSS transition
    const getDragStyle = (q: QuizQuestion): CSSProperties => {
        if (!dragInfo || !q.id || dragInfo.groupKey !== getDragGroupKey(q)) return {}
        const slot = dragInfo.memberIds.indexOf(q.id)
        if (slot === -1) return {}
        if (q.id === dragInfo.questionId) {
            return {
                transform: `translateY(${dragInfo.currentDy}px)`,
                transition: 'none',
                position: 'relative',
                zIndex: 50,
                boxShadow: '0 20px 45px rgba(0, 0, 0, 0.3)',
                pointerEvents: 'none'
            }
        }
        const lastIdx = dragInfo.memberIds.length - 1
        let toSlot = dragInfo.insertionIndex
        if (toSlot > dragInfo.fromSlot) toSlot -= 1
        toSlot = Math.max(0, Math.min(toSlot, lastIdx))
        const order = dragInfo.memberIds.filter(id => id !== dragInfo.questionId)
        order.splice(toSlot, 0, dragInfo.questionId)
        const newSlot = order.indexOf(q.id)
        const dy = dragInfo.memberTops[newSlot] - dragInfo.memberTops[slot]
        return {
            transform: dy !== 0 ? `translateY(${dy}px)` : undefined,
            transition: 'transform 200ms ease'
        }
    }

    // Solid background while lifted so content underneath does not bleed through
    const getDragClassName = (q: QuizQuestion) =>
        dragInfo && q.id === dragInfo.questionId ? 'bg-white dark:bg-surface-dark rounded-xl' : ''

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
                                disabled={publishingCheck || (aiReviewEnabled && questions.some(q => q.status === 'draft' || q.status === 'ai_reviewing' || q.status === 'returned'))}
                                loading={publishingCheck}
                                title={aiReviewEnabled && questions.some(q => q.status === 'draft' || q.status === 'ai_reviewing' || q.status === 'returned') ? 'Tunggu proses AI selesai atau perbaiki soal yang dikembalikan sebelum publish' : ''}
                                className="bg-gradient-to-r from-green-500 to-emerald-600 text-white flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                data-tutorial="quiz-activate-btn"
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

            {/* Multi-Class Banner */}
            {siblingIds.length > 0 && !quiz.is_active && !quiz.pending_publish && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-700 rounded-xl animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                        <div className="w-5 h-5 text-blue-500 shrink-0"><User set="bold" primaryColor="currentColor" size={20} /></div>
                        <div>
                            <h4 className="font-bold text-blue-800 dark:text-blue-300 text-sm">
                                Kuis Multi-Kelas ({siblingIds.length + 1} kelas)
                            </h4>
                            <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-0.5">
                                Kuis ini juga akan dibuat untuk kelas lainnya. Soal yang Anda tambahkan di sini akan otomatis disalin ke kelas lainnya saat publish.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Sync Failure Banner — muncul bila penyalinan ke kelas lain gagal (bisa terjadi setelah primary terbit) */}
            {syncFailedCount > 0 && siblingIds.length > 0 && (
                <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-700 rounded-xl animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                            <h4 className="font-bold text-red-800 dark:text-red-300 text-sm">
                                Soal belum tersalin ke {syncFailedCount} kelas
                            </h4>
                            <p className="text-xs text-red-600/70 dark:text-red-400/70 mt-0.5">
                                Kuis utama sudah terbit. Tekan tombol di samping untuk menyalin ulang soal ke kelas lainnya.
                            </p>
                        </div>
                        <Button size="sm" onClick={handleRetrySync} loading={retryingSync}>
                            Salin Ulang Soal
                        </Button>
                    </div>
                </div>
            )}

            {/* Returned Questions Banner */}
            {questions.some(q => q.status === 'returned') && (
                <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center text-red-500 shrink-0">
                            <Danger set="bold" primaryColor="currentColor" size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-red-600 dark:text-red-400">Ada {questions.filter(q => q.status === 'returned').length} soal yang dikembalikan admin</h3>
                            <p className="text-sm text-red-500 dark:text-red-300">
                                Silakan perbaiki soal sesuai catatan admin agar kuis bisa dipublikasikan.
                            </p>
                        </div>
                    </div>
                    <Button
                        size="sm"
                        onClick={() => {
                            const firstReturned = questions.find(q => q.status === 'returned');
                            if (firstReturned?.id) {
                                const el = document.getElementById(`question-${firstReturned.id}`);
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }}
                        className="!bg-red-600 hover:!bg-red-700 text-white shadow-sm shrink-0 whitespace-nowrap"
                    >
                        Lihat Soal Dikembalikan
                    </Button>
                </div>
            )}

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
                <div className="relative inline-block" data-tutorial="quiz-add-section">
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
                            <div className="absolute left-0 top-full mt-2 z-50 w-64 bg-white rounded-xl shadow-xl border border-gray-200 py-2 animate-in fade-in slide-in-from-top-2 duration-200" data-tutorial="quiz-add-dropdown">
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
                                    data-tutorial="quiz-add-manual"
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
                                    data-tutorial="quiz-add-ai"
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
                                    data-tutorial="quiz-add-bank"
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
                <div className="space-y-4" data-tutorial="quiz-question-list" ref={listContainerRef}>
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

                    {/* AI Review Progress Banner */}
                    {aiReviewEnabled && questions.length > 0 && (() => {
                        const approved = questions.filter(q => q.status === 'approved').length
                        const reviewing = questions.filter(q => q.status === 'ai_reviewing' || q.status === 'draft').length
                        const needReview = questions.filter(q => q.status === 'admin_review').length
                        const returned = questions.filter(q => q.status === 'returned').length
                        const total = questions.length
                        const allApproved = approved === total
                        
                        if (allApproved) return null

                        const progress = Math.round((approved / total) * 100)

                        return (
                            <div className="mb-4 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700">
                                <div className="flex items-center gap-3 mb-3">
                                    {reviewing > 0 && (
                                        <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full flex-shrink-0" />
                                    )}
                                    <div className="flex-1">
                                        <h4 className="font-bold text-blue-800 dark:text-blue-300 text-sm">
                                            {reviewing > 0 ? `🤖 ${reviewing} soal baru sedang dianalisis AI...` : '📋 Status Review Soal'}
                                        </h4>
                                        <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-0.5">
                                            {reviewing > 0 
                                                ? `${approved} dari ${total} soal sudah approved. Mohon tunggu, status otomatis diperbarui.`
                                                : 'Semua soal harus di-approve sebelum bisa di-publish.'}
                                        </p>
                                    </div>
                                </div>
                                {/* Progress bar */}
                                <div className="w-full h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden mb-2">
                                    <div 
                                        className="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full transition-all duration-500"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                                <div className="flex flex-wrap gap-3 text-xs">
                                    <span className="text-green-600 dark:text-green-400 font-medium">✅ {approved} Approved</span>
                                    {reviewing > 0 && <span className="text-blue-600 dark:text-blue-400 font-medium animate-pulse">🤖 {reviewing} Sedang dianalisis</span>}
                                    {needReview > 0 && <span className="text-amber-600 dark:text-amber-400 font-medium">⏳ {needReview} Menunggu review admin</span>}
                                    {returned > 0 && <span className="text-red-600 dark:text-red-400 font-medium">↩️ {returned} Dikembalikan</span>}
                                </div>
                            </div>
                        )
                    })()}

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
                            <div key={q.id || idx} id={`question-${q.id}`} className={`${isInGroup ? 'p-4' : ''} ${highlightId === q.id ? 'ring-2 ring-red-500 rounded-xl animate-pulse-once transition-all duration-1000' : ''}`}>
                                <div className="flex items-start gap-4">
                                    {!dragDisabled && q.id && (
                                        <button
                                            type="button"
                                            aria-label="Geser untuk mengubah urutan soal"
                                            title="Tahan & geser untuk mengubah urutan"
                                            onPointerDown={(e) => handleDragStart(e, q)}
                                            onPointerMove={handleDragMove}
                                            onPointerUp={handleDragEnd}
                                            onPointerCancel={handleDragCancel}
                                            className="mt-1 -ml-2 p-1 text-text-secondary/50 hover:text-text-secondary dark:text-zinc-500 dark:hover:text-zinc-300 cursor-grab active:cursor-grabbing touch-none select-none shrink-0"
                                            style={{ touchAction: 'none' }}
                                        >
                                            <GripVertical className="w-4 h-4" />
                                        </button>
                                    )}
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
                                            <span className={`px-2 py-0.5 text-xs rounded-full bg-secondary/10 text-text-main dark:text-zinc-300`}>
                                                {q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 
                                                 q.question_type === 'MULTIPLE_ANSWER' ? 'Ganda Kompleks' : 
                                                 q.question_type === 'TRUE_FALSE' ? 'Benar Salah' : 
                                                 q.question_type === 'SHORT_ANSWER' ? 'Isian Singkat' : 'Essay'}
                                            </span>
                                            {!isInGroup && q.passage_text && (
                                                <span className="px-2 py-0.5 text-xs rounded-full bg-teal-500/20 text-teal-400 flex items-center gap-1">
                                                    <Document set="bold" primaryColor="currentColor" size={10} /> Passage
                                                </span>
                                            )}
                                            {q.status === 'approved' && <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 flex items-center gap-1"><TickSquare set="bold" primaryColor="currentColor" size={10} /> Approved</span>}
                                            {aiReviewEnabled && q.status === 'admin_review' && <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 flex items-center gap-1"><InfoCircle set="bold" primaryColor="currentColor" size={10} /> Menunggu Review</span>}
                                            {q.status === 'returned' && <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 flex items-center gap-1"><CloseSquare set="bold" primaryColor="currentColor" size={10} /> Dikembalikan</span>}
                                            {aiReviewEnabled && q.status === 'ai_reviewing' && <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 animate-pulse flex items-center gap-1"><Discovery set="bold" primaryColor="currentColor" size={10} /> AI Analyzing...</span>}
                                            {aiReviewEnabled && q.status === 'draft' && <span className="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 animate-pulse flex items-center gap-1"><Discovery set="bold" primaryColor="currentColor" size={10} /> Menunggu AI...</span>}
                                        </div>

                                        {q.status === 'returned' && q.admin_review && (
                                            <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
                                                <p className="text-xs font-bold text-red-600 dark:text-red-400 mb-1">📋 Catatan Admin:</p>
                                                <p className="text-sm text-red-700 dark:text-red-300">
                                                    {q.admin_review.notes || 'Silakan periksa dan perbaiki soal Anda.'}
                                                </p>
                                                {q.admin_review.return_reasons && q.admin_review.return_reasons.length > 0 && (
                                                    <ul className="mt-1 text-xs text-red-600 dark:text-red-400 list-disc list-inside">
                                                        {q.admin_review.return_reasons.map((r: string, i: number) => (
                                                            <li key={i}>{r}</li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        )}

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

                                        {['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE'].includes(q.question_type) && q.options && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm" dir={q.text_direction || 'ltr'}>
                                                {q.options.map((opt, optIdx) => (
                                                    <div key={optIdx} className={`px-3 py-2 rounded-lg border ${isCorrectOption(q.question_type, q.correct_answer, optIdx) ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-500/30' : 'bg-secondary/5 text-text-main dark:text-zinc-300 border-secondary/20'}`}>
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
                                                setEditForm({
                                                    ...q,
                                                    question_text: q.content_format === 'html' ? q.question_text : plainToHtml(q.question_text)
                                                })
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

                        // Small round dashed "+" under each question card — opens the manual form
                        // with a preset taken from the question right above it.
                        // Terkunci saat kuis aktif / menunggu review — mengikuti kunci UI tambah-soal lainnya
                        const renderQuickAddButton = (q: typeof questions[0]) => {
                            if (quiz?.is_active || quiz?.pending_publish) return null
                            return (
                                <div className="flex justify-center py-1">
                                    <button
                                        type="button"
                                        aria-label="Tambah soal di sini"
                                        title="Tambah soal di sini"
                                        onClick={() => handleQuickAdd(q)}
                                        className="w-7 h-7 rounded-full border-2 border-dashed border-secondary/40 dark:border-zinc-600 text-text-secondary dark:text-zinc-500 hover:border-primary hover:text-primary dark:hover:border-primary dark:hover:text-primary hover:scale-125 transition-all flex items-center justify-center cursor-pointer bg-white dark:bg-surface-dark"
                                    >
                                        <Plus set="bold" primaryColor="currentColor" size={14} />
                                    </button>
                                </div>
                            )
                        }

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
                                        {/* Individual questions — reorderable only within this audio group */}
                                        <div className="divide-y divide-violet-100 dark:divide-violet-800">
                                            {item.items.map(({ question, originalIndex }) => (
                                                <div
                                                    key={question.id || originalIndex}
                                                    ref={setCardRef(question.id)}
                                                    style={getDragStyle(question)}
                                                    className={getDragClassName(question)}
                                                >
                                                    {renderQuestionCard(question, originalIndex, true)}
                                                    {renderQuickAddButton(question)}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )
                            } else {
                                return (
                                    <div key={item.question.id || item.originalIndex}>
                                        <div
                                            ref={setCardRef(item.question.id)}
                                            style={getDragStyle(item.question)}
                                            className={getDragClassName(item.question)}
                                        >
                                            <Card className={`p-4 ${selectedQuestionIds.has(item.question.id || '') ? 'ring-2 ring-primary' : ''}`}>
                                                {renderQuestionCard(item.question, item.originalIndex, false)}
                                            </Card>
                                        </div>
                                        {renderQuickAddButton(item.question)}
                                    </div>
                                )
                            }
                        })
                    })()}
                </div>
            )}

            {/* Edit Question Modal */}
            {editingQuestionId && editForm && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6">
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
                                            const type = e.target.value
                                            const prevType = editForm.question_type
                                            if (type === 'ESSAY' || type === 'SHORT_ANSWER') {
                                                setEditForm({ ...editForm, question_type: type, options: null, correct_answer: type === 'SHORT_ANSWER' ? '' : null })
                                            } else if (type === 'TRUE_FALSE') {
                                                setEditForm({ ...editForm, question_type: type, options: ['Benar', 'Salah'], correct_answer: '' })
                                            } else {
                                                const keepOpts = ['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(prevType) && editForm.options && editForm.options.length >= 3
                                                setEditForm({ ...editForm, question_type: type, options: keepOpts ? editForm.options : ['', '', '', ''], correct_answer: '' })
                                            }
                                        }}
                                        className="w-full px-4 py-2 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                    >
                                        <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                                        <option value="MULTIPLE_ANSWER">Ganda Kompleks</option>
                                        <option value="TRUE_FALSE">Benar Salah</option>
                                        <option value="SHORT_ANSWER">Isian Singkat</option>
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
                                <RichTextEditor
                                    value={editForm.question_text}
                                    onChange={(val: string) => setEditForm({ ...editForm, question_text: val })}
                                    placeholder="Masukkan teks soal..."
                                    textDirection={editForm.text_direction || 'ltr'}
                                />
                            </div>

                            {/* Passage Text / Audio (if exists) */}
                            {(editForm.passage_text || (editForm as any).passage_audio_url) && (
                                <div className="p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg space-y-2">
                                    {(editForm as any).passage_audio_url && (
                                        <>
                                            <p className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-1">🎧 Audio:</p>
                                            <audio controls controlsList="nodownload" className="w-full mb-2" src={(editForm as any).passage_audio_url} />
                                        </>
                                    )}
                                    {editForm.passage_text !== undefined && (
                                        <>
                                            <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-1">📖 Bacaan:</p>
                                            <textarea
                                                value={editForm.passage_text || ''}
                                                onChange={(e) => setEditForm({ ...editForm, passage_text: e.target.value || null })}
                                                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-teal-300 dark:border-teal-700 rounded-lg text-sm text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-h-[80px]"
                                                placeholder="Edit teks bacaan..."
                                                rows={4}
                                            />
                                        </>
                                    )}
                                </div>
                            )}

                            <QuestionOptionsEditor
                                        questionType={editForm.question_type}
                                        options={editForm.options}
                                        correctAnswer={editForm.correct_answer}
                                        onChange={(opts, correct) => setEditForm({ ...editForm, options: opts, correct_answer: correct })}
                                        textDirection={editForm.text_direction}
                                    />

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
                                disabled={saving || !editForm.question_text || !validateCorrectAnswer(editForm.question_type, editForm.correct_answer, editForm.options).valid}
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
                        <div data-tutorial="quiz-manual-type">
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe Soal</label>
                            <div className="flex gap-2 items-center">
                                <select
                                    value={isPassageMode ? '__passage__' : manualForm.question_type}
                                    onChange={(e) => {
                                        const val = e.target.value
                                        if (val === '__passage__') {
                                            setIsPassageMode(true)
                                        } else {
                                            setIsPassageMode(false)
                                            const prevType = manualForm.question_type
                                            const needsOptions = ['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(val)
                                            const keepOpts = needsOptions && ['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(prevType) && manualForm.options && manualForm.options.length >= 3
                                            setManualForm({
                                                ...manualForm,
                                                question_type: val,
                                                options: needsOptions ? (keepOpts ? manualForm.options : ['', '', '', '']) : val === 'TRUE_FALSE' ? ['Benar', 'Salah'] : null,
                                                correct_answer: val === 'ESSAY' ? null : ''
                                            })
                                        }
                                    }}
                                    className="flex-1 px-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                                >
                                    <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                                    <option value="MULTIPLE_ANSWER">Ganda Kompleks</option>
                                    <option value="TRUE_FALSE">Benar Salah</option>
                                    <option value="SHORT_ANSWER">Isian Singkat</option>
                                    <option value="ESSAY">Essay</option>
                                    <option value="__passage__">📖 Passage</option>
                                </select>
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
                                            <audio controls controlsList="nodownload" className="w-full" src={passageAudioUrl} />
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
                                                                    const newType = e.target.value
                                                                    const prevType = pq.question_type
                                                                    const updated = [...passageQuestions]
                                                                    const needsOptions = ['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(newType)
                                                                    const keepOpts = needsOptions && ['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(prevType) && updated[pqIdx].options && updated[pqIdx].options!.length >= 3
                                                                    updated[pqIdx] = {
                                                                        ...updated[pqIdx],
                                                                        question_type: newType,
                                                                        options: needsOptions ? (keepOpts ? updated[pqIdx].options : ['', '', '', '']) : newType === 'TRUE_FALSE' ? ['Benar', 'Salah'] : null,
                                                                        correct_answer: ''
                                                                    }
                                                                    setPassageQuestions(updated)
                                                                }}
                                                                className="text-xs px-2 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-secondary/30 text-text-main dark:text-white"
                                                            >
                                                            <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                                                            <option value="MULTIPLE_ANSWER">Ganda Kompleks</option>
                                                            <option value="TRUE_FALSE">Benar Salah</option>
                                                            <option value="SHORT_ANSWER">Isian Singkat</option>
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
                                                <RichTextEditor
                                                    value={pq.question_text}
                                                    onChange={(val) => {
                                                        const updated = [...passageQuestions]
                                                        updated[pqIdx] = { ...updated[pqIdx], question_text: val }
                                                        setPassageQuestions(updated)
                                                    }}
                                                    placeholder="Tulis pertanyaan..."
                                                    textDirection={pq.text_direction || 'ltr'}
                                                />
                                                <div className="mt-3">
                                                    <QuestionOptionsEditor
                                                        questionType={pq.question_type}
                                                        options={pq.options}
                                                        correctAnswer={pq.correct_answer}
                                                        onChange={(newOptions, newCorrectAnswer) => {
                                                            const updated = [...passageQuestions]
                                                            updated[pqIdx] = { ...updated[pqIdx], options: newOptions, correct_answer: newCorrectAnswer }
                                                            setPassageQuestions(updated)
                                                        }}
                                                        textDirection={pq.text_direction || 'ltr'}
                                                    />
                                                </div>

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
                                        onClick={() => handleAddManualQuestion()}
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
                                <div data-tutorial="quiz-manual-question">
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-sm font-bold text-text-main dark:text-white">Pertanyaan</label>
                                        <div className="flex gap-1">
                                            <button type="button" onClick={() => setManualForm({ ...manualForm, text_direction: 'ltr' })} className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors ${manualForm.text_direction !== 'rtl' ? 'bg-primary text-white' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>LTR</button>
                                            <button type="button" onClick={() => setManualForm({ ...manualForm, text_direction: 'rtl' })} className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors ${manualForm.text_direction === 'rtl' ? 'bg-primary text-white' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>Arab (RTL)</button>
                                        </div>
                                    </div>
                                    <RichTextEditor
                                        value={manualForm.question_text}
                                        onChange={(val) => setManualForm({ ...manualForm, question_text: val })}
                                        placeholder="Tulis pertanyaan..."
                                        textDirection={manualForm.text_direction || 'ltr'}
                                    />
                                </div>

                                <div data-tutorial="quiz-manual-options">
                                <QuestionOptionsEditor
                                    questionType={manualForm.question_type}
                                    options={manualForm.options}
                                    correctAnswer={manualForm.correct_answer}
                                    onChange={(newOptions, newCorrectAnswer) => setManualForm({ ...manualForm, options: newOptions, correct_answer: newCorrectAnswer })}
                                    textDirection={manualForm.text_direction || 'ltr'}
                                />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-tutorial="quiz-manual-difficulty">
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

                                <div className="flex gap-3 pt-4" data-tutorial="quiz-manual-submit">
                                    <Button variant="secondary" onClick={() => setMode('list')} className="flex-1">
                                        Batal
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => handleAddManualQuestion(true)}
                                        disabled={saving || !manualForm.question_text || !manualForm.difficulty || (['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE', 'SHORT_ANSWER'].includes(manualForm.question_type) && !manualForm.correct_answer)}
                                        loading={saving}
                                        className="flex-1 !border-primary/40 text-primary"
                                        title="Simpan soal ini, lalu lanjut menambah soal baru dengan tipe & pengaturan yang sama"
                                    >
                                        {saving ? 'Menyimpan...' : 'Simpan & Tambah Lagi'}
                                    </Button>
                                    <Button
                                        onClick={() => handleAddManualQuestion(false)}
                                        disabled={saving || !manualForm.question_text || !manualForm.difficulty || (['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE', 'SHORT_ANSWER'].includes(manualForm.question_type) && !manualForm.correct_answer)}
                                        loading={saving}
                                        className="flex-1"
                                    >
                                        {saving ? 'Menyimpan...' : 'Simpan & Kembali'}
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
                                                            <span className={`px-2 py-0.5 text-xs rounded ${q.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' : q.question_type === 'MULTIPLE_ANSWER' ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400' : q.question_type === 'TRUE_FALSE' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' : q.question_type === 'SHORT_ANSWER' ? 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-400' : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'}`}>
                                                                {q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : q.question_type === 'MULTIPLE_ANSWER' ? 'Ganda Kompleks' : q.question_type === 'TRUE_FALSE' ? 'Benar Salah' : q.question_type === 'SHORT_ANSWER' ? 'Isian Singkat' : 'Essay'}
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
                open={!!showSuccessModal}
                onClose={() => setShowSuccessModal(false)}
            >
                <div className="text-center py-6">
                    {showSuccessModal === 'published' ? (
                        <>
                            <div className="w-16 h-16 bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto mb-4">
                                <TickSquare set="bold" primaryColor="currentColor" size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Kuis Berhasil Dipublish!</h3>
                            <p className="text-sm text-text-secondary dark:text-zinc-400 mb-6">
                                Siswa sekarang dapat melihat dan mengerjakan kuis ini melalui dashboard mereka.
                            </p>
                        </>
                    ) : (
                        <>
                            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto mb-4">
                                <TickSquare set="bold" primaryColor="currentColor" size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Kuis Dikirim ke Review Admin</h3>
                            <p className="text-sm text-text-secondary dark:text-zinc-400 mb-6">
                                Ada soal yang memerlukan persetujuan admin. Kuis akan otomatis dipublikasikan ke siswa setelah admin menyetujui semua soal.
                            </p>
                        </>
                    )}
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

            {/* Toast notification (e.g. "Urutan disimpan" after drag & drop reorder) */}
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
        </div >
    )
}

export default function EditQuizPage() {
    return (
        <EditorErrorBoundary>
            <EditQuizPageInner />
        </EditorErrorBoundary>
    )
}
