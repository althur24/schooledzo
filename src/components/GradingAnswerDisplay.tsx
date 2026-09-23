import React from 'react'
import SmartText from '@/components/SmartText'
import { parseAnswerLetters } from '@/lib/questionTypeUtils'

interface GradingAnswerDisplayProps {
    question: {
        question_type: string
        options: string[] | null
        correct_answer: string | null
    }
    answer: {
        answer: string
        is_correct?: boolean | null
    } | undefined
}

export default function GradingAnswerDisplay({ question, answer }: GradingAnswerDisplayProps) {
    const isCorrect = answer?.is_correct
    const studentAnswer = answer?.answer

    const renderAnswer = (ansStr: string | undefined, isKey = false) => {
        if (!ansStr) return <span className="italic opacity-70">(Kosong)</span>

        if (question.question_type === 'MULTIPLE_CHOICE') {
            const idx = ansStr.charCodeAt(0) - 65
            const optText = question.options?.[idx] || ansStr
            return <span><span className="font-bold">{ansStr}.</span> <SmartText text={optText} as="span" /></span>
        }

        if (question.question_type === 'MULTIPLE_ANSWER') {
            // Satu sumber parsing dengan grading (parseAnswerLetters): JSON array
            // ATAU koma diterima — supaya kunci tampil persis seperti yang dinilai.
            const letters = parseAnswerLetters(ansStr)
            if (letters.length > 0) {
                return (
                    <div className="space-y-1 mt-1">
                        {letters.map(char => {
                            const idx = char.charCodeAt(0) - 65
                            const optText = question.options?.[idx] || char
                            return <div key={char}>• <span className="font-bold">{char}.</span> <SmartText text={optText} as="span" /></div>
                        })}
                    </div>
                )
            }
            // Bukan huruf yang dikenal (data lama/anomali) — tampilkan teks mentah
            return <SmartText text={ansStr} as="div" className="whitespace-pre-wrap" />
        }

        return <SmartText text={ansStr} as="div" className="whitespace-pre-wrap" />
    }

    return (
        <div className="bg-secondary/5 dark:bg-black/20 p-4 rounded-xl border border-secondary/20 dark:border-white/10 space-y-4">
            <div>
                <p className="text-xs text-text-secondary uppercase tracking-wider mb-1">Jawaban Siswa</p>
                <div className={`font-medium ${
                    isCorrect === true ? 'text-green-600 dark:text-green-400' : 
                    isCorrect === false ? 'text-red-600 dark:text-red-400' : 
                    'text-text-main dark:text-white'
                }`}>
                    {renderAnswer(studentAnswer)}
                </div>
            </div>

            {isCorrect === false && question.correct_answer && (
                <div>
                    <p className="text-xs text-text-secondary uppercase tracking-wider mb-1">Kunci Jawaban</p>
                    <div className="font-medium text-green-600 dark:text-green-400">
                        {renderAnswer(question.correct_answer, true)}
                    </div>
                </div>
            )}
        </div>
    )
}
