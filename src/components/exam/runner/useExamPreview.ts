'use client'

import { useRef, useState } from 'react'
import useExamZoom from '@/hooks/useExamZoom'
import type { ExamRunnerState, RunnerQuestion } from './types'

/**
 * State ExamRunner untuk MODE PREVIEW (guru/admin): bentuk identik dengan
 * useExamRunner, tapi semua perilaku jaringan/perilaku ujian adalah no-op —
 * jawaban hanya lokal, timer statis, tidak ada fullscreen/pelanggaran/submit.
 * Dengan bentuk yang sama, ExamRunnerView merender markup yang sama persis
 * dengan yang dilihat siswa.
 */
export function useExamPreviewState(
    title: string,
    subjectName: string,
    durationMinutes: number,
    questions: RunnerQuestion[],
    examLabel: string,
): ExamRunnerState {
    const [answers, setAnswers] = useState<Record<string, string>>({})
    const [currentIndex, setCurrentIndex] = useState(0)
    const containerRef = useRef<HTMLDivElement>(null)

    // Zoom tetap fungsional (interaksi lokal murni); hint & blokir shortcut
    // zoom browser tidak dipasang di preview (enabled=false).
    const zoom = useExamZoom(false, false)

    const setAnswer = (questionId: string, answer: string) => {
        setAnswers(prev => ({ ...prev, [questionId]: answer }))
    }

    return {
        exam: {
            id: 'preview',
            title,
            description: null,
            start_time: '',
            duration_minutes: durationMinutes,
            max_violations: 0,
            subjectName,
        },
        questions,
        submission: { id: 'preview', started_at: '', is_submitted: false, violation_count: 0, question_order: [] },
        answers,
        currentIndex,
        setCurrentIndex,
        // null = "Tanpa Batas" — konsisten dengan siswa saat ujian tanpa durasi
        timeLeft: durationMinutes > 0 ? durationMinutes * 60 : null,
        loading: false,
        loadError: null,
        submitting: false,
        saveStatus: 'idle',
        lastLatencyMs: null,
        violationCount: 0,
        showViolationWarning: false,
        isFullscreen: true,
        examLabel,
        showConfirmSubmit: false,
        setShowConfirmSubmit: () => { },
        showOfflineTimeoutModal: false,
        showResumeModal: false,
        resumeData: null,
        isOnline: true,
        zoom,
        saveAnswer: setAnswer,
        saveAnswerImmediate: setAnswer,
        handleSubmit: () => { },
        continueResume: () => { },
        requestFullscreen: () => { },
        retryLoad: () => { },
        goBack: () => { },
        containerRef,
    }
}
