'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, Card, Button, StatsCard, EmptyState } from '@/components/ui'
import { Chart, User, TickSquare, TimeCircle, Activity, Search, ArrowRight, Document, Discovery, Download, Paper, Edit } from 'react-iconly'
import { GraduationCap } from 'lucide-react'

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
    grade: Array<{ score: number }>
}

interface QuizSubmission {
    id: string
    student_id: string
    total_score: number
    max_score: number
    is_graded: boolean
    quiz: { id: string; title: string }
}

interface ExamSubmission {
    id: string
    is_submitted: boolean
    total_score: number
    max_score: number
    student: { id: string }
    exam: { id: string; title: string }
}

interface Assignment {
    id: string
    title: string
    type: string
    teaching_assignment: { id: string }
}

interface Quiz {
    id: string
    title: string
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
}

interface TeachingAssignment {
    id: string
    subject: { id: string; name: string }
    class: { id: string; name: string }
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

    useEffect(() => {
        const fetchInitial = async () => {
            try {
                const res = await fetch('/api/my-teaching-assignments')
                const data = await res.json()
                setTeachingAssignments(Array.isArray(data) ? data : [])
            } catch (error) {
                console.error('Error:', error)
            } finally {
                setLoading(false)
            }
        }
        if (user) fetchInitial()
    }, [user])

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

