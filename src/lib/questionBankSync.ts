import { supabaseAdmin } from './supabase'
import { fetchAllRows } from './fetchAllRows'

/**
 * questionBankSync — auto-sync soal ulangan/kuis ke bank soal dengan dedup.
 *
 * Dua aturan anti-duplikasi:
 * 1. Soal yang memang diambil dari bank (ditandai `bank_status` oleh client)
 *    tidak boleh disalin balik ke bank — caller yang memfilter ini.
 * 2. Soal dengan konten identik (teks + opsi + kunci jawaban, ternormalisasi)
 *    hanya boleh ada sekali per (teacher_id, subject_id).
 *
 * Catatan: teks generik yang sama (mis. "Pilih semua jawaban yang benar!")
 * sah dipakai banyak soal selama opsi/jawabannya berbeda — karena itu kunci
 * dedup memakai konten lengkap, bukan teks saja.
 */

const normText = (s: unknown): string =>
    String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

function stableStringify(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
    if (typeof value === 'object') {
        return '{' + Object.keys(value as Record<string, unknown>).sort()
            .map((k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]))
            .join(',') + '}'
    }
    return JSON.stringify(value)
}

export function questionContentKey(q: { question_text?: unknown; options?: unknown; correct_answer?: unknown }): string {
    return `${normText(q.question_text)}|${stableStringify(q.options)}|${stableStringify(q.correct_answer)}`
}

/**
 * Sisihkan soal yang kontennya sudah ada di bank milik guru ini.
 * Juga men-dedup di dalam batch itu sendiri (double-submit dalam satu request).
 */
export async function filterNewBankQuestions<T extends { question_text?: unknown; options?: unknown; correct_answer?: unknown; subject_id?: string | null }>(
    teacherId: string,
    questions: T[],
    defaultSubjectId: string | null = null
): Promise<{ fresh: T[]; skipped: number }> {
    const existing = await fetchAllRows(
        supabaseAdmin
            .from('question_bank')
            .select('subject_id, question_text, options, correct_answer')
            .eq('teacher_id', teacherId)
    )
    const keyOf = (subjectId: string | null | undefined, q: T) =>
        `${subjectId || ''}|${questionContentKey(q)}`
    const keys = new Set((existing || []).map((r: { subject_id: string | null; question_text: unknown; options: unknown; correct_answer: unknown }) => keyOf(r.subject_id, r as unknown as T)))

    const fresh: T[] = []
    let skipped = 0
    for (const q of questions) {
        const k = keyOf(q.subject_id ?? defaultSubjectId, q)
        if (keys.has(k)) {
            skipped++
            continue
        }
        keys.add(k)
        fresh.push(q)
    }
    return { fresh, skipped }
}

export interface BankSyncQuestion {
    question_text: string
    question_type: string
    options?: unknown
    correct_answer?: unknown
    difficulty?: string
    teacher_hots_claim?: boolean
    content_format?: string
    image_url?: string | null
    tags?: string[] | null
}

/**
 * Salin soal baru ke question_bank. Fire-and-forget: semua error
 * ditangkap dan di-log di sini, tidak melempar ke caller.
 */
export async function syncQuestionsToBank(params: {
    teacherId: string
    subjectId: string | null
    sourceType: 'exam' | 'quiz'
    sourceId: string
    sourceName: string
    questions: BankSyncQuestion[]
}): Promise<void> {
    try {
        const { teacherId, subjectId, sourceType, sourceId, sourceName, questions } = params
        if (!teacherId || questions.length === 0) return

        const { fresh, skipped } = await filterNewBankQuestions(teacherId, questions, subjectId)
        if (skipped > 0) {
            console.log(`[bank-sync] ${skipped} soal duplikat diskip (teacher ${teacherId}, ${sourceType} ${sourceId})`)
        }
        if (fresh.length === 0) return

        const rows = fresh.map((q) => ({
            teacher_id: teacherId,
            subject_id: subjectId,
            question_text: q.question_text,
            question_type: q.question_type,
            options: q.options ?? null,
            correct_answer: q.correct_answer ?? null,
            difficulty: q.difficulty,
            teacher_hots_claim: q.teacher_hots_claim,
            content_format: q.content_format,
            image_url: q.image_url ?? null,
            tags: q.tags && q.tags.length > 0 ? q.tags : null,
            source_type: sourceType,
            ...(sourceType === 'exam' ? { source_exam_id: sourceId } : { source_quiz_id: sourceId }),
            source_name: sourceName,
            // Otomatis approved karena sudah dipakai di ulangan/kuis
            status: 'approved'
        }))

        const { error } = await supabaseAdmin.from('question_bank').insert(rows)
        if (error) console.error('Failed to auto-sync questions to bank:', error)
    } catch (err) {
        console.error('Error syncing questions to bank:', err)
    }
}
