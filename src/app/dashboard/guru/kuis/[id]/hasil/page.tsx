'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PageHeader, Card, Button, EmptyState, StatsCard } from '@/components/ui'
import { InfoCircle, TickSquare, User, TimeCircle, Document, ArrowDown, ChevronDown } from 'react-iconly'
import { Loader2 } from 'lucide-react'
import AssessmentAnalytics from '@/components/analytics/AssessmentAnalytics'
import { useSchoolLabels } from '@/contexts/LabelsContext'

interface QuizSubmission {
    id: string
    submitted_at: string | null
    total_score: number | null
    max_score: number | null
    is_graded: boolean | null
    needs_manual_review?: boolean | null
    student: {
        id: string
        nis: string
        user: { full_name: string }
    }
}

interface Quiz {
    title: string
    submission_mode?: string
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
    const labels = useSchoolLabels()

    const [submissions, setSubmissions] = useState<QuizSubmission[]>([])
    const [quiz, setQuiz] = useState<Quiz | null>(null)
    const [classStudents, setClassStudents] = useState<Student[]>([])
    const [loading, setLoading] = useState(true)
    const [showNotSubmitted, setShowNotSubmitted] = useState(false)

    // Grid roster untuk kuis offline (input nilai tanpa pengerjaan online)
    const [offlineScores, setOfflineScores] = useState<Record<string, string>>({})
    const [savingOffline, setSavingOffline] = useState(false)

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

