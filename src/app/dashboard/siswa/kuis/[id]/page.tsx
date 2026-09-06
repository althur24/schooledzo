'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import SmartText from '@/components/SmartText'
import StudentAnswerInput from '@/components/StudentAnswerInput'
import PassageBlock from '@/components/PassageBlock'
import NetworkBadge from '@/components/NetworkBadge'
import useOnlineStatus from '@/hooks/useOnlineStatus'
import { Danger, TimeCircle, TickSquare } from 'react-iconly'

interface QuizQuestion {
    id: string
    question_text: string
    question_type: string
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
    deadline?: string | null
}

interface QuizAnswer {
    question_id: string
    answer: string
}

import { useAuth } from '@/contexts/AuthContext'
import { useSchoolLabels } from '@/contexts/LabelsContext'

export default function KerjakanKuisPage() {
    const params = useParams()
    const router = useRouter()
    const { user } = useAuth()
    const labels = useSchoolLabels()
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
    const [loadFailed, setLoadFailed] = useState(false) // error yang bisa dicoba ulang (kegagalan jaringan)
    const isOnline = useOnlineStatus()
    const isOffline = !isOnline

    // Resume State
    const [showResumeModal, setShowResumeModal] = useState(false)
    const [resumeData, setResumeData] = useState<{
        answeredCount: number
        totalQuestions: number
        timeRemaining: number
    } | null>(null)

    // E1 Gerbang mulai: attempt + timer BARU DIBUAT SETELAH siswa menekan "Mulai" —
    // membuka halaman/intip kuis tidak boleh membakar jendela waktu diam-diam.
    const [showStartGate, setShowStartGate] = useState(false)
    // E2 Info attempt yang sudah tertutup: kapan dibuka, kapan habis — menggantikan
    // alert generik "Anda sudah mengerjakan kuis ini" yang membingungkan siswa.
    // E3: canRescue = ada draft lokal yang belum sampai ke server sebelum ditutup.
    const [closedInfo, setClosedInfo] = useState<{
        submission_id: string
        started_at: string | null
        ends_at: string | null
        canRescue: boolean
    } | null>(null)
    const [rescueSending, setRescueSending] = useState(false)
    const [rescueDone, setRescueDone] = useState(false)
    const myStudentRef = useRef<any>(null)

    const timerRef = useRef<NodeJS.Timeout | null>(null)
    const answersRef = useRef(answers)

    // Delta autosave: hanya soal yang berubah sejak flush sukses terakhir yang
    // dikirim ke server (bukan seluruh set — kuis 50 soal essay berarti
    // rewrite JSONB besar tiap 1,5 dtk per siswa). Server merge per question_id.
    const dirtyQuestionsRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        answersRef.current = answers
    }, [answers])

    const quizRef = useRef(quiz)
    const startTimeRef = useRef(startTime)
    useEffect(() => { quizRef.current = quiz }, [quiz])
    useEffect(() => { startTimeRef.current = startTime }, [startTime])

    // Ref pendamping listener 'online' (stale-closure-safe): retry load saat koneksi kembali
    const loadFailedRef = useRef(false)
    useEffect(() => { loadFailedRef.current = loadFailed }, [loadFailed])

    // Patokan waktu dari server: ends_at (batas efektif = min(started_at + durasi, deadline))
    // + offset jam HP vs server. Semua hitungan sisa waktu memakai keduanya — kebal jam HP ngaco.
    const endsAtRef = useRef<number | null>(null)
    const offsetMsRef = useRef(0)

    // Sisa waktu (milidetik — konvensi halaman ini) dihitung ulang dari patokan server
    // tiap tick. null = patokan belum diketahui / kuis tanpa batas waktu — BUKAN "waktu
    // habis": memakai 0 di sini membuat kuis tanpa durasi salah tampil 00:00:00 merah.
    const computeRemainingMs = (): number | null => {
        if (endsAtRef.current === null) return null
        return Math.max(0, endsAtRef.current - (Date.now() + offsetMsRef.current))
    }

    // Status online/offline kini dari hook useOnlineStatus (blok listener di sini dihapus).

    // LocalStorage helpers
    const saveAnswersToLocal = (answers: Record<string, string>) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(`quiz_${quizId}_answers`, JSON.stringify({
                answers,
                lastSaved: new Date().toISOString()
            }))
        }
    }

    const loadLocalDraft = (): { answers: Record<string, string>; lastSaved: string | null } => {
        if (typeof window !== 'undefined') {
            const data = localStorage.getItem(`quiz_${quizId}_answers`)
            if (data) {
                try {
                    const parsed = JSON.parse(data)
                    return { answers: parsed.answers || {}, lastSaved: parsed.lastSaved || null }
                } catch (e) {
                    return { answers: {}, lastSaved: null }
                }
            }
        }
        return { answers: {}, lastSaved: null }
    }

    const loadAnswersFromLocal = (): Record<string, string> => loadLocalDraft().answers

    const clearLocalAnswers = () => {
        if (typeof window !== 'undefined') {
            localStorage.removeItem(`quiz_${quizId}_answers`)
        }
    }

    // === Autosave jawaban ke server (debounce 1,5 dtk) ===
    // Pola yang sama dengan ulangan/UTS-UAS: server selalu punya salinan terbaru,
    // jadi penutupan paksa saat waktu habis memakai jawaban ASLI siswa — bukan array kosong.
    // Save-progress = satu update kolom answers (JSONB); jawaban lokal tetap ada sampai server konfirmasi.
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const saveTimerRef = useRef<NodeJS.Timeout | null>(null)

    const scheduleSaveToServer = () => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => { flushSaveToServer() }, 1500)
    }

    const flushSaveToServer = async () => {
        const current = answersRef.current
        // Submission dibuat saat halaman dibuka (startTimeRef terisi) — tanpa itu belum ada yang bisa disimpan
        if (!startTimeRef.current) return

        // Delta: kirim hanya soal dirty. Set dirty kosong (mis. tepat setelah
        // load sebelum resume) → fallback kirim semua (superset, server merge aman).
        const dirty = dirtyQuestionsRef.current
        let payload: { question_id: string; answer: string }[]
        let sentIds: Set<string> | null = null
        if (dirty.size > 0) {
            sentIds = new Set(dirty)
            payload = Array.from(sentIds)
                .filter(qId => current[qId] !== undefined)
                .map(qId => ({ question_id: qId, answer: current[qId] }))
        } else {
            payload = Object.entries(current).map(([question_id, answer]) => ({ question_id, answer }))
        }
        if (payload.length === 0) return

        setSaveStatus('saving')
        try {
            const res = await fetch('/api/quiz-submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quiz_id: quizId,
                    answers: payload
                })
            })
            if (res.status === 409) {
                const data = await res.json().catch(() => null)
                if (data?.code === 'TIME_EXPIRED') {
                    if (timerRef.current) clearInterval(timerRef.current)
                    clearLocalAnswers()
                    router.replace(`/dashboard/siswa/kuis/${quizId}/hasil`)
                    return
                }
            }
            // 400 "Kuis sudah dikumpulkan": submission sudah tertutup rapi (mis. submit
            // mendahului save yang tertunda) — bukan kegagalan, jangan tampilkan error
            if (res.status === 400) {
                setSaveStatus('idle')
                return
            }
            // Flush tersimpan (atau submission final — dirty tak relevan lagi):
            // hapus hanya soal yang nilainya MASIH sama dengan yang terkirim.
            // Soal yang diubah user selama flush in-flight tetap dirty (dikirim
            // ulang oleh flush berikutnya).
            if (res.ok && sentIds) {
                const nowAnswers = answersRef.current
                for (const p of payload) {
                    if (nowAnswers[p.question_id] === p.answer) dirty.delete(p.question_id)
                }
            }
            setSaveStatus(res.ok ? 'saved' : 'error')
        } catch {
            setSaveStatus('error') // jawaban lokal aman; dirty bertahan → perubahan berikutnya / reconnect mengirim ulang
        }
    }

    // Satu pintu perubahan jawaban: state + localStorage + jadwalkan autosave server
    const applyAnswersChange = (newAnswers: Record<string, string>, changedQuestionId?: string) => {
        setAnswers(newAnswers)
        saveAnswersToLocal(newAnswers)
        if (changedQuestionId) dirtyQuestionsRef.current.add(changedQuestionId)
        scheduleSaveToServer()
    }

    // Bersihkan timer autosave saat unmount
    useEffect(() => {
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
    }, [])

    // Sync local answers to server when called manually
    useEffect(() => {
        const handleOnline = () => {
            // Halaman gagal dimuat saat offline → muat ulang begitu koneksi kembali
            if (loadFailedRef.current) {
                setError(null)
                setLoadFailed(false)
                setLoading(true)
                fetchQuizData()
                return
            }
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
        if (Object.keys(localAnswers).length === 0 || !currentStartTime) return

        try {
            const formattedAnswers = Object.entries(localAnswers).map(([qId, val]) => ({
                question_id: qId,
                answer: val
            }))

            // Kedaluwarsa dinilai dari patokan server (ends_at + offset), bukan jam HP mentah
            const isTimeUp = endsAtRef.current !== null && (Date.now() + offsetMsRef.current) >= endsAtRef.current

            const res = await fetch('/api/quiz-submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quiz_id: quizId,
                    answers: formattedAnswers,
                    started_at: currentStartTime,
                    submit: isTimeUp
                })
            })

            // 409 TIME_EXPIRED: server sudah menutup (jawaban request ikut terselamatkan
            // via merge). 400 "Kuis sudah dikumpulkan": submission tertutup dari jalur lain
            // (submit mendahului sync / device lain). Keduanya = state final di server,
            // draft lokal aman dibersihkan supaya tidak bocor ke attempt berikutnya.
            const errBody = res.ok ? null : await res.json().catch(() => null)
            const alreadySubmitted = res.status === 400 && errBody?.error === 'Kuis sudah dikumpulkan'
            if (res.status === 409 || alreadySubmitted) {
                clearLocalAnswers()
                router.replace(`/dashboard/siswa/kuis/${quizId}/hasil`)
            } else if (isTimeUp && res.ok) {
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

    // Continuous Timer Effect — dihitung ulang dari patokan server (ends_at + offset),
    // bukan dari startTime lokal: kebal jam HP ngaco & konsisten dengan enforcement server
    useEffect(() => {
        // Don't run if critical data is missing or submitting
        if (!quiz || !startTime || submitting || timeLeft === null) return

        // If time is already up, don't start timer (handled by check below, but optimization)
        if (timeLeft <= 0) return

        timerRef.current = setInterval(() => {
            const currentRemaining = computeRemainingMs()
            // null = tanpa batas waktu / patokan belum diketahui — tidak ada yang perlu di-tick
            if (currentRemaining === null) return

            setTimeLeft(currentRemaining)

            if (currentRemaining <= 0) {
                if (timerRef.current) clearInterval(timerRef.current)
                if (navigator.onLine) {
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
                setError(`Anda login sebagai Guru/Admin. Tidak dapat mengerjakan ${labels.kuis} sebagai Siswa.`)
                setLoading(false)
                return
            }

            // Fetch Quiz Details
            const quizRes = await fetch(`/api/quizzes/${quizId}`)
            if (!quizRes.ok) {
                setError(`Gagal memuat ${labels.kuis}. ${labels.kuis} mungkin tidak ditemukan atau belum aktif.`)
                setLoading(false)
                return
            }
            const quizData = await quizRes.json()

            // Deadline TIDAK dicek client-side: penegakan ada di server dengan kontrak
            // "deadline hanya menggerbang attempt BARU" (attempt berjalan tetap bisa
            // diselesaikan). Cek lokal pakai jam HP mentah pernah memblokir siswa keliru.

            // Fetch Student Data
            const studentsRes = await fetch(`/api/students?user_id=${user?.id}`)
            const students = await studentsRes.json()
            const myStudent = students[0] || null

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
            // Gagal memuat (drop koneksi dsb.) BUKAN berarti kuisnya selesai/terkunci —
            // attempt & draft jawaban tetap aman (server + localStorage). Beri pesan
            // sesuai kondisi jaringan + tombol coba lagi.
            setLoadFailed(true)
            setError(!navigator.onLine
                ? 'Koneksi terputus. Jawaban tersimpan lokal akan dikirim otomatis saat online. Periksa koneksi Anda lalu coba lagi.'
                : `Gagal memuat ${labels.kuis}. Periksa koneksi Anda lalu coba lagi.`)
            setLoading(false)
        }
    }

    const handleRetry = () => {
        setError(null)
        setLoadFailed(false)
        setLoading(true)
        fetchQuizData()
    }

    const initializeAttemptFromResume = (quizData: Quiz, remainingTime: number | null) => {
        // null = kuis tanpa batas waktu — JANGAN koerce ke 0 (timer badge akan
        // menampilkan "00:00:00" merah berkedip seolah waktu habis)
        setTimeLeft(remainingTime)
        setLoading(false)
        // Timer handled by useEffect
    }

    // Helper for new attempt initialization — sisa waktu dari patokan server (ends_at)
    const startNewAttemptTimer = (_quizData: Quiz, _startedAt: Date) => {
        if (endsAtRef.current !== null) setTimeLeft(computeRemainingMs())
        setLoading(false)
        // Timer handled by useEffect
    }

    const initializeAttempt = async (quizData: Quiz, myStudent: any) => {
        // Check existing submission
        const subRes = await fetch(`/api/quiz-submissions?quiz_id=${quizData.id}&student_id=${myStudent.id}`)
        // Patokan waktu server: koreksi jam HP via header response
        const hdrServerTime = subRes.headers.get('x-server-time')
        if (hdrServerTime) offsetMsRef.current = new Date(hdrServerTime).getTime() - Date.now()
        // Body error ({error:...}) TIDAK BOLEH dianggap submission — dulu object error
        // (truthy) lolos sebagai existingSub → started_at/ends_at undefined → autosave
        // mati & resume modal kacau saat blip jaringan.
        if (!subRes.ok) throw new Error('GAGAL_MEMUAT_STATUS_ATTEMPT')
        const subs = await subRes.json()
        const existingSub = Array.isArray(subs) ? subs[0] : undefined
        if (existingSub?.ends_at) endsAtRef.current = new Date(existingSub.ends_at).getTime()


        let startedAt = new Date()

        if (existingSub) {
            if (existingSub.submitted_at) {
                // E2: attempt sudah dikumpulkan/ditutup — tampilkan layar informatif
                // (kapan dibuka & kapan batasnya habis), bukan alert generik.
                const localDraft = loadLocalDraft()
                const localAnswers = localDraft.answers || {}
                const dbAnswers: Record<string, string> = {}
                if (existingSub.answers) {
                    existingSub.answers.forEach((ans: any) => {
                        dbAnswers[ans.question_id] = ans.answer
                    })
                }
                const draftStale = localDraft.lastSaved !== null && existingSub.started_at != null
                    && new Date(localDraft.lastSaved).getTime() < new Date(existingSub.started_at).getTime()
                // E3: draft lokal berisi jawaban yang belum sempat sampai ke server
                // sebelum attempt ditutup paksa (mis. browser mati saat waktu habis)
                const canRescue = !draftStale && Object.keys(localAnswers).some(
                    qId => localAnswers[qId] !== dbAnswers[qId]
                )
                setClosedInfo({
                    submission_id: existingSub.id,
                    started_at: existingSub.started_at,
                    ends_at: existingSub.ends_at ?? null,
                    canRescue
                })
                setLoading(false)
                return
            }

            // Show resume modal/logic
            const localDraft = loadLocalDraft()
            const localAnswers = localDraft.answers
            const dbAnswers: Record<string, string> = {}

            if (existingSub.answers) {
                existingSub.answers.forEach((ans: any) => {
                    dbAnswers[ans.question_id] = ans.answer
                })
            }

            // Draft dari attempt lama (lastSaved mendahului started_at server, mis. setelah
            // reset manual di DB) diabaikan supaya tidak mencampur attempt sebelumnya.
            const draftStale = localDraft.lastSaved !== null && existingSub.started_at != null
                && new Date(localDraft.lastSaved).getTime() < new Date(existingSub.started_at).getTime()

            // Merge per soal: draft lokal (device ini) dianggap terbaru untuk soal yang
            // sama-sama terjawab; jawaban server dipertahankan untuk soal yang tak ada di lokal.
            // (Autosave gagal saat offline → server tertinggal, localStorage yang lengkap.)
            const mergedAnswers = draftStale
                ? dbAnswers
                : { ...dbAnswers, ...localAnswers }

            // Sisa waktu dari patokan server (ends_at), bukan jam HP. null = tanpa batas.
            const remaining = computeRemainingMs()

            if (endsAtRef.current !== null && remaining !== null && remaining <= 0) {
                // Auto-submit immediately if time expired — server tetap yang menilai batas
                try {
                    const formattedAnswers = Object.entries(mergedAnswers).map(([qId, val]) => ({
                        question_id: qId,
                        answer: val as string
                    }))

                    const res = await fetch('/api/quiz-submissions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            quiz_id: quizData.id,
                            answers: formattedAnswers,
                            started_at: existingSub.started_at,
                            submit: true
                        })
                    })

                    // 409 TIME_EXPIRED: server sudah menutup dengan jawaban tersimpan — aman dibersihkan
                    if (res.ok || res.status === 409) clearLocalAnswers()
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
                timeRemaining: remaining ?? 0
            })
            setAnswers(mergedAnswers)
            // Full resync: setelah resume, semua jawaban merge dianggap dirty —
            // autosave pertama berikutnya mengirim set lengkap (meng-cover kasus
            // autosave gagal offline sebelumnya → server tertinggal).
            dirtyQuestionsRef.current = new Set(Object.keys(mergedAnswers))
            setStartTime(existingSub.started_at)
            if (endsAtRef.current !== null) setTimeLeft(remaining) // Set timeLeft so modal shows live timer

            // Show modal to ask user to resume
            setShowResumeModal(true)
            setLoading(false)
            return

        } else {
            // E1 Gerbang mulai: JANGAN buat attempt di sini. Waktu (duration) baru
            // berjalan setelah siswa menekan "Mulai" di layar konfirmasi —
            // membuka halaman untuk melihat-lihat tidak boleh membakar jendela
            // waktu diam-diam (akar kasus "baru ngerjain 1 soal tiba-tiba tertutup").
            myStudentRef.current = myStudent
            setShowStartGate(true)
            setLoading(false)
            return
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

    // E1: attempt benar-benar dimulai — dipanggil dari tombol "Mulai" di gerbang.
    const beginNewAttempt = async () => {
        const quizData = quiz
        if (!quizData) return
        setLoading(true)
        setShowStartGate(false)
        try {
            // Start new attempt — started_at & ends_at otoritatif dari server (jam HP tidak dipercaya)
            const res = await fetch('/api/quiz-submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quiz_id: quizData.id,
                    answers: []
                })
            })
            const startData = await res.json().catch(() => null)
            // Start ditolak server (belum dibuka / lewat deadline / dsb.) — JANGAN render
            // editor "hantu": submission tidak dibuat, autosave akan gagal terus-menerus.
            if (!res.ok) {
                setError(startData?.error || `Tidak bisa memulai ${labels.kuis} ini.`)
                setLoadFailed(true)
                setLoading(false)
                return
            }
            if (startData?.server_time) offsetMsRef.current = new Date(startData.server_time).getTime() - Date.now()
            if (startData?.ends_at) endsAtRef.current = new Date(startData.ends_at).getTime()
            setStartTime(startData?.started_at || new Date().toISOString())
            startNewAttemptTimer(quizData, new Date())
        } catch (e) {
            console.error('Error starting attempt:', e)
            setError(`Gagal memulai ${labels.kuis}. Periksa koneksi Anda lalu coba lagi.`)
            setLoadFailed(true)
            setLoading(false)
        }
    }

    // E3: kirim draft lokal (jawaban yang belum sempat tersimpan sebelum attempt
    // ditutup paksa) ke guru untuk ditinjau manual — lebih adil daripada dibuang diam-diam.
    const handleRescueDraft = async () => {
        if (!closedInfo || rescueSending) return
        setRescueSending(true)
        try {
            const localDraft = loadLocalDraft()
            const formattedAnswers = Object.entries(localDraft.answers || {}).map(([qId, val]) => ({
                question_id: qId,
                answer: val as string
            }))
            const res = await fetch(`/api/quiz-submissions/${closedInfo.submission_id}/rescue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answers: formattedAnswers })
            })
            if (!res.ok) throw new Error('rescue failed')
            clearLocalAnswers()
            setRescueDone(true)
        } catch (e) {
            console.error('Rescue draft error:', e)
            alert('Gagal mengirim jawaban. Coba lagi sebentar lagi.')
        } finally {
            setRescueSending(false)
        }
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
        // Batalkan autosave terjadwal — submit ini membawa semua jawaban;
        // tanpa ini save yang tertunda menembak submission yang sudah tertutup (400)
        // dan indikator "Gagal menyimpan" muncul di kuis yang sebenarnya sudah terkumpul
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)

        try {
            // Format answers for API
            const formattedAnswers = Object.entries(answersRef.current).map(([qId, val]) => ({
                question_id: qId,
                answer: val
            }))

            const res = await fetch('/api/quiz-submissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quiz_id: quizId,
                    answers: formattedAnswers,
                    started_at: startTime,
                    submit: true
                })
            })

            // 400 "sudah dikumpulkan" / 409 TIME_EXPIRED: submission sudah tertutup rapi di server
            // (409 = ditutup paksa dengan jawaban yang tersimpan) — keduanya aman untuk lanjut
            if (!res.ok && res.status !== 400 && res.status !== 409) {
                const errData = await res.json().catch(() => null)
                throw new Error(errData?.error || `Gagal mengumpulkan ${labels.kuis}`)
            }

            // Clear localStorage after successful submit
            clearLocalAnswers()

            if (auto) {
                setShowTimeoutModal(true)
            } else {
                router.push('/dashboard/siswa/kuis')
            }
        } catch (error) {
            console.error('Error submitting:', error)
            alert(`Gagal mengumpulkan ${labels.kuis}. Coba lagi.`)
            setSubmitting(false)
        }
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
                <div className="text-red-500 mb-4 flex"><Danger set="bold" size="xlarge" primaryColor="currentColor" /></div>
                <h2 className="text-xl font-bold text-white">Oops!</h2>
                <p className="text-slate-400 text-center max-w-md">{error}</p>
                {loadFailed && (
                    <button
                        onClick={handleRetry}
                        className="px-6 py-2 bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors font-bold"
                    >
                        Coba Lagi
                    </button>
                )}
                <Link href="/dashboard/siswa" className="px-6 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-colors">
                    Kembali ke Dashboard
                </Link>
            </div>
        )
    }

    // E2: layar informatif untuk attempt yang sudah tertutup
    if (closedInfo) {
        const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 space-y-5 max-w-md mx-auto">
                <div className="w-16 h-16 rounded-full bg-amber-500/15 flex items-center justify-center text-amber-500 text-3xl">⏱️</div>
                <h2 className="text-xl font-bold text-text-main dark:text-white text-center">Waktu {labels.kuis} ini sudah berakhir</h2>
                <div className="w-full space-y-2 text-sm">
                    <div className="flex justify-between px-4 py-2.5 rounded-xl bg-secondary/10">
                        <span className="text-text-secondary">Kamu membuka {labels.kuis}</span>
                        <span className="font-bold text-text-main dark:text-white">{fmt(closedInfo.started_at)}</span>
                    </div>
                    <div className="flex justify-between px-4 py-2.5 rounded-xl bg-secondary/10">
                        <span className="text-text-secondary">Batas waktu berakhir</span>
                        <span className="font-bold text-text-main dark:text-white">{fmt(closedInfo.ends_at)}</span>
                    </div>
                </div>
                <p className="text-text-secondary text-sm text-center">
                    Durasi {labels.kuis} dihitung sejak kamu pertama membuka {labels.kuis}, bukan sejak kamu mulai menjawab.
                    Jawaban yang tersimpan hingga batas waktu otomatis dikumpulkan.
                </p>

                {/* E3: rescue draft lokal yang belum sampai ke server */}
                {closedInfo.canRescue && !rescueDone && (
                    <div className="w-full p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-3">
                        <p className="text-sm text-text-main dark:text-white font-medium">
                            Ada jawaban di perangkat ini yang belum sempat terkirim sebelum waktu berakhir.
                        </p>
                        <button
                            onClick={handleRescueDraft}
                            disabled={rescueSending}
                            className="w-full px-4 py-2.5 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700 disabled:opacity-60 transition-colors text-sm"
                        >
                            {rescueSending ? 'Mengirim...' : 'Kirim Jawaban ke Guru untuk Ditinjau'}
                        </button>
                        <p className="text-xs text-text-secondary">Guru akan meninjau jawabanmu secara manual — nilainya tidak berubah otomatis.</p>
                    </div>
                )}
                {rescueDone && (
                    <p className="text-green-600 dark:text-green-400 text-sm font-medium text-center">✓ Jawabanmu sudah dikirim ke guru untuk ditinjau.</p>
                )}

                <div className="flex gap-3 w-full">
                    <Link href={`/dashboard/siswa/kuis/${quizId}/hasil`} className="flex-1 text-center px-4 py-2.5 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark transition-colors text-sm">
                        Lihat Hasil
                    </Link>
                    <Link href="/dashboard/siswa/kuis" className="flex-1 text-center px-4 py-2.5 bg-secondary/80 text-text-main dark:text-white rounded-xl font-bold hover:bg-secondary transition-colors text-sm">
                        Daftar {labels.kuis}
                    </Link>
                </div>
            </div>
        )
    }

    // E1: gerbang konfirmasi sebelum attempt (dan timer) dimulai
    if (showStartGate && quiz) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 space-y-5 max-w-md mx-auto">
                <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center text-3xl">📝</div>
                <h2 className="text-xl font-bold text-text-main dark:text-white text-center">{quiz.title}</h2>
                <div className="w-full space-y-2 text-sm">
                    <div className="flex justify-between px-4 py-2.5 rounded-xl bg-secondary/10">
                        <span className="text-text-secondary">Jumlah soal</span>
                        <span className="font-bold text-text-main dark:text-white">{quiz.questions.length} soal</span>
                    </div>
                    {quiz.duration_minutes > 0 && (
                        <div className="flex justify-between px-4 py-2.5 rounded-xl bg-secondary/10">
                            <span className="text-text-secondary">Durasi pengerjaan</span>
                            <span className="font-bold text-text-main dark:text-white">{quiz.duration_minutes} menit</span>
                        </div>
                    )}
                    {quiz.deadline && (
                        <div className="flex justify-between px-4 py-2.5 rounded-xl bg-secondary/10">
                            <span className="text-text-secondary">Batas akhir</span>
                            <span className="font-bold text-text-main dark:text-white">
                                {new Date(quiz.deadline).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                    )}
                </div>
                <div className="w-full p-4 rounded-xl border border-amber-500/40 bg-amber-500/10">
                    <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">
                        ⚠️ {quiz.duration_minutes > 0
                            ? `Waktu ${quiz.duration_minutes} menit mulai berjalan SEKARANG setelah kamu menekan tombol Mulai — walaupun kamu keluar atau menutup halaman.`
                            : 'Pastikan kamu benar-benar siap sebelum memulai.'}
                    </p>
                </div>
                <button
                    onClick={beginNewAttempt}
                    className="w-full px-6 py-3.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl font-bold shadow-lg shadow-cyan-500/20 hover:scale-[1.01] transition-all">
                    🚀 Mulai {labels.kuis} Sekarang
                </button>
                <Link href="/dashboard/siswa/kuis" className="text-text-secondary hover:text-text-main text-sm transition-colors">
                    Kembali dulu, saya belum siap
                </Link>
            </div>
        )
    }

    if (loading || !quiz) {
        return <div className="text-center text-slate-400 py-8">Memuat soal...</div>
    }

    return (
        <div className="space-y-6 pb-20 px-4 md:px-8">
            {/* Header Sticky */}
            {isOffline && (
                <div className="bg-red-500 text-white text-xs font-bold text-center py-1.5 animate-pulse w-full">
                    ⚠️ Koneksi terputus — jawaban disimpan lokal & akan otomatis dikirim saat online
                </div>
            )}
            <div className="sticky top-0 z-10 bg-surface-light/90 dark:bg-surface-dark/90 backdrop-blur border-b border-gray-200 dark:border-gray-700 pb-3 pt-2 md:pb-4 md:pt-2 -mx-4 px-4 md:-mx-8 md:px-8">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-base md:text-xl font-bold text-text-main dark:text-white truncate max-w-[200px] md:max-w-md">{quiz.title}</h1>
                        <p className="text-xs text-text-secondary">Total: {quiz.questions.length} Soal</p>
                    </div>
                    <div className="flex items-center gap-2 md:gap-3">
                        {saveStatus !== 'idle' && (
                            <span className={`text-[10px] font-bold ${saveStatus === 'error' ? 'text-red-500' : saveStatus === 'saved' ? 'text-green-500' : 'text-text-secondary'}`}>
                                {saveStatus === 'saving' ? 'Menyimpan…' : saveStatus === 'saved' ? 'Tersimpan' : 'Gagal menyimpan'}
                            </span>
                        )}
                        <NetworkBadge isOnline={isOnline} />
                        <div className={`px-3 py-1.5 md:px-4 md:py-2 rounded-xl font-mono text-base md:text-xl font-bold shadow-lg relative ${timeLeft !== null && timeLeft < 60000 ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 dark:bg-surface-dark text-primary dark:text-primary-light'}`}>
                            {timeLeft !== null ? formatTime(timeLeft) : '--:--:--'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Question List */}
            <div className="space-y-5 md:space-y-8 max-w-3xl mx-auto">
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
                                    <div className="p-3 md:p-5 bg-violet-50 dark:bg-violet-900/20 border-b border-violet-200 dark:border-violet-700">
                                        <p className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-2 flex items-center gap-1">🎧 Listening</p>
                                        <audio controls controlsList="nodownload" className="w-full mb-2" src={item.audioUrl} />
                                        {item.passageText && (
                                            <PassageBlock text={item.passageText} />
                                        )}
                                    </div>
                                    {/* Questions in group */}
                                    <div className="divide-y divide-violet-100 dark:divide-violet-800">
                                        {item.questions.map(({ q }) => {
                                            questionNumber++
                                            return (
                                                <div key={q.id} className="p-3 md:p-6">
                                                    <div className="flex items-center gap-3 mb-3">
                                                        <span className="w-7 h-7 md:w-8 md:h-8 flex-shrink-0 bg-violet-500/20 text-violet-600 dark:text-violet-400 rounded-full flex items-center justify-center font-bold text-xs md:text-sm">
                                                            {questionNumber}
                                                        </span>
                                                        <span className={`px-2 py-0.5 text-xs rounded bg-secondary/10 text-text-main dark:text-white`}>
                                            {q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 
                                             q.question_type === 'MULTIPLE_ANSWER' ? 'Ganda Kompleks' : 
                                             q.question_type === 'TRUE_FALSE' ? 'Benar Salah' : 
                                             q.question_type === 'SHORT_ANSWER' ? 'Isian Singkat' : 'Essay'}
                                        </span>

                                                    </div>
                                                    <div dir={q.text_direction || 'ltr'}>
                                                        <SmartText text={q.question_text} className="text-text-main dark:text-white text-sm md:text-base mb-3 whitespace-pre-wrap" />
                                                    </div>
                                                    {q.image_url && (
                                                        <div className="mb-3">
                                                            <img src={q.image_url} alt="Gambar soal" className="max-h-40 md:max-h-64 rounded-lg border border-gray-200 dark:border-gray-600" />
                                                        </div>
                                                    )}
                                                    <StudentAnswerInput
                                                        question={q}
                                                        value={answers[q.id]}
                                                        onChange={(val) => { applyAnswersChange({ ...answers, [q.id]: val }, q.id) }}
                                                        onChangeImmediate={(val) => { applyAnswersChange({ ...answers, [q.id]: val }, q.id) }}
                                                    />
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
                                <div key={q.id} className="bg-white dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-xl p-3 md:p-6">
                                    {/* Text-only passage (no audio) */}
                                    {q.passage_text && !q.passage_audio_url && (
                                        <div className="mb-3">
                                            <PassageBlock text={q.passage_text} />
                                        </div>
                                    )}
                                    <div className="flex items-center gap-3 mb-3">
                                        <span className="w-7 h-7 md:w-8 md:h-8 flex-shrink-0 bg-primary/20 text-primary rounded-full flex items-center justify-center font-bold text-xs md:text-sm">
                                            {questionNumber}
                                        </span>
                                        <span className={`px-2 py-0.5 text-xs rounded bg-secondary/10 text-text-main dark:text-white`}>
                                            {q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 
                                             q.question_type === 'MULTIPLE_ANSWER' ? 'Ganda Kompleks' : 
                                             q.question_type === 'TRUE_FALSE' ? 'Benar Salah' : 
                                             q.question_type === 'SHORT_ANSWER' ? 'Isian Singkat' : 'Essay'}
                                        </span>

                                    </div>
                                    <div dir={q.text_direction || 'ltr'}>
                                        <SmartText text={q.question_text} className={`text-text-main dark:text-white text-sm md:text-base mb-3 whitespace-pre-wrap ${q.text_direction === 'rtl' ? 'text-right' : ''}`} />
                                    </div>
                                    {q.image_url && (
                                        <div className="mb-3">
                                            <img src={q.image_url} alt="Gambar soal" className="max-h-40 md:max-h-64 rounded-lg border border-gray-200 dark:border-gray-600 mx-auto" />
                                        </div>
                                    )}
                                    <StudentAnswerInput
                                        question={q}
                                        value={answers[q.id]}
                                        onChange={(val) => { applyAnswersChange({ ...answers, [q.id]: val }, q.id) }}
                                        onChangeImmediate={(val) => { applyAnswersChange({ ...answers, [q.id]: val }, q.id) }}
                                    />
                                </div>
                            )
                        }
                    })
                })()}
            </div>

            {/* Submit Action */}
            <div className="fixed bottom-0 left-0 right-0 bg-surface-light/90 dark:bg-surface-dark/90 backdrop-blur border-t border-gray-200 dark:border-gray-700 p-3 md:p-4 z-10">
                <div className="max-w-3xl mx-auto flex items-center justify-between">
                    <p className="text-xs md:text-sm text-text-secondary">
                        Terjawab: <span className="text-text-main dark:text-white font-bold">{Object.keys(answers).length}</span> / {quiz.questions.length}
                    </p>
                    <button
                        onClick={() => handleSubmit(false)}
                        disabled={submitting}
                        className="px-5 py-2.5 md:px-8 md:py-3 text-sm md:text-base bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/20 hover:bg-primary-dark transition-all disabled:opacity-50"
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
                        <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Kumpulkan {labels.kuis}?</h3>
                        <p className="text-text-secondary mb-6">
                            Apakah kamu yakin ingin mengumpulkan {labels.kuis} ini? Jawaban tidak dapat diubah setelah dikumpulkan.
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
                            {labels.kuis} telah otomatis dikumpulkan. Jawabanmu sudah tersimpan.
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
                            Waktu {labels.kuis} telah habis, tetapi koneksi internet terputus. Jawaban Anda sudah tersimpan secara lokal dan akan dikumpulkan otomatis saat koneksi kembali.
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
                            Ada {labels.kuis} yang Belum Selesai
                        </h3>
                        <p className="text-text-secondary mb-6">
                            Kamu belum menyelesaikan {labels.kuis} ini. Lanjutkan dari mana kamu berhenti.
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
                                    {timeLeft !== null ? formatTime(timeLeft) : 'Tanpa Batas'}
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                setShowResumeModal(false)
                                if (quiz) {
                                    // null tetap null = Tanpa Batas (bukan 0)
                                    initializeAttemptFromResume(quiz, timeLeft)
                                }
                            }}
                            className="w-full px-6 py-4 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark transition-all text-lg shadow-lg shadow-primary/20"
                        >
                            🚀 Lanjutkan {labels.kuis}
                        </button>

                        <button
                            onClick={() => router.push('/dashboard/siswa/kuis')}
                            className="w-full mt-3 px-6 py-3 text-text-secondary hover:text-text-main transition-colors text-sm"
                        >
                            Kembali ke Daftar {labels.kuis}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
