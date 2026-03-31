'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Modal, Button, EmptyState } from '@/components/ui'
import Card from '@/components/ui/Card'
import { Loader2, WifiOff, CheckSquare } from 'lucide-react'
import { Document, Video, Paper, Discovery, ArrowLeft, Search, Delete, Download } from 'react-iconly'
import {
    formatToOfflineMaterial,
    saveMaterialOffline,
    getAllOfflineMaterials,
    getBlobOffline,
    removeMaterialOffline
} from '@/lib/offlineMateri'

interface Material {
    id: string
    title: string
    description: string | null
    type: string
    content_url: string | null
    content_text: string | null
    created_at: string
    teaching_assignment: {
        subject: { name: string }
        class: { name: string }
    }
}

interface SubjectGroup {
    subjectName: string
    materials: Material[]
}

export default function SiswaMateriPage() {
    const { user } = useAuth()
    const [groupedMaterials, setGroupedMaterials] = useState<SubjectGroup[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedSubject, setSelectedSubject] = useState<SubjectGroup | null>(null)
    const [viewingMaterial, setViewingMaterial] = useState<Material | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [previewingPDF, setPreviewingPDF] = useState<string | null>(null)
    const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null)

    // Offline Mode States
    const [isOffline, setIsOffline] = useState(false)
    const [savedMaterials, setSavedMaterials] = useState<Set<string>>(new Set())
    const [savingStates, setSavingStates] = useState<Record<string, boolean>>({})

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
        const fetchData = async () => {
            try {
                let classMaterials: Material[] = []

                if (!navigator.onLine) {
                    // Load strictly from offline DB if no connection
                    const offlineMats = await getAllOfflineMaterials()
                    classMaterials = offlineMats.map(om => ({
                        id: om.id,
                        title: om.title,
                        description: om.description,
                        type: om.type,
                        content_url: om.content_url,
                        content_text: om.content_text,
                        created_at: om.savedAt,
                        teaching_assignment: {
                            subject: { name: om.subjectName },
                            class: { name: om.className || '' }
                        }
                    }))
                } else {
                    const studentsRes = await fetch('/api/students')
                    if (!studentsRes.ok) throw new Error('Network error')
                    const students = await studentsRes.json()
                    const myStudent = students.find((s: { user: { id: string } }) => s.user.id === user?.id)

                    if (!myStudent?.class_id) {
                        setLoading(false)
                        return
                    }

                    const materialsRes = await fetch('/api/materials')
                    const materialsData = await materialsRes.json()

                    classMaterials = materialsData.filter((m: Material) =>
                        m.teaching_assignment?.class?.name === myStudent.class.name
                    )
                }

                const groups: Record<string, Material[]> = {}
                classMaterials.forEach((m: Material) => {
                    const subjectName = m.teaching_assignment?.subject?.name || 'Lainnya'
                    if (!groups[subjectName]) {
                        groups[subjectName] = []
                    }
                    groups[subjectName].push(m)
                })

                const groupList = Object.entries(groups).map(([subjectName, materials]) => ({
                    subjectName,
                    materials
                }))

                setGroupedMaterials(groupList)
            } catch (error) {
                console.error('Error:', error)
                // Fallback to offline on error
                setIsOffline(true)
                const offlineMats = await getAllOfflineMaterials()
                const groups: Record<string, Material[]> = {}
                offlineMats.forEach((om) => {
                    const subjectName = om.subjectName || 'Lainnya'
                    if (!groups[subjectName]) {
                        groups[subjectName] = []
                    }
                    groups[subjectName].push({
                        id: om.id,
                        title: om.title,
                        description: om.description,
                        type: om.type,
                        content_url: om.content_url,
                        content_text: om.content_text,
                        created_at: om.savedAt,
                        teaching_assignment: {
                            subject: { name: om.subjectName },
                            class: { name: om.className || '' }
                        }
                    })
                })
                setGroupedMaterials(Object.entries(groups).map(([subjectName, materials]) => ({ subjectName, materials })))
            } finally {
                setLoading(false)
            }
        }
        if (user) fetchData()
    }, [user, isOffline])

    // Cleanup Object URLs to avoid memory leaks
    useEffect(() => {
        // Store the current URL so we can revoke it on cleanup or dependency change
        const currentUrl = previewPdfUrl
        return () => {
            if (currentUrl && currentUrl.startsWith('blob:')) {
                URL.revokeObjectURL(currentUrl)
            }
        }
    }, [previewPdfUrl])

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'PDF': return Document
            case 'VIDEO': return Video
            case 'TEXT': return Paper
            case 'LINK': return Discovery
            default: return Document
        }
    }

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'PDF': return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400' }
            case 'VIDEO': return { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400' }
            case 'TEXT': return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400' }
            case 'LINK': return { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-600 dark:text-cyan-400' }
            default: return { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' }
        }
    }

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

        if (isOffline) {
            // Cannot download new items while offline
            return
        }

        setSavingStates(prev => ({ ...prev, [material.id]: true }))
        try {
            const isText = material.type === 'TEXT'
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

        } catch (error) {
            console.error('Save offline error:', error)
            // Error handling could be a simple state toast, but keeping it simple for now
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
        
        if (isOffline) {
             // Cannot view online PDF while offline
             return
        }

        setPreviewPdfUrl(material.content_url)
        setPreviewingPDF(material.id)
    }

    // Filter subjects by search query
    const filteredSubjects = groupedMaterials.filter(group =>
        group.subjectName.toLowerCase().includes(searchQuery.toLowerCase())
    )

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <Loader2 className="w-8 h-8 text-primary animate-spin" strokeWidth={2} />
            </div>
        )
    }

    // View 1: Subject List (Default)
    if (!selectedSubject) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <a href="/dashboard/siswa" className="p-3 rounded-xl bg-white dark:bg-surface-dark border border-secondary/20 hover:border-primary text-text-secondary hover:text-primary transition-all shadow-sm">
                            <ArrowLeft set="bold" primaryColor="currentColor" size={24} />
                        </a>
                        <div>
                            <div className="flex items-center gap-2">
                                <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                                    <div className="text-blue-600 dark:text-blue-400 flex"><Document set="bold" primaryColor="currentColor" size="small" /></div>
                                </div>
                                <h1 className="text-2xl font-bold text-text-main dark:text-white">Materi Pembelajaran</h1>
                            </div>
                            <p className="text-text-secondary dark:text-[#A8BC9F] ml-12">Pilih mata pelajaran untuk melihat materi</p>
                        </div>
                    </div>
                    {isOffline && (
                        <div className="flex items-center gap-2 bg-red-100 text-red-600 px-4 py-2 rounded-full font-bold shadow-sm border border-red-200">
                            <WifiOff size={20} />
                            <span>Mode Offline</span>
                        </div>
                    )}
                </div>

                {/* Search Bar - Disabled if offline since mostly small dataset */}
                <Card className="p-6 bg-gradient-to-r from-secondary/10 to-primary/5 border-secondary/20">
                    <label className="block text-sm font-bold text-text-main dark:text-white mb-3">🔍 Cari Mata Pelajaran</label>
                    <div className="relative">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Ketik nama mata pelajaran (contoh: Biologi)..."
                            className="w-full px-5 py-4 pl-12 bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl text-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
                        />
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary">
                            <Search set="light" primaryColor="currentColor" size={24} />
                        </div>
                    </div>
                </Card>

                {filteredSubjects.length === 0 ? (
                    <EmptyState
                        icon={<div className="text-secondary flex">{isOffline ? <WifiOff size={48} /> : <Search set="bold" primaryColor="currentColor" size="xlarge" />}</div>}
                        title={isOffline ? "Materi Offline Kosong" : "Tidak Ditemukan"}
                        description={isOffline ? 'Anda sedang offline dan tidak ada materi yang disimpan ke perangkat ini.' : (searchQuery ? 'Tidak ada mata pelajaran yang cocok.' : 'Belum ada materi pelajaran yang tersedia.')}
                    />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredSubjects.map((group) => (
                            <Card
                                key={group.subjectName}
                                className="group cursor-pointer hover:border-primary/50 transition-all hover:scale-[1.02] hover:shadow-lg"
                            >
                                <div onClick={() => { setSelectedSubject(group); setSearchQuery('') }}>
                                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white mb-4 shadow-lg shadow-primary/20 group-hover:scale-110 transition-transform">
                                        <Document set="bold" primaryColor="currentColor" size={32} />
                                    </div>
                                    <h3 className="text-xl font-bold text-text-main dark:text-white mb-2 group-hover:text-primary transition-colors">
                                        {group.subjectName}
                                    </h3>
                                    <p className="text-sm text-text-secondary dark:text-[#A8BC9F] flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${isOffline ? 'bg-amber-100 text-amber-700' : 'bg-secondary/20 text-text-secondary'}`}>
                                            {group.materials.length} File {isOffline && 'Offline'}
                                        </span>
                                    </p>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        )
    }

    const getYouTubeEmbedUrl = (url: string) => {
        try {
            if (!url) return null
            let videoId = ''
            if (url.includes('youtube.com/watch')) {
                const urlParams = new URLSearchParams(new URL(url).search)
                videoId = urlParams.get('v') || ''
            } else if (url.includes('youtu.be/')) {
                videoId = url.split('youtu.be/')[1]?.split('?')[0] || ''
            } else if (url.includes('youtube.com/embed/')) {
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

    // View 2: Material List for Selected Subject
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-4 bg-white dark:bg-surface-dark p-6 rounded-3xl shadow-soft">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setSelectedSubject(null)}
                        className="w-10 h-10 rounded-full bg-secondary/10 hover:bg-secondary/20 text-text-secondary dark:text-[#A8BC9F] flex items-center justify-center transition-colors scroll-smooth"
                    >
                        <ArrowLeft set="bold" primaryColor="currentColor" size={24} />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-text-main dark:text-white leading-tight">{selectedSubject.subjectName}</h1>
                        <p className="text-text-secondary dark:text-[#A8BC9F] text-sm">Daftar Materi Pembelajaran</p>
                    </div>
                </div>
                {isOffline && (
                    <div className="flex items-center gap-2 bg-red-100 text-red-600 px-4 py-2 rounded-full font-bold shadow-sm border border-red-200">
                        <WifiOff size={20} />
                        <span className="hidden sm:inline">Mode Offline</span>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedSubject.materials.map((material) => {
                    const isSaved = savedMaterials.has(material.id)
                    const isSaving = savingStates[material.id]

                    return (
                        <Card key={material.id} className="hover:shadow-lg transition-all border-l-4 border-l-transparent hover:border-l-primary flex flex-col">
                            <div className="flex items-start gap-4 flex-1">
                                {(() => {
                                    const IconComponent = getTypeIcon(material.type)
                                    const colors = getTypeColor(material.type)
                                    return (
                                        <div className={`w-12 h-12 rounded-2xl ${colors.bg} flex items-center justify-center flex-shrink-0`}>
                                            <div className={`flex ${colors.text}`}><IconComponent set="bold" primaryColor="currentColor" size="small" /></div>
                                        </div>
                                    )
                                })()}
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-lg font-bold text-text-main dark:text-white mb-1">{material.title}</h3>
                                    <p className="text-sm text-text-secondary dark:text-[#A8BC9F] mb-4 line-clamp-2">{material.description || 'Tidak ada deskripsi'}</p>

                                    {/* Video Player Embed */}
                                    {material.type === 'VIDEO' && material.content_url && !isOffline && (
                                        <div className="mb-4 rounded-xl overflow-hidden bg-black/5 dark:bg-black/20 aspect-video relative group shadow-sm border border-secondary/10">
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
                                    {material.type === 'VIDEO' && isOffline && (
                                        <div className="mb-4 rounded-xl bg-secondary/10 flex items-center justify-center p-6 text-center">
                                            <p className="text-sm text-text-secondary">🎥 Video tidak dapat diputar offline</p>
                                        </div>
                                    )}

                                    <div className="flex flex-wrap items-center justify-between gap-4 mt-auto">
                                        <div className="flex gap-2">
                                            {material.type === 'TEXT' ? (
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => setViewingMaterial(material)}
                                                >
                                                    Baca Materi
                                                </Button>
                                            ) : material.type === 'PDF' && material.content_url ? (
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    disabled={isOffline && !isSaved}
                                                    onClick={() => handlePreviewPDF(material)}
                                                >
                                                    Preview PDF
                                                </Button>
                                            ) : material.type !== 'VIDEO' && (
                                                <a
                                                    href={material.content_url || '#'}
                                                    target={(!isOffline || isSaved) ? "_blank" : "_self"}
                                                    rel="noopener noreferrer"
                                                    className={`px-4 py-2 rounded-full font-semibold transition-colors text-sm inline-flex items-center gap-2 ${isOffline && !isSaved ? 'bg-secondary/10 text-text-secondary cursor-not-allowed' : 'bg-secondary/10 text-primary hover:bg-secondary/20'}`}
                                                    onClick={(e) => { if (isOffline && !isSaved) e.preventDefault() }}
                                                >
                                                    🔗 Buka Link
                                                </a>
                                            )}
                                        </div>

                                        {/* Offline Toggle Button — only for PDF and TEXT */}
                                        {material.type !== 'VIDEO' && material.type !== 'LINK' && (
                                        <button
                                            onClick={() => handleToggleOffline(material)}
                                            disabled={isSaving || (isOffline && !isSaved)}
                                            className={`text-sm font-bold flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors ${
                                                isSaved ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-700 group' :
                                                (isOffline && !isSaved) ? 'bg-secondary/10 text-text-secondary opacity-50 cursor-not-allowed' :
                                                'bg-secondary/10 text-text-main hover:bg-primary/10 hover:text-primary dark:text-white'
                                            }`}
                                            title={isSaved ? "Hapus dari offline" : "Offlinekan Materi"}
                                        >
                                            {isSaving ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : isSaved ? (
                                                <>
                                                    <span className="group-hover:hidden flex items-center gap-2">
                                                        <CheckSquare size={16} />
                                                        Tersimpan
                                                    </span>
                                                    <span className="hidden group-hover:flex items-center gap-2">
                                                        <div className="flex items-center"><Delete set="bold" primaryColor="currentColor" size={16} /></div>
                                                        Hapus File
                                                    </span>
                                                </>
                                            ) : (
                                                <>
                                                    <Download set="bold" primaryColor="currentColor" size={16} />
                                                    <span>Offlinekan Materi</span>
                                                </>
                                            )}
                                        </button>
                                        )}

                                    </div>
                                </div>
                            </div>
                        </Card>
                    )
                })}
            </div>

            {/* Read Text Material Modal */}
            <Modal
                open={!!viewingMaterial}
                onClose={() => setViewingMaterial(null)}
                title={viewingMaterial?.title || ''}
                maxWidth="2xl"
            >
                <div className="space-y-4">
                    <div className="bg-secondary/5 p-4 rounded-xl border border-secondary/20">
                        <p className="text-sm text-text-secondary dark:text-[#A8BC9F] italic">
                            {viewingMaterial?.description || 'Tidak ada deskripsi tambahan.'}
                        </p>
                    </div>
                    <div className="prose prose-slate dark:prose-invert max-w-none text-text-main dark:text-white leading-relaxed whitespace-pre-wrap">
                        {viewingMaterial?.content_text}
                    </div>
                    <div className="pt-4 flex justify-end">
                        <Button variant="secondary" onClick={() => setViewingMaterial(null)}>
                            Tutup
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* PDF Preview Modal */}
            {previewingPDF && previewPdfUrl && (
                <div className="fixed inset-0 bg-background-dark/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm" 
                     onClick={() => { setPreviewingPDF(null); setPreviewPdfUrl(null) }}>
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
                                    <Delete set="bold" primaryColor="currentColor" size={20} />
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-hidden bg-slate-50 relative">
                             {/* The actual iframe for PDF */}
                            <iframe
                                src={previewPdfUrl}
                                className="w-full h-full"
                                title="PDF Preview"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

