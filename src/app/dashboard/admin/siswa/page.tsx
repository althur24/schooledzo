'use client'

import { useEffect, useState, useRef } from 'react'
import { Modal, Button, PageHeader, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import { User as Users, AddUser as UserPlus, Edit as Pencil, Delete as Trash2, Show as Eye, Hide as EyeOff, InfoCircle as AlertCircle, Filter, Document as GraduationCap, Paper, Search, ChevronDown, ChevronRight } from 'react-iconly'
import Link from 'next/link'
import { Loader2, Upload, FileDown, CheckCircle2, XCircle, Search as SearchIcon } from 'lucide-react'
import Papa from 'papaparse'
import { Class, SchoolLevel } from '@/lib/types'


interface Student {
    id: string
    nis: string | null
    class_id: string | null
    parent_user_id: string | null
    gender: 'L' | 'P' | null
    angkatan: string | null
    entry_year: number | null
    school_level: SchoolLevel | null
    status: string
    user: {
        id: string
        username: string
        full_name: string | null
    }
    class: { id: string; name: string; grade_level?: number; school_level?: SchoolLevel } | null
}

interface FormData {
    username: string
    password: string
    full_name: string
    nis: string
    class_id: string
    gender: string
    angkatan: string
    entry_year: string
    school_level: string
    wali_password: string
}

const defaultFormData: FormData = {
    username: '',
    password: '',
    full_name: '',
    nis: '',
    class_id: '',
    gender: '',
    angkatan: '',
    entry_year: '',
    school_level: '',
    wali_password: ''
}

// Generate angkatan options (last 10 years)
const currentYear = new Date().getFullYear()
const angkatanOptions = Array.from({ length: 10 }, (_, i) => (currentYear - i).toString())

export default function SiswaPage() {
    const [students, setStudents] = useState<Student[]>([])
    const [filteredStudents, setFilteredStudents] = useState<Student[]>([])
    const [classes, setClasses] = useState<Class[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [editingStudent, setEditingStudent] = useState<Student | null>(null)
    const [formData, setFormData] = useState<FormData>(defaultFormData)
    const [showPassword, setShowPassword] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [successMessage, setSuccessMessage] = useState('')

    // Bulk Upload States
    const [showBulkModal, setShowBulkModal] = useState(false)
    const [bulkSaving, setBulkSaving] = useState(false)
    const [bulkResults, setBulkResults] = useState<{ success: number, failed: number, errors: any[] } | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Filter & Search states
    const [searchQuery, setSearchQuery] = useState('')
    const [filterAngkatan, setFilterAngkatan] = useState('')
    const [filterSchoolLevel, setFilterSchoolLevel] = useState('')
    const [showFilters, setShowFilters] = useState(false)

    // Accordion State
    const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set())



    const fetchData = async () => {
        try {
            const [studentsRes, classesRes] = await Promise.all([
                fetch('/api/students?status=ACTIVE'),
                fetch('/api/classes')
            ])
            const [studentsData, classesData] = await Promise.all([
                studentsRes.json(),
                classesRes.json()
            ])
            const studentList = Array.isArray(studentsData) ? studentsData : []
            setStudents(studentList)
            setFilteredStudents(studentList)
            setClasses(Array.isArray(classesData) ? classesData : [])
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchData() }, [])

    // Apply filters and search
    useEffect(() => {
        let filtered = students

        if (searchQuery) {
            const query = searchQuery.toLowerCase()
            filtered = filtered.filter(s =>
                s.user.full_name?.toLowerCase().includes(query) ||
                s.nis?.toLowerCase().includes(query) ||
                s.user.username.toLowerCase().includes(query)
            )
        }

        if (filterAngkatan) {
            filtered = filtered.filter(s => s.angkatan === filterAngkatan)
        }
        if (filterSchoolLevel) {
            filtered = filtered.filter(s => s.school_level === filterSchoolLevel)
        }
        setFilteredStudents(filtered)
    }, [students, searchQuery, filterAngkatan, filterSchoolLevel])

    // Grouping by class
    const groupedStudents = filteredStudents.reduce((acc, student) => {
        const className = student.class?.name || 'Belum Masuk Kelas'
        if (!acc[className]) {
            acc[className] = {
                name: className,
                grade_level: student.class?.grade_level || 0,
                school_level: student.class?.school_level || 'Belum Masuk Kelas',
                students: []
            }
        }
        acc[className].students.push(student)
        return acc
    }, {} as Record<string, { name: string, grade_level: number, school_level: string | SchoolLevel, students: Student[] }>)

    // Sort groups: SMP first, then SMA, then grade, then name
    const sortedGroups = Object.values(groupedStudents).sort((a, b) => {
        if (a.name === 'Belum Masuk Kelas') return 1
        if (b.name === 'Belum Masuk Kelas') return -1

        const levelWeight = { 'SMP': 1, 'SMA': 2 }
        const weightA = levelWeight[a.school_level as keyof typeof levelWeight] || 99
        const weightB = levelWeight[b.school_level as keyof typeof levelWeight] || 99

        if (weightA !== weightB) return weightA - weightB
        if (a.grade_level !== b.grade_level) return a.grade_level - b.grade_level
        return a.name.localeCompare(b.name)
    })

    const toggleClass = (className: string) => {
        const newExpanded = new Set(expandedClasses)
        if (newExpanded.has(className)) {
            newExpanded.delete(className)
        } else {
            newExpanded.add(className)
        }
        setExpandedClasses(newExpanded)
    }

    const toggleAllClasses = () => {
        if (expandedClasses.size === sortedGroups.length) {
            setExpandedClasses(new Set())
        } else {
            setExpandedClasses(new Set(sortedGroups.map(g => g.name)))
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        setError('')
        try {
            const url = editingStudent ? `/api/students/${editingStudent.id}` : '/api/students'
            const method = editingStudent ? 'PUT' : 'POST'

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    class_id: formData.class_id || null,
                    entry_year: formData.entry_year ? parseInt(formData.entry_year) : null,
                    school_level: formData.school_level || null,
                    angkatan: formData.angkatan || null,
                    wali_password: formData.wali_password || null
                })
            })

            const data = await res.json()

            if (!res.ok) {
                setError(data.error || 'Gagal menyimpan')
                return
            }

            const isEdit = !!editingStudent;
            const hasWali = !!formData.wali_password;

            setSuccessMessage(
                isEdit
                    ? `Data siswa berhasil diperbarui. ${hasWali ? 'Password wali berhasil disimpan.' : ''}`
                    : `Siswa berhasil ditambahkan. ${hasWali ? 'Akun wali berhasil dibuat.' : ''}`
            )

            // Clear success message after 5 seconds
            setTimeout(() => setSuccessMessage(''), 5000)

            setShowModal(false)
            setEditingStudent(null)
            setFormData(defaultFormData)
            fetchData()
        } catch (err) {
            setError('Terjadi kesalahan jaringan atau server')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Yakin ingin menghapus siswa ini?')) return
        await fetch(`/api/students/${id}`, { method: 'DELETE' })
        fetchData()
    }

    const openEdit = (student: Student) => {
        setEditingStudent(student)
        setFormData({
            username: student.user.username,
            password: '',
            full_name: student.user.full_name || '',
            nis: student.nis || '',
            class_id: student.class_id || '',
            gender: student.gender || '',
            angkatan: student.angkatan || '',
            entry_year: student.entry_year?.toString() || '',
            school_level: student.school_level || '',
            wali_password: ''
        })
        setError('')
        setShowModal(true)
    }

    const openAdd = () => {
        setEditingStudent(null)
        setFormData(defaultFormData)
        setError('')
        setShowModal(true)
    }

    const clearFilters = () => {
        setFilterAngkatan('')
        setFilterSchoolLevel('')
    }

    const downloadTemplate = () => {
        const headers = ['Nama Lengkap', 'L/P', 'NIS', 'Angkatan', 'Kelas', 'Username', 'Password']
        const csvContent = headers.join(',') + '\n' +
            'Muhammad Rizki,L,221001,2022,X IPA 1,rizki_siswa,pass123\n' +
            'Siti Hawa,P,221002,2022,X IPS 1,siti_siswa,pass123'

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute('download', 'Template_Upload_Siswa.csv')
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setBulkSaving(true)
        setBulkResults(null)

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                try {
                    const payload = results.data.map((row: any) => ({
                        full_name: row['Nama Lengkap'] || row['nama lengkap'] || '',
                        gender: row['L/P']?.toUpperCase() === 'L' || row['L/P']?.toUpperCase() === 'P' ? row['L/P'].toUpperCase() : null,
                        nis: row['NIS'] || row['nis'] || '',
                        angkatan: row['Angkatan'] || row['angkatan'] || '',
                        kelas: row['Kelas'] || row['kelas'] || '',
                        username: row['Username'] || row['username'] || '',
                        password: row['Password'] || row['password'] || ''
                    }))

                    const res = await fetch('/api/students/bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    })

                    const data = await res.json()

                    if (!res.ok) throw new Error(data.error || 'Server error')

                    let successCount = 0
                    let failedCount = 0
                    const errors: any[] = []

                    data.results.forEach((r: any) => {
                        if (r.success) successCount++
                        else {
                            failedCount++
                            errors.push({ name: r.item.full_name || r.item.username, error: r.error })
                        }
                    })

                    setBulkResults({ success: successCount, failed: failedCount, errors })
                    fetchData()
                } catch (err: any) {
                    console.error(err)
                    setError(err.message || 'Gagal memproses file')
                } finally {
                    setBulkSaving(false)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                }
            },
            error: (err) => {
                setError('Format file tidak valid')
                setBulkSaving(false)
            }
        })
    }

    // Get unique angkatan values from students
    const uniqueAngkatan = [...new Set(students.map(s => s.angkatan).filter(Boolean))].sort().reverse()

    return (
        <div className="space-y-6">
            <PageHeader
                title="Akun Siswa"
                subtitle="Kelola data siswa dan akses login"
                backHref="/dashboard/admin"
                icon={<div className="text-violet-500"><Users set="bold" primaryColor="currentColor" size={24} /></div>}
                action={
                    <div className="flex flex-wrap gap-2 justify-end">
                        <Button variant="secondary" onClick={() => setShowFilters(!showFilters)} icon={<Filter set="bold" primaryColor="currentColor" size={20} />}>
                            Filter
                        </Button>
                        <Button variant="secondary" onClick={() => { setBulkResults(null); setShowBulkModal(true); }} icon={<Upload className="w-5 h-5" />}>
                            Upload Massal
                        </Button>
                        <Button onClick={openAdd} icon={<UserPlus set="bold" primaryColor="currentColor" size={20} />}>
                            Tambah Siswa
                        </Button>
                    </div>
                }
            />

            {/* Search Bar */}
            <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary">
                    <SearchIcon className="w-5 h-5 text-slate-400" />
                </div>
                <input
                    type="text"
                    placeholder="Cari berdasarkan nama, NIS, atau username..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 text-sm shadow-sm"
                />
            </div>

            {/* Filters */}
            {showFilters && (
                <Card className="p-4">
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-text-main dark:text-white">Angkatan:</label>
                            <select
                                value={filterAngkatan}
                                onChange={(e) => setFilterAngkatan(e.target.value)}
                                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                                <option value="">Semua</option>
                                {uniqueAngkatan.map(a => (
                                    <option key={a} value={a!}>{a}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-text-main dark:text-white">Level:</label>
                            <select
                                value={filterSchoolLevel}
                                onChange={(e) => setFilterSchoolLevel(e.target.value)}
                                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                                <option value="">Semua</option>
                                <option value="SMP">SMP</option>
                                <option value="SMA">SMA</option>
                            </select>
                        </div>
                        {(filterAngkatan || filterSchoolLevel) && (
                            <button
                                onClick={clearFilters}
                                className="text-sm text-primary hover:underline"
                            >
                                Reset Filter
                            </button>
                        )}
                        <div className="text-sm text-text-secondary ml-auto">
                            Menampilkan {filteredStudents.length} dari {students.length} siswa
                        </div>
                    </div>
                </Card>
            )}

            <Card className="overflow-hidden p-0 bg-transparent border-none shadow-none">
                <div className="flex justify-between items-center mb-4 px-1">
                    <div className="text-sm font-medium text-text-secondary">
                        Total: <span className="text-text-main dark:text-white font-bold">{filteredStudents.length}</span> Siswa
                    </div>
                    {sortedGroups.length > 0 && (
                        <button
                            onClick={toggleAllClasses}
                            className="text-sm font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300 transition-colors"
                        >
                            {expandedClasses.size === sortedGroups.length ? 'Tutup Semua Kelas' : 'Buka Semua Kelas'}
                        </button>
                    )}
                </div>

                {loading ? (
                    <Card className="p-12 flex justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
                    </Card>
                ) : filteredStudents.length === 0 ? (
                    <Card className="p-6">
                        <EmptyState
                            icon={<div className="text-violet-200"><Users set="bold" primaryColor="currentColor" size={48} /></div>}
                            title="Belum Ada Siswa"
                            description={students.length > 0 ? "Tidak ada siswa yang sesuai pencarian atau filter" : "Tambahkan akun siswa untuk memulai"}
                            action={<Button onClick={students.length > 0 ? () => { clearFilters(); setSearchQuery(''); } : openAdd}>{students.length > 0 ? 'Reset Filter' : 'Tambah Siswa'}</Button>}
                        />
                    </Card>
                ) : (
                    <div className="space-y-4">
                        {sortedGroups.map((group) => {
                            const isExpanded = expandedClasses.has(group.name)
                            return (
                                <Card key={group.name} className="overflow-hidden p-0 transition-all duration-200">
                                    <button
                                        onClick={() => toggleClass(group.name)}
                                        className="w-full flex items-center justify-between p-4 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-800/80 transition-colors"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="text-text-secondary transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                                                <ChevronRight set="bold" primaryColor="currentColor" size={20} />
                                            </div>
                                            <div className="text-left">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">{group.name}</h3>
                                                    {group.school_level && group.school_level !== 'Belum Masuk Kelas' && (
                                                        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 border border-violet-200 dark:border-violet-800">
                                                            {group.school_level}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="px-3 py-1 bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 rounded-full text-xs font-bold">
                                                {group.students.length} Siswa
                                            </span>
                                        </div>
                                    </button>

                                    {isExpanded && (
                                        <div className="border-t border-secondary/10 dark:border-white/5">
                                            <div className="overflow-x-auto">
                                                <table className="w-full">
                                                    <thead className="bg-slate-50 dark:bg-slate-800/50">
                                                        <tr>
                                                            <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">Nama</th>
                                                            <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">L/P</th>
                                                            <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">NIS</th>
                                                            <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">Angkatan</th>
                                                            <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">Username</th>
                                                            <th className="px-6 py-3 text-right text-xs font-bold text-text-secondary uppercase tracking-wider">Aksi</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-secondary/10 dark:divide-white/5 bg-white dark:bg-slate-800/20">
                                                        {group.students.map((student) => (
                                                            <tr key={student.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                                                                <td className="px-6 py-3">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold shadow-sm text-xs">
                                                                            {student.user.full_name?.[0] || '?'}
                                                                        </div>
                                                                        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{student.user.full_name || '-'}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-3">
                                                                    {student.gender ? (
                                                                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-sm border ${student.gender === 'L'
                                                                            ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20'
                                                                            : 'bg-pink-50 text-pink-600 border-pink-200 dark:bg-pink-500/10 dark:text-pink-400 dark:border-pink-500/20'
                                                                            }`}>
                                                                            {student.gender === 'L' ? 'L' : 'P'}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-text-secondary dark:text-zinc-500 text-xs">-</span>
                                                                    )}
                                                                </td>
                                                                <td className="px-6 py-3 text-text-secondary dark:text-zinc-400 font-mono text-xs">{student.nis || '-'}</td>
                                                                <td className="px-6 py-3">
                                                                    {student.angkatan ? (
                                                                        <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 text-xs font-medium">
                                                                            <GraduationCap set="light" primaryColor="currentColor" size={12} />
                                                                            {student.angkatan}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-text-secondary dark:text-zinc-500 text-xs">-</span>
                                                                    )}
                                                                </td>
                                                                <td className="px-6 py-3 text-text-secondary dark:text-zinc-400 font-mono text-xs">{student.user.username}</td>
                                                                <td className="px-6 py-3 text-right">
                                                                    <div className="flex items-center justify-end gap-1.5">
                                                                        <Link href={`/dashboard/admin/siswa/${student.id}/rapor`} className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors" title="Rapor">
                                                                            <Paper set="bold" primaryColor="currentColor" size={16} />
                                                                        </Link>
                                                                        <button onClick={() => openEdit(student)} className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors" title="Edit">
                                                                            <Pencil set="bold" primaryColor="currentColor" size={16} />
                                                                        </button>
                                                                        <button onClick={() => handleDelete(student.id)} className="p-1.5 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors" title="Hapus">
                                                                            <Trash2 set="bold" primaryColor="currentColor" size={16} />
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </Card>
                            )
                        })}
                    </div>
                )}
            </Card>

            <Modal
                open={showModal}
                onClose={() => setShowModal(false)}
                title={editingStudent ? 'Edit Siswa' : 'Tambah Siswa'}
            >
                {error && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 text-sm font-medium flex items-center gap-2">
                        <AlertCircle set="bold" primaryColor="currentColor" size={20} />
                        {error}
                    </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Nama Lengkap</label>
                        <input
                            type="text"
                            value={formData.full_name}
                            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-slate-400"
                            placeholder="Nama Lengkap Siswa"
                            required
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">NIS</label>
                            <input
                                type="text"
                                value={formData.nis}
                                onChange={(e) => setFormData({ ...formData, nis: e.target.value })}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-slate-400"
                                placeholder="NIS Siswa"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jenis Kelamin</label>
                            <div className="relative">
                                <select
                                    value={formData.gender}
                                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 appearance-none"
                                >
                                    <option value="">Pilih</option>
                                    <option value="L">Laki-laki</option>
                                    <option value="P">Perempuan</option>
                                </select>
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">▼</div>
                            </div>
                        </div>
                    </div>

                    {/* Angkatan Section */}
                    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="text-amber-600"><GraduationCap set="bold" primaryColor="currentColor" size={20} /></div>
                            <span className="text-sm font-bold text-amber-800 dark:text-amber-200">Informasi Angkatan</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-text-main dark:text-white mb-2">Angkatan</label>
                                <div className="relative">
                                    <select
                                        value={formData.angkatan}
                                        onChange={(e) => setFormData({ ...formData, angkatan: e.target.value, entry_year: e.target.value })}
                                        className="w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 appearance-none"
                                    >
                                        <option value="">Pilih Angkatan</option>
                                        {angkatanOptions.map(year => (
                                            <option key={year} value={year}>{year}</option>
                                        ))}
                                    </select>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">▼</div>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-text-main dark:text-white mb-2">Level Sekolah</label>
                                <div className="relative">
                                    <select
                                        value={formData.school_level}
                                        onChange={(e) => setFormData({ ...formData, school_level: e.target.value })}
                                        className="w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 appearance-none"
                                    >
                                        <option value="">Pilih Level</option>
                                        <option value="SMP">SMP</option>
                                        <option value="SMA">SMA</option>
                                    </select>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">▼</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kelas</label>
                        <div className="relative">
                            <select
                                value={formData.class_id}
                                onChange={(e) => setFormData({ ...formData, class_id: e.target.value })}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 appearance-none"
                            >
                                <option value="">Pilih Kelas</option>
                                {classes
                                    .filter(c => !formData.school_level || c.school_level === formData.school_level)
                                    .map((c) => (
                                        <option key={c.id} value={c.id}>{c.name} {c.school_level ? `(${c.school_level})` : ''}</option>
                                    ))}
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">▼</div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Username</label>
                        <input
                            type="text"
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-slate-400"
                            placeholder="Username login"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">
                            Password {editingStudent && <span className="text-text-secondary font-normal text-xs">(Biarkan kosong jika tidak ingin mengubah)</span>}
                        </label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-slate-400 pr-12"
                                placeholder={editingStudent ? "••••••••" : "Password"}
                                required={!editingStudent}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-text-secondary hover:text-text-main transition-colors"
                            >
                                {showPassword ? (
                                    <EyeOff set="bold" primaryColor="currentColor" size={20} />
                                ) : (
                                    <Eye set="bold" primaryColor="currentColor" size={20} />
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Wali Murid (Parent) Section */}
                    <div className="bg-teal-50 dark:bg-teal-900/10 border border-teal-200 dark:border-teal-800 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-lg">👨‍👩‍👧</span>
                            <span className="text-sm font-bold text-teal-800 dark:text-teal-200">Akses Orang Tua</span>
                        </div>
                        {editingStudent && editingStudent.parent_user_id && (
                            <p className="text-xs text-teal-600 dark:text-teal-400 mb-2 bg-teal-100 dark:bg-teal-900/30 px-3 py-1.5 rounded-lg">
                                ✅ Login wali: <strong>{formData.username}.wali</strong>
                            </p>
                        )}
                        <label className="block text-xs font-medium text-teal-700 dark:text-teal-300 mb-1">
                            Password Wali {editingStudent && <span className="text-text-secondary font-normal">(Kosongkan jika tidak diubah)</span>}
                        </label>
                        <input
                            type="text"
                            value={formData.wali_password}
                            onChange={(e) => setFormData({ ...formData, wali_password: e.target.value })}
                            className="w-full px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 placeholder-slate-400 text-sm"
                            placeholder={editingStudent ? '••••••••' : 'Password untuk orang tua (opsional)'}
                        />
                        {formData.username && formData.wali_password && (
                            <p className="text-[11px] text-teal-600 dark:text-teal-400 mt-1.5">
                                Orang tua akan login dengan username: <strong>{formData.username}.wali</strong>
                            </p>
                        )}

                    </div>

                    <div className="flex gap-3 pt-4 border-t border-secondary/10 mt-4">
                        <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">
                            Batal
                        </Button>
                        <Button type="submit" loading={saving} className="flex-1">
                            Simpan Data
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* Bulk Upload Modal */}
            <Modal
                open={showBulkModal}
                onClose={() => setShowBulkModal(false)}
                title="Upload Massal Siswa"
            >
                {!bulkResults ? (
                    <div className="space-y-6">
                        <div className="p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-xl text-sm">
                            <h4 className="font-bold text-blue-800 dark:text-blue-300 mb-2">Petunjuk Upload</h4>
                            <ul className="list-disc pl-5 space-y-1 text-blue-700 dark:text-blue-400">
                                <li>File harus berupa format <b>.csv</b></li>
                                <li>Pastikan menggunakan template yang telah disediakan</li>
                                <li>Nama Kelas harus <b>sama persis</b> dengan nama kelas di sistem (tidak case-sensitive)</li>
                                <li>Kolom <b>Nama Lengkap</b>, <b>Username</b>, dan <b>Password</b> wajib diisi</li>
                            </ul>
                            <div className="mt-4">
                                <Button variant="secondary" onClick={downloadTemplate} size="sm" icon={<FileDown className="w-4 h-4" />}>
                                    Download Template CSV
                                </Button>
                            </div>
                        </div>

                        <div>
                            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-secondary/30 rounded-xl hover:bg-secondary/5 transition-colors cursor-pointer">
                                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                    <Upload className="w-8 h-8 text-secondary mb-2" />
                                    <p className="mb-2 text-sm text-text-secondary">
                                        <span className="font-bold text-primary">Klik untuk upload</span> atau drag and drop
                                    </p>
                                    <p className="text-xs text-text-secondary/70">CSV (Max. 5MB)</p>
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    className="hidden"
                                    accept=".csv"
                                    onChange={handleFileUpload}
                                    disabled={bulkSaving}
                                />
                            </label>
                            {bulkSaving && (
                                <p className="text-center text-sm text-text-secondary mt-3 animate-pulse">
                                    Sedang memproses data, mohon tunggu...
                                </p>
                            )}
                            {error && (
                                <p className="text-center text-sm text-red-500 mt-3">{error}</p>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <div className="flex gap-4 p-4 bg-secondary/5 rounded-xl border border-secondary/10">
                            <div className="flex-1 text-center">
                                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                                <div className="text-2xl font-bold text-text-main dark:text-white">{bulkResults.success}</div>
                                <div className="text-sm text-text-secondary">Berhasil</div>
                            </div>
                            <div className="w-px bg-secondary/20 my-2"></div>
                            <div className="flex-1 text-center">
                                <XCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                                <div className="text-2xl font-bold text-text-main dark:text-white">{bulkResults.failed}</div>
                                <div className="text-sm text-text-secondary">Gagal</div>
                            </div>
                        </div>

                        {bulkResults.errors.length > 0 && (
                            <div className="max-h-48 overflow-y-auto border border-red-200 dark:border-red-900/30 rounded-lg">
                                <table className="w-full text-sm">
                                    <thead className="bg-red-50 dark:bg-red-900/10 sticky top-0">
                                        <tr>
                                            <th className="px-3 py-2 text-left text-red-800 dark:text-red-400 font-medium">Nama/Username</th>
                                            <th className="px-3 py-2 text-left text-red-800 dark:text-red-400 font-medium">Keterangan Error</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-red-100 dark:divide-red-900/10">
                                        {bulkResults.errors.map((err, i) => (
                                            <tr key={i} className="hover:bg-red-50/50 dark:hover:bg-red-900/5 transition-colors">
                                                <td className="px-3 py-2 text-slate-700 dark:text-slate-300 font-medium">{err.name}</td>
                                                <td className="px-3 py-2 text-red-600 dark:text-red-400">{err.error}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        <div className="pt-2">
                            <Button className="w-full" onClick={() => setShowBulkModal(false)}>
                                Selesai
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    )
}
