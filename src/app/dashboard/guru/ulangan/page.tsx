'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Modal, PageHeader, Button } from '@/components/ui'
import type { DropdownMenuItem } from '@/components/ui/DropdownMenu'
import Card from '@/components/ui/Card'
import DailyExamCard from '@/components/exam/DailyExamCard'
import OfficialExamCard from '@/components/exam/OfficialExamCard'
import { getExamStatus, getOfficialExamStatus } from '@/lib/exam'
import { groupExamsByBatch, type ExamBatchGroup } from '@/lib/examBatchGrouping'
import ShowDraftsToggle from '@/components/ShowDraftsToggle'
import ClassChipsSelector from '@/components/ClassChipsSelector'
import TimeWindowFields from '@/components/TimeWindowFields'
import { useServerTimeOffset } from '@/hooks/useServerTimeOffset'
import { RemedialPolicyValue } from '@/components/RemedialPolicyFields'
import DuplicateRemedialModal from '@/components/exam/DuplicateRemedialModal'
import { useDuplicateGuard } from '@/components/exam/useDuplicateGuard'
import { useDuplicate409Handler } from '@/components/exam/useDuplicate409Handler'
import { useAuth } from '@/contexts/AuthContext'
import { useSchoolLabels } from '@/contexts/LabelsContext'
import { useIncrementalList } from '@/hooks/useIncrementalList'
import { labelForGradeType } from '@/lib/labels'
import { TimeCircle as Clock, Plus, Lock, ShieldDone, Graph, Edit, Document } from 'react-iconly'
import { Loader2, RefreshCw, GraduationCap, BookOpen, Copy, Trash2, Activity } from 'lucide-react'

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
    is_remedial?: boolean | null
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
    is_remedial?: boolean | null
    question_count: number
    target_class_ids: string[]
    subject: { id: string; name: string; kkm?: number }
    created_by?: string | null
    creator_role?: string | null
    created_at: string
}

interface TeachingAssignment {
    id: string
    subject: { id: string; name: string }
    class: { id: string; name: string }
}

// Embed PostgREST bisa array (FK ambigu) — ambil elemen pertama
const first = (v: unknown) => Array.isArray(v) ? v[0] : v
const taOf = (e: Exam) => first(e.teaching_assignment) as Exam['teaching_assignment'] | undefined
const classIdOf = (e: Exam) => first(taOf(e)?.class)?.id as string | undefined
const subjectIdOf = (e: Exam) => first(taOf(e)?.subject)?.id as string | undefined

