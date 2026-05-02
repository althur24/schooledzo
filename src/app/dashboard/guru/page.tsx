'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { TimeCircle as Clock, Danger, Calendar, Category, CloseSquare, User } from 'react-iconly'
import { PlayCircle } from 'lucide-react'

interface WarningItem {
    student_id: string
    student_name: string
    class_name: string
    subject_name: string
    avg_score: number
    score_count: number
    teaching_assignment_id?: string
    kkm?: number
}

interface MyClassItem {
    class_id: string
    class_name: string
    subjects: string[]
    isHomeroom: boolean
}

interface WarningsData {
    kkm: number
    teachingWarnings: WarningItem[]
    homeroomWarnings: WarningItem[]
    myClasses: MyClassItem[]
}

interface ScheduleEntry {
    id: string
    day_of_week: number
    period: number
    time_start: string
    time_end: string
    subject: { id: string; name: string } | null
    room: string | null
    schedule: {
        id: string
        class: { id: string; name: string; grade_level: number }
    }
}

export default function GuruDashboard() {
    const { user } = useAuth()
    const router = useRouter()
    const [warnings, setWarnings] = useState<WarningsData | null>(null)
    const [todaySchedule, setTodaySchedule] = useState<ScheduleEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [activeWarningTab, setActiveWarningTab] = useState<'teaching' | 'homeroom'>('teaching')
    const [warningVisibleCount, setWarningVisibleCount] = useState(5)
    const [activeOfficialExams, setActiveOfficialExams] = useState<any[]>([])

    const handleTabChange = (tab: 'teaching' | 'homeroom') => {
        setActiveWarningTab(tab)
        setWarningVisibleCount(5)
    }

    const [selectedClass, setSelectedClass] = useState<{ id: string, name: string } | null>(null)
    const [classStudents, setClassStudents] = useState<any[]>([])
    const [loadingStudents, setLoadingStudents] = useState(false)

    const handleClassClick = async (classId: string, className: string) => {
        setSelectedClass({ id: classId, name: className })
        setLoadingStudents(true)
        try {
            const res = await fetch(`/api/students?class_id=${classId}`)
            const data = await res.json()
            setClassStudents(Array.isArray(data) ? data : [])
        } catch (error) {
            console.error('Failed to fetch students', error)
            setClassStudents([])
        } finally {
            setLoadingStudents(false)
        }
    }

    const closeStudentModal = () => {
        setSelectedClass(null)
        setClassStudents([])
    }

    useEffect(() => {
        if (user && user.role !== 'GURU') {
            router.replace('/dashboard')
        }
    }, [user, router])

    useEffect(() => {
        const fetchDashboardData = async () => {
            try {
                const [warnRes, scheduleRes, examsRes] = await Promise.all([
                    fetch('/api/dashboard/guru/warnings'),
                    fetch('/api/schedules/my-schedule?today=true'),
                    fetch('/api/official-exams')
                ])
                const warnData = await warnRes.json()
                const scheduleData = await scheduleRes.json()
                const examsData = await examsRes.json()

                if (!warnData.error) setWarnings(warnData)
                setTodaySchedule(Array.isArray(scheduleData) ? scheduleData : [])
                
                if (Array.isArray(examsData)) {
                    const nowMs = new Date().getTime()
                    const active = examsData.filter((exam: any) => {
                        const startMs = new Date(exam.start_time).getTime()
                        const endMs = startMs + (exam.duration_minutes * 60 * 1000)
                        return exam.is_active && nowMs >= startMs && nowMs <= endMs
                    })
                    setActiveOfficialExams(active)
                }
            } catch (error) {
                console.error('Error:', error)
            } finally {
                setLoading(false)
            }
        }
        if (user) fetchDashboardData()
    }, [user])

    const now = new Date()
    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const isCurrentPeriod = (startTime: string, endTime: string) => {
        return currentTimeStr >= startTime.slice(0, 5) && currentTimeStr < endTime.slice(0, 5)
    }

    const isPastPeriod = (endTime: string) => {
        return currentTimeStr >= endTime.slice(0, 5)
    }

    const teachingWarnings = warnings?.teachingWarnings || []
    const homeroomWarnings = warnings?.homeroomWarnings || []
    const myClasses = warnings?.myClasses || []

    const activeWarnings = activeWarningTab === 'teaching' ? teachingWarnings : homeroomWarnings

    // Render a single warning card (reused across both tabs)
    const renderWarningCard = (warning: WarningItem, idx: number, tab: 'teaching' | 'homeroom') => (
        <div key={`${warning.student_id}-${warning.subject_name}-${idx}`} className="group flex items-center gap-4 p-4 rounded-2xl bg-white/70 dark:bg-surface-dark/70 backdrop-blur-xl border border-red-100 dark:border-red-900/30 shadow-sm hover:shadow-md hover:border-red-300 dark:hover:border-red-700 transition-all">
            {/* Score Indicator */}
            <div className="relative w-14 h-14 flex items-center justify-center flex-shrink-0">
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <path className="text-red-100 dark:text-red-900/50" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" />
                    <path className="text-red-500" strokeDasharray={`${Math.min(100, Math.max(0, warning.avg_score))}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <span className="font-black text-red-600 dark:text-red-400 text-sm">{Math.round(warning.avg_score)}</span>
            </div>

            <div className="flex-1 min-w-0">
                <h4 className="font-bold text-text-main dark:text-white truncate">
                    {warning.student_name}
                </h4>
                <div className="flex items-center gap-2 mt-1 -mx-1">
                    <span className="px-2 py-0.5 bg-black/5 dark:bg-white/5 rounded text-[10px] font-bold text-text-secondary">
                        {warning.class_name}
                    </span>
                    <span className="px-2 py-0.5 bg-black/5 dark:bg-white/5 rounded text-[10px] font-bold text-text-secondary truncate">
                        {warning.subject_name}
                    </span>
                    {warning.kkm && (
                        <span className="px-2 py-0.5 bg-red-50 dark:bg-red-900/20 rounded text-[10px] font-bold text-red-500">
                            KKM: {warning.kkm}
                        </span>
                    )}
                </div>
            </div>

            {/* Action button */}
            <Link href={tab === 'homeroom' ? `/dashboard/guru/wali-kelas/${warning.student_id}` : `/dashboard/guru/nilai${warning.teaching_assignment_id ? `?ta=${warning.teaching_assignment_id}` : ''}`} className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-500 hover:text-white transition-colors">
                <svg className="w-5 h-5 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Link>
        </div>
    )

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl lg:text-4xl font-black text-text-main dark:text-white tracking-tight">
                        Selamat Datang, <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-400">{user?.full_name?.split(' ')[0] || 'Guru'}</span>
                    </h1>
                    <p className="text-text-secondary dark:text-zinc-400 mt-2 font-medium">
                        Berikut adalah ringkasan jadwal dan peringatan akademik hari ini.
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
                {/* Left Column: Schedule (Timeline Style) & Active Exams */}
                <div className="xl:col-span-7 space-y-6">

                    {/* Active Official Exams Banner */}
                    {activeOfficialExams.length > 0 && (
                        <div className="space-y-4 mb-8">
                            <div className="flex items-center gap-3 border-b-2 border-red-500/20 pb-4">
                                <div className="p-2 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl text-white shadow-lg shadow-red-500/20">
                                    <PlayCircle size={24} strokeWidth={2.5} />
                                </div>
                                <h2 className="text-xl font-bold text-text-main dark:text-white tracking-tight flex items-center gap-2">
                                    Sedang Berlangsung 
                                    <span className="relative flex h-3 w-3">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                                    </span>
                                </h2>
                            </div>
                            
                            <div className="grid gap-4">
                                {activeOfficialExams.map(exam => (
                                    <div key={exam.id} className="relative overflow-hidden group p-6 rounded-2xl bg-gradient-to-br from-red-500/5 to-orange-500/5 border border-red-500/20 shadow-sm transition-all hover:border-red-500/40 hover:shadow-md">
                                        <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
                                        
                                        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center relative z-10">
                                            <div>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className="px-2.5 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-full">
                                                        {exam.exam_type}
                                                    </span>
                                                    <span className="text-xs font-bold text-text-secondary bg-black/5 dark:bg-white/5 px-2.5 py-1 rounded-full">
                                                        {exam.duration_minutes} Menit
                                                    </span>
                                                </div>
                                                <h3 className="text-lg font-black text-text-main dark:text-white group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                                                    {exam.title}
                                                </h3>
                                                <p className="text-sm font-bold text-text-secondary mt-1">{exam.subject?.name}</p>
                                            </div>
                                            
                                            <Link 
                                                href={`/dashboard/guru/uts-uas/${exam.id}/monitor`}
                                                className="w-full sm:w-auto px-5 py-2.5 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-bold text-sm rounded-xl transition-colors shadow-lg shadow-red-500/30 flex items-center justify-center gap-2"
                                            >
                                                Pantau Live 
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                                </svg>
                                            </Link>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-3 border-b-2 border-primary/20 pb-4">
                        <div className="p-2 bg-gradient-to-br from-blue-500 to-primary rounded-xl text-white shadow-lg shadow-primary/20">
                            <Clock set="bold" size={24} />
                        </div>
                        <h2 className="text-2xl font-bold text-text-main dark:text-white tracking-tight">Jadwal Mengajar Hari Ini</h2>
                    </div>

                    {!loading && todaySchedule.length === 0 ? (
                        <div className="h-64 flex flex-col items-center justify-center text-center p-8 bg-gradient-to-br from-blue-50/50 to-transparent dark:from-blue-900/10 dark:to-transparent rounded-3xl border border-blue-100 dark:border-blue-900/30">
                            <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900/30 text-blue-500 rounded-full flex items-center justify-center mb-4">
                                <Clock set="bold" size={40} />
                            </div>
                            <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Tidak Ada Jadwal Mengajar</h3>
                            <p className="text-text-secondary dark:text-zinc-400">Anda tidak memiliki jadwal kelas untuk hari ini. Waktu luang dapat digunakan untuk mengoreksi tugas atau menyiapkan materi.</p>
                        </div>
                    ) : (
                        <div className="relative pl-6 lg:pl-8 space-y-8">
                            {/* Timeline Line */}
                            <div className="absolute left-0 top-2 bottom-6 w-0.5 bg-gradient-to-b from-primary/50 via-primary/20 to-transparent rounded-full ml-[11px] lg:ml-[15px]"></div>

                            {todaySchedule.map((entry, index) => {
                                const current = isCurrentPeriod(entry.time_start, entry.time_end)
                                const past = isPastPeriod(entry.time_end)

                                return (
                                    <div key={entry.id} className={`relative flex flex-col sm:flex-row gap-4 sm:gap-6 group transition-all duration-300 ${past ? 'opacity-60 grayscale-[0.3]' : ''}`}>
                                        {/* Timeline Dot */}
                                        <div className={`absolute -left-6 lg:-left-8 mt-1.5 w-6 h-6 rounded-full border-4 flex items-center justify-center z-10 transition-colors ${current
                                            ? 'bg-primary border-primary/30 outline outline-4 outline-primary/10 animate-pulse'
                                            : past
                                                ? 'bg-zinc-300 dark:bg-zinc-600 border-white dark:border-surface-dark'
                                                : 'bg-white dark:bg-surface-dark border-primary'
                                            }`}>
                                            {current && <div className="w-2 h-2 bg-white rounded-full"></div>}
                                        </div>

                                        {/* Time Block */}
                                        <div className="sm:w-32 flex-shrink-0 pt-1">
                                            <div className={`text-xl font-black ${current ? 'text-primary' : 'text-text-main dark:text-white'}`}>
                                                {entry.time_start.slice(0, 5)}
                                            </div>
                                            <div className="text-sm font-bold text-text-secondary dark:text-zinc-500">
                                                - {entry.time_end.slice(0, 5)}
                                            </div>
                                            <div className="text-xs font-medium text-text-secondary mt-1 bg-black/5 dark:bg-white/5 inline-block px-2 py-0.5 rounded-full">
                                                Jam ke-{entry.period}
                                            </div>
                                        </div>

                                        {/* Class Card */}
                                        <div className={`flex-1 rounded-2xl p-5 md:p-6 transition-all duration-300 border backdrop-blur-xl ${current
                                            ? 'bg-gradient-to-br from-primary/10 to-transparent border-primary/30 shadow-lg shadow-primary/10 scale-[1.02] lg:transform-origin-left'
                                            : 'bg-white/70 dark:bg-surface-dark/70 border-black/5 dark:border-white/5 shadow-sm hover:shadow-md'
                                            }`}>
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                <div>
                                                    <h3 className={`text-xl font-black mb-1 ${current ? 'text-primary' : 'text-text-main dark:text-white'}`}>
                                                        {entry.subject?.name || 'Mata Pelajaran'}
                                                    </h3>
                                                    <div className="flex items-center gap-3">
                                                        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-text-secondary">
                                                            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                                            Kelas {entry.schedule.class.name}
                                                        </span>
                                                        {entry.room && (
                                                            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-text-secondary border-l border-zinc-300 dark:border-zinc-700 pl-3">
                                                                Ruangan: {entry.room}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                {current && (
                                                    <span className="px-3 py-1 bg-primary text-white text-xs font-bold rounded-full animate-pulse self-start sm:self-center">
                                                        Sedang Berlangsung
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Right Column: Academic Warnings (Tabbed) */}
                <div className="xl:col-span-5 space-y-6">
                    <div className="flex items-center justify-between border-b-2 border-red-500/20 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl text-white shadow-lg shadow-red-500/20">
                                <Danger set="bold" size={24} />
                            </div>
                            <h2 className="text-2xl font-bold text-text-main dark:text-white tracking-tight">Peringatan</h2>
                        </div>
                        {warnings?.kkm && (
                            <div className="bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-xs font-bold px-3 py-1.5 rounded-full border border-red-200 dark:border-red-800">
                                KKM: {warnings.kkm}
                            </div>
                        )}
                    </div>

                    {/* Warning Tabs */}
                    <div className="flex gap-2 p-1 bg-black/5 dark:bg-white/5 rounded-xl">
                        <button
                            onClick={() => handleTabChange('teaching')}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${activeWarningTab === 'teaching'
                                ? 'bg-white dark:bg-surface-dark text-text-main dark:text-white shadow-sm'
                                : 'text-text-secondary dark:text-zinc-400 hover:text-text-main dark:hover:text-white'
                                }`}
                        >
                            Mata Pelajaran
                            {teachingWarnings.length > 0 && (
                                <span className={`min-w-[20px] h-5 flex items-center justify-center px-1.5 text-[10px] font-bold rounded-full ${activeWarningTab === 'teaching'
                                    ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                                    : 'bg-black/10 dark:bg-white/10 text-text-secondary'
                                    }`}>
                                    {teachingWarnings.length}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() => handleTabChange('homeroom')}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all ${activeWarningTab === 'homeroom'
                                ? 'bg-white dark:bg-surface-dark text-text-main dark:text-white shadow-sm'
                                : 'text-text-secondary dark:text-zinc-400 hover:text-text-main dark:hover:text-white'
                                }`}
                        >
                            Wali Kelas
                            {homeroomWarnings.length > 0 && (
                                <span className={`min-w-[20px] h-5 flex items-center justify-center px-1.5 text-[10px] font-bold rounded-full ${activeWarningTab === 'homeroom'
                                    ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                                    : 'bg-black/10 dark:bg-white/10 text-text-secondary'
                                    }`}>
                                    {homeroomWarnings.length}
                                </span>
                            )}
                        </button>
                    </div>

                    {/* Warning Content */}
                    {!loading && activeWarnings.length === 0 ? (
                        <div className="h-52 flex flex-col items-center justify-center text-center p-8 bg-gradient-to-br from-emerald-50/50 to-transparent dark:from-emerald-900/10 dark:to-transparent rounded-3xl border border-emerald-100 dark:border-emerald-900/30">
                            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            </div>
                            {activeWarningTab === 'teaching' ? (
                                <>
                                    <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Semua Aman!</h3>
                                    <p className="text-text-secondary dark:text-zinc-400">Tidak ada siswa dengan nilai rata-rata di bawah KKM untuk mata pelajaran Anda.</p>
                                </>
                            ) : (
                                homeroomWarnings.length === 0 && myClasses.some(c => c.isHomeroom) ? (
                                    <>
                                        <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Semua Aman!</h3>
                                        <p className="text-text-secondary dark:text-zinc-400">Tidak ada siswa wali kelas dengan nilai rata-rata di bawah KKM.</p>
                                    </>
                                ) : (
                                    <>
                                        <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Bukan Wali Kelas</h3>
                                        <p className="text-text-secondary dark:text-zinc-400">Anda saat ini tidak menjadi wali kelas manapun.</p>
                                    </>
                                )
                            )}
                        </div>
                    ) : (
                        <div className="grid gap-3">
                            {activeWarnings.slice(0, warningVisibleCount).map((warning, idx) => renderWarningCard(warning, idx, activeWarningTab))}
                            {activeWarnings.length > warningVisibleCount && (
                                <button
                                    onClick={() => setWarningVisibleCount(prev => prev + 5)}
                                    className="w-full py-3 rounded-2xl border-2 border-dashed border-red-200 dark:border-red-900/40 text-red-500 dark:text-red-400 text-sm font-bold hover:bg-red-50 dark:hover:bg-red-900/10 hover:border-red-300 dark:hover:border-red-800 transition-all"
                                >
                                    Tampilkan Lebih Banyak ({activeWarnings.length - warningVisibleCount} sisanya)
                                </button>
                            )}
                            {warningVisibleCount > 5 && (
                                <button
                                    onClick={() => setWarningVisibleCount(5)}
                                    className="w-full py-3 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 text-text-secondary dark:text-zinc-400 text-sm font-bold hover:bg-zinc-50 dark:hover:bg-zinc-800/30 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all"
                                >
                                    Tampilkan Lebih Sedikit
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* My Classes Section (Bottom) */}
            {!loading && myClasses.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center gap-3 border-b-2 border-violet-500/20 pb-4">
                        <div className="p-2 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl text-white shadow-lg shadow-purple-500/20">
                            <Category set="bold" size={24} />
                        </div>
                        <h2 className="text-2xl font-bold text-text-main dark:text-white tracking-tight">Kelas Saya</h2>
                        <span className="px-2.5 py-1 bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 text-xs font-bold rounded-full">
                            {myClasses.length} Kelas
                        </span>
                    </div>
                    <div
                        className="flex gap-4 pb-3 -mx-1 px-1"
                        style={{ overflowX: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#a1a1aa transparent' }}
                    >
                        {myClasses.map((cls) => (
                            <div
                                key={cls.class_id}
                                className="flex-shrink-0 w-56 p-5 rounded-2xl bg-white/80 dark:bg-surface-dark/80 backdrop-blur-xl border border-black/5 dark:border-white/5 shadow-sm hover:shadow-lg hover:border-violet-200 dark:hover:border-violet-800 transition-all group cursor-pointer"
                                onClick={() => handleClassClick(cls.class_id, cls.class_name)}
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-lg font-black text-text-main dark:text-white group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                                        {cls.class_name}
                                    </h3>
                                    {cls.isHomeroom && (
                                        <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 text-[10px] font-bold rounded-full border border-amber-200 dark:border-amber-800 flex-shrink-0">
                                            Wali Kelas
                                        </span>
                                    )}
                                </div>
                                {cls.subjects.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                        {cls.subjects.map((subj, i) => (
                                            <span key={i} className="px-2 py-0.5 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 text-[10px] font-bold rounded-lg">
                                                {subj}
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-text-secondary dark:text-zinc-500 italic">Wali kelas saja</p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Class Students Modal */}
            {selectedClass && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={closeStudentModal}>
                    <div
                        className="bg-white dark:bg-surface-dark w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-black/5 dark:border-white/5 animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b border-black/5 dark:border-white/5 flex items-center justify-between bg-black/5 dark:bg-white/5">
                            <div>
                                <h3 className="text-xl font-bold text-text-main dark:text-white">Data Siswa</h3>
                                <p className="text-sm font-medium text-text-secondary">Kelas {selectedClass.name}</p>
                            </div>
                            <button
                                onClick={closeStudentModal}
                                className="p-2 text-text-secondary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
                            >
                                <CloseSquare set="bold" size={24} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700">
                            {loadingStudents ? (
                                <div className="flex flex-col items-center justify-center py-8">
                                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                                    <p className="mt-4 text-sm font-bold text-text-secondary">Memuat data siswa...</p>
                                </div>
                            ) : classStudents.length === 0 ? (
                                <div className="text-center py-8">
                                    <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 text-zinc-400 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <User set="bold" size={32} />
                                    </div>
                                    <p className="text-sm font-bold text-text-secondary">Belum ada siswa di kelas ini.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {classStudents.map((student, idx) => (
                                        <div key={student.id} className="flex items-center justify-between p-4 rounded-2xl border border-black/5 dark:border-white/5 bg-white dark:bg-surface-dark hover:border-primary/30 transition-colors group">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                                                    {idx + 1}
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-text-main dark:text-white group-hover:text-primary transition-colors">
                                                        {student.user.full_name}
                                                    </h4>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <span className="text-[10px] font-bold text-text-secondary bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-md">
                                                            NIS: {student.nis || '-'}
                                                        </span>
                                                        <span className="text-[10px] font-bold text-text-secondary bg-black/5 dark:bg-white/5 px-2 py-0.5 rounded-md">
                                                            {student.gender === 'L' ? 'Laki-laki' : student.gender === 'P' ? 'Perempuan' : '-'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
