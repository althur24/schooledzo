'use client'

import { useEffect, useState, useRef } from 'react'
import { Modal, Button, PageHeader, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import { User as Users, AddUser as UserPlus, Edit as Pencil, Delete as Trash2, Show as Eye, Hide as EyeOff, InfoCircle as AlertCircle, Filter, Document as GraduationCap, Paper, Search, ChevronDown, ChevronRight } from 'react-iconly'
import Link from 'next/link'
import { Loader2, Upload, FileDown, CheckCircle2, XCircle, Search as SearchIcon } from 'lucide-react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { parseSpreadsheet } from '@/lib/parseSpreadsheet'
import { Class, SchoolLevel } from '@/lib/types'

interface FormData {
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
        must_change_password?: boolean
        is_locked?: boolean
    }
    class: { id: string; name: string; grade_level?: number; school_level?: SchoolLevel } | null
}

const defaultFormData: FormData = {
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

// Helper: infer school_level from grade_level
const inferSchoolLevel = (gradeLevel?: number | null): 'SMP' | 'SMA' | null => {
    if (!gradeLevel) return null
    if (gradeLevel >= 7 && gradeLevel <= 9) return 'SMP'
    if (gradeLevel >= 10 && gradeLevel <= 12) return 'SMA'
    return null
}

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
    const [filterPasswordStatus, setFilterPasswordStatus] = useState('')
    const [filterLockStatus, setFilterLockStatus] = useState('')
    const [showFilters, setShowFilters] = useState(false)

    // Accordion State
    const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set())
    const [expandedLevels, setExpandedLevels] = useState<Set<string>>(new Set())

    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: React.ReactNode;
        confirmText: string;
        cancelText: string;
        isDanger: boolean;
        onConfirm: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        confirmText: 'Ya',
        cancelText: 'Tidak',
        isDanger: false,
        onConfirm: () => { }
    })

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
        if (filterPasswordStatus) {
            const isMustChange = filterPasswordStatus === 'belum_ganti'
            filtered = filtered.filter(s => s.user.must_change_password === isMustChange)
        }
        if (filterLockStatus) {
            const isLocked = filterLockStatus === 'terkunci'
            filtered = filtered.filter(s => !!s.user.is_locked === isLocked)
        }
        setFilteredStudents(filtered)

        // Auto-expand groups when searching
        if (searchQuery.trim().length > 0) {
            setExpandedLevels(prev => {
                const next = new Set(prev)
                filtered.forEach(student => {
                    const schoolLevel = student.class?.school_level || 
                        (student.class?.grade_level ? inferSchoolLevel(student.class.grade_level) : null) || 
                        (student.class ? 'Lainnya' : 'Belum Masuk Kelas')
                    next.add(schoolLevel as string)
                })
                return next
            })

            setExpandedClasses(prev => {
                const next = new Set(prev)
                filtered.forEach(student => {
                    const className = student.class?.name || 'Belum Masuk Kelas'
                    next.add(className)
                })
                return next
            })
        }
    }, [students, searchQuery, filterAngkatan, filterSchoolLevel, filterPasswordStatus, filterLockStatus])

    // Grouping by class
    const groupedStudents = filteredStudents.reduce((acc, student) => {
        const className = student.class?.name || 'Belum Masuk Kelas'
        if (!acc[className]) {
            acc[className] = {
                name: className,
                grade_level: student.class?.grade_level || 0,
                school_level: student.class?.school_level || inferSchoolLevel(student.class?.grade_level) || (student.class ? 'Lainnya' : 'Belum Masuk Kelas'),
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

    const toggleLevel = (level: string) => {
        const newExpandedLevels = new Set(expandedLevels)
        if (newExpandedLevels.has(level)) {
            newExpandedLevels.delete(level)
            // also collapse all classes in this level
            const newExpandedClasses = new Set(expandedClasses)
            sortedGroups.filter(g => (g.school_level || 'Belum Masuk Kelas') === level).forEach(g => {
                newExpandedClasses.delete(g.name)
            })
            setExpandedClasses(newExpandedClasses)
        } else {
            newExpandedLevels.add(level)
        }
        setExpandedLevels(newExpandedLevels)
    }

    const levelGroups = sortedGroups.reduce((acc, group) => {
        const level = (group.school_level as string) || 'Belum Masuk Kelas'
        if (!acc[level]) acc[level] = []
        acc[level].push(group)
        return acc
    }, {} as Record<string, typeof sortedGroups>)

    const levelOrder = Object.keys(levelGroups).sort((a, b) => {
        const weightA = a === 'SMP' ? 1 : a === 'SMA' ? 2 : 3
        const weightB = b === 'SMP' ? 1 : b === 'SMA' ? 2 : 3
        if (weightA !== weightB) return weightA - weightB
        return a.localeCompare(b)
    })

    const toggleAllClasses = () => {
        if (expandedClasses.size === sortedGroups.length) {
            setExpandedClasses(new Set())
            setExpandedLevels(new Set())
        } else {
            setExpandedClasses(new Set(sortedGroups.map(g => g.name)))
            setExpandedLevels(new Set(levelOrder))
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

    const handleDelete = (id: string) => {
        setConfirmDialog({
            isOpen: true,
            title: 'Hapus Siswa',
            message: 'Yakin ingin menghapus siswa ini? Data tidak dapat dikembalikan.',
            confirmText: 'Ya, Hapus',
            cancelText: 'Batal',
            isDanger: true,
            onConfirm: async () => {
                setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                try {
                    const res = await fetch(`/api/students/${id}`, { method: 'DELETE' })
                    if (!res.ok) {
                        const data = await res.json()
                        setError(data.error || 'Gagal menghapus siswa')
                        return
                    }
                    setSuccessMessage('Siswa berhasil dihapus')
                    fetchData()
                } catch (err) {
                    setError('Terjadi kesalahan jaringan')
                }
            }
        });
    }

    const handleToggleLock = (id: string, currentStatus: boolean | undefined) => {
        const action = currentStatus ? 'membuka kunci' : 'mengunci'

        setConfirmDialog({
            isOpen: true,
            title: currentStatus ? 'Buka Kunci Akses' : 'Teruskan Kunci Akses',
            message: `Yakin ingin ${action} akun siswa ini beserta akun walinya (jika ada)?`,
            confirmText: 'Ya, Lanjutkan',
            cancelText: 'Batal',
            isDanger: !currentStatus,
            onConfirm: async () => {
                setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                setSaving(true)
                try {
                    const res = await fetch(`/api/students/${id}/lock`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ is_locked: !currentStatus })
                    })

                    if (!res.ok) {
                        const data = await res.json()
                        alert(data.error || `Gagal ${action} akun`)
                    } else {
                        fetchData() // Refresh data
                    }
                } catch (err) {
                    alert(`Terjadi kesalahan saat ${action} akun`)
                } finally {
                    setSaving(false)
                }
            }
        });
    }

    const openEdit = (student: Student) => {
        setEditingStudent(student)
        // Cascade: student.school_level -> class.school_level -> infer from grade_level
        const detectedLevel = student.school_level 
            || student.class?.school_level 
            || inferSchoolLevel(student.class?.grade_level) 
            || ''
        setFormData({
            password: '',
            full_name: student.user.full_name || '',
            nis: student.nis || '',
            class_id: student.class_id || '',
            gender: student.gender || '',
            angkatan: student.angkatan || '',
            entry_year: student.entry_year?.toString() || '',
            school_level: detectedLevel,
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
        setFilterPasswordStatus('')
        setFilterLockStatus('')
    }

    const downloadTemplate = () => {
        const headers = ['Nama Lengkap', 'L/P', 'NIS', 'Angkatan', 'Kelas', 'Password']
        const csvContent = headers.join(',') + '\n' +
            'Muhammad Rizki,L,0012345001,2022,X IPA 1,pass123\n' +
            'Siti Hawa,P,0012345002,2022,X IPS 1,pass123'

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute('download', 'Template_Upload_Siswa.csv')
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    const downloadExcel = () => {
        if (filteredStudents.length === 0) return
        const data = filteredStudents.map((s, i) => ({
            'No': i + 1,
            'Nama Lengkap': s.user.full_name || '-',
            'NIS': s.nis || '-',
            'Jenis Kelamin': s.gender === 'L' ? 'Laki-laki' : s.gender === 'P' ? 'Perempuan' : '-',
            'Jenjang': s.school_level || '-',
            'Kelas': s.class?.name || '-',
            'Angkatan': s.angkatan || '-',
            'Username': s.user.username,
            'Status Password': s.user.must_change_password ? 'Belum Diganti' : 'Sudah Diganti'
        }))
        const ws = XLSX.utils.json_to_sheet(data)
        // Auto-fit column widths
        ws['!cols'] = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length, 15) }))
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Data Siswa')
        const today = new Date().toISOString().split('T')[0]
        XLSX.writeFile(wb, `Data_Siswa_${today}.xlsx`)
    }

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setBulkSaving(true)
        setBulkResults(null)

        try {
            const parsedData = await parseSpreadsheet(file)
            
            const payload = parsedData.map((row: any) => ({
                full_name: row['Nama Lengkap'] || row['nama lengkap'] || '',
                gender: row['L/P']?.toUpperCase() === 'L' || row['L/P']?.toUpperCase() === 'P' ? row['L/P'].toUpperCase() : null,
                nis: row['NIS'] || row['nis'] || row['NISN'] || row['nisn'] || '',
                angkatan: row['Angkatan'] || row['angkatan'] || '',
                kelas: row['Kelas'] || row['kelas'] || '',
                username: row['Username'] || row['username'] || '',  // optional, NIS used if empty
                password: row['Password'] || row['password'] || ''
            }))

            const res = await fetch('/api/students/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            const responseData = await res.json()

            if (!res.ok) throw new Error(responseData.error || 'Server error')

            let successCount = 0
            let failedCount = 0
            const errors: any[] = []

            responseData.results.forEach((r: any) => {
                if (r.success) successCount++
                else {
                    failedCount++
                    errors.push({ name: r.item.full_name || r.item.nis || r.item.username, error: r.error })
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
                        <Button variant="secondary" onClick={downloadExcel} icon={<FileDown className="w-5 h-5" />}>
                            Download Excel
                        </Button>
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
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-text-main dark:text-white">Status Password:</label>
                            <select
                                value={filterPasswordStatus}
                                onChange={(e) => setFilterPasswordStatus(e.target.value)}
                                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                                <option value="">Semua</option>
                                <option value="sudah_ganti">Sudah Ganti</option>
                                <option value="belum_ganti">Belum Ganti</option>
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-text-main dark:text-white">Status Akun:</label>
                            <select
                                value={filterLockStatus}
                                onChange={(e) => setFilterLockStatus(e.target.value)}
                                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                                <option value="">Semua</option>
                                <option value="aktif">Aktif</option>
                                <option value="terkunci">Terkunci</option>
                            </select>
                        </div>
                        {(filterAngkatan || filterSchoolLevel || filterPasswordStatus || filterLockStatus) && (
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
                    <div className="space-y-6">
                        {levelOrder.map((level) => {
                            const isLevelExpanded = expandedLevels.has(level)
                            const levelStudentsCount = levelGroups[level].reduce((sum, g) => sum + g.students.length, 0)
                            const bgColors = level === 'SMP' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800' 
                                            : level === 'SMA' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800'
                                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                            
                            return (
                                <div key={level} className="space-y-3">
                                    {/* Level Card */}
                                    <button 
                                        onClick={() => toggleLevel(level)}
                                        className={`w-full flex items-center justify-between p-4 rounded-2xl border ${bgColors} transition-all hover:brightness-95`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="text-current transition-transform duration-200" style={{ transform: isLevelExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                                                <ChevronRight set="bold" primaryColor="currentColor" size={24} />
                                            </div>
                                            <h2 className="text-xl font-black tracking-tight">{level}</h2>
                                        </div>
                                        <div className="flex items-center gap-2 bg-white/50 dark:bg-black/20 px-4 py-1.5 rounded-full">
                                            <Users set="bold" primaryColor="currentColor" size={16} />
                                            <span className="font-bold text-sm">{levelStudentsCount} Siswa</span>
                                        </div>
                                    </button>

                                    {/* Classes in this level */}
                                    {isLevelExpanded && (
                                        <div className="space-y-3 pl-4 border-l-2 border-slate-100 dark:border-slate-800 ml-4 mt-2">
                                            {levelGroups[level].map((group) => {
                                                const isExpanded = expandedClasses.has(group.name)
                                                return (
                                                    <Card key={group.name} className="overflow-hidden p-0 transition-all duration-200 shadow-sm border-secondary/20">
                                                        <button
                                                            onClick={() => toggleClass(group.name)}
                                                            className="w-full flex items-center justify-between p-4 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-800/80 transition-colors"
                                                        >
                                                            <div className="flex items-center gap-4">
                                                                <div className="text-text-secondary transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                                                                    <ChevronRight set="bold" primaryColor="currentColor" size={20} />
                                                                </div>
                                                                <div className="text-left">
                                                                    <h3 className="text-base font-bold text-slate-800 dark:text-white">{group.name}</h3>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <span className="px-3 py-1 bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 rounded-full text-xs font-bold shadow-sm">
                                                                    {group.students.length} Siswa
                                                                </span>
                                                            </div>
                                                        </button>

                                                        {isExpanded && (
                                                            <div className="border-t border-secondary/10 dark:border-white/5 bg-slate-50/50 dark:bg-slate-800/10">
                                                                <div className="overflow-x-auto">
                                                                    <table className="w-full">
                                                                        <thead className="bg-white dark:bg-slate-800/50 border-b border-secondary/10 dark:border-white/5">
                                                                            <tr>
                                                                                <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider w-12">No</th>
                                                                                <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">Nama</th>
                                                                                <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">L/P</th>
                                                                                <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">NIS</th>
                                                                                <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">Angkatan</th>
                                                                                <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">Username Login</th>
                                                                                <th className="px-6 py-3 text-left text-xs font-bold text-text-secondary uppercase tracking-wider">Status Password</th>
                                                                                <th className="px-6 py-3 text-right text-xs font-bold text-text-secondary uppercase tracking-wider">Aksi</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-secondary/5 dark:divide-white/5">
                                                                            {[...group.students].sort((a, b) => (a.user.full_name || '').localeCompare(b.user.full_name || '', 'id')).map((student, index) => (
                                                                                <tr key={student.id} className={`hover:bg-white dark:hover:bg-slate-800 transition-colors ${student.user.is_locked ? 'opacity-60 bg-red-50/20 dark:bg-red-900/10' : ''}`}>
                                                                                    <td className="px-6 py-3 text-xs font-bold text-text-secondary">{index + 1}</td>
                                                                                    <td className="px-6 py-3">
                                                                                        <div className="flex items-center gap-3">
                                                                                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold shadow-sm text-xs relative flex-shrink-0">
                                                                                                {student.user.full_name?.[0] || '?'}
                                                                                                {student.user.is_locked && (
                                                                                                    <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white dark:border-slate-800 flex items-center justify-center">
                                                                                                        <span className="text-[8px]">🔒</span>
                                                                                                    </div>
                                                                                                )}
                                                                                            </div>
                                                                                            <div className="flex flex-col">
                                                                                                <span className={`text-sm font-bold ${student.user.is_locked ? 'text-red-700 dark:text-red-400 line-through decoration-red-500/50' : 'text-slate-700 dark:text-slate-200'}`}>
                                                                                                    {student.user.full_name || '-'}
                                                                                                </span>
                                                                                                {student.user.is_locked && (
                                                                                                    <span className="text-[10px] font-bold text-red-600 dark:text-red-400 mt-0.5">TERKUNCI</span>
                                                                                                )}
                                                                                            </div>
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
                                                                                    <td className="px-6 py-3">
                                                                                        {student.user.must_change_password ? (
                                                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50 shadow-sm">
                                                                                                <span className="w-1 h-1 rounded-full bg-amber-500 mr-1.5 animate-pulse"></span>
                                                                                                Belum Diganti
                                                                                            </span>
                                                                                        ) : (
                                                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50 shadow-sm">
                                                                                                <span className="w-1 h-1 rounded-full bg-emerald-500 mr-1.5"></span>
                                                                                                Sudah Diganti
                                                                                            </span>
                                                                                        )}
                                                                                    </td>
                                                                                    <td className="px-6 py-3 text-right">
                                                                                        <div className="flex items-center justify-end gap-1.5">
                                                                                            <button
                                                                                                onClick={() => handleToggleLock(student.id, student.user.is_locked)}
                                                                                                className={`p-1.5 rounded-md transition-colors ${student.user.is_locked ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10' : 'text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10'}`}
                                                                                                title={student.user.is_locked ? "Buka Akses Siswa" : "Blokir Akses Siswa"}
                                                                                                disabled={saving}
                                                                                            >
                                                                                                <span className="text-base">{student.user.is_locked ? '🔓' : '🔒'}</span>
                                                                                            </button>
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
                                </div>
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
                                required
                            />
                            <p className="text-xs text-text-secondary mt-1">
                                NIS ini otomatis menjadi username login siswa
                            </p>
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
                                onChange={(e) => {
                                    const selectedClass = classes.find(c => c.id === e.target.value)
                                    const autoLevel = selectedClass?.school_level || inferSchoolLevel(selectedClass?.grade_level) || formData.school_level
                                    setFormData({ ...formData, class_id: e.target.value, school_level: autoLevel })
                                }}
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
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2 flex items-center gap-2">
                            <span>Password {editingStudent && <span className="text-text-secondary font-normal text-xs">(Biarkan kosong jika tidak ingin mengubah)</span>}</span>
                            {editingStudent && (
                                editingStudent.user.must_change_password ? (
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50">
                                        ⚠️ Siswa belum ganti default password
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50">
                                        ✅ Sudah diganti
                                    </span>
                                )
                            )}
                        </label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-slate-400 pr-12"
                                placeholder={editingStudent ? "Ketik untuk reset password..." : "Password Default"}
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
                                ✅ Login wali: <strong>{formData.nis}.wali</strong>
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
                        {formData.nis && formData.wali_password && (
                            <p className="text-[11px] text-teal-600 dark:text-teal-400 mt-1.5">
                                Orang tua akan login dengan username: <strong>{formData.nis}.wali</strong>
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
                                <li>File harus berupa format <b>.csv</b>, <b>.xlsx</b>, atau <b>.xls</b></li>
                                <li>Pastikan menggunakan template yang telah disediakan</li>
                                <li>Nama Kelas harus <b>sama persis</b> dengan nama kelas di sistem (tidak case-sensitive)</li>
                                <li>Kolom <b>Nama Lengkap</b>, <b>NIS</b>, dan <b>Password</b> wajib diisi</li>
                                <li><b>NIS/NISN</b> akan otomatis digunakan sebagai <b>username login</b> siswa</li>
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
                                    <p className="text-xs text-text-secondary/70">Excel atau CSV (Max. 5MB)</p>
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    className="hidden"
                                    accept=".csv,.xlsx,.xls"
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

            {/* Confirmation Modal */}
            <Modal
                open={confirmDialog.isOpen}
                onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                title={confirmDialog.title}
            >
                <div>
                    <p className="text-slate-700 dark:text-slate-300 font-medium">{confirmDialog.message}</p>
                    <div className="flex gap-3 pt-4 border-t border-secondary/10 mt-6">
                        <Button
                            variant="secondary"
                            onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                            className="flex-1"
                        >
                            {confirmDialog.cancelText}
                        </Button>
                        <Button
                            onClick={confirmDialog.onConfirm}
                            className={`flex-1 ${confirmDialog.isDanger ? "bg-red-600 hover:bg-red-700 border-none !text-white" : ""}`}
                        >
                            {confirmDialog.confirmText}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}
