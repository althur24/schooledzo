'use client'

import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

// Check if text contains Arabic characters
function containsArabic(text: string): boolean {
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text)
}

// Check if text contains LaTeX patterns (explicit $ delimiters OR raw commands)
function containsLatex(text: string): boolean {
    return /\$\$.+?\$\$|\$.+?\$|\\(?:frac|sqrt|log|ln|sin|cos|tan|sec|csc|cot|int|sum|prod|lim|infty|alpha|beta|gamma|delta|theta|pi|sigma|omega|times|div|pm|mp|leq|geq|neq|approx|cdot|ldots|vec|hat|bar|overline|underline|text|mathrm|mathbf|binom|left|right|begin|end)\b/.test(text)
}

// Check for raw LaTeX patterns without $ delimiters (like \log_2, x^2, \frac{}{})
function containsRawLatex(text: string): boolean {
    return /\\(?:frac|sqrt|log|ln|sin|cos|tan|sec|csc|cot|int|sum|prod|lim|infty|alpha|beta|gamma|delta|theta|pi|sigma|omega|times|div|pm|mp|leq|geq|neq|approx|cdot|ldots|vec|hat|bar|overline|underline|text|mathrm|mathbf|binom|left|right|begin|end)\b/.test(text)
}

// Check for math notation without backslash commands (e.g., x^2, a^{n+1})
// Safe: ^ is rarely used in natural language (Bahasa Indonesia, IPS, etc.)
function containsMathNotation(text: string): boolean {
    // Caret exponent: x^2, a^{n}, 2^3, (x+1)^2
    return /[a-zA-Z0-9)}\]]\^[0-9a-zA-Z{(]/.test(text)
}

// Known math function names (won't be treated as natural language words)
const MATH_FUNCTIONS = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'log', 'ln', 'exp', 'max', 'min', 'lim', 'mod', 'gcd', 'det', 'abs'
])

// Check if text looks like a pure math expression (not natural language)
// This prevents rendering "Proklamasi kemerdekaan" or "Fotosintesis menghasilkan O2" as math
function looksLikePureMath(text: string): boolean {
    // Safety: skip very long text (paragraphs are not math expressions)
    if (text.length > 200) return false

    // Split by math operators and whitespace to get "tokens"
    const tokens = text.split(/[\s+\-*/=<>≤≥≠±×÷(),^_{}[\]|:!]+/).filter(t => t.length > 0)

    for (const token of tokens) {
        // Numbers (including decimals): OK
        if (/^[0-9]+\.?[0-9]*$/.test(token)) continue
        // Single or double-letter variables (x, y, ab, xy): OK
        if (/^[a-zA-Z]{1,2}$/.test(token)) continue
        // Known math functions (sin, cos, log): OK
        if (MATH_FUNCTIONS.has(token.toLowerCase())) continue
        // LaTeX commands (\frac, \pi): OK
        if (token.startsWith('\\')) continue
        // 3+ letter word that's NOT a math function → natural language detected
        if (/^[a-zA-Z]{3,}$/.test(token)) return false
    }

    return true
}

// Render text that contains math notation (like x^2 + 3x - 10)
function renderMathNotation(text: string): string {
    if (looksLikePureMath(text)) {
        // Pure math expression — render the whole thing
        try {
            return katex.renderToString(text.trim(), { displayMode: false, throwOnError: false })
        } catch {
            return text
        }
    }

    // Mixed text (e.g., "Hasil dari x^2 + 3"): find and render math segments
    // Match sequences that contain ^ with surrounding math context
    const result = text.replace(
        /(?:[a-zA-Z0-9()\[\]{}]+\s*[+\-*/=<>]*\s*)*[a-zA-Z0-9)}\]]\^[0-9a-zA-Z{(][^\s,;:!?]*(?:\s*[+\-*/=<>]\s*[a-zA-Z0-9(^_][^\s,;:!?]*)*/g,
        (match) => {
            try {
                return katex.renderToString(match.trim(), { displayMode: false, throwOnError: false })
            } catch {
                return match
            }
        }
    )

    return result
}

// Render LaTeX expressions in text, returning HTML string
function renderLatexInText(text: string): string {
    // First handle block math ($$...$$)
    let result = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
        // Fix common matrix issue: single backslash at end of line instead of double
        // handle both real newlines and literal \n string
        let cleanExpr = expr.replace(/(?<!\\)\\(?:\s*[\n\r]|\s*\\n)/g, '\\\\ ')

        try {
            return `<div class="katex-block">${katex.renderToString(cleanExpr.trim(), { displayMode: true, throwOnError: false, trust: true })}</div>`
        } catch (e) {
            return `$$${expr}$$`
        }
    })

    // Then handle inline math ($...$) - allow newlines for matrices etc.
    result = result.replace(/\$((?:[^\$]|\\\$)+?)\$/g, (_, expr) => {
        // Fix common matrix issue: single backslash at end of line instead of double
        // handle both real newlines and literal \n string
        let cleanExpr = expr.replace(/(?<!\\)\\(?:\s*[\n\r]|\s*\\n)/g, '\\\\ ')

        try {
            return katex.renderToString(cleanExpr.trim(), { displayMode: false, throwOnError: false, trust: true })
        } catch (e) {
            return `$${expr}$`
        }
    })

    return result
}

