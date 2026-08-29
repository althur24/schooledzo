import React from 'react'
import SmartText from '@/components/SmartText'

interface StudentAnswerInputProps {
    question: {
        id: string
        question_type: string
        options?: string[] | null
        text_direction?: 'ltr' | 'rtl' | null
    }
    value: string | undefined
    onChange: (value: string) => void
    onChangeImmediate: (value: string) => void
}

export default function StudentAnswerInput({ question, value, onChange, onChangeImmediate }: StudentAnswerInputProps) {
    const dir = question.text_direction || 'ltr'
    const isRtl = dir === 'rtl'

    // Parse MULTIPLE_ANSWER value as JSON array
    let selectedSet = new Set<string>()
    if (question.question_type === 'MULTIPLE_ANSWER' && value) {
        try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) selectedSet = new Set(parsed)
        } catch {}
    }

    const toggleMultipleAnswer = (letter: string) => {
        const newSet = new Set(selectedSet)
        if (newSet.has(letter)) newSet.delete(letter)
        else newSet.add(letter)
        onChangeImmediate(JSON.stringify(Array.from(newSet)))
    }

    if (question.question_type === 'MULTIPLE_CHOICE' && question.options) {
        return (
            <div className="space-y-3">
                {question.options.map((opt, optIdx) => {
                    const letter = String.fromCharCode(65 + optIdx)
                    const isSelected = value === letter
                    return (
                        <button 
                            key={optIdx} 
                            onClick={() => onChangeImmediate(letter)} 
                            className={`w-full text-left px-3 py-2.5 md:px-4 md:py-3 rounded-xl border transition-all flex items-center ${isSelected ? 'bg-primary/10 border-primary text-text-main dark:text-white' : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-600 text-text-secondary dark:text-slate-300 hover:border-gray-400 dark:hover:border-slate-500'}`}
                        >
                            <span className={`inline-flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-lg ${isRtl ? 'ml-3' : 'mr-3'} font-bold flex-shrink-0 ${isSelected ? 'bg-primary text-white' : 'bg-gray-200 dark:bg-slate-600 text-text-secondary dark:text-slate-300'}`} dir="ltr">{letter}</span>
                            <div className="flex-1" dir={dir}><SmartText text={opt} as="span" className={isRtl ? 'text-right block' : ''} /></div>
                        </button>
                    )
                })}
            </div>
        )
    }

    if (question.question_type === 'MULTIPLE_ANSWER' && question.options) {
        return (
            <div className="space-y-3">
                <p className="text-xs text-text-secondary dark:text-slate-400 mb-2">Pilih semua jawaban yang benar (bisa lebih dari satu)</p>
                {question.options.map((opt, optIdx) => {
                    const letter = String.fromCharCode(65 + optIdx)
                    const isSelected = selectedSet.has(letter)
                    return (
                        <button 
                            key={optIdx} 
                            onClick={() => toggleMultipleAnswer(letter)} 
                            className={`w-full text-left px-3 py-2.5 md:px-4 md:py-3 rounded-xl border transition-all flex items-center ${isSelected ? 'bg-primary/10 border-primary text-text-main dark:text-white' : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-600 text-text-secondary dark:text-slate-300 hover:border-gray-400 dark:hover:border-slate-500'}`}
                        >
                            <span className={`inline-flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-lg ${isRtl ? 'ml-3' : 'mr-3'} font-bold flex-shrink-0 ${isSelected ? 'bg-primary text-white' : 'bg-gray-200 dark:bg-slate-600 text-text-secondary dark:text-slate-300'}`} dir="ltr">
                                {isSelected ? '✓' : letter}
                            </span>
                            <div className="flex-1" dir={dir}><SmartText text={opt} as="span" className={isRtl ? 'text-right block' : ''} /></div>
                        </button>
                    )
                })}
            </div>
        )
    }

    if (question.question_type === 'TRUE_FALSE') {
        return (
            <div className="grid grid-cols-2 gap-4">
                <button
                    onClick={() => onChangeImmediate('BENAR')}
                    className={`py-4 rounded-xl border-2 font-bold text-lg transition-all ${value === 'BENAR' ? 'bg-green-500/10 border-green-500 text-green-700 dark:text-green-400' : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-600 text-text-secondary dark:text-slate-300 hover:border-gray-400 dark:hover:border-slate-500'}`}
                >
                    BENAR
                </button>
                <button
                    onClick={() => onChangeImmediate('SALAH')}
                    className={`py-4 rounded-xl border-2 font-bold text-lg transition-all ${value === 'SALAH' ? 'bg-red-500/10 border-red-500 text-red-700 dark:text-red-400' : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-600 text-text-secondary dark:text-slate-300 hover:border-gray-400 dark:hover:border-slate-500'}`}
                >
                    SALAH
                </button>
            </div>
        )
    }

    if (question.question_type === 'SHORT_ANSWER') {
        return (
            <div className="space-y-2">
                <p className="text-sm text-text-secondary dark:text-slate-400 mb-1">Jawaban Singkat:</p>
                <input
                    type="text"
                    dir={dir}
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    className={`w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary ${isRtl ? 'text-right' : ''}`}
                    placeholder="Ketik jawaban Anda..."
                    maxLength={200}
                />
                {value && value.trim() && (
                    <div>
                        <p className="text-xs text-text-secondary dark:text-slate-400 mb-1">Pratinjau (mendukung LaTeX, mis. $x^2$):</p>
                        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg">
                            <SmartText text={value} as="div" />
                        </div>
                    </div>
                )}
            </div>
        )
    }

    // ESSAY fallback
    return (
        <div className="space-y-2">
            <textarea
                dir={dir}
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                className={`w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none ${isRtl ? 'text-right' : ''}`}
                rows={6}
                placeholder="Tulis jawaban Anda di sini..."
            />
            {value && value.trim() && (
                <div>
                    <p className="text-xs text-text-secondary dark:text-slate-400 mb-1">{"Pratinjau (mendukung LaTeX, mis. $x^2$ atau $\\frac{a}{b}$):"}</p>
                    <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg max-h-48 overflow-y-auto">
                        <SmartText text={value} as="div" />
                    </div>
                </div>
            )}
        </div>
    )
}
