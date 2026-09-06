'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useSchoolLabels } from '@/contexts/LabelsContext'
import { labelForGradeType } from '@/lib/labels'
import { Modal, PageHeader, Button, EmptyState } from '@/components/ui'
import { Loader2 } from 'lucide-react'
import { Edit, TimeCircle, TickSquare, Paper, Discovery, Calendar, Star, Document } from 'react-iconly'
import FileUpload from '@/components/FileUpload'
import { SubmissionAttachment } from '@/lib/types'

interface Assignment {
    id: string
    title: string
    description: string | null
    type: string
    due_date: string | null
    created_at: string
    submission_mode?: string
    teaching_assignment: {
        subject: { name: string }
        class: { id?: string; name: string }
    }
}

interface Submission {
    id: string
    assignment_id: string
    answers: any[]
    attachments: SubmissionAttachment[] | null
    is_late: boolean
    submitted_at: string
    grade?: { score: number; feedback: string | null }[]
}

export default function SiswaTugasPage() {
    const { user } = useAuth()
    const labels = useSchoolLabels()
    const [assignments, setAssignments] = useState<Assignment[]>([])
    const [submissions, setSubmissions] = useState<Submission[]>([])
    const [studentId, setStudentId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState<{ assignmentId: string; answer: string; type: 'text' | 'link'; files: SubmissionAttachment[] } | null>(null)
    const [saving, setSaving] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    useEffect(() => {
        const fetchData = async () => {
            try {
                // user_id WAJIB: tanpa ini guard SISWA di /api/students mengembalikan []
                const studentsRes = await fetch(`/api/students?user_id=${user?.id}`)
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

                const assignmentsArray = Array.isArray(assignmentsData) ? assignmentsData : []
                // Filter by class_id (bukan nama): nama kelas duplikat
                // lintas tahun ajaran membuat pencocokan nama rapuh
                const myAssignments = assignmentsArray.filter((a: Assignment) =>
                    a.teaching_assignment?.class?.id === myStudent.class_id
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

    const isOverdue = (dueDate: string | null) => {
        if (!dueDate) return false
        return new Date(dueDate) < new Date()
    }

    const handleEditSubmission = (assignmentId: string, existingSub: Submission) => {
        const type = existingSub.answers && existingSub.answers[0]?.type === 'link' ? 'link' : 'text'
        const answer = existingSub.answers && existingSub.answers[0]?.answer ? existingSub.answers[0].answer : ''
        
        setSubmitting({
            assignmentId,
            type,
            answer,
            files: existingSub.attachments || []
        })
    }

    const handleSubmit = async () => {
        if (!submitting) return
        setSaving(true)
        setSubmitError(null)
        try {
            const res = await fetch('/api/submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assignment_id: submitting.assignmentId,
                    answers: [{
                        type: submitting.type,
                        answer: submitting.answer
                    }],
                    attachments: submitting.files
                })
            })

            // Tanpa cek ini POST yang gagal (500/dll) tetap menutup modal —
            // siswa mengira tugasnya terkirim padahal tidak
            if (!res.ok) {
                const data = await res.json().catch(() => null)
                setSubmitError(data?.error || `Gagal mengumpulkan ${labels.tugas}. Coba lagi.`)
                return
            }

            const subsRes = await fetch(`/api/submissions?student_id=${studentId}`)
            const subsData = await subsRes.json()
            setSubmissions(Array.isArray(subsData) ? subsData : [])
            setSubmitting(null)
        } catch {
            setSubmitError('Gagal terhubung ke server. Periksa koneksi dan coba lagi.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title={`${labels.tugas} Saya`}
                subtitle={`Daftar ${labels.tugas} yang harus dikerjakan`}
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
                    title={`Belum Ada ${labels.tugas}`}
                    description={`Belum ada ${labels.tugas} tersedia untuk kelasmu`}
                />
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {assignments.map((assignment) => {
                        const submission = getSubmission(assignment.id)
                        const overdue = isOverdue(assignment.due_date)
                        const isLate = submission?.is_late || false
                        const grade = submission?.grade?.[0]
                        const canEdit = submission && !overdue && !grade
                        const isOffline = assignment.submission_mode === 'OFFLINE'

                        return (
                            <div key={assignment.id} className="bg-white dark:bg-surface-dark border-2 border-primary/30 rounded-xl p-4 md:p-5 hover:border-primary hover:shadow-lg hover:shadow-primary/10 active:scale-[0.98] transition-all group cursor-pointer">
                                <div className="flex flex-col h-full gap-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="px-2.5 py-1 bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 text-xs font-bold rounded-full">
                                                    {labelForGradeType(assignment.type, labels)}
                                                </span>
                                                <span className="px-2.5 py-1 bg-primary/10 text-primary-dark dark:text-primary text-xs font-bold rounded-full">
                                                    {assignment.teaching_assignment?.subject?.name}
                                                </span>
                                                {isOffline && (
                                                    <span className="px-2.5 py-1 bg-teal-100 text-teal-600 dark:bg-teal-900/20 dark:text-teal-400 text-xs font-bold rounded-full">
                                                        Offline
                                                    </span>
                                                )}
                                                {isLate && (
                                                    <span className="px-2.5 py-1 bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400 text-xs font-bold rounded-full">
                                                        Terlambat
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="font-bold text-text-main dark:text-white text-base md:text-lg group-hover:text-primary transition-colors">{assignment.title}</h3>
                                        </div>
                                    </div>

                                    <p className="text-sm text-text-secondary dark:text-zinc-400 line-clamp-2">{assignment.description || 'Tidak ada deskripsi'}</p>
                                    
                                    {/* Submissions Stats / File info */}
                                    {submission && !isOffline && (
                                        <div className="bg-secondary/5 rounded-lg p-3 text-sm flex flex-col gap-2">
                                            {submission.attachments && submission.attachments.length > 0 && (
                                                <div className="flex items-center gap-2 text-text-main dark:text-white">
                                                    <span className="text-primary"><Document set="bold" primaryColor="currentColor" size={16} /></span>
                                                    <span className="font-medium">{submission.attachments.length} Lampiran Terkirim</span>
                                                </div>
                                            )}
                                            {submission.answers && submission.answers[0]?.type === 'link' && (
                                                <div className="flex items-center gap-2 text-text-main dark:text-white">
                                                    <span className="text-primary"><Discovery set="bold" primaryColor="currentColor" size={16} /></span>
                                                    <span className="font-medium truncate max-w-[200px]">{submission.answers[0]?.answer}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Nilai / Grade Card */}
                                    {grade && (
                                        <div className="mt-2 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/10 dark:to-orange-900/10 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-3">
                                            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full shrink-0">
                                                <Star set="bold" primaryColor="currentColor" size={20} />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-sm font-bold text-text-main dark:text-white">Nilai:</span>
                                                    <span className="text-lg font-black text-amber-600 dark:text-amber-400">{grade.score}/100</span>
                                                </div>
                                                {grade.feedback && (
                                                    <p className="text-xs text-text-secondary dark:text-zinc-400 italic">"{grade.feedback}"</p>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    <div className="pt-4 mt-auto border-t border-secondary/10 space-y-2">
                                        <div className="flex justify-between items-center text-xs font-medium text-text-secondary dark:text-zinc-500">
                                            <div className="flex items-center gap-1.5">
                                                <Calendar set="bold" primaryColor="currentColor" size={14} />
                                                Dibuat: {new Date(assignment.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                                            </div>
                                            {assignment.due_date && (
                                                <div className={`flex items-center gap-1 ${overdue && !submission ? 'text-red-500' : ''}`}>
                                                    <TimeCircle set="bold" primaryColor="currentColor" size={14} />
                                                    Deadline: {new Date(assignment.due_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                            )}
                                        </div>
                                        
                                        <div className="flex items-center justify-between pt-2">
                                            {isOffline ? (
                                                <p className="text-xs text-text-secondary dark:text-zinc-400 italic flex items-center gap-1.5">
                                                    <TickSquare set="bold" primaryColor="currentColor" size={14} />
                                                    Dikumpulkan langsung ke guru{grade ? '' : ' — nilai muncul setelah dinilai'}
                                                </p>
                                            ) : (
                                                <>
                                            <div>
                                                {submission ? (
                                                    <span className="px-3 py-1 bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400 rounded-full text-xs font-bold flex items-center gap-1">
                                                        <TickSquare set="bold" primaryColor="currentColor" size={12} /> Selesai
                                                    </span>
                                                ) : overdue ? (
                                                    <span className="px-3 py-1 bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400 rounded-full text-xs font-bold">
                                                        Terlambat
                                                    </span>
                                                ) : null}
                                            </div>

                                            <div>
                                                {canEdit ? (
                                                     <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            handleEditSubmission(assignment.id, submission)
                                                        }}
                                                        className="shadow-soft"
                                                    >
                                                        Edit Jawaban
                                                    </Button>
                                                ) : !submission && !overdue ? (
                                                    <Button
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setSubmitting({ assignmentId: assignment.id, answer: '', type: 'text', files: [] })
                                                        }}
                                                        className="shadow-soft"
                                                    >
                                                        Kerjakan
                                                    </Button>
                                                ) : null}
                                            </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )
                    })}

                    <Modal open={!!submitting} onClose={() => setSubmitting(null)} title={`Kumpulkan ${labels.tugas}`}>
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
                                        <Paper set="bold" primaryColor="currentColor" size={16} /> Teks / File
                                    </button>
                                    <button
                                        onClick={() => setSubmitting({ ...submitting, type: 'link' })}
                                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${submitting.type === 'link'
                                            ? 'bg-white dark:bg-surface-dark text-primary shadow-sm'
                                            : 'text-text-secondary hover:text-text-main'
                                            }`}
                                    >
                                        <Discovery set="bold" primaryColor="currentColor" size={16} /> Link Video
                                    </button>
                                </div>

                                {submitting.type === 'text' ? (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jawaban Teks</label>
                                            <textarea
                                                value={submitting.answer}
                                                onChange={(e) => setSubmitting({ ...submitting, answer: e.target.value })}
                                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary min-h-[100px]"
                                                placeholder="Tulis jawaban opsional kamu di sini..."
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Lampiran File (PDF/Gambar/Office)</label>
                                            <FileUpload
                                                files={submitting.files}
                                                onFilesChange={(files) => setSubmitting({ ...submitting, files })}
                                                maxFiles={3}
                                                maxSizeMB={10}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Link Video (YouTube / Google Drive)</label>
                                        <input
                                            type="url"
                                            value={submitting.answer}
                                            onChange={(e) => setSubmitting({ ...submitting, answer: e.target.value })}
                                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                            placeholder="https://youtube.com/... atau https://drive.google.com/..."
                                        />
                                        <p className="mt-2 text-xs text-text-secondary">
                                            *Pastikan privasi video/link sudah diatur ke Publik atau "Anyone with the link".
                                        </p>
                                    </div>
                                )}

                                {submitError && (
                                    <p className="text-sm text-red-500 dark:text-red-400">{submitError}</p>
                                )}

                                <div className="flex gap-3 pt-2">
                                    <Button type="button" variant="ghost" onClick={() => setSubmitting(null)} className="flex-1">
                                        Batal
                                    </Button>
                                    <Button onClick={handleSubmit} loading={saving} disabled={(!submitting.answer && submitting.files.length === 0)} className="flex-1">
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
