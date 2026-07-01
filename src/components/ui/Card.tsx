import { ReactNode, HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode
    className?: string
    padding?: string
}

export default function Card({
    children,
    className = '',
    padding = 'p-6',
    ...props
}: CardProps) {
    return (
        <div className={`
            bg-white dark:bg-surface-dark
            rounded-2xl
            shadow-card
            border border-slate-200 dark:border-slate-700
            ${padding}
            ${className}
        `}
            {...props}
        >
            {children}
        </div>
    )
}
