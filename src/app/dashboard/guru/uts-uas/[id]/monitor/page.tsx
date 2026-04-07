'use client'

import { useEffect, useState, use } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui'
import { 
    Loader2, ArrowLeft, GraduationCap, Users, 
    CheckCircle, AlertTriangle, Clock, PlayCircle, RefreshCw
} from 'lucide-react'

interface StudentProgress {
    student_id: string
    student_name: string
    nis: string
    class_name: string
    status: 'not_started' | 'working' | 'submitted'
    answered_count: number
    total_questions: number
    violation_count: number
    started_at: string | null
    submitted_at: string | null
    time_remaining_seconds: number | null
}

interface MonitorData {
    exam: {
        id: string
        title: string
        exam_type: string
        subject_name: string
        start_time: string
        duration_minutes: number
        total_questions: number
        is_active: boolean
        max_violations: number
        target_classes: { id: string; name: string }[]
    }
    students: StudentProgress[]
    summary: {
        total_target_students: number
        not_started: number
        working: number
        submitted: number
    }
}

export default function GuruUtsUasMonitorPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: examId } = use(params)
    const router = useRouter()

    const [data, setData] = useState<MonitorData | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
    const [classFilter, setClassFilter] = useState('')
    const [error, setError] = useState<string | null>(null)

    // Client-side countdown ticker (ticks every second between server refreshes)
    const [tickOffset, setTickOffset] = useState(0)

    // Manual refresh or Initial fetch
    const fetchMonitorData = async (isManualRefresh = false) => {
        if (isManualRefresh) setRefreshing(true)
        try {
            const res = await fetch(`/api/official-exam-submissions/monitor?exam_id=${examId}`)
            const json = await res.json()
            
            if (!res.ok) throw new Error(json.error || 'Gagal memuat data')
            
            setData(json)
            setLastUpdated(new Date())
            setTickOffset(0) // Reset client countdown on fresh data
            setError(null)
        } catch (err: any) {
            console.error('Monitor fetch error:', err)
            setError(err.message)
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }

    // Auto refresh every 15 seconds
    useEffect(() => {
        fetchMonitorData() // Initial
        
        const interval = setInterval(() => {
            fetchMonitorData()
        }, 15000)
        
        return () => clearInterval(interval)
    }, [examId])

    // Client-side 1-second ticker for countdown
    useEffect(() => {
        const ticker = setInterval(() => {
            setTickOffset(prev => prev + 1)
        }, 1000)
        return () => clearInterval(ticker)
    }, [])

    if (loading) {
        return <div className="flex justify-center py-20"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>
    }

    if (error || !data) {
        // Check if the error is due to the exam not having started yet
        const isExamNotStarted = error?.includes('Exam has not started yet') && data?.exam;

        if (isExamNotStarted) {
            return (
                <div className="p-4 bg-orange-50 border-b border-orange-100 dark:bg-orange-900/10 dark:border-orange-900/20 px-8 flex flex-col items-center justify-center text-center">
                    <p className="font-bold text-orange-800 dark:text-orange-400 mb-2">Ujian Belum Dimulai</p>
                    <p className="text-sm text-orange-700 dark:text-orange-500 mb-4">Waktu mulai: {new Date(data.exam.start_time).toLocaleString('id-ID')}</p>
                    <button onClick={() => router.push('/dashboard/guru/ulangan')} className="text-primary hover:underline font-bold">
                        Kembali ke Daftar Ulangan
                    </button>
                </div>
            );
        }

        return (
            <div className="text-center py-20 space-y-4">
                <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
                <h2 className="text-xl font-bold text-text-main dark:text-white">Gagal Memuat Monitor</h2>
                <p className="text-text-secondary">{error || 'Data ujian tidak ditemukan atau Anda tidak memiliki akses.'}</p>
                <button onClick={() => router.push('/dashboard/guru/ulangan')} className="text-primary hover:underline font-bold">
                    Kembali ke Daftar Ulangan
                </button>
            </div>
        )
    }

    const { exam, summary, students } = data
    
    // Sort logic: 'working' first, then 'submitted', then 'not_started'
    // Within 'working', sort by highest answered count
    const sortedStudents = [...students].sort((a, b) => {
        const order = { 'working': 1, 'submitted': 2, 'not_started': 3 }
        if (order[a.status] !== order[b.status]) {
            return order[a.status] - order[b.status]
        }
        if (a.status === 'working') {
            return b.answered_count - a.answered_count
        }
        return a.student_name.localeCompare(b.student_name)
    })

    const filteredStudents = classFilter 
        ? sortedStudents.filter(s => s.class_name === classFilter) // we only have class_name here currently, so match by exact name context
        : sortedStudents

    // Timer display logic
    const formatTimeRemaining = (seconds: number) => {
        const h = Math.floor(seconds / 3600)
        const m = Math.floor((seconds % 3600) / 60)
        const s = seconds % 60
        if (h > 0) return `${h}h ${m}m ${s}s`
        return `${m}m ${s}s`
    }

    return (
        <div className="space-y-6 max-w-[1600px] mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div>
                    <Link
                        href={'/dashboard/guru/ulangan'}
                        className="inline-flex items-center justify-center p-3 mb-4 rounded-xl bg-white dark:bg-surface-dark border border-secondary/20 hover:border-primary text-text-secondary hover:text-primary transition-all shadow-sm"
                        title="Kembali ke Daftar Ulangan"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div className="flex items-center gap-3">
                        <span className={`px-3 py-1 text-sm font-bold rounded-full ${exam.exam_type === 'UTS' ? 'bg-indigo-500/10 text-indigo-600' : 'bg-purple-500/10 text-purple-600'}`}>
                            {exam.exam_type}
                        </span>
                        <h1 className="text-2xl font-bold text-text-main dark:text-white">{exam.title}</h1>
                        <span className="flex items-center gap-1.5 px-3 py-1 bg-red-500 text-white text-xs font-bold rounded-full animate-pulse shadow-lg shadow-red-500/20">
                            <span className="w-2 h-2 rounded-full bg-white relative">
                                <span className="absolute inset-0 rounded-full bg-white animate-ping"></span>
                            </span>
                            LIVE
                        </span>
                    </div>
                    <p className="text-sm text-text-secondary mt-1">
                        {exam.subject_name} • {exam.total_questions} Soal • {exam.duration_minutes} Menit
                        • <span className="text-red-500 font-bold">Berakhir {new Date(new Date(exam.start_time).getTime() + exam.duration_minutes * 60000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                    </p>
                </div>

                <div className="flex items-center gap-4 bg-white dark:bg-surface-dark px-4 py-3 rounded-2xl shadow-sm border border-secondary/20">
                    <div className="text-right">
                        <p className="text-xs text-text-secondary font-medium">Update Terakhir</p>
                        <p className="text-sm font-bold text-text-main dark:text-white">
                            {lastUpdated.toLocaleTimeString('id-ID', { hour12: false })}
                        </p>
                    </div>
                    <button 
                        onClick={() => fetchMonitorData(true)}
                        className={`p-2 rounded-full bg-primary/10 text-primary hover:bg-primary hover:text-white transition-all ${refreshing ? 'animate-spin' : ''}`}
                        title="Perbarui Data"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card padding="p-4 flex items-center gap-4" className="bg-gradient-to-br from-secondary/5 to-transparent border border-black/5">
                    <div className="w-12 h-12 rounded-xl bg-secondary/10 flex items-center justify-center text-text-secondary"><Users className="w-6 h-6" /></div>
                    <div>
                        <p className="text-2xl font-black text-text-main dark:text-white">{summary.total_target_students}</p>
                        <p className="text-xs font-bold text-text-secondary">Total Siswa Target</p>
                    </div>
                </Card>
                <Card padding="p-4 flex items-center gap-4" className="bg-gradient-to-br from-blue-500/5 to-transparent border border-blue-500/20">
                    <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600"><PlayCircle className="w-6 h-6" /></div>
                    <div>
                        <p className="text-2xl font-black text-blue-600 dark:text-blue-400">{summary.working}</p>
                        <p className="text-xs font-bold text-blue-600/70 dark:text-blue-400/70">Sedang Mengerjakan</p>
                    </div>
                </Card>
                <Card padding="p-4 flex items-center gap-4" className="bg-gradient-to-br from-green-500/5 to-transparent border border-green-500/20">
                    <div className="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600"><CheckCircle className="w-6 h-6" /></div>
                    <div>
                        <p className="text-2xl font-black text-green-600 dark:text-green-400">{summary.submitted}</p>
                        <p className="text-xs font-bold text-green-600/70 dark:text-green-400/70">Sudah Selesai</p>
                    </div>
                </Card>
                <Card padding="p-4 flex items-center gap-4" className="bg-gradient-to-br from-zinc-500/5 to-transparent border border-zinc-500/20">
                    <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500"><Clock className="w-6 h-6" /></div>
                    <div>
                        <p className="text-2xl font-black text-zinc-600 dark:text-zinc-400">{summary.not_started}</p>
                        <p className="text-xs font-bold text-zinc-500">Belum Mulai</p>
                    </div>
                </Card>
            </div>

            {/* Main Table */}
            <Card padding="p-0" className="overflow-hidden bg-white dark:bg-surface-dark border shadow-sm">
                <div className="p-4 border-b border-secondary/10 flex flex-col sm:flex-row justify-between items-center gap-4 bg-secondary/5">
                    <h2 className="text-lg font-bold text-text-main dark:text-white flex items-center gap-2">
                        <GraduationCap className="w-5 h-5 text-primary" /> Progress Siswa
                    </h2>
                    
                    <div className="flex bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl overflow-hidden focus-within:ring-2 ring-primary/50 transition-all">
                        <div className="px-3 py-2 border-r border-secondary/20 bg-secondary/5 font-medium text-text-secondary text-sm">
                            Saring Kelas:
                        </div>
                        <select
                            value={classFilter}
                            onChange={(e) => setClassFilter(e.target.value)}
                            className="px-3 py-2 bg-transparent text-text-main dark:text-white focus:outline-none text-sm font-bold min-w-[120px] cursor-pointer"
                        >
                            <option value="">Semua Kelas</option>
                            {/* Unique classes from students array */}
                            {Array.from(new Set(students.map(s => s.class_name))).filter(Boolean).sort().map(className => (
                                <option key={className} value={className}>{className}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-black/5 dark:border-white/5 bg-secondary/5 text-xs font-bold text-text-secondary uppercase tracking-wider">
                                <th className="p-4 w-12 text-center">No</th>
                                <th className="p-4">Siswa</th>
                                <th className="p-4">Kelas</th>
                                <th className="p-4 text-center w-36">Status</th>
                                <th className="p-4 min-w-[200px]">Progress (Sampai Nomor Berapa)</th>
                                <th className="p-4 text-center">Pelanggaran</th>
                                <th className="p-4 text-right">Sisa Waktu</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5 dark:divide-white/5">
                            {filteredStudents.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="p-12 text-center text-text-secondary font-medium">
                                        Tidak ada siswa yang sesuai filter.
                                    </td>
                                </tr>
                            ) : filteredStudents.map((student, idx) => {
                                const isWorking = student.status === 'working'
                                const pct = student.total_questions > 0 
                                    ? Math.round((student.answered_count / student.total_questions) * 100) 
                                    : 0
                                
                                return (
                                    <tr key={student.student_id} className={`hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors ${isWorking ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}`}>
                                        <td className="p-4 text-center text-sm text-text-secondary font-medium">{idx + 1}</td>
                                        <td className="p-4">
                                            <div className="font-bold text-text-main dark:text-white">{student.student_name}</div>
                                            <div className="text-xs text-text-secondary">NIS: {student.nis}</div>
                                        </td>
                                        <td className="p-4">
                                            <span className="px-2.5 py-1 bg-secondary/10 dark:bg-secondary/20 rounded-lg text-xs font-bold text-text-main dark:text-white">
                                                {student.class_name}
                                            </span>
                                        </td>
                                        
                                        <td className="p-4 text-center">
                                            {student.status === 'not_started' && (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-bold rounded-full">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-400"></span> Belum Mulai
                                                </span>
                                            )}
                                            {student.status === 'working' && (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold rounded-full ring-2 ring-blue-500/20">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span> Mengerjakan
                                                </span>
                                            )}
                                            {student.status === 'submitted' && (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-bold rounded-full">
                                                    <CheckCircle className="w-3.5 h-3.5" /> Selesai
                                                </span>
                                            )}
                                        </td>

                                        <td className="p-4">
                                            {student.status === 'not_started' ? (
                                                <div className="text-xs text-text-secondary font-medium italic">-</div>
                                            ) : (
                                                <div className="w-full space-y-1.5">
                                                    <div className="flex justify-between text-xs font-bold">
                                                        <span className={pct === 100 ? 'text-green-600 dark:text-green-400' : 'text-text-main dark:text-white'}>
                                                            {student.answered_count} / {student.total_questions} Soal
                                                        </span>
                                                        <span className="text-text-secondary">{pct}%</span>
                                                    </div>
                                                    <div className="w-full h-2.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                                                        <div 
                                                            className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-500'}`}
                                                            style={{ width: `${pct}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            )}
                                        </td>

                                        <td className="p-4 text-center">
                                            {student.violation_count > 0 ? (
                                                <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold ${
                                                    student.violation_count >= exam.max_violations 
                                                    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 ring-1 ring-red-500/50' 
                                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                                }`}>
                                                    <AlertTriangle className="w-3.5 h-3.5" />
                                                    {student.violation_count} / {exam.max_violations}
                                                </div>
                                            ) : (
                                                <span className="text-text-secondary font-medium">-</span>
                                            )}
                                        </td>

                                        <td className="p-4 text-right text-sm font-bold">
                                            {student.status === 'not_started' && <span className="text-text-secondary">-</span>}
                                            {student.status === 'submitted' && <span className="text-green-600 dark:text-green-400">Selesai</span>}
                                            {student.status === 'working' && student.time_remaining_seconds !== null && (() => {
                                                const adjustedTime = Math.max(0, student.time_remaining_seconds - tickOffset)
                                                return (
                                                    <span className={adjustedTime < 300 ? 'text-red-500 animate-pulse' : 'text-text-main dark:text-white'}>
                                                        {adjustedTime === 0 ? 'Habis' : formatTimeRemaining(adjustedTime)}
                                                    </span>
                                                )
                                            })()}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    )
}
