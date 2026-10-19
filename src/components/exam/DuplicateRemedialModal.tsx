'use client'

import { Modal, Button } from '@/components/ui'
import TimeWindowFields from '@/components/TimeWindowFields'
import RemedialPolicyFields, { RemedialPolicyValue } from '@/components/RemedialPolicyFields'
import TargetClassSelector, { TargetClassItem } from './TargetClassSelector'
import { formatScore, round2 } from '@/lib/formatScore'
import { Copy, Loader2 } from 'lucide-react'

export interface RemedialStudentInfo {
    id: string
    name: string
    nis?: string
    score?: number | null
    max_score?: number | null
    pct?: number
    needsRemedial?: boolean
    className?: string
    memberExamId?: string
    hasSubmitted?: boolean
}

export interface DuplicateRemedialForm {
    title: string
    start_time: string
    duration_minutes: number
    schedule_mode: 'sync' | 'window'
    window_end_time: string
    target_class_ids: string[]
}

interface DuplicateRemedialModalProps {
    open: boolean
    onClose: () => void

    mode: 'BIASA' | 'REMEDIAL'
    source: 'official' | 'ulangan'

    // Source exam info
    sourceTitle: string
    sourceQuestionCount: number
    sourceExamType?: 'UTS' | 'UAS'
    remedialNewQuestionsNote?: string

    // Form
    form: DuplicateRemedialForm
    onFormChange: (patch: Partial<DuplicateRemedialForm>) => void

    // Labels
    labels: { ulangan: string; uts: string; uas: string }

    // Target class selector
    showTargetClassSelector: boolean
    classesByLevel?: Record<string, TargetClassItem[]>
    droppedClasses?: { id: string; name: string }[]
    onToggleClass?: (classId: string) => void
    onSelectAllClasses?: () => void
    onResetClasses?: () => void
    targetClassHelperText?: string
    partialWarning?: { taught: number; total: number; typeLabel: string }

    // Remedial method (ulangan only)
    remedialMethod?: 'ASLI' | 'BARU'
    onRemedialMethodChange?: (method: 'ASLI' | 'BARU') => void

    // Remedial policy
    remedialPolicy?: RemedialPolicyValue
    onRemedialPolicyChange?: (policy: RemedialPolicyValue) => void
    kkm?: number

    // Student picker
    students?: RemedialStudentInfo[]
    selectedStudentIds?: string[]
    onStudentToggle?: (studentId: string) => void
    remedialLoading?: boolean
    remedialClassCount?: number

    // Submit
    onSubmit: () => void
    submitting: boolean
    extraSubmitDisabled?: boolean
}