            // Fetch students in this class — year-aware so a past quiz shows the
            // students who were enrolled then (not the current roster).
            if (quizData.teaching_assignment?.class?.id) {
                const taYear = (quizData.teaching_assignment as any)?.academic_year_id
                const studentsRes = await fetch(`/api/students?class_id=${quizData.teaching_assignment.class.id}&enrollment_year_id=${taYear || ''}`)
                const studentsData = await studentsRes.json()
                setClassStudents(studentsData)
            }

        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [quizId])

    const saveOfflineScores = async () => {
        setSavingOffline(true)
        try {
            const entries = Object.entries(offlineScores).filter(([, v]) => {
                if (v === '') return false
                const num = parseInt(v)
                return !isNaN(num) && num >= 0 && num <= 100
            })
            if (entries.length === 0) return
            await Promise.all(entries.map(([studentId, v]) =>
                fetch('/api/quiz-submissions/manual', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ quiz_id: quizId, student_id: studentId, score: parseInt(v) })
                }).then(res => {
                    if (!res.ok) throw new Error('Gagal menyimpan nilai')
                })
            ))
            setOfflineScores({})
            await fetchData()
        } catch (error) {
            console.error('Error saving offline scores:', error)
            alert('Gagal menyimpan sebagian nilai. Periksa kembali.')
        } finally {
            setSavingOffline(false)
        }
    }

    const formatDate = (dateString: string | null) => {
        // Guard null: new Date(null) = 1 Jan 1970 (epoch) — tampil sebagai
        // "1 Jan" palsu karena format tanpa tahun. Tahun disertakan supaya
        // anomali tanggal masa lalu langsung kelihatan.
        if (!dateString) return '—'
        return new Date(dateString).toLocaleDateString('id-ID', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        })
    }

    // Pisahkan attempt final vs yang masih berjalan — attempt dengan
    // submitted_at null adalah siswa yang membuka kuis tapi belum menekan
    // "Kumpulkan" (atau belum ditutup paksa); JANGAN dihitung sebagai
    // "sudah mengumpulkan" (nilainya belum final, tanggalnya tidak ada).
    const submitted = submissions.filter(s => s.submitted_at)
    const inProgress = submissions.filter(s => !s.submitted_at)

    // Calculate not submitted students (belum membuka kuis sama sekali)
    const submittedStudentIds = submissions.map(s => s.student.id)
    const notSubmittedStudents = classStudents
        .filter(s => !submittedStudentIds.includes(s.id))
        .sort((a, b) => a.user.full_name.localeCompare(b.user.full_name))

    const isOffline = quiz?.submission_mode === 'OFFLINE'

    // Roster untuk kuis offline: semua siswa kelas + nilai yang sudah terinput
    const offlineRoster = classStudents
        .map(student => {
            const sub = submissions.find(s => s.student.id === student.id)
            return {
                studentId: student.id,
                name: student.user.full_name,
                nis: student.nis,
                score: sub?.is_graded ? sub.total_score : undefined,
                gradedAt: sub?.is_graded ? sub.submitted_at : undefined
            }
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'id'))
    const offlineGradedCount = offlineRoster.filter(r => r.score !== undefined).length

    if (loading) return (
        <div className="flex justify-center py-12">
            <div className="animate-spin text-primary"><Loader2 className="w-10 h-10" /></div>
        </div>
    )

    return (
        <div className="space-y-6">
            <PageHeader
                title={`Hasil ${labels.kuis}: ${quiz?.title || ''}`}
                subtitle={`${quiz?.teaching_assignment?.class?.name} • ${quiz?.teaching_assignment?.subject?.name} • ${submitted.length} Pengumpulan`}
                backHref="/dashboard/guru/kuis"
            />

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatsCard
                    value={submitted.length}
                    label="Sudah Mengumpulkan"
                    icon={<div className="text-white"><TickSquare set="bold" primaryColor="currentColor" size={24} /></div>}
                />
                <StatsCard
                    value={inProgress.length}
                    label="Sedang Mengerjakan"
                    icon={<div className="text-white"><TimeCircle set="bold" primaryColor="currentColor" size={24} /></div>}
                />
                <StatsCard
                    value={notSubmittedStudents.length}
                    label="Belum Mengerjakan"
                    icon={<div className="text-white"><User set="bold" primaryColor="currentColor" size={24} /></div>}
                />
            </div>

            {/* Grid Roster Offline: input nilai langsung per siswa */}
            {isOffline ? (
                <Card className="overflow-hidden p-0">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-secondary/20 dark:border-white/5 bg-secondary/5">
                        <div>
                            <p className="font-bold text-text-main dark:text-white">Input Nilai ({labels.kuis} Offline)</p>
                            <p className="text-xs text-text-secondary">Isi nilai lalu klik Simpan Semua — riwayat penilaian tersimpan otomatis</p>
                        </div>
                        <Button onClick={saveOfflineScores} loading={savingOffline} size="sm" disabled={Object.keys(offlineScores).length === 0}>
                            Simpan Semua
                        </Button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-secondary/10 dark:bg-white/5 border-b border-secondary/20">
                                <tr>
                                    <th className="text-left px-6 py-4 text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Siswa</th>
                                    <th className="text-center px-6 py-4 text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Nilai (0-100)</th>
                                    <th className="text-center px-6 py-4 text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Riwayat</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-secondary/20 dark:divide-white/5">
                                {offlineRoster.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} className="p-12 text-center text-text-secondary">
                                            Belum ada siswa di kelas ini
                                        </td>
                                    </tr>
                                ) : (
                                    offlineRoster.map((row) => (
                                        <tr key={row.studentId} className="hover:bg-secondary/5 transition-colors">
                                            <td className="px-6 py-4">
                                                <p className="text-text-main dark:text-white font-bold">{row.name}</p>
                                                <p className="text-xs text-text-secondary dark:text-zinc-400 font-mono">{row.nis || 'No NIS'}</p>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={100}
                                                    value={offlineScores[row.studentId] ?? (row.score !== undefined && row.score !== null ? row.score.toString() : '')}
                                                    onChange={(e) => setOfflineScores({ ...offlineScores, [row.studentId]: e.target.value })}
                                                    className="w-20 px-3 py-2 text-center border border-secondary/30 rounded-lg bg-white dark:bg-surface-dark text-text-main dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-primary"
                                                    placeholder="-"
                                                />
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {row.gradedAt ? (
                                                    <span className="text-xs text-text-secondary">
                                                        Dinilai {formatDate(row.gradedAt)}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex px-3 py-1 bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-500/20 dark:text-amber-400 rounded-full text-xs font-bold">Belum Dinilai</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            ) : (
            <>
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

            {/* Analytics Dashboard — hanya attempt yang sudah dikumpulkan */}
            {submitted.length > 0 && (
                <AssessmentAnalytics
                    assessmentId={quizId}
                    assessmentType="quiz"
                />
            )}

            {/* In-Progress Submissions — siswa yang membuka kuis tapi belum mengumpulkan */}
            {inProgress.length > 0 && (
                <Card className="bg-amber-500/10 border-amber-500/30">
                    <div className="px-4 py-3 flex items-center gap-3">
                        <span className="text-amber-500"><TimeCircle set="bold" primaryColor="currentColor" size={20} /></span>
                        <span className="text-amber-600 dark:text-amber-400 font-medium">{inProgress.length} Siswa Sedang Mengerjakan</span>
                    </div>
                    <div className="px-4 pb-4 space-y-2">
                        {inProgress.map(sub => (
                            <div key={sub.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-white dark:bg-surface-dark rounded-lg shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xs font-bold">
                                        {sub.student.user.full_name.charAt(0)}
                                    </div>
                                    <div>
                                        <p className="text-text-main dark:text-white text-sm font-medium">{sub.student.user.full_name}</p>
                                        <p className="text-xs text-text-secondary dark:text-zinc-500">{sub.student.nis}</p>
                                    </div>
                                </div>
                                <Link href={`/dashboard/guru/kuis/${quizId}/hasil/${sub.id}`}>
                                    <Button size="sm" variant="ghost">
                                        Lihat Progres
                                    </Button>
                                </Link>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Submissions Table */}
            {submitted.length === 0 ? (
                <EmptyState
                    icon={<div className="text-secondary"><Document set="bold" primaryColor="currentColor" size={48} /></div>}
                    title="Belum ada pengumpulan"
                    description={`Belum ada siswa yang mengerjakan dan mengumpulkan ${labels.kuis.toLowerCase()} ini.`}
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
                                {submitted.map((sub) => (
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
                                                <span className="text-xl font-bold text-text-main dark:text-white">{sub.total_score ?? '—'}</span>
                                                <span className="text-xs text-text-secondary dark:text-zinc-500">/{sub.max_score ?? '—'}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {sub.needs_manual_review ? (
                                                <span className="px-2 py-1 bg-purple-500/20 text-purple-500 text-xs rounded-full" title="Siswa mengirim jawaban tertunda (lewat batas) untuk ditinjau — nilai tidak dihitung otomatis">
                                                    ⚠️ Butuh Review Manual
                                                </span>
                                            ) : sub.is_graded ? (
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
                                                    variant={!sub.is_graded || sub.needs_manual_review ? 'primary' : 'ghost'}
                                                    className={!sub.is_graded || sub.needs_manual_review ? 'bg-gradient-to-r from-blue-600 to-cyan-600' : ''}
                                                >
                                                    {sub.needs_manual_review ? 'Tinjau' : sub.is_graded ? 'Lihat' : 'Koreksi'}
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
            </>
            )}
        </div>
    )
}
