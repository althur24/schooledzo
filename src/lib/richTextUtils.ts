/**
 * Rich Text Utilities
 * 
 * Helper functions for detecting and converting between plain text (legacy)
 * and HTML (TipTap) content formats.
 */

/**
 * Detect whether content is HTML (from TipTap) or plain text (legacy).
 * Checks for common HTML tags that TipTap produces.
 */
export function isHtmlContent(text: string | null | undefined): boolean {
    if (!text) return false
    // TipTap always wraps content in <p> or other block-level tags
    return /^<(?:p|div|h[1-6]|ul|ol|blockquote|pre|img|table)\b/i.test(text.trim())
}

/**
 * Convert legacy plain text + LaTeX content to minimal HTML for editing in TipTap.
 * This is called when opening an old (plain text) question in the new editor.
 * 
 * Handles:
 * - Newlines → <p> blocks
 * - Preserves $...$ and $$...$$ LaTeX delimiters as-is (TipTap treats as text)
 * - Preserves Arabic text direction
 */
export function plainToHtml(text: string | null | undefined): string {
    if (!text) return '<p></p>'
    if (isHtmlContent(text)) return text // already HTML

    // Normalize literal \n to real newlines
    const normalized = text.replace(/\\n/g, '\n')

    // Split by newlines and wrap each line in <p>
    const lines = normalized.split('\n')
    return lines
        .map(line => {
            const trimmed = line.trim()
            if (!trimmed) return '<p></p>' // empty line → empty paragraph
            // Escape HTML special chars but preserve LaTeX delimiters
            const escaped = escapeHtml(trimmed)
            return `<p>${escaped}</p>`
        })
        .join('')
}

/**
 * Extract plain text from HTML for search indexing, AI review, etc.
 * Strips all HTML tags and returns clean text.
 */
export function htmlToPlainPreview(html: string | null | undefined): string {
    if (!html) return ''
    if (!isHtmlContent(html)) return html // already plain text

    return html
        // Replace <br> with newline
        .replace(/<br\s*\/?>/gi, '\n')
        // Replace closing block tags with newline
        .replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, '\n')
        // Strip all remaining HTML tags
        .replace(/<[^>]+>/g, '')
        // Decode HTML entities
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        // Normalize whitespace
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/**
 * Escape HTML special characters (for plainToHtml conversion).
 * Does NOT escape $ (LaTeX delimiters) or \ (LaTeX commands).
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/**
 * Process HTML content for safe rendering.
 * - Sanitizes dangerous tags (script, iframe, etc.)
 * - Preserves img, p, strong, em, u, s, br, ul, ol, li, etc.
 * - Processes LaTeX ($...$) blocks within HTML text nodes
 */
export function sanitizeHtml(html: string | null | undefined): string {
    if (!html) return ''
    // Remove dangerous tags
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<link\b[^>]*>/gi, '')
        .replace(/on\w+="[^"]*"/gi, '') // remove inline event handlers
        .replace(/on\w+='[^']*'/gi, '')
        .replace(/\son\w+\s*=\s*[^\s>]+/gi, '') // unquoted event handlers (e.g. onerror=alert(1))
        .replace(/javascript:/gi, '') // remove javascript: URLs
}
