'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Modal, Button, PageHeader, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import { TimeCircle as Clock, Document as FileText, Graph as BarChart3, Game as Brain, Calendar, Plus, Game, Graph, Edit, Swap } from 'react-iconly'
import { Loader2, CheckSquare, Square, RefreshCw } from 'lucide-react'

interface Quiz {
    id: string
    title: string
    description: string | null
    duration_minutes: number
    is_active: boolean
    pending_publish: boolean
    is_randomized: boolean
    created_at: string
    teaching_assignment: {
        id: string
        subject: { name: string, kkm: number }
        class: { id: string, name: string }
    }
    questions: { count: number }[]
}

interface TeachingAssignment {
    id: string
    subject: { id: string; name: string }
    class: { id: string; name: string }
}

export default function GuruKuisPage() {
    const { user } = useAuth()
    const router = useRouter()
    const [quizzes, setQuizzes] = useState<Quiz[]>([])
    const [teachingAssignments, setTeachingAssignments] = useState<TeachingAssignment[]>([])
    const [submissionCounts, setSubmissionCounts] = useState<Record<string, number>>({})
    const [pendingGradingCounts, setPendingGradingCounts] = useState<Record<string, number>>({})
    const [studentCounts, setStudentCounts] = useState<Record<string, number>>({})
    const [loading, setLoading] = useState(true)
    const [returnedQuizzes, setReturnedQuizzes] = useState<{quizId: string, title: string, returnedCount: number}[]>([])
    const [aiReviewEnabled, setAiReviewEnabled] = useState(true)
    const [showCreate, setShowCreate] = useState(false)
    const [creating, setCreating] = useState(false)
    const [form, setForm] = useState({
        teaching_assignment_id: '',
        title: '',
        description: '',
        duration_minutes: 30,
        is_randomized: true
    })
    const [hasDeadline, setHasDeadline] = useState(false)
    const [deadlineValue, setDeadlineValue] = useState('')

    // Remedial States
    const [showRemedial, setShowRemedial] = useState(false)
    const [remedialQuiz, setRemedialQuiz] = useState<Quiz | null>(null)
    const [remedialStudents, setRemedialStudents] = useState<any[]>([])
    const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
    const [remedialMethod, setRemedialMethod] = useState<'ASLI' | 'BARU'>('ASLI')
    const [remedialLoading, setRemedialLoading] = useState(false)

    useEffect(() => {
        fetchData()
    }, [user])

    const fetchData = async () => {
        if (!user) {
            return
        }

        try {
            const [quizzesRes, myAssignmentsRes, yearsRes, returnedRes, settingsRes] = await Promise.all([
                fetch('/api/quizzes'),
                fetch('/api/my-teaching-assignments'),
                fetch('/api/academic-years'),
                fetch('/api/quizzes/returned-counts'),
                fetch('/api/school-settings')
            ])

            if (settingsRes.ok) {
                const settings = await settingsRes.json()
                setAiReviewEnabled(settings?.ai_review_enabled !== false)
            }
            if (returnedRes.ok) {
                const returned = await returnedRes.json()
                setReturnedQuizzes(Array.isArray(returned) ? returned : [])
            }

            // Handle quiz response
            let quizzesData = []
            if (quizzesRes.ok) {
                const data = await quizzesRes.json()
                quizzesData = Array.isArray(data) ? data : []
            }

            // Handle assignments response
            let myAssignments = []
            if (myAssignmentsRes.ok) {
                const data = await myAssignmentsRes.json()
                myAssignments = Array.isArray(data) ? data : []
            }

            // Get active academic year and fetch students with enrollment
            const yearsData = yearsRes.ok ? await yearsRes.json() : []
            const activeYear = Array.isArray(yearsData) ? yearsData.find((y: any) => y.is_active) : null
            if (activeYear) {
                try {
                    const studentsRes = await fetch(`/api/students?enrollment_year_id=${activeYear.id}`)
                    const studentsData = await studentsRes.json()
                    const studentsArray = Array.isArray(studentsData) ? studentsData : []
                    const counts: Record<string, number> = {}
                    studentsArray.forEach((s: any) => {
                        const classId = s.class?.id || s.class_id
                        if (classId) counts[classId] = (counts[classId] || 0) + 1
                    })
                    setStudentCounts(counts)
                } catch (e) {
                    console.error('Error fetching students:', e)
                }
            }

            setTeachingAssignments(myAssignments)

            // Filter quizzes by my teaching assignments
            const myQuizzes = quizzesData.filter((q: Quiz) =>
                myAssignments.some((ta: TeachingAssignment) => ta.id === q.teaching_assignment?.id)
            )
            setQuizzes(myQuizzes)

            // Fetch submission counts per quiz
            const subCounts: Record<string, number> = {}
            const pendingCounts: Record<string, number> = {}
            await Promise.all(myQuizzes.map(async (quiz: Quiz) => {
                try {
                    const res = await fetch(`/api/quiz-submissions?quiz_id=${quiz.id}`)
                    if (res.ok) {
                        const subs = await res.json()
                        const subsArr = Array.isArray(subs) ? subs : []
                        subCounts[quiz.id] = subsArr.filter((s: any) => s.submitted_at).length
                        pendingCounts[quiz.id] = subsArr.filter((s: any) => s.submitted_at && !s.is_graded).length
                    }
                } catch { }
            }))
            setSubmissionCounts(subCounts)
            setPendingGradingCounts(pendingCounts)
        } catch (error) {
            console.error('Quiz Page - Error fetching data:', error)
            setTeachingAssignments([])
        } finally {
            setLoading(false)
        }
    }

    const handleCreate = async () => {
        if (!form.teaching_assignment_id || !form.title) return
        setCreating(true)
        try {
            const res = await fetch('/api/quizzes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    deadline: hasDeadline && deadlineValue ? new Date(deadlineValue).toISOString() : null
                })
            })
            if (res.ok) {
                const newQuiz = await res.json()
                setShowCreate(false)
                setForm({ teaching_assignment_id: '', title: '', description: '', duration_minutes: 30, is_randomized: true })
                setHasDeadline(false)
                setDeadlineValue('')
                router.push(`/dashboard/guru/kuis/${newQuiz.id}`)
            }
        } finally {
            setCreating(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Hapus kuis ini?')) return
        await fetch(`/api/quizzes/${id}`, { method: 'DELETE' })
        fetchData()
    }

    const handleOpenRemedial = async (quiz: Quiz) => {
        setRemedialQuiz(quiz)
        setShowRemedial(true)
        setRemedialLoading(true)
        setSelectedStudentIds([])
        setRemedialMethod('ASLI')

        try {
            const classId = quiz.teaching_assignment?.class?.id
            const kkm = quiz.teaching_assignment?.subject?.kkm || 75

            if (!classId) throw new Error('Class ID missing')

            const [studentsRes, subsRes] = await Promise.all([
                fetch(`/api/students?class_id=${classId}`),
                fetch(`/api/quiz-submissions?quiz_id=${quiz.id}`)
            ])
            const studentsData = await studentsRes.json()
            const subsData = await subsRes.json()

            const studentsWithScores = (Array.isArray(studentsData) ? studentsData : []).map((s: any) => {
                const sub = (Array.isArray(subsData) ? subsData : []).find((sub: any) => sub.student_id === s.id)
                let score = 0
                if (sub && sub.max_score > 0) {
                    score = (sub.total_score / sub.max_score) * 100
                }
                const isBelowKKM = score < kkm
                return {
                    ...s,
                    score: Math.round(score),
                    isBelowKKM
                }
            })

            // Sort by score
            studentsWithScores.sort((a, b) => a.score - b.score)

            setRemedialStudents(studentsWithScores)
            // Pre-select those below KKM
            setSelectedStudentIds(studentsWithScores.filter((s: any) => s.isBelowKKM).map((s: any) => s.user.id))
        } catch (error) {
            console.error('Error fetching remedial data:', error)
            alert('Gagal memuat data siswa untuk remedial')
        } finally {
            setRemedialLoading(false)
        }
    }

    const handleCreateRemedial = async () => {
        if (!remedialQuiz || selectedStudentIds.length === 0) return
        setCreating(true)
        try {
            const payload = {
                teaching_assignment_id: remedialQuiz.teaching_assignment.id,
                title: `[Remedial] ${remedialQuiz.title}`,
                description: `Remedial untuk kuis: ${remedialQuiz.title}`,
                duration_minutes: remedialQuiz.duration_minutes,
                is_randomized: remedialQuiz.is_randomized,
                is_remedial: true,
                remedial_for_id: remedialQuiz.id,
                allowed_student_ids: selectedStudentIds,
                duplicate_questions: remedialMethod === 'ASLI' // Custom flag to trigger backend duplication API
            }

            const res = await fetch('/api/quizzes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (res.ok) {
                const newQuiz = await res.json()
                setShowRemedial(false)
                fetchData() // Refresh list

                // If they require new questions, redirect to quiz editor
                if (remedialMethod === 'BARU') {
                    router.push(`/dashboard/guru/kuis/${newQuiz.id}`)
                }
            } else {
                alert('Gagal membuat quiz remedial')
            }
        } finally {
            setCreating(false)
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Kuis"
                subtitle="Buat dan kelola kuis dengan AI"
                backHref="/dashboard/guru"
                action={
                    <Button onClick={() => setShowCreate(true)} className="flex items-center gap-2">
                        <div className="text-white"><Plus set="bold" primaryColor="currentColor" size={20} /></div>
                        Buat Kuis
                    </Button>
                }
            />

            {aiReviewEnabled && returnedQuizzes.length > 0 && (
                <Card className="p-4 bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-700">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-red-500">🔬</span>
                        <h3 className="font-bold text-red-700 dark:text-red-300 text-sm">
                            Soal Perlu Diperbaiki ({returnedQuizzes.reduce((acc, curr) => acc + curr.returnedCount, 0)})
                        </h3>
                    </div>
                    <div className="space-y-2">
                        {returnedQuizzes.map(rq => (
                            <Link key={rq.quizId} href={`/dashboard/guru/kuis/${rq.quizId}`}>
                                <div className="flex items-center justify-between px-3 py-2 bg-white dark:bg-surface-dark rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors border border-red-100 dark:border-red-900/30">
                                    <span className="text-sm font-semibold text-text-main dark:text-white">{rq.title}</span>
                                    <span className="text-xs font-bold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-2.5 py-1 rounded-full">
                                        {rq.returnedCount} soal dikembalikan
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>
                </Card>
            )}

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin text-primary"><Loader2 className="w-10 h-10" /></div>
                </div>
            ) : quizzes.length === 0 ? (
                <EmptyState
                    icon={<div className="text-secondary"><Game set="bold" primaryColor="currentColor" size={48} /></div>}
                    title="Belum Ada Kuis"
                    description="Buat kuis pertama Anda dengan bantuan AI!"
                    action={
                        <Button onClick={() => setShowCreate(true)}>
                            Buat Kuis Sekarang
                        </Button>
                    }
                />
            ) : (
                <div className="grid gap-4">
                    {quizzes.map((quiz) => (
                        <Card key={quiz.id} className="p-4">
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h3 className="font-bold text-text-main dark:text-white text-lg">{quiz.title}</h3>
                                        {(quiz as any).is_remedial && (
                                            <span className="px-2 py-0.5 bg-gradient-to-r from-orange-400 to-red-500 text-white text-[10px] font-bold rounded-full shadow-sm animate-pulse-slow">
                                                REMEDIAL
                                            </span>
                                        )}
                                        {quiz.pending_publish ? (
                                            <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-xs rounded-full border border-amber-200 dark:border-amber-500/20 font-bold">🔍 Under Review</span>
                                        ) : quiz.is_active ? (
                                            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 text-xs rounded-full">Aktif</span>
                                        ) : (
                                            <span className="px-2 py-0.5 bg-amber-100 dark:bg-yellow-500/20 text-amber-700 dark:text-yellow-500 text-xs rounded-full border border-amber-200 dark:border-yellow-500/20">Draft</span>
                                        )}
                                    </div>
                                    <p className="text-sm text-text-secondary dark:text-zinc-400 mb-2">{quiz.description || '-'}</p>
                                    <div className="flex items-center gap-4 text-xs text-text-secondary dark:text-zinc-500">
                                        <span className="flex items-center gap-1.5">
                                            <Calendar set="bold" primaryColor="currentColor" size={14} />
                                            Dibuat: {new Date(quiz.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </span>
                                        <span className="px-2 py-1 bg-secondary/10 rounded">{quiz.teaching_assignment?.subject?.name}</span>
                                        <span className="px-2 py-1 bg-secondary/10 rounded">{quiz.teaching_assignment?.class?.name}</span>
                                        <span className="flex items-center gap-1"><Clock set="bold" primaryColor="currentColor" size={14} /> {quiz.duration_minutes} menit</span>
                                        <span className="flex items-center gap-1"><Edit set="bold" primaryColor="currentColor" size={14} /> {quiz.questions?.[0]?.count || 0} soal</span>
                                        {quiz.is_randomized && <span className="flex items-center gap-1"><Swap set="bold" primaryColor="currentColor" size={14} /> Acak</span>}
                                    </div>
                                    {/* Submission Counter */}
                                    {(() => {
                                        const classId = quiz.teaching_assignment?.class?.id
                                        const total = classId ? (studentCounts[classId] || 0) : 0
                                        const submitted = submissionCounts[quiz.id] || 0
                                        const pendingGrading = pendingGradingCounts[quiz.id] || 0
                                        return (
                                            <div className="mt-2 space-y-1">
                                                <div className="flex items-center gap-3">
                                                    <span className={`text-xs font-bold ${submitted >= total && total > 0 ? 'text-green-600' : 'text-primary'}`}>
                                                        📨 {submitted}/{total} mengumpulkan
                                                    </span>
                                                    {total > 0 && (
                                                        <div className="w-20 bg-secondary/20 rounded-full h-1.5 overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all duration-500 ${submitted >= total ? 'bg-green-500' : submitted > 0 ? 'bg-primary' : 'bg-secondary/30'}`}
                                                                style={{ width: `${Math.min(100, total > 0 ? (submitted / total) * 100 : 0)}%` }}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                                {pendingGrading > 0 && (
                                                    <Link href={`/dashboard/guru/kuis/${quiz.id}/hasil`} className="block">
                                                        <div className="flex items-center justify-between text-xs px-2 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors cursor-pointer">
                                                            <span className="text-amber-600 dark:text-amber-400 font-medium">📝 Perlu Dikoreksi</span>
                                                            <span className="font-bold text-amber-600 dark:text-amber-400">{pendingGrading}</span>
                                                        </div>
                                                    </Link>
                                                )}
                                            </div>
                                        )
                                    })()}
                                </div>
                                <div className="flex items-center gap-2">
                                    {quiz.is_active && (
                                        <Link
                                            href={`/dashboard/guru/kuis/${quiz.id}/hasil`}
                                            className="px-3 py-1.5 bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 rounded-full hover:bg-green-200 dark:hover:bg-green-500/30 transition-colors text-sm font-medium flex items-center gap-1"
                                        >
                                            <Graph set="bold" primaryColor="currentColor" size={16} /> Hasil
                                        </Link>
                                    )}
                                    {quiz.is_active && !(quiz as any).is_remedial && (
                                        <button
                                            onClick={() => handleOpenRemedial(quiz)}
                                            className="px-3 py-1.5 bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 rounded-full hover:bg-orange-200 dark:hover:bg-orange-500/30 transition-colors text-sm font-medium flex items-center gap-1"
                                        >
                                            <RefreshCw className="w-4 h-4" /> Remedial
                                        </button>
                                    )}
                                    <Link
                                        href={`/dashboard/guru/kuis/${quiz.id}`}
                                        className="px-3 py-1.5 bg-primary/10 text-primary rounded-full hover:bg-primary/20 transition-colors text-sm font-medium flex items-center gap-1"
                                    >
                                        <Edit set="bold" primaryColor="currentColor" size={16} /> Edit Soal
                                    </Link>
                                    <button
                                        onClick={() => handleDelete(quiz.id)}
                                        className="px-3 py-1.5 bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 rounded-full hover:bg-red-200 dark:hover:bg-red-500/30 transition-colors text-sm font-medium"
                                    >
                                        Hapus
                                    </button>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )
            }

            <Modal
                open={showCreate}
                onClose={() => setShowCreate(false)}
                title="Buat Kuis Baru"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kelas & Mata Pelajaran</label>
                        <select
                            value={form.teaching_assignment_id}
                            onChange={(e) => setForm({ ...form, teaching_assignment_id: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            disabled={teachingAssignments.length === 0}
                        >
                            <option value="">-- Pilih --</option>
                            {teachingAssignments.length === 0 ? (
                                <option disabled>Tidak ada kelas (Hubungi Admin)</option>
                            ) : (
                                teachingAssignments.map((ta) => (
                                    <option key={ta.id} value={ta.id}>
                                        {ta.class?.name || 'Unknown Class'} - {ta.subject?.name || 'Unknown Subject'}
                                    </option>
                                ))
                            )}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Kuis</label>
                        <input
                            type="text"
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Contoh: Kuis Bab 1 - Bilangan Bulat"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Deskripsi (Opsional)</label>
                        <textarea
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            rows={2}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Durasi (menit)</label>
                            <input
                                type="number"
                                value={form.duration_minutes}
                                onChange={(e) => setForm({ ...form, duration_minutes: parseInt(e.target.value) || 30 })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                min={5}
                            />
                        </div>
                        <div className="flex items-end">
                            <label className="flex items-center gap-2 cursor-pointer p-3 bg-secondary/5 border border-secondary/20 rounded-xl w-full">
                                <input
                                    type="checkbox"
                                    checked={form.is_randomized}
                                    onChange={(e) => setForm({ ...form, is_randomized: e.target.checked })}
                                    className="w-5 h-5 rounded bg-white border-secondary/30 text-primary focus:ring-primary"
                                />
                                <span className="text-text-main dark:text-white flex items-center gap-1"><Swap set="bold" primaryColor="currentColor" size={16} /> Acak Soal</span>
                            </label>
                        </div>
                    </div>
                    {/* Deadline Toggle */}
                    <div>
                        <label className="flex items-center gap-2 cursor-pointer mb-2">
                            <input
                                type="checkbox"
                                checked={hasDeadline}
                                onChange={(e) => {
                                    setHasDeadline(e.target.checked)
                                    if (!e.target.checked) setDeadlineValue('')
                                }}
                                className="w-5 h-5 rounded bg-white border-secondary/30 text-primary focus:ring-primary"
                            />
                            <span className="text-sm font-bold text-text-main dark:text-white">Batas Waktu Pengerjaan</span>
                        </label>
                        {hasDeadline && (
                            <input
                                type="datetime-local"
                                value={deadlineValue}
                                onChange={(e) => setDeadlineValue(e.target.value)}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        )}
                        <p className="text-xs text-text-secondary dark:text-zinc-500 mt-1">
                            {hasDeadline ? 'Siswa tidak bisa mengerjakan kuis setelah waktu ini.' : 'Tanpa batas waktu — siswa bisa mengerjakan kapan saja selama kuis aktif.'}
                        </p>
                    </div>
                    <div className="flex gap-3 pt-4">
                        <Button
                            variant="secondary"
                            onClick={() => setShowCreate(false)}
                            className="flex-1"
                        >
                            Batal
                        </Button>
                        <Button
                            onClick={handleCreate}
                            disabled={creating || !form.teaching_assignment_id || !form.title}
                            loading={creating}
                            className="flex-1"
                        >
                            Buat Kuis
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal
                open={showRemedial}
                onClose={() => setShowRemedial(false)}
                title="Tugaskan Remedial"
            >
                {remedialLoading ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                ) : remedialQuiz ? (
                    <div className="space-y-6">
                        {/* Info Kuis & KKM */}
                        <div className="bg-secondary/10 p-4 rounded-xl">
                            <h4 className="font-bold text-text-main dark:text-white mb-1">{remedialQuiz.title}</h4>
                            <div className="flex gap-4 text-sm text-text-secondary dark:text-zinc-400">
                                <span>Mata Pelajaran: <strong>{remedialQuiz.teaching_assignment?.subject?.name}</strong></span>
                                <span>KKM: <strong className="text-red-500">{remedialQuiz.teaching_assignment?.subject?.kkm || 75}</strong></span>
                            </div>
                        </div>

                        {/* Metode Soal */}
                        <div className="space-y-3">
                            <label className="block text-sm font-bold text-text-main dark:text-white">Metode Soal Remedial</label>
                            <div className="grid grid-cols-2 gap-3">
                                <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${remedialMethod === 'ASLI' ? 'border-primary bg-primary/5' : 'border-secondary/20 hover:border-primary/50'}`}>
                                    <input type="radio" name="method" checked={remedialMethod === 'ASLI'} onChange={() => setRemedialMethod('ASLI')} className="hidden" />
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${remedialMethod === 'ASLI' ? 'border-primary' : 'border-secondary/50'}`}>
                                        {remedialMethod === 'ASLI' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                                    </div>
                                    <span className="font-medium text-text-main dark:text-white">Gunakan Soal Asli</span>
                                </label>
                                <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${remedialMethod === 'BARU' ? 'border-primary bg-primary/5' : 'border-secondary/20 hover:border-primary/50'}`}>
                                    <input type="radio" name="method" checked={remedialMethod === 'BARU'} onChange={() => setRemedialMethod('BARU')} className="hidden" />
                                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${remedialMethod === 'BARU' ? 'border-primary' : 'border-secondary/50'}`}>
                                        {remedialMethod === 'BARU' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                                    </div>
                                    <span className="font-medium text-text-main dark:text-white">Buat Soal Baru</span>
                                </label>
                            </div>
                        </div>

                        {/* Pemilihan Siswa */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="block text-sm font-bold text-text-main dark:text-white">
                                    Pilih Siswa ({selectedStudentIds.length} terpilih)
                                </label>
                                <button
                                    onClick={() => setSelectedStudentIds(remedialStudents.map(s => s.user.id))}
                                    className="text-xs text-primary font-bold hover:underline"
                                >
                                    Pilih Semua
                                </button>
                            </div>
                            <div className="max-h-60 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                                {remedialStudents.length === 0 ? (
                                    <p className="text-sm text-text-secondary text-center py-4">Tidak ada siswa di kelas ini</p>
                                ) : (
                                    remedialStudents.map((student) => {
                                        const isSelected = selectedStudentIds.includes(student.user.id)
                                        return (
                                            <div
                                                key={student.id}
                                                onClick={() => {
                                                    if (isSelected) {
                                                        setSelectedStudentIds(prev => prev.filter(id => id !== student.user.id))
                                                    } else {
                                                        setSelectedStudentIds(prev => [...prev, student.user.id])
                                                    }
                                                }}
                                                className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${isSelected ? 'border-primary bg-primary/5 dark:bg-primary/20' : 'border-secondary/20 bg-white dark:bg-surface-dark hover:bg-secondary/5'}`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    {isSelected ? <CheckSquare className="text-primary w-5 h-5" /> : <Square className="text-secondary/50 w-5 h-5" />}
                                                    <span className="font-medium text-text-main dark:text-white">{student.user.full_name}</span>
                                                </div>
                                                <div className={`px-2 py-1 rounded text-xs font-bold ${student.isBelowKKM ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'}`}>
                                                    Nilai: {student.score}
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                            </div>
                        </div>

                        <div className="flex gap-3 pt-4">
                            <Button variant="secondary" onClick={() => setShowRemedial(false)} className="flex-1">
                                Batal
                            </Button>
                            <Button
                                onClick={handleCreateRemedial}
                                disabled={creating || selectedStudentIds.length === 0}
                                loading={creating}
                                className="flex-1"
                            >
                                Proses Remedial
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </div >
    )
}
