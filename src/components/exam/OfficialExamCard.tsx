'use client'

import { ReactNode } from 'react'
import { Shuffle } from 'lucide-react'
import ExamCard, { ExamCardPrimaryAction } from './ExamCard'
import type { DropdownMenuItem } from '@/components/ui/DropdownMenu'
import {
    typeBadgeFor,
    examScheduleLabels,
    getEffectiveEndTime,
    getOfficialExamStatus,
} from '@/lib/exam'

/** Baris ujian resmi (tabel official_exams) dari GET /api/official-exams */
export interface OfficialExamRow {
    id: string
    exam_type: 'UTS' | 'UAS'
    title: string
    description?: string | null
    start_time: string
    duration_minutes: number
    window_end_time?: string | null
    is_active?: boolean | null
    is_randomized?: boolean | null
    is_remedial?: boolean | null
    created_at?: string | null
    question_count?: number | null
    creator_role?: string | null
    /** Nama pembuat (guru/admin) — ditambahkan oleh GET /api/official-exams */
    creator_name?: string | null
    target_class_ids?: string[] | null
    /** Nama kelas target (aligned dengan target_class_ids) — ditambahkan GET /api/official-exams */
    target_class_names?: string[] | null
    subject?: { name?: string | null } | null
}

interface OfficialExamCardProps {
    exam: OfficialExamRow
    /** Guru: {submitted, total} → "X/Y siswa"; Admin: {submitted} → "X terkumpul" */
    submission?: { submitted: number; total?: number }
    pendingGrading?: number
    onPendingGradingClick?: () => void
    /** Tampilkan sel "Guru Pembuat" (nama pembuat ujian) — khusus admin */
    showCreator?: boolean
    primaryAction: ExamCardPrimaryAction
    menuItems?: DropdownMenuItem[]
    /** Badge tambahan di luar REMEDIAL / Dibuatkan Admin / Acak */
    extraBadges?: ReactNode[]
    dataTutorial?: string
    actionsDataTutorial?: string
}

/**
 * Adaptor card untuk ujian resmi UTS/UAS (tabel official_exams) — dipakai
 * guru (dashboard/guru/ulangan, section 2) dan admin (dashboard/admin/uts-uas).
 * Guru: tanpa info pembuat; Admin: sel "Guru Pembuat" dari creator_name.
 */
export default function OfficialExamCard({
    exam,
    submission,
    pendingGrading,
    onPendingGradingClick,
    showCreator = false,
    primaryAction,
    menuItems,
    extraBadges = [],
    dataTutorial,
    actionsDataTutorial,
}: OfficialExamCardProps) {
    const status = getOfficialExamStatus(exam)
    const scheduleLabels = examScheduleLabels(exam.window_end_time)
    const nClasses = exam.target_class_ids?.length ?? 0
    // Tooltip nama kelas target — admin/guru bisa melihat kelas mana saja
    // tanpa membuka halaman detail (mengatasi "gatau kelas mana yang terpilih")
    const classCell = nClasses > 0 && exam.target_class_names?.length ? (
        <span title={exam.target_class_names.join(', ')}>{nClasses} kelas</span>
    ) : `${nClasses} kelas`

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
            typeBadge={typeBadgeFor(exam.exam_type === 'UTS' ? 'uts' : 'uas')}
            title={exam.title}
            description={exam.description}
            extraBadges={badges}
            isLive={status.isLive}
            subjectName={exam.subject?.name}
            classNameLabel={classCell}
            durationMinutes={exam.duration_minutes}
            questionCount={exam.question_count ?? 0}
            createdAt={exam.created_at}
            teacherName={showCreator ? exam.creator_name : undefined}
            teacherLabel="Guru Pembuat"
            startTime={exam.start_time}
            endTime={getEffectiveEndTime(exam)}
            startLabel={scheduleLabels.start}
            endLabel={scheduleLabels.end}
            submission={submission}
            pendingGrading={pendingGrading}
            onPendingGradingClick={onPendingGradingClick}
            primaryAction={primaryAction}
            menuItems={menuItems}
            dataTutorial={dataTutorial}
            actionsDataTutorial={actionsDataTutorial}
        />
    )
}
