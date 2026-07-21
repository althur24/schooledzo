'use client'

import { useMemo, useState } from 'react'
import { X, ChevronDown } from 'lucide-react'

export interface ChipAssignment {
    id: string
    subject: { id: string; name: string } | null
    class: { id?: string; name: string } | null
}

interface ClassChipsSelectorProps {
    assignments: ChipAssignment[]
    selectedIds: string[]
    onChange: (ids: string[]) => void
    disabled?: boolean
    defaultSubjectId?: string
    mode?: 'multi' | 'single'
}

/**
 * Two-step class picker:
 * 1. Pick a subject → its classes appear
 * 2. Click a class → it shows up as a small chip with an X to remove
 */
export default function ClassChipsSelector({
    assignments,
    selectedIds,
    onChange,
    disabled = false,
    defaultSubjectId,
    mode = 'multi'
}: ClassChipsSelectorProps) {
    const [subjectId, setSubjectId] = useState(defaultSubjectId || '')

    // Unique subjects from the assignments
    const subjects = useMemo(() => {
        const map = new Map<string, string>()
        assignments.forEach(a => {
            if (a.subject?.id) map.set(a.subject.id, a.subject.name)
        })
        return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    }, [assignments])

    // Classes of the chosen subject
    const classesForSubject = useMemo(() => {
        return assignments
            .filter(a => a.subject?.id === subjectId)
            .sort((a, b) => (a.class?.name || '').localeCompare(b.class?.name || ''))
    }, [assignments, subjectId])

    const selectedAssignments = useMemo(() => {
        return assignments.filter(a => selectedIds.includes(a.id))
    }, [assignments, selectedIds])

    const handleSubjectChange = (newSubjectId: string) => {
        setSubjectId(newSubjectId)
        // Selected classes belong to the previous subject — clear them
        if (selectedIds.length > 0) onChange([])
    }

    const addClass = (taId: string) => {
        if (!taId || selectedIds.includes(taId)) return
        if (mode === 'single') {
            onChange([taId])
            return
        }
        onChange([...selectedIds, taId])
    }

    const removeClass = (taId: string) => {
        onChange(selectedIds.filter(id => id !== taId))
    }

    const selectAllClasses = () => {
        const allIds = classesForSubject.map(a => a.id)
        onChange([...new Set([...selectedIds, ...allIds])])
    }

    const selectClassName = 'w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none disabled:opacity-60 disabled:cursor-not-allowed'

    return (
        <div className="space-y-3">
            {/* Step 1: Subject */}
            <div className="relative">
                <select
                    value={subjectId}
                    onChange={(e) => handleSubjectChange(e.target.value)}
                    disabled={disabled}
                    className={selectClassName}
                >
                    <option value="">Pilih Mata Pelajaran...</option>
                    {subjects.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">
                    <ChevronDown size={20} />
                </div>
            </div>

            {/* Step 2: Class (appears after subject is chosen) */}
            {subjectId && (
                <div className="relative">
                    <select
                        value=""
                        onChange={(e) => addClass(e.target.value)}
                        disabled={disabled}
                        className={selectClassName}
                    >
                        <option value="">Klik untuk memilih kelas...</option>
                        {classesForSubject.map(ta => (
                            <option key={ta.id} value={ta.id} disabled={selectedIds.includes(ta.id)}>
                                {ta.class?.name || 'Unknown'}{selectedIds.includes(ta.id) ? ' ✓ (sudah dipilih)' : ''}
                            </option>
                        ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">
                        <ChevronDown size={20} />
                    </div>
                </div>
            )}

            {/* Select all shortcut */}
            {mode === 'multi' && subjectId && classesForSubject.length > 1 && (
                <button
                    type="button"
                    onClick={selectAllClasses}
                    disabled={disabled}
                    className="text-xs font-bold text-primary hover:underline disabled:opacity-50"
                >
                    Pilih semua {classesForSubject.length} kelas
                </button>
            )}

            {/* Selected chips */}
            {selectedAssignments.length > 0 && (
                <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                        {selectedAssignments.map(ta => (
                            <span
                                key={ta.id}
                                className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 bg-primary/10 border border-primary/30 text-primary rounded-full text-xs font-bold shadow-sm hover:shadow-md transition-shadow"
                            >
                                {ta.class?.name || 'Unknown'}
                                <button
                                    type="button"
                                    onClick={() => removeClass(ta.id)}
                                    disabled={disabled}
                                    className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors disabled:opacity-50"
                                    title="Batalkan pilihan kelas ini"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                    <p className="text-xs text-text-secondary">
                        ✅ <span className="font-bold text-primary">{selectedIds.length}</span> kelas dipilih — akan dibagikan ke semua kelas ini
                    </p>
                </div>
            )}
        </div>
    )
}
