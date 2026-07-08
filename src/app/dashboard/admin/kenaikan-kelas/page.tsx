'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageHeader, Modal, Button, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import { AcademicYear, Class, SchoolLevel } from '@/lib/types'
import {
    ArrowRight, People as Users, TickSquare as CheckCircle, CloseSquare as XCircle,
    Danger as AlertTriangle, Document as GraduationCap, ArrowUpSquare as ArrowUpRight,
    ChevronDown, ChevronRight, Search, Download, ShieldFail as ShieldAlert,
    Calendar, Filter as FilterIcon, TimeCircle as History
} from 'react-iconly'
import { Loader2, UserCheck, UserX, ChevronUp } from 'lucide-react'

interface Student {
    id: string
    nis: string | null
    class_id: string | null
    angkatan: string | null
    school_level: SchoolLevel | null
    status: string
    user: {
        id: string
        username: string
        full_name: string | null
    }
    class: { id: string; name: string; grade_level: number | null; school_level: SchoolLevel | null; academic_year_id?: string } | null
    // Enrollment info from the source year
    enrollment_status?: string
    enrollment_id?: string
    enrollment_ended_at?: string | null
    enrollment_notes?: string | null
}

type StudentDecision = 'PROMOTE' | 'SKIP' | 'RETAIN'

interface ClassGroup {
    sourceClass: Class
    students: Student[]
    targetClassId: string
    targetClassName: string
    action: 'PROMOTE' | 'GRADUATE' | 'TRANSITION'
    excludedStudents: Set<string>   // SKIP — left pending, NOT processed this run
    retainedStudents: Set<string>   // RETAIN — tinggal kelas (repeat same grade)
    studentTargetOverrides: Map<string, string> // studentId -> targetClassId
    isCompleted: boolean
    completedCount: number
}

type FilterMode = 'ALL' | 'PENDING' | 'DONE'

/**
 * Extract the parallel-class "section" from a class name by stripping the leading
 * grade marker. The remainder identifies the parallel group across grades, so a
 * class can be matched to its next-grade peer during promotion.
 *   "X IPA 1" -> "IPA 1",  "XI IPA 1" -> "IPA 1"   (match — numeric/program section)
 *   "X-A"     -> "A",      "XI-A"     -> "A"       (match — letter section)
 *   "VII-1"   -> "1",      "VIII-1"   -> "1"       (match — numeric section)
 * Handles roman grades (VII/VIII/IX/X/XI/XII) and numeric (7-12), an optional
 * "Kelas" prefix, and the separator after it (-, ., space). Returns '' when the
 * name is only a grade (no section) — callers then treat all same-grade candidates.
 */
function classSectionOf(name?: string | null): string {
    if (!name) return ''
    return String(name).trim()
        .replace(/^\s*Kelas\s+/i, '')
        .replace(/^\s*(?:XII|XI|IX|VIII|VII|X|[7-9]|1[0-2])\s*[-.]?\s*/i, '')
        .trim()
        .toUpperCase()
}