        const fetchTAData = async () => {
            setLoadingData(true)
            try {
                const ta = teachingAssignments.find(t => t.id === selectedTA)
                if (!ta) return

                // Fetch students in the class
                const studentsRes = await fetch(`/api/students?class_id=${ta.class.id}`)
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
                                exam_id: oe.id
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
        }

        fetchTAData()
    }, [selectedTA, teachingAssignments])

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

    // Export to Excel
    const handleExport = () => {
        const ta = teachingAssignments.find(t => t.id === selectedTA)
        if (!ta) return

        const tugasAssignments = assignments.filter(a => a.type === 'TUGAS')
        const utsExams = officialExams.filter(oe => oe.exam_type === 'UTS')
        const uasExams = officialExams.filter(oe => oe.exam_type === 'UAS')

        let html = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:x='urn:schemas-microsoft-com:office:excel'>
            <head><meta charset='utf-8'><style>
                table { border-collapse: collapse; width: 100%; }
                th, td { border: 1px solid #000; padding: 8px; text-align: center; }
                th { background-color: #4472C4; color: white; }
                .student-name { text-align: left; }
                .avg { background-color: #FFC000; font-weight: bold; }
            </style></head>
            <body>
            <h2 style="text-align:center;">DAFTAR NILAI SISWA</h2>
            <p><strong>Kelas:</strong> ${ta.class.name}</p>
            <p><strong>Mata Pelajaran:</strong> ${ta.subject.name}</p>
            <br/>
            <table>
                <thead>
                    <tr>
                        <th>No</th>
                        <th>NIS</th>
                        <th>Nama Siswa</th>
                        ${tugasAssignments.map((a, i) => `<th>T${i + 1}</th>`).join('')}
                        ${quizzes.map((q, i) => `<th>K${i + 1}</th>`).join('')}
                        ${exams.map((e, i) => `<th>U${i + 1}</th>`).join('')}
                        ${utsExams.map((oe, i) => `<th>UTS${utsExams.length > 1 ? i + 1 : ''}</th>`).join('')}
                        ${uasExams.map((oe, i) => `<th>UAS${uasExams.length > 1 ? i + 1 : ''}</th>`).join('')}
                        <th class="avg">Rata-rata</th>
                    </tr>
                </thead>
                <tbody>
                    ${students.map((student, idx) => {
            const tugasGrades = tugasAssignments.map(a => {
                const sub = allSubmissions.find(s => s.student?.id === student.id && s.assignment?.id === a.id)
                return sub?.grade?.[0]?.score ?? '-'
            })
            const kuisGrades = quizzes.map(q => {
                const qs = quizSubmissions.find(qs => qs.student_id === student.id && qs.quiz.id === q.id)
                return qs?.is_graded ? Math.round((qs.total_score / qs.max_score) * 100) : '-'
            })
            const ulanganGrades = exams.map(e => {
                const es = examSubmissions.find(es => es.student?.id === student.id && es.exam.id === e.id)
                return es ? Math.round((es.total_score / es.max_score) * 100) : '-'
            })
            const utsGrades = utsExams.map(oe => {
                const os = officialExamSubs.find(s => s.student_id === student.id && s.exam_id === oe.id)
                return os?.is_graded && os.max_score > 0 ? Math.round((os.total_score / os.max_score) * 100) : '-'
            })
            const uasGrades = uasExams.map(oe => {
                const os = officialExamSubs.find(s => s.student_id === student.id && s.exam_id === oe.id)
                return os?.is_graded && os.max_score > 0 ? Math.round((os.total_score / os.max_score) * 100) : '-'
            })
            const avg = calculateAverage(student.id)

            return `
                        <tr>
                            <td>${idx + 1}</td>
                            <td>${student.nis}</td>
                            <td class="student-name">${student.user.full_name}</td>
                            ${tugasGrades.map(g => `<td>${g}</td>`).join('')}
                            ${kuisGrades.map(g => `<td>${g}</td>`).join('')}
                            ${ulanganGrades.map(g => `<td>${g}</td>`).join('')}
                            ${utsGrades.map(g => `<td>${g}</td>`).join('')}
                            ${uasGrades.map(g => `<td>${g}</td>`).join('')}
                            <td class="avg">${avg ?? '-'}</td>
                        </tr>
                    `
        }).join('')}
                </tbody>
            </table>
            </body>
            </html>
        `

        const blob = new Blob([html], { type: 'application/vnd.ms-excel' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `Nilai_${ta.class.name}_${ta.subject.name}.xls`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        // Show success toast
        setExportSuccess(true)
        setTimeout(() => setExportSuccess(false), 4000)
    }

    const selectedTAData = teachingAssignments.find(t => t.id === selectedTA)
    const tugasAssignments = assignments.filter(a => a.type === 'TUGAS')
    const utsExams = officialExams.filter(oe => oe.exam_type === 'UTS')
    const uasExams = officialExams.filter(oe => oe.exam_type === 'UAS')

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
                                className="w-full px-5 py-4 pl-12 bg-white dark:bg-surface-dark border border-secondary/20 rounded-full text-text-main dark:text-white text-lg focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
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
                            {filteredTAs.map((ta) => (
                                <Card
                                    key={ta.id}
                                    padding="p-6"
                                    className="hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 transition-all duration-200 cursor-pointer group"
                                    onClick={() => { setSelectedTA(ta.id); setActiveTab('rekap'); setSearchQuery('') }}
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex-1">
                                            <h3 className="text-2xl font-bold text-text-main dark:text-white mb-2 group-hover:text-primary transition-colors">
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
                            { id: 'ulangan', label: `Ulangan (${exams.length})`, icon: TimeCircle, color: 'bg-red-500' },
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
                                <Card padding="p-0" className="overflow-hidden">
                                    <div className="overflow-x-auto custom-scrollbar">
                                        <table className="w-full text-sm">
                                            <thead className="bg-secondary/5 border-b border-secondary/10">
                                                <tr>
                                                    <th className="px-6 py-4 text-left text-text-secondary font-bold sticky left-0 z-10 bg-white/95 dark:bg-surface-dark/95 min-w-[200px]">Nama Siswa</th>
                                                    {tugasAssignments.map((a, i) => (
                                                        <th key={a.id} className="px-4 py-4 text-center text-text-secondary font-bold min-w-[60px]">
                                                            <span className="px-2 py-1 text-xs rounded-full bg-amber-500/10 text-amber-600 border border-amber-200">T{i + 1}</span>
                                                        </th>
                                                    ))}
                                                    {quizzes.map((q, i) => (
                                                        <th key={q.id} className="px-4 py-4 text-center text-text-secondary font-bold min-w-[60px]">
                                                            <span className="px-2 py-1 text-xs rounded-full bg-purple-500/10 text-purple-600 border border-purple-200">K{i + 1}</span>
                                                        </th>
                                                    ))}
                                                    {exams.map((e, i) => (
                                                        <th key={e.id} className="px-4 py-4 text-center text-text-secondary font-bold min-w-[60px]">
                                                            <span className="px-2 py-1 text-xs rounded-full bg-red-500/10 text-red-600 border border-red-200">U{i + 1}</span>
                                                        </th>
                                                    ))}
                                                    {utsExams.map((oe, i) => (
                                                        <th key={oe.id} className="px-4 py-4 text-center text-text-secondary font-bold min-w-[60px]">
                                                            <span className="px-2 py-1 text-xs rounded-full bg-indigo-500/10 text-indigo-600 border border-indigo-200">UTS{utsExams.length > 1 ? i + 1 : ''}</span>
                                                        </th>
                                                    ))}
                                                    {uasExams.map((oe, i) => (
                                                        <th key={oe.id} className="px-4 py-4 text-center text-text-secondary font-bold min-w-[60px]">
                                                            <span className="px-2 py-1 text-xs rounded-full bg-purple-500/10 text-purple-600 border border-purple-200">UAS{uasExams.length > 1 ? i + 1 : ''}</span>
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
                                                                        {score !== undefined ? (
                                                                            <span className="text-text-main dark:text-white font-bold">{score}</span>
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
                                                                        {qs?.is_graded ? (
                                                                            <span className="text-text-main dark:text-white font-bold">
                                                                                {Math.round((qs.total_score / qs.max_score) * 100)}
                                                                            </span>
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
                                                                            <span className="text-text-main dark:text-white font-bold">
                                                                                {Math.round((es.total_score / es.max_score) * 100)}
                                                                            </span>
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
                                                                            <span className="text-text-main dark:text-white font-bold">
                                                                                {os.max_score > 0 ? Math.round((os.total_score / os.max_score) * 100) : 0}
                                                                            </span>
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
                                                                            <span className="text-text-main dark:text-white font-bold">
                                                                                {os.max_score > 0 ? Math.round((os.total_score / os.max_score) * 100) : 0}
                                                                            </span>
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
                                                                    <span className={`px-2 py-1 rounded-md font-bold text-sm ${avg >= 75 ? 'bg-green-500/10 text-green-600' : avg >= 60 ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-600'}`}>
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
                            )}

                            {/* Tab: Tugas - Links to hasil pages */}
                            {activeTab === 'tugas' && (
                                <div className="space-y-4">
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
                                                            <span className="text-xs text-text-secondary bg-secondary/10 px-2 py-1 rounded-full font-medium">{assignment.type}</span>
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
                                                            <span className="text-xs text-text-secondary bg-secondary/10 px-2 py-1 rounded-full font-medium">KUIS</span>
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
                                    {exams.length === 0 ? (
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
                                <Card padding="p-8" className="text-center flex flex-col items-center justify-center min-h-[400px]">
                                    <div className="w-20 h-20 bg-blue-500/10 text-blue-600 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-blue-500/10">
                                        <Download set="bold" primaryColor="currentColor" size={40} />
                                    </div>
                                    <h3 className="text-2xl font-bold text-text-main dark:text-white mb-2">Export Nilai ke Excel</h3>
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
