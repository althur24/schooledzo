'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Modal, PageHeader, Button } from '@/components/ui'
import Card from '@/components/ui/Card'
import { Graph, Edit, Paper, Document } from 'react-iconly'
import { Loader2 } from 'lucide-react'

interface Submission {
    id: string
    answers: string | Record<string, unknown> | null
    submitted_at: string
    student: {
        id: string
        nis: string | null
        user: { full_name: string | null }
    }
    grade: Array<{
        id: string
        score: number
        feedback: string | null
    }>
}

interface Assignment {
    id: string
    title: string
    description: string | null
    type: string
    due_date: string | null
    teaching_assignment: {
        subject: { name: string }
        class: { name: string }
    }
}

export default function TugasHasilPage() {
    const params = useParams()
    const assignmentId = params.id as string

    const [assignment, setAssignment] = useState<Assignment | null>(null)
    const [submissions, setSubmissions] = useState<Submission[]>([])
    const [loading, setLoading] = useState(true)

    const [grading, setGrading] = useState<{
        submissionId: string
        score: string
        feedback: string
        answers: string
        studentName: string
    } | null>(null)
    const [saving, setSaving] = useState(false)

    const fetchData = useCallback(async () => {
        try {
            const [assignmentRes, subsRes] = await Promise.all([
                fetch(`/api/assignments/${assignmentId}`),
                fetch(`/api/submissions?assignment_id=${assignmentId}`)
            ])
            const assignmentData = await assignmentRes.json()
            const subsData = await subsRes.json()

            setAssignment(assignmentData)
            setSubmissions(Array.isArray(subsData) ? subsData : [])
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }, [assignmentId])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    const handleGrade = async () => {
        if (!grading) return
        setSaving(true)
        try {
            await fetch('/api/grades', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submission_id: grading.submissionId,
                    score: parseInt(grading.score),
                    feedback: grading.feedback
                })
            })
            setGrading(null)
            fetchData()
        } catch (error) {
            console.error('Error grading:', error)
            alert('Gagal menyimpan nilai')
        } finally {
            setSaving(false)
        }
    }

    const getAnswersText = (answers: Submission['answers']) => {
        if (typeof answers === 'string') return answers
        if (Array.isArray(answers)) {
            return answers.map((a: any) => a.answer || JSON.stringify(a)).join('\n\n')
        }
        if (answers) return JSON.stringify(answers, null, 2)
        return '-'
    }

    const calculateStats = () => {
        const graded = submissions.filter(s => s.grade?.length > 0)
        if (graded.length === 0) return { avg: 0, highest: 0, lowest: 0, count: 0 }

        const scores = graded.map(s => s.grade[0].score)
        return {
            avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
            highest: Math.max(...scores),
            lowest: Math.min(...scores),
            count: graded.length
        }
    }

    if (loading) {
        return <div className="text-center text-text-secondary py-12 flex justify-center"><div className="animate-spin text-primary"><Loader2 className="w-10 h-10" /></div></div>
    }

    if (!assignment) {
        return <div className="text-center text-text-secondary py-8">Tugas tidak ditemukan</div>
    }

    const stats = calculateStats()

    return (
        <div className="space-y-6">
            <PageHeader
                title={`Hasil: ${assignment.title}`}
                subtitle={`${assignment.teaching_assignment?.class?.name} • ${assignment.teaching_assignment?.subject?.name}`}
                icon={<div className="text-primary"><Graph set="bold" primaryColor="currentColor" size={24} /></div>}
                backHref="/dashboard/guru/tugas"
            />

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="p-4 flex flex-col items-center justify-center text-center">
                    <p className="text-2xl md:text-3xl font-bold text-purple-500 mb-1">{submissions.length}</p>
                    <p className="text-xs text-text-secondary font-bold uppercase tracking-wider">Total Submit</p>
                </Card>
                <Card className="p-4 flex flex-col items-center justify-center text-center">
                    <p className="text-2xl md:text-3xl font-bold text-blue-500 mb-1">{stats.avg || '-'}</p>
                    <p className="text-xs text-text-secondary font-bold uppercase tracking-wider">Rata-rata</p>
                </Card>
                <Card className="p-4 flex flex-col items-center justify-center text-center">
                    <p className="text-2xl md:text-3xl font-bold text-green-500 mb-1">{stats.highest || '-'}</p>
                    <p className="text-xs text-text-secondary font-bold uppercase tracking-wider">Tertinggi</p>
                </Card>
                <Card className="p-4 flex flex-col items-center justify-center text-center">
                    <p className="text-2xl md:text-3xl font-bold text-amber-500 mb-1">{submissions.length - stats.count}</p>
                    <p className="text-xs text-text-secondary font-bold uppercase tracking-wider">Belum Dinilai</p>
                </Card>
            </div>

            {/* Submissions Table */}
            <Card className="overflow-hidden p-0">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-secondary/10 dark:bg-white/5 border-b border-secondary/20">
                            <tr>
                                <th className="text-left px-6 py-4 text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Siswa</th>
                                <th className="text-center px-6 py-4 text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Waktu Submit</th>
                                <th className="text-center px-6 py-4 text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Nilai</th>
                                <th className="text-center px-6 py-4 text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-secondary/20 dark:divide-white/5">
                            {submissions.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="p-12 text-center text-text-secondary">
                                        Belum ada siswa yang mengumpulkan tugas ini
                                    </td>
                                </tr>
                            ) : (
                                submissions.map((sub) => (
                                    <tr key={sub.id} className="hover:bg-secondary/5 transition-colors">
                                        <td className="px-6 py-4">
                                            <p className="text-text-main dark:text-white font-bold">{sub.student?.user?.full_name}</p>
                                            <p className="text-xs text-text-secondary dark:text-zinc-400 font-mono">{sub.student?.nis || 'No NIS'}</p>
                                        </td>
                                        <td className="px-6 py-4 text-center text-sm text-text-secondary dark:text-zinc-400">
                                            {new Date(sub.submitted_at).toLocaleString('id-ID', {
                                                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                                            })}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {sub.grade?.length > 0 ? (
                                                <span className={`inline-flex px-3 py-1.5 rounded-full text-sm font-bold shadow-sm ${sub.grade[0].score >= 75
                                                    ? 'bg-green-500/10 text-green-600 border border-green-200 dark:border-green-500/20 dark:text-green-400'
                                                    : sub.grade[0].score >= 60
                                                        ? 'bg-amber-500/10 text-amber-600 border border-amber-200 dark:border-amber-500/20 dark:text-amber-400'
                                                        : 'bg-red-500/10 text-red-600 border border-red-200 dark:border-red-500/20 dark:text-red-400'
                                                    }`}>
                                                    {sub.grade[0].score}
                                                </span>
                                            ) : (
                                                <span className="inline-flex px-3 py-1 bg-secondary/10 text-text-secondary rounded-full text-xs font-medium">Belum Dinilai</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => setGrading({
                                                    submissionId: sub.id,
                                                    score: sub.grade?.[0]?.score?.toString() || '',
                                                    feedback: sub.grade?.[0]?.feedback || '',
                                                    answers: getAnswersText(sub.answers),
                                                    studentName: sub.student?.user?.full_name || 'Siswa'
                                                })}
                                                className="w-full justify-center"
                                            >
                                                <div className="flex items-center gap-2">
                                                    {sub.grade?.length ? <Edit set="bold" primaryColor="currentColor" size={16} /> : <Paper set="bold" primaryColor="currentColor" size={16} />}
                                                    <span>{sub.grade?.length ? 'Edit Nilai' : 'Beri Nilai'}</span>
                                                </div>
                                            </Button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* Grading Modal */}
            <Modal
                open={!!grading}
                onClose={() => setGrading(null)}
                title="Input Nilai"
                subtitle={grading?.studentName}
                maxWidth="lg"
            >
                {grading && (
                    <div className="space-y-6">
                        {/* Jawaban Siswa */}
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2 flex items-center gap-2">
                                <Document set="bold" primaryColor="currentColor" size={16} /> Jawaban Siswa
                            </label>
                            <div className="bg-secondary/5 border border-secondary/20 rounded-xl p-4 max-h-[40vh] overflow-y-auto custom-scrollbar">
                                <pre className="text-text-main dark:text-slate-200 whitespace-pre-wrap font-mono text-sm leading-relaxed">{grading.answers}</pre>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Score Input */}
                            <div className="md:col-span-1">
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Nilai (0-100)</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={grading.score}
                                    onChange={(e) => setGrading({ ...grading, score: e.target.value })}
                                    className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-2xl md:text-3xl font-bold text-center placeholder-text-secondary/30"
                                    placeholder="0"
                                    autoFocus
                                />
                            </div>

                            {/* Feedback */}
                            <div className="md:col-span-2">
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Feedback (Opsional)</label>
                                <textarea
                                    value={grading.feedback}
                                    onChange={(e) => setGrading({ ...grading, feedback: e.target.value })}
                                    className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary h-[88px] resize-none"
                                    placeholder="Berikan komentar atau masukan untuk siswa..."
                                />
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 pt-4 border-t border-secondary/10 mt-2">
                            <Button variant="secondary" onClick={() => setGrading(null)} className="flex-1">
                                Batal
                            </Button>
                            <Button onClick={handleGrade} loading={saving} disabled={!grading.score} className="flex-1">
                                Simpan Nilai
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    )
}
