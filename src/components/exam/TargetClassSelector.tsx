'use client'

export interface TargetClassItem {
    id: string
    name: string
    school_level: string | null
    grade_level: number | null
}

interface TargetClassSelectorProps {
    classesByLevel: Record<string, TargetClassItem[]>
    selectedIds: string[]
    onToggle: (classId: string) => void
    onSelectAll?: () => void
    onReset?: () => void
    droppedClasses?: { id: string; name: string }[]
    label?: string
    helperText?: string
    showSelectAll?: boolean
    partialWarning?: { taught: number; total: number; typeLabel: string }
}

export default function TargetClassSelector({
    classesByLevel,
    selectedIds,
    onToggle,
    onSelectAll,
    onReset,
    droppedClasses = [],
    label = 'Kelas Target',
    helperText,
    showSelectAll = true,
    partialWarning,
}: TargetClassSelectorProps) {
    return (
        <div>
            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">
                {label} ({selectedIds.length} terpilih)
            </label>
            {helperText && (
                <p className="mb-2 text-xs text-text-secondary">{helperText}</p>
            )}
            {partialWarning && partialWarning.taught < partialWarning.total && (
                <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                    Anda mengajar {partialWarning.taught} dari {partialWarning.total} kelas di {partialWarning.typeLabel} ini. {partialWarning.typeLabel} dibuat dengan kelas yang Anda ajar saja.
                </p>
            )}
            {droppedClasses.length > 0 && (
                <div className="mb-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
                    <span className="font-bold">{droppedClasses.length} kelas dari ujian sumber tidak ikut disalin</span> karena bukan kelas tahun ajaran aktif:{' '}
                    <span className="font-medium">{droppedClasses.map(c => c.name).join(', ')}</span>. Pilih kelas pengganti di bawah bila diperlukan.
                </div>
            )}
            {showSelectAll && (onSelectAll || onReset) && (
                <div className="flex flex-wrap gap-2 mb-3">
                    {onSelectAll && (
                        <button
                            type="button"
                            onClick={onSelectAll}
                            className="text-xs px-3 py-1.5 bg-primary/10 text-primary font-bold rounded-lg hover:bg-primary/20 transition-colors"
                        >
                            Pilih Semua
                        </button>
                    )}
                    {onReset && (
                        <button
                            type="button"
                            onClick={onReset}
                            className="text-xs px-3 py-1.5 bg-red-500/10 text-red-500 font-bold rounded-lg hover:bg-red-500/20 transition-colors"
                        >
                            Reset
                        </button>
                    )}
                </div>
            )}
            <div className="max-h-48 overflow-y-auto space-y-1 pr-2 custom-scrollbar">
                {Object.entries(classesByLevel).map(([level, levelClasses]) => (
                    <div key={level}>
                        <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1 mt-2">{level}</p>
                        <div className="grid grid-cols-3 gap-1.5">
                            {levelClasses.map(c => {
                                const selected = selectedIds.includes(c.id)
                                return (
                                    <button
                                        type="button"
                                        key={c.id}
                                        onClick={() => onToggle(c.id)}
                                        className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${selected
                                            ? 'bg-primary text-white shadow-sm'
                                            : 'bg-secondary/5 text-text-secondary hover:bg-secondary/10 border border-secondary/10'
                                            }`}
                                    >
                                        {c.name}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
