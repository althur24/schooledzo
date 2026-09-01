'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { Chart, Game, Edit, TimeCircle, ArrowLeft, Document } from 'react-iconly'

// Interfaces
interface AssignmentSubmission {
    id: string
    submitted_at: string
    assignment: {
        id: string
        title: string
        type: 'TUGAS' | 'ULANGAN'
        teaching_assignment: {
            subject: { name: string }
        }
    }
    grade: Array<{
        score: number
        feedback: string | null
        graded_at: string
    }>
}

interface QuizSubmission {
    id: string
    submitted_at: string
    total_score: number
    max_score: number
    is_graded: boolean
    quiz: {
        id: string
        title: string
        teaching_assignment: {
            subject: { name: string }
        }
    }
}

interface ExamSubmission {
    id: string
    exam_id: string
    is_submitted: boolean
    submitted_at: string
    total_score: number
    max_score: number
    violation_count: number
    exam: {
        id: string
        title: string
        teaching_assignment: {
            subject: { name: string }
        }
    }
}

interface OfficialExamSubmission {
    id: string
    exam_id: string
    is_submitted: boolean
    submitted_at: string
    total_score: number
    max_score: number
    violation_count: number
    exam: {
        id: string
        title: string
        exam_type: 'UTS' | 'UAS'
        subject: { name: string }
    }
}

interface SubjectGrades {
    subjectName: string
    kuis: QuizSubmission[]
    tugas: AssignmentSubmission[]
    ulangan: (AssignmentSubmission | ExamSubmission)[]
    utsUas: OfficialExamSubmission[]
}

type TabType = 'kuis' | 'tugas' | 'ulangan' | 'utsUas'