export default function KenaikanKelasPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [processing, setProcessing] = useState(false)
    const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
    const [classes, setClasses] = useState<Class[]>([])
    const [students, setStudents] = useState<Student[]>([])
    const [classGroups, setClassGroups] = useState<ClassGroup[]>([])
    const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())

    // Source = COMPLETED year, Target = ACTIVE year
    const [sourceYear, setSourceYear] = useState<AcademicYear | null>(null)
    const [targetYear, setTargetYear] = useState<AcademicYear | null>(null)

    // Expanded accordion state
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

    // Search & Filter  
    const [searchQuery, setSearchQuery] = useState('')
    const [filterMode, setFilterMode] = useState<FilterMode>('ALL')

    // History panel
    const [showHistory, setShowHistory] = useState(false)

    // Confirmation modal
    const [showConfirmModal, setShowConfirmModal] = useState(false)

    // Results
    const [showResultModal, setShowResultModal] = useState(false)
    const [results, setResults] = useState<{ success: number; failed: number; errors: string[] }>({ success: 0, failed: 0, errors: [] })

    // Promote retained student
    const [promoteRetainedStudent, setPromoteRetainedStudent] = useState<Student | null>(null)
    const [promoteRetainedClassId, setPromoteRetainedClassId] = useState<string>('')
    const [promotingRetained, setPromotingRetained] = useState(false)

    // Processing progress
    const [processProgress, setProcessProgress] = useState({ current: 0, total: 0 })

    const completedYears = useMemo(() =>
        academicYears
            .filter(y => y.status === 'COMPLETED')
            .sort((a, b) => new Date(b.end_date || b.created_at).getTime() - new Date(a.end_date || a.created_at).getTime()),
        [academicYears]
    )

    const activeYear = useMemo(() =>
        academicYears.find(y => y.is_active || y.status === 'ACTIVE') || null,
        [academicYears]
    )

    // === Stats ===
    const processedStudents = useMemo(() => {
        return students.filter(s =>
            s.enrollment_status === 'PROMOTED' ||
            s.enrollment_status === 'GRADUATED' ||
            s.enrollment_status === 'RETAINED'
        )
    }, [students])

    const pendingStudents = useMemo(() => {
        return students.filter(s => s.enrollment_status === 'ACTIVE')
    }, [students])

    const progressPercent = students.length > 0
        ? Math.round((processedStudents.length / students.length) * 100)
        : 0

    const sourceEqualsTarget = sourceYear?.id === targetYear?.id

    // === Data fetching ===
    const fetchYears = async () => {
        try {
            const [yearsRes, classesRes] = await Promise.all([
                fetch('/api/academic-years'),
                fetch('/api/classes'),
            ])
            const [yearsData, classesData] = await Promise.all([
                yearsRes.json(),
                classesRes.json(),
            ])
            const years: AcademicYear[] = Array.isArray(yearsData) ? yearsData : []
            const classList: Class[] = Array.isArray(classesData) ? classesData : []

            setAcademicYears(years)
            setClasses(classList)

            // Auto-select source and target
            const active = years.find((y: AcademicYear) => y.is_active || y.status === 'ACTIVE')
            setTargetYear(active || null)

            const completed = years
                .filter((y: AcademicYear) => y.status === 'COMPLETED')
                .sort((a: AcademicYear, b: AcademicYear) =>
                    new Date(b.end_date || b.created_at).getTime() - new Date(a.end_date || a.created_at).getTime()
                )
            const lastCompleted = completed[0] || null
            setSourceYear(lastCompleted)

            // If we have a source year, fetch students
            // Pass active year ID directly (don't rely on stale React state)
            if (lastCompleted) {
                await fetchStudents(lastCompleted.id, classList, active?.id)
            }
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchStudents = async (yearId: string, classList?: Class[], overrideTargetYearId?: string) => {
        try {
            const res = await fetch(`/api/students?enrollment_year_id=${yearId}`)
            const data = await res.json()
            const studentList: Student[] = Array.isArray(data) ? data : []
            setStudents(studentList)

            const classListToUse = classList || classes
            // Use overrideTargetYearId if provided (to avoid stale React state)
            const effectiveTargetYearId = overrideTargetYearId || targetYear?.id
            generateClassGroups(classListToUse, studentList, yearId, effectiveTargetYearId)
        } catch (error) {
            console.error('Error fetching students:', error)
        }
    }

    const generateClassGroups = (classList: Class[], studentList: Student[], sourceYearId: string, passedTargetYearId?: string) => {
        // Group students by their enrollment class 
        const classStudentMap = new Map<string, Student[]>()

        for (const student of studentList) {
            const classId = student.class?.id
            if (!classId) continue
            if (!classStudentMap.has(classId)) {
                classStudentMap.set(classId, [])
            }
            classStudentMap.get(classId)!.push(student)
        }

        const groups: ClassGroup[] = []

        // Use passed targetYearId to avoid stale React state
        const effectiveTargetYearId = passedTargetYearId || targetYear?.id || academicYears.find(y => y.is_active || y.status === 'ACTIVE')?.id
        const targetClasses = effectiveTargetYearId
            ? classList.filter(c => c.academic_year_id === effectiveTargetYearId)
            : classList

        for (const [classId, classStudents] of classStudentMap) {
            const cls = classList.find(c => c.id === classId)
            if (!cls || classStudents.length === 0) continue

            // Only show students with ACTIVE enrollment (not yet processed)
            // Already-processed ones go to history
            const pendingInGroup = classStudents.filter(s => s.enrollment_status === 'ACTIVE')
            const processedInGroup = classStudents.filter(s =>
                s.enrollment_status === 'PROMOTED' ||
                s.enrollment_status === 'GRADUATED' ||
                s.enrollment_status === 'RETAINED'
            )

            // Determine target based on grade level (STRICT match — no silent auto-pick)
            let action: 'PROMOTE' | 'GRADUATE' | 'TRANSITION' = 'PROMOTE'
            let targetClassName = ''
            let targetClassId = ''

            const gradeLevel = cls.grade_level || 0
            const schoolLevel = cls.school_level

            if (gradeLevel === 3 && schoolLevel === 'SMA') {
                action = 'GRADUATE'
                targetClassName = 'Lulus (Alumni)'
            } else {
                // PROMOTE (naik 1 jenjang) atau TRANSITION (SMP 3 -> SMA 1)
                action = gradeLevel === 3 && schoolLevel === 'SMP' ? 'TRANSITION' : 'PROMOTE'
                const nextGrade = gradeLevel === 3 && schoolLevel === 'SMP' ? 1 : gradeLevel + 1
                const nextSchool = gradeLevel === 3 && schoolLevel === 'SMP' ? 'SMA' : schoolLevel
                const srcSection = classSectionOf(cls.name)

                // Candidates at the next grade/school level. When the source name has
                // a section, narrow by section equality; when it has none (single class
                // per grade), consider all candidates. Ambiguity (more than one) is NOT
                // resolved by picking the first match — the admin must choose manually.
                const candidates = targetClasses.filter(c =>
                    c.grade_level === nextGrade && c.school_level === nextSchool
                )
                const matches = srcSection !== ''
                    ? candidates.filter(c => classSectionOf(c.name) === srcSection)
                    : candidates

                if (matches.length === 1) {
                    targetClassId = matches[0].id
                    targetClassName = matches[0].name
                } else if (matches.length > 1) {
                    targetClassName = `${matches.length} kelas cocok — pilih manual`
                } else {
                    targetClassName = srcSection
                        ? `Kelas ${nextSchool === 'SMP' ? 'MP' : 'MA'}${nextGrade} ${srcSection} (belum ada)`
                        : `Kelas ${nextSchool === 'SMP' ? 'MP' : 'MA'}${nextGrade} (belum ada)`
                }
            }

            const isCompleted = pendingInGroup.length === 0 && processedInGroup.length > 0

            groups.push({
                sourceClass: cls,
                students: classStudents,
                targetClassId,
                targetClassName,
                action,
                excludedStudents: new Set(),
                retainedStudents: new Set(),
                studentTargetOverrides: new Map(),
                isCompleted,
                completedCount: processedInGroup.length
            })
        }

        groups.sort((a, b) => {
            if (a.sourceClass.school_level !== b.sourceClass.school_level) {
                return a.sourceClass.school_level === 'SMP' ? -1 : 1
            }
            return (a.sourceClass.grade_level || 0) - (b.sourceClass.grade_level || 0)
        })

        setClassGroups(groups)
    }

    useEffect(() => { fetchYears() }, [])

    // Change source year
    const handleSourceYearChange = async (yearId: string) => {
        const year = academicYears.find(y => y.id === yearId)
        if (!year) return
        setSourceYear(year)
        setSelectedGroups(new Set())
        setLoading(true)
        await fetchStudents(yearId)
        setLoading(false)
    }

    // === Helpers ===
    const getTargetOptions = (group: ClassGroup): Class[] => {
        // Only show classes from the target (active) year
        const targetClasses = targetYear
            ? classes.filter(c => c.academic_year_id === targetYear.id)
            : classes
        if (group.action === 'PROMOTE') {
            const nextGrade = (group.sourceClass.grade_level || 0) + 1
            return targetClasses.filter(c =>
                c.school_level === group.sourceClass.school_level && c.grade_level === nextGrade
            )
        } else if (group.action === 'TRANSITION') {
            return targetClasses.filter(c => c.school_level === 'SMA' && c.grade_level === 1)
        }
        return []
    }

    const toggleGroup = (classId: string) => {
        const group = classGroups.find(g => g.sourceClass.id === classId)
        if (group?.isCompleted) return
        const newSelected = new Set(selectedGroups)
        if (newSelected.has(classId)) { newSelected.delete(classId) } else { newSelected.add(classId) }
        setSelectedGroups(newSelected)
    }

    const toggleExpand = (classId: string) => {
        const newExpanded = new Set(expandedGroups)
        if (newExpanded.has(classId)) { newExpanded.delete(classId) } else { newExpanded.add(classId) }
        setExpandedGroups(newExpanded)
    }

    const decisionOf = (g: ClassGroup, studentId: string): StudentDecision => {
        if (g.retainedStudents.has(studentId)) return 'RETAIN'
        if (g.excludedStudents.has(studentId)) return 'SKIP'
        return 'PROMOTE'
    }

    // Set a student's promotion decision. The two sets are kept MUTUALLY EXCLUSIVE:
    // a student is in at most one of excludedStudents (SKIP) / retainedStudents (RETAIN),
    // or in neither (PROMOTE = default).
    const setStudentDecision = (classId: string, studentId: string, decision: StudentDecision) => {
        setClassGroups(prev => prev.map(g => {
            if (g.sourceClass.id !== classId) return g
            const excluded = new Set(g.excludedStudents)
            const retained = new Set(g.retainedStudents)
            excluded.delete(studentId)
            retained.delete(studentId)
            if (decision === 'SKIP') excluded.add(studentId)
            else if (decision === 'RETAIN') retained.add(studentId)
            return { ...g, excludedStudents: excluded, retainedStudents: retained }
        }))
    }

    const updateTargetClass = (classId: string, targetId: string) => {
        const targetClass = classes.find(c => c.id === targetId)
        setClassGroups(prev => prev.map(g => {
            if (g.sourceClass.id !== classId) return g
            // When updating the main group target, we reset all individual overrides
            // to ensure everyone gets the new target unless explicitly overridden again
            return {
                ...g,
                targetClassId: targetId,
                targetClassName: targetClass?.name || g.targetClassName,
                studentTargetOverrides: new Map()
            }
        }))
    }

    const setStudentTargetOverride = (classId: string, studentId: string, targetId: string) => {
        setClassGroups(prev => prev.map(g => {
            if (g.sourceClass.id !== classId) return g
            const newOverrides = new Map(g.studentTargetOverrides)
            if (!targetId || targetId === g.targetClassId) {
                // If set back to default, remove the override
                newOverrides.delete(studentId)
            } else {
                newOverrides.set(studentId, targetId)
            }
            return { ...g, studentTargetOverrides: newOverrides }
        }))
    }

    const selectAll = () => {
        const selectableGroups = classGroups.filter(g => !g.isCompleted && getPendingStudents(g).length > 0)
        if (selectedGroups.size === selectableGroups.length && selectedGroups.size > 0) {
            setSelectedGroups(new Set())
        } else {
            setSelectedGroups(new Set(selectableGroups.map(g => g.sourceClass.id)))
        }
    }

    const getPendingStudents = (group: ClassGroup) =>
        group.students.filter(s => s.enrollment_status === 'ACTIVE')

    const getDoneStudents = (group: ClassGroup) =>
        group.students.filter(s =>
            s.enrollment_status === 'PROMOTED' ||
            s.enrollment_status === 'GRADUATED' ||
            s.enrollment_status === 'RETAINED'
        )

    // === Process ===
    const handleProcessClick = () => {
        if (selectedGroups.size === 0) return
        setShowConfirmModal(true)
    }

    const handleConfirmProcess = async () => {
        setShowConfirmModal(false)
        setProcessing(true)

        // Build a single batch payload. The whole batch is processed in ONE server-side
        // RPC transaction (per-student sub-transactions), so a failure/interruption can
        // never leave students half-processed (unlike the previous per-student loop).
        const targets: {
            student_id: string; to_class_id: string;
            from_academic_year_id?: string; enrollment_status: string; note?: string
        }[] = []
        const graduations: { student_id: string; note?: string }[] = []
        const preflightErrors: string[] = []

        const sourceYearId = sourceYear?.id

        const targetYearId = targetYear?.id
        const targetClasses = targetYearId ? classes.filter(c => c.academic_year_id === targetYearId) : []

        for (const group of classGroups) {
            if (!selectedGroups.has(group.sourceClass.id)) continue
            const studentsToProcess = getPendingStudents(group)

            // Resolve the RETAINED target class (same name/grade/school in the target year)
            // once per group — used for any student explicitly marked "Tinggal Kelas".
            let retainedClassId = ''
            if (studentsToProcess.some(s => group.retainedStudents.has(s.id))) {
                const retainedClass = targetClasses.find(c =>
                    c.name === group.sourceClass.name &&
                    c.grade_level === group.sourceClass.grade_level &&
                    c.school_level === group.sourceClass.school_level
                )
                if (retainedClass) retainedClassId = retainedClass.id
            }

            for (const student of studentsToProcess) {
                // SKIP: left ACTIVE (pending) — NOT processed this run, not counted as done.
                if (group.excludedStudents.has(student.id)) continue

                // RETAIN (Tinggal Kelas): enroll in the same-grade class in the target year.
                if (group.retainedStudents.has(student.id)) {
                    if (retainedClassId) {
                        targets.push({
                            student_id: student.id,
                            to_class_id: retainedClassId,
                            from_academic_year_id: sourceYearId,
                            enrollment_status: 'RETAINED',
                            note: `Tinggal di kelas ${group.sourceClass.name} - ${sourceYear?.name}`
                        })
                    } else {
                        preflightErrors.push(`${student.user.full_name}: Kelas ${group.sourceClass.name} belum ada di tahun ${targetYear?.name}. Buat kelas dulu untuk 'Tinggal Kelas'.`)
                    }
                    continue
                }

                if (group.action === 'GRADUATE') {
                    graduations.push({
                        student_id: student.id,
                        note: `Lulus dari ${group.sourceClass.name} - ${sourceYear?.name}`
                    })
                } else {
                    // PROMOTE / TRANSITION
                    const overrideTargetId = group.studentTargetOverrides.get(student.id)
                    const finalTargetId = overrideTargetId || group.targetClassId
                    if (finalTargetId) {
                        const finalTargetClass = overrideTargetId ? classes.find(c => c.id === finalTargetId) : null
                        const finalTargetName = finalTargetClass?.name || group.targetClassName
                        const actionName = group.action === 'TRANSITION' ? 'Transisi SMA' : 'Naik kelas'
                        targets.push({
                            student_id: student.id,
                            to_class_id: finalTargetId,
                            from_academic_year_id: sourceYearId,
                            enrollment_status: 'PROMOTED',
                            note: `${actionName} dari ${group.sourceClass.name} ke ${finalTargetName} - ${sourceYear?.name}`
                        })
                    } else {
                        preflightErrors.push(`${student.user.full_name}: Target kelas belum dipilih — pilih manual dulu.`)
                    }
                }
            }
        }

        // Pre-flight: if any student lacks a resolvable target, do NOT call the API.
        if (preflightErrors.length > 0) {
            setResults({ success: 0, failed: preflightErrors.length, errors: preflightErrors })
            setShowResultModal(true)
            setProcessing(false)
            return
        }

        const total = targets.length + graduations.length
        setProcessProgress({ current: 0, total })

        try {
            const res = await fetch('/api/batch/promote-students', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targets,
                    graduations,
                    notes: `Kenaikan kelas ${sourceYear?.name || ''} → ${targetYear?.name || ''}`
                })
            })

            let successCount = 0
            let failedCount = 0
            let errorLines: string[] = []

            if (res.ok) {
                const data = await res.json()
                successCount = (data.promoted || 0) + (data.graduated || 0)
                failedCount = data.failed || 0
                errorLines = (data.errors || []).map((e: { student_name?: string; error?: string }) =>
                    `${e.student_name || 'Siswa'}: ${e.error || 'gagal'}`
                )
            } else {
                const errData = await res.json().catch(() => ({}))
                failedCount = total
                errorLines = [errData.error || 'Gagal memproses kenaikan kelas']
            }

            setResults({ success: successCount, failed: failedCount, errors: errorLines })
            setShowResultModal(true)

            // Refresh data from source year
            if (sourceYear) await fetchStudents(sourceYear.id)
            setSelectedGroups(new Set())
        } catch {
            setResults({
                success: 0,
                failed: total,
                errors: ['Terjadi error tidak terduga saat memproses kenaikan kelas']
            })
            setShowResultModal(true)
        } finally {
            setProcessing(false)
            setProcessProgress({ current: 0, total: 0 })
        }
    }

    // === Export CSV ===
    const handleExportCSV = () => {
        const rows: string[][] = [['No', 'Nama Siswa', 'NIS', 'Kelas Asal', 'Kelas Tujuan', 'Aksi', 'Status']]
        let no = 1
        classGroups.forEach(group => {
            group.students.forEach(student => {
                const decision = decisionOf(group, student.id)
                const actionLabel = group.action === 'PROMOTE' ? 'Naik Kelas'
                    : group.action === 'GRADUATE' ? 'Lulus' : 'Transisi SMA'
                const statusLabel = student.enrollment_status === 'PROMOTED' ? 'Sudah Dinaikkan'
                    : student.enrollment_status === 'GRADUATED' ? 'Sudah Lulus'
                        : student.enrollment_status === 'RETAINED' ? 'Sudah Tinggal'
                            : decision === 'SKIP' ? 'Dilewati'
                                : decision === 'RETAIN' ? 'Akan Tinggal Kelas'
                                    : 'Akan Naik Kelas'
                rows.push([
                    String(no++),
                    student.user.full_name || student.user.username,
                    student.nis || '-',
                    group.sourceClass.name,
                    group.targetClassName,
                    actionLabel,
                    statusLabel
                ])
            })
        })
        const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `kenaikan-kelas-${sourceYear?.name || 'report'}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    // === Promote Retained Student ===
    const handlePromoteRetained = async () => {
        if (!promoteRetainedStudent || !promoteRetainedClassId || !targetYear) return
        setPromotingRetained(true)
        try {
            const res = await fetch(`/api/students/${promoteRetainedStudent.id}/promote`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from_academic_year_id: targetYear.id,  // Source = tahun AKTIF (bukan completed)
                    to_class_id: promoteRetainedClassId,
                    to_academic_year_id: targetYear.id,
                    enrollment_status: 'PROMOTED',
                    notes: `Dinaikkan setelah pertimbangan ulang (sebelumnya tinggal kelas)`
                })
            })
            if (res.ok) {
                setPromoteRetainedStudent(null)
                setPromoteRetainedClassId('')
                // Refresh data
                if (sourceYear) await fetchStudents(sourceYear.id)
            } else {
                const err = await res.json()
                alert(`Gagal: ${err.error}`)
            }
        } catch {
            alert('Terjadi error saat memproses')
        } finally {
            setPromotingRetained(false)
        }
    }

    // Get target classes for a retained student (same school_level, higher or equal grade)
    const getRetainedTargetClasses = (student: Student) => {
        if (!targetYear) return []
        // Find the student's current class info from the class groups
        const studentGroup = classGroups.find(g => g.students.some(s => s.id === student.id))
        if (!studentGroup) return []
        const srcClass = studentGroup.sourceClass
        // Show classes in the active year that are same or higher grade, same school level
        return classes.filter(c =>
            c.academic_year_id === targetYear.id &&
            c.school_level === srcClass.school_level &&
            (c.grade_level ?? 0) >= (srcClass.grade_level ?? 0)
        )
    }

    // === Badge helpers ===
    const getActionBadge = (action: 'PROMOTE' | 'GRADUATE' | 'TRANSITION') => {
        switch (action) {
            case 'PROMOTE':
                return (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full text-xs font-bold">
                        <ArrowUpRight set="bold" primaryColor="currentColor" size={12} />
                        Naik Kelas
                    </span>
                )
            case 'GRADUATE':
                return (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-full text-xs font-bold">
                        <GraduationCap set="bold" primaryColor="currentColor" size={12} />
                        Lulus
                    </span>
                )
            case 'TRANSITION':
                return (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-full text-xs font-bold">
                        <ArrowRight set="bold" primaryColor="currentColor" size={16} />
                        Transisi SMA
                    </span>
                )
        }
    }

    const getStudentStatusBadge = (student: Student) => {
        switch (student.enrollment_status) {
            case 'PROMOTED':
                return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full text-[10px] font-bold"><UserCheck className="w-3 h-3" /> Dinaikkan</span>
            case 'GRADUATED':
                return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full text-[10px] font-bold"><GraduationCap set="bold" primaryColor="currentColor" size={10} /> Lulus</span>
            case 'RETAINED':
                return (
                    <span className="inline-flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-full text-[10px] font-bold">
                            <UserX className="w-3 h-3" /> Tinggal
                        </span>
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                setPromoteRetainedStudent(student)
                                setPromoteRetainedClassId('')
                            }}
                            className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-[10px] font-bold hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                            title="Naikkan siswa ini"
                        >
                            <ArrowUpRight set="bold" primaryColor="currentColor" size={10} /> Naikkan
                        </button>
                    </span>
                )
            default:
                return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full text-[10px] font-bold">⏳ Belum</span>
        }
    }

    // === Filtered groups ===
    const filteredGroups = useMemo(() => {
        let groups = classGroups
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            groups = groups.filter(g =>
                g.sourceClass.name.toLowerCase().includes(q) ||
                g.targetClassName.toLowerCase().includes(q)
            )
        }
        if (filterMode === 'PENDING') {
            groups = groups.filter(g => getPendingStudents(g).length > 0)
        } else if (filterMode === 'DONE') {
            groups = groups.filter(g => getDoneStudents(g).length > 0)
        }
        return groups
    }, [classGroups, searchQuery, filterMode])

    const smpGroups = filteredGroups.filter(g => g.sourceClass.school_level === 'SMP')
    const smaGroups = filteredGroups.filter(g => g.sourceClass.school_level === 'SMA')

    const totalSelectedStudents = classGroups
        .filter(g => selectedGroups.has(g.sourceClass.id))
        .reduce((acc, g) => {
            const pending = getPendingStudents(g)
            return acc + pending.length - [...g.excludedStudents].filter(id => pending.some(s => s.id === id)).length
        }, 0)

    const confirmStats = useMemo(() => {
        const groups = classGroups.filter(g => selectedGroups.has(g.sourceClass.id))
        // Students that will be promoted/graduated/transitioned — excludes SKIP and RETAIN.
        const getPromotePending = (g: ClassGroup) => getPendingStudents(g).filter(s =>
            !g.excludedStudents.has(s.id) && !g.retainedStudents.has(s.id)
        )
        const countRetained = (g: ClassGroup) =>
            getPendingStudents(g).filter(s => g.retainedStudents.has(s.id)).length
        const promote = groups.filter(g => g.action === 'PROMOTE').reduce((a, g) => a + getPromotePending(g).length, 0)
        const graduate = groups.filter(g => g.action === 'GRADUATE').reduce((a, g) => a + getPromotePending(g).length, 0)
        const transition = groups.filter(g => g.action === 'TRANSITION').reduce((a, g) => a + getPromotePending(g).length, 0)
        const retained = groups.reduce((a, g) => a + countRetained(g), 0)
        return {
            promote,
            graduate,
            transition,
            retained,
            excluded: groups.reduce((a, g) => {
                const pending = getPendingStudents(g)
                return a + [...g.excludedStudents].filter(id => pending.some(s => s.id === id)).length
            }, 0),
            total: promote + graduate + transition + retained,
            classes: groups.length
        }
    }, [classGroups, selectedGroups])

    // === RENDER ===
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        )
    }

    const renderGroupRow = (group: ClassGroup) => {
        const isSelected = selectedGroups.has(group.sourceClass.id)
        const isExpanded = expandedGroups.has(group.sourceClass.id)
        const pending = getPendingStudents(group)
        const done = getDoneStudents(group)
        const targetOptions = getTargetOptions(group)
        const allDone = pending.length === 0 && done.length > 0

        // Show students based on filter
        const visibleStudents = filterMode === 'DONE' ? done
            : filterMode === 'PENDING' ? pending
                : group.students

        return (
            <div key={group.sourceClass.id} className={`transition-colors ${allDone ? 'opacity-60' : ''}`}>
                {/* Main row */}
                <div
                    className={`p-4 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isSelected ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''} ${allDone ? 'bg-green-50 dark:bg-green-900/10' : ''}`}
                >
                    {/* Checkbox - only if there are pending students */}
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleGroup(group.sourceClass.id)}
                        disabled={allDone}
                        className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500/50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    />

                    {/* Expand toggle */}
                    <button
                        onClick={(e) => { e.stopPropagation(); toggleExpand(group.sourceClass.id) }}
                        className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        {isExpanded
                            ? <ChevronDown set="bold" primaryColor="currentColor" size={16} />
                            : <ChevronRight set="bold" primaryColor="currentColor" size={16} />
                        }
                    </button>

                    {/* Source class info */}
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 items-center">
                        <div className="md:col-span-3">
                            <p className="font-bold text-text-main dark:text-white">{group.sourceClass.name}</p>
                            <p className="text-xs text-text-secondary">
                                <span className="text-red-500 font-medium">{pending.length} belum</span>
                                {done.length > 0 && <span className="text-green-500 ml-1.5">• {done.length} selesai</span>}
                                {group.excludedStudents.size > 0 && (
                                    <span className="text-amber-500 ml-1">({group.excludedStudents.size} dilewati)</span>
                                )}
                                {group.retainedStudents.size > 0 && (
                                    <span className="text-orange-500 ml-1">({group.retainedStudents.size} tinggal)</span>
                                )}
                            </p>
                        </div>

                        {/* Arrow */}
                        <div className="hidden md:flex md:col-span-1 items-center justify-center">
                            <ArrowRight set="bold" primaryColor="currentColor" size={16} />
                        </div>

                        {/* Target class */}
                        <div className="md:col-span-4">
                            {(group.action === 'PROMOTE' || group.action === 'TRANSITION') ? (
                                targetOptions.length > 0 ? (
                                    <div className="relative">
                                        <select
                                            value={group.targetClassId}
                                            onChange={(e) => updateTargetClass(group.sourceClass.id, e.target.value)}
                                            disabled={allDone}
                                            className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 appearance-none disabled:opacity-50"
                                        >
                                            {targetOptions.map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary text-xs">▼</div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col">
                                        <p className="font-medium text-amber-500 text-sm mb-1">{group.targetClassName}</p>
                                        <Link href="/dashboard/admin/kelas" className="text-xs text-primary hover:underline">+ Buat Kelas Baru</Link>
                                    </div>
                                )
                            ) : (
                                <p className="font-medium text-text-main dark:text-white">{group.targetClassName}</p>
                            )}
                        </div>

                        {/* Badge */}
                        <div className="md:col-span-2 flex justify-start md:justify-center">
                            {getActionBadge(group.action)}
                        </div>

                        {/* Status */}
                        <div className="md:col-span-2 flex justify-end">
                            {allDone ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-full text-xs font-bold">
                                    <CheckCircle set="bold" primaryColor="currentColor" size={14} />
                                    Selesai ({done.length})
                                </span>
                            ) : (
                                <span className="text-xs text-text-secondary">{pending.length} menunggu</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Expanded student list */}
                {isExpanded && (
                    <div className="bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-200 dark:border-slate-700">
                        <div className="px-4 py-2 flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
                            <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">Daftar Siswa</span>
                            {pending.length > 0 && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setClassGroups(prev => prev.map(g =>
                                            g.sourceClass.id === group.sourceClass.id
                                                ? { ...g, excludedStudents: new Set(), retainedStudents: new Set() }
                                                : g
                                        ))}
                                        className="text-xs text-primary hover:underline"
                                    >Pilih Semua</button>
                                    <span className="text-xs text-text-secondary">|</span>
                                    <button
                                        onClick={() => setClassGroups(prev => prev.map(g =>
                                            g.sourceClass.id === group.sourceClass.id
                                                ? { ...g, excludedStudents: new Set(pending.map(s => s.id)), retainedStudents: new Set() }
                                                : g
                                        ))}
                                        className="text-xs text-red-500 hover:underline"
                                    >Batalkan Semua</button>
                                </div>
                            )}
                        </div>
                        {visibleStudents.map((student, idx) => {
                            const isPending = student.enrollment_status === 'ACTIVE'
                            const decision = decisionOf(group, student.id)
                            return (
                                <div
                                    key={student.id}
                                    className={`flex items-center gap-3 px-6 py-2.5 hover:bg-secondary/5 transition-colors ${decision === 'SKIP' ? 'opacity-50' : ''}`}
                                >
                                    <span className="text-xs text-text-secondary w-6 text-right">{idx + 1}.</span>
                                    <div className="flex-1 flex items-center justify-between pr-4">
                                        <span className={`text-sm ${decision === 'SKIP' ? 'line-through text-text-secondary' : 'text-text-main dark:text-white'}`}>
                                            {student.user.full_name || student.user.username}
                                        </span>
                                        {isPending && decision === 'PROMOTE' && (group.action === 'PROMOTE' || group.action === 'TRANSITION') && targetOptions.length > 0 && (
                                            <div className="w-48 ml-2">
                                                <select
                                                    value={group.studentTargetOverrides.get(student.id) || ''}
                                                    onChange={(e) => setStudentTargetOverride(group.sourceClass.id, student.id, e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-full px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                                >
                                                    <option value="">(Ikut Kelompok)</option>
                                                    {targetOptions.map(c => (
                                                        <option key={c.id} value={c.id}>{c.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                    <span className="text-xs text-text-secondary">{student.nis || '-'}</span>
                                    {getStudentStatusBadge(student)}
                                    {isPending ? (
                                        <select
                                            value={decision}
                                            onChange={(e) => setStudentDecision(group.sourceClass.id, student.id, e.target.value as StudentDecision)}
                                            onClick={(e) => e.stopPropagation()}
                                            className={`text-xs px-2 py-1 rounded border focus:outline-none focus:ring-1 ${
                                                decision === 'RETAIN'
                                                    ? 'border-orange-300 text-orange-600 bg-orange-50 dark:bg-orange-900/20 focus:ring-orange-400'
                                                    : decision === 'SKIP'
                                                        ? 'border-amber-300 text-amber-600 bg-amber-50 dark:bg-amber-900/20 focus:ring-amber-400'
                                                        : 'border-emerald-300 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 focus:ring-emerald-400'
                                            }`}
                                        >
                                            <option value="PROMOTE">{group.action === 'GRADUATE' ? 'Lulus' : 'Naik Kelas'}</option>
                                            <option value="SKIP">Dilewati</option>
                                            <option value="RETAIN">Tinggal Kelas</option>
                                        </select>
                                    ) : null}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        )
    }

    // Determine page state
    const noCompletedYear = completedYears.length === 0
    const noActiveYear = !activeYear
    const hasData = !noCompletedYear && !noActiveYear

    return (
        <div className="space-y-6">
            <PageHeader
                title="Kenaikan Kelas"
                subtitle="Proses kenaikan kelas, transisi, dan kelulusan siswa"
                backHref="/dashboard/admin"
                icon={<div className="text-emerald-500"><ArrowUpRight set="bold" primaryColor="currentColor" size={24} /></div>}
            />

            {/* Source & Target Year Info */}
            <Card className="p-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    {/* Source year */}
                    <div className="flex-1">
                        <p className="text-xs text-text-secondary mb-1">📤 Asal (Tahun Selesai)</p>
                        {completedYears.length > 0 ? (
                            <select
                                value={sourceYear?.id || ''}
                                onChange={(e) => handleSourceYearChange(e.target.value)}
                                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full sm:w-auto"
                            >
                                {completedYears.map(y => (
                                    <option key={y.id} value={y.id}>✅ {y.name}</option>
                                ))}
                            </select>
                        ) : (
                            <p className="text-sm font-bold text-amber-500">Belum ada tahun ajaran selesai</p>
                        )}
                    </div>

                    {/* Arrow */}
                    <div className="hidden sm:flex items-center px-4">
                        <ArrowRight set="bold" primaryColor="currentColor" size={24} />
                    </div>

                    {/* Target year */}
                    <div className="flex-1 text-right">
                        <p className="text-xs text-text-secondary mb-1">📥 Tujuan (Tahun Aktif)</p>
                        {activeYear ? (
                            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">▶️ {activeYear.name}</p>
                        ) : (
                            <p className="text-sm font-bold text-amber-500">Belum ada tahun aktif</p>
                        )}
                    </div>
                </div>

                {/* Progress bar */}
                {students.length > 0 && (
                    <div className="mt-4">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-medium text-text-secondary">
                                Progress: {processedStudents.length}/{students.length} siswa diproses
                            </span>
                            <span className="text-xs font-bold text-text-main dark:text-white">{progressPercent}%</span>
                        </div>
                        <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${progressPercent === 100 ? 'bg-green-500' : 'bg-emerald-500'}`}
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                    </div>
                )}
            </Card>

            {/* Pre-flight Validation Warnings */}
            {sourceEqualsTarget && sourceYear && (
                <Card className="p-4 border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
                    <div className="flex items-start gap-3">
                        <div className="text-amber-500 mt-0.5"><AlertTriangle set="bold" primaryColor="currentColor" size={20} /></div>
                        <div>
                            <p className="text-sm font-bold text-amber-700 dark:text-amber-400">Tahun Sumber dan Tujuan Sama</p>
                            <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                                Sumber dan tujuan = <strong>{sourceYear.name}</strong>. Untuk kenaikan kelas, buat tahun ajaran baru terlebih dahulu.
                            </p>
                            <Button
                                variant="secondary"
                                onClick={() => router.push('/dashboard/admin/tahun-ajaran')}
                                className="mt-2 text-xs"
                            >
                                Ke Halaman Tahun Ajaran →
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {/* Empty states */}
            {noCompletedYear ? (
                <Card className="p-6">
                    <EmptyState
                        icon={<div className="text-amber-500"><Calendar set="bold" primaryColor="currentColor" size={48} /></div>}
                        title="Belum Ada Tahun Ajaran Selesai"
                        description="Selesaikan tahun ajaran yang sedang berjalan terlebih dahulu untuk bisa menaikkan kelas siswa"
                        action={
                            <Button onClick={() => router.push('/dashboard/admin/tahun-ajaran')}>
                                Kelola Tahun Ajaran
                            </Button>
                        }
                    />
                </Card>
            ) : noActiveYear ? (
                <Card className="p-6">
                    <EmptyState
                        icon={<div className="text-amber-500"><AlertTriangle set="bold" primaryColor="currentColor" size={48} /></div>}
                        title="Belum Ada Tahun Ajaran Aktif"
                        description="Buat dan aktifkan tahun ajaran baru sebagai tujuan kenaikan kelas"
                        action={
                            <Button onClick={() => router.push('/dashboard/admin/tahun-ajaran')}>
                                Buat Tahun Ajaran Baru
                            </Button>
                        }
                    />
                </Card>
            ) : classGroups.length === 0 ? (
                <Card className="p-6">
                    <EmptyState
                        icon={<div className="text-secondary"><Users set="bold" primaryColor="currentColor" size={48} /></div>}
                        title="Tidak Ada Siswa"
                        description={`Tidak ada siswa yang terdaftar (enrollment) di tahun ajaran ${sourceYear?.name}`}
                        action={
                            <Button onClick={() => router.push('/dashboard/admin/siswa')}>
                                Kelola Siswa
                            </Button>
                        }
                    />
                </Card>
            ) : (
                <>
                    {/* Search + Filter + Controls */}
                    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                        <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
                            <Button variant="secondary" onClick={selectAll}>
                                {selectedGroups.size === classGroups.filter(g => !g.isCompleted && getPendingStudents(g).length > 0).length && selectedGroups.size > 0
                                    ? 'Batalkan Semua'
                                    : 'Pilih Semua'}
                            </Button>
                            <div className="relative flex-1 sm:w-64">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"><Search set="bold" primaryColor="currentColor" size={16} /></span>
                                <input
                                    type="text"
                                    placeholder="Cari kelas..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>
                            {/* Filter toggle */}
                            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-0.5 border border-slate-200 dark:border-slate-700">
                                {(['ALL', 'PENDING', 'DONE'] as FilterMode[]).map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => setFilterMode(mode)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filterMode === mode
                                            ? 'bg-white dark:bg-slate-700 text-text-main dark:text-white shadow-sm'
                                            : 'text-text-secondary hover:text-text-main'
                                            }`}
                                    >
                                        {mode === 'ALL' ? 'Semua' : mode === 'PENDING' ? '🔴 Belum' : '🟢 Sudah'}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setShowHistory(!showHistory)}
                                className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors ${showHistory
                                    ? 'bg-primary/10 text-primary font-medium'
                                    : 'text-text-secondary hover:text-text-main dark:hover:text-white hover:bg-secondary/10'
                                    }`}
                            >
                                <History set="bold" primaryColor="currentColor" size={16} />
                                History
                                {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown set="bold" primaryColor="currentColor" size={12} />}
                            </button>
                            <button
                                onClick={handleExportCSV}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-text-secondary hover:text-text-main dark:hover:text-white hover:bg-secondary/10 rounded-lg transition-colors"
                            >
                                <Download set="bold" primaryColor="currentColor" size={16} />
                                Export
                            </button>
                            <span className="text-sm text-text-secondary">
                                {selectedGroups.size} kelas • {totalSelectedStudents} siswa
                            </span>
                        </div>
                    </div>

                    {/* History Panel */}
                    {showHistory && (
                        <Card className="p-0 overflow-hidden animate-in slide-in-from-top-2 duration-200">
                            <div className="bg-slate-50 dark:bg-slate-800 px-6 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                                <h3 className="font-bold text-text-main dark:text-white text-sm flex items-center gap-2">
                                    <History set="bold" primaryColor="currentColor" size={16} />
                                    Riwayat Kenaikan — {sourceYear?.name}
                                </h3>
                                <span className="text-xs text-text-secondary">{processedStudents.length} siswa diproses</span>
                            </div>
                            {processedStudents.length === 0 ? (
                                <div className="p-6 text-center text-sm text-text-secondary">
                                    Belum ada siswa yang diproses di tahun ajaran ini.
                                </div>
                            ) : (
                                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-2 text-left text-xs font-bold text-text-secondary">No</th>
                                                <th className="px-4 py-2 text-left text-xs font-bold text-text-secondary">Nama</th>
                                                <th className="px-4 py-2 text-left text-xs font-bold text-text-secondary">NIS</th>
                                                <th className="px-4 py-2 text-left text-xs font-bold text-text-secondary">Kelas Asal</th>
                                                <th className="px-4 py-2 text-left text-xs font-bold text-text-secondary">Status</th>
                                                <th className="px-4 py-2 text-left text-xs font-bold text-text-secondary">Keterangan</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-secondary/10">
                                            {processedStudents.map((s, i) => (
                                                <tr key={s.enrollment_id || s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                    <td className="px-4 py-2 text-text-secondary">{i + 1}</td>
                                                    <td className="px-4 py-2 font-medium text-text-main dark:text-white">{s.user.full_name || s.user.username}</td>
                                                    <td className="px-4 py-2 text-text-secondary">{s.nis || '-'}</td>
                                                    <td className="px-4 py-2 text-text-secondary">{s.class?.name || '-'}</td>
                                                    <td className="px-4 py-2">{getStudentStatusBadge(s)}</td>
                                                    <td className="px-4 py-2 text-xs text-text-secondary max-w-[200px] truncate">{s.enrollment_notes || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </Card>
                    )}

                    {/* SMP Section */}
                    {smpGroups.length > 0 && (
                        <Card className="p-0 overflow-hidden">
                            <div className="bg-blue-500/10 px-6 py-3 border-b border-blue-500/20">
                                <h3 className="font-bold text-blue-600 dark:text-blue-400">🏫 SMP</h3>
                            </div>
                            <div className="divide-y divide-secondary/10">
                                {smpGroups.map(renderGroupRow)}
                            </div>
                        </Card>
                    )}

                    {/* SMA Section */}
                    {smaGroups.length > 0 && (
                        <Card className="p-0 overflow-hidden">
                            <div className="bg-purple-500/10 px-6 py-3 border-b border-purple-500/20">
                                <h3 className="font-bold text-purple-600 dark:text-purple-400">🎓 SMA</h3>
                            </div>
                            <div className="divide-y divide-secondary/10">
                                {smaGroups.map(renderGroupRow)}
                            </div>
                        </Card>
                    )}

                    {filteredGroups.length === 0 && searchQuery && (
                        <Card className="p-6">
                            <EmptyState
                                icon={<div className="text-secondary"><Search set="bold" primaryColor="currentColor" size={48} /></div>}
                                title="Tidak Ditemukan"
                                description={`Tidak ada kelas yang cocok dengan "${searchQuery}"`}
                            />
                        </Card>
                    )}

                    {/* Process Button */}
                    <div className="flex justify-end">
                        <Button
                            onClick={handleProcessClick}
                            loading={processing}
                            disabled={selectedGroups.size === 0 || processing || sourceEqualsTarget}
                            icon={<CheckCircle set="bold" primaryColor="currentColor" size={20} />}
                            className="px-8"
                            title={sourceEqualsTarget ? 'Buat tahun ajaran baru dulu' : ''}
                        >
                            {processing
                                ? `Memproses ${processProgress.total} siswa...`
                                : `Proses Kenaikan Kelas (${totalSelectedStudents} siswa)`
                            }
                        </Button>
                    </div>
                </>
            )}

            {/* Confirmation Modal */}
            <Modal
                open={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                title="⚠️ Konfirmasi Kenaikan Kelas"
            >
                <div className="space-y-4">
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 rounded-xl">
                        <div className="flex items-start gap-3">
                            <div className="text-amber-500 mt-0.5 flex-shrink-0"><ShieldAlert set="bold" primaryColor="currentColor" size={20} /></div>
                            <div>
                                <p className="font-bold text-amber-700 dark:text-amber-300 text-sm">Perhatian!</p>
                                <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                                    Siswa akan dipindahkan dari <strong>{sourceYear?.name}</strong> ke <strong>{targetYear?.name}</strong>.
                                    Pastikan data sudah benar sebelum melanjutkan.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-secondary/5 border border-secondary/10 p-3 rounded-xl text-center">
                            <p className="text-2xl font-bold text-text-main dark:text-white">{confirmStats.classes}</p>
                            <p className="text-xs text-text-secondary">Kelas</p>
                        </div>
                        <div className="bg-secondary/5 border border-secondary/10 p-3 rounded-xl text-center">
                            <p className="text-2xl font-bold text-text-main dark:text-white">{confirmStats.total}</p>
                            <p className="text-xs text-text-secondary">Total Siswa</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        {confirmStats.promote > 0 && (
                            <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                                    <ArrowUpRight set="bold" primaryColor="currentColor" size={16} /> Naik Kelas
                                </span>
                                <span className="font-bold text-text-main dark:text-white">{confirmStats.promote} siswa</span>
                            </div>
                        )}
                        {confirmStats.graduate > 0 && (
                            <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 text-green-600 dark:text-green-400">
                                    <GraduationCap set="bold" primaryColor="currentColor" size={16} /> Lulus
                                </span>
                                <span className="font-bold text-text-main dark:text-white">{confirmStats.graduate} siswa</span>
                            </div>
                        )}
                        {confirmStats.transition > 0 && (
                            <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
                                    <ArrowRight set="bold" primaryColor="currentColor" size={16} /> Transisi SMA
                                </span>
                                <span className="font-bold text-text-main dark:text-white">{confirmStats.transition} siswa</span>
                            </div>
                        )}
                        {confirmStats.retained > 0 && (
                            <div className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2 text-orange-500">
                                    <UserX className="w-4 h-4" /> Tinggal Kelas
                                </span>
                                <span className="font-bold text-orange-500">{confirmStats.retained} siswa</span>
                            </div>
                        )}
                        {confirmStats.excluded > 0 && (
                            <div className="flex items-center justify-between text-sm border-t border-secondary/10 pt-2">
                                <span className="flex items-center gap-2 text-amber-500">
                                    <UserX className="w-4 h-4" /> Dilewati (tidak diproses kali ini)
                                </span>
                                <span className="font-bold text-amber-500">{confirmStats.excluded} siswa</span>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3 pt-2">
                        <Button variant="secondary" onClick={() => setShowConfirmModal(false)} className="flex-1">Batal</Button>
                        <Button onClick={handleConfirmProcess} className="flex-1" icon={<CheckCircle set="bold" primaryColor="currentColor" size={16} />}>
                            Ya, Proses Sekarang
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Results Modal */}
            <Modal
                open={showResultModal}
                onClose={() => setShowResultModal(false)}
                title="📊 Hasil Proses Kenaikan Kelas"
            >
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4 rounded-xl text-center">
                            <div className="text-green-500 mx-auto mb-2"><CheckCircle set="bold" primaryColor="currentColor" size={32} /></div>
                            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{results.success}</p>
                            <p className="text-sm text-green-700 dark:text-green-300">Berhasil</p>
                        </div>
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-xl text-center">
                            <div className="text-red-500 mx-auto mb-2"><XCircle set="bold" primaryColor="currentColor" size={32} /></div>
                            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{results.failed}</p>
                            <p className="text-sm text-red-700 dark:text-red-300">Gagal</p>
                        </div>
                    </div>

                    {results.errors.length > 0 && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-xl">
                            <p className="font-medium text-red-700 dark:text-red-300 mb-2">Detail Error:</p>
                            <ul className="text-sm text-red-600 dark:text-red-400 space-y-1 max-h-40 overflow-y-auto">
                                {results.errors.map((err, i) => (
                                    <li key={i}>• {err}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <Button onClick={() => setShowResultModal(false)} className="w-full">Tutup</Button>
                </div>
            </Modal>

            {/* Promote Retained Student Modal */}
            <Modal
                open={!!promoteRetainedStudent}
                onClose={() => { setPromoteRetainedStudent(null); setPromoteRetainedClassId('') }}
                title="🔄 Naikkan Siswa Tinggal Kelas"
            >
                {promoteRetainedStudent && (
                    <div className="space-y-4">
                        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                            <p className="text-sm text-amber-800 dark:text-amber-200">
                                <strong>{promoteRetainedStudent.user.full_name || promoteRetainedStudent.user.username}</strong>
                                {' '}sebelumnya ditandai <strong>tinggal kelas</strong>. Pilih kelas tujuan untuk menaikkan siswa ini.
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">
                                Kelas Tujuan
                            </label>
                            <select
                                value={promoteRetainedClassId}
                                onChange={(e) => setPromoteRetainedClassId(e.target.value)}
                                className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
                            >
                                <option value="">Pilih kelas tujuan...</option>
                                {getRetainedTargetClasses(promoteRetainedStudent).map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.name} ({c.school_level} Kelas {c.grade_level})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {promoteRetainedClassId && (
                            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-sm text-blue-800 dark:text-blue-200">
                                ✅ Enrollment aktif di kelas lama akan ditandai <strong>PROMOTED</strong>, dan enrollment baru dibuat di kelas tujuan.
                            </div>
                        )}

                        <div className="flex gap-3 pt-2">
                            <Button
                                variant="secondary"
                                onClick={() => { setPromoteRetainedStudent(null); setPromoteRetainedClassId('') }}
                                className="flex-1"
                            >
                                Batal
                            </Button>
                            <Button
                                onClick={handlePromoteRetained}
                                disabled={!promoteRetainedClassId || promotingRetained}
                                className="flex-1"
                            >
                                {promotingRetained ? 'Memproses...' : '⬆️ Naikkan Siswa'}
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    )
}
