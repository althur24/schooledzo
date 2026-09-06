'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Modal, PageHeader, Button, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import TimeWindowFields from '@/components/TimeWindowFields'
import ClassChipsSelector from '@/components/ClassChipsSelector'
import RemedialPolicyFields, { RemedialPolicyValue } from '@/components/RemedialPolicyFields'
import { Plus, ChevronDown } from 'react-iconly'
import { Loader2, FileText, Clock, Users, CheckCircle, Edit3, Trash2, GraduationCap, BookOpen, BarChart3, Copy, RefreshCw } from 'lucide-react'
import { useSchoolLabels } from '@/contexts/LabelsContext'

interface OfficialExam {
    id: string
    exam_type: 'UTS' | 'UAS'
    title: string
    description: string | null
    start_time: string
    duration_minutes: number
    window_end_time?: string | null
    is_active: boolean
    is_randomized: boolean
    max_violations: number
    target_class_ids: string[]
    question_count: number
    created_at: string
    subject: { id: string; name: string; kkm?: number }
    academic_year: { id: string; name: string; is_active: boolean }
    is_remedial?: boolean
    remedial_for_id?: string | null
    allowed_student_ids?: string[] | null
}

interface Subject {
    id: string
    name: string
}

interface ClassItem {
    id: string
    name: string
    school_level: string | null
    grade_level: number | null
}