export default function SiswaNilaiPage() {
    const { user } = useAuth()
    const [loading, setLoading] = useState(true)
    const [groupedGrades, setGroupedGrades] = useState<SubjectGrades[]>([])

    // UI State
    const [selectedSubject, setSelectedSubject] = useState<SubjectGrades | null>(null)
    const [activeTab, setActiveTab] = useState<TabType>('kuis')

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Get student record
                // user_id WAJIB: tanpa ini guard SISWA di /api/students mengembalikan []
                const studentsRes = await fetch(`/api/students?user_id=${user?.id}`)
                const students = await studentsRes.json()
                const myStudent = students.find((s: { user: { id: string } }) => s.user.id === user?.id)

                if (!myStudent) {
                    setLoading(false)
                    return
                }

                // Fetch all data sources in parallel
                const [submissionsRes, quizSubsRes, examSubsRes, officialSubsRes] = await Promise.all([
                    fetch(`/api/submissions?student_id=${myStudent.id}`),
                    fetch(`/api/quiz-submissions?student_id=${myStudent.id}`),
                    fetch(`/api/exam-submissions?student_id=${myStudent.id}`),
                    fetch(`/api/official-exam-submissions?student_id=${myStudent.id}`)
                ])

                const [submissions, quizSubmissions, examSubmissions, officialSubmissions]: [AssignmentSubmission[], QuizSubmission[], ExamSubmission[], OfficialExamSubmission[]] = await Promise.all([
                    submissionsRes.json(),
                    quizSubsRes.json(),
                    examSubsRes.json(),
                    officialSubsRes.json()
                ])

                // Group by Subject
                const subjectsMap: Record<string, SubjectGrades> = {}

                const getOrInitSubject = (name: string) => {
                    if (!subjectsMap[name]) {
                        subjectsMap[name] = { subjectName: name, kuis: [], tugas: [], ulangan: [], utsUas: [] }
                    }
                    return subjectsMap[name]
                }

                // Process Quiz Submissions
                quizSubmissions.forEach((qs) => {
                    const subjectName = qs.quiz?.teaching_assignment?.subject?.name || 'Lainnya'
                    getOrInitSubject(subjectName).kuis.push(qs)
                })

                // Process Assignment Submissions
                submissions.forEach((sub) => {
                    const subjectName = sub.assignment?.teaching_assignment?.subject?.name || 'Lainnya'
                    const subject = getOrInitSubject(subjectName)
                    if (sub.assignment.type === 'ULANGAN') {
                        subject.ulangan.push(sub)
                    } else {
                        // TUGAS/PR/PROYEK/LATIHAN all count as tugas
                        subject.tugas.push(sub)
                    }
                })

                // Process Exam Submissions (new ulangan system)
                if (Array.isArray(examSubmissions)) {
                    examSubmissions.filter(es => es.is_submitted).forEach((es) => {
                        const subjectName = es.exam?.teaching_assignment?.subject?.name || 'Lainnya'
                        getOrInitSubject(subjectName).ulangan.push(es)
                    })
                }

                // Process Official Exam (UTS/UAS) Submissions
                if (Array.isArray(officialSubmissions)) {
                    officialSubmissions.filter(es => es.is_submitted).forEach((es) => {
                        const subjectName = es.exam?.subject?.name || 'Lainnya'
                        getOrInitSubject(subjectName).utsUas.push(es)
                    })
                }

                setGroupedGrades(Object.values(subjectsMap))

            } catch (error) {
                console.error('Error fetching grades:', error)
            } finally {
                setLoading(false)
            }
        }

        if (user) fetchData()
    }, [user])

    const getScoreColor = (score: number | undefined | null, max: number = 100) => {
        if (score === undefined || score === null || max === 0) {
            return 'text-gray-700 bg-gray-100 dark:text-gray-400 dark:bg-gray-500/20'
        }
        const percentage = (score / max) * 100
        if (percentage >= 80) return 'text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-500/20'
        if (percentage >= 60) return 'text-yellow-700 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-500/20'
        return 'text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-500/20'
    }

    if (loading) {
        return <div className="text-center text-slate-400 py-8">Memuat nilai...</div>
    }

    // ==================== VIEW 1: Subject List ====================
    if (!selectedSubject) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <Link href="/dashboard/siswa" className="p-3 rounded-xl bg-white dark:bg-surface-dark border border-secondary/20 hover:border-primary text-text-secondary hover:text-primary transition-all shadow-sm">
                        <ArrowLeft set="bold" primaryColor="currentColor" size={24} />
                    </Link>
                    <div>
                        <div className="flex items-center gap-2">
                            <div className="text-primary flex"><Chart set="bold" primaryColor="currentColor" size="large" /></div>
                            <h1 className="text-xl md:text-2xl font-bold text-text-main dark:text-white">Nilai Saya</h1>
                        </div>
                        <p className="text-text-secondary dark:text-zinc-400">Pilih mata pelajaran untuk lihat detail nilai</p>
                    </div>
                </div>

                {groupedGrades.length === 0 ? (
                    <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-6 md:p-12 text-center text-text-secondary dark:text-zinc-500 shadow-sm flex flex-col items-center gap-4">
                        <div className="text-secondary flex"><Chart set="bold" primaryColor="currentColor" size="xlarge" /></div>
                        Belum ada nilai yang tercatat.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                        {groupedGrades.map((subject) => {
                            const totalItems = (subject.kuis?.length ?? 0) + (subject.tugas?.length ?? 0) + (subject.ulangan?.length ?? 0) + (subject.utsUas?.length ?? 0)
                            return (
                                <button
                                    key={subject.subjectName}
                                    onClick={() => { setSelectedSubject(subject); setActiveTab('kuis'); }}
                                    className="group bg-white dark:bg-surface-dark border-2 border-primary/30 rounded-2xl p-4 md:p-6 hover:border-primary hover:shadow-lg hover:shadow-primary/10 active:scale-[0.98] transition-all text-left relative overflow-hidden cursor-pointer"
                                >
                                    <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>

                                    <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary dark:text-primary-light flex items-center justify-center mb-4 group-hover:scale-110 transition-transform relative z-10">
                                        <Chart set="bold" primaryColor="currentColor" size={24} />
                                    </div>
                                    <h3 className="text-lg font-bold text-text-main dark:text-white mb-1 group-hover:text-primary transition-colors relative z-10">
                                        {subject.subjectName}
                                    </h3>
                                    <p className="text-sm text-text-secondary dark:text-zinc-400 relative z-10">
                                        {totalItems} Nilai Tercatat
                                    </p>
                                    <div className="flex gap-2 mt-4 text-xs relative z-10 flex-wrap">
                                        <span className="px-2 py-1 bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400 rounded-md font-medium">Kuis: {subject.kuis?.length ?? 0}</span>
                                        <span className="px-2 py-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-md font-medium">Tugas: {subject.tugas?.length ?? 0}</span>
                                        <span className="px-2 py-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-md font-medium">Ulangan: {subject.ulangan?.length ?? 0}</span>
                                        <span className="px-2 py-1 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 rounded-md font-medium">UTS/UAS: {subject.utsUas?.length ?? 0}</span>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                )}
            </div>
        )
    }

    // ==================== VIEW 2: Subject Detail with Tabs ====================
    const tabs: { key: TabType; label: string; icon: any; color: string }[] = [
        { key: 'kuis', label: 'Kuis', icon: Game, color: 'purple' },
        { key: 'tugas', label: 'Tugas', icon: Edit, color: 'amber' },
        { key: 'ulangan', label: 'Ulangan', icon: TimeCircle, color: 'red' },
        { key: 'utsUas', label: 'UTS/UAS', icon: Document, color: 'indigo' },
    ]

    const renderQuizList = () => (
        selectedSubject.kuis.length === 0 ? (
            <div className="text-center text-text-secondary dark:text-zinc-500 py-12 bg-white dark:bg-surface-dark rounded-xl border border-secondary/20 border-dashed flex flex-col items-center gap-4">
                <div className="text-secondary flex"><Game set="bold" primaryColor="currentColor" size="xlarge" /></div>
                Belum ada nilai kuis.
            </div>
        ) : (
            <div className="space-y-3">
                {selectedSubject.kuis.map((qs) => (
                    <div key={qs.id} className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-4 flex items-center justify-between shadow-sm">
                        <div>
                            <p className="text-text-main dark:text-white font-bold">{qs.quiz?.title}</p>
                            <p className="text-xs text-text-secondary dark:text-zinc-400">{new Date(qs.submitted_at).toLocaleDateString('id-ID')}</p>
                        </div>
                        {qs.is_graded ? (
                            <span className={`px-3 py-1 rounded-full font-bold text-sm ${getScoreColor(qs.total_score, qs.max_score)}`}>
                                {qs.total_score ?? 0}/{qs.max_score ?? 0}
                            </span>
                        ) : (
                            <span className="px-3 py-1 bg-secondary/10 text-text-secondary rounded-full text-sm font-medium flex items-center gap-1">
                                <TimeCircle set="bold" primaryColor="currentColor" size={14} /> Menunggu
                            </span>
                        )}
                    </div>
                ))}
            </div>
        )
    )

    const renderAssignmentList = (items: AssignmentSubmission[]) => (
        items.length === 0 ? (
            <div className="text-center text-text-secondary dark:text-zinc-500 py-12 bg-white dark:bg-surface-dark rounded-xl border border-secondary/20 border-dashed flex flex-col items-center gap-4">
                <div className="text-secondary flex"><Edit set="bold" primaryColor="currentColor" size="xlarge" /></div>
                Belum ada nilai tugas.
            </div>
        ) : (
            <div className="space-y-3">
                {items.map((sub) => (
                    <div key={sub.id} className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-4 flex items-center justify-between shadow-sm">
                        <div className="flex-1">
                            <p className="text-text-main dark:text-white font-bold">{sub.assignment?.title}</p>
                            <p className="text-xs text-text-secondary dark:text-zinc-400">{new Date(sub.submitted_at).toLocaleDateString('id-ID')}</p>
                            {sub.grade?.[0]?.feedback && (
                                <p className="text-sm text-text-secondary dark:text-zinc-400 mt-2 italic bg-secondary/5 p-2 rounded-lg inline-block border border-secondary/10">" {sub.grade[0].feedback} "</p>
                            )}
                        </div>
                        {sub.grade && sub.grade.length > 0 ? (
                            <span className={`px-3 py-1 rounded-full font-bold text-sm ml-4 ${getScoreColor(sub.grade[0].score)}`}>
                                {sub.grade[0].score ?? 0}
                            </span>
                        ) : (
                            <span className="px-3 py-1 bg-secondary/10 text-text-secondary rounded-full text-sm font-medium ml-4 flex items-center gap-1">
                                <TimeCircle set="bold" primaryColor="currentColor" size={14} /> Menunggu
                            </span>
                        )}
                    </div>
                ))}
            </div>
        )
    )

    // Helper to check if item is ExamSubmission
    const isExamSubmission = (item: AssignmentSubmission | ExamSubmission): item is ExamSubmission => {
        return 'exam' in item && 'max_score' in item
    }

    const renderUlanganList = (items: (AssignmentSubmission | ExamSubmission)[]) => (
        items.length === 0 ? (
            <div className="text-center text-text-secondary dark:text-zinc-500 py-12 bg-white dark:bg-surface-dark rounded-xl border border-secondary/20 border-dashed flex flex-col items-center gap-4">
                <div className="text-secondary flex"><TimeCircle set="bold" primaryColor="currentColor" size="xlarge" /></div>
                Belum ada nilai ulangan.
            </div>
        ) : (
            <div className="space-y-3">
                {items.map((item) => {
                    if (isExamSubmission(item)) {
                        // Render ExamSubmission
                        return (
                            <div key={item.id} className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-4 flex items-center justify-between shadow-sm">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <p className="text-text-main dark:text-white font-bold">{item.exam?.title}</p>
                                        <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-md font-bold">Ulangan</span>
                                    </div>
                                    <p className="text-xs text-text-secondary dark:text-zinc-400">{new Date(item.submitted_at).toLocaleDateString('id-ID')}</p>
                                    {item.violation_count > 0 && (
                                        <p className="text-xs text-red-500 mt-1 font-medium">⚠️ {item.violation_count} pelanggaran</p>
                                    )}
                                </div>
                                <span className={`px-3 py-1 rounded-full font-bold text-sm ${getScoreColor(item.total_score, item.max_score)}`}>
                                    {item.total_score ?? 0}/{item.max_score ?? 0}
                                </span>
                            </div>
                        )
                    } else {
                        // Render AssignmentSubmission
                        return (
                            <div key={item.id} className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-4 flex items-center justify-between shadow-sm">
                                <div className="flex-1">
                                    <p className="text-text-main dark:text-white font-bold">{item.assignment?.title}</p>
                                    <p className="text-xs text-text-secondary dark:text-zinc-400">{new Date(item.submitted_at).toLocaleDateString('id-ID')}</p>
                                    {item.grade?.[0]?.feedback && (
                                        <p className="text-sm text-text-secondary dark:text-zinc-400 mt-2 italic bg-secondary/5 p-2 rounded-lg inline-block border border-secondary/10">" {item.grade[0].feedback} "</p>
                                    )}
                                </div>
                                {item.grade && item.grade.length > 0 ? (
                                    <span className={`px-3 py-1 rounded-full font-bold text-sm ml-4 ${getScoreColor(item.grade[0].score)}`}>
                                        {item.grade[0].score}
                                    </span>
                                ) : (
                                    <span className="px-3 py-1 bg-secondary/10 text-text-secondary rounded-full text-sm font-medium ml-4 flex items-center gap-1">
                                        <TimeCircle set="bold" primaryColor="currentColor" size={14} /> Menunggu
                                    </span>
                                )}
                            </div>
                        )
                    }
                })}
            </div>
        )
    )

    const renderUtsUasList = (items: OfficialExamSubmission[]) => (
        items.length === 0 ? (
            <div className="text-center text-text-secondary dark:text-zinc-500 py-12 bg-white dark:bg-surface-dark rounded-xl border border-secondary/20 border-dashed flex flex-col items-center gap-4">
                <div className="text-secondary flex"><Document set="bold" primaryColor="currentColor" size="xlarge" /></div>
                Belum ada nilai UTS/UAS.
            </div>
        ) : (
            <div className="space-y-3">
                {items.map((item) => (
                    <div key={item.id} className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-4 flex items-center justify-between shadow-sm">
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <p className="text-text-main dark:text-white font-bold">{item.exam?.title}</p>
                                <span className={`px-2 py-0.5 text-xs rounded-md font-bold ${item.exam?.exam_type === 'UTS' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'}`}>
                                    {item.exam?.exam_type}
                                </span>
                            </div>
                            <p className="text-xs text-text-secondary dark:text-zinc-400">{new Date(item.submitted_at).toLocaleDateString('id-ID')}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full font-bold text-sm ${getScoreColor(item.total_score, item.max_score)}`}>
                            {item.total_score ?? 0}/{item.max_score ?? 0}
                        </span>
                    </div>
                ))}
            </div>
        )
    )

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={() => setSelectedSubject(null)}
                    className="p-3 rounded-xl bg-white dark:bg-surface-dark border border-secondary/20 hover:border-primary text-text-secondary hover:text-primary transition-all shadow-sm"
                >
                    <ArrowLeft set="bold" primaryColor="currentColor" size={24} />
                </button>
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-text-main dark:text-white">{selectedSubject.subjectName}</h1>
                    <p className="text-text-secondary dark:text-zinc-400">Detail Nilai</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-secondary/20 pb-2 overflow-x-auto">
                {tabs.map((tab) => {
                    const IconComponent = tab.icon
                    return (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`px-4 py-2 rounded-t-xl font-bold transition-all flex items-center gap-2 whitespace-nowrap ${activeTab === tab.key
                                ? `bg-${tab.color}-50 border-b-2 border-${tab.color}-500 text-${tab.color}-700 dark:bg-${tab.color}-900/20 dark:text-${tab.color}-400`
                                : 'text-text-secondary dark:text-zinc-400 hover:text-text-main hover:bg-secondary/5'
                                }`}
                        >
                            <IconComponent set="bold" primaryColor="currentColor" size={16} />
                            {tab.label}
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ml-1 ${activeTab === tab.key ? `bg-${tab.color}-100 dark:bg-${tab.color}-900/40` : 'bg-secondary/10'
                                }`}>
                                {tab.key === 'kuis' ? (selectedSubject.kuis?.length ?? 0) : tab.key === 'tugas' ? (selectedSubject.tugas?.length ?? 0) : tab.key === 'ulangan' ? (selectedSubject.ulangan?.length ?? 0) : (selectedSubject.utsUas?.length ?? 0)}
                            </span>
                        </button>
                    )
                })}
            </div>

            {/* Tab Content */}
            <div className="min-h-[300px]">
                {activeTab === 'kuis' && renderQuizList()}
                {activeTab === 'tugas' && renderAssignmentList(selectedSubject.tugas)}
                {activeTab === 'ulangan' && renderUlanganList(selectedSubject.ulangan)}
                {activeTab === 'utsUas' && renderUtsUasList(selectedSubject.utsUas)}
            </div>
        </div>
    )
}
