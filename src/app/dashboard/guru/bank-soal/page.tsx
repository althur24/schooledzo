'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Modal, Button, PageHeader, EmptyState, Toast, type ToastType } from '@/components/ui'
import { Stepper } from '@/components/ui/Stepper'
import SmartText from '@/components/SmartText'
import Card from '@/components/ui/Card'
import QuestionOptionsEditor from '@/components/QuestionOptionsEditor'
import QuestionImageUpload from '@/components/QuestionImageUpload'
import FilterSelect from '@/components/FilterSelect'
import Pagination from '@/components/Pagination'
import TagInput from '@/components/TagInput'
import { TagBadge } from '@/components/BankQuestionPicker'
import HotsToggle from '@/components/HotsToggle'
import AudioUploadField from '@/components/AudioUploadField'
import ConfirmDialog from '@/components/ConfirmDialog'
import { AnswerOptionsView, TextAnswerView } from '@/components/QuestionAnswerView'
import {
    QuestionTypeBadge, DifficultyBadge, QuestionStatusBadge, SourceBadge, HotsBadge
} from '@/components/QuestionBadges'
// Dynamic imports for heavy components
const RapihAIModal = dynamic(() => import('@/components/RapihAIModal'), { ssr: false })
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), {
    ssr: false,
    loading: () => <textarea placeholder="Memuat editor..." className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main" rows={4} readOnly />
})
import { plainToHtml } from '@/lib/richTextUtils'
import {
    Folder, Plus, Document, Delete, Edit, Discovery, Paper, TickSquare,
    Search, Show, Swap, EditSquare, Voice, Download
} from 'react-iconly'
import { ChevronDown, ChevronUp, Copy } from 'lucide-react'

interface QuestionBankItem {
    id: string
    question_text: string
    question_type: string
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
    content_format?: 'html' | 'plain'
    source_type?: string
    source_name?: string
    tags?: string[] | null
}

interface Subject {
    id: string
    name: string
}

interface PassageQuestion {
    question_text: string
    question_type: string
    options: string[]
    correct_answer: string
    difficulty: 'EASY' | 'MEDIUM' | 'HARD'
    teacher_hots_claim?: boolean
    content_format?: 'html' | 'plain'
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
        question_type: string
        options: string[] | null
        correct_answer: string | null
        difficulty: 'EASY' | 'MEDIUM' | 'HARD'
        order_in_passage: number
        status?: string
        teacher_hots_claim?: boolean
        ai_review?: any
        admin_review?: any
        content_format?: 'html' | 'plain'
        source_type?: string
        source_name?: string
        tags?: string[] | null
    }>
    created_at: string
}

interface QuestionFormState {
    question_text: string
    question_type: string
    options: string[]
    correct_answer: string
    difficulty: 'EASY' | 'MEDIUM' | 'HARD'
    subject_id: string
    image_url: string
    teacher_hots_claim: boolean
    content_format: 'html' | 'plain'
    tags: string[]
}

interface PassageFormState {
    title: string
    passage_text: string
    audio_url: string
    subject_id: string
    questions: PassageQuestion[]
}

interface PreviewTarget {
    question_text: string
    question_type: string
    options: string[] | null
    correct_answer: string | null
    difficulty: string
    image_url?: string | null
    ai_review?: any
    passage?: { title: string | null; passage_text: string; audio_url?: string | null } | null
}

const ITEMS_PER_PAGE = 20

const WIZARD_STEPS = [
    { label: 'Tipe Soal' },
    { label: 'Isi Soal' },
    { label: 'Jawaban' },
    { label: 'Pengaturan' }
]

const QUESTION_TYPE_CARDS: Array<{ value: string; label: string; desc: string; icon: React.ReactNode }> = [
    { value: 'MULTIPLE_CHOICE', label: 'Pilihan Ganda', desc: 'Satu jawaban benar (A/B/C/D)', icon: <Paper set="bold" primaryColor="currentColor" size={28} /> },
    { value: 'MULTIPLE_ANSWER', label: 'Ganda Kompleks', desc: 'Lebih dari satu jawaban benar', icon: <TickSquare set="bold" primaryColor="currentColor" size={28} /> },
    { value: 'TRUE_FALSE', label: 'Benar / Salah', desc: 'Pernyataan benar atau salah', icon: <Swap set="bold" primaryColor="currentColor" size={28} /> },
    { value: 'SHORT_ANSWER', label: 'Isian Singkat', desc: 'Jawaban berupa kata/frasa', icon: <EditSquare set="bold" primaryColor="currentColor" size={28} /> },
    { value: 'ESSAY', label: 'Essay', desc: 'Jawaban uraian panjang', icon: <Document set="bold" primaryColor="currentColor" size={28} /> }
]

const emptyQuestionForm = (): QuestionFormState => ({
    question_text: '',
    question_type: 'MULTIPLE_CHOICE',
    options: ['', '', '', ''],
    correct_answer: '',
    difficulty: 'MEDIUM',
    subject_id: '',
    image_url: '',
    teacher_hots_claim: false,
    content_format: 'html',
    tags: []
})

const emptyPassageQuestion = (): PassageQuestion => ({
    question_text: '',
    question_type: 'MULTIPLE_CHOICE',
    options: ['', '', '', ''],
    correct_answer: '',
    difficulty: 'MEDIUM',
    teacher_hots_claim: false,
    content_format: 'html'
})

const emptyPassageForm = (): PassageFormState => ({
    title: '',
    passage_text: '',
    audio_url: '',
    subject_id: '',
    questions: [emptyPassageQuestion()]
})

// Helper to strip HTML tags for validation (RichTextEditor may output <p></p> for empty)
const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').trim()

// Ringkasan hasil AI review (bloom level, kekuatan HOTS, label kesulitan)
function AIReviewSummary({ review }: { review: any }) {
    if (!review || typeof review !== 'object' || !review.primary_bloom_level) return null
    const bloomLabels: Record<number, string> = {
        1: 'C1 Mengingat', 2: 'C2 Memahami', 3: 'C3 Menerapkan',
        4: 'C4 Menganalisis', 5: 'C5 Mengevaluasi', 6: 'C6 Mencipta'
    }
    const hotsLabels: Record<string, string> = { S0: 'LOTS', S1: 'HOTS Moderat', S2: 'HOTS Kuat' }
    const chip = 'px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/20 font-medium'
    return (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-xl">
            <p className="text-xs font-bold text-blue-700 dark:text-blue-300 mb-1.5 flex items-center gap-1">
                <Discovery set="bold" primaryColor="currentColor" size={14} /> Ringkasan AI Review
            </p>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className={chip}>{bloomLabels[review.primary_bloom_level] || `C${review.primary_bloom_level}`}</span>
                {review.hots_strength && <span className={chip}>{hotsLabels[review.hots_strength] || review.hots_strength}</span>}
                {review.difficulty_label && <span className={chip}>Kesulitan: {review.difficulty_label}</span>}
            </div>
        </div>
    )
}

