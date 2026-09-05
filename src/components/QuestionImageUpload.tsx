'use client'

import { useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { shouldSkipCrop, uploadQuestionImage } from '@/lib/questionImage'

const ImageCropModal = dynamic(() => import('./ImageCropModal'), { ssr: false })

interface QuestionImageUploadProps {
    imageUrl?: string | null
    onImageChange: (url: string | null) => void
    disabled?: boolean
}

export default function QuestionImageUpload({ imageUrl, onImageChange, disabled }: QuestionImageUploadProps) {
    const [uploading, setUploading] = useState(false)
    const [showModal, setShowModal] = useState(false)
    // Gambar yang menunggu konfirmasi crop di ImageCropModal
    const [pendingFile, setPendingFile] = useState<File | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const uploadFile = async (file: File) => {
        setUploading(true)
        try {
            const data = await uploadQuestionImage(file)
            onImageChange(data.url)
            setShowModal(false)
            setPendingFile(null)
        } catch (error) {
            alert(error instanceof Error ? error.message : 'Gagal upload gambar')
        } finally {
            setUploading(false)
        }
    }

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (fileInputRef.current) fileInputRef.current.value = ''
        if (!file) return

        // GIF langsung upload (crop via canvas mematikan animasi)
        if (shouldSkipCrop(file)) {
            await uploadFile(file)
            return
        }
        setPendingFile(file)
    }

    const handleRemove = () => {
        onImageChange(null)
        setShowModal(false)
    }

    return (
        <>
            {/* Image Preview or Add Button */}
            {imageUrl ? (
                <button
                    onClick={() => !disabled && setShowModal(true)}
                    disabled={disabled}
                    className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-primary/30"
                >
                    🖼️ Edit Gambar
                </button>
            ) : (
                <button
                    onClick={() => !disabled && setShowModal(true)}
                    disabled={disabled}
                    className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-primary/30"
                    title="Tambah gambar"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </button>
            )}

            {/* Upload Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white border border-secondary/20 rounded-2xl p-6 w-full max-w-md shadow-xl">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-text-main">📷 Gambar Soal</h3>
                            <button onClick={() => setShowModal(false)} className="p-1 text-text-secondary hover:text-text-main transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {imageUrl && (
                            <div className="mb-4">
                                <img src={imageUrl} alt="Current image" className="max-h-48 mx-auto rounded-lg border border-secondary/20" />
                            </div>
                        )}

                        <div className="space-y-3">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/jpeg,image/png,image/gif,image/webp"
                                onChange={handleUpload}
                                className="hidden"
                                id="question-image-upload"
                                disabled={uploading}
                            />

                            <label
                                htmlFor="question-image-upload"
                                className={`flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary to-primary-dark text-white rounded-xl font-medium cursor-pointer hover:opacity-90 transition-opacity ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                {uploading ? (
                                    <>⏳ Mengupload...</>
                                ) : (
                                    <>
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                        </svg>
                                        {imageUrl ? 'Ganti Gambar' : 'Upload Gambar'}
                                    </>
                                )}
                            </label>

                            {imageUrl && (
                                <button
                                    onClick={handleRemove}
                                    className="w-full px-4 py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl hover:bg-red-100 transition-colors"
                                >
                                    🗑️ Hapus Gambar
                                </button>
                            )}

                            <p className="text-xs text-text-secondary text-center">
                                Format: JPG, PNG, GIF, WebP • Max 5MB • GIF diunggah apa adanya (tanpa pemangkasan)
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Crop gambar sebelum upload */}
            <ImageCropModal
                file={pendingFile}
                onCancel={() => setPendingFile(null)}
                onConfirm={(processed) => uploadFile(processed)}
            />
        </>
    )
}
