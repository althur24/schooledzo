'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Document, Danger, Scan, TimeCircle, TickSquare } from 'react-iconly'
import SmartText from '@/components/SmartText'
import PassageBlock from '@/components/PassageBlock'
import { GraduationCap } from 'lucide-react'

interface ExamQuestion {
    id: string
    question_text: string
    question_type: 'ESSAY' | 'MULTIPLE_CHOICE'
    options: string[] | null
    points: number
    passage_text?: string | null
    image_url?: string | null
    text_direction?: 'ltr' | 'rtl'
}

interface OfficialExam {
    id: string
    exam_type: 'UTS' | 'UAS'
    title: string
    description: string | null
    start_time: string
    duration_minutes: number
    max_violations: number
    subject: { id: string; name: string }
}

interface Submission {
    id: string
    started_at: string
    is_submitted: boolean
    violation_count: number
    question_order: string[]
}

export default function TakeOfficialExamPage() {
    const params = useParams()
    const router = useRouter()
    const examId = params.id as string

    const [exam, setExam] = useState<OfficialExam | null>(null)
    const [questions, setQuestions] = useState<ExamQuestion[]>([])
    const [submission, setSubmission] = useState<Submission | null>(null)
    const [answers, setAnswers] = useState<{ [key: string]: string }>({})
    const [currentIndex, setCurrentIndex] = useState(0)
    const [timeLeft, setTimeLeft] = useState(0)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [showConfirmSubmit, setShowConfirmSubmit] = useState(false)
    const [violationCount, setViolationCount] = useState(0)
    const [showViolationWarning, setShowViolationWarning] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [forceSubmitted, setForceSubmitted] = useState(false)
    const [alertMessage, setAlertMessage] = useState<string | null>(null)
    const [isOffline, setIsOffline] = useState(false)

    const containerRef = useRef<HTMLDivElement>(null)
    const hasStarted = useRef(false)
    const timerRef = useRef<NodeJS.Timeout | null>(null)
    const answersRef = useRef(answers)

    useEffect(() => { answersRef.current = answers }, [answers])

    // Reactive offline state
    useEffect(() => {
        setIsOffline(!navigator.onLine)
        const goOffline = () => setIsOffline(true)
        const goOnline = () => setIsOffline(false)
        window.addEventListener('offline', goOffline)
        window.addEventListener('online', goOnline)
        return () => {
            window.removeEventListener('offline', goOffline)
            window.removeEventListener('online', goOnline)
        }
    }, [])

    // LocalStorage helpers
    const saveLocal = (a: { [key: string]: string }) => {
        if (typeof window !== 'undefined')
            localStorage.setItem(`official_exam_${examId}_answers`, JSON.stringify({ answers: a, lastSaved: new Date().toISOString() }))
    }
    const loadLocal = (): { [key: string]: string } => {
        if (typeof window !== 'undefined') {
            try { return JSON.parse(localStorage.getItem(`official_exam_${examId}_answers`) || '{}').answers || {} } catch { return {} }
        }
        return {}
    }
    const clearLocal = () => { if (typeof window !== 'undefined') localStorage.removeItem(`official_exam_${examId}_answers`) }

    // Start exam
    const startExam = useCallback(async () => {
        if (hasStarted.current) return
        hasStarted.current = true

        try {
            const [examRes, questionsRes] = await Promise.all([
                fetch(`/api/official-exams/${examId}`),
                fetch(`/api/official-exams/${examId}/questions`)
            ])
            const examData = await examRes.json()
            const questionsData = await questionsRes.json()

            setExam(examData)

            // Start/resume submission
            const subRes = await fetch('/api/official-exam-submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exam_id: examId })
            })
            const subData = await subRes.json()

            if (subData.error) {
                setAlertMessage(subData.error)
                setTimeout(() => router.push('/dashboard/siswa/ulangan'), 2000)
                return
            }

            setSubmission(subData)
            setViolationCount(subData.violation_count || 0)

            const questionArr = Array.isArray(questionsData) ? questionsData : []
            if (subData.question_order && subData.question_order.length > 0) {
                const orderedQuestions = subData.question_order
                    .map((qId: string) => questionArr.find((q: ExamQuestion) => q.id === qId))
                    .filter(Boolean)
                setQuestions(orderedQuestions)
            } else {
                setQuestions(questionArr)
            }

            // Load local answers (but clear if a hard reset made them stale)
            const localRaw = typeof window !== 'undefined' ? localStorage.getItem(`official_exam_${examId}_answers`) : null
            let localAnswers: { [key: string]: string } = {}
            let localLastSaved: string | null = null
            if (localRaw) {
                try {
                    const parsed = JSON.parse(localRaw)
                    localAnswers = parsed.answers || {}
                    localLastSaved = parsed.lastSaved || null
                } catch { /* ignore parse error */ }
            }

            // If submission was restarted (hard reset), started_at will be newer than localStorage lastSaved
            // In that case, discard stale local answers
            if (localLastSaved && new Date(subData.started_at).getTime() > new Date(localLastSaved).getTime()) {
                localAnswers = {}
                clearLocal()
            }

            let initialAnswers: { [key: string]: string } = {}
            if (Object.keys(localAnswers).length > 0) {
                setAnswers(localAnswers)
                initialAnswers = localAnswers
            }

            // Calculate time
            const startedAt = new Date(subData.started_at).getTime()
            const durationMs = examData.duration_minutes * 60000
            const remaining = Math.max(0, Math.floor((durationMs - (Date.now() - startedAt)) / 1000))

            if (remaining <= 0) {
                // Auto-submit expired
                const formattedAnswers = Object.entries(initialAnswers).map(([qId, val]) => ({ question_id: qId, answer: val }))
                await fetch('/api/official-exam-submissions', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ submission_id: subData.id, answers: formattedAnswers, submit: true })
                })
                clearLocal()
                router.replace('/dashboard/siswa/ulangan')
                return
            }

            setTimeLeft(remaining)
            setLoading(false)
        } catch (error) {
            console.error('Error starting exam:', error)
            setAlertMessage('Gagal memulai ujian')
            setTimeout(() => router.push('/dashboard/siswa/ulangan'), 2000)
            setLoading(false)
        }
    }, [examId, router])

    const submissionRef = useRef(submission)
    useEffect(() => {
        submissionRef.current = submission
    }, [submission])

    const examRef = useRef(exam)
    useEffect(() => {
        examRef.current = exam
    }, [exam])

    // Sync local answers when reconnected
    useEffect(() => {
        const handleOnline = async () => {
            const localAnswers = loadLocal()
            if (Object.keys(localAnswers).length > 0 && submissionRef.current) {
                try {
                    const answersArray = Object.entries(localAnswers).map(([question_id, answer]) => ({ question_id, answer }))

                    // Check if exam time is expired
                    const currentExam = examRef.current
                    const currentSub = submissionRef.current
                    let isTimeUp = false
                    if (currentExam && currentSub) {
                        const durationMs = currentExam.duration_minutes * 60 * 1000
                        const elapsed = Date.now() - new Date(currentSub.started_at).getTime()
                        isTimeUp = durationMs > 0 && elapsed >= durationMs
                    }

                    await fetch('/api/official-exam-submissions', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            submission_id: submissionRef.current.id,
                            answers: answersArray,
                            ...(isTimeUp && { submit: true })
                        })
                    })

                    if (isTimeUp) {
                        clearLocal()
                        router.replace('/dashboard/siswa/ulangan')
                    }
                } catch (e) { console.error('Error syncing:', e) }
            }
        }
        window.addEventListener('online', handleOnline)
        return () => window.removeEventListener('online', handleOnline)
    }, [])

    useEffect(() => {
        startExam()
        return () => { if (timerRef.current) clearInterval(timerRef.current) }
    }, [startExam])

    // Timer
    useEffect(() => {
        if (timeLeft <= 0 || !submission) return
        timerRef.current = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    if (timerRef.current) clearInterval(timerRef.current)
                    handleSubmit(true)
                    return 0
                }
                return prev - 1
            })
        }, 1000)
        return () => { if (timerRef.current) clearInterval(timerRef.current) }
    }, [submission, timeLeft > 0])

    // Tab lock — multi-layered violation detection for PWA + browser
    // Strategy: DEFER violations until user returns. This prevents false positives
    // from screen sleep/off which also triggers visibilitychange.
    const pendingViolationRef = useRef(false)
    const violationCooldownRef = useRef(false)
    const isFullscreenTransition = useRef(false)
    const hiddenAtRef = useRef<number>(0)
    const SLEEP_THRESHOLD_MS = 30000 // 30 seconds — beyond this, assume sleep/screen-off

    const handleReturnFromHidden = useCallback(async () => {
        const hiddenDuration = Date.now() - hiddenAtRef.current
        hiddenAtRef.current = 0

        if (hiddenDuration > SLEEP_THRESHOLD_MS || hiddenDuration <= 0) {
            // Hidden for >30s = likely sleep/screen-off, NOT a tab switch — skip violation
            return
        }

        // Short switch = real tab switch — log the violation now
        if (violationCooldownRef.current || isFullscreenTransition.current) return
        violationCooldownRef.current = true
        setTimeout(() => { violationCooldownRef.current = false }, 5000)

        await logViolation('TAB_SWITCH')
        // Show warning after logging
        setShowViolationWarning(true)
        setTimeout(() => setShowViolationWarning(false), 4000)
    }, [submission, forceSubmitted])

    useEffect(() => {
        if (!submission || submission.is_submitted) return

        // Method 1: Page Visibility API (works for browser tab switches)
        const handleVisibility = () => {
            if (document.hidden) {
                // Only record timestamp — don't send violation yet
                hiddenAtRef.current = Date.now()
            } else {
                // Page became visible again — now decide if it was a real violation
                handleReturnFromHidden()
            }
        }

        // Method 2: Window blur/focus (works for PWA standalone + Alt+Tab)
        const handleWindowBlur = () => {
            if (document.hidden) return // Already handled by visibilitychange
            // Record timestamp for blur without visibility change
            if (hiddenAtRef.current === 0) hiddenAtRef.current = Date.now()
        }
        
        const handleWindowFocus = () => {
            if (document.hidden) return // Ignore if still hidden
            if (hiddenAtRef.current > 0) handleReturnFromHidden()
        }

        const handleBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = 'Anda sedang dalam ujian!' }
        const handleContextMenu = (e: MouseEvent) => e.preventDefault()
        const handleCopy = (e: ClipboardEvent) => e.preventDefault()
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'a', 'p', 's'].includes(e.key.toLowerCase())) e.preventDefault()
            if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) e.preventDefault()
        }

        document.addEventListener('visibilitychange', handleVisibility)
        window.addEventListener('blur', handleWindowBlur)
        window.addEventListener('focus', handleWindowFocus)
        window.addEventListener('beforeunload', handleBeforeUnload)
        document.addEventListener('contextmenu', handleContextMenu)
        document.addEventListener('copy', handleCopy)
        document.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('visibilitychange', handleVisibility)
            window.removeEventListener('blur', handleWindowBlur)
            window.removeEventListener('focus', handleWindowFocus)
            window.removeEventListener('beforeunload', handleBeforeUnload)
            document.removeEventListener('contextmenu', handleContextMenu)
            document.removeEventListener('copy', handleCopy)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [submission, handleReturnFromHidden])

    const logViolation = async (type: string) => {
        if (!submission || submission.is_submitted || forceSubmitted) return
        try {
            const res = await fetch('/api/official-exam-submissions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ submission_id: submission.id, violation: { type } })
            })
            const data = await res.json()
            if (data.force_submitted) {
                setForceSubmitted(true)
                pendingViolationRef.current = false
                setAlertMessage('Ujian otomatis dikumpulkan karena pelanggaran melebihi batas!')
                setTimeout(() => router.push('/dashboard/siswa/ulangan'), 3000)
                return
            }
            setViolationCount(data.violation_count)
            // Don't show warning here — it will show when student returns to tab
        } catch { }
    }

    const requestFullscreen = async () => {
        try {
            const el = containerRef.current as any
            if (el?.requestFullscreen) {
                await el.requestFullscreen()
                setIsFullscreen(true)
            } else if (el?.webkitRequestFullscreen) {
                await el.webkitRequestFullscreen()
                setIsFullscreen(true)
            } else {
                // Fullscreen API not supported (mobile browsers) — bypass
                setIsFullscreen(true)
            }
        } catch {
            // Fullscreen request failed (e.g. user denied, or not allowed) — bypass
            setIsFullscreen(true)
        }
    }

    useEffect(() => {
        // On mobile devices or browsers without Fullscreen API support, auto-bypass
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
        const supportsFullscreen = !!(document.documentElement as any).requestFullscreen || !!(document.documentElement as any).webkitRequestFullscreen
        if (isMobile || !supportsFullscreen) {
            setIsFullscreen(true)
        }

        const handler = () => {
            isFullscreenTransition.current = true
            setIsFullscreen(!!document.fullscreenElement || !!(document as any).webkitFullscreenElement)
            setTimeout(() => { isFullscreenTransition.current = false }, 1000)
        }
        document.addEventListener('fullscreenchange', handler)
        document.addEventListener('webkitfullscreenchange', handler)
        return () => {
            document.removeEventListener('fullscreenchange', handler)
            document.removeEventListener('webkitfullscreenchange', handler)
        }
    }, [])

    const saveAnswer = async (questionId: string, answer: string) => {
        const newAnswers = { ...answers, [questionId]: answer }
        setAnswers(newAnswers)
        saveLocal(newAnswers)

        if (submission) {
            try {
                await fetch('/api/official-exam-submissions', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ submission_id: submission.id, answers: [{ question_id: questionId, answer }] })
                })
            } catch { }
        }
    }

    const handleSubmit = async (auto = false) => {
        if (!submission || submitting) return
        setSubmitting(true)
        try {
            const answersArray = Object.entries(answersRef.current).map(([question_id, answer]) => ({ question_id, answer }))
            await fetch('/api/official-exam-submissions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ submission_id: submission.id, answers: answersArray, submit: true })
            })
            clearLocal()
            if (document.fullscreenElement) await document.exitFullscreen()
            router.push('/dashboard/siswa/ulangan')
        } catch (error) {
            console.error('Error submitting:', error)
            alert('Gagal mengumpulkan ujian')
        } finally {
            setSubmitting(false)
        }
    }

    const formatTime = (seconds: number) => {
        if (isNaN(seconds) || seconds < 0) return '00:00'
        const hrs = Math.floor(seconds / 3600)
        const mins = Math.floor((seconds % 3600) / 60)
        const secs = seconds % 60
        if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background-light dark:bg-background-dark">
                <div className="text-center">
                    <div className="text-indigo-500 mb-4 animate-pulse mx-auto flex justify-center"><GraduationCap className="w-12 h-12" /></div>
                    <p className="text-text-secondary">Mempersiapkan ujian...</p>
                </div>
            </div>
        )
    }

    if (!exam || !submission || questions.length === 0) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background-light dark:bg-background-dark">
                <div className="text-center text-red-500 dark:text-red-400">Ujian tidak dapat dimulai</div>
            </div>
        )
    }

    const currentQuestion = questions[currentIndex]
    const answeredCount = Object.keys(answers).length
    const maxViolations = exam.max_violations

    return (
        <div ref={containerRef} className="min-h-screen bg-background-light dark:bg-background-dark flex flex-col select-none" style={{ userSelect: 'none' }}>
            {/* Violation Warning */}
            {showViolationWarning && (
                <div className="fixed inset-0 bg-red-600/80 flex items-center justify-center z-50">
                    <div className="text-center text-white p-8">
                        <div className="text-white mb-4 mx-auto flex justify-center"><Danger set="bold" primaryColor="currentColor" size="xlarge" /></div>
                        <h2 className="text-2xl font-bold mb-2">PERINGATAN!</h2>
                        <p>Anda terdeteksi keluar dari halaman ujian</p>
                        <p className="text-xl mt-4">Pelanggaran: {violationCount} / {maxViolations}</p>
                        {violationCount >= maxViolations - 1 && (
                            <p className="text-yellow-300 mt-2 font-bold">Pelanggaran berikutnya akan mengumpulkan ujian secara otomatis!</p>
                        )}
                    </div>
                </div>
            )}

            {/* Fullscreen Enforcer Overlay */}
            {!isFullscreen && (
                <div className="fixed inset-0 z-[100] bg-background-light/95 dark:bg-background-dark/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-24 h-24 bg-red-500/10 text-red-500 dark:text-red-400 rounded-full flex items-center justify-center mb-6 animate-pulse">
                        <Scan set="bold" primaryColor="currentColor" size={48} />
                    </div>
                    <h2 className="text-3xl font-extrabold text-text-main dark:text-white mb-4 tracking-tight">Layar Penuh Diwajibkan</h2>
                    <p className="text-text-secondary mb-8 max-w-lg text-lg leading-relaxed">
                        Ujian ini diatur sedemikian rupa agar Anda mengerjakannya dalam mode layar penuh. Anda tidak dapat melihat soal atau melanjutkan sebelum masuk ke mode layar penuh.
                    </p>
                    <button 
                        onClick={requestFullscreen} 
                        className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-600/30 flex items-center gap-3 hover:-translate-y-1 active:translate-y-0"
                    >
                        <Scan set="bold" primaryColor="currentColor" size={24} />
                        Masuk Layar Penuh Sekarang
                    </button>
                </div>
            )}

            {/* Offline Banner */}
            {isOffline && (
                <div className="bg-red-500 text-white text-xs font-bold text-center py-1.5 animate-pulse w-full">
                    ⚠️ Koneksi terputus — jawaban disimpan lokal & akan otomatis dikirim saat online
                </div>
            )}

            {/* Header */}
            <div className="bg-surface-light dark:bg-surface-dark border-b border-gray-200 dark:border-gray-700 p-3 md:p-4">
                <div className="max-w-4xl mx-auto flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${exam.exam_type === 'UTS' ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'bg-purple-500/20 text-purple-600 dark:text-purple-400'}`}>
                            {exam.exam_type}
                        </span>
                        <div>
                            <h1 className="text-base md:text-lg font-bold text-text-main dark:text-white">{exam.title}</h1>
                            <p className="text-sm text-text-secondary">{exam.subject?.name}</p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between md:justify-end gap-3 md:gap-6">
                        <div className={`px-3 py-1 rounded-lg flex items-center gap-1.5 ${violationCount > 0 ? 'bg-red-500/20 text-red-500' : 'bg-gray-100 dark:bg-gray-800 text-text-secondary'}`}>
                            <Danger set="bold" primaryColor="currentColor" size={16} /> {violationCount}/{maxViolations}
                        </div>
                        <div className={`px-3 py-1.5 md:px-4 md:py-2 rounded-lg font-mono text-sm md:text-lg font-bold flex items-center gap-2 ${timeLeft <= 300 ? 'bg-red-500 text-white animate-pulse' : timeLeft <= 600 ? 'bg-amber-500 text-white' : 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400'}`}>
                            <TimeCircle set="bold" primaryColor="currentColor" size={20} /> {formatTime(timeLeft)}
                        </div>
                    </div>
                </div>
            </div>

            {/* Main */}
            <div className="flex-1 flex flex-col md:flex-row max-w-4xl mx-auto w-full overflow-hidden">
                {/* Nav sidebar */}
                <div className="hidden md:block w-20 bg-surface-light dark:bg-surface-dark border-r border-gray-200 dark:border-gray-700 p-3 overflow-y-auto">
                    <p className="text-xs text-text-secondary mb-3 text-center">Navigasi</p>
                    <div className="grid grid-cols-2 gap-2">
                        {questions.map((q, idx) => {
                            const isAnswered = !!answers[q.id]
                            return (
                                <button key={q.id} onClick={() => setCurrentIndex(idx)}
                                    className={`h-8 rounded-lg text-xs font-bold transition-all ${currentIndex === idx ? 'bg-indigo-500 text-white' : isAnswered ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-500/30' : 'bg-gray-100 dark:bg-gray-700 text-text-secondary hover:bg-gray-200'}`}>
                                    {idx + 1}
                                </button>
                            )
                        })}
                    </div>
                    <p className="text-xs text-text-secondary mt-4 text-center">{answeredCount}/{questions.length}</p>
                </div>

                {/* Question */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Mobile horizontal navigation strip */}
                    <div className="md:hidden bg-surface-light dark:bg-surface-dark border-b border-gray-200 dark:border-gray-700 px-3 py-2">
                        <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                            {questions.map((q, idx) => {
                                const isAnswered = !!answers[q.id]
                                return (
                                    <button key={q.id} onClick={() => setCurrentIndex(idx)}
                                        className={`flex-shrink-0 w-8 h-8 rounded-lg text-xs font-bold transition-all ${currentIndex === idx ? 'bg-indigo-500 text-white' : isAnswered ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-500/30' : 'bg-gray-100 dark:bg-gray-700 text-text-secondary hover:bg-gray-200'}`}>
                                        {idx + 1}
                                    </button>
                                )
                            })}
                        </div>
                        <p className="text-xs text-text-secondary mt-1 text-center">{answeredCount}/{questions.length}</p>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 md:p-6">
                        <div className="bg-white dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-xl p-4 md:p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <span className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">{currentIndex + 1}</span>
                                <span className={`px-2 py-0.5 text-xs rounded ${currentQuestion.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-500/20 text-blue-500' : 'bg-amber-500/20 text-amber-600'}`}>
                                    {currentQuestion.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 'Essay'}
                                </span>
                                <span className="text-xs text-text-secondary">({currentQuestion.points} poin)</span>
                            </div>

                            {currentQuestion.passage_text && (
                                <PassageBlock text={currentQuestion.passage_text} />
                            )}

                            <div dir={currentQuestion.text_direction || 'ltr'}>
                                <SmartText text={currentQuestion.question_text} className="text-text-main dark:text-white text-base md:text-lg mb-4 whitespace-pre-wrap" />
                            </div>

                            {currentQuestion.image_url && (
                                <div className="mb-4">
                                    <img src={currentQuestion.image_url} alt="Gambar soal" className="max-h-48 md:max-h-64 rounded-lg border border-gray-200 dark:border-gray-600 mx-auto" />
                                </div>
                            )}

                            {currentQuestion.question_type === 'MULTIPLE_CHOICE' && currentQuestion.options && (
                                <div className="space-y-3">
                                    {currentQuestion.options.map((opt, optIdx) => {
                                        const letter = String.fromCharCode(65 + optIdx)
                                        const isSelected = answers[currentQuestion.id] === letter
                                        return (
                                            <button key={optIdx} onClick={() => saveAnswer(currentQuestion.id, letter)}
                                                className={`w-full text-left px-3 py-2.5 md:px-4 md:py-3 rounded-xl border transition-all flex items-center ${isSelected ? 'bg-indigo-500/10 border-indigo-500 text-text-main dark:text-white' : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-600 text-text-secondary hover:border-gray-400'}`}>
                                                <span className={`inline-flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-lg ${currentQuestion.text_direction === 'rtl' ? 'ml-3' : 'mr-3'} font-bold flex-shrink-0 ${isSelected ? 'bg-indigo-500 text-white' : 'bg-gray-200 dark:bg-slate-600 text-text-secondary'}`} dir="ltr">{letter}</span>
                                                <div className="flex-1" dir={currentQuestion.text_direction || 'ltr'}><SmartText text={opt} as="span" className={currentQuestion.text_direction === 'rtl' ? 'text-right block' : ''} /></div>
                                            </button>
                                        )
                                    })}
                                </div>
                            )}

                            {currentQuestion.question_type === 'ESSAY' && (
                                <textarea dir={currentQuestion.text_direction || 'ltr'} value={answers[currentQuestion.id] || ''} onChange={(e) => saveAnswer(currentQuestion.id, e.target.value)}
                                    className={`w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none ${currentQuestion.text_direction === 'rtl' ? 'text-right' : ''}`} rows={6} placeholder="Tulis jawaban Anda di sini..." />
                            )}
                        </div>
                    </div>

                    {/* Nav buttons — sticky at bottom */}
                    <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 bg-surface-light dark:bg-surface-dark px-3 py-3 md:px-6 md:py-4">
                        <div className="flex items-center justify-between">
                            <button onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))} disabled={currentIndex === 0}
                                className="px-4 py-2.5 md:px-6 md:py-3 bg-gray-200 dark:bg-slate-700 text-text-main dark:text-white text-sm md:text-base rounded-xl hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                ← Sebelumnya
                            </button>
                            {currentIndex >= questions.length - 1 ? (
                                <button onClick={() => setShowConfirmSubmit(true)}
                                    className="px-5 py-2.5 md:px-8 md:py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm md:text-base rounded-xl font-medium hover:opacity-90 transition-opacity">
                                    <span className="flex items-center gap-2"><TickSquare set="bold" primaryColor="currentColor" size={20} /> Kumpulkan Ujian</span>
                                </button>
                            ) : (
                                <button onClick={() => setCurrentIndex(prev => prev + 1)}
                                    className="px-4 py-2.5 md:px-6 md:py-3 bg-indigo-500 text-white text-sm md:text-base rounded-xl hover:bg-indigo-600 transition-colors">
                                    Selanjutnya →
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Submit Confirmation */}
            {showConfirmSubmit && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-6 w-full max-w-sm text-center">
                        <div className="w-16 h-16 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <TickSquare set="bold" primaryColor="currentColor" size={32} />
                        </div>
                        <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Kumpulkan Ujian?</h3>
                        <p className="text-text-secondary mb-2">
                            Anda telah menjawab <strong className="text-text-main dark:text-white">{answeredCount}</strong> dari <strong className="text-text-main dark:text-white">{questions.length}</strong> soal.
                        </p>
                        {answeredCount < questions.length && (
                            <p className="text-amber-500 text-sm mb-4 flex items-center justify-center gap-1">
                                <Danger set="bold" primaryColor="currentColor" size={16} /> Masih ada {questions.length - answeredCount} soal yang belum dijawab!
                            </p>
                        )}
                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setShowConfirmSubmit(false)} disabled={submitting}
                                className="flex-1 px-4 py-3 bg-gray-200 dark:bg-slate-700 text-text-main dark:text-white rounded-xl hover:bg-gray-300 transition-colors">
                                Kembali
                            </button>
                            <button onClick={() => handleSubmit(false)} disabled={submitting}
                                className="flex-1 px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:opacity-90 transition-opacity">
                                {submitting ? 'Mengumpulkan...' : 'Ya, Kumpulkan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Alert Modal */}
            {alertMessage && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-white dark:bg-surface-dark rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="w-16 h-16 mx-auto bg-amber-100 dark:bg-amber-900/30 text-amber-500 rounded-full flex items-center justify-center mb-4">
                            <Danger set="bold" size={32} />
                        </div>
                        <h3 className="text-lg font-bold text-text-main dark:text-white mb-2">Pemberitahuan</h3>
                        <p className="text-text-secondary mb-6">{alertMessage}</p>
                        <button
                            onClick={() => setAlertMessage(null)}
                            className="w-full py-3 bg-primary hover:bg-primary-hover text-white rounded-xl font-bold transition-colors"
                        >
                            Tutup
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