export default function BankSoalPage() {
    const { user } = useAuth()
    const searchParams = useSearchParams()
    const [questions, setQuestions] = useState<QuestionBankItem[]>([])
    const [passages, setPassages] = useState<Passage[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<'standalone' | 'passages'>('standalone')

    // Filters (berlaku ke tab aktif)
    const [selectedSubject, setSelectedSubject] = useState('')
    const [selectedDifficulty, setSelectedDifficulty] = useState('')
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedType, setSelectedType] = useState('')
    const [selectedStatus, setSelectedStatus] = useState('')
    const [standalonePage, setStandalonePage] = useState(1)
    const [passagePage, setPassagePage] = useState(1)
    const [aiReviewEnabled, setAiReviewEnabled] = useState(true)
    // Gate Generate AI: default OFF untuk guru; admin menyalakan via school-settings.
    // Admin/super-admin yang membuka halaman guru selalu boleh (middleware mengizinkan).
    const [aiGenerateEnabled, setAiGenerateEnabled] = useState(false)

    // Filter tag (multi-tag, OR)
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    // Daftar tag yang sudah dipakai (filter chips + autocomplete)
    const [availableTags, setAvailableTags] = useState<string[]>([])

    // Selection mode for export
    const [selectionMode, setSelectionMode] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [selectedPassageIds, setSelectedPassageIds] = useState<Set<string>>(new Set())
    const [showExportConfirm, setShowExportConfirm] = useState(false)
    const [includeAnswerKey, setIncludeAnswerKey] = useState(true)

    // Delete confirmation state
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
    const [deleteTargetType, setDeleteTargetType] = useState<'question' | 'passage'>('question')
    const [deleteTargetLabel, setDeleteTargetLabel] = useState('')
    const [deleting, setDeleting] = useState(false)

    // Expand & preview state
    const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null)
    const [expandedPassageId, setExpandedPassageId] = useState<string | null>(null)
    const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null)

    // Wizard (Add & Edit soal satuan memakai form yang sama)
    const [showWizard, setShowWizard] = useState(false)
    const [wizardStep, setWizardStep] = useState(0)
    const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
    const [questionForm, setQuestionForm] = useState<QuestionFormState>(emptyQuestionForm())
    const [saving, setSaving] = useState(false)
    const [showRapihAI, setShowRapihAI] = useState(false)
    const [showAddDropdown, setShowAddDropdown] = useState(false)

    // Passage modal (Add & Edit passage memakai form yang sama)
    const [showPassageModal, setShowPassageModal] = useState(false)
    const [editingPassageId, setEditingPassageId] = useState<string | null>(null)
    const [passageForm, setPassageForm] = useState<PassageFormState>(emptyPassageForm())

    // Toast notification (design system)
    const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)
    const showToast = (message: string, type: ToastType = 'error') => setToast({ message, type })

    useEffect(() => {
        if (user) fetchData()
    }, [user])

    useEffect(() => {
        fetch('/api/school-settings').then(r => r.ok ? r.json() : null).then(d => {
            if (d) {
                setAiReviewEnabled(d.ai_review_enabled !== false)
                setAiGenerateEnabled(d.ai_generate_enabled === true)
            }
        }).catch(() => { })
    }, [])

    useEffect(() => {
        const statusParam = searchParams.get('status')
        if (statusParam) setSelectedStatus(statusParam)
    }, [searchParams])

    const fetchTags = () => {
        fetch('/api/question-bank/tags')
            .then(r => r.ok ? r.json() : [])
            .then((d: { tag: string }[]) => setAvailableTags(d.map(t => t.tag)))
            .catch(() => { })
    }

    useEffect(() => {
        fetchTags()
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

    // Setiap perubahan filter mereset halaman kedua tab
    const resetPages = () => { setStandalonePage(1); setPassagePage(1) }

    // ─── Delete ───
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
            const res = deleteTargetType === 'question'
                ? await fetch(`/api/question-bank?id=${deleteTargetId}`, { method: 'DELETE' })
                : await fetch(`/api/passages?id=${deleteTargetId}`, { method: 'DELETE' })
            if (!res.ok) throw new Error('Delete failed')
            await fetchData()
            setShowDeleteModal(false)
            setDeleteTargetId(null)
            showToast(deleteTargetType === 'question' ? 'Soal berhasil dihapus' : 'Passage berhasil dihapus', 'success')
        } catch (error) {
            console.error('Error:', error)
            showToast('Gagal menghapus')
        } finally {
            setDeleting(false)
        }
    }

    // ─── Duplikat soal ───
    const handleDuplicate = async (q: QuestionBankItem) => {
        setSaving(true)
        try {
            const res = await fetch('/api/question-bank', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_text: q.question_text,
                    question_type: q.question_type,
                    options: q.options,
                    correct_answer: q.correct_answer,
                    difficulty: q.difficulty,
                    subject_id: q.subject?.id || '',
                    image_url: q.image_url || '',
                    teacher_hots_claim: q.teacher_hots_claim || false,
                    content_format: q.content_format || 'html',
                    allow_duplicate: true // duplikasi eksplisit — bypass dedup server
                })
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error || 'Gagal menduplikat soal')
            }
            await fetchData()
            showToast('Soal diduplikat', 'success')
        } catch (error: any) {
            console.error('Error:', error)
            showToast(error?.message || 'Gagal menduplikat soal')
        } finally {
            setSaving(false)
        }
    }

    // ─── Wizard soal satuan (Add & Edit) ───
    const openAddWizard = () => {
        setEditingQuestionId(null)
        setQuestionForm(emptyQuestionForm())
        setWizardStep(0)
        setShowWizard(true)
    }

    const handleEditQuestion = (q: QuestionBankItem) => {
        setEditingQuestionId(q.id)
        setQuestionForm({
            question_text: q.content_format === 'html' ? q.question_text : plainToHtml(q.question_text),
            question_type: q.question_type,
            options: q.options || ['', '', '', ''],
            correct_answer: q.correct_answer || '',
            difficulty: q.difficulty,
            subject_id: q.subject?.id || '',
            image_url: q.image_url || '',
            teacher_hots_claim: q.teacher_hots_claim || false,
            content_format: 'html',
            tags: q.tags || []
        })
        setWizardStep(1) // Edit dibuka langsung di langkah isi soal (tipe bisa diubah via Kembali)
        setShowWizard(true)
    }

    const handleCloseWizard = () => {
        setShowWizard(false)
        setEditingQuestionId(null)
        setWizardStep(0)
        setSaving(false)
        setQuestionForm(emptyQuestionForm())
    }

    // Pilih tipe soal di langkah 1 wizard — reset opsi mengikuti tipe (logika lama)
    const handleWizardTypeChange = (newType: string) => {
        const prevType = questionForm.question_type
        let newOpts: string[] = []
        if (['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(newType)) {
            newOpts = ['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(prevType) && questionForm.options?.length
                ? questionForm.options
                : ['', '', '', '']
        } else if (newType === 'TRUE_FALSE') {
            newOpts = ['Benar', 'Salah']
        }
        setQuestionForm({ ...questionForm, question_type: newType, options: newOpts, correct_answer: '' })
    }

    const validateQuestionForm = (): boolean => {
        if (!stripHtml(questionForm.question_text)) {
            showToast('Pertanyaan tidak boleh kosong'); return false
        }
        if (['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(questionForm.question_type)) {
            if (!questionForm.options || questionForm.options.filter(o => o.trim()).length < 2) {
                showToast('Minimal 2 opsi jawaban harus diisi'); return false
            }
            if (!questionForm.correct_answer) {
                showToast('Jawaban benar harus dipilih'); return false
            }
        }
        if (questionForm.question_type === 'TRUE_FALSE' && !questionForm.correct_answer) {
            showToast('Jawaban benar harus dipilih'); return false
        }
        if (questionForm.question_type === 'SHORT_ANSWER' && !questionForm.correct_answer.trim()) {
            showToast('Jawaban benar harus diisi'); return false
        }
        return true
    }

    // addAnother=true → "Simpan & Tambah Lagi": simpan, reset form (tipe tetap), kembali ke langkah Isi Soal
    const handleSaveQuestion = async (addAnother: boolean) => {
        if (!validateQuestionForm()) return
        setSaving(true)
        try {
            const res = editingQuestionId
                ? await fetch(`/api/question-bank?id=${editingQuestionId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(questionForm)
                })
                : await fetch('/api/question-bank', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(questionForm)
                })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error || 'Gagal menyimpan soal')
            await fetchData()
            fetchTags()
            if (addAnother && !editingQuestionId) {
                const keepType = questionForm.question_type
                const keepSubject = questionForm.subject_id
                setQuestionForm({ ...emptyQuestionForm(), question_type: keepType, subject_id: keepSubject, options: keepType === 'TRUE_FALSE' ? ['Benar', 'Salah'] : ['', '', '', ''] })
                setWizardStep(1)
                showToast('Soal berhasil ditambahkan! Silakan tambah soal berikutnya.', 'success')
            } else {
                handleCloseWizard()
                showToast(editingQuestionId ? 'Soal berhasil diperbarui!' : 'Soal berhasil ditambahkan!', 'success')
            }
        } catch (error: any) {
            console.error('Error:', error)
            showToast(error?.message || 'Gagal menyimpan soal')
        } finally {
            setSaving(false)
        }
    }

    // ─── Passage modal (Add & Edit) ───
    const openAddPassageModal = () => {
        setEditingPassageId(null)
        setPassageForm(emptyPassageForm())
        setShowPassageModal(true)
    }

    const handleEditPassage = (p: Passage) => {
        setEditingPassageId(p.id)
        setPassageForm({
            title: p.title || '',
            passage_text: p.passage_text,
            audio_url: p.audio_url || '',
            subject_id: p.subject?.id || '',
            questions: p.questions?.map(q => ({
                question_text: q.content_format === 'html' ? q.question_text : plainToHtml(q.question_text),
                question_type: q.question_type,
                options: q.options || ['', '', '', ''],
                correct_answer: q.correct_answer || '',
                difficulty: q.difficulty,
                teacher_hots_claim: q.teacher_hots_claim || false,
                content_format: 'html' as 'html' | 'plain'
            })) || []
        })
        setShowPassageModal(true)
    }

    const handleClosePassageModal = () => {
        setShowPassageModal(false)
        setEditingPassageId(null)
        setSaving(false)
        setPassageForm(emptyPassageForm())
    }

    const handleSavePassage = async () => {
        // Validasi (add: lengkap; edit: sama seperti form lama — minimal bacaan/audio)
        if (!passageForm.passage_text.trim() && !passageForm.audio_url) {
            showToast('Teks bacaan atau audio harus diisi'); return
        }
        if (!editingPassageId) {
            const filledQuestions = passageForm.questions.filter(q => stripHtml(q.question_text))
            if (filledQuestions.length === 0) {
                showToast('Minimal 1 pertanyaan harus diisi'); return
            }
            for (let i = 0; i < filledQuestions.length; i++) {
                const q = filledQuestions[i]
                if (['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(q.question_type)) {
                    if (!q.options || q.options.filter(o => o.trim()).length < 2) {
                        showToast(`Soal ${i + 1}: Minimal 2 opsi jawaban harus diisi`); return
                    }
                    if (!q.correct_answer) {
                        showToast(`Soal ${i + 1}: Jawaban benar harus dipilih`); return
                    }
                }
                if (q.question_type === 'TRUE_FALSE' && !q.correct_answer) {
                    showToast(`Soal ${i + 1}: Jawaban benar harus dipilih`); return
                }
                if (q.question_type === 'SHORT_ANSWER' && !q.correct_answer.trim()) {
                    showToast(`Soal ${i + 1}: Jawaban benar harus diisi`); return
                }
            }
        }

        setSaving(true)
        try {
            const res = editingPassageId
                ? await fetch(`/api/passages?id=${editingPassageId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(passageForm)
                })
                : await fetch('/api/passages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(passageForm)
                })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error || 'Gagal menyimpan passage')
            }
            await fetchData()
            const wasEditing = !!editingPassageId
            handleClosePassageModal()
            showToast(wasEditing ? 'Passage berhasil diperbarui!' : 'Passage berhasil ditambahkan!', 'success')
        } catch (error: any) {
            console.error('Error:', error)
            showToast(error?.message || 'Gagal menyimpan passage')
        } finally {
            setSaving(false)
        }
    }

    const handleAddPassageQuestion = () => {
        setPassageForm({ ...passageForm, questions: [...passageForm.questions, emptyPassageQuestion()] })
    }

    const handleRemovePassageQuestion = (index: number) => {
        if (passageForm.questions.length > 1) {
            setPassageForm({ ...passageForm, questions: passageForm.questions.filter((_, i) => i !== index) })
        }
    }

    const updatePassageQuestion = (index: number, updater: (q: PassageQuestion) => PassageQuestion) => {
        const newQuestions = [...passageForm.questions]
        newQuestions[index] = updater(newQuestions[index])
        setPassageForm({ ...passageForm, questions: newQuestions })
    }

    const handlePassageQuestionTypeChange = (index: number, newType: string) => {
        updatePassageQuestion(index, (q) => {
            let newOpts: string[] = []
            if (['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(newType)) {
                newOpts = ['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(q.question_type) && q.options?.length
                    ? q.options
                    : ['', '', '', '']
            } else if (newType === 'TRUE_FALSE') {
                newOpts = ['Benar', 'Salah']
            }
            return { ...q, question_type: newType, options: newOpts, correct_answer: '' }
        })
    }

    // ─── Filters ───
    const filteredQuestions = questions.filter((q) => {
        if (selectedSubject && q.subject?.id !== selectedSubject) return false
        if (selectedDifficulty && q.difficulty !== selectedDifficulty) return false
        if (selectedType && q.question_type !== selectedType) return false
        if (selectedStatus && q.status !== selectedStatus) return false
        if (selectedTags.length > 0 && !(q.tags || []).some(t => selectedTags.includes(t))) return false
        if (searchQuery && !q.question_text.toLowerCase().includes(searchQuery.toLowerCase())) return false
        return true
    })

    const filteredPassages = passages.filter((p) => {
        if (selectedSubject && p.subject?.id !== selectedSubject) return false
        if (selectedDifficulty && !p.questions?.some(q => q.difficulty === selectedDifficulty)) return false
        if (selectedType && !p.questions?.some(q => q.question_type === selectedType)) return false
        if (selectedStatus && !p.questions?.some(q => q.status === selectedStatus)) return false
        if (selectedTags.length > 0 && !p.questions?.some(q => (q.tags || []).some(t => selectedTags.includes(t)))) return false
        if (searchQuery) {
            const passageMatch = p.passage_text.toLowerCase().includes(searchQuery.toLowerCase())
            const titleMatch = p.title?.toLowerCase().includes(searchQuery.toLowerCase())
            const questionMatch = p.questions?.some(q => q.question_text.toLowerCase().includes(searchQuery.toLowerCase()))
            if (!passageMatch && !titleMatch && !questionMatch) return false
        }
        return true
    })

    // Pagination per tab
    const paginatedQuestions = filteredQuestions.slice(
        (standalonePage - 1) * ITEMS_PER_PAGE,
        standalonePage * ITEMS_PER_PAGE
    )
    const paginatedPassages = filteredPassages.slice(
        (passagePage - 1) * ITEMS_PER_PAGE,
        passagePage * ITEMS_PER_PAGE
    )

    // ─── Selection mode ───
    const totalSelected = selectedIds.size + selectedPassageIds.size

    const toggleSelectionMode = () => {
        if (selectionMode) {
            setSelectedIds(new Set())
            setSelectedPassageIds(new Set())
        }
        setSelectionMode(!selectionMode)
    }

    const toggleSelectAll = () => {
        if (activeTab === 'standalone') {
            const allSelected = selectedIds.size === filteredQuestions.length && filteredQuestions.length > 0
            setSelectedIds(allSelected ? new Set() : new Set(filteredQuestions.map(q => q.id)))
        } else {
            const allSelected = selectedPassageIds.size === filteredPassages.length && filteredPassages.length > 0
            setSelectedPassageIds(allSelected ? new Set() : new Set(filteredPassages.map(p => p.id)))
        }
    }

    const toggleSelectQuestion = (id: string) => {
        const newSet = new Set(selectedIds)
        if (newSet.has(id)) newSet.delete(id)
        else newSet.add(id)
        setSelectedIds(newSet)
    }

    const toggleSelectPassage = (id: string) => {
        const newSet = new Set(selectedPassageIds)
        if (newSet.has(id)) newSet.delete(id)
        else newSet.add(id)
        setSelectedPassageIds(newSet)
    }

    // ─── Bulk actions (tag massal & hapus massal) — berlaku untuk soal satuan terpilih ───
    const [showBulkTagModal, setShowBulkTagModal] = useState(false)
    const [bulkTagMode, setBulkTagMode] = useState<'add_tags' | 'remove_tags' | 'set_tags'>('add_tags')
    const [bulkTagForm, setBulkTagForm] = useState<string[]>([])
    const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)

    const openBulkTagModal = (mode: 'add_tags' | 'remove_tags' | 'set_tags') => {
        setBulkTagMode(mode)
        setBulkTagForm([])
        setShowBulkTagModal(true)
    }

    const handleBulkTag = async () => {
        if (selectedIds.size === 0 || bulkTagForm.length === 0) return
        setSaving(true)
        try {
            const res = await fetch('/api/question-bank/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: bulkTagMode, ids: Array.from(selectedIds), tags: bulkTagForm })
            })
            if (!res.ok) throw new Error('Gagal memperbarui tag')
            await fetchData()
            fetchTags()
            setShowBulkTagModal(false)
            showToast(`Tag ${selectedIds.size} soal berhasil diperbarui`, 'success')
        } catch (error: any) {
            showToast(error?.message || 'Gagal memperbarui tag')
        } finally {
            setSaving(false)
        }
    }

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return
        setDeleting(true)
        try {
            const res = await fetch(`/api/question-bank?ids=${Array.from(selectedIds).join(',')}`, { method: 'DELETE' })
            if (!res.ok) throw new Error('Gagal menghapus soal')
            await fetchData()
            fetchTags()
            setSelectedIds(new Set())
            setShowBulkDeleteModal(false)
            showToast(`${selectedIds.size} soal berhasil dihapus`, 'success')
        } catch (error: any) {
            showToast(error?.message || 'Gagal menghapus soal')
        } finally {
            setDeleting(false)
        }
    }

    // ─── Export Word (.doc) — logika sama persis dengan implementasi lama ───
    const handleExport = () => {
        const questionsToExport = filteredQuestions.filter(q => selectedIds.has(q.id))
        const passagesToExport = filteredPassages.filter(p => selectedPassageIds.has(p.id))
        let questionNumber = 0

        // Helper: render options/answer for any question type
        // includeAnswerKey=false → lembar soal polos untuk siswa (tanpa tanda jawaban/rubrik)
        const renderOptionsHtml = (q: { question_type: string; options?: string[] | null; correct_answer?: string | null }) => {
            if (['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(q.question_type) && q.options) {
                let correctLetters: string[] = []
                if (q.question_type === 'MULTIPLE_ANSWER') {
                    try { correctLetters = JSON.parse(q.correct_answer || '[]') } catch { correctLetters = [] }
                }
                return `
                    <ul style="list-style:none; padding-left:20px; margin:0;">
                        ${q.options.map((opt, optIdx) => {
                            const letter = String.fromCharCode(65 + optIdx)
                            const isCorrect = includeAnswerKey && (q.question_type === 'MULTIPLE_ANSWER'
                                ? correctLetters.includes(letter)
                                : q.correct_answer === letter)
                            return `
                                <li style="margin-bottom: 4px; ${isCorrect ? 'font-weight:bold; color:green;' : ''}">
                                    ${letter}. ${opt}
                                </li>`
                        }).join('')}
                    </ul>`
            }
            if (q.question_type === 'TRUE_FALSE' && q.options) {
                return `
                    <ul style="list-style:none; padding-left:20px; margin:0;">
                        ${q.options.map(opt => {
                            const isCorrect = includeAnswerKey && q.correct_answer?.toUpperCase() === opt.toUpperCase()
                            return `<li style="margin-bottom: 4px; ${isCorrect ? 'font-weight:bold; color:green;' : ''}">${opt}</li>`
                        }).join('')}
                    </ul>`
            }
            if (includeAnswerKey && q.question_type === 'SHORT_ANSWER' && q.correct_answer) {
                return `<p style="margin-top:8px; padding-left:20px;"><strong>Jawaban:</strong> <span style="color:green;">${q.correct_answer}</span></p>`
            }
            if (includeAnswerKey && q.question_type === 'ESSAY' && q.correct_answer) {
                return `<p style="margin-top:8px; padding-left:20px;"><strong>Rubrik:</strong> <span style="color:#555;">${q.correct_answer}</span></p>`
            }
            return ''
        }

        const passageHtml = passagesToExport.map(p => `
            <div style="margin-bottom: 32px; page-break-inside: avoid; border: 1px solid #ddd; padding: 16px; border-radius: 8px;">
                <h3 style="margin-bottom: 8px;">${p.title || 'Bacaan'}</h3>
                <p style="margin-bottom: 16px; color:#444; white-space: pre-wrap;">${p.passage_text}</p>
                ${(p.questions || []).map(q => {
            questionNumber++
            return `<div style="margin-bottom: 12px;">
                        <p style="margin-bottom: 4px;"><strong>${questionNumber}. ${q.question_text}</strong></p>
                        ${renderOptionsHtml(q)}
                    </div>`
        }).join('')}
            </div>
        `).join('')

        const standaloneHtml = questionsToExport.map(q => {
            questionNumber++
            return `<div style="margin-bottom: 24px; page-break-inside: avoid;">
                <p style="margin-bottom: 8px;"><strong>${questionNumber}. ${q.question_text}</strong></p>
                ${renderOptionsHtml(q)}
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
        a.download = includeAnswerKey ? 'Bank_Soal_dengan_Kunci.doc' : 'Lembar_Soal_tanpa_Kunci.doc'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        setShowExportConfirm(false)
        setSelectedIds(new Set())
        setSelectedPassageIds(new Set())
        setSelectionMode(false)
    }

    // ─── Rapih AI: simpan hasil AI langsung ke bank soal ───
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
                        subject_id: selectedSubject || null,
                        teacher_hots_claim: q.teacher_hots_claim || false,
                        content_format: 'html',
                        tags: q.tags || null
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
                            difficulty: q.difficulty || 'MEDIUM',
                            teacher_hots_claim: q.teacher_hots_claim || false,
                            content_format: 'html'
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
                            <p className="text-xl font-bold text-primary">{questions.length + passages.reduce((acc, p) => acc + (p.questions?.length || 0), 0)}</p>
                            <p className="text-xs text-text-secondary">Total Soal</p>
                        </div>
                        <Button
                            variant={selectionMode ? 'secondary' : 'outline'}
                            onClick={toggleSelectionMode}
                            icon={<TickSquare set="bold" primaryColor="currentColor" size={20} />}
                            aria-label={selectionMode ? 'Keluar dari mode pilih' : 'Aktifkan mode pilih dan export'}
                        >
                            {selectionMode ? 'Selesai' : 'Pilih & Export'}
                        </Button>
                        <div className="relative inline-block">
                            <button
                                onClick={() => setShowAddDropdown(!showAddDropdown)}
                                className="flex items-center gap-2 px-5 py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 active:scale-95 transition-all shadow-md shadow-primary/20 cursor-pointer"
                                data-tutorial="bank-add-btn"
                            >
                                <Plus set="bold" primaryColor="currentColor" size={20} />
                                Tambah Soal
                            </button>
                            {showAddDropdown && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowAddDropdown(false)} />
                                    <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-white dark:bg-surface-dark rounded-xl shadow-xl border border-secondary/20 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                        <button
                                            onClick={() => {
                                                openAddWizard()
                                                setShowAddDropdown(false)
                                            }}
                                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer"
                                        >
                                            <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 text-blue-600 dark:text-blue-300">
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
                                            data-tutorial="bank-ai-btn"
                                        >
                                            <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0 text-purple-600 dark:text-purple-300">
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
                    </div>
                }
            />

            {/* Tabs */}
            <div className="flex gap-2 border-b border-secondary/20">
                <button
                    onClick={() => setActiveTab('standalone')}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-t-xl border-b-2 -mb-px transition-colors cursor-pointer ${activeTab === 'standalone'
                        ? 'border-primary text-primary bg-primary/5'
                        : 'border-transparent text-text-secondary hover:text-text-main hover:bg-secondary/5'
                        }`}
                >
                    <Paper set="bold" primaryColor="currentColor" size={18} />
                    Soal Satuan ({filteredQuestions.length})
                </button>
                <button
                    onClick={() => setActiveTab('passages')}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-t-xl border-b-2 -mb-px transition-colors cursor-pointer ${activeTab === 'passages'
                        ? 'border-primary text-primary bg-primary/5'
                        : 'border-transparent text-text-secondary hover:text-text-main hover:bg-secondary/5'
                        }`}
                >
                    <Document set="bold" primaryColor="currentColor" size={18} />
                    Bacaan & Listening ({filteredPassages.length})
                </button>
            </div>

            {/* Search & Filters */}
            <div className="space-y-3" data-tutorial="bank-filters">
                <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">
                        <Search set="light" primaryColor="currentColor" size={20} />
                    </div>
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); resetPages() }}
                        placeholder={activeTab === 'standalone' ? 'Cari soal berdasarkan kata kunci...' : 'Cari bacaan atau soal di dalamnya...'}
                        className="w-full pl-10 pr-4 py-3 bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary"
                    />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <FilterSelect
                        value={selectedSubject}
                        onChange={(v) => { setSelectedSubject(v); resetPages() }}
                        placeholder="Semua Mata Pelajaran"
                        ariaLabel="Filter mata pelajaran"
                        options={subjects.map(s => ({ value: s.id, label: s.name }))}
                    />
                    <FilterSelect
                        value={selectedDifficulty}
                        onChange={(v) => { setSelectedDifficulty(v); resetPages() }}
                        placeholder="Semua Kesulitan"
                        ariaLabel="Filter kesulitan"
                        options={[
                            { value: 'EASY', label: 'Mudah' },
                            { value: 'MEDIUM', label: 'Sedang' },
                            { value: 'HARD', label: 'Sulit' }
                        ]}
                    />
                    <FilterSelect
                        value={selectedType}
                        onChange={(v) => { setSelectedType(v); resetPages() }}
                        placeholder="Semua Tipe"
                        ariaLabel="Filter tipe soal"
                        options={[
                            { value: 'MULTIPLE_CHOICE', label: 'Pilihan Ganda' },
                            { value: 'MULTIPLE_ANSWER', label: 'Ganda Kompleks' },
                            { value: 'TRUE_FALSE', label: 'Benar Salah' },
                            { value: 'SHORT_ANSWER', label: 'Isian Singkat' },
                            { value: 'ESSAY', label: 'Essay' }
                        ]}
                    />
                    <FilterSelect
                        value={selectedStatus}
                        onChange={(v) => { setSelectedStatus(v); resetPages() }}
                        placeholder="Semua Status"
                        ariaLabel="Filter status soal"
                        options={[
                            { value: 'approved', label: '✅ Approved' },
                            ...(aiReviewEnabled ? [
                                { value: 'ai_reviewing', label: '🤖 AI Review' },
                                { value: 'admin_review', label: '⚠️ Perlu Review' }
                            ] : []),
                            { value: 'returned', label: '❌ Dikembalikan' },
                            { value: 'draft', label: '📝 Draft' }
                        ]}
                    />
                </div>
                {availableTags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-text-secondary">Tag:</span>
                        {availableTags.slice(0, 20).map((tag) => (
                            <button
                                key={tag}
                                onClick={() => { setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]); resetPages() }}
                                className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors cursor-pointer ${selectedTags.includes(tag)
                                    ? 'bg-primary text-white border-primary'
                                    : 'bg-secondary/10 text-text-secondary border-secondary/20 hover:border-primary/40 hover:text-primary'
                                    }`}
                            >
                                #{tag}
                            </button>
                        ))}
                        {selectedTags.length > 0 && (
                            <button
                                onClick={() => { setSelectedTags([]); resetPages() }}
                                className="px-2.5 py-1 text-xs font-medium rounded-full border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                            >
                                Hapus Filter Tag
                            </button>
                        )}
                    </div>
                )}
                {(searchQuery || selectedSubject || selectedDifficulty || selectedType || selectedStatus || selectedTags.length > 0) && (
                    <span className="text-xs text-text-secondary">
                        Ditemukan: {filteredQuestions.length} soal, {filteredPassages.length} bacaan
                    </span>
                )}
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin text-primary"><Discovery set="bold" primaryColor="currentColor" size={40} /></div>
                </div>
            ) : filteredQuestions.length === 0 && filteredPassages.length === 0 ? (
                <EmptyState
                    icon={<div className="text-secondary"><Folder set="bold" primaryColor="currentColor" size={48} /></div>}
                    title="Bank Soal Kosong"
                    description="Belum ada soal yang tersimpan. Tambahkan soal secara manual, atau gunakan Rapih AI untuk merapikan dan membuat soal secara otomatis."
                    action={
                        <div className="flex flex-wrap justify-center gap-3">
                            <Button onClick={openAddWizard} icon={<Plus set="bold" primaryColor="currentColor" size={18} />}>
                                Tambah Soal Manual
                            </Button>
                            <Button variant="secondary" onClick={() => setShowRapihAI(true)} icon={<Discovery set="bold" primaryColor="currentColor" size={18} />}>
                                Rapih AI
                            </Button>
                        </div>
                    }
                />
            ) : activeTab === 'standalone' ? (
                /* ─── TAB: SOAL SATUAN ─── */
                paginatedQuestions.length === 0 ? (
                    <div className="text-center py-12 text-text-secondary text-sm bg-white dark:bg-surface-dark rounded-2xl border border-secondary/20">
                        Tidak ada soal satuan yang cocok dengan filter. Coba tab Bacaan & Listening.
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4">
                            {paginatedQuestions.map((q, idx) => {
                                const isExpanded = expandedQuestionId === q.id
                                return (
                                    <Card
                                        key={q.id}
                                        padding="p-5"
                                        className={`transition-all hover:shadow-md ${selectionMode && selectedIds.has(q.id)
                                            ? 'border-primary bg-primary/5 dark:bg-primary/10'
                                            : 'hover:border-primary/30'
                                            }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            {selectionMode && (
                                                <div className="pt-1">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.has(q.id)}
                                                        onChange={() => toggleSelectQuestion(q.id)}
                                                        aria-label={`Pilih soal nomor ${(standalonePage - 1) * ITEMS_PER_PAGE + idx + 1}`}
                                                        className="w-5 h-5 rounded-md border-secondary/30 text-primary focus:ring-primary bg-secondary/10 cursor-pointer"
                                                    />
                                                </div>
                                            )}
                                            <div className="w-8 h-8 rounded-lg bg-secondary/10 text-primary flex items-center justify-center font-bold text-sm flex-shrink-0">
                                                {(standalonePage - 1) * ITEMS_PER_PAGE + idx + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-3 flex-wrap">
                                                    <QuestionTypeBadge type={q.question_type} />
                                                    <DifficultyBadge difficulty={q.difficulty} />
                                                    <SourceBadge source={q.source_type} sourceName={q.source_name} />
                                                    <QuestionStatusBadge status={q.status} aiReviewEnabled={aiReviewEnabled} />
                                                    {aiReviewEnabled && q.teacher_hots_claim && <HotsBadge />}
                                                    {(q.tags || []).map((t: string) => (
                                                        <TagBadge key={t} tag={t} />
                                                    ))}
                                                    {q.subject && (
                                                        <span className="inline-flex items-center px-2 py-0.5 text-xs rounded-full font-medium border bg-secondary/10 text-text-secondary border-secondary/20">
                                                            {q.subject.name}
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => setExpandedQuestionId(isExpanded ? null : q.id)}
                                                    className="w-full text-left cursor-pointer"
                                                    aria-expanded={isExpanded}
                                                >
                                                    <SmartText
                                                        text={q.question_text}
                                                        className={`text-text-main dark:text-white font-medium leading-relaxed ${isExpanded ? 'text-lg' : 'line-clamp-2'}`}
                                                    />
                                                </button>

                                                {isExpanded && (
                                                    <div className="mt-4 pt-4 border-t border-secondary/20 space-y-4">
                                                        {q.image_url && (
                                                            <img src={q.image_url} alt="Gambar soal" className="max-h-56 rounded-xl border border-secondary/20" />
                                                        )}
                                                        <AnswerOptionsView questionType={q.question_type} options={q.options} correctAnswer={q.correct_answer} />
                                                        <TextAnswerView questionType={q.question_type} correctAnswer={q.correct_answer} />
                                                        {q.status === 'returned' && q.admin_review?.notes && (
                                                            <div className="p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                                                                <p className="text-xs font-bold text-amber-700 dark:text-amber-300 mb-0.5">📋 Alasan Pengembalian dari Admin:</p>
                                                                <p className="text-xs text-amber-600 dark:text-amber-400">{q.admin_review.notes}</p>
                                                            </div>
                                                        )}
                                                        <AIReviewSummary review={q.ai_review} />
                                                        <div className="flex flex-wrap gap-2 pt-1">
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                aria-label="Preview soal"
                                                                icon={<Show set="bold" primaryColor="currentColor" size={16} />}
                                                                onClick={() => setPreviewTarget({
                                                                    question_text: q.question_text,
                                                                    question_type: q.question_type,
                                                                    options: q.options,
                                                                    correct_answer: q.correct_answer,
                                                                    difficulty: q.difficulty,
                                                                    image_url: q.image_url,
                                                                    ai_review: q.ai_review
                                                                })}
                                                            >
                                                                Preview
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                aria-label="Duplikat soal"
                                                                icon={<Copy className="w-4 h-4" />}
                                                                onClick={() => handleDuplicate(q)}
                                                                disabled={saving}
                                                            >
                                                                Duplikat
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="secondary"
                                                                aria-label="Edit soal"
                                                                icon={<Edit set="bold" primaryColor="currentColor" size={16} />}
                                                                onClick={() => handleEditQuestion(q)}
                                                            >
                                                                Edit
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="danger"
                                                                aria-label="Hapus soal"
                                                                icon={<Delete set="bold" primaryColor="currentColor" size={16} />}
                                                                onClick={() => openDeleteModal(q.id, 'question', q.question_text.replace(/<[^>]*>/g, '').substring(0, 50))}
                                                            >
                                                                Hapus
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => setExpandedQuestionId(isExpanded ? null : q.id)}
                                                aria-label={isExpanded ? 'Tutup detail soal' : 'Buka detail soal'}
                                                aria-expanded={isExpanded}
                                                className="p-2 rounded-lg hover:bg-secondary/10 text-text-secondary transition-colors flex-shrink-0"
                                            >
                                                {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                            </button>
                                        </div>
                                    </Card>
                                )
                            })}
                        </div>
                        <Pagination
                            currentPage={standalonePage}
                            totalItems={filteredQuestions.length}
                            itemsPerPage={ITEMS_PER_PAGE}
                            onPageChange={setStandalonePage}
                            itemLabel="soal"
                        />
                    </div>
                )
            ) : (
                /* ─── TAB: BACAAN & LISTENING ─── */
                paginatedPassages.length === 0 ? (
                    <div className="text-center py-12 text-text-secondary text-sm bg-white dark:bg-surface-dark rounded-2xl border border-secondary/20">
                        Tidak ada bacaan yang cocok dengan filter. Coba tab Soal Satuan.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {paginatedPassages.map((p) => {
                            const isExpanded = expandedPassageId === p.id
                            return (
                                <div
                                    key={p.id}
                                    className={`border-2 rounded-2xl overflow-hidden transition-all ${selectionMode && selectedPassageIds.has(p.id)
                                        ? 'border-primary bg-primary/5'
                                        : 'border-primary/20 dark:border-primary/10 bg-primary/[0.02]'
                                        }`}
                                >
                                    <div className="p-4 bg-primary/5 dark:bg-primary/10 border-b border-primary/20 dark:border-primary/10">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3 min-w-0">
                                                {selectionMode && (
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedPassageIds.has(p.id)}
                                                        onChange={() => toggleSelectPassage(p.id)}
                                                        aria-label={`Pilih bacaan ${p.title || 'tanpa judul'}`}
                                                        className="w-5 h-5 rounded-md border-secondary/30 text-primary focus:ring-primary bg-secondary/10 cursor-pointer flex-shrink-0"
                                                    />
                                                )}
                                                <div className="min-w-0">
                                                    <h4 className="font-bold text-text-main dark:text-white flex items-center gap-2 flex-wrap">
                                                        <Document set="bold" primaryColor="currentColor" size={16} />
                                                        <span className="truncate">{p.title || 'Bacaan Tanpa Judul'}</span>
                                                        {p.audio_url && (
                                                            <span className="px-2 py-0.5 text-xs rounded-full bg-violet-500/20 text-violet-600 dark:text-violet-400 font-medium flex-shrink-0">🎧 Listening</span>
                                                        )}
                                                    </h4>
                                                    <span className="text-xs text-primary">{p.questions?.length || 0} soal terkait</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {p.subject && (
                                                    <span className="hidden sm:inline-flex px-2.5 py-1 text-xs font-bold rounded-full bg-primary/10 text-primary border border-primary/20">
                                                        {p.subject.name}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => setExpandedPassageId(isExpanded ? null : p.id)}
                                                    aria-label={isExpanded ? 'Tutup detail bacaan' : 'Buka detail bacaan'}
                                                    aria-expanded={isExpanded}
                                                    className="p-2 rounded-lg hover:bg-primary/10 text-text-secondary transition-colors"
                                                >
                                                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                                </button>
                                            </div>
                                        </div>
                                        <p className={`text-sm text-text-secondary mt-2 whitespace-pre-wrap ${isExpanded ? '' : 'line-clamp-3'}`}>{p.passage_text}</p>
                                        {p.audio_url && (
                                            <audio controls controlsList="nodownload" className="mt-2 h-9 w-full" src={p.audio_url} />
                                        )}
                                    </div>

                                    {isExpanded && (
                                        <div className="p-4 space-y-3">
                                            {p.questions && p.questions.length > 0 && p.questions.map((pq, idx) => (
                                                <div key={pq.id} className="p-3 bg-white dark:bg-surface-dark rounded-xl border border-primary/20 dark:border-primary/10">
                                                    <div className="flex items-start gap-3">
                                                        <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                            {idx + 1}
                                                        </span>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                                <QuestionTypeBadge type={pq.question_type} />
                                                                <DifficultyBadge difficulty={pq.difficulty} />
                                                                <SourceBadge source={pq.source_type} sourceName={pq.source_name} />
                                                                <QuestionStatusBadge status={pq.status} aiReviewEnabled={aiReviewEnabled} />
                                                                {aiReviewEnabled && pq.teacher_hots_claim && <HotsBadge />}
                                                                {(pq.tags || []).map((t: string) => (
                                                                    <TagBadge key={t} tag={t} />
                                                                ))}
                                                            </div>
                                                            <SmartText text={pq.question_text} className="text-text-main dark:text-white text-sm" />
                                                            <div className="mt-2">
                                                                <AnswerOptionsView questionType={pq.question_type} options={pq.options} correctAnswer={pq.correct_answer} />
                                                                <TextAnswerView questionType={pq.question_type} correctAnswer={pq.correct_answer} />
                                                            </div>
                                                            {pq.status === 'returned' && pq.admin_review?.notes && (
                                                                <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                                                                    <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 mb-0.5">📋 Alasan Admin:</p>
                                                                    <p className="text-[10px] text-amber-600 dark:text-amber-400">{pq.admin_review.notes}</p>
                                                                </div>
                                                            )}
                                                            <div className="mt-2">
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    aria-label={`Preview soal ${idx + 1} bacaan`}
                                                                    icon={<Show set="bold" primaryColor="currentColor" size={16} />}
                                                                    onClick={() => setPreviewTarget({
                                                                        question_text: pq.question_text,
                                                                        question_type: pq.question_type,
                                                                        options: pq.options,
                                                                        correct_answer: pq.correct_answer,
                                                                        difficulty: pq.difficulty,
                                                                        ai_review: pq.ai_review,
                                                                        passage: { title: p.title, passage_text: p.passage_text, audio_url: p.audio_url }
                                                                    })}
                                                                >
                                                                    Preview
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            <div className="flex flex-wrap gap-2 pt-1">
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    aria-label="Edit bacaan"
                                                    icon={<Edit set="bold" primaryColor="currentColor" size={16} />}
                                                    onClick={() => handleEditPassage(p)}
                                                >
                                                    Edit Bacaan
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="danger"
                                                    aria-label="Hapus bacaan"
                                                    icon={<Delete set="bold" primaryColor="currentColor" size={16} />}
                                                    onClick={() => openDeleteModal(p.id, 'passage', p.title || 'Bacaan')}
                                                >
                                                    Hapus
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                        <Pagination
                            currentPage={passagePage}
                            totalItems={filteredPassages.length}
                            itemsPerPage={ITEMS_PER_PAGE}
                            onPageChange={setPassagePage}
                            itemLabel="bacaan"
                        />
                    </div>
                )
            )}

            {/* Bulk bar melayang (mode seleksi) */}
            {selectionMode && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-wrap items-center justify-center gap-2 px-5 py-3 bg-white dark:bg-surface-dark border border-secondary/20 rounded-2xl shadow-2xl shadow-primary/20 animate-in fade-in slide-in-from-bottom-3 duration-300">
                    <span className="text-sm font-bold text-text-main dark:text-white whitespace-nowrap">
                        {totalSelected} dipilih
                    </span>
                    <Button size="sm" variant="ghost" onClick={toggleSelectAll}>
                        Pilih Semua
                    </Button>
                    {selectedIds.size > 0 && (
                        <>
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => openBulkTagModal('add_tags')}
                                disabled={saving}
                            >
                                + Tag
                            </Button>
                            <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => openBulkTagModal('remove_tags')}
                                disabled={saving}
                            >
                                − Tag
                            </Button>
                            <Button
                                size="sm"
                                variant="danger"
                                onClick={() => setShowBulkDeleteModal(true)}
                                disabled={deleting}
                                icon={<Delete set="bold" primaryColor="currentColor" size={16} />}
                            >
                                Hapus
                            </Button>
                        </>
                    )}
                    <Button
                        size="sm"
                        onClick={() => setShowExportConfirm(true)}
                        disabled={totalSelected === 0}
                        icon={<Download set="bold" primaryColor="currentColor" size={16} />}
                    >
                        Export Word
                    </Button>
                    <Button size="sm" variant="secondary" onClick={toggleSelectionMode}>
                        Batal
                    </Button>
                </div>
            )}

            {/* Modal tag massal */}
            <Modal
                open={showBulkTagModal}
                onClose={() => setShowBulkTagModal(false)}
                title={bulkTagMode === 'add_tags' ? `Tambah Tag — ${selectedIds.size} Soal` : bulkTagMode === 'remove_tags' ? `Hapus Tag — ${selectedIds.size} Soal` : `Atur Tag — ${selectedIds.size} Soal`}
            >
                <div className="space-y-4">
                    <p className="text-sm text-text-secondary">
                        {bulkTagMode === 'add_tags'
                            ? 'Tag berikut akan ditambahkan ke semua soal satuan yang dipilih:'
                            : bulkTagMode === 'remove_tags'
                                ? 'Tag berikut akan dihapus dari semua soal satuan yang dipilih:'
                                : 'Semua tag soal terpilih akan diganti dengan tag berikut:'}
                    </p>
                    <TagInput
                        value={bulkTagForm}
                        onChange={setBulkTagForm}
                        suggestions={availableTags}
                    />
                    <div className="flex justify-end gap-3 pt-2 border-t border-secondary/20">
                        <Button variant="secondary" onClick={() => setShowBulkTagModal(false)}>Batal</Button>
                        <Button onClick={handleBulkTag} disabled={saving || bulkTagForm.length === 0} loading={saving}>
                            {saving ? 'Menyimpan...' : 'Terapkan'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Modal hapus massal */}
            <ConfirmDialog
                open={showBulkDeleteModal}
                title="Hapus Soal Terpilih"
                message={`Yakin ingin menghapus ${selectedIds.size} soal satuan yang dipilih? Tindakan ini tidak bisa dibatalkan.`}
                confirmLabel="Hapus"
                onConfirm={handleBulkDelete}
                onCancel={() => setShowBulkDeleteModal(false)}
            />

            {/* ─── Wizard Tambah/Edit Soal ─── */}
            <Modal
                open={showWizard}
                onClose={handleCloseWizard}
                title={editingQuestionId ? 'Edit Soal' : 'Tambah Soal'}
                maxWidth="2xl"
            >
                <div className="space-y-6">
                    <Stepper steps={WIZARD_STEPS} currentStep={wizardStep} />

                    {/* Langkah 1: Pilih tipe soal */}
                    {wizardStep === 0 && (
                        <div className="space-y-4">
                            <p className="text-sm text-text-secondary text-center">Pilih tipe soal yang ingin {editingQuestionId ? 'digunakan' : 'dibuat'}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {QUESTION_TYPE_CARDS.map((t) => (
                                    <button
                                        key={t.value}
                                        onClick={() => handleWizardTypeChange(t.value)}
                                        className={`flex items-center gap-3 p-4 border-2 rounded-xl text-left transition-all cursor-pointer ${questionForm.question_type === t.value
                                            ? 'border-primary bg-primary/5 dark:bg-primary/10'
                                            : 'border-secondary/20 hover:border-primary/40'
                                            }`}
                                    >
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${questionForm.question_type === t.value ? 'bg-primary text-white' : 'bg-secondary/10 text-primary'}`}>
                                            {t.icon}
                                        </div>
                                        <div>
                                            <p className="font-bold text-text-main dark:text-white">{t.label}</p>
                                            <p className="text-xs text-text-secondary">{t.desc}</p>
                                        </div>
                                    </button>
                                ))}
                                {!editingQuestionId && (
                                    <button
                                        onClick={() => { handleCloseWizard(); openAddPassageModal() }}
                                        className="flex items-center gap-3 p-4 border-2 border-dashed border-violet-300 dark:border-violet-700 rounded-xl text-left transition-all hover:bg-violet-50 dark:hover:bg-violet-900/20 cursor-pointer"
                                    >
                                        <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 flex items-center justify-center flex-shrink-0">
                                            <Voice set="bold" primaryColor="currentColor" size={28} />
                                        </div>
                                        <div>
                                            <p className="font-bold text-text-main dark:text-white">Bacaan / Listening</p>
                                            <p className="text-xs text-text-secondary">Passage + beberapa soal (bisa dengan audio)</p>
                                        </div>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Langkah 2: Isi soal */}
                    {wizardStep === 1 && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pertanyaan *</label>
                                <RichTextEditor
                                    value={questionForm.question_text}
                                    onChange={(val) => setQuestionForm({ ...questionForm, question_text: val })}
                                    placeholder="Tulis soal..."
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Gambar Soal (opsional)</label>
                                <div className="flex items-center gap-3">
                                    <QuestionImageUpload
                                        imageUrl={questionForm.image_url || null}
                                        onImageChange={(url) => setQuestionForm({ ...questionForm, image_url: url || '' })}
                                    />
                                    {!questionForm.image_url && (
                                        <span className="text-xs text-text-secondary">Tambahkan gambar pendukung (maks 5MB)</span>
                                    )}
                                </div>
                                {questionForm.image_url && (
                                    <img src={questionForm.image_url} alt="Preview gambar soal" className="mt-2 max-h-40 rounded-xl border border-secondary/20" />
                                )}
                            </div>
                        </div>
                    )}

                    {/* Langkah 3: Jawaban */}
                    {wizardStep === 2 && (
                        <QuestionOptionsEditor
                            questionType={questionForm.question_type}
                            options={questionForm.options}
                            correctAnswer={questionForm.correct_answer}
                            onChange={(opts, correct) => setQuestionForm({ ...questionForm, options: opts || [], correct_answer: correct || '' })}
                        />
                    )}

                    {/* Langkah 4: Pengaturan */}
                    {wizardStep === 3 && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Mata Pelajaran</label>
                                <FilterSelect
                                    value={questionForm.subject_id}
                                    onChange={(v) => setQuestionForm({ ...questionForm, subject_id: v })}
                                    placeholder="Pilih Mapel"
                                    ariaLabel="Mata pelajaran soal"
                                    options={subjects.map(s => ({ value: s.id, label: s.name }))}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kesulitan</label>
                                <FilterSelect
                                    value={questionForm.difficulty}
                                    onChange={(v) => setQuestionForm({ ...questionForm, difficulty: v as 'EASY' | 'MEDIUM' | 'HARD' })}
                                    ariaLabel="Tingkat kesulitan soal"
                                    options={[
                                        { value: 'EASY', label: 'Mudah' },
                                        { value: 'MEDIUM', label: 'Sedang' },
                                        { value: 'HARD', label: 'Sulit' }
                                    ]}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tag Soal <span className="text-text-secondary font-normal">(opsional)</span></label>
                                <TagInput
                                    value={questionForm.tags}
                                    onChange={(tags) => setQuestionForm({ ...questionForm, tags })}
                                    suggestions={availableTags}
                                />
                                <p className="text-xs text-text-secondary mt-1.5">Tag memudahkan pencarian soal di Bank Soal (mis. #pecahan, #aljabar).</p>
                            </div>
                            {aiReviewEnabled && (
                                <HotsToggle
                                    checked={questionForm.teacher_hots_claim}
                                    onChange={(c) => setQuestionForm({ ...questionForm, teacher_hots_claim: c })}
                                />
                            )}
                        </div>
                    )}

                    {/* Footer navigasi wizard */}
                    <div className="flex gap-3 pt-4 border-t border-secondary/20">
                        <Button
                            variant="secondary"
                            onClick={wizardStep === 0 ? handleCloseWizard : () => setWizardStep(wizardStep - 1)}
                        >
                            {wizardStep === 0 ? 'Batal' : 'Kembali'}
                        </Button>
                        {wizardStep < WIZARD_STEPS.length - 1 ? (
                            <Button
                                className="flex-1"
                                onClick={() => setWizardStep(wizardStep + 1)}
                                disabled={wizardStep === 1 && !stripHtml(questionForm.question_text)}
                            >
                                Lanjut
                            </Button>
                        ) : editingQuestionId ? (
                            <Button
                                className="flex-1"
                                onClick={() => handleSaveQuestion(false)}
                                loading={saving}
                                disabled={saving}
                            >
                                Simpan Perubahan
                            </Button>
                        ) : (
                            <>
                                <Button
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => handleSaveQuestion(true)}
                                    disabled={saving}
                                >
                                    {saving ? 'Menyimpan...' : 'Simpan & Tambah Lagi'}
                                </Button>
                                <Button
                                    className="flex-1"
                                    onClick={() => handleSaveQuestion(false)}
                                    loading={saving}
                                    disabled={saving}
                                >
                                    Simpan & Tutup
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </Modal>

            {/* ─── Modal Tambah/Edit Bacaan ─── */}
            <Modal
                open={showPassageModal}
                onClose={handleClosePassageModal}
                title={editingPassageId ? 'Edit Bacaan' : 'Tambah Bacaan & Soal'}
                maxWidth="2xl"
            >
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Bacaan (opsional)</label>
                            <input
                                type="text"
                                value={passageForm.title}
                                onChange={(e) => setPassageForm({ ...passageForm, title: e.target.value })}
                                placeholder="Contoh: Dialog di Toko"
                                className="w-full px-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Mata Pelajaran</label>
                            <FilterSelect
                                value={passageForm.subject_id}
                                onChange={(v) => setPassageForm({ ...passageForm, subject_id: v })}
                                placeholder="Pilih Mapel (opsional)"
                                ariaLabel="Mata pelajaran bacaan"
                                options={subjects.map(s => ({ value: s.id, label: s.name }))}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Teks Bacaan *</label>
                        <textarea
                            value={passageForm.passage_text}
                            onChange={(e) => setPassageForm({ ...passageForm, passage_text: e.target.value })}
                            rows={6}
                            placeholder="Masukkan teks bacaan/dialog..."
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>

                    <AudioUploadField
                        value={passageForm.audio_url}
                        onChange={(url) => setPassageForm({ ...passageForm, audio_url: url })}
                        onError={(msg) => showToast(msg)}
                    />

                    <div className="border-t border-secondary/20 pt-4">
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
                                <div key={idx} className="p-4 bg-secondary/5 rounded-xl border border-secondary/20 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-bold text-text-main dark:text-white">Soal {idx + 1}</span>
                                        {passageForm.questions.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => handleRemovePassageQuestion(idx)}
                                                aria-label={`Hapus soal ${idx + 1}`}
                                                className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                            >
                                                <Delete set="bold" primaryColor="currentColor" size={16} />
                                            </button>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        <FilterSelect
                                            value={pq.question_type}
                                            onChange={(v) => handlePassageQuestionTypeChange(idx, v)}
                                            ariaLabel={`Tipe soal ${idx + 1}`}
                                            options={[
                                                { value: 'MULTIPLE_CHOICE', label: 'Pilihan Ganda' },
                                                { value: 'MULTIPLE_ANSWER', label: 'Ganda Kompleks' },
                                                { value: 'TRUE_FALSE', label: 'Benar Salah' },
                                                { value: 'SHORT_ANSWER', label: 'Isian Singkat' },
                                                { value: 'ESSAY', label: 'Essay' }
                                            ]}
                                        />
                                        <FilterSelect
                                            value={pq.difficulty}
                                            onChange={(v) => updatePassageQuestion(idx, (q) => ({ ...q, difficulty: v as 'EASY' | 'MEDIUM' | 'HARD' }))}
                                            ariaLabel={`Kesulitan soal ${idx + 1}`}
                                            options={[
                                                { value: 'EASY', label: 'Mudah' },
                                                { value: 'MEDIUM', label: 'Sedang' },
                                                { value: 'HARD', label: 'Sulit' }
                                            ]}
                                        />
                                    </div>

                                    <RichTextEditor
                                        value={pq.question_text}
                                        onChange={(val) => updatePassageQuestion(idx, (q) => ({ ...q, question_text: val }))}
                                        placeholder="Tulis pertanyaan..."
                                    />

                                    <QuestionOptionsEditor
                                        questionType={pq.question_type}
                                        options={pq.options}
                                        correctAnswer={pq.correct_answer}
                                        onChange={(opts, correct) => updatePassageQuestion(idx, (q) => ({ ...q, options: opts || [], correct_answer: correct || '' }))}
                                    />

                                    {aiReviewEnabled && (
                                        <HotsToggle
                                            checked={pq.teacher_hots_claim || false}
                                            onChange={(c) => updatePassageQuestion(idx, (q) => ({ ...q, teacher_hots_claim: c }))}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-secondary/20">
                        <Button variant="secondary" onClick={handleClosePassageModal} className="flex-1">Batal</Button>
                        <Button
                            onClick={handleSavePassage}
                            disabled={saving || (!passageForm.passage_text.trim() && !passageForm.audio_url)}
                            loading={saving}
                            className="flex-1"
                        >
                            {saving ? 'Menyimpan...' : editingPassageId ? 'Simpan Perubahan' : 'Simpan Bacaan'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* ─── Preview Soal (tampilan siswa, kunci ditandai untuk guru) ─── */}
            <Modal
                open={!!previewTarget}
                onClose={() => setPreviewTarget(null)}
                title="Preview Soal"
                maxWidth="2xl"
            >
                {previewTarget && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 flex-wrap">
                            <QuestionTypeBadge type={previewTarget.question_type} />
                            <DifficultyBadge difficulty={previewTarget.difficulty} />
                        </div>

                        {previewTarget.passage && (
                            <div className="p-4 bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl space-y-2">
                                <p className="text-sm font-bold text-text-main dark:text-white flex items-center gap-2">
                                    <Document set="bold" primaryColor="currentColor" size={16} />
                                    {previewTarget.passage.title || 'Bacaan'}
                                </p>
                                <p className="text-sm text-text-secondary whitespace-pre-wrap">{previewTarget.passage.passage_text}</p>
                                {previewTarget.passage.audio_url && (
                                    <audio controls controlsList="nodownload" className="w-full h-9" src={previewTarget.passage.audio_url} />
                                )}
                            </div>
                        )}

                        <SmartText text={previewTarget.question_text} className="text-text-main dark:text-white text-lg font-medium leading-relaxed" />

                        {previewTarget.image_url && (
                            <img src={previewTarget.image_url} alt="Gambar soal" className="max-h-56 rounded-xl border border-secondary/20" />
                        )}

                        <AnswerOptionsView questionType={previewTarget.question_type} options={previewTarget.options} correctAnswer={previewTarget.correct_answer} />
                        <TextAnswerView questionType={previewTarget.question_type} correctAnswer={previewTarget.correct_answer} />

                        <AIReviewSummary review={previewTarget.ai_review} />

                        <p className="text-xs text-text-secondary">Kunci jawaban ditandai hijau — hanya terlihat oleh guru, tidak oleh siswa.</p>
                    </div>
                )}
            </Modal>

            {/* ─── Konfirmasi Export ─── */}
            <ConfirmDialog
                open={showExportConfirm}
                onCancel={() => setShowExportConfirm(false)}
                onConfirm={handleExport}
                title="Export ke Word"
                confirmLabel="Ya, Export Sekarang"
                message={
                    <div className="space-y-3">
                        <p>
                            Kamu akan mengexport <span className="font-bold">{selectedIds.size} soal{selectedPassageIds.size > 0 ? ` + ${selectedPassageIds.size} bacaan` : ''}</span> terpilih ke dalam format Microsoft Word (.doc).
                        </p>
                        <label className="flex items-center gap-3 p-3 bg-white/60 dark:bg-white/5 border border-blue-200 dark:border-blue-800 rounded-xl cursor-pointer">
                            <input
                                type="checkbox"
                                checked={includeAnswerKey}
                                onChange={(e) => setIncludeAnswerKey(e.target.checked)}
                                className="w-5 h-5 accent-emerald-600"
                            />
                            <div>
                                <p className="font-bold text-blue-900 dark:text-blue-200">Sertakan kunci jawaban</p>
                                <p className="text-xs text-blue-700 dark:text-blue-400">
                                    {includeAnswerKey
                                        ? 'Jawaban benar ditandai hijau — cocok untuk arsip guru.'
                                        : 'Tanpa kunci — cocok dibagikan ke siswa sebagai lembar soal.'}
                                </p>
                            </div>
                        </label>
                    </div>
                }
            />

            {/* ─── Konfirmasi Hapus ─── */}
            <ConfirmDialog
                open={showDeleteModal}
                onCancel={() => { setShowDeleteModal(false); setDeleteTargetId(null) }}
                onConfirm={executeDelete}
                title="Konfirmasi Hapus"
                confirmLabel="Ya, Hapus"
                variant="danger"
                loading={deleting}
                message={
                    <div className="space-y-1">
                        <p className="font-bold">{deleteTargetType === 'passage' ? 'Hapus Bacaan?' : 'Hapus Soal?'}</p>
                        <p>
                            {deleteTargetType === 'passage'
                                ? 'Bacaan beserta semua soal di dalamnya akan dihapus permanen.'
                                : 'Soal ini akan dihapus permanen dari Bank Soal.'}
                        </p>
                        {deleteTargetLabel && (
                            <p className="line-clamp-2 opacity-80">&quot;{deleteTargetLabel}...&quot;</p>
                        )}
                    </div>
                }
            />

            {/* ─── Rapih AI Modal ─── */}
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
                            canGenerate={aiGenerateEnabled || user?.role === 'ADMIN'}
                            tagSuggestions={availableTags}
                        />
                    </div>
                </div>
            )}

            {/* Toast notification (design system) */}
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
        </div>
    )
}
