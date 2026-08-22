'use client'

import { useMemo, useRef, useState } from 'react'
import { X, Tag } from 'lucide-react'

interface TagInputProps {
    value: string[]
    onChange: (tags: string[]) => void
    /** Daftar tag yang sudah dipakai guru sebelumnya (untuk autocomplete) */
    suggestions?: string[]
    placeholder?: string
    disabled?: boolean
    maxTags?: number
    className?: string
}

// Karakter , { } " ' \ dibersihkan — mereka bentrok dengan format array literal
// Postgres yang dipakai filter `ov` di /api/question-bank.
const cleanTag = (raw: string): string =>
    raw.replace(/[{},"'\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30)

/**
 * Input tag berbentuk chips dengan autocomplete.
 * Enter / koma untuk tambah, X untuk hapus. Tag dibersihkan dari
 * karakter yang bentrok dengan format array Postgres (koma & kurung kurawal).
 */
export default function TagInput({
    value,
    onChange,
    suggestions = [],
    placeholder = 'Tulis tag lalu tekan Enter...',
    disabled = false,
    maxTags = 10,
    className = ''
}: TagInputProps) {
    const [input, setInput] = useState('')
    const [focused, setFocused] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const available = useMemo(
        () => suggestions.filter((s) => !value.includes(s)),
        [suggestions, value]
    )

    const matching = useMemo(() => {
        const q = cleanTag(input).toLowerCase()
        const list = q ? available.filter((s) => s.toLowerCase().includes(q)) : available
        return list.slice(0, 8)
    }, [input, available])

    const addTag = (raw: string) => {
        const tag = cleanTag(raw)
        if (!tag || value.includes(tag) || value.length >= maxTags) return
        onChange([...value, tag])
        setInput('')
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            addTag(input)
        } else if (e.key === 'Backspace' && !input && value.length > 0) {
            onChange(value.slice(0, -1))
        }
    }

    return (
        <div className={`space-y-2 ${className}`}>
            <div
                className={`flex flex-wrap items-center gap-1.5 min-h-[46px] p-2 bg-secondary/5 border rounded-xl transition-colors ${
                    focused ? 'border-primary ring-2 ring-primary/20' : 'border-secondary/20'
                }`}
                onClick={() => inputRef.current?.focus()}
            >
                <Tag className="w-4 h-4 text-text-secondary ml-1 shrink-0" />
                {value.map((tag) => (
                    <span
                        key={tag}
                        className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-primary/10 border border-primary/30 text-primary rounded-full text-xs font-bold"
                    >
                        {tag}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation()
                                onChange(value.filter((t) => t !== tag))
                            }}
                            disabled={disabled}
                            className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
                            title={`Hapus tag "${tag}"`}
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </span>
                ))}
                <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setFocused(true)}
                    onBlur={() => {
                        setFocused(false)
                        if (cleanTag(input)) addTag(input)
                    }}
                    disabled={disabled || value.length >= maxTags}
                    placeholder={value.length === 0 ? placeholder : ''}
                    className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm text-text-main dark:text-white placeholder:text-text-secondary/60"
                />
            </div>

            {/* Autocomplete */}
            {focused && matching.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {matching.map((s) => (
                        <button
                            key={s}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => addTag(s)}
                            className="px-2.5 py-1 text-xs font-medium bg-secondary/10 hover:bg-primary/10 hover:text-primary border border-secondary/20 hover:border-primary/30 rounded-full transition-colors"
                        >
                            + {s}
                        </button>
                    ))}
                </div>
            )}

            {value.length >= maxTags && (
                <p className="text-xs text-amber-600 dark:text-amber-400">Maksimal {maxTags} tag per soal.</p>
            )}
        </div>
    )
}
