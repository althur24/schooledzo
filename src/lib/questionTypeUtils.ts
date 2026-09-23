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
 * Checks if option at given index is a correct answer (tampilan kunci di editor guru).
 */
/**
 * Mode penilaian Ganda Kompleks (kolom gk_grading_mode di tabel soal).
 * PROPORTIONAL (default): skor dibagi — benar N dari M kunci → N/M × poin.
 * ALL_OR_NOTHING: jawaban harus persis sama dengan kunci, salah/kurang satu = 0.
 */
export type GkGradingMode = 'PROPORTIONAL' | 'ALL_OR_NOTHING'

/**
 * SATU sumber parsing kunci/jawaban Ganda Kompleks.
 * Menerima JSON array ('["A","C"]'), koma ("A, C" / "A,C"), atau JSON rusak —
 * hasil selalu daftar huruf uppercase tunggal, dedup, terurut.
 * Dipakai gradeAnswer, isCorrectOption, GradingAnswerDisplay, dan
 * normalizeQuestionTypes supaya tampilan guru = penilaian, by construction.
 */
export function parseAnswerLetters(raw: string | null | undefined): string[] {
    if (!raw) return []
    const trimmed = raw.trim()
    if (!trimmed) return []

    let parts: string[]
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed)
            parts = Array.isArray(parsed) ? parsed.map(x => String(x)) : [trimmed]
        } catch {
            // JSON rusak (mis. kurung tak tertutup) — buang bracket & kutip lalu split koma
            parts = trimmed.replace(/[\[\]"']/g, ',').split(',')
        }
    } else {
        parts = trimmed.split(',')
    }

    const seen = new Set<string>()
    for (const p of parts) {
        const letter = p.trim().toUpperCase()
        if (/^[A-Z]$/.test(letter)) seen.add(letter)
    }
    return [...seen].sort()
}

export function isCorrectOption(questionType: string, correctAnswer: string | null, optionIndex: number): boolean {
    if (!correctAnswer) return false
    const letter = String.fromCharCode(65 + optionIndex)

    if (questionType === 'MULTIPLE_ANSWER') {
        // Kunci bisa format JSON array atau koma — parse dengan sumber yang sama
        // dengan grading supaya tampilan tidak pernah "hijau" saat nilai 0.
        return parseAnswerLetters(correctAnswer).includes(letter)
    }

    if (questionType === 'TRUE_FALSE') {
        // Options are [Benar, Salah] → A=Benar, B=Salah
        if (correctAnswer === 'BENAR') return optionIndex === 0
        if (correctAnswer === 'SALAH') return optionIndex === 1
        return correctAnswer === letter
    }

    // MULTIPLE_CHOICE: letter comparison — case-insensitive, paritas gradeAnswer
    return correctAnswer.toUpperCase() === letter
}

/**
 * Standardizes text for short answer checking.
 * NFKC (menyatukan karakter Unicode kompatibel), NBSP/spasi runtun → satu
 * spasi, trim, lowercase — supaya "kota  jakarta" = "kota jakarta".
 */
function standardizeText(text: string): string {
    return text
        .normalize('NFKC')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
}

/**
 * Grades a single answer based on its question type.
 * @param gkGradingMode mode penilaian MULTIPLE_ANSWER (default PROPORTIONAL)
 * @returns { isCorrect: boolean, pointsEarned: number } — pointsEarned bisa
 *          desimal (GK proporsional); pembulatan ke 2 angka agar rapi di UI/DB.
 */
export function gradeAnswer(
    type: string | QuestionType,
    studentAnswer: string | null | undefined,
    correctAnswer: string | null | undefined,
    options: string[] | null | undefined,
    maxPoints: number,
    gkGradingMode: GkGradingMode = 'PROPORTIONAL'
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
            // Kunci & jawaban keduanya via parseAnswerLetters: JSON array ATAU
            // koma diterima, lowercase dinormalisasi, duplikat dihapus (bug lama:
            // siswa ["A","A"] vs kunci ["A","C"] dihitung 2x benar → nilai penuh).
            const correctSet = parseAnswerLetters(correctAnswer)
            const studentSet = parseAnswerLetters(studentAnswer)

            if (correctSet.length === 0) {
                return { isCorrect: false, pointsEarned: 0 }
            }

            if (gkGradingMode === 'ALL_OR_NOTHING') {
                // Salah satu = salah semua: set siswa harus PERSIS sama dengan kunci
                // (semua kunci terpilih, tanpa pick salah, tanpa yang kurang).
                const exact = studentSet.length === correctSet.length
                    && studentSet.every(l => correctSet.includes(l))
                return { isCorrect: exact, pointsEarned: exact ? maxPoints : 0 }
            }

            // PROPORTIONAL (default): skor dibagi — benar N dari M kunci → N/M × poin.
            // Tanpa penalti pick salah; penuh hanya bila set persis sama dengan kunci.
            const correctPicks = studentSet.filter(l => correctSet.includes(l)).length
            const score = Math.round((correctPicks / correctSet.length) * maxPoints * 100) / 100
            const isCorrect = correctPicks === correctSet.length && studentSet.length === correctSet.length
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
            // Terima JSON array ATAU format koma ("A, C") — paritas grading
            // (parseAnswerLetters) supaya soal yang divalidasi = soal yang dinilai.
            return parseAnswerLetters(correctAnswer).length > 0
                ? { valid: true }
                : { valid: false, error: 'Minimal satu jawaban benar harus dipilih' }
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
