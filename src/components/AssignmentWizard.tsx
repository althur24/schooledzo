'use client'

import { useState, useEffect } from 'react'
import { Modal, Button } from '@/components/ui'
import { Stepper } from '@/components/ui/Stepper'
import { User, BookOpen, School, Search, AlertCircle, Check } from 'lucide-react'

interface Teacher {
    id: string
    nip: string | null
    user: { id: string; username: string; full_name: string | null }
}

interface Subject {
    id: string
    name: string
}

interface Class {
    id: string
    name: string
    school_level: 'SMP' | 'SMA' | null
    grade_level: number | null
}

interface ExistingAssignment {
    teacher_id: string
    subject_id: string
    class_id: string
    teacher_name?: string
}

interface AssignmentWizardProps {
    open: boolean
    onClose: () => void
    onSuccess: () => void
    teachers: Teacher[]
    subjects: Subject[]
    classes: Class[]
    existingAssignments: ExistingAssignment[]
    academicYearId: string
    editMode?: {
        teacherId: string
        subjectId: string
        selectedClassIds: string[]
    }
}

export function AssignmentWizard({
    open,
    onClose,
    onSuccess,
    teachers,
    subjects,
    classes,
    existingAssignments,
    academicYearId,
    editMode
}: AssignmentWizardProps) {
    const [step, setStep] = useState(0)
    const [selectedTeacherId, setSelectedTeacherId] = useState('')
    const [selectedSubjectId, setSelectedSubjectId] = useState('')
    const [selectedClassIds, setSelectedClassIds] = useState<string[]>([])
    const [teacherSearch, setTeacherSearch] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [showSuccess, setShowSuccess] = useState(false)
    const [savedCount, setSavedCount] = useState(0)

    // Initialize with edit mode data
    useEffect(() => {
        if (editMode) {
            setSelectedTeacherId(editMode.teacherId)
            setSelectedSubjectId(editMode.subjectId)
            setSelectedClassIds(editMode.selectedClassIds)
            // If subjectId is empty, this is just pre-selecting teacher (start at step 1)
            // If subjectId is provided, this is full edit mode (start at step 2)
            if (editMode.subjectId) {
                setStep(2) // Full edit mode - go to class selection
            } else {
                setStep(1) // Pre-select teacher - go to subject selection
            }
        } else {
            setStep(0)
            setSelectedTeacherId('')
            setSelectedSubjectId('')
            setSelectedClassIds([])
        }
    }, [editMode, open])

    // Reset when closed
    useEffect(() => {
        if (!open) {
            setStep(0)
            setSelectedTeacherId('')
            setSelectedSubjectId('')
            setSelectedClassIds([])
            setTeacherSearch('')
            setError('')
            setShowSuccess(false)
            setSavedCount(0)
        }
    }, [open])

    const steps = [
        { label: 'Pilih Guru', icon: <User className="w-4 h-4" /> },
        { label: 'Pilih Mapel', icon: <BookOpen className="w-4 h-4" /> },
        { label: 'Pilih Kelas', icon: <School className="w-4 h-4" /> }
    ]

    // Filter teachers by search
    const filteredTeachers = teachers.filter(t => {
        const name = t.user.full_name || t.user.username
        return name.toLowerCase().includes(teacherSearch.toLowerCase())
    })

    // Get teacher's existing assignments count
    const getTeacherAssignmentCount = (teacherId: string) => {
        return existingAssignments.filter(a => a.teacher_id === teacherId).length
    }

    // Get classes with conflict info
    const getClassConflictInfo = (classId: string) => {
        const conflict = existingAssignments.find(
            a => a.class_id === classId &&
                a.subject_id === selectedSubjectId &&
                a.teacher_id !== selectedTeacherId
        )
        return conflict
    }

    // Check if this teacher already teaches this subject
    const teacherHasSubject = (subjectId: string) => {
        return existingAssignments.some(
            a => a.teacher_id === selectedTeacherId && a.subject_id === subjectId
        )
    }

    // Get classes for the selected teacher+subject
    const getCurrentTeacherClassesForSubject = () => {
        return existingAssignments
            .filter(a => a.teacher_id === selectedTeacherId && a.subject_id === selectedSubjectId)
            .map(a => a.class_id)
    }

    // Group classes by school level (classes without a level go to "Lainnya")
    const smpClasses = classes.filter(c => c.school_level === 'SMP').sort((a, b) => a.name.localeCompare(b.name))
    const smaClasses = classes.filter(c => c.school_level === 'SMA').sort((a, b) => a.name.localeCompare(b.name))
    const otherClasses = classes.filter(c => c.school_level !== 'SMP' && c.school_level !== 'SMA').sort((a, b) => a.name.localeCompare(b.name))

    const makeToggleAll = (group: Class[]) => () => {
        const ids = group.map(c => c.id)
        const allSelected = ids.every(id => selectedClassIds.includes(id))
        if (allSelected) {
            setSelectedClassIds(selectedClassIds.filter(id => !ids.includes(id)))
        } else {
            setSelectedClassIds([...new Set([...selectedClassIds, ...ids])])
        }
    }

    const toggleClass = (classId: string) => {
        if (selectedClassIds.includes(classId)) {
            setSelectedClassIds(selectedClassIds.filter(id => id !== classId))
        } else {
            setSelectedClassIds([...selectedClassIds, classId])
        }
    }

    const handleSubmit = async () => {
        if (selectedClassIds.length === 0) {
            setError('Pilih minimal 1 kelas')
            return
        }

        setSaving(true)
        setError('')

        try {
            // Create new assignments FIRST (API skips ones that already exist).
            // Old assignments are only deleted AFTER this succeeds, so a failed
            // save never wipes the teacher's existing assignments.
            const res = await fetch('/api/teaching-assignments/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    teacher_id: selectedTeacherId,
                    subject_id: selectedSubjectId,
                    academic_year_id: academicYearId,
                    class_ids: selectedClassIds
                })
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Gagal menyimpan')
            }

            // In edit mode, remove assignments for classes that were un-checked
            if (editMode?.subjectId) {
                const listRes = await fetch(`/api/teaching-assignments?academic_year_id=${academicYearId}`)
                const allAssignments = await listRes.json()
                const staleIds = (Array.isArray(allAssignments) ? allAssignments : [])
                    .filter((a: any) =>
                        a.teacher_id === selectedTeacherId &&
                        a.subject_id === selectedSubjectId &&
                        !selectedClassIds.includes(a.class_id)
                    )
                    .map((a: any) => a.id)

                if (staleIds.length > 0) {
                    const delRes = await fetch('/api/teaching-assignments/bulk', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ assignment_ids: staleIds })
                    })
                    if (!delRes.ok) {
                        const delData = await delRes.json().catch(() => ({}))
                        throw new Error(delData.error || 'Gagal menghapus kelas yang tidak dipilih')
                    }
                }
            }

            // Show success screen
            setSavedCount(data.created || selectedClassIds.length)
            setShowSuccess(true)
            onSuccess() // Refresh parent data
        } catch (err: any) {
            setError(err.message || 'Terjadi kesalahan')
        } finally {
            setSaving(false)
        }
    }

    // Add more subjects for the same teacher
    const handleAddMoreSubjects = () => {
        setShowSuccess(false)
        setSelectedSubjectId('')
        setSelectedClassIds([])
        setStep(1) // Go back to subject selection
    }

    // Close and finish
    const handleFinish = () => {
        onClose()
    }

    const selectedTeacher = teachers.find(t => t.id === selectedTeacherId)
    const selectedSubject = subjects.find(s => s.id === selectedSubjectId)

    // Render one class group (SMP / SMA / Lainnya). Returns null for empty groups.
    const renderClassGroup = (title: string, group: Class[], accent: 'blue' | 'green' | 'slate') => {
        if (group.length === 0) return null
        const allSelected = group.every(c => selectedClassIds.includes(c.id))
        const styles = {
            blue: {
                label: 'text-blue-600 dark:text-blue-400',
                selected: 'bg-blue-500/10 border-blue-500 text-blue-700 dark:text-blue-400',
                checkbox: 'bg-blue-500 border-blue-500'
            },
            green: {
                label: 'text-green-600 dark:text-green-400',
                selected: 'bg-green-500/10 border-green-500 text-green-700 dark:text-green-400',
                checkbox: 'bg-green-500 border-green-500'
            },
            slate: {
                label: 'text-slate-600 dark:text-slate-400',
                selected: 'bg-slate-500/10 border-slate-500 text-slate-700 dark:text-slate-300',
                checkbox: 'bg-slate-500 border-slate-500'
            }
        }[accent]

        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <span className={`text-sm font-bold ${styles.label}`}>{title}</span>
                    <button
                        type="button"
                        onClick={makeToggleAll(group)}
                        className="text-xs text-primary hover:underline"
                    >
                        {allSelected ? 'Hapus Semua' : 'Pilih Semua'}
                    </button>
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                    {group.map((cls) => {
                        const conflict = getClassConflictInfo(cls.id)
                        const isSelected = selectedClassIds.includes(cls.id)

                        return (
                            <button
                                key={cls.id}
                                onClick={() => toggleClass(cls.id)}
                                className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left transition-all ${isSelected
                                    ? styles.selected
                                    : conflict
                                        ? 'bg-amber-500/10 border-amber-500/30'
                                        : 'bg-secondary/5 border-secondary/20 hover:bg-secondary/10'
                                    }`}
                            >
                                <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? `${styles.checkbox} text-white` : 'border-secondary/40'
                                    }`}>
                                    {isSelected && <Check className="w-3 h-3" />}
                                </div>
                                <div className="flex-1">
                                    <span className="text-sm font-medium text-text-main dark:text-white">{cls.name}</span>
                                    {conflict && (
                                        <span className="text-xs text-amber-600 ml-1">
                                            ({conflict.teacher_name || 'Guru lain'})
                                        </span>
                                    )}
                                </div>
                            </button>
                        )
                    })}
                </div>
            </div>
        )
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={showSuccess ? '✅ Berhasil!' : editMode?.subjectId ? '✏️ Edit Penugasan' : '➕ Tambah Penugasan Baru'}
            maxWidth="lg"
        >
            <div className="space-y-6">
                {/* Success Screen */}
                {showSuccess ? (
                    <div className="text-center py-6">
                        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Check className="w-10 h-10 text-green-500" />
                        </div>
                        <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">
                            Penugasan Berhasil Disimpan!
                        </h3>
                        <p className="text-text-secondary dark:text-zinc-400 mb-2">
                            {savedCount} kelas untuk mapel <span className="font-bold text-primary">{selectedSubject?.name}</span>
                        </p>
                        <p className="text-sm text-text-secondary dark:text-zinc-500 mb-6">
                            Guru: {selectedTeacher?.user.full_name || selectedTeacher?.user.username}
                        </p>

                        <div className="flex gap-3 justify-center">
                            <Button
                                variant="secondary"
                                onClick={handleFinish}
                            >
                                Selesai
                            </Button>
                            <Button
                                onClick={handleAddMoreSubjects}
                                icon={<BookOpen className="w-4 h-4" />}
                            >
                                Tambah Mapel Lagi
                            </Button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Stepper */}
                        <Stepper steps={steps} currentStep={step} />

                        {/* Error */}
                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 text-sm font-medium flex items-center gap-2">
                                <AlertCircle className="w-4 h-4" />
                                {error}
                            </div>
                        )}

                        {/* Step 1: Pilih Guru */}
                        {step === 0 && (
                            <div className="space-y-4">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
                                    <input
                                        type="text"
                                        value={teacherSearch}
                                        onChange={(e) => setTeacherSearch(e.target.value)}
                                        placeholder="Cari guru..."
                                        className="w-full pl-10 pr-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                    />
                                </div>

                                <div className="max-h-64 overflow-y-auto space-y-2">
                                    {filteredTeachers.map((teacher) => {
                                        const assignmentCount = getTeacherAssignmentCount(teacher.id)
                                        const isSelected = selectedTeacherId === teacher.id

                                        return (
                                            <button
                                                key={teacher.id}
                                                onClick={() => setSelectedTeacherId(teacher.id)}
                                                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${isSelected
                                                    ? 'bg-primary/10 border-primary text-primary'
                                                    : 'bg-secondary/5 border-secondary/20 hover:bg-secondary/10'
                                                    }`}
                                            >
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${isSelected ? 'bg-primary text-white' : 'bg-secondary/20 text-text-main dark:text-white'
                                                    }`}>
                                                    {(teacher.user.full_name || teacher.user.username)?.[0]?.toUpperCase() || '?'}
                                                </div>
                                                <div className="flex-1 text-left">
                                                    <div className="font-bold text-text-main dark:text-white">
                                                        {teacher.user.full_name || teacher.user.username}
                                                    </div>
                                                    <div className="text-xs text-text-secondary">
                                                        {assignmentCount > 0
                                                            ? `${assignmentCount} kelas diassign`
                                                            : '⚠️ Belum ada penugasan'
                                                        }
                                                    </div>
                                                </div>
                                                {isSelected && <Check className="w-5 h-5 text-primary" />}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Step 2: Pilih Mapel */}
                        {step === 1 && (
                            <div className="space-y-4">
                                <div className="text-sm text-text-secondary mb-2">
                                    Guru: <span className="font-bold text-text-main dark:text-white">{selectedTeacher?.user.full_name || selectedTeacher?.user.username}</span>
                                </div>

                                <div className="max-h-64 overflow-y-auto space-y-2">
                                    {subjects.map((subject) => {
                                        const hasSubject = teacherHasSubject(subject.id)
                                        const isSelected = selectedSubjectId === subject.id

                                        return (
                                            <button
                                                key={subject.id}
                                                onClick={() => setSelectedSubjectId(subject.id)}
                                                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${isSelected
                                                    ? 'bg-primary/10 border-primary text-primary'
                                                    : 'bg-secondary/5 border-secondary/20 hover:bg-secondary/10'
                                                    }`}
                                            >
                                                <BookOpen className={`w-5 h-5 ${isSelected ? 'text-primary' : 'text-text-secondary'}`} />
                                                <div className="flex-1 text-left">
                                                    <div className="font-bold text-text-main dark:text-white">{subject.name}</div>
                                                    {hasSubject && (
                                                        <div className="text-xs text-amber-600">
                                                            ✓ Sudah mengajar mapel ini
                                                        </div>
                                                    )}
                                                </div>
                                                {isSelected && <Check className="w-5 h-5 text-primary" />}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Step 3: Pilih Kelas */}
                        {step === 2 && (
                            <div className="space-y-4">
                                <div className="text-sm text-text-secondary space-y-1">
                                    <div>Guru: <span className="font-bold text-text-main dark:text-white">{selectedTeacher?.user.full_name || selectedTeacher?.user.username}</span></div>
                                    <div>Mapel: <span className="font-bold text-text-main dark:text-white">{selectedSubject?.name}</span></div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    {renderClassGroup('📘 SMP', smpClasses, 'blue')}
                                    {renderClassGroup('📗 SMA', smaClasses, 'green')}
                                    {renderClassGroup('📙 Lainnya', otherClasses, 'slate')}
                                </div>

                                <div className="text-sm text-text-secondary">
                                    ✅ <span className="font-bold text-primary">{selectedClassIds.length}</span> kelas dipilih
                                </div>
                            </div>
                        )}

                        {/* Navigation */}
                        <div className="flex gap-3 pt-4 border-t border-secondary/10">
                            {step > 0 && !(editMode?.subjectId) && (
                                <Button type="button" variant="secondary" onClick={() => setStep(step - 1)}>
                                    ← Kembali
                                </Button>
                            )}
                            <div className="flex-1" />
                            <Button type="button" variant="secondary" onClick={onClose}>
                                Batal
                            </Button>
                            {step < 2 ? (
                                <Button
                                    onClick={() => setStep(step + 1)}
                                    disabled={
                                        (step === 0 && !selectedTeacherId) ||
                                        (step === 1 && !selectedSubjectId)
                                    }
                                >
                                    Lanjut →
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleSubmit}
                                    loading={saving}
                                    disabled={selectedClassIds.length === 0}
                                >
                                    💾 Simpan {selectedClassIds.length} Kelas
                                </Button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </Modal>
    )
}

export default AssignmentWizard
