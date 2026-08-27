'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'

export interface DropdownMenuItem {
    label: string
    icon?: ReactNode
    onClick: () => void
    danger?: boolean
    show?: boolean
}

interface DropdownMenuProps {
    items: DropdownMenuItem[]
    align?: 'left' | 'right'
    ariaLabel?: string
}

/**
 * Lightweight kebab ("...") menu.
 * Click outside / Escape closes it; no portal needed since cards don't clip
 * overflow (only the kebab trigger must not be inside an overflow-hidden parent).
 */
export default function DropdownMenu({ items, align = 'right', ariaLabel = 'Menu aksi' }: DropdownMenuProps) {
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)

    const visibleItems = items.filter(i => i.show !== false)

    useEffect(() => {
        if (!open) return

        const handleClickOutside = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }

        document.addEventListener('mousedown', handleClickOutside)
        document.addEventListener('keydown', handleEscape)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
            document.removeEventListener('keydown', handleEscape)
        }
    }, [open])

    if (visibleItems.length === 0) return null

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                aria-label={ariaLabel}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className="p-2 rounded-full text-text-secondary hover:bg-slate-100 hover:text-text-main dark:hover:bg-slate-800 dark:hover:text-white transition-colors"
            >
                <MoreVertical className="w-5 h-5" />
            </button>

            {open && (
                <div
                    role="menu"
                    className={`absolute z-50 mt-1 w-48 rounded-xl bg-white dark:bg-surface-dark border border-slate-200 dark:border-slate-700 shadow-lg py-1 ${align === 'right' ? 'right-0' : 'left-0'}`}
                >
                    {visibleItems.map(item => (
                        <button
                            key={item.label}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                setOpen(false)
                                item.onClick()
                            }}
                            className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-medium text-left transition-colors ${
                                item.danger
                                    ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                                    : 'text-text-main dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                        >
                            {item.icon && <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">{item.icon}</span>}
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