export default function DuplicateRemedialModal({
    open,
    onClose,
    mode,
    source,
    sourceTitle,
    sourceQuestionCount,
    sourceExamType,
    remedialNewQuestionsNote,
    form,
    onFormChange,
    labels,
    showTargetClassSelector,
    classesByLevel,
    droppedClasses,
    onToggleClass,
    onSelectAllClasses,
    onResetClasses,
    targetClassHelperText,
    partialWarning,
    remedialMethod,
    onRemedialMethodChange,
    remedialPolicy,
    onRemedialPolicyChange,
    kkm = 75,
    students = [],
    selectedStudentIds = [],
    onStudentToggle,
    remedialLoading = false,
    remedialClassCount = 1,
    onSubmit,
    submitting,
    extraSubmitDisabled = false,
}: DuplicateRemedialModalProps) {
    const typeLabel = source === 'official'
        ? (sourceExamType === 'UAS' ? labels.uas : labels.uts)
        : labels.ulangan

    const modalTitle = mode === 'REMEDIAL'
        ? `Buat Remedial ${typeLabel}`
        : `Pakai Ulang ${typeLabel}`

    const submitLabel = mode === 'REMEDIAL'
        ? 'Proses Remedial'
        : `Salin ${typeLabel}`

    const isRemedial = mode === 'REMEDIAL'
    const showSoalMethod = isRemedial && source === 'ulangan'

    const showNewQuestionsNote = isRemedial && source === 'ulangan' && remedialMethod === 'BARU'

    const submitDisabled = !form.title || !form.start_time
        || (showTargetClassSelector && form.target_class_ids.length === 0)
        || (isRemedial && selectedStudentIds.length === 0)
        || (form.duration_minutes !== undefined && form.duration_minutes < 5)
        || extraSubmitDisabled

    return (
        <Modal open={open} onClose={onClose} title={modalTitle}>
            <div className="space-y-5">
                {/* Source banner */}
                <div className="flex items-center gap-3 p-3 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 rounded-xl">
                    <Copy className="w-5 h-5 flex-shrink-0" />
                    <div className="text-sm">
                        <div>Sumber: <span className="font-bold">{sourceTitle}</span>
                            {source === 'ulangan' && <span className="ml-1 text-xs">({labels.ulangan})</span>}
                        </div>
                        <div className="text-xs opacity-80">
                            {showNewQuestionsNote
                                ? (remedialNewQuestionsNote || `${typeLabel} baru akan dibuat dengan soal kosong`)
                                : `${sourceQuestionCount} soal akan disalin otomatis`}
                        </div>
                    </div>
                </div>

                {/* Title */}
                <div>
                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">
                        {isRemedial ? 'Judul Remedial' : 'Judul Ujian Baru'}
                    </label>
                    <input
                        type="text"
                        value={form.title}
                        onChange={(e) => onFormChange({ title: e.target.value })}
                        className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                        placeholder={isRemedial ? `Remedial ${sourceTitle}` : `Copy of ${sourceTitle}`}
                    />
                </div>

                {/* Target class selector */}
                {showTargetClassSelector && classesByLevel && onToggleClass && (
                    <TargetClassSelector
                        classesByLevel={classesByLevel}
                        selectedIds={form.target_class_ids}
                        onToggle={onToggleClass}
                        onSelectAll={onSelectAllClasses}
                        onReset={onResetClasses}
                        droppedClasses={droppedClasses}
                        helperText={targetClassHelperText}
                        partialWarning={partialWarning}
                    />
                )}

                {/* Schedule */}
                <div>
                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jadwal Pengerjaan</label>
                    <TimeWindowFields
                        value={{
                            mode: form.schedule_mode,
                            start_time: form.start_time,
                            window_end_time: form.window_end_time,
                            duration_minutes: String(form.duration_minutes)
                        }}
                        onChange={(v) => onFormChange({
                            schedule_mode: v.mode,
                            start_time: v.start_time,
                            duration_minutes: v.duration_minutes ? parseInt(v.duration_minutes, 10) || 0 : 0,
                            window_end_time: v.mode === 'window' ? v.window_end_time : ''
                        })}
                        durationRequired
                    />
                </div>

                {/* Remedial section */}
                {isRemedial && (
                    <div className="pt-2 border-t border-secondary/20">
                        {/* Soal method (ulangan only) */}
                        {showSoalMethod && onRemedialMethodChange && (
                            <div className="mb-3">
                                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Soal Remedial</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onRemedialMethodChange('ASLI')}
                                        className={`px-3 py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${remedialMethod === 'ASLI' ? 'border-primary bg-primary/5 text-primary' : 'border-secondary/20 text-text-main dark:text-white hover:border-primary/50'}`}
                                    >
                                        Soal Asli (disalin)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onRemedialMethodChange('BARU')}
                                        className={`px-3 py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${remedialMethod === 'BARU' ? 'border-primary bg-primary/5 text-primary' : 'border-secondary/20 text-text-main dark:text-white hover:border-primary/50'}`}
                                    >
                                        Soal Baru (kosong)
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Policy fields */}
                        {remedialPolicy && onRemedialPolicyChange && (
                            <div className="mb-4">
                                <RemedialPolicyFields
                                    value={remedialPolicy}
                                    onChange={onRemedialPolicyChange}
                                    capPlaceholder={kkm}
                                />
                            </div>
                        )}

                        {/* Student picker */}
                        <div className="flex items-center justify-between mb-3">
                            <label className="block text-sm font-bold text-text-main dark:text-white">Pilih Siswa Remedial</label>
                            <div className="text-xs text-text-secondary">
                                <span className="font-bold text-primary">{selectedStudentIds.length}</span> dari {students.length} siswa
                            </div>
                        </div>

                        {remedialLoading ? (
                            <div className="flex items-center justify-center py-6">
                                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                            </div>
                        ) : students.length === 0 ? (
                            <div className="p-4 bg-secondary/5 rounded-xl text-center text-sm text-text-secondary">
                                Belum ada siswa di kelas {typeLabel.toLowerCase()} ini.
                            </div>
                        ) : (
                            <div className="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                {students.map(student => (
                                    <label
                                        key={student.id}
                                        className="flex items-center gap-3 p-3 rounded-xl border border-secondary/20 hover:border-primary/30 cursor-pointer transition-colors bg-white dark:bg-surface-dark"
                                        onClick={(e) => {
                                            e.preventDefault()
                                            onStudentToggle?.(student.id)
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedStudentIds.includes(student.id)}
                                            onChange={() => { }}
                                            className="w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary pointer-events-none"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-sm text-text-main dark:text-white truncate">{student.name}</div>
                                            <div className="text-xs text-text-secondary">
                                                {student.nis ? `NIS: ${student.nis}` : ''}
                                                {remedialClassCount > 1 && student.className && <span className="ml-2 font-bold text-primary">{student.className}</span>}
                                                {student.hasSubmitted === false && ' · Belum Mengumpulkan'}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            {student.hasSubmitted === false ? (
                                                <div className="text-xs text-text-secondary">Belum Mengumpulkan</div>
                                            ) : (
                                                <>
                                                    <div className={`font-bold text-sm ${student.needsRemedial ? 'text-red-500' : 'text-emerald-500'}`}>
                                                        {formatScore(student.score)} / {formatScore(student.max_score)}
                                                    </div>
                                                    {typeof student.pct === 'number' && (
                                                        <div className="text-[10px] text-text-secondary">Nilai: {formatScore(round2(student.pct))}</div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}

                        {/* Info box */}
                        <div className="mt-2 text-xs text-text-secondary p-2 bg-primary/5 text-primary rounded-lg">
                            <span className="font-bold">Info:</span> Siswa yang dipilih akan melihat soal ini di dashboard mereka. Sistem akan secara otomatis mengambil nilai tertinggi antara ujian asli dan remedial sesuai kebijakan yang dipilih.
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="flex gap-3 pt-4 border-t border-secondary/10">
                    <Button variant="secondary" onClick={onClose} className="flex-1">Batal</Button>
                    <Button
                        onClick={onSubmit}
                        loading={submitting}
                        disabled={submitDisabled}
                        className="flex-1"
                    >
                        {submitLabel}
                    </Button>
                </div>
            </div>
        </Modal>
    )
}
