/**
 * tenantGuard.ts — guard isolasi antar-sekolah untuk route API.
 *
 * Prinsip: resource yang diakses client (by id / param) harus milik sekolah
 * caller. SUPER_ADMIN (schoolId null) memang lintas sekolah — selalu lolos.
 *
 * Dipakai bersama getSchoolContextOrError:
 *   const ctx = await getSchoolContextOrError(request)
 *   if (isErrorResponse(ctx)) return ctx
 *   const { schoolId } = ctx
 *   // ... fetch resource ...
 *   if (tenantMismatch(resourceSchoolId, schoolId)) return notFound()
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from './supabase'

/** Response 404 standar untuk resource lintas sekolah (jangan bocorkan keberadaan id). */
export function notFound(): NextResponse {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

/**
 * true bila resource BUKAN milik sekolah caller.
 * callerSchoolId null (SUPER_ADMIN) selalu false — akses lintas sekolah memang sengaja.
 */
export function tenantMismatch(
    resourceSchoolId: string | null | undefined,
    callerSchoolId: string | null
): boolean {
    if (!callerSchoolId) return false
    return resourceSchoolId !== callerSchoolId
}

/** Resolve school_id sebuah exam via teaching_assignment → academic_year. */
export async function resolveExamSchoolId(examId: string): Promise<string | null> {
    const { data } = await supabase
        .from('exams')
        .select('teaching_assignment:teaching_assignments(academic_year:academic_years(school_id))')
        .eq('id', examId)
        .single()
    const ta = data?.teaching_assignment as { academic_year?: { school_id?: string } } | null
    return ta?.academic_year?.school_id ?? null
}

/** Resolve school_id sebuah quiz via teaching_assignment → academic_year. */
export async function resolveQuizSchoolId(quizId: string): Promise<string | null> {
    const { data } = await supabase
        .from('quizzes')
        .select('teaching_assignment:teaching_assignments(academic_year:academic_years(school_id))')
        .eq('id', quizId)
        .single()
    const ta = data?.teaching_assignment as { academic_year?: { school_id?: string } } | null
    return ta?.academic_year?.school_id ?? null
}

/** Resolve school_id sebuah assignment (tugas) via teaching_assignment → academic_year. */
export async function resolveAssignmentSchoolId(assignmentId: string): Promise<string | null> {
    const { data } = await supabase
        .from('assignments')
        .select('teaching_assignment:teaching_assignments(academic_year:academic_years(school_id))')
        .eq('id', assignmentId)
        .single()
    const ta = data?.teaching_assignment as { academic_year?: { school_id?: string } } | null
    return ta?.academic_year?.school_id ?? null
}

/** Resolve school_id sebuah teaching assignment via academic_year. */
export async function resolveTeachingAssignmentSchoolId(taId: string): Promise<string | null> {
    const { data } = await supabase
        .from('teaching_assignments')
        .select('academic_year:academic_years(school_id)')
        .eq('id', taId)
        .single()
    const ay = (data as any)?.academic_year
    return (Array.isArray(ay) ? ay[0]?.school_id : ay?.school_id) ?? null
}

/**
 * Validasi batch teaching assignment id terhadap sekolah caller.
 * Mengembalikan daftar id yang TIDAK valid.
 */
export async function findTeachingAssignmentsOutsideSchool(taIds: string[], callerSchoolId: string | null): Promise<string[]> {
    if (!callerSchoolId || taIds.length === 0) return []
    const { data } = await supabase
        .from('teaching_assignments')
        .select('id, academic_year:academic_years(school_id)')
        .in('id', taIds)
    const rows = (data || []) as any[]
    const inSchool = new Set(
        rows
            .filter(r => (Array.isArray(r.academic_year) ? r.academic_year[0]?.school_id : r.academic_year?.school_id) === callerSchoolId)
            .map(r => r.id)
    )
    return taIds.filter(id => !inSchool.has(id))
}

/**
 * Validasi batch: semua exam id harus milik sekolah caller.
 * Mengembalikan daftar id yang TIDAK valid (kosong = semua lolos).
 */
export async function findExamsOutsideSchool(examIds: string[], callerSchoolId: string | null): Promise<string[]> {
    if (!callerSchoolId || examIds.length === 0) return []
    const { data } = await supabase
        .from('exams')
        .select('id, teaching_assignment:teaching_assignments(academic_year:academic_years(school_id))')
        .in('id', examIds)
    const rows = (data || []) as any[]
    const inSchool = new Set(
        rows
            .filter(r => r.teaching_assignment?.academic_year?.school_id === callerSchoolId)
            .map(r => r.id)
    )
    return examIds.filter(id => !inSchool.has(id))
}

/** Validasi batch quiz id terhadap sekolah caller — sama seperti findExamsOutsideSchool. */
export async function findQuizzesOutsideSchool(quizIds: string[], callerSchoolId: string | null): Promise<string[]> {
    if (!callerSchoolId || quizIds.length === 0) return []
    const { data } = await supabase
        .from('quizzes')
        .select('id, teaching_assignment:teaching_assignments(academic_year:academic_years(school_id))')
        .in('id', quizIds)
    const rows = (data || []) as any[]
    const inSchool = new Set(
        rows
            .filter(r => r.teaching_assignment?.academic_year?.school_id === callerSchoolId)
            .map(r => r.id)
    )
    return quizIds.filter(id => !inSchool.has(id))
}

/**
 * Validasi id question_bank terhadap sekolah caller (question_bank tidak punya
 * school_id — scope via teacher → teachers.school_id).
 * Mengembalikan daftar question id yang TIDAK valid.
 */
export async function findQuestionBankQuestionsOutsideSchool(questionIds: string[], callerSchoolId: string | null): Promise<string[]> {
    if (!callerSchoolId || questionIds.length === 0) return []
    const { data } = await supabase
        .from('question_bank')
        .select('id, teacher:teachers(school_id)')
        .in('id', questionIds)
    const rows = (data || []) as any[]
    const inSchool = new Set(
        rows
            .filter(r => r.teacher?.school_id === callerSchoolId)
            .map(r => r.id)
    )
    return questionIds.filter(id => !inSchool.has(id))
}

/**
 * Validasi question id milik exam/quiz/official_exam terhadap sekolah caller.
 * questionType: 'exam_questions' | 'quiz_questions' | 'official_exam_questions'.
 */
export async function findExamQuizQuestionsOutsideSchool(
    questionIds: string[],
    questionType: 'exam_questions' | 'quiz_questions' | 'official_exam_questions',
    callerSchoolId: string | null
): Promise<string[]> {
    if (!callerSchoolId || questionIds.length === 0) return []

    if (questionType === 'official_exam_questions') {
        const { data } = await supabase
            .from('official_exam_questions')
            .select('id, official_exam:official_exams(school_id)')
            .in('id', questionIds)
        const rows = (data || []) as any[]
        const inSchool = new Set(rows.filter(r => r.official_exam?.school_id === callerSchoolId).map(r => r.id))
        return questionIds.filter(id => !inSchool.has(id))
    }

    const table = questionType === 'exam_questions' ? 'exam_questions' : 'quiz_questions'
    const parent = questionType === 'exam_questions' ? 'exam:exams' : 'quiz:quizzes'
    const { data } = await supabase
        .from(table)
        .select(`id, ${parent}(teaching_assignment:teaching_assignments(academic_year:academic_years(school_id)))`)
        .in('id', questionIds)
    const rows = (data || []) as any[]
    const parentKey = questionType === 'exam_questions' ? 'exam' : 'quiz'
    const inSchool = new Set(
        rows
            .filter(r => r[parentKey]?.teaching_assignment?.academic_year?.school_id === callerSchoolId)
            .map(r => r.id)
    )
    return questionIds.filter(id => !inSchool.has(id))
}
