'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
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
import { Loader2, Eye, Brain, BarChart3, FileText, Download, RotateCcw, ChevronDown as ChevronDownIcon } from 'lucide-react'
import * as XLSX from 'xlsx'
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
    passage_audio_url?: string | null
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD'
    status?: string
    teacher_hots_claim?: boolean
    text_direction?: 'ltr' | 'rtl'
    admin_review?: any
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
    show_results_immediately: boolean
    results_released: boolean
    max_violations: number
    teaching_assignment: {
        subject: { id: string; name: string }
        class: { name: string }
    }
}

type Mode = 'list' | 'manual' | 'clean' | 'ai' | 'bank'
type TabType = 'soal' | 'hasil'

export default function EditExamPage() {
    const params = useParams()
    const searchParams = useSearchParams()
    const examId = params.id as string
    const highlightId = searchParams.get('highlight')

    const [exam, setExam] = useState<Exam | null>(null)
    const [questions, setQuestions] = useState<ExamQuestion[]>([])

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

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [mode, setMode] = useState<Mode>('list')
    const [activeTab, setActiveTab] = useState<TabType>(searchParams.get('tab') === 'hasil' ? 'hasil' : 'soal')
    const [showAddDropdown, setShowAddDropdown] = useState(false)

    // Manual mode state
    const [manualForm, setManualForm] = useState<ExamQuestion>({
        question_text: '',
        question_type: 'MULTIPLE_CHOICE',
        options: ['', '', '', ''],
        correct_answer: '',
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
    const [passageQuestions, setPassageQuestions] = useState<ExamQuestion[]>([{
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
    const [editQuestionForm, setEditQuestionForm] = useState<ExamQuestion | null>(null)

    // Bulk selection state for delete
    const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set())
    const [isBulkSelectMode, setIsBulkSelectMode] = useState(false)

    const [showPublishConfirm, setShowPublishConfirm] = useState(false)
    const [showPreview, setShowPreview] = useState(false)
    const [publishing, setPublishing] = useState(false)
    const [showSuccessModal, setShowSuccessModal] = useState<false | 'published' | 'pending'>(false)
    const [alertInfo, setAlertInfo] = useState<{ type: 'info' | 'warning' | 'error' | 'success', title: string, message: string } | null>(null)
    const [aiReviewEnabled, setAiReviewEnabled] = useState(true)

    // Results state
    const [submissions, setSubmissions] = useState<any[]>([])
    const [resultsLoading, setResultsLoading] = useState(false)
    const [selectedSubmission, setSelectedSubmission] = useState<any>(null)
    const [resettingId, setResettingId] = useState<string | null>(null)
    const [resetMenuId, setResetMenuId] = useState<string | null>(null)

    // Edit settings state
    const [showEditSettings, setShowEditSettings] = useState(false)
    const [editForm, setEditForm] = useState({
        title: '',
        description: '',
        start_time: '',
        duration_minutes: 60,
        max_violations: 3,
        is_randomized: true,
        show_results_immediately: true
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

    // Auto-poll when questions are being AI-reviewed
    useEffect(() => {
        if (!aiReviewEnabled) return
        const hasPending = questions.some(q => q.status === 'ai_reviewing' || q.status === 'draft')
        if (!hasPending) return
        const interval = setInterval(() => {
            fetchExam()
        }, 5000)
        return () => clearInterval(interval)
    }, [aiReviewEnabled, questions, fetchExam])

    useEffect(() => {
        fetch('/api/school-settings').then(r => r.ok ? r.json() : null).then(d => {
            if (d) setAiReviewEnabled(d.ai_review_enabled !== false)
        }).catch(() => { })
    }, [])

    const fetchResults = useCallback(async () => {
        setResultsLoading(true)
        try {
            const res = await fetch(`/api/exam-submissions?exam_id=${examId}`)
            if (res.ok) {
                const data = await res.json()
                setSubmissions(Array.isArray(data) ? data : [])
            }
        } catch (error) {
            console.error('Error fetching results:', error)
        } finally {
            setResultsLoading(false)
        }
    }, [examId])

    // Helper function for reset
    const handleResetAttempt = async (submissionId: string, studentName: string, mode: 'soft' | 'hard') => {
        const isHard = mode === 'hard'
        if (!confirm(isHard
            ? `PERINGATAN HARD RESET!\n\nApakah Anda yakin ingin melakukan HARD RESET untuk ulangan milik ${studentName}?\n\nSELURUH JAWABAN SAAT INI AKAN DIHAPUS dan siswa akan mengulang dari awal dengan durasi penuh.`
            : `Konfirmasi Soft Reset\n\nApakah Anda yakin ingin membuka akses kembali (Soft Reset) untuk ulangan milik ${studentName}?\n\nJawaban sebelumnya tidak akan dihapus, dan timer akan melanjutkan sisa waktu sebelumnya.`
        )) return
        
        setResettingId(submissionId)
        setResetMenuId(null)
        try {
            const res = await fetch('/api/exam-submissions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submission_id: submissionId,
                    reset_attempt: mode
                })
            })
            const data = await res.json()
            if (data.error) throw new Error(data.error)
            
            alert(data.message || (isHard ? 'Hard reset berhasil diproses.' : 'Soft reset berhasil diproses.'))
            fetchResults()
        } catch (error: any) {
            alert('Gagal memproses reset: ' + error.message)
        } finally {
            setResettingId(null)
        }
    }

    // Click outside listener for reset menu
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement
            if (!target.closest('[data-reset-menu]')) {
                setResetMenuId(null)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    useEffect(() => {
        if (activeTab === 'hasil') {
            fetchResults()
            if (exam?.is_active) {
                const interval = setInterval(fetchResults, 10000)
                return () => clearInterval(interval)
            }
        }
    }, [activeTab, exam?.is_active, fetchResults])

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
            // Fresh-fetch latest question statuses before attempting publish
            await fetchExam()

            const res = await fetch(`/api/exams/${examId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: true })
            })
            if (res.ok) {
                const resData = await res.json()
                setShowPublishConfirm(false)
                setShowSuccessModal(resData?.pending_publish ? 'pending' : 'published')
                fetchExam()
            } else {
                let errData
                try {
                    errData = await res.json()
                } catch {
                    // ignore
                }
                // Re-fetch to sync UI with actual DB state
                await fetchExam()
                throw new Error(errData?.error || 'Gagal mempublish ulangan')
            }
        } catch (error: any) {
            console.error('Error publishing:', error)
            setAlertInfo({ type: 'error', title: 'Gagal Publish', message: error.message || 'Terjadi kesalahan saat mempublish ulangan. Coba lagi.' })
            setShowPublishConfirm(false)
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
                is_randomized: exam.is_randomized,
                show_results_immediately: exam.show_results_immediately ?? true
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
            // Convert local datetime-local string to UTC for backend
            let formattedStartTime = null;
            if (editForm.start_time) {
                const localDate = new Date(editForm.start_time);
                formattedStartTime = localDate.toISOString();
            }

            const res = await fetch(`/api/exams/${examId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: editForm.title,
                    description: editForm.description,
                    start_time: formattedStartTime,
                    duration_minutes: editForm.duration_minutes,
                    max_violations: editForm.max_violations,
                    is_randomized: editForm.is_randomized,
                    show_results_immediately: editForm.show_results_immediately
                })
            })
            if (res.ok) {
                setShowEditSettings(false)
                fetchExam()
            } else {
                setAlertInfo({ type: 'error', title: 'Gagal', message: 'Gagal menyimpan pengaturan.' })
            }
        } catch (error) {
            console.error(error)
            setAlertInfo({ type: 'error', title: 'Gagal', message: 'Terjadi kesalahan sistem.' })
        } finally {
            setSavingSettings(false)
        }
    }

    const handleShareResults = async () => {
        if (!confirm('Apakah Anda yakin ingin membagikan hasil ke siswa sekarang? Siswa akan bisa melihat nilai mereka.')) return
        
        try {
            const res = await fetch(`/api/exams/${examId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ results_released: true })
            })
            if (res.ok) {
                setAlertInfo({ type: 'success', title: 'Berhasil', message: 'Hasil ulangan telah dibagikan ke siswa.' })
                fetchExam() // Refresh to update button visibility
            } else {
                throw new Error('Gagal membagikan hasil')
            }
        } catch (error: any) {
            setAlertInfo({ type: 'error', title: 'Gagal', message: error.message })
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
                await fetch(`/api/exams/${examId}/questions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ questions: questionsToSave })
                })
                setPassageText('')
                setPassageAudioUrl('')
                setPassageQuestions([{ question_text: '', question_type: 'MULTIPLE_CHOICE', options: ['', '', '', ''], correct_answer: '', points: 10, order_index: 0, text_direction: 'ltr' }])
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
                teacher_hots_claim: false,
                text_direction: 'ltr'
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
                    question_type: editQuestionForm.question_type,
                    options: editQuestionForm.options,
                    correct_answer: editQuestionForm.correct_answer,
                    difficulty: editQuestionForm.difficulty,
                    points: editQuestionForm.points,
                    image_url: editQuestionForm.image_url,
                    teacher_hots_claim: editQuestionForm.teacher_hots_claim || false,
                    text_direction: editQuestionForm.text_direction || 'ltr',
                    passage_text: editQuestionForm.passage_text || null,
                    passage_audio_url: (editQuestionForm as any).passage_audio_url || null
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

    const formatDateTime = (dateString: string) => {
        return new Date(dateString).toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        })
    }

    // Helper functions for Results
    const getScoreColor = (score: number, max: number) => {
        const percentage = max > 0 ? (score / max) * 100 : 0
        if (percentage >= 80) return 'text-green-600 dark:text-green-400'
        if (percentage >= 60) return 'text-amber-600 dark:text-amber-400'
        return 'text-red-600 dark:text-red-400'
    }

    const formatDuration = (start: string, end: string | null) => {
        if (!end) return '-'
        const diff = new Date(end).getTime() - new Date(start).getTime()
        const mins = Math.floor(diff / 60000)
        const secs = Math.floor((diff % 60000) / 1000)
        return `${mins}m ${secs}s`
    }

    const calculateStats = () => {
        const submitted = submissions.filter(s => s.is_submitted)
        if (submitted.length === 0) return { avg: 0, highest: 0, lowest: 0, count: 0 }

        const scores = submitted.map(s => (s.max_score > 0 ? (s.total_score / s.max_score) * 100 : 0))
        return {
            avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
            highest: Math.round(Math.max(...scores)),
            lowest: Math.round(Math.min(...scores)),
            count: submitted.length
        }
    }

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
                'Skor': sub.total_score || 0,
                'Max Skor': sub.max_score || 0,
                'Persentase': `${percentage}%`,
                'Durasi': sub.submitted_at ? formatDuration(sub.started_at, sub.submitted_at) : '-',
                'Pelanggaran': sub.violation_count || 0,
                'Status': status,
                'Waktu Submit': sub.submitted_at ? new Date(sub.submitted_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'
            }
        })

        const ws = XLSX.utils.json_to_sheet(formattedData)
        
        const colWidths = [
            { wch: 5 },  // No
            { wch: 30 }, // Nama
            { wch: 15 }, // NIS
            { wch: 10 }, // Skor
            { wch: 10 }, // Max
            { wch: 15 }, // Persentase
            { wch: 15 }, // Durasi
            { wch: 15 }, // Pelanggaran
            { wch: 15 }, // Status
            { wch: 20 }, // Waktu
        ]
        ws['!cols'] = colWidths

        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, "Hasil_Ulangan")

        const fileName = `Hasil_Ulangan_${exam.title.replace(/ /g, '_')}.xlsx`
        
        XLSX.writeFile(wb, fileName)
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
                        {!exam.is_active && !exam.pending_publish && (
                            <Button
                                onClick={handlePublishClick}
                                disabled={questions.length === 0 || (aiReviewEnabled && questions.some(q => q.status === 'draft' || q.status === 'ai_reviewing' || q.status === 'returned'))}
                                title={aiReviewEnabled && questions.some(q => q.status === 'draft' || q.status === 'ai_reviewing' || q.status === 'returned') ? 'Tunggu proses AI selesai atau perbaiki soal yang dikembalikan sebelum publish' : ''}
                                className="disabled:opacity-50 disabled:cursor-not-allowed"
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

            {/* Tabs */}
            <div className="flex gap-1 bg-secondary/5 p-1 rounded-xl border border-secondary/10 mt-4 mb-6">
                {([{ key: 'soal' as TabType, label: 'Soal', icon: FileText }, { key: 'hasil' as TabType, label: 'Hasil', icon: BarChart3 }]).map(tab => (
                    <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold transition-all ${activeTab === tab.key ? 'bg-white dark:bg-surface-dark text-primary shadow-sm' : 'text-text-secondary hover:text-text-main'}`}>
                        <tab.icon className="w-5 h-5" /> {tab.label}
                    </button>
                ))}
            </div>

            {/* ===== TAB: SOAL ===== */}
            {activeTab === 'soal' && (
                <div className="space-y-4">
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
                                        Silakan perbaiki soal sesuai catatan admin agar ulangan bisa dipublikasikan.
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
                            <div key={q.id || idx} id={`question-${q.id}`} className={`${isInGroup ? 'p-5' : ''} ${highlightId === q.id ? 'ring-2 ring-red-500 rounded-xl animate-pulse-once transition-all duration-1000' : ''}`}>
                                <div className="flex items-start gap-5">
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
                                    <div className={`w-10 h-10 rounded-xl ${isInGroup ? 'bg-violet-500/10 text-violet-500' : 'bg-primary/10 text-primary'} flex items-center justify-center font-bold text-lg flex-shrink-0`}>
                                        {idx + 1}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-3">
                                            <span className={`px-2.5 py-1 text-xs font-bold rounded-full border ${q.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-500/20 dark:text-blue-400' : 'bg-orange-500/10 text-orange-600 border-orange-200 dark:border-orange-500/20 dark:text-orange-400'}`}>
                                                {q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 'Essay'}
                                            </span>
                                            {!isInGroup && q.passage_text && (
                                                <span className="px-2 py-0.5 text-xs rounded-full bg-teal-500/20 text-teal-600 dark:text-teal-400">
                                                    📖 Passage
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
                                            <SmartText text={q.question_text} className={`prose dark:prose-invert max-w-none text-text-main dark:text-white mb-4 ${q.text_direction === 'rtl' ? 'text-right' : ''}`} />
                                        </div>
                                        {q.image_url && (
                                            <div className="mb-4">
                                                <img src={q.image_url} alt="Gambar soal" className="max-h-60 rounded-xl border border-secondary/20" />
                                            </div>
                                        )}
                                        {q.question_type === 'MULTIPLE_CHOICE' && q.options && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm" dir={q.text_direction || 'ltr'}>
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
                            </div>
                        )

                        return displayItems.map((item, itemIdx) => {
                            if (item.type === 'audio_group') {
                                return (
                                    <div key={`audio-group-${itemIdx}`} className="border-2 border-violet-300 dark:border-violet-700 rounded-2xl overflow-hidden bg-surface-light dark:bg-surface-dark">
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
                                        <div className="divide-y divide-violet-100 dark:divide-violet-800">
                                            {item.items.map(({ question, originalIndex }) =>
                                                renderQuestionCard(question, originalIndex, true)
                                            )}
                                        </div>
                                    </div>
                                )
                            } else {
                                return (
                                    <Card key={item.question.id || item.originalIndex} className={`p-5 ${selectedQuestionIds.has(item.question.id || '') ? 'ring-2 ring-primary' : ''}`}>
                                        {renderQuestionCard(item.question, item.originalIndex, false)}
                                    </Card>
                                )
                            }
                        })
                    })()}
                </div>
            )
            }

            {/* Edit Question Modal */}
            {
                editingQuestionId && editQuestionForm && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6">
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
                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe Soal</label>
                                        <select 
                                            value={editQuestionForm.question_type} 
                                            onChange={(e) => {
                                                const type = e.target.value as 'MULTIPLE_CHOICE' | 'ESSAY'
                                                if (type === 'ESSAY') {
                                                    if (confirm('Beralih ke Essay akan menghapus opsi dan kunci jawaban yang ada saat ini. Lanjutkan?')) {
                                                        setEditQuestionForm({ ...editQuestionForm, question_type: type, options: null, correct_answer: null })
                                                    }
                                                } else {
                                                    setEditQuestionForm({ ...editQuestionForm, question_type: type, options: editQuestionForm.options || ['', '', '', ''], correct_answer: '' })
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
                                                onClick={() => setEditQuestionForm({ ...editQuestionForm, text_direction: 'ltr' })}
                                                className={`flex-1 py-1.5 rounded-xl text-sm font-bold transition-all border ${editQuestionForm.text_direction !== 'rtl' ? 'bg-primary text-white border-primary' : 'bg-secondary/5 text-text-main dark:text-white border-secondary/20'}`}
                                            >
                                                Kiri ke Kanan
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setEditQuestionForm({ ...editQuestionForm, text_direction: 'rtl' })}
                                                className={`flex-1 py-1.5 rounded-xl text-sm font-bold transition-all border ${editQuestionForm.text_direction === 'rtl' ? 'bg-primary text-white border-primary' : 'bg-secondary/5 text-text-main dark:text-white border-secondary/20'}`}
                                            >
                                                Arab (RTL)
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Question Text */}
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Teks Soal</label>
                                    <div dir={editQuestionForm.text_direction || 'ltr'}>
                                        <MathTextarea
                                            value={editQuestionForm.question_text}
                                            onChange={(val: string) => setEditQuestionForm({ ...editQuestionForm, question_text: val })}
                                            placeholder="Masukkan teks soal..."
                                            rows={4}
                                        />
                                    </div>
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

                                {/* Passage Text / Audio (if exists) */}
                                {(editQuestionForm.passage_text || (editQuestionForm as any).passage_audio_url) && (
                                    <div className="p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg space-y-2">
                                        {(editQuestionForm as any).passage_audio_url && (
                                            <>
                                                <p className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-1">🎧 Audio:</p>
                                                <audio controls controlsList="nodownload" className="w-full mb-2" src={(editQuestionForm as any).passage_audio_url} />
                                            </>
                                        )}
                                        {editQuestionForm.passage_text !== undefined && (
                                            <>
                                                <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-1">📖 Bacaan:</p>
                                                <textarea
                                                    value={editQuestionForm.passage_text || ''}
                                                    onChange={(e) => setEditQuestionForm({ ...editQuestionForm, passage_text: e.target.value || null })}
                                                    className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-teal-300 dark:border-teal-700 rounded-lg text-sm text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-h-[80px]"
                                                    placeholder="Edit teks bacaan..."
                                                    rows={4}
                                                />
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* Options for Multiple Choice */}
                                {editQuestionForm.question_type === 'MULTIPLE_CHOICE' && editQuestionForm.options && (
                                    <div>
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pilihan Jawaban</label>
                                        <div className="space-y-2">
                                            {editQuestionForm.options.map((opt, optIdx) => (
                                                <div key={optIdx} className="space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${editQuestionForm.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300'}`}>
                                                            {String.fromCharCode(65 + optIdx)}
                                                        </span>
                                                        <div className="flex-1">
                                                            <MathTextarea
                                                                value={opt}
                                                                onChange={(val: string) => {
                                                                    const newOptions = [...editQuestionForm.options!]
                                                                    newOptions[optIdx] = val
                                                                    setEditQuestionForm({ ...editQuestionForm, options: newOptions })
                                                                }}
                                                                placeholder={`Pilihan ${String.fromCharCode(65 + optIdx)}`}
                                                                rows={1}
                                                            />
                                                        </div>
                                                        <button
                                                            onClick={() => setEditQuestionForm({ ...editQuestionForm, correct_answer: String.fromCharCode(65 + optIdx) })}
                                                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${editQuestionForm.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300 hover:bg-green-500/20'}`}
                                                        >
                                                            {editQuestionForm.correct_answer === String.fromCharCode(65 + optIdx) ? '✓ Benar' : 'Set Benar'}
                                                        </button>
                                                        {editQuestionForm.options!.length > 2 && (
                                                            <button
                                                                onClick={() => {
                                                                    const newOptions = [...editQuestionForm.options!]
                                                                    newOptions.splice(optIdx, 1)
                                                                    let newCorrectAnswer = editQuestionForm.correct_answer
                                                                    if (newCorrectAnswer) {
                                                                        const charCode = newCorrectAnswer.charCodeAt(0) - 65
                                                                        if (charCode === optIdx) newCorrectAnswer = ''
                                                                        else if (charCode > optIdx) newCorrectAnswer = String.fromCharCode(charCode + 65 - 1)
                                                                    }
                                                                    setEditQuestionForm({ ...editQuestionForm, options: newOptions, correct_answer: newCorrectAnswer })
                                                                }}
                                                                className="px-3 py-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0"
                                                            >
                                                                ✕
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                            {editQuestionForm.options.length < 6 && (
                                                <button
                                                    onClick={() => setEditQuestionForm({ ...editQuestionForm, options: [...editQuestionForm.options!, ''] })}
                                                    className="mt-2 text-sm text-primary font-bold hover:underline flex items-center gap-1"
                                                >
                                                    <Plus set="bold" primaryColor="currentColor" size={16} /> Tambah Opsi
                                                </button>
                                            )}
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
                                            className={`w-full px-4 py-3 bg-secondary/5 border border-secondary/30 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none ${editQuestionForm.text_direction === 'rtl' ? 'text-right' : ''}`}
                                            rows={3}
                                            dir={editQuestionForm.text_direction || 'ltr'}
                                            placeholder="Kunci jawaban essay..."
                                        />
                                    </div>
                                )}

                                <div className="flex items-center gap-4">
                                    <div className="flex-1">
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tingkat Kesulitan</label>
                                        <select 
                                            className="w-full px-4 py-2 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                            value={editQuestionForm.difficulty || 'MEDIUM'}
                                            onChange={e => setEditQuestionForm({ ...editQuestionForm, difficulty: e.target.value as any })}
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
                                            value={editQuestionForm.points}
                                            onChange={e => setEditQuestionForm({ ...editQuestionForm, points: Number(e.target.value) || 1 })}
                                            min={1}
                                        />
                                    </div>
                                </div>

                                {/* HOTS Toggle */}
                                {aiReviewEnabled && (
                                    <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl">
                                        <input
                                            type="checkbox"
                                            id="hots-edit-exam"
                                            checked={editQuestionForm.teacher_hots_claim || false}
                                            onChange={e => setEditQuestionForm({ ...editQuestionForm, teacher_hots_claim: e.target.checked })}
                                            className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500"
                                        />
                                        <label htmlFor="hots-edit-exam" className="flex-1 cursor-pointer">
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
                                    <button onClick={() => { setIsPassageMode(false); setManualForm({ ...manualForm, question_type: 'MULTIPLE_CHOICE', options: manualForm.options || ['', '', '', ''], correct_answer: '' }) }} className={`flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all ${!isPassageMode && manualForm.question_type === 'MULTIPLE_CHOICE' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}`}>Pilihan Ganda</button>
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
                                                    id="exam-passage-audio-upload"
                                                    disabled={uploadingAudio}
                                                />
                                                <label
                                                    htmlFor="exam-passage-audio-upload"
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
                                                            <button type="button" onClick={() => { const u = [...passageQuestions]; u[pqIdx] = { ...u[pqIdx], text_direction: 'ltr' }; setPassageQuestions(u) }} className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${pq.text_direction !== 'rtl' ? 'bg-primary text-white' : 'bg-secondary/10 text-text-secondary'}`}>LTR</button>
                                                            <button type="button" onClick={() => { const u = [...passageQuestions]; u[pqIdx] = { ...u[pqIdx], text_direction: 'rtl' }; setPassageQuestions(u) }} className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${pq.text_direction === 'rtl' ? 'bg-primary text-white' : 'bg-secondary/10 text-text-secondary'}`}>RTL</button>
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
                                                                            <div className={`absolute ${pq.text_direction === 'rtl' ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-secondary/20 flex items-center justify-center text-xs font-bold text-text-secondary`}>{letter}</div>
                                                                            <input
                                                                                dir={pq.text_direction || 'ltr'}
                                                                                type="text"
                                                                                value={pq.options?.[optIdx] || ''}
                                                                                onChange={(e) => {
                                                                                    const updated = [...passageQuestions]
                                                                                    const newOpts = [...(updated[pqIdx].options || ['', '', '', ''])]
                                                                                    newOpts[optIdx] = e.target.value
                                                                                    updated[pqIdx] = { ...updated[pqIdx], options: newOpts }
                                                                                    setPassageQuestions(updated)
                                                                                }}
                                                                                className={`w-full ${pq.text_direction === 'rtl' ? 'pr-10 pl-3 text-right' : 'pl-10 pr-3'} py-1.5 bg-white dark:bg-zinc-800 border border-secondary/20 rounded-lg text-sm text-text-main dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500`}
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
                                                                id={`hots-passage-exam-${pqIdx}`}
                                                                checked={pq.teacher_hots_claim || false}
                                                                onChange={e => {
                                                                    const updated = [...passageQuestions]
                                                                    updated[pqIdx] = { ...updated[pqIdx], teacher_hots_claim: e.target.checked }
                                                                    setPassageQuestions(updated)
                                                                }}
                                                                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                                                            />
                                                            <label htmlFor={`hots-passage-exam-${pqIdx}`} className="cursor-pointer">
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

                                    <div className="flex gap-3 pt-6 border-t border-secondary/10">
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
                                                        <div className="relative">
                                                            <div className={`absolute ${manualForm.text_direction === 'rtl' ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-secondary/20 flex items-center justify-center text-xs font-bold text-text-secondary`}>{letter}</div>
                                                            <input dir={manualForm.text_direction || 'ltr'} type="text" value={manualForm.options?.[idx] || ''} onChange={(e) => { const newOptions = [...(manualForm.options || ['', '', '', ''])]; newOptions[idx] = e.target.value; setManualForm({ ...manualForm, options: newOptions }) }} className={`w-full ${manualForm.text_direction === 'rtl' ? 'pr-12 pl-4 text-right' : 'pl-12 pr-4'} py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm`} placeholder={`Jawaban ${letter}`} />
                                                        </div>
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
                                    {aiReviewEnabled && (
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
                                    )}
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
                                                        passage_text: p.passage_text,
                                                        passage_audio_url: p.audio_url || null
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
                                                        passage_audio_url: q.passage_audio_url || null,
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

                </div>
            )}

            {/* ===== TAB: HASIL ===== */}
            {activeTab === 'hasil' && (
                <div className="space-y-4">
                    {/* Stats Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card padding="p-4" className="text-center">
                            <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{calculateStats().count}</p>
                            <p className="text-xs text-text-secondary dark:text-zinc-400 mt-1">Mengumpulkan</p>
                        </Card>
                        <Card padding="p-4" className="text-center">
                            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{calculateStats().avg}%</p>
                            <p className="text-xs text-text-secondary dark:text-zinc-400 mt-1">Rata-rata</p>
                        </Card>
                        <Card padding="p-4" className="text-center">
                            <p className="text-3xl font-bold text-green-600 dark:text-green-400">{calculateStats().highest}%</p>
                            <p className="text-xs text-text-secondary dark:text-zinc-400 mt-1">Tertinggi</p>
                        </Card>
                        <Card padding="p-4" className="text-center">
                            <p className="text-3xl font-bold text-red-600 dark:text-red-400">{calculateStats().lowest}%</p>
                            <p className="text-xs text-text-secondary dark:text-zinc-400 mt-1">Terendah</p>
                        </Card>
                    </div>

                    {/* Action Bar — matches UTS/UAS pattern */}
                    <div className="flex justify-between items-center bg-white dark:bg-surface-dark border border-secondary/20 p-3 rounded-xl shadow-sm">
                        <div className="flex gap-3 items-center">
                            {exam?.is_active && (
                                <span className="flex items-center gap-1.5 text-xs font-bold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-500/20 px-2.5 py-1 rounded-full">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                    </span>
                                    Live
                                </span>
                            )}
                            <span className="text-sm font-medium text-text-secondary border-l border-secondary/20 pl-3">{submissions.length} submission</span>
                        </div>
                        <div className="flex items-center gap-2">
                           {exam?.show_results_immediately === false && exam?.results_released === false && submissions.length > 0 && (
                                <Button onClick={handleShareResults} className="bg-primary hover:bg-primary-dark text-white text-sm">
                                    Bagikan Hasil
                                </Button>
                            )}
                            {submissions.length > 0 && (
                                <Button onClick={handleDownloadExcel} className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm" icon={<Download className="w-4 h-4 ml-1" />}>
                                    Download Excel
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Submissions Table */}
                    {resultsLoading && submissions.length === 0 ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                    ) : submissions.length === 0 ? (
                        <Card padding="p-8" className="text-center">
                            <BarChart3 className="w-12 h-12 text-text-secondary/50 mx-auto mb-3" />
                            <p className="text-text-secondary">Belum ada siswa yang mengerjakan ulangan ini.</p>
                        </Card>
                    ) : (
                        <Card padding="p-0" className="overflow-hidden">
                            <table className="w-full">
                                <thead className="bg-secondary/5">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-text-main dark:text-white">No</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-text-main dark:text-white">Nama Siswa</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white">Skor</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white">Durasi</th>
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
                                                <td className="px-4 py-3">
                                                    <span className="text-sm font-medium text-text-main dark:text-white">{sub.student?.user?.full_name || '-'}</span>
                                                    <span className="text-xs text-text-secondary ml-2">{sub.student?.nis}</span>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {sub.is_submitted ? (
                                                        <span className={`font-bold text-sm ${percentage >= 75 ? 'text-green-600' : percentage >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                                                            {sub.total_score}/{sub.max_score} ({percentage}%)
                                                        </span>
                                                    ) : (
                                                        <span className="text-text-secondary text-sm">-</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-center text-xs text-text-secondary">
                                                    {sub.submitted_at ? formatDuration(sub.started_at, sub.submitted_at) : '-'}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`text-xs font-medium ${sub.violation_count > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                                        {sub.violation_count || 0}
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
                                                    {sub.is_submitted ? (
                                                        <div className="flex items-center justify-center gap-2">
                                                            <Link href={`/dashboard/guru/ulangan/${examId}/hasil/${sub.id}`}>
                                                                <Button size="sm" variant={sub.is_graded ? 'ghost' : 'primary'} className={!sub.is_graded ? 'bg-gradient-to-r from-blue-600 to-cyan-600' : ''}>
                                                                    {sub.is_graded ? 'Lihat' : 'Koreksi'}
                                                                </Button>
                                                            </Link>
                                                            <button
                                                                onClick={() => setSelectedSubmission(sub)}
                                                                className="px-3 py-1.5 bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-400 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-500/30 transition-colors text-sm font-medium"
                                                            >
                                                                Detail
                                                            </button>

                                                            {exam?.is_active && (
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
                                                                                    <span className="text-text-secondary mt-0.5 text-[10px] leading-tight">Lanjutkan, timer berjalan & jawaban aman</span>
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

            {/* Submission Detail Modal */}
            <Modal open={!!selectedSubmission} onClose={() => setSelectedSubmission(null)} title="Detail Submission" maxWidth="lg">
                {selectedSubmission && (
                    <div className="space-y-4">
                        <div className="bg-secondary/10 rounded-xl p-4">
                            <p className="text-sm text-text-secondary dark:text-zinc-400">Siswa</p>
                            <p className="text-lg font-bold text-text-main dark:text-white">{selectedSubmission.student?.user?.full_name}</p>
                            <p className="text-sm text-text-secondary dark:text-zinc-500">NIS: {selectedSubmission.student?.nis}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-secondary/10 rounded-xl p-4 text-center">
                                <p className="text-sm text-text-secondary dark:text-zinc-400">Nilai</p>
                                <p className={`text-2xl font-bold ${getScoreColor(selectedSubmission.total_score, selectedSubmission.max_score).split(' ')[0]}`}>
                                    {selectedSubmission.total_score}/{selectedSubmission.max_score}
                                </p>
                            </div>
                            <div className="bg-secondary/10 rounded-xl p-4 text-center">
                                <p className="text-sm text-text-secondary dark:text-zinc-400">Pelanggaran</p>
                                <p className={`text-2xl font-bold ${selectedSubmission.violation_count > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                    {selectedSubmission.violation_count || 0}
                                </p>
                            </div>
                        </div>
                        <div className="bg-secondary/10 rounded-xl p-4">
                            <p className="text-sm text-text-secondary dark:text-zinc-400 mb-2">Waktu</p>
                            <div className="text-sm text-text-main dark:text-zinc-300 space-y-1">
                                <p>Mulai: {new Date(selectedSubmission.started_at).toLocaleString('id-ID')}</p>
                                <p>Selesai: {selectedSubmission.submitted_at ? new Date(selectedSubmission.submitted_at).toLocaleString('id-ID') : '-'}</p>
                                <p>Durasi: {selectedSubmission.submitted_at ? formatDuration(selectedSubmission.started_at, selectedSubmission.submitted_at) : '-'}</p>
                            </div>
                        </div>
                        {selectedSubmission.violations_log && selectedSubmission.violations_log.length > 0 && (
                            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
                                <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-2">⚠️ Log Pelanggaran</p>
                                <div className="space-y-1 text-sm max-h-48 overflow-y-auto pr-2">
                                    {selectedSubmission.violations_log.map((v: any, idx: number) => (
                                        <div key={idx} className="flex justify-between text-text-main dark:text-zinc-300 border-b border-red-500/10 last:border-0 pb-1 last:pb-0">
                                            <span>{v.type}</span>
                                            <span className="text-text-secondary dark:text-zinc-500">{new Date(v.timestamp).toLocaleTimeString('id-ID')}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </Modal>

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
                    {editForm.start_time && editForm.duration_minutes > 0 && (
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-700/30 rounded-xl">
                            <p className="text-xs text-text-secondary mb-0.5">Waktu Berakhir (otomatis)</p>
                            <p className="text-sm font-bold text-blue-600 dark:text-blue-400">
                                {new Date(new Date(editForm.start_time).getTime() + editForm.duration_minutes * 60000)
                                    .toLocaleString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                        </div>
                    )}
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
                    <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/10">
                        <input
                            type="checkbox"
                            id="edit-show-results"
                            checked={editForm.show_results_immediately}
                            onChange={(e) => setEditForm({ ...editForm, show_results_immediately: e.target.checked })}
                            className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary"
                        />
                        <label htmlFor="edit-show-results" className="text-sm font-medium text-text-main dark:text-white cursor-pointer select-none flex flex-col">
                            <span>Tampilkan Hasil Langsung</span>
                            <span className="text-xs text-text-secondary font-normal mt-0.5">Jika dimatikan, siswa baru bisa melihat nilai setelah Anda klik "Bagikan Hasil"</span>
                        </label>
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
                open={!!showSuccessModal}
                onClose={() => setShowSuccessModal(false)}
            >
                <div className="text-center py-6">
                    {showSuccessModal === 'published' ? (
                        <>
                            <div className="w-16 h-16 bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto mb-4">
                                <TickSquare set="bold" primaryColor="currentColor" size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Ulangan Berhasil Dipublish!</h3>
                            <p className="text-sm text-text-secondary dark:text-zinc-400 mb-6">
                                Siswa sekarang dapat melihat dan mengerjakan ulangan ini melalui dashboard mereka.
                            </p>
                        </>
                    ) : (
                        <>
                            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto mb-4">
                                <TickSquare set="bold" primaryColor="currentColor" size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Ulangan Dikirim ke Review Admin</h3>
                            <p className="text-sm text-text-secondary dark:text-zinc-400 mb-6">
                                Ada soal yang memerlukan persetujuan admin. Ulangan akan otomatis dipublikasikan ke siswa setelah admin menyetujui semua soal.
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
