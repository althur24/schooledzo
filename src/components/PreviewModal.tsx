'use client'

import { useState } from 'react'
import SmartText from '@/components/SmartText'
import { TimeCircle, TickSquare, CloseSquare } from 'react-iconly'
import { Eye, X } from 'lucide-react'

interface PreviewQuestion {
    id?: string
    question_text: string
    question_type: 'ESSAY' | 'MULTIPLE_CHOICE'
    options: string[] | null
    points: number
    order_index: number
    image_url?: string | null
    passage_text?: string | null
    passage_audio_url?: string | null
}

interface PreviewModalProps {
    open: boolean
    onClose: () => void
    title: string
    description?: string | null
    durationMinutes: number
    questions: PreviewQuestion[]
    type: 'kuis' | 'ulangan'
}

export default function PreviewModal({
    open, onClose, title, description, durationMinutes, questions, type
}: PreviewModalProps) {
    const [answers, setAnswers] = useState<Record<string, string>>({})

    if (!open) return null

    const sortedQuestions = [...questions].sort((a, b) => a.order_index - b.order_index)

    const formatTime = (minutes: number) => {
        const h = Math.floor(minutes / 60)
        const m = minutes % 60
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
    }

    const answeredCount = Object.keys(answers).length
    const typeLabel = type === 'kuis' ? 'Kuis' : 'Ulangan'

    return (
        <div className="fixed inset-0 z-[100] bg-surface-light dark:bg-surface-dark overflow-y-auto">
            {/* Preview Banner */}
            <div className="sticky top-0 z-20 bg-blue-600 text-white shadow-lg">
                <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Eye className="w-5 h-5" />
                        <span className="text-sm font-bold">MODE PREVIEW</span>
                        <span className="text-xs opacity-80 hidden sm:inline">— Ini adalah tampilan siswa saat mengerjakan {typeLabel.toLowerCase()}</span>
                    </div>
                    <button
                        onClick={() => { setAnswers({}); onClose() }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors"
                    >
                        <X className="w-4 h-4" />
                        Tutup Preview
                    </button>
                </div>
            </div>

            {/* Student UI Replica */}
            <div className="px-4 md:px-8 pb-24">
                {/* Sticky Header — same as student */}
                <div className="sticky top-[44px] z-10 bg-surface-light/90 dark:bg-surface-dark/90 backdrop-blur border-b border-gray-200 dark:border-gray-700 pb-4 pt-3 -mx-4 px-4 md:-mx-8 md:px-8">
                    <div className="max-w-3xl mx-auto flex items-center justify-between">
                        <div>
                            <h1 className="text-xl font-bold text-text-main dark:text-white truncate max-w-xs md:max-w-md">{title}</h1>
                            <p className="text-xs text-text-secondary">Total: {sortedQuestions.length} Soal</p>
                        </div>
                        <div className="px-4 py-2 rounded-xl font-mono text-xl font-bold shadow-lg bg-gray-100 dark:bg-surface-dark text-primary dark:text-primary-light">
                            {formatTime(durationMinutes)}
                        </div>
                    </div>
                </div>

                {/* Description */}
                {description && (
                    <div className="max-w-3xl mx-auto mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                        <p className="text-sm text-blue-800 dark:text-blue-200">{description}</p>
                    </div>
                )}

                {/* Question List — exact replica of student view */}
                <div className="space-y-8 max-w-3xl mx-auto mt-6">
                    {(() => {
                        type DisplayItem =
                            | { type: 'standalone'; question: PreviewQuestion; qId: string }
                            | { type: 'audio_group'; audioUrl: string; passageText?: string | null; questions: { q: PreviewQuestion; qId: string }[] }

                        const items: DisplayItem[] = []
                        const audioGroupMap = new Map<string, { audioUrl: string; passageText?: string | null; questions: { q: PreviewQuestion; qId: string }[] }>()

                        sortedQuestions.forEach((q, idx) => {
                            const qId = q.id || `preview-${idx}`
                            if (q.passage_audio_url) {
                                const key = q.passage_audio_url
                                if (!audioGroupMap.has(key)) {
                                    audioGroupMap.set(key, { audioUrl: q.passage_audio_url, passageText: q.passage_text, questions: [] })
                                }
                                audioGroupMap.get(key)!.questions.push({ q, qId })
                            } else {
                                items.push({ type: 'standalone', question: q, qId })
                            }
                        })

                        const audioGroups = Array.from(audioGroupMap.values())
                        // Insert audio groups in order (at beginning for simplicity, matching sorted order)
                        audioGroups.forEach(group => {
                            const firstQIdx = sortedQuestions.findIndex(q => q.passage_audio_url === group.audioUrl)
                            let insertAt = items.findIndex(item => {
                                if (item.type !== 'standalone') return false
                                const itemIdx = sortedQuestions.indexOf(item.question)
                                return itemIdx > firstQIdx
                            })
                            if (insertAt === -1) insertAt = items.length
                            items.splice(insertAt, 0, { type: 'audio_group', ...group })
                        })

                        let questionNumber = 0

                        return items.map((item, itemIdx) => {
                            if (item.type === 'audio_group') {
                                return (
                                    <div key={`audio-group-${itemIdx}`} className="bg-surface-light dark:bg-surface-dark border border-violet-300 dark:border-violet-700 rounded-xl overflow-hidden">
                                        <div className="p-5 bg-violet-50 dark:bg-violet-900/20 border-b border-violet-200 dark:border-violet-700">
                                            <p className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-2">🎧 Listening</p>
                                            <audio controls controlsList="nodownload" className="w-full mb-2" src={item.audioUrl} />
                                            {item.passageText && (
                                                <>
                                                    <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-1 mt-3">📖 Bacaan:</p>
                                                    <SmartText text={item.passageText} className="text-sm text-text-main dark:text-white whitespace-pre-wrap leading-relaxed" />
                                                </>
                                            )}
                                        </div>
                                        <div className="divide-y divide-violet-100 dark:divide-violet-800">
                                            {item.questions.map(({ q, qId }) => {
                                                questionNumber++
                                                return (
                                                    <div key={qId} className="p-6">
                                                        <div className="flex items-start gap-4 mb-4">
                                                            <span className="w-8 h-8 flex-shrink-0 bg-violet-500 text-white rounded-full flex items-center justify-center font-bold">{questionNumber}</span>
                                                            <div className="flex-1">
                                                                <SmartText text={q.question_text} className="text-text-main dark:text-white text-lg leading-relaxed whitespace-pre-wrap" />
                                                            </div>
                                                            <span className="text-xs text-text-secondary font-medium px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">{q.points} Poin</span>
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
                                                                        const isSelected = answers[qId] === letter
                                                                        return (
                                                                            <label key={optIdx} className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-all border ${isSelected ? 'bg-primary/10 border-primary text-primary-dark dark:text-primary-light' : 'bg-gray-50 dark:bg-gray-800/50 border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-text-secondary dark:text-slate-300'}`}>
                                                                                <div className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 ${isSelected ? 'border-primary bg-primary text-white' : 'border-gray-400 dark:border-slate-500'}`}>
                                                                                    {isSelected && <TickSquare set="bold" primaryColor="currentColor" size={16} />}
                                                                                </div>
                                                                                <input type="radio" name={`preview-q-${qId}`} value={letter} checked={isSelected} onChange={() => setAnswers({ ...answers, [qId]: letter })} className="hidden" />
                                                                                <span className="font-medium"><span className="mr-2 font-bold opacity-70">{letter}.</span><SmartText text={opt} as="span" /></span>
                                                                            </label>
                                                                        )
                                                                    })}
                                                                </div>
                                                            ) : (
                                                                <textarea value={answers[qId] || ''} onChange={(e) => setAnswers({ ...answers, [qId]: e.target.value })} className="w-full h-32 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-gray-400" placeholder="Tulis jawaban Anda di sini..." />
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            } else {
                                const q = item.question
                                const qId = item.qId
                                questionNumber++
                                return (
                                    <div key={qId} className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-xl p-6">
                                        {q.passage_text && !q.passage_audio_url && (
                                            <div className="mb-4 p-4 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-xl">
                                                <p className="text-xs text-teal-600 dark:text-teal-400 font-bold mb-2">📖 Bacaan:</p>
                                                <SmartText text={q.passage_text} className="text-sm text-text-main dark:text-white whitespace-pre-wrap leading-relaxed" />
                                            </div>
                                        )}
                                        <div className="flex items-start gap-4 mb-4">
                                            <span className="w-8 h-8 flex-shrink-0 bg-primary text-white rounded-full flex items-center justify-center font-bold">{questionNumber}</span>
                                            <div className="flex-1">
                                                <SmartText text={q.question_text} className="text-text-main dark:text-white text-lg leading-relaxed whitespace-pre-wrap" />
                                            </div>
                                            <span className="text-xs text-text-secondary font-medium px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded">{q.points} Poin</span>
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
                                                        const isSelected = answers[qId] === letter
                                                        return (
                                                            <label key={optIdx} className={`flex items-center gap-3 p-4 rounded-xl cursor-pointer transition-all border ${isSelected ? 'bg-primary/10 border-primary text-primary-dark dark:text-primary-light' : 'bg-gray-50 dark:bg-gray-800/50 border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-text-secondary dark:text-slate-300'}`}>
                                                                <div className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 ${isSelected ? 'border-primary bg-primary text-white' : 'border-gray-400 dark:border-slate-500'}`}>
                                                                    {isSelected && <TickSquare set="bold" primaryColor="currentColor" size={16} />}
                                                                </div>
                                                                <input type="radio" name={`preview-q-${qId}`} value={letter} checked={isSelected} onChange={() => setAnswers({ ...answers, [qId]: letter })} className="hidden" />
                                                                <span className="font-medium"><span className="mr-2 font-bold opacity-70">{letter}.</span><SmartText text={opt} as="span" /></span>
                                                            </label>
                                                        )
                                                    })}
                                                </div>
                                            ) : (
                                                <textarea value={answers[qId] || ''} onChange={(e) => setAnswers({ ...answers, [qId]: e.target.value })} className="w-full h-32 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-gray-400" placeholder="Tulis jawaban Anda di sini..." />
                                            )}
                                        </div>
                                    </div>
                                )
                            }
                        })
                    })()}
                </div>
            </div>

            {/* Bottom Bar — same as student but disabled submit */}
            <div className="fixed bottom-0 left-0 right-0 bg-surface-light/90 dark:bg-surface-dark/90 backdrop-blur border-t border-gray-200 dark:border-gray-700 p-4 z-10">
                <div className="max-w-3xl mx-auto flex items-center justify-between">
                    <p className="text-sm text-text-secondary">
                        Terjawab: <span className="text-text-main dark:text-white font-bold">{answeredCount}</span> / {sortedQuestions.length}
                    </p>
                    <button
                        disabled
                        className="px-8 py-3 bg-gray-400 text-white rounded-xl font-bold cursor-not-allowed opacity-60"
                        title="Tombol ini hanya tampilan preview"
                    >
                        Kumpulkan Jawaban
                    </button>
                </div>
            </div>
        </div>
    )
}
