'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Modal, PageHeader, Button, EmptyState } from '@/components/ui'
import { Loader2 } from 'lucide-react'
import { Edit, TimeCircle, TickSquare, Paper, Discovery, Calendar } from 'react-iconly'

interface Assignment {
    id: string
    title: string
    description: string | null
    type: string
    due_date: string | null
    created_at: string
    teaching_assignment: {
        subject: { name: string }
        class: { name: string }
    }
}

interface Submission {
    id: string
    assignment_id: string
    answers: unknown
    submitted_at: string
}

export default function SiswaTugasPage() {
    const { user } = useAuth()
    const [assignments, setAssignments] = useState<Assignment[]>([])
    const [submissions, setSubmissions] = useState<Submission[]>([])
    const [studentId, setStudentId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState<{ assignmentId: string; answer: string; type: 'text' | 'link' } | null>(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        const fetchData = async () => {
            try {
                const studentsRes = await fetch('/api/students')
                const students = await studentsRes.json()
                const myStudent = students.find((s: { user: { id: string } }) => s.user.id === user?.id)

                if (!myStudent?.class_id) {
                    setLoading(false)
                    return
                }

                setStudentId(myStudent.id)

                const [assignmentsRes, submissionsRes] = await Promise.all([
                    fetch('/api/assignments'),
                    fetch(`/api/submissions?student_id=${myStudent.id}`)
                ])
                const [assignmentsData, submissionsData] = await Promise.all([
                    assignmentsRes.json(),
                    submissionsRes.json()
                ])

                // Handle case where API returns error object instead of array
                const assignmentsArray = Array.isArray(assignmentsData) ? assignmentsData : []
                const myAssignments = assignmentsArray.filter((a: Assignment) =>
                    a.teaching_assignment?.class?.name === myStudent.class.name
                )
                setAssignments(myAssignments)
                setSubmissions(Array.isArray(submissionsData) ? submissionsData : [])
            } catch (error) {
                console.error('Error:', error)
            } finally {
                setLoading(false)
            }
        }
        if (user) fetchData()
    }, [user])

    const getSubmission = (assignmentId: string) => {
        return submissions.find((s) => s.assignment_id === assignmentId)
    }

    const handleSubmit = async () => {
        if (!submitting) return
        setSaving(true)
        try {
            await fetch('/api/submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assignment_id: submitting.assignmentId,
                    answers: [{
                        type: submitting.type,
                        answer: submitting.answer
                    }]
                })
            })

            const res = await fetch(`/api/submissions?student_id=${studentId}`)
            setSubmissions(await res.json())
            setSubmitting(null)
        } finally {
            setSaving(false)
        }
    }

    const isOverdue = (dueDate: string | null) => {
        if (!dueDate) return false
        return new Date(dueDate) < new Date()
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Tugas Saya"
                subtitle="Daftar tugas yang harus dikerjakan"
                icon={<div className="text-amber-500 flex"><Edit set="bold" primaryColor="currentColor" size="small" /></div>}
                backHref="/dashboard/siswa"
            />

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : assignments.length === 0 ? (
                <EmptyState
                    icon={<div className="text-pink-500 dark:text-pink-200 flex"><Edit set="bold" primaryColor="currentColor" size="xlarge" /></div>}
                    title="Belum Ada Tugas"
                    description="Belum ada tugas tersedia untuk kelasmu"
                />
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {assignments.map((assignment) => {
                        const submission = getSubmission(assignment.id)
                        const overdue = isOverdue(assignment.due_date)

                        return (
                            <div key={assignment.id} className="bg-white dark:bg-surface-dark border-2 border-primary/30 rounded-xl p-4 md:p-5 hover:border-primary hover:shadow-lg hover:shadow-primary/10 active:scale-[0.98] transition-all group cursor-pointer">
                                <div className="flex flex-col h-full gap-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${assignment.type === 'ULANGAN'
                                                    ? 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                                                    : 'bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'}`}>
                                                    {assignment.type}
                                                </span>
                                                <span className="px-2.5 py-1 bg-primary/10 text-primary-dark dark:text-primary text-xs font-bold rounded-full">
                                                    {assignment.teaching_assignment?.subject?.name}
                                                </span>
                                            </div>
                                            <h3 className="font-bold text-text-main dark:text-white text-base md:text-lg group-hover:text-primary transition-colors">{assignment.title}</h3>
                                        </div>
                                    </div>

                                    <p className="text-sm text-text-secondary dark:text-zinc-400 line-clamp-2">{assignment.description || 'Tidak ada deskripsi'}</p>

                                    <div className="pt-4 mt-auto border-t border-secondary/10 space-y-2">
                                        <div className="text-xs font-medium text-text-secondary dark:text-zinc-500 flex items-center gap-1.5">
                                            <Calendar set="bold" primaryColor="currentColor" size={14} />
                                            Dibuat: {new Date(assignment.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div className="text-xs font-medium">
                                                {assignment.due_date && (
                                                    <span className={`flex items-center gap-1 ${overdue && !submission ? 'text-red-500' : 'text-text-secondary dark:text-zinc-500'}`}>
                                                        <TimeCircle set="bold" primaryColor="currentColor" size={12} />
                                                        Deadline: {new Date(assignment.due_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                        {overdue && !submission && ' (Lewat)'}
                                                    </span>
                                                )}
                                            </div>

                                            <div>
                                                {submission ? (
                                                    <span className="px-3 py-1 bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 rounded-full text-xs font-bold flex items-center gap-1">
                                                        <TickSquare set="bold" primaryColor="currentColor" size={12} /> Selesai
                                                    </span>
                                                ) : overdue ? (
                                                    <span className="px-3 py-1 bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400 rounded-full text-xs font-bold">
                                                        Terlambat
                                                    </span>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        onClick={() => setSubmitting({ assignmentId: assignment.id, answer: '', type: 'text' })}
                                                        className="shadow-soft"
                                                    >
                                                        Kerjakan
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    })}

                    <Modal open={!!submitting} onClose={() => setSubmitting(null)} title="Kumpulkan Tugas">
                        {submitting && (
                            <div className="space-y-5">
                                {/* Tab Toggle */}
                                <div className="flex bg-secondary/10 p-1 rounded-xl">
                                    <button
                                        onClick={() => setSubmitting({ ...submitting, type: 'text' })}
                                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${submitting.type === 'text'
                                            ? 'bg-white dark:bg-surface-dark text-primary shadow-sm'
                                            : 'text-text-secondary hover:text-text-main'
                                            }`}
                                    >
                                        <Paper set="bold" primaryColor="currentColor" size={16} /> Jawaban Teks
                                    </button>
                                    <button
                                        onClick={() => setSubmitting({ ...submitting, type: 'link' })}
                                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${submitting.type === 'link'
                                            ? 'bg-white dark:bg-surface-dark text-primary shadow-sm'
                                            : 'text-text-secondary hover:text-text-main'
                                            }`}
                                    >
                                        <Discovery set="bold" primaryColor="currentColor" size={16} /> Lampirkan Link
                                    </button>
                                </div>

                                {submitting.type === 'text' ? (
                                    <div>
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jawaban Teks</label>
                                        <textarea
                                            value={submitting.answer}
                                            onChange={(e) => setSubmitting({ ...submitting, answer: e.target.value })}
                                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary min-h-[150px]"
                                            placeholder="Tulis jawaban kamu di sini..."
                                        />
                                    </div>
                                ) : (
                                    <div>
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Link Dokumen / File</label>
                                        <input
                                            type="url"
                                            value={submitting.answer}
                                            onChange={(e) => setSubmitting({ ...submitting, answer: e.target.value })}
                                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                            placeholder="https://docs.google.com/..."
                                        />
                                        <p className="mt-2 text-xs text-text-secondary">
                                            *Pastikan link Google Drive/Docs dapat diakses (Setting: Anyone with the link)
                                        </p>
                                    </div>
                                )}

                                <div className="flex gap-3 pt-2">
                                    <Button type="button" variant="ghost" onClick={() => setSubmitting(null)} className="flex-1">
                                        Batal
                                    </Button>
                                    <Button onClick={handleSubmit} loading={saving} disabled={!submitting.answer} className="flex-1">
                                        Kumpulkan
                                    </Button>
                                </div>
                            </div>
                        )}
                    </Modal>
                </div>
            )}
        </div>
    )
}
