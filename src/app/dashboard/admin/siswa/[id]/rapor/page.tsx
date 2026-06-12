'use client'

import { useEffect, useState, use } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Printer, ArrowLeft, GraduationCap, School, MapPin, Calendar, User, FileText } from 'lucide-react'
import { Button } from '@/components/ui'

interface Student {
    id: string
    nis: string | null
    class: { name: string; school_level?: string } | null
    user: { full_name: string }
    angkatan: string | null
    entry_year: number | null
}

interface Grade {
    id: string
    subject_id: string
    subject: { name: string }
    grade_type: 'TUGAS' | 'KUIS' | 'ULANGAN'
    score: number
}

interface SubjectSummary {
    subject_id: string
    subject_name: string
    tugas_scores: number[]
    kuis_scores: number[]
    ulangan_scores: number[]
    tugas_avg: number
    kuis_avg: number
    ulangan_avg: number
    final_score: number
    predicate: string
}

export default function RaporPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params)
    const router = useRouter()
    const [student, setStudent] = useState<Student | null>(null)
    const [summary, setSummary] = useState<SubjectSummary[]>([])
    const [loading, setLoading] = useState(true)
    const [debugGradeCount, setDebugGradeCount] = useState<number>(0)

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [studentRes, gradesRes] = await Promise.all([
                    fetch(`/api/students/${id}`),
                    fetch(`/api/grades?student_id=${id}&all_years=true`)
                ])

                const studentData = await studentRes.json()
                const gradesData = await gradesRes.json()

                if (studentRes.ok) {
                    setStudent(studentData)
                }

                if (gradesRes.ok && Array.isArray(gradesData)) {
                    setDebugGradeCount(gradesData.length)
                    processGrades(gradesData)
                }
            } catch (error) {
                console.error('Error fetching rapor data:', error)
            } finally {
                setLoading(false)
            }
        }

        fetchData()
    }, [id])

    // DEBUG: Log state changes
    useEffect(() => {
        console.log('Student:', student)
        console.log('Summary:', summary)
    }, [student, summary])

    const processGrades = (grades: Grade[]) => {
        const subjects: Record<string, SubjectSummary> = {}

        grades.forEach(grade => {
            if (!grade.subject_id) return

            if (!subjects[grade.subject_id]) {
                subjects[grade.subject_id] = {
                    subject_id: grade.subject_id,
                    subject_name: grade.subject.name,
                    tugas_scores: [],
                    kuis_scores: [],
                    ulangan_scores: [],
                    tugas_avg: 0,
                    kuis_avg: 0,
                    ulangan_avg: 0,
                    final_score: 0,
                    predicate: '-'
                }
            }

            if (grade.grade_type === 'TUGAS') subjects[grade.subject_id].tugas_scores.push(grade.score)
            else if (grade.grade_type === 'KUIS') subjects[grade.subject_id].kuis_scores.push(grade.score)
            else if (grade.grade_type === 'ULANGAN') subjects[grade.subject_id].ulangan_scores.push(grade.score)
        })

        const summaryArray = Object.values(subjects).map(subj => {
            const calcAvg = (scores: number[]) => scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0

            subj.tugas_avg = calcAvg(subj.tugas_scores)
            subj.kuis_avg = calcAvg(subj.kuis_scores)
            subj.ulangan_avg = calcAvg(subj.ulangan_scores)

            // Weight: 30% Tugas, 30% Kuis, 40% Ulangan
            subj.final_score = (subj.tugas_avg * 0.3) + (subj.kuis_avg * 0.3) + (subj.ulangan_avg * 0.4)

            // Predicate
            if (subj.final_score >= 90) subj.predicate = 'A'
            else if (subj.final_score >= 80) subj.predicate = 'B'
            else if (subj.final_score >= 70) subj.predicate = 'C'
            else if (subj.final_score >= 60) subj.predicate = 'D'
            else subj.predicate = 'E'

            return subj
        })

        // Sort by Subject Name
        summaryArray.sort((a, b) => a.subject_name.localeCompare(b.subject_name))
        setSummary(summaryArray)
    }

    const handlePrint = () => {
        window.print()
    }

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-50">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-8 h-8 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin"></div>
                    <p className="text-slate-500 font-medium">Memuat Data Rapor...</p>
                </div>
            </div>
        )
    }

    if (!student) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500">
                <div className="text-center">
                    <GraduationCap className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                    <h2 className="text-lg font-bold text-slate-700">Siswa Tidak Ditemukan</h2>
                    <p className="text-sm">ID: {id}</p>
                    <Button variant="ghost" onClick={() => router.back()} className="mt-4 text-emerald-600">
                        Kembali
                    </Button>
                </div>
            </div>
        )
    }

    // Calculate Overall Details
    const totalScore = summary.reduce((acc, curr) => acc + curr.final_score, 0)
    const gpa = summary.length > 0 ? (totalScore / summary.length).toFixed(1) : "0.0"

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-900 p-8 print:p-0 print:bg-white font-sans text-slate-900">

            {/* DEBUG INFO */}
            <div className="fixed bottom-4 right-4 p-4 bg-slate-900/90 text-white text-xs rounded-xl shadow-lg z-50 max-w-xs border border-slate-700/50 backdrop-blur-sm print:hidden">
                <div className="flex justify-between items-center mb-2 border-b border-slate-700 pb-2">
                    <span className="font-bold text-emerald-400">DEBUG</span>
                    <span className="text-slate-400">{id.slice(0, 8)}...</span>
                </div>
                <div className="space-y-1">
                    <div className="flex justify-between">
                        <span className="text-slate-400">Raw Grades:</span>
                        <span className="font-mono">{debugGradeCount}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400">Subjects:</span>
                        <span className="font-mono">{summary.length}</span>
                    </div>
                </div>
            </div>

            {/* Toolbar - Hidden when printing */}
            <div className="max-w-[210mm] mx-auto mb-6 flex justify-between items-center print:hidden">
                <Button variant="ghost" onClick={() => router.back()} className="text-slate-600 hover:text-emerald-600 hover:bg-emerald-50">
                    <ArrowLeft className="w-5 h-5 mr-2" />
                    Kembali
                </Button>
                <div className="flex items-center gap-4">
                    <div className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium flex items-center gap-1.5 border border-amber-200">
                        <Printer className="w-3.5 h-3.5" />
                        Gunakan Kertas A4
                    </div>
                    <Button onClick={handlePrint} className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20">
                        <Printer className="w-5 h-5 mr-2" />
                        Cetak Rapor
                    </Button>
                </div>
            </div>

            {/* Rapor Paper - A4 Width */}
            <div className="max-w-[210mm] min-h-[297mm] mx-auto bg-white p-[20mm] shadow-2xl rounded-sm print:shadow-none print:w-full print:max-w-none print:p-0 print:m-0">

                {/* 1. Header Section */}
                <div className="border-b-4 border-double border-emerald-600 pb-6 mb-8 text-center relative">
                    <div className="absolute left-0 top-2 w-20 h-20 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-100 print:hidden">
                        <School className="w-10 h-10 text-emerald-600" />
                    </div>
                    {/* Centered Content */}
                    <div className="px-4">
                        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2 font-display uppercase">
                            Laporan Hasil Belajar
                        </h1>
                        <h2 className="text-xl font-bold text-emerald-700 mb-1">
                            SMK DIGITAL NUSANTARA
                        </h2>
                        <div className="flex items-center justify-center gap-2 text-slate-500 text-sm">
                            <MapPin className="w-4 h-4" />
                            <span>Jl. Teknologi Raya No. 101, Kota Digital • (021) 555-0123</span>
                        </div>
                    </div>
                </div>

                {/* 2. Grid Info Section */}
                <div className="bg-slate-50 rounded-2xl p-6 mb-8 border border-slate-100 print:bg-transparent print:border-none print:p-0">
                    <div className="grid grid-cols-2 gap-x-12 gap-y-4">
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">Nama Peserta Didik</label>
                                <div className="text-lg font-bold text-slate-900">{student.user.full_name}</div>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">Nomor Induk / NISN</label>
                                <div className="text-base font-medium text-slate-700 font-mono">{student.nis || '-'}</div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">Kelas</label>
                                    <div className="text-lg font-bold text-slate-900">{student.class?.name || '-'}</div>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">Tahun Ajaran</label>
                                    <div className="text-lg font-bold text-emerald-700">
                                        {new Date().getFullYear()}/{new Date().getFullYear() + 1}
                                    </div>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">Semester</label>
                                <div className="text-base font-medium text-slate-700">Ganjil (Satu)</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 3. Summary Stats (Mini) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 print:hidden">
                    <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                            <FileText className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="text-xs text-slate-500">Mata Pelajaran</div>
                            <div className="font-bold text-lg">{summary.length}</div>
                        </div>
                    </div>
                    <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                            <GraduationCap className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="text-xs text-slate-500">Rata-Rata Umum</div>
                            <div className="font-bold text-lg">{gpa}</div>
                        </div>
                    </div>
                    <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                            <Calendar className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="text-xs text-slate-500">Kehadiran</div>
                            <div className="font-bold text-lg">100%</div>
                        </div>
                    </div>
                </div>

                {/* 4. Grades Table */}
                <div className="mb-12">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-1.5 h-6 bg-emerald-500 rounded-full"></div>
                        <h3 className="font-bold text-xl text-slate-900">A. Nilai Akademik</h3>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-200 print:rounded-none print:border-slate-900">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 text-slate-700 border-b border-slate-200 print:bg-slate-100">
                                    <th className="px-4 py-3 text-center w-12 font-bold">No</th>
                                    <th className="px-4 py-3 text-left font-bold">Mata Pelajaran</th>
                                    <th className="px-4 py-3 text-center w-24">Tugas</th>
                                    <th className="px-4 py-3 text-center w-24">Kuis</th>
                                    <th className="px-4 py-3 text-center w-24">Ulangan</th>
                                    <th className="px-4 py-3 text-center w-24 bg-emerald-50/50 print:bg-transparent font-bold text-emerald-800 print:text-black">Nilai Akhir</th>
                                    <th className="px-4 py-3 text-center w-20 font-bold">Predikat</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 print:divide-slate-300">
                                {summary.map((subj, idx) => (
                                    <tr key={subj.subject_id} className="hover:bg-slate-50/80 transition-colors print:hover:bg-transparent">
                                        <td className="px-4 py-3 text-center text-slate-500">{idx + 1}</td>
                                        <td className="px-4 py-3 font-medium text-slate-900">{subj.subject_name}</td>
                                        <td className="px-4 py-3 text-center text-slate-600">{Math.round(subj.tugas_avg)}</td>
                                        <td className="px-4 py-3 text-center text-slate-600">{Math.round(subj.kuis_avg)}</td>
                                        <td className="px-4 py-3 text-center text-slate-600">{Math.round(subj.ulangan_avg)}</td>
                                        <td className="px-4 py-3 text-center font-bold text-emerald-700 bg-emerald-50/30 print:bg-transparent print:text-black">
                                            {Math.round(subj.final_score)}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold
                                                ${subj.predicate === 'A' ? 'bg-emerald-100 text-emerald-700 print:bg-transparent print:text-black print:border print:border-black' :
                                                    subj.predicate === 'B' ? 'bg-blue-100 text-blue-700 print:bg-transparent print:text-black print:border print:border-black' :
                                                        subj.predicate === 'C' ? 'bg-amber-100 text-amber-700 print:bg-transparent print:text-black print:border print:border-black' :
                                                            'bg-red-100 text-red-700 print:bg-transparent print:text-black print:border print:border-black'}
                                            `}>
                                                {subj.predicate}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                {summary.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-12 text-center text-slate-400 italic bg-slate-50/50 dashed border-2 border-slate-100 m-4 rounded-xl">
                                            Belum ada data nilai akademik yang tersedia.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* 5. Signatures Footer */}
                <div className="grid grid-cols-3 gap-8 mt-24 text-sm text-slate-900 break-inside-avoid">
                    <div className="text-center relative">
                        <p className="mb-20 text-slate-600">Mengetahui,<br />Orang Tua / Wali</p>
                        <div className="border-b border-slate-900 w-32 mx-auto"></div>
                        <p className="mt-2 text-xs text-slate-400 print:hidden">( Tanda Tangan )</p>
                    </div>

                    <div className="text-center">
                        <p className="mb-20 text-slate-600">Mengetahui,<br />Kepala Sekolah</p>
                        <p className="font-bold underline text-slate-900 decoration-2 decoration-emerald-500 print:decoration-black">DR. H. AHMAD FAUZI, M.Pd</p>
                        <p className="text-xs text-slate-500 mt-1">NIP. 19800101 200501 1 001</p>
                    </div>

                    <div className="text-center">
                        <p className="mb-[88px] text-slate-600">
                            Kota Digital, {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}<br />
                            Wali Kelas
                        </p>
                        <div className="border-b border-slate-900 w-32 mx-auto"></div>
                    </div>
                </div>

                {/* Print Footer */}
                <div className="hidden print:block fixed bottom-0 left-0 w-full text-center text-[10px] text-slate-400 p-4 border-t border-slate-200">
                    Dicetak melalui Sistem Informasi Akademik HippoCampus by Edzo pada {new Date().toLocaleString('id-ID')}
                </div>
            </div>
        </div>
    )
}
