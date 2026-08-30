'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, Card, Button, StatsCard, EmptyState, Modal } from '@/components/ui'
import { Chart, User, TickSquare, TimeCircle, Activity, Search, ArrowRight, Document, Discovery, Download, Paper, Edit, Plus } from 'react-iconly'
import { GraduationCap } from 'lucide-react'
import * as XLSX from 'xlsx'

interface Student {
    id: string
    nis: string
    user: { full_name: string }
}

interface Submission {
    id: string
    submitted_at: string
    student: { id: string }
    assignment: { id: string; title: string; type: string }
    grade: Array<{ score: number; graded_at?: string }>
}

interface QuizSubmission {
    id: string
    student_id: string
    total_score: number
    max_score: number
    is_graded: boolean
    submitted_at?: string
    quiz: { id: string; title: string }
}

interface ExamSubmission {
    id: string
    is_submitted: boolean
    total_score: number
    max_score: number
    submitted_at?: string
    student: { id: string }
    exam: { id: string; title: string }
}

interface Assignment {
    id: string
    title: string
    type: string
    submission_mode?: string
    teaching_assignment: { id: string }
}

interface Quiz {
    id: string
    title: string
    submission_mode?: string
    teaching_assignment: { id: string }
}

interface Exam {
    id: string
    title: string
    teaching_assignment: { id: string }
}

interface OfficialExamForNilai {
    id: string
    title: string
    exam_type: 'UTS' | 'UAS'
    subject_id: string
    target_class_ids: string[]
}

interface OfficialExamSubForNilai {
    id: string
    student_id: string
    is_submitted: boolean
    total_score: number
    max_score: number
    is_graded: boolean
    exam_id: string
    submitted_at?: string
}

interface TeachingAssignment {
    id: string
    subject: { id: string; name: string; kkm?: number }
    class: { id: string; name: string; school_level?: string; grade_level?: number }
    academic_year?: { id: string; name: string; is_active?: boolean }
}

type TabType = 'rekap' | 'tugas' | 'kuis' | 'ulangan' | 'uts-uas' | 'export'

