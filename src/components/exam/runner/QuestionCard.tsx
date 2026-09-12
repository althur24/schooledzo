'use client'

import SmartText from '@/components/SmartText'
import StudentAnswerInput from '@/components/StudentAnswerInput'
import PassageBlock from '@/components/PassageBlock'
import { QUESTION_TYPE_LABELS } from '@/lib/questionTypeUtils'
import type { RunnerQuestion } from './types'

interface QuestionCardProps {
    questionNumber: number
    question: RunnerQuestion
    answer: string | undefined
    onAnswerChange: (val: string) => void
    onAnswerChangeImmediate: (val: string) => void
    /** Konten footer kartu (tombol navigasi soal) — dirender menempel dasar kartu. */
    footer?: React.ReactNode
}

/** Kartu soal standalone — replika persis kartu soal halaman ulangan siswa. */
export default function QuestionCard({ questionNumber, question, answer, onAnswerChange, onAnswerChangeImmediate, footer }: QuestionCardProps) {
    return (
        <div className="flex-1 bg-white dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-xl p-4 md:p-6 lg:p-8 min-h-0 md:min-h-[400px] flex flex-col">
            <div className="flex items-center gap-3 mb-4">
                <span className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold">{questionNumber}</span>
                <span className={`px-2 py-0.5 text-xs rounded bg-secondary/10 text-text-main dark:text-white`}>
                    {QUESTION_TYPE_LABELS[question.question_type as keyof typeof QUESTION_TYPE_LABELS] ?? question.question_type}
                </span>
            </div>
            {/* Text-only passage — show BEFORE question */}
            {question.passage_text && !question.passage_audio_url && (
                <PassageBlock text={question.passage_text} />
            )}
            <div dir={question.text_direction || 'ltr'}>
                <SmartText text={question.question_text} className="text-text-main dark:text-white text-base md:text-lg lg:text-xl mb-4 whitespace-pre-wrap" />
            </div>
            {question.image_url && (
                <div className="mb-6">
                    <img src={question.image_url} alt="Gambar soal" className="max-h-48 md:max-h-64 rounded-lg border border-gray-200 dark:border-gray-600 mx-auto" />
                </div>
            )}
            <StudentAnswerInput
                question={question}
                value={answer}
                onChange={onAnswerChange}
                onChangeImmediate={onAnswerChangeImmediate}
            />
            {footer && (
                <div className="mt-auto -mx-4 -mb-4 md:-mx-6 md:-mb-6 lg:-mx-8 lg:-mb-8 border-t border-gray-200 dark:border-gray-700 rounded-b-xl px-4 md:px-6 lg:px-8 py-3 md:py-4">
                    {footer}
                </div>
            )}
        </div>
    )
}
