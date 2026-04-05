'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import SmartText from '@/components/SmartText'
import { Danger, TimeCircle, TickSquare } from 'react-iconly'

interface QuizQuestion {
    id: string
    question_text: string
    question_type: 'ESSAY' | 'MULTIPLE_CHOICE'
    options: string[] | null
    points: number
    order_index: number
    image_url?: string | null
    passage_text?: string | null
    passage_audio_url?: string | null
    text_direction?: 'ltr' | 'rtl'
}

interface Quiz {
    id: string
    title: string
    description: string
    duration_minutes: number
    is_randomized: boolean
    questions: QuizQuestion[]
}

interface QuizAnswer {
    question_id: string
    answer: string
}

import { useAuth } from '@/contexts/AuthContext'

export default function KerjakanKuisPage() {
    const params = useParams()
    const router = useRouter()
    const { user } = useAuth()
    const quizId = params.id as string

    const [quiz, setQuiz] = useState<Quiz | null>(null)
    const [answers, setAnswers] = useState<Record<string, string>>({})
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [timeLeft, setTimeLeft] = useState<number | null>(null)
    const [startTime, setStartTime] = useState<string | null>(null)
    const [showTimeoutModal, setShowTimeoutModal] = useState(false)
    const [showOfflineTimeoutModal, setShowOfflineTimeoutModal] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isOffline, setIsOffline] = useState(false)

    // Resume State
    const [showResumeModal, setShowResumeModal] = useState(false)
    const [resumeData, setResumeData] = useState<{
        answeredCount: number
        totalQuestions: number
        timeRemaining: number
    } | null>(null)

    const timerRef = useRef<NodeJS.Timeout | null>(null)
    const answersRef = useRef(answers)

    useEffect(() => {
        answersRef.current = answers
    }, [answers])

    const quizRef = useRef(quiz)
    const startTimeRef = useRef(startTime)
    useEffect(() => { quizRef.current = quiz }, [quiz])
    useEffect(() => { startTimeRef.current = startTime }, [startTime])

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
    const saveAnswersToLocal = (answers: Record<string, string>) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(`quiz_${quizId}_answers`, JSON.stringify({
                answers,
                lastSaved: new Date().toISOString()
            }))
        }
    }

    const loadAnswersFromLocal = (): Record<string, string> => {
        if (typeof window !== 'undefined') {
            const data = localStorage.getItem(`quiz_${quizId}_answers`)
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
            localStorage.removeItem(`quiz_${quizId}_answers`)
        }
    }

    // Sync local answers to server when called manually
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
        const currentStartTime = startTimeRef.current
        const currentQuiz = quizRef.current
        if (Object.keys(localAnswers).length === 0 || !currentStartTime) return

        try {
            const formattedAnswers = Object.entries(localAnswers).map(([qId, val]) => ({
                question_id: qId,
                answer: val
            }))

            // Check if time is already up
            const durationMs = currentQuiz ? currentQuiz.duration_minutes * 60 * 1000 : 0
            const elapsed = Date.now() - new Date(currentStartTime).getTime()
            const isTimeUp = durationMs > 0 && elapsed >= durationMs

            await fetch('/api/quiz-submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quiz_id: quizId,
                    answers: formattedAnswers,
                    started_at: currentStartTime,
                    submit: isTimeUp
                })
            })

            if (isTimeUp) {
                clearLocalAnswers()
                router.replace(`/dashboard/siswa/kuis/${quizId}/hasil`)
            }
        } catch (error) {
            console.error('Error syncing to server:', error)
        }
    }

    useEffect(() => {
        if (user) {
            fetchQuizData()
        }
    }, [quizId, user])

    // Continuous Timer Effect
    useEffect(() => {
        // Don't run if critical data is missing or submitting
        if (!quiz || !startTime || submitting || timeLeft === null) return

        // If time is already up, don't start timer (handled by check below, but optimization)
        if (timeLeft <= 0) return

        timerRef.current = setInterval(() => {
            const now = new Date().getTime()
            const startStr = startTime
            if (!startStr) return

            const durationMs = quiz.duration_minutes * 60 * 1000
            const start = new Date(startStr).getTime()
            const currentElapsed = now - start
            const currentRemaining = Math.max(0, durationMs - currentElapsed)

            setTimeLeft(currentRemaining)

            if (currentRemaining <= 0) {
                if (timerRef.current) clearInterval(timerRef.current)
                if (navigator.onLine) {
                    // Call handleSubmit directly here. 
                    // Note: accessing handleSubmit inside useEffect might require it to be dependency 
                    // or wrapped in useCallback. Since it's defined in component, it changes on render.
                    // But handleSubmit functionality is static enough.
                    // Better to just copy the submit logic or call the confirmSubmit(true)
                    confirmSubmit(true)
                } else {
                    setShowOfflineTimeoutModal(true)
                }
            }
        }, 1000)

        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [quiz, startTime, submitting]) // Intentionally omitting timeLeft to prevent re-running every second

    const fetchQuizData = async () => {
        try {
            // Check Role
            if (user?.role === 'GURU' || user?.role === 'ADMIN') {
                setError('Anda login sebagai Guru/Admin. Tidak dapat mengerjakan kuis sebagai Siswa.')
                setLoading(false)
                return
            }

            // Fetch Quiz Details
            const quizRes = await fetch(`/api/quizzes/${quizId}`)
            if (!quizRes.ok) {
                setError('Gagal memuat kuis. Kuis mungkin tidak ditemukan atau belum aktif.')
                setLoading(false)
                return
            }
            const quizData = await quizRes.json()

            // Fetch Student Data
            const studentsRes = await fetch('/api/students')
            const students = await studentsRes.json()
            const myStudent = students.find((s: any) => s.user.id === user?.id)

            if (!myStudent) {
                setError('Data siswa tidak ditemukan. Pastikan akun anda terdaftar sebagai siswa.')
                setLoading(false)
                return
            }

            setQuiz(quizData)

            // Initialize or Resume attempt
            await initializeAttempt(quizData, myStudent)

        } catch (error) {
            console.error('Error:', error)
            setError('Terjadi kesalahan saat memuat kuis.')
            setLoading(false)
        }
    }

    const initializeAttemptFromResume = (quizData: Quiz, remainingTime: number) => {
        setTimeLeft(remainingTime)
        setLoading(false)
        // Timer handled by useEffect
    }

    // Helper for new attempt initialization
    const startNewAttemptTimer = (quizData: Quiz, startedAt: Date) => {
        const durationMs = quizData.duration_minutes * 60 * 1000
        const elapsed = new Date().getTime() - startedAt.getTime()
        const remaining = Math.max(0, durationMs - elapsed)

        setTimeLeft(remaining)
        setLoading(false)
        // Timer handled by useEffect
    }

    const initializeAttempt = async (quizData: Quiz, myStudent: any) => {
        // Check existing submission
        const subRes = await fetch(`/api/quiz-submissions?quiz_id=${quizData.id}&student_id=${myStudent.id}`)
        const subs = await subRes.json()
        const existingSub = subs[0]


        let startedAt = new Date()

        if (existingSub) {
            if (existingSub.submitted_at) {
                alert('Anda sudah mengerjakan kuis ini.')
                router.push('/dashboard/siswa/kuis')
                return
            }

            // Show resume modal/logic
            const localAnswers = loadAnswersFromLocal()
            const dbAnswers: Record<string, string> = {}

            if (existingSub.answers) {
                existingSub.answers.forEach((ans: any) => {
                    dbAnswers[ans.question_id] = ans.answer
                })
            }

            // Merge: prefer localStorage if it has more answers or same
            // Actually usually we want the latest. But here we assume local is latest if valid.
            const mergedAnswers = Object.keys(localAnswers).length >= Object.keys(dbAnswers).length
                ? { ...dbAnswers, ...localAnswers }
                : { ...localAnswers, ...dbAnswers } // If DB has more, maybe we cleared local?

            const startedAtDate = new Date(existingSub.started_at)
            const durationMs = quizData.duration_minutes * 60 * 1000
            const elapsed = new Date().getTime() - startedAtDate.getTime()
            const remaining = Math.max(0, durationMs - elapsed)

            if (remaining <= 0) {
                // Auto-submit immediately if time expired
                try {
                    const formattedAnswers = Object.entries(mergedAnswers).map(([qId, val]) => ({
                        question_id: qId,
                        answer: val as string
                    }))

                    await fetch('/api/quiz-submissions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            quiz_id: quizData.id,
                            answers: formattedAnswers,
                            started_at: existingSub.started_at,
                            submit: true
                        })
                    })

                    clearLocalAnswers()
                    // alert('Waktu pengerjaan telah habis. Jawaban Anda otomatis dikumpulkan.')
                    router.replace(`/dashboard/siswa/kuis/${quizData.id}/hasil`)
                } catch (e) {
                    console.error('Auto-submit error:', e)
                    router.replace('/dashboard/siswa/kuis')
                }
                return
            }

            setResumeData({
                answeredCount: Object.keys(mergedAnswers).length,
                totalQuestions: quizData.questions.length,
                timeRemaining: remaining
            })
            setAnswers(mergedAnswers)
            setStartTime(existingSub.started_at)
            setTimeLeft(remaining) // Set timeLeft so modal shows live timer

            // Show modal to ask user to resume
            setShowResumeModal(true)
            setLoading(false)
            return

        } else {
            // Start new attempt (implicitly by setting start time now, will be saved on first save/submit)
            // Ideally we create the submission record NOW so the server knows when we started.
            // Let's send a "start" request or just create a submission with null submitted_at

            // Create initial submission to record start time
            await fetch('/api/quiz-submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quiz_id: quizData.id,
                    answers: [],
                    started_at: startedAt.toISOString()
                })
            })
            setStartTime(startedAt.toISOString())
        }

        // Randomize questions if needed
        let displayQuestions = [...(quizData.questions || [])]
        if (quizData.is_randomized && !existingSub) {
            // Only randomize if new attempt, otherwise keep order? 
            // Actually, if we randomize, the order should probably be stored or deterministic.
            // For simplicity, let's just shuffle client side for now, 
            // BUT if the student refreshes, the order might change which is confusing.
            // Ideally the order is saved. Since we didn't add 'question_order' to submission,
            // let's skip persistent randomization for now or just sort by ID to be consistent.
            // Or just respect the `order_index` from DB which is what the API returns.
            // The API returns sorted by order_index.
            // If quiz.is_randomized is true, we should probably shuffle.
            // Let's use a seeded shuffle based on student ID + quiz ID so it's consistent?
            // Too complex for now. Let's just use the order from DB.
        }

        startNewAttemptTimer(quizData, startedAt)
    }


    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000)
        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const seconds = totalSeconds % 60
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }

    const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)



    const handleSubmit = async (auto = false) => {
        if (submitting) return

        if (auto) {
            await confirmSubmit(true)
        } else {
            setShowSubmitConfirm(true)
        }
    }

    const confirmSubmit = async (auto = false) => {
        setSubmitting(true)
        setShowSubmitConfirm(false)
        setShowOfflineTimeoutModal(false)
        if (timerRef.current) clearInterval(timerRef.current)

        try {
            // Format answers for API
            const formattedAnswers = Object.entries(answersRef.current).map(([qId, val]) => ({
                question_id: qId,
                answer: val
            }))

            await fetch('/api/quiz-submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quiz_id: quizId,
                    answers: formattedAnswers,
                    started_at: startTime,
                    submit: true
                })
            })

            // Clear localStorage after successful submit
            clearLocalAnswers()

            if (auto) {
                setShowTimeoutModal(true)
            } else {
                router.push('/dashboard/siswa/kuis')
            }
        } catch (error) {
            console.error('Error submitting:', error)
            alert('Gagal mengumpulkan kuis. Coba lagi.')
            setSubmitting(false)
        }
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
                <div className="text-red-500 mb-4 flex"><Danger set="bold" size="xlarge" primaryColor="currentColor" /></div>
                <h2 className="text-xl font-bold text-white">Oops!</h2>
                <p className="text-slate-400 text-center max-w-md">{error}</p>
                <Link href="/dashboard/siswa" className="px-6 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-colors">
                    Kembali ke Dashboard
                </Link>
            </div>
        )
    }

    if (loading || !quiz) {
        return <div className="text-center text-slate-400 py-8">Memuat soal...</div>
    }

    return (
        <div className="space-y-6 pb-20">
            {/* Header Sticky */}
            {isOffline && (
                <div className="bg-red-500 text-white text-xs font-bold text-center py-1.5 animate-pulse w-full">
                    ⚠️ Koneksi terputus — jawaban disimpan lokal & akan otomatis dikirim saat online
                </div>
            )}
            <div className="sticky top-0 z-10 bg-surface-light/90 dark:bg-surface-dark/90 backdrop-blur border-b border-gray-200 dark:border-gray-700 pb-4 pt-2 -mx-4 px-4 md:-mx-8 md:px-8">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-text-main dark:text-white truncate max-w-xs md:max-w-md">{quiz.title}</h1>
                        <p className="text-xs text-text-secondary">Total: {quiz.questions.length} Soal</p>
                    </div>
                    <div className={`px-4 py-2 rounded-xl font-mono text-xl font-bold shadow-lg relative ${(timeLeft || 0) < 60000 ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 dark:bg-surface-dark text-primary dark:text-primary-light'}`}>
                        {timeLeft !== null ? formatTime(timeLeft) : '--:--:--'}
                    </div>
                </div>
            </div>

            {/* Question List */}
            <div className="space-y-8 max-w-3xl mx-auto">
                {(() => {
                    // Group audio passage questions together, keep text-only passages as individual items
                    type DisplayItem =
                        | { type: 'standalone'; question: QuizQuestion; globalIdx: number }
                        | { type: 'audio_group'; audioUrl: string; passageText?: string | null; questions: { q: QuizQuestion; globalIdx: number }[] }

                    const items: DisplayItem[] = []
                    const audioGroupMap = new Map<string, { audioUrl: string; passageText?: string | null; questions: { q: QuizQuestion; globalIdx: number }[] }>()

                    quiz.questions.forEach((q, idx) => {
                        if (q.passage_audio_url) {
                            // Group by audio URL
                            const key = q.passage_audio_url
                            if (!audioGroupMap.has(key)) {
                                audioGroupMap.set(key, { audioUrl: q.passage_audio_url, passageText: q.passage_text, questions: [] })
                            }
                            audioGroupMap.get(key)!.questions.push({ q, globalIdx: idx })
                        } else {
                            items.push({ type: 'standalone', question: q, globalIdx: idx })
                        }
                    })

                    // Insert audio groups at the position of their first question
                    const audioGroups = Array.from(audioGroupMap.values())
                    audioGroups.forEach(group => {
                        const firstIdx = group.questions[0].globalIdx
                        // Find insert position in items
                        let insertAt = items.findIndex(item => item.type === 'standalone' && item.globalIdx > firstIdx)
                        if (insertAt === -1) insertAt = items.length
                        items.splice(insertAt, 0, { type: 'audio_group', ...group })
                    })

                    // Renumber all questions sequentially
                    let questionNumber = 0

                    return items.map((item, itemIdx) => {
                        if (item.type === 'audio_group') {
                            return (
                                <div key={`audio-group-${itemIdx}`} className="bg-surface-light dark:bg-surface-dark border border-violet-300 dark:border-violet-700 rounded-xl overflow-hidden">
                                    {/* Audio + Passage Header */}
                                    <div className="p-5 bg-violet-50 dark:bg-violet-900/20 border-b border-violet-200 dark:border-violet-700">
                                        <p className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-2 flex items-center gap-1">🎧 Listening</p>
                                        <audio controls controlsList="nodownload" className="w-full mb-2" src={item.audioUrl} />
                                        {item.passageText && (
                                            <>
                                                <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-1 mt-3">📖 Bacaan:</p>
                                                <p className="text-sm text-text-main dark:text-white whitespace-pre-wrap leading-relaxed">{item.passageText}</p>
                                            </>
                                        )}
                                    </div>
                                    {/* Questions in group */}
                                    <div className="divide-y divide-violet-100 dark:divide-violet-800">
                                        {item.questions.map(({ q }) => {
                                            questionNumber++
                                            return (
                                                <div key={q.id} className="p-6">
                                                    <div className="flex items-start gap-4 mb-4">
                                                        <span className="w-8 h-8 flex-shrink-0 bg-violet-500 text-white rounded-full flex items-center justify-center font-bold">
                                                            {questionNumber}
                                                        </span>
                                                        <div className="flex-1" dir={q.text_direction || 'ltr'}>
                                                            <SmartText text={q.question_text} className="text-text-main dark:text-white text-lg leading-relaxed whitespace-pre-wrap" />
                                                        </div>
                                                        <span className="text-xs text-text-secondary font-medium px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">
                                                            {q.points} Poin
                                                        </span>
                                                    </div>
                                                    {q.image_url && (
                                                        <div className="pl-12 mb-4">
                                                            <img src={q.image_url} alt="Gambar soal" className="max-h-64 rounded-lg border border-gray-200 dark:border-gray-600" />
                                                        </div>
                                                    )}
                                                    <div className="pl-12">
                                                        {q.question_type === 'MULTIPLE_CHOICE' && q.options ? (
                                                            <div className="space-y-3">
                                                                {q.options.map((opt, optIdx) => {
                                                                    const letter = String.fromCharCode(65 + optIdx)
                                                                    const isSelected = answers[q.id] === letter
                                                                    return (
                                                                        <label key={optIdx} className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-all border ${isSelected ? 'bg-primary/10 border-primary text-primary-dark dark:text-primary-light' : 'bg-gray-50 dark:bg-gray-800/50 border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-text-secondary dark:text-slate-300'}`}>
                                                                            <div className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 ${isSelected ? 'border-primary bg-primary text-white' : 'border-gray-400 dark:border-slate-500'}`}>
                                                                                {isSelected && <TickSquare set="bold" primaryColor="currentColor" size={16} />}
                                                                            </div>
                                                                            <input type="radio" name={`q-${q.id}`} value={letter} checked={isSelected} onChange={() => { const newAnswers = { ...answers, [q.id]: letter }; setAnswers(newAnswers); saveAnswersToLocal(newAnswers) }} className="hidden" />
                                                                            <span className="font-medium flex-1" dir={q.text_direction || 'ltr'}><span className="mr-2 font-bold opacity-70" dir="ltr">{letter}.</span><SmartText text={opt} as="span" /></span>
                                                                        </label>
                                                                    )
                                                                })}
                                                            </div>
                                                        ) : (
                                                            <textarea dir={q.text_direction || 'ltr'} value={answers[q.id] || ''} onChange={(e) => { const newAnswers = { ...answers, [q.id]: e.target.value }; setAnswers(newAnswers); saveAnswersToLocal(newAnswers) }} className={`w-full h-32 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-gray-400 ${q.text_direction === 'rtl' ? 'text-right' : ''}`} placeholder="Tulis jawaban Anda di sini..." />
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )
                        } else {
                            // Standalone question (text passage or no passage)
                            const q = item.question
                            questionNumber++
                            return (
                                <div key={q.id} className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                                    {/* Text-only passage (no audio) */}
                                    {q.passage_text && !q.passage_audio_url && (
                                        <div className="mb-4 p-4 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-xl">
                                            <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-2">📖 Bacaan:</p>
                                            <SmartText text={q.passage_text} className="text-sm text-text-main dark:text-white whitespace-pre-wrap leading-relaxed" />
                                        </div>
                                    )}
                                    <div className="flex items-start gap-4 mb-4">
                                        <span className="w-8 h-8 flex-shrink-0 bg-primary text-white rounded-full flex items-center justify-center font-bold">
                                            {questionNumber}
                                        </span>
                                        <div className="flex-1" dir={q.text_direction || 'ltr'}>
                                            <SmartText text={q.question_text} className={`text-text-main dark:text-white text-lg leading-relaxed whitespace-pre-wrap ${q.text_direction === 'rtl' ? 'text-right' : ''}`} />
                                        </div>
                                        <span className="text-xs text-text-secondary font-medium px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">
                                            {q.points} Poin
                                        </span>
                                    </div>
                                    {q.image_url && (
                                        <div className="pl-12 mb-4">
                                            <img src={q.image_url} alt="Gambar soal" className="max-h-64 rounded-lg border border-gray-200 dark:border-gray-600" />
                                        </div>
                                    )}
                                    <div className="pl-12">
                                        {q.question_type === 'MULTIPLE_CHOICE' && q.options ? (
                                            <div className="space-y-3">
                                                {q.options.map((opt, optIdx) => {
                                                    const letter = String.fromCharCode(65 + optIdx)
                                                    const isSelected = answers[q.id] === letter
                                                    return (
                                                        <label key={optIdx} className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-all border ${isSelected ? 'bg-primary/10 border-primary text-primary-dark dark:text-primary-light' : 'bg-gray-50 dark:bg-gray-800/50 border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-text-secondary dark:text-slate-300'}`}>
                                                            <div className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 ${isSelected ? 'border-primary bg-primary text-white' : 'border-gray-400 dark:border-slate-500'}`}>
                                                                {isSelected && <TickSquare set="bold" primaryColor="currentColor" size={16} />}
                                                            </div>
                                                            <input type="radio" name={`q-${q.id}`} value={letter} checked={isSelected} onChange={() => { const newAnswers = { ...answers, [q.id]: letter }; setAnswers(newAnswers); saveAnswersToLocal(newAnswers) }} className="hidden" />
                                                            <span className={`font-medium flex-1 ${q.text_direction === 'rtl' ? 'text-right' : ''}`} dir={q.text_direction || 'ltr'}><span className="mr-2 font-bold opacity-70" dir="ltr">{letter}.</span><SmartText text={opt} as="span" /></span>
                                                        </label>
                                                    )
                                                })}
                                            </div>
                                        ) : (
                                            <textarea dir={q.text_direction || 'ltr'} value={answers[q.id] || ''} onChange={(e) => { const newAnswers = { ...answers, [q.id]: e.target.value }; setAnswers(newAnswers); saveAnswersToLocal(newAnswers) }} className={`w-full h-32 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-gray-400 ${q.text_direction === 'rtl' ? 'text-right' : ''}`} placeholder="Tulis jawaban Anda di sini..." />
                                        )}
                                    </div>
                                </div>
                            )
                        }
                    })
                })()}
            </div>

            {/* Submit Action */}
            <div className="fixed bottom-0 left-0 right-0 bg-surface-light/90 dark:bg-surface-dark/90 backdrop-blur border-t border-gray-200 dark:border-gray-700 p-4 z-10">
                <div className="max-w-3xl mx-auto flex items-center justify-between">
                    <p className="text-sm text-text-secondary">
                        Terjawab: <span className="text-text-main dark:text-white font-bold">{Object.keys(answers).length}</span> / {quiz.questions.length}
                    </p>
                    <button
                        onClick={() => handleSubmit(false)}
                        disabled={submitting}
                        className="px-8 py-3 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/20 hover:bg-primary-dark transition-all disabled:opacity-50"
                    >
                        {submitting ? 'Mengirim...' : 'Kumpulkan Jawaban'}
                    </button>
                </div>
            </div>
            {/* Submit Confirmation Modal */}
            {showSubmitConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-6 w-full max-w-sm text-center shadow-xl">
                        <div className="w-16 h-16 bg-primary/20 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
                            <TickSquare set="bold" primaryColor="currentColor" size={32} />
                        </div>
                        <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Kumpulkan Kuis?</h3>
                        <p className="text-text-secondary mb-6">
                            Apakah kamu yakin ingin mengumpulkan kuis ini? Jawaban tidak dapat diubah setelah dikumpulkan.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowSubmitConfirm(false)}
                                className="flex-1 px-4 py-3 bg-gray-200 dark:bg-slate-700 text-text-main dark:text-slate-200 rounded-xl hover:bg-gray-300 dark:hover:bg-slate-600 transition-colors font-medium"
                                disabled={submitting}
                            >
                                Nanti Dulu
                            </button>
                            <button
                                onClick={() => confirmSubmit(false)}
                                disabled={submitting}
                                className="flex-1 px-4 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark transition-opacity"
                            >
                                {submitting ? 'Mengirim...' : 'Iya, Kumpulkan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Timeout Modal */}
            {showTimeoutModal && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-8 w-full max-w-sm text-center shadow-2xl">
                        <div className="w-20 h-20 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                            <TimeCircle set="bold" primaryColor="currentColor" size={40} />
                        </div>
                        <h3 className="text-2xl font-bold text-text-main dark:text-white mb-2 flex items-center justify-center gap-2">
                            Waktu Habis!
                        </h3>
                        <p className="text-text-secondary mb-6">
                            Kuis telah otomatis dikumpulkan. Jawabanmu sudah tersimpan.
                        </p>
                        <button
                            onClick={() => router.push(`/dashboard/siswa/kuis/${quizId}/hasil`)}
                            className="w-full px-6 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark transition-opacity"
                        >
                            Lihat Hasil
                        </button>
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
                            Waktu kuis telah habis, tetapi koneksi internet terputus. Jawaban Anda sudah tersimpan secara lokal dan akan dikumpulkan otomatis saat koneksi kembali.
                        </p>
                        <button
                            onClick={() => confirmSubmit(true)}
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
                            Ada Kuis yang Belum Selesai
                        </h3>
                        <p className="text-text-secondary mb-6">
                            Kamu belum menyelesaikan kuis ini. Lanjutkan dari mana kamu berhenti.
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
                                    {formatTime(timeLeft || 0)}
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                setShowResumeModal(false)
                                if (quiz && timeLeft) {
                                    initializeAttemptFromResume(quiz, timeLeft)
                                }
                            }}
                            className="w-full px-6 py-4 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark transition-all text-lg shadow-lg shadow-primary/20"
                        >
                            🚀 Lanjutkan Kuis
                        </button>

                        <button
                            onClick={() => router.push('/dashboard/siswa/kuis')}
                            className="w-full mt-3 px-6 py-3 text-text-secondary hover:text-text-main transition-colors text-sm"
                        >
                            Kembali ke Daftar Kuis
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
