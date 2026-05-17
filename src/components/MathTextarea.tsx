'use client'

import { useRef, useState, useCallback } from 'react'
import SmartText from './SmartText'

// ─── Toolbar config ───

const MATH_BUTTONS = [
    { label: '½', tooltip: 'Pecahan', latex: '\\frac{a}{b}' },
    { label: 'x²', tooltip: 'Pangkat', latex: 'x^{2}' },
    { label: '√', tooltip: 'Akar', latex: '\\sqrt{x}' },
    { label: 'Σ', tooltip: 'Sigma', latex: '\\sum_{i=1}^{n}' },
]

const SIMPLE_BUTTONS = [
    { label: '×', tooltip: 'Kali', latex: '\\times' },
    { label: '÷', tooltip: 'Bagi', latex: '\\div' },
    { label: 'π', tooltip: 'Pi', latex: '\\pi' },
    { label: '°', tooltip: 'Derajat', latex: '^\\circ' },
    { label: '≥', tooltip: 'Lebih besar ≥', latex: '\\geq' },
    { label: '≤', tooltip: 'Lebih kecil ≤', latex: '\\leq' },
    { label: '≠', tooltip: 'Tidak sama', latex: '\\neq' },
    { label: '∞', tooltip: 'Tak hingga', latex: '\\infty' },
]

interface MathTextareaProps {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    rows?: number
    className?: string
}

export default function MathTextarea({ value, onChange, placeholder = 'Tulis pertanyaan...', rows = 3, className = '' }: MathTextareaProps) {
    const [showPreview, setShowPreview] = useState(false)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const insertMath = useCallback((latex: string) => {
        const textarea = textareaRef.current
        if (!textarea) {
            onChange(value + `$${latex}$`)
            return
        }

        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        const before = value.substring(0, start)
        const after = value.substring(end)

        // Count unescaped $ signs before cursor to determine if we're inside a math block
        const dollarCount = (before.match(/(?<!\\)\$/g) || []).length
        const isInsideMath = dollarCount % 2 === 1

        let insertText: string
        let cursorOffset: number

        if (isInsideMath) {
            // Already inside $...$, just insert raw latex (with space separator if needed)
            const needsSpaceBefore = before.length > 0 && !/[\s{(]$/.test(before)
            insertText = (needsSpaceBefore ? ' ' : '') + latex
            cursorOffset = insertText.length
        } else {
            // Outside math — check for adjacent $ to avoid $$
            const charBefore = before.slice(-1)
            const charAfter = after.charAt(0)

            if (charBefore === '$') {
                // Cursor is right after a closing $, add space separator
                insertText = ' $' + latex + '$'
                cursorOffset = insertText.length
            } else if (charAfter === '$') {
                // Cursor is right before an opening $, add space separator
                insertText = '$' + latex + '$ '
                cursorOffset = insertText.length
            } else {
                // Normal case — wrap with delimiters
                insertText = '$' + latex + '$'
                cursorOffset = insertText.length
            }
        }

        const newValue = before + insertText + after
        onChange(newValue)

        // Refocus and set cursor position after render
        setTimeout(() => {
            textarea.focus()
            const newPos = start + cursorOffset
            textarea.setSelectionRange(newPos, newPos)
        }, 0)
    }, [value, onChange])

    return (
        <div className={`space-y-2 ${className}`}>
            {/* Toggle + Toolbar */}
            <div className="flex items-center gap-1 flex-wrap">
                <button
                    type="button"
                    onClick={() => setShowPreview(!showPreview)}
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md transition-all cursor-pointer select-none ${showPreview
                            ? 'font-bold text-blue-600 bg-blue-50 border border-blue-200'
                            : 'text-text-secondary bg-gray-50 border border-gray-200 hover:bg-gray-100'
                        }`}
                    title="Toggle Preview Rumus"
                >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>Preview</span>
                </button>

                <div className="w-px h-5 bg-gray-200" />
                <span className="text-[10px] text-text-secondary select-none font-medium">Rumus:</span>
                {MATH_BUTTONS.map(btn => (
                    <button
                        key={btn.label}
                        type="button"
                        onClick={() => insertMath(btn.latex)}
                        title={btn.tooltip}
                        className="w-7 h-7 flex items-center justify-center text-xs font-semibold bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-400 active:scale-90 transition-all cursor-pointer select-none text-blue-700"
                    >
                        {btn.label}
                    </button>
                ))}
                
                <div className="w-px h-5 bg-gray-200" />
                <span className="text-[10px] text-text-secondary select-none font-medium">Simbol:</span>
                {SIMPLE_BUTTONS.map(btn => (
                    <button
                        key={btn.label}
                        type="button"
                        onClick={() => insertMath(btn.latex)}
                        title={btn.tooltip}
                        className="w-7 h-7 flex items-center justify-center text-xs font-medium bg-white border border-gray-200 rounded-md hover:bg-gray-50 hover:border-gray-400 active:scale-90 transition-all cursor-pointer select-none"
                    >
                        {btn.label}
                    </button>
                ))}
            </div>

            {/* Plain textarea */}
            <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                rows={rows}
                className="w-full px-4 py-3 bg-secondary/5 border border-secondary/30 rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />

            {/* Live Preview Panel */}
            {showPreview && (
                <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl mt-2">
                    <div className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2 flex items-center">
                        <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Preview Rendering
                    </div>
                    <SmartText text={value} as="div" className="text-text-main" />
                </div>
            )}
        </div>
    )
}
