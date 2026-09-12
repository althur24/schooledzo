'use client'

import SmartText from '@/components/SmartText'
import StudentAnswerInput from '@/components/StudentAnswerInput'
import PassageBlock from '@/components/PassageBlock'
import { QUESTION_TYPE_LABELS } from '@/lib/questionTypeUtils'
import type { RunnerQuestion } from './types'

interface AudioGroupCardProps {
    audioUrl: string
    passageText?: string | null
    questions: RunnerQuestion[]
    questionNumbers: number[]
    answers: Record<string, string>
    onAnswerChange: (questionId: string, val: string) => void
    onAnswerChangeImmediate: (questionId: string, val: string) => void
    /** Konten footer kartu (tombol navigasi soal) — dirender menempel dasar kartu. */
    footer?: React.ReactNode
}

/** Kartu Listening: audio + (opsional) bacaan + seluruh soal anggota group. */
export default function AudioGroupCard({
    audioUrl, passageText, questions, questionNumbers, answers, onAnswerChange, onAnswerChangeImmediate, footer
}: AudioGroupCardProps) {
    return (
        <div className="flex-1 bg-white dark:bg-surface-dark border border-violet-300 dark:border-violet-700 rounded-xl overflow-hidden min-h-0 md:min-h-[400px] flex flex-col">
            {/* Audio header */}
            <div className="p-3 md:p-5 bg-violet-50 dark:bg-violet-900/20 border-b border-violet-200 dark:border-violet-700">
                <p className="text-xs text-violet-600 dark:text-violet-400 font-bold mb-2">🎧 Listening</p>
                <audio controls controlsList="nodownload" className="w-full mb-2" src={audioUrl} />
                {passageText && (
                    <PassageBlock text={passageText} />
                )}
            </div>
            {/* Questions */}
            <div className="divide-y divide-violet-100 dark:divide-violet-800 flex-1">
                {questions.map((q, qIdx) => (
                    <div key={q.id} className="p-3 md:p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <span className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-violet-500/20 text-violet-600 dark:text-violet-400 flex items-center justify-center font-bold">{questionNumbers[qIdx]}</span>
                            <span className={`px-2 py-0.5 text-xs rounded bg-secondary/10 text-text-main dark:text-white`}>
                                {QUESTION_TYPE_LABELS[q.question_type as keyof typeof QUESTION_TYPE_LABELS] ?? q.question_type}
                            </span>
                        </div>
                        <div dir={q.text_direction || 'ltr'}>
                            <SmartText text={q.question_text} className="text-text-main dark:text-white text-base md:text-lg lg:text-xl mb-4 whitespace-pre-wrap" />
                        </div>
                        {q.image_url && (
                            <div className="mb-4">
                                <img src={q.image_url} alt="Gambar soal" className="max-h-48 md:max-h-64 rounded-lg border border-gray-200 dark:border-gray-600 mx-auto" />
                            </div>
                        )}
                        <StudentAnswerInput
                            question={q}
                            value={answers[q.id]}
                            onChange={(val) => onAnswerChange(q.id, val)}
                            onChangeImmediate={(val) => onAnswerChangeImmediate(q.id, val)}
                        />
                    </div>
                ))}
            </div>
            {footer && (
                <div className="mt-auto border-t border-violet-200 dark:border-violet-700 px-4 md:px-6 lg:px-8 py-3 md:py-4">
                    {footer}
                </div>
            )}
        </div>
    )
}
