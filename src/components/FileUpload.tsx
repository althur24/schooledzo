'use client'

import React, { useCallback, useState, useRef } from 'react'
import { Document, Image as ImageIcon, Delete, Upload } from 'react-iconly'
import { SubmissionAttachment } from '@/lib/types'

interface FileUploadProps {
    files: SubmissionAttachment[]
    onFilesChange: (files: SubmissionAttachment[]) => void
    maxFiles?: number        // default 3
    maxSizeMB?: number       // default 10
    accept?: string          // default: gambar + PDF + Office docs
    disabled?: boolean
}

export default function FileUpload({
    files,
    onFilesChange,
    maxFiles = 3,
    maxSizeMB = 10,
    accept = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx',
    disabled = false
}: FileUploadProps) {
    const [isDragging, setIsDragging] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [progress, setProgress] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setIsDragging(true)
        } else if (e.type === 'dragleave') {
            setIsDragging(false)
        }
    }, [])

    const validateFile = (file: File): string | null => {
        if (file.size > maxSizeMB * 1024 * 1024) {
            return `File "${file.name}" terlalu besar (Max: ${maxSizeMB}MB)`
        }
        return null
    }

    const uploadFile = async (file: File) => {
        const formData = new FormData()
        formData.append('file', file)

        return new Promise<SubmissionAttachment>((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open('POST', '/api/submissions/upload')
            
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100)
                    setProgress(percentComplete)
                }
            }

            xhr.onload = () => {
                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText)
                        resolve({
                            url: data.url,
                            name: data.originalName,
                            type: data.type,
                            size: data.size
                        })
                    } catch (e) {
                        reject(new Error('Format respons tidak valid'))
                    }
                } else {
                    try {
                        const errData = JSON.parse(xhr.responseText)
                        reject(new Error(errData.error || 'Upload gagal'))
                    } catch (e) {
                        reject(new Error('Gagal mengunggah file'))
                    }
                }
            }

            xhr.onerror = () => reject(new Error('Kesalahan jaringan saat upload'))
            xhr.send(formData)
        })
    }

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
        if (disabled || uploading) return

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            await handleFiles(Array.from(e.dataTransfer.files))
        }
    }, [disabled, uploading, files, maxFiles])

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            await handleFiles(Array.from(e.target.files))
            // Reset input so the same file can be selected again if removed
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    const handleFiles = async (newFiles: File[]) => {
        setError(null)
        
        if (files.length + newFiles.length > maxFiles) {
            setError(`Maksimal ${maxFiles} file yang diizinkan`)
            return
        }

        for (const file of newFiles) {
            const validationError = validateFile(file)
            if (validationError) {
                setError(validationError)
                return
            }
        }

        setUploading(true)
        setProgress(0)

        const uploadedAttachments: SubmissionAttachment[] = []
        try {
            for (const file of newFiles) {
                const attachment = await uploadFile(file)
                uploadedAttachments.push(attachment)
            }
            onFilesChange([...files, ...uploadedAttachments])
        } catch (err: any) {
            setError(err.message || 'Terjadi kesalahan saat mengunggah')
        } finally {
            setUploading(false)
            setProgress(0)
        }
    }

    const removeFile = (index: number) => {
        if (disabled) return
        const newFiles = [...files]
        newFiles.splice(index, 1)
        onFilesChange(newFiles)
    }

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
    }

    const isImage = (type: string) => type.startsWith('image/')

    return (
        <div className="space-y-4">
            {/* Upload Zone */}
            {files.length < maxFiles && (
                <div
                    className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                        disabled ? 'opacity-50 cursor-not-allowed bg-secondary/5 border-secondary/20' 
                        : isDragging ? 'border-primary bg-primary/5' 
                        : 'border-secondary/30 hover:border-primary/50 hover:bg-secondary/5 cursor-pointer'
                    }`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => !disabled && !uploading && fileInputRef.current?.click()}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        className="hidden"
                        accept={accept}
                        multiple
                        disabled={disabled || uploading}
                    />
                    
                    <div className="flex flex-col items-center justify-center gap-3">
                        <div className={`p-3 rounded-full ${isDragging ? 'bg-primary/20 text-primary' : 'bg-secondary/10 text-secondary'}`}>
                            <Upload set="bold" primaryColor="currentColor" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-text-main dark:text-white">
                                {uploading ? 'Mengunggah file...' : 'Seret file ke sini atau klik untuk memilih file'}
                            </p>
                            <p className="text-xs text-text-secondary mt-1">
                                PDF, Gambar, Office (maks {maxSizeMB}MB)
                            </p>
                            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1">
                                🎬 Video? Gunakan tab Link YouTube/Drive
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="p-3 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 text-sm font-medium rounded-lg">
                    {error}
                </div>
            )}

            {/* Progress Bar */}
            {uploading && (
                <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-lg p-4 shadow-sm">
                    <div className="flex justify-between text-xs font-bold mb-2 text-text-main dark:text-white">
                        <span>Mengunggah...</span>
                        <span>{progress}%</span>
                    </div>
                    <div className="w-full bg-secondary/20 rounded-full h-2">
                        <div 
                            className="bg-primary h-2 rounded-full transition-all duration-300" 
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            )}

            {/* File List */}
            {files.length > 0 && (
                <div className="space-y-2">
                    {files.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 bg-white dark:bg-surface-dark border border-secondary/20 rounded-lg shadow-sm">
                            <div className="flex items-center gap-3 overflow-hidden">
                                <div className="p-2 bg-primary/10 text-primary rounded-lg shrink-0">
                                    {isImage(file.type) ? (
                                        <ImageIcon set="bold" primaryColor="currentColor" size={20} />
                                    ) : (
                                        <Document set="bold" primaryColor="currentColor" size={20} />
                                    )}
                                </div>
                                <div className="truncate">
                                    <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-text-main dark:text-white hover:text-primary transition-colors truncate block">
                                        {file.name}
                                    </a>
                                    <p className="text-xs text-text-secondary">{formatSize(file.size)}</p>
                                </div>
                            </div>
                            
                            {!disabled && (
                                <button
                                    type="button"
                                    onClick={() => removeFile(idx)}
                                    className="p-2 text-text-secondary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors shrink-0"
                                    title="Hapus file"
                                >
                                    <Delete set="light" primaryColor="currentColor" size={20} />
                                </button>
                            )}
                        </div>
                    ))}
                    
                    <div className="text-xs text-text-secondary text-right">
                        {files.length} dari {maxFiles} file
                    </div>
                </div>
            )}
        </div>
    )
}
