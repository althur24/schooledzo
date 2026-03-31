'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Document, Danger, Scan, TimeCircle, TickSquare } from 'react-iconly'
import SmartText from '@/components/SmartText'

interface ExamQuestion {
    id: string
    question_text: string
    question_type: 'ESSAY' | 'MULTIPLE_CHOICE'
    options: string[] | null
    points: number
    image_url?: string | null
    passage_text?: string | null
    passage_audio_url?: string | null
}

interface Exam {
    id: string
    title: string
    description: string | null
    start_time: string
    duration_minutes: number
    max_violations: number
    teaching_assignment: {
        subject: { name: string }
        class: { name: string }
    }
}

interface Submission {
    id: string
    started_at: string
    is_submitted: boolean
    violation_count: number
    question_order: string[]
}

export default function TakeExamPage() {
    const params = useParams()
    const router = useRouter()
    const examId = params.id as string

    const [exam, setExam] = useState<Exam | null>(null)
    const [questions, setQuestions] = useState<ExamQuestion[]>([])
    const [submission, setSubmission] = useState<Submission | null>(null)
    const [answers, setAnswers] = useState<{ [key: string]: string }>({})
    const [currentIndex, setCurrentIndex] = useState(0)
    const [timeLeft, setTimeLeft] = useState(0)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [showConfirmSubmit, setShowConfirmSubmit] = useState(false)
    const [showOfflineTimeoutModal, setShowOfflineTimeoutModal] = useState(false)
    const [violationCount, setViolationCount] = useState(0)
    const [showViolationWarning, setShowViolationWarning] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [forceSubmitted, setForceSubmitted] = useState(false)
    const [isOffline, setIsOffline] = useState(false)

    const containerRef = useRef<HTMLDivElement>(null)
    const hasStarted = useRef(false)
    const timerRef = useRef<NodeJS.Timeout | null>(null)
    const answersRef = useRef(answers)

    useEffect(() => {
        answersRef.current = answers
    }, [answers])

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

    // Resume State
    const [showResumeModal, setShowResumeModal] = useState(false)
    const [resumeData, setResumeData] = useState<{
        answeredCount: number
        totalQuestions: number
        timeRemaining: number
    } | null>(null)

    // Helper functions for Timer - just set initial state
    const initializeExamFromResume = (examData: Exam, remainingTime: number) => {
        setTimeLeft(remainingTime)
        setLoading(false)
        setShowResumeModal(false)
    }

    const startNewExamTimer = (examData: Exam, startedAt: number) => {
        const endTime = startedAt + examData.duration_minutes * 60000
        const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000))
        setTimeLeft(remaining)
        setLoading(false)
    }

    // LocalStorage helpers
    const saveAnswersToLocal = (answers: { [key: string]: string }) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(`exam_${examId}_answers`, JSON.stringify({
                answers,
                lastSaved: new Date().toISOString()
            }))
        }
    }

    const loadAnswersFromLocal = (): { [key: string]: string } => {
        if (typeof window !== 'undefined') {
            const data = localStorage.getItem(`exam_${examId}_answers`)
            if (data) {
                try {
                    const parsed = JSON.parse(data)
                    return parsed.answers || {}
                } catch (e) {
                    return {}
                }
            }
        }
        return {}
    }

    const clearLocalAnswers = () => {
        if (typeof window !== 'undefined') {
            localStorage.removeItem(`exam_${examId}_answers`)
        }
    }

    const submissionRef = useRef(submission)

    useEffect(() => {
        submissionRef.current = submission
    }, [submission])

    const examRef = useRef(exam)
    useEffect(() => {
        examRef.current = exam
    }, [exam])

    // Sync local answers to server when reconnected
    useEffect(() => {
        const handleOnline = () => {
            syncLocalToServer()
        }

        if (typeof window !== 'undefined') {
            window.addEventListener('online', handleOnline)
        }

        return () => {
            if (typeof window !== 'undefined') {
                window.removeEventListener('online', handleOnline)
            }
        }
    }, [])

    const syncLocalToServer = async () => {
        const localAnswers = loadAnswersFromLocal()
        if (Object.keys(localAnswers).length > 0 && submissionRef.current) {
            try {
                const answersArray = Object.entries(localAnswers).map(([question_id, answer]) => ({
                    question_id, answer
                }))

                // Check if exam time is expired
                const currentExam = examRef.current
                const currentSub = submissionRef.current
                let isTimeUp = false
                if (currentExam && currentSub) {
                    const durationMs = currentExam.duration_minutes * 60 * 1000
                    const elapsed = Date.now() - new Date(currentSub.started_at).getTime()
                    isTimeUp = durationMs > 0 && elapsed >= durationMs
                }

                await fetch('/api/exam-submissions', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        submission_id: submissionRef.current.id,
                        answers: answersArray,
                        ...(isTimeUp && { submit: true })
                    })
                })

                if (isTimeUp) {
                    clearLocalAnswers()
                    router.replace(`/dashboard/siswa/ulangan/${examId}/hasil`)
                }
            } catch (error) {
                console.error('Error syncing to server:', error)
            }
        }
    }

    // Start exam - create submission
    const startExam = useCallback(async () => {
        if (hasStarted.current) return
        hasStarted.current = true

        try {
            // Fetch exam details
            const [examRes, questionsRes] = await Promise.all([
                fetch(`/api/exams/${examId}`),
                fetch(`/api/exams/${examId}/questions`)
            ])
            const examData = await examRes.json()
            const questionsData = await questionsRes.json()

            setExam(examData)

            // Start submission
            const subRes = await fetch('/api/exam-submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exam_id: examId })
            })
            const subData = await subRes.json()

            if (subData.error) {
                alert(subData.error)
                router.push('/dashboard/siswa/ulangan')
                return
            }

            setSubmission(subData)
            setViolationCount(subData.violation_count || 0)

            // Order questions based on submission's question_order (randomized)
            const questionArr = Array.isArray(questionsData) ? questionsData : []
            if (subData.question_order && subData.question_order.length > 0) {
                const orderedQuestions = subData.question_order
                    .map((qId: string) => questionArr.find((q: ExamQuestion) => q.id === qId))
                    .filter(Boolean)
                setQuestions(orderedQuestions)
            } else {
                setQuestions(questionArr)
            }

            // Load answers from localStorage if available
            const localAnswers = loadAnswersFromLocal()
            let initialAnswers = {}
            if (Object.keys(localAnswers).length > 0) {
                setAnswers(localAnswers)
                initialAnswers = localAnswers
            }

            // Check for Resume
            const startedAt = new Date(subData.started_at).getTime()
            const durationMs = examData.duration_minutes * 60000
            const elapsed = Date.now() - startedAt
            const remaining = Math.max(0, Math.floor((durationMs - elapsed) / 1000))

            if (remaining <= 0) {
                // Auto-submit if time expired
                try {
                    const formattedAnswers = Object.entries(initialAnswers).map(([qId, val]) => ({
                        question_id: qId,
                        answer: val as string
                    }))

                    await fetch('/api/exam-submissions', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            submission_id: subData.id,
                            answers: formattedAnswers,
                            submit: true
                        })
                    })

                    if (typeof window !== 'undefined') {
                        localStorage.removeItem(`exam_${examId}_answers`)
                    }
                    router.replace('/dashboard/siswa/ulangan')
                } catch (e) {
                    console.error('Auto-submit error:', e)
                    router.replace('/dashboard/siswa/ulangan')
                }
                return
            }

            // Always set timeLeft immediately so timer can start
            setTimeLeft(remaining)

            // If elapsed is significant (> 10s) OR we found local answers, assume it's a resume
            const isResume = elapsed > 10000 || Object.keys(localAnswers).length > 0

            if (isResume) {
                setResumeData({
                    answeredCount: Object.keys(initialAnswers).length,
                    totalQuestions: questionArr.length,
                    timeRemaining: remaining
                })
                setShowResumeModal(true)
                setLoading(false)
            } else {
                setLoading(false)
            }

        } catch (error) {
            console.error('Error starting exam:', error)
            alert('Gagal memulai ulangan')
            router.push('/dashboard/siswa/ulangan')
            setLoading(false)
        }
    }, [examId, router])

    useEffect(() => {
        startExam()
        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [startExam])

    // Timer countdown - reacts to timeLeft and submission changes
    useEffect(() => {
        if (timeLeft <= 0 || !submission) return

        timerRef.current = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    if (timerRef.current) clearInterval(timerRef.current)
                    if (navigator.onLine) {
                        handleSubmit(true)
                    } else {
                        setShowOfflineTimeoutModal(true)
                    }
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [submission, timeLeft > 0])

    // Tab lock: detect visibility change
    useEffect(() => {
        if (!submission || submission.is_submitted) return

        const handleVisibilityChange = async () => {
            if (document.hidden) {
                // User switched tab or minimized
                await logViolation('TAB_SWITCH')
            }
        }

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = 'Anda sedang dalam ulangan. Keluar akan dihitung sebagai pelanggaran!'
            return e.returnValue
        }

        // Prevent right-click
        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault()
        }

        // Prevent copy-paste
        const handleCopy = (e: ClipboardEvent) => {
            e.preventDefault()
        }

        const handlePaste = (e: ClipboardEvent) => {
            e.preventDefault()
        }

        // Prevent keyboard shortcuts
        const handleKeyDown = (e: KeyboardEvent) => {
            // Prevent Ctrl+C, Ctrl+V, Ctrl+A, F12, etc.
            if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'a', 'p', 's'].includes(e.key.toLowerCase())) {
                e.preventDefault()
            }
            if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
                e.preventDefault()
            }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        window.addEventListener('beforeunload', handleBeforeUnload)
        document.addEventListener('contextmenu', handleContextMenu)
        document.addEventListener('copy', handleCopy)
        document.addEventListener('paste', handlePaste)
        document.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            window.removeEventListener('beforeunload', handleBeforeUnload)
            document.removeEventListener('contextmenu', handleContextMenu)
            document.removeEventListener('copy', handleCopy)
            document.removeEventListener('paste', handlePaste)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [submission])

    // Log violation
    const logViolation = async (type: string) => {
        if (!submission || submission.is_submitted || forceSubmitted) return

        try {
            const res = await fetch('/api/exam-submissions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submission_id: submission.id,
                    violation: { type }
                })
            })

            const data = await res.json()

            if (data.force_submitted) {
                setForceSubmitted(true)
                alert('Ulangan otomatis dikumpulkan karena pelanggaran melebihi batas!')
                router.push('/dashboard/siswa/ulangan')
                return
            }

            setViolationCount(data.violation_count)
            setShowViolationWarning(true)
            setTimeout(() => setShowViolationWarning(false), 3000)
        } catch (error) {
            console.error('Error logging violation:', error)
        }
    }

    // Request fullscreen
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
            // Fullscreen request failed — bypass
            setIsFullscreen(true)
        }
    }

    // Exit fullscreen handler
    useEffect(() => {
        // On mobile devices or browsers without Fullscreen API support, auto-bypass
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
        const supportsFullscreen = !!(document.documentElement as any).requestFullscreen || !!(document.documentElement as any).webkitRequestFullscreen
        if (isMobile || !supportsFullscreen) {
            setIsFullscreen(true)
        }

        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement || !!(document as any).webkitFullscreenElement)
        }
        document.addEventListener('fullscreenchange', handleFullscreenChange)
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange)
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
        }
    }, [])

    // Save answer
    const saveAnswer = async (questionId: string, answer: string) => {
        const newAnswers = { ...answers, [questionId]: answer }
        setAnswers(newAnswers)
        saveAnswersToLocal(newAnswers)

        if (submission) {
            try {
                await fetch('/api/exam-submissions', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        submission_id: submission.id,
                        answers: [{ question_id: questionId, answer }]
                    })
                })
            } catch (error) {
                console.error('Error saving answer:', error)
            }
        }
    }

    // Submit exam
    const handleSubmit = async (auto = false) => {
        if (!submission || submitting) return
        setSubmitting(true)
        setShowOfflineTimeoutModal(false)

        try {
            // Save all current answers first
            const answersArray = Object.entries(answersRef.current).map(([question_id, answer]) => ({
                question_id, answer
            }))

            await fetch('/api/exam-submissions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submission_id: submission.id,
                    answers: answersArray,
                    submit: true
                })
            })

            // Clear localStorage after successful submit
            clearLocalAnswers()

            if (document.fullscreenElement) {
                await document.exitFullscreen()
            }

            router.push(`/dashboard/siswa/ulangan/${examId}/hasil`)
        } catch (error) {
            console.error('Error submitting:', error)
            alert('Gagal mengumpulkan ulangan')
        } finally {
            setSubmitting(false)
        }
    }

    const formatTime = (seconds: number) => {
        if (isNaN(seconds) || seconds < 0) {
            return '00:00'
        }
        const hrs = Math.floor(seconds / 3600)
        const mins = Math.floor((seconds % 3600) / 60)
        const secs = seconds % 60
        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background-light dark:bg-background-dark">
                <div className="text-center">
                    <div className="text-primary mb-4 animate-pulse mx-auto flex justify-center"><Document set="bold" primaryColor="currentColor" size="xlarge" /></div>
                    <p className="text-text-secondary">Mempersiapkan ulangan...</p>
                </div>
            </div>
        )
    }

    if (!exam || !submission || questions.length === 0) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background-light dark:bg-background-dark">
                <div className="text-center text-red-500 dark:text-red-400">Ulangan tidak dapat dimulai</div>
            </div>
        )
    }

    const currentQuestion = questions[currentIndex]
    const answeredCount = Object.keys(answers).length
    const maxViolations = exam.max_violations

    return (
        <div ref={containerRef} className="min-h-screen bg-background-light dark:bg-background-dark flex flex-col select-none" style={{ userSelect: 'none' }}>
            {/* Violation Warning Overlay */}
            {showViolationWarning && (
                <div className="fixed inset-0 bg-red-600/80 flex items-center justify-center z-50">
                    <div className="text-center text-white p-8">
                        <div className="text-white mb-4 mx-auto flex justify-center"><Danger set="bold" primaryColor="currentColor" size="xlarge" /></div>
                        <h2 className="text-2xl font-bold mb-2">PERINGATAN!</h2>
                        <p>Anda terdeteksi keluar dari halaman ulangan</p>
                        <p className="text-xl mt-4">Pelanggaran: {violationCount} / {maxViolations}</p>
                        {violationCount >= maxViolations - 1 && (
                            <p className="text-yellow-300 mt-2 font-bold">Pelanggaran berikutnya akan mengumpulkan ulangan secara otomatis!</p>
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
                        Ulangan ini diatur sedemikian rupa agar Anda mengerjakannya dalam mode layar penuh. Anda tidak dapat melihat soal atau melanjutkan sebelum masuk ke mode layar penuh.
                    </p>
                    <button 
                        onClick={requestFullscreen} 
                        className="px-8 py-4 bg-primary text-white rounded-2xl font-bold text-lg hover:bg-primary-dark transition-all shadow-xl shadow-primary/30 flex items-center gap-3 hover:-translate-y-1 active:translate-y-0"
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
            <div className="bg-surface-light dark:bg-surface-dark border-b border-gray-200 dark:border-gray-700 p-4">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold text-text-main dark:text-white">{exam.title}</h1>
                        <p className="text-sm text-text-secondary">{exam.teaching_assignment?.subject?.name}</p>
                    </div>
                    <div className="flex items-center gap-6">
                        {/* Violation counter */}
                        <div className={`px-3 py-1 rounded-lg flex items-center gap-1.5 ${violationCount > 0 ? 'bg-red-500/20 text-red-500 dark:text-red-400' : 'bg-gray-100 dark:bg-gray-800 text-text-secondary'}`}>
                            <Danger set="bold" primaryColor="currentColor" size={16} /> {violationCount}/{maxViolations}
                        </div>
                        {/* Timer */}
                        <div className={`px-4 py-2 rounded-lg font-mono text-lg font-bold flex items-center gap-2 relative ${timeLeft <= 300 ? 'bg-red-500 text-white animate-pulse' : timeLeft <= 600 ? 'bg-amber-500 text-white' : 'bg-primary/20 text-primary dark:text-primary-light'}`}>
                            <TimeCircle set="bold" primaryColor="currentColor" size={20} /> {formatTime(timeLeft)}
                        </div>
                    </div>
                </div>
            </div>

            {/* Main content */}
            {(() => {
                // Build display items: audio groups and standalone questions
                type DisplayItem =
                    | { type: 'standalone'; question: ExamQuestion; questionNumbers: number[] }
                    | { type: 'audio_group'; audioUrl: string; passageText?: string | null; questions: ExamQuestion[]; questionNumbers: number[] }

                const displayItems: DisplayItem[] = []
                const audioGroupMap = new Map<string, { audioUrl: string; passageText?: string | null; questions: ExamQuestion[] }>()
                const processedAudioUrls = new Set<string>()

                // First pass: identify audio groups
                questions.forEach(q => {
                    if (q.passage_audio_url) {
                        const key = q.passage_audio_url
                        if (!audioGroupMap.has(key)) {
                            audioGroupMap.set(key, { audioUrl: q.passage_audio_url, passageText: q.passage_text, questions: [] })
                        }
                        audioGroupMap.get(key)!.questions.push(q)
                    }
                })

                // Second pass: build display items in order
                let questionNumber = 0
                questions.forEach(q => {
                    if (q.passage_audio_url) {
                        if (!processedAudioUrls.has(q.passage_audio_url)) {
                            processedAudioUrls.add(q.passage_audio_url)
                            const group = audioGroupMap.get(q.passage_audio_url)!
                            const nums: number[] = []
                            group.questions.forEach(() => { questionNumber++; nums.push(questionNumber) })
                            displayItems.push({ type: 'audio_group', ...group, questionNumbers: nums })
                        }
                    } else {
                        questionNumber++
                        displayItems.push({ type: 'standalone', question: q, questionNumbers: [questionNumber] })
                    }
                })

                const currentItem = displayItems[currentIndex] || displayItems[0]
                const isLastItem = currentIndex >= displayItems.length - 1

                return (
                    <div className="flex-1 flex max-w-4xl mx-auto w-full">
                        {/* Question navigation sidebar */}
                        <div className="w-20 bg-surface-light dark:bg-surface-dark border-r border-gray-200 dark:border-gray-700 p-3 overflow-y-auto">
                            <p className="text-xs text-text-secondary mb-3 text-center">Navigasi</p>
                            <div className="grid grid-cols-2 gap-2">
                                {displayItems.map((item, idx) => {
                                    const nums = item.questionNumbers
                                    const label = nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : `${nums[0]}`
                                    const allAnswered = item.type === 'audio_group'
                                        ? item.questions.every(q => !!answers[q.id])
                                        : !!answers[item.question.id]
                                    const isAudio = item.type === 'audio_group'
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => setCurrentIndex(idx)}
                                            className={`${nums.length > 1 ? 'col-span-2' : ''} h-8 rounded-lg text-xs font-bold transition-all ${currentIndex === idx ? (isAudio ? 'bg-violet-500 text-white' : 'bg-primary text-white') : allAnswered ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-500/30' : isAudio ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 hover:bg-violet-200' : 'bg-gray-100 dark:bg-gray-700 text-text-secondary dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-600'}`}
                                        >
                                            {isAudio ? `🎧${label}` : label}
                                        </button>
                                    )
                                })}
                            </div>
                            <p className="text-xs text-text-secondary mt-4 text-center">{answeredCount}/{questions.length}</p>
                        </div>

                        {/* Question area */}
                        <div className="flex-1 p-6">
                            {currentItem?.type === 'audio_group' ? (
                                /* Audio group: show audio + all questions */
                                <div className="bg-white dark:bg-surface-dark border border-violet-300 dark:border-violet-700 rounded-xl overflow-hidden min-h-[400px]">
                                    {/* Audio header */}
                                    <div className="p-5 bg-violet-50 dark:bg-violet-900/20 border-b border-violet-200 dark:border-violet-700">
                                        <p className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-2">🎧 Listening</p>
                                        <audio controls controlsList="nodownload" className="w-full mb-2" src={currentItem.audioUrl} />
                                        {currentItem.passageText && (
                                            <>
                                                <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-1 mt-3">📖 Bacaan:</p>
                                                <p className="text-sm text-text-main dark:text-white whitespace-pre-wrap leading-relaxed">{currentItem.passageText}</p>
                                            </>
                                        )}
                                    </div>
                                    {/* Questions */}
                                    <div className="divide-y divide-violet-100 dark:divide-violet-800">
                                        {currentItem.questions.map((q, qIdx) => (
                                            <div key={q.id} className="p-6">
                                                <div className="flex items-center gap-3 mb-4">
                                                    <span className="w-10 h-10 rounded-full bg-violet-500/20 text-violet-600 dark:text-violet-400 flex items-center justify-center font-bold">{currentItem.questionNumbers[qIdx]}</span>
                                                    <span className={`px-2 py-0.5 text-xs rounded ${q.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-500/20 text-blue-500 dark:text-blue-400' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'}`}>
                                                        {q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 'Essay'}
                                                    </span>
                                                    <span className="text-xs text-text-secondary">({q.points} poin)</span>
                                                </div>
                                                <SmartText text={q.question_text} className="text-text-main dark:text-white text-lg mb-4" />
                                                {q.image_url && (
                                                    <div className="mb-4">
                                                        <img src={q.image_url} alt="Gambar soal" className="max-h-64 rounded-lg border border-gray-200 dark:border-gray-600 mx-auto" />
                                                    </div>
                                                )}
                                                {q.question_type === 'MULTIPLE_CHOICE' && q.options && (
                                                    <div className="space-y-3">
                                                        {q.options.map((opt, optIdx) => {
                                                            const letter = String.fromCharCode(65 + optIdx)
                                                            const isSelected = answers[q.id] === letter
                                                            return (
                                                                <button key={optIdx} onClick={() => saveAnswer(q.id, letter)} className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${isSelected ? 'bg-primary/10 border-primary text-text-main dark:text-white' : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-600 text-text-secondary dark:text-slate-300 hover:border-gray-400 dark:hover:border-slate-500'}`}>
                                                                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg mr-3 font-bold ${isSelected ? 'bg-primary text-white' : 'bg-gray-200 dark:bg-slate-600 text-text-secondary dark:text-slate-300'}`}>{letter}</span>
                                                                    <SmartText text={opt} as="span" />
                                                                </button>
                                                            )
                                                        })}
                                                    </div>
                                                )}
                                                {q.question_type === 'ESSAY' && (
                                                    <textarea value={answers[q.id] || ''} onChange={(e) => saveAnswer(q.id, e.target.value)} className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none" rows={6} placeholder="Tulis jawaban Anda di sini..." />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : currentItem?.type === 'standalone' ? (
                                /* Standalone question */
                                <div className="bg-white dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-xl p-6 min-h-[400px]">
                                    <div className="flex items-center gap-3 mb-4">
                                        <span className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold">{currentItem.questionNumbers[0]}</span>
                                        <span className={`px-2 py-0.5 text-xs rounded ${currentItem.question.question_type === 'MULTIPLE_CHOICE' ? 'bg-blue-500/20 text-blue-500 dark:text-blue-400' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'}`}>
                                            {currentItem.question.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 'Essay'}
                                        </span>
                                        <span className="text-xs text-text-secondary">({currentItem.question.points} poin)</span>
                                    </div>
                                    <SmartText text={currentItem.question.question_text} className="text-text-main dark:text-white text-lg mb-4" />
                                    {/* Text-only passage */}
                                    {currentItem.question.passage_text && !currentItem.question.passage_audio_url && (
                                        <div className="mb-6 p-4 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-xl">
                                            <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-2">📖 Bacaan:</p>
                                            <SmartText text={currentItem.question.passage_text} className="text-sm text-text-main dark:text-white whitespace-pre-wrap leading-relaxed" />
                                        </div>
                                    )}
                                    {currentItem.question.image_url && (
                                        <div className="mb-6">
                                            <img src={currentItem.question.image_url} alt="Gambar soal" className="max-h-64 rounded-lg border border-gray-200 dark:border-gray-600 mx-auto" />
                                        </div>
                                    )}
                                    {currentItem.question.question_type === 'MULTIPLE_CHOICE' && currentItem.question.options && (
                                        <div className="space-y-3">
                                            {currentItem.question.options.map((opt, optIdx) => {
                                                const letter = String.fromCharCode(65 + optIdx)
                                                const isSelected = answers[currentItem.question.id] === letter
                                                return (
                                                    <button key={optIdx} onClick={() => saveAnswer(currentItem.question.id, letter)} className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${isSelected ? 'bg-primary/10 border-primary text-text-main dark:text-white' : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-600 text-text-secondary dark:text-slate-300 hover:border-gray-400 dark:hover:border-slate-500'}`}>
                                                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg mr-3 font-bold ${isSelected ? 'bg-primary text-white' : 'bg-gray-200 dark:bg-slate-600 text-text-secondary dark:text-slate-300'}`}>{letter}</span>
                                                        <SmartText text={opt} as="span" />
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}
                                    {currentItem.question.question_type === 'ESSAY' && (
                                        <textarea value={answers[currentItem.question.id] || ''} onChange={(e) => saveAnswer(currentItem.question.id, e.target.value)} className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none" rows={6} placeholder="Tulis jawaban Anda di sini..." />
                                    )}
                                </div>
                            ) : null}

                            {/* Navigation buttons */}
                            <div className="flex items-center justify-between mt-6">
                                <button
                                    onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                                    disabled={currentIndex === 0}
                                    className="px-6 py-3 bg-gray-200 dark:bg-slate-700 text-text-main dark:text-white rounded-xl hover:bg-gray-300 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    ← Sebelumnya
                                </button>

                                {isLastItem ? (
                                    <button
                                        onClick={() => setShowConfirmSubmit(true)}
                                        className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
                                    >
                                        <span className="flex items-center gap-2">
                                            <TickSquare set="bold" primaryColor="currentColor" size={20} /> Kumpulkan Ulangan
                                        </span>
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => setCurrentIndex(prev => Math.min(displayItems.length - 1, prev + 1))}
                                        className="px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors"
                                    >
                                        Selanjutnya →
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )
            })()}

            {/* Submit Confirmation Modal */}
            {showConfirmSubmit && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-6 w-full max-w-sm text-center">
                        <div className="w-16 h-16 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <TickSquare set="bold" primaryColor="currentColor" size={32} />
                        </div>
                        <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Kumpulkan Ulangan?</h3>
                        <p className="text-text-secondary mb-2">
                            Anda telah menjawab <strong className="text-text-main dark:text-white">{answeredCount}</strong> dari <strong className="text-text-main dark:text-white">{questions.length}</strong> soal.
                        </p>
                        {answeredCount < questions.length && (
                            <p className="text-amber-500 dark:text-amber-400 text-sm mb-4 flex items-center justify-center gap-1">
                                <Danger set="bold" primaryColor="currentColor" size={16} /> Masih ada {questions.length - answeredCount} soal yang belum dijawab!
                            </p>
                        )}
                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setShowConfirmSubmit(false)}
                                className="flex-1 px-4 py-3 bg-gray-200 dark:bg-slate-700 text-text-main dark:text-white rounded-xl hover:bg-gray-300 dark:hover:bg-slate-600 transition-colors"
                                disabled={submitting}
                            >
                                Kembali
                            </button>
                            <button
                                onClick={() => handleSubmit(false)}
                                disabled={submitting}
                                className="flex-1 px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
                            >
                                {submitting ? 'Mengumpulkan...' : 'Ya, Kumpulkan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Offline Timeout Modal */}
            {showOfflineTimeoutModal && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-8 w-full max-w-sm text-center shadow-2xl">
                        <div className="w-20 h-20 bg-amber-500/20 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
                            <Danger set="bold" primaryColor="currentColor" size={40} />
                        </div>
                        <h3 className="text-2xl font-bold text-text-main dark:text-white mb-2">
                            Waktu Habis (Offline)
                        </h3>
                        <p className="text-text-secondary mb-6">
                            Waktu ulangan telah habis, tetapi koneksi internet terputus. Jawaban Anda sudah tersimpan secara lokal dan akan dikumpulkan otomatis saat koneksi kembali.
                        </p>
                        <button
                            onClick={() => handleSubmit(true)}
                            className="w-full px-6 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark transition-opacity"
                        >
                            Kumpulkan Sekarang
                        </button>
                    </div>
                </div>
            )}
            {/* Resume Modal */}
            {showResumeModal && resumeData && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-8 w-full max-w-md text-center shadow-2xl">
                        <div className="w-20 h-20 bg-amber-500/20 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
                            <TimeCircle set="bold" primaryColor="currentColor" size={40} />
                        </div>
                        <h3 className="text-2xl font-bold text-text-main dark:text-white mb-2">
                            Lanjutkan Ulangan
                        </h3>
                        <p className="text-text-secondary mb-6">
                            Ulangan ini belum diselesaikan. Waktu terus berjalan saat Anda meninggalkan halaman.
                        </p>

                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div className="p-4 bg-primary/10 rounded-xl">
                                <p className="text-xs text-text-secondary mb-1">Terjawab</p>
                                <p className="text-2xl font-bold text-primary">
                                    {resumeData.answeredCount}/{resumeData.totalQuestions}
                                </p>
                            </div>
                            <div className="p-4 bg-blue-500/10 rounded-xl">
                                <p className="text-xs text-text-secondary mb-1">Sisa Waktu</p>
                                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 font-mono">
                                    {formatTime(resumeData.timeRemaining)}
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                if (exam && resumeData) {
                                    initializeExamFromResume(exam, resumeData.timeRemaining)
                                }
                            }}
                            className="w-full px-6 py-4 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark transition-all text-lg shadow-lg shadow-primary/20"
                        >
                            🚀 Lanjutkan Ulangan
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
