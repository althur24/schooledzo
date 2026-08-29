'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import SmartText from '../SmartText'

interface MathMenuItem {
    label: string
    latex: string
    title?: string
}

interface MathMenuGroup {
    name: string
    items: MathMenuItem[]
}

const MENU_GROUPS: MathMenuGroup[] = [
    {
        name: 'Simbol',
        items: [
            { label: '×', latex: '\\times', title: 'Kali' },
            { label: '÷', latex: '\\div', title: 'Bagi' },
            { label: '±', latex: '\\pm', title: 'Plus minus' },
            { label: '≠', latex: '\\neq', title: 'Tidak sama' },
            { label: '≤', latex: '\\leq', title: 'Kurang dari sama dengan' },
            { label: '≥', latex: '\\geq', title: 'Lebih dari sama dengan' },
            { label: 'π', latex: '\\pi', title: 'Pi' },
            { label: 'Σ', latex: '\\sum', title: 'Sigma' },
            { label: '°', latex: '^\\circ', title: 'Derajat' },
            { label: '∞', latex: '\\infty', title: 'Tak hingga' },
            { label: '→', latex: '\\to', title: 'Panah' },
        ],
    },
    {
        name: 'Konstruksi',
        items: [
            { label: '½', latex: '\\frac{a}{b}', title: 'Pecahan' },
            { label: '√', latex: '\\sqrt{x}', title: 'Akar' },
            { label: 'x²', latex: 'x^{2}', title: 'Pangkat (superskrip)' },
            { label: 'x₂', latex: 'x_{1}', title: 'Subskrip' },
            { label: '∫', latex: '\\int_{a}^{b}', title: 'Integral' },
            { label: '∑', latex: '\\sum_{i=1}^{n}', title: 'Penjumlahan' },
            { label: '( n k )', latex: '\\binom{n}{k}', title: 'Binomial' },
            { label: 'x̄', latex: '\\bar{x}', title: 'Garis atas' },
        ],
    },
    {
        name: 'Matriks',
        items: [
            {
                label: '[ ] 2×2',
                latex: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}',
                title: 'Matriks 2×2',
            },
            {
                label: '[ ] 3×3',
                latex: '\\begin{bmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{bmatrix}',
                title: 'Matriks 3×3',
            },
            {
                label: '( ) 2×2',
                latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
                title: 'Matriks kurung 2×2',
            },
        ],
    },
]

interface MathInsertMenuProps {
    onInsert: (latex: string) => void
    disabled?: boolean
}

