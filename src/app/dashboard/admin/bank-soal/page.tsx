'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { PageHeader, EmptyState, StatsCard } from '@/components/ui'
import Card from '@/components/ui/Card'
import SmartText from '@/components/SmartText'
import FilterSelect from '@/components/FilterSelect'
import Pagination from '@/components/Pagination'
import {
    QuestionTypeBadge, DifficultyBadge, QuestionStatusBadge, SourceBadge, HotsBadge
} from '@/components/QuestionBadges'
import { AnswerOptionsView, TextAnswerView } from '@/components/QuestionAnswerView'
import { Folder, Search, User, Document as BookOpen, Document, Edit, Paper, Discovery } from 'react-iconly'
import { ChevronDown, ChevronUp } from 'lucide-react'
const AIReviewPanel = dynamic(() => import('@/components/AIReviewPanel'), { ssr: false })

interface BankItem {
    id: string
    question_text: string
    question_type: string
    options?: string[] | null
    correct_answer?: string | null
    difficulty?: string
    image_url?: string | null
    status: string
    created_at: string
    source_type: string
    source_name?: string
    teacher_hots_claim?: boolean
    ai_review: any
    subject?: { id: string; name: string } | null
    teacher?: { id: string; user?: { full_name: string | null } | null } | null
    content_format?: 'html' | 'plain'
}

interface Teacher {
    id: string
    user?: { full_name: string | null } | null
}

interface Subject {
    id: string
    name: string
}

const ITEMS_PER_PAGE = 20

