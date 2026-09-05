'use client'

import { ReactNode } from 'react'

interface ModalProps {
    open: boolean
    onClose: () => void
    title: ReactNode
    subtitle?: ReactNode
    children: ReactNode
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl'
    /**
     * Animasi zoom saat buka (default). Matikan (false) untuk konten yang
     * mengukur dimensi container saat mount (mis. react-easy-crop) — scaling
     * animation membuat pengukuran awal meleset (react-easy-crop#428).
     */
    scaleIn?: boolean
}

const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl'
}

export default function Modal({
    open,
    onClose,
    title,
    subtitle,
    children,
    maxWidth = 'md',
    scaleIn = true
}: ModalProps) {
    if (!open) return null

    return (
        <div className="fixed inset-0 bg-background-dark/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4 transition-all duration-300">
            <div className={`
                bg-white dark:bg-surface-dark 
                border border-secondary/20 dark:border-white/5 
                rounded-3xl 
                p-6 
                w-full ${maxWidthClasses[maxWidth]} 
                max-h-[90vh] overflow-y-auto 
                shadow-2xl shadow-primary/10
                animate-in fade-in ${scaleIn ? 'zoom-in-95 ' : ''}duration-200
            `}>
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-text-main dark:text-white leading-tight">{title}</h2>
                        {subtitle && <p className="text-text-secondary dark:text-[#A8BC9F] text-sm mt-1">{subtitle}</p>}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-secondary/10 text-text-secondary hover:text-primary-dark transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                {children}
            </div>
        </div>
    )
}
