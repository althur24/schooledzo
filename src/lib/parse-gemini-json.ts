/**
 * Safely parse JSON that may contain LaTeX backslash sequences.
 * 
 * Problem: Gemini sometimes outputs LaTeX like \frac, \log, \sqrt inside JSON strings.
 * In JSON, \f is a valid escape (form-feed), \b is backspace, \t is tab, \n is newline, \r is carriage return.
 * But in LaTeX context, \frac, \binom, \text, \not, \rho are NOT meant as JSON escapes.
 * This causes JSON.parse() to either fail on invalid escapes (\l, \s, \i)
 * or silently corrupt data by interpreting \f as form-feed instead of \frac.
 * 
 * Solution: Process the raw text character by character inside string literals,
 * double-escaping ALL backslashes that appear to be LaTeX commands.
 * A LaTeX command pattern is: backslash followed by a letter.
 * Valid JSON escapes that could conflict: \b, \f, \n, \r, \t
 * But these are never followed by more letters in valid JSON,
 * while in LaTeX they always are (\binom, \frac, \newcommand, \rho, \text).
 */
export function safeJsonParse(rawText: string): any {
    // NOTE: We do NOT try JSON.parse(rawText) first anymore.
    // Why? Because valid JSON escapes like \f (form feed) are also LaTeX commands (\frac).
    // If we parse as-is, \frac becomes \x0Crac (form feed + rac), corrupting the data.
    // We must always run the sanitizer to protect LaTeX commands.

    // Sanitize: fix ALL backslash-letter sequences inside JSON string values
    // by double-escaping the backslash
    let result = ''
    let inString = false
    let i = 0

    while (i < rawText.length) {
        const ch = rawText[i]

        if (!inString) {
            if (ch === '"') {
                inString = true
            }
            result += ch
            i++
        } else {
            // Inside a JSON string
            if (ch === '"') {
                inString = false
                result += ch
                i++
            } else if (ch === '\\') {
                const next = rawText[i + 1]
                if (next === undefined) {
                    result += '\\\\'
                    i++
                } else if (next === '"' || next === '\\' || next === '/') {
                    // Definitely valid JSON escapes - keep as-is
                    result += ch + next
                    i += 2
                } else if (next === 'u') { // \uXXXX unicode escape - keep as-is
                    result += ch + next
                    i += 2
                    result += rawText.substring(i, i + 4)
                    i += 4
                } else if ('bfnrt'.includes(next)) {
                    // Could be valid JSON escape (\b, \f, \n, \r, \t)
                    // OR could be LaTeX (\binom, \frac, \newcommand, \rho, \text)
                    // Check if followed by more letters → LaTeX command
                    const afterNext = rawText[i + 2]
                    if (afterNext && /[a-zA-Z]/.test(afterNext)) {
                        // LaTeX command like \frac, \binom, \text, \newcommand, \rho
                        result += '\\\\' + next
                        i += 2
                    } else {
                        // Actual JSON escape like \n at end of text, \t before non-letter
                        result += ch + next
                        i += 2
                    }
                } else {
                    // Any other \X → not valid JSON, must be LaTeX (\log, \sqrt, \int, etc.)
                    result += '\\\\' + next
                    i += 2
                }
            } else {
                result += ch
                i++
            }
        }
    }

    try {
        return JSON.parse(result)
    } catch (firstError) {
        // Attempt truncated JSON recovery:
        // Close any open strings, arrays, and objects
        let repaired = result
        
        // If we're inside an unclosed string, close it
        let inStr = false
        for (let j = 0; j < repaired.length; j++) {
            if (repaired[j] === '"' && (j === 0 || repaired[j-1] !== '\\')) {
                inStr = !inStr
            }
        }
        if (inStr) repaired += '"'
        
        // Count open brackets/braces and close them
        let openBraces = 0, openBrackets = 0
        let inStr2 = false
        for (let j = 0; j < repaired.length; j++) {
            const c = repaired[j]
            if (c === '"' && (j === 0 || repaired[j-1] !== '\\')) { inStr2 = !inStr2; continue }
            if (inStr2) continue
            if (c === '{') openBraces++
            else if (c === '}') openBraces--
            else if (c === '[') openBrackets++
            else if (c === ']') openBrackets--
        }
        
        // Remove trailing comma before closing
        repaired = repaired.replace(/,\s*$/, '')
        
        for (let j = 0; j < openBrackets; j++) repaired += ']'
        for (let j = 0; j < openBraces; j++) repaired += '}'
        
        try {
            console.warn('[parseGeminiJson] Recovered truncated JSON via bracket repair')
            return JSON.parse(repaired)
        } catch {
            throw firstError // Throw original error if recovery also fails
        }
    }
}

/**
 * Extract and parse JSON from Gemini API response text.
 * Handles markdown code blocks and LaTeX escape issues.
 */
export function parseGeminiJson(textContent: string): any {
    let jsonStr = textContent.trim()

    // Remove markdown code fences if present
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
    if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim()
    }

    // Find JSON boundaries if there's extra text
    if (!jsonStr.startsWith('{') && !jsonStr.startsWith('[')) {
        const firstBrace = jsonStr.indexOf('{')
        const lastBrace = jsonStr.lastIndexOf('}')
        if (firstBrace !== -1 && lastBrace !== -1) {
            jsonStr = jsonStr.substring(firstBrace, lastBrace + 1)
        }
    }

    return safeJsonParse(jsonStr)
}
