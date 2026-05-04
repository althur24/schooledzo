'use client'

import SmartText from '@/components/SmartText'

interface PassageBlockProps {
    text: string
    className?: string
    /** Show paragraph numbers for multi-paragraph passages */
    showParagraphNumbers?: boolean
}

/**
 * PassageBlock — renders a reading passage with:
 * - SmartText support (LaTeX, Arabic, math notation, markdown)
 * - Auto-numbered paragraphs when passage has multiple paragraphs
 * - Clear visual hierarchy so students know which paragraph is which
 */
export default function PassageBlock({ text, className = '', showParagraphNumbers = true }: PassageBlockProps) {
    // Split passage into paragraphs (double newline or multiple newlines)
    const paragraphs = text
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0)

    const isMultiParagraph = paragraphs.length > 1

    return (
        <div className={`mb-6 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-xl overflow-hidden ${className}`}>
            {/* Header */}
            <div className="px-4 py-2 bg-teal-100/60 dark:bg-teal-900/40 border-b border-teal-200 dark:border-teal-700 flex items-center gap-2">
                <span className="text-sm">📖</span>
                <span className="text-xs text-teal-700 dark:text-teal-300 font-bold tracking-wide uppercase">Bacaan</span>
                {isMultiParagraph && (
                    <span className="text-xs text-teal-500 dark:text-teal-400 ml-auto">{paragraphs.length} paragraf</span>
                )}
            </div>

            {/* Content */}
            <div className="p-4 space-y-0">
                {isMultiParagraph && showParagraphNumbers ? (
                    // Multi-paragraph: show numbered paragraphs
                    paragraphs.map((para, idx) => (
                        <div key={idx} className={`flex gap-3 ${idx > 0 ? 'mt-4 pt-4 border-t border-teal-200/50 dark:border-teal-700/50' : ''}`}>
                            {/* Paragraph number indicator */}
                            <div className="flex-shrink-0 mt-0.5">
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-teal-500/20 text-teal-700 dark:text-teal-300 text-[10px] font-bold">
                                    {idx + 1}
                                </span>
                            </div>
                            {/* Paragraph content */}
                            <div className="flex-1 min-w-0">
                                <SmartText 
                                    text={para} 
                                    className="text-sm text-text-main dark:text-white leading-relaxed" 
                                />
                            </div>
                        </div>
                    ))
                ) : (
                    // Single paragraph: render as-is with SmartText
                    <SmartText 
                        text={text} 
                        className="text-sm text-text-main dark:text-white whitespace-pre-wrap leading-relaxed" 
                    />
                )}
            </div>
        </div>
    )
}
