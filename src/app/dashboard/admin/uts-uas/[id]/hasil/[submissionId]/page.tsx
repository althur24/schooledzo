'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import SmartText from '@/components/SmartText'
import PassageBlock from '@/components/PassageBlock'
import GradingAnswerDisplay from '@/components/GradingAnswerDisplay'
import { isAutoGradeable } from '@/lib/questionTypeUtils'
import { PageHeader, Card, Button } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'

interface Answer {
    id: string
    question_id: string
    answer: string
    is_correct?: boolean | null
    points_earned?: number | null
    question?: Question // joined from API
}

interface Question {
    id: string
    question_text: string
    question_type: string
    options: string[] | null
    correct_answer: string | null
    points: number
    order_index: number
    passage_text?: string | null
    passage_audio_url?: string | null
    text_direction?: 'ltr' | 'rtl'
}

interface SubmissionDetail {
    id: string
    answers: Answer[]
    total_score: number
    max_score: number
    violation_count: number
    student: {
        user: { full_name: string }
        nis: string
    }
    exam: {
        title: string
    }
}

export default function AdminUtsUasGradingPage() {
    const params = useParams()
    const router = useRouter()
    const examId = params.id as string
    const submissionId = params.submissionId as string
    // Halaman ini dipakai admin & guru (via wrapper guru/uts-uas/[id]/hasil/[submissionId])
    const { user } = useAuth()
    const basePath = user?.role === 'GURU' ? '/dashboard/guru/uts-uas' : '/dashboard/admin/uts-uas'

    const [submission, setSubmission] = useState<SubmissionDetail | null>(null)
    // Extracted & deduplicated questions from answers[].question
    const [questions, setQuestions] = useState<Question[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // Local state for grading edits
    const [grades, setGrades] = useState<Record<string, { score: number }>>({})

    useEffect(() => {
        fetchData()
    }, [submissionId])

    const fetchData = async () => {
        try {
            const res = await fetch(`/api/official-exam-submissions/${submissionId}`)
            const data = await res.json()
            // Normalize answers to always be an array
            const answers: Answer[] = Array.isArray(data.answers) ? data.answers : []
            setSubmission({ ...data, answers })

            // Extract questions from each answer's joined `question` field (deduplicated)
            const questionMap = new Map<string, Question>()
            const initialGrades: Record<string, { score: number }> = {}

            answers.forEach((ans: any) => {
                if (ans.question) {
                    questionMap.set(ans.question.id, ans.question as Question)
                }
                initialGrades[ans.question_id] = {
                    score: ans.points_earned ?? 0
                }
            })

            // Sort by order_index
            const sortedQuestions = Array.from(questionMap.values()).sort(
                (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)
            )
            setQuestions(sortedQuestions)
            setGrades(initialGrades)

        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleGradeChange = (qId: string, value: string | number) => {
        setGrades(prev => ({
            ...prev,
            [qId]: {
                score: typeof value === 'string' ? parseInt(value) || 0 : value
            }
        }))
    }

    const handleSave = async () => {
        if (!submission) return
        setSaving(true)

        try {
            // Reconstruct payload for the API
            const gradesPayload = submission.answers.map(ans => {
                const grade = grades[ans.question_id]
                const currentScore = grade ? grade.score : (ans.points_earned || 0)

                return {
                    answer_id: ans.id,
                    points_earned: currentScore
                }
            })

            const response = await fetch(`/api/official-exam-submissions/${submissionId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grades: gradesPayload })
            })

            if (!response.ok) {
                const errorData = await response.json()
                throw new Error(errorData.error || 'Failed to save')
            }

            alert('Penilaian berhasil disimpan!')
            router.push(`${basePath}/${examId}`)
        } catch (error: any) {
            console.error('Error saving:', error)
            alert(error.message || 'Gagal menyimpan penilaian')
        } finally {
            setSaving(false)
        }
    }

    if (loading) return (
        <div className="flex justify-center py-12">
            <div className="animate-spin text-3xl text-primary">⏳</div>
        </div>
    )
    if (!submission) return <div className="text-center text-text-secondary py-8">Data tidak ditemukan</div>

    const currentTotalScore = Object.values(grades).reduce((acc, curr) => acc + (curr.score || 0), 0)

    return (
        <div className="space-y-6 pb-24">
            {/* Header Sticky wrapper */}
            <div className="sticky top-0 z-20 bg-white/95 dark:bg-surface-dark/95 backdrop-blur pt-4 pb-2 -mx-6 px-6 border-b border-secondary/10 dark:border-white/5">
                <PageHeader
                    title={`Penilaian: ${submission.student.user.full_name}`}
                    subtitle={`${submission.exam.title} • ${submission.violation_count > 0 ? `⚠️ ${submission.violation_count} Pelanggaran` : ''}`}
                    backHref={`${basePath}/${examId}`}
                    action={
                        <div className="text-right">
                            <span className="text-2xl md:text-3xl font-bold text-primary">
                                {currentTotalScore}
                            </span>
                            <span className="text-sm text-text-secondary ml-1">/{submission.max_score}</span>
                        </div>
                    }
                />
            </div>

            {/* Grading List */}
            <div className="space-y-6 max-w-4xl mx-auto px-4">
                {questions.map((q, idx) => {
                    const ans = submission.answers.find(a => a.question_id === q.id)
                    const grade = grades[q.id] || { score: 0 }
                    const isCorrect = ans?.is_correct

                    return (
                        <Card
                            key={q.id}
                            className={`p-6 transition-all ${(q.question_type === 'ESSAY' || q.question_type === 'SHORT_ANSWER')
                                ? 'border-amber-500/30'
                                : ''
                                }`}
                        >
                            <div className="flex items-start gap-4 mb-4">
                                <span className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold flex-shrink-0">
                                    {idx + 1}
                                </span>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`px-2 py-0.5 text-xs rounded-full bg-secondary/10 text-text-main dark:text-white border border-secondary/20`}>
                                            {q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 
                                             q.question_type === 'MULTIPLE_ANSWER' ? 'Ganda Kompleks' : 
                                             q.question_type === 'TRUE_FALSE' ? 'Benar Salah' : 
                                             q.question_type === 'SHORT_ANSWER' ? 'Isian Singkat' : 'Essay'}
                                        </span>
                                        <span className="text-xs text-text-secondary">Max: {q.points} Poin</span>
                                    </div>

                                    {/* Passage audio / text if exists */}
                                    {(q.passage_audio_url || q.passage_text) && (
                                        <div className="mb-4">
                                            {q.passage_audio_url && (
                                                <div className="mb-3 p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-lg">
                                                    <p className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-1">🎧 Listening:</p>
                                                    <audio controls controlsList="nodownload" className="w-full mb-2" src={q.passage_audio_url} />
                                                </div>
                                            )}
                                            {q.passage_text && (
                                                <PassageBlock text={q.passage_text} />
                                            )}
                                        </div>
                                    )}

                                    <div dir={q.text_direction || 'ltr'}>
                                        <SmartText text={q.question_text} className={`text-text-main dark:text-white text-lg mb-4 ${q.text_direction === 'rtl' ? 'text-right' : ''}`} />
                                    </div>

                                    <GradingAnswerDisplay question={q as any} answer={ans} />
                                </div>
                            </div>

                            <div className="pl-12 grid grid-cols-1 md:grid-cols-2 gap-4 bg-secondary/5 dark:bg-white/5 p-4 rounded-xl mt-4">
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Nilai</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            value={grade.score ?? 0}
                                            onChange={(e) => {
                                                const val = Math.min(q.points, Math.max(0, parseInt(e.target.value) || 0))
                                                handleGradeChange(q.id, val)
                                            }}
                                            className={`w-24 px-3 py-2 bg-secondary/5 dark:bg-white/5 border rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 ${(q.question_type === 'ESSAY' || q.question_type === 'SHORT_ANSWER') ? 'border-amber-500 focus:ring-amber-500' : 'border-secondary/30 dark:border-white/20 focus:ring-primary'} ${isAutoGradeable(q.question_type) ? 'opacity-50 cursor-not-allowed bg-secondary/10' : ''}`}
                                            max={q.points}
                                            min={0}
                                            disabled={isAutoGradeable(q.question_type)}
                                        />
                                        <span className="text-text-secondary text-sm">/ {q.points}</span>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    )
                })}
            </div>

            {/* Save Action Sticky Footer */}
            <div className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-surface-dark/95 backdrop-blur border-t border-secondary/10 dark:border-white/5 p-4 z-20">
                <div className="max-w-4xl mx-auto flex items-center justify-end gap-4">
                    <Link href={`${basePath}/${examId}`}>
                        <Button variant="secondary">Batal</Button>
                    </Link>
                    <Button
                        onClick={handleSave}
                        disabled={saving}
                        loading={saving}
                        className="bg-gradient-to-r from-green-600 to-emerald-600 px-8"
                    >
                        Simpan Penilaian
                    </Button>
                </div>
            </div>
        </div>
    )
}
