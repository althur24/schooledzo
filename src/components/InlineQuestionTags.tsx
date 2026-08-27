'use client'

import { useState } from 'react'
import TagInput from '@/components/TagInput'

interface InlineQuestionTagsProps {
    questionId: string
    tags?: string[] | null
    suggestions?: string[]
    /** Callback simpan: PUT { question_id, tags } ke endpoint questions editor */
    onSave: (tags: string[]) => Promise<boolean>
    /** Nonaktif saat ulangan aktif (read-only) — default hanya menampilkan badge */
    readOnly?: boolean
}

/**
 * Baris tag yang bisa diisi LANGSUNG di card soal — tanpa membuka form edit.
 * Guru (terutama senior) tidak perlu tahu ada form edit tersembunyi hanya
 * untuk memberi tag; tag lama tampil sebagai input chips yang bisa dihapus.
 *
 * Auto-save per aksi tambah/hapus; kegagalan mengembalikan nilai lama + toast.
 */
export default function InlineQuestionTags({
    questionId,
    tags,
    suggestions = [],
    onSave,
    readOnly = false,
}: InlineQuestionTagsProps) {
    const current = tags || []
    const [local, setLocal] = useState<string[] | null>(null)
    const [error, setError] = useState(false)

    const value = local ?? current

    const persist = async (next: string[]) => {
        const prev = current
        setLocal(next)
        setError(false)
        const ok = await onSave(next)
        if (!ok) {
            setLocal(prev)
            setError(true)
        } else {
            setLocal(null) // ikuti state server
        }
    }

    if (readOnly) {
        if (current.length === 0) return null
        return (
            <div className="flex flex-wrap items-center gap-1.5">
                {current.map((t) => (
                    <span key={t} className="inline-flex items-center px-2 py-0.5 text-xs rounded-full font-medium bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/20 whitespace-nowrap">
                        #{t}
                    </span>
                ))}
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-1">
            <TagInput
                value={value}
                onChange={(next) => persist(next)}
                suggestions={suggestions}
                placeholder="Tag soal (opsional) — Enter untuk tambah"
                className="text-xs"
                maxTags={10}
            />
            {error && (
                <span className="text-xs text-red-500 font-medium">Gagal menyimpan tag — coba lagi</span>
            )}
        </div>
    )
}
