import { QuestionType } from './types'

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
    MULTIPLE_CHOICE: 'Pilihan Ganda',
    MULTIPLE_ANSWER: 'Ganda Kompleks',
    TRUE_FALSE: 'Benar Salah',
    SHORT_ANSWER: 'Isian Singkat',
    ESSAY: 'Essay',
}

export function isAutoGradeable(type: string | QuestionType): boolean {
    return type !== 'ESSAY' && type !== 'SHORT_ANSWER'
}

/**
 * Checks if a question type requires manual grading by teacher.
 */
export function needsManualGrading(type: string | QuestionType): boolean {
    return type === 'ESSAY' || type === 'SHORT_ANSWER'
}

/**
 * Checks if option at given index is a correct answer.
 * Handles MC (single letter), MULTIPLE_ANSWER (JSON array), and TRUE_FALSE (BENAR/SALAH).
 */
export function isCorrectOption(questionType: string, correctAnswer: string | null, optionIndex: number): boolean {
    if (!correctAnswer) return false
    const letter = String.fromCharCode(65 + optionIndex)

    if (questionType === 'MULTIPLE_ANSWER') {
        try {
            const parsed = JSON.parse(correctAnswer)
            if (Array.isArray(parsed)) return parsed.includes(letter)
        } catch { /* fallback below */ }
        // Fallback: comma-separated
        return correctAnswer.split(',').map(s => s.trim().toUpperCase()).includes(letter)
    }

    if (questionType === 'TRUE_FALSE') {
        // Options are [Benar, Salah] → A=Benar, B=Salah
        if (correctAnswer === 'BENAR') return optionIndex === 0
        if (correctAnswer === 'SALAH') return optionIndex === 1
        return correctAnswer === letter
    }

    // MULTIPLE_CHOICE: simple letter comparison
    return correctAnswer === letter
}

/**
 * Parses JSON arrays safely, returning empty array on error.
 */
function safeParseArray(jsonString: string | null | undefined): string[] {
    if (!jsonString) return []
    try {
        const parsed = JSON.parse(jsonString)
        if (Array.isArray(parsed)) return parsed
        return []
    } catch {
        // Fallback for single string or invalid json
        return [jsonString.trim()]
    }
}

/**
 * Standardizes text for short answer checking.
 */
function standardizeText(text: string): string {
    return text.trim().toLowerCase()
}

/**
 * Grades a single answer based on its question type.
 * @returns { isCorrect: boolean, pointsEarned: number }
 */
export function gradeAnswer(
    type: string | QuestionType,
    studentAnswer: string | null | undefined,
    correctAnswer: string | null | undefined,
    options: string[] | null | undefined,
    maxPoints: number
): { isCorrect: boolean; pointsEarned: number } {
    if (!studentAnswer || !correctAnswer) {
        return { isCorrect: false, pointsEarned: 0 }
    }

    switch (type) {
        case 'MULTIPLE_CHOICE': {
            const isCorrect = studentAnswer.toUpperCase() === correctAnswer.toUpperCase()
            return {
                isCorrect,
                pointsEarned: isCorrect ? maxPoints : 0
            }
        }
        case 'MULTIPLE_ANSWER': {
            // Both are expected to be JSON arrays, e.g., '["A", "C"]'
            const correctSet = safeParseArray(correctAnswer)
            const studentSet = safeParseArray(studentAnswer)

            if (correctSet.length === 0) {
                return { isCorrect: false, pointsEarned: 0 }
            }

            const correctPicks = studentSet.filter(ans => correctSet.includes(ans)).length
            const wrongPicks = studentSet.filter(ans => !correctSet.includes(ans)).length

            let score = 0
            if (wrongPicks > 0) {
                // Penalty for wrong picks, but score can't go below 0
                score = Math.max(0, Math.round((correctPicks - wrongPicks) / correctSet.length * maxPoints))
            } else {
                score = Math.round((correctPicks / correctSet.length) * maxPoints)
            }

            // Consider it strictly "correct" if they got full points
            const isCorrect = score === maxPoints
            return { isCorrect, pointsEarned: score }
        }
        case 'TRUE_FALSE': {
            const isCorrect = studentAnswer.toUpperCase() === correctAnswer.toUpperCase()
            return {
                isCorrect,
                pointsEarned: isCorrect ? maxPoints : 0
            }
        }
        case 'SHORT_ANSWER': {
            // correctAnswer contains a comma-separated list of acceptable answers
            // e.g., "fotosintesis, Fotosintesis, photosynthesis"
            const acceptedAnswers = correctAnswer.split(',').map(standardizeText)
            const isCorrect = acceptedAnswers.includes(standardizeText(studentAnswer))
            return {
                isCorrect,
                pointsEarned: isCorrect ? maxPoints : 0
            }
        }
        case 'ESSAY':
        default:
            return { isCorrect: false, pointsEarned: 0 }
    }
}

/**
 * Validates the correct_answer field format based on question type before saving.
 */
export function validateCorrectAnswer(
    type: string | QuestionType,
    correctAnswer: string | null | undefined,
    options: string[] | null | undefined
): { valid: boolean; error?: string } {
    if (type === 'ESSAY') {
        return { valid: true } // Essay correct answer is just a rubric, can be anything or empty
    }

    if (!correctAnswer || correctAnswer.trim() === '') {
        return { valid: false, error: 'Kunci jawaban tidak boleh kosong' }
    }

    switch (type) {
        case 'MULTIPLE_CHOICE':
            if (!options || options.length === 0) {
                return { valid: false, error: 'Opsi jawaban harus diisi' }
            }
            return { valid: true }
        case 'MULTIPLE_ANSWER':
            try {
                const parsed = JSON.parse(correctAnswer)
                if (!Array.isArray(parsed) || parsed.length === 0) {
                    return { valid: false, error: 'Minimal satu jawaban benar harus dipilih' }
                }
                return { valid: true }
            } catch {
                return { valid: false, error: 'Format jawaban ganda kompleks tidak valid' }
            }
        case 'TRUE_FALSE':
            if (correctAnswer !== 'BENAR' && correctAnswer !== 'SALAH') {
                return { valid: false, error: 'Jawaban harus BENAR atau SALAH' }
            }
            return { valid: true }
        case 'SHORT_ANSWER':
            // As long as it's not empty, it's valid. (Comma separated allowed)
            return { valid: true }
        default:
            return { valid: true }
    }
}
