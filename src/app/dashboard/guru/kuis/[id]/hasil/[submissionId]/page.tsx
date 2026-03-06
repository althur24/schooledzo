'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import SmartText from '@/components/SmartText'
import { PageHeader, Card, Button } from '@/components/ui'

interface Answer {
    question_id: string
    answer: string
    is_correct?: boolean | null
    score?: number | null
    feedback?: string
}

interface Question {
    id: string
    question_text: string
    question_type: 'ESSAY' | 'MULTIPLE_CHOICE'
    options: string[] | null
    correct_answer: string | null
    points: number
    order_index: number
    passage_text?: string | null
    passage_audio_url?: string | null
}

interface SubmissionDetail {
    id: string
    answers: Answer[]
    total_score: number
    max_score: number
    student: {
        user: { full_name: string }
        nis: string
    }
    quiz: {
        title: string
        questions: Question[]
    }
}

export default function GradingPage() {
    const params = useParams()
    const router = useRouter()
    const quizId = params.id as string
    const submissionId = params.submissionId as string

    const [submission, setSubmission] = useState<SubmissionDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // Local state for grading edits
    const [grades, setGrades] = useState<Record<string, { score: number, feedback: string }>>({})

    useEffect(() => {
        fetchData()
    }, [submissionId])

    const fetchData = async () => {
        try {
            const res = await fetch(`/api/quiz-submissions/${submissionId}`)
            const data = await res.json()
            // Normalize answers to always be an array
            const normalizedData = {
                ...data,
                answers: Array.isArray(data.answers) ? data.answers : []
            }
            setSubmission(normalizedData)

            // Initialize grades state
            const initialGrades: Record<string, { score: number, feedback: string }> = {}
            if (data.answers && Array.isArray(data.answers)) {
                data.answers.forEach((ans: Answer) => {
                    initialGrades[ans.question_id] = {
                        score: ans.score || 0,
                        feedback: ans.feedback || ''
                    }
                })
            }
            setGrades(initialGrades)

        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleGradeChange = (qId: string, field: 'score' | 'feedback', value: string | number) => {
        setGrades(prev => ({
            ...prev,
            [qId]: {
                ...prev[qId],
                [field]: value
            }
        }))
    }

    const handleSave = async () => {
        if (!submission) return
        setSaving(true)

        try {
            // Reconstruct answers array with new grades
            let totalScore = 0
            const updatedAnswers = submission.answers.map(ans => {
                const grade = grades[ans.question_id]
                const currentScore = grade ? grade.score : (ans.score || 0)
                const currentFeedback = grade ? grade.feedback : (ans.feedback || '')

                totalScore += currentScore

                return {
                    ...ans,
                    score: currentScore,
                    feedback: currentFeedback
                }
            })

            await fetch(`/api/quiz-submissions/${submissionId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    answers: updatedAnswers,
                    total_score: totalScore,
                    is_graded: true
                })
            })

            // Using simple alert as per original code, could be replaced with Toast later
            alert('Penilaian berhasil disimpan!')
            router.push(`/dashboard/guru/kuis/${quizId}/hasil`)
        } catch (error) {
            console.error('Error saving:', error)
            alert('Gagal menyimpan penilaian')
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

    // Sort questions by order
    const questions = [...(submission.quiz.questions || [])].sort((a, b) => a.order_index - b.order_index)
    const currentTotalScore = Object.values(grades).reduce((acc, curr) => acc + (curr.score || 0), 0)

    return (
        <div className="space-y-6 pb-24">
            {/* Header Sticky wrapper */}
            <div className="sticky top-0 z-20 bg-white/95 dark:bg-surface-dark/95 backdrop-blur pt-4 pb-2 -mx-6 px-6 border-b border-secondary/10 dark:border-white/5">
                <PageHeader
                    title={`Penilaian: ${submission.student.user.full_name}`}
                    subtitle={submission.quiz.title}
                    backHref={`/dashboard/guru/kuis/${quizId}/hasil`}
                    action={
                        <div className="text-right">
                            <span className="text-3xl font-bold text-primary">
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
                    const grade = grades[q.id] || { score: 0, feedback: '' }
                    const isCorrect = q.question_type === 'MULTIPLE_CHOICE'
                        ? (ans?.answer === q.correct_answer)
                        : null

                    return (
                        <Card
                            key={q.id}
                            className={`p-6 transition-all ${q.question_type === 'ESSAY'
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
                                        <span className={`px-2 py-0.5 text-xs rounded-full ${q.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'}`}>
                                            {q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 'Essay'}
                                        </span>
                                        <span className="text-xs text-text-secondary">Max: {q.points} Poin</span>
                                    </div>

                                    {/* Passage audio / text if exists */}
                                    {(q.passage_audio_url || q.passage_text) && (
                                        <div className={`mb-4 p-3 ${q.passage_audio_url ? 'bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700' : 'bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700'} rounded-lg`}>
                                            {q.passage_audio_url && (
                                                <>
                                                    <p className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-1">🎧 Listening:</p>
                                                    <audio controls controlsList="nodownload" className="w-full mb-2" src={q.passage_audio_url} />
                                                </>
                                            )}
                                            {q.passage_text && (
                                                <>
                                                    <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-1">📖 Bacaan:</p>
                                                    <p className="text-sm text-text-main dark:text-white whitespace-pre-wrap leading-relaxed break-all" style={{ overflowWrap: 'anywhere' }}>{q.passage_text}</p>
                                                </>
                                            )}
                                        </div>
                                    )}

                                    <SmartText text={q.question_text} className="text-text-main dark:text-white text-lg mb-4" />

                                    <div className="bg-secondary/5 dark:bg-black/20 p-4 rounded-xl border border-secondary/20 dark:border-white/10 space-y-3">
                                        <div>
                                            <p className="text-xs text-text-secondary uppercase tracking-wider mb-1">Jawaban Siswa</p>
                                            <p className={`font-medium ${q.question_type === 'MULTIPLE_CHOICE'
                                                ? (isCorrect ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')
                                                : 'text-text-main dark:text-white whitespace-pre-wrap'
                                                }`}>
                                                {q.question_type === 'MULTIPLE_CHOICE' && q.options
                                                    ? ans?.answer
                                                        ? `${ans.answer}. ${q.options[ans.answer.charCodeAt(0) - 65] || ''}`
                                                        : '(Tidak menjawab)'
                                                    : ans?.answer || '(Tidak menjawab)'}
                                            </p>
                                        </div>

                                        {q.question_type === 'MULTIPLE_CHOICE' && !isCorrect && (
                                            <div>
                                                <p className="text-xs text-text-secondary uppercase tracking-wider mb-1">Kunci Jawaban</p>
                                                <p className="text-green-600 dark:text-green-400">
                                                    {q.correct_answer}. {q.options?.[(q.correct_answer?.charCodeAt(0) || 65) - 65]}
                                                </p>
                                            </div>
                                        )}
                                    </div>
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
                                                handleGradeChange(q.id, 'score', val)
                                            }}
                                            className={`w-24 px-3 py-2 bg-secondary/5 dark:bg-white/5 border rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 ${q.question_type === 'ESSAY' ? 'border-amber-500 focus:ring-amber-500' : 'border-secondary/30 dark:border-white/20 focus:ring-primary'} ${q.question_type === 'MULTIPLE_CHOICE' ? 'opacity-50 cursor-not-allowed bg-secondary/10' : ''}`}
                                            max={q.points}
                                            min={0}
                                            disabled={q.question_type === 'MULTIPLE_CHOICE'}
                                        />
                                        <span className="text-text-secondary text-sm">/ {q.points}</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Feedback</label>
                                    <input
                                        type="text"
                                        value={grade.feedback ?? ''}
                                        onChange={(e) => handleGradeChange(q.id, 'feedback', e.target.value)}
                                        className={`w-full px-3 py-2 bg-secondary/5 dark:bg-white/5 border border-secondary/30 dark:border-white/20 rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50 ${q.question_type === 'MULTIPLE_CHOICE' ? 'opacity-50 cursor-not-allowed bg-secondary/10' : ''}`}
                                        placeholder={q.question_type === 'MULTIPLE_CHOICE' ? 'Sistem otomatis menilai soal Pilihan Ganda' : 'Berikan catatan...'}
                                        disabled={q.question_type === 'MULTIPLE_CHOICE'}
                                    />
                                </div>
                            </div>
                        </Card>
                    )
                })}
            </div>

            {/* Save Action Sticky Footer */}
            <div className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-surface-dark/95 backdrop-blur border-t border-secondary/10 dark:border-white/5 p-4 z-20">
                <div className="max-w-4xl mx-auto flex items-center justify-end gap-4">
                    <Link href={`/dashboard/guru/kuis/${quizId}/hasil`}>
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
