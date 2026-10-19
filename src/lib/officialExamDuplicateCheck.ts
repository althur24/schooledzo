/**
 * Guard duplikat-judul untuk official_exams (UTS/UAS).
 *
 * Berbeda dari `exams` (ulangan harian) yang scope per teaching_assignment_id,
 * official_exams punya kolom langsung: school_id, subject_id, academic_year_id,
 * target_class_ids (array). Guard mengecek collision dengan scope:
 *   same school_id + same subject_id + same academic_year_id + same normalized title
 *   + target_class_ids overlap (≥1 kelas sama) — siswa di kelas yg sama tak bingung.
 *
 * Kontrak tahun-scoping: academic_year_id berbeda = tidak collision. Guru 4 tahun
 * ke depan tetap bisa pakai judul sama (tahun beda, TA scope berbeda).
 *
 * Remedial dikecualikan (is_remedial=true — make-up sah).
 * force_duplicate=true = override eksplisit guru/admin setelah dialog konfirmasi.
 *
 * Digunakan di: POST /api/official-exams (create-new) & POST /api/official-exams/duplicate.
 */
import { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/fetchAllRows'

export interface DuplicateOfficialExamHit {
    id: string
    title: string
    isActive: boolean | null
    className: string | null
    submissionCount: number
    createdAt: string
}

/**
 * Cek apakah ada official_exam lain dgn judul sama (normalize trim+lowercase)
 * di scope (school_id + subject_id + academic_year_id + target_class overlap).
 *
 * Return hit bila ditemukan, null bila aman.
 */
export async function checkOfficialExamDuplicate(params: {
    supabase: SupabaseClient
    schoolId: string
    subjectId: string
    academicYearId: string
    title: string
    targetClassIds: string[]
    excludeId?: string // id exam yg sedang di-edit (PUT rename) — exclude diri sendiri
}): Promise<DuplicateOfficialExamHit | null> {
    const { supabase, schoolId, subjectId, academicYearId, title, targetClassIds, excludeId } = params
    const normTitle = (title || '').trim().toLowerCase()
    if (!normTitle || targetClassIds.length === 0) return null

    // Fetch semua official_exam di scope (school+subject+year), non-remedial.
    // Realistis <50/school/subject/year — fetchAllRows + .order('id') tetap aman.
    const candidates = await fetchAllRows(supabase
        .from('official_exams')
        .select('id, title, is_active, target_class_ids, created_at, subject:subjects(name)')
        .eq('school_id', schoolId)
        .eq('subject_id', subjectId)
        .eq('academic_year_id', academicYearId)
        .neq('is_remedial', true)
        .order('created_at', { ascending: false })
        .order('id'))

    const targetSet = new Set(targetClassIds)
    for (const e of (candidates || [])) {
        if (excludeId && e.id === excludeId) continue
        const eNorm = (e.title || '').trim().toLowerCase()
        if (eNorm !== normTitle) continue
        // Cek overlap target_class_ids — ≥1 kelas sama
        const eTargets: string[] = Array.isArray(e.target_class_ids) ? e.target_class_ids : []
        const overlap = eTargets.some((cid: string) => targetSet.has(cid))
        if (!overlap) continue
        // Hit — kumpulkan info untuk dialog
        let submissionCount = 0
        try {
            const { count } = await supabase
                .from('official_exam_submissions')
                .select('id', { count: 'exact', head: true })
                .eq('exam_id', e.id)
            submissionCount = count || 0
        } catch { /* non-fatal — info dialog saja */ }
        return {
            id: e.id,
            title: e.title,
            isActive: e.is_active ?? null,
            className: (e.subject as { name?: string } | null)?.name || null,
            submissionCount,
            createdAt: e.created_at,
        }
    }
    return null
}
