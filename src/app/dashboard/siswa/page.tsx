'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { TimeCircle as Clock, Danger, Calendar, Document, Edit, ArrowRight, Notification } from 'react-iconly'
import { PartyPopper, GraduationCap, Loader2, Megaphone } from 'lucide-react'

interface StudentData {
    id: string
    nis: string | null
    class: { id: string; name: string } | null
}

interface DeadlineItem {
    id: string
    type: 'TUGAS' | 'ULANGAN' | 'KUIS'
    title: string
    subject: string
    deadline: string
    link: string
    expirationTime: number
    startTime: number
}

interface ScheduleEntry {
    id: string
    day_of_week: number
    period: number
    time_start: string
    time_end: string
    subject: { id: string; name: string } | null
    teacher: { id: string; user: { full_name: string } } | null
    room: string | null
}

export default function SiswaDashboard() {
    const { user } = useAuth()
    const router = useRouter()
    const [student, setStudent] = useState<StudentData | null>(null)
    const [loading, setLoading] = useState(true)

    // Dashboard Data State
    const [upcomingDeadlines, setUpcomingDeadlines] = useState<DeadlineItem[]>([])
    const [todaySchedule, setTodaySchedule] = useState<ScheduleEntry[]>([])
    const [announcements, setAnnouncements] = useState<any[]>([])

    // Resume Modal State
    const [resumeItem, setResumeItem] = useState<{
        type: 'Kuis' | 'Ulangan'
        title: string
        link: string
        remainingTime?: string
    } | null>(null)
    const [showResumeModal, setShowResumeModal] = useState(false)

    // Promotion Popup State
    const [promotionInfo, setPromotionInfo] = useState<{ fromClass: string; toClass: string } | null>(null)
    const [showPromotionPopup, setShowPromotionPopup] = useState(false)

    useEffect(() => {
        if (user && user.role !== 'SISWA') {
            router.replace('/dashboard')
        }
    }, [user, router])

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch student data first to get class_id
                const studentsRes = await fetch('/api/students')
                const students = await studentsRes.json()
                const myStudent = students.find((s: { user: { id: string } }) => s.user.id === user?.id)
                setStudent(myStudent || null)

                // Check for promotion status (unchanged)
                if (myStudent) {
                    try {
                        const enrollRes = await fetch(`/api/student-enrollments?student_id=${myStudent.id}`)
                        if (enrollRes.ok) {
                            const enrollments = await enrollRes.json()
                            const promotedEnrollment = enrollments.find((e: { status: string }) => e.status === 'PROMOTED')
                            if (promotedEnrollment) {
                                const storageKey = `promotion_seen_${myStudent.id}_${promotedEnrollment.id}`
                                if (!localStorage.getItem(storageKey)) {
                                    setPromotionInfo({
                                        fromClass: promotedEnrollment.class?.name || 'Kelas Sebelumnya',
                                        toClass: myStudent.class?.name || 'Kelas Baru'
                                    })
                                    setShowPromotionPopup(true)
                                    localStorage.setItem(storageKey, 'true')
                                }
                            }
                        }
                    } catch (err) {
                        console.error('Error checking promotion:', err)
                    }
                }

                if (myStudent?.class?.id) {
                    // Fetch Deadlines & Schedule in parallel
                    const [assignmentsRes, examsRes, quizzesRes, submissionsRes, examSubmissionsRes, quizSubmissionsRes, scheduleRes] = await Promise.all([
                        fetch('/api/assignments'),
                        fetch('/api/exams'),
                        fetch('/api/quizzes'),
                        fetch(`/api/submissions?student_id=${myStudent.id}`),
                        fetch(`/api/exam-submissions?student_id=${myStudent.id}`),
                        fetch(`/api/quiz-submissions?student_id=${myStudent.id}`),
                        fetch('/api/schedules/student-schedule')
                    ])

                    const assignmentsData = await assignmentsRes.json()
                    const examsData = await examsRes.json()
                    const quizzesData = await quizzesRes.json()
                    const submissionsData = await submissionsRes.json()
                    const examSubmissionsData = await examSubmissionsRes.json()
                    const quizSubmissionsData = await quizSubmissionsRes.json()
                    const scheduleData = await scheduleRes.json()

                    setTodaySchedule(Array.isArray(scheduleData) ? scheduleData : [])

                    // Fetch announcements
                    try {
                        const annRes = await fetch(`/api/announcements?class_id=${myStudent.class.id}&limit=5`)
                        const annData = await annRes.json()
                        setAnnouncements(Array.isArray(annData) ? annData : [])
                    } catch (err) {
                        console.error('Error fetching announcements:', err)
                    }

                    const assignments = Array.isArray(assignmentsData) ? assignmentsData : []
                    const exams = Array.isArray(examsData) ? examsData : []
                    const quizzes = Array.isArray(quizzesData) ? quizzesData : []
                    const assignmentSubmissions = Array.isArray(submissionsData) ? submissionsData : []
                    const examSubmissions = Array.isArray(examSubmissionsData) ? examSubmissionsData : []
                    const quizSubmissions = Array.isArray(quizSubmissionsData) ? quizSubmissionsData : []

                    const nowTime = new Date().getTime()
                    const newDeadlines: DeadlineItem[] = []

                    // Process Assignments — show ALL that haven't been submitted (deadline not passed)
                    assignments.forEach((a: any) => {
                        if (a.teaching_assignment?.class?.id !== myStudent.class.id) return
                        if (assignmentSubmissions.some((s: any) => s.assignment_id === a.id)) return

                        const expirationTime = a.due_date ? new Date(a.due_date).getTime() : nowTime + 999999999
                        const startTime = new Date(a.created_at || Date.now() - 86400000).getTime()

                        // Show if deadline hasn't passed (or no deadline set)
                        if (!a.due_date || expirationTime > nowTime) {
                            newDeadlines.push({
                                id: a.id,
                                type: 'TUGAS',
                                title: a.title,
                                subject: a.teaching_assignment?.subject?.name || 'Mapel',
                                deadline: a.due_date || '',
                                link: '/dashboard/siswa/tugas',
                                expirationTime,
                                startTime
                            })
                        }
                    })

                    // Process Exams — show ALL active & not submitted, with remaining time
                    exams.forEach((e: any) => {
                        if (e.teaching_assignment?.class?.id !== myStudent.class.id) return
                        if (examSubmissions.some((s: any) => s.exam_id === e.id && s.is_submitted)) return
                        if (!e.is_active) return

                        const startTime = new Date(e.start_time).getTime()
                        const endTime = startTime + (e.duration_minutes * 60 * 1000)

                        // Show if exam hasn't ended yet
                        if (endTime > nowTime) {
                            const isStarted = startTime <= nowTime
                            const countdownTarget = isStarted ? endTime : startTime

                            newDeadlines.push({
                                id: e.id,
                                type: 'ULANGAN',
                                title: e.title,
                                subject: e.teaching_assignment?.subject?.name || 'Mapel',
                                deadline: new Date(startTime).toISOString(),
                                link: `/dashboard/siswa/ulangan/${e.id}`,
                                expirationTime: countdownTarget,
                                startTime
                            })
                        }
                    })

                    // Process Quizzes — show ALL active & not submitted
                    quizzes.forEach((q: any) => {
                        if (q.teaching_assignment?.class?.id !== myStudent.class.id) return
                        if (quizSubmissions.some((s: any) => s.quiz_id === q.id && s.submitted_at)) return
                        if (!q.is_active) return

                        // Use the deadline field from DB
                        const deadlineTime = q.deadline ? new Date(q.deadline).getTime() : 0

                        // If there's a deadline and it has passed, don't show
                        if (deadlineTime > 0 && deadlineTime <= nowTime) return

                        newDeadlines.push({
                            id: q.id,
                            type: 'KUIS',
                            title: q.title,
                            subject: q.teaching_assignment?.subject?.name || 'Mapel',
                            deadline: q.deadline || '',
                            link: `/dashboard/siswa/kuis/${q.id}`,
                            expirationTime: deadlineTime || nowTime + 999999999,
                            startTime: deadlineTime || nowTime
                        })
                    })

                    // Sort: ongoing items first, then by expiration time
                    newDeadlines.sort((a, b) => {
                        const aOngoing = a.startTime <= nowTime
                        const bOngoing = b.startTime <= nowTime
                        if (aOngoing && !bOngoing) return -1
                        if (!aOngoing && bOngoing) return 1
                        return a.expirationTime - b.expirationTime
                    })
                    setUpcomingDeadlines(newDeadlines)
                }

            } catch (error) {
                console.error('Error:', error)
            } finally {
                setLoading(false)
            }
        }
        if (user) fetchData()
    }, [user])

    // Check for incomplete assessments logic (unchanged)
    useEffect(() => {
        if (!user || user.role !== 'SISWA') return

        const checkIncomplete = async () => {
            try {
                const studentsRes = await fetch('/api/students')
                const students = await studentsRes.json()
                const myStudent = students.find((s: any) => s.user.id === user.id)

                if (!myStudent) return

                const [quizRes, examRes] = await Promise.all([
                    fetch(`/api/quiz-submissions?student_id=${myStudent.id}`),
                    fetch(`/api/exam-submissions?student_id=${myStudent.id}`)
                ])

                const quizzes = await quizRes.json()
                const exams = await examRes.json()

                let foundResumeItem = null

                if (Array.isArray(exams)) {
                    for (const e of exams) {
                        if (!e.is_submitted && e.exam?.is_active) {
                            const startedAt = new Date(e.started_at).getTime()
                            const durationMs = (e.exam.duration_minutes || 0) * 60 * 1000
                            const now = Date.now()
                            const isExpired = now > (startedAt + durationMs + 60000)

                            if (isExpired) {
                                await fetch('/api/exam-submissions', {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        submission_id: e.id,
                                        submit: true
                                    })
                                })
                            } else if (!foundResumeItem) {
                                foundResumeItem = {
                                    type: 'Ulangan' as const,
                                    title: e.exam?.title || 'Ulangan Tanpa Judul',
                                    link: `/dashboard/siswa/ulangan/${e.exam_id}`,
                                }
                            }
                        }
                    }
                }

                if (Array.isArray(quizzes)) {
                    for (const q of quizzes) {
                        if (!q.submitted_at && q.quiz?.is_active) {
                            const startedAt = new Date(q.started_at).getTime()
                            const durationMs = (q.quiz.duration_minutes || 0) * 60 * 1000
                            const now = Date.now()
                            const isExpired = now > (startedAt + durationMs + 60000)

                            if (isExpired) {
                                await fetch('/api/quiz-submissions', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        quiz_id: q.quiz_id,
                                        answers: [],
                                        submit: true
                                    })
                                })
                            } else if (!foundResumeItem) {
                                foundResumeItem = {
                                    type: 'Kuis' as const,
                                    title: q.quiz?.title || 'Kuis Tanpa Judul',
                                    link: `/dashboard/siswa/kuis/${q.quiz_id}`
                                }
                            }
                        }
                    }
                }

                if (foundResumeItem) {
                    setResumeItem(foundResumeItem)
                    setShowResumeModal(true)
                }
            } catch (error) { }
        }
        checkIncomplete()
    }, [user])

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric'
        })
    }

    const formatHour = (dateString: string) => {
        return new Date(dateString).toLocaleTimeString('id-ID', {
            hour: '2-digit', minute: '2-digit'
        })
    }

    // Auto-refresh state every minute for real-time countdowns
    const [currentTimeMs, setCurrentTimeMs] = useState<number>(Date.now())
    useEffect(() => {
        const interval = setInterval(() => setCurrentTimeMs(Date.now()), 60000)
        return () => clearInterval(interval)
    }, [])

    // UI helpers
    const getCountdownText = (item: DeadlineItem, nowMs: number) => {
        // Items without deadline
        if (!item.deadline) {
            if (item.type === 'KUIS') return '📝 Kerjakan kapan saja'
            if (item.type === 'TUGAS') return '📝 Belum ada deadline'
        }

        // ULANGAN: show start time / sedang berlangsung
        if (item.type === 'ULANGAN') {
            const startTime = item.startTime
            if (startTime > nowMs) {
                const diffMs = startTime - nowMs
                const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
                const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
                const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

                if (days > 0) return `Mulai ${days} hari ${hours > 0 ? `${hours} jm` : ''} lagi`
                if (hours > 0) return `Mulai ${hours} jm ${minutes > 0 ? `${minutes} mnt` : ''} lagi`
                return `Mulai ${Math.max(1, minutes)} menit lagi`
            }
            return '🔴 Sedang Berlangsung — Kerjakan!'
        }

        // TUGAS & KUIS with deadline: countdown to deadline
        const diffMs = item.expirationTime - nowMs
        if (diffMs <= 0) return 'Waktu Habis'
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
        const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

        if (days > 0) return `Deadline ${days} hari ${hours > 0 ? `${hours} jm` : ''} lagi`
        if (hours > 0) return `Deadline ${hours} jm ${minutes > 0 ? `${minutes} mnt` : ''} lagi`
        return `Deadline ${Math.max(1, minutes)} menit lagi`
    }

    const getUrgencyStyles = (expirationTime: number, nowMs: number) => {
        const diff = expirationTime - nowMs
        if (diff < 6 * 60 * 60 * 1000) {
            return {
                border: 'border-red-500 hover:border-red-600',
                glow: 'bg-red-500/10',
                badge: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400 animate-pulse',
                text: 'text-red-600 dark:text-red-500',
                progressBg: 'bg-red-500',
                iconPulse: true
            }
        } else if (diff < 24 * 60 * 60 * 1000) {
            return {
                border: 'border-amber-400 hover:border-amber-500',
                glow: 'bg-amber-500/10',
                badge: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
                text: 'text-amber-600 dark:text-amber-500',
                progressBg: 'bg-amber-500',
                iconPulse: false
            }
        } else {
            return {
                border: 'border-blue-200 hover:border-blue-300 dark:border-blue-900/40 dark:hover:border-blue-800',
                glow: 'bg-transparent',
                badge: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
                text: 'text-blue-600 dark:text-blue-500',
                progressBg: 'bg-blue-500',
                iconPulse: false
            }
        }
    }

    const getProgressPercent = (startTime: number, expirationTime: number, nowMs: number) => {
        const total = expirationTime - startTime
        if (total <= 0) return 100
        const elapsed = nowMs - startTime
        const percent = Math.max(0, Math.min(100, (elapsed / total) * 100))
        return percent
    }

    const now = new Date(currentTimeMs)
    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const isCurrentPeriod = (startTime: string, endTime: string) => {
        return currentTimeStr >= startTime.slice(0, 5) && currentTimeStr < endTime.slice(0, 5)
    }
    const isPastPeriod = (endTime: string) => {
        return currentTimeStr >= endTime.slice(0, 5)
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl lg:text-4xl font-black text-text-main dark:text-white tracking-tight">
                        Halo, <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">{user?.full_name?.split(' ')[0] || 'Siswa'}</span> 👋
                    </h1>
                    <p className="text-text-secondary dark:text-zinc-400 mt-2 font-medium">
                        Siap untuk belajar hari ini? Berikut ringkasan jadwal dan tugasmu.
                    </p>
                </div>
                <div className="bg-white dark:bg-surface-dark px-4 py-2 rounded-2xl shadow-sm border border-black/5 dark:border-white/5 flex items-center gap-3 w-max">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                        <Calendar set="bold" size={20} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">{now.toLocaleDateString('id-ID', { weekday: 'long' })}</p>
                        <p className="font-bold text-text-main dark:text-white">{now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                {/* Left Column: Upcoming Deadlines */}
                <div className="xl:col-span-7 space-y-6">
                    <div className="flex items-center justify-between border-b-2 border-amber-500/20 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl text-white shadow-lg shadow-amber-500/20">
                                <Danger set="bold" size={24} />
                            </div>
                            <h2 className="text-2xl font-bold text-text-main dark:text-white tracking-tight">Belum Dikerjakan</h2>
                        </div>
                        {!loading && upcomingDeadlines.length > 0 && (
                            <div className="bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 text-xs font-bold px-3 py-1.5 rounded-full border border-amber-200 dark:border-amber-800 animate-pulse">
                                {upcomingDeadlines.length} Item
                            </div>
                        )}
                    </div>

                    {!loading && upcomingDeadlines.length === 0 ? (
                        <div className="h-64 flex flex-col items-center justify-center text-center p-8 bg-gradient-to-br from-emerald-50/50 to-transparent dark:from-emerald-900/10 dark:to-transparent rounded-3xl border border-emerald-100 dark:border-emerald-900/30">
                            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            </div>
                            <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Semua Sudah Dikerjakan!</h3>
                            <p className="text-text-secondary dark:text-zinc-400">Keren, {user?.full_name?.split(' ')[0]}! Semua tugas, kuis, dan ulangan sudah selesai. 💪</p>
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {upcomingDeadlines.map((item) => {
                                const styles = getUrgencyStyles(item.expirationTime, currentTimeMs)
                                const progress = getProgressPercent(item.startTime, item.expirationTime, currentTimeMs)
                                const countdownText = getCountdownText(item, currentTimeMs)

                                return (
                                    <Link key={item.id} href={item.link}>
                                        <div className={`group h-full bg-white/70 dark:bg-surface-dark/70 backdrop-blur-xl border ${styles.border} rounded-2xl p-5 shadow-sm hover:shadow-md transition-all relative overflow-hidden flex flex-col`}>
                                            {/* Status Glow */}
                                            <div className={`absolute top-0 right-0 w-32 h-32 ${styles.glow} rounded-bl-full -z-10 transition-transform group-hover:scale-110`}></div>

                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-1">
                                                <div className="max-w-[70%]">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${styles.badge}`}>
                                                            {item.type}
                                                        </span>
                                                        <span className={`text-xs font-bold flex items-center gap-1 ${styles.text}`}>
                                                            <span className={styles.iconPulse ? "animate-pulse" : ""}>
                                                                <Clock set="bold" size={12} />
                                                            </span>
                                                            {countdownText}
                                                        </span>
                                                    </div>
                                                    <h3 className="font-bold text-lg text-text-main dark:text-white mb-1 line-clamp-1 group-hover:text-primary transition-colors">
                                                        {item.title}
                                                    </h3>
                                                    <div className="flex items-center gap-3 text-sm text-text-secondary dark:text-zinc-400">
                                                        <span className="flex items-center gap-1 bg-secondary/10 px-2 py-0.5 rounded-md text-xs">
                                                            <Document set="bold" size={12} /> {item.subject}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2">
                                                    <div className="text-sm font-bold text-text-secondary dark:text-zinc-500 text-right">
                                                        {item.deadline ? (
                                                            <>{formatDate(item.deadline)} <br className="hidden sm:block" /> <span className="text-xs">{formatHour(item.deadline)}</span></>
                                                        ) : (
                                                            <span className="text-xs text-blue-500 dark:text-blue-400">Tanpa Batas Waktu</span>
                                                        )}
                                                    </div>
                                                    <button className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-secondary/10 text-text-secondary group-hover:bg-primary group-hover:text-white transition-colors">
                                                        <ArrowRight size={16} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Progress Bar — only for items with a deadline/time */}
                                            {item.deadline && (
                                                <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5">
                                                    <div className="w-full bg-secondary/20 rounded-full h-1.5 overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full transition-all duration-1000 ${styles.progressBg}`}
                                                            style={{ width: `${progress}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </Link>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Right Column: Today's Schedule (Timeline Style) */}
                <div className="xl:col-span-5 space-y-6">
                    <div className="flex items-center justify-between border-b-2 border-blue-500/20 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl text-white shadow-lg shadow-blue-500/20">
                                <Calendar set="bold" size={24} />
                            </div>
                            <h2 className="text-2xl font-bold text-text-main dark:text-white tracking-tight">Pelajaran Hari Ini</h2>
                        </div>
                    </div>

                    {!loading && todaySchedule.length === 0 ? (
                        <div className="h-64 flex flex-col items-center justify-center text-center p-8 bg-gradient-to-br from-secondary/10 to-transparent rounded-3xl border border-secondary/20">
                            <div className="w-16 h-16 bg-white dark:bg-surface-dark text-secondary rounded-full flex items-center justify-center mb-4 shadow-sm">
                                <Calendar set="light" size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Libur / Bebas Kelas!</h3>
                            <p className="text-text-secondary dark:text-zinc-400">Tidak ada jadwal pelajaran untuk hari ini.</p>
                        </div>
                    ) : (
                        <div className="relative pl-6 lg:pl-8 space-y-6">
                            {/* Timeline Line */}
                            <div className="absolute left-0 top-2 bottom-6 w-0.5 bg-gradient-to-b from-blue-500/50 via-blue-500/20 to-transparent rounded-full ml-[11px] lg:ml-[15px]"></div>

                            {todaySchedule.map((entry, index) => {
                                const current = isCurrentPeriod(entry.time_start, entry.time_end)
                                const past = isPastPeriod(entry.time_end)

                                return (
                                    <div key={entry.id} className={`relative flex flex-col gap-2 group transition-all duration-300 ${past ? 'opacity-60' : ''}`}>
                                        {/* Timeline Dot */}
                                        <div className={`absolute -left-6 lg:-left-8 mt-4 w-6 h-6 rounded-full border-4 flex items-center justify-center z-10 transition-colors ${current
                                            ? 'bg-blue-500 border-blue-500/30 outline outline-4 outline-blue-500/10 animate-pulse'
                                            : past
                                                ? 'bg-zinc-300 dark:bg-zinc-600 border-white dark:border-surface-dark'
                                                : 'bg-white dark:bg-surface-dark border-blue-500'
                                            }`}>
                                            {current && <div className="w-2 h-2 bg-white rounded-full"></div>}
                                        </div>

                                        {/* Class Card (Compact for side column) */}
                                        <div className={`flex flex-col sm:flex-row sm:items-center rounded-2xl p-4 transition-all duration-300 border backdrop-blur-xl ${current
                                            ? 'bg-gradient-to-br from-blue-500/10 to-transparent border-blue-500/30 shadow-lg shadow-blue-500/10 scale-[1.02] transform-origin-left'
                                            : 'bg-white/70 dark:bg-surface-dark/70 border-black/5 dark:border-white/5 shadow-sm'
                                            }`}>

                                            <div className="flex-1 w-full flex items-center justify-between">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className={`text-sm font-black ${current ? 'text-blue-500' : 'text-text-main dark:text-white'}`}>
                                                            {entry.time_start.slice(0, 5)} - {entry.time_end.slice(0, 5)}
                                                        </span>
                                                        {current && (
                                                            <span className="px-2 py-0.5 bg-blue-500 text-white text-[10px] font-bold rounded-full animate-pulse">
                                                                SEKARANG
                                                            </span>
                                                        )}
                                                    </div>
                                                    <h3 className={`text-lg font-bold mb-1 ${current ? 'text-blue-600 dark:text-blue-400' : 'text-text-main dark:text-white'}`}>
                                                        {entry.subject?.name || 'Mata Pelajaran'}
                                                    </h3>
                                                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                                                        <span className="font-medium bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded">
                                                            P{entry.period}
                                                        </span>
                                                        {entry.teacher && (
                                                            <span className="truncate">👩‍🏫 {entry.teacher.user.full_name}</span>
                                                        )}
                                                    </div>
                                                </div>
                                                {entry.room && (
                                                    <div className="flex flex-col items-end justify-center ml-2 border-l border-black/5 dark:border-white/5 pl-4">
                                                        <span className="text-[10px] font-bold text-text-secondary tracking-wider uppercase mb-0.5">Ruang</span>
                                                        <span className="text-xl font-black text-text-main dark:text-white">{entry.room}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Announcements Section */}
            {!loading && announcements.length > 0 && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between border-b-2 border-purple-500/20 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl text-white shadow-lg shadow-purple-500/20">
                                <Megaphone className="w-6 h-6" />
                            </div>
                            <h2 className="text-2xl font-bold text-text-main dark:text-white tracking-tight">Pengumuman</h2>
                        </div>
                        <div className="bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 text-xs font-bold px-3 py-1.5 rounded-full border border-purple-200 dark:border-purple-800">
                            {announcements.length} Pengumuman
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        {announcements.map((ann: any) => (
                            <div key={ann.id} className="bg-white/70 dark:bg-surface-dark/70 backdrop-blur-xl border border-purple-200/50 dark:border-purple-800/30 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                                {/* Decorative glow */}
                                <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-bl-full -z-10"></div>

                                <div className="flex items-start justify-between gap-3 mb-3">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0">
                                            <Notification set="bold" primaryColor="currentColor" size={16} />
                                        </div>
                                        <h3 className="font-bold text-text-main dark:text-white line-clamp-1">{ann.title}</h3>
                                    </div>
                                    {ann.is_global && (
                                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 whitespace-nowrap">
                                            Semua Kelas
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-text-secondary dark:text-zinc-400 line-clamp-3 mb-3 leading-relaxed">{ann.content}</p>
                                <div className="flex items-center justify-between text-xs text-text-secondary dark:text-zinc-500">
                                    <span className="flex items-center gap-1">
                                        <Calendar set="bold" size={12} />
                                        {new Date(ann.published_at || ann.created_at).toLocaleDateString('id-ID', {
                                            day: 'numeric', month: 'long', year: 'numeric'
                                        })}
                                    </span>
                                    {ann.created_by_user && (
                                        <span className="font-medium">oleh {ann.created_by_user.full_name}</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Global Resume Modal (unchanged) */}
            {showResumeModal && resumeItem && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-surface-light dark:bg-surface-dark border-2 border-primary/20 rounded-2xl p-8 w-full max-w-md text-center shadow-2xl relative overflow-hidden">
                        <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/10 rounded-full blur-3xl"></div>
                        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl"></div>

                        <div className="relative">
                            <div className="w-20 h-20 bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner ring-4 ring-white dark:ring-surface-dark">
                                <Clock set="bold" size={40} />
                            </div>
                            <h3 className="text-2xl font-bold text-text-main dark:text-white mb-2">
                                Ada {resumeItem.type} Belum Selesai!
                            </h3>
                            <div className="bg-surface-ground/50 dark:bg-surface-ground/30 rounded-xl p-4 my-6 border border-secondary/10">
                                <p className="text-sm text-text-secondary dark:text-zinc-400 mb-1">
                                    Kamu sedang mengerjakan:
                                </p>
                                <p className="text-lg font-bold text-primary truncate px-2">
                                    {resumeItem.title}
                                </p>
                            </div>
                            <div className="space-y-3">
                                <Link
                                    href={resumeItem.link}
                                    className="w-full block py-3.5 bg-gradient-to-r from-primary to-blue-600 text-white rounded-xl font-bold shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:scale-[1.02] transition-all"
                                >
                                    🚀 Lanjutkan Sekarang
                                </Link>
                                <button
                                    onClick={() => setShowResumeModal(false)}
                                    className="w-full py-3 text-text-secondary hover:text-text-main dark:text-zinc-400 dark:hover:text-white transition-colors"
                                >
                                    Nanti Saja
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Promotion Celebration Popup (unchanged) */}
            {showPromotionPopup && promotionInfo && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-surface-dark rounded-3xl shadow-2xl max-w-sm w-full p-8 text-center relative overflow-hidden">
                        <div className="absolute inset-0 pointer-events-none">
                            {[...Array(20)].map((_, i) => (
                                <div key={i} className="absolute w-2 h-2 rounded-full animate-bounce" style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`, backgroundColor: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'][i % 6], animationDelay: `${Math.random() * 2}s`, animationDuration: `${1 + Math.random()}s` }} />
                            ))}
                        </div>
                        <div className="relative">
                            <div className="flex justify-center gap-3 mb-4">
                                <PartyPopper className="w-10 h-10 text-yellow-500 animate-bounce" />
                                <GraduationCap className="w-12 h-12 text-primary" />
                                <PartyPopper className="w-10 h-10 text-yellow-500 animate-bounce" style={{ animationDelay: '0.5s' }} />
                            </div>
                            <h2 className="text-2xl font-bold text-text-main dark:text-white mb-2">🎉 Selamat Naik Kelas!</h2>
                            <p className="text-text-secondary dark:text-zinc-400 mb-4">Kamu berhasil naik dari <strong>{promotionInfo.fromClass}</strong> ke <strong>{promotionInfo.toClass}</strong>!</p>
                            <p className="text-sm text-text-secondary dark:text-zinc-500 mb-6">Terus semangat belajar ya! 💪</p>
                            <button onClick={() => setShowPromotionPopup(false)} className="w-full py-3.5 bg-gradient-to-r from-primary to-emerald-500 text-white rounded-xl font-bold shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all">
                                Terima Kasih! 🚀
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
