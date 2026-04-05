'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PageHeader, Card, Button, EmptyState, StatsCard } from '@/components/ui'
import { InfoCircle, TickSquare, User, TimeCircle, Document, ArrowDown, ChevronDown } from 'react-iconly'
import { Loader2 } from 'lucide-react'

interface QuizSubmission {
    id: string
    submitted_at: string
    total_score: number
    max_score: number
    is_graded: boolean
    student: {
        id: string
        nis: string
        user: { full_name: string }
    }
}

interface Quiz {
    title: string
    teaching_assignment: {
        class: { id: string; name: string }
        subject: { name: string }
    }
}

interface Student {
    id: string
    nis: string
    user: { full_name: string }
}

export default function QuizSubmissionsPage() {
    const params = useParams()
    const quizId = params.id as string

    const [submissions, setSubmissions] = useState<QuizSubmission[]>([])
    const [quiz, setQuiz] = useState<Quiz | null>(null)
    const [classStudents, setClassStudents] = useState<Student[]>([])
    const [loading, setLoading] = useState(true)
    const [showNotSubmitted, setShowNotSubmitted] = useState(false)

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [quizRes, subsRes] = await Promise.all([
                    fetch(`/api/quizzes/${quizId}`),
                    fetch(`/api/quiz-submissions?quiz_id=${quizId}`)
                ])

                const quizData = await quizRes.json()
                const subsData = await subsRes.json()

                // Sort submissions alphabetically by student name
                subsData.sort((a: QuizSubmission, b: QuizSubmission) => 
                    a.student.user.full_name.localeCompare(b.student.user.full_name)
                )

                setQuiz(quizData)
                setSubmissions(subsData)

                // Fetch students in this class
                if (quizData.teaching_assignment?.class?.id) {
                    const studentsRes = await fetch(`/api/students?class_id=${quizData.teaching_assignment.class.id}`)
                    const studentsData = await studentsRes.json()
                    setClassStudents(studentsData)
                }

            } catch (error) {
                console.error('Error:', error)
            } finally {
                setLoading(false)
            }
        }
        fetchData()
    }, [quizId])

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('id-ID', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        })
    }

    // Calculate not submitted students
    const submittedStudentIds = submissions.map(s => s.student.id)
    const notSubmittedStudents = classStudents
        .filter(s => !submittedStudentIds.includes(s.id))
        .sort((a, b) => a.user.full_name.localeCompare(b.user.full_name))

    if (loading) return (
        <div className="flex justify-center py-12">
            <div className="animate-spin text-primary"><Loader2 className="w-10 h-10" /></div>
        </div>
    )

    return (
        <div className="space-y-6">
            <PageHeader
                title={`Hasil Kuis: ${quiz?.title || ''}`}
                subtitle={`${quiz?.teaching_assignment?.class?.name} • ${quiz?.teaching_assignment?.subject?.name} • ${submissions.length} Pengumpulan`}
                backHref="/dashboard/guru/kuis"
            />

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatsCard
                    value={submissions.length}
                    label="Sudah Mengerjakan"
                    icon={<div className="text-white"><TickSquare set="bold" primaryColor="currentColor" size={24} /></div>}
                />
                <StatsCard
                    value={notSubmittedStudents.length}
                    label="Belum Mengerjakan"
                    icon={<div className="text-white"><TimeCircle set="bold" primaryColor="currentColor" size={24} /></div>}
                />
                <StatsCard
                    value={classStudents.length}
                    label="Total Siswa"
                    icon={<div className="text-white"><User set="bold" primaryColor="currentColor" size={24} /></div>}
                />
            </div>

            {/* Not Submitted Students Section */}
            {notSubmittedStudents.length > 0 && (
                <Card className="bg-red-500/10 border-red-500/30">
                    <button
                        onClick={() => setShowNotSubmitted(!showNotSubmitted)}
                        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-red-500/20 transition-colors rounded-lg"
                    >
                        <div className="flex items-center gap-3">
                            <span className="text-red-400"><InfoCircle set="bold" primaryColor="currentColor" size={20} /></span>
                            <span className="text-red-400 font-medium">{notSubmittedStudents.length} Siswa Belum Mengerjakan</span>
                        </div>
                        <div className={`text-red-400 transition-transform ${showNotSubmitted ? 'rotate-180' : ''}`}>
                            <ChevronDown set="bold" primaryColor="currentColor" size={20} />
                        </div>
                    </button>
                    {showNotSubmitted && (
                        <div className="px-4 pb-4 space-y-2 mt-2">
                            {notSubmittedStudents.map(student => (
                                <div key={student.id} className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-surface-dark rounded-lg shadow-sm">
                                    <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-500/20 text-red-500 dark:text-red-400 flex items-center justify-center text-xs font-bold">
                                        {student.user.full_name.charAt(0)}
                                    </div>
                                    <div>
                                        <p className="text-text-main dark:text-white text-sm font-medium">{student.user.full_name}</p>
                                        <p className="text-xs text-text-secondary dark:text-zinc-500">{student.nis}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            {/* Submissions Table */}
            {submissions.length === 0 ? (
                <EmptyState
                    icon={<div className="text-secondary"><Document set="bold" primaryColor="currentColor" size={48} /></div>}
                    title="Belum ada pengumpulan"
                    description="Belum ada siswa yang mengerjakan dan mengumpulkan kuis ini."
                />
            ) : (
                <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-secondary/10 dark:bg-surface-dark text-text-secondary dark:text-zinc-400 text-xs uppercase">
                                <tr>
                                    <th className="px-6 py-4">Siswa</th>
                                    <th className="px-6 py-4">Waktu Submit</th>
                                    <th className="px-6 py-4">Nilai</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 text-right">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-secondary/20 dark:divide-white/10">
                                {submissions.map((sub) => (
                                    <tr key={sub.id} className="hover:bg-secondary/10 dark:hover:bg-white/5 transition-colors">
                                        <td className="px-6 py-4">
                                            <p className="font-medium text-text-main dark:text-white">{sub.student.user.full_name}</p>
                                            <p className="text-xs text-text-secondary dark:text-zinc-500">{sub.student.nis}</p>
                                        </td>
                                        <td className="px-6 py-4 text-text-secondary dark:text-zinc-300 font-mono text-sm">
                                            {formatDate(sub.submitted_at)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-xl font-bold text-text-main dark:text-white">{sub.total_score}</span>
                                                <span className="text-xs text-text-secondary dark:text-zinc-500">/{sub.max_score}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {sub.is_graded ? (
                                                <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full">
                                                    Selesai Dinilai
                                                </span>
                                            ) : (
                                                <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded-full animate-pulse">
                                                    Perlu Koreksi
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <Link href={`/dashboard/guru/kuis/${quizId}/hasil/${sub.id}`}>
                                                <Button
                                                    size="sm"
                                                    variant={sub.is_graded ? 'ghost' : 'primary'}
                                                    className={!sub.is_graded ? 'bg-gradient-to-r from-blue-600 to-cyan-600' : ''}
                                                >
                                                    {sub.is_graded ? 'Lihat' : 'Koreksi'}
                                                </Button>
                                            </Link>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </div>
    )
}
