'use client'

import type { DisplayItem } from './displayItems'

interface ExamQuestionNavigatorProps {
    items: DisplayItem[]
    currentIndex: number
    answers: Record<string, string>
    answeredCount: number
    totalQuestions: number
    onSelect: (idx: number) => void
}

/**
 * Navigasi nomor soal — grid sidebar (desktop) + strip horizontal (mobile),
 * dengan status terjawab (hijau) dan penanda audio group (violet, label rentang).
 */
export default function ExamQuestionNavigator({
    items, currentIndex, answers, answeredCount, totalQuestions, onSelect
}: ExamQuestionNavigatorProps) {
    const isAnswered = (item: DisplayItem) =>
        item.type === 'audio_group'
            ? item.questions.every(q => !!answers[q.id])
            : !!answers[item.question.id]

    const labelOf = (item: DisplayItem) => {
        const nums = item.questionNumbers
        return nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : `${nums[0]}`
    }

    return (
        <>
            {/* Question navigation sidebar (Desktop) */}
            <div className="hidden md:block w-20 lg:w-24 bg-surface-light dark:bg-surface-dark border-r border-gray-200 dark:border-gray-700 p-3 overflow-y-auto">
                <p className="text-xs text-text-secondary mb-3 text-center">Navigasi</p>
                <div className="grid grid-cols-2 gap-2">
                    {items.map((item, idx) => {
                        const allAnswered = isAnswered(item)
                        const isAudio = item.type === 'audio_group'
                        const nums = item.questionNumbers
                        return (
                            <button
                                key={idx}
                                onClick={() => onSelect(idx)}
                                className={`${nums.length > 1 ? 'col-span-2' : ''} h-8 rounded-lg text-xs font-bold transition-all ${currentIndex === idx ? (isAudio ? 'bg-violet-500 text-white' : 'bg-primary text-white') : allAnswered ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-500/30' : isAudio ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 hover:bg-violet-200' : 'bg-gray-100 dark:bg-gray-700 text-text-secondary dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-600'}`}
                            >
                                {isAudio ? `🎧${labelOf(item)}` : labelOf(item)}
                            </button>
                        )
                    })}
                </div>
                <p className="text-xs text-text-secondary mt-4 text-center">{answeredCount}/{totalQuestions}</p>
            </div>

            {/* Mobile horizontal navigation strip */}
            <div className="md:hidden bg-surface-light dark:bg-surface-dark border-b border-gray-200 dark:border-gray-700 px-3 py-2">
                <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                    {items.map((item, idx) => {
                        const allAnswered = isAnswered(item)
                        const isAudio = item.type === 'audio_group'
                        return (
                            <button
                                key={idx}
                                onClick={() => onSelect(idx)}
                                className={`flex-shrink-0 w-auto min-w-[2rem] h-8 px-2 rounded-lg text-xs font-bold transition-all ${currentIndex === idx ? (isAudio ? 'bg-violet-500 text-white' : 'bg-primary text-white') : allAnswered ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-500/30' : isAudio ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 hover:bg-violet-200' : 'bg-gray-100 dark:bg-gray-700 text-text-secondary dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-600'}`}
                            >
                                {isAudio ? `🎧${labelOf(item)}` : labelOf(item)}
                            </button>
                        )
                    })}
                </div>
                <p className="text-xs text-text-secondary mt-1 text-center">{answeredCount}/{totalQuestions}</p>
            </div>
        </>
    )
}
