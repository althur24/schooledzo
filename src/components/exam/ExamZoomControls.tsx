'use client'

interface ExamZoomControlsProps {
    zoomLevel: number
    canZoomIn: boolean
    canZoomOut: boolean
    onZoomIn: () => void
    onZoomOut: () => void
}

export default function ExamZoomControls({ zoomLevel, canZoomIn, canZoomOut, onZoomIn, onZoomOut }: ExamZoomControlsProps) {
    return (
        <div
            className="flex items-center gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 select-none"
            title="Zoom soal — bisa juga klik dua kali pada area soal"
        >
            <button
                type="button"
                onClick={onZoomOut}
                disabled={!canZoomOut}
                aria-label="Perkecil tampilan soal"
                className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-lg font-bold leading-none transition-colors"
            >
                −
            </button>
            <span className="text-xs font-bold text-text-secondary dark:text-slate-400 tabular-nums min-w-[2.75rem] text-center">
                {Math.round(zoomLevel * 100)}%
            </span>
            <button
                type="button"
                onClick={onZoomIn}
                disabled={!canZoomIn}
                aria-label="Perbesar tampilan soal"
                className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-lg font-bold leading-none transition-colors"
            >
                +
            </button>
        </div>
    )
}
