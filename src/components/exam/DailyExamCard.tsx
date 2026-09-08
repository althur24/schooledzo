'use client'

import { ReactNode } from 'react'
import { Shuffle } from 'lucide-react'
import ExamCard, { ExamCardPrimaryAction } from './ExamCard'
import type { DropdownMenuItem } from '@/components/ui/DropdownMenu'
import {
    typeBadgeFor,
    examScheduleLabels,
    getEffectiveEndTime,
    getExamStatus,
    unwrapEmbed,
} from '@/lib/exam'

/** Embed teaching_assignment — PostgREST bisa mengembalikan array (FK ambigu) */
interface TaEmbed {
    id?: string
    subject?: { name?: string | null } | { name?: string | null }[] | null
    class?: { name?: string | null } | { name?: string | null }[] | null
    teacher?: {
        user?: { full_name?: string | null } | { full_name?: string | null }[] | null
    } | {
        user?: { full_name?: string | null } | { full_name?: string | null }[] | null
    }[] | null
}

/** Baris ulangan harian (tabel exams) dari GET /api/exams */
export interface DailyExamRow {
    id: string
    title: string
    description?: string | null
    start_time: string
    duration_minutes: number
    window_end_time?: string | null
    is_active?: boolean | null
    pending_publish?: boolean | null
    is_randomized?: boolean | null
    is_remedial?: boolean | null
    batch_size?: number | null
    created_at?: string | null
    question_count?: number | null
    creator_role?: string | null
    teaching_assignment?: TaEmbed | TaEmbed[] | null
}

interface DailyExamCardProps {
    exam: DailyExamRow
    /** Guru: {submitted, total} → "X/Y siswa"; Admin: {submitted} → "X terkumpul" */
    submission?: { submitted: number; total?: number }
    pendingGrading?: number
    onPendingGradingClick?: () => void
    /** Override nama guru pengampu; default dari embed teaching_assignment (dipakai admin) */
    teacherName?: string
    primaryAction: ExamCardPrimaryAction
    menuItems?: DropdownMenuItem[]
    /** Badge tambahan di luar REMEDIAL / Dibuatkan Admin / Acak */
    extraBadges?: ReactNode[]
    dataTutorial?: string
    actionsDataTutorial?: string
}

/**
 * Adaptor card untuk ulangan harian (tabel exams) — dipakai guru
 * (dashboard/guru/ulangan) dan admin (tab Ulangan). Mapping row → props,
 * status, badge, dan jadwal terjadi di satu tempat; halaman hanya
 * menyuplai aksi (primaryAction + menuItems) dan info pengumpulan.
 */
export default function DailyExamCard({
    exam,
    submission,
    pendingGrading,
    onPendingGradingClick,
    teacherName,
    primaryAction,
    menuItems,
    extraBadges = [],
    dataTutorial,
    actionsDataTutorial,
}: DailyExamCardProps) {
    const status = getExamStatus(exam)

    const ta = unwrapEmbed(exam.teaching_assignment)
    const subjectName = unwrapEmbed(ta?.subject)?.name
    const classNameLabel = unwrapEmbed(ta?.class)?.name
    const embeddedTeacherName = unwrapEmbed(unwrapEmbed(ta?.teacher)?.user)?.full_name

    const scheduleLabels = examScheduleLabels(exam.window_end_time)

    const badges = [
        ...(exam.is_remedial ? [(
            <span key="remedial" className="px-2 py-0.5 bg-gradient-to-r from-orange-400 to-red-500 text-white text-[10px] font-bold rounded-full shadow-sm animate-pulse-slow">
                REMEDIAL
            </span>
        )] : []),
        ...(exam.creator_role === 'ADMIN' ? [(
            <span key="admin" className="px-2.5 py-1 text-xs font-bold rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20">
                Dibuatkan Admin
            </span>
        )] : []),
        ...(exam.is_randomized ? [(
            <span key="acak" className="text-xs text-text-secondary flex items-center gap-1 bg-secondary/10 px-2 py-1 rounded-full">
                <Shuffle className="w-3 h-3" /> Acak
            </span>
        )] : []),
        ...extraBadges,
    ]

    return (
        <ExamCard
            status={status}
            typeBadge={typeBadgeFor('ulangan')}
            title={exam.title}
            description={exam.description}
            extraBadges={badges}
            isLive={status.isLive}
            subjectName={subjectName}
            classNameLabel={classNameLabel}
            durationMinutes={exam.duration_minutes}
            questionCount={exam.question_count ?? 0}
            createdAt={exam.created_at}
            teacherName={teacherName ?? embeddedTeacherName}
            startTime={exam.start_time}
            endTime={getEffectiveEndTime(exam)}
            startLabel={scheduleLabels.start}
            endLabel={scheduleLabels.end}
            submission={submission}
            pendingGrading={pendingGrading}
            onPendingGradingClick={onPendingGradingClick}
            batchSize={exam.batch_size ?? 1}
            primaryAction={primaryAction}
            menuItems={menuItems}
            dataTutorial={dataTutorial}
            actionsDataTutorial={actionsDataTutorial}
        />
    )
}
