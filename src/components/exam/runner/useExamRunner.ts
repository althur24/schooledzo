'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import useOnlineStatus from '@/hooks/useOnlineStatus'
import useExamZoom from '@/hooks/useExamZoom'
import type { ExamData, ExamRunnerConfig, ExamRunnerState, RunnerQuestion, RunnerSubmission } from './types'

/**
 * useExamRunner — SEMUA perilaku ruang ujian siswa (load, resume, autosave,
 * timer, fullscreen, pelanggaran, offline, submit). Dipakai ulangan & UTS/UAS;
 * perbedaan antar keduanya HANYA lewat ExamRunnerConfig (endpoint, storage,
 * route, label).
 *
 * Di-port dari halaman ulangan siswa (sumber kebenaran yang teruji di
 * production) dengan penyeragaman perilaku terbaik dari UTS/UAS:
 * - margin 2 detik deteksi hard-reset draft (ulangan)
 * - resume modal + offline timeout modal (ulangan)
 * - listener paste (ulangan)
 * - auto-submit kadaluarsa saat load: pesan + draft TIDAK dihapus saat gagal (uts-uas)
 * - submit gagal: pesan error server ditampilkan (uts-uas), draft tetap aman
 */
export function useExamRunner(examId: string, config: ExamRunnerConfig): ExamRunnerState {
    const router = useRouter()

    // Config dibuat inline di halaman (identitas berubah tiap render) — baca
    // lewat ref supaya deps effect/callback tetap stabil.
    const configRef = useRef(config)
    useEffect(() => { configRef.current = config })

    const [exam, setExam] = useState<ExamData | null>(null)
    const [questions, setQuestions] = useState<RunnerQuestion[]>([])
    const [submission, setSubmission] = useState<RunnerSubmission | null>(null)
    const [answers, setAnswers] = useState<{ [key: string]: string }>({})
    const [currentIndex, setCurrentIndex] = useState(0)
    const [timeLeft, setTimeLeft] = useState<number | null>(0)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [showConfirmSubmit, setShowConfirmSubmit] = useState(false)
    const [showOfflineTimeoutModal, setShowOfflineTimeoutModal] = useState(false)
    const [violationCount, setViolationCount] = useState(0)
    const [showViolationWarning, setShowViolationWarning] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [forceSubmitted, setForceSubmitted] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null) // gagal load (network dsb.) — bisa dicoba ulang
    const isOnline = useOnlineStatus()
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null)
    const [examLabel, setExamLabel] = useState(config.fallbackLabel)

    // Label untuk pesan di dalam callback — pakai ref agar tidak stale closure
    const examLabelRef = useRef(config.fallbackLabel)
    useEffect(() => { examLabelRef.current = examLabel }, [examLabel])

    const containerRef = useRef<HTMLDivElement>(null)
    const hasStarted = useRef(false)
    const timerRef = useRef<NodeJS.Timeout | null>(null)
    const answersRef = useRef(answers)
    // Patokan waktu dari server: ends_at (batas efektif, sudah termasuk override hard reset)
    // + offset jam HP vs server. Semua hitungan sisa waktu memakai keduanya — kebal jam HP ngaco.
    const endsAtRef = useRef<number | null>(null)
    const offsetMsRef = useRef(0)

    // Sisa waktu (detik) dihitung ulang dari patokan server — kebal throttle background tab / HP sleep.
    // null = patokan belum diketahui / ujian tanpa batas waktu — BUKAN "waktu habis":
    // memakai 0 di sini membuat ujian tanpa durasi salah tampil 00:00 merah + auto-submit.
    const computeRemaining = (): number | null => {
        if (endsAtRef.current === null) return null
        return Math.max(0, Math.ceil((endsAtRef.current - (Date.now() + offsetMsRef.current)) / 1000))
    }

    useEffect(() => {
        answersRef.current = answers
    }, [answers])

    // Resume State
    const [showResumeModal, setShowResumeModal] = useState(false)
    const [resumeData, setResumeData] = useState<{
        answeredCount: number
        totalQuestions: number
        timeRemaining: number
    } | null>(null)

    // Zoom internal: aktif selama pengerjaan; hint hanya saat soal benar-benar terlihat
    // (sudah fullscreen dan tidak ada modal resume) supaya tidak kedaluwarsa tersembunyi.
    const examZoomActive = !!submission && !submission.is_submitted && !forceSubmitted
    const zoom = useExamZoom(examZoomActive, examZoomActive && isFullscreen && !showResumeModal)

    const continueResume = useCallback(() => {
        if (resumeData) setTimeLeft(resumeData.timeRemaining)
        setLoading(false)
        setShowResumeModal(false)
    }, [resumeData])

    // === LocalStorage helpers (key mengikuti config.storagePrefix) ===
    const saveAnswersToLocal = (answers: { [key: string]: string }) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(`${configRef.current.storagePrefix}_${examId}_answers`, JSON.stringify({
                answers,
                lastSaved: new Date().toISOString()
            }))
        }
    }

    const loadAnswersFromLocal = (): { [key: string]: string } => {
        if (typeof window !== 'undefined') {
            const data = localStorage.getItem(`${configRef.current.storagePrefix}_${examId}_answers`)
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
            localStorage.removeItem(`${configRef.current.storagePrefix}_${examId}_answers`)
        }
    }

    const submissionRef = useRef(submission)

    useEffect(() => {
        submissionRef.current = submission
    }, [submission])

    // Ref pendamping listener 'online' (stale-closure-safe): retry load saat koneksi kembali
    const loadFailedRef = useRef(false)
    useEffect(() => { loadFailedRef.current = !!loadError }, [loadError])

    // === Queue pelanggaran yang gagal terkirim (offline) ===
    // logViolation saat offline: warning tetap tampil, tapi PUT gagal → tanpa
    // queue, pelanggaran HILANG dan tidak pernah tercatat walau online kembali
    // (jawaban punya localStorage + retry; pelanggaran sebelumnya tidak).
    // Queue di-persist (tahan refresh saat masih offline) dan di-flush SENYAP
    // tanpa UI tambahan: event online / interval 15 dtk / saat mount.
    const VIOLATION_QUEUE_KEY = `${config.storagePrefix}_${examId}_pending_violations`
    const pendingViolationsRef = useRef<{ type: string; at: number }[]>([])
    const persistViolationQueue = () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(VIOLATION_QUEUE_KEY, JSON.stringify(pendingViolationsRef.current))
        }
    }

    // Muat queue sisa refresh-saat-offline
    useEffect(() => {
        try {
            pendingViolationsRef.current = JSON.parse(localStorage.getItem(VIOLATION_QUEUE_KEY) || '[]')
        } catch { pendingViolationsRef.current = [] }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const flushPendingViolations = async () => {
        const sub = submissionRef.current
        if (!sub || sub.is_submitted) return
        if (pendingViolationsRef.current.length === 0) return
        try {
            const res = await fetch(configRef.current.submissionApi, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submission_id: sub.id,
                    violations: pendingViolationsRef.current,
                })
            })
            const data = await res.json().catch(() => null)
            if (data?.force_submitted) {
                pendingViolationsRef.current = []
                persistViolationQueue()
                setForceSubmitted(true)
                alert(`${examLabelRef.current} otomatis dikumpulkan karena pelanggaran melebihi batas!`)
                router.push(configRef.current.listRoute)
                return
            }
            if (res.ok || res.status === 400 || res.status === 409) {
                // Sukses, atau state final di server (sudah submit / kedaluwarsa) —
                // queue tidak akan pernah diterima, bersihkan supaya tidak dicoba selamanya.
                pendingViolationsRef.current = []
                persistViolationQueue()
                if (typeof data?.violation_count === 'number') setViolationCount(data.violation_count)
            }
            // 5xx: biarkan queue untuk retry berikutnya
        } catch {
            // masih offline — retry berikutnya (interval 15 dtk / event online)
        }
    }

    // Flush berkala pelanggaran tertunda — senyap, no-op saat queue kosong.
    // (Interval aktif selama ujian berjalan; cek panjang queue = murah.)
    useEffect(() => {
        if (!submission) return
        flushPendingViolations()
        const iv = setInterval(() => { flushPendingViolations() }, 15000)
        return () => clearInterval(iv)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [submission])

    // Sync local answers to server when reconnected
    useEffect(() => {
        const handleOnline = () => {
            // Halaman gagal dimuat saat offline → muat ulang begitu koneksi kembali
            if (loadFailedRef.current) {
                setLoadError(null)
                setLoading(true)
                hasStarted.current = false
                startExam()
                return
            }
            syncLocalToServer()
            flushPendingViolations()
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

    // Retry berkala saat autosave gagal: event 'online' browser TIDAK reliable —
    // WiFi tersambung tapi internet mati tidak memicu event apa pun, sehingga
    // badge bisa macet "Gagal simpan" selamanya. Retry ini memastikan sync
    // terjadi begitu server benar-benar terjangkau lagi, lalu badge pulih.
    useEffect(() => {
        if (saveStatus !== 'error' || !submission) return
        const iv = setInterval(() => { syncLocalToServer() }, 15000)
        return () => clearInterval(iv)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saveStatus, submission])

    const syncLocalToServer = async () => {
        const localAnswers = loadAnswersFromLocal()
        if (Object.keys(localAnswers).length > 0 && submissionRef.current) {
            try {
                const answersArray = Object.entries(localAnswers).map(([question_id, answer]) => ({
                    question_id, answer
                }))

                // Kedaluwarsa dinilai dari patokan server (ends_at + offset), bukan jam HP mentah
                const isTimeUp = endsAtRef.current !== null && (Date.now() + offsetMsRef.current) >= endsAtRef.current

                const t0 = performance.now()
                const res = await fetch(configRef.current.submissionApi, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        submission_id: submissionRef.current.id,
                        answers: answersArray,
                        ...(isTimeUp && { submit: true })
                    })
                })

                // 409 TIME_EXPIRED: server sudah menutup (jawaban request ikut terselamatkan
                // via upsert). 400 "Already submitted": submission tertutup dari jalur lain
                // (device lain / submit mendahului sync). Keduanya = state final di server,
                // draft lokal aman dibersihkan supaya tidak dicoba terus tiap event online.
                const errBody = res.ok ? null : await res.json().catch(() => null)
                const alreadySubmitted = res.status === 400 && errBody?.error === 'Already submitted'
                if (res.status === 409 || alreadySubmitted) {
                    clearLocalAnswers()
                    router.replace(configRef.current.resultRoute(examId))
                } else if (isTimeUp && res.ok) {
                    clearLocalAnswers()
                    router.replace(configRef.current.resultRoute(examId))
                } else if (res.ok) {
                    // Pulihkan badge: sync sukses → "Tersimpan" (sebelumnya badge macet
                    // "Gagal simpan" selamanya walau jawaban sudah masuk server).
                    setSaveStatus('saved')
                    setLastLatencyMs(performance.now() - t0)
                } else {
                    // Server menolak (5xx dsb.) → tetap error; retry loop akan mencoba lagi.
                    setSaveStatus('error')
                }
            } catch (error) {
                console.error('Error syncing to server:', error)
                setSaveStatus('error')
            }
        }
    }

    /** Normalisasi data ujian dari API (embed ulangan vs UTS/UAS berbeda). */
    const normalizeExam = (raw: any): ExamData => ({
        id: raw?.id ?? examId,
        title: raw?.title ?? '',
        description: raw?.description ?? null,
        start_time: raw?.start_time ?? '',
        duration_minutes: raw?.duration_minutes ?? 0,
        max_violations: raw?.max_violations ?? 0,
        subjectName: raw?.teaching_assignment?.subject?.name ?? raw?.subject?.name ?? '',
        exam_type: raw?.exam_type,
    })

    // Start exam - create submission
    const startExam = useCallback(async () => {
        if (hasStarted.current) return
        hasStarted.current = true

        try {
            // Fetch exam details
            const [examRes, questionsRes] = await Promise.all([
                fetch(`${configRef.current.examApiBase}/${examId}`),
                fetch(`${configRef.current.examApiBase}/${examId}/questions`)
            ])
            const examData = await examRes.json()
            const questionsData = await questionsRes.json()

            // Abort bila soal gagal dimuat (mis. gate jadwal/kelas menolak) —
            // tanpa ini POST start tetap jalan dan siswa masuk ujian 0 soal.
            if (!questionsRes.ok || !Array.isArray(questionsData)) {
                alert(typeof questionsData?.error === 'string' ? questionsData.error : `Gagal memuat soal ${configRef.current.fallbackLabel.toLowerCase()}`)
                router.push(configRef.current.listRoute)
                return
            }

            const normalizedExam = normalizeExam(examData)
            setExam(normalizedExam)
            const label = configRef.current.resolveLabel(normalizedExam)
            examLabelRef.current = label
            setExamLabel(label)

            // Start submission
            const subRes = await fetch(configRef.current.submissionApi, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exam_id: examId })
            })
            const subData = await subRes.json()

            if (subData.error) {
                alert(subData.error)
                router.push(configRef.current.listRoute)
                return
            }

            // Patokan waktu server: koreksi jam HP + batas efektif (jendela global / override hard reset)
            if (subData.server_time) {
                offsetMsRef.current = new Date(subData.server_time).getTime() - Date.now()
            }
            endsAtRef.current = subData.ends_at ? new Date(subData.ends_at).getTime() : null

            setSubmission(subData)
            setViolationCount(subData.violation_count || 0)

            // Order questions based on submission's question_order (randomized)
            const questionArr = Array.isArray(questionsData) ? questionsData : []
            if (subData.question_order && subData.question_order.length > 0) {
                const orderedQuestions = subData.question_order
                    .map((qId: string) => questionArr.find((q: RunnerQuestion) => q.id === qId))
                    .filter(Boolean)
                setQuestions(orderedQuestions)
            } else {
                setQuestions(questionArr)
            }

            // Load answers from localStorage if available
            const localAnswersRaw = localStorage.getItem(`${configRef.current.storagePrefix}_${examId}_answers`)
            let localAnswers = {}
            if (localAnswersRaw) {
                try {
                    const parsed = JSON.parse(localAnswersRaw)
                    // Deteksi Hard Reset: jika started_at server lebih baru dari lastSaved lokal,
                    // artinya ini adalah attempt baru dari Hard Reset. Abaikan & hapus cache lokal yang lama.
                    // Margin 2 detik: restart attempt yang nyaris bersamaan tidak boleh
                    // menghapus draft sah siswa.
                    const startedAtTime = new Date(subData.started_at).getTime()
                    const lastSavedTime = parsed.lastSaved ? new Date(parsed.lastSaved).getTime() : 0

                    if (startedAtTime > lastSavedTime + 2000) {
                        clearLocalAnswers()
                    } else {
                        localAnswers = parsed.answers || {}
                    }
                } catch (e) {
                    localAnswers = {}
                }
            }

            // Jawaban tersimpan di server (resume lintas device / localStorage kosong)
            // digabung dengan draft lokal — draft lokal menang per soal (paling baru).
            const dbAnswers: Record<string, string> = {}
            if (Array.isArray(subData.saved_answers)) {
                subData.saved_answers.forEach((a: { question_id: string; answer: string }) => {
                    if (a?.question_id) dbAnswers[a.question_id] = a.answer
                })
            }
            const mergedAnswers = { ...dbAnswers, ...localAnswers }

            let initialAnswers: Record<string, string> = {}
            if (Object.keys(mergedAnswers).length > 0) {
                setAnswers(mergedAnswers)
                initialAnswers = mergedAnswers
            }

            // Check for Resume — sisa waktu dari patokan server (ends_at + offset), bukan jam HP
            const elapsed = Date.now() - new Date(subData.started_at).getTime()
            const remaining = computeRemaining()

            if (remaining !== null && remaining <= 0) {
                // Auto-submit if time expired — server tetap yang menilai batas; ini hanya pemicu
                try {
                    const formattedAnswers = Object.entries(initialAnswers).map(([qId, val]) => ({
                        question_id: qId,
                        answer: val as string
                    }))

                    const res = await fetch(configRef.current.submissionApi, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            submission_id: subData.id,
                            answers: formattedAnswers,
                            submit: true
                        })
                    })

                    if (!res.ok && res.status !== 409) {
                        // Submit gagal — jawaban lokal jangan dihapus; siswa bisa buka ulang untuk coba lagi
                        alert('Gagal mengumpulkan jawaban otomatis. Jawaban Anda tersimpan di perangkat; buka kembali ujian untuk mencoba lagi.')
                    } else {
                        // 409 TIME_EXPIRED: server sudah menutup dengan jawaban tersimpan — aman dibersihkan
                        clearLocalAnswers()
                    }
                    router.replace(configRef.current.listRoute)
                } catch (e) {
                    console.error('Auto-submit error:', e)
                    router.replace(configRef.current.listRoute)
                }
                return
            }

            // Always set timeLeft immediately so timer can start (null = tanpa batas waktu)
            setTimeLeft(remaining)

            // If elapsed is significant (> 10s) OR we have answers (local/server), assume it's a resume
            const isResume = elapsed > 10000 || Object.keys(mergedAnswers).length > 0

            if (isResume) {
                setResumeData({
                    answeredCount: Object.keys(initialAnswers).length,
                    totalQuestions: questionArr.length,
                    timeRemaining: remaining ?? 0
                })
                setShowResumeModal(true)
                setLoading(false)
            } else {
                setLoading(false)
            }

        } catch (error) {
            console.error('Error starting exam:', error)
            // Gagal memuat (drop koneksi dsb.) BUKAN berarti ujiannya selesai/terkunci —
            // attempt & draft jawaban tetap aman (server + localStorage). Jangan usir siswa;
            // beri pesan sesuai kondisi jaringan + tombol coba lagi.
            hasStarted.current = false
            setLoadError(!navigator.onLine
                ? 'Koneksi terputus. Jawaban tersimpan lokal akan dikirim otomatis saat online. Periksa koneksi Anda lalu coba lagi.'
                : `Gagal memuat ${configRef.current.fallbackLabel}. Periksa koneksi Anda lalu coba lagi.`)
            setLoading(false)
        }
    }, [examId, router])

    useEffect(() => {
        startExam()
        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [startExam])

    // Timer countdown — dihitung ulang dari patokan server setiap detik (bukan kurang-1),
    // sehingga kebal throttle background tab / HP sleep dan jam HP yang ngaco
    useEffect(() => {
        if (timeLeft === null || timeLeft <= 0 || !submission) return

        timerRef.current = setInterval(() => {
            const remaining = computeRemaining()
            // null = tanpa batas waktu / patokan belum diketahui — tidak ada yang perlu di-tick
            if (remaining === null) return
            setTimeLeft(remaining)
            if (remaining <= 0) {
                if (timerRef.current) clearInterval(timerRef.current)
                if (navigator.onLine) {
                    handleSubmit(true)
                } else {
                    setShowOfflineTimeoutModal(true)
                }
            }
        }, 1000)

        return () => {
            if (timerRef.current) clearInterval(timerRef.current)
        }
    }, [submission, (timeLeft ?? 0) > 0])

    // Tab lock: detect visibility change
    // Strategy: DEFER violations until user returns. This prevents false positives
    // from screen sleep/off which also triggers visibilitychange.
    const pendingViolationRef = useRef(false)
    const violationCooldownRef = useRef(false)
    const isFullscreenTransition = useRef(false)
    const hiddenAtRef = useRef<number>(0)
    const SLEEP_THRESHOLD_MS = 30000 // 30 seconds — beyond this, assume sleep/screen-off

    useEffect(() => {
        if (!submission || submission.is_submitted) return

        const handleVisibilityChange = async () => {
            if (document.hidden) {
                // Only record timestamp — don't send violation yet
                hiddenAtRef.current = Date.now()
            } else {
                // Page became visible — now decide if it was a real violation
                const hiddenDuration = Date.now() - hiddenAtRef.current
                hiddenAtRef.current = 0

                if (hiddenDuration > SLEEP_THRESHOLD_MS || hiddenDuration <= 0) {
                    // Hidden for >30s = likely sleep/screen-off — skip violation
                    return
                }

                // Short switch = real tab switch — log violation now
                if (violationCooldownRef.current || isFullscreenTransition.current) return
                violationCooldownRef.current = true
                setTimeout(() => { violationCooldownRef.current = false }, 5000)

                await logViolation('TAB_SWITCH')
                setShowViolationWarning(true)
                setTimeout(() => setShowViolationWarning(false), 4000)
            }
        }

        // Method 2: Window blur/focus (works for PWA standalone + Alt+Tab)
        const handleWindowBlur = async () => {
            if (document.hidden) return // Already handled by visibilitychange
            // Only record timestamp for blur without visibility change
            if (hiddenAtRef.current === 0) hiddenAtRef.current = Date.now()
        }

        const handleWindowFocus = async () => {
            if (document.hidden) return
            if (hiddenAtRef.current <= 0) return

            const hiddenDuration = Date.now() - hiddenAtRef.current
            hiddenAtRef.current = 0

            if (hiddenDuration > SLEEP_THRESHOLD_MS || hiddenDuration <= 0) {
                // Long absence = sleep/screen-off — skip
                return
            }

            if (violationCooldownRef.current || isFullscreenTransition.current) return
            violationCooldownRef.current = true
            setTimeout(() => { violationCooldownRef.current = false }, 5000)

            await logViolation('TAB_SWITCH')
            setShowViolationWarning(true)
            setTimeout(() => setShowViolationWarning(false), 4000)
        }

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = `Anda sedang dalam ${examLabelRef.current}. Keluar akan dihitung sebagai pelanggaran!`
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
        window.addEventListener('blur', handleWindowBlur)
        window.addEventListener('focus', handleWindowFocus)
        window.addEventListener('beforeunload', handleBeforeUnload)
        document.addEventListener('contextmenu', handleContextMenu)
        document.addEventListener('copy', handleCopy)
        document.addEventListener('paste', handlePaste)
        document.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            window.removeEventListener('blur', handleWindowBlur)
            window.removeEventListener('focus', handleWindowFocus)
            window.removeEventListener('beforeunload', handleBeforeUnload)
            document.removeEventListener('contextmenu', handleContextMenu)
            document.removeEventListener('copy', handleCopy)
            document.removeEventListener('paste', handlePaste)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [submission, forceSubmitted])

    // Log violation
    const logViolation = async (type: string) => {
        if (!submission || submission.is_submitted || forceSubmitted) return

        try {
            const res = await fetch(configRef.current.submissionApi, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submission_id: submission.id,
                    violation: { type }
                })
            })

            if (res.status >= 500) throw new Error(`server ${res.status}`)
            const data = await res.json()

            if (data.force_submitted) {
                setForceSubmitted(true)
                pendingViolationRef.current = false // cancel warning
                alert(`${examLabelRef.current} otomatis dikumpulkan karena pelanggaran melebihi batas!`)
                router.push(configRef.current.listRoute)
                return
            }

            if (typeof data.violation_count === 'number') setViolationCount(data.violation_count)
            // Wait to show violation warning when they return (handled in visibility handler)
        } catch {
            // Offline / server error: antre pelanggaran (persist ke localStorage)
            // — dikirim ulang otomatis oleh flushPendingViolations saat koneksi
            // pulih. Tanpa ini pelanggaran hilang diam-diam.
            pendingViolationsRef.current.push({ type, at: Date.now() })
            persistViolationQueue()
            // Optimistic UI: counter langsung naik walau offline — tanpa ini
            // warning muncul tapi angka tetap 0/3 sampai flush sukses. Aman dari
            // double-count: flush/logViolation sukses selalu MENIMPA count dengan
            // angka otoritatif server (dedup 3 dtk di mergeViolations mengoreksi
            // bila increment ini ternyata ditolak server).
            setViolationCount(c => c + 1)
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
        } catch (error) {
            console.error('Fullscreen request error:', error)
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
            isFullscreenTransition.current = true
            setIsFullscreen(!!document.fullscreenElement || !!(document as any).webkitFullscreenElement)
            setTimeout(() => { isFullscreenTransition.current = false }, 1000)
        }
        document.addEventListener('fullscreenchange', handleFullscreenChange)
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange)
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
        }
    }, [])

    // Save answer — per-question debounce so passage groups with multiple essays don't cancel each other
    const debounceTimersRef = useRef<Record<string, NodeJS.Timeout>>({})

    // Cleanup all pending timers on unmount
    useEffect(() => {
        return () => {
            Object.values(debounceTimersRef.current).forEach(clearTimeout)
        }
    }, [])

    const saveAnswer = (questionId: string, answer: string) => {
        const newAnswers = { ...answers, [questionId]: answer }
        setAnswers(newAnswers)
        saveAnswersToLocal(newAnswers)

        // Debounce server sync per question (1.5 seconds)
        if (debounceTimersRef.current[questionId]) {
            clearTimeout(debounceTimersRef.current[questionId])
        }
        debounceTimersRef.current[questionId] = setTimeout(() => {
            syncToServer(questionId, answer)
            delete debounceTimersRef.current[questionId]
        }, 1500)
    }

    const saveAnswerImmediate = (questionId: string, answer: string) => {
        const newAnswers = { ...answers, [questionId]: answer }
        setAnswers(newAnswers)
        saveAnswersToLocal(newAnswers)
        syncToServer(questionId, answer)
    }

    const syncToServer = async (questionId: string, answer: string) => {
        if (!submission) return
        // Offline murni: jangan fire fetch yang pasti gagal — badge sudah menampilkan
        // "Offline" (merah), bukan "Gagal simpan" yang menyesatkan. Jawaban aman di
        // localStorage dan akan di-flush oleh syncLocalToServer saat koneksi pulih.
        if (!navigator.onLine) return
        setSaveStatus('saving')
        const t0 = performance.now()
        try {
            const res = await fetch(configRef.current.submissionApi, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submission_id: submission.id,
                    answers: [{ question_id: questionId, answer }]
                })
            })
            // Waktu habis terdeteksi di server saat autosave — tutup sesi ini dengan rapi
            if (res.status === 409) {
                const data = await res.json().catch(() => null)
                if (data?.code === 'TIME_EXPIRED') {
                    if (timerRef.current) clearInterval(timerRef.current)
                    clearLocalAnswers()
                    alert('Waktu pengerjaan sudah berakhir. Jawaban yang tersimpan otomatis dikumpulkan.')
                    router.replace(configRef.current.resultRoute(examId))
                    return
                }
            }
            setLastLatencyMs(performance.now() - t0)
            setSaveStatus(res.ok ? 'saved' : 'error')
        } catch (error) {
            console.error('Error saving answer:', error)
            setSaveStatus('error')
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

            const res = await fetch(configRef.current.submissionApi, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submission_id: submission.id,
                    answers: answersArray,
                    submit: true
                })
            })

            // 400 "Already submitted" / 409 TIME_EXPIRED: submission sudah tertutup rapi di server
            // (409 = ditutup paksa dengan jawaban yang tersimpan) — keduanya aman untuk lanjut
            if (!res.ok && res.status !== 400 && res.status !== 409) {
                const errData = await res.json().catch(() => null)
                throw new Error(errData?.error || `Gagal mengumpulkan ${examLabelRef.current}`)
            }

            // Clear localStorage after successful submit
            clearLocalAnswers()

            if (document.fullscreenElement) {
                await document.exitFullscreen()
            }

            router.push(configRef.current.resultRoute(examId))
        } catch (error) {
            console.error('Error submitting:', error)
            // Tampilkan pesan spesifik dari server (mis. "Sudah dikumpulkan dari
            // perangkat lain") bila ada; fallback ke pesan generik.
            alert(error instanceof Error && error.message ? error.message : `Gagal mengumpulkan ${examLabelRef.current}`)
        } finally {
            setSubmitting(false)
        }
    }

    // Retry setelah layar error (koneksi putus dsb.)
    const retryLoad = useCallback(() => {
        setLoadError(null)
        setLoading(true)
        hasStarted.current = false
        startExam()
    }, [startExam])

    const goBack = useCallback(() => {
        router.push(configRef.current.listRoute)
    }, [router])

    return {
        exam,
        questions,
        submission,
        answers,
        currentIndex,
        setCurrentIndex,
        timeLeft,
        loading,
        loadError,
        submitting,
        saveStatus,
        lastLatencyMs,
        violationCount,
        showViolationWarning,
        isFullscreen,
        examLabel,
        showConfirmSubmit,
        setShowConfirmSubmit,
        showOfflineTimeoutModal,
        showResumeModal,
        resumeData,
        isOnline,
        zoom,
        saveAnswer,
        saveAnswerImmediate,
        handleSubmit,
        continueResume,
        requestFullscreen,
        retryLoad,
        goBack,
        containerRef,
    }
}