export default function AdminUtsUasPage() {
    const router = useRouter()
    const labels = useSchoolLabels()
    const [exams, setExams] = useState<OfficialExam[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [classes, setClasses] = useState<ClassItem[]>([])
    const [loading, setLoading] = useState(true)
    const [showCreate, setShowCreate] = useState(false)
    const [creating, setCreating] = useState(false)
    const [filterType, setFilterType] = useState<string>('')
    const [filterSubject, setFilterSubject] = useState<string>('')
    const [submissionCounts, setSubmissionCounts] = useState<Record<string, { submitted: number; total: number }>>({})
    const [tab, setTab] = useState<'utsuas' | 'ulangan'>('utsuas')
    const [ulanganExams, setUlanganExams] = useState<any[]>([])
    const [ulanganCounts, setUlanganCounts] = useState<Record<string, { submitted: number; total: number }>>({})
    const [ulanganLoading, setUlanganLoading] = useState(true)

    // Duplicate & Remedial states (dipakai UTS/UAS & Ulangan — source membedakan endpoint)
    const [showDuplicate, setShowDuplicate] = useState(false)

    // === Buat Ulangan untuk Guru (admin) — form senanda form ulangan guru ===
    const [showCreateTeacherExam, setShowCreateTeacherExam] = useState(false)
    const [teacherOptions, setTeacherOptions] = useState<{ id: string; name: string }[]>([])
    const [teacherTAs, setTeacherTAs] = useState<{ id: string; subject: { id: string; name: string }; class: { id: string; name: string } }[]>([])
    const [teacherExamForm, setTeacherExamForm] = useState({
        teacher_id: '',
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
    const [creatingTeacherExam, setCreatingTeacherExam] = useState(false)

    const openCreateTeacherExam = async () => {
        setShowCreateTeacherExam(true)
        setTeacherExamForm({
            teacher_id: '',
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
        setTeacherTAs([])
        if (teacherOptions.length === 0) {
            try {
                const res = await fetch('/api/teachers')
                const data = await res.json()
                const list = Array.isArray(data) ? data : []
                setTeacherOptions(list.map((t: any) => ({ id: t.id, name: t.user?.full_name || t.nip || 'Tanpa Nama' })))
            } catch (e) {
                console.error('Error fetching teachers:', e)
            }
        }
    }

    const handleTeacherExamTeacherChange = async (teacherId: string) => {
        setTeacherExamForm(prev => ({ ...prev, teacher_id: teacherId, teaching_assignment_ids: [] }))
        setTeacherTAs([])
        if (!teacherId) return
        try {
            const res = await fetch('/api/teaching-assignments')
            const data = await res.json()
            const list = Array.isArray(data) ? data : []
            setTeacherTAs(list
                .filter((ta: any) => ta.teacher_id === teacherId || (Array.isArray(ta.teacher) ? ta.teacher[0]?.id === teacherId : ta.teacher?.id === teacherId))
                .map((ta: any) => ({
                    id: ta.id,
                    subject: Array.isArray(ta.subject) ? ta.subject[0] : ta.subject,
                    class: Array.isArray(ta.class) ? ta.class[0] : ta.class
                }))
                .filter((ta: any) => ta.subject?.id && ta.class?.id))
        } catch (e) {
            console.error('Error fetching teacher assignments:', e)
        }
    }

    const handleCreateTeacherExam = async () => {
        const f = teacherExamForm
        if (!f.teacher_id || f.teaching_assignment_ids.length === 0 || !f.title || !f.start_time || f.duration_minutes < 5 || (f.schedule_mode === 'window' && !f.window_end_time)) return
        setCreatingTeacherExam(true)
        try {
            const batchId = f.teaching_assignment_ids.length > 1 ? crypto.randomUUID() : null
            const basePayload = {
                title: f.title,
                description: f.description,
                start_time: new Date(f.start_time).toISOString(),
                duration_minutes: f.duration_minutes,
                window_end_time: f.schedule_mode === 'window' && f.window_end_time ? new Date(f.window_end_time).toISOString() : null,
                is_randomized: f.is_randomized,
                max_violations: f.max_violations,
                show_results_immediately: f.show_results_immediately,
                batch_id: batchId
            }

            const results = await Promise.allSettled(
                f.teaching_assignment_ids.map(taId =>
                    fetch('/api/exams', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...basePayload, teaching_assignment_id: taId })
                    }).then(r => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`)
                        return r.json()
                    })
                )
            )
            const okCount = results.filter(r => r.status === 'fulfilled').length
            if (okCount === 0) {
                showToast(`Gagal membuat ${labels.ulangan}. Silakan coba lagi.`, 'error')
                return
            }
            setShowCreateTeacherExam(false)
            const firstCreated = results.find(r => r.status === 'fulfilled')?.value
            if (firstCreated?.id) {
                router.push(`/dashboard/admin/uts-uas/${firstCreated.id}?type=ulangan`)
            } else {
                fetchUlangan()
            }
            if (okCount < f.teaching_assignment_ids.length) {
                showToast(`${okCount} dari ${f.teaching_assignment_ids.length} kelas berhasil dibuat. Sisanya gagal — buat ulang untuk kelas tersebut.`, 'error')
            }
        } finally {
            setCreatingTeacherExam(false)
        }
    }

    const [duplicateExam, setDuplicateExam] = useState<OfficialExam | any | null>(null)
    const [duplicateSource, setDuplicateSource] = useState<'official' | 'ulangan'>('official')
    const [duplicateMode, setDuplicateMode] = useState<'BIASA' | 'REMEDIAL'>('BIASA')
    const [duplicating, setDuplicating] = useState(false)
    const [remedialStudents, setRemedialStudents] = useState<any[]>([])
    const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])
    const [remedialLoading, setRemedialLoading] = useState(false)
    // Ulangan remedial: pilihan soal ASLI (disalin) atau BARU (kosong) — ala halaman guru
    const [ulanganRemedialMethod, setUlanganRemedialMethod] = useState<'ASLI' | 'BARU'>('ASLI')
    const [remedialPolicy, setRemedialPolicy] = useState<RemedialPolicyValue>({ policy: 'HIGHEST', cap: 75 })
    const [duplicateForm, setDuplicateForm] = useState({
        title: '',
        start_time: '',
        duration_minutes: 90,
        schedule_mode: 'sync' as 'sync' | 'window',
        window_end_time: '',
        target_class_ids: [] as string[]
    })

    // Toast & confirm dialog
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
    const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type })
        setTimeout(() => setToast(null), 3000)
    }

    const [form, setForm] = useState({
        exam_type: 'UTS' as 'UTS' | 'UAS',
        title: '',
        description: '',
        subject_id: '',
        start_time: '',
        duration_minutes: 90,
        schedule_mode: 'sync' as 'sync' | 'window',
        window_end_time: '',
        is_randomized: true,
        max_violations: 3,
        show_results_immediately: true,
        target_class_ids: [] as string[]
    })

    useEffect(() => {
        fetchData()
        fetchUlangan()
    }, [])

    const fetchData = async () => {
        try {
            const [examsRes, subjectsRes, classesRes] = await Promise.all([
                fetch('/api/official-exams'),
                fetch('/api/subjects'),
                fetch('/api/classes')
            ])
            const examsData = await examsRes.json()
            const subjectsData = await subjectsRes.json()
            const classesData = await classesRes.json()

            setExams(Array.isArray(examsData) ? examsData : [])
            setSubjects(Array.isArray(subjectsData) ? subjectsData : [])
            // Scope classes to the active academic year only — UTS/UAS exams are always
            // created in the active year, so target classes must be from it too. Without
            // this, copy-classes creates same-named classes across years → duplicates.
            const allClasses = Array.isArray(classesData) ? classesData : []
            const activeClasses = allClasses.filter(c => {
                const ay = Array.isArray(c.academic_year) ? c.academic_year[0] : c.academic_year
                return ay?.is_active === true || ay?.status === 'ACTIVE'
            })
            setClasses(activeClasses)

            // Fetch submission counts for each exam
            const examsList = Array.isArray(examsData) ? examsData : []
            const counts: Record<string, { submitted: number; total: number }> = {}
            await Promise.all(examsList.map(async (exam: OfficialExam) => {
                try {
                    const res = await fetch(`/api/official-exam-submissions?exam_id=${exam.id}`)
                    if (res.ok) {
                        const subs = await res.json()
                        const subsArr = Array.isArray(subs) ? subs : []
                        counts[exam.id] = {
                            submitted: subsArr.filter((s: any) => s.is_submitted).length,
                            total: subsArr.length
                        }
                    }
                } catch { }
            }))
            setSubmissionCounts(counts)
        } catch (error) {
            console.error('Error fetching data:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchUlangan = async () => {
        setUlanganLoading(true)
        try {
            const res = await fetch('/api/exams')
            const data = await res.json()
            const list = Array.isArray(data) ? data : []
            setUlanganExams(list)
            const counts: Record<string, { submitted: number; total: number }> = {}
            await Promise.all(list.map(async (exam: any) => {
                try {
                    const r = await fetch(`/api/exam-submissions?exam_id=${exam.id}`)
                    if (r.ok) {
                        const subs = await r.json()
                        const arr = Array.isArray(subs) ? subs : []
                        counts[exam.id] = { submitted: arr.filter((s: any) => s.is_submitted).length, total: arr.length }
                    }
                } catch { }
            }))
            setUlanganCounts(counts)
        } catch (error) {
            console.error('Error fetching ulangan:', error)
        } finally {
            setUlanganLoading(false)
        }
    }

    const handleCreate = async () => {
        if (!form.subject_id || !form.title || !form.start_time || form.target_class_ids.length === 0) return
        setCreating(true)
        try {
            const localDate = new Date(form.start_time)
            const res = await fetch('/api/official-exams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    start_time: localDate.toISOString(),
                    window_end_time: form.schedule_mode === 'window' && form.window_end_time
                        ? new Date(form.window_end_time).toISOString()
                        : null
                })
            })
            if (res.ok) {
                const newExam = await res.json()
                setShowCreate(false)
                setForm({
                    exam_type: 'UTS',
                    title: '',
                    description: '',
                    subject_id: '',
                    start_time: '',
                    duration_minutes: 90,
                    schedule_mode: 'sync',
                    window_end_time: '',
                    is_randomized: true,
                    max_violations: 3,
                    show_results_immediately: true,
                    target_class_ids: []
                })
                router.push(`/dashboard/admin/uts-uas/${newExam.id}`)
            } else {
                const errData = await res.json().catch(() => ({}))
                alert(errData?.error || 'Gagal membuat ujian. Periksa isian lalu coba lagi.')
            }
        } finally {
            setCreating(false)
        }
    }

    const handleDelete = (id: string) => {
        setConfirmDialog({
            title: 'Hapus Ujian',
            message: 'Hapus ujian ini? Semua soal dan submission akan dihapus.',
            onConfirm: async () => {
                const res = await fetch(`/api/official-exams/${id}`, { method: 'DELETE' })
                if (res.ok) {
                    showToast('Ujian berhasil dihapus', 'success')
                } else {
                    showToast('Gagal menghapus ujian', 'error')
                }
                fetchData()
                setConfirmDialog(null)
            }
        })
    }

    const handleDeleteUlangan = (id: string) => {
        setConfirmDialog({
            title: `Hapus ${labels.ulangan}`,
            message: `Hapus ${labels.ulangan} ini? Semua soal dan submission akan dihapus.`,
            onConfirm: async () => {
                const res = await fetch(`/api/exams/${id}`, { method: 'DELETE' })
                if (res.ok) {
                    showToast(`${labels.ulangan} berhasil dihapus`, 'success')
                } else {
                    const err = await res.json().catch(() => null)
                    showToast(err?.error || `Gagal menghapus ${labels.ulangan}`, 'error')
                }
                fetchUlangan()
                setConfirmDialog(null)
            }
        })
    }

    const handleOpenDuplicate = async (exam: OfficialExam | any, mode: 'BIASA' | 'REMEDIAL', source: 'official' | 'ulangan' = 'official') => {
        setDuplicateExam(exam)
        setDuplicateSource(source)
        setDuplicateMode(mode)
        setRemedialStudents([])
        setSelectedStudentIds([])
        setUlanganRemedialMethod('ASLI')
        setRemedialPolicy({ policy: 'HIGHEST', cap: exam.subject?.kkm || 75 })

        const pad = (n: number) => n.toString().padStart(2, '0')
        const now = new Date()
        now.setDate(now.getDate() + 1)
        now.setHours(8, 0, 0, 0)

        const defaultTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`

        setDuplicateForm({
            title: mode === 'REMEDIAL' ? `Remedial ${exam.title}` : `Copy of ${exam.title}`,
            start_time: defaultTime,
            duration_minutes: exam.duration_minutes,
            schedule_mode: exam.window_end_time ? 'window' : 'sync',
            window_end_time: '',
            target_class_ids: exam.target_class_ids || []
        })

        if (mode === 'REMEDIAL') {
            setRemedialLoading(true)
            setShowDuplicate(true)
            try {
                if (source === 'ulangan') {
                    // Ulangan: submissions dari /api/exam-submissions; kelas dari teaching_assignment
                    const res = await fetch(`/api/exam-submissions?exam_id=${exam.id}`)
                    if (res.ok) {
                        const submissions = await res.json()
                        const ta = ulanganTA(exam)
                        const subject = Array.isArray(ta?.subject) ? ta?.subject[0] : ta?.subject
                        const cls = Array.isArray(ta?.class) ? ta?.class[0] : ta?.class
                        const baseKkm = subject?.kkm || 75
                        let granularKkms: any[] = []
                        try {
                            const kkmRes = await fetch(`/api/subject-kkm?subject_id=${subject?.id}`)
                            if (kkmRes.ok) granularKkms = await kkmRes.json()
                        } catch (e) {
                            console.error('Failed to fetch granular KKM', e)
                        }
                        let studentKkm = baseKkm
                        if (cls?.school_level && cls?.grade_level) {
                            const granular = granularKkms.find((k: any) => k.school_level === cls.school_level && k.grade_level === cls.grade_level)
                            if (granular) studentKkm = granular.kkm
                        }
                        const studentsList = (Array.isArray(submissions) ? submissions : [])
                            .filter((sub: any) => sub.is_submitted)
                            .map((sub: any) => {
                                const pct = (sub.total_score || 0) / (sub.max_score || 1) * 100
                                return {
                                    id: sub.student?.id,
                                    name: sub.student?.user?.full_name,
                                    nis: sub.student?.nis,
                                    score: sub.total_score,
                                    max_score: sub.max_score,
                                    pct,
                                    needsRemedial: pct < studentKkm,
                                    kkmApplied: studentKkm
                                }
                            })
                        setRemedialStudents(studentsList)
                        setSelectedStudentIds(studentsList.filter((s: any) => s.needsRemedial).map((s: any) => s.id))
                    }
                } else {
                    const res = await fetch(`/api/official-exam-submissions?exam_id=${exam.id}`)
                    if (res.ok) {
                        const submissions = await res.json()
                        const baseKkm = exam.subject?.kkm || 75
                        let granularKkms: any[] = []

                        try {
                            const kkmRes = await fetch(`/api/subject-kkm?subject_id=${exam.subject?.id}`)
                            if (kkmRes.ok) {
                                granularKkms = await kkmRes.json()
                            }
                        } catch (e) {
                            console.error('Failed to fetch granular KKM', e)
                        }

                        const studentsList = submissions.map((sub: any) => {
                            const pct = (sub.total_score || 0) / (sub.max_score || 1) * 100
                            let studentKkm = baseKkm

                            const classLevel = sub.student?.class?.school_level
                            const gradeLevel = sub.student?.class?.grade_level

                            if (classLevel && gradeLevel) {
                                const granular = granularKkms.find((k: any) => k.school_level === classLevel && k.grade_level === gradeLevel)
                                if (granular) studentKkm = granular.kkm
                            }

                            return {
                                id: sub.student?.id,
                                name: sub.student?.user?.full_name,
                                nis: sub.student?.nis,
                                score: sub.total_score,
                                max_score: sub.max_score,
                                pct,
                                needsRemedial: pct < studentKkm,
                                kkmApplied: studentKkm
                            }
                        })
                        setRemedialStudents(studentsList)
                        setSelectedStudentIds(studentsList.filter((s: any) => s.needsRemedial).map((s: any) => s.id))
                    }
                }
            } catch (err) {
                console.error("Failed to fetch remedial students", err)
            } finally {
                setRemedialLoading(false)
            }
        } else {
            setShowDuplicate(true)
        }
    }

    const handleDuplicate = async () => {
        if (!duplicateExam) return
        setDuplicating(true)
        try {
            const localDate = new Date(duplicateForm.start_time)
            let newExam: any = null

            if (duplicateSource === 'ulangan') {
                // Ulangan (tabel exams): create baru + salin soal via POST /api/exams
                const ta = ulanganTA(duplicateExam)
                const isRemedial = duplicateMode === 'REMEDIAL'
                const payload: any = {
                    teaching_assignment_id: ta?.id,
                    title: duplicateForm.title,
                    description: duplicateExam.description,
                    start_time: localDate.toISOString(),
                    duration_minutes: duplicateForm.duration_minutes,
                    window_end_time: duplicateForm.schedule_mode === 'window' && duplicateForm.window_end_time
                        ? new Date(duplicateForm.window_end_time).toISOString()
                        : null,
                    is_randomized: duplicateExam.is_randomized,
                    max_violations: duplicateExam.max_violations,
                    show_results_immediately: duplicateExam.show_results_immediately ?? true,
                    duplicate_from_exam_id: duplicateExam.id,
                    duplicate_questions: isRemedial ? ulanganRemedialMethod === 'ASLI' : true
                }
                if (isRemedial) {
                    payload.is_remedial = true
                    payload.remedial_for_id = duplicateExam.id
                    payload.allowed_student_ids = selectedStudentIds
                    payload.remedial_score_policy = remedialPolicy.policy
                    if (remedialPolicy.policy === 'CAP') payload.remedial_max_score = remedialPolicy.cap
                }
                const res = await fetch('/api/exams', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                })
                if (res.ok) {
                    newExam = await res.json()
                } else {
                    const err = await res.json().catch(() => null)
                    showToast(err?.error || `Gagal menduplikasi ${labels.ulangan}`, 'error')
                    return
                }
            } else {
                const payload = {
                    source_exam_id: duplicateExam.id,
                    title: duplicateForm.title,
                    start_time: localDate.toISOString(),
                    duration_minutes: duplicateForm.duration_minutes,
                    window_end_time: duplicateForm.schedule_mode === 'window' && duplicateForm.window_end_time
                        ? new Date(duplicateForm.window_end_time).toISOString()
                        : null,
                    target_class_ids: duplicateForm.target_class_ids,
                    is_remedial: duplicateMode === 'REMEDIAL',
                    allowed_student_ids: duplicateMode === 'REMEDIAL' ? selectedStudentIds : null,
                    ...(duplicateMode === 'REMEDIAL' ? {
                        remedial_score_policy: remedialPolicy.policy,
                        ...(remedialPolicy.policy === 'CAP' ? { remedial_max_score: remedialPolicy.cap } : {}),
                    } : {})
                }

                const res = await fetch('/api/official-exams/duplicate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                })

                if (res.ok) {
                    newExam = await res.json()
                } else {
                    const err = await res.json()
                    showToast(err.error || 'Gagal menduplikasi ujian', 'error')
                    return
                }
            }

            setShowDuplicate(false)
            showToast(duplicateMode === 'REMEDIAL' ? 'Ujian remedial berhasil dibuat' : 'Ujian berhasil diduplikasi', 'success')
            router.push(`/dashboard/admin/uts-uas/${newExam.id}${duplicateSource === 'ulangan' ? '?type=ulangan' : ''}`)
        } catch (e) {
            showToast('Terjadi kesalahan', 'error')
        } finally {
            setDuplicating(false)
        }
    }

    const toggleClassSelection = (classId: string) => {
        setForm(prev => ({
            ...prev,
            target_class_ids: prev.target_class_ids.includes(classId)
                ? prev.target_class_ids.filter(id => id !== classId)
                : [...prev.target_class_ids, classId]
        }))
    }

    const selectAllClasses = () => {
        setForm(prev => ({
            ...prev,
            target_class_ids: classes.map(c => c.id)
        }))
    }

    const selectByLevel = (level: string) => {
        const levelClasses = classes.filter(c => c.school_level === level)
        setForm(prev => ({
            ...prev,
            target_class_ids: levelClasses.map(c => c.id)
        }))
    }

    const getExamStatus = (exam: OfficialExam) => {
        const now = new Date()
        const startTime = new Date(exam.start_time)
        // Mode jendela: akhir = jam tutup; mode serentak = start + durasi
        const endTime = exam.window_end_time
            ? new Date(exam.window_end_time)
            : new Date(startTime.getTime() + exam.duration_minutes * 60000)

        // Draft dicek sebelum waktu — draft yang jendela waktunya sudah lewat
        // tetap tampil "Draft" (bisa diedit/dilengkapi), bukan "Selesai"
        if (!exam.is_active) return { label: 'Draft', color: 'bg-amber-500/10 text-amber-600 border-amber-200 dark:border-amber-500/20 dark:text-amber-400' }
        if (now < startTime) return { label: 'Terjadwal', color: 'bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-500/20 dark:text-blue-400' }
        if (now >= startTime && now <= endTime) return { label: 'Berlangsung', color: 'bg-green-500/10 text-green-600 border-green-200 dark:border-green-500/20 dark:text-green-400' }
        return { label: 'Selesai', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
    }

    const formatDateTime = (dateString: string) => {
        return new Date(dateString).toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        })
    }

    const filteredExams = exams.filter(e => {
        if (filterType && e.exam_type !== filterType) return false
        if (filterSubject && e.subject?.id !== filterSubject) return false
        return true
    })

    // Ambil object teaching_assignment (array-aware) untuk ulangan
    const ulanganTA = (exam: any) => Array.isArray(exam?.teaching_assignment) ? exam.teaching_assignment[0] : exam?.teaching_assignment

    const filteredUlangan = ulanganExams.filter(e => {
        if (filterSubject && ulanganTA(e)?.subject?.id !== filterSubject) return false
        return true
    })

    // Group classes by school_level for the selection UI
    const classesByLevel = classes.reduce((acc, c) => {
        const level = c.school_level || 'Lainnya'
        if (!acc[level]) acc[level] = []
        acc[level].push(c)
        return acc
    }, {} as Record<string, ClassItem[]>)

    return (
        <div className="space-y-6">
            <PageHeader
                title={labels.ulangan}
                subtitle={`Kelola ${labels.ulangan} harian guru & ujian ${labels.uts}/${labels.uas} sekolah`}
                icon={<div className="text-indigo-500"><GraduationCap className="w-6 h-6" /></div>}
                backHref="/dashboard/admin"
                action={
                    <div className="flex gap-2">
                        {tab === 'ulangan' && (
                            <Button variant="secondary" onClick={() => setShowCreateTeacherExam(true)}>
                                Buat {labels.ulangan} untuk Guru
                            </Button>
                        )}
                        <Button onClick={() => setShowCreate(true)} icon={
                            <div className="text-white"><Plus set="bold" primaryColor="currentColor" size={20} /></div>
                        }>
                            Buat Ujian
                        </Button>
                    </div>
                }
            />

            {/* Tab toggle: UTS/UAS ↔ Ulangan */}
            <div className="flex gap-1 bg-secondary/5 p-1 rounded-xl w-fit">
                <button
                    onClick={() => setTab('utsuas')}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${tab === 'utsuas' ? 'bg-white dark:bg-surface-dark text-primary shadow-sm' : 'text-text-secondary hover:text-text-main dark:hover:text-white'}`}
                >
                    {labels.uts} / {labels.uas}
                </button>
                <button
                    onClick={() => setTab('ulangan')}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${tab === 'ulangan' ? 'bg-white dark:bg-surface-dark text-primary shadow-sm' : 'text-text-secondary hover:text-text-main dark:hover:text-white'}`}
                >
                    {labels.ulangan}
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                {tab === 'utsuas' && (
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="px-4 py-2 bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    >
                        <option value="">Semua Tipe</option>
                        <option value="UTS">{labels.uts}</option>
                        <option value="UAS">{labels.uas}</option>
                    </select>
                )}
                <select
                    value={filterSubject}
                    onChange={(e) => setFilterSubject(e.target.value)}
                    className="px-4 py-2 bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                >
                    <option value="">Semua Mapel</option>
                    {subjects.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
            </div>

            {/* Exam List — UTS/UAS */}
            <div className={tab === 'utsuas' ? '' : 'hidden'}>
            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                </div>
            ) : filteredExams.length === 0 ? (
                <EmptyState
                    icon={<div className="text-indigo-400"><GraduationCap className="w-12 h-12" /></div>}
                    title="Belum Ada Ujian"
                    description={`Buat ujian ${labels.uts} atau ${labels.uas} baru untuk kelas-kelas Anda.`}
                    action={<Button onClick={() => setShowCreate(true)}>Buat Ujian Sekarang</Button>}
                />
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredExams.map((exam) => {
                        const status = getExamStatus(exam)
                        const counts = submissionCounts[exam.id]
                        return (
                            <Card key={exam.id} padding="p-5" className="group hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all">
                                <div className="flex flex-col h-full gap-3">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${status.color}`}>{status.label}</span>
                                                <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${exam.exam_type === 'UTS'
                                                    ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                                                    : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                                                    }`}>
                                                    {exam.exam_type === 'UTS' ? labels.uts : labels.uas}
                                                </span>
                                                {exam.is_remedial && (
                                                    <span className="px-2.5 py-1 bg-gradient-to-r from-orange-400 to-red-500 text-white text-[10px] font-bold rounded-full">
                                                        REMEDIAL
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="font-bold text-text-main dark:text-white text-lg group-hover:text-primary transition-colors line-clamp-2">{exam.title}</h3>
                                        </div>
                                        <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                                            <GraduationCap className="w-5 h-5" />
                                        </div>
                                    </div>

                                    <p className="text-sm text-text-secondary dark:text-zinc-400 line-clamp-1">{exam.description || 'Tidak ada deskripsi'}</p>

                                    <div className="space-y-2 pt-3 border-t border-secondary/10">
                                        <div className="flex items-center justify-between text-xs text-text-secondary">
                                            <span>Mata Pelajaran</span>
                                            <span className="px-2 py-1 bg-primary/10 rounded font-bold text-primary">{exam.subject?.name}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-text-secondary">
                                            <span>Kelas Target</span>
                                            <span className="font-bold text-text-main dark:text-white flex items-center gap-1">
                                                <Users className="w-3.5 h-3.5" /> {exam.target_class_ids?.length || 0} kelas
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-text-secondary">
                                            <span>Soal & Durasi</span>
                                            <div className="flex gap-3">
                                                <span className="flex items-center gap-1 font-medium">
                                                    <FileText className="w-3.5 h-3.5" /> {exam.question_count}
                                                </span>
                                                <span className="flex items-center gap-1 font-medium">
                                                    <Clock className="w-3.5 h-3.5" /> {exam.duration_minutes}m
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-1.5 pt-1 text-xs text-text-secondary">
                                            <div className="flex items-center justify-between">
                                                <span>{exam.window_end_time ? 'Dibuka' : 'Waktu Mulai'}</span>
                                                <span className="font-bold text-text-main dark:text-white">{formatDateTime(exam.start_time)}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span>{exam.window_end_time ? 'Ditutup' : 'Waktu Selesai'}</span>
                                                <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                    <Clock className="w-3.5 h-3.5" />
                                                    {formatDateTime(exam.window_end_time
                                                        ? exam.window_end_time
                                                        : new Date(new Date(exam.start_time).getTime() + exam.duration_minutes * 60000).toISOString())}
                                                </span>
                                            </div>
                                        </div>
                                        {counts && (
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-text-secondary">Pengumpulan</span>
                                                <span className="font-bold text-primary">{counts.submitted} terkumpul</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap gap-2 mt-auto pt-3">
                                        {status.label === 'Berlangsung' && (
                                            <Link href={`/dashboard/admin/uts-uas/${exam.id}/monitor`} className="flex-1 min-w-[120px]">
                                                <Button variant="outline" size="sm" className="w-full justify-center text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-900/20 whitespace-nowrap gap-1.5">
                                                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                                                    Monitor Live
                                                </Button>
                                            </Link>
                                        )}
                                        {status.label === 'Selesai' && (
                                            <Link href={`/dashboard/admin/uts-uas/${exam.id}#hasil`} className="flex-1 min-w-[80px]">
                                                <Button variant="outline" size="sm" className="w-full justify-center text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:border-emerald-900/50 dark:hover:bg-emerald-900/20">
                                                    <BarChart3 className="w-4 h-4 mr-1" /> Hasil
                                                </Button>
                                            </Link>
                                        )}
                                        <Link href={`/dashboard/admin/uts-uas/${exam.id}`} className="flex-1 min-w-[80px]">
                                            <Button variant="outline" size="sm" className="w-full justify-center border-primary/20 text-primary hover:bg-primary/5">
                                                <Edit3 className="w-4 h-4 mr-1" /> Detail
                                            </Button>
                                        </Link>
                                        <Button
                                            variant="outline" size="sm"
                                            onClick={() => handleOpenDuplicate(exam, 'BIASA')}
                                            title="Duplikasi Ujian"
                                            className="text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-blue-200 dark:border-blue-900/30"
                                        >
                                            <Copy className="w-4 h-4" />
                                        </Button>
                                        {status.label === 'Selesai' && !exam.is_remedial && (
                                            <Button
                                                variant="outline" size="sm"
                                                onClick={() => handleOpenDuplicate(exam, 'REMEDIAL')}
                                                title="Buat Remedial"
                                                className="text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 border-orange-200 dark:border-orange-900/30"
                                            >
                                                <RefreshCw className="w-4 h-4" />
                                            </Button>
                                        )}
                                        <Button
                                            variant="outline" size="sm"
                                            onClick={() => handleDelete(exam.id)}
                                            className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200 dark:border-red-900/30"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        )
                    })}
                </div>
            )}
            </div>

            {/* Exam List — Ulangan */}
            <div className={tab === 'ulangan' ? '' : 'hidden'}>
                {ulanganLoading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="w-10 h-10 animate-spin text-primary" />
                    </div>
                ) : filteredUlangan.length === 0 ? (
                    <EmptyState
                        icon={<div className="text-indigo-400"><GraduationCap className="w-12 h-12" /></div>}
                        title={`Belum Ada ${labels.ulangan}`}
                        description={`${labels.ulangan} yang dibuat guru akan muncul di sini untuk dikelola, dimonitor, dan dikoreksi.`}
                    />
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {filteredUlangan.map((exam: any) => {
                            const status = getExamStatus(exam as any)
                            const ta = ulanganTA(exam)
                            const className = (Array.isArray(ta?.class) ? ta?.class[0]?.name : ta?.class?.name) || '-'
                            const teacherName = (Array.isArray(ta?.teacher?.user) ? ta?.teacher?.user[0]?.full_name : ta?.teacher?.user?.full_name) || '-'
                            const subjectName = (Array.isArray(ta?.subject) ? ta?.subject[0]?.name : ta?.subject?.name) || '-'
                            const counts = ulanganCounts[exam.id]
                            return (
                                <Card key={exam.id} padding="p-5" className="group hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all">
                                    <div className="flex flex-col h-full gap-3">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                                    <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${status.color}`}>{status.label}</span>
                                                    <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400">{labels.ulangan}</span>
                                                    {exam.is_remedial && (
                                                        <span className="px-2.5 py-1 bg-gradient-to-r from-orange-400 to-red-500 text-white text-[10px] font-bold rounded-full">
                                                            REMEDIAL
                                                        </span>
                                                    )}
                                                    {exam.pending_publish && (
                                                        <span className="px-2.5 py-1 text-xs font-bold rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">⏳ Review</span>
                                                    )}
                                                </div>
                                                <h3 className="font-bold text-text-main dark:text-white text-lg group-hover:text-primary transition-colors line-clamp-2">{exam.title}</h3>
                                            </div>
                                            <div className="w-10 h-10 rounded-full bg-teal-500/10 flex items-center justify-center text-teal-500">
                                                <FileText className="w-5 h-5" />
                                            </div>
                                        </div>
                                        <div className="space-y-2 pt-3 border-t border-secondary/10">
                                            <div className="flex items-center justify-between text-xs text-text-secondary">
                                                <span>Mata Pelajaran</span>
                                                <span className="px-2 py-1 bg-primary/10 rounded font-bold text-primary">{subjectName}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-text-secondary">
                                                <span>Kelas</span>
                                                <span className="font-bold text-text-main dark:text-white">{className}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-text-secondary">
                                                <span>Guru</span>
                                                <span className="font-bold text-text-main dark:text-white truncate ml-2 text-right">{teacherName}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-text-secondary">
                                                <span>Soal & Durasi</span>
                                                <div className="flex gap-3">
                                                    <span className="flex items-center gap-1 font-medium"><FileText className="w-3.5 h-3.5" /> {exam.question_count}</span>
                                                    <span className="flex items-center gap-1 font-medium"><Clock className="w-3.5 h-3.5" /> {exam.duration_minutes}m</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-text-secondary">
                                                <span>{exam.window_end_time ? 'Dibuka' : 'Mulai'}</span>
                                                <span className="font-bold text-text-main dark:text-white">{formatDateTime(exam.start_time)}</span>
                                            </div>
                                            {exam.window_end_time && (
                                                <div className="flex items-center justify-between text-xs text-text-secondary">
                                                    <span>Ditutup</span>
                                                    <span className="font-bold text-red-500 dark:text-red-400">{formatDateTime(exam.window_end_time)}</span>
                                                </div>
                                            )}
                                            {counts && (
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className="text-text-secondary">Pengumpulan</span>
                                                    <span className="font-bold text-primary">{counts.submitted} terkumpul</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2 mt-auto pt-3">
                                            {status.label === 'Berlangsung' && (
                                                <Link href={`/dashboard/admin/uts-uas/${exam.id}/monitor?type=ulangan`} className="flex-1 min-w-[120px]">
                                                    <Button variant="outline" size="sm" className="w-full justify-center text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-900/20 whitespace-nowrap gap-1.5">
                                                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                                                        Monitor Live
                                                    </Button>
                                                </Link>
                                            )}
                                            {status.label === 'Selesai' && (
                                                <Link href={`/dashboard/admin/uts-uas/${exam.id}?type=ulangan#hasil`} className="flex-1 min-w-[80px]">
                                                    <Button variant="outline" size="sm" className="w-full justify-center text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:border-emerald-900/50 dark:hover:bg-emerald-900/20">
                                                        <BarChart3 className="w-4 h-4 mr-1" /> Hasil
                                                    </Button>
                                                </Link>
                                            )}
                                            <Link href={`/dashboard/admin/uts-uas/${exam.id}?type=ulangan`} className="flex-1 min-w-[80px]">
                                                <Button variant="outline" size="sm" className="w-full justify-center border-primary/20 text-primary hover:bg-primary/5">
                                                    <Edit3 className="w-4 h-4 mr-1" /> Detail
                                                </Button>
                                            </Link>
                                            <Button
                                                variant="outline" size="sm"
                                                onClick={() => handleOpenDuplicate(exam, 'BIASA', 'ulangan')}
                                                title={`Duplikasi ${labels.ulangan}`}
                                                className="text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-blue-200 dark:border-blue-900/30"
                                            >
                                                <Copy className="w-4 h-4" />
                                            </Button>
                                            {status.label === 'Selesai' && !exam.is_remedial && (
                                                <Button
                                                    variant="outline" size="sm"
                                                    onClick={() => handleOpenDuplicate(exam, 'REMEDIAL', 'ulangan')}
                                                    title="Buat Remedial"
                                                    className="text-orange-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 border-orange-200 dark:border-orange-900/30"
                                                >
                                                    <RefreshCw className="w-4 h-4" />
                                                </Button>
                                            )}
                                            <Button
                                                variant="outline" size="sm"
                                                onClick={() => handleDeleteUlangan(exam.id)}
                                                className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200 dark:border-red-900/30"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </Card>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Create Modal */}
            <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Buat Ujian Baru">
                <div className="space-y-4">
                    {/* Exam Type */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe Ujian</label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {(['UTS', 'UAS'] as const).map(type => (
                                <label key={type} className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all font-bold ${form.exam_type === type ? 'border-primary bg-primary/5 text-primary' : 'border-secondary/20 hover:border-primary/50 text-text-main dark:text-white'}`}>
                                    <input type="radio" name="exam_type" checked={form.exam_type === type} onChange={() => setForm({ ...form, exam_type: type })} className="hidden" />
                                    {type === 'UTS' ? <BookOpen className="w-5 h-5" /> : <GraduationCap className="w-5 h-5" />}
                                    {type === 'UTS' ? labels.uts : labels.uas}
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Subject */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Mata Pelajaran</label>
                        <div className="relative">
                            <select
                                value={form.subject_id}
                                onChange={(e) => setForm({ ...form, subject_id: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
                            >
                                <option value="">Pilih mata pelajaran...</option>
                                {subjects.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary"><ChevronDown set="bold" primaryColor="currentColor" size={20} /></div>
                        </div>
                    </div>

                    {/* Title */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Ujian</label>
                        <input
                            type="text"
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            placeholder={`Contoh: ${form.exam_type === 'UTS' ? labels.uts : labels.uas} Matematika Semester 1`}
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Deskripsi (Opsional)</label>
                        <textarea
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            rows={2}
                            placeholder="Materi yang diujikan..."
                        />
                    </div>

                    {/* Target Classes */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">
                            Kelas Target ({form.target_class_ids.length} terpilih)
                        </label>
                        <div className="flex flex-wrap gap-2 mb-3">
                            <button onClick={selectAllClasses} className="text-xs px-3 py-1.5 bg-primary/10 text-primary font-bold rounded-lg hover:bg-primary/20 transition-colors">
                                Pilih Semua
                            </button>
                            {Object.keys(classesByLevel).map(level => (
                                <button key={level} onClick={() => selectByLevel(level)} className="text-xs px-3 py-1.5 bg-secondary/10 text-text-secondary font-bold rounded-lg hover:bg-secondary/20 transition-colors">
                                    Semua {level}
                                </button>
                            ))}
                            <button onClick={() => setForm(prev => ({ ...prev, target_class_ids: [] }))} className="text-xs px-3 py-1.5 bg-red-500/10 text-red-500 font-bold rounded-lg hover:bg-red-500/20 transition-colors">
                                Reset
                            </button>
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-1 pr-2 custom-scrollbar">
                            {Object.entries(classesByLevel).map(([level, levelClasses]) => (
                                <div key={level}>
                                    <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1 mt-2">{level}</p>
                                    <div className="grid grid-cols-3 gap-1.5">
                                        {levelClasses.map(c => {
                                            const selected = form.target_class_ids.includes(c.id)
                                            return (
                                                <button
                                                    key={c.id}
                                                    onClick={() => toggleClassSelection(c.id)}
                                                    className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${selected
                                                        ? 'bg-primary text-white shadow-sm'
                                                        : 'bg-secondary/5 text-text-secondary hover:bg-secondary/10 border border-secondary/10'
                                                        }`}
                                                >
                                                    {c.name}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Schedule */}
                    <div>
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

                    {/* Options */}
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/10">
                            <input type="checkbox" id="randomize_official" checked={form.is_randomized} onChange={(e) => setForm({ ...form, is_randomized: e.target.checked })} className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary" />
                            <label htmlFor="randomize_official" className="text-sm font-medium text-text-main dark:text-white cursor-pointer select-none">Acak urutan soal per siswa</label>
                        </div>
                        <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/10">
                            <input
                                type="checkbox"
                                id="showResultsOfficial"
                                checked={form.show_results_immediately}
                                onChange={(e) => setForm({ ...form, show_results_immediately: e.target.checked })}
                                className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary"
                            />
                            <label htmlFor="showResultsOfficial" className="text-sm font-medium text-text-main dark:text-white cursor-pointer select-none flex flex-col">
                                <span>Tampilkan Hasil Langsung</span>
                                <span className="text-xs text-text-secondary font-normal mt-0.5">Jika dimatikan, siswa baru bisa melihat nilai setelah Anda klik "Bagikan Hasil"</span>
                            </label>
                        </div>
                    </div>

                    {/* Max Violations */}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Maksimal Pelanggaran</label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                value={form.max_violations}
                                onChange={(e) => setForm({ ...form, max_violations: parseInt(e.target.value) || 3 })}
                                className="w-24 px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-center font-bold"
                                min={1} max={10}
                            />
                            <p className="text-xs text-text-secondary">Ujian otomatis dikumpulkan jika siswa melebihi batas pelanggaran (pindah tab, dll)</p>
                        </div>
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-secondary/10 mt-2">
                        <Button variant="secondary" onClick={() => setShowCreate(false)} className="flex-1">Batal</Button>
                        <Button
                            onClick={handleCreate}
                            loading={creating}
                            disabled={!form.subject_id || !form.title || !form.start_time || form.target_class_ids.length === 0 || form.duration_minutes < 5 || (form.schedule_mode === 'window' && !form.window_end_time)}
                            className="flex-1"
                        >
                            Buat & Tambah Soal
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Buat Ulangan untuk Guru (admin) — form senanda form ulangan guru */}
            <Modal
                open={showCreateTeacherExam}
                onClose={() => setShowCreateTeacherExam(false)}
                title={`Buat ${labels.ulangan} untuk Guru`}
            >
                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 bg-teal-500/10 text-teal-700 dark:text-teal-300 rounded-xl text-sm">
                        <BookOpen className="w-5 h-5 flex-shrink-0" />
                        <div>
                            {labels.ulangan} dibuat sebagai <span className="font-bold">DRAFT atas nama guru</span> yang dipilih — langsung muncul di daftar {labels.ulangan} guru terkait. Guru melengkapi soal dan mempublikasikannya.
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Guru <span className="text-red-500">*</span></label>
                        <select
                            value={teacherExamForm.teacher_id}
                            onChange={(e) => handleTeacherExamTeacherChange(e.target.value)}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="">-- Pilih Guru --</option>
                            {teacherOptions.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                    </div>
                    {teacherExamForm.teacher_id && (
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kelas & Mata Pelajaran <span className="text-red-500">*</span></label>
                            {teacherTAs.length === 0 ? (
                                <p className="text-sm text-text-secondary p-3 bg-secondary/5 border border-secondary/20 rounded-xl">
                                    Guru ini belum memiliki penugasan mengajar di tahun ajaran aktif.
                                </p>
                            ) : (
                                <ClassChipsSelector
                                    assignments={teacherTAs.map(ta => ({ id: ta.id, subject: ta.subject, class: ta.class }))}
                                    selectedIds={teacherExamForm.teaching_assignment_ids}
                                    onChange={(ids) => setTeacherExamForm({ ...teacherExamForm, teaching_assignment_ids: ids })}
                                    disabled={teacherTAs.length === 0}
                                />
                            )}
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul {labels.ulangan} <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            value={teacherExamForm.title}
                            onChange={(e) => setTeacherExamForm({ ...teacherExamForm, title: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder={`Contoh: ${labels.ulangan} Harian Bab 2`}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Deskripsi (Opsional)</label>
                        <textarea
                            value={teacherExamForm.description}
                            onChange={(e) => setTeacherExamForm({ ...teacherExamForm, description: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            rows={2}
                            placeholder="Materi yang diujikan..."
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jadwal Pengerjaan</label>
                        <TimeWindowFields
                            value={{
                                mode: teacherExamForm.schedule_mode,
                                start_time: teacherExamForm.start_time,
                                window_end_time: teacherExamForm.window_end_time,
                                duration_minutes: String(teacherExamForm.duration_minutes)
                            }}
                            onChange={(v) => setTeacherExamForm({
                                ...teacherExamForm,
                                schedule_mode: v.mode,
                                start_time: v.start_time,
                                duration_minutes: v.duration_minutes ? parseInt(v.duration_minutes, 10) || 0 : 0,
                                window_end_time: v.mode === 'window' ? v.window_end_time : ''
                            })}
                            durationRequired
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Max Pelanggaran (auto-submit)</label>
                        <input
                            type="number"
                            value={teacherExamForm.max_violations}
                            onChange={(e) => setTeacherExamForm({ ...teacherExamForm, max_violations: parseInt(e.target.value) || 3 })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            min={1}
                            max={10}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/10">
                            <input
                                type="checkbox"
                                id="teacherExamRandomize"
                                checked={teacherExamForm.is_randomized}
                                onChange={(e) => setTeacherExamForm({ ...teacherExamForm, is_randomized: e.target.checked })}
                                className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary"
                            />
                            <label htmlFor="teacherExamRandomize" className="text-sm font-medium text-text-main dark:text-white cursor-pointer select-none">Acak urutan soal per siswa</label>
                        </div>
                        <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-xl border border-secondary/10">
                            <input
                                type="checkbox"
                                id="teacherExamShowResults"
                                checked={teacherExamForm.show_results_immediately}
                                onChange={(e) => setTeacherExamForm({ ...teacherExamForm, show_results_immediately: e.target.checked })}
                                className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary"
                            />
                            <label htmlFor="teacherExamShowResults" className="text-sm font-medium text-text-main dark:text-white cursor-pointer select-none flex flex-col">
                                <span>Tampilkan Hasil Langsung</span>
                                <span className="text-xs text-text-secondary font-normal mt-0.5">Jika dimatikan, siswa baru bisa melihat nilai setelah guru klik "Bagikan Hasil"</span>
                            </label>
                        </div>
                    </div>
                    <div className="flex gap-3 pt-4 border-t border-secondary/10">
                        <Button variant="secondary" onClick={() => setShowCreateTeacherExam(false)} className="flex-1">Batal</Button>
                        <Button
                            onClick={handleCreateTeacherExam}
                            loading={creatingTeacherExam}
                            disabled={creatingTeacherExam || !teacherExamForm.teacher_id || teacherExamForm.teaching_assignment_ids.length === 0 || !teacherExamForm.title || !teacherExamForm.start_time || teacherExamForm.duration_minutes < 5 || (teacherExamForm.schedule_mode === 'window' && !teacherExamForm.window_end_time)}
                            className="flex-1"
                        >
                            Buat {labels.ulangan} (Draft)
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Duplicate & Remedial Modal */}
            <Modal open={showDuplicate} onClose={() => setShowDuplicate(false)} title={duplicateMode === 'REMEDIAL' ? "Buat Ujian Remedial" : "Duplikasi Ujian"}>
                {duplicateExam && (
                    <div className="space-y-5">
                        <div className="flex items-center gap-3 p-3 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 rounded-xl">
                            <Copy className="w-5 h-5 flex-shrink-0" />
                            <div className="text-sm">
                                <div>Sumber: <span className="font-bold">{duplicateExam.title}</span>{duplicateSource === 'ulangan' && <span className="ml-1 text-xs">({labels.ulangan})</span>}</div>
                                <div className="text-xs opacity-80">
                                    {duplicateSource === 'ulangan' && duplicateMode === 'REMEDIAL' && ulanganRemedialMethod === 'BARU'
                                        ? `${labels.ulangan} baru akan dibuat dengan soal kosong`
                                        : `${duplicateExam.question_count} soal akan disalin otomatis`}
                                </div>
                            </div>
                        </div>

                        {/* Title */}
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Ujian Baru</label>
                            <input
                                type="text"
                                value={duplicateForm.title}
                                onChange={(e) => setDuplicateForm({ ...duplicateForm, title: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                placeholder="Judul ujian..."
                            />
                        </div>

                        {/* Schedule */}
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jadwal Pengerjaan</label>
                            <TimeWindowFields
                                value={{
                                    mode: duplicateForm.schedule_mode,
                                    start_time: duplicateForm.start_time,
                                    window_end_time: duplicateForm.window_end_time,
                                    duration_minutes: String(duplicateForm.duration_minutes)
                                }}
                                onChange={(v) => setDuplicateForm({
                                    ...duplicateForm,
                                    schedule_mode: v.mode,
                                    start_time: v.start_time,
                                    duration_minutes: v.duration_minutes ? parseInt(v.duration_minutes, 10) || 0 : 0,
                                    window_end_time: v.mode === 'window' ? v.window_end_time : ''
                                })}
                                durationRequired
                            />
                        </div>

                        {/* Remedial Student Selection */}
                        {duplicateMode === 'REMEDIAL' && (
                            <div className="pt-2 border-t border-secondary/20">
                                {duplicateSource === 'ulangan' && (
                                    <div className="mb-3">
                                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Soal Remedial</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setUlanganRemedialMethod('ASLI')}
                                                className={`px-3 py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${ulanganRemedialMethod === 'ASLI' ? 'border-primary bg-primary/5 text-primary' : 'border-secondary/20 text-text-main dark:text-white hover:border-primary/50'}`}
                                            >
                                                Soal Asli (disalin)
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setUlanganRemedialMethod('BARU')}
                                                className={`px-3 py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${ulanganRemedialMethod === 'BARU' ? 'border-primary bg-primary/5 text-primary' : 'border-secondary/20 text-text-main dark:text-white hover:border-primary/50'}`}
                                            >
                                                Soal Baru (kosong)
                                            </button>
                                        </div>
                                    </div>
                                )}
                                <div className="mb-4">
                                    <RemedialPolicyFields
                                        value={remedialPolicy}
                                        onChange={setRemedialPolicy}
                                        capPlaceholder={duplicateExam?.subject?.kkm || 75}
                                    />
                                </div>
                                <div className="flex items-center justify-between mb-3">
                                    <label className="block text-sm font-bold text-text-main dark:text-white">Pilih Siswa Remedial</label>
                                    <div className="text-xs text-text-secondary">
                                        <span className="font-bold text-primary">{selectedStudentIds.length}</span> dari {remedialStudents.length} siswa
                                    </div>
                                </div>
                                
                                {remedialLoading ? (
                                    <div className="flex items-center justify-center py-6">
                                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                    </div>
                                ) : remedialStudents.length === 0 ? (
                                    <div className="p-4 bg-secondary/5 rounded-xl text-center text-sm text-text-secondary">
                                        Belum ada data pengumpulan untuk ujian ini.
                                    </div>
                                ) : (
                                    <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                        {remedialStudents.map(student => (
                                            <label key={student.id} className="flex items-center gap-3 p-3 rounded-xl border border-secondary/20 hover:border-primary/30 cursor-pointer transition-colors bg-white dark:bg-surface-dark">
                                                <input 
                                                    type="checkbox"
                                                    checked={selectedStudentIds.includes(student.id)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) setSelectedStudentIds(prev => [...prev, student.id])
                                                        else setSelectedStudentIds(prev => prev.filter(id => id !== student.id))
                                                    }}
                                                    className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-bold text-sm text-text-main dark:text-white truncate">{student.name}</div>
                                                    <div className="text-xs text-text-secondary">NIS: {student.nis}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className={`font-bold text-sm ${student.needsRemedial ? 'text-red-500' : 'text-emerald-500'}`}>
                                                        {student.score} / {student.max_score}
                                                    </div>
                                                    <div className="text-[10px] text-text-secondary">Nilai: {student.pct.toFixed(1)}</div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                )}
                                <div className="mt-2 text-xs text-text-secondary p-2 bg-primary/5 text-primary rounded-lg">
                                    <span className="font-bold">Info:</span> Siswa yang dipilih akan melihat soal ini di dashboard mereka. Sistem akan secara otomatis mengambil nilai tertinggi antara ujian asli dan remedial.
                                </div>
                            </div>
                        )}

                        <div className="flex gap-3 pt-4 border-t border-secondary/10">
                            <Button variant="secondary" onClick={() => setShowDuplicate(false)} className="flex-1">Batal</Button>
                            <Button
                                onClick={handleDuplicate}
                                loading={duplicating}
                                disabled={!duplicateForm.title || !duplicateForm.start_time || (duplicateMode === 'REMEDIAL' && selectedStudentIds.length === 0)}
                                className="flex-1"
                            >
                                Duplikasi & Buat Ujian
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Toast */}
            {toast && (
                <div className={`fixed bottom-6 right-6 z-[200] px-5 py-3 rounded-xl shadow-2xl text-white font-medium text-sm flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-300 ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
                    <span>{toast.type === 'success' ? '✅' : '❌'}</span>
                    {toast.message}
                    <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
                </div>
            )}

            {/* Confirm Dialog */}
            {confirmDialog && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-white dark:bg-surface-dark rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="w-16 h-16 mx-auto bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mb-4">
                            <Trash2 className="w-7 h-7" />
                        </div>
                        <h3 className="text-lg font-bold text-text-main dark:text-white mb-2">{confirmDialog.title}</h3>
                        <p className="text-text-secondary mb-6">{confirmDialog.message}</p>
                        <div className="flex gap-3">
                            <button onClick={() => setConfirmDialog(null)} className="flex-1 py-3 bg-gray-200 dark:bg-slate-700 text-text-main dark:text-white rounded-xl font-bold hover:bg-gray-300 transition-colors">Batal</button>
                            <button onClick={confirmDialog.onConfirm} className="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors">Hapus</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
