'use client'

import { Search, X } from 'lucide-react'

interface StudentSearchInputProps {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    className?: string
    ariaLabel?: string
}

/**
 * Input pencarian siswa berbasis NAMA (dipakai Monitor Live & tab Hasil).
 * Satu komponen agar perilaku/ukuran konsisten di semua halaman guru/admin.
 */
export default function StudentSearchInput({
    value,
    onChange,
    placeholder = 'Cari nama siswa...',
    className = '',
    ariaLabel = 'Cari nama siswa',
}: StudentSearchInputProps) {
    return (
        <div className={`relative ${className}`}>
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
            <input
                type="text"
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                aria-label={ariaLabel}
                autoComplete="off"
                className="w-full pl-10 pr-9 py-2 bg-white dark:bg-surface-dark border border-secondary/20 dark:border-white/10 rounded-xl text-sm text-text-main dark:text-white placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {value && (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-text-secondary hover:bg-secondary/10"
                    aria-label="Hapus pencarian"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
    )
}