export default function MathInsertMenu({ onInsert, disabled = false }: MathInsertMenuProps) {
    const [open, setOpen] = useState(false)
    const [showFreeInput, setShowFreeInput] = useState(false)
    const [freeLatex, setFreeLatex] = useState('')
    const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)

    const closeMenu = useCallback(() => {
        setOpen(false)
        setShowFreeInput(false)
        setFreeLatex('')
    }, [])

    // Dropdown dirender via portal ke document.body dengan position: fixed.
    // Kalau absolute di dalam editor, dia terpotong oleh overflow:hidden
    // (.rich-text-editor) dan scroll container lain (modal, dsb.).
    const openMenu = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect()
        if (rect) {
            const MENU_W = 320
            const MENU_H_EST = 380
            const margin = 8
            // Clamp agar tidak keluar viewport kanan/kiri
            const left = Math.max(margin, Math.min(rect.left, window.innerWidth - MENU_W - margin))
            const spaceBelow = window.innerHeight - rect.bottom
            // Flip ke atas kalau ruang bawah kurang dan atas lebih lega
            const top = spaceBelow < MENU_H_EST && rect.top > spaceBelow
                ? Math.max(margin, rect.top - MENU_H_EST - 6)
                : rect.bottom + 6
            setDropdownPos({ top, left })
        }
        setOpen(true)
    }, [])

    const toggleMenu = useCallback(() => {
        if (disabled) return
        if (open) closeMenu()
        else openMenu()
    }, [open, disabled, closeMenu, openMenu])

    // Tutup saat: klik di luar (trigger + dropdown), Escape, scroll di luar
    // dropdown (hindari posisi basi), atau resize window.
    useEffect(() => {
        if (!open) return

        const handleMouseDown = (e: MouseEvent) => {
            const target = e.target as Node
            if (triggerRef.current?.contains(target)) return
            if (dropdownRef.current?.contains(target)) return
            closeMenu()
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeMenu()
        }
        const handleScroll = (e: Event) => {
            const target = e.target as Node
            // Scroll di dalam dropdown sendiri (textarea preview) tidak menutup
            if (dropdownRef.current?.contains(target)) return
            closeMenu()
        }
        const handleResize = () => closeMenu()

        document.addEventListener('mousedown', handleMouseDown)
        document.addEventListener('keydown', handleKeyDown)
        window.addEventListener('scroll', handleScroll, true)
        window.addEventListener('resize', handleResize)
        return () => {
            document.removeEventListener('mousedown', handleMouseDown)
            document.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('scroll', handleScroll, true)
            window.removeEventListener('resize', handleResize)
        }
    }, [open, closeMenu])

    const insert = useCallback((latex: string) => {
        onInsert(latex)
        closeMenu()
    }, [onInsert, closeMenu])

    const insertFree = useCallback(() => {
        const trimmed = freeLatex.trim()
        if (!trimmed) return
        // Auto-strip delimiter kalau guru sudah menulis $...$ sendiri
        const expr = trimmed.replace(/^\$+/, '').replace(/\$+$/, '').trim()
        if (!expr) return
        insert(expr)
    }, [freeLatex, insert])

    // Live preview LaTeX bebas — pakai SmartText agar konsisten dengan render akhir
    const freePreview = freeLatex.trim()
        ? <SmartText text={`$${freeLatex.trim().replace(/^\$+/, '').replace(/\$+$/, '')}$`} as="div" className="math-free-preview" />
        : null

    const dropdown = open && dropdownPos ? createPortal(
        <div
            className="math-insert-menu__dropdown"
            ref={dropdownRef}
            role="menu"
            style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
            {showFreeInput ? (
                <div className="math-free-input">
                    <label className="math-free-input__label">Tulis LaTeX bebas (tanpa delimiter $)</label>
                    <textarea
                        value={freeLatex}
                        onChange={(e) => setFreeLatex(e.target.value)}
                        placeholder="Contoh: \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}"
                        rows={3}
                        dir="ltr"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault()
                                insertFree()
                            }
                            if (e.key === 'Escape') {
                                e.stopPropagation()
                                setShowFreeInput(false)
                            }
                        }}
                    />
                    {freePreview}
                    <div className="math-free-input__actions">
                        <button type="button" className="math-free-input__btn math-free-input__btn--cancel" onClick={() => setShowFreeInput(false)}>
                            Batal
                        </button>
                        <button type="button" className="math-free-input__btn math-free-input__btn--insert" onClick={insertFree} disabled={!freeLatex.trim()}>
                            Sisipkan
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    {MENU_GROUPS.map((group) => (
                        <div key={group.name} className="math-insert-menu__group">
                            <div className="math-insert-menu__group-name">{group.name}</div>
                            <div className="math-insert-menu__items">
                                {group.items.map((item) => (
                                    <button
                                        key={item.label}
                                        type="button"
                                        role="menuitem"
                                        className="math-insert-menu__item"
                                        title={item.title || item.label}
                                        onClick={() => insert(item.latex)}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                    <button type="button" className="math-insert-menu__free-btn" onClick={() => setShowFreeInput(true)}>
                        ✎ Tulis LaTeX bebas…
                    </button>
                </>
            )}
        </div>,
        document.body
    ) : null

    return (
        <div className="math-insert-menu">
            <button
                type="button"
                ref={triggerRef}
                onClick={toggleMenu}
                disabled={disabled}
                className={`rte-toolbar-btn rte-toolbar-btn--math ${open ? 'is-active' : ''}`}
                title="Sisipkan rumus / simbol matematika"
                aria-haspopup="menu"
                aria-expanded={open}
            >
                ƒ<span className="math-insert-menu__x">x</span>
            </button>
            {dropdown}
        </div>
    )
}