export default function AdminBankSoalPage() {
    const { user } = useAuth()
    const router = useRouter()

    const [items, setItems] = useState<BankItem[]>([])
    const [loading, setLoading] = useState(true)
    const [teachers, setTeachers] = useState<Teacher[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [aiReviewEnabled, setAiReviewEnabled] = useState(true)

    // Stats — dihitung dari SEMUA data (fetch tanpa filter, sekali di awal)
    const [stats, setStats] = useState({ total: 0, manual: 0, exam: 0, quiz: 0 })

    // Filters: guru/mapel/sumber (server-side), kesulitan/tipe (client-side)
    const [sourceFilter, setSourceFilter] = useState('')
    const [teacherFilter, setTeacherFilter] = useState('')
    const [subjectFilter, setSubjectFilter] = useState('')
    const [difficultyFilter, setDifficultyFilter] = useState('')
    const [typeFilter, setTypeFilter] = useState('')
    const [searchInput, setSearchInput] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')

    // Pagination & expand
    const [currentPage, setCurrentPage] = useState(1)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    useEffect(() => {
        if (user && user.role !== 'ADMIN') {
            router.replace('/dashboard')
        }
    }, [user, router])

    // Debounce search ~400ms — tidak fetch per keystroke
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 400)
        return () => clearTimeout(timer)
    }, [searchInput])

    const fetchFilters = async () => {
        try {
            const [teachersRes, subjectsRes] = await Promise.all([
                fetch('/api/teachers'),
                fetch('/api/subjects')
            ])
            if (teachersRes.ok) setTeachers(await teachersRes.json())
            if (subjectsRes.ok) setSubjects(await subjectsRes.json())
        } catch (error) {
            console.error('Error fetching filters:', error)
        }
    }

    // Stats: fetch TANPA filter sekali di awal agar angka tidak ikut filter (tidak menyesatkan)
    const fetchStats = async () => {
        try {
            const res = await fetch('/api/question-bank')
            if (!res.ok) return
            const data: BankItem[] = await res.json()
            const all = Array.isArray(data) ? data : []
            setStats({
                total: all.length,
                manual: all.filter(i => i.source_type === 'manual' || !i.source_type).length,
                exam: all.filter(i => i.source_type === 'exam').length,
                quiz: all.filter(i => i.source_type === 'quiz').length
            })
        } catch (error) {
            console.error('Error fetching stats:', error)
        }
    }

    const fetchBankSoal = useCallback(async () => {
        setLoading(true)
        try {
            let url = `/api/question-bank?`
            if (teacherFilter) url += `teacher_id=${teacherFilter}&`
            if (subjectFilter) url += `subject_id=${subjectFilter}&`
            if (sourceFilter) url += `source_type=${sourceFilter}&`
            if (debouncedSearch) url += `search=${encodeURIComponent(debouncedSearch)}`

            const res = await fetch(url)
            const data = await res.json()
            setItems(Array.isArray(data) ? data : [])
            setCurrentPage(1)
        } catch (error) {
            console.error('Error fetching question bank:', error)
        } finally {
            setLoading(false)
        }
    }, [teacherFilter, subjectFilter, sourceFilter, debouncedSearch])

    useEffect(() => {
        if (user) {
            fetchFilters()
            fetchStats()
            fetch('/api/school-settings').then(r => r.ok ? r.json() : null).then(d => {
                if (d) setAiReviewEnabled(d.ai_review_enabled !== false)
            }).catch(() => { })
        }
    }, [user])

    useEffect(() => {
        if (user) fetchBankSoal()
    }, [user, fetchBankSoal])

    // Filter client-side (kesulitan & tipe) — tidak memicu fetch ulang
    const filteredItems = items.filter(q => {
        if (difficultyFilter && q.difficulty !== difficultyFilter) return false
        if (typeFilter && q.question_type !== typeFilter) return false
        return true
    })

    const paginatedItems = filteredItems.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    )

    return (
        <div className="space-y-6">
            <PageHeader
                title="Bank Soal Sekolah"
                subtitle="Lihat seluruh kumpulan soal dari semua guru"
                backHref="/dashboard/admin"
                icon={<Folder set="bold" primaryColor="currentColor" size={24} />}
            />

            {/* Overview Stats — dari seluruh data, tidak mengikuti filter */}
            <div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatsCard
                        label="Total Soal"
                        value={stats.total}
                        icon={<div className="text-primary"><Folder set="bold" primaryColor="currentColor" size={24} /></div>}
                    />
                    <StatsCard
                        label="Input Manual"
                        value={stats.manual}
                        icon={<div className="text-secondary"><Edit set="bold" primaryColor="currentColor" size={24} /></div>}
                    />
                    <StatsCard
                        label="Dari Ulangan"
                        value={stats.exam}
                        icon={<div className="text-secondary"><Document set="bold" primaryColor="currentColor" size={24} /></div>}
                    />
                    <StatsCard
                        label="Dari Kuis"
                        value={stats.quiz}
                        icon={<div className="text-secondary"><Paper set="bold" primaryColor="currentColor" size={24} /></div>}
                    />
                </div>
                <p className="text-xs text-text-secondary mt-2">Statistik dihitung dari seluruh bank soal (tidak mengikuti filter di bawah).</p>
            </div>

            {/* Filters */}
            <Card padding="p-4">
                <div className="space-y-3">
                    <div className="relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">
                            <Search set="light" primaryColor="currentColor" size={20} />
                        </div>
                        <input
                            type="text"
                            placeholder="Cari soal berdasarkan kata kunci..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            aria-label="Cari soal"
                            className="w-full pl-10 pr-4 py-3 bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary"
                        />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                        <FilterSelect
                            value={teacherFilter}
                            onChange={setTeacherFilter}
                            placeholder="Semua Guru"
                            ariaLabel="Filter guru"
                            options={teachers.map(t => ({ value: t.id, label: t.user?.full_name || 'Tanpa Nama' }))}
                        />
                        <FilterSelect
                            value={subjectFilter}
                            onChange={setSubjectFilter}
                            placeholder="Semua Mapel"
                            ariaLabel="Filter mata pelajaran"
                            options={subjects.map(s => ({ value: s.id, label: s.name }))}
                        />
                        <FilterSelect
                            value={sourceFilter}
                            onChange={setSourceFilter}
                            placeholder="Semua Sumber"
                            ariaLabel="Filter sumber soal"
                            options={[
                                { value: 'manual', label: 'Manual Input' },
                                { value: 'exam', label: 'Dari Ulangan' },
                                { value: 'quiz', label: 'Dari Kuis' },
                                { value: 'ai_generated', label: 'AI Generated' }
                            ]}
                        />
                        <FilterSelect
                            value={difficultyFilter}
                            onChange={(v) => { setDifficultyFilter(v); setCurrentPage(1) }}
                            placeholder="Semua Kesulitan"
                            ariaLabel="Filter kesulitan"
                            options={[
                                { value: 'EASY', label: 'Mudah' },
                                { value: 'MEDIUM', label: 'Sedang' },
                                { value: 'HARD', label: 'Sulit' }
                            ]}
                        />
                        <FilterSelect
                            value={typeFilter}
                            onChange={(v) => { setTypeFilter(v); setCurrentPage(1) }}
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
                    </div>
                </div>
            </Card>

            {/* Questions List */}
            {loading ? (
                <div className="flex flex-col items-center py-12 gap-3">
                    <div className="animate-spin text-primary"><Discovery set="bold" primaryColor="currentColor" size={40} /></div>
                    <p className="text-text-secondary">Memuat soal...</p>
                </div>
            ) : filteredItems.length === 0 ? (
                <EmptyState
                    icon={<div className="text-secondary"><Folder set="bold" primaryColor="currentColor" size={48} /></div>}
                    title="Tidak ada soal ditemukan"
                    description="Coba ubah filter atau kata kunci pencarian."
                />
            ) : (
                <>
                    <Card padding="p-0" className="overflow-hidden">
                        <div className="divide-y divide-secondary/10">
                            {paginatedItems.map((item, idx) => {
                                const isExpanded = expandedId === item.id
                                return (
                                    <div key={item.id}>
                                        <div className="flex items-start">
                                            <button
                                                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                                                aria-expanded={isExpanded}
                                                aria-label={`${isExpanded ? 'Tutup' : 'Buka'} detail soal nomor ${(currentPage - 1) * ITEMS_PER_PAGE + idx + 1}`}
                                                className="flex-1 min-w-0 px-5 py-4 text-left hover:bg-secondary/5 transition-colors cursor-pointer"
                                            >
                                                <div className="flex gap-4">
                                                    <div className="flex-shrink-0 pt-1">
                                                        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                                                            {(currentPage - 1) * ITEMS_PER_PAGE + idx + 1}
                                                        </div>
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        {/* Teacher & subject info */}
                                                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                            <div className="flex items-center gap-1.5 text-sm font-semibold text-text-main dark:text-white">
                                                                <span className="text-text-secondary"><User set="bold" primaryColor="currentColor" size={14} /></span>
                                                                {item.teacher?.user?.full_name || 'Guru Tidak Diketahui'}
                                                            </div>
                                                            <span className="text-secondary/40">•</span>
                                                            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                                                                <BookOpen set="bold" primaryColor="currentColor" size={14} />
                                                                {item.subject?.name || '-'}
                                                            </div>
                                                        </div>

                                                        {/* Question preview */}
                                                        <div className="text-sm text-text-main dark:text-white line-clamp-2 mb-2 pr-4">
                                                            <SmartText text={item.question_text} />
                                                        </div>

                                                        {/* Badges */}
                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                            <QuestionTypeBadge type={item.question_type} />
                                                            <DifficultyBadge difficulty={item.difficulty || ''} />
                                                            <SourceBadge source={item.source_type} sourceName={item.source_name} />
                                                            <QuestionStatusBadge status={item.status} aiReviewEnabled={aiReviewEnabled} />
                                                            {item.teacher_hots_claim && <HotsBadge />}
                                                            {item.ai_review && (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full font-medium border bg-secondary/10 text-text-secondary border-secondary/20">
                                                                    <Discovery set="bold" primaryColor="currentColor" size={12} /> AI Analyzed
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex-shrink-0 text-text-secondary pt-1">
                                                        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                                    </div>
                                                </div>
                                            </button>

                                            {/* Tanggal + aksi review (di luar tombol accordion) */}
                                            <div className="flex-shrink-0 px-5 py-4 flex flex-col items-end gap-2">
                                                <span className="text-xs text-text-secondary whitespace-nowrap">
                                                    {new Date(item.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </span>
                                                {item.status === 'admin_review' && (
                                                    <Link
                                                        href="/dashboard/admin/review-soal"
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                                                    >
                                                        Review →
                                                    </Link>
                                                )}
                                            </div>
                                        </div>

                                        {/* Expanded Detail */}
                                        {isExpanded && (
                                            <div className="px-5 pb-5 pt-2 border-t border-dashed border-secondary/20 bg-secondary/5">
                                                <div className="space-y-4">
                                                    <div>
                                                        <h4 className="text-xs font-bold text-text-secondary mb-2 uppercase tracking-wider">Detail Soal</h4>
                                                        <div className="text-sm text-text-main dark:text-white bg-white dark:bg-surface-dark p-4 rounded-xl border border-secondary/20 shadow-sm space-y-4">
                                                            <SmartText text={item.question_text} />

                                                            {item.image_url && (
                                                                <img
                                                                    src={item.image_url}
                                                                    alt="Gambar soal"
                                                                    className="max-h-64 w-auto max-w-full rounded-xl border border-secondary/20"
                                                                />
                                                            )}

                                                            <AnswerOptionsView
                                                                questionType={item.question_type}
                                                                options={item.options || null}
                                                                correctAnswer={item.correct_answer || null}
                                                            />
                                                            <TextAnswerView
                                                                questionType={item.question_type}
                                                                correctAnswer={item.correct_answer || null}
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* AI Review Details */}
                                                    {item.ai_review && (
                                                        <div>
                                                            <h4 className="text-xs font-bold text-text-secondary mb-2 uppercase tracking-wider">Analisis AI</h4>
                                                            <AIReviewPanel review={item.ai_review} compact={false} />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </Card>

                    <Pagination
                        currentPage={currentPage}
                        totalItems={filteredItems.length}
                        itemsPerPage={ITEMS_PER_PAGE}
                        onPageChange={setCurrentPage}
                        itemLabel="soal"
                    />
                </>
            )}
        </div>
    )
}
