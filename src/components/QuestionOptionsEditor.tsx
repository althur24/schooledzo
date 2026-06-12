import React from 'react'
import dynamic from 'next/dynamic'
import { Plus } from 'react-iconly'

const MathTextarea = dynamic(() => import('@/components/MathTextarea'), {
    ssr: false,
    loading: () => <textarea placeholder="Memuat editor..." className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main" rows={1} readOnly />
})

interface QuestionOptionsEditorProps {
    questionType: string
    options: string[] | null
    correctAnswer: string | null
    onChange: (options: string[] | null, correctAnswer: string | null) => void
    textDirection?: 'ltr' | 'rtl'
}

export default function QuestionOptionsEditor({
    questionType,
    options,
    correctAnswer,
    onChange,
    textDirection = 'ltr'
}: QuestionOptionsEditorProps) {
    if (questionType === 'ESSAY') {
        return (
            <div>
                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kunci Jawaban (opsional)</label>
                <textarea
                    value={correctAnswer || ''}
                    onChange={(e) => onChange(null, e.target.value)}
                    className={`w-full px-4 py-3 bg-secondary/5 border border-secondary/30 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none ${textDirection === 'rtl' ? 'text-right' : ''}`}
                    rows={3}
                    dir={textDirection}
                    placeholder="Kunci jawaban essay..."
                />
            </div>
        )
    }

    if (questionType === 'SHORT_ANSWER') {
        return (
            <div>
                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jawaban Benar</label>
                <p className="text-xs text-text-secondary mb-2">Pisahkan beberapa variasi jawaban dengan koma (,). Contoh: fotosintesis, Fotosintesis</p>
                <textarea
                    value={correctAnswer || ''}
                    onChange={(e) => onChange(null, e.target.value)}
                    className={`w-full px-4 py-3 bg-secondary/5 border border-secondary/30 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none ${textDirection === 'rtl' ? 'text-right' : ''}`}
                    rows={2}
                    dir={textDirection}
                    placeholder="Masukkan jawaban..."
                />
            </div>
        )
    }

    if (questionType === 'TRUE_FALSE') {
        return (
            <div>
                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pilih Jawaban Benar</label>
                <div className="flex gap-4">
                    <button
                        type="button"
                        onClick={() => onChange(['Benar', 'Salah'], 'BENAR')}
                        className={`flex-1 px-4 py-3 rounded-xl font-bold transition-all border ${correctAnswer === 'BENAR' ? 'bg-green-500 text-white border-green-500' : 'bg-secondary/5 text-text-main border-secondary/20 hover:bg-secondary/10'}`}
                    >
                        Benar
                    </button>
                    <button
                        type="button"
                        onClick={() => onChange(['Benar', 'Salah'], 'SALAH')}
                        className={`flex-1 px-4 py-3 rounded-xl font-bold transition-all border ${correctAnswer === 'SALAH' ? 'bg-green-500 text-white border-green-500' : 'bg-secondary/5 text-text-main border-secondary/20 hover:bg-secondary/10'}`}
                    >
                        Salah
                    </button>
                </div>
            </div>
        )
    }

    // MULTIPLE_CHOICE or MULTIPLE_ANSWER
    const isMultipleAnswer = questionType === 'MULTIPLE_ANSWER'
    const safeOptions = options || ['', '', '', '']
    
    // For MULTIPLE_ANSWER, correctAnswer is a JSON array string
    let correctAnswersSet = new Set<string>()
    if (isMultipleAnswer) {
        try {
            const parsed = JSON.parse(correctAnswer || '[]')
            if (Array.isArray(parsed)) {
                correctAnswersSet = new Set(parsed)
            }
        } catch {
            correctAnswersSet = new Set()
        }
    } else {
        if (correctAnswer) correctAnswersSet.add(correctAnswer)
    }

    const toggleCorrectAnswer = (letter: string) => {
        if (isMultipleAnswer) {
            const newSet = new Set(correctAnswersSet)
            if (newSet.has(letter)) newSet.delete(letter)
            else newSet.add(letter)
            onChange(safeOptions, JSON.stringify(Array.from(newSet)))
        } else {
            onChange(safeOptions, letter)
        }
    }

    return (
        <div>
            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pilihan Jawaban</label>
            {isMultipleAnswer && <p className="text-xs text-text-secondary mb-2">Pilih lebih dari satu opsi sebagai jawaban benar.</p>}
            <div className="space-y-2">
                {safeOptions.map((opt, optIdx) => {
                    const letter = String.fromCharCode(65 + optIdx)
                    const isCorrect = correctAnswersSet.has(letter)

                    return (
                        <div key={optIdx} className="space-y-1">
                            <div className="flex items-center gap-2">
                                <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${isCorrect ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300'}`}>
                                    {letter}
                                </span>
                                <div className="flex-1">
                                    <MathTextarea
                                        value={opt}
                                        onChange={(val: string) => {
                                            const newOptions = [...safeOptions]
                                            newOptions[optIdx] = val
                                            onChange(newOptions, correctAnswer)
                                        }}
                                        placeholder={`Pilihan ${letter}`}
                                        rows={1}
                                    />
                                </div>
                                <button
                                    onClick={() => toggleCorrectAnswer(letter)}
                                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${isCorrect ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300 hover:bg-green-500/20'}`}
                                >
                                    {isCorrect ? '✓ Benar' : 'Set Benar'}
                                </button>
                                {safeOptions.length > 2 && (
                                    <button
                                        onClick={() => {
                                            const newOptions = [...safeOptions]
                                            newOptions.splice(optIdx, 1)
                                            
                                            // Adjust correct answers logic if removing an option
                                            let newCorrectAnswerStr = correctAnswer || ''
                                            if (isMultipleAnswer) {
                                                const arr = Array.from(correctAnswersSet)
                                                const newArr = arr.filter(c => c !== letter).map(c => {
                                                    const charCode = c.charCodeAt(0) - 65
                                                    return charCode > optIdx ? String.fromCharCode(charCode + 65 - 1) : c
                                                })
                                                newCorrectAnswerStr = JSON.stringify(newArr)
                                            } else {
                                                if (newCorrectAnswerStr === letter) newCorrectAnswerStr = ''
                                                else {
                                                    const charCode = newCorrectAnswerStr.charCodeAt(0) - 65
                                                    if (charCode > optIdx) newCorrectAnswerStr = String.fromCharCode(charCode + 65 - 1)
                                                }
                                            }
                                            onChange(newOptions, newCorrectAnswerStr)
                                        }}
                                        className="px-3 py-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                })}
                {safeOptions.length < 6 && (
                    <button
                        onClick={() => onChange([...safeOptions, ''], correctAnswer)}
                        className="mt-2 text-sm text-primary font-bold hover:underline flex items-center gap-1"
                    >
                        <Plus set="bold" primaryColor="currentColor" size={16} /> Tambah Opsi
                    </button>
                )}
            </div>
        </div>
    )
}
