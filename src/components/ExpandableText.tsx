'use client'

import { useState } from 'react'

interface ExpandableTextProps {
    text: string
    /** Kelas styling paragraf (warna/ukuran) — tanpa line-clamp */
    className?: string
    /** Kelas clamp saat collapsed (default 2 baris) */
    clampClass?: string
    /** Batas karakter sebelum tombol "Selengkapnya" muncul */
    threshold?: number
}

/**
 * Paragraf deskripsi yang bisa di-expand — anti "terpotong" di kartu.
 * Line-clamp dihapus saat expanded, baris baru selalu dijaga (whitespace-pre-wrap).
 * Tombol hanya muncul bila teks terdeteksi panjang (>threshold atau multi-baris).
 */
export default function ExpandableText({
    text,
    className = '',
    clampClass = 'line-clamp-2',
    threshold = 120
}: ExpandableTextProps) {
    const [expanded, setExpanded] = useState(false)
    const isLong = text.length > threshold || text.includes('\n')

    return (
        <div>
            <p className={`${className} ${expanded ? '' : clampClass} whitespace-pre-wrap break-words`}>
                {text}
            </p>
            {isLong && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation()
                        setExpanded(!expanded)
                    }}
                    className="text-xs text-primary font-bold mt-1 hover:text-primary-dark dark:hover:text-primary transition-colors"
                >
                    {expanded ? 'Sembunyikan' : 'Selengkapnya'}
                </button>
            )}
        </div>
    )
}
