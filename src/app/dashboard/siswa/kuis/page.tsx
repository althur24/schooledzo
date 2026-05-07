'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, EmptyState } from '@/components/ui'
import { Loader2 } from 'lucide-react'
import { Game, Calendar, TimeCircle, Document, TickSquare } from 'react-iconly'

interface Quiz {
    id: string
    title: string
    description: string | null
    duration_minutes: number
    is_active: boolean
    created_at: string
    teaching_assignment: {
        subject: { name: string }
        class: { name: string }
    }
    questions: { count: number }[]
}

interface QuizSubmission {
    id: string
    quiz_id: string
    submitted_at: string | null
    total_score: number
    max_score: number
    is_graded: boolean
    started_at: string
}

export default function SiswaKuisPage() {
    const { user } = useAuth()
    const [quizzes, setQuizzes] = useState<Quiz[]>([])
    const [submissions, setSubmissions] = useState<QuizSubmission[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const fetchData = async () => {
            if (!user) return
            try {
                // Fetch Student Profile First
                const studentsRes = await fetch(`/api/students?user_id=${user.id}`)
                const students = await studentsRes.json()
                const myStudent = students[0] || null

                if (!myStudent?.class_id) {
                    setLoading(false)
                    return
                }

                const [quizzesRes, subsRes] = await Promise.all([
                    fetch('/api/quizzes'),
                    fetch(`/api/quiz-submissions?student_id=${myStudent.id}`)
                ])
                const [quizzesData, subsData] = await Promise.all([
                    quizzesRes.json(),
                    subsRes.json()
                ])

                const quizzesArray = Array.isArray(quizzesData) ? quizzesData : []
                const myQuizzes = quizzesArray.filter((q: Quiz) =>
                    q.is_active && q.teaching_assignment?.class?.name === myStudent.class.name
                )
                setQuizzes(myQuizzes)
                setSubmissions(Array.isArray(subsData) ? subsData : [])
            } catch (error) {
                console.error('Error:', error)
            } finally {
                setLoading(false)
            }
        }
        if (user) fetchData()
    }, [user])

    const getSubmission = (quizId: string) => {
        return submissions.find((s) => s.quiz_id === quizId)
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Kuis"
                subtitle="Kerjakan kuis dari guru"
                icon={<div className="text-purple-500 flex"><Game set="bold" primaryColor="currentColor" size="small" /></div>}
                backHref="/dashboard/siswa"
            />

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : quizzes.length === 0 ? (
                <EmptyState
                    icon={<div className="text-secondary flex"><Game set="bold" primaryColor="currentColor" size="xlarge" /></div>}
                    title="Belum Ada Kuis"
                    description="Belum ada kuis aktif untuk kelasmu"
                />
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {quizzes.map((quiz) => {
                        const submission = getSubmission(quiz.id)
                        const isCompleted = !!submission?.submitted_at
                        const isInProgress = submission && !submission.submitted_at
                        const questionCount = quiz.questions?.[0]?.count || 0

                        return (
                            <div key={quiz.id} className="bg-white dark:bg-surface-dark border-2 border-primary/30 rounded-xl p-4 md:p-5 hover:border-primary hover:shadow-lg hover:shadow-primary/10 active:scale-[0.98] transition-all group cursor-pointer">
                                <div className="flex flex-col h-full gap-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="px-2.5 py-1 bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400 text-xs font-bold rounded-full">
                                                    Kuis
                                                </span>
                                                {isCompleted && (
                                                    <span className="px-2.5 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs font-bold rounded-full flex items-center gap-1">
                                                        <TickSquare set="bold" primaryColor="currentColor" size={12} /> Selesai
                                                    </span>
                                                )}
                                                {isInProgress && (
                                                    <span className="px-2.5 py-1 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-xs font-bold rounded-full flex items-center gap-1">
                                                        <TimeCircle set="bold" primaryColor="currentColor" size={12} /> Sedang Dikerjakan
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="font-bold text-text-main dark:text-white text-base md:text-lg group-hover:text-cyan-600 transition-colors">{quiz.title}</h3>
                                        </div>
                                    </div>

                                    <p className="text-sm text-text-secondary dark:text-zinc-400 line-clamp-2">{quiz.description || 'Tidak ada deskripsi'}</p>

                                    <div className="space-y-2 pt-3 border-t border-secondary/10">
                                        <div className="flex items-center text-xs text-text-secondary dark:text-zinc-500 mb-2">
                                            <span className="mr-1.5 flex"><Calendar set="bold" primaryColor="currentColor" size="small" /></span>
                                            Dibuat: {new Date(quiz.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-text-secondary">
                                            <span>Mata Pelajaran</span>
                                            <span className="font-bold text-text-main dark:text-zinc-300">{quiz.teaching_assignment?.subject?.name}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-text-secondary">
                                            <span>Durasi</span>
                                            <span className="font-medium flex items-center gap-1"><TimeCircle set="bold" primaryColor="currentColor" size={14} /> {quiz.duration_minutes} menit</span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-text-secondary">
                                            <span>Jumlah Soal</span>
                                            <span className="font-medium flex items-center gap-1"><Document set="bold" primaryColor="currentColor" size={14} /> {questionCount} soal</span>
                                        </div>
                                    </div>

                                    <div className="mt-auto pt-3">
                                        {isCompleted ? (
                                            <div className="flex items-center gap-3">
                                                <div className="flex-1 p-2 bg-secondary/10 rounded-lg text-center">
                                                    <p className="text-xs text-text-secondary">Nilai</p>
                                                    <p className="text-lg md:text-xl font-bold text-cyan-600 dark:text-cyan-400">
                                                        {submission.total_score}/{submission.max_score}
                                                    </p>
                                                </div>
                                                <Link
                                                    href={`/dashboard/siswa/kuis/${quiz.id}/hasil`}
                                                    className="flex-1 px-3 py-2 md:px-4 md:py-3 bg-secondary/20 text-text-main dark:text-white rounded-xl font-bold hover:bg-secondary/30 transition-colors text-center text-xs md:text-sm"
                                                >
                                                    Lihat Hasil
                                                </Link>
                                            </div>
                                        ) : isInProgress ? (
                                            (() => {
                                                // Check expiration
                                                const startedAt = new Date(submission.started_at).getTime()
                                                const durationMs = quiz.duration_minutes * 60000
                                                const isExpired = Date.now() > (startedAt + durationMs + 60000)

                                                if (isExpired) {
                                                    return (
                                                        <Link
                                                            href={`/dashboard/siswa/kuis/${quiz.id}`}
                                                            className="w-full block text-center px-4 py-2 md:px-6 md:py-3 bg-secondary/80 text-text-main dark:text-white rounded-xl font-bold hover:bg-secondary transition-all text-xs md:text-sm"
                                                        >
                                                            Lihat Hasil
                                                        </Link>
                                                    )
                                                }
                                                return (
                                                    <Link
                                                        href={`/dashboard/siswa/kuis/${quiz.id}`}
                                                        className="w-full block text-center px-4 py-2.5 md:px-6 md:py-3 bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-xl font-bold shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 hover:scale-[1.02] transition-all text-sm md:text-base"
                                                    >
                                                        Lanjutkan Kuis
                                                    </Link>
                                                )
                                            })()
                                        ) : (
                                            <Link
                                                href={`/dashboard/siswa/kuis/${quiz.id}`}
                                                className="w-full block text-center px-4 py-2.5 md:px-6 md:py-3 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl font-bold shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:scale-[1.02] transition-all text-sm md:text-base"
                                            >
                                                Mulai Kuis
                                            </Link>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
