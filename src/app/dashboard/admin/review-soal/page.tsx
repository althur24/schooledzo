'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import dynamic from 'next/dynamic'
const AIReviewPanel = dynamic(() => import('@/components/AIReviewPanel'), { ssr: false })
import { ArrowLeft, Filter as Filter2, TickSquare as CheckCircle, Swap as RotateCcw, ArrowDown as ChevronDown, ArrowUp as ChevronUp, Search, User, Document as BookOpen, Discovery as Brain, Graph as BarChart3, Show as Eye, Hide as EyeOff } from 'react-iconly'
import Link from 'next/link'
import SmartText from '@/components/SmartText'

interface QueueItem {
    id: string
    question_text: string
    question_type: string
    options?: any
    correct_answer?: string
    difficulty?: string
    status: string
    created_at: string
    question_source: string
    teacher_hots_claim?: boolean
    ai_review: any
    subject?: any
    teacher?: any
    quiz?: any
    exam?: any
}

interface TeacherGroup {
    teacherId: string
    teacherName: string
    questions: QueueItem[]
    subjects: string[]
    totalQuestions: number
    avgBloomLevel: number | null
    hotsCount: number
    approvedCount: number
    reviewCount: number
}

export default function ReviewSoalPage() {
    const { user } = useAuth()
    const router = useRouter()
    const [items, setItems] = useState<QueueItem[]>([])
    const [loading, setLoading] = useState(true)
    const [sourceFilter, setSourceFilter] = useState<string>('')
    const [statusFilter, setStatusFilter] = useState<string>('admin_review')
    const [search, setSearch] = useState('')
    const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null)
    const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null)
    const [actionLoading, setActionLoading] = useState<string | null>(null)
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [notes, setNotes] = useState<Record<string, string>>({})

    useEffect(() => {
        if (user && user.role !== 'ADMIN') {
            router.replace('/dashboard')
        }
    }, [user, router])

    const fetchQueue = useCallback(async () => {
        setLoading(true)
        try {
            let url = `/api/admin/review-queue?page=${page}&limit=100`
            if (sourceFilter) url += `&source=${sourceFilter}`
            if (statusFilter) url += `&status=${statusFilter}`

            const res = await fetch(url)
            const data = await res.json()

            setItems(data.data || [])
            setTotal(data.total || 0)
            setTotalPages(data.totalPages || 1)
        } catch (error) {
            console.error('Error fetching review queue:', error)
        } finally {
            setLoading(false)
        }
    }, [page, sourceFilter, statusFilter])

    useEffect(() => {
        if (user) fetchQueue()
    }, [user, fetchQueue])

    const handleAction = async (item: QueueItem, decision: 'approve' | 'return') => {
        setActionLoading(item.id)

        // Optimistic UI updates
        const statusMap: Record<string, string> = {
            approve: 'approved',
            return: 'returned'
        }
        const newStatus = statusMap[decision]
        const oldStatus = item.status

        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: newStatus } : i))

        try {
            const res = await fetch('/api/admin/review-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: item.id,
                    question_source: item.question_source,
                    decision,
                    notes: notes[item.id] || ''
                })
            })

            if (!res.ok) {
                // Revert locally
                setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: oldStatus } : i))
                alert('Gagal memproses review')
            }
        } catch (error) {
            console.error('Error processing review:', error)
            setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: oldStatus } : i))
            alert('Terjadi kesalahan')
        } finally {
            setActionLoading(null)
        }
    }

    const handleReanalyze = async (item: QueueItem) => {
        setActionLoading(item.id)
        try {
            const res = await fetch('/api/admin/review-queue/reanalyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question_id: item.id,
                    question_source: item.question_source
                })
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || 'Gagal menganalisis ulang')
            }
            alert('Analisis ulang berhasil dijadwalkan / selesai.')
            fetchQueue()
        } catch (error: any) {
            alert('Gagal menganalisis ulang: ' + error.message)
        } finally {
            setActionLoading(null)
        }
    }

    const handleBulkApprove = async (teacherId: string, questions: QueueItem[]) => {
        const toApprove = questions.filter(q => 
            (q.status === 'admin_review' || q.status === 'ai_reviewing') &&
            q.ai_review && q.ai_review.model_version !== 'FAILED'
        )
        if (toApprove.length === 0) {
            alert('Tidak ada soal yang valid untuk disetujui (semua butuh re-analyze AI).')
            return
        }

        if (!confirm(`Apakah Anda yakin ingin menyetujui sekaligus ${toApprove.length} soal terpilih?`)) {
            return
        }

        setActionLoading(`bulk-${teacherId}`)

        // Optimistic UI
        const toApproveIds = new Set(toApprove.map(q => q.id))
        setItems(prev => prev.map(i => toApproveIds.has(i.id) ? { ...i, status: 'approved' } : i))

        const failedIds: string[] = []

        try {
            // SEQUENTIAL processing to avoid race condition:
            // Each approval calls checkAndAutoPublish server-side.
            // With parallel requests, PostgreSQL MVCC may prevent any single check
            // from seeing ALL approvals committed, causing auto-publish to never trigger.
            // Sequential ensures the LAST approval's check sees all previous ones committed.
            for (const item of toApprove) {
                try {
                    const res = await fetch('/api/admin/review-queue', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            question_id: item.id,
                            question_source: item.question_source,
                            decision: 'approve',
                            notes: notes[item.id] || ''
                        })
                    })
                    if (!res.ok) failedIds.push(item.id)
                } catch {
                    failedIds.push(item.id)
                }
            }
        } catch (error) {
            console.error('Bulk approve error', error)
            alert('Kesalahan tak terduga saat memproses bulk approve.')
        }

        if (failedIds.length > 0) {
            alert(`Berhasil menyetujui sebagian. Gagal menyetujui ${failedIds.length} soal.`)
            // Revert failed items
            setItems(prev => prev.map(i => failedIds.includes(i.id) ? { ...i, status: 'admin_review' } : i))
        }

        setActionLoading(null)
    }

    // ---- Helpers ----

    const getTeacherName = (item: QueueItem): string => {
        if (item.teacher?.user?.full_name) return item.teacher.user.full_name
        const ta = item.quiz?.teaching_assignment || item.exam?.teaching_assignment
        return ta?.teacher?.user?.full_name || 'Guru Tidak Diketahui'
    }

    const getTeacherId = (item: QueueItem): string => {
        if (item.teacher?.id) return item.teacher.id
        const ta = item.quiz?.teaching_assignment || item.exam?.teaching_assignment
        return ta?.teacher?.id || 'unknown'
    }

    const getSubjectName = (item: QueueItem): string => {
        if (item.subject?.name) return item.subject.name
        const ta = item.quiz?.teaching_assignment || item.exam?.teaching_assignment
        return ta?.subject?.name || '-'
    }

    const getClassName = (item: QueueItem): string => {
        const ta = item.quiz?.teaching_assignment || item.exam?.teaching_assignment
        return ta?.class?.name || ''
    }

    const getSourceLabel = (source: string): string => {
        switch (source) {
            case 'bank': return 'Bank Soal'
            case 'quiz': return 'Kuis'
            case 'exam': return 'Ulangan'
            default: return source
        }
    }

    const getSourceBadge = (source: string) => {
        const colors: Record<string, string> = {
            bank: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
            quiz: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
            exam: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
        }
        return <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${colors[source] || 'bg-gray-100 text-gray-600'}`}>{getSourceLabel(source)}</span>
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'approved': return <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium">✅ Approved</span>
            case 'ai_reviewing': return <span className="px-2 py-0.5 text-xs rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 font-medium animate-pulse">🤖 AI Review...</span>
            case 'admin_review': return <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-medium">⚠️ Perlu Review</span>
            case 'returned': return <span className="px-2 py-0.5 text-xs rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 font-medium">❌ Dikembalikan</span>
            case 'draft': return <span className="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-medium">📝 Draft</span>
            default: return <span className="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-medium">{status || '-'}</span>
        }
    }

    const getDifficultyBadge = (difficulty?: string) => {
        switch (difficulty) {
            case 'EASY': return <span className="px-1.5 py-0.5 text-xs rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">Mudah</span>
            case 'MEDIUM': return <span className="px-1.5 py-0.5 text-xs rounded bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">Sedang</span>
            case 'HARD': return <span className="px-1.5 py-0.5 text-xs rounded bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400">Sulit</span>
            default: return null
        }
    }

    // ---- Group by Teacher ----

    const filteredItems = search
        ? items.filter(i => i.question_text.toLowerCase().includes(search.toLowerCase()))
        : items

    const teacherGroups: TeacherGroup[] = (() => {
        const groupMap = new Map<string, TeacherGroup>()

        filteredItems.forEach(item => {
            const teacherId = getTeacherId(item)
            const teacherName = getTeacherName(item)

            if (!groupMap.has(teacherId)) {
                groupMap.set(teacherId, {
                    teacherId,
                    teacherName,
                    questions: [],
                    subjects: [],
                    totalQuestions: 0,
                    avgBloomLevel: null,
                    hotsCount: 0,
                    approvedCount: 0,
                    reviewCount: 0
                })
            }

            const group = groupMap.get(teacherId)!
            group.questions.push(item)
            group.totalQuestions++

            const subject = getSubjectName(item)
            if (subject !== '-' && !group.subjects.includes(subject)) {
                group.subjects.push(subject)
            }

            if (item.status === 'approved') group.approvedCount++
            if (item.status === 'admin_review') group.reviewCount++
            if (item.ai_review?.hots_flag) group.hotsCount++
        })

        // Calculate avg bloom level
        groupMap.forEach(group => {
            const bloomLevels = group.questions
                .filter(q => q.ai_review?.primary_bloom_level)
                .map(q => q.ai_review.primary_bloom_level)
            if (bloomLevels.length > 0) {
                group.avgBloomLevel = Math.round((bloomLevels.reduce((a: number, b: number) => a + b, 0) / bloomLevels.length) * 10) / 10
            }
        })

        return Array.from(groupMap.values()).sort((a, b) => b.totalQuestions - a.totalQuestions)
    })()

    // ---- Stats ----
    const totalAnalyzed = items.filter(i => i.ai_review).length
    const totalHots = items.filter(i => i.ai_review?.hots_flag).length
    const totalNeedReview = items.filter(i => i.status === 'admin_review').length

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Link href="/dashboard/admin">
                        <Button variant="ghost" icon={<ArrowLeft set="bold" primaryColor="currentColor" size={16} />} />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-text-main dark:text-white">Review Soal</h1>
                        <p className="text-sm text-text-secondary dark:text-zinc-400">
                            Pantau dan review kualitas soal dari semua guru
                        </p>
                    </div>
                </div>
            </div>

            {/* Overview Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="p-4 text-center">
                    <p className="text-2xl font-bold text-text-main dark:text-white">{total}</p>
                    <p className="text-xs text-text-secondary dark:text-zinc-400 mt-1">Total Soal</p>
                </Card>
                <Card className="p-4 text-center">
                    <p className="text-2xl font-bold text-sky-600 dark:text-sky-400">{totalAnalyzed}</p>
                    <p className="text-xs text-text-secondary dark:text-zinc-400 mt-1">Sudah Dianalisis AI</p>
                </Card>
                <Card className="p-4 text-center">
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{totalHots}</p>
                    <p className="text-xs text-text-secondary dark:text-zinc-400 mt-1">Soal HOTS</p>
                </Card>
                <Card className="p-4 text-center">
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{totalNeedReview}</p>
                    <p className="text-xs text-text-secondary dark:text-zinc-400 mt-1">Perlu Review</p>
                </Card>
            </div>

            {/* Filters */}
            <Card className="p-4">
                <div className="flex flex-wrap gap-3 items-center">
                    <div className="flex items-center gap-1">
                        <Filter2 set="bold" primaryColor="currentColor" size={16} />
                        <span className="text-sm text-text-secondary dark:text-zinc-400">Sumber:</span>
                    </div>
                    {['', 'bank', 'quiz', 'exam'].map(src => (
                        <button
                            key={src || 'all'}
                            onClick={() => { setSourceFilter(src); setPage(1) }}
                            className={`px-3 py-1 text-sm rounded-lg transition-colors ${sourceFilter === src
                                ? 'bg-primary text-white shadow-sm'
                                : 'bg-secondary/10 text-text-main dark:text-zinc-300 hover:bg-secondary/20'
                                }`}
                        >
                            {src === '' ? 'Semua' : src === 'bank' ? 'Bank Soal' : src === 'quiz' ? 'Kuis' : 'Ulangan'}
                        </button>
                    ))}
                    <div className="border-l dark:border-zinc-600 h-6 mx-1" />
                    <span className="text-sm text-text-secondary dark:text-zinc-400">Status:</span>
                    {[{ v: '', l: 'Semua' }, { v: 'approved', l: '✅' }, { v: 'admin_review', l: '⚠️' }, { v: 'returned', l: '❌' }, { v: 'draft', l: '📝' }].map(s => (
                        <button
                            key={s.v || 'all-status'}
                            onClick={() => { setStatusFilter(s.v); setPage(1) }}
                            className={`px-3 py-1 text-sm rounded-lg transition-colors ${statusFilter === s.v
                                ? 'bg-primary text-white shadow-sm'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                }`}
                        >
                            {s.l}
                        </button>
                    ))}
                    <div className="flex-1" />
                    <div className="relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"><Search set="bold" primaryColor="currentColor" size={16} /></div>
                        <input
                            type="text"
                            placeholder="Cari soal..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="pl-9 pr-4 py-1.5 text-sm border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-white w-48"
                        />
                    </div>
                </div>
            </Card>

            {/* Teacher Groups */}
            {loading ? (
                <div className="text-center py-12">
                    <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                    <p className="text-text-secondary dark:text-zinc-400">Memuat soal...</p>
                </div>
            ) : teacherGroups.length === 0 ? (
                <Card className="p-12 text-center">
                    <p className="text-4xl mb-3">📭</p>
                    <p className="text-lg font-medium text-text-main dark:text-white">Belum ada soal</p>
                    <p className="text-sm text-text-secondary dark:text-zinc-400 mt-1">
                        Belum ada soal yang dibuat oleh guru{statusFilter ? ` dengan status "${statusFilter}"` : ''}.
                    </p>
                </Card>
            ) : (
                <div className="space-y-4">
                    {teacherGroups.map(group => (
                        <Card key={group.teacherId} className="overflow-hidden" padding="">
                            {/* Teacher Header */}
                            <div
                                className={`p-4 cursor-pointer transition-colors z-10 ${expandedTeacher === group.teacherId ? 'sticky top-0 bg-white dark:bg-zinc-900 border-b dark:border-zinc-800 shadow-sm' : 'hover:bg-gray-50 dark:hover:bg-zinc-800/50'}`}
                                onClick={() => setExpandedTeacher(expandedTeacher === group.teacherId ? null : group.teacherId)}
                            >
                                <div className="flex items-center gap-4">
                                    {/* Avatar */}
                                    <div className="w-12 h-12 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                                        <User set="bold" primaryColor="currentColor" size={24} />
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-semibold text-text-main dark:text-white text-lg">
                                            {group.teacherName}
                                        </h3>
                                        <div className="flex flex-wrap gap-2 mt-1">
                                            {group.subjects.map(subj => (
                                                <span key={subj} className="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 font-medium">
                                                    <div className="inline mr-1"><BookOpen set="bold" primaryColor="currentColor" size={12} /></div>{subj}
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Quick Stats */}
                                    <div className="flex items-center gap-4 flex-shrink-0 text-center">
                                        <div>
                                            <p className="text-lg font-bold text-text-main dark:text-white">{group.totalQuestions}</p>
                                            <p className="text-xs text-text-secondary dark:text-zinc-400">Soal</p>
                                        </div>
                                        {group.avgBloomLevel !== null && (
                                            <div>
                                                <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{group.avgBloomLevel}</p>
                                                <p className="text-xs text-text-secondary dark:text-zinc-400">Avg Bloom</p>
                                            </div>
                                        )}
                                        <div>
                                            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{group.hotsCount}</p>
                                            <p className="text-xs text-text-secondary dark:text-zinc-400">HOTS</p>
                                        </div>
                                        {group.reviewCount > 0 && (
                                            <div>
                                                <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{group.reviewCount}</p>
                                                <p className="text-xs text-text-secondary dark:text-zinc-400">Review</p>
                                            </div>
                                        )}
                                        <div className="flex-shrink-0">
                                            {expandedTeacher === group.teacherId
                                                ? <ChevronUp set="bold" primaryColor="currentColor" size={20} />
                                                : <ChevronDown set="bold" primaryColor="currentColor" size={20} />
                                            }
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Expanded: Question list */}
                            {expandedTeacher === group.teacherId && (
                                <div className="border-t dark:border-zinc-700">
                                    {(group.questions.some(q => q.status === 'admin_review' || q.status === 'ai_reviewing')) && (
                                        <div className="px-4 py-3 bg-slate-50 dark:bg-zinc-800/50 border-b dark:border-zinc-700 flex justify-between items-center sm:sticky sm:top-[88px] z-10">
                                            <span className="text-sm font-medium text-text-secondary dark:text-zinc-400">
                                                Terdapat {group.questions.filter(q => q.status === 'admin_review' || q.status === 'ai_reviewing').length} soal yang perlu direview.
                                            </span>
                                            <Button
                                                size="sm"
                                                onClick={() => handleBulkApprove(group.teacherId, group.questions)}
                                                disabled={actionLoading === `bulk-${group.teacherId}`}
                                                className="!bg-emerald-600 hover:!bg-emerald-700 !text-white text-xs whitespace-nowrap"
                                            >
                                                <span className="mr-1 inline-flex"><CheckCircle set="bold" primaryColor="currentColor" size={14} /></span>
                                                {actionLoading === `bulk-${group.teacherId}` ? 'Memproses...' : 'Setujui Semua'}
                                            </Button>
                                        </div>
                                    )}
                                    {group.questions.map((item, idx) => (
                                        <div key={item.id} className={`${idx > 0 ? 'border-t dark:border-zinc-700/50' : ''}`}>
                                            {/* Question Row */}
                                            <div
                                                className="px-4 py-3 cursor-pointer hover:bg-gray-50/80 dark:hover:bg-zinc-800/30 transition-colors"
                                                onClick={() => setExpandedQuestion(expandedQuestion === item.id ? null : item.id)}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <span className="text-xs text-text-secondary dark:text-zinc-500 mt-1 font-mono w-6 text-right flex-shrink-0">
                                                        {idx + 1}.
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm text-text-main dark:text-white line-clamp-2">
                                                            <SmartText text={item.question_text} />
                                                        </div>
                                                        {/* === Baris 1: Data Guru === */}
                                                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                                            <span className="text-xs text-text-secondary dark:text-zinc-500 font-medium mr-0.5" title="Inputan Guru">👨‍🏫</span>
                                                            {getSourceBadge(item.question_source)}
                                                            {getStatusBadge(item.status)}
                                                            {getDifficultyBadge(item.difficulty)}
                                                            <span className="px-1.5 py-0.5 text-xs rounded bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                                                {item.question_type === 'MULTIPLE_CHOICE' ? 'PG' : 'Essay'}
                                                            </span>
                                                            {item.teacher_hots_claim && (
                                                                <span className="px-1.5 py-0.5 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 rounded font-medium">
                                                                    🏷️ Klaim HOTS
                                                                </span>
                                                            )}
                                                            {getSubjectName(item) !== '-' && (
                                                                <span className="px-1.5 py-0.5 text-xs rounded bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400 font-medium">
                                                                    📚 {getSubjectName(item)}
                                                                </span>
                                                            )}
                                                            {getClassName(item) && (
                                                                <span className="px-1.5 py-0.5 text-xs rounded bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                                                    {getClassName(item)}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {/* === Baris 2: Analisis AI === */}
                                                        {item.ai_review && (
                                                            <div className="flex flex-wrap items-center gap-1.5 mt-1 pl-0.5">
                                                                <span className="text-xs text-text-secondary dark:text-zinc-500 font-medium mr-0.5" title="Analisis AI">🤖</span>
                                                                <AIReviewPanel review={item.ai_review} compact />
                                                                {/* Konflik: Guru klaim HOTS tapi AI bilang LOTS */}
                                                                {item.teacher_hots_claim && item.ai_review.hots_strength === 'S0' && (
                                                                    <span className="px-1.5 py-0.5 text-xs rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-bold animate-pulse" title="Guru mengklaim soal ini HOTS, tetapi AI mendeteksi soal ini sebagai LOTS">
                                                                        ⚡ Konflik: Guru HOTS ≠ AI LOTS
                                                                    </span>
                                                                )}
                                                                {/* Konflik: Difficulty guru ≠ AI */}
                                                                {item.difficulty && item.ai_review.difficulty_label && (() => {
                                                                    const guruDiff = item.difficulty.toLowerCase()
                                                                    const aiDiff = item.ai_review.difficulty_label.toLowerCase()
                                                                    if (guruDiff !== aiDiff) {
                                                                        return (
                                                                            <span className="px-1.5 py-0.5 text-xs rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-bold" title={`Guru: ${item.difficulty}, AI: ${item.ai_review.difficulty_label}`}>
                                                                                ⚡ Kesulitan berbeda
                                                                            </span>
                                                                        )
                                                                    }
                                                                    return null
                                                                })()}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex-shrink-0 text-xs text-text-secondary dark:text-zinc-500">
                                                        {new Date(item.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Expanded Question Detail */}
                                            {expandedQuestion === item.id && (
                                                <div className="px-4 pb-4 pt-2 ml-9 space-y-4 bg-slate-50/50 dark:bg-slate-900/30 rounded-b-lg">
                                                    {/* Full Question */}
                                                    <div>
                                                        <h4 className="text-xs font-bold text-text-secondary dark:text-zinc-400 mb-1 uppercase tracking-wide">Soal Lengkap</h4>
                                                        <div className="text-sm text-text-main dark:text-white whitespace-pre-wrap bg-white dark:bg-zinc-800 p-3 rounded-lg border dark:border-zinc-700">
                                                            <SmartText text={item.question_text} />
                                                        </div>
                                                        {item.options && Array.isArray(item.options) && (
                                                            <div className="mt-2 space-y-1 pl-3">
                                                                {item.options.map((opt: string, i: number) => (
                                                                    <p key={i} className={`text-sm ${opt === item.correct_answer
                                                                        ? 'text-green-600 dark:text-green-400 font-medium'
                                                                        : 'text-text-main dark:text-zinc-300'
                                                                        }`}>
                                                                        {String.fromCharCode(65 + i)}. <SmartText text={opt} as="span" />
                                                                        {opt === item.correct_answer && ' ✓'}
                                                                    </p>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {item.correct_answer && !item.options && (
                                                            <div className="mt-2 pl-3">
                                                                <span className="text-xs text-text-secondary dark:text-zinc-400">Jawaban: </span>
                                                                <span className="text-sm text-green-600 dark:text-green-400"><SmartText text={item.correct_answer} as="span" /></span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* AI Review */}
                                                    {item.ai_review ? (
                                                        <div>
                                                            <h4 className="text-xs font-bold text-text-secondary dark:text-zinc-400 mb-2 uppercase tracking-wide">
                                                                🤖 Analisis AI
                                                            </h4>
                                                            <AIReviewPanel review={item.ai_review} />
                                                        </div>
                                                    ) : (
                                                        <div className="text-sm text-text-secondary dark:text-zinc-400 italic py-2">
                                                            ℹ️ Belum dianalisis AI. Analisis otomatis berjalan saat soal dibuat.
                                                        </div>
                                                    )}

                                                    {/* Admin Actions */}
                                                    <div className="border-t dark:border-zinc-700 pt-3">
                                                        <div className="flex flex-col md:flex-row gap-3">
                                                            <textarea
                                                                placeholder="Tulis catatan / alasan pengembalian soal ke guru..."
                                                                value={notes[item.id] || ''}
                                                                onChange={e => setNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                                className="flex-1 p-2 text-sm border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-white transition-colors focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none resize-none"
                                                                rows={2}
                                                            />
                                                            <div className="flex flex-wrap md:flex-col gap-2 justify-center md:w-32 flex-shrink-0">
                                                                <Button
                                                                    onClick={() => handleAction(item, 'approve')}
                                                                    disabled={actionLoading === item.id || item.status === 'approved' || !item.ai_review || item.ai_review.model_version === 'FAILED'}
                                                                    title={(!item.ai_review || item.ai_review.model_version === 'FAILED') ? 'Tunggu atau ulangi analisis AI sebelum menyetujui' : ''}
                                                                    className="!bg-emerald-600 hover:!bg-emerald-700 !text-white text-xs flex-1 md:flex-none justify-center transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >
                                                                    <CheckCircle set="bold" primaryColor="currentColor" size={14} />
                                                                    Approve
                                                                </Button>
                                                                <Button
                                                                    variant="secondary"
                                                                    onClick={() => {
                                                                        if (!notes[item.id]?.trim()) {
                                                                            alert('Harap tulis alasan pengembalian di catatan admin sebelum mengembalikan soal.')
                                                                            return
                                                                        }
                                                                        handleAction(item, 'return')
                                                                    }}
                                                                    disabled={actionLoading === item.id}
                                                                    className="!bg-amber-500 hover:!bg-amber-600 !text-white text-xs flex-1 md:flex-none justify-center transition-all shadow-sm"
                                                                >
                                                                    <RotateCcw set="bold" primaryColor="currentColor" size={14} />
                                                                    Return
                                                                </Button>
                                                                {(!item.ai_review || item.ai_review.model_version === 'FAILED' || item.status === 'ai_reviewing') && (
                                                                    <Button
                                                                        variant="secondary"
                                                                        onClick={() => handleReanalyze(item)}
                                                                        disabled={actionLoading === item.id}
                                                                        className="!bg-blue-500 hover:!bg-blue-600 !text-white text-xs flex-1 md:flex-none justify-center transition-all shadow-sm"
                                                                    >
                                                                        <Brain set="bold" primaryColor="currentColor" size={14} />
                                                                        Re-analyze AI
                                                                    </Button>
                                                                )}

                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </Card>
                    ))}
                </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex justify-center gap-2">
                    <Button
                        variant="ghost"
                        disabled={page <= 1}
                        onClick={() => setPage(p => p - 1)}
                    >
                        ← Sebelumnya
                    </Button>
                    <span className="flex items-center text-sm text-text-secondary dark:text-zinc-400">
                        Halaman {page} dari {totalPages}
                    </span>
                    <Button
                        variant="ghost"
                        disabled={page >= totalPages}
                        onClick={() => setPage(p => p + 1)}
                    >
                        Selanjutnya →
                    </Button>
                </div>
            )}
        </div>
    )
}
