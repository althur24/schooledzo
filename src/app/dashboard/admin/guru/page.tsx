'use client'

import { useEffect, useState, useRef } from 'react'
import { Modal, Button, EmptyState, PageHeader } from '@/components/ui'
import Card from '@/components/ui/Card'
import { UserCheck, UserPlus, Upload, FileDown, CheckCircle2, XCircle, Search, Lock } from 'lucide-react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { parseSpreadsheet } from '@/lib/parseSpreadsheet'

interface Teacher {
    id: string
    nip: string | null
    gender: 'L' | 'P' | null
    user: {
        id: string
        username: string
        full_name: string | null
        must_change_password?: boolean
    }
    teaching_assignments?: {
        id: string
    }[]
}

export default function GuruPage() {
    const [teachers, setTeachers] = useState<Teacher[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [filterGender, setFilterGender] = useState('')
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null)
    const [formData, setFormData] = useState({ username: '', password: '', full_name: '', nip: '', gender: '' })
    const [showPassword, setShowPassword] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')

    // Bulk Upload States
    const [showBulkModal, setShowBulkModal] = useState(false)
    const [bulkSaving, setBulkSaving] = useState(false)
    const [bulkResults, setBulkResults] = useState<{ success: number, failed: number, errors: any[] } | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Delete confirmation state
    const [deleteTarget, setDeleteTarget] = useState<Teacher | null>(null)
    const [deleting, setDeleting] = useState(false)

    const fetchTeachers = async () => {
        try {
            const res = await fetch('/api/teachers')
            const data = await res.json()
            setTeachers(data)
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchTeachers() }, [])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        setError('')
        try {
            const url = editingTeacher ? `/api/teachers/${editingTeacher.id}` : '/api/teachers'
            const method = editingTeacher ? 'PUT' : 'POST'

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            })

            const data = await res.json()

            if (!res.ok) {
                setError(data.error || 'Gagal menyimpan')
                return
            }

            setShowModal(false)
            setEditingTeacher(null)
            setFormData({ username: '', password: '', full_name: '', nip: '', gender: '' })
            fetchTeachers()
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (teacher: Teacher) => {
        setDeleteTarget(teacher)
    }

    const confirmDelete = async () => {
        if (!deleteTarget) return
        setDeleting(true)
        try {
            await fetch(`/api/teachers/${deleteTarget.id}`, { method: 'DELETE' })
            fetchTeachers()
        } finally {
            setDeleting(false)
            setDeleteTarget(null)
        }
    }

    const openEdit = (teacher: Teacher) => {
        setEditingTeacher(teacher)
        setFormData({
            username: teacher.user.username,
            password: '',
            full_name: teacher.user.full_name || '',
            nip: teacher.nip || '',
            gender: teacher.gender || ''
        })
        setError('')
        setShowModal(true)
    }

    const openAdd = () => {
        setEditingTeacher(null)
        setFormData({ username: '', password: '', full_name: '', nip: '', gender: '' })
        setError('')
        setShowModal(true)
    }

    const downloadTemplate = () => {
        const headers = ['Nama Lengkap', 'L/P', 'NIP', 'Username', 'Password']
        const csvContent = headers.join(',') + '\n' +
            'Budi Santoso,L,198001012010011001,budi_guru,pass123\n' +
            'Siti Aminah,P,198502022015022002,siti_guru,pass123'

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute('download', 'Template_Upload_Guru.csv')
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    const downloadExcel = () => {
        if (filteredTeachers.length === 0) return
        const data = filteredTeachers.map((t, i) => ({
            'No': i + 1,
            'Nama Lengkap': t.user.full_name || '-',
            'Jenis Kelamin': t.gender === 'L' ? 'Laki-laki' : t.gender === 'P' ? 'Perempuan' : '-',
            'Username': t.user.username,
            'NIP': t.nip || '-',
            'Jumlah Penugasan': t.teaching_assignments?.length || 0,
            'Status Password': t.user.must_change_password ? 'Belum Diganti' : 'Sudah Diganti'
        }))
        const ws = XLSX.utils.json_to_sheet(data)
        // Auto-fit column widths
        ws['!cols'] = Object.keys(data[0] || {}).map(k => ({ wch: Math.max(k.length, 15) }))
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Data Guru')
        const today = new Date().toISOString().split('T')[0]
        XLSX.writeFile(wb, `Data_Guru_${today}.xlsx`)
    }

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setBulkSaving(true)
        setBulkResults(null)

        try {
            const parsedData = await parseSpreadsheet(file)
            
            // Map headers to payload format
            const payload = parsedData.map((row: any) => ({
                full_name: row['Nama Lengkap'] || row['nama lengkap'] || '',
                gender: row['L/P']?.toUpperCase() === 'L' || row['L/P']?.toUpperCase() === 'P' ? row['L/P'].toUpperCase() : null,
                nip: row['NIP'] || row['nip'] || '',
                username: row['Username'] || row['username'] || '',
                password: row['Password'] || row['password'] || ''
            }))

            const res = await fetch('/api/teachers/bulk', {
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
                    errors.push({ name: r.item.full_name || r.item.username, error: r.error })
                }
            })

            setBulkResults({ success: successCount, failed: failedCount, errors })
            fetchTeachers()
        } catch (err: any) {
            console.error(err)
            setError(err.message || 'Gagal memproses file')
        } finally {
            setBulkSaving(false)
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    const filteredTeachers = teachers.filter(teacher => {
        if (filterGender && teacher.gender !== filterGender) return false
        
        if (!searchQuery) return true
        const query = searchQuery.toLowerCase()
        return teacher.user.full_name?.toLowerCase().includes(query) ||
               teacher.user.username.toLowerCase().includes(query) ||
               teacher.nip?.toLowerCase().includes(query)
    }).sort((a, b) => {
        const nameA = (a.user.full_name || a.user.username).toLowerCase()
        const nameB = (b.user.full_name || b.user.username).toLowerCase()
        return nameA.localeCompare(nameB, 'id')
    })

    return (
        <div className="space-y-6">
            <PageHeader
                title={`Akun Guru${!loading ? ` (${teachers.length})` : ''}`}
                subtitle="Kelola data guru dan akses login"
                backHref="/dashboard/admin"
                icon={<UserCheck className="w-6 h-6 text-blue-500" />}
                action={
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={downloadExcel} icon={<FileDown className="w-5 h-5" />}>
                            Download Excel
                        </Button>
                        <Button variant="secondary" onClick={() => { setBulkResults(null); setShowBulkModal(true); }} icon={<Upload className="w-5 h-5" />}>
                            Upload Massal
                        </Button>
                        <Button onClick={openAdd} icon={<UserPlus className="w-5 h-5" />}>
                            Tambah Guru
                        </Button>
                    </div>
                }
            />

            {/* Search Bar & Filters */}
            <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="relative flex-1 w-full">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary">
                        <Search className="w-5 h-5 text-slate-400" />
                    </div>
                    <input
                        type="text"
                        placeholder="Cari berdasarkan nama, NIP, atau username..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-12 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 text-sm shadow-sm"
                    />
                </div>
                <div className="w-full sm:w-auto flex items-center gap-3">
                    <select
                        value={filterGender}
                        onChange={(e) => setFilterGender(e.target.value)}
                        className="px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                    >
                        <option value="">Semua L/P</option>
                        <option value="L">Laki-laki</option>
                        <option value="P">Perempuan</option>
                    </select>
                </div>
            </div>
            
            {(searchQuery || filterGender) && (
                <div className="text-sm text-text-secondary">
                    Menampilkan <span className="font-bold text-text-main dark:text-white">{filteredTeachers.length}</span> dari {teachers.length} guru
                </div>
            )}

            <Card className="overflow-hidden p-0">
                {loading ? (
                    <div className="p-12 flex justify-center">
                        <div className="animate-spin text-primary"><UserCheck className="w-8 h-8" /></div>
                    </div>
                ) : teachers.length === 0 ? (
                    <div className="p-6">
                        <EmptyState
                            icon={<UserCheck className="w-12 h-12 text-secondary" />}
                            title="Belum Ada Guru"
                            description="Tambahkan akun guru untuk memulai"
                            action={<Button onClick={openAdd}>Tambah Guru</Button>}
                        />
                    </div>
                ) : filteredTeachers.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Search className="w-8 h-8 text-slate-400" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Guru tidak ditemukan</h3>
                        <p className="text-slate-500 dark:text-slate-400">Tidak ada guru yang cocok dengan kata kunci "{searchQuery}"</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-secondary/10 dark:bg-white/5 border-b border-secondary/20">
                                <tr>
                                    <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider w-16">No</th>
                                    <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Nama</th>
                                    <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">L/P</th>
                                    <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Username</th>
                                    <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">NIP</th>
                                    <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Status Password</th>
                                    <th className="px-6 py-4 text-left text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Penugasan</th>
                                    <th className="px-6 py-4 text-right text-sm font-bold text-text-main dark:text-white uppercase tracking-wider">Aksi</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-secondary/20 dark:divide-white/5">
                                {filteredTeachers.map((teacher, index) => (
                                    <tr key={teacher.id} className="hover:bg-secondary/5 transition-colors">
                                        <td className="px-6 py-4 text-sm font-bold text-text-secondary">{index + 1}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 flex items-center justify-center text-white font-bold shadow-sm text-sm">
                                                    {teacher.user.full_name?.[0] || '?'}
                                                </div>
                                                <span className="text-text-main dark:text-white font-bold">{teacher.user.full_name || '-'}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {teacher.gender ? (
                                                <span className={`px-2.5 py-1 text-xs font-bold rounded-full border ${teacher.gender === 'L'
                                                    ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20'
                                                    : 'bg-pink-50 text-pink-600 border-pink-200 dark:bg-pink-500/10 dark:text-pink-400 dark:border-pink-500/20'
                                                    }`}>
                                                    {teacher.gender === 'L' ? '👨 Laki-laki' : '👩 Perempuan'}
                                                </span>
                                            ) : (
                                                <span className="text-text-secondary dark:text-zinc-500">-</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-text-secondary dark:text-zinc-300 font-mono text-sm">{teacher.user.username}</td>
                                        <td className="px-6 py-4 text-text-secondary dark:text-zinc-300">{teacher.nip || '-'}</td>
                                        <td className="px-6 py-4">
                                            {teacher.user.must_change_password ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200/50 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">
                                                    <Lock className="w-3.5 h-3.5" />
                                                    Belum Diganti
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/50 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                    Sudah Diganti
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            {teacher.teaching_assignments && teacher.teaching_assignments.length > 0 ? (
                                                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20">
                                                    {teacher.teaching_assignments.length} Kelas
                                                </span>
                                            ) : (
                                                <span className="text-text-secondary dark:text-zinc-500 text-xs">-</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button onClick={() => openEdit(teacher)} className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 flex items-center justify-center transition-colors">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                </button>
                                                <button onClick={() => handleDelete(teacher)} className="w-8 h-8 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500/20 flex items-center justify-center transition-colors">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            <Modal
                open={showModal}
                onClose={() => setShowModal(false)}
                title={editingTeacher ? '✏️ Edit Guru' : '➕ Tambah Guru'}
            >
                {error && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 text-sm font-medium flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
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
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            placeholder="Nama Lengkap Guru"
                            required
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">NIP</label>
                            <input
                                type="text"
                                value={formData.nip}
                                onChange={(e) => setFormData({ ...formData, nip: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                                placeholder="NIP (Opsi)"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jenis Kelamin</label>
                            <div className="relative">
                                <select
                                    value={formData.gender}
                                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                                    className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
                                >
                                    <option value="">Pilih</option>
                                    <option value="L">Laki-laki</option>
                                    <option value="P">Perempuan</option>
                                </select>
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">▼</div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Username</label>
                        <input
                            type="text"
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            placeholder="Username untuk login"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">
                            Password {editingTeacher && <span className="text-text-secondary font-normal text-xs">(Biarkan kosong jika tidak ingin mengubah)</span>}
                        </label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50 pr-12"
                                placeholder={editingTeacher ? "••••••••" : "Password"}
                                required={!editingTeacher}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-text-secondary hover:text-text-main transition-colors"
                            >
                                {showPassword ? (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                )}
                            </button>
                        </div>
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
                title="Upload Massal Guru"
            >
                {!bulkResults ? (
                    <div className="space-y-6">
                        <div className="p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-xl text-sm">
                            <h4 className="font-bold text-blue-800 dark:text-blue-300 mb-2">Petunjuk Upload</h4>
                            <ul className="list-disc pl-5 space-y-1 text-blue-700 dark:text-blue-400">
                                <li>File harus berupa format <b>.csv</b>, <b>.xlsx</b>, atau <b>.xls</b></li>
                                <li>Pastikan menggunakan template yang telah disediakan</li>
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

            {/* Delete Confirmation Modal */}
            <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Hapus Guru">
                <div className="space-y-4">
                    <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/30">
                        <p className="text-sm text-red-800 dark:text-red-300">
                            Apakah Anda yakin ingin menghapus guru <strong>{deleteTarget?.user.full_name || deleteTarget?.user.username}</strong>?
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                            Semua data terkait guru ini (penugasan kelas, jadwal, dll) akan ikut terhapus. Tindakan ini tidak dapat dibatalkan.
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" className="flex-1" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                            Batal
                        </Button>
                        <button
                            onClick={confirmDelete}
                            disabled={deleting}
                            className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-bold text-sm rounded-xl transition-colors disabled:opacity-60"
                        >
                            {deleting ? 'Menghapus...' : 'Ya, Hapus'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}
