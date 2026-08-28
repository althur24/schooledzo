'use client'

interface ExamZoomHintProps {
    visible: boolean
    onDismiss: () => void
}

export default function ExamZoomHint({ visible, onDismiss }: ExamZoomHintProps) {
    if (!visible) return null
    return (
        <div
            onClick={onDismiss}
            className="bg-blue-500/10 dark:bg-blue-400/10 text-blue-600 dark:text-blue-300 text-xs font-medium text-center py-1.5 px-3 cursor-pointer select-none"
        >
            💡 Tips: klik dua kali pada soal — atau gunakan tombol − / + di header — untuk memperbesar tampilan
        </div>
    )
}