// Auto-wrap raw LaTeX expressions and render
function renderRawLatexInText(text: string): string {
    // Match segments that contain LaTeX commands with their arguments
    // This handles patterns like: \log_2(x-1), \int_0^1, \frac{a}{b}, x^2, etc.

    // First, try to find and render parenthesized LaTeX expressions: ( \expr ... )
    let result = text.replace(/\(\s*((?:[^()]*\\[a-zA-Z]+[^()]*)+)\s*\)/g, (match, expr) => {
        try {
            const rendered = katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false })
            return rendered
        } catch {
            return match
        }
    })

    // If the entire text looks like a math expression, render the whole thing
    if (result === text && containsRawLatex(text)) {
        // Find contiguous LaTeX segments (command + arguments + operators + numbers + variables)
        result = text.replace(
            /((?:\\[a-zA-Z]+(?:_\{[^}]*\}|_[a-zA-Z0-9]|\^\{[^}]*\}|\^[a-zA-Z0-9]|\{[^}]*\}|\([^)]*\))*(?:\s*[+\-=<>*/^_,]\s*(?:[a-zA-Z0-9]+(?:_\{[^}]*\}|_[a-zA-Z0-9]|\^\{[^}]*\}|\^[a-zA-Z0-9])*|\\[a-zA-Z]+(?:\{[^}]*\})*))*)+)/g,
            (match) => {
                try {
                    return katex.renderToString(match.trim(), { displayMode: false, throwOnError: false })
                } catch {
                    return match
                }
            }
        )
    }

    return result
}

interface SmartTextProps {
    text: string
    className?: string
    as?: 'p' | 'span' | 'div'
}

export default function SmartText({ text, className = '', as: Tag = 'p' }: SmartTextProps) {
    const isArabic = useMemo(() => containsArabic(text), [text])
    const hasExplicitLatex = useMemo(() => /\$\$.+?\$\$|\$.+?\$/.test(text), [text])
    const hasRawLatex = useMemo(() => containsRawLatex(text), [text])
    const hasMathNotation = useMemo(() => containsMathNotation(text), [text])
    const hasLatex = hasExplicitLatex || hasRawLatex

    const arabicClasses = isArabic ? 'arabic-text' : ''
    const combinedClassName = `${className} ${arabicClasses}`.trim()

    // Path 1: Explicit LaTeX ($...$) or raw LaTeX commands (\frac, \pi, etc.)
    if (hasLatex) {
        let html: string
        if (hasExplicitLatex) {
            html = renderLatexInText(text)
        } else {
            html = renderRawLatexInText(text)
        }

        // Process Markdown formatting (bold, italic)
        // Note: we do this AFTER LaTeX processing so we don't break LaTeX commands
        // However, we must be careful not to break LaTeX that might contain * or _
        // So we only replace if it's clearly not inside a LaTeX block

        // Convert newlines to <br> SAFELY — only outside of HTML tags
        // KaTeX outputs SVG <path> elements with newlines in their 'd' attribute.
        // Replacing ALL newlines (including inside SVG) corrupts the rendering.
        // Solution: only replace newlines that are NOT inside an HTML tag attribute.
        html = html.replace(/\\n/g, '\n') // normalize literal \n to real newlines first
        html = html.replace(/\n/g, (match, offset) => {
            // Check if this newline is inside an HTML tag (between < and >)
            const before = html.substring(Math.max(0, offset - 500), offset)
            const lastOpen = before.lastIndexOf('<')
            const lastClose = before.lastIndexOf('>')
            if (lastOpen > lastClose) {
                // We're inside a tag — don't replace
                return '\n'
            }
            return '<br />'
        })

        // Basic Markdown Bold: **text** -> <b>text</b>
        html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')

        // Basic Markdown Italic: *text* -> <i>text</i> (careful with LaTeX multiplication)
        // We only match if it's not surrounded by numbers/whitespace typical in math
        html = html.replace(/(^|[^\w\d\\])\*(?!\s)(.*?)(?<!\s)\*(?!\w)/g, '$1<i>$2</i>')

        return (
            <Tag
                className={combinedClassName}
                dangerouslySetInnerHTML={{ __html: html }}
                dir="auto"
            />
        )
    }

    // Path 2: Math notation without LaTeX commands (e.g., x^2 + 3x - 10)
    // Safe: only triggers on ^ patterns, validated by looksLikePureMath
    if (hasMathNotation) {
        const html = renderMathNotation(text)
        // Only use rendered HTML if it actually changed (i.e., KaTeX processed something)
        if (html !== text) {
            return (
                <Tag
                    className={combinedClassName}
                    dangerouslySetInnerHTML={{ __html: html }}
                    dir="auto"
                />
            )
        }
    }

    // Path 3: Plain text
    // Replace literal \n with real newlines for whitespace-pre-wrap to work
    const cleanedText = text.replace(/\\n/g, '\n')

    return (
        <Tag
            className={`${combinedClassName} whitespace-pre-wrap`}
            dir="auto"
        >
            {cleanedText}
        </Tag>
    )
}


