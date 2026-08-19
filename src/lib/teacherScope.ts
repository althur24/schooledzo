/**
 * teacherScope.ts — satu sumber untuk "apa yang diajar guru ini".
 *
 * Dipakai untuk:
 *  - validasi scope saat guru membuat/mengedit UTS/UAS (mapel & kelas harus diajar),
 *  - validasi kepemilikan ulangan (teaching assignment milik guru ini),
 *  - pengetatan edit: hanya guru pemilik atau ADMIN yang boleh mengubah.
 *
 * Semua fungsi menerima hasil resolve agar endpoint tidak mengulang query yang sama.
 */

import { supabaseAdmin as supabase } from './supabase'

export interface TeacherAssignment {
    subject_id: string
    class_id: string
}

export interface TeacherScope {
    teacherId: string
    assignments: TeacherAssignment[]
}

/**
 * Resolve teacher + teaching assignments untuk user guru.
 * academicYearId null → semua tahun (dipakai untuk ulangan yang TA-nya sudah pasti).
 * Mengembalikan null bila user bukan guru terdaftar.
 */
export async function getTeacherScope(userId: string, academicYearId: string | null = null): Promise<TeacherScope | null> {
    const { data: teacher } = await supabase
        .from('teachers')
        .select('id')
        .eq('user_id', userId)
        .single()
    if (!teacher) return null

    let query = supabase
        .from('teaching_assignments')
        .select('subject_id, class_id')
        .eq('teacher_id', teacher.id)
    if (academicYearId) query = query.eq('academic_year_id', academicYearId)

    const { data: assignments } = await query
    return { teacherId: teacher.id, assignments: assignments || [] }
}

/**
 * Scope ketat untuk UTS/UAS: mapel harus diajar DAN SEMUA kelas target harus diajar.
 * targetClassIds kosong → false (ujian tanpa sasaran tidak valid).
 */
export function canTeachScope(
    scope: TeacherScope | null,
    subjectId: string | null | undefined,
    targetClassIds: string[] | null | undefined
): boolean {
    if (!scope || !subjectId || !targetClassIds || targetClassIds.length === 0) return false
    const taughtSubjects = new Set(scope.assignments.map(a => a.subject_id))
    const taughtClasses = new Set(scope.assignments.map(a => a.class_id))
    return taughtSubjects.has(subjectId) && targetClassIds.every(cid => taughtClasses.has(cid))
}

/**
 * Kepemilikan ulangan: teaching assignment exam ini milik guru dalam scope ini.
 */
export function ownsTeachingAssignment(scope: TeacherScope | null, taTeacherId: string | null | undefined): boolean {
    return !!scope && !!taTeacherId && taTeacherId === scope.teacherId
}

/**
 * Helper gabungan untuk guard endpoint ulangan:
 * ADMIN selalu boleh; GURU hanya bila TA-nya sendiri.
 */
export async function canManageExam(user: { id: string; role: string }, taTeacherId: string | null | undefined): Promise<boolean> {
    if (user.role === 'ADMIN') return true
    if (user.role !== 'GURU') return false
    const scope = await getTeacherScope(user.id)
    return ownsTeachingAssignment(scope, taTeacherId)
}

/**
 * Helper gabungan untuk guard endpoint UTS/UAS:
 * ADMIN selalu boleh; GURU hanya bila mapel & semua kelas target diajar (di tahun exam).
 */
export async function canManageOfficialExam(
    user: { id: string; role: string },
    exam: { subject_id: string; target_class_ids: string[] | null; academic_year_id: string | null }
): Promise<boolean> {
    if (user.role === 'ADMIN') return true
    if (user.role !== 'GURU') return false
    const scope = await getTeacherScope(user.id, exam.academic_year_id)
    return canTeachScope(scope, exam.subject_id, exam.target_class_ids)
}
