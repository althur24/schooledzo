/**
 * Post-processing layer to fix AI-misclassified question types.
 * The AI (Gemini) sometimes lazily defaults everything to MULTIPLE_CHOICE or ESSAY.
 * This function analyzes the actual content and corrects the type.
 */

interface RawQuestion {
    question_text: string
    question_type: string
    options: string[] | null
    correct_answer: string | null
    [key: string]: any
}

export function normalizeQuestionTypes(questions: RawQuestion[]): RawQuestion[] {
    return questions.map(q => {
        const corrected = { ...q }
        const opts = q.options

        // Safely convert correct_answer to string — AI sometimes returns arrays or numbers
        let rawAnswer = q.correct_answer
        if (Array.isArray(rawAnswer)) {
            // AI returned ["A", "C"] as native array — convert to JSON string
            corrected.correct_answer = JSON.stringify(rawAnswer)
            rawAnswer = corrected.correct_answer
        } else if (rawAnswer !== null && rawAnswer !== undefined && typeof rawAnswer !== 'string') {
            rawAnswer = String(rawAnswer)
            corrected.correct_answer = rawAnswer
        }
        const answer = (typeof rawAnswer === 'string' ? rawAnswer.trim() : '') || ''
        const text = q.question_text?.toLowerCase() || ''

        // ─── Rule 1: TRUE_FALSE detection ───
        // If options are exactly 2 and contain Benar/Salah variants
        if (opts && opts.length === 2) {
            const normalized = opts.map(o => o.trim().toLowerCase())
            const isTF = (
                (normalized.includes('benar') && normalized.includes('salah')) ||
                (normalized.includes('true') && normalized.includes('false')) ||
                (normalized.includes('b') && normalized.includes('s'))
            )
            if (isTF) {
                corrected.question_type = 'TRUE_FALSE'
                corrected.options = ['Benar', 'Salah']
                // Normalize the correct answer
                const ansLower = answer.toLowerCase()
                if (['benar', 'true', 'b', 'betul'].includes(ansLower)) {
                    corrected.correct_answer = 'BENAR'
                } else if (['salah', 'false', 's'].includes(ansLower)) {
                    corrected.correct_answer = 'SALAH'
                }
                return corrected
            }
        }

        // Also detect from question text patterns even if AI didn't set options
        if (
            q.question_type === 'ESSAY' &&
            !opts &&
            (
                /^(benar atau salah|betul atau salah|true or false)/i.test(text) ||
                /\b(B\/S|T\/F)\b/.test(q.question_text || '')
            )
        ) {
            corrected.question_type = 'TRUE_FALSE'
            corrected.options = ['Benar', 'Salah']
            const ansLower = answer.toLowerCase()
            if (['benar', 'true', 'b', 'betul'].includes(ansLower)) {
                corrected.correct_answer = 'BENAR'
            } else if (['salah', 'false', 's'].includes(ansLower)) {
                corrected.correct_answer = 'SALAH'
            }
            // Clean prefix from question text
            corrected.question_text = q.question_text
                .replace(/^(Benar atau Salah\s*[:.]?\s*)/i, '')
                .replace(/^(True or False\s*[:.]?\s*)/i, '')
                .trim()
            return corrected
        }

        // ─── Rule 2: MULTIPLE_ANSWER detection ───
        // If correct_answer looks like a JSON array with multiple items
        if (q.question_type === 'MULTIPLE_CHOICE' && answer) {
            try {
                const parsed = JSON.parse(answer)
                if (Array.isArray(parsed) && parsed.length > 1) {
                    corrected.question_type = 'MULTIPLE_ANSWER'
                    corrected.correct_answer = JSON.stringify(parsed)
                    return corrected
                }
            } catch {
                // Not JSON, check comma-separated letters like "A, C" or "A,C"
                if (/^[A-E]\s*,\s*[A-E](\s*,\s*[A-E])*$/i.test(answer)) {
                    const letters = answer.split(',').map(l => l.trim().toUpperCase())
                    corrected.question_type = 'MULTIPLE_ANSWER'
                    corrected.correct_answer = JSON.stringify(letters)
                    return corrected
                }
            }
        }

        // Also detect from text hints
        if (
            q.question_type === 'MULTIPLE_CHOICE' &&
            opts && opts.length >= 3 &&
            (
                /pilih.*(lebih dari satu|semua yang benar|yang tepat|lebih dari 1)/i.test(text) ||
                /jawaban.*lebih dari satu/i.test(text) ||
                /boleh lebih dari satu/i.test(text)
            )
        ) {
            corrected.question_type = 'MULTIPLE_ANSWER'
            // Ensure correct_answer is JSON array
            if (answer && !answer.startsWith('[')) {
                const letters = answer.split(',').map(l => l.trim().toUpperCase()).filter(l => /^[A-E]$/.test(l))
                if (letters.length > 0) {
                    corrected.correct_answer = JSON.stringify(letters)
                }
            }
            return corrected
        }

        // ─── Rule 3: SHORT_ANSWER detection ───
        // If AI classified as ESSAY but answer is very short (1-3 words) and no options
        if (q.question_type === 'ESSAY' && (!opts || opts.length === 0)) {
            const wordCount = answer.split(/\s+/).filter(Boolean).length
            const hasShortAnswerHint = (
                /isian singkat/i.test(text) ||
                /jawab(an)? singkat/i.test(text) ||
                /\bdisebut\b/i.test(text) ||
                /\badalah\.\.\./i.test(text) ||
                /\bialah\.\.\./i.test(text) ||
                /\.{2,}$/i.test(q.question_text?.trim() || '') // ends with ...
            )

            if (answer && wordCount <= 3 && hasShortAnswerHint) {
                corrected.question_type = 'SHORT_ANSWER'
                corrected.options = null
                // Clean prefix
                corrected.question_text = q.question_text
                    .replace(/^(Isian Singkat\s*[:.]?\s*)/i, '')
                    .trim()
                return corrected
            }
        }

        // ─── Rule 4: Validate MULTIPLE_CHOICE has options ───
        if (q.question_type === 'MULTIPLE_CHOICE' && (!opts || opts.length < 2)) {
            // MC without options → likely SHORT_ANSWER or ESSAY
            const wordCount = answer.split(/\s+/).filter(Boolean).length
            if (answer && wordCount <= 5) {
                corrected.question_type = 'SHORT_ANSWER'
                corrected.options = null
            } else {
                corrected.question_type = 'ESSAY'
                corrected.options = null
            }
            return corrected
        }

        return corrected
    })
}
