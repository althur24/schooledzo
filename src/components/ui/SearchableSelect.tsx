'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'

export interface SearchableOption {
    value: string
    label: string
    sublabel?: string
}

interface SearchableSelectProps {
    value: string
    onChange: (value: string) => void
    options: SearchableOption[]
    placeholder?: string
    /** Label for the explicit "clear / none" choice shown at the top of the list. */
    emptyOptionLabel?: string
    searchPlaceholder?: string
    className?: string
    disabled?: boolean
}

/**
 * Lightweight, dependency-free searchable dropdown.
 *
 * Renders the options panel through a portal to `document.body` with
 * `position: fixed` so it is never clipped by an `overflow-hidden` ancestor
 * (e.g. a Card with rounded corners). Selection filters by label + sublabel,
 * so NIP is searchable too.
 */
export default function SearchableSelect({
    value,
    onChange,
    options,
    placeholder = 'Pilih...',
    emptyOptionLabel,
    searchPlaceholder = 'Cari...',
    className = '',
    disabled = false,
}: SearchableSelectProps) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)
    const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)

    const triggerRef = useRef<HTMLButtonElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const selected = options.find(o => o.value === value) || null

    const filtered = query.trim()
        ? options.filter(o =>
            `${o.label} ${o.sublabel ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
        )
        : options

    // When query is empty we show the explicit "clear" choice on top.
    const rendered: SearchableOption[] =
        !query.trim() && emptyOptionLabel
            ? [{ value: '', label: emptyOptionLabel }, ...filtered]
            : filtered

    // Mirror the latest values into refs. The keydown handler is registered once
    // (on open) and would otherwise close over a STALE activeIndex/rendered,
    // causing Enter to select the wrong (old) item after navigating with arrows.
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const renderedRef = useRef(rendered)
    renderedRef.current = rendered
    const activeIndexRef = useRef(activeIndex)
    activeIndexRef.current = activeIndex

    const reposition = () => {
        const el = triggerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        // Flip above the trigger if there's no room below.
        const panelHeight = 340
        const spaceBelow = window.innerHeight - rect.bottom
        const top = spaceBelow < panelHeight && rect.top > panelHeight
            ? rect.top - panelHeight - 8
            : rect.bottom + 6
        setCoords({ top, left: rect.left, width: rect.width })
    }

    useLayoutEffect(() => {
        if (!open) return
        reposition()
        const onScrollResize = () => reposition()
        window.addEventListener('scroll', onScrollResize, true)
        window.addEventListener('resize', onScrollResize)
        return () => {
            window.removeEventListener('scroll', onScrollResize, true)
            window.removeEventListener('resize', onScrollResize)
        }
    }, [open])

    useEffect(() => {
        if (!open) return
        setActiveIndex(0)
        const onMouseDown = (e: MouseEvent) => {
            const t = e.target as Node
            if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return
            setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOpen(false)
            } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveIndex(i => Math.min(i + 1, renderedRef.current.length - 1))
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveIndex(i => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
                e.preventDefault()
                const item = renderedRef.current[activeIndexRef.current]
                if (item) {
                    onChangeRef.current(item.value)
                    setOpen(false)
                }
            }
        }
        document.addEventListener('mousedown', onMouseDown)
        document.addEventListener('keydown', onKey)
        // Autofocus search after paint
        const t = setTimeout(() => inputRef.current?.focus(), 0)
        return () => {
            document.removeEventListener('mousedown', onMouseDown)
            document.removeEventListener('keydown', onKey)
            clearTimeout(t)
        }
    }, [open])

    useEffect(() => {
        if (!open) setQuery('')
    }, [open])

    // Reset highlight to the top whenever the search filter changes
    useEffect(() => {
        setActiveIndex(0)
    }, [query])

    const handleSelect = (val: string) => {
        onChange(val)
        setOpen(false)
    }

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                onClick={() => setOpen(o => !o)}
                className={`w-full px-4 py-2.5 border rounded-xl text-sm text-left appearance-none transition-colors flex items-center justify-between gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
            >
                <span className={`truncate ${selected ? 'text-slate-900 dark:text-white' : 'text-text-secondary'}`}>
                    {selected ? selected.label : placeholder}
                </span>
                <ChevronDown className={`w-4 h-4 flex-shrink-0 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && coords && createPortal(
                <div
                    ref={panelRef}
                    className="fixed z-[90] bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl flex flex-col"
                    style={{ top: coords.top, left: coords.left, width: coords.width, maxHeight: 340 }}
                >
                    <div className="relative p-2 border-b border-slate-200 dark:border-slate-700">
                        <Search className="w-4 h-4 text-text-secondary absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={searchPlaceholder}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
                        />
                    </div>
                    <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
                        {rendered.length === 0 ? (
                            <div className="px-3 py-6 text-sm text-text-secondary text-center">Tidak ada hasil</div>
                        ) : (
                            rendered.map((o, i) => {
                                const isActive = i === activeIndex
                                const isSelected = o.value === value
                                return (
                                    <button
                                        key={`${o.value}-${i}`}
                                        type="button"
                                        onMouseEnter={() => setActiveIndex(i)}
                                        onClick={() => handleSelect(o.value)}
                                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${isSelected
                                            ? 'bg-emerald-50 dark:bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300'
                                            : isActive
                                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                                                : o.value === ''
                                                    ? 'text-text-secondary'
                                                    : 'text-slate-900 dark:text-white'
                                            }`}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="truncate">{o.label}</div>
                                            {o.sublabel && (
                                                <div className="text-xs text-text-secondary truncate">{o.sublabel}</div>
                                            )}
                                        </div>
                                        {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>,
                document.body
            )}
        </>
    )
}
