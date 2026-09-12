'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RotateCcw, ChevronDown as ChevronDownIcon, Loader2 } from 'lucide-react'

interface ResetAttemptMenuProps {
    /** ID unik menu ini (untuk koordinasi open/close antar baris). */
    menuId: string
    /** ID menu yang sedang terbuka (null = semua tertutup). */
    openMenuId: string | null
    onToggle: (menuId: string | null) => void
    /** Dipanggil saat user memilih mode reset. */
    onSelect: (mode: 'soft' | 'hard') => void
    /** Tampil spinner + disable saat reset sedang diproses. */
    busy?: boolean
    /** Label tombol trigger ("Reset" di monitor, "Izinkan Ulang" di hasil). */
    label?: string
}

const MENU_W = 224 // w-56
const MENU_H_EST = 150

/**
 * Dropdown Soft/Hard Reset attempt — panel dirender via PORTAL ke body
 * (position: fixed), sehingga TIDAK pernah ter-clip oleh container
 * overflow-hidden/overflow-auto di sekitarnya (tabel monitor scroll,
 * Card hasil, dsb.). Pola yang sama dengan MathInsertMenu.
 */
export default function ResetAttemptMenu({
    menuId, openMenuId, onToggle, onSelect, busy = false, label = 'Reset',
}: ResetAttemptMenuProps) {
    const open = openMenuId === menuId
    const triggerRef = useRef<HTMLButtonElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

    // Hitung posisi saat dibuka; flip ke atas bila ruang bawah sempit.
    useEffect(() => {
        if (!open) { setPos(null); return }
        const rect = triggerRef.current?.getBoundingClientRect()
        if (!rect) return
        const margin = 8
        const left = Math.max(margin, Math.min(rect.right - MENU_W, window.innerWidth - MENU_W - margin))
        const spaceBelow = window.innerHeight - rect.bottom
        const top = spaceBelow < MENU_H_EST && rect.top > spaceBelow
            ? Math.max(margin, rect.top - MENU_H_EST - 6)
            : rect.bottom + 6
        setPos({ top, left })
    }, [open])

    // Tutup saat scroll/resize (posisi fixed akan basi).
    useEffect(() => {
        if (!open) return
        const close = () => onToggle(null)
        window.addEventListener('scroll', close, true)
        window.addEventListener('resize', close)
        return () => {
            window.removeEventListener('scroll', close, true)
            window.removeEventListener('resize', close)
        }
    }, [open, onToggle])

    const panel = open && pos ? createPortal(
        <div
            ref={panelRef}
            data-reset-menu
            className="fixed z-[100] w-56 rounded-xl bg-white dark:bg-surface-dark shadow-xl ring-1 ring-black ring-opacity-5 border border-secondary/20 overflow-hidden"
            style={{ top: pos.top, left: pos.left }}
        >
            <div className="p-1.5">
                <button
                    onClick={() => { onToggle(null); onSelect('soft') }}
                    className="w-full text-left px-3 py-2.5 hover:bg-secondary/10 rounded-lg transition-colors flex flex-col mb-1"
                >
                    <span className="font-bold text-text-main dark:text-white flex items-center gap-1.5 text-xs">
                        <RotateCcw className="w-3.5 h-3.5 text-blue-500" /> Soft Reset
                    </span>
                    <span className="text-text-secondary mt-0.5 text-[10px] leading-tight">Lanjutkan, timer tetap &amp; jawaban aman</span>
                </button>
                <button
                    onClick={() => { onToggle(null); onSelect('hard') }}
                    className="w-full text-left px-3 py-2.5 hover:bg-red-500/10 rounded-lg transition-colors flex flex-col"
                >
                    <span className="font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5 text-xs">
                        <RotateCcw className="w-3.5 h-3.5" /> Hard Reset
                    </span>
                    <span className="text-red-600/70 dark:text-red-400/80 mt-0.5 text-[10px] leading-tight">Mulai ulang (jawaban dihapus, timer penuh)</span>
                </button>
            </div>
        </div>,
        document.body
    ) : null

    return (
        <div className="relative inline-block text-left" data-reset-menu>
            <button
                ref={triggerRef}
                onClick={() => onToggle(open ? null : menuId)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 rounded-lg hover:bg-orange-200 dark:hover:bg-orange-500/30 transition-colors text-xs font-bold disabled:opacity-50"
            >
                {busy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                    <RotateCcw className="w-3.5 h-3.5" />
                )}
                {label}
                <ChevronDownIcon className="w-3.5 h-3.5" />
            </button>
            {panel}
        </div>
    )
}
