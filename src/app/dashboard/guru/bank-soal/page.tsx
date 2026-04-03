'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import dynamic from 'next/dynamic'
import { Modal, Button, PageHeader, EmptyState } from '@/components/ui'
import SmartText from '@/components/SmartText'
import Card from '@/components/ui/Card'
// Dynamic imports for heavy components (mathlive 5.6MB, AI modal 724 lines)
const RapihAIModal = dynamic(() => import('@/components/RapihAIModal'), { ssr: false })
const MathTextarea = dynamic(() => import('@/components/MathTextarea'), {
    ssr: false,
    loading: () => <textarea placeholder="Memuat editor..." className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main" rows={3} readOnly />
})
const AIReviewPanel = dynamic(() => import('@/components/AIReviewPanel'), { ssr: false })
import { Folder, Plus, Document, Delete, Edit, Discovery, Paper, ShieldDone, TickSquare, InfoCircle, CloseSquare, Download, Search, Danger } from 'react-iconly'
import { Copy, ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link' // Keep this import as it's used later

interface QuestionBankItem {
    id: string
    question_text: string
    question_type: 'ESSAY' | 'MULTIPLE_CHOICE'
    options: string[] | null
    correct_answer: string | null
    difficulty: 'EASY' | 'MEDIUM' | 'HARD'
    image_url?: string | null
    created_at: string
    subject: { id: string; name: string } | null
    status?: string
    teacher_hots_claim?: boolean
    ai_review?: any
    admin_review?: any
}

interface Subject {
    id: string
    name: string
}

interface PassageQuestion {
    question_text: string
    question_type: 'ESSAY' | 'MULTIPLE_CHOICE'
    options: string[]
    correct_answer: string
    difficulty: 'EASY' | 'MEDIUM' | 'HARD'
    teacher_hots_claim?: boolean
}

interface Passage {
    id: string
    title: string | null
    passage_text: string
    audio_url?: string | null
    subject: { id: string; name: string } | null
    questions: Array<{
        id: string
        question_text: string
        question_type: 'ESSAY' | 'MULTIPLE_CHOICE'
        options: string[] | null
        correct_answer: string | null
        difficulty: 'EASY' | 'MEDIUM' | 'HARD'
        order_in_passage: number
        status?: string
        teacher_hots_claim?: boolean
        admin_review?: any
    }>
    created_at: string
}

export default function BankSoalPage() {
    const { user } = useAuth()
    const [questions, setQuestions] = useState<QuestionBankItem[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedSubject, setSelectedSubject] = useState('')
    const [selectedDifficulty, setSelectedDifficulty] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedType, setSelectedType] = useState('')
    const [selectedStatus, setSelectedStatus] = useState('')
    const [currentPage, setCurrentPage] = useState(1)
    const ITEMS_PER_PAGE = 20
    const [aiReviewEnabled, setAiReviewEnabled] = useState(true)

    // Selection state for export
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [selectedPassageIds, setSelectedPassageIds] = useState<Set<string>>(new Set())
    const [showExportConfirm, setShowExportConfirm] = useState(false)

    // Delete modal state
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
    const [deleteTargetType, setDeleteTargetType] = useState<'question' | 'passage'>('question')
    const [deleteTargetLabel, setDeleteTargetLabel] = useState('')
    const [deleting, setDeleting] = useState(false)


    // Modal & Form Control
    const [showAddModal, setShowAddModal] = useState(false)
    const [questionType, setQuestionType] = useState<'standalone' | 'passage'>('standalone')
    const [saving, setSaving] = useState(false)
    const [showRapihAI, setShowRapihAI] = useState(false)
    const [showAddDropdown, setShowAddDropdown] = useState(false)

    // Toast notification state (replacing browser alert)
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
    const showToast = (message: string, type: 'success' | 'error' = 'error') => {
        setToast({ message, type })
        setTimeout(() => setToast(null), 4000)
    }

    // Standalone Question Form
    const [questionForm, setQuestionForm] = useState({
        question_text: '',
        question_type: 'MULTIPLE_CHOICE' as 'ESSAY' | 'MULTIPLE_CHOICE',
        options: ['', '', '', ''],
        correct_answer: '',
        difficulty: 'MEDIUM' as 'EASY' | 'MEDIUM' | 'HARD',
        subject_id: '',
        image_url: '',
        teacher_hots_claim: false
    })
    const [uploading, setUploading] = useState(false)
    const [uploadingAudio, setUploadingAudio] = useState(false)

    // Passage State
    const [passages, setPassages] = useState<Passage[]>([])
    const [passageForm, setPassageForm] = useState({
        title: '',
        passage_text: '',
        audio_url: '',
        subject_id: '',
        questions: [{
            question_text: '',
            question_type: 'MULTIPLE_CHOICE' as 'ESSAY' | 'MULTIPLE_CHOICE',
            options: ['', '', '', ''],
            correct_answer: '',
            difficulty: 'MEDIUM' as 'EASY' | 'MEDIUM' | 'HARD',
            teacher_hots_claim: false
        }] as PassageQuestion[]
    })

    // Edit Passage State
    const [editingPassageId, setEditingPassageId] = useState<string | null>(null)
    const [showEditPassageModal, setShowEditPassageModal] = useState(false)
    const [editPassageForm, setEditPassageForm] = useState({
        title: '',
        passage_text: '',
        audio_url: '',
        subject_id: '',
        questions: [] as PassageQuestion[]
    })

    // Image upload handler
    const handleImageUpload = async (file: File): Promise<string | null> => {
        setUploading(true)
        try {
            const formData = new FormData()
            formData.append('file', file)
            const res = await fetch('/api/questions/upload-image', {
                method: 'POST',
                body: formData
            })
            const data = await res.json()
            if (res.ok) return data.url
            showToast(data.error || 'Gagal upload gambar')
            return null
        } catch {
            showToast('Gagal upload gambar')
            return null
        } finally {
            setUploading(false)
        }
    }

    useEffect(() => {
        if (user) fetchData()
    }, [user])

    useEffect(() => {
        fetch('/api/school-settings').then(r => r.ok ? r.json() : null).then(d => {
            if (d) setAiReviewEnabled(d.ai_review_enabled !== false)
        }).catch(() => { })
    }, [])

    const fetchData = async () => {
        try {
            const [questionsRes, passagesRes, subjectsRes] = await Promise.all([
                fetch('/api/question-bank'),
                fetch('/api/passages'),
                fetch('/api/subjects')
            ])
            const [questionsData, passagesData, subjectsData] = await Promise.all([
                questionsRes.json(),
                passagesRes.json(),
                subjectsRes.json()
            ])
            setQuestions(questionsData)
            setPassages(passagesData)
            setSubjects(subjectsData)
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const openDeleteModal = (id: string, type: 'question' | 'passage', label: string) => {
        setDeleteTargetId(id)
        setDeleteTargetType(type)
        setDeleteTargetLabel(label)
        setShowDeleteModal(true)
    }

    const executeDelete = async () => {
        if (!deleteTargetId) return
        setDeleting(true)
        try {
            if (deleteTargetType === 'question') {
                await fetch(`/api/question-bank?id=${deleteTargetId}`, { method: 'DELETE' })
            } else {
                await fetch(`/api/passages?id=${deleteTargetId}`, { method: 'DELETE' })
            }
            await fetchData()
            setShowDeleteModal(false)
            setDeleteTargetId(null)
        } catch (error) {
            console.error('Error:', error)
            showToast('Gagal menghapus')
        } finally {
            setDeleting(false)
        }
    }

    const handleSubmitStandalone = async () => {
        setSaving(true)
        try {
            await fetch('/api/question-bank', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(questionForm)
            })
            await fetchData()
            handleCloseModal()
        } catch (error) {
            console.error('Error:', error)
            showToast('Gagal menyimpan soal')
        } finally {
            setSaving(false)
        }
    }

    const handleSubmitPassage = async () => {
        setSaving(true)
        try {
            await fetch('/api/passages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(passageForm)
            })
            await fetchData()
            handleCloseModal()
        } catch (error) {
            console.error('Error:', error)
            showToast('Gagal menyimpan passage')
        } finally {
            setSaving(false)
        }
    }

    const handleCloseModal = () => {
        setShowAddModal(false)
        setQuestionType('standalone')
        setSaving(false)
        // Reset forms
        setQuestionForm({
            question_text: '',
            question_type: 'MULTIPLE_CHOICE',
            options: ['', '', '', ''],
            correct_answer: '',
            difficulty: 'MEDIUM',
            subject_id: '',
            image_url: '',
            teacher_hots_claim: false
        })
        setPassageForm({
            title: '',
            passage_text: '',
            audio_url: '',
            subject_id: '',
            questions: [{
                question_text: '',
                question_type: 'MULTIPLE_CHOICE',
                options: ['', '', '', ''],
                correct_answer: '',
                difficulty: 'MEDIUM',
                teacher_hots_claim: false
            }]
        })
    }

    const handleAddPassageQuestion = () => {
        setPassageForm({
            ...passageForm,
            questions: [...passageForm.questions, {
                question_text: '',
                question_type: 'MULTIPLE_CHOICE',
                options: ['', '', '', ''],
                correct_answer: '',
                difficulty: 'MEDIUM',
                teacher_hots_claim: false
            }]
        })
    }

    const handleRemovePassageQuestion = (index: number) => {
        if (passageForm.questions.length > 1) {
            setPassageForm({
                ...passageForm,
                questions: passageForm.questions.filter((_, i) => i !== index)
            })
        }
    }

    // Edit Passage Handlers
    const handleEditPassage = (p: Passage) => {
        setEditingPassageId(p.id)
        setEditPassageForm({
            title: p.title || '',
            passage_text: p.passage_text,
            audio_url: p.audio_url || '',
            subject_id: p.subject?.id || '',
            questions: p.questions?.map(q => ({
                question_text: q.question_text,
                question_type: q.question_type,
                options: q.options || ['', '', '', ''],
                correct_answer: q.correct_answer || '',
                difficulty: q.difficulty,
                teacher_hots_claim: q.teacher_hots_claim || false
            })) || []
        })
        setShowEditPassageModal(true)
    }

    const handleSaveEditPassage = async () => {
        if (!editingPassageId) return
        setSaving(true)
        try {
            await fetch(`/api/passages?id=${editingPassageId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editPassageForm)
            })
            await fetchData()
            setShowEditPassageModal(false)
            setEditingPassageId(null)
        } catch (error) {
            console.error('Error:', error)
            showToast('Gagal menyimpan perubahan')
        } finally {
            setSaving(false)
        }
    }

    // handleDeletePassage is now handled by openDeleteModal + executeDelete

    const handleAddEditPassageQuestion = () => {
        setEditPassageForm({
            ...editPassageForm,
            questions: [...editPassageForm.questions, {
                question_text: '',
                question_type: 'MULTIPLE_CHOICE',
                options: ['', '', '', ''],
                correct_answer: '',
                difficulty: 'MEDIUM',
                teacher_hots_claim: false
            }]
        })
    }

    const handleRemoveEditPassageQuestion = (index: number) => {
        if (editPassageForm.questions.length > 1) {
            setEditPassageForm({
                ...editPassageForm,
                questions: editPassageForm.questions.filter((_, i) => i !== index)
            })
        }
    }

    // Edit Standalone Question Handlers
    const [showEditQuestionModal, setShowEditQuestionModal] = useState(false)
    const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
    const [editQuestionForm, setEditQuestionForm] = useState({
        question_text: '',
        question_type: 'MULTIPLE_CHOICE' as 'ESSAY' | 'MULTIPLE_CHOICE',
        options: ['', '', '', ''],
        correct_answer: '',
        difficulty: 'MEDIUM' as 'EASY' | 'MEDIUM' | 'HARD',
        subject_id: '',
        image_url: '',
        teacher_hots_claim: false
    })

    const handleEditQuestion = (q: QuestionBankItem) => {
        setEditingQuestionId(q.id)
        setEditQuestionForm({
            question_text: q.question_text,
            question_type: q.question_type,
            options: q.options || ['', '', '', ''],
            correct_answer: q.correct_answer || '',
            difficulty: q.difficulty,
            subject_id: q.subject?.id || '',
            image_url: q.image_url || '',
            teacher_hots_claim: q.teacher_hots_claim || false
        })
        setShowEditQuestionModal(true)
    }

    const handleSaveEditQuestion = async () => {
        if (!editingQuestionId) return
        setSaving(true)
        try {
            await fetch(`/api/question-bank?id=${editingQuestionId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editQuestionForm)
            })
            await fetchData()
            setShowEditQuestionModal(false)
            setEditingQuestionId(null)
        } catch (error) {
            console.error('Error:', error)
            showToast('Gagal menyimpan perubahan')
        } finally {
            setSaving(false)
        }
    }

    const filteredQuestions = questions.filter((q) => {
        if (selectedSubject && q.subject?.id !== selectedSubject) return false
        if (selectedDifficulty && q.difficulty !== selectedDifficulty) return false
        if (selectedType && q.question_type !== selectedType) return false
        if (selectedStatus && q.status !== selectedStatus) return false
        if (searchQuery && !q.question_text.toLowerCase().includes(searchQuery.toLowerCase())) return false
        return true
    })

    const filteredPassages = passages.filter((p) => {
        if (selectedSubject && p.subject?.id !== selectedSubject) return false
        if (selectedDifficulty && !p.questions?.some(q => q.difficulty === selectedDifficulty)) return false
        if (selectedType && !p.questions?.some(q => q.question_type === selectedType)) return false
        if (searchQuery) {
            const passageMatch = p.passage_text.toLowerCase().includes(searchQuery.toLowerCase())
            const titleMatch = p.title?.toLowerCase().includes(searchQuery.toLowerCase())
            const questionMatch = p.questions?.some(q => q.question_text.toLowerCase().includes(searchQuery.toLowerCase()))
            if (!passageMatch && !titleMatch && !questionMatch) return false
        }
        return true
    })

    // Pagination
    const totalPages = Math.ceil(filteredQuestions.length / ITEMS_PER_PAGE)
    const paginatedQuestions = filteredQuestions.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    )

    const getDifficultyBadge = (difficulty: string) => {
        switch (difficulty) {
            case 'EASY':
                return 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-200'
            case 'MEDIUM':
                return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200'
            case 'HARD':
                return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200'
            default:
                return 'bg-secondary/10 text-text-secondary border-secondary/20'
        }
    }

    const getDifficultyLabel = (difficulty: string) => {
        switch (difficulty) {
            case 'EASY': return 'Mudah'
            case 'MEDIUM': return 'Sedang'
            case 'HARD': return 'Sulit'
            default: return difficulty
        }
    }

    const getStatusBadge = (status?: string) => {
        switch (status) {
            case 'approved':
                return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 font-medium flex items-center gap-1"><TickSquare set="bold" primaryColor="currentColor" size={12} /> Approved</span>
            case 'ai_reviewing':
                return aiReviewEnabled ? <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium animate-pulse flex items-center gap-1"><Discovery set="bold" primaryColor="currentColor" size={12} /> AI Review...</span> : null
            case 'admin_review':
                return aiReviewEnabled ? <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-medium flex items-center gap-1"><InfoCircle set="bold" primaryColor="currentColor" size={12} /> Perlu Review</span> : null
            case 'returned':
                return <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 font-medium flex items-center gap-1"><CloseSquare set="bold" primaryColor="currentColor" size={12} /> Dikembalikan</span>
            case 'draft':
                return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 font-medium flex items-center gap-1"><Paper set="bold" primaryColor="currentColor" size={12} /> Draft</span>
            default:
                return null
        }
    }

    const handleExport = () => {
        const questionsToExport = filteredQuestions.filter(q => selectedIds.has(q.id))
        const passagesToExport = filteredPassages.filter(p => selectedPassageIds.has(p.id))
        let questionNumber = 0

        const passageHtml = passagesToExport.map(p => `
            <div style="margin-bottom: 32px; page-break-inside: avoid; border: 1px solid #ddd; padding: 16px; border-radius: 8px;">
                <h3 style="margin-bottom: 8px;">${p.title || 'Bacaan'}</h3>
                <p style="margin-bottom: 16px; color:#444; white-space: pre-wrap;">${p.passage_text}</p>
                ${(p.questions || []).map(q => {
            questionNumber++
            return `<div style="margin-bottom: 12px;">
                        <p style="margin-bottom: 4px;"><strong>${questionNumber}. ${q.question_text}</strong></p>
                        ${q.question_type === 'MULTIPLE_CHOICE' && q.options ? `
                            <ul style="list-style:none; padding-left:20px; margin:0;">
                                ${q.options.map((opt, optIdx) => `
                                    <li style="margin-bottom: 4px; ${q.correct_answer === String.fromCharCode(65 + optIdx) ? 'font-weight:bold; color:green;' : ''}">
                                        ${String.fromCharCode(65 + optIdx)}. ${opt}
                                    </li>
                                `).join('')}
                            </ul>
                        ` : ''}
                    </div>`
        }).join('')}
            </div>
        `).join('')

        const standaloneHtml = questionsToExport.map(q => {
            questionNumber++
            return `<div style="margin-bottom: 24px; page-break-inside: avoid;">
                <p style="margin-bottom: 8px;"><strong>${questionNumber}. ${q.question_text}</strong></p>
                ${q.question_type === 'MULTIPLE_CHOICE' && q.options ? `
                    <ul style="list-style:none; padding-left:20px; margin:0;">
                        ${q.options.map((opt, optIdx) => `
                            <li style="margin-bottom: 4px; ${q.correct_answer === String.fromCharCode(65 + optIdx) ? 'font-weight:bold; color:green;' : ''}">
                                ${String.fromCharCode(65 + optIdx)}. ${opt}
                            </li>
                        `).join('')}
                    </ul>
                ` : ''}
            </div>`
        }).join('')

        const htmlContent = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
            <head><meta charset='utf-8'><title>Bank Soal</title></head>
            <body style="font-family: Arial, sans-serif;">
            <h1 style="text-align:center;">Bank Soal</h1>
            <p style="text-align:center; color:#666;">Total: ${questionNumber} Soal</p>
            <hr/>
            ${passageHtml}
            ${standaloneHtml}
            </body>
            </html>
        `
        const blob = new Blob([htmlContent], { type: 'application/msword' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'Bank_Soal.doc'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        setShowExportConfirm(false)
        setSelectedIds(new Set())
        setSelectedPassageIds(new Set())
    }

    const totalSelected = selectedIds.size + selectedPassageIds.size

    const toggleSelectAll = () => {
        const allQSelected = selectedIds.size === filteredQuestions.length && filteredQuestions.length > 0
        const allPSelected = selectedPassageIds.size === filteredPassages.length && filteredPassages.length > 0
        if (allQSelected && allPSelected) {
            setSelectedIds(new Set())
            setSelectedPassageIds(new Set())
        } else {
            setSelectedIds(new Set(filteredQuestions.map(q => q.id)))
            setSelectedPassageIds(new Set(filteredPassages.map(p => p.id)))
        }
    }

    // Rapih AI Save Handler - saves AI results directly to bank soal
    const handleSaveAIToBank = async (results: any[]) => {
        if (results.length === 0) return
        setSaving(true)
        try {
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

            // Save standalone questions to question bank
            if (standaloneQuestions.length > 0) {
                await fetch('/api/question-bank', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(standaloneQuestions.map(q => ({
                        question_text: q.question_text,
                        question_type: q.question_type,
                        options: q.options || null,
                        correct_answer: q.correct_answer || null,
                        difficulty: q.difficulty || 'MEDIUM',
                        subject_id: selectedSubject || null
                    })))
                })
            }

            // Save passage-based questions as passages
            for (const [passageText, pQuestions] of passageGroups) {
                await fetch('/api/passages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: passageText.substring(0, 50) + '...',
                        passage_text: passageText,
                        subject_id: selectedSubject || null,
                        questions: pQuestions.map(q => ({
                            question_text: q.question_text,
                            question_type: q.question_type,
                            options: q.options || null,
                            correct_answer: q.correct_answer || null,
                            difficulty: q.difficulty || 'MEDIUM'
                        }))
                    })
                })
            }

            await fetchData()
            setShowRapihAI(false)
            showToast('Soal berhasil disimpan ke Bank Soal!', 'success')
        } catch (error) {
            console.error('Error saving AI results to bank:', error)
            showToast('Gagal menyimpan soal ke Bank Soal')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Bank Soal"
                subtitle="Kelola dan reuse soal-soal Anda"
                backHref="/dashboard/guru"
                icon={<Folder set="bold" primaryColor="currentColor" size={24} />}
                action={
                    <div className="flex items-center gap-3">
                        <div className="text-right hidden sm:block">
                            <p className="text-xl font-bold text-primary">{questions.length}</p>
                            <p className="text-xs text-text-secondary">Total Soal</p>
                        </div>
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
                                    <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-white dark:bg-zinc-800 rounded-xl shadow-xl border border-gray-200 dark:border-zinc-700 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                        <button
                                            onClick={() => {
                                                setShowAddModal(true)
                                                setShowAddDropdown(false)
                                            }}
                                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer"
                                        >
                                            <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                                                <Edit set="bold" primaryColor="currentColor" size={20} />
                                            </div>
                                            <div className="text-left">
                                                <div className="text-sm font-semibold text-text-main dark:text-white">Manual</div>
                                                <div className="text-xs text-text-secondary">Ketik soal satu per satu</div>
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => {
                                                setShowRapihAI(true)
                                                setShowAddDropdown(false)
                                            }}
                                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors cursor-pointer"
                                        >
                                            <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                                                <Discovery set="bold" primaryColor="currentColor" size={20} />
                                            </div>
                                            <div className="text-left">
                                                <div className="text-sm font-semibold text-text-main dark:text-white">Rapih AI</div>
                                                <div className="text-xs text-text-secondary">Rapikan, generate, atau upload soal</div>
                                            </div>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                        <Button
                            onClick={() => setShowExportConfirm(true)}
                            disabled={totalSelected === 0}
                            className="disabled:opacity-50 disabled:cursor-not-allowed"
                            icon={<Download set="bold" primaryColor="currentColor" size={20} />}
                        >
                            Export ({totalSelected})
                        </Button>
                    </div>
                }
            />

            {/* Search & Filters */}
            <div className="space-y-3">
                <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">
                        <Search set="light" primaryColor="currentColor" size={20} />
                    </div>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
                        placeholder="Cari soal berdasarkan kata kunci..."
                        className="w-full pl-10 pr-4 py-3 bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary"
                    />
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-center">
                    <select
                        value={selectedSubject}
                        onChange={(e) => { setSelectedSubject(e.target.value); setCurrentPage(1) }}
                        className="w-full sm:w-auto px-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none cursor-pointer hover:bg-secondary/10 transition-colors"
                    >
                        <option value="">Semua Mata Pelajaran</option>
                        {subjects.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                    <select
                        value={selectedDifficulty}
                        onChange={(e) => { setSelectedDifficulty(e.target.value); setCurrentPage(1) }}
                        className="w-full sm:w-auto px-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none cursor-pointer hover:bg-secondary/10 transition-colors"
                    >
                        <option value="">Semua Kesulitan</option>
                        <option value="EASY">Mudah</option>
                        <option value="MEDIUM">Sedang</option>
                        <option value="HARD">Sulit</option>
                    </select>
                    <select
                        value={selectedType}
                        onChange={(e) => { setSelectedType(e.target.value); setCurrentPage(1) }}
                        className="w-full sm:w-auto px-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none cursor-pointer hover:bg-secondary/10 transition-colors"
                    >
                        <option value="">Semua Tipe</option>
                        <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                        <option value="ESSAY">Essay</option>
                    </select>
                    <select
                        value={selectedStatus}
                        onChange={(e) => { setSelectedStatus(e.target.value); setCurrentPage(1) }}
                        className="w-full sm:w-auto px-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none cursor-pointer hover:bg-secondary/10 transition-colors"
                    >
                        <option value="">Semua Status</option>
                        <option value="approved">✅ Approved</option>
                        {aiReviewEnabled && <option value="ai_reviewing">🤖 AI Review</option>}
                        {aiReviewEnabled && <option value="admin_review">⚠️ Perlu Review</option>}
                        <option value="returned">❌ Dikembalikan</option>
                        <option value="draft">📝 Draft</option>
                    </select>
                    {(filteredQuestions.length > 0 || filteredPassages.length > 0) && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={toggleSelectAll}
                            className="w-full sm:w-auto"
                        >
                            {selectedIds.size === filteredQuestions.length && selectedPassageIds.size === filteredPassages.length && (filteredQuestions.length + filteredPassages.length) > 0 ? 'Batal Pilih Semua' : 'Pilih Semua'}
                        </Button>
                    )}
                    {(searchQuery || selectedSubject || selectedDifficulty || selectedType) && (
                        <span className="text-xs text-text-secondary">Ditemukan: {filteredQuestions.length} soal, {filteredPassages.length} passage</span>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin text-3xl text-primary"><Discovery set="bold" primaryColor="currentColor" size={40} /></div>
                </div>
            ) : filteredQuestions.length === 0 && filteredPassages.length === 0 ? (
                <EmptyState
                    icon={<div className="text-secondary"><Folder set="bold" primaryColor="currentColor" size={48} /></div>}
                    title="Bank Soal Kosong"
                    description="Simpan soal ke bank soal saat membuat kuis dengan OCR atau AI Generate."
                    action={
                        <Link href="/dashboard/guru/kuis">
                            <Button>Buat Kuis dengan AI</Button>
                        </Link>
                    }
                />
            ) : (
                <div className="space-y-6">
                    {/* Passages Section */}
                    {filteredPassages.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-bold text-text-main dark:text-white flex items-center gap-2">
                                <Document set="bold" primaryColor="currentColor" size={20} />
                                Soal dengan Bacaan ({filteredPassages.length})
                            </h3>
                            {filteredPassages.map((p) => (
                                <label key={p.id} className={`block border-2 rounded-2xl overflow-hidden cursor-pointer transition-all ${selectedPassageIds.has(p.id) ? 'border-primary bg-primary/5' : 'border-teal-200 dark:border-teal-700 bg-teal-50/50 dark:bg-teal-900/20'}`}>
                                    <div className="p-4 bg-teal-100/50 dark:bg-teal-800/30 border-b border-teal-200 dark:border-teal-700">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedPassageIds.has(p.id)}
                                                    onChange={(e) => {
                                                        const newSet = new Set(selectedPassageIds)
                                                        if (e.target.checked) newSet.add(p.id)
                                                        else newSet.delete(p.id)
                                                        setSelectedPassageIds(newSet)
                                                    }}
                                                    className="w-5 h-5 rounded-md border-secondary/30 text-primary focus:ring-primary bg-secondary/10"
                                                />
                                                <div>
                                                    <h4 className="font-bold text-text-main dark:text-white flex items-center gap-2">
                                                        <Document set="bold" primaryColor="currentColor" size={16} /> {p.title || 'Bacaan Tanpa Judul'}
                                                    </h4>
                                                    <span className="text-xs text-teal-600 dark:text-teal-400">{p.questions?.length || 0} soal terkait</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {p.subject && (
                                                    <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-teal-500/20 text-teal-700 dark:text-teal-300">
                                                        {p.subject.name}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={(e) => { e.preventDefault(); handleEditPassage(p) }}
                                                    className="p-2 hover:bg-teal-200 dark:hover:bg-teal-700 rounded-lg transition-colors"
                                                    title="Edit passage"
                                                >
                                                    <Edit set="bold" primaryColor="currentColor" size={16} />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.preventDefault(); openDeleteModal(p.id, 'passage', p.title || 'Bacaan') }}
                                                    className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                                    title="Hapus passage"
                                                >
                                                    <Delete set="bold" primaryColor="currentColor" size={16} />
                                                </button>
                                            </div>
                                        </div>
                                        <p className="text-sm text-text-secondary dark:text-zinc-400 mt-2 line-clamp-3">{p.passage_text}</p>
                                        {p.audio_url && (
                                            <div className="mt-2 flex items-center gap-2">
                                                <span className="px-2 py-0.5 text-xs rounded-full bg-violet-500/20 text-violet-600 dark:text-violet-400 font-medium">🎧 Listening</span>
                                                <audio controls className="h-8" src={p.audio_url} />
                                            </div>
                                        )}
                                    </div>
                                    {/* Questions inside passage */}
                                    {p.questions && p.questions.length > 0 && (
                                        <div className="p-4 space-y-3">
                                            {p.questions.map((q, idx) => (
                                                <div key={q.id} className="p-3 bg-white dark:bg-surface-dark rounded-xl border border-teal-200 dark:border-teal-700">
                                                    <div className="flex items-start gap-3">
                                                        <span className="w-6 h-6 rounded-full bg-teal-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                            {idx + 1}
                                                        </span>
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                                <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${q.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-500/20 text-blue-600' : 'bg-amber-500/20 text-amber-600'}`}>
                                                                    {q.question_type === 'MULTIPLE_CHOICE' ? 'PG' : 'Essay'}
                                                                </span>
                                                                <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${getDifficultyBadge(q.difficulty)}`}>
                                                                    {getDifficultyLabel(q.difficulty)}
                                                                </span>
                                                                {getStatusBadge(q.status)}
                                                                {aiReviewEnabled && q.teacher_hots_claim && (
                                                                    <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-200 dark:text-emerald-400">
                                                                        🧠 HOTS
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {/* Admin return reason */}
                                                            {q.status === 'returned' && q.admin_review?.notes && (
                                                                <div className="mt-2 mb-3 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                                                                    <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 mb-0.5">📋 Alasan Admin:</p>
                                                                    <p className="text-[10px] text-amber-600 dark:text-amber-400">{q.admin_review.notes}</p>
                                                                </div>
                                                            )}
                                                            <SmartText text={q.question_text} className="text-text-main dark:text-white text-sm" />
                                                            {q.question_type === 'MULTIPLE_CHOICE' && q.options && (
                                                                <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                                                                    {q.options.map((opt, optIdx) => (
                                                                        <div key={optIdx} className={`px-2 py-1 rounded ${q.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'text-text-secondary'}`}>
                                                                            {String.fromCharCode(65 + optIdx)}. {opt}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </label>
                            ))}
                        </div>
                    )}

                    {/* Standalone Questions Section */}
                    {paginatedQuestions.length > 0 && (
                        <div className="space-y-4">
                            {filteredPassages.length > 0 && (
                                <h3 className="text-lg font-bold text-text-main dark:text-white flex items-center gap-2">
                                    <Paper set="bold" primaryColor="currentColor" size={20} /> Soal Biasa ({filteredQuestions.length})
                                </h3>
                            )}
                            <div className="grid grid-cols-1 gap-4">
                                {paginatedQuestions.map((q, idx) => (
                                    <label
                                        key={q.id}
                                        className={`block bg-white dark:bg-surface-dark border rounded-2xl p-5 cursor-pointer transition-all hover:shadow-md ${selectedIds.has(q.id)
                                            ? 'border-primary bg-primary/5 dark:bg-primary/10'
                                            : 'border-transparent hover:border-primary/30'
                                            }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            <div className="pt-1">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(q.id)}
                                                    onChange={(e) => {
                                                        const newSet = new Set(selectedIds)
                                                        if (e.target.checked) {
                                                            newSet.add(q.id)
                                                        } else {
                                                            newSet.delete(q.id)
                                                        }
                                                        setSelectedIds(newSet)
                                                    }}
                                                    className="w-5 h-5 rounded-md border-secondary/30 text-primary focus:ring-primary bg-secondary/10"
                                                />
                                            </div>
                                            <div className="w-8 h-8 rounded-lg bg-secondary/10 text-primary flex items-center justify-center font-bold text-sm flex-shrink-0">
                                                {(currentPage - 1) * ITEMS_PER_PAGE + idx + 1}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-3 flex-wrap">
                                                    <span className={`px-2.5 py-1 text-xs font-bold rounded-full border ${q.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-500/10 text-blue-600 border-blue-200 dark:text-blue-400' : 'bg-orange-500/10 text-orange-600 border-orange-200 dark:text-orange-400'}`}>
                                                        {q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 'Essay'}
                                                    </span>
                                                    <span className={`px-2.5 py-1 text-xs font-bold rounded-full border ${getDifficultyBadge(q.difficulty)}`}>
                                                        {getDifficultyLabel(q.difficulty)}
                                                    </span>
                                                    {q.subject && (
                                                        <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-secondary/10 text-text-secondary border border-secondary/20">
                                                            {q.subject.name}
                                                        </span>
                                                    )}
                                                    {getStatusBadge(q.status)}
                                                </div>
                                                {/* Admin return reason */}
                                                {q.status === 'returned' && q.admin_review?.notes && (
                                                    <div className="mt-2 p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                                                        <p className="text-xs font-bold text-amber-700 dark:text-amber-300 mb-0.5">📋 Alasan Pengembalian dari Admin:</p>
                                                        <p className="text-xs text-amber-600 dark:text-amber-400">{q.admin_review.notes}</p>
                                                    </div>
                                                )}
                                                <SmartText text={q.question_text} className="text-text-main dark:text-white mb-4 text-lg font-medium leading-relaxed" />
                                                {q.question_type === 'MULTIPLE_CHOICE' && q.options && (
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                                        {q.options.map((opt, optIdx) => (
                                                            <div key={optIdx} className={`px-4 py-3 rounded-xl border flex items-center gap-3 ${q.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-500/5 border-green-200 text-green-700 dark:text-green-400 dark:border-green-500/20' : 'bg-secondary/5 border-transparent text-text-secondary'}`}>
                                                                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${q.correct_answer === String.fromCharCode(65 + optIdx) ? 'bg-green-500 text-white' : 'bg-secondary/20 text-text-secondary'}`}>
                                                                    {String.fromCharCode(65 + optIdx)}
                                                                </span>
                                                                {opt}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex flex-col items-center gap-1">
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={(e: any) => { e.preventDefault(); handleEditQuestion(q) }}
                                                    className="text-blue-500 hover:text-blue-600 hover:bg-blue-50"
                                                    title="Edit"
                                                >
                                                    <Edit set="bold" primaryColor="currentColor" size={16} />
                                                </Button>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={(e: any) => { e.preventDefault(); openDeleteModal(q.id, 'question', q.question_text.substring(0, 50)) }}
                                                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                                    title="Hapus"
                                                >
                                                    <Delete set="bold" primaryColor="currentColor" size={20} />
                                                </Button>
                                            </div>
                                        </div>
                                    </label>
                                ))}
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-center gap-4 py-4">
                                    <button
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="p-2 rounded-lg hover:bg-secondary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <ChevronLeft className="w-5 h-5" />
                                    </button>
                                    <span className="text-sm text-text-secondary">
                                        Halaman <span className="font-bold text-text-main dark:text-white">{currentPage}</span> dari <span className="font-bold text-text-main dark:text-white">{totalPages}</span>
                                    </span>
                                    <button
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                        className="p-2 rounded-lg hover:bg-secondary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <ChevronRight className="w-5 h-5" />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Add Question Modal */}
            <Modal
                open={showAddModal}
                onClose={handleCloseModal}
                title="Tambah Soal"
                maxWidth="2xl"
            >
                <div className="space-y-5">
                    {/* Type Selection */}
                    <div className="grid grid-cols-2 gap-3">
                        <label className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-colors ${questionType === 'standalone' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-secondary/20 hover:border-blue-300'}`}>
                            <input
                                type="radio"
                                name="questionType"
                                value="standalone"
                                checked={questionType === 'standalone'}
                                onChange={() => setQuestionType('standalone')}
                                className="w-5 h-5"
                            />
                            <div>
                                <p className="font-bold text-text-main dark:text-white">📝 Soal Biasa</p>
                                <p className="text-xs text-text-secondary">Soal standalone</p>
                            </div>
                        </label>

                        <label className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-colors ${questionType === 'passage' ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20' : 'border-secondary/20 hover:border-teal-300'}`}>
                            <input
                                type="radio"
                                name="questionType"
                                value="passage"
                                checked={questionType === 'passage'}
                                onChange={() => setQuestionType('passage')}
                                className="w-5 h-5"
                            />
                            <div>
                                <p className="font-bold text-text-main dark:text-white">📖 Soal dengan Bacaan</p>
                                <p className="text-xs text-text-secondary">Passage + multiple soal</p>
                            </div>
                        </label>
                    </div>

                    {/* Image Upload */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-1">Gambar Soal</label>
                        {questionForm.image_url ? (
                            <div className="relative inline-block">
                                <img src={questionForm.image_url} alt="Preview" className="max-h-40 rounded-xl border border-secondary/20" />
                                <button
                                    onClick={() => setQuestionForm({ ...questionForm, image_url: '' })}
                                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"
                                >✕</button>
                            </div>
                        ) : (
                            <label className="flex items-center gap-2 px-4 py-3 bg-secondary/5 border-2 border-dashed border-secondary/30 rounded-xl cursor-pointer hover:border-primary/50 transition-colors">
                                <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span className="text-sm text-text-secondary">{uploading ? 'Mengupload...' : 'Upload Gambar (maks 5MB)'}</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    disabled={uploading}
                                    onChange={async (e) => {
                                        const file = e.target.files?.[0]
                                        if (file) {
                                            const url = await handleImageUpload(file)
                                            if (url) setQuestionForm({ ...questionForm, image_url: url })
                                        }
                                    }}
                                />
                            </label>
                        )}
                    </div>

                    {/* STANDALONE FORM */}
                    {questionType === 'standalone' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe Soal</label>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setQuestionForm({ ...questionForm, question_type: 'MULTIPLE_CHOICE', options: ['', '', '', ''], correct_answer: '' })}
                                        className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${questionForm.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-500 text-white' : 'bg-secondary/10 text-text-main hover:bg-secondary/20'}`}
                                    >
                                        Pilihan Ganda
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setQuestionForm({ ...questionForm, question_type: 'ESSAY', options: [], correct_answer: '' })}
                                        className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${questionForm.question_type === 'ESSAY' ? 'bg-amber-500 text-white' : 'bg-secondary/10 text-text-main hover:bg-secondary/20'}`}
                                    >
                                        Essay
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Mata Pelajaran</label>
                                    <select
                                        value={questionForm.subject_id}
                                        onChange={(e) => setQuestionForm({ ...questionForm, subject_id: e.target.value })}
                                        className="w-full px-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white"
                                    >
                                        <option value="">Pilih Mapel</option>
                                        {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kesulitan</label>
                                    <select
                                        value={questionForm.difficulty}
                                        onChange={(e) => setQuestionForm({ ...questionForm, difficulty: e.target.value as any })}
                                        className="w-full px-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white"
                                    >
                                        <option value="EASY">Mudah</option>
                                        <option value="MEDIUM">Sedang</option>
                                        <option value="HARD">Sulit</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pertanyaan *</label>
                                <MathTextarea
                                    value={questionForm.question_text}
                                    onChange={(val) => setQuestionForm({ ...questionForm, question_text: val })}
                                    rows={3}
                                    placeholder="Tulis soal..."
                                />
                            </div>

                            {questionForm.question_type === 'MULTIPLE_CHOICE' && (
                                <>
                                    <div className="grid grid-cols-2 gap-3">
                                        {(questionForm.options || ['','','','']).map((_, idx) => { const letter = String.fromCharCode(65 + idx); return (
                                            <div key={letter}>
                                                <label className="block text-sm font-bold text-text-main dark:text-white mb-1">Opsi {letter}</label>
                                                <input
                                                    type="text"
                                                    value={questionForm.options[idx] || ''}
                                                    onChange={(e) => {
                                                        const newOptions = [...questionForm.options]
                                                        newOptions[idx] = e.target.value
                                                        setQuestionForm({ ...questionForm, options: newOptions })
                                                    }}
                                                    placeholder={`Opsi ${letter}`}
                                                    className="w-full px-3 py-2 bg-secondary/5 border border-secondary/20 rounded-lg text-text-main dark:text-white text-sm"
                                                />
                                            </div>
                                        )})}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kunci Jawaban</label>
                                        <div className="flex gap-2">
                                            {(questionForm.options || ['','','','']).map((_, idx) => { const letter = String.fromCharCode(65 + idx); return (
                                                <button
                                                    key={letter}
                                                    type="button"
                                                    onClick={() => setQuestionForm({ ...questionForm, correct_answer: letter })}
                                                    className={`w-12 h-12 rounded-lg font-bold transition-colors ${questionForm.correct_answer === letter ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-main hover:bg-secondary/20'}`}
                                                >
                                                    {letter}
                                                </button>
                                            )})}
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* HOTS Claim Toggle */}
                            {aiReviewEnabled && (
                                <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl">
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={questionForm.teacher_hots_claim}
                                            onChange={e => setQuestionForm({ ...questionForm, teacher_hots_claim: e.target.checked })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                                    </label>
                                    <div>
                                        <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">🧠 Klaim HOTS</p>
                                        <p className="text-xs text-emerald-600 dark:text-emerald-400">Tandai soal ini sebagai Higher-Order Thinking</p>
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3 pt-4">
                                <Button variant="secondary" onClick={handleCloseModal} className="flex-1">Batal</Button>
                                <Button
                                    onClick={handleSubmitStandalone}
                                    disabled={saving || !questionForm.question_text.trim()}
                                    loading={saving}
                                    className="flex-1"
                                >
                                    {saving ? 'Menyimpan...' : 'Tambah Soal'}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* PASSAGE FORM */}
                    {questionType === 'passage' && (
                        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Bacaan (opsional)</label>
                                    <input
                                        type="text"
                                        value={passageForm.title}
                                        onChange={(e) => setPassageForm({ ...passageForm, title: e.target.value })}
                                        placeholder="Contoh: Dialog di Toko"
                                        className="w-full px-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Mata Pelajaran</label>
                                    <select
                                        value={passageForm.subject_id}
                                        onChange={(e) => setPassageForm({ ...passageForm, subject_id: e.target.value })}
                                        className="w-full px-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white"
                                    >
                                        <option value="">Pilih Mapel (opsional)</option>
                                        {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Teks Bacaan *</label>
                                <textarea
                                    value={passageForm.passage_text}
                                    onChange={(e) => setPassageForm({ ...passageForm, passage_text: e.target.value })}
                                    rows={6}
                                    placeholder="Masukkan teks bacaan/dialog..."
                                    className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white resize-none"
                                />
                            </div>

                            {/* Audio Upload */}
                            <div>
                                <label className="block text-sm font-bold text-violet-700 dark:text-violet-400 mb-2">🎧 Audio Listening (Opsional)</label>
                                {passageForm.audio_url ? (
                                    <div className="p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-300 dark:border-violet-700 rounded-xl space-y-2">
                                        <audio controls className="w-full" src={passageForm.audio_url} />
                                        <button onClick={() => setPassageForm({ ...passageForm, audio_url: '' })} className="text-sm text-red-500 hover:text-red-700 font-medium">✕ Hapus Audio</button>
                                    </div>
                                ) : (
                                    <div className="relative">
                                        <input type="file" accept="audio/*" onChange={async (e) => {
                                            const file = e.target.files?.[0]
                                            if (!file) return
                                            if (file.size > 25 * 1024 * 1024) { showToast('Maksimal ukuran audio 25MB.'); return }
                                            setUploadingAudio(true)
                                            try {
                                                const fd = new FormData(); fd.append('file', file)
                                                const res = await fetch('/api/audio/upload', { method: 'POST', body: fd })
                                                if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Upload gagal') }
                                                const { url } = await res.json()
                                                setPassageForm({ ...passageForm, audio_url: url })
                                            } catch (err: any) { showToast(err.message || 'Gagal upload audio') }
                                            finally { setUploadingAudio(false); e.target.value = '' }
                                        }} className="hidden" id="bank-passage-audio" disabled={uploadingAudio} />
                                        <label htmlFor="bank-passage-audio" className={`flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed border-violet-300 dark:border-violet-700 rounded-xl text-sm font-medium cursor-pointer transition-colors ${uploadingAudio ? 'opacity-50 cursor-wait' : 'text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20'}`}>
                                            {uploadingAudio ? '⏳ Mengupload...' : '🎵 Upload Audio (MP3, WAV, M4A, OGG — maks 25MB)'}
                                        </label>
                                    </div>
                                )}
                            </div>

                            <div className="border-t pt-4">
                                <div className="flex items-center justify-between mb-3">
                                    <label className="text-sm font-bold text-text-main dark:text-white">Soal-Soal ({passageForm.questions.length})</label>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleAddPassageQuestion}
                                        icon={<Plus set="bold" primaryColor="currentColor" size={16} />}
                                    >
                                        Tambah Soal
                                    </Button>
                                </div>

                                <div className="space-y-4">
                                    {passageForm.questions.map((pq, idx) => (
                                        <div key={idx} className="p-4 bg-secondary/5 rounded-xl border border-secondary/20">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-sm font-bold text-text-main dark:text-white">Soal {idx + 1}</span>
                                                {passageForm.questions.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemovePassageQuestion(idx)}
                                                        className="p-1 text-red-500 hover:bg-red-50 rounded"
                                                    >
                                                        <Delete set="bold" primaryColor="currentColor" size={16} />
                                                    </button>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 mb-3">
                                                <select
                                                    value={pq.question_type}
                                                    onChange={(e) => {
                                                        const newQuestions = [...passageForm.questions]
                                                        newQuestions[idx].question_type = e.target.value as any
                                                        setPassageForm({ ...passageForm, questions: newQuestions })
                                                    }}
                                                    className="px-3 py-2 bg-white dark:bg-surface-dark border border-secondary/20 rounded-lg text-sm"
                                                >
                                                    <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                                                    <option value="ESSAY">Essay</option>
                                                </select>
                                                <select
                                                    value={pq.difficulty}
                                                    onChange={(e) => {
                                                        const newQuestions = [...passageForm.questions]
                                                        newQuestions[idx].difficulty = e.target.value as any
                                                        setPassageForm({ ...passageForm, questions: newQuestions })
                                                    }}
                                                    className="px-3 py-2 bg-white dark:bg-surface-dark border border-secondary/20 rounded-lg text-sm"
                                                >
                                                    <option value="EASY">Mudah</option>
                                                    <option value="MEDIUM">Sedang</option>
                                                    <option value="HARD">Sulit</option>
                                                </select>
                                            </div>

                                            <MathTextarea
                                                value={pq.question_text}
                                                onChange={(val) => {
                                                    const newQuestions = [...passageForm.questions]
                                                    newQuestions[idx].question_text = val
                                                    setPassageForm({ ...passageForm, questions: newQuestions })
                                                }}
                                                rows={2}
                                                placeholder="Tulis pertanyaan..."
                                            />

                                            {pq.question_type === 'MULTIPLE_CHOICE' && (
                                                <div className="grid grid-cols-2 gap-2">
                                                    {(pq.options || ['','','','']).map((_, optIdx) => { const letter = String.fromCharCode(65 + optIdx); return (
                                                        <div key={letter} className="flex items-center gap-2">
                                                            <input
                                                                type="radio"
                                                                name={`correct-${idx}`}
                                                                checked={pq.correct_answer === letter}
                                                                onChange={() => {
                                                                    const newQuestions = [...passageForm.questions]
                                                                    newQuestions[idx].correct_answer = letter
                                                                    setPassageForm({ ...passageForm, questions: newQuestions })
                                                                }}
                                                                className="text-primary"
                                                            />
                                                            <input
                                                                type="text"
                                                                value={pq.options[optIdx] || ''}
                                                                onChange={(e) => {
                                                                    const newQuestions = [...passageForm.questions]
                                                                    const newOpts = [...pq.options]
                                                                    newOpts[optIdx] = e.target.value
                                                                    newQuestions[idx].options = newOpts
                                                                    setPassageForm({ ...passageForm, questions: newQuestions })
                                                                }}
                                                                placeholder={`Opsi ${letter}`}
                                                                className="flex-1 px-2 py-1.5 bg-white dark:bg-surface-dark border border-secondary/20 rounded text-sm"
                                                            />
                                                        </div>
                                                    )})}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex gap-3 pt-4 border-t">
                                <Button variant="secondary" onClick={handleCloseModal} className="flex-1">Batal</Button>
                                <Button
                                    onClick={handleSubmitPassage}
                                    disabled={saving || (!passageForm.passage_text.trim() && !passageForm.audio_url)}
                                    loading={saving}
                                    className="flex-1 bg-teal-500 hover:bg-teal-600"
                                >
                                    {saving ? 'Menyimpan...' : 'Simpan Passage'}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </Modal>

            {/* Export Confirmation Modal */}
            <Modal
                open={showExportConfirm}
                onClose={() => setShowExportConfirm(false)}
                title="Export ke Word"
                maxWidth="sm"
            >
                <div className="text-center py-4">
                    <div className="w-20 h-20 bg-blue-500/10 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
                        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                    </div>
                    <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Konfirmasi Export</h3>
                    <p className="text-text-secondary mb-8">
                        Kamu akan mengexport <span className="text-primary font-bold">{selectedIds.size} soal</span> terpilih ke dalam format Microsoft Word (.doc).
                    </p>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={() => setShowExportConfirm(false)} className="flex-1">
                            Batal
                        </Button>
                        <Button onClick={handleExport} className="flex-1">
                            Ya, Export Sekarang
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Edit Question Modal */}
            <Modal
                open={showEditQuestionModal}
                onClose={() => setShowEditQuestionModal(false)}
                title="Edit Soal"
                maxWidth="xl"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-1">Tipe Soal</label>
                        <select
                            value={editQuestionForm.question_type}
                            onChange={(e) => setEditQuestionForm({ ...editQuestionForm, question_type: e.target.value as 'ESSAY' | 'MULTIPLE_CHOICE' })}
                            className="w-full p-3 border border-secondary/30 rounded-xl bg-secondary/10 text-text-main"
                        >
                            <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                            <option value="ESSAY">Essay</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-1">Mata Pelajaran</label>
                        <select
                            value={editQuestionForm.subject_id}
                            onChange={(e) => setEditQuestionForm({ ...editQuestionForm, subject_id: e.target.value })}
                            className="w-full p-3 border border-secondary/30 rounded-xl bg-secondary/10 text-text-main"
                        >
                            <option value="">Pilih Mata Pelajaran</option>
                            {subjects.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-1">Kesulitan</label>
                        <select
                            value={editQuestionForm.difficulty}
                            onChange={(e) => setEditQuestionForm({ ...editQuestionForm, difficulty: e.target.value as 'EASY' | 'MEDIUM' | 'HARD' })}
                            className="w-full p-3 border border-secondary/30 rounded-xl bg-secondary/10 text-text-main"
                        >
                            <option value="EASY">Mudah</option>
                            <option value="MEDIUM">Sedang</option>
                            <option value="HARD">Sulit</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-1">Pertanyaan</label>
                        <MathTextarea
                            value={editQuestionForm.question_text}
                            onChange={(val) => setEditQuestionForm({ ...editQuestionForm, question_text: val })}
                            rows={4}
                            placeholder="Tulis pertanyaan..."
                        />
                    </div>
                    {editQuestionForm.question_type === 'MULTIPLE_CHOICE' && (
                        <div className="space-y-2">
                            <label className="block text-sm font-bold text-text-main dark:text-white">Pilihan Jawaban</label>
                            {editQuestionForm.options.map((opt, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                    <span className="w-8 h-8 rounded-full bg-secondary/20 flex items-center justify-center font-bold text-sm">
                                        {String.fromCharCode(65 + idx)}
                                    </span>
                                    <input
                                        type="text"
                                        value={opt}
                                        onChange={(e) => {
                                            const newOpts = [...editQuestionForm.options]
                                            newOpts[idx] = e.target.value
                                            setEditQuestionForm({ ...editQuestionForm, options: newOpts })
                                        }}
                                        className="flex-1 p-2 border border-secondary/30 rounded-lg bg-secondary/10"
                                        placeholder={`Pilihan ${String.fromCharCode(65 + idx)}`}
                                    />
                                    <input
                                        type="radio"
                                        name="editCorrectAnswer"
                                        checked={editQuestionForm.correct_answer === String.fromCharCode(65 + idx)}
                                        onChange={() => setEditQuestionForm({ ...editQuestionForm, correct_answer: String.fromCharCode(65 + idx) })}
                                        className="w-5 h-5"
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                    {/* HOTS Claim Toggle */}
                    {aiReviewEnabled && (
                        <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl">
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={editQuestionForm.teacher_hots_claim}
                                    onChange={e => setEditQuestionForm({ ...editQuestionForm, teacher_hots_claim: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                            </label>
                            <div>
                                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">🧠 Klaim HOTS</p>
                                <p className="text-xs text-emerald-600 dark:text-emerald-400">Tandai soal ini sebagai Higher-Order Thinking</p>
                            </div>
                        </div>
                    )}
                    <div className="flex gap-3 pt-4">
                        <Button variant="secondary" onClick={() => setShowEditQuestionModal(false)} className="flex-1">Batal</Button>
                        <Button onClick={handleSaveEditQuestion} disabled={saving} className="flex-1">
                            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Edit Passage Modal */}
            <Modal
                open={showEditPassageModal}
                onClose={() => setShowEditPassageModal(false)}
                title="Edit Passage"
                maxWidth="2xl"
            >
                <div className="space-y-5 max-h-[70vh] overflow-y-auto">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-1">Judul Bacaan (Opsional)</label>
                        <input
                            type="text"
                            value={editPassageForm.title}
                            onChange={(e) => setEditPassageForm({ ...editPassageForm, title: e.target.value })}
                            className="w-full p-3 border border-secondary/30 rounded-xl bg-secondary/10 text-text-main"
                            placeholder="Contoh: Teks Narasi - Cerita Rakyat"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-1">Teks Bacaan *</label>
                        <textarea
                            value={editPassageForm.passage_text}
                            onChange={(e) => setEditPassageForm({ ...editPassageForm, passage_text: e.target.value })}
                            className="w-full p-3 border border-secondary/30 rounded-xl bg-secondary/10 text-text-main min-h-[150px]"
                            placeholder="Tulis atau paste teks bacaan di sini..."
                        />
                    </div>

                    {/* Audio Upload */}
                    <div>
                        <label className="block text-sm font-bold text-violet-700 dark:text-violet-400 mb-1">🎧 Audio Listening (Opsional)</label>
                        {editPassageForm.audio_url ? (
                            <div className="p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-300 dark:border-violet-700 rounded-xl space-y-2">
                                <audio controls className="w-full" src={editPassageForm.audio_url} />
                                <button onClick={() => setEditPassageForm({ ...editPassageForm, audio_url: '' })} className="text-sm text-red-500 hover:text-red-700 font-medium">✕ Hapus Audio</button>
                            </div>
                        ) : (
                            <div className="relative">
                                <input type="file" accept="audio/*" onChange={async (e) => {
                                    const file = e.target.files?.[0]
                                    if (!file) return
                                    if (file.size > 25 * 1024 * 1024) { showToast('Maksimal ukuran audio 25MB.'); return }
                                    setUploadingAudio(true)
                                    try {
                                        const fd = new FormData(); fd.append('file', file)
                                        const res = await fetch('/api/audio/upload', { method: 'POST', body: fd })
                                        if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Upload gagal') }
                                        const { url } = await res.json()
                                        setEditPassageForm({ ...editPassageForm, audio_url: url })
                                    } catch (err: any) { showToast(err.message || 'Gagal upload audio') }
                                    finally { setUploadingAudio(false); e.target.value = '' }
                                }} className="hidden" id="bank-edit-passage-audio" disabled={uploadingAudio} />
                                <label htmlFor="bank-edit-passage-audio" className={`flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed border-violet-300 dark:border-violet-700 rounded-xl text-sm font-medium cursor-pointer transition-colors ${uploadingAudio ? 'opacity-50 cursor-wait' : 'text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20'}`}>
                                    {uploadingAudio ? '⏳ Mengupload...' : '🎵 Upload Audio (MP3, WAV, M4A, OGG — maks 25MB)'}
                                </label>
                            </div>
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-1">Mata Pelajaran</label>
                        <select
                            value={editPassageForm.subject_id}
                            onChange={(e) => setEditPassageForm({ ...editPassageForm, subject_id: e.target.value })}
                            className="w-full p-3 border border-secondary/30 rounded-xl bg-secondary/10 text-text-main"
                        >
                            <option value="">Pilih Mata Pelajaran</option>
                            {subjects.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Questions */}
                    <div className="border-t pt-4">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="font-bold text-text-main dark:text-white">Soal-soal ({editPassageForm.questions.length})</h4>
                            <Button variant="secondary" size="sm" onClick={handleAddEditPassageQuestion} icon={<Plus set="bold" primaryColor="currentColor" size={16} />}>
                                Tambah Soal
                            </Button>
                        </div>
                        <div className="space-y-4">
                            {editPassageForm.questions.map((q, idx) => (
                                <div key={idx} className="border border-secondary/20 rounded-xl p-4 bg-secondary/5">
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="font-bold text-sm">Soal #{idx + 1}</span>
                                        {editPassageForm.questions.length > 1 && (
                                            <button onClick={() => handleRemoveEditPassageQuestion(idx)} className="text-red-500 hover:text-red-600">
                                                <Delete set="bold" primaryColor="currentColor" size={16} />
                                            </button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 mb-3">
                                        <select
                                            value={q.question_type}
                                            onChange={(e) => {
                                                const newQs = [...editPassageForm.questions]
                                                newQs[idx].question_type = e.target.value as 'ESSAY' | 'MULTIPLE_CHOICE'
                                                setEditPassageForm({ ...editPassageForm, questions: newQs })
                                            }}
                                            className="p-2 border border-secondary/30 rounded-lg bg-secondary/10 text-sm"
                                        >
                                            <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                                            <option value="ESSAY">Essay</option>
                                        </select>
                                        <select
                                            value={q.difficulty}
                                            onChange={(e) => {
                                                const newQs = [...editPassageForm.questions]
                                                newQs[idx].difficulty = e.target.value as 'EASY' | 'MEDIUM' | 'HARD'
                                                setEditPassageForm({ ...editPassageForm, questions: newQs })
                                            }}
                                            className="p-2 border border-secondary/30 rounded-lg bg-secondary/10 text-sm"
                                        >
                                            <option value="EASY">Mudah</option>
                                            <option value="MEDIUM">Sedang</option>
                                            <option value="HARD">Sulit</option>
                                        </select>
                                    </div>
                                    <textarea
                                        value={q.question_text}
                                        onChange={(e) => {
                                            const newQs = [...editPassageForm.questions]
                                            newQs[idx].question_text = e.target.value
                                            setEditPassageForm({ ...editPassageForm, questions: newQs })
                                        }}
                                        className="w-full p-2 border border-secondary/30 rounded-lg bg-secondary/10 mb-2 text-sm"
                                        placeholder="Pertanyaan..."
                                        rows={2}
                                    />
                                    {q.question_type === 'MULTIPLE_CHOICE' && (
                                        <div className="grid grid-cols-2 gap-2">
                                            {q.options.map((opt, optIdx) => (
                                                <div key={optIdx} className="flex items-center gap-1">
                                                    <input
                                                        type="radio"
                                                        name={`editPassageQ${idx}`}
                                                        checked={q.correct_answer === String.fromCharCode(65 + optIdx)}
                                                        onChange={() => {
                                                            const newQs = [...editPassageForm.questions]
                                                            newQs[idx].correct_answer = String.fromCharCode(65 + optIdx)
                                                            setEditPassageForm({ ...editPassageForm, questions: newQs })
                                                        }}
                                                        className="w-4 h-4"
                                                    />
                                                    <span className="text-xs font-bold">{String.fromCharCode(65 + optIdx)}.</span>
                                                    <input
                                                        type="text"
                                                        value={opt}
                                                        onChange={(e) => {
                                                            const newQs = [...editPassageForm.questions]
                                                            newQs[idx].options[optIdx] = e.target.value
                                                            setEditPassageForm({ ...editPassageForm, questions: newQs })
                                                        }}
                                                        className="flex-1 p-1 border border-secondary/30 rounded text-xs bg-white dark:bg-surface-dark"
                                                        placeholder={`Pilihan ${String.fromCharCode(65 + optIdx)}`}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {/* HOTS Claim Toggle for Passage Question */}
                                    {aiReviewEnabled && (
                                        <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl mt-3">
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={q.teacher_hots_claim || false}
                                                    onChange={e => {
                                                        const newQs = [...editPassageForm.questions]
                                                        newQs[idx].teacher_hots_claim = e.target.checked
                                                        setEditPassageForm({ ...editPassageForm, questions: newQs })
                                                    }}
                                                    className="sr-only peer"
                                                />
                                                <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                                            </label>
                                            <div>
                                                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">🧠 Klaim HOTS</p>
                                                <p className="text-xs text-emerald-600 dark:text-emerald-400">Tandai soal ini sebagai Higher-Order Thinking</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4 border-t">
                        <Button variant="secondary" onClick={() => setShowEditPassageModal(false)} className="flex-1">Batal</Button>
                        <Button onClick={handleSaveEditPassage} disabled={saving} className="flex-1">
                            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Delete Confirmation Modal */}
            <Modal
                open={showDeleteModal}
                onClose={() => { setShowDeleteModal(false); setDeleteTargetId(null) }}
                title="Konfirmasi Hapus"
            >
                <div className="space-y-4">
                    <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
                        <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                            <Danger set="bold" primaryColor="currentColor" size={24} />
                        </div>
                        <div>
                            <p className="font-bold text-red-700 dark:text-red-400">
                                {deleteTargetType === 'passage' ? 'Hapus Passage?' : 'Hapus Soal?'}
                            </p>
                            <p className="text-sm text-red-600/80 dark:text-red-300/80">
                                {deleteTargetType === 'passage'
                                    ? 'Passage beserta semua soal di dalamnya akan dihapus permanen.'
                                    : 'Soal ini akan dihapus permanen dari Bank Soal.'}
                            </p>
                        </div>
                    </div>
                    {deleteTargetLabel && (
                        <p className="text-sm text-text-secondary px-1 line-clamp-2">
                            &quot;{deleteTargetLabel}...&quot;
                        </p>
                    )}
                    <div className="flex gap-3">
                        <Button
                            variant="secondary"
                            onClick={() => { setShowDeleteModal(false); setDeleteTargetId(null) }}
                            className="flex-1 justify-center"
                        >
                            Batal
                        </Button>
                        <Button
                            onClick={executeDelete}
                            disabled={deleting}
                            className="flex-1 justify-center bg-red-500 hover:bg-red-600 text-white"
                        >
                            {deleting ? 'Menghapus...' : 'Ya, Hapus'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Rapih AI Modal */}
            {showRapihAI && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                        <RapihAIModal
                            visible={showRapihAI}
                            onClose={() => setShowRapihAI(false)}
                            onSaveResults={handleSaveAIToBank}
                            onSaveToBank={handleSaveAIToBank}
                            saving={saving}
                            targetLabel="Bank Soal"
                            aiReviewEnabled={aiReviewEnabled}
                        />
                    </div>
                </div>
            )}

            {/* Toast notification */}
            {toast && (
                <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg border text-sm font-medium animate-in fade-in slide-in-from-bottom-3 duration-300 ${toast.type === 'success'
                    ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-300'
                    : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300'
                    }`}>
                    {toast.type === 'success' ? '✅' : '❌'} {toast.message}
                </div>
            )}
        </div>
    )
}
