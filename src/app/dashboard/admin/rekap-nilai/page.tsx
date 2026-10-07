'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { PageHeader, Button, EmptyState } from '@/components/ui'
import { Graph as BarChart3, Download } from 'react-iconly'
import { Loader2, Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { useSchoolLabels } from '@/contexts/LabelsContext'
import { formatScore } from '@/lib/formatScore'
import ExportNilaiModal from '@/components/admin/ExportNilaiModal'

interface AcademicYear {
    id: string
    name: string
    is_active: boolean
}

interface Class {
    id: string
    name: string
    school_level?: string
    grade_level?: number
    academic_year_id?: string
}

interface Student {
    id: string
    nis: string | null
    user: {
        full_name: string | null
    }
}

interface Grade {
    id: string
    student_id: string
    subject_id: string
    grade_type: string
    score: number
    subject: { name: string }
    item_id?: string | null
    item_title?: string | null
}

interface SubjectGrade {
    subject_id: string
    subject_name: string
    tugas: number | null
    kuis: number | null
    ulangan: number | null
    uts: number | null
    uas: number | null
    rata_rata: number | null
    kkm: number
}

interface StudentGrades {
    student: Student
    grades: SubjectGrade[]
    average: number | null
}

const getScoreColor = (score: number | null, kkm: number = 75): string => {
    if (score === null) return 'text-text-secondary dark:text-zinc-500'
    if (score >= kkm) return 'text-green-700 dark:text-green-400'
    if (score >= kkm - 15) return 'text-amber-700 dark:text-amber-400'
    return 'text-red-700 dark:text-red-400'
}

export default function RekapNilaiPage() {
    const labels = useSchoolLabels()
    const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
    const [classes, setClasses] = useState<Class[]>([])
    const [selectedYear, setSelectedYear] = useState('')
    const [selectedClass, setSelectedClass] = useState('')
    const [loading, setLoading] = useState(true)
    const [loadingData, setLoadingData] = useState(false)
    const [studentGrades, setStudentGrades] = useState<StudentGrades[]>([])
    const [rawGrades, setRawGrades] = useState<Grade[]>([])
    const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([])
    const [viewMode, setViewMode] = useState<'ringkas' | 'detail'>('ringkas')
    const [searchQuery, setSearchQuery] = useState('')
    const [sortBy, setSortBy] = useState('name')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
    const [exportOpen, setExportOpen] = useState(false)
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => {
        fetchInitialData()
    }, [])

    const fetchInitialData = async () => {
        try {
            const [yearsRes, classesRes] = await Promise.all([
                fetch('/api/academic-years'),
                fetch('/api/classes')
            ])
            const yearsData = await yearsRes.json()
            const classesData = await classesRes.json()

            setAcademicYears(Array.isArray(yearsData) ? yearsData : [])
            setClasses(Array.isArray(classesData) ? classesData : [])

            const activeYear = yearsData.find((y: AcademicYear) => y.is_active)
            if (activeYear) {
                setSelectedYear(activeYear.id)
            }
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchGrades = async () => {
        if (!selectedYear || !selectedClass) return

        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller
        const { signal } = controller

        setLoadingData(true)
        try {
            const [studentsRes, subjectsRes, subjectKkmRes] = await Promise.all([
                fetch(`/api/students?class_id=${selectedClass}&enrollment_year_id=${selectedYear}`, { signal }),
                fetch('/api/subjects', { signal }),
                fetch('/api/subject-kkm', { signal })
            ])

            const studentsData = await studentsRes.json()
            const subjectsData = await subjectsRes.json()
            const subjectKkmData = await subjectKkmRes.json()
            const students: Student[] = Array.isArray(studentsData) ? studentsData : []
            setSubjects(Array.isArray(subjectsData) ? subjectsData : [])
            const allSubjectKkms = Array.isArray(subjectKkmData) ? subjectKkmData : []

            const studentIds = students.map(s => s.id).join(',')
            const gradesRes = await fetch(`/api/grades?academic_year_id=${selectedYear}&student_ids=${studentIds}`, { signal })
            const gradesData = await gradesRes.json()
            const allGrades: Grade[] = Array.isArray(gradesData) ? gradesData : []
            setRawGrades(allGrades)

            const gradesIndex = new Map<string, Map<string, Map<string, Grade[]>>>()
            for (const g of allGrades) {
                if (!gradesIndex.has(g.student_id)) gradesIndex.set(g.student_id, new Map())
                const subjMap = gradesIndex.get(g.student_id)!
                if (!subjMap.has(g.subject_id)) subjMap.set(g.subject_id, new Map())
                const typeMap = subjMap.get(g.subject_id)!
                if (!typeMap.has(g.grade_type)) typeMap.set(g.grade_type, [])
                typeMap.get(g.grade_type)!.push(g)
            }

            const classObj = classes.find(c => c.id === selectedClass)
            const classSchoolLevel = classObj?.school_level
            const classGradeLevel = classObj?.grade_level

            const getKkm = (subjectId: string, fallbackKkm: number = 75) => {
                if (!classSchoolLevel || !classGradeLevel) return fallbackKkm
                const granular = allSubjectKkms.find((k: Record<string, unknown>) =>
                    k.subject_id === subjectId &&
                    k.school_level === classSchoolLevel &&
                    k.grade_level === classGradeLevel
                )
                return granular ? granular.kkm : fallbackKkm
            }

            const processedGrades: StudentGrades[] = students.map(student => {
                const subjMap = gradesIndex.get(student.id)

                const subjectGrades: SubjectGrade[] = subjectsData.map((subject: { id: string; name: string; kkm?: number }) => {
                    const typeMap = subjMap?.get(subject.id)
                    const getAvg = (type: string): number | null => {
                        const grades = typeMap?.get(type) || []
                        if (grades.length === 0) return null
                        return grades.reduce((a, b) => a + b.score, 0) / grades.length
                    }

                    const tugasAvg = getAvg('TUGAS')
                    const kuisAvg = getAvg('KUIS')
                    const ulanganAvg = getAvg('ULANGAN')
                    const utsAvg = getAvg('UTS')
                    const uasAvg = getAvg('UAS')

                    const allScores = [tugasAvg, kuisAvg, ulanganAvg, utsAvg, uasAvg].filter(s => s !== null) as number[]
                    const subjectAvg = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null
                    const subjectKkm = getKkm(subject.id, subject.kkm)

                    return {
                        subject_id: subject.id,
                        subject_name: subject.name,
                        tugas: tugasAvg,
                        kuis: kuisAvg,
                        ulangan: ulanganAvg,
                        uts: utsAvg,
                        uas: uasAvg,
                        rata_rata: subjectAvg,
                        kkm: subjectKkm
                    }
                })

                const allSubjectAvgs = subjectGrades.map(sg => sg.rata_rata).filter(s => s !== null) as number[]
                const overallAvg = allSubjectAvgs.length > 0 ? allSubjectAvgs.reduce((a, b) => a + b, 0) / allSubjectAvgs.length : null

                return {
                    student,
                    grades: subjectGrades,
                    average: overallAvg
                }
            })

            processedGrades.sort((a, b) =>
                (a.student.user.full_name || '').localeCompare(b.student.user.full_name || '')
            )

            setStudentGrades(processedGrades)
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return
            console.error('Error:', error)
        } finally {
            if (abortRef.current === controller) {
                setLoadingData(false)
            }
        }
    }

    useEffect(() => {
        if (selectedYear && selectedClass) {
            fetchGrades()
        } else {
            setStudentGrades([])
            setRawGrades([])
        }
    }, [selectedYear, selectedClass])

    const handleSort = (column: string) => {
        if (sortBy === column) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
        } else {
            setSortBy(column)
            setSortDir(column === 'name' ? 'asc' : 'desc')
        }
    }

    const renderSortIcon = (column: string) => {
        if (sortBy !== column) return <ArrowUpDown className="inline-block w-3 h-3 ml-1 opacity-30" />
        return sortDir === 'asc'
            ? <ArrowUp className="inline-block w-3 h-3 ml-1" />
            : <ArrowDown className="inline-block w-3 h-3 ml-1" />
    }

    const displayGrades = useMemo(() => {
        let result = [...studentGrades]

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            result = result.filter(sg =>
                (sg.student.user.full_name || '').toLowerCase().includes(q) ||
                (sg.student.nis || '').toLowerCase().includes(q)
            )
        }

        if (sortBy === 'name') {
            result.sort((a, b) => {
                const cmp = (a.student.user.full_name || '').localeCompare(b.student.user.full_name || '')
                return sortDir === 'asc' ? cmp : -cmp
            })
        } else if (sortBy === 'average') {
            result.sort((a, b) => {
                const av = a.average ?? -1
                const bv = b.average ?? -1
                return sortDir === 'asc' ? av - bv : bv - av
            })
        } else {
            result.sort((a, b) => {
                const ag = a.grades.find(g => g.subject_id === sortBy)
                const bg = b.grades.find(g => g.subject_id === sortBy)
                const av = ag?.rata_rata ?? -1
                const bv = bg?.rata_rata ?? -1
                return sortDir === 'asc' ? av - bv : bv - av
            })
        }

        return result
    }, [studentGrades, searchQuery, sortBy, sortDir])

    const avgKkm = useMemo(() => {
        if (studentGrades.length === 0 || studentGrades[0].grades.length === 0) return 75
        return studentGrades[0].grades.reduce((sum, s) => sum + s.kkm, 0) / studentGrades[0].grades.length
    }, [studentGrades])

    const detailHeaders = useMemo(() => {
        const cats = [
            labels.tugas.charAt(0).toUpperCase(),
            labels.kuis.charAt(0).toUpperCase(),
            labels.ulangan.charAt(0).toUpperCase(),
            labels.uts,
            labels.uas,
            'Rata\u00B2'
        ]
        return cats
    }, [labels])

    return (
        <div className="space-y-6">
            <PageHeader
                title="Rekap Nilai"
                subtitle="Rekap nilai siswa per kelas"
                backHref="/dashboard/admin"
                icon={<BarChart3 set="bold" primaryColor="currentColor" size={32} />}
            />

            <div className="bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tahun Ajaran</label>
                        <select
                            value={selectedYear}
                            onChange={(e) => {
                                setSelectedYear(e.target.value)
                                setSelectedClass('')
                            }}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                            <option value="">Pilih Tahun Ajaran</option>
                            {academicYears.map(y => (
                                <option key={y.id} value={y.id}>
                                    {y.name} {y.is_active && '(Aktif)'}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kelas</label>
                        <select
                            value={selectedClass}
                            onChange={(e) => setSelectedClass(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            disabled={!selectedYear}
                        >
                            <option value="">Pilih Kelas</option>
                            {classes.filter(c => !selectedYear || c.academic_year_id === selectedYear).map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-end">
                        <Button
                            onClick={() => setExportOpen(true)}
                            disabled={studentGrades.length === 0}
                            className="w-full"
                            icon={
                                <div className="text-white"><Download set="bold" primaryColor="currentColor" size={20} /></div>
                            }
                        >
                            Export Nilai
                        </Button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : !selectedYear || !selectedClass ? (
                <EmptyState
                    icon={<BarChart3 set="bold" primaryColor="currentColor" size={48} />}
                    title="Pilih Filter"
                    description="Pilih tahun ajaran dan kelas untuk melihat rekap nilai"
                />
            ) : loadingData ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : studentGrades.length === 0 ? (
                <EmptyState
                    icon={<BarChart3 set="bold" primaryColor="currentColor" size={48} />}
                    title="Belum Ada Data"
                    description="Belum ada data nilai untuk kelas ini"
                />
            ) : (
                <div className="bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
                    <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h3 className="font-bold text-text-main dark:text-white">
                                Rekap Nilai: {classes.find(c => c.id === selectedClass)?.name}
                            </h3>
                            <p className="text-sm text-text-secondary dark:text-zinc-400">
                                {displayGrades.length} siswa{searchQuery.trim() && displayGrades.length !== studentGrades.length ? ` (dari ${studentGrades.length})` : ''}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary dark:text-zinc-500" />
                                <input
                                    type="text"
                                    placeholder="Cari siswa..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="pl-9 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 w-48"
                                />
                            </div>
                            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
                                <button
                                    onClick={() => setViewMode('ringkas')}
                                    className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${viewMode === 'ringkas'
                                        ? 'bg-white dark:bg-slate-700 text-text-main dark:text-white shadow-sm'
                                        : 'text-text-secondary dark:text-zinc-400 hover:text-text-main dark:hover:text-white'
                                        }`}
                                >
                                    Ringkas
                                </button>
                                <button
                                    onClick={() => setViewMode('detail')}
                                    className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${viewMode === 'detail'
                                        ? 'bg-white dark:bg-slate-700 text-text-main dark:text-white shadow-sm'
                                        : 'text-text-secondary dark:text-zinc-400 hover:text-text-main dark:hover:text-white'
                                        }`}
                                >
                                    Detail
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        {viewMode === 'ringkas' ? (
                            <table className="w-full min-w-[800px]">
                                <thead className="bg-slate-50 dark:bg-slate-800">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-sm font-bold text-text-main dark:text-white sticky left-0 bg-slate-50 dark:bg-slate-800 z-10">No</th>
                                        <th
                                            className="px-4 py-3 text-left text-sm font-bold text-text-main dark:text-white sticky left-12 bg-slate-50 dark:bg-slate-800 z-10 cursor-pointer select-none whitespace-nowrap"
                                            onClick={() => handleSort('name')}
                                        >
                                            Nama Siswa {renderSortIcon('name')}
                                        </th>
                                        {subjects.map(s => (
                                            <th
                                                key={s.id}
                                                className="px-4 py-3 text-center text-sm font-bold text-text-main dark:text-white whitespace-nowrap cursor-pointer select-none"
                                                onClick={() => handleSort(s.id)}
                                            >
                                                {s.name} {renderSortIcon(s.id)}
                                            </th>
                                        ))}
                                        <th
                                            className="px-4 py-3 text-center text-sm font-bold text-emerald-600 dark:text-emerald-400 cursor-pointer select-none whitespace-nowrap"
                                            onClick={() => handleSort('average')}
                                        >
                                            Rata-rata {renderSortIcon('average')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                    {displayGrades.map((sg, idx) => (
                                        <tr key={sg.student.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                            <td className="px-4 py-3 text-text-secondary dark:text-zinc-400 sticky left-0 bg-white dark:bg-surface-dark">{idx + 1}</td>
                                            <td className="px-4 py-3 text-text-main dark:text-white sticky left-12 bg-white dark:bg-surface-dark">
                                                <div>
                                                    <p className="font-medium">{sg.student.user.full_name || '-'}</p>
                                                    <p className="text-xs text-text-secondary dark:text-zinc-500">{sg.student.nis || '-'}</p>
                                                </div>
                                            </td>
                                            {sg.grades.map(g => (
                                                <td key={g.subject_id} className="px-4 py-3 text-center">
                                                    <span className={`font-medium ${getScoreColor(g.rata_rata, g.kkm)}`}>
                                                        {formatScore(g.rata_rata)}
                                                    </span>
                                                </td>
                                            ))}
                                            <td className="px-4 py-3 text-center">
                                                <span className={`font-bold ${getScoreColor(sg.average, avgKkm)}`}>
                                                    {formatScore(sg.average)}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <table className="w-full" style={{ minWidth: `${subjects.length * 180 + 200}px` }}>
                                <thead className="bg-slate-50 dark:bg-slate-800">
                                    <tr>
                                        <th className="px-3 py-3 text-left text-sm font-bold text-text-main dark:text-white sticky left-0 bg-slate-50 dark:bg-slate-800 z-10" rowSpan={2}>No</th>
                                        <th
                                            className="px-3 py-3 text-left text-sm font-bold text-text-main dark:text-white sticky left-10 bg-slate-50 dark:bg-slate-800 z-10 cursor-pointer select-none whitespace-nowrap"
                                            rowSpan={2}
                                            onClick={() => handleSort('name')}
                                        >
                                            Nama Siswa {renderSortIcon('name')}
                                        </th>
                                        {subjects.map(s => (
                                            <th
                                                key={s.id}
                                                className="px-2 py-2 text-center text-xs font-bold text-text-main dark:text-white whitespace-nowrap border-l border-slate-200 dark:border-slate-600"
                                                colSpan={6}
                                            >
                                                {s.name}
                                            </th>
                                        ))}
                                        <th
                                            className="px-3 py-3 text-center text-sm font-bold text-emerald-600 dark:text-emerald-400 cursor-pointer select-none whitespace-nowrap"
                                            rowSpan={2}
                                            onClick={() => handleSort('average')}
                                        >
                                            Rata-rata {renderSortIcon('average')}
                                        </th>
                                    </tr>
                                    <tr>
                                        {subjects.map(s => (
                                            detailHeaders.map((label, i) => (
                                                <th
                                                    key={`${s.id}_${i}`}
                                                    className="px-2 py-1.5 text-center text-xs font-semibold text-text-secondary dark:text-zinc-400 whitespace-nowrap border-l border-slate-200 dark:border-slate-600"
                                                >
                                                    {label}
                                                </th>
                                            ))
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                    {displayGrades.map((sg, idx) => (
                                        <tr key={sg.student.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                            <td className="px-3 py-2.5 text-text-secondary dark:text-zinc-400 sticky left-0 bg-white dark:bg-surface-dark">{idx + 1}</td>
                                            <td className="px-3 py-2.5 text-text-main dark:text-white sticky left-10 bg-white dark:bg-surface-dark">
                                                <div>
                                                    <p className="font-medium text-sm">{sg.student.user.full_name || '-'}</p>
                                                    <p className="text-xs text-text-secondary dark:text-zinc-500">{sg.student.nis || '-'}</p>
                                                </div>
                                            </td>
                                            {sg.grades.map(g => (
                                                [
                                                    { val: g.tugas, kkm: g.kkm },
                                                    { val: g.kuis, kkm: g.kkm },
                                                    { val: g.ulangan, kkm: g.kkm },
                                                    { val: g.uts, kkm: g.kkm },
                                                    { val: g.uas, kkm: g.kkm },
                                                    { val: g.rata_rata, kkm: g.kkm }
                                                ].map((cell, i) => (
                                                    <td
                                                        key={`${g.subject_id}_${i}`}
                                                        className={`px-2 py-2.5 text-center text-sm border-l border-slate-100 dark:border-slate-700/50 ${i === 5 ? 'font-bold' : 'font-medium'}`}
                                                    >
                                                        <span className={getScoreColor(cell.val, cell.kkm)}>
                                                            {formatScore(cell.val)}
                                                        </span>
                                                    </td>
                                                ))
                                            ))}
                                            <td className="px-3 py-2.5 text-center">
                                                <span className={`font-bold ${getScoreColor(sg.average, avgKkm)}`}>
                                                    {formatScore(sg.average)}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            <ExportNilaiModal
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                students={studentGrades}
                subjects={subjects}
                rawGrades={rawGrades}
                labels={labels}
                className={classes.find(c => c.id === selectedClass)?.name || ''}
                yearName={academicYears.find(y => y.id === selectedYear)?.name || ''}
            />
        </div>
    )
}
