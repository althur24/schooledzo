'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageHeader, Button, Modal } from '@/components/ui'
import Card from '@/components/ui/Card'
import SmartText from '@/components/SmartText'
import {
    Loader2, ArrowLeft, GraduationCap, BarChart3, Users,
    CheckCircle, AlertTriangle, Save, ChevronDown, ChevronUp, History, Download, RefreshCw, XCircle, AlertCircle, Search, Filter
} from 'lucide-react'

interface Submission {
    id: string
    student_id: string
    total_score: number
    max_score: number
    is_submitted: boolean
    is_graded: boolean
    violation_count: number
    submitted_at: string | null
    student: {
        id: string
        nis: string | null
        class_id: string
        user: { full_name: string }
    }
}

interface SubmissionDetail {
    id: string
    answers: {
        id: string
        answer: string
        is_correct: boolean
        points_earned: number
        question: {
            id: string
            question_text: string
            question_type: string
            options: string[] | null
            correct_answer: string | null
            points: number
        }
    }[]
}

export default function GuruUtsUasHasilPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: examId } = use(params)
    const router = useRouter()

    const [exam, setExam] = useState<any>(null)
    const [submissions, setSubmissions] = useState<Submission[]>([])
    const [loading, setLoading] = useState(true)
    const [classFilter, setClassFilter] = useState('')
    const [subjectKkms, setSubjectKkms] = useState<any[]>([])

    // Grading modal
    const [gradingSubmission, setGradingSubmission] = useState<SubmissionDetail | null>(null)
    const [gradingStudentName, setGradingStudentName] = useState('')
    const [showGrading, setShowGrading] = useState(false)
    const [gradingScores, setGradingScores] = useState<Record<string, number>>({})
    const [gradingSaving, setGradingSaving] = useState(false)

    useEffect(() => {
        fetchData()
    }, [examId])

    useEffect(() => {
        fetchSubmissions()
    }, [classFilter])

    const fetchData = async () => {
        try {
            const res = await fetch(`/api/official-exams/${examId}`)
            const data = await res.json()
            setExam(data)

            if (data?.subject_id) {
                const kkmRes = await fetch(`/api/subject-kkm?subject_id=${data.subject_id}`)
                if (kkmRes.ok) {
                    const kkmData = await kkmRes.json()
                    setSubjectKkms(Array.isArray(kkmData) ? kkmData : [])
                }
            }

            await fetchSubmissions()
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchSubmissions = async () => {
        try {
            let url = `/api/official-exam-submissions?exam_id=${examId}`
            if (classFilter) url += `&class_id=${classFilter}`
            const res = await fetch(url)
            const data = await res.json()
            setSubmissions(Array.isArray(data) ? data : [])
        } catch { }
    }

    const openGrading = async (sub: Submission) => {
        try {
            const res = await fetch(`/api/official-exam-submissions/${sub.id}`)
            const data = await res.json()
            setGradingSubmission(data)
            setGradingStudentName(sub.student?.user?.full_name || '')

            // Initialize scores
            const scores: Record<string, number> = {}
            data.answers?.forEach((a: any) => {
                scores[a.id] = a.points_earned || 0
            })
            setGradingScores(scores)
            setShowGrading(true)
        } catch (error) {
            console.error('Error:', error)
        }
    }

    const handleSaveGrading = async () => {
        if (!gradingSubmission) return
        setGradingSaving(true)
        try {
            const grades = Object.entries(gradingScores).map(([answer_id, points_earned]) => ({
                answer_id,
                points_earned
            }))

            const res = await fetch(`/api/official-exam-submissions/${gradingSubmission.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grades })
            })

            if (res.ok) {
                setShowGrading(false)
                fetchSubmissions()
            }
        } finally {
            setGradingSaving(false)
        }
    }

    if (loading) {
        return <div className="flex justify-center py-20"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>
    }

    if (!exam) {
        return <div className="text-center py-20 text-text-secondary">Ujian tidak ditemukan</div>
    }

    const targetClasses = exam.target_classes || []

    const getKkm = (classId: string) => {
        const fallback = exam.subject?.kkm || 75
        const targetClass = targetClasses.find((c: any) => c.id === classId)
        if (!targetClass?.school_level || !targetClass?.grade_level) return fallback

        const granular = subjectKkms.find((k: any) => 
            k.school_level === targetClass.school_level && 
            k.grade_level === targetClass.grade_level
        )
        return granular ? granular.kkm : fallback
    }

    // Stats
    const totalSubmitted = submissions.filter(s => s.is_submitted).length
    const pendingGrading = submissions.filter(s => s.is_submitted && !s.is_graded).length
    const avgScore = submissions.filter(s => s.is_submitted && s.max_score > 0).reduce((sum, s) => sum + (s.total_score / s.max_score) * 100, 0) / (totalSubmitted || 1)

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                {/* Header Actions */}
                <Link
                    href={'/dashboard/guru/ulangan'}
                    className="inline-flex items-center justify-center p-3 mb-4 rounded-xl bg-white dark:bg-surface-dark border border-secondary/20 hover:border-primary text-text-secondary hover:text-primary transition-all shadow-sm"
                    title="Kembali ke Daftar Ulangan"
                >
                    <ArrowLeft className="w-5 h-5" />
                </Link>
                <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 text-sm font-bold rounded-full ${exam.exam_type === 'UTS' ? 'bg-indigo-500/10 text-indigo-600' : 'bg-purple-500/10 text-purple-600'}`}>
                        {exam.exam_type}
                    </span>
                    <h1 className="text-xl md:text-2xl font-bold text-text-main dark:text-white">{exam.title}</h1>
                </div>
                <p className="text-sm text-text-secondary mt-1">{exam.subject?.name} • Hasil Ujian</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card padding="p-4" className="bg-gradient-to-br from-blue-500/5 to-blue-600/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600"><Users className="w-5 h-5" /></div>
                        <div>
                            <p className="text-xl md:text-2xl font-bold text-text-main dark:text-white">{totalSubmitted}</p>
                            <p className="text-xs text-text-secondary">Terkumpul</p>
                        </div>
                    </div>
                </Card>
                <Card padding="p-4" className="bg-gradient-to-br from-amber-500/5 to-amber-600/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600"><AlertTriangle className="w-5 h-5" /></div>
                        <div>
                            <p className="text-xl md:text-2xl font-bold text-text-main dark:text-white">{pendingGrading}</p>
                            <p className="text-xs text-text-secondary">Perlu Koreksi</p>
                        </div>
                    </div>
                </Card>
                <Card padding="p-4" className="bg-gradient-to-br from-green-500/5 to-green-600/5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600"><BarChart3 className="w-5 h-5" /></div>
                        <div>
                            <p className="text-xl md:text-2xl font-bold text-text-main dark:text-white">{Math.round(avgScore)}%</p>
                            <p className="text-xs text-text-secondary">Rata-rata Skor</p>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Class filter */}
            <div className="flex gap-3 items-center">
                <select
                    value={classFilter}
                    onChange={(e) => setClassFilter(e.target.value)}
                    className="px-4 py-2 bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                >
                    <option value="">Semua Kelas</option>
                    {targetClasses.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
            </div>

            {/* Results Table */}
            {submissions.length === 0 ? (
                <Card padding="p-8" className="text-center">
                    <BarChart3 className="w-12 h-12 text-text-secondary/50 mx-auto mb-3" />
                    <p className="text-text-secondary">Belum ada submission.</p>
                </Card>
            ) : (
                <Card padding="p-0" className="overflow-hidden">
                    <table className="w-full">
                        <thead className="bg-secondary/5">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-bold text-text-main dark:text-white">No</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-text-main dark:text-white">Nama Siswa</th>
                                <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white">NIS</th>
                                <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white">Skor</th>
                                <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white">Pelanggaran</th>
                                <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white">Status</th>
                                <th className="px-4 py-3 text-center text-xs font-bold text-text-main dark:text-white">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-secondary/10">
                            {submissions.map((sub, idx) => {
                                const pct = sub.max_score > 0 ? Math.round((sub.total_score / sub.max_score) * 100) : 0
                                return (
                                    <tr key={sub.id} className="hover:bg-secondary/5">
                                        <td className="px-4 py-3 text-sm text-text-secondary">{idx + 1}</td>
                                        <td className="px-4 py-3 text-sm font-medium text-text-main dark:text-white">{sub.student?.user?.full_name || '-'}</td>
                                        <td className="px-4 py-3 text-center text-xs text-text-secondary">{sub.student?.nis || '-'}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`font-bold text-sm ${pct >= getKkm(sub.student?.class_id) ? 'text-green-600' : pct >= getKkm(sub.student?.class_id) - 15 ? 'text-amber-600' : 'text-red-600'}`}>
                                                {sub.total_score}/{sub.max_score} ({pct}%)
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center text-xs">{sub.violation_count}</td>
                                        <td className="px-4 py-3 text-center">
                                            {sub.is_submitted ? (
                                                sub.is_graded ? (
                                                    <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 font-bold">Selesai</span>
                                                ) : (
                                                    <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 font-bold">Perlu Koreksi</span>
                                                )
                                            ) : (
                                                <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-600 font-bold">Mengerjakan</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {sub.is_submitted && !sub.is_graded && (
                                                <Button size="sm" variant="outline" onClick={() => openGrading(sub)} className="text-xs">
                                                    Koreksi
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </Card>
            )}

            {/* Grading Modal */}
            <Modal open={showGrading} onClose={() => setShowGrading(false)} title={`Koreksi Essay — ${gradingStudentName}`}>
                {gradingSubmission && (
                    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                        {gradingSubmission.answers
                            ?.filter((a: any) => a.question?.question_type === 'ESSAY')
                            .map((answer: any, idx: number) => (
                                <Card key={answer.id} padding="p-4" className="space-y-3">
                                    <div>
                                        <p className="text-xs text-text-secondary mb-1 font-bold">Soal {idx + 1} ({answer.question?.points} poin)</p>
                                        <div className="text-sm text-text-main dark:text-white">
                                            <SmartText text={answer.question?.question_text || ''} />
                                        </div>
                                    </div>
                                    <div className="p-3 bg-secondary/5 rounded-lg">
                                        <p className="text-xs text-text-secondary mb-1 font-bold">Jawaban Siswa:</p>
                                        <p className="text-sm text-text-main dark:text-white whitespace-pre-wrap">{answer.answer || '(tidak dijawab)'}</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <label className="text-sm font-bold text-text-main dark:text-white">Poin:</label>
                                        <input
                                            type="number"
                                            value={gradingScores[answer.id] || 0}
                                            onChange={(e) => setGradingScores(prev => ({ ...prev, [answer.id]: Math.min(parseInt(e.target.value) || 0, answer.question?.points || 100) }))}
                                            min={0}
                                            max={answer.question?.points || 100}
                                            className="w-24 px-3 py-2 bg-secondary/5 border border-secondary/20 rounded-lg text-center font-bold text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                        />
                                        <span className="text-sm text-text-secondary">/ {answer.question?.points}</span>
                                    </div>
                                </Card>
                            ))}
                        <div className="flex gap-3 pt-4 border-t border-secondary/10">
                            <Button variant="secondary" onClick={() => setShowGrading(false)} className="flex-1">Batal</Button>
                            <Button onClick={handleSaveGrading} loading={gradingSaving} className="flex-1" icon={<Save className="w-4 h-4" />}>
                                Simpan Koreksi
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    )
}
