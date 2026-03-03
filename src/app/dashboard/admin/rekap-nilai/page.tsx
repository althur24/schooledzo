'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, Button, EmptyState } from '@/components/ui'
import { Graph as BarChart3, Download } from 'react-iconly'
import { Loader2 } from 'lucide-react'

interface AcademicYear {
    id: string
    name: string
    is_active: boolean
}

interface Class {
    id: string
    name: string
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
}

interface SubjectGrade {
    subject_id: string
    subject_name: string
    tugas: number | null
    kuis: number | null
    ulangan: number | null
    rata_rata: number | null
}

interface StudentGrades {
    student: Student
    grades: SubjectGrade[]
    average: number | null
}

export default function RekapNilaiPage() {
    const [academicYears, setAcademicYears] = useState<AcademicYear[]>([])
    const [classes, setClasses] = useState<Class[]>([])
    const [selectedYear, setSelectedYear] = useState('')
    const [selectedClass, setSelectedClass] = useState('')
    const [loading, setLoading] = useState(true)
    const [loadingData, setLoadingData] = useState(false)
    const [studentGrades, setStudentGrades] = useState<StudentGrades[]>([])
    const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([])

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

            // Auto select active year
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

        setLoadingData(true)
        try {
            // Fetch students in the class
            const studentsRes = await fetch(`/api/students?class_id=${selectedClass}`)
            const studentsData = await studentsRes.json()
            const students: Student[] = Array.isArray(studentsData) ? studentsData : []

            // Fetch all grades
            const gradesRes = await fetch(`/api/grades?academic_year_id=${selectedYear}`)
            const gradesData = await gradesRes.json()
            const allGrades: Grade[] = Array.isArray(gradesData) ? gradesData : []

            // Fetch subjects
            const subjectsRes = await fetch('/api/subjects')
            const subjectsData = await subjectsRes.json()
            setSubjects(Array.isArray(subjectsData) ? subjectsData : [])

            // Process grades per student
            const processedGrades: StudentGrades[] = students.map(student => {
                const studentGradesList = allGrades.filter(g => g.student_id === student.id)

                // Group by subject
                const subjectGrades: SubjectGrade[] = subjectsData.map((subject: { id: string; name: string }) => {
                    const subjectGradesList = studentGradesList.filter(g => g.subject_id === subject.id)

                    const tugasGrades = subjectGradesList.filter(g => g.grade_type === 'TUGAS').map(g => g.score)
                    const kuisGrades = subjectGradesList.filter(g => g.grade_type === 'KUIS').map(g => g.score)
                    const ulanganGrades = subjectGradesList.filter(g => g.grade_type === 'ULANGAN').map(g => g.score)

                    const tugasAvg = tugasGrades.length > 0 ? tugasGrades.reduce((a, b) => a + b, 0) / tugasGrades.length : null
                    const kuisAvg = kuisGrades.length > 0 ? kuisGrades.reduce((a, b) => a + b, 0) / kuisGrades.length : null
                    const ulanganAvg = ulanganGrades.length > 0 ? ulanganGrades.reduce((a, b) => a + b, 0) / ulanganGrades.length : null

                    const allScores = [tugasAvg, kuisAvg, ulanganAvg].filter(s => s !== null) as number[]
                    const subjectAvg = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null

                    return {
                        subject_id: subject.id,
                        subject_name: subject.name,
                        tugas: tugasAvg,
                        kuis: kuisAvg,
                        ulangan: ulanganAvg,
                        rata_rata: subjectAvg
                    }
                })

                // Calculate overall average
                const allSubjectAvgs = subjectGrades.map(sg => sg.rata_rata).filter(s => s !== null) as number[]
                const overallAvg = allSubjectAvgs.length > 0 ? allSubjectAvgs.reduce((a, b) => a + b, 0) / allSubjectAvgs.length : null

                return {
                    student,
                    grades: subjectGrades,
                    average: overallAvg
                }
            })

            // Sort by student name
            processedGrades.sort((a, b) =>
                (a.student.user.full_name || '').localeCompare(b.student.user.full_name || '')
            )

            setStudentGrades(processedGrades)
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoadingData(false)
        }
    }

    useEffect(() => {
        if (selectedYear && selectedClass) {
            fetchGrades()
        } else {
            setStudentGrades([])
        }
    }, [selectedYear, selectedClass])

    const handleDownloadExcel = async () => {
        if (studentGrades.length === 0) return

        // Lazy load xlsx (7.2MB) only when user clicks export
        const XLSX = await import('xlsx')

        const selectedClassName = classes.find(c => c.id === selectedClass)?.name || ''
        const selectedYearName = academicYears.find(y => y.id === selectedYear)?.name || ''

        // Prepare Excel data
        const headers = ['No', 'NIS', 'Nama Siswa']
        subjects.forEach(s => {
            headers.push(`${s.name} (Tugas)`)
            headers.push(`${s.name} (Kuis)`)
            headers.push(`${s.name} (Ulangan)`)
            headers.push(`${s.name} (Rata-rata)`)
        })
        headers.push('Rata-rata Keseluruhan')

        const data = studentGrades.map((sg, idx) => {
            const row: (string | number)[] = [
                idx + 1,
                sg.student.nis || '-',
                sg.student.user.full_name || '-'
            ]

            sg.grades.forEach(g => {
                row.push(g.tugas !== null ? Math.round(g.tugas * 10) / 10 : '-')
                row.push(g.kuis !== null ? Math.round(g.kuis * 10) / 10 : '-')
                row.push(g.ulangan !== null ? Math.round(g.ulangan * 10) / 10 : '-')
                row.push(g.rata_rata !== null ? Math.round(g.rata_rata * 10) / 10 : '-')
            })

            row.push(sg.average !== null ? Math.round(sg.average * 10) / 10 : '-')

            return row
        })

        // Create workbook
        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.aoa_to_sheet([headers, ...data])

        // Set column widths
        ws['!cols'] = headers.map((_, i) => ({ wch: i < 3 ? 20 : 12 }))

        XLSX.utils.book_append_sheet(wb, ws, 'Rekap Nilai')
        XLSX.writeFile(wb, `Rekap_Nilai_${selectedClassName}_${selectedYearName}.xlsx`)
    }

    const formatScore = (score: number | null) => {
        if (score === null) return '-'
        return Math.round(score * 10) / 10
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Rekap Nilai"
                subtitle="Rekap nilai siswa per kelas"
                backHref="/dashboard/admin"
                icon={<BarChart3 set="bold" primaryColor="currentColor" size={32} />}
            />

            {/* Filters */}
            <div className="bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tahun Ajaran</label>
                        <select
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(e.target.value)}
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
                            {classes.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-end">
                        <Button
                            onClick={handleDownloadExcel}
                            disabled={studentGrades.length === 0}
                            className="w-full"
                            icon={
                                <div className="text-white"><Download set="bold" primaryColor="currentColor" size={20} /></div>
                            }
                        >
                            Download Excel
                        </Button>
                    </div>
                </div>
            </div>

            {/* Results */}
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
                    <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                        <div>
                            <h3 className="font-bold text-text-main dark:text-white">
                                Rekap Nilai: {classes.find(c => c.id === selectedClass)?.name}
                            </h3>
                            <p className="text-sm text-text-secondary dark:text-zinc-400">{studentGrades.length} siswa</p>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[800px]">
                            <thead className="bg-slate-50 dark:bg-slate-800">
                                <tr>
                                    <th className="px-4 py-3 text-left text-sm font-bold text-text-main dark:text-white sticky left-0 bg-slate-50 dark:bg-slate-800 z-10">No</th>
                                    <th className="px-4 py-3 text-left text-sm font-bold text-text-main dark:text-white sticky left-12 bg-slate-50 dark:bg-slate-800 z-10">Nama Siswa</th>
                                    {subjects.map(s => (
                                        <th key={s.id} className="px-4 py-3 text-center text-sm font-bold text-text-main dark:text-white whitespace-nowrap">
                                            {s.name}
                                        </th>
                                    ))}
                                    <th className="px-4 py-3 text-center text-sm font-bold text-emerald-600 dark:text-emerald-400">Rata-rata</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                {studentGrades.map((sg, idx) => (
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
                                                <span className={`font-medium ${g.rata_rata !== null
                                                    ? g.rata_rata >= 75
                                                        ? 'text-green-700 dark:text-green-400'
                                                        : g.rata_rata >= 60
                                                            ? 'text-amber-700 dark:text-amber-400'
                                                            : 'text-red-700 dark:text-red-400'
                                                    : 'text-text-secondary dark:text-zinc-500'
                                                    }`}>
                                                    {formatScore(g.rata_rata)}
                                                </span>
                                            </td>
                                        ))}
                                        <td className="px-4 py-3 text-center">
                                            <span className={`font-bold ${sg.average !== null
                                                ? sg.average >= 75
                                                    ? 'text-emerald-600 dark:text-emerald-400'
                                                    : sg.average >= 60
                                                        ? 'text-amber-600 dark:text-amber-400'
                                                        : 'text-rose-600 dark:text-rose-400'
                                                : 'text-slate-400 dark:text-slate-500'
                                                }`}>
                                                {formatScore(sg.average)}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}
