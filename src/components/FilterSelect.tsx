import { ChevronDown } from 'lucide-react'

interface FilterSelectProps {
    value: string
    onChange: (value: string) => void
    options: { value: string; label: string }[]
    placeholder?: string
    disabled?: boolean
    className?: string
    ariaLabel?: string
}

/** Select bergaya konsisten (rounded-xl, chevron) untuk filter & form */
export default function FilterSelect({
    value,
    onChange,
    options,
    placeholder,
    disabled = false,
    className = '',
    ariaLabel
}: FilterSelectProps) {
    return (
        <div className={`relative ${className}`}>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                aria-label={ariaLabel || placeholder}
                className="w-full px-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary appearance-none disabled:opacity-60 disabled:cursor-not-allowed pr-10"
            >
                {placeholder && <option value="">{placeholder}</option>}
                {options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">
                <ChevronDown className="w-4 h-4" />
            </div>
        </div>
    )
}
