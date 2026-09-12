import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'

/** Soal ujian sebagaimana diterima halaman siswa (correct_answer sudah di-strip API). */
export interface RunnerQuestion {
    id: string
    question_text: string
    question_type: string
    options: string[] | null
    points: number
    image_url?: string | null
    passage_text?: string | null
    passage_audio_url?: string | null
    text_direction?: 'ltr' | 'rtl'
}

/**
 * Data ujian hasil NORMALISASI. Ulangan dan UTS/UAS punya bentuk embed berbeda
 * (`teaching_assignment.subject.name` vs `subject.name`) — hook menormalkannya
 * ke bentuk ini supaya view punya satu sumber.
 */
export interface ExamData {
    id: string
    title: string
    description: string | null
    start_time: string
    duration_minutes: number
    max_violations: number
    subjectName: string
    exam_type?: 'UTS' | 'UAS'
}

export interface RunnerSubmission {
    id: string
    started_at: string
    is_submitted: boolean
    violation_count: number
    question_order: string[]
}

/**
 * Config per tipe ujian — SATU-satunya hal yang boleh berbeda antar ulangan
 * dan UTS/UAS. Perilaku & tampilan ruang ujian sama untuk semua tipe.
 */
export interface ExamRunnerConfig {
    /** Base API detail ujian + soal, tanpa trailing slash. Contoh: '/api/exams' */
    examApiBase: string
    /** Endpoint PUT/POST submission. Contoh: '/api/exam-submissions' */
    submissionApi: string
    /**
     * Prefix key localStorage (`${prefix}_${examId}_answers` dan
     * `${prefix}_${examId}_pending_violations`). HARUS stabil per tipe ujian —
     * mengubahnya memutus resume draft siswa yang sedang mengerjakan.
     */
    storagePrefix: string
    /** Route daftar ujian untuk redirect saat ujian batal / tidak bisa dimulai. */
    listRoute: string
    /** Route halaman hasil setelah submit sukses. */
    resultRoute: (examId: string) => string
    /** Label ujian setelah data termuat (mis. 'Ulangan' / 'UTS' / 'UAS'). */
    resolveLabel: (exam: ExamData) => string
    /** Label sebelum data termuat (layar loading / error). */
    fallbackLabel: string
}

export interface ExamZoomState {
    zoomLevel: number
    zoomIn: () => void
    zoomOut: () => void
    handleDoubleClick: (e: ReactMouseEvent<HTMLElement>) => void
    handleTouchEnd: (e: ReactTouchEvent<HTMLElement>) => void
    canZoomIn: boolean
    canZoomOut: boolean
    showHint: boolean
    dismissHint: () => void
}

export interface ResumeData {
    answeredCount: number
    totalQuestions: number
    timeRemaining: number
}

/**
 * State lengkap ruang ujian — dihasilkan useExamRunner (mode live) atau
 * useExamPreviewState (mode preview). ExamRunnerView hanya mengonsumsi
 * bentuk ini, sehingga preview & siswa render markup yang sama persis.
 */
export interface ExamRunnerState {
    exam: ExamData | null
    questions: RunnerQuestion[]
    submission: RunnerSubmission | null
    answers: Record<string, string>
    currentIndex: number
    setCurrentIndex: Dispatch<SetStateAction<number>>
    timeLeft: number | null
    loading: boolean
    loadError: string | null
    submitting: boolean
    saveStatus: 'idle' | 'saving' | 'saved' | 'error'
    lastLatencyMs: number | null
    violationCount: number
    showViolationWarning: boolean
    isFullscreen: boolean
    examLabel: string
    showConfirmSubmit: boolean
    setShowConfirmSubmit: (v: boolean) => void
    showOfflineTimeoutModal: boolean
    showResumeModal: boolean
    resumeData: ResumeData | null
    isOnline: boolean
    zoom: ExamZoomState
    saveAnswer: (questionId: string, answer: string) => void
    saveAnswerImmediate: (questionId: string, answer: string) => void
    handleSubmit: (auto?: boolean) => void
    /** Lanjutkan setelah modal resume (tutup modal, pasang sisa waktu). */
    continueResume: () => void
    requestFullscreen: () => void
    /** Coba muat ulang setelah layar error (koneksi putus dsb.). */
    retryLoad: () => void
    /** Kembali ke daftar ujian (layar error "Kembali"). */
    goBack: () => void
    containerRef: RefObject<HTMLDivElement | null>
}
