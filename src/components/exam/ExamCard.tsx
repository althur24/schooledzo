'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import { Layers } from 'lucide-react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import DropdownMenu, { DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { useSchoolLabels } from '@/contexts/LabelsContext'
import { labelForGradeType } from '@/lib/labels'
import { formatDate, formatDateTime } from '@/lib/exam'

export interface ExamCardStatus {
    label: string
    color: string
}

export interface ExamCardPrimaryAction {
    label: string
    icon?: ReactNode
    href: string
}

interface ExamCardProps {
    /** Status badge hasil getExamStatus / getOfficialExamStatus / getQuizStatus (src/lib/exam.ts) */
    status: ExamCardStatus
    /** Badge jenis ujian: ULANGAN / UTS / UAS / KUIS */
    typeBadge: { label: string; className: string }
    title: string
    description?: string | null
    /** Badge tambahan (REMEDIAL, Dibuatkan Admin, Acak, Offline, dst.) */
    extraBadges?: ReactNode[]
    isLive?: boolean

    /** Nama mapel — kosongkan bila tidak relevan */
    subjectName?: string | null
    /** Nama kelas / ringkasan kelas target */
    classNameLabel?: string | null
    durationMinutes?: number | null
    questionCount?: number
    /** Tanggal card/ujian dibuat (created_at) */
    createdAt?: string | null
    /** Nama guru pemilik ujian — khusus tampilan admin */
    teacherName?: string | null
    /** Label sel guru (default "Guru"; UTS/UAS admin pakai "Guru Pembuat") */
    teacherLabel?: string

    /**
     * Jadwal — murni presentasi. Perhitungan endTime & pemilihan label
     * dilakukan adaptor (DailyExamCard/OfficialExamCard/QuizCard), bukan di sini.
     * Baris dirender independen: kuis bisa hanya punya Dibuka, atau hanya Ditutup.
     */
    startTime?: string | null
    endTime?: string | null
    startLabel?: string
    endLabel?: string

    /** Pengumpulan: total terisi → "X/Y siswa" (guru); tanpa total → "X terkumpul" (admin) */
    submission?: { submitted: number; total?: number }
    /** Jumlah jawaban yang belum dikoreksi */
    pendingGrading?: number
    onPendingGradingClick?: () => void

    /** Jumlah anggota batch multi-kelas (1 = bukan batch). Soal batch tersinkron antar kelas. */
    batchSize?: number

    /** Aksi utama kontekstual: Edit (draft) / Monitor (live) / Hasil (selesai) */
    primaryAction: ExamCardPrimaryAction
    /** Aksi sekunder di menu "..." (Remedial, Pakai Ulang, Hapus, dst.) */
    menuItems?: DropdownMenuItem[]

    /** Hook product-tour (data-tutorial) — root card & wadah tombol aksi */
    dataTutorial?: string
    actionsDataTutorial?: string
}

const typeBadgeBase = 'px-2.5 py-1 text-xs font-bold rounded-full'

/**
 * Card ujian terpadu — dipakai bersama oleh Ulangan Harian, UTS/UAS, dan
 * Kuis (via adaptor) agar semua jenis & role tampil identik:
 * header (status + jenis) → judul/deskripsi → ringkasan info → footer
 * (1 tombol aksi utama + menu "..." untuk aksi sekunder).
 * Perbedaan antar role hanya lewat props (mis. teacherName khusus admin).
 */
export default function ExamCard({
    status,
    typeBadge,
    title,
    description,
    extraBadges = [],
    isLive = false,
    subjectName,
    classNameLabel,
    durationMinutes,
    questionCount,
    createdAt,
    teacherName,
    teacherLabel = 'Guru',
    startTime,
    endTime,
    startLabel = 'Mulai',
    endLabel = 'Berakhir',
    submission,
    pendingGrading = 0,
    onPendingGradingClick,
    batchSize = 1,
    primaryAction,
    menuItems = [],
    dataTutorial,
    actionsDataTutorial,
}: ExamCardProps) {
    const labels = useSchoolLabels()
    const noQuestions = (questionCount ?? 0) === 0

    // Sel info meta. Bila jumlahnya ganjil, sel TERAKHIR dirender sebagai baris
    // pasangan label-kiri/nilai-kanan agar nilainya jatuh di rel kolom kanan
    // (sejajar nilai jadwal) dan grid tidak bolong.
    const metaCells: { key: string; label: string; value: ReactNode; valueClass: string }[] = []
    if (subjectName) metaCells.push({ key: 'subject', label: 'Mata Pelajaran', value: subjectName, valueClass: 'font-bold text-primary truncate' })
    if (classNameLabel) metaCells.push({ key: 'class', label: 'Kelas', value: classNameLabel, valueClass: 'font-bold text-text-main dark:text-white truncate' })
    if (teacherName) metaCells.push({ key: 'teacher', label: teacherLabel, value: teacherName, valueClass: 'font-bold text-text-main dark:text-white truncate' })
    if (typeof durationMinutes === 'number') metaCells.push({ key: 'duration', label: 'Durasi', value: `${durationMinutes} menit`, valueClass: 'font-bold text-text-main dark:text-white' })
    if (typeof questionCount === 'number') metaCells.push({
        key: 'questions',
        label: 'Jumlah Soal',
        value: noQuestions
            ? (<>
                <span className="text-red-500">{questionCount}</span>
                <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-[10px] font-bold">BELUM ADA SOAL</span>
            </>)
            : questionCount,
        valueClass: `font-bold ${noQuestions ? '' : 'text-text-main dark:text-white'}`,
    })
    if (createdAt) metaCells.push({ key: 'created', label: 'Dibuat', value: formatDate(createdAt), valueClass: 'font-bold text-text-main dark:text-white truncate' })

    const oddLastCell = metaCells.length % 2 === 1 ? metaCells[metaCells.length - 1] : null
    const stackedCells = oddLastCell ? metaCells.slice(0, -1) : metaCells
    const hasScheduleRows = Boolean(startTime || endTime || submission)

    return (
        <Card
            padding="p-0"
            className={`group flex flex-col overflow-visible transition-all hover:shadow-lg ${isLive ? 'hover:shadow-red-500/10' : 'hover:shadow-primary/5'}`}
            {...(dataTutorial ? { 'data-tutorial': dataTutorial } : {})}
        >
            <div className="p-5 pb-4 flex flex-col gap-3 flex-1">
                {/* Header: badges */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${status.color}`}>
                        {isLive && (
                            <span className="flex items-center gap-1.5">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                                </span>
                                {status.label}
                            </span>
                        )}
                        {!isLive && status.label}
                    </span>
                    <span className={`${typeBadgeBase} ${typeBadge.className}`}>{labelForGradeType(typeBadge.label, labels)}</span>
                    {(batchSize > 1) && (
                        <span
                            title={`Soal ${labelForGradeType(typeBadge.label, labels)} ini tersinkron otomatis ke ${batchSize} kelas paralel`}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-500/20"
                        >
                            <Layers className="w-3.5 h-3.5" /> {batchSize} Kelas Paralel
                        </span>
                    )}
                    {extraBadges}
                </div>

                {/* Title + description */}
                <div>
                    <h3 className="font-bold text-text-main dark:text-white text-lg group-hover:text-primary transition-colors line-clamp-2">
                        {title}
                    </h3>
                    <p className="text-sm text-text-secondary dark:text-zinc-400 line-clamp-2 mt-1">
                        {description || 'Tidak ada deskripsi'}
                    </p>
                </div>

                {/* Meta — SATU grid datar: sel info & baris jadwal berbagi track
                    kolom yang sama, jadi nilai kolom kanan dan nilai jadwal
                    dijamin sejajar presisi di satu rel vertikal. */}
                {(metaCells.length > 0 || hasScheduleRows) && (
                <div className="grid grid-cols-2 gap-2 pt-3 border-t border-secondary/10 text-xs">
                    {stackedCells.map(cell => (
                        <div key={cell.key} className="min-w-0">
                            <p className="text-text-secondary">{cell.label}</p>
                            <p className={cell.valueClass}>{cell.value}</p>
                        </div>
                    ))}
                    {oddLastCell && (<>
                        <span className="text-text-secondary">{oddLastCell.label}</span>
                        <span className={`min-w-0 ${oddLastCell.valueClass}`}>{oddLastCell.value}</span>
                    </>)}
                    {hasScheduleRows && metaCells.length > 0 && (
                        <div aria-hidden className="col-span-2 border-t border-secondary/10" />
                    )}
                    {startTime && (<>
                        <span className="text-text-secondary">{startLabel}</span>
                        <span className="font-bold text-text-main dark:text-white">{formatDateTime(startTime)}</span>
                    </>)}
                    {endTime && (<>
                        <span className="text-text-secondary">{endLabel}</span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatDateTime(endTime)}</span>
                    </>)}
                    {submission && (() => {
                        const total = submission.total
                        const value = typeof total === 'number'
                            ? `${submission.submitted}/${total} siswa`
                            : `${submission.submitted} terkumpul`
                        const valueClass = typeof total === 'number' && total > 0 && submission.submitted >= total
                            ? 'text-green-600'
                            : 'text-primary'
                        return (<>
                            <span className="text-text-secondary">Pengumpulan</span>
                            <span className={`font-bold ${valueClass}`}>{value}</span>
                        </>)
                    })()}
                </div>
                )}

                {pendingGrading > 0 && (
                    <button
                        type="button"
                        onClick={onPendingGradingClick}
                        className="flex items-center justify-between text-xs px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors cursor-pointer"
                    >
                        <span className="text-amber-600 dark:text-amber-400 font-medium">Perlu Dikoreksi</span>
                        <span className="font-bold text-amber-600 dark:text-amber-400">{pendingGrading}</span>
                    </button>
                )}
            </div>

            {/* Footer: 1 aksi utama + menu "..." */}
            <div
                className="px-5 py-4 border-t border-secondary/10 flex items-center gap-2"
                {...(actionsDataTutorial ? { 'data-tutorial': actionsDataTutorial } : {})}
            >
                <Link href={primaryAction.href} className="flex-1">
                    <Button
                        size="sm"
                        variant={isLive ? 'danger-solid' : 'primary'}
                        className="w-full justify-center"
                        icon={primaryAction.icon}
                    >
                        {primaryAction.label}
                    </Button>
                </Link>
                {menuItems.length > 0 && <DropdownMenu items={menuItems} ariaLabel={`Aksi lainnya untuk ${title}`} />}
            </div>
        </Card>
    )
}
