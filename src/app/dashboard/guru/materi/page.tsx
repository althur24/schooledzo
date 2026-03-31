'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Modal, Button, EmptyState, Toast, type ToastType, PageHeader } from '@/components/ui'
import Card from '@/components/ui/Card'
import { Document as BookOpen, Paper as FileText, Video, Document as Type, Discovery as LinkIcon, Plus, Show as Eye, Delete as Trash, Download, ArrowRight, TickSquare as CheckCircle, Danger as AlertTriangle } from 'react-iconly'
import { Loader2, WifiOff, CheckSquare } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
    formatToOfflineMaterial,
    saveMaterialOffline,
    getAllOfflineMaterials,
    getBlobOffline,
    removeMaterialOffline
} from '@/lib/offlineMateri'

interface TeachingAssignment {
    id: string
    subject: { id: string; name: string }
    class: { name: string }
}

interface Material {
    id: string
    title: string
    description: string | null
    type: string
    content_url: string | null
    content_text: string | null
    created_at: string

    teaching_assignment: TeachingAssignment

}

interface SubjectGroup {
    subjectId: string
    subjectName: string
    classes: string[]
    materials: Material[]
}

export default function MateriPage() {
    const { user } = useAuth()
    const [materials, setMaterials] = useState<Material[]>([])
    const [assignments, setAssignments] = useState<TeachingAssignment[]>([])
    const [groupedSubjects, setGroupedSubjects] = useState<SubjectGroup[]>([])
    const [selectedSubject, setSelectedSubject] = useState<SubjectGroup | null>(null)
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [formData, setFormData] = useState({
        teaching_assignment_id: '',
        title: '',
        description: '',
        type: 'TEXT',
        content_url: '',
        content_text: ''
    })
    const [saving, setSaving] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)
    const [file, setFile] = useState<File | null>(null)

    const [previewingPDF, setPreviewingPDF] = useState<string | null>(null)
    const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null)

    // Offline Mode States
    const [isOffline, setIsOffline] = useState(false)
    const [savedMaterials, setSavedMaterials] = useState<Set<string>>(new Set())
    const [savingStates, setSavingStates] = useState<Record<string, boolean>>({})
    const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null)
    const [viewingMaterialText, setViewingMaterialText] = useState<Material | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

    useEffect(() => {
        const handleOnline = () => setIsOffline(false)
        const handleOffline = () => setIsOffline(true)

        setIsOffline(!navigator.onLine)
        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        const loadSavedMaterials = async () => {
            const saved = await getAllOfflineMaterials()
            setSavedMaterials(new Set(saved.map(m => m.id)))
        }
        loadSavedMaterials()

        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
        }
    }, [])

    useEffect(() => {
        const currentUrl = previewPdfUrl
        return () => {
            if (currentUrl && currentUrl.startsWith('blob:')) {
                URL.revokeObjectURL(currentUrl)
            }
        }
    }, [previewPdfUrl])

    const fetchData = async () => {
        try {
            if (!navigator.onLine) {
                throw new Error('Offline')
            }

            const [assignmentsRes, materialsRes] = await Promise.all([
                fetch('/api/my-teaching-assignments'),
                fetch('/api/materials')
            ])
            const [assignmentsData, materialsData] = await Promise.all([
                assignmentsRes.json(),
                materialsRes.json()
            ])

            const validAssignments = Array.isArray(assignmentsData) ? assignmentsData : []
            const validMaterials = Array.isArray(materialsData) ? materialsData : []

            setAssignments(validAssignments)
            setMaterials(validMaterials)

            const groups: Record<string, SubjectGroup> = {}
            validAssignments.forEach((a: TeachingAssignment) => {
                const subjectId = a.subject.id
                if (!groups[subjectId]) {
                    groups[subjectId] = {
                        subjectId,
                        subjectName: a.subject.name,
                        classes: [],
                        materials: []
                    }
                }
                if (!groups[subjectId].classes.includes(a.class.name)) {
                    groups[subjectId].classes.push(a.class.name)
                }
            })

            validMaterials.forEach((m: Material) => {
                const subjectId = m.teaching_assignment?.subject?.id
                if (subjectId && groups[subjectId]) {
                    groups[subjectId].materials.push(m)
                }
            })

            setGroupedSubjects(Object.values(groups))
            return Object.values(groups)
        } catch (error) {
            console.error('Error or Offline:', error)
            setIsOffline(true)
            const offlineMats = await getAllOfflineMaterials()
            const groups: Record<string, SubjectGroup> = {}
            offlineMats.forEach(om => {
                const subjectName = om.subjectName || 'Lainnya'
                const subjectId = `offline-${subjectName}`
                if (!groups[subjectId]) {
                    groups[subjectId] = {
                        subjectId,
                        subjectName,
                        classes: om.className ? [om.className] : [],
                        materials: []
                    }
                } else if (om.className && !groups[subjectId].classes.includes(om.className)) {
                    groups[subjectId].classes.push(om.className)
                }
                groups[subjectId].materials.push({
                     id: om.id,
                     title: om.title,
                     description: om.description,
                     type: om.type,
                     content_url: om.content_url,
                     content_text: om.content_text,
                     created_at: om.savedAt,
                     teaching_assignment: {
                          id: 'offline',
                          subject: { id: subjectId, name: subjectName },
                          class: { name: om.className || '' }
                     }
                })
            })
            setAssignments([]) 
            setGroupedSubjects(Object.values(groups))
            return Object.values(groups)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (user) fetchData()
    }, [user, isOffline])

    const [videoSource, setVideoSource] = useState<'UPLOAD' | 'YOUTUBE'>('YOUTUBE')

    const handleToggleOffline = async (material: Material) => {
        const isSaved = savedMaterials.has(material.id)

        if (isSaved) {
            await removeMaterialOffline(material.id)
            setSavedMaterials(prev => {
                const next = new Set(prev)
                next.delete(material.id)
                return next
            })
            return
        }

        if (isOffline) return

        setSavingStates(prev => ({ ...prev, [material.id]: true }))
        try {
            const isPdf = material.type === 'PDF' && material.content_url
            const offlineData = formatToOfflineMaterial(
                material,
                material.teaching_assignment?.subject?.name || 'Lainnya',
                material.teaching_assignment?.class?.name || '',
                isPdf ? true : false
            )

            let blob: Blob | undefined
            if (isPdf) {
                const response = await fetch(material.content_url!)
                if (!response.ok) throw new Error('Failed to fetch PDF')
                blob = await response.blob()
            }

            await saveMaterialOffline(offlineData, blob)

            setSavedMaterials(prev => {
                const next = new Set(prev)
                next.add(material.id)
                return next
            })
            setToast({ message: 'Materi disimpan ke perangkat', type: 'success' })
        } catch (error) {
            console.error('Save offline error:', error)
            setToast({ message: 'Gagal menyimpan materi offline', type: 'error' })
        } finally {
            setSavingStates(prev => ({ ...prev, [material.id]: false }))
        }
    }

    const handlePreviewPDF = async (material: Material) => {
        if (previewPdfUrl && previewPdfUrl.startsWith('blob:')) {
            URL.revokeObjectURL(previewPdfUrl)
        }

        if (savedMaterials.has(material.id)) {
            const offlineBlob = await getBlobOffline(material.id)
            if (offlineBlob && offlineBlob.data) {
                const blobUrl = URL.createObjectURL(offlineBlob.data)
                setPreviewPdfUrl(blobUrl)
                setPreviewingPDF(material.id)
                return
            }
        }
        
        if (isOffline) return

        if (material.content_url) {
            setPreviewPdfUrl(material.content_url)
            setPreviewingPDF(material.id)
        }
    }

    // Helper to get YouTube Embed URL
    const getYouTubeEmbedUrl = (url: string) => {
        try {
            if (!url) return null
            // Handle standard youtube.com/watch?v=ID
            let videoId = ''
            if (url.includes('youtube.com/watch')) {
                const urlParams = new URLSearchParams(new URL(url).search)
                videoId = urlParams.get('v') || ''
            } else if (url.includes('youtu.be/')) {
                // Handle youtu.be/ID
                videoId = url.split('youtu.be/')[1]?.split('?')[0] || ''
            } else if (url.includes('youtube.com/embed/')) {
                // Already an embed link
                return url
            }

            if (videoId) {
                return `https://www.youtube.com/embed/${videoId}`
            }
            return null
        } catch (e) {
            return null
        }
    }

    const uploadFile = async (file: File, onProgress: (percent: number) => void): Promise<{ url: string }> => {
        try {
            const signRes = await fetch('/api/materials/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: file.name,
                    contentType: file.type
                })
            })

            if (!signRes.ok) {
                const err = await signRes.json()
                throw new Error(err.error || 'Failed to get upload token')
            }

            const { path, token } = await signRes.json()

            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest()
                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
                const uploadUrl = `${supabaseUrl}/storage/v1/object/upload/sign/materials/${path}?token=${token}`

                xhr.open('PUT', uploadUrl)
                xhr.setRequestHeader('Content-Type', file.type)

                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percentComplete = Math.round((event.loaded / event.total) * 100)
                        onProgress(percentComplete)
                    }
                }

                xhr.onload = async () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        const { data: { publicUrl } } = supabase.storage
                            .from('materials')
                            .getPublicUrl(path)

                        resolve({ url: publicUrl })
                    } else {
                        reject(new Error(`Upload failed with status ${xhr.status}`))
                    }
                }

                xhr.onerror = () => reject(new Error('Network error during upload'))
                xhr.send(file)
            })
        } catch (error) {
            console.error('Upload error:', error)
            throw error
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        // Close modal immediately so user can see the progress
        setShowModal(false)
        setSaving(true)
        setUploadProgress(0)

        try {
            let finalContentUrl = formData.content_url
            let finalContentText = formData.content_text

            // Handle PDF Upload
            if (formData.type === 'PDF' && file) {
                const { url } = await uploadFile(file, setUploadProgress)
                finalContentUrl = url
            }
            // Handle Video Upload
            else if (formData.type === 'VIDEO' && videoSource === 'UPLOAD' && file) {
                const { url } = await uploadFile(file, setUploadProgress)
                finalContentUrl = url
            }

            const res = await fetch('/api/materials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    content_url: finalContentUrl,
                    content_text: finalContentText
                })
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Gagal menyimpan materi')
            }

            setToast({ message: 'Materi berhasil disimpan!', type: 'success' })
            setFormData({
                teaching_assignment_id: '',
                title: '',
                description: '',
                type: 'TEXT',
                content_url: '',
                content_text: ''
            })
            setFile(null)
            setVideoSource('YOUTUBE') // Reset default
            // Refresh data and update selectedSubject so the list re-renders immediately
            const freshGroups = await fetchData()
            if (selectedSubject && freshGroups) {
                const updated = freshGroups.find((g: SubjectGroup) => g.subjectId === selectedSubject.subjectId)
                if (updated) setSelectedSubject(updated)
            }
        } catch (error: any) {
            setToast({ message: error.message, type: 'error' })
        } finally {
            setSaving(false)
            setUploadProgress(0)
        }
    }



    const getTypeLabel = (type: string) => {
        switch (type) {
            case 'TEXT': return Type
            case 'VIDEO': return Video
            case 'PDF': return FileText
            case 'LINK': return LinkIcon
            default: return FileText
        }
    }

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'TEXT': return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400' }
            case 'VIDEO': return { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400' }
            case 'PDF': return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400' }
            case 'LINK': return { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-600 dark:text-cyan-400' }
            default: return { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' }
        }
    }

    const handleDelete = async (id: string) => {
        setDeleteTarget(null)

        try {
            const res = await fetch(`/api/materials/${id}`, {
                method: 'DELETE'
            })

            if (!res.ok) throw new Error('Gagal menghapus materi')

            setToast({ message: 'Materi berhasil dihapus', type: 'success' })
            const freshGroups = await fetchData()
            if (selectedSubject && freshGroups) {
                const updated = freshGroups.find((g: SubjectGroup) => g.subjectId === selectedSubject.subjectId)
                if (updated) setSelectedSubject(updated)
            }
        } catch (error) {
            setToast({ message: 'Gagal menghapus materi', type: 'error' })
        }
    }

    const handleAddMaterial = () => {
        if (assignments.length === 0) {
            setToast({ message: 'Anda belum memiliki kelas ajar. Hubungi Admin.', type: 'error' })
            return
        }
        setShowModal(true)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="animate-spin text-primary"><Loader2 className="w-10 h-10" /></div>
            </div>
        )
    }

    if (assignments.length === 0 && !isOffline) {
        return (
            <EmptyState
                icon={<div className="text-secondary"><BookOpen set="bold" primaryColor="currentColor" size={48} /></div>}
                title="Belum Ada Penugasan"
                description="Anda belum ditugaskan di kelas manapun. Hubungi Administrator."
            />
        )
    }

    if (!selectedSubject) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                    <PageHeader
                        title="Materi Pembelajaran"
                        subtitle="Pilih mata pelajaran untuk mengelola materi"
                        backHref="/dashboard/guru"
                    />
                    
                    {isOffline && (
                        <div className="flex items-center gap-2 bg-red-100/50 text-red-600 px-4 py-2 rounded-xl font-bold border border-red-200 mt-6">
                            <WifiOff size={20} />
                            <span className="hidden sm:inline">Mode Offline - Hanya materi tersimpan yang dapat diakses</span>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {groupedSubjects.map((subject) => (
                        <Card
                            key={subject.subjectId}
                            className="group cursor-pointer hover:border-primary/50 transition-all hover:scale-[1.02]"
                        >
                            <div onClick={() => setSelectedSubject(subject)}>
                                <div className="flex items-center gap-4 mb-4">
                                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                                        <BookOpen set="bold" primaryColor="currentColor" size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-text-main dark:text-white group-hover:text-primary transition-colors">{subject.subjectName}</h3>
                                        <p className="text-sm text-text-secondary dark:text-[#A8BC9F]">{subject.classes.join(', ')}</p>
                                    </div>
                                </div>
                                <div className="border-t border-secondary/10 dark:border-white/5 pt-4 flex justify-between items-center text-sm text-text-secondary dark:text-[#A8BC9F]">
                                    <span>{subject.materials.length} Materi</span>
                                    <span className="text-primary font-medium group-hover:underline">Buka Folder →</span>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <PageHeader
                    title={selectedSubject.subjectName}
                    subtitle={`${selectedSubject.materials.length} file tersedia${isOffline ? ' (Offline)' : ''}`}
                    onBack={() => setSelectedSubject(null)}
                    action={
                        <Button disabled={isOffline} onClick={handleAddMaterial} icon={
                            <div className="text-white"><Plus set="bold" primaryColor="currentColor" size={20} /></div>
                        }>
                            Tambah Materi
                        </Button>
                    }
                />
                {isOffline && (
                    <div className="flex items-center gap-2 bg-red-100 text-red-600 px-4 py-2 rounded-xl font-bold border border-red-200">
                        <WifiOff size={20} />
                        <span className="text-sm">Tambah/Hapus dinonaktifkan</span>
                    </div>
                )}
            </div>

            {selectedSubject.materials.length === 0 ? (
                <EmptyState
                    icon={<div className="text-secondary"><FileText set="bold" primaryColor="currentColor" size={48} /></div>}
                    title="Folder Kosong"
                    description={`Belum ada materi untuk ${selectedSubject.subjectName}`}
                    action={<Button onClick={handleAddMaterial}>Upload Materi Pertama</Button>}
                />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedSubject.materials.map((material) => (
                        <Card key={material.id} className="hover:shadow-lg transition-shadow border-l-4 border-l-primary/0 hover:border-l-primary">
                            <div className="flex items-start gap-3">
                                {(() => {
                                    const IconComponent = getTypeLabel(material.type)
                                    const colors = getTypeColor(material.type)
                                    return (
                                        <div className={`w-12 h-12 rounded-xl ${colors.bg} flex items-center justify-center flex-shrink-0`}>
                                            <div className={colors.text}><IconComponent set="bold" primaryColor="currentColor" size={24} /></div>
                                        </div>
                                    )
                                })()}
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-bold text-text-main dark:text-white mb-1 truncate">{material.title}</h3>
                                    <p className="text-sm text-text-secondary dark:text-[#A8BC9F] mb-3 line-clamp-2">{material.description || 'Tidak ada deskripsi'}</p>

                                    {/* Video Player Embed */}
                                    {material.type === 'VIDEO' && material.content_url && (
                                        <div className="mb-3 rounded-xl overflow-hidden bg-black/5 dark:bg-black/20 aspect-video relative group">
                                            {getYouTubeEmbedUrl(material.content_url) ? (
                                                <iframe
                                                    src={getYouTubeEmbedUrl(material.content_url)!}
                                                    className="w-full h-full"
                                                    allowFullScreen
                                                    title={material.title}
                                                />
                                            ) : (
                                                <video
                                                    src={material.content_url}
                                                    controls
                                                    className="w-full h-full"
                                                    preload="metadata"
                                                />
                                            )}
                                        </div>
                                    )}

                                    <div className="flex flex-wrap items-center gap-2 mb-4">
                                        <span className="px-2.5 py-1 bg-secondary/10 text-text-secondary text-xs rounded-full font-medium border border-secondary/20">
                                            {material.teaching_assignment?.class?.name}
                                        </span>

                                    </div>

                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-secondary/10 dark:border-white/5 pt-3 mt-3">
                                        {material.type === 'TEXT' ? (
                                            <>
                                                <button
                                                    onClick={() => setViewingMaterialText(material)}
                                                    className="text-xs font-bold text-primary-dark dark:text-primary hover:text-text-main transition-colors flex items-center gap-1"
                                                >
                                                    <span className="text-primary"><Eye set="bold" primaryColor="currentColor" size={16} /></span> Baca
                                                </button>
                                                <span className="text-secondary/30 hidden sm:inline">|</span>
                                            </>
                                        ) : material.type === 'PDF' && material.content_url ? (
                                            <>
                                                <button
                                                    onClick={() => handlePreviewPDF(material)}
                                                    disabled={isOffline && !savedMaterials.has(material.id)}
                                                    className={`text-xs font-bold transition-colors flex items-center gap-1 ${isOffline && !savedMaterials.has(material.id) ? 'text-secondary/50 cursor-not-allowed' : 'text-primary-dark dark:text-primary hover:text-text-main'}`}
                                                >
                                                    <span className="text-primary"><Eye set="bold" primaryColor="currentColor" size={16} /></span> Preview
                                                </button>
                                                <span className="text-secondary/30 hidden sm:inline">|</span>
                                                <a
                                                    href={material.content_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className={`text-xs font-bold transition-colors flex items-center gap-1 ${isOffline && !savedMaterials.has(material.id) ? 'text-secondary/50 pointer-events-none' : 'text-text-secondary hover:text-text-main'}`}
                                                    onClick={(e) => { if(isOffline && !savedMaterials.has(material.id)) e.preventDefault() }}
                                                >
                                                    <span className={isOffline && !savedMaterials.has(material.id) ? "text-secondary/50" : "text-text-secondary"}><Download set="bold" primaryColor="currentColor" size={16} /></span> File Asli
                                                </a>
                                                <span className="text-secondary/30 hidden sm:inline">|</span>
                                            </>
                                        ) : material.content_url && material.type !== 'VIDEO' && (
                                            <>
                                                <a
                                                    href={material.content_url}
                                                    target={isOffline && !savedMaterials.has(material.id) ? "_self" : "_blank"}
                                                    rel="noopener noreferrer"
                                                    className={`text-xs font-bold transition-colors flex items-center gap-1 ${isOffline && !savedMaterials.has(material.id) ? 'text-secondary/50 cursor-not-allowed pointer-events-none' : 'text-primary hover:underline'}`}
                                                    onClick={(e) => { if (isOffline && !savedMaterials.has(material.id)) e.preventDefault() }}
                                                >
                                                    <span className="text-primary"><ArrowRight set="bold" primaryColor="currentColor" size={16} /></span> Buka Link
                                                </a>
                                                <span className="text-secondary/30 hidden sm:inline">|</span>
                                            </>
                                        )}
                                        {/* Offline Toggle — only for PDF and TEXT */}
                                        {(material.type === 'PDF' || material.type === 'TEXT') && (
                                        <button
                                            onClick={() => handleToggleOffline(material)}
                                            disabled={savingStates[material.id] || (isOffline && !savedMaterials.has(material.id))}
                                            className={`text-xs font-bold transition-colors flex items-center gap-1 ${savingStates[material.id] ? 'text-secondary/50 cursor-not-allowed' : savedMaterials.has(material.id) ? 'text-green-600 hover:text-red-500 group relative' : isOffline ? 'text-secondary/50 cursor-not-allowed' : 'text-text-secondary hover:text-primary'}`}
                                            title={savedMaterials.has(material.id) ? 'Hapus Offline (Tersimpan)' : 'Offlinekan Materi'}
                                        >
                                            {savingStates[material.id] ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : savedMaterials.has(material.id) ? (
                                                <><span className="text-green-600 flex group-hover:hidden items-center gap-1"><CheckSquare size={16} /> Tersimpan</span><span className="hidden group-hover:flex items-center gap-1"><Trash set="bold" primaryColor="currentColor" size={16} /> Hapus Offline</span></>
                                            ) : (
                                                <><span className="text-text-secondary"><Download set="bold" primaryColor="currentColor" size={16} /></span> Offlinekan Materi</>
                                            )}
                                        </button>
                                        )}

                                        <div className="flex-1 min-w-[20px]"></div>
                                        <button
                                            onClick={() => setDeleteTarget(material.id)}
                                            disabled={isOffline}
                                            className={`text-xs font-bold transition-colors flex items-center gap-1 ${isOffline ? 'text-red-500/30 cursor-not-allowed' : 'text-red-500/70 hover:text-red-600'}`}
                                        >
                                            <span className={isOffline ? 'text-red-500/30' : 'text-red-500'}><Trash set="bold" primaryColor="currentColor" size={16} /></span> Hapus Materi
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            <Modal open={showModal} onClose={() => setShowModal(false)} title="Tambah Materi Baru">
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kelas & Mata Pelajaran</label>
                        <div className="relative">
                            <select
                                value={formData.teaching_assignment_id}
                                onChange={(e) => setFormData({ ...formData, teaching_assignment_id: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
                                required
                            >
                                <option value="">Pilih Target Kelas...</option>
                                {assignments.map((a) => (
                                    <option key={a.id} value={a.id}>{a.class.name} - {a.subject.name}</option>
                                ))}
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">
                                ▼
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Judul Materi</label>
                        <input
                            type="text"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            placeholder="Contoh: Bab 1 - Pengenalan Aljabar"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Deskripsi Singkat</label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder-text-secondary/50"
                            rows={2}
                            placeholder="Jelaskan sedikit tentang materi ini..."
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe Konten</label>
                        <div className="grid grid-cols-4 gap-2">
                            {['TEXT', 'LINK', 'PDF', 'VIDEO'].map((type) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, type })}
                                    className={`
                                        py-2 rounded-lg text-sm font-bold transition-all
                                        ${formData.type === type
                                            ? 'bg-primary text-white shadow-soft'
                                            : 'bg-secondary/10 text-text-secondary hover:bg-secondary/20'}
                                    `}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>

                    {formData.type === 'VIDEO' ? (
                        <div className="space-y-4">
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setVideoSource('YOUTUBE')}
                                    className={`flex-1 py-2 text-xs font-bold rounded-lg border ${videoSource === 'YOUTUBE' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 text-red-600' : 'border-transparent text-text-secondary hover:bg-secondary/5'}`}
                                >
                                    YouTube Link
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setVideoSource('UPLOAD')}
                                    className={`flex-1 py-2 text-xs font-bold rounded-lg border ${videoSource === 'UPLOAD' ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 text-blue-600' : 'border-transparent text-text-secondary hover:bg-secondary/5'}`}
                                >
                                    Upload Video
                                </button>
                            </div>

                            {videoSource === 'YOUTUBE' ? (
                                <div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Link YouTube</label>
                                    <input
                                        type="url"
                                        value={formData.content_url || ''}
                                        onChange={(e) => setFormData({ ...formData, content_url: e.target.value })}
                                        className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                        placeholder="https://youtube.com/watch?v=..."
                                    />
                                    {formData.content_url && (
                                        <div className="mt-2 text-xs text-text-secondary flex items-center gap-1">
                                            {getYouTubeEmbedUrl(formData.content_url) ?
                                                <><span className="text-green-500"><CheckCircle set="bold" primaryColor="currentColor" size={14} /></span> Link valid</> :
                                                <><span className="text-amber-500"><AlertTriangle set="bold" primaryColor="currentColor" size={14} /></span> Link tidak dikenali (pastikan link YouTube)</>}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-secondary/5 border-2 border-dashed border-secondary/30 rounded-2xl p-6 text-center hover:border-primary/50 transition-colors">
                                    <div className="mb-3 text-secondary flex justify-center"><Video set="bold" primaryColor="currentColor" size={32} /></div>
                                    <label className="block text-sm font-bold text-text-main dark:text-white mb-1 cursor-pointer">
                                        <span>Klik untuk upload Video</span>
                                        <input
                                            type="file"
                                            accept="video/*"
                                            onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
                                            className="hidden"
                                            required={videoSource === 'UPLOAD'}
                                        />
                                    </label>
                                    <p className="text-xs text-text-secondary">{file ? `Terpilih: ${file.name}` : 'Maksimal ukuran 50MB (MP4/WebM)'}</p>
                                </div>
                            )}
                        </div>
                    ) : formData.type === 'PDF' ? (
                        <div className="bg-secondary/5 border-2 border-dashed border-secondary/30 rounded-2xl p-6 text-center hover:border-primary/50 transition-colors">
                            <div className="mb-3 text-secondary flex justify-center"><FileText set="bold" primaryColor="currentColor" size={32} /></div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-1 cursor-pointer">
                                <span>Klik untuk upload PDF</span>
                                <input
                                    type="file"
                                    accept="application/pdf"
                                    onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
                                    className="hidden"
                                    required
                                />
                            </label>
                            <p className="text-xs text-text-secondary">{file ? `Terpilih: ${file.name}` : 'Maksimal ukuran 5MB'}</p>
                        </div>
                    ) : formData.type === 'TEXT' ? (
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Isi Konten</label>
                            <textarea
                                value={formData.content_text || ''}
                                onChange={(e) => setFormData({ ...formData, content_text: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                rows={6}
                                placeholder="Tulis materi di sini..."
                            />
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Link URL</label>
                            <input
                                type="url"
                                value={formData.content_url || ''}
                                onChange={(e) => setFormData({ ...formData, content_url: e.target.value })}
                                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                placeholder="https://..."
                            />
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <Button type="button" variant="ghost" onClick={() => setShowModal(false)} className="flex-1">
                            Batal
                        </Button>
                        <Button type="submit" loading={saving} className="flex-1">
                            Simpan Materi
                        </Button>
                    </div>
                </form>
            </Modal>

            {viewingMaterialText && (
                <Modal
                    open={!!viewingMaterialText}
                    onClose={() => setViewingMaterialText(null)}
                    title={viewingMaterialText.title || ''}
                    maxWidth="2xl"
                >
                    <div className="space-y-4">
                        <div className="bg-secondary/5 p-4 rounded-xl border border-secondary/20">
                            <p className="text-sm text-text-secondary dark:text-[#A8BC9F] italic">
                                {viewingMaterialText.description || 'Tidak ada deskripsi tambahan.'}
                            </p>
                        </div>
                        <div className="prose prose-slate dark:prose-invert max-w-none text-text-main dark:text-white leading-relaxed whitespace-pre-wrap">
                            {viewingMaterialText.content_text}
                        </div>
                        <div className="pt-4 flex justify-end">
                            <Button variant="secondary" onClick={() => setViewingMaterialText(null)}>
                                Tutup
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}

            {previewingPDF && previewPdfUrl && (
                <div className="fixed inset-0 bg-background-dark/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => { setPreviewingPDF(null); setPreviewPdfUrl(null) }}>
                    <div className="bg-white dark:bg-surface-dark rounded-3xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 px-6 border-b border-secondary/20">
                            <h3 className="text-lg font-bold text-text-main dark:text-white flex items-center gap-2">
                                📄 Preview Document
                                {savedMaterials.has(previewingPDF) && (
                                   <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full ml-2">Offline Ready</span> 
                                )}
                            </h3>
                            <div className="flex gap-3">
                                {(!isOffline || savedMaterials.has(previewingPDF)) && (
                                    <a
                                        href={previewPdfUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-4 py-2 bg-primary/10 text-primary-dark rounded-full transition-colors text-sm font-bold hover:bg-primary hover:text-white flex items-center gap-2"
                                    >
                                        <Download set="bold" primaryColor="currentColor" size={20} />
                                        Download File
                                    </a>
                                )}
                                <button
                                    onClick={() => { setPreviewingPDF(null); setPreviewPdfUrl(null) }}
                                    className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center text-text-secondary hover:bg-red-100 hover:text-red-500 transition-colors"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-hidden bg-slate-50 relative">
                            <iframe
                                src={previewPdfUrl}
                                className="w-full h-full"
                                title="PDF Preview"
                            />
                        </div>
                    </div>
                </div>
            )}

            {saving && uploadProgress === 0 && (
                <div className="fixed bottom-6 right-6 bg-white dark:bg-surface-dark px-6 py-4 rounded-2xl shadow-2xl border border-secondary/20 z-50 flex items-center gap-3 w-80 animate-in slide-in-from-bottom duration-300">
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    <span className="font-bold text-sm text-text-main dark:text-white">Menyimpan materi...</span>
                </div>
            )}

            {uploadProgress > 0 && (
                <div className="fixed bottom-6 right-6 bg-white dark:bg-surface-dark px-6 py-4 rounded-2xl shadow-2xl border border-secondary/20 z-50 flex flex-col gap-2 w-80 animate-in slide-in-from-bottom duration-300">
                    <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-text-main dark:text-white">Uploading...</span>
                        <span className="font-bold text-primary">{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-secondary/10 rounded-full h-3 overflow-hidden">
                        <div
                            className="bg-primary h-full rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${uploadProgress}%` }}
                        ></div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteTarget && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl">
                        <div className="w-16 h-16 bg-red-500/15 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Trash set="bold" primaryColor="currentColor" size={32} />
                        </div>
                        <h3 className="text-xl font-bold text-text-main dark:text-white mb-2">Hapus Materi?</h3>
                        <p className="text-text-secondary mb-6 text-sm">
                            Materi yang sudah dihapus tidak dapat dikembalikan.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteTarget(null)}
                                className="flex-1 px-4 py-3 bg-gray-100 dark:bg-gray-800 text-text-main dark:text-white rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            >
                                Batal
                            </button>
                            <button
                                onClick={() => handleDelete(deleteTarget)}
                                className="flex-1 px-4 py-3 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors"
                            >
                                Ya, Hapus
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
        </div>
    )
}

