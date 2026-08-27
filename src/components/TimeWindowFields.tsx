'use client'

import { useMemo } from 'react'
import { Clock, CalendarRange, Users } from 'lucide-react'

/**
 * TimeWindowFields — form jadwal pengerjaan untuk kuis/ulangan/UTS-UAS.
 *
 * Dua mode:
 *  - SERENTAK (default, perilaku lama): semua siswa selesai bersamaan di
 *    jam mulai + durasi.
 *  - JENDELA WAKTU: siswa boleh mulai kapan saja antara jam buka dan jam
 *    tutup; setelah mulai mendapat durasi per siswa, dipotong di jam tutup.
 *
 * Komponen ini controlled — nilai dikembalikan via onChange dan caller
 * yang mengirim ke API (ISO string / null).
 */

export type ExamScheduleMode = 'sync' | 'window'

export interface ExamScheduleValue {
    mode: ExamScheduleMode
    /** datetime-local string (jam mulai / jam buka) */
    start_time: string
    /** datetime-local string (jam tutup) — hanya mode window */
    window_end_time: string
    /** menit; string agar input number fleksibel */
    duration_minutes: string
}

export const emptyExamSchedule = (): ExamScheduleValue => ({
    mode: 'sync',
    start_time: '',
    window_end_time: '',
    duration_minutes: '',
})

interface TimeWindowFieldsProps {
    value: ExamScheduleValue
    onChange: (v: ExamScheduleValue) => void
    /** Label jam buka sesuai konteks (mis. "Waktu Mulai") */
    startLabel?: string
    /** Durasi wajib diisi? (ulangan/UTS-UAS: ya; kuis: opsional) */
    durationRequired?: boolean
    disabled?: boolean
    /** Sembunyikan pilihan mode serentak (dipakai kuis yang tidak punya konsep serentak) */
    quizMode?: boolean
}

const inputClass = 'w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary'