export default function NilaiPage() {
    const { user } = useAuth()
    const searchParams = useSearchParams()
    const [activeTab, setActiveTab] = useState<TabType>('rekap')
    const [teachingAssignments, setTeachingAssignments] = useState<TeachingAssignment[]>([])
    const [selectedTA, setSelectedTA] = useState<string>('')
    const [students, setStudents] = useState<Student[]>([])
    const [assignments, setAssignments] = useState<Assignment[]>([])
    const [quizzes, setQuizzes] = useState<Quiz[]>([])
    const [exams, setExams] = useState<Exam[]>([])
    const [allSubmissions, setAllSubmissions] = useState<Submission[]>([])
    const [quizSubmissions, setQuizSubmissions] = useState<QuizSubmission[]>([])
    const [examSubmissions, setExamSubmissions] = useState<ExamSubmission[]>([])
    const [officialExams, setOfficialExams] = useState<OfficialExamForNilai[]>([])
    const [officialExamSubs, setOfficialExamSubs] = useState<OfficialExamSubForNilai[]>([])
    const [loading, setLoading] = useState(true)
    const [loadingData, setLoadingData] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [exportSuccess, setExportSuccess] = useState(false)
    const [subjectKkms, setSubjectKkms] = useState<any[]>([])

    // Gradebook: tambah kolom penilaian offline + edit kolom + detail sel
    const [showAddColumn, setShowAddColumn] = useState<'TUGAS' | 'ULANGAN' | 'KUIS' | null>(null)
    const [newColumnTitle, setNewColumnTitle] = useState('')
    const [newColumnType, setNewColumnType] = useState('TUGAS')
    const [savingColumn, setSavingColumn] = useState(false)
    const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
    const [editingQuizId, setEditingQuizId] = useState<string | null>(null)
    const [draftScores, setDraftScores] = useState<Record<string, string>>({})
    const [savingScores, setSavingScores] = useState(false)
    const [cellDetail, setCellDetail] = useState<{
        title: string
        category: string
        studentName: string
        nis: string
        score: number | null
        date: string | null
        source?: 'ASSIGNMENT' | 'QUIZ'
        refId?: string
        studentId?: string
    } | null>(null)

    // Riwayat perubahan nilai untuk sel yang sedang dibuka (hanya kolom yang guru input manual)
    const [cellHistory, setCellHistory] = useState<Array<{
        id: string
        old_score: number | null
        new_score: number
        max_score: number | null
        changed_by_name: string | null
        changed_at: string
    }>>([])
    const [loadingHistory, setLoadingHistory] = useState(false)

    useEffect(() => {
        if (!cellDetail?.source || !cellDetail?.refId || !cellDetail?.studentId) {
            setCellHistory([])
            return
        }
        setLoadingHistory(true)
        fetch(`/api/grade-history?source=${cellDetail.source}&ref_id=${cellDetail.refId}&student_id=${cellDetail.studentId}`)
            .then(res => res.json())
            .then(data => setCellHistory(Array.isArray(data) ? data : []))
            .catch(() => setCellHistory([]))
            .finally(() => setLoadingHistory(false))
    }, [cellDetail])

    useEffect(() => {
        const fetchInitial = async () => {
            try {
                const [taRes, skkmRes] = await Promise.all([
                    fetch('/api/my-teaching-assignments'),
                    fetch('/api/subject-kkm')
                ])
                const taData = await taRes.json()
                const skkmData = await skkmRes.json()
                setTeachingAssignments(Array.isArray(taData) ? taData : [])
                setSubjectKkms(Array.isArray(skkmData) ? skkmData : [])
            } catch (error) {
                console.error('Error:', error)
            } finally {
                setLoading(false)
            }
        }
        if (user) fetchInitial()
    }, [user])

    const getKkm = (taId: string) => {
        const ta = teachingAssignments.find(t => t.id === taId)
        if (!ta) return 75
        const fallback = ta.subject.kkm || 75
        const { school_level, grade_level } = ta.class
        if (!school_level || !grade_level) return fallback

        const granular = subjectKkms.find(k => 
            k.subject_id === ta.subject.id && 
            k.school_level === school_level && 
            k.grade_level === grade_level
        )
        return granular ? granular.kkm : fallback
    }

    // Auto-select teaching assignment from query param (deep-link from dashboard warnings)
    useEffect(() => {
        const taParam = searchParams.get('ta')
        if (taParam && teachingAssignments.length > 0 && !selectedTA) {
            const match = teachingAssignments.find(t => t.id === taParam)
            if (match) {
                setSelectedTA(match.id)
                setActiveTab('rekap')
            }
        }
    }, [searchParams, teachingAssignments])

    const fetchTAData = useCallback(async () => {
        if (!selectedTA) return
        setLoadingData(true)
        try {
            const ta = teachingAssignments.find(t => t.id === selectedTA)
            if (!ta) return

            // Fetch students in the class — year-aware so a past TA shows the
            // students who were enrolled then (not the current roster).
            const studentsRes = await fetch(`/api/students?class_id=${ta.class.id}&enrollment_year_id=${ta.academic_year?.id || ''}`)
            const studentsData = await studentsRes.json()
            setStudents(Array.isArray(studentsData) ? studentsData : [])

            // Fetch assignments
            const assignmentsRes = await fetch('/api/assignments')
            const assignmentsData = await assignmentsRes.json()
            const myAssignments = (assignmentsData || []).filter((a: Assignment) =>
                a.teaching_assignment?.id === selectedTA
            )
            setAssignments(myAssignments)

            // Fetch submissions for assignments
            const allSubs: Submission[] = []
            for (const assignment of myAssignments) {
                const subRes = await fetch(`/api/submissions?assignment_id=${assignment.id}`)
                const subData = await subRes.json()
                if (Array.isArray(subData)) {
                    allSubs.push(...subData.map((s: any) => ({ ...s, assignment: { id: assignment.id, title: assignment.title, type: assignment.type } })))
                }
            }
            setAllSubmissions(allSubs)

            // Fetch quizzes
            const quizzesRes = await fetch('/api/quizzes')
            const quizzesData = await quizzesRes.json()
            const myQuizzes = (quizzesData || []).filter((q: Quiz) => q.teaching_assignment?.id === selectedTA)
            setQuizzes(myQuizzes)

            // Fetch quiz submissions
            const allQuizSubs: QuizSubmission[] = []
            for (const quiz of myQuizzes) {
                const qSubRes = await fetch(`/api/quiz-submissions?quiz_id=${quiz.id}`)
                const qSubData = await qSubRes.json()
                if (Array.isArray(qSubData)) {
                    allQuizSubs.push(...qSubData.map((s: any) => ({ ...s, quiz: { id: quiz.id, title: quiz.title } })))
                }
            }
            setQuizSubmissions(allQuizSubs)

            // Fetch exams
            const examsRes = await fetch('/api/exams')
            const examsData = await examsRes.json()
            const myExams = (examsData || []).filter((e: Exam) => e.teaching_assignment?.id === selectedTA)
            setExams(myExams)

            // Fetch exam submissions
            const allExamSubs: ExamSubmission[] = []
            for (const exam of myExams) {
                const eSubRes = await fetch(`/api/exam-submissions?exam_id=${exam.id}`)
                const eSubData = await eSubRes.json()
                if (Array.isArray(eSubData)) {
                    allExamSubs.push(...eSubData.filter((s: any) => s.is_submitted).map((s: any) => ({ ...s, exam: { id: exam.id, title: exam.title } })))
                }
            }
            setExamSubmissions(allExamSubs)

            // Fetch official exams (UTS/UAS) matching this subject + class
            const officialRes = await fetch('/api/official-exams')
            const officialData = await officialRes.json()
            const myOfficialExams = (Array.isArray(officialData) ? officialData : []).filter(
                (oe: any) => oe.subject?.id === ta.subject.id && oe.target_class_ids?.includes(ta.class.id)
            )
            setOfficialExams(myOfficialExams.map((oe: any) => ({
                id: oe.id, title: oe.title, exam_type: oe.exam_type,
                subject_id: oe.subject?.id, target_class_ids: oe.target_class_ids
            })))

            // Fetch official exam submissions
            const allOfficialSubs: OfficialExamSubForNilai[] = []
            for (const oe of myOfficialExams) {
                const oeSubRes = await fetch(`/api/official-exam-submissions?exam_id=${oe.id}`)
                const oeSubData = await oeSubRes.json()
                if (Array.isArray(oeSubData)) {
                    allOfficialSubs.push(...oeSubData
                        .filter((s: any) => s.is_submitted)
                        .map((s: any) => ({
                            id: s.id, student_id: s.student?.id || s.student_id,
                            is_submitted: true, total_score: s.total_score,
                            max_score: s.max_score, is_graded: s.is_graded,
                            exam_id: oe.id, submitted_at: s.submitted_at
                        }))
                    )
                }
            }
            setOfficialExamSubs(allOfficialSubs)

        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoadingData(false)
        }
    }, [selectedTA, teachingAssignments])

    useEffect(() => {
        if (!selectedTA) {
            setStudents([])
            setAssignments([])
            setQuizzes([])
            setExams([])
            setAllSubmissions([])
            setQuizSubmissions([])
            setExamSubmissions([])
            setOfficialExams([])
            setOfficialExamSubs([])
            return
        }
        fetchTAData()
    }, [selectedTA, teachingAssignments, fetchTAData])

    // Calculate average for a student
    const calculateAverage = (studentId: string) => {
        const grades: number[] = []

        // Assignment grades
        allSubmissions.filter(s => s.student?.id === studentId && s.grade?.length > 0).forEach(s => {
            grades.push(s.grade[0].score)
        })

        // Quiz grades
        quizSubmissions.filter(qs => qs.student_id === studentId && qs.is_graded).forEach(qs => {
            grades.push(Math.round((qs.total_score / qs.max_score) * 100))
        })

        // Exam grades
        examSubmissions.filter(es => es.student?.id === studentId).forEach(es => {
            grades.push(Math.round((es.total_score / es.max_score) * 100))
        })

        // Official exam (UTS/UAS) grades
        officialExamSubs.filter(os => os.student_id === studentId && os.is_graded && os.max_score > 0).forEach(os => {
            grades.push(Math.round((os.total_score / os.max_score) * 100))
        })

        if (grades.length === 0) return null
        return Math.round(grades.reduce((sum, g) => sum + g, 0) / grades.length)
    }

    // Export to Excel (proper .xlsx)
    const handleExport = () => {
        const ta = teachingAssignments.find(t => t.id === selectedTA)
        if (!ta) return

        // Build header row — memakai daftar kolom yang sama dengan tampilan Rekap
        // (const di bawah; aman karena handleExport dipanggil post-render)
        const headers = [
            'No',
            'NIS',
            'Nama Siswa',
            ...tugasAssignments.map((_, i) => `T${i + 1}`),
            ...quizzes.map((_, i) => `K${i + 1}`),
            ...exams.map((_, i) => `U${i + 1}`),
            ...ulanganAssignments.map((_, i) => `U${exams.length + i + 1}`),
            ...utsExams.map((_, i) => `UTS${utsExams.length > 1 ? i + 1 : ''}`),
            ...uasExams.map((_, i) => `UAS${uasExams.length > 1 ? i + 1 : ''}`),
            'Rata-rata'
        ]

        // Build data rows (sorted alphabetically by student name)
        const sortedStudents = [...students].sort((a, b) =>
            (a.user.full_name || '').localeCompare(b.user.full_name || '', 'id')
        )
        const rows = sortedStudents.map((student, idx) => {
            const tugasGrades = tugasAssignments.map(a => {
                const sub = allSubmissions.find(s => s.student?.id === student.id && s.assignment?.id === a.id)
                return sub?.grade?.[0]?.score ?? ''
            })
            const kuisGrades = quizzes.map(q => {
                const qs = quizSubmissions.find(qs => qs.student_id === student.id && qs.quiz.id === q.id)
                return qs?.is_graded ? Math.round((qs.total_score / qs.max_score) * 100) : ''
            })
            const ulanganGrades = exams.map(e => {
                const es = examSubmissions.find(es => es.student?.id === student.id && es.exam.id === e.id)
                return es ? Math.round((es.total_score / es.max_score) * 100) : ''
            })
            const ulanganOfflineGrades = ulanganAssignments.map(a => {
                const sub = allSubmissions.find(s => s.student?.id === student.id && s.assignment?.id === a.id)
                return sub?.grade?.[0]?.score ?? ''
            })
            const utsGrades = utsExams.map(oe => {
                const os = officialExamSubs.find(s => s.student_id === student.id && s.exam_id === oe.id)
                return os?.is_graded && os.max_score > 0 ? Math.round((os.total_score / os.max_score) * 100) : ''
            })
            const uasGrades = uasExams.map(oe => {
                const os = officialExamSubs.find(s => s.student_id === student.id && s.exam_id === oe.id)
                return os?.is_graded && os.max_score > 0 ? Math.round((os.total_score / os.max_score) * 100) : ''
            })
            const avg = calculateAverage(student.id)

            return [
                idx + 1,
                student.nis,
                student.user.full_name,
                ...tugasGrades,
                ...kuisGrades,
                ...ulanganGrades,
                ...ulanganOfflineGrades,
                ...utsGrades,
                ...uasGrades,
                avg ?? ''
            ]
        })

        // Build info rows at top
        const sheetData = [
            ['DAFTAR NILAI SISWA'],
            [`Kelas: ${ta.class.name}`],
            [`Mata Pelajaran: ${ta.subject.name}`],
            [`Tanggal Export: ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`],
            [],
            headers,
            ...rows
        ]

        const ws = XLSX.utils.aoa_to_sheet(sheetData)

        // Set column widths
        ws['!cols'] = [
            { wch: 4 },   // No
            { wch: 12 },  // NIS
            { wch: 30 },  // Nama
            ...Array(headers.length - 3).fill({ wch: 8 }),
        ]

        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Nilai')

        // Sanitize filename
        const safeClass = ta.class.name.replace(/[^a-zA-Z0-9\s]/g, '').trim()
        const safeSubject = ta.subject.name.replace(/[^a-zA-Z0-9\s]/g, '').trim()
        const filename = `Nilai_${safeClass}_${safeSubject}.xlsx`

        XLSX.writeFile(wb, filename)

        // Show success toast
        setExportSuccess(true)
        setTimeout(() => setExportSuccess(false), 4000)
    }

    const selectedTAData = teachingAssignments.find(t => t.id === selectedTA)
    const tugasAssignments = assignments.filter(a => a.type !== 'ULANGAN')
    const ulanganAssignments = assignments.filter(a => a.type === 'ULANGAN')
    const utsExams = officialExams.filter(oe => oe.exam_type === 'UTS')
    const uasExams = officialExams.filter(oe => oe.exam_type === 'UAS')

    // Label kategori ramah untuk detail sel
    const categoryLabel = (type: string) =>
        type === 'ULANGAN' ? 'Ulangan' : type === 'PR' ? 'PR' : type === 'PROYEK' ? 'Proyek' : type === 'LATIHAN' ? 'Latihan' : 'Tugas'

    // Buat kolom penilaian offline (Tugas/Ulangan/Kuis) dari halaman Nilai
    const handleAddColumn = async () => {
        if (!showAddColumn || !newColumnTitle.trim() || !selectedTA) return
        setSavingColumn(true)
        try {
            const res = showAddColumn === 'KUIS'
                ? await fetch('/api/quizzes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        teaching_assignment_id: selectedTA,
                        title: newColumnTitle.trim(),
                        description: '',
                        duration_minutes: 30, // placeholder — tidak dipakai untuk kuis offline
                        submission_mode: 'OFFLINE'
                    })
                })
                : await fetch('/api/assignments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        teaching_assignment_id: selectedTA,
                        title: newColumnTitle.trim(),
                        description: '',
                        type: showAddColumn === 'ULANGAN' ? 'ULANGAN' : newColumnType,
                        due_date: null,
                        submission_mode: 'OFFLINE'
                    })
                })
            if (!res.ok) {
                const err = await res.json().catch(() => null)
                throw new Error(err?.error || 'Gagal membuat kolom')
            }
            setShowAddColumn(null)
            setNewColumnTitle('')
            setNewColumnType('TUGAS')
            await fetchTAData()
        } catch (error: any) {
            console.error('Error creating column:', error)
            alert(error?.message || 'Gagal membuat kolom penilaian')
        } finally {
            setSavingColumn(false)
        }
    }

    // Mode edit kolom offline: isi nilai seluruh siswa langsung di grid
    const startEditColumn = (assignmentId: string) => {
        const drafts: Record<string, string> = {}
        students.forEach(student => {
            const sub = allSubmissions.find(s => s.student?.id === student.id && s.assignment?.id === assignmentId)
            drafts[student.id] = sub?.grade?.[0]?.score?.toString() || ''
        })
        setDraftScores(drafts)
        setEditingQuizId(null)
        setEditingColumnId(assignmentId)
    }

    const startEditQuizColumn = (quizId: string) => {
        const drafts: Record<string, string> = {}
        students.forEach(student => {
            const qs = quizSubmissions.find(q => q.student_id === student.id && q.quiz.id === quizId)
            drafts[student.id] = qs?.is_graded ? Math.round((qs.total_score / qs.max_score) * 100).toString() : ''
        })
        setDraftScores(drafts)
        setEditingColumnId(null)
        setEditingQuizId(quizId)
    }

    const cancelEditColumn = () => {
        setEditingColumnId(null)
        setEditingQuizId(null)
        setDraftScores({})
    }

    const saveColumnScores = async () => {
        if (!editingColumnId) return
        setSavingScores(true)
        try {
            // Hanya kirim nilai yang BERUBAH atau BARU — menyimpan ulang nilai
            // yang sama akan memicu notifikasi duplikat & menimpa graded_at.
            const entries = Object.entries(draftScores).filter(([studentId, v]) => {
                if (v === '') return false
                const num = parseInt(v)
                if (isNaN(num)) return false
                const sub = allSubmissions.find(s => s.student?.id === studentId && s.assignment?.id === editingColumnId)
                const current = sub?.grade?.[0]?.score
                return current === undefined || current !== num
            })
            const invalid = entries.filter(([, v]) => {
                const num = parseInt(v)
                return num < 0 || num > 100
            })
            if (invalid.length > 0) {
                alert(`${invalid.length} nilai di luar rentang 0-100 dilewati.`)
            }
            const valid = entries.filter(([, v]) => {
                const num = parseInt(v)
                return num >= 0 && num <= 100
            })
            if (valid.length === 0) {
                setEditingColumnId(null)
                setDraftScores({})
                return
            }
            await Promise.all(valid.map(([studentId, v]) =>
                fetch('/api/grades', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        assignment_id: editingColumnId,
                        student_id: studentId,
                        score: parseInt(v)
                    })
                }).then(res => {
                    if (!res.ok) throw new Error('Gagal menyimpan nilai')
                })
            ))
            setEditingColumnId(null)
            setDraftScores({})
            await fetchTAData()
        } catch (error) {
            console.error('Error saving scores:', error)
            alert('Gagal menyimpan sebagian nilai. Periksa kembali.')
        } finally {
            setSavingScores(false)
        }
    }

    // Simpan kolom kuis offline (endpoint manual terpisah dari jalur kuis online)
    const saveQuizColumnScores = async () => {
        if (!editingQuizId) return
        setSavingScores(true)
        try {
            // Hanya kirim nilai yang BERUBAH atau BARU (pola sama seperti kolom tugas)
            const entries = Object.entries(draftScores).filter(([studentId, v]) => {
                if (v === '') return false
                const num = parseInt(v)
                if (isNaN(num) || num < 0 || num > 100) return false
                const qs = quizSubmissions.find(q => q.student_id === studentId && q.quiz.id === editingQuizId)
                const current = qs?.is_graded ? Math.round((qs.total_score / qs.max_score) * 100) : undefined
                return current === undefined || current !== num
            })
            if (entries.length === 0) {
                cancelEditColumn()
                return
            }
            await Promise.all(entries.map(([studentId, v]) =>
                fetch('/api/quiz-submissions/manual', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        quiz_id: editingQuizId,
                        student_id: studentId,
                        score: parseInt(v)
                    })
                }).then(res => {
                    if (!res.ok) throw new Error('Gagal menyimpan nilai')
                })
            ))
            cancelEditColumn()
            await fetchTAData()
        } catch (error) {
            console.error('Error saving quiz scores:', error)
            alert('Gagal menyimpan sebagian nilai. Periksa kembali.')
        } finally {
            setSavingScores(false)
        }
    }

    // Stats
    const totalGraded = allSubmissions.filter(s => s.grade?.length > 0).length + quizSubmissions.filter(q => q.is_graded).length + examSubmissions.length
    const totalUngraded = allSubmissions.filter(s => !s.grade?.length).length + quizSubmissions.filter(q => !q.is_graded).length

    // Perbaikan: Hindari pembagian dengan 0 yang menghasilkan NaN
    const studentsWithGradesCount = students.filter(s => calculateAverage(s.id) !== null).length;
    const classAverage = studentsWithGradesCount > 0
        ? Math.round(students.map(s => calculateAverage(s.id)).filter(a => a !== null).reduce((sum, a) => sum + (a as number), 0) / studentsWithGradesCount)
        : 0

    // Filter teaching assignments by search query
    const filteredTAs = teachingAssignments.filter(ta =>
        ta.class.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ta.subject.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <div className="space-y-6">
            <PageHeader
                title="Nilai"
                subtitle="Lihat dan kelola rekap nilai siswa"
                icon={<Chart set="bold" primaryColor="currentColor" size={24} />}
                backHref="/dashboard/guru"
            />

            {/* Selection View - Cards */}
            {!selectedTA && (
                <>
                    {/* Search Bar */}
                    <Card padding="p-6" className="bg-gradient-to-r from-primary/10 to-secondary/10 border-primary/20">
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-3">🔍 Cari Kelas atau Mata Pelajaran</label>
                        <div className="relative">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Ketik nama kelas atau mata pelajaran..."
                                className="w-full px-4 py-3 pl-11 md:px-5 md:py-4 md:pl-12 bg-white dark:bg-surface-dark border border-secondary/20 rounded-full text-text-main dark:text-white text-base md:text-lg focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            />
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary">
                                <Search set="light" primaryColor="currentColor" size={24} />
                            </div>
                        </div>
                    </Card>

                    {/* Class Cards Grid */}
                    {loading ? (
                        <div className="text-center text-text-secondary py-8">Memuat...</div>
                    ) : filteredTAs.length === 0 ? (
                        <EmptyState
                            icon={<div className="text-secondary/30"><Chart set="bold" primaryColor="currentColor" size={48} /></div>}
                            title={searchQuery ? 'Tidak ada yang cocok' : 'Belum ada kelas'}
                            description={searchQuery ? 'Cobalah kata kunci yang lain.' : 'Anda belum memiliki kelas yang diampu.'}
                        />
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredTAs.map((ta, _tIdx) => (
                                <Card
                                    key={ta.id}
                                    padding="p-4 md:p-6"
                                    className="hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 transition-all duration-200 cursor-pointer group"
                                    onClick={() => { setSelectedTA(ta.id); setActiveTab('rekap'); setSearchQuery('') }}
                                    {...(_tIdx === 0 ? { 'data-tutorial': 'nilai-class-card' } : {})}
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <h3 className="text-xl md:text-2xl font-bold text-text-main dark:text-white mb-2 group-hover:text-primary transition-colors">
                                                {ta.class.name}
                                            </h3>
                                            <div className="flex items-center gap-2">
                                                <span className="px-3 py-1 bg-primary/10 text-primary-dark dark:text-primary rounded-full text-sm font-bold">
                                                    {ta.subject.name}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="p-3 bg-secondary/10 rounded-full group-hover:bg-primary/20 transition-colors">
                                            <ArrowRight set="bold" primaryColor="currentColor" size={24} />
                                        </div>
                                    </div>
                                    <p className="text-text-secondary text-sm">Klik untuk melihat nilai</p>
                                </Card>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Content after class selected */}
            {selectedTA && (
                <>
                    {/* Change Class Header */}
                    <Card padding="p-4" className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-bold text-text-main dark:text-white">{selectedTAData?.class.name}</h3>
                            <p className="text-sm text-text-secondary">{selectedTAData?.subject.name}</p>
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedTA('')}
                            icon={
                                <ArrowRight set="bold" primaryColor="currentColor" size={16} style={{ transform: 'rotate(180deg)' }} />
                            }
                        >
                            Ganti Kelas
                        </Button>
                    </Card>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatsCard
                            label="Siswa"
                            value={students.length}
                            icon={<User set="bold" primaryColor="currentColor" size={24} />}
                        />
                        <StatsCard
                            label="Sudah Dinilai"
                            value={totalGraded}
                            icon={<TickSquare set="bold" primaryColor="currentColor" size={24} />}
                            trend="submissions"
                        />
                        <StatsCard
                            label="Belum Dinilai"
                            value={totalUngraded}
                            icon={<TimeCircle set="bold" primaryColor="currentColor" size={24} />}
                        />
                        <StatsCard
                            label="Rata-rata Kelas"
                            value={classAverage || '-'}
                            icon={<Activity set="bold" primaryColor="currentColor" size={24} />}
                        />
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                        {[
                            { id: 'rekap', label: 'Rekap', icon: Paper, color: 'bg-primary' },
                            { id: 'tugas', label: `Tugas (${tugasAssignments.length})`, icon: Edit, color: 'bg-amber-500' },
                            { id: 'kuis', label: `Kuis (${quizzes.length})`, icon: Discovery, color: 'bg-purple-500' },
                            { id: 'ulangan', label: `Ulangan (${exams.length + ulanganAssignments.length})`, icon: TimeCircle, color: 'bg-red-500' },
                            { id: 'uts-uas', label: `UTS/UAS (${officialExams.length})`, icon: Document, color: 'bg-indigo-500' },
                            { id: 'export', label: 'Export', icon: Download, color: 'bg-blue-500' }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as TabType)}
                                className={`px-4 py-2 rounded-full font-bold transition-all whitespace-nowrap text-sm flex items-center gap-2 ${activeTab === tab.id
                                    ? `${tab.color} text-white shadow-lg shadow-${tab.color.replace('bg-', '')}/20`
                                    : 'bg-white dark:bg-surface-dark border border-secondary/20 text-text-secondary hover:text-primary hover:border-primary/30'
                                    }`}
                            >
                                <tab.icon set="bold" primaryColor="currentColor" size={16} />
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Tab Content */}
                    {loadingData ? (
                        <div className="text-center text-text-secondary py-8">Memuat data...</div>
                    ) : (
                        <>
                            {/* Tab: Rekap */}
                            {activeTab === 'rekap' && (
                                <div className="space-y-3">
                                    {/* Toolbar gradebook */}
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <p className="text-xs text-text-secondary">
                                            Klik nilai untuk melihat judul penilaian • Kolom <span className="font-bold text-amber-600">T</span> = Tugas, <span className="font-bold text-purple-600">K</span> = Kuis, <span className="font-bold text-red-600">U</span> = Ulangan
                                        </p>
                                        {editingColumnId || editingQuizId ? (
                                            <div className="flex gap-2">
                                                <Button variant="secondary" size="sm" onClick={cancelEditColumn}>
                                                    Batal
                                                </Button>
                                                <Button size="sm" onClick={editingQuizId ? saveQuizColumnScores : saveColumnScores} loading={savingScores}>
                                                    Simpan Nilai Kolom
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                <Button variant="secondary" size="sm" onClick={() => { setNewColumnType('TUGAS'); setShowAddColumn('TUGAS') }} icon={<Plus set="bold" primaryColor="currentColor" size={16} />}>
                                                    Tugas
                                                </Button>
                                                <Button variant="secondary" size="sm" onClick={() => setShowAddColumn('KUIS')} icon={<Plus set="bold" primaryColor="currentColor" size={16} />}>
                                                    Kuis
                                                </Button>
                                                <Button variant="secondary" size="sm" onClick={() => setShowAddColumn('ULANGAN')} icon={<Plus set="bold" primaryColor="currentColor" size={16} />}>
                                                    Ulangan
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                <Card padding="p-0" className="overflow-hidden">
                                    <div className="overflow-x-auto custom-scrollbar">
                                        <table className="w-full text-sm">
                                            <thead className="bg-secondary/5 border-b border-secondary/10">
                                                <tr>
                                                    <th className="px-6 py-4 text-left text-text-secondary font-bold sticky left-0 z-10 bg-white/95 dark:bg-surface-dark/95 min-w-[200px]">Nama Siswa</th>
                                                    {tugasAssignments.map((a, i) => (
                                                        <th key={a.id} title={a.title} className="px-2 py-3 text-center text-text-secondary font-bold min-w-[72px]">
                                                            <div className="flex flex-col items-center gap-1">
                                                                <span className="px-2 py-1 text-xs rounded-full bg-amber-500/10 text-amber-600 border border-amber-200">T{i + 1}</span>
                                                                <span className="text-[10px] font-medium text-text-secondary/80 leading-tight line-clamp-2 break-words max-w-[90px]">{a.title}</span>
                                                                {a.submission_mode === 'OFFLINE' && (
                                                                    editingColumnId === a.id ? (
                                                                        <span className="text-[10px] font-bold text-primary">Mode Edit</span>
                                                                    ) : (
                                                                        <button onClick={() => startEditColumn(a.id)} title="Input nilai kolom ini" className="text-primary hover:scale-110 transition-transform">
                                                                            <Edit set="bold" primaryColor="currentColor" size={14} />
                                                                        </button>
                                                                    )
                                                                )}
                                                            </div>
                                                        </th>
                                                    ))}
                                                    {quizzes.map((q, i) => (
                                                        <th key={q.id} title={q.title} className="px-2 py-3 text-center text-text-secondary font-bold min-w-[72px]">
                                                            <div className="flex flex-col items-center gap-1">
                                                                <span className="px-2 py-1 text-xs rounded-full bg-purple-500/10 text-purple-600 border border-purple-200">K{i + 1}</span>
                                                                <span className="text-[10px] font-medium text-text-secondary/80 leading-tight line-clamp-2 break-words max-w-[90px]">{q.title}</span>
                                                                {q.submission_mode === 'OFFLINE' && (
                                                                    editingQuizId === q.id ? (
                                                                        <span className="text-[10px] font-bold text-primary">Mode Edit</span>
                                                                    ) : (
                                                                        <button onClick={() => startEditQuizColumn(q.id)} title="Input nilai kolom ini" className="text-primary hover:scale-110 transition-transform">
                                                                            <Edit set="bold" primaryColor="currentColor" size={14} />
                                                                        </button>
                                                                    )
                                                                )}
                                                            </div>
                                                        </th>
                                                    ))}
                                                    {exams.map((e, i) => (
                                                        <th key={e.id} title={e.title} className="px-2 py-3 text-center text-text-secondary font-bold min-w-[72px]">
                                                            <div className="flex flex-col items-center gap-1">
                                                                <span className="px-2 py-1 text-xs rounded-full bg-red-500/10 text-red-600 border border-red-200">U{i + 1}</span>
                                                                <span className="text-[10px] font-medium text-text-secondary/80 leading-tight line-clamp-2 break-words max-w-[90px]">{e.title}</span>
                                                            </div>
                                                        </th>
                                                    ))}
                                                    {ulanganAssignments.map((a, i) => (
                                                        <th key={a.id} title={a.title} className="px-2 py-3 text-center text-text-secondary font-bold min-w-[72px]">
                                                            <div className="flex flex-col items-center gap-1">
                                                                <span className="px-2 py-1 text-xs rounded-full bg-red-500/10 text-red-600 border border-red-200">U{exams.length + i + 1}</span>
                                                                <span className="text-[10px] font-medium text-text-secondary/80 leading-tight line-clamp-2 break-words max-w-[90px]">{a.title}</span>
                                                                {a.submission_mode === 'OFFLINE' && (
                                                                    editingColumnId === a.id ? (
                                                                        <span className="text-[10px] font-bold text-primary">Mode Edit</span>
                                                                    ) : (
                                                                        <button onClick={() => startEditColumn(a.id)} title="Input nilai kolom ini" className="text-primary hover:scale-110 transition-transform">
                                                                            <Edit set="bold" primaryColor="currentColor" size={14} />
                                                                        </button>
                                                                    )
                                                                )}
                                                            </div>
                                                        </th>
                                                    ))}
                                                    {utsExams.map((oe, i) => (
                                                        <th key={oe.id} title={oe.title} className="px-2 py-3 text-center text-text-secondary font-bold min-w-[72px]">
                                                            <div className="flex flex-col items-center gap-1">
                                                                <span className="px-2 py-1 text-xs rounded-full bg-indigo-500/10 text-indigo-600 border border-indigo-200">UTS{utsExams.length > 1 ? i + 1 : ''}</span>
                                                                <span className="text-[10px] font-medium text-text-secondary/80 leading-tight line-clamp-2 break-words max-w-[90px]">{oe.title}</span>
                                                            </div>
                                                        </th>
                                                    ))}
                                                    {uasExams.map((oe, i) => (
                                                        <th key={oe.id} title={oe.title} className="px-2 py-3 text-center text-text-secondary font-bold min-w-[72px]">
                                                            <div className="flex flex-col items-center gap-1">
                                                                <span className="px-2 py-1 text-xs rounded-full bg-purple-500/10 text-purple-600 border border-purple-200">UAS{uasExams.length > 1 ? i + 1 : ''}</span>
                                                                <span className="text-[10px] font-medium text-text-secondary/80 leading-tight line-clamp-2 break-words max-w-[90px]">{oe.title}</span>
                                                            </div>
                                                        </th>
                                                    ))}
                                                    <th className="px-6 py-4 text-center text-primary font-bold min-w-[80px]">Rata-rata</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-secondary/10">
                                                {students.map((student) => {
                                                    const avg = calculateAverage(student.id)
                                                    return (
                                                        <tr key={student.id} className="hover:bg-secondary/5 transition-colors">
                                                            <td className="px-6 py-4 sticky left-0 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-sm z-10 border-r border-secondary/10">
                                                                <p className="text-text-main dark:text-white font-bold truncate max-w-[180px]">{student.user.full_name}</p>
                                                                <p className="text-xs text-text-secondary">{student.nis}</p>
                                                            </td>
                                                            {tugasAssignments.map(a => {
                                                                const sub = allSubmissions.find(s => s.student?.id === student.id && s.assignment?.id === a.id)
                                                                const score = sub?.grade?.[0]?.score
                                                                return (
                                                                    <td key={a.id} className="px-4 py-4 text-center">
                                                                        {editingColumnId === a.id ? (
                                                                            <input
                                                                                type="number"
                                                                                min={0}
                                                                                max={100}
                                                                                value={draftScores[student.id] ?? ''}
                                                                                onChange={(e) => setDraftScores({ ...draftScores, [student.id]: e.target.value })}
                                                                                className="w-16 px-2 py-1.5 text-center border border-primary/40 rounded-lg bg-white dark:bg-surface-dark text-text-main dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-primary"
                                                                            />
                                                                        ) : score !== undefined ? (
                                                                            <button
                                                                                onClick={() => setCellDetail({ title: a.title, category: categoryLabel(a.type), studentName: student.user.full_name, nis: student.nis, score, date: sub?.grade?.[0]?.graded_at || sub?.submitted_at || null, source: 'ASSIGNMENT', refId: a.id, studentId: student.id })}
                                                                                className="text-text-main dark:text-white font-bold hover:text-primary hover:underline transition-colors cursor-pointer"
                                                                                title="Klik untuk detail"
                                                                            >
                                                                                {score}
                                                                            </button>
                                                                        ) : sub ? (
                                                                            <span className="text-amber-500 flex justify-center"><TimeCircle set="bold" primaryColor="currentColor" size={16} /></span>
                                                                        ) : (
                                                                            <span className="text-text-secondary/30">-</span>
                                                                        )}
                                                                    </td>
                                                                )
                                                            })}
                                                            {quizzes.map(q => {
                                                                const qs = quizSubmissions.find(qs => qs.student_id === student.id && qs.quiz.id === q.id)
                                                                return (
                                                                    <td key={q.id} className="px-4 py-4 text-center">
                                                                        {editingQuizId === q.id ? (
                                                                            <input
                                                                                type="number"
                                                                                min={0}
                                                                                max={100}
                                                                                value={draftScores[student.id] ?? ''}
                                                                                onChange={(e) => setDraftScores({ ...draftScores, [student.id]: e.target.value })}
                                                                                className="w-16 px-2 py-1.5 text-center border border-primary/40 rounded-lg bg-white dark:bg-surface-dark text-text-main dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-primary"
                                                                            />
                                                                        ) : qs?.is_graded ? (
                                                                            <button
                                                                                onClick={() => setCellDetail({ title: q.title, category: 'Kuis', studentName: student.user.full_name, nis: student.nis, score: Math.round((qs.total_score / qs.max_score) * 100), date: qs.submitted_at || null, source: 'QUIZ', refId: q.id, studentId: student.id })}
                                                                                className="text-text-main dark:text-white font-bold hover:text-primary hover:underline transition-colors cursor-pointer"
                                                                                title="Klik untuk detail"
                                                                            >
                                                                                {Math.round((qs.total_score / qs.max_score) * 100)}
                                                                            </button>
                                                                        ) : qs ? (
                                                                            <span className="text-amber-500 flex justify-center"><TimeCircle set="bold" primaryColor="currentColor" size={16} /></span>
                                                                        ) : (
                                                                            <span className="text-text-secondary/30">-</span>
                                                                        )}
                                                                    </td>
                                                                )
                                                            })}
                                                            {exams.map(e => {
                                                                const es = examSubmissions.find(es => es.student?.id === student.id && es.exam.id === e.id)
                                                                return (
                                                                    <td key={e.id} className="px-4 py-4 text-center">
                                                                        {es ? (
                                                                            <button
                                                                                onClick={() => setCellDetail({ title: e.title, category: 'Ulangan', studentName: student.user.full_name, nis: student.nis, score: Math.round((es.total_score / es.max_score) * 100), date: es.submitted_at || null })}
                                                                                className="text-text-main dark:text-white font-bold hover:text-primary hover:underline transition-colors cursor-pointer"
                                                                                title="Klik untuk detail"
                                                                            >
                                                                                {Math.round((es.total_score / es.max_score) * 100)}
                                                                            </button>
                                                                        ) : (
                                                                            <span className="text-text-secondary/30">-</span>
                                                                        )}
                                                                    </td>
                                                                )
                                                            })}
                                                            {ulanganAssignments.map(a => {
                                                                const sub = allSubmissions.find(s => s.student?.id === student.id && s.assignment?.id === a.id)
                                                                const score = sub?.grade?.[0]?.score
                                                                return (
                                                                    <td key={a.id} className="px-4 py-4 text-center">
                                                                        {editingColumnId === a.id ? (
                                                                            <input
                                                                                type="number"
                                                                                min={0}
                                                                                max={100}
                                                                                value={draftScores[student.id] ?? ''}
                                                                                onChange={(e) => setDraftScores({ ...draftScores, [student.id]: e.target.value })}
                                                                                className="w-16 px-2 py-1.5 text-center border border-primary/40 rounded-lg bg-white dark:bg-surface-dark text-text-main dark:text-white font-bold focus:outline-none focus:ring-2 focus:ring-primary"
                                                                            />
                                                                        ) : score !== undefined ? (
                                                                            <button
                                                                                onClick={() => setCellDetail({ title: a.title, category: 'Ulangan', studentName: student.user.full_name, nis: student.nis, score, date: sub?.grade?.[0]?.graded_at || sub?.submitted_at || null, source: 'ASSIGNMENT', refId: a.id, studentId: student.id })}
                                                                                className="text-text-main dark:text-white font-bold hover:text-primary hover:underline transition-colors cursor-pointer"
                                                                                title="Klik untuk detail"
                                                                            >
                                                                                {score}
                                                                            </button>
                                                                        ) : (
                                                                            <span className="text-text-secondary/30">-</span>
                                                                        )}
                                                                    </td>
                                                                )
                                                            })}
                                                            {utsExams.map(oe => {
                                                                const os = officialExamSubs.find(s => s.student_id === student.id && s.exam_id === oe.id)
                                                                return (
                                                                    <td key={oe.id} className="px-4 py-4 text-center">
                                                                        {os?.is_graded ? (
                                                                            <button
                                                                                onClick={() => setCellDetail({ title: oe.title, category: 'UTS', studentName: student.user.full_name, nis: student.nis, score: os.max_score > 0 ? Math.round((os.total_score / os.max_score) * 100) : 0, date: os.submitted_at || null })}
                                                                                className="text-text-main dark:text-white font-bold hover:text-primary hover:underline transition-colors cursor-pointer"
                                                                                title="Klik untuk detail"
                                                                            >
                                                                                {os.max_score > 0 ? Math.round((os.total_score / os.max_score) * 100) : 0}
                                                                            </button>
                                                                        ) : os ? (
                                                                            <span className="text-amber-500 flex justify-center"><TimeCircle set="bold" primaryColor="currentColor" size={16} /></span>
                                                                        ) : (
                                                                            <span className="text-text-secondary/30">-</span>
                                                                        )}
                                                                    </td>
                                                                )
                                                            })}
                                                            {uasExams.map(oe => {
                                                                const os = officialExamSubs.find(s => s.student_id === student.id && s.exam_id === oe.id)
                                                                return (
                                                                    <td key={oe.id} className="px-4 py-4 text-center">
                                                                        {os?.is_graded ? (
                                                                            <button
                                                                                onClick={() => setCellDetail({ title: oe.title, category: 'UAS', studentName: student.user.full_name, nis: student.nis, score: os.max_score > 0 ? Math.round((os.total_score / os.max_score) * 100) : 0, date: os.submitted_at || null })}
                                                                                className="text-text-main dark:text-white font-bold hover:text-primary hover:underline transition-colors cursor-pointer"
                                                                                title="Klik untuk detail"
                                                                            >
                                                                                {os.max_score > 0 ? Math.round((os.total_score / os.max_score) * 100) : 0}
                                                                            </button>
                                                                        ) : os ? (
                                                                            <span className="text-amber-500 flex justify-center"><TimeCircle set="bold" primaryColor="currentColor" size={16} /></span>
                                                                        ) : (
                                                                            <span className="text-text-secondary/30">-</span>
                                                                        )}
                                                                    </td>
                                                                )
                                                            })}
                                                            <td className="px-6 py-4 text-center">
                                                                {avg !== null ? (
                                                                    <span className={`px-2 py-1 rounded-md font-bold text-sm ${avg >= getKkm(selectedTA) ? 'bg-green-500/10 text-green-600' : avg >= getKkm(selectedTA) - 15 ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-600'}`}>
                                                                        {avg}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-text-secondary/30">-</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </Card>
                                </div>
                            )}

                            {/* Tab: Tugas - Links to hasil pages */}
                            {activeTab === 'tugas' && (
                                <div className="space-y-4">
                                    <div className="flex justify-end">
                                        <Button variant="secondary" size="sm" onClick={() => { setNewColumnType('TUGAS'); setShowAddColumn('TUGAS') }} icon={<Plus set="bold" primaryColor="currentColor" size={16} />}>
                                            Kolom Tugas Offline
                                        </Button>
                                    </div>
                                    {tugasAssignments.length === 0 ? (
                                        <EmptyState title="Belum ada tugas" description="Anda belum membuat tugas untuk kelas ini." icon={<div className="text-amber-200"><Edit set="bold" primaryColor="currentColor" size={48} /></div>} />
                                    ) : (
                                        <div className="grid gap-4 md:grid-cols-2">
                                            {tugasAssignments.map(assignment => {
                                                const subs = allSubmissions.filter(s => s.assignment?.id === assignment.id)
                                                const graded = subs.filter(s => s.grade?.length > 0).length
                                                return (
                                                    <Card key={assignment.id} padding="p-5" className="hover:border-amber-500/50 transition-colors">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center">
                                                                <Edit set="bold" primaryColor="currentColor" size={20} />
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {assignment.submission_mode === 'OFFLINE' && (
                                                                    <span className="text-[10px] px-2 py-1 rounded-full font-bold bg-teal-500/10 text-teal-600 border border-teal-200 dark:border-teal-500/20">Offline</span>
                                                                )}
                                                                <span className="text-xs text-text-secondary bg-secondary/10 px-2 py-1 rounded-full font-medium">{assignment.type}</span>
                                                            </div>
                                                        </div>
                                                        <h3 className="text-lg font-bold text-text-main dark:text-white mb-1">{assignment.title}</h3>
                                                        <p className="text-sm text-text-secondary mb-4">{subs.length} submission • {graded} dinilai</p>
                                                        <Link href={`/dashboard/guru/tugas/${assignment.id}/hasil`} className="w-full block">
                                                            <Button size="sm" variant="outline" className="w-full">
                                                                Lihat & Nilai →
                                                            </Button>
                                                        </Link>
                                                    </Card>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Tab: Kuis - Links to hasil pages */}
                            {activeTab === 'kuis' && (
                                <div className="space-y-4">
                                    <div className="flex justify-end">
                                        <Button variant="secondary" size="sm" onClick={() => setShowAddColumn('KUIS')} icon={<Plus set="bold" primaryColor="currentColor" size={16} />}>
                                            Kolom Kuis Offline
                                        </Button>
                                    </div>
                                    {quizzes.length === 0 ? (
                                        <EmptyState title="Belum ada kuis" description="Anda belum membuat kuis untuk kelas ini." icon={<div className="text-purple-200"><Discovery set="bold" primaryColor="currentColor" size={48} /></div>} />
                                    ) : (
                                        <div className="grid gap-4 md:grid-cols-2">
                                            {quizzes.map(quiz => {
                                                const subs = quizSubmissions.filter(qs => qs.quiz.id === quiz.id)
                                                const graded = subs.filter(s => s.is_graded).length
                                                return (
                                                    <Card key={quiz.id} padding="p-5" className="hover:border-purple-500/50 transition-colors">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="w-10 h-10 rounded-full bg-purple-500/10 text-purple-600 flex items-center justify-center">
                                                                <Discovery set="bold" primaryColor="currentColor" size={20} />
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {quiz.submission_mode === 'OFFLINE' && (
                                                                    <span className="text-[10px] px-2 py-1 rounded-full font-bold bg-teal-500/10 text-teal-600 border border-teal-200 dark:border-teal-500/20">Offline</span>
                                                                )}
                                                                <span className="text-xs text-text-secondary bg-secondary/10 px-2 py-1 rounded-full font-medium">KUIS</span>
                                                            </div>
                                                        </div>
                                                        <h3 className="text-lg font-bold text-text-main dark:text-white mb-1">{quiz.title}</h3>
                                                        <p className="text-sm text-text-secondary mb-4">{subs.length} submission • {graded} dinilai</p>
                                                        <Link href={`/dashboard/guru/kuis/${quiz.id}/hasil`} className="w-full block">
                                                            <Button size="sm" variant="outline" className="w-full">
                                                                Lihat Hasil →
                                                            </Button>
                                                        </Link>
                                                    </Card>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Tab: Ulangan - Links to hasil pages */}
                            {activeTab === 'ulangan' && (
                                <div className="space-y-4">
                                    <div className="flex justify-end">
                                        <Button variant="secondary" size="sm" onClick={() => setShowAddColumn('ULANGAN')} icon={<Plus set="bold" primaryColor="currentColor" size={16} />}>
                                            Kolom Ulangan Offline
                                        </Button>
                                    </div>
                                    {exams.length === 0 && ulanganAssignments.length === 0 ? (
                                        <EmptyState title="Belum ada ulangan" description="Anda belum membuat ulangan untuk kelas ini." icon={<div className="text-red-200"><TimeCircle set="bold" primaryColor="currentColor" size={48} /></div>} />
                                    ) : (
                                        <div className="grid gap-4 md:grid-cols-2">
                                            {exams.map(exam => {
                                                const subs = examSubmissions.filter(es => es.exam.id === exam.id)
                                                return (
                                                    <Card key={exam.id} padding="p-5" className="hover:border-red-500/50 transition-colors">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="w-10 h-10 rounded-full bg-red-500/10 text-red-600 flex items-center justify-center">
                                                                <TimeCircle set="bold" primaryColor="currentColor" size={20} />
                                                            </div>
                                                            <span className="text-xs text-text-secondary bg-secondary/10 px-2 py-1 rounded-full font-medium">ULANGAN</span>
                                                        </div>
                                                        <h3 className="text-lg font-bold text-text-main dark:text-white mb-1">{exam.title}</h3>
                                                        <p className="text-sm text-text-secondary mb-4">{subs.length} submission</p>
                                                        <Link href={`/dashboard/guru/ulangan/${exam.id}/hasil`} className="w-full block">
                                                            <Button size="sm" variant="outline" className="w-full">
                                                                Lihat Hasil →
                                                            </Button>
                                                        </Link>
                                                    </Card>
                                                )
                                            })}
                                            {ulanganAssignments.map(assignment => {
                                                const subs = allSubmissions.filter(s => s.assignment?.id === assignment.id)
                                                const graded = subs.filter(s => s.grade?.length > 0).length
                                                return (
                                                    <Card key={assignment.id} padding="p-5" className="hover:border-red-500/50 transition-colors">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="w-10 h-10 rounded-full bg-red-500/10 text-red-600 flex items-center justify-center">
                                                                <TimeCircle set="bold" primaryColor="currentColor" size={20} />
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {assignment.submission_mode === 'OFFLINE' && (
                                                                    <span className="text-[10px] px-2 py-1 rounded-full font-bold bg-teal-500/10 text-teal-600 border border-teal-200 dark:border-teal-500/20">Offline</span>
                                                                )}
                                                                <span className="text-xs text-text-secondary bg-secondary/10 px-2 py-1 rounded-full font-medium">ULANGAN</span>
                                                            </div>
                                                        </div>
                                                        <h3 className="text-lg font-bold text-text-main dark:text-white mb-1">{assignment.title}</h3>
                                                        <p className="text-sm text-text-secondary mb-4">{graded} dari {students.length} siswa dinilai</p>
                                                        <Link href={`/dashboard/guru/tugas/${assignment.id}/hasil`} className="w-full block">
                                                            <Button size="sm" variant="outline" className="w-full">
                                                                Lihat & Nilai →
                                                            </Button>
                                                        </Link>
                                                    </Card>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Tab: UTS/UAS - Links to hasil pages */}
                            {activeTab === 'uts-uas' && (
                                <div className="space-y-4">
                                    {officialExams.length === 0 ? (
                                        <EmptyState title="Belum ada UTS/UAS" description="Belum ada ujian UTS atau UAS untuk mata pelajaran dan kelas ini." icon={<div className="text-indigo-200"><GraduationCap className="w-12 h-12" /></div>} />
                                    ) : (
                                        <div className="grid gap-4 md:grid-cols-2">
                                            {officialExams.map(oe => {
                                                const subs = officialExamSubs.filter(s => s.exam_id === oe.id)
                                                const graded = subs.filter(s => s.is_graded).length
                                                return (
                                                    <Card key={oe.id} padding="p-5" className="hover:border-indigo-500/50 transition-colors">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${oe.exam_type === 'UTS' ? 'bg-indigo-500/10 text-indigo-600' : 'bg-purple-500/10 text-purple-600'}`}>
                                                                <GraduationCap className="w-5 h-5" />
                                                            </div>
                                                            <span className={`text-xs px-2 py-1 rounded-full font-bold ${oe.exam_type === 'UTS' ? 'bg-indigo-500/10 text-indigo-600' : 'bg-purple-500/10 text-purple-600'}`}>{oe.exam_type}</span>
                                                        </div>
                                                        <h3 className="text-lg font-bold text-text-main dark:text-white mb-1">{oe.title}</h3>
                                                        <p className="text-sm text-text-secondary mb-4">{subs.length} submission • {graded} dinilai</p>
                                                        <Link href={`/dashboard/guru/uts-uas/${oe.id}/hasil`} className="w-full block">
                                                            <Button size="sm" variant="outline" className="w-full">
                                                                Lihat Hasil →
                                                            </Button>
                                                        </Link>
                                                    </Card>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Tab: Export */}
                            {activeTab === 'export' && (
                                <Card padding="p-4 md:p-8" className="text-center flex flex-col items-center justify-center min-h-[400px]">
                                    <div className="w-20 h-20 bg-blue-500/10 text-blue-600 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-blue-500/10">
                                        <Download set="bold" primaryColor="currentColor" size={40} />
                                    </div>
                                    <h3 className="text-xl md:text-2xl font-bold text-text-main dark:text-white mb-2">Export Nilai ke Excel</h3>
                                    <p className="text-text-secondary mb-8 max-w-lg">
                                        Download rekap nilai dalam format buku nilai untuk kelas <span className="text-text-main dark:text-white font-bold">{selectedTAData?.class.name}</span> - <span className="text-text-main dark:text-white font-bold">{selectedTAData?.subject.name}</span>
                                    </p>

                                    <div className="bg-secondary/5 rounded-2xl p-6 mb-8 max-w-md w-full text-left border border-secondary/10">
                                        <p className="text-sm text-text-secondary mb-3 uppercase tracking-wider font-bold">Format export meliputi:</p>
                                        <ul className="text-sm text-text-main dark:text-white space-y-3">
                                            <li className="flex items-center gap-3"><span className="text-success"><TickSquare set="bold" primaryColor="currentColor" size={16} /></span> Nama dan NIS siswa</li>
                                            <li className="flex items-center gap-3"><span className="text-success"><TickSquare set="bold" primaryColor="currentColor" size={16} /></span> Nilai Tugas (T1, T2, ...)</li>
                                            <li className="flex items-center gap-3"><span className="text-success"><TickSquare set="bold" primaryColor="currentColor" size={16} /></span> Nilai Kuis (K1, K2, ...)</li>
                                            <li className="flex items-center gap-3"><span className="text-success"><TickSquare set="bold" primaryColor="currentColor" size={16} /></span> Nilai Ulangan (U1, U2, ...)</li>
                                            <li className="flex items-center gap-3"><span className="text-success"><TickSquare set="bold" primaryColor="currentColor" size={16} /></span> Nilai UTS</li>
                                            <li className="flex items-center gap-3"><span className="text-success"><TickSquare set="bold" primaryColor="currentColor" size={16} /></span> Nilai UAS</li>
                                            <li className="flex items-center gap-3"><span className="text-success"><TickSquare set="bold" primaryColor="currentColor" size={16} /></span> Rata-rata nilai</li>
                                        </ul>
                                    </div>

                                    <Button
                                        onClick={handleExport}
                                        disabled={students.length === 0}
                                        className="px-8 py-4 text-lg bg-gradient-to-r from-emerald-500 to-green-600 shadow-xl shadow-green-500/20 hover:shadow-green-500/30 text-white border-0"
                                    >
                                        Download Excel
                                    </Button>
                                </Card>
                            )}
                        </>
                    )}
                </>
            )}

            {loading && <div className="text-center text-text-secondary py-8">Memuat...</div>}

            {/* Modal: Tambah Kolom Penilaian Offline */}
            <Modal
                open={!!showAddColumn}
                onClose={() => setShowAddColumn(null)}
                title={showAddColumn === 'ULANGAN' ? 'Tambah Kolom Ulangan' : showAddColumn === 'KUIS' ? 'Tambah Kolom Kuis' : 'Tambah Kolom Tugas'}
                subtitle="Kolom penilaian untuk tugas/kuis/ulangan yang dilaksanakan di luar LMS"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Penilaian</label>
                        <input
                            type="text"
                            value={newColumnTitle}
                            onChange={(e) => setNewColumnTitle(e.target.value)}
                            placeholder={showAddColumn === 'ULANGAN' ? 'cth: Ulangan Harian Bab 3 (kertas)' : showAddColumn === 'KUIS' ? 'cth: Kuis Kosakata (lisan)' : 'cth: Praktik Membaca Puisi'}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            autoFocus
                        />
                    </div>
                    {showAddColumn === 'TUGAS' && (
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jenis</label>
                            <select
                                value={newColumnType}
                                onChange={(e) => setNewColumnType(e.target.value)}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                <option value="TUGAS">Tugas</option>
                                <option value="PR">PR</option>
                                <option value="PROYEK">Proyek</option>
                                <option value="LATIHAN">Latihan</option>
                            </select>
                        </div>
                    )}
                    <p className="text-xs text-text-secondary bg-secondary/5 border border-secondary/10 rounded-xl p-3">
                        Kolom ini langsung muncul di tabel Rekap. Setelah dibuat, klik ikon pensil di header kolom untuk menginput nilai seluruh siswa sekaligus. Nilai tersimpan sebagai riwayat dan otomatis masuk rata-rata, export Excel, dan halaman nilai siswa.
                    </p>
                    <div className="flex gap-3 pt-2">
                        <Button variant="secondary" onClick={() => setShowAddColumn(null)} className="flex-1">
                            Batal
                        </Button>
                        <Button onClick={handleAddColumn} loading={savingColumn} disabled={!newColumnTitle.trim()} className="flex-1">
                            Buat Kolom
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Modal: Detail Sel Nilai */}
            <Modal
                open={!!cellDetail}
                onClose={() => setCellDetail(null)}
                title="Detail Nilai"
            >
                {cellDetail && (
                    <div className="space-y-4">
                        <div>
                            <p className="text-xs text-text-secondary uppercase tracking-wider font-bold mb-1">Penilaian</p>
                            <p className="text-lg font-bold text-text-main dark:text-white">{cellDetail.title}</p>
                            <span className="inline-block mt-1 px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs font-bold">{cellDetail.category}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 border-t border-secondary/10 pt-4">
                            <div>
                                <p className="text-xs text-text-secondary uppercase tracking-wider font-bold mb-1">Siswa</p>
                                <p className="font-bold text-text-main dark:text-white">{cellDetail.studentName}</p>
                                <p className="text-xs text-text-secondary font-mono">{cellDetail.nis}</p>
                            </div>
                            <div>
                                <p className="text-xs text-text-secondary uppercase tracking-wider font-bold mb-1">Nilai</p>
                                <p className="text-2xl font-black text-primary">{cellDetail.score ?? '-'}</p>
                            </div>
                        </div>
                        {cellDetail.date && (
                            <p className="text-xs text-text-secondary border-t border-secondary/10 pt-3">
                                Dinilai pada {new Date(cellDetail.date).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                        )}

                        {/* Riwayat perubahan nilai (kolom yang diinput manual guru) */}
                        {cellDetail.source && (
                            <div className="border-t border-secondary/10 pt-3">
                                <p className="text-xs text-text-secondary uppercase tracking-wider font-bold mb-2">Riwayat Perubahan</p>
                                {loadingHistory ? (
                                    <p className="text-xs text-text-secondary">Memuat riwayat...</p>
                                ) : cellHistory.length === 0 ? (
                                    <p className="text-xs text-text-secondary">Belum ada perubahan tercatat.</p>
                                ) : (
                                    <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                        {cellHistory.map(h => (
                                            <div key={h.id} className="flex items-center justify-between text-xs bg-secondary/5 rounded-lg px-3 py-2">
                                                <span className="font-bold text-text-main dark:text-white">
                                                    {h.old_score === null ? 'Diberi nilai' : `${h.old_score} →`} {h.new_score}
                                                </span>
                                                <span className="text-text-secondary text-right">
                                                    {h.changed_by_name || 'Guru'} • {new Date(h.changed_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <Button variant="secondary" onClick={() => setCellDetail(null)} className="w-full">
                            Tutup
                        </Button>
                    </div>
                )}
            </Modal>

            {/* Export Success Toast */}
            {exportSuccess && (
                <div className="fixed bottom-6 right-6 z-50 animate-[slideUp_0.3s_ease-out]">
                    <div className="flex items-center gap-3 bg-white dark:bg-surface-dark border border-primary/30 shadow-2xl shadow-primary/20 rounded-2xl px-6 py-4">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <TickSquare set="bold" primaryColor="#10B981" size={24} />
                        </div>
                        <div>
                            <p className="text-text-main dark:text-white font-bold">Export Berhasil! ✅</p>
                            <p className="text-sm text-text-secondary">File Excel telah diunduh ke perangkat Anda</p>
                        </div>
                        <button
                            onClick={() => setExportSuccess(false)}
                            className="ml-2 text-text-secondary hover:text-text-main transition-colors"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
