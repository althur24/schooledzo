import React, { useMemo } from 'react'
import { CheckSquare, Square, ChevronDown, AlertTriangle } from 'lucide-react'

export interface TeachingAssignment {
    id: string
    subject: { id: string; name: string }
    class: { id: string; name: string }
}

interface MultiClassSelectorProps {
    teachingAssignments: TeachingAssignment[]
    selectedIds: string[]
    onChange: (ids: string[]) => void
    mode: 'single' | 'multi'
    disabled?: boolean
    defaultSubjectLock?: string
}

export default function MultiClassSelector({
    teachingAssignments,
    selectedIds,
    onChange,
    mode,
    disabled = false,
    defaultSubjectLock
}: MultiClassSelectorProps) {
    // Group assignments by subject
    const groupedAssignments = useMemo(() => {
        return teachingAssignments.reduce((acc, ta) => {
            const subjectName = ta.subject?.name || 'Lainnya'
            if (!acc[subjectName]) acc[subjectName] = []
            acc[subjectName].push(ta)
            return acc
        }, {} as Record<string, TeachingAssignment[]>)
    }, [teachingAssignments])

    // Determine which subject is currently "locked" (the one with selected items or default lock)
    const lockedSubjectName = useMemo(() => {
        if (selectedIds.length > 0) {
            for (const [subjectName, assignments] of Object.entries(groupedAssignments)) {
                if (assignments.some(a => selectedIds.includes(a.id))) {
                    return subjectName
                }
            }
        }
        
        if (defaultSubjectLock) {
            return defaultSubjectLock
        }
        
        return null
    }, [selectedIds, groupedAssignments, defaultSubjectLock])

    const handleSelectAll = (subjectName: string) => {
        if (disabled || mode === 'single') return
        // Block if a different subject is already locked
        if (lockedSubjectName && lockedSubjectName !== subjectName) return
        const assignments = groupedAssignments[subjectName] || []
        const assignmentIds = assignments.map(a => a.id)
        
        // Check if all in this group are already selected
        const allSelected = assignmentIds.every(id => selectedIds.includes(id))
        
        if (allSelected) {
            // Deselect all in this group
            onChange(selectedIds.filter(id => !assignmentIds.includes(id)))
        } else {
            // Select all in this group (add missing ones)
            const newSelection = [...selectedIds]
            assignmentIds.forEach(id => {
                if (!newSelection.includes(id)) newSelection.push(id)
            })
            onChange(newSelection)
        }
    }

    const toggleSelection = (id: string, subjectName: string) => {
        if (disabled) return
        if (mode === 'single') {
            onChange([id])
        } else {
            // Block if a different subject is locked
            if (lockedSubjectName && lockedSubjectName !== subjectName && !selectedIds.includes(id)) return
            if (selectedIds.includes(id)) {
                onChange(selectedIds.filter(selectedId => selectedId !== id))
            } else {
                onChange([...selectedIds, id])
            }
        }
    }

    // Fallback for single mode or when empty
    if (teachingAssignments.length === 0 || mode === 'single') {
        return (
            <div className="relative">
                <select
                    value={selectedIds[0] || ''}
                    onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
                    className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none disabled:opacity-60 disabled:cursor-not-allowed"
                    disabled={disabled || teachingAssignments.length === 0}
                >
                    <option value="">-- Pilih Kelas & Mapel --</option>
                    {teachingAssignments.map((ta) => (
                        <option key={ta.id} value={ta.id}>
                            {ta.class?.name || 'Unknown Class'} - {ta.subject?.name || 'Unknown Subject'}
                        </option>
                    ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">
                    <ChevronDown size={20} />
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {Object.entries(groupedAssignments).map(([subjectName, assignments]) => {
                const groupIds = assignments.map(a => a.id)
                const isAllSelected = groupIds.every(id => selectedIds.includes(id))
                const selectedInGroupCount = groupIds.filter(id => selectedIds.includes(id)).length
                const isLockedOut = lockedSubjectName !== null && lockedSubjectName !== subjectName

                return (
                    <div key={subjectName} className={`bg-secondary/5 border rounded-xl overflow-hidden transition-opacity ${isLockedOut ? 'border-secondary/10 opacity-60' : 'border-secondary/20'}`}>
                        {/* Group Header */}
                        <div className="px-4 py-3 bg-secondary/10 flex items-center justify-between border-b border-secondary/20">
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-text-main dark:text-white">{subjectName}</span>
                                {selectedInGroupCount > 0 && (
                                    <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-bold">
                                        {selectedInGroupCount} dipilih
                                    </span>
                                )}
                                {isLockedOut && (
                                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-xs font-medium">
                                        <AlertTriangle className="w-3 h-3" />
                                        Mapel lain dipilih
                                    </span>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => handleSelectAll(subjectName)}
                                disabled={disabled || isLockedOut}
                                className="text-xs font-semibold text-primary hover:text-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isAllSelected ? 'Batal Pilih Semua' : 'Pilih Semua'}
                            </button>
                        </div>
                        
                        {/* Group Items */}
                        <div className="p-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {assignments.map(ta => {
                                const isSelected = selectedIds.includes(ta.id)
                                return (
                                    <div
                                        key={ta.id}
                                        onClick={() => toggleSelection(ta.id, subjectName)}
                                        className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                            isSelected 
                                                ? 'bg-primary/5 border-primary dark:bg-primary/20 cursor-pointer' 
                                                : isLockedOut
                                                    ? 'bg-secondary/5 border-secondary/10 cursor-not-allowed'
                                                    : 'bg-white dark:bg-surface-dark border-secondary/20 hover:border-primary/50 cursor-pointer'
                                        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                                    >
                                        <div className="flex-shrink-0">
                                            {isSelected ? (
                                                <CheckSquare className="w-5 h-5 text-primary" />
                                            ) : (
                                                <Square className={`w-5 h-5 ${isLockedOut ? 'text-secondary/30' : 'text-secondary/50'}`} />
                                            )}
                                        </div>
                                        <div className={`font-medium text-sm ${isLockedOut ? 'text-text-secondary' : 'text-text-main dark:text-white'}`}>
                                            Kelas {ta.class?.name || 'Unknown'}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