export default function TimeWindowFields({
    value,
    onChange,
    startLabel = 'Waktu Mulai',
    durationRequired = true,
    disabled = false,
    quizMode = false
}: TimeWindowFieldsProps) {
    const set = (patch: Partial<ExamScheduleValue>) => onChange({ ...value, ...patch })

    const startMs = value.start_time ? new Date(value.start_time).getTime() : null
    const endMs = value.window_end_time ? new Date(value.window_end_time).getTime() : null
    const durationMin = parseInt(value.duration_minutes, 10) || 0

    const errors: string[] = []
    const warnings: string[] = []

    if (startMs !== null && endMs !== null && endMs <= startMs) {
        errors.push('Jam tutup harus setelah jam buka.')
    }
    if (durationRequired && durationMin < 5) {
        errors.push('Durasi minimal 5 menit.')
    }
    if (value.mode === 'window' && startMs !== null && endMs !== null && durationMin > 0) {
        const windowMin = Math.round((endMs - startMs) / 60000)
        if (durationMin > windowMin) {
            warnings.push(`Durasi (${durationMin} mnt) lebih panjang dari jendela (${windowMin} mnt) — siswa yang mulai di menit-menit akhir hanya mendapat sisa waktu jendela.`)
        }
    }

    const fmtTime = (ms: number | null): string => {
        if (ms === null) return '—'
        return new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    }
    const fmtDate = (ms: number | null): string => {
        if (ms === null) return ''
        return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
    }

    // Preview bar jendela (mode window)
    const windowPreview = useMemo(() => {
        if (value.mode !== 'window' || startMs === null || endMs === null || endMs <= startMs) return null
        return { start: startMs, end: endMs }
    }, [value.mode, startMs, endMs])

    return (
        <div className="space-y-4">
            {/* Mode selector */}
            {!quizMode && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => set({ mode: 'sync', window_end_time: '' })}
                        className={`flex items-start gap-3 p-3.5 border-2 rounded-xl text-left transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${value.mode === 'sync'
                            ? 'border-primary bg-primary/5 dark:bg-primary/10'
                            : 'border-secondary/20 hover:border-primary/40'
                            }`}
                    >
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${value.mode === 'sync' ? 'bg-primary text-white' : 'bg-secondary/10 text-primary'}`}>
                            <Users className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-text-main dark:text-white">Serentak</p>
                            <p className="text-xs text-text-secondary">Semua siswa selesai bersamaan di jam mulai + durasi</p>
                        </div>
                    </button>
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => set({ mode: 'window' })}
                        className={`flex items-start gap-3 p-3.5 border-2 rounded-xl text-left transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${value.mode === 'window'
                            ? 'border-primary bg-primary/5 dark:bg-primary/10'
                            : 'border-secondary/20 hover:border-primary/40'
                            }`}
                    >
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${value.mode === 'window' ? 'bg-primary text-white' : 'bg-secondary/10 text-primary'}`}>
                            <CalendarRange className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-text-main dark:text-white">Jendela Waktu</p>
                            <p className="text-xs text-text-secondary">Siswa mulai kapan saja antara jam buka–tutup, durasi per siswa</p>
                        </div>
                    </button>
                </div>
            )}

            {/* Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">
                        {value.mode === 'window' ? 'Dibuka Pukul' : startLabel} <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="datetime-local"
                        value={value.start_time}
                        onChange={(e) => set({ start_time: e.target.value })}
                        disabled={disabled}
                        required
                        className={inputClass}
                    />
                </div>
                {value.mode === 'window' && (
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">
                            Ditutup Pukul <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="datetime-local"
                            value={value.window_end_time}
                            onChange={(e) => set({ window_end_time: e.target.value })}
                            disabled={disabled}
                            className={inputClass}
                        />
                    </div>
                )}
                <div>
                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">
                        Durasi Pengerjaan {!durationRequired && <span className="text-text-secondary font-normal">(opsional)</span>} {durationRequired && <span className="text-red-500">*</span>}
                    </label>
                    <div className="relative">
                        <input
                            type="number"
                            value={value.duration_minutes}
                            onChange={(e) => set({ duration_minutes: e.target.value })}
                            disabled={disabled}
                            min={5}
                            max={quizMode ? 720 : 300}
                            placeholder={quizMode ? 'Tanpa batas waktu' : '60'}
                            className={inputClass}
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-text-secondary pointer-events-none">menit / siswa</span>
                    </div>
                </div>
            </div>

            {/* Preview + rules */}
            {value.mode === 'window' && windowPreview && (
                <div className="p-4 bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-primary">
                        <span>{fmtDate(windowPreview.start)} · {fmtTime(windowPreview.start)}</span>
                        <span>{fmtDate(windowPreview.end)} · {fmtTime(windowPreview.end)}</span>
                    </div>
                    <div className="relative h-2.5 bg-secondary/10 rounded-full overflow-hidden">
                        <div className="absolute inset-y-0 left-0 right-0 bg-gradient-to-r from-primary/70 to-primary/30 rounded-full" />
                    </div>
                    <p className="text-xs text-text-secondary flex items-start gap-1.5">
                        <Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
                        {durationMin > 0
                            ? <>Siswa boleh mulai kapan saja antara {fmtTime(windowPreview.start)}–{fmtTime(windowPreview.end)}. Setelah mulai, siswa punya <span className="font-bold text-primary">{durationMin} menit</span> — dipotong di jam tutup bila sisa waktunya lebih pendek.</>
                            : <>Siswa boleh mulai kapan saja antara {fmtTime(windowPreview.start)}–{fmtTime(windowPreview.end)} dan mengerjakan tanpa batas waktu sampai jam tutup.</>}
                    </p>
                </div>
            )}
            {value.mode === 'sync' && startMs !== null && durationMin > 0 && !quizMode && (
                <div className="p-3 bg-secondary/5 border border-secondary/20 rounded-xl">
                    <p className="text-xs text-text-secondary flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
                        Semua siswa selesai bersamaan pukul <span className="font-bold text-primary">{fmtTime(startMs + durationMin * 60000)}</span> ({fmtDate(startMs + durationMin * 60000)}). Siswa telat mulai hanya mendapat sisa waktu.
                    </p>
                </div>
            )}

            {/* Validasi inline */}
            {errors.map((e) => (
                <p key={e} className="text-xs font-medium text-red-600 dark:text-red-400">⚠ {e}</p>
            ))}
            {warnings.map((w) => (
                <p key={w} className="text-xs font-medium text-amber-600 dark:text-amber-400">💡 {w}</p>
            ))}
        </div>
    )
}
