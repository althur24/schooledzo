'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Modal, PageHeader, Button, DropdownMenu } from '@/components/ui'
import type { DropdownMenuItem } from '@/components/ui/DropdownMenu'
import Card from '@/components/ui/Card'
import ExamCard from '@/components/exam/ExamCard'
import ClassChipsSelector from '@/components/ClassChipsSelector'
import TimeWindowFields from '@/components/TimeWindowFields'
import { useAuth } from '@/contexts/AuthContext'
import { TimeCircle as Clock, Plus, Lock, ShieldDone, Swap, Graph, Edit, Document } from 'react-iconly'
import { Loader2, CheckSquare, Square, RefreshCw, GraduationCap, BookOpen, Copy, Trash2, Activity } from 'lucide-react'

interface Exam {
    id: string
    title: string
    description: string | null
    start_time: string
    duration_minutes: number
    window_end_time?: string | null
    is_active: boolean
    pending_publish: boolean
    is_randomized: boolean
    batch_id?: string | null
    batch_size?: number
    created_by?: string | null
    creator_role?: string | null
    max_violations: number
    question_count: number
    created_at: string
    teaching_assignment: {
        id: string
        subject: { id?: string, name: string, kkm: number }
        class: { id: string, name: string }
    }
}

interface OfficialExam {
    id: string
    exam_type: 'UTS' | 'UAS'
    title: string
    description: string | null
    start_time: string
    duration_minutes: number
    window_end_time?: string | null
    is_active: boolean
    question_count: number
    target_class_ids: string[]
    subject: { id: string; name: string }
    created_by?: string | null
    creator_role?: string | null
}

interface TeachingAssignment {
    id: string
    subject: { id: string; name: string }
    class: { id: string; name: string }
}

