'use client'

import { useEffect, useState, useRef } from 'react'
import { Modal, Button, PageHeader, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import { Document as BookOpen, Plus, Edit, Delete, User as Users, Home as School } from 'react-iconly'
import { Loader2, Upload, FileDown, Search as SearchIcon, ChevronRight } from 'lucide-react'
import { Subject } from '@/lib/types'
import { parseSpreadsheet } from '@/lib/parseSpreadsheet'

interface SubjectTeacher {
    teacherName: string
    teacherNip: string | null
    classes: { id: string; name: string; school_level: string; grade_level: number }[]
}

export default function MapelPage() {
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [filteredSubjects, setFilteredSubjects] = useState<Subject[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [editingSubject, setEditingSubject] = useState<Subject | null>(null)
    const [formData, setFormData] = useState({ name: '' })
    const [saving, setSaving] = useState(false)

    // Bulk Upload States
    const [showBulkModal, setShowBulkModal] = useState(false)
    const [bulkSaving, setBulkSaving] = useState(false)
    const [bulkResults, setBulkResults] = useState<{ success: number, failed: number, skipped: number, errors: any[] } | null>(null)
    const [bulkError, setBulkError] = useState('')
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Search
    const [searchQuery, setSearchQuery] = useState('')

    // Detail Modal
    const [detailSubject, setDetailSubject] = useState<Subject | null>(null)
    const [detailTeachers, setDetailTeachers] = useState<SubjectTeacher[]>([])
    const [detailLoading, setDetailLoading] = useState(false)

    // Unique teacher count per subject
    const [teacherCountMap, setTeacherCountMap] = useState<Record<string, number>>({})

    const fetchSubjects = async () => {
        try {
            const res = await fetch('/api/subjects')
            const data = await res.json()
            setSubjects(Array.isArray(data) ? data : [])
        } catch (error) {
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchSubjects()
        // Fetch teaching assignments to compute unique teacher counts
        fetch('/api/teaching-assignments').then(r => r.json()).then(data => {
            if (!Array.isArray(data)) return
            const countMap: Record<string, Set<string>> = {}
            data.forEach((a: any) => {
                const subj = Array.isArray(a.subject) ? a.subject[0] : a.subject
                const teacher = Array.isArray(a.teacher) ? a.teacher[0] : a.teacher
                if (!subj?.id || !teacher?.id) return
                if (!countMap[subj.id]) countMap[subj.id] = new Set()
                countMap[subj.id].add(teacher.id)
            })
            const result: Record<string, number> = {}
            Object.entries(countMap).forEach(([sid, tset]) => { result[sid] = tset.size })
            setTeacherCountMap(result)
        }).catch(() => {})
    }, [])

    useEffect(() => {
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase()
            setFilteredSubjects(subjects.filter(s => s.name.toLowerCase().includes(query)))
        } else {
            setFilteredSubjects(subjects)
        }
    }, [subjects, searchQuery])

    const openDetail = async (subject: Subject) => {
        setDetailSubject(subject)
        setDetailLoading(true)
        setDetailTeachers([])
        try {
            const res = await fetch('/api/teaching-assignments')
            const data = await res.json()
            if (!Array.isArray(data)) return

            // Filter assignments for this subject
            const subjectAssignments = data.filter((a: any) => {
                const subj = Array.isArray(a.subject) ? a.subject[0] : a.subject
                return subj?.id === subject.id
            })

            // Group by teacher
            const teacherMap = new Map<string, SubjectTeacher>()
            subjectAssignments.forEach((a: any) => {
                const teacher = Array.isArray(a.teacher) ? a.teacher[0] : a.teacher
                const cls = Array.isArray(a.class) ? a.class[0] : a.class
                if (!teacher) return
                const tid = teacher.id
                const user = Array.isArray(teacher.user) ? teacher.user[0] : teacher.user
                if (!teacherMap.has(tid)) {
                    teacherMap.set(tid, {
                        teacherName: user?.full_name || user?.username || '-',
                        teacherNip: teacher.nip,
                        classes: []
                    })
                }
                if (cls) {
                    teacherMap.get(tid)!.classes.push({
                        id: cls.id, name: cls.name,
                        school_level: cls.school_level || '',
                        grade_level: cls.grade_level || 0
                    })
                }
            })

            // Sort classes within each teacher
            teacherMap.forEach(t => t.classes.sort((a, b) => a.name.localeCompare(b.name)))
            setDetailTeachers(Array.from(teacherMap.values()).sort((a, b) => a.teacherName.localeCompare(b.teacherName)))
        } catch (err) {
            console.error('Error fetching detail:', err)
        } finally {
            setDetailLoading(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const url = editingSubject ? `/api/subjects/${editingSubject.id}` : '/api/subjects'
            const method = editingSubject ? 'PUT' : 'POST'

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            })

            if (res.ok) {
                setShowModal(false)
                setEditingSubject(null)
                setFormData({ name: '' })
                fetchSubjects()
            } else {
                const err = await res.json()
                alert(err.error || 'Gagal menyimpan mata pelajaran')
            }
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Yakin ingin menghapus mata pelajaran ini?')) return
        await fetch(`/api/subjects/${id}`, { method: 'DELETE' })
        fetchSubjects()
    }

    const openEdit = (subject: Subject) => {
        setEditingSubject(subject)
        setFormData({ name: subject.name })
        setShowModal(true)
    }

    const openAdd = () => {
        setEditingSubject(null)
        setFormData({ name: '' })
        setShowModal(true)
    }

    const downloadTemplate = () => {
        const headers = ['Nama Mapel']
        const mapelStandar = [
            'Matematika',
            'Bahasa Indonesia',
            'Bahasa Inggris',
            'IPA',
            'IPS',
            'PKn',
            'Pendidikan Agama',
            'Seni Budaya',
            'PJOK',
            'Prakarya',
            'Informatika'
        ]
        
        const csvContent = headers.join(',') + '\n' + mapelStandar.join('\n')

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const link = document.createElement('a')
        const url = URL.createObjectURL(blob)
        link.setAttribute('href', url)
        link.setAttribute('download', 'Template_Upload_Mapel.csv')
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setBulkSaving(true)
        setBulkResults(null)
        setBulkError('')

        try {
            const parsedData = await parseSpreadsheet(file)
            
            const payload = parsedData.map((row: any) => ({
                name: row['Nama Mapel'] || row['nama mapel'] || row['Name'] || ''
            })).filter(row => row.name.trim())

            if (payload.length === 0) {
                throw new Error('Tidak ada data valid yang ditemukan. Pastikan kolom bernama "Nama Mapel".')
            }

            const res = await fetch('/api/subjects/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            const responseData = await res.json()

            if (!res.ok) throw new Error(responseData.error || 'Server error')

            let successCount = 0
            let skippedCount = 0
            let failedCount = 0
            const errors: any[] = []

            responseData.results.forEach((r: any) => {
                if (r.success) successCount++
                else if (r.skipped) {
                    skippedCount++
                    errors.push({ name: r.item._normalizedName || r.item.name, error: r.error })
                }
                else {
                    failedCount++
                    errors.push({ name: r.item.name || 'Tidak diketahui', error: r.error })
                }
            })

            setBulkResults({ success: successCount, failed: failedCount, skipped: skippedCount, errors })
            fetchSubjects()
        } catch (err: any) {
            console.error(err)
            setBulkError(err.message || 'Gagal memproses file')
        } finally {
            setBulkSaving(false)
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Mata Pelajaran"
                subtitle="Kelola daftar mata pelajaran sekolah"
                backHref="/dashboard/admin"
                icon={<div className="text-emerald-500"><BookOpen set="bold" primaryColor="currentColor" size={24} /></div>}
                action={
                    <div className="flex flex-wrap gap-2 justify-end">
                        <Button variant="secondary" onClick={() => { setBulkResults(null); setBulkError(''); setShowBulkModal(true); }} icon={<Upload className="w-5 h-5" />}>
                            Upload Massal
                        </Button>
                        <Button onClick={openAdd} icon={<Plus set="bold" primaryColor="currentColor" size={20} />}>
                            Tambah Mapel
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
                    placeholder="Cari mata pelajaran..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-sm shadow-sm"
                />
            </div>

            {/* Counter */}
            {!loading && subjects.length > 0 && (
                <div className="flex items-center justify-between px-1">
                    <div className="text-sm font-medium text-text-secondary">
                        {searchQuery 
                            ? <>Menampilkan <span className="text-text-main dark:text-white font-bold">{filteredSubjects.length}</span> dari <span className="text-text-main dark:text-white font-bold">{subjects.length}</span> mapel</>
                            : <>Total: <span className="text-text-main dark:text-white font-bold">{subjects.length}</span> Mata Pelajaran</>
                        }
                    </div>
                </div>
            )}

            <div className="min-h-[50vh]">
                {loading ? (
                    <div className="p-12 flex justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                ) : filteredSubjects.length === 0 ? (
                    <EmptyState
                        icon={<div className="text-secondary"><BookOpen set="bold" primaryColor="currentColor" size={48} /></div>}
                        title="Belum Ada Mata Pelajaran"
                        description={searchQuery ? "Mata pelajaran yang dicari tidak ditemukan" : "Tambahkan mata pelajaran untuk memulai"}
                        action={!searchQuery ? <Button onClick={openAdd}>Tambah Mapel</Button> : <Button variant="secondary" onClick={() => setSearchQuery('')}>Clear Search</Button>}
                    />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredSubjects.map((subject) => {
                            const uniqueTeacherCount = teacherCountMap[subject.id] || 0;
                            return (
                                <Card key={subject.id} className="group hover:border-emerald-500/50 transition-all hover:shadow-lg cursor-pointer" onClick={() => openDetail(subject)}>
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-900/10 flex items-center justify-center text-xl font-bold text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-500 group-hover:text-white transition-colors flex-shrink-0">
                                            {subject.name[0]}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h3 className="font-bold text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{subject.name}</h3>
                                            <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500 dark:text-slate-400 font-medium">
                                                <Users set="bold" primaryColor="currentColor" size={12} />
                                                <span>{uniqueTeacherCount} Guru Mengajar</span>
                                            </div>
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-slate-300 dark:text-slate-600 group-hover:text-emerald-500 transition-colors flex-shrink-0" />
                                    </div>
                                </Card>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Detail Modal */}
            <Modal
                open={!!detailSubject}
                onClose={() => setDetailSubject(null)}
                title={`📖 ${detailSubject?.name || ''}`}
            >
                <div className="space-y-4">
                    {detailLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                        </div>
                    ) : detailTeachers.length === 0 ? (
                        <div className="text-center py-8">
                            <div className="text-slate-400 mb-2">
                                <Users set="bold" primaryColor="currentColor" size={32} />
                            </div>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Belum ada guru yang mengajar mata pelajaran ini</p>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Assign guru di halaman Penugasan</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="text-sm text-text-secondary font-medium">
                                {detailTeachers.length} Guru Mengajar • {detailTeachers.reduce((sum, t) => sum + t.classes.length, 0)} Total Kelas
                            </div>
                            {detailTeachers.map((teacher, idx) => (
                                <div key={idx} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-700/50">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 flex items-center justify-center text-white font-bold text-sm">
                                            {teacher.teacherName[0]?.toUpperCase() || '?'}
                                        </div>
                                        <div>
                                            <div className="font-bold text-sm text-slate-800 dark:text-white">{teacher.teacherName}</div>
                                            {teacher.teacherNip && (
                                                <div className="text-xs text-slate-500">NIP: {teacher.teacherNip}</div>
                                            )}
                                        </div>
                                        <span className="ml-auto px-2.5 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-bold border border-emerald-500/20">
                                            {teacher.classes.length} Kelas
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {teacher.classes.map((cls) => (
                                            <span
                                                key={cls.id}
                                                className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                                                    cls.school_level === 'SMP'
                                                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                                                        : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20'
                                                }`}
                                            >
                                                {cls.name}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="pt-3 flex gap-3">
                        <Button 
                            variant="secondary" 
                            onClick={() => { setDetailSubject(null); if (detailSubject) openEdit(detailSubject); }} 
                            className="flex-1"
                            icon={<Edit set="bold" primaryColor="currentColor" size={16} />}
                        >
                            Edit Nama
                        </Button>
                        <Button 
                            variant="secondary" 
                            onClick={() => { if (detailSubject) { setDetailSubject(null); handleDelete(detailSubject.id); }}} 
                            className="flex-1 !text-red-600 !border-red-200 hover:!bg-red-50"
                            icon={<Delete set="bold" primaryColor="currentColor" size={16} />}
                        >
                            Hapus
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Single Form Modal */}
            <Modal
                open={showModal}
                onClose={() => setShowModal(false)}
                title={editingSubject ? '✏️ Edit Mata Pelajaran' : '➕ Tambah Mata Pelajaran'}
            >
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Nama Mata Pelajaran</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-slate-400 transition-all"
                            placeholder="Contoh: Matematika"
                            required
                        />
                    </div>
                    <div className="flex gap-3 pt-2">
                        <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">
                            Batal
                        </Button>
                        <Button type="submit" loading={saving} className="flex-1">
                            Simpan Perubahan
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* Bulk Upload Modal */}
            <Modal
                open={showBulkModal}
                onClose={() => !bulkSaving && setShowBulkModal(false)}
                title="📥 Upload Massal Mata Pelajaran"
            >
                <div className="space-y-6">
                    {!bulkResults ? (
                        <>
                            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl text-sm text-blue-800 dark:text-blue-300">
                                <ul className="list-disc pl-4 space-y-1">
                                    <li>Gunakan template CSV yang disediakan</li>
                                    <li>Mapel yang namanya sudah ada akan otomatis dilewati</li>
                                    <li>Pastikan ejaan dan huruf besar/kecil sudah benar (misal: IPA, bukan Ipa)</li>
                                </ul>
                            </div>

                            <Button 
                                type="button" 
                                variant="secondary" 
                                onClick={downloadTemplate}
                                className="w-full"
                                icon={<FileDown className="w-5 h-5" />}
                            >
                                Download Template CSV
                            </Button>

                            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 text-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                                    Pilih atau tarik file ke sini
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
                                    Mendukung file .csv, .xlsx, .xls
                                </p>
                                
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileUpload}
                                    accept=".csv,.xlsx,.xls"
                                    className="hidden"
                                    id="file-upload"
                                    disabled={bulkSaving}
                                />
                                <Button 
                                    onClick={() => fileInputRef.current?.click()} 
                                    loading={bulkSaving}
                                    variant="primary"
                                >
                                    Pilih File
                                </Button>
                            </div>
                            
                            {bulkError && (
                                <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-200">
                                    {bulkError}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
                                <div className="w-12 h-12 bg-green-100 dark:bg-green-800 text-green-600 dark:text-green-300 rounded-full flex items-center justify-center text-xl font-bold">
                                    {bulkResults.success}
                                </div>
                                <div>
                                    <h4 className="font-bold text-green-800 dark:text-green-300">Berhasil Disimpan</h4>
                                    <p className="text-xs text-green-600 dark:text-green-400">Mapel baru telah ditambahkan</p>
                                </div>
                            </div>
                            
                            <div className="flex gap-4">
                                <div className="flex-1 flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
                                    <div className="text-xl font-bold text-slate-600 dark:text-slate-300">
                                        {bulkResults.skipped}
                                    </div>
                                    <div className="text-xs text-slate-500">Dilewati (Sudah ada)</div>
                                </div>
                                <div className="flex-1 flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                                    <div className="text-xl font-bold text-red-600 dark:text-red-400">
                                        {bulkResults.failed}
                                    </div>
                                    <div className="text-xs text-red-500">Gagal Tersimpan</div>
                                </div>
                            </div>

                            {bulkResults.errors.length > 0 && (
                                <div className="mt-4">
                                    <h4 className="font-bold text-sm text-slate-700 dark:text-slate-300 mb-2">Detail Peringatan:</h4>
                                    <div className="max-h-40 overflow-y-auto bg-slate-50 dark:bg-slate-900 rounded-lg p-3 space-y-1 text-xs">
                                        {bulkResults.errors.map((err, i) => (
                                            <div key={i} className="flex gap-2">
                                                <span className="font-bold text-slate-700 dark:text-slate-300 w-1/3 truncate">{err.name}</span>
                                                <span className="text-red-500">{err.error}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="pt-4 flex gap-3">
                                <Button variant="secondary" onClick={() => setBulkResults(null)} className="flex-1">
                                    Upload File Lain
                                </Button>
                                <Button onClick={() => setShowBulkModal(false)} className="flex-1">
                                    Selesai
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    )
}
