import { supabaseAdmin } from './supabase'

/**
 * Cache in-memory untuk daftar soal ujian yang dipakai saat grading autosave.
 *
 * Tanpa cache, setiap PUT autosave (per siswa per soal) mengambil ulang SELURUH
 * soal ujian dari database — ribuan fetch identik per menit saat ujian berjalan.
 * Daftar soal praktis tidak berubah selama ujian, jadi aman di-cache per replica
 * dengan TTL pendek. Cache hilang saat restart — tidak ada state permanen.
 */

export type GradableQuestion = {
    id: string
    correct_answer: string
    options: string[] | null
    points: number
    question_type: string
}

type CacheEntry = { data: GradableQuestion[]; expiresAt: number }

const cache = new Map<string, CacheEntry>()
const TTL_MS = 10 * 60 * 1000 // 10 menit

const GRADING_SELECT = 'id, correct_answer, options, points, question_type'

export async function getExamQuestionsForGrading(
    table: 'exam_questions' | 'official_exam_questions',
    examId: string
): Promise<GradableQuestion[]> {
    const key = `${table}:${examId}`
    const hit = cache.get(key)
    if (hit && hit.expiresAt > Date.now()) return hit.data

    const { data, error } = await supabaseAdmin.from(table).select(GRADING_SELECT).eq('exam_id', examId)
    if (error) throw error

    const questions = (data || []) as GradableQuestion[]
    cache.set(key, { data: questions, expiresAt: Date.now() + TTL_MS })
    return questions
}

/** Panggil setelah ada perubahan soal agar cache tidak basi (opsional — TTL sudah membatasi). */
export function invalidateExamQuestions(examId: string) {
    cache.delete(`exam_questions:${examId}`)
    cache.delete(`official_exam_questions:${examId}`)
}