export default function GuruUlanganPage() {
    const { user } = useAuth()
    const router = useRouter()
    const [exams, setExams] = useState<Exam[]>([])
    const [teachingAssignments, setTeachingAssignments] = useState<TeachingAssignment[]>([])
    const [submissionCounts, setSubmissionCounts] = useState<Record<string, number>>({})
    const [pendingGradingCounts, setPendingGradingCounts] = useState<Record<string, number>>({})
    const [studentCounts, setStudentCounts] = useState<Record<string, number>>({})
    const [officialExams, setOfficialExams] = useState<OfficialExam[]>([])
    const [loading, setLoading] = useState(true)
    const [returnedExams, setReturnedExams] = useState<{examId: string, title: string, returnedCount: number}[]>([])
    const [aiReviewEnabled, setAiReviewEnabled] = useState(true)
    const [showCreate, setShowCreate] = useState(false)
    const [creating, setCreating] = useState(false)
    const [form, setForm] = useState({
        teaching_assignment_ids: [] as string[],
        title: '',
        description: '',
        start_time: '',
        duration_minutes: 60,
        schedule_mode: 'sync' as 'sync' | 'window',
        window_end_time: '',
        is_randomized: true,
        max_violations: 3,
        show_results_immediately: true
    })
    // Jenis yang dibuat dari satu pintu form ini: ulangan harian atau UTS/UAS resmi
    const [examKind, setExamKind] = useState<'ULANGAN' | 'UTS' | 'UAS'>('ULANGAN')

    // Copy States
    const [showCopy, setShowCopy] = useState(false)
    const [copySourceExam, setCopySourceExam] = useState<Exam | null>(null)
    const [copying, setCopying] = useState(false)
    const [copyForm, setCopyForm] = useState({
        teaching_assignment_ids: [] as string[],
        title: '',
        description: '',
        start_time: '',
        duration_minutes: 60,
        schedule_mode: 'sync' as 'sync' | 'window',
        window_end_time: '',
        is_randomized: true,
        max_violations: 3,
        show_results_immediately: true
    })

    // Remedial States
    const [showRemedial, setShowRemedial] = useState(false)
    const [remedialExam, setRemedialExam] = useState<Exam | null>(null)
    const [remedialStudents, setRemedialStudents] = useState<any[]>([])
    const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
    const [remedialMethod, setRemedialMethod] = useState<'ASLI' | 'BARU'>('ASLI')
    const [remedialLoading, setRemedialLoading] = useState(false)
    const [remedialStartTime, setRemedialStartTime] = useState('')
    const [remedialKkm, setRemedialKkm] = useState(75)

    // Tutorial event: open/close create modal when tutorial requests it
    useEffect(() => {
        const openHandler = () => setShowCreate(true)
        const closeHandler = () => setShowCreate(false)
        window.addEventListener('tutorial:open-exam-modal', openHandler)
        window.addEventListener('tutorial:close-exam-modal', closeHandler)
        return () => {
            window.removeEventListener('tutorial:open-exam-modal', openHandler)
            window.removeEventListener('tutorial:close-exam-modal', closeHandler)
        }
    }, [])

    useEffect(() => {
        fetchData()
    }, [user])

    const fetchData = async () => {
        if (!user) return

        try {
            const [examsRes, myAssignmentsRes, yearsRes, officialExamsRes, returnedRes, settingsRes] = await Promise.all([
                fetch('/api/exams'),
                fetch('/api/my-teaching-assignments'),
                fetch('/api/academic-years'),
                fetch('/api/official-exams'),
                fetch('/api/exams/returned-counts'),
                fetch('/api/school-settings')
            ])

            if (settingsRes.ok) {
                const settings = await settingsRes.json()
                setAiReviewEnabled(settings?.ai_review_enabled !== false)
            }
            if (returnedRes.ok) {
                const returned = await returnedRes.json()
                setReturnedExams(Array.isArray(returned) ? returned : [])
            }

            let examsData = []
            if (examsRes.ok) {
                const data = await examsRes.json()
                examsData = Array.isArray(data) ? data : []
            }

            let officialExamsData: OfficialExam[] = []
            if (officialExamsRes.ok) {
                const data = await officialExamsRes.json()
                officialExamsData = Array.isArray(data) ? data : []
                setOfficialExams(officialExamsData)
            }

            let myAssignments = []
            if (myAssignmentsRes.ok) {
                const data = await myAssignmentsRes.json()
                myAssignments = Array.isArray(data) ? data : []
            }

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

            const myExams = examsData.filter((e: Exam) =>
                myAssignments.some((ta: TeachingAssignment) => ta.id === e.teaching_assignment?.id)
            )
            setExams(myExams)

            const subCounts: Record<string, number> = {}
            const pendingCounts: Record<string, number> = {}
            
            const regularExamPromises = myExams.map(async (exam: Exam) => {
                try {
                    const res = await fetch(`/api/exam-submissions?exam_id=${exam.id}`)
                    if (res.ok) {
                        const subs = await res.json()
                        const subsArr = Array.isArray(subs) ? subs : []
                        subCounts[exam.id] = subsArr.filter((s: any) => s.is_submitted).length
                        pendingCounts[exam.id] = subsArr.filter((s: any) => s.is_submitted && !s.is_graded).length
                    }
                } catch { }
            })

            const officialExamPromises = officialExamsData.map(async (exam: OfficialExam) => {
                try {
                    const res = await fetch(`/api/official-exam-submissions?exam_id=${exam.id}`)
                    if (res.ok) {
                        const subs = await res.json()
                        const subsArr = Array.isArray(subs) ? subs : []
                        subCounts[exam.id] = subsArr.filter((s: any) => s.is_submitted).length
                        pendingCounts[exam.id] = subsArr.filter((s: any) => s.is_submitted && !s.is_graded).length
                    }
                } catch { }
            })

            await Promise.all([...regularExamPromises, ...officialExamPromises])
            setSubmissionCounts(subCounts)
            setPendingGradingCounts(pendingCounts)
        } catch (error) {
            console.error('Error fetching data:', error)
        } finally {
            setLoading(false)
        }
    }

    const resetCreateForm = () => {
        setForm({
            teaching_assignment_ids: [],
            title: '',
            description: '',
            start_time: '',
            duration_minutes: 60,
            schedule_mode: 'sync',
            window_end_time: '',
            is_randomized: true,
            max_violations: 3,
            show_results_immediately: true
        })
        setExamKind('ULANGAN')
    }

    // Buat UTS/UAS (ujian resmi serentak) — satu mapel, kelas target = kelas TA terpilih
    const handleCreateOfficial = async () => {
        const selectedTAs = teachingAssignments.filter(ta => form.teaching_assignment_ids.includes(ta.id))
        const subjectIds = [...new Set(selectedTAs.map(ta => ta.subject?.id).filter(Boolean))]
        if (subjectIds.length !== 1) {
            alert('Untuk UTS/UAS, pilih kelas dari SATU mata pelajaran yang sama.')
            return
        }
        const targetClassIds = [...new Set(selectedTAs.map(ta => ta.class?.id).filter(Boolean))] as string[]
        setCreating(true)
        try {
            const res = await fetch('/api/official-exams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    exam_type: examKind,
                    title: form.title,
                    description: form.description,
                    subject_id: subjectIds[0],
                    start_time: new Date(form.start_time).toISOString(),
                    duration_minutes: form.duration_minutes,
                    window_end_time: form.schedule_mode === 'window' && form.window_end_time ? new Date(form.window_end_time).toISOString() : null,
                    is_randomized: form.is_randomized,
                    max_violations: form.max_violations,
                    target_class_ids: targetClassIds,
                    show_results_immediately: form.show_results_immediately
                })
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                alert(err.error || 'Gagal membuat ujian. Silakan coba lagi.')
                return
            }
            setShowCreate(false)
            resetCreateForm()
            const created = await res.json()
            router.push(`/dashboard/guru/uts-uas/${created.id}`)
        } finally {
            setCreating(false)
        }
    }

    const handleCreate = async () => {
        if (examKind !== 'ULANGAN') return handleCreateOfficial()
        if (form.teaching_assignment_ids.length === 0 || !form.title || !form.start_time) return
        setCreating(true)
        try {
            const localStart = new Date(form.start_time)
            const utcStart = localStart.toISOString()
            // Satu batch multi-kelas diikat batch_id di DB — tahan tab tertutup
            const batchId = form.teaching_assignment_ids.length > 1 ? crypto.randomUUID() : null
            const payload = {
                ...form,
                start_time: utcStart,
                window_end_time: form.schedule_mode === 'window' && form.window_end_time ? new Date(form.window_end_time).toISOString() : null,
                batch_id: batchId
            }

            // Create first (primary) exam
            const primaryRes = await fetch('/api/exams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...payload,
                    teaching_assignment_id: form.teaching_assignment_ids[0]
                })
            })

            if (!primaryRes.ok) {
                const err = await primaryRes.json().catch(() => ({}))
                alert(err.error || 'Gagal membuat ulangan. Silakan coba lagi.')
                return
            }

            const primaryExam = await primaryRes.json()
            
            // Create sibling exams (remaining classes)
            const siblingIds: string[] = []
            if (form.teaching_assignment_ids.length > 1) {
                const siblingResults = await Promise.allSettled(
                    form.teaching_assignment_ids.slice(1).map(taId =>
                        fetch('/api/exams', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                ...payload,
                                teaching_assignment_id: taId
                            })
                        }).then(r => {
                            if (!r.ok) throw new Error(`HTTP ${r.status}`)
                            return r.json()
                        })
                    )
                )
                const failedClassNames: string[] = []
                siblingResults.forEach((r, i) => {
                    if (r.status === 'fulfilled' && r.value?.id) {
                        siblingIds.push(r.value.id)
                    } else {
                        const taId = form.teaching_assignment_ids.slice(1)[i]
                        failedClassNames.push(teachingAssignments.find(t => t.id === taId)?.class?.name || `Kelas ke-${i + 2}`)
                    }
                })
                if (failedClassNames.length > 0) {
                    alert(`Ulangan utama berhasil dibuat. ${siblingIds.length} kelas tambahan berhasil, ${failedClassNames.length} GAGAL: ${failedClassNames.join(', ')}. Buat ulang ulangan untuk kelas tersebut.`)
                }
            }

            setShowCreate(false)
            resetCreateForm()
            
            const siblingParam = siblingIds.length > 0 ? `?siblings=${siblingIds.join(',')}` : ''
            router.push(`/dashboard/guru/ulangan/${primaryExam.id}${siblingParam}`)
        } finally {
            setCreating(false)
        }
    }

    const openCopyModal = (exam: Exam) => {
        setCopySourceExam(exam)
        setCopyForm({
            teaching_assignment_ids: [],
            title: `[Copy] ${exam.title}`,
            description: exam.description || '',
            start_time: '', // Waktu mulai wajib diisi baru
            duration_minutes: exam.duration_minutes,
            schedule_mode: exam.window_end_time ? 'window' : 'sync',
            window_end_time: '',
            is_randomized: exam.is_randomized,
            max_violations: exam.max_violations,
            show_results_immediately: true
        })
        setShowCopy(true)
    }

    const handleCopyExam = async () => {
        if (!copySourceExam || copyForm.teaching_assignment_ids.length === 0 || !copyForm.title || !copyForm.start_time) return
        setCopying(true)
        try {
            const targetIds: string[] = []
            const localStart = new Date(copyForm.start_time)
            const utcStart = localStart.toISOString()
            
            // Create target exams
            const createResults = await Promise.allSettled(
                copyForm.teaching_assignment_ids.map(taId => 
                    fetch('/api/exams', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            teaching_assignment_id: taId,
                            title: copyForm.title,
                            description: copyForm.description,
                            start_time: utcStart,
                            duration_minutes: copyForm.duration_minutes,
                            window_end_time: copyForm.schedule_mode === 'window' && copyForm.window_end_time ? new Date(copyForm.window_end_time).toISOString() : null,
                            is_randomized: copyForm.is_randomized,
                            max_violations: copyForm.max_violations,
                            show_results_immediately: copyForm.show_results_immediately
                        })
                    }).then(r => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`)
                        return r.json()
                    })
                )
            )

            createResults.forEach(r => {
                if (r.status === 'fulfilled' && r.value?.id) {
                    targetIds.push(r.value.id)
                }
            })

            if (targetIds.length === 0) {
                alert('Gagal membuat ulangan baru. Silakan coba lagi.')
                return
            }

            // Copy questions
            const copyRes = await fetch('/api/exams/copy-questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_exam_id: copySourceExam.id,
                    target_exam_ids: targetIds,
                    also_publish: false
                })
            })

            if (!copyRes.ok) {
                alert('Berhasil membuat ulangan, tetapi gagal menyalin soal.')
            } else {
                alert(`Ulangan berhasil disalin ke ${targetIds.length} kelas.`)
            }

            setShowCopy(false)
            fetchData()
        } catch (error) {
            console.error('Error copying exam:', error)
            alert('Terjadi kesalahan saat menyalin ulangan.')
        } finally {
            setCopying(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Hapus ulangan ini?')) return
        await fetch(`/api/exams/${id}`, { method: 'DELETE' })
        fetchData()
    }

    const handleOpenRemedial = async (exam: Exam) => {
        setRemedialExam(exam)
        setShowRemedial(true)
        setRemedialLoading(true)
        setSelectedStudentIds([])
        setRemedialMethod('ASLI')
        setRemedialStartTime('')

        try {
            const classId = exam.teaching_assignment?.class?.id
            let kkm = exam.teaching_assignment?.subject?.kkm || 75

            // Resolve Granular KKM if available
            try {
                const kkmRes = await fetch(`/api/subject-kkm?subject_id=${exam.teaching_assignment?.subject?.id}`)
                if (kkmRes.ok) {
                    const kkmData = await kkmRes.json()
                    const classLevel = (exam.teaching_assignment?.class as any)?.school_level
                    const gradeLevel = (exam.teaching_assignment?.class as any)?.grade_level
                    const granular = kkmData.find((k: any) => k.school_level === classLevel && k.grade_level === gradeLevel)
                    if (granular) kkm = granular.kkm
                }
            } catch (e) {
                console.error('Failed to fetch granular KKM', e)
            }
            
            setRemedialKkm(kkm)

            if (!classId) throw new Error('Class ID missing')

            const [studentsRes, subsRes] = await Promise.all([
                fetch(`/api/students?class_id=${classId}&enrollment_year_id=${(exam.teaching_assignment as any)?.academic_year_id || ''}`),
                fetch(`/api/exam-submissions?exam_id=${exam.id}&teacher_view=true`)
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

            studentsWithScores.sort((a, b) => a.score - b.score)

            setRemedialStudents(studentsWithScores)
            setSelectedStudentIds(studentsWithScores.filter((s: any) => s.isBelowKKM).map((s: any) => s.id))
        } catch (error) {
            console.error('Error fetching remedial data:', error)
            alert('Gagal memuat data siswa untuk remedial')
        } finally {
            setRemedialLoading(false)
        }
    }

    const handleCreateRemedial = async () => {
        if (!remedialExam || selectedStudentIds.length === 0 || !remedialStartTime) return
        setCreating(true)
        try {
            let formattedRemedialStartTime = null;
            if (remedialStartTime) {
                const localDate = new Date(remedialStartTime);
                formattedRemedialStartTime = localDate.toISOString();
            }

            const payload = {
                teaching_assignment_id: remedialExam.teaching_assignment.id,
                title: `[Remedial] ${remedialExam.title}`,
                description: `Remedial untuk ulangan: ${remedialExam.title}`,
                start_time: formattedRemedialStartTime,
                duration_minutes: remedialExam.duration_minutes,
                is_randomized: remedialExam.is_randomized,
                max_violations: remedialExam.max_violations,
                is_remedial: true,
                remedial_for_id: remedialExam.id,
                allowed_student_ids: selectedStudentIds,
                duplicate_questions: remedialMethod === 'ASLI'
            }

            const res = await fetch('/api/exams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (res.ok) {
                const newExam = await res.json()
                setShowRemedial(false)
                fetchData()

                if (remedialMethod === 'BARU') {
                    router.push(`/dashboard/guru/ulangan/${newExam.id}`)
                }
            } else {
                alert('Gagal membuat ulangan remedial')
            }
        } finally {
            setCreating(false)
        }
    }

    const formatDateTime = (dateString: string) => {
        return new Date(dateString).toLocaleString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    const getExamStatus = (exam: Exam) => {
        const now = new Date()
        const startTime = new Date(exam.start_time)
        // Mode jendela: akhir = jam tutup; mode serentak = start + durasi
        const endTime = exam.window_end_time
            ? new Date(exam.window_end_time)
            : new Date(startTime.getTime() + exam.duration_minutes * 60000)

        if (exam.pending_publish) return { label: '🔍 Under Review', color: 'bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-500/20 dark:text-amber-400 font-bold' }
        if (!exam.is_active) return { label: 'Draft', color: 'bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-500/20 dark:text-amber-400' }
        if (now < startTime) return { label: 'Terjadwal', color: 'bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-500/20 dark:text-blue-400' }
        if (now >= startTime && now <= endTime) return { label: 'Berlangsung', color: 'bg-green-500/10 text-green-600 border-green-200 dark:border-green-500/20 dark:text-green-400' }
        return { label: 'Selesai', color: 'bg-secondary/10 text-text-secondary border-secondary/20' }
    }

    const getOfficialExamStatus = (exam: OfficialExam) => {
        const now = new Date()
        const startTime = new Date(exam.start_time)
        // Mode jendela: akhir = jam tutup; mode serentak = start + durasi
        const endTime = exam.window_end_time
            ? new Date(exam.window_end_time)
            : new Date(startTime.getTime() + exam.duration_minutes * 60000)

        if (!exam.is_active) return { label: 'Draft', color: 'bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-500/20 dark:text-amber-400' }
        if (now < startTime) return { label: 'Terjadwal', color: 'bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-500/20 dark:text-blue-400' }
        if (now >= startTime && now <= endTime) return { label: 'Berlangsung', color: 'bg-green-500/10 text-green-600 border-green-200 dark:border-green-500/20 dark:text-green-400' }
        return { label: 'Selesai', color: 'bg-secondary/10 text-text-secondary border-secondary/20' }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Ulangan"
                icon={<div className="text-red-500"><Clock set="bold" primaryColor="currentColor" size={24} /></div>}
                backHref="/dashboard/guru"
                subtitle="Ulangan harian & ujian UTS/UAS"
                action={
                    <Button onClick={() => setShowCreate(true)} data-tutorial="exam-create-btn" icon={
                        <div className="text-white"><Plus set="bold" primaryColor="currentColor" size={20} /></div>
                    }>
                        Buat Ulangan
                    </Button>
                }
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-tutorial="exam-feature-cards">
                <Card padding="p-4" className="bg-gradient-to-br from-purple-500/5 to-purple-600/5 border-purple-200/50">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400 shadow-sm">
                            <Lock set="bold" primaryColor="currentColor" size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-text-main dark:text-white">Tab Lock Mode</h3>
                            <p className="text-sm text-text-secondary">Siswa tidak bisa keluar tab</p>
                        </div>
                    </div>
                </Card>
                <Card padding="p-4" className="bg-gradient-to-br from-orange-500/5 to-orange-600/5 border-orange-200/50">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 dark:text-orange-400 shadow-sm">
                            <Clock set="bold" primaryColor="currentColor" size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-text-main dark:text-white">Waktu & Durasi</h3>
                            <p className="text-sm text-text-secondary">Kontrol waktu yang ketat</p>
                        </div>
                    </div>
                </Card>
                <Card padding="p-4" className="bg-gradient-to-br from-cyan-500/5 to-cyan-600/5 border-cyan-200/50">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center text-cyan-600 dark:text-cyan-400 shadow-sm">
                            <ShieldDone set="bold" primaryColor="currentColor" size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-text-main dark:text-white">Violation Limit</h3>
                            <p className="text-sm text-text-secondary">Auto-submit jika curang</p>
                        </div>
                    </div>
                </Card>
            </div>

            {aiReviewEnabled && returnedExams.length > 0 && (
                <Card className="p-4 bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-700 mt-8">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-red-500">🔬</span>
                        <h3 className="font-bold text-red-700 dark:text-red-300 text-sm">
                            Soal Perlu Diperbaiki ({returnedExams.reduce((acc, curr) => acc + curr.returnedCount, 0)})
                        </h3>
                    </div>
                    <div className="space-y-2">
                        {returnedExams.map(re => (
                            <Link key={re.examId} href={`/dashboard/guru/ulangan/${re.examId}`}>
                                <div className="flex items-center justify-between px-3 py-2 bg-white dark:bg-surface-dark rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors border border-red-100 dark:border-red-900/30">
                                    <span className="text-sm font-semibold text-text-main dark:text-white">{re.title}</span>
                                    <span className="text-xs font-bold text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-2.5 py-1 rounded-full">
                                        {re.returnedCount} soal dikembalikan
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
            ) : (
                <div className="space-y-8">
                    <div>
                        <h2 className="text-xl font-bold text-text-main dark:text-white mb-4 flex items-center gap-2">
                            <div className="text-red-500"><Clock set="bold" primaryColor="currentColor" size={24} /></div>
                            Ulangan Harian
                        </h2>
                        {exams.length === 0 ? (
                            <div className="bg-secondary/5 border-2 border-dashed border-secondary/20 rounded-2xl p-8 text-center">
                                <div className="text-secondary/50 mx-auto mb-3 flex justify-center"><Document set="bold" primaryColor="currentColor" size={48} /></div>
                                <h3 className="font-bold text-text-main dark:text-white text-lg">Belum Ada Ulangan Harian</h3>
                                <p className="text-text-secondary text-sm mb-4">Buat ulangan baru untuk kelas Anda dengan fitur pengawasan.</p>
                                <Button onClick={() => setShowCreate(true)} size="sm">Buat Ulangan Sekarang</Button>
                            </div>
                        ) : (
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {exams.map((exam) => {
                                    const status = getExamStatus(exam as any)
                                    const classId = exam.teaching_assignment?.class?.id
                                    const total = classId ? (studentCounts[classId] || 0) : 0
                                    const submitted = submissionCounts[exam.id] || 0
                                    const pendingGrading = pendingGradingCounts[exam.id] || 0
                                    const isLive = status.label === 'Berlangsung'
                                    const isDone = status.label === 'Selesai'
                                    const isActive = exam.is_active

                                    // Aksi utama kontekstual: Monitor saat live, Hasil saat selesai, Edit selebihnya
                                    const primaryAction = isLive
                                        ? { label: 'Monitor Live', href: `/dashboard/guru/ulangan/${exam.id}/monitor`, icon: <Activity className="w-4 h-4" /> }
                                        : isActive && isDone
                                            ? { label: 'Lihat Hasil', href: `/dashboard/guru/ulangan/${exam.id}?tab=hasil`, icon: <span className="text-secondary"><Graph set="bold" primaryColor="currentColor" size={16} /></span> }
                                            : { label: exam.pending_publish ? 'Perbaiki Soal' : 'Edit Soal', href: `/dashboard/guru/ulangan/${exam.id}`, icon: <Edit set="bold" primaryColor="currentColor" size={16} /> }

                                    const menuItems: DropdownMenuItem[] = [
                                        {
                                            label: 'Lihat Hasil',
                                            show: isActive,
                                            icon: <span className="text-secondary"><Graph set="bold" primaryColor="currentColor" size={14} /></span>,
                                            onClick: () => router.push(`/dashboard/guru/ulangan/${exam.id}?tab=hasil`),
                                        },
                                        {
                                            label: 'Buat Remedial',
                                            show: isActive && !(exam as any).is_remedial && isDone,
                                            icon: <RefreshCw className="w-4 h-4" />,
                                            onClick: () => handleOpenRemedial(exam),
                                        },
                                        {
                                            label: 'Pakai Ulang',
                                            show: isActive,
                                            icon: <Copy className="w-4 h-4" />,
                                            onClick: () => openCopyModal(exam),
                                        },
                                        {
                                            label: 'Hapus',
                                            danger: true,
                                            icon: <Trash2 className="w-4 h-4" />,
                                            onClick: () => handleDelete(exam.id),
                                        },
                                    ]

                                    const extraBadges = [
                                        ...(exam as any).is_remedial ? [(
                                            <span key="remedial" className="px-2 py-0.5 bg-gradient-to-r from-orange-400 to-red-500 text-white text-[10px] font-bold rounded-full shadow-sm animate-pulse-slow">
                                                REMEDIAL
                                            </span>
                                        )] : [],
                                        ...exam.creator_role === 'ADMIN' ? [(
                                            <span key="admin" className="px-2.5 py-1 text-xs font-bold rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20">
                                                Dibuatkan Admin
                                            </span>
                                        )] : [],
                                        ...exam.is_randomized ? [(
                                            <span key="acak" className="text-xs text-text-secondary flex items-center gap-1 bg-secondary/10 px-2 py-1 rounded-full">
                                                <Swap set="bold" primaryColor="currentColor" size={12} /> Acak
                                            </span>
                                        )] : [],
                                    ]

                                    return (
                                        <ExamCard
                                            key={exam.id}
                                            status={status}
                                            typeBadge={{ label: 'ULANGAN', className: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20' }}
                                            title={exam.title}
                                            description={exam.description}
                                            extraBadges={extraBadges}
                                            isLive={isLive}
                                            subjectName={exam.teaching_assignment?.subject?.name}
                                            classNameLabel={exam.teaching_assignment?.class?.name}
                                            durationMinutes={exam.duration_minutes}
                                            questionCount={exam.question_count}
                                            batchSize={exam.batch_size}
                                            submission={{ submitted, total }}
                                            pendingGrading={pendingGrading}
                                            onPendingGradingClick={() => router.push(`/dashboard/guru/ulangan/${exam.id}?tab=hasil`)}
                                            primaryAction={primaryAction}
                                            menuItems={menuItems}
                                        />
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    <div>
                        <h2 className="text-xl font-bold text-text-main dark:text-white mb-4 flex items-center gap-2">
                            <GraduationCap className="w-6 h-6 text-indigo-500" />
                            Ujian UTS & UAS
                        </h2>
                        {officialExams.length === 0 ? (
                            <div className="bg-secondary/5 border-2 border-dashed border-secondary/20 rounded-2xl p-8 text-center">
                                <BookOpen className="w-12 h-12 text-secondary/50 mx-auto mb-3" />
                                <h3 className="font-bold text-text-main dark:text-white text-lg">Belum Ada UTS/UAS</h3>
                                <p className="text-text-secondary text-sm">Tidak ada ujian resmi yang terkait dengan mata pelajaran Anda saat ini.</p>
                            </div>
                        ) : (
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {officialExams.map(exam => {
                                    const status = getOfficialExamStatus(exam)
                                    const isLive = status.label === 'Berlangsung'

                                    // Draft (termasuk buatan admin) dibuka di editor agar bisa dilengkapi & dipublish
                                    const primaryAction = status.label === 'Draft'
                                        ? { label: 'Edit Soal', href: `/dashboard/guru/uts-uas/${exam.id}`, icon: <Edit set="bold" primaryColor="currentColor" size={16} /> }
                                        : isLive
                                            ? { label: 'Monitor Live', href: `/dashboard/guru/uts-uas/${exam.id}/monitor`, icon: <Activity className="w-4 h-4" /> }
                                            : { label: 'Lihat Hasil', href: `/dashboard/guru/uts-uas/${exam.id}/hasil`, icon: <span className="text-secondary"><Graph set="bold" primaryColor="currentColor" size={16} /></span> }

                                    const extraBadges = exam.creator_role === 'ADMIN' ? [(
                                        <span key="admin" className="px-2.5 py-1 text-xs font-bold rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20">
                                            Dibuatkan Admin
                                        </span>
                                    )] : []

                                    return (
                                        <ExamCard
                                            key={exam.id}
                                            status={status}
                                            typeBadge={exam.exam_type === 'UTS'
                                                ? { label: 'UTS', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20' }
                                                : { label: 'UAS', className: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20' }}
                                            title={exam.title}
                                            description={exam.description}
                                            extraBadges={extraBadges}
                                            isLive={isLive}
                                            subjectName={exam.subject?.name}
                                            classNameLabel={`${exam.target_class_ids?.length ?? 0} kelas`}
                                            durationMinutes={exam.duration_minutes}
                                            questionCount={exam.question_count}
                                            primaryAction={primaryAction}
                                        />
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <Modal
                open={showCopy}
                onClose={() => setShowCopy(false)}
                title="Pakai Ulang Ulangan"
            >
                <div className="space-y-4">
                    <div className="bg-secondary/10 p-4 rounded-xl mb-2">
                        <h4 className="font-bold text-text-main dark:text-white mb-1">Source Ulangan: {copySourceExam?.title}</h4>
                        <div className="flex gap-4 text-sm text-text-secondary dark:text-zinc-400">
                            <span>Mata Pelajaran: <strong>{copySourceExam?.teaching_assignment?.subject?.name}</strong></span>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pilih Kelas Tujuan</label>
                        <ClassChipsSelector
                            assignments={teachingAssignments}
                            selectedIds={copyForm.teaching_assignment_ids}
                            onChange={(ids) => setCopyForm({ ...copyForm, teaching_assignment_ids: ids })}
                            disabled={teachingAssignments.length === 0}
                            defaultSubjectId={copySourceExam?.teaching_assignment?.subject?.id}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Ulangan Baru</label>
                        <input
                            type="text"
                            value={copyForm.title}
                            onChange={(e) => setCopyForm({ ...copyForm, title: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Deskripsi (Opsional)</label>
                        <textarea
                            value={copyForm.description}
                            onChange={(e) => setCopyForm({ ...copyForm, description: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            rows={2}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jadwal Pengerjaan</label>
                        <TimeWindowFields
                            value={{
                                mode: copyForm.schedule_mode,
                                start_time: copyForm.start_time,
                                window_end_time: copyForm.window_end_time,
                                duration_minutes: String(copyForm.duration_minutes)
                            }}
                            onChange={(v) => setCopyForm({
                                ...copyForm,
                                schedule_mode: v.mode,
                                start_time: v.start_time,
                                duration_minutes: v.duration_minutes ? parseInt(v.duration_minutes, 10) || 0 : 0,
                                window_end_time: v.mode === 'window' ? v.window_end_time : ''
                            })}
                            startLabel="Waktu Mulai Baru"
                            durationRequired
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Max Pelanggaran</label>
                            <input
                                type="number"
                                value={copyForm.max_violations}
                                onChange={(e) => setCopyForm({ ...copyForm, max_violations: parseInt(e.target.value) || 3 })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                min={1}
                                max={10}
                            />
                        </div>
                        <div className="flex items-end">
                            <label className="flex items-center gap-2 cursor-pointer p-3 bg-secondary/5 border border-secondary/20 rounded-xl w-full">
                                <input
                                    type="checkbox"
                                    checked={copyForm.is_randomized}
                                    onChange={(e) => setCopyForm({ ...copyForm, is_randomized: e.target.checked })}
                                    className="w-5 h-5 rounded bg-white border-secondary/30 text-primary focus:ring-primary"
                                />
                                <span className="text-text-main dark:text-white flex items-center gap-1"><Swap set="bold" primaryColor="currentColor" size={16} /> Acak Soal</span>
                            </label>
                        </div>
                    </div>
                    <div className="flex gap-3 pt-4">
                        <Button
                            variant="secondary"
                            onClick={() => setShowCopy(false)}
                            className="flex-1"
                        >
                            Batal
                        </Button>
                        <Button
                            onClick={handleCopyExam}
                            disabled={copying || copyForm.teaching_assignment_ids.length === 0 || !copyForm.title || !copyForm.start_time || copyForm.duration_minutes < 5 || (copyForm.schedule_mode === 'window' && !copyForm.window_end_time)}
                            loading={copying}
                            className="flex-1"
                        >
                            Salin Ulangan
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal
                open={showCreate}
                onClose={() => setShowCreate(false)}
                title={examKind === 'ULANGAN' ? 'Buat Ulangan Baru' : `Buat ${examKind} Baru`}
            >
                <div className="space-y-4">
                    {/* Pilihan jenis: ulangan harian atau UTS/UAS resmi — satu pintu form */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jenis Ujian</label>
                        <div className="grid grid-cols-3 gap-2">
                            {(['ULANGAN', 'UTS', 'UAS'] as const).map(k => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => setExamKind(k)}
                                    className={`px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all ${examKind === k
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-secondary/20 text-text-secondary hover:border-primary/40'}`}
                                >
                                    {k === 'ULANGAN' ? 'Ulangan' : k}
                                </button>
                            ))}
                        </div>
                        {examKind !== 'ULANGAN' && (
                            <p className="text-xs text-text-secondary mt-2">
                                {examKind} adalah ujian resmi sekolah — semua kelas terpilih mengerjakan pada jadwal yang sama (bisa mode serentak atau jendela waktu). Pilih kelas dari SATU mata pelajaran.
                            </p>
                        )}
                    </div>
                    <div data-tutorial="exam-form-class">
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kelas & Mata Pelajaran</label>
                        <ClassChipsSelector
                            assignments={teachingAssignments}
                            selectedIds={form.teaching_assignment_ids}
                            onChange={(ids) => setForm({ ...form, teaching_assignment_ids: ids })}
                            disabled={teachingAssignments.length === 0}
                        />
                    </div>
                    <div data-tutorial="exam-form-title">
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Ulangan</label>
                        <input
                            type="text"
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            placeholder="Contoh: UTS Matematika Bab 1-3"
                        />
                    </div>
                    <div data-tutorial="exam-form-desc">
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Deskripsi (Opsional)</label>
                        <textarea
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            rows={2}
                            placeholder="Materi yang diujikan..."
                        />
                    </div>
                    <div data-tutorial="exam-form-start">
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jadwal Pengerjaan</label>
                        <TimeWindowFields
                            value={{
                                mode: form.schedule_mode,
                                start_time: form.start_time,
                                window_end_time: form.window_end_time,
                                duration_minutes: String(form.duration_minutes)
                            }}
                            onChange={(v) => setForm({
                                ...form,
                                schedule_mode: v.mode,
                                start_time: v.start_time,
                                duration_minutes: v.duration_minutes ? parseInt(v.duration_minutes, 10) || 0 : 0,
                                window_end_time: v.mode === 'window' ? v.window_end_time : ''
                            })}
                            durationRequired
                        />
                    </div>
                    <div data-tutorial="exam-form-violations">
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Max Pelanggaran (auto-submit)</label>
                        <input
                            type="number"
                            value={form.max_violations}
                            onChange={(e) => setForm({ ...form, max_violations: parseInt(e.target.value) || 3 })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            min={1}
                            max={10}
                        />
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/10" data-tutorial="exam-form-randomize">
                        <input
                            type="checkbox"
                            id="randomize"
                            checked={form.is_randomized}
                            onChange={(e) => setForm({ ...form, is_randomized: e.target.checked })}
                            className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary"
                        />
                        <label htmlFor="randomize" className="text-sm font-medium text-text-main dark:text-white cursor-pointer select-none">Acak urutan soal per siswa</label>
                    </div>

                    <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/10" data-tutorial="exam-form-show-results">
                        <input
                            type="checkbox"
                            id="showResults"
                            checked={form.show_results_immediately}
                            onChange={(e) => setForm({ ...form, show_results_immediately: e.target.checked })}
                            className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary"
                        />
                        <label htmlFor="showResults" className="text-sm font-medium text-text-main dark:text-white cursor-pointer select-none flex flex-col">
                            <span>Tampilkan Hasil Langsung</span>
                        </label>
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-secondary/10 mt-2" data-tutorial="exam-form-submit">
                        <Button variant="secondary" onClick={() => setShowCreate(false)} className="flex-1">
                            Batal
                        </Button>
                        <Button
                            onClick={handleCreate}
                            loading={creating}
                            disabled={creating || form.teaching_assignment_ids.length === 0 || !form.title || !form.start_time || form.duration_minutes < 5 || (form.schedule_mode === 'window' && !form.window_end_time)}
                            className="flex-1"
                        >
                            Buat & Tambah Soal
                        </Button>
                    </div>
                </div>
            </Modal>

            <Modal
                open={showRemedial}
                onClose={() => setShowRemedial(false)}
                title="Tugaskan Remedial Ulangan"
            >
                {remedialLoading ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                ) : remedialExam ? (
                    <div className="space-y-6">
                        <div className="bg-secondary/10 p-4 rounded-xl">
                            <h4 className="font-bold text-text-main dark:text-white mb-1">{remedialExam.title}</h4>
                            <div className="flex gap-4 text-sm text-text-secondary dark:text-zinc-400">
                                <span>Mata Pelajaran: <strong>{remedialExam.teaching_assignment?.subject?.name}</strong></span>
                                <span>KKM: <strong className="text-red-500">{remedialKkm}</strong></span>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Waktu Mulai Ulangan Remedial</label>
                            <input
                                type="datetime-local"
                                value={remedialStartTime}
                                onChange={(e) => setRemedialStartTime(e.target.value)}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>

                        <div className="space-y-3">
                            <label className="block text-sm font-bold text-text-main dark:text-white">Metode Soal Remedial</label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="block text-sm font-bold text-text-main dark:text-white">
                                    Pilih Siswa ({selectedStudentIds.length} terpilih)
                                </label>
                            </div>
                            <div className="max-h-60 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                                {remedialStudents.length === 0 ? (
                                    <p className="text-sm text-text-secondary text-center py-4">Tidak ada siswa di kelas ini</p>
                                ) : (
                                    remedialStudents.map((student) => {
                                        const isSelected = selectedStudentIds.includes(student.id)
                                        return (
                                            <div
                                                key={student.id}
                                                onClick={() => {
                                                    if (isSelected) {
                                                        setSelectedStudentIds(prev => prev.filter(id => id !== student.id))
                                                    } else {
                                                        setSelectedStudentIds(prev => [...prev, student.id])
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
                            disabled={creating || selectedStudentIds.length === 0 || !remedialStartTime}
                            loading={creating}
                            className="flex-1"
                        >
                                Proses Remedial
                            </Button>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </div>
    )
}
