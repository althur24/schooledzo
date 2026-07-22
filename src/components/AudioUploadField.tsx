'use client'

import { useState } from 'react'

interface AudioUploadFieldProps {
    value: string
    onChange: (url: string) => void
    onError?: (message: string) => void
    disabled?: boolean
}

const MAX_SIZE = 25 * 1024 * 1024 // 25MB

/** Upload audio listening (maks 25MB) dengan player preview */
export default function AudioUploadField({ value, onChange, onError, disabled = false }: AudioUploadFieldProps) {
    const [uploading, setUploading] = useState(false)
    const inputId = `audio-upload-${Math.random().toString(36).slice(2, 8)}`

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        if (file.size > MAX_SIZE) {
            onError?.('Maksimal ukuran audio 25MB.')
            return
        }
        setUploading(true)
        try {
            const fd = new FormData()
            fd.append('file', file)
            const res = await fetch('/api/audio/upload', { method: 'POST', body: fd })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || 'Upload gagal')
            }
            const { url } = await res.json()
            onChange(url)
        } catch (err: any) {
            onError?.(err.message || 'Gagal upload audio')
        } finally {
            setUploading(false)
        }
    }

    return (
        <div>
            <label className="block text-sm font-bold text-violet-700 dark:text-violet-400 mb-2">🎧 Audio Listening (Opsional)</label>
            {value ? (
                <div className="p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-300 dark:border-violet-700 rounded-xl space-y-2">
                    <audio controls controlsList="nodownload" className="w-full" src={value} />
                    <button
                        type="button"
                        onClick={() => onChange('')}
                        disabled={disabled}
                        className="text-sm text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                    >
                        ✕ Hapus Audio
                    </button>
                </div>
            ) : (
                <div className="relative">
                    <input
                        type="file"
                        accept="audio/*"
                        onChange={handleFile}
                        className="hidden"
                        id={inputId}
                        disabled={uploading || disabled}
                    />
                    <label
                        htmlFor={inputId}
                        className={`flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed border-violet-300 dark:border-violet-700 rounded-xl text-sm font-medium cursor-pointer transition-colors ${uploading || disabled ? 'opacity-50 cursor-wait' : 'text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20'}`}
                    >
                        {uploading ? '⏳ Mengupload...' : '🎵 Upload Audio (MP3, WAV, M4A, OGG — maks 25MB)'}
                    </label>
                </div>
            )}
        </div>
    )
}
