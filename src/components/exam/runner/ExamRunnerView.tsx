'use client'

import { Document, Danger, Scan, TimeCircle, TickSquare } from 'react-iconly'
import NetworkBadge from '@/components/NetworkBadge'
import ExamZoomControls from '@/components/exam/ExamZoomControls'
import ExamZoomHint from '@/components/exam/ExamZoomHint'
import { buildDisplayItems } from './displayItems'
import QuestionCard from './QuestionCard'
import AudioGroupCard from './AudioGroupCard'
import ExamQuestionNavigator from './ExamQuestionNavigator'
import type { ExamRunnerState } from './types'

export function formatTime(seconds: number) {
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

interface ExamRunnerViewProps {
    state: ExamRunnerState
    /**
     * live  = ruang ujian siswa sesungguhnya (fullscreen, pelanggaran, autosave).
     * preview = replika 1:1 di PreviewModal guru/admin: markup identik, tanpa
     *           NetworkBadge/counter pelanggaran, tombol kumpulkan disabled.
     */
    mode?: 'live' | 'preview'
}

/**
 * SATU tampilan ruang ujian untuk siswa (live) dan preview guru/admin —
 * 1:1 by construction: keduanya merender file yang sama, hanya perilaku
 * (mode) yang berbeda. Dilarang menduplikasi markup soal di luar sini.
 */
export function ExamRunnerView({ state, mode = 'live' }: ExamRunnerViewProps) {
    const isPreview = mode === 'preview'
    const { exam, questions, answers } = state

    if (state.loadError) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background-light dark:bg-background-dark">
                <div className="text-center space-y-4 max-w-md px-4">
                    <div className="text-red-500 dark:text-red-400 flex justify-center"><Danger set="bold" primaryColor="currentColor" size="xlarge" /></div>
                    <p className="text-text-secondary">{state.loadError}</p>
                    <div className="flex gap-3 justify-center">
                        <button
                            onClick={state.retryLoad}
                            className="px-6 py-2 bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors font-bold"
                        >
                            Coba Lagi
                        </button>
                        <button
                            onClick={state.goBack}
                            className="px-6 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-colors"
                        >
                            Kembali
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    if (state.loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background-light dark:bg-background-dark">
                <div className="text-center">
                    <div className="text-primary mb-4 animate-pulse mx-auto flex justify-center"><Document set="bold" primaryColor="currentColor" size="xlarge" /></div>
                    <p className="text-text-secondary">Mempersiapkan {state.examLabel}...</p>
                </div>
            </div>
        )
    }

    if (!exam || !state.submission || questions.length === 0) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background-light dark:bg-background-dark">
                <div className="text-center text-red-500 dark:text-red-400">{state.examLabel || 'Ujian'} tidak dapat dimulai</div>
            </div>
        )
    }

    const displayItems = buildDisplayItems(questions)
    const currentItem = displayItems[state.currentIndex] || displayItems[0]
    const isLastItem = state.currentIndex >= displayItems.length - 1
    const answeredCount = Object.keys(answers).length
    const maxViolations = exam.max_violations
    const { zoom } = state

    // Tombol navigasi soal — dirender sebagai footer di dalam kartu soal.
    const navButtons = (
        <div className="flex items-center justify-between gap-3">
            <button
                onClick={() => state.setCurrentIndex(prev => Math.max(0, prev - 1))}
                disabled={state.currentIndex === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 md:px-6 md:py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-surface-dark text-text-main dark:text-white text-sm md:text-base font-medium shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed"
            >
                ← Sebelumnya
            </button>

            {isLastItem ? (
                isPreview ? (
                    <button
                        disabled
                        title="Tombol ini hanya tampilan preview"
                        className="inline-flex items-center gap-2 px-5 py-2.5 md:px-8 md:py-3 rounded-xl bg-gray-400 text-white text-sm md:text-base font-bold cursor-not-allowed opacity-60"
                    >
                        <TickSquare set="bold" primaryColor="currentColor" size={20} /> Kumpulkan {state.examLabel}
                    </button>
                ) : (
                    <button
                        onClick={() => state.setShowConfirmSubmit(true)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 md:px-8 md:py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm md:text-base font-bold shadow-md shadow-green-500/25 hover:opacity-90 transition-opacity"
                    >
                        <TickSquare set="bold" primaryColor="currentColor" size={20} /> Kumpulkan {state.examLabel}
                    </button>
                )
            ) : (
                <button
                    onClick={() => state.setCurrentIndex(prev => Math.min(displayItems.length - 1, prev + 1))}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 md:px-6 md:py-3 rounded-xl bg-primary text-white text-sm md:text-base font-bold shadow-md shadow-primary/25 hover:bg-primary-dark transition-colors"
                >
                    Selanjutnya →
                </button>
            )}
        </div>
    )

    return (
        <div
            ref={state.containerRef}
            className={`bg-background-light dark:bg-background-dark flex flex-col ${isPreview
                ? 'flex-1 min-h-0' // preview: isi sisa ruang modal (dulu min-h-screen → tombol nav di bawah lipatan layar)
                : 'min-h-screen md:h-screen md:overflow-hidden select-none' // live: layar penuh desktop, scroll internal
                }`}
            style={isPreview ? undefined : { userSelect: 'none' }}
        >
            {/* Violation Warning Overlay */}
            {state.showViolationWarning && (
                <div className="fixed inset-0 bg-red-600/80 flex items-center justify-center z-50">
                    <div className="text-center text-white p-8">
                        <div className="text-white mb-4 mx-auto flex justify-center"><Danger set="bold" primaryColor="currentColor" size="xlarge" /></div>
                        <h2 className="text-2xl font-bold mb-2">PERINGATAN!</h2>
                        <p>Anda terdeteksi keluar dari halaman {state.examLabel}</p>
                        <p className="text-xl mt-4">Pelanggaran: {state.violationCount} / {maxViolations}</p>
                        {state.violationCount >= maxViolations - 1 && (
                            <p className="text-yellow-300 mt-2 font-bold">Pelanggaran berikutnya akan mengumpulkan {state.examLabel} secara otomatis!</p>
                        )}
                    </div>
                </div>
            )}

            {/* Fullscreen Enforcer Overlay */}
            {!state.isFullscreen && (
                <div className="fixed inset-0 z-[100] bg-background-light/95 dark:bg-background-dark/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-24 h-24 bg-red-500/10 text-red-500 dark:text-red-400 rounded-full flex items-center justify-center mb-6 animate-pulse">
                        <Scan set="bold" primaryColor="currentColor" size={48} />
                    </div>
                    <h2 className="text-3xl font-extrabold text-text-main dark:text-white mb-4 tracking-tight">Layar Penuh Diwajibkan</h2>
                    <p className="text-text-secondary mb-8 max-w-lg text-lg leading-relaxed">
                        {state.examLabel} ini diatur sedemikian rupa agar Anda mengerjakannya dalam mode layar penuh. Anda tidak dapat melihat soal atau melanjutkan sebelum masuk ke mode layar penuh.
                    </p>
                    <button
                        onClick={state.requestFullscreen}
                        className="px-8 py-4 bg-primary text-white rounded-2xl font-bold text-lg hover:bg-primary-dark transition-all shadow-xl shadow-primary/30 flex items-center gap-3 hover:-translate-y-1 active:translate-y-0"
                    >
                        <Scan set="bold" primaryColor="currentColor" size={24} />
                        Masuk Layar Penuh Sekarang
                    </button>
                </div>
            )}

            {/* Offline Banner */}
            {!state.isOnline && (
                <div className="bg-red-500 text-white text-xs font-bold text-center py-1.5 animate-pulse w-full">
                    ⚠️ Koneksi terputus — jawaban disimpan lokal & akan otomatis dikirim saat online
                </div>
            )}

            {/* Header */}
            <div className="bg-surface-light dark:bg-surface-dark border-b border-gray-200 dark:border-gray-700 p-3 md:p-4">
                <div className="w-full flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-base md:text-lg font-bold text-text-main dark:text-white">{exam.title}</h1>
                        <p className="text-sm text-text-secondary">{exam.subjectName}</p>
                    </div>
                    <div className="flex items-center justify-between md:justify-end gap-3 md:gap-6 flex-wrap">
                        {!isPreview && (
                            <NetworkBadge isOnline={state.isOnline} saveStatus={state.saveStatus} latencyMs={state.lastLatencyMs} />
                        )}
                        <ExamZoomControls
                            zoomLevel={zoom.zoomLevel}
                            canZoomIn={zoom.canZoomIn}
                            canZoomOut={zoom.canZoomOut}
                            onZoomIn={zoom.zoomIn}
                            onZoomOut={zoom.zoomOut}
                        />
                        {!isPreview && (
                            <div className={`px-3 py-1 rounded-lg flex items-center gap-1.5 ${state.violationCount > 0 ? 'bg-red-500/20 text-red-500 dark:text-red-400' : 'bg-gray-100 dark:bg-gray-800 text-text-secondary'}`}>
                                <Danger set="bold" primaryColor="currentColor" size={16} /> {state.violationCount}/{maxViolations}
                            </div>
                        )}
                        {/* Timer */}
                        <div className={`px-3 py-1.5 md:px-4 md:py-2 rounded-lg font-mono text-sm md:text-lg font-bold flex items-center gap-2 relative ${state.timeLeft !== null && state.timeLeft <= 300 ? 'bg-red-500 text-white animate-pulse' : state.timeLeft !== null && state.timeLeft <= 600 ? 'bg-amber-500 text-white' : 'bg-primary/20 text-primary dark:text-primary-light'}`}>
                            <TimeCircle set="bold" primaryColor="currentColor" size={20} /> {state.timeLeft !== null ? formatTime(state.timeLeft) : 'Tanpa Batas'}
                        </div>
                    </div>
                </div>
            </div>

            <ExamZoomHint visible={zoom.showHint} onDismiss={zoom.dismissHint} />

            {/* Main content — lebar penuh: navigator nempel kiri, area soal
                memakai seluruh sisa layar (dulu max-w-4xl/6xl mx-auto → kartu
                menggantung di tengah dengan margin besar kiri-kanan) */}
            <div className="flex-1 min-h-0 flex flex-col md:flex-row w-full">
                <ExamQuestionNavigator
                    items={displayItems}
                    currentIndex={state.currentIndex}
                    answers={answers}
                    answeredCount={answeredCount}
                    totalQuestions={questions.length}
                    onSelect={state.setCurrentIndex}
                />

                {/* Question area */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    <div
                        className="flex-1 min-h-0 overflow-y-auto w-full p-3 md:p-6 lg:p-8"
                        style={{ zoom: zoom.zoomLevel, touchAction: 'manipulation' }}
                        onDoubleClick={zoom.handleDoubleClick}
                        onTouchEnd={zoom.handleTouchEnd}
                    >
                        {/* min-h-full + flex: kartu soal memenuhi tinggi area pandang.
                            Tombol Sebelumnya/Selanjutnya dirender sebagai FOOTER di
                            dalam kartu (bukan bar mengambang di dasar layar) — nempel
                            dengan konten dan terlihat seperti aksi kartu yang wajar. */}
                        <div className="min-h-full flex flex-col">
                            {currentItem?.type === 'audio_group' ? (
                                /* Audio group: show audio + all questions */
                                <AudioGroupCard
                                    audioUrl={currentItem.audioUrl}
                                    passageText={currentItem.passageText}
                                    questions={currentItem.questions}
                                    questionNumbers={currentItem.questionNumbers}
                                    answers={answers}
                                    onAnswerChange={state.saveAnswer}
                                    onAnswerChangeImmediate={state.saveAnswerImmediate}
                                    footer={navButtons}
                                />
                            ) : currentItem?.type === 'standalone' ? (
                                <QuestionCard
                                    questionNumber={currentItem.questionNumbers[0]}
                                    question={currentItem.question}
                                    answer={answers[currentItem.question.id]}
                                    onAnswerChange={(val) => state.saveAnswer(currentItem.question.id, val)}
                                    onAnswerChangeImmediate={(val) => state.saveAnswerImmediate(currentItem.question.id, val)}
                                    footer={navButtons}
                                />
                            ) : null}
                        </div>

                    </div>
                </div>
            </div>

            {/* Submit Confirmation Modal */}
            {state.showConfirmSubmit && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-6 w-full max-w-sm text-center">
                        <div className="w-16 h-16 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <TickSquare set="bold" primaryColor="currentColor" size={32} />
                        </div>
                        <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Kumpulkan {state.examLabel}?</h3>
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
                                onClick={() => state.setShowConfirmSubmit(false)}
                                disabled={state.submitting}
                                className="flex-1 px-4 py-3 bg-gray-200 dark:bg-slate-700 text-text-main dark:text-white rounded-xl hover:bg-gray-300 dark:hover:bg-slate-600 transition-colors"
                            >
                                Kembali
                            </button>
                            <button
                                onClick={() => state.handleSubmit(false)}
                                disabled={state.submitting}
                                className="flex-1 px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
                            >
                                {state.submitting ? 'Mengumpulkan...' : 'Ya, Kumpulkan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Offline Timeout Modal */}
            {state.showOfflineTimeoutModal && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-8 w-full max-w-sm text-center shadow-2xl">
                        <div className="w-20 h-20 bg-amber-500/20 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
                            <Danger set="bold" primaryColor="currentColor" size={40} />
                        </div>
                        <h3 className="text-2xl font-bold text-text-main dark:text-white mb-2">
                            Waktu Habis (Offline)
                        </h3>
                        <p className="text-text-secondary mb-6">
                            Waktu {state.examLabel} telah habis, tetapi koneksi internet terputus. Jawaban Anda sudah tersimpan secara lokal dan akan dikumpulkan otomatis saat koneksi kembali.
                        </p>
                        <button
                            onClick={() => state.handleSubmit(true)}
                            className="w-full px-6 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark transition-opacity"
                        >
                            Kumpulkan Sekarang
                        </button>
                    </div>
                </div>
            )}
            {/* Resume Modal */}
            {state.showResumeModal && state.resumeData && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-8 w-full max-w-md text-center shadow-2xl">
                        <div className="w-20 h-20 bg-amber-500/20 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
                            <TimeCircle set="bold" primaryColor="currentColor" size={40} />
                        </div>
                        <h3 className="text-2xl font-bold text-text-main dark:text-white mb-2">
                            Lanjutkan {state.examLabel}
                        </h3>
                        <p className="text-text-secondary mb-6">
                            {state.examLabel} ini belum diselesaikan. Waktu terus berjalan saat Anda meninggalkan halaman.
                        </p>

                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div className="p-4 bg-primary/10 rounded-xl">
                                <p className="text-xs text-text-secondary mb-1">Terjawab</p>
                                <p className="text-2xl font-bold text-primary">
                                    {state.resumeData.answeredCount}/{state.resumeData.totalQuestions}
                                </p>
                            </div>
                            <div className="p-4 bg-blue-500/10 rounded-xl">
                                <p className="text-xs text-text-secondary mb-1">Sisa Waktu</p>
                                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 font-mono">
                                    {formatTime(state.resumeData.timeRemaining)}
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={state.continueResume}
                            className="w-full px-6 py-4 bg-primary text-white rounded-xl font-bold hover:bg-primary-dark transition-all text-lg shadow-lg shadow-primary/20"
                        >
                            🚀 Lanjutkan {state.examLabel}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
