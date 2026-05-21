import React, { useMemo } from 'react'
import { CheckSquare, Square, ChevronDown } from 'lucide-react'

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
}

export default function MultiClassSelector({
    teachingAssignments,
    selectedIds,
    onChange,
    mode,
    disabled = false
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

    const handleSelectAll = (subjectName: string) => {
        if (disabled || mode === 'single') return
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

    const toggleSelection = (id: string) => {
        if (disabled) return
        if (mode === 'single') {
            onChange([id])
        } else {
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

                return (
                    <div key={subjectName} className="bg-secondary/5 border border-secondary/20 rounded-xl overflow-hidden">
                        {/* Group Header */}
                        <div className="px-4 py-3 bg-secondary/10 flex items-center justify-between border-b border-secondary/20">
                            <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-text-main dark:text-white">{subjectName}</span>
                                {selectedInGroupCount > 0 && (
                                    <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-bold">
                                        {selectedInGroupCount} dipilih
                                    </span>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => handleSelectAll(subjectName)}
                                disabled={disabled}
                                className="text-xs font-semibold text-primary hover:text-primary-dark transition-colors disabled:opacity-50"
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
                                        onClick={() => toggleSelection(ta.id)}
                                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                            isSelected 
                                                ? 'bg-primary/5 border-primary dark:bg-primary/20' 
                                                : 'bg-white dark:bg-surface-dark border-secondary/20 hover:border-primary/50'
                                        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                                    >
                                        <div className="flex-shrink-0">
                                            {isSelected ? (
                                                <CheckSquare className="w-5 h-5 text-primary" />
                                            ) : (
                                                <Square className="w-5 h-5 text-secondary/50" />
                                            )}
                                        </div>
                                        <div className="font-medium text-sm text-text-main dark:text-white">
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
