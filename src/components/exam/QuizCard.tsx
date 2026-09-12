'use client'

import { ReactNode } from 'react'
import { Shuffle } from 'lucide-react'
import ExamCard, { ExamCardPrimaryAction } from './ExamCard'
import type { DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { typeBadgeFor, getQuizStatus, unwrapEmbed } from '@/lib/exam'

/** Embed teaching_assignment — PostgREST bisa mengembalikan array (FK ambigu) */
interface TaEmbed {
    id?: string
    subject?: { name?: string | null } | { name?: string | null }[] | null
    class?: { name?: string | null } | { name?: string | null }[] | null
}

/** Baris kuis (tabel quizzes) dari GET /api/quizzes */
export interface QuizRow {
    id: string
    title: string
    description?: string | null
    duration_minutes?: number | null
    /** Jam buka jendela pengerjaan (opsional) */
    available_from?: string | null
    /** Batas waktu pengerjaan (opsional — null = tanpa batas) */
    deadline?: string | null
    is_active?: boolean | null
    pending_publish?: boolean | null
    is_randomized?: boolean | null
    is_remedial?: boolean | null
    submission_mode?: string | null
    batch_size?: number | null
    /** Nama kelas unik dalam batch — tooltip badge "N Kelas Paralel" */
    batch_class_names?: string[] | null
    created_at?: string | null
    questions?: { count: number }[] | null
    teaching_assignment?: TaEmbed | TaEmbed[] | null
}

interface QuizCardProps {
    quiz: QuizRow
    submission?: { submitted: number; total?: number }
    pendingGrading?: number
    onPendingGradingClick?: () => void
    primaryAction: ExamCardPrimaryAction
    menuItems?: DropdownMenuItem[]
    /** Badge tambahan di luar REMEDIAL / Offline / Acak */
    extraBadges?: ReactNode[]
    dataTutorial?: string
    actionsDataTutorial?: string
}

/**
 * Adaptor card untuk kuis (tabel quizzes).
 *
 * Perbedaan vs ujian (by design):
 * - Tidak ada Monitor Live — kuis tidak diawasi real-time.
 * - Jadwal = jendela available_from → deadline (keduanya opsional,
 *   tidak pernah dihitung dari durasi — durasi kuis berjalan per-siswa
 *   setelah mulai).
 * - Status 4-state: Under Review → Draft → Aktif → Berakhir.
 */
export default function QuizCard({
    quiz,
    submission,
    pendingGrading,
    onPendingGradingClick,
    primaryAction,
    menuItems,
    extraBadges = [],
    dataTutorial,
    actionsDataTutorial,
}: QuizCardProps) {
    const status = getQuizStatus(quiz)

    const ta = unwrapEmbed(quiz.teaching_assignment)
    const subjectName = unwrapEmbed(ta?.subject)?.name
    const classNameLabel = unwrapEmbed(ta?.class)?.name

    const badges = [
        ...(quiz.is_remedial ? [(
            <span key="remedial" className="px-2 py-0.5 bg-gradient-to-r from-orange-400 to-red-500 text-white text-[10px] font-bold rounded-full shadow-sm animate-pulse-slow">
                REMEDIAL
            </span>
        )] : []),
        ...(quiz.submission_mode === 'OFFLINE' ? [(
            <span key="offline" className="px-2.5 py-1 text-xs font-bold rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-200 dark:border-teal-500/20">
                Offline
            </span>
        )] : []),
        ...(quiz.is_randomized ? [(
            <span key="acak" className="text-xs text-text-secondary flex items-center gap-1 bg-secondary/10 px-2 py-1 rounded-full">
                <Shuffle className="w-3 h-3" /> Acak
            </span>
        )] : []),
        ...extraBadges,
    ]

    return (
        <ExamCard
            status={status}
            typeBadge={typeBadgeFor('kuis')}
            title={quiz.title}
            description={quiz.description}
            extraBadges={badges}
            subjectName={subjectName}
            classNameLabel={classNameLabel}
            durationMinutes={quiz.duration_minutes}
            questionCount={quiz.questions?.[0]?.count ?? 0}
            createdAt={quiz.created_at}
            startTime={quiz.available_from}
            endTime={quiz.deadline}
            startLabel="Dibuka"
            endLabel="Ditutup"
            submission={submission}
            pendingGrading={pendingGrading}
            onPendingGradingClick={onPendingGradingClick}
            batchSize={quiz.batch_size ?? 1}
            batchClassNames={quiz.batch_class_names ?? undefined}
            primaryAction={primaryAction}
            menuItems={menuItems}
            dataTutorial={dataTutorial}
            actionsDataTutorial={actionsDataTutorial}
        />
    )
}
