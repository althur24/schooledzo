import { supabaseAdmin as supabase } from './supabase'

/**
 * Resolve KKM for a specific subject + class combination.
 * Hierarchy: subject_kkm (grade-specific) → subjects.kkm (legacy) → 75 (default)
 */
export async function resolveKkm(
    subjectId: string,
    schoolLevel: string,
    gradeLevel: number
): Promise<number> {
    try {
        // 1. Try subject_kkm table (new, granular)
        const { data: granularData, error: granularError } = await supabase
            .from('subject_kkm')
            .select('kkm')
            .eq('subject_id', subjectId)
            .eq('school_level', schoolLevel)
            .eq('grade_level', gradeLevel)
            .single()
        
        if (!granularError && granularData && granularData.kkm !== undefined) {
            return granularData.kkm
        }
        
        // 2. Fallback to subjects.kkm (legacy)
        const { data: subject, error: subjectError } = await supabase
            .from('subjects')
            .select('kkm')
            .eq('id', subjectId)
            .single()
        
        if (!subjectError && subject && subject.kkm !== undefined && subject.kkm !== null) {
            return subject.kkm
        }
    } catch (e) {
        console.error('Error resolving KKM:', e)
    }
    
    // Default fallback
    return 75
}
