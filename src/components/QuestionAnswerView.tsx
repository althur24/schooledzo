'use client'

import SmartText from '@/components/SmartText'

// ─────────────────────────────────────────────────────────
// Render opsi jawaban + penanda kunci (semua tipe soal)
// Dipakai halaman bank soal guru & admin.
// ─────────────────────────────────────────────────────────

export function AnswerOptionsView({ questionType, options, correctAnswer }: {
    questionType: string
    options: string[] | null
    correctAnswer: string | null
}) {
    if (!['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE'].includes(questionType) || !options) return null
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {options.map((opt, optIdx) => {
                const letter = String.fromCharCode(65 + optIdx)
                let isCorrect = false
                if (questionType === 'MULTIPLE_ANSWER') {
                    try { isCorrect = JSON.parse(correctAnswer || '[]').includes(letter) } catch { }
                } else if (questionType === 'TRUE_FALSE') {
                    isCorrect = correctAnswer?.toUpperCase() === opt.toUpperCase()
                } else {
                    isCorrect = correctAnswer === letter
                }
                return (
                    <div key={optIdx} className={`px-4 py-3 rounded-xl border flex items-center gap-3 ${isCorrect ? 'bg-green-500/5 border-green-200 text-green-700 dark:text-green-400 dark:border-green-500/20' : 'bg-secondary/5 border-transparent text-text-secondary'}`}>
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isCorrect ? 'bg-green-500 text-white' : 'bg-secondary/20 text-text-secondary'}`}>
                            {questionType === 'TRUE_FALSE' ? (opt === 'Benar' ? '✓' : '✗') : letter}
                        </span>
                        <SmartText text={opt} className="flex-1 min-w-0" />
                    </div>
                )
            })}
        </div>
    )
}

// Kunci jawaban teks (isian singkat / rubrik essay)
export function TextAnswerView({ questionType, correctAnswer }: { questionType: string; correctAnswer: string | null }) {
    if (questionType === 'SHORT_ANSWER' && correctAnswer) {
        return (
            <div className="px-4 py-3 rounded-xl bg-green-500/5 border border-green-200 dark:border-green-500/20 text-sm">
                <span className="font-bold text-green-700 dark:text-green-400">Jawaban: </span>
                <SmartText text={correctAnswer} className="inline text-green-700 dark:text-green-400" />
            </div>
        )
    }
    if (questionType === 'ESSAY' && correctAnswer) {
        return (
            <div className="px-4 py-3 rounded-xl bg-secondary/5 border border-secondary/20 text-sm">
                <span className="font-bold text-text-main dark:text-white">Rubrik: </span>
                <SmartText text={correctAnswer} className="inline text-text-secondary" />
            </div>
        )
    }
    return null
}
