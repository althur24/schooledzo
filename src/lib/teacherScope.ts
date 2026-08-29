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
 * ADMIN hanya boleh di sekolahnya sendiri (via teacher → teachers.school_id);
 * GURU hanya bila TA-nya sendiri.
 */
export async function canManageExam(
    user: { id: string; role: string; school_id?: string | null },
    taTeacherId: string | null | undefined
): Promise<boolean> {
    if (user.role === 'ADMIN') {
        // Tenant guard: sebelumnya return true tanpa cek — ADMIN satu sekolah
        // bisa mengubah/menghapus ulangan sekolah lain.
        const callerSchoolId = user.school_id ?? null
        if (!callerSchoolId || !taTeacherId) return false
        const { data: teacher } = await supabase
            .from('teachers')
            .select('school_id')
            .eq('id', taTeacherId)
            .single()
        const teacherSchoolId = (teacher as any)?.school_id
        return !!teacherSchoolId && teacherSchoolId === callerSchoolId
    }
    if (user.role !== 'GURU') return false
    const scope = await getTeacherScope(user.id)
    return ownsTeachingAssignment(scope, taTeacherId)
}

/**
 * Scope per-submission untuk UTS/UAS: guru boleh mengelola submission siswa bila
 * dia mengajar mapel ujian DI KELAS siswa tersebut. Berbeda dengan canTeachScope
 * (level ujian — semua kelas target, dipakai untuk create/edit exam), ini level
 * submission — guru mapel per-kelas tetap bisa menilai/menangani siswa di kelasnya
 * sendiri tanpa harus mengajar semua kelas target ujian.
 */
export function canTeachStudentSubmission(
    scope: TeacherScope | null,
    subjectId: string | null | undefined,
    studentClassId: string | null | undefined
): boolean {
    if (!scope || !subjectId || !studentClassId) return false
    return scope.assignments.some(a => a.subject_id === subjectId && a.class_id === studentClassId)
}

/**
 * Helper gabungan untuk guard endpoint UTS/UAS:
 * ADMIN hanya boleh di sekolahnya sendiri (official_exams.school_id);
 * GURU hanya bila mapel & semua kelas target diajar (di tahun exam).
 */
export async function canManageOfficialExam(
    user: { id: string; role: string; school_id?: string | null },
    exam: { subject_id: string; target_class_ids: string[] | null; academic_year_id: string | null; school_id?: string | null }
): Promise<boolean> {
    if (user.role === 'ADMIN') {
        // Tenant guard: sebelumnya return true tanpa cek — ADMIN satu sekolah
        // bisa mengubah/menghapus UTS/UAS sekolah lain.
        const callerSchoolId = user.school_id ?? null
        if (!callerSchoolId) return false
        return exam.school_id === callerSchoolId
    }
    if (user.role !== 'GURU') return false
    const scope = await getTeacherScope(user.id, exam.academic_year_id)
    return canTeachScope(scope, exam.subject_id, exam.target_class_ids)
}