export default function GuruUlanganPage() {
    const { user } = useAuth()
    const router = useRouter()
    const labels = useSchoolLabels()
    const { now: serverNow, sync } = useServerTimeOffset()
    const [exams, setExams] = useState<Exam[]>([])
    const [teachingAssignments, setTeachingAssignments] = useState<TeachingAssignment[]>([])
    const [submissionCounts, setSubmissionCounts] = useState<Record<string, number>>({})
    const [pendingGradingCounts, setPendingGradingCounts] = useState<Record<string, number>>({})
    const [studentCounts, setStudentCounts] = useState<Record<string, number>>({})
    const [officialExams, setOfficialExams] = useState<OfficialExam[]>([])
    const [loading, setLoading] = useState(true)
    const [returnedExams, setReturnedExams] = useState<{examId: string, title: string, returnedCount: number}[]>([])
    const [aiReviewEnabled, setAiReviewEnabled] = useState(true)
    // Filter kelas di list ulangan (batch multi-kelas + filter manual guru)
    const [classFilter, setClassFilter] = useState('')
    // Toggle "Tampilkan Draft" — satu kontrol untuk ulangan + UTS/UAS.
    // Default false: draft (belum publish / under review) disembunyikan.
    const [showDrafts, setShowDrafts] = useState(false)
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
        is_randomized: false,
        max_violations: 3,
        show_results_immediately: true
    })
    // Jenis yang dibuat dari satu pintu form ini: ulangan harian atau UTS/UAS resmi
    const [examKind, setExamKind] = useState<'ULANGAN' | 'UTS' | 'UAS'>('ULANGAN')

    // ── Unified Duplicate & Remedial state (mirrors admin uts-uas/page.tsx) ──
    // Satu modal shared component menangani 4 skenario: ulangan/official × BIASA/REMEDIAL.
    const [dupShow, setDupShow] = useState(false)
    const [dupMode, setDupMode] = useState<'BIASA' | 'REMEDIAL'>('BIASA')
    const [dupSource, setDupSource] = useState<'official' | 'ulangan'>('official')
    const [dupExam, setDupExam] = useState<any>(null)
    const [dupMembers, setDupMembers] = useState<any[]>([])
    const [dupForm, setDupForm] = useState({
        title: '',
        start_time: '',
        duration_minutes: 90,
        schedule_mode: 'sync' as 'sync' | 'window',
        window_end_time: '',
        target_class_ids: [] as string[]
    })
    const [dupRemedialMethod, setDupRemedialMethod] = useState<'ASLI' | 'BARU'>('ASLI')
    const [dupRemedialPolicy, setDupRemedialPolicy] = useState<RemedialPolicyValue>({ policy: 'HIGHEST', cap: 75 })
    const [dupRemedialStudents, setDupRemedialStudents] = useState<any[]>([])
    const [dupSelectedStudentIds, setDupSelectedStudentIds] = useState<string[]>([])
    const [dupRemedialLoading, setDupRemedialLoading] = useState(false)
    const [dupSubmitting, setDupSubmitting] = useState(false)
    const [dupKkm, setDupKkm] = useState(75)
    // Guard duplikat-judul (pre-flight + dialog konfirmasi) — shared guru+admin.
    const dupGuard = useDuplicateGuard(labels.ulangan)
    // Handler 409 DUPLICATE_TITLE dari POST official-exams (UTS/UAS) — server guard
    // sebagai PRIMARY UX (pre-flight belum cover official_exams). Reuse DuplicateConfirmDialog.
    const dup409 = useDuplicate409Handler(labels.uts || labels.uas || 'UTS/UAS')
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
            // Wave-1 paralel penuh: semua fetch mandiri (grading-overview tidak
            // tergantung apa pun — dulu dieksekusi SETELAH 3 tahap waterfall,
            // menambah satu round-trip penuh di akhir).
            const [examsRes, myAssignmentsRes, yearsRes, officialExamsRes, returnedRes, settingsRes, gradingRes] = await Promise.all([
                fetch('/api/exams'),
                fetch('/api/my-teaching-assignments'),
                fetch('/api/academic-years'),
                fetch('/api/official-exams'),
                fetch('/api/exams/returned-counts'),
                fetch('/api/school-settings'),
                fetch('/api/dashboard/guru/grading-overview')
            ])
            sync(examsRes)

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
                    // status=ACTIVE: hitungan "N siswa" kelas = anggota SAAT INI —
                    // siswa yang pindah kelas tidak terhitung dobel di dua kelas.
                    // Satu request GROUP BY (RPC) — pengganti roster 1.000+ siswa
                    // full-embed yang hanya dipakai untuk counts[classId]++.
                    const countsRes = await fetch(`/api/students/class-counts?enrollment_year_id=${activeYear.id}`)
                    const countsData = await countsRes.json()
                    setStudentCounts(countsData && !Array.isArray(countsData) ? countsData : {})
                } catch (e) {
                    console.error('Error fetching class student counts:', e)
                }
            }

            setTeachingAssignments(myAssignments)

            // Exam milik saya = TA anchor saya ATAU co-teacher (mapel+kelas yang
            // saya ampou) — paritas filter server GET /api/exams (co-teaching).
            const myExams = examsData.filter((e: Exam) => {
                const ta = first(e.teaching_assignment) as any
                const subjId = first(ta?.subject)?.id
                const classId = first(ta?.class)?.id
                return myAssignments.some((ta2: TeachingAssignment) =>
                    ta2.id === ta?.id || (ta2.subject?.id === subjId && ta2.class?.id === classId)
                )
            })
            setExams(myExams)

            // Ringkasan koreksi dari wave-1 (satu request, cache server 30 dtk).
            // Definisi sama dengan sebelumnya: submitted = is_submitted,
            // pending = is_submitted && !is_graded.
            const subCounts: Record<string, number> = {}
            const pendingCounts: Record<string, number> = {}
            try {
                if (gradingRes.ok) {
                    const data = await gradingRes.json()
                    const items = Array.isArray(data?.items) ? data.items : []
                    items.forEach((it: any) => {
                        subCounts[it.id] = it.submitted_count || 0
                        pendingCounts[it.id] = it.ungraded_count || 0
                    })
                }
            } catch { }
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
            is_randomized: false,
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
            alert(`Untuk ${labels.uts}/${labels.uas}, pilih kelas dari SATU mata pelajaran yang sama.`)
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
                if (dup409.handle409(err, async () => {
                    // Retry dgn force_duplicate: true
                    const retryRes = await fetch('/api/official-exams', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            exam_type: examKind, title: form.title, description: form.description,
                            subject_id: subjectIds[0], start_time: new Date(form.start_time).toISOString(),
                            duration_minutes: form.duration_minutes,
                            window_end_time: form.schedule_mode === 'window' && form.window_end_time ? new Date(form.window_end_time).toISOString() : null,
                            is_randomized: form.is_randomized, max_violations: form.max_violations,
                            target_class_ids: targetClassIds, show_results_immediately: form.show_results_immediately,
                            force_duplicate: true,
                        })
                    })
                    if (retryRes.ok) {
                        setShowCreate(false)
                        resetCreateForm()
                        const created = await retryRes.json()
                        router.push(`/dashboard/guru/uts-uas/${created.id}`)
                    } else {
                        const retryErr = await retryRes.json().catch(() => ({}))
                        alert(retryErr?.error || 'Gagal membuat ujian setelah bypass duplikat.')
                    }
                })) return
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
            // Pre-flight cek duplikat-judul per TA (adil: guru & admin sama).
            // Pakai exams in-memory (nol fetch tambahan) — list page sudah punya data.
            // setCreating(true) SEBELUM guard agar tombol disable selama pre-flight
            // (anti double-click yang justru bikin duplikat).
            const { proceed, forceDuplicate } = await dupGuard.guard(form.teaching_assignment_ids, form.title, exams)
            if (!proceed) return
            const localStart = new Date(form.start_time)
            const utcStart = localStart.toISOString()
            // Satu batch multi-kelas diikat batch_id di DB — tahan tab tertutup
            const batchId = form.teaching_assignment_ids.length > 1 ? crypto.randomUUID() : null
            const payload = {
                ...form,
                start_time: utcStart,
                window_end_time: form.schedule_mode === 'window' && form.window_end_time ? new Date(form.window_end_time).toISOString() : null,
                batch_id: batchId,
                force_duplicate: forceDuplicate,
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
                alert(err.error || `Gagal membuat ${labels.ulangan.toLowerCase()}. Silakan coba lagi.`)
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
                    alert(`${labels.ulangan} utama berhasil dibuat. ${siblingIds.length} kelas tambahan berhasil, ${failedClassNames.length} GAGAL: ${failedClassNames.join(', ')}. Buat ulang ${labels.ulangan.toLowerCase()} untuk kelas tersebut.`)
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

    const handleDelete = async (exam: Exam, group?: ExamBatchGroup<Exam>) => {
        const members = group?.isBatch ? group.members : [exam]
        if (members.length > 1) {
            const classNames = members
                .map(m => first(taOf(m)?.class)?.name)
                .filter(Boolean)
                .join(', ')
            if (!confirm(`Hapus ${labels.ulangan.toLowerCase()} ini dari ${members.length} kelas (${classNames})? Semua soal & hasil pengerjaan siswa di semua kelas ikut terhapus.`)) return
        } else {
            if (!confirm(`Hapus ${labels.ulangan.toLowerCase()} ini?`)) return
        }
        const failedClasses: string[] = []
        await Promise.all(members.map(async (m) => {
            try {
                const res = await fetch(`/api/exams/${m.id}`, { method: 'DELETE' })
                if (!res.ok) {
                    const err = await res.json().catch(() => null)
                    const className = first(taOf(m)?.class)?.name || m.title
                    failedClasses.push(err?.error ? `${className} (${err.error})` : className)
                }
            } catch {
                failedClasses.push(first(taOf(m)?.class)?.name || m.title)
            }
        }))
        if (failedClasses.length > 0) {
            alert(`${members.length - failedClasses.length} kelas berhasil dihapus. GAGAL (${failedClasses.length}): ${failedClasses.join(', ')}. Coba ulangi untuk kelas tersebut.`)
        }
        fetchData()
    }

    const handleDeleteOfficial = async (id: string) => {
        if (!confirm(`Hapus ujian ${labels.uts}/${labels.uas} ini? Semua soal & hasil pengerjaan siswa ikut terhapus.`)) return
        const res = await fetch(`/api/official-exams/${id}`, { method: 'DELETE' })
        if (!res.ok) {
            const data = await res.json().catch(() => null)
            alert(data?.error || 'Gagal menghapus ujian.')
        }
        fetchData()
    }

    // ── Unified open handler (mirrors admin handleOpenDuplicate) ──
    // Satu pintu untuk 4 skenario: ulangan/official × BIASA/REMEDIAL.
    const openDuplicate = async (
        exam: any,
        mode: 'BIASA' | 'REMEDIAL',
        source: 'official' | 'ulangan' = 'official',
        group?: ExamBatchGroup<any>
    ) => {
        setDupExam(exam)
        setDupSource(source)
        setDupMode(mode)
        setDupRemedialStudents([])
        setDupSelectedStudentIds([])
        setDupRemedialMethod('ASLI')
        // Resolve KKM awal: official = exam.subject.kkm, ulangan = TA subject kkm
        const initialKkm = source === 'ulangan'
            ? (first(taOf(exam)?.subject) as any)?.kkm || 75
            : exam.subject?.kkm || 75
        setDupKkm(initialKkm)
        setDupRemedialPolicy({ policy: 'HIGHEST', cap: initialKkm })

        // Filter members untuk ulangan: hanya kelas yang guru co-teach (mapel
        // yang sama). Admin tidak perlu filter (admin manage semua kelas), tapi
        // halaman ini khusus guru. Tanpa filter ini:
        // - BIASA: prefill ghost IDs (kelas tidak terlihat di selector tapi ada
        //   di state → di-skip diam-diam saat submit)
        // - REMEDIAL: guru lihat siswa dari kelas orang lain (data exposure) +
        //   remedial ditolak 403 saat submit untuk kelas yang tidak dia ajar
        const allMembers = group?.isBatch ? group.members : [exam]
        const srcSubjectId = source === 'ulangan' ? subjectIdOf(exam) : undefined
        const effectiveMembers = source === 'ulangan' && srcSubjectId
            ? allMembers.filter(m => {
                const mTa = taOf(m as Exam)
                const mClass = first(mTa?.class) as any
                if (!mClass?.id) return false
                return teachingAssignments.some((ta: any) => {
                    const subj = Array.isArray(ta.subject) ? ta.subject[0] : ta.subject
                    const cl = Array.isArray(ta.class) ? ta.class[0] : ta.class
                    return subj?.id === srcSubjectId && cl?.id === mClass.id
                })
            })
            : allMembers
        setDupMembers(effectiveMembers)

        const pad = (n: number) => n.toString().padStart(2, '0')
        const now = new Date()
        now.setDate(now.getDate() + 1)
        now.setHours(8, 0, 0, 0)
        const defaultTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`

        // Prefill target class IDs
        let prefillTargetIds: string[] = []
        if (source === 'official') {
            // Official: irisan kelas diajar guru × kelas target ujian
            const taughtClassIds = new Set(
                teachingAssignments.map((ta: any) => {
                    const cls = Array.isArray(ta.class) ? ta.class[0] : ta.class
                    return cls?.id
                }).filter(Boolean)
            )
            prefillTargetIds = ((exam.target_class_ids as string[]) || []).filter(cid => taughtClassIds.has(cid))
        } else {
            // Ulangan: kelas dari member batch yang guru co-teach (efektif)
            prefillTargetIds = effectiveMembers
                .map(m => first(taOf(m as Exam)?.class)?.id)
                .filter((id): id is string => !!id)
        }

        setDupForm({
            title: mode === 'REMEDIAL' ? `Remedial ${exam.title}` : `[Copy] ${exam.title}`,
            start_time: defaultTime,
            duration_minutes: exam.duration_minutes,
            schedule_mode: exam.window_end_time ? 'window' : 'sync',
            window_end_time: '',
            target_class_ids: prefillTargetIds
        })

        setDupShow(true)

        if (mode === 'REMEDIAL') {
            setDupRemedialLoading(true)
            try {
                if (source === 'ulangan') {
                    // Ulangan: fetch students dari member yang guru co-teach saja
                    // (effectiveMembers sudah di-filter di atas). Tiap siswa
                    // ditandai memberExamId untuk grouping saat submit.
                    const members = effectiveMembers as any[]
                    const ta = taOf(exam)
                    const subject = first(ta?.subject)
                    const yearId = (ta as any)?.academic_year_id || ''
                    const baseKkm = subject?.kkm || 75
                    let granularKkms: any[] = []
                    try {
                        const kkmRes = await fetch(`/api/subject-kkm?subject_id=${subject?.id}`)
                        if (kkmRes.ok) granularKkms = await kkmRes.json()
                    } catch (e) {
                        console.error('Failed to fetch granular KKM', e)
                    }
                    const resolveKkm = (cls: any) => {
                        if (cls?.school_level && cls?.grade_level) {
                            const granular = granularKkms.find((k: any) => k.school_level === cls.school_level && k.grade_level === cls.grade_level)
                            if (granular) return granular.kkm
                        }
                        return baseKkm
                    }
                    // Update dupKkm + policy cap dengan KKM yang di-resolve (paritas
                    // kode guru lama — loadRemedialMember set cap = kkm). Ambil KKM
                    // kelas pertama yang punya granular; fallback baseKkm.
                    const firstResolvedKkm = members.length > 0
                        ? resolveKkm(first(taOf(members[0])?.class) as any)
                        : baseKkm
                    setDupKkm(firstResolvedKkm)
                    setDupRemedialPolicy(prev => ({ ...prev, cap: firstResolvedKkm }))
                    const lists = await Promise.all(members.map(async (m: any) => {
                        const mTa = taOf(m)
                        const cls = first(mTa?.class) as any
                        if (!cls?.id) return []
                        const examStart = m.start_time ? `&as_of=${encodeURIComponent(m.start_time)}` : ''
                        const [rosterRes, subsRes] = await Promise.all([
                            fetch(`/api/students?class_id=${cls.id}&enrollment_year_id=${yearId}${examStart}`),
                            fetch(`/api/exam-submissions?exam_id=${m.id}`)
                        ])
                        const roster = rosterRes.ok ? await rosterRes.json() : []
                        const subs = subsRes.ok ? await subsRes.json() : []
                        const scoreByStudent = new Map<string, any>()
                        ;(Array.isArray(subs) ? subs : []).forEach((sub) => {
                            const sid = sub.student?.id || sub.student_id
                            if (sid && !scoreByStudent.has(sid)) scoreByStudent.set(sid, sub)
                        })
                        const kkm = resolveKkm(cls)
                        return (Array.isArray(roster) ? roster : []).map((s) => {
                            const sub = scoreByStudent.get(s.id)
                            const score = sub?.is_submitted ? (sub.total_score || 0) : 0
                            const maxScore = sub?.is_submitted ? (sub.max_score || 1) : 1
                            const pct = score / maxScore * 100
                            return {
                                id: s.id,
                                name: s.user?.full_name || '',
                                nis: s.nis || '',
                                score,
                                max_score: maxScore,
                                pct,
                                needsRemedial: pct < kkm,
                                className: cls.name,
                                memberExamId: m.id,
                                hasSubmitted: !!sub?.is_submitted,
                            }
                        })
                    }))
                    const studentsList = lists.flat()
                    setDupRemedialStudents(studentsList)
                    setDupSelectedStudentIds(studentsList.filter(s => s.needsRemedial).map(s => s.id))
                } else {
                    // Official: fetch dari official-exam-submissions (guru-scoped)
                    const res = await fetch(`/api/official-exam-submissions?exam_id=${exam.id}`)
                    if (res.ok) {
                        const submissions = await res.json()
                        const baseKkm = exam.subject?.kkm || 75
                        let granularKkms: any[] = []
                        try {
                            const kkmRes = await fetch(`/api/subject-kkm?subject_id=${exam.subject?.id}`)
                            if (kkmRes.ok) granularKkms = await kkmRes.json()
                        } catch (e) {
                            console.error('Failed to fetch granular KKM', e)
                        }
                        // Update dupKkm + policy cap dengan KKM granular pertama
                        // yang cocok (paritas kode guru lama — openOfficialRemedialModal).
                        const firstSub = (Array.isArray(submissions) ? submissions : [])[0]
                        const firstClassLevel = firstSub?.student?.class?.school_level
                        const firstGradeLevel = firstSub?.student?.class?.grade_level
                        const firstGranular = firstClassLevel && firstGradeLevel
                            ? granularKkms.find((k: any) => k.school_level === firstClassLevel && k.grade_level === firstGradeLevel)
                            : null
                        const resolvedKkm = firstGranular?.kkm || baseKkm
                        setDupKkm(resolvedKkm)
                        setDupRemedialPolicy(prev => ({ ...prev, cap: resolvedKkm }))
                        const studentsList = (Array.isArray(submissions) ? submissions : []).map((sub: any) => {
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
                                name: sub.student?.user?.full_name || '-',
                                nis: sub.student?.nis || '-',
                                score: sub.total_score,
                                max_score: sub.max_score,
                                pct,
                                needsRemedial: pct < studentKkm,
                                hasSubmitted: !!sub.is_submitted,
                            }
                        }).filter((s: any) => s.id)
                        studentsList.sort((a: any, b: any) => a.score - b.score)
                        setDupRemedialStudents(studentsList)
                        setDupSelectedStudentIds(studentsList.filter((s: any) => s.needsRemedial).map((s: any) => s.id))
                    }
                }
            } catch (err) {
                console.error('Failed to fetch remedial students', err)
            } finally {
                setDupRemedialLoading(false)
            }
        }
    }

    // ── Unified submit handler (mirrors admin handleDuplicate) ──
    const handleDuplicateSubmit = async () => {
        if (!dupExam || !dupForm.title || !dupForm.start_time) return
        setDupSubmitting(true)
        try {
            const localDate = new Date(dupForm.start_time)
            let newExam: any = null

            if (dupSource === 'ulangan') {
                if (dupMode === 'REMEDIAL') {
                    // Ulangan REMEDIAL: group siswa per memberExamId, loop per member
                    const selected = dupRemedialStudents.filter(s => dupSelectedStudentIds.includes(s.id))
                    const byMember = new Map<string, any[]>()
                    selected.forEach(s => {
                        const key = s.memberExamId || dupExam.id
                        if (!byMember.has(key)) byMember.set(key, [])
                        byMember.get(key)!.push(s)
                    })
                    const targets = dupMembers.filter(m => (byMember.get(m.id) || []).length > 0)
                    if (targets.length === 0) {
                        alert('Pilih minimal satu siswa remedial')
                        return
                    }
                    const remedialBatchId = targets.length > 1 ? crypto.randomUUID() : null
                    const results = await Promise.allSettled(targets.map(m => {
                        const ta = taOf(m)
                        const payload: any = {
                            teaching_assignment_id: ta?.id,
                            title: dupForm.title,
                            description: dupExam.description,
                            start_time: localDate.toISOString(),
                            duration_minutes: dupForm.duration_minutes,
                            window_end_time: dupForm.schedule_mode === 'window' && dupForm.window_end_time
                                ? new Date(dupForm.window_end_time).toISOString() : null,
                            is_randomized: dupExam.is_randomized,
                            max_violations: dupExam.max_violations,
                            show_results_immediately: dupExam.show_results_immediately ?? true,
                            is_remedial: true,
                            remedial_for_id: m.id,
                            allowed_student_ids: (byMember.get(m.id) || []).map(s => s.id),
                            remedial_score_policy: dupRemedialPolicy.policy,
                            ...(dupRemedialPolicy.policy === 'CAP' ? { remedial_max_score: dupRemedialPolicy.cap } : {}),
                            duplicate_questions: dupRemedialMethod === 'ASLI',
                            batch_id: remedialBatchId
                        }
                        return fetch('/api/exams', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
                    }))
                    const okResults = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
                    if (okResults.length === 0) {
                        alert('Gagal membuat remedial. Silakan coba lagi.')
                        return
                    }
                    newExam = okResults[0].value
                    if (okResults.length < targets.length) {
                        alert(`Remedial dibuat di ${okResults.length} kelas; GAGAL di ${targets.length - okResults.length} kelas — ulangi dari daftar`)
                    } else {
                        alert(`Remedial berhasil dibuat di ${okResults.length} kelas.`)
                    }
                } else {
                    // Ulangan BIASA: loop per target class, resolve TA, POST with duplicate_from_exam_id
                    const subjectId = subjectIdOf(dupExam)
                    const matched = dupForm.target_class_ids.map(classId => {
                        const tas = teachingAssignments.filter((ta: any) => {
                            const subj = Array.isArray(ta.subject) ? ta.subject[0] : ta.subject
                            const cl = Array.isArray(ta.class) ? ta.class[0] : ta.class
                            return subj?.id === subjectId && cl?.id === classId
                        })
                        return { classId, anchor: tas[0] }
                    })
                    const withTeachers = matched.filter(m => m.anchor)
                    if (withTeachers.length === 0) {
                        alert('Tidak ada kelas terpilih yang memiliki guru pengampu untuk mapel ini.')
                        return
                    }
                    // Pre-flight cek duplikat-judul per TA target (adil: guru & admin).
                    // Pakai exams in-memory (nol fetch tambahan).
                    const { proceed: dupOk, forceDuplicate: dupForce } = await dupGuard.guard(withTeachers.map(m => m.anchor.id), dupForm.title, exams)
                    if (!dupOk) return
                    const batchId = withTeachers.length > 1 ? crypto.randomUUID() : null
                    const results = await Promise.allSettled(withTeachers.map(m =>
                        fetch('/api/exams', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                teaching_assignment_id: m.anchor.id,
                                title: dupForm.title,
                                description: dupExam.description,
                                start_time: localDate.toISOString(),
                                duration_minutes: dupForm.duration_minutes,
                                window_end_time: dupForm.schedule_mode === 'window' && dupForm.window_end_time
                                    ? new Date(dupForm.window_end_time).toISOString() : null,
                                is_randomized: dupExam.is_randomized,
                                max_violations: dupExam.max_violations,
                                show_results_immediately: dupExam.show_results_immediately ?? true,
                                duplicate_from_exam_id: dupMembers[0]?.id || dupExam.id,
                                duplicate_questions: true,
                                batch_id: batchId,
                                force_duplicate: dupForce,
                            })
                        }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
                    ))
                    const okResults = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
                    if (okResults.length === 0) {
                        alert(`Gagal menyalin ${labels.ulangan.toLowerCase()}. Silakan coba lagi.`)
                        return
                    }
                    newExam = okResults[0].value
                    alert(`${okResults.length} ${labels.ulangan} berhasil disalin.`)
                }
            } else {
                // Official (UTS/UAS) — POST /api/official-exams/duplicate
                const payload = {
                    source_exam_id: dupExam.id,
                    title: dupForm.title,
                    start_time: localDate.toISOString(),
                    duration_minutes: dupForm.duration_minutes,
                    window_end_time: dupForm.schedule_mode === 'window' && dupForm.window_end_time
                        ? new Date(dupForm.window_end_time).toISOString() : null,
                    target_class_ids: dupForm.target_class_ids,
                    is_remedial: dupMode === 'REMEDIAL',
                    allowed_student_ids: dupMode === 'REMEDIAL' ? dupSelectedStudentIds : null,
                    ...(dupMode === 'REMEDIAL' ? {
                        remedial_score_policy: dupRemedialPolicy.policy,
                        ...(dupRemedialPolicy.policy === 'CAP' ? { remedial_max_score: dupRemedialPolicy.cap } : {}),
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
                    const err = await res.json().catch(() => null)
                    if (err && dup409.handle409(err, async () => {
                        // Retry dgn force_duplicate: true
                        const retryRes = await fetch('/api/official-exams/duplicate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ...payload, force_duplicate: true })
                        })
                        if (retryRes.ok) {
                            newExam = await retryRes.json()
                            setDupShow(false)
                            if (newExam?.id) router.push(`/dashboard/guru/uts-uas/${newExam.id}`)
                        } else {
                            const retryErr = await retryRes.json().catch(() => ({}))
                            alert(retryErr?.error || 'Gagal menduplikasi setelah bypass duplikat.')
                        }
                    })) return
                    alert(err?.error || 'Gagal menduplikasi ujian')
                    return
                }
            }

            setDupShow(false)
            fetchData()
            if (newExam?.id) {
                router.push(dupSource === 'official'
                    ? `/dashboard/guru/uts-uas/${newExam.id}`
                    : `/dashboard/guru/ulangan/${newExam.id}`)
            }
        } catch (e) {
            console.error('Error in duplicate submit:', e)
            alert('Terjadi kesalahan')
        } finally {
            setDupSubmitting(false)
        }
    }

    // Grouping batch multi-kelas → 1 card per batch (key batch_id|mapel; guard
    // batch lama & baris tanpa embed di examBatchGrouping). Angka pengumpulan
    // diagregasi dari member yang TERLIHAT (co-teacher parsial hanya kelasnya);
    // badge "N Kelas Paralel" dari server tetap mencerminkan batch penuh.
    const examGroups = groupExamsByBatch(exams, { subjectId: subjectIdOf, classId: classIdOf })
    const classFilteredGroups = classFilter
        ? examGroups.filter(g => g.classIds.includes(classFilter))
        : examGroups
    // Draft filter DISETELAH grouping: batch disembunyikan hanya bila SEMUA
    // member belum publish — batch campuran tetap tampil utuh.
    const visibleExamGroups = showDrafts
        ? classFilteredGroups
        : classFilteredGroups.filter(g => g.members.some(m => m.is_active))
    // UTS/UAS: draft (is_active=false, termasuk buatan admin) disembunyikan
    const visibleOfficialExams = showDrafts
        ? officialExams
        : officialExams.filter(e => e.is_active)
    // Draf tersembunyi per seksi — pesan empty state ulangan butuh membedakan
    // "difilter kelas" vs "semuanya draf tersembunyi"
    const hiddenUlanganDrafts = classFilteredGroups.length - visibleExamGroups.length
    // Hint toggle: jumlah draf tersembunyi di kedua seksi
    const hiddenDrafts = hiddenUlanganDrafts
        + (officialExams.length - visibleOfficialExams.length)
    // Opsi filter kelas = kelas unik dari TA saya (urut nama)
    const classOptions = [...new Map(
        teachingAssignments
            .map(ta => [ta.class?.id, ta.class?.name] as [string, string])
            .filter(([id]) => !!id)
    ).entries()].sort((a, b) => a[1].localeCompare(b[1], 'id'))

    // ── classesByLevel untuk modal duplikasi (guru = kelas dari TA saya) ──
    // Official: irisan kelas diajar × kelas target ujian.
    // Ulangan: hanya kelas yang guru ajar mapel yang SAMA dengan exam sumber
    // (paritas ClassChipsSelector lama yang filter via defaultSubjectId).
    const guruClasses = teachingAssignments.map((ta: any) => {
        const cls = Array.isArray(ta.class) ? ta.class[0] : ta.class
        const subj = Array.isArray(ta.subject) ? ta.subject[0] : ta.subject
        if (!cls) return null
        return { id: cls.id, name: cls.name, school_level: cls.school_level || null, grade_level: cls.grade_level || null, subjectId: subj?.id }
    }).filter(Boolean) as { id: string; name: string; school_level: string | null; grade_level: number | null; subjectId?: string }[]

    const dupClassesByLevel = (() => {
        let classes = guruClasses
        if (dupSource === 'official' && dupExam?.target_class_ids) {
            const examClassIds = new Set(dupExam.target_class_ids as string[])
            classes = guruClasses.filter(c => examClassIds.has(c.id))
        } else if (dupSource === 'ulangan' && dupExam) {
            // Filter by source exam's subject — hanya tampilkan kelas dengan
            // mapel yang sama agar "Pilih Semua" tidak memilih kelas mapel lain
            // yang akan di-skip diam-diam saat submit (tidak ada TA match).
            const srcSubjectId = subjectIdOf(dupExam)
            if (srcSubjectId) {
                classes = guruClasses.filter(c => c.subjectId === srcSubjectId)
            }
        }
        return classes.reduce((acc, c) => {
            const level = c.school_level || 'Lainnya'
            if (!acc[level]) acc[level] = []
            acc[level].push(c)
            return acc
        }, {} as Record<string, { id: string; name: string; school_level: string | null; grade_level: number | null }[]>)
    })()

    const dupRemedialClassCount = new Set(dupRemedialStudents.map((s: any) => s.className).filter(Boolean)).size

    // Partial warning: guru ajar sebagian kelas dari ujian resmi
    const dupPartialWarning = dupSource === 'official' && dupExam?.target_class_ids
        ? { taught: dupClassesByLevel ? Object.values(dupClassesByLevel).flat().length : 0, total: dupExam.target_class_ids.length, typeLabel: dupExam.exam_type === 'UAS' ? labels.uas : labels.uts }
        : undefined

    // Render bertahap: 24 kartu pertama langsung, sisanya menyusul saat
    // di-scroll (sentinel + IntersectionObserver) — DOM ratusan kartu
    // dirender sekaligus membuat halaman tersendat walau data sudah sampai.
    const { items: renderedExamGroups, sentinelRef: listSentinelRef, hasMore: listHasMore } = useIncrementalList(visibleExamGroups)

    return (
        <div className="space-y-6">
            <PageHeader
                title={labels.ulangan}
                icon={<div className="text-red-500"><Clock set="bold" primaryColor="currentColor" size={24} /></div>}
                backHref="/dashboard/guru"
                subtitle={`${labels.ulangan} harian & ujian ${labels.uts}/${labels.uas}`}
                action={
                    <Button onClick={() => setShowCreate(true)} data-tutorial="exam-create-btn" icon={
                        <div className="text-white"><Plus set="bold" primaryColor="currentColor" size={20} /></div>
                    }>
                        Buat {labels.ulangan}
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
                    {/* Satu toggle untuk kedua seksi: ulangan harian + UTS/UAS */}
                    <div className="flex justify-end">
                        <ShowDraftsToggle
                            checked={showDrafts}
                            onChange={setShowDrafts}
                            hiddenCount={hiddenDrafts}
                        />
                    </div>
                    <div>
                        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                            <h2 className="text-xl font-bold text-text-main dark:text-white flex items-center gap-2">
                                <div className="text-red-500"><Clock set="bold" primaryColor="currentColor" size={24} /></div>
                                {labels.ulangan} Harian
                            </h2>
                            {classOptions.length > 1 && (
                                <select
                                    value={classFilter}
                                    onChange={(e) => setClassFilter(e.target.value)}
                                    className="px-4 py-2 bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary text-sm font-bold"
                                    title="Filter kelas"
                                >
                                    <option value="">Semua Kelas</option>
                                    {classOptions.map(([id, name]) => (
                                        <option key={id} value={id}>{name}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                        {exams.length === 0 ? (
                            <div className="bg-secondary/5 border-2 border-dashed border-secondary/20 rounded-2xl p-8 text-center">
                                <div className="text-secondary/50 mx-auto mb-3 flex justify-center"><Document set="bold" primaryColor="currentColor" size={48} /></div>
                                <h3 className="font-bold text-text-main dark:text-white text-lg">Belum Ada {labels.ulangan} Harian</h3>
                                <p className="text-text-secondary text-sm mb-4">Buat {labels.ulangan.toLowerCase()} baru untuk kelas Anda dengan fitur pengawasan.</p>
                                <Button onClick={() => setShowCreate(true)} size="sm">Buat {labels.ulangan} Sekarang</Button>
                            </div>
                        ) : visibleExamGroups.length === 0 ? (
                            <div className="bg-secondary/5 border-2 border-dashed border-secondary/20 rounded-2xl p-8 text-center">
                                <p className="text-text-secondary text-sm">
                                    {hiddenUlanganDrafts > 0
                                        ? <>Semua {labels.ulangan.toLowerCase()} yang tampil berstatus draf — nyalakan <strong>Tampilkan Draft</strong> untuk melihatnya.</>
                                        : <>Tidak ada {labels.ulangan.toLowerCase()} untuk kelas terpilih.</>}
                                </p>
                            </div>
                        ) : (
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {renderedExamGroups.map((group) => {
                                    const exam = group.representative
                                    const nowMs = serverNow()
                                    const repStatus = getExamStatus(exam, nowMs)
                                    // Status agregat batch: live bila ADA member live,
                                    // selesai bila SEMUA member selesai (representative
                                    // pending_publish otomatis jadi Under Review).
                                    const memberStatuses = group.members.map(m => getExamStatus(m, nowMs))
                                    const isLive = group.isBatch ? memberStatuses.some(s => s.isLive) : repStatus.isLive
                                    const isDone = group.isBatch ? memberStatuses.every(s => s.isDone) : repStatus.isDone
                                    const isActive = group.isBatch ? group.members.some(m => m.is_active) : exam.is_active

                                    // Agregasi angka pengumpulan dari semua member terlihat
                                    const repClassId = classIdOf(exam)
                                    const total = group.isBatch
                                        ? group.members.reduce((acc, m) => acc + (studentCounts[classIdOf(m) || ''] || 0), 0)
                                        : (repClassId ? (studentCounts[repClassId] || 0) : 0)
                                    const submitted = group.members.reduce((acc, m) => acc + (submissionCounts[m.id] || 0), 0)
                                    const pendingGrading = group.members.reduce((acc, m) => acc + (pendingGradingCounts[m.id] || 0), 0)

                                    // Aksi utama kontekstual: Monitor saat live, Hasil saat selesai, Edit selebihnya.
                                    // Batch: monitor membuka SEMUA kelas member (?batch=1).
                                    const monitorHref = `/dashboard/guru/ulangan/${exam.id}/monitor${group.isBatch ? '?batch=1' : ''}`
                                    const primaryAction = isLive
                                        ? { label: 'Monitor Live', href: monitorHref, icon: <Activity className="w-4 h-4" /> }
                                        : isActive && isDone
                                            ? { label: 'Lihat Hasil', href: `/dashboard/guru/ulangan/${exam.id}?tab=hasil`, icon: <span className="text-secondary"><Graph set="bold" primaryColor="currentColor" size={16} /></span> }
                                            : { label: exam.pending_publish ? 'Perbaiki Soal' : 'Edit Soal', href: `/dashboard/guru/ulangan/${exam.id}`, icon: <Edit set="bold" primaryColor="currentColor" size={16} /> }

                                    // Info per-kelas untuk section expandable (batch card).
                                    const batchMembers = group.isBatch
                                        ? group.members.map(m => {
                                            const ms = getExamStatus(m, nowMs)
                                            const cId = classIdOf(m) || ''
                                            return {
                                                examId: m.id,
                                                className: first(taOf(m)?.class)?.name || null,
                                                statusLabel: ms.label,
                                                statusColor: ms.color,
                                                submitted: submissionCounts[m.id] || 0,
                                                total: studentCounts[cId] || 0,
                                            }
                                        })
                                        : undefined

                                    const menuItems: DropdownMenuItem[] = [
                                        {
                                            label: 'Lihat Hasil',
                                            show: isActive,
                                            icon: <span className="text-secondary"><Graph set="bold" primaryColor="currentColor" size={14} /></span>,
                                            onClick: () => router.push(`/dashboard/guru/ulangan/${exam.id}?tab=hasil`),
                                        },
                                        {
                                            label: 'Buat Remedial',
                                            show: isActive && !exam.is_remedial && isDone,
                                            icon: <RefreshCw className="w-4 h-4" />,
                                            onClick: () => openDuplicate(exam, 'REMEDIAL', 'ulangan', group.isBatch ? group : undefined),
                                        },
                                        {
                                            label: 'Pakai Ulang',
                                            show: isActive,
                                            icon: <Copy className="w-4 h-4" />,
                                            onClick: () => openDuplicate(exam, 'BIASA', 'ulangan', group.isBatch ? group : undefined),
                                        },
                                        {
                                            label: 'Hapus',
                                            danger: true,
                                            icon: <Trash2 className="w-4 h-4" />,
                                            onClick: () => handleDelete(exam, group.isBatch ? group : undefined),
                                        },
                                    ]

                                    return (
                                        <DailyExamCard
                                            key={exam.id}
                                            exam={exam}
                                            submission={{ submitted, total }}
                                            pendingGrading={pendingGrading}
                                            onPendingGradingClick={() => router.push(`/dashboard/guru/ulangan/${exam.id}?tab=hasil`)}
                                            primaryAction={primaryAction}
                                            menuItems={menuItems}
                                            now={serverNow()}
                                            batchMembers={batchMembers}
                                        />
                                    )
                                })}
                            </div>
                        )}
                        {/* Sentinel render bertahap: terlihat saat scroll → muat batch berikutnya */}
                        {listHasMore && <div ref={listSentinelRef} className="h-1" aria-hidden="true" />}
                    </div>

                    <div>
                        <h2 className="text-xl font-bold text-text-main dark:text-white mb-4 flex items-center gap-2">
                            <GraduationCap className="w-6 h-6 text-indigo-500" />
                            Ujian {labels.uts} & {labels.uas}
                        </h2>
                        {visibleOfficialExams.length === 0 ? (
                            <div className="bg-secondary/5 border-2 border-dashed border-secondary/20 rounded-2xl p-8 text-center">
                                <BookOpen className="w-12 h-12 text-secondary/50 mx-auto mb-3" />
                                <h3 className="font-bold text-text-main dark:text-white text-lg">Belum Ada {labels.uts}/{labels.uas}</h3>
                                <p className="text-text-secondary text-sm">
                                    {(officialExams.length - visibleOfficialExams.length) > 0
                                        ? <>Semua ujian {labels.uts}/{labels.uas} yang tampil berstatus draf — nyalakan <strong>Tampilkan Draft</strong> untuk melihatnya.</>
                                        : <>Tidak ada ujian resmi yang terkait dengan mata pelajaran Anda saat ini.</>}
                                </p>
                            </div>
                        ) : (
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {visibleOfficialExams.map(exam => {
                                    const status = getOfficialExamStatus(exam, serverNow())
                                    const isLive = status.isLive
                                    const isDone = status.isDone

                                    // Draft (termasuk buatan admin) dibuka di editor agar bisa dilengkapi & dipublish
                                    const primaryAction = status.label === 'Draft'
                                        ? { label: 'Edit Soal', href: `/dashboard/guru/uts-uas/${exam.id}`, icon: <Edit set="bold" primaryColor="currentColor" size={16} /> }
                                        : isLive
                                            ? { label: 'Monitor Live', href: `/dashboard/guru/uts-uas/${exam.id}/monitor`, icon: <Activity className="w-4 h-4" /> }
                                            : { label: 'Lihat Hasil', href: `/dashboard/guru/uts-uas/${exam.id}#hasil`, icon: <span className="text-secondary"><Graph set="bold" primaryColor="currentColor" size={16} /></span> }

                                    const officialMenuItems: DropdownMenuItem[] = [
                                        {
                                            label: 'Lihat Hasil',
                                            show: exam.is_active && !isLive,
                                            icon: <span className="text-secondary"><Graph set="bold" primaryColor="currentColor" size={14} /></span>,
                                            onClick: () => router.push(`/dashboard/guru/uts-uas/${exam.id}#hasil`),
                                        },
                                        {
                                            label: `Buat Remedial ${exam.exam_type === 'UTS' ? labels.uts : labels.uas}`,
                                            show: isDone && !exam.is_remedial,
                                            icon: <RefreshCw className="w-4 h-4" />,
                                            onClick: () => openDuplicate(exam, 'REMEDIAL', 'official'),
                                        },
                                        {
                                            label: 'Pakai Ulang',
                                            show: isDone || isLive,
                                            icon: <Copy className="w-4 h-4" />,
                                            onClick: () => openDuplicate(exam, 'BIASA', 'official'),
                                        },
                                        {
                                            label: 'Hapus',
                                            danger: true,
                                            icon: <Trash2 className="w-4 h-4" />,
                                            onClick: () => handleDeleteOfficial(exam.id),
                                        },
                                    ]

                                    return (
                                        <OfficialExamCard
                                            key={exam.id}
                                            exam={exam}
                                            primaryAction={primaryAction}
                                            menuItems={officialMenuItems}
                                            pendingGrading={pendingGradingCounts[exam.id] || 0}
                                            now={serverNow()}
                                        />
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <Modal
                open={showCreate}
                onClose={() => setShowCreate(false)}
                title={examKind === 'ULANGAN' ? `Buat ${labels.ulangan} Baru` : `Buat ${labelForGradeType(examKind, labels)} Baru`}
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
                                    {labelForGradeType(k, labels)}
                                </button>
                            ))}
                        </div>
                        {examKind !== 'ULANGAN' && (
                            <p className="text-xs text-text-secondary mt-2">
                                {labelForGradeType(examKind, labels)} adalah ujian resmi sekolah — semua kelas terpilih mengerjakan pada jadwal yang sama (bisa mode serentak atau jendela waktu). Pilih kelas dari SATU mata pelajaran.
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
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul {examKind === 'ULANGAN' ? labels.ulangan : 'Ujian'}</label>
                        <input
                            type="text"
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            placeholder={`Contoh: ${labels.uts} Matematika Bab 1-3`}
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

            {/* Unified Duplicate & Remedial Modal — shared component (admin & guru pakai sama) */}
            <DuplicateRemedialModal
                open={dupShow}
                onClose={() => setDupShow(false)}
                mode={dupMode}
                source={dupSource}
                sourceTitle={dupExam?.title || ''}
                sourceQuestionCount={dupExam?.question_count || 0}
                sourceExamType={dupSource === 'official' ? dupExam?.exam_type : undefined}
                remedialNewQuestionsNote={dupSource === 'ulangan' && dupMode === 'REMEDIAL' && dupRemedialMethod === 'BARU' ? `${labels.ulangan} baru akan dibuat dengan soal kosong` : undefined}
                form={dupForm}
                onFormChange={(patch) => setDupForm(prev => ({ ...prev, ...patch }))}
                labels={labels}
                showTargetClassSelector={dupSource === 'official' || dupMode === 'BIASA'}
                classesByLevel={dupClassesByLevel}
                onToggleClass={(classId) => setDupForm(prev => ({
                    ...prev,
                    target_class_ids: prev.target_class_ids.includes(classId)
                        ? prev.target_class_ids.filter(id => id !== classId)
                        : [...prev.target_class_ids, classId]
                }))}
                onSelectAllClasses={() => setDupForm(prev => ({ ...prev, target_class_ids: Object.values(dupClassesByLevel).flat().map(c => c.id) }))}
                onResetClasses={() => setDupForm(prev => ({ ...prev, target_class_ids: [] }))}
                targetClassHelperText={dupSource === 'ulangan' && dupMode === 'BIASA' ? `${labels.ulangan} dibuat atas nama guru pengampu mapel ini di setiap kelas terpilih.` : undefined}
                partialWarning={dupPartialWarning}
                remedialMethod={dupRemedialMethod}
                onRemedialMethodChange={setDupRemedialMethod}
                remedialPolicy={dupRemedialPolicy}
                onRemedialPolicyChange={setDupRemedialPolicy}
                kkm={dupKkm}
                students={dupRemedialStudents}
                selectedStudentIds={dupSelectedStudentIds}
                onStudentToggle={(studentId) => {
                    setDupSelectedStudentIds(prev => prev.includes(studentId) ? prev.filter(id => id !== studentId) : [...prev, studentId])
                }}
                remedialLoading={dupRemedialLoading}
                remedialClassCount={dupRemedialClassCount}
                onSubmit={handleDuplicateSubmit}
                submitting={dupSubmitting}
            />

            {/* Guard duplikat-judul dialog (pre-flight) — shared guru+admin */}
            {dupGuard.dialog}
            {/* Handler 409 DUPLICATE_TITLE dari POST official-exams (server guard backstop) */}
            {dup409.dialog}
        </div>
    )
}
