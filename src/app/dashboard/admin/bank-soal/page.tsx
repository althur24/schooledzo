'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { ArrowLeft, Filter as Filter2, Search, User, Document as BookOpen, Folder, Graph as BarChart3 } from 'react-iconly'
import Link from 'next/link'
import SmartText from '@/components/SmartText'
import dynamic from 'next/dynamic'
const AIReviewPanel = dynamic(() => import('@/components/AIReviewPanel'), { ssr: false })

interface BankItem {
    id: string
    question_text: string
    question_type: string
    options?: any
    correct_answer?: string
    difficulty?: string
    status: string
    created_at: string
    source_type: string
    source_name?: string
    teacher_hots_claim?: boolean
    ai_review: any
    subject?: any
    teacher?: any
    content_format?: 'html' | 'plain'
}

export default function AdminBankSoalPage() {
    const { user } = useAuth()
    const router = useRouter()
    
    const [items, setItems] = useState<BankItem[]>([])
    const [loading, setLoading] = useState(true)
    const [teachers, setTeachers] = useState<any[]>([])
    const [subjects, setSubjects] = useState<any[]>([])
    
    // Filters
    const [sourceFilter, setSourceFilter] = useState<string>('')
    const [teacherFilter, setTeacherFilter] = useState<string>('')
    const [subjectFilter, setSubjectFilter] = useState<string>('')
    const [difficultyFilter, setDifficultyFilter] = useState<string>('')
    const [search, setSearch] = useState('')
    
    // UI State
    const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null)

    useEffect(() => {
        if (user && user.role !== 'ADMIN') {
            router.replace('/dashboard')
        }
    }, [user, router])

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

    const fetchBankSoal = useCallback(async () => {
        setLoading(true)
        try {
            let url = `/api/question-bank?`
            if (teacherFilter) url += `teacher_id=${teacherFilter}&`
            if (subjectFilter) url += `subject_id=${subjectFilter}&`
            if (sourceFilter) url += `source_type=${sourceFilter}&`
            if (search) url += `search=${encodeURIComponent(search)}`

            const res = await fetch(url)
            const data = await res.json()
            
            // Apply client-side difficulty filter if needed
            let filteredData = data || []
            if (difficultyFilter) {
                filteredData = filteredData.filter((q: any) => q.difficulty === difficultyFilter)
            }
            
            setItems(filteredData)
        } catch (error) {
            console.error('Error fetching question bank:', error)
        } finally {
            setLoading(false)
        }
    }, [teacherFilter, subjectFilter, sourceFilter, search, difficultyFilter])

    useEffect(() => {
        if (user) {
            fetchFilters()
        }
    }, [user])

    useEffect(() => {
        if (user) {
            fetchBankSoal()
        }
    }, [user, fetchBankSoal])

    // ---- Helpers ----

    const getSourceLabel = (source: string, sourceName?: string): string => {
        if (source === 'exam') return `Ulangan${sourceName ? `: ${sourceName}` : ''}`
        if (source === 'quiz') return `Kuis${sourceName ? `: ${sourceName}` : ''}`
        if (source === 'ai_generated') return 'AI Generated'
        return 'Manual'
    }

    const getSourceBadge = (source: string, sourceName?: string) => {
        if (source === 'exam') return <span className="px-2 py-0.5 text-xs rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" title={sourceName}>📋 {getSourceLabel(source, sourceName)}</span>
        if (source === 'quiz') return <span className="px-2 py-0.5 text-xs rounded-full font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" title={sourceName}>📋 {getSourceLabel(source, sourceName)}</span>
        if (source === 'ai_generated') return <span className="px-2 py-0.5 text-xs rounded-full font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">🤖 AI Generated</span>
        return <span className="px-2 py-0.5 text-xs rounded-full font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">📝 Manual</span>
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'approved': return <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium">✅ Approved</span>
            case 'ai_reviewing': return <span className="px-2 py-0.5 text-xs rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 font-medium animate-pulse">🤖 AI Review...</span>
            case 'admin_review': return <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-medium">⚠️ Perlu Review</span>
            case 'returned': return <span className="px-2 py-0.5 text-xs rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 font-medium">❌ Dikembalikan</span>
            case 'draft': return <span className="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-medium">📝 Draft</span>
            default: return null
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

    // ---- Stats ----
    const totalQuestions = items.length
    const manualCount = items.filter(i => i.source_type === 'manual' || !i.source_type).length
    const examCount = items.filter(i => i.source_type === 'exam').length
    const quizCount = items.filter(i => i.source_type === 'quiz').length

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Link href="/dashboard/admin">
                        <Button variant="ghost" icon={<ArrowLeft set="bold" primaryColor="currentColor" size={16} />} />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-text-main dark:text-white">Bank Soal Sekolah</h1>
                        <p className="text-sm text-text-secondary dark:text-zinc-400">
                            Lihat seluruh kumpulan soal dari semua guru
                        </p>
                    </div>
                </div>
            </div>

            {/* Overview Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="p-4 text-center border-l-4 border-l-primary">
                    <p className="text-2xl font-bold text-text-main dark:text-white">{totalQuestions}</p>
                    <p className="text-xs text-text-secondary dark:text-zinc-400 mt-1">Total Soal</p>
                </Card>
                <Card className="p-4 text-center border-l-4 border-l-slate-400">
                    <p className="text-2xl font-bold text-slate-600 dark:text-slate-400">{manualCount}</p>
                    <p className="text-xs text-text-secondary dark:text-zinc-400 mt-1">Input Manual</p>
                </Card>
                <Card className="p-4 text-center border-l-4 border-l-blue-400">
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{examCount}</p>
                    <p className="text-xs text-text-secondary dark:text-zinc-400 mt-1">Dari Ulangan</p>
                </Card>
                <Card className="p-4 text-center border-l-4 border-l-indigo-400">
                    <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{quizCount}</p>
                    <p className="text-xs text-text-secondary dark:text-zinc-400 mt-1">Dari Kuis</p>
                </Card>
            </div>

            {/* Filters */}
            <Card className="p-4">
                <div className="flex flex-col md:flex-row gap-3">
                    <div className="flex-1 relative">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">
                            <Search set="light" primaryColor="currentColor" size={18} />
                        </div>
                        <input
                            type="text"
                            placeholder="Cari soal..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-white focus:ring-1 focus:ring-primary focus:border-primary text-sm"
                        />
                    </div>
                    
                    <div className="flex flex-wrap gap-2">
                        <select
                            value={teacherFilter}
                            onChange={(e) => setTeacherFilter(e.target.value)}
                            className="px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-white text-sm"
                        >
                            <option value="">Semua Guru</option>
                            {teachers.map(t => (
                                <option key={t.id} value={t.id}>{t.user?.full_name}</option>
                            ))}
                        </select>

                        <select
                            value={subjectFilter}
                            onChange={(e) => setSubjectFilter(e.target.value)}
                            className="px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-white text-sm"
                        >
                            <option value="">Semua Mapel</option>
                            {subjects.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>

                        <select
                            value={sourceFilter}
                            onChange={(e) => setSourceFilter(e.target.value)}
                            className="px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-white text-sm"
                        >
                            <option value="">Semua Sumber</option>
                            <option value="manual">Manual Input</option>
                            <option value="exam">Dari Ulangan</option>
                            <option value="quiz">Dari Kuis</option>
                            <option value="ai_generated">AI Generated</option>
                        </select>

                        <select
                            value={difficultyFilter}
                            onChange={(e) => setDifficultyFilter(e.target.value)}
                            className="px-3 py-2 border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-white text-sm"
                        >
                            <option value="">Semua Kesulitan</option>
                            <option value="EASY">Mudah</option>
                            <option value="MEDIUM">Sedang</option>
                            <option value="HARD">Sulit</option>
                        </select>
                    </div>
                </div>
            </Card>

            {/* Questions List */}
            {loading ? (
                <div className="text-center py-12">
                    <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
                    <p className="text-text-secondary dark:text-zinc-400">Memuat soal...</p>
                </div>
            ) : items.length === 0 ? (
                <Card className="p-12 text-center">
                    <div className="w-16 h-16 bg-slate-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
                        <div className="text-slate-400">
                            <Folder set="bold" primaryColor="currentColor" size={32} />
                        </div>
                    </div>
                    <p className="text-lg font-medium text-text-main dark:text-white">Tidak ada soal ditemukan</p>
                    <p className="text-sm text-text-secondary dark:text-zinc-400 mt-1">
                        Coba ubah filter atau kata kunci pencarian.
                    </p>
                </Card>
            ) : (
                <Card className="overflow-hidden">
                    <div className="divide-y dark:divide-zinc-800">
                        {items.map((item, idx) => (
                            <div key={item.id} className="group">
                                <div
                                    className="px-5 py-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors"
                                    onClick={() => setExpandedQuestion(expandedQuestion === item.id ? null : item.id)}
                                >
                                    <div className="flex gap-4">
                                        <div className="flex-shrink-0 pt-1">
                                            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                                                {idx + 1}
                                            </div>
                                        </div>
                                        
                                        <div className="flex-1 min-w-0">
                                            {/* Teacher info */}
                                            <div className="flex items-center gap-2 mb-2">
                                                <div className="flex items-center gap-1.5 text-sm font-semibold text-text-main dark:text-white">
                                                    <div className="text-text-secondary"><User set="bold" primaryColor="currentColor" size={14} /></div>
                                                    {item.teacher?.user?.full_name || 'Guru Tidak Diketahui'}
                                                </div>
                                                <span className="text-slate-300 dark:text-zinc-600">•</span>
                                                <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                                                    <BookOpen set="bold" primaryColor="currentColor" size={14} />
                                                    {item.subject?.name || '-'}
                                                </div>
                                            </div>

                                            {/* Question Preview */}
                                            <div className="text-sm text-text-main dark:text-white line-clamp-2 mb-2 pr-4">
                                                <SmartText text={item.question_text} />
                                            </div>

                                            {/* Badges */}
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                {getSourceBadge(item.source_type, item.source_name)}
                                                {getStatusBadge(item.status)}
                                                {getDifficultyBadge(item.difficulty)}
                                                <span className="px-1.5 py-0.5 text-xs rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-medium">
                                                    {item.question_type === 'MULTIPLE_CHOICE' ? 'PG' : 
                                                     item.question_type === 'MULTIPLE_ANSWER' ? 'GK' :
                                                     item.question_type === 'TRUE_FALSE' ? 'BS' :
                                                     item.question_type === 'SHORT_ANSWER' ? 'IS' : 'Esai'}
                                                </span>
                                                {item.teacher_hots_claim && (
                                                    <span className="px-1.5 py-0.5 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 rounded font-medium">
                                                        🏷️ Klaim HOTS
                                                    </span>
                                                )}
                                                {item.ai_review && (
                                                    <span className="px-1.5 py-0.5 text-xs bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 rounded font-medium">
                                                        🤖 AI Analyzed
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex-shrink-0 text-xs text-text-secondary">
                                            {new Date(item.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded Detail */}
                                {expandedQuestion === item.id && (
                                    <div className="px-5 pb-5 pt-2 ml-12 border-t border-dashed dark:border-zinc-700 bg-slate-50/50 dark:bg-zinc-900/30">
                                        <div className="space-y-4">
                                            {/* Full Question & Options */}
                                            <div>
                                                <h4 className="text-xs font-bold text-text-secondary dark:text-zinc-500 mb-2 uppercase tracking-wider">Detail Soal</h4>
                                                <div className="text-sm text-text-main dark:text-white bg-white dark:bg-zinc-800 p-4 rounded-xl border dark:border-zinc-700 shadow-sm">
                                                    <div className="whitespace-pre-wrap">
                                                        <SmartText text={item.question_text} />
                                                    </div>
                                                    
                                                    {item.options && Array.isArray(item.options) && (
                                                        <div className="mt-4 space-y-2 pl-4 border-l-2 border-slate-200 dark:border-zinc-700">
                                                            {item.options.map((opt: string, i: number) => {
                                                                const letter = String.fromCharCode(65 + i)
                                                                let isCorrect = false
                                                                if (item.question_type === 'MULTIPLE_ANSWER') {
                                                                    try { isCorrect = JSON.parse(item.correct_answer || '[]').includes(letter) } catch {}
                                                                } else if (item.question_type === 'TRUE_FALSE') {
                                                                    isCorrect = item.correct_answer?.toUpperCase() === opt.toUpperCase()
                                                                } else {
                                                                    isCorrect = letter === item.correct_answer
                                                                }
                                                                return (
                                                                    <div key={i} className={`flex gap-2 text-sm ${isCorrect ? 'text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-900/10 -ml-4 pl-4 py-1 rounded-r-lg' : 'text-text-main dark:text-zinc-300'}`}>
                                                                        <span className="flex-shrink-0">{item.question_type === 'TRUE_FALSE' ? '' : `${letter}.`}</span>
                                                                        <div><SmartText text={opt} /></div>
                                                                        {isCorrect && <span className="flex-shrink-0 ml-auto mr-2">✓ Jawaban Benar</span>}
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    )}
                                                    
                                                    {item.correct_answer && (!item.options || item.question_type === 'ESSAY' || item.question_type === 'SHORT_ANSWER') && (
                                                        <div className="mt-4 pt-3 border-t dark:border-zinc-700">
                                                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase">Jawaban/Rubrik:</span>
                                                            <div className="text-sm text-emerald-700 dark:text-emerald-300 mt-1 bg-emerald-50 dark:bg-emerald-900/10 p-3 rounded-lg">
                                                                <SmartText text={item.correct_answer} />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* AI Review Details */}
                                            {item.ai_review && (
                                                <div>
                                                    <h4 className="text-xs font-bold text-text-secondary dark:text-zinc-500 mb-2 uppercase tracking-wider">🤖 Analisis AI</h4>
                                                    <AIReviewPanel review={item.ai_review} compact={false} />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    )
}
