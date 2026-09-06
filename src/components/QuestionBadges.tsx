import { TickSquare, Discovery, InfoCircle, CloseSquare, Paper } from 'react-iconly'
import { BrainCircuit } from 'lucide-react'
import { useSchoolLabels } from '@/contexts/LabelsContext'
import { MenuLabels, DEFAULT_MENU_LABELS } from '@/lib/labels'

// ─────────────────────────────────────────────────────────
// Shared question badges — satu sumber warna untuk guru & admin
// ─────────────────────────────────────────────────────────

const baseClass = 'inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full font-medium border whitespace-nowrap'

export function getQuestionTypeLabel(type: string): string {
    switch (type) {
        case 'MULTIPLE_CHOICE': return 'Pilihan Ganda'
        case 'MULTIPLE_ANSWER': return 'PG Kompleks'
        case 'TRUE_FALSE': return 'Benar/Salah'
        case 'SHORT_ANSWER': return 'Isian Singkat'
        case 'ESSAY': return 'Essay'
        default: return type
    }
}

export function QuestionTypeBadge({ type }: { type: string }) {
    return (
        <span className={`${baseClass} bg-secondary/10 text-text-secondary border-secondary/20`}>
            {getQuestionTypeLabel(type)}
        </span>
    )
}

export function getDifficultyLabel(difficulty: string): string {
    switch (difficulty) {
        case 'EASY': return 'Mudah'
        case 'MEDIUM': return 'Sedang'
        case 'HARD': return 'Sulit'
        default: return difficulty
    }
}

export function DifficultyBadge({ difficulty }: { difficulty: string }) {
    const cls = difficulty === 'EASY'
        ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-500/20'
        : difficulty === 'MEDIUM'
            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20'
            : difficulty === 'HARD'
                ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20'
                : 'bg-secondary/10 text-text-secondary border-secondary/20'
    return <span className={`${baseClass} ${cls}`}>{getDifficultyLabel(difficulty)}</span>
}

export function getSourceLabel(source?: string, sourceName?: string, labels: MenuLabels = DEFAULT_MENU_LABELS): string {
    if (source === 'exam') return `${labels.ulangan}${sourceName ? `: ${sourceName}` : ''}`
    if (source === 'quiz') return `${labels.kuis}${sourceName ? `: ${sourceName}` : ''}`
    if (source === 'ai_generated') return 'AI Generated'
    return 'Manual'
}

export function SourceBadge({ source, sourceName }: { source?: string; sourceName?: string }) {
    const labels = useSchoolLabels()
    const type = source || 'manual'
    const cls = type === 'exam'
        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20'
        : type === 'quiz'
            ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/20'
            : type === 'ai_generated'
                ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-500/20'
                : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/20'
    return (
        <span className={`${baseClass} ${cls}`} title={sourceName || undefined}>
            {getSourceLabel(type, sourceName, labels)}
        </span>
    )
}

export function QuestionStatusBadge({ status, aiReviewEnabled }: { status?: string; aiReviewEnabled: boolean }) {
    switch (status) {
        case 'approved':
            return <span className={`${baseClass} bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-500/20`}><TickSquare set="bold" primaryColor="currentColor" size={12} /> Approved</span>
        case 'ai_reviewing':
            return aiReviewEnabled
                ? <span className={`${baseClass} bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20 animate-pulse`}><Discovery set="bold" primaryColor="currentColor" size={12} /> AI Review...</span>
                : null
        case 'admin_review':
            return aiReviewEnabled
                ? <span className={`${baseClass} bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20`}><InfoCircle set="bold" primaryColor="currentColor" size={12} /> Perlu Review</span>
                : null
        case 'returned':
            return <span className={`${baseClass} bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20`}><CloseSquare set="bold" primaryColor="currentColor" size={12} /> Dikembalikan</span>
        case 'draft':
            return <span className={`${baseClass} bg-secondary/10 text-text-secondary border-secondary/20`}><Paper set="bold" primaryColor="currentColor" size={12} /> Draft</span>
        default:
            return null
    }
}

export function HotsBadge() {
    return (
        <span className={`${baseClass} bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20`}>
            <BrainCircuit className="w-3 h-3" /> HOTS
        </span>
    )
}
