/**
 * susulanGrant.ts — logika server fitur Susulan (grant & revoke).
 *
 * Satu implementasi untuk ulangan (exams/exam_submissions) dan UTS/UAS
 * (official_exams/official_exam_submissions). Route hanya menangani auth
 * context + JSON; seluruh validasi tenant/scope/waktu/roster ada di sini.
 *
 * Placeholder submission = baris dengan started_at NULL + susulan_granted_at
 * terisi. Keberadaannya sengaja memakai baris submission (bukan tabel baru)
 * agar unique constraint (exam_id, student_id) tetap menjaga satu attempt,
 * dan seluruh alur nilai/reset yang sudah ada langsung berlaku.
 */

import { supabaseAdmin as supabase } from './supabase'
import { coTeachesClassSubject, getTeacherScope, ownsTeachingAssignment } from './teacherScope'
import { fetchAllRows } from './fetchAllRows'
import { enrollmentClassAt, type EnrollmentInterval } from './enrollmentClassAt'
import { resolveWindowExpiry } from './examExpiry'
import {
    sanitizeSusulanMaxPercent,
    susulanExpiresAtIso,
    SUSULAN_MIN_PERCENT,
    SUSULAN_MAX_PERCENT,
} from './susulan'

export type SusulanKind = 'exam' | 'official'

export interface SusulanAuthContext {
    userId: string
    role: string
    schoolId: string | null
}

export type SusulanGrantResult =
    | { ok: true; submissionId: string; expiresAt: string; maxPercent: number }
    | { ok: false; status: number; error: string }

export type SusulanRevokeResult = { ok: true } | { ok: false; status: number; error: string }

interface TeacherSchoolEmbed {
    school_id: string | null
}

interface UlanganTaAuth {
    teacher_id: string | null
    subject_id: string | null
    class_id: string | null
    academic_year_id: string | null
    teacher?: TeacherSchoolEmbed | TeacherSchoolEmbed[] | null
}

interface ExamAuthRow {
    id: string
    title?: string | null
    start_time: string | null
    duration_minutes: number | null
    window_end_time: string | null
    is_active: boolean | null
    is_remedial: boolean | null
    allowed_student_ids: string[] | null
    /** UTS/UAS: kelas target. */
    target_class_ids?: string[] | null
    /** UTS/UAS: tenant + mapel + tahun. */
    school_id?: string | null
    subject_id?: string | null
    academic_year_id?: string | null
}

interface UlanganExamAuthRow extends ExamAuthRow {
    teaching_assignment: UlanganTaAuth | UlanganTaAuth[] | null
}

interface StudentAuthRow {
    id: string
    class_id: string | null
    school_id: string | null
}

interface SubmissionPlaceholderRow {
    id: string
    student_id?: string
    started_at: string | null
    is_submitted: boolean
    susulan_granted_at: string | null
}

interface ExamSubmissionRevokeRow extends SubmissionPlaceholderRow {
    exam:
        | { teaching_assignment: UlanganTaAuth | UlanganTaAuth[] | null }
        | { teaching_assignment: UlanganTaAuth | UlanganTaAuth[] | null }[]
        | null
}

interface OfficialExamEmbed {
    id: string
    school_id: string | null
    subject_id: string | null
    target_class_ids: string[] | null
    academic_year_id: string | null
    start_time: string | null
}

interface OfficialSubmissionRevokeRow extends SubmissionPlaceholderRow {
    student: { class_id: string | null } | { class_id: string | null }[] | null
    exam: OfficialExamEmbed | OfficialExamEmbed[] | null
}

const firstEmbed = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

/** Ujian dianggap berakhir bila batas global (jendela / start+durasi) sudah lewat. */
function isExamEnded(exam: ExamAuthRow, now: number = Date.now()): boolean {
    const expiry = resolveWindowExpiry(
        {
            start_time: exam.start_time,
            duration_minutes: exam.duration_minutes,
            window_end_time: exam.window_end_time,
        },
        { started_at: null, timer_override_until: null },
    )
    return expiry.limited && now > expiry.endAt
}

function examHasNoDeadline(exam: ExamAuthRow): boolean {
    const expiry = resolveWindowExpiry(
        {
            start_time: exam.start_time,
            duration_minutes: exam.duration_minutes,
            window_end_time: exam.window_end_time,
        },
        { started_at: null, timer_override_until: null },
    )
    return !expiry.limited
}

/**
 * Hitung max_score ujian. Disimpan sejak grant agar cap tidak pernah fail-open
 * bila ada jalur tulis yang menyentuh placeholder sebelum start (defense in
 * depth — jalur tersebut juga sudah diblokir di PUT).
 */
async function computeExamMaxScore(kind: SusulanKind, examId: string): Promise<number | null> {
    const table = kind === 'exam' ? 'exam_questions' : 'official_exam_questions'
    const fallbackPoints = kind === 'exam' ? 1 : 10
    let data: { points: number | null }[] = []
    try {
        // fetchAllRows: ujian >1000 soal (jarang, tetapi doktrin repo) tidak
        // boleh terpotong diam-diam → max_score kurang → cap terlalu ketat.
        data = await fetchAllRows<{ points: number | null }>(
            supabase
                .from(table)
                .select('points')
                .eq('exam_id', examId)
                .order('id'),
        )
    } catch {
        // Jangan pernah menulis max_score=0 karena query gagal — cap fail-closed
        // akan mengunci nilai siswa ke 0 permanen.
        return null
    }
    const total = data.reduce(
        (sum, q) => sum + (q.points || fallbackPoints),
        0,
    )
    return Math.round(total * 100) / 100
}

async function authorizeExam(
    kind: SusulanKind,
    examId: string,
    ctx: SusulanAuthContext,
): Promise<{ ok: true; exam: ExamAuthRow; ulanganTa: UlanganTaAuth | null } | { ok: false; status: number; error: string }> {
    if (kind === 'exam') {
        const { data, error } = await supabase
            .from('exams')
            .select(`
                id, title, start_time, duration_minutes, window_end_time, is_active,
                is_remedial, allowed_student_ids,
                teaching_assignment:teaching_assignments(
                    teacher_id, subject_id, class_id, academic_year_id,
                    teacher:teachers(school_id)
                )
            `)
            .eq('id', examId)
            .single()
        if (error || !data) return { ok: false, status: 404, error: 'Ulangan tidak ditemukan' }

        const row = data as unknown as UlanganExamAuthRow
        const ta = firstEmbed(row.teaching_assignment)
        const teacher = firstEmbed(ta?.teacher)
        if (ctx.schoolId && (!teacher?.school_id || teacher.school_id !== ctx.schoolId)) {
            return { ok: false, status: 404, error: 'Ulangan tidak ditemukan' }
        }

        if (ctx.role === 'GURU') {
            const scope = await getTeacherScope(ctx.userId, ta?.academic_year_id ?? null)
            if (!ownsTeachingAssignment(scope, ta?.teacher_id) && !coTeachesClassSubject(scope, ta?.subject_id, ta?.class_id)) {
                return { ok: false, status: 403, error: 'Anda tidak memiliki akses ke ulangan ini' }
            }
        } else if (ctx.role !== 'ADMIN') {
            return { ok: false, status: 403, error: 'Forbidden' }
        }

        return { ok: true, exam: row, ulanganTa: ta }
    }

    const { data, error } = await supabase
        .from('official_exams')
        .select(`
            id, title, start_time, duration_minutes, window_end_time, is_active,
            is_remedial, allowed_student_ids, school_id, subject_id,
            target_class_ids, academic_year_id
        `)
        .eq('id', examId)
        .single()
    if (error || !data) return { ok: false, status: 404, error: 'Ujian tidak ditemukan' }

    const exam = data as unknown as ExamAuthRow
    if (ctx.schoolId && exam.school_id !== ctx.schoolId) {
        return { ok: false, status: 404, error: 'Ujian tidak ditemukan' }
    }

    if (ctx.role === 'GURU') {
        const scope = await getTeacherScope(ctx.userId, exam.academic_year_id ?? null)
        const canRead = (exam.target_class_ids || []).some((cid: string) =>
            coTeachesClassSubject(scope, exam.subject_id, cid),
        )
        if (!canRead) {
            return { ok: false, status: 403, error: 'Anda tidak memiliki akses ke ujian ini' }
        }
    } else if (ctx.role !== 'ADMIN') {
        return { ok: false, status: 403, error: 'Forbidden' }
    }

    return { ok: true, exam, ulanganTa: null }
}

/** Siswa harus masih menjadi anggota roster ujian (paritas dengan roster Monitor Live). */
/** Kelas roster ujian untuk siswa (null = bukan anggota). */
async function resolveRosterClassId(
    kind: SusulanKind,
    exam: ExamAuthRow,
    ulanganTa: UlanganTaAuth | null,
    student: StudentAuthRow,
): Promise<string | null> {
    if (kind === 'exam') {
        if (!ulanganTa?.class_id) return null
        let q = supabase
            .from('student_enrollments')
            .select('id')
            .eq('student_id', student.id)
            .eq('class_id', ulanganTa.class_id)
            .eq('status', 'ACTIVE')
            .limit(1)
        if (ulanganTa.academic_year_id) q = q.eq('academic_year_id', ulanganTa.academic_year_id)
        const { data } = await q
        return (data || []).length > 0 ? ulanganTa.class_id : null
    }

    const targetIds: string[] = exam.target_class_ids || []
    if (targetIds.length === 0) return null
    const { data } = await supabase
        .from('student_enrollments')
        .select('student_id, class_id, academic_year_id, status, enrolled_at, ended_at, created_at, updated_at')
        .eq('student_id', student.id)
        .in('class_id', targetIds)
        .order('id')
    const rows = (data || []) as EnrollmentInterval[]
    const picked = enrollmentClassAt(rows, exam.start_time)
    if (picked && targetIds.includes(picked.class_id)) return picked.class_id
    // Fallback legacy (paritas start/gate soal): kelas sekarang bila target.
    return student.class_id && targetIds.includes(student.class_id) ? student.class_id : null
}

/**
 * Buka/perpanjang susulan untuk satu siswa. Idempoten untuk placeholder yang
 * belum dimulai (cap & masa berlaku diperbarui).
 */
export async function grantSusulan(
    kind: SusulanKind,
    params: { examId: string; studentId: string; maxPercent: unknown },
    ctx: SusulanAuthContext,
): Promise<SusulanGrantResult> {
    const { examId, studentId } = params
    if (!examId || !studentId) {
        return { ok: false, status: 400, error: 'exam_id dan student_id wajib diisi' }
    }
    // Fail-closed: GURU/ADMIN tanpa sekolah tidak boleh melakukan grant lintas tenant.
    if (!ctx.schoolId) return { ok: false, status: 403, error: 'Forbidden' }

    const maxPercent = sanitizeSusulanMaxPercent(params.maxPercent)
    if (maxPercent === null) {
        return {
            ok: false,
            status: 400,
            error: `susulan_max_percent harus angka bulat ${SUSULAN_MIN_PERCENT}–${SUSULAN_MAX_PERCENT}`,
        }
    }

    const auth = await authorizeExam(kind, examId, ctx)
    if (!auth.ok) return auth
    const { exam, ulanganTa } = auth

    // Tahun ajaran arsip (COMPLETED) tidak boleh menerima grant/nilai baru
    // (paritas guard 11 route tulis lain). Revoke tetap diizinkan untuk cleanup.
    const yearId = kind === 'exam' ? ulanganTa?.academic_year_id : exam.academic_year_id
    if (yearId) {
        const { data: yearRow, error: yearError } = await supabase
            .from('academic_years')
            .select('status')
            .eq('id', yearId)
            .maybeSingle()
        if (yearError) {
            return { ok: false, status: 500, error: 'Gagal memeriksa status tahun ajaran. Coba lagi.' }
        }
        if (yearRow?.status === 'COMPLETED') {
            return { ok: false, status: 403, error: 'Tahun ajaran ini sudah Selesai — susulan tidak bisa dibuka.' }
        }
    }

    if (!exam.is_active) {
        return { ok: false, status: 400, error: 'Ujian belum dibuka/dipublikasikan' }
    }
    if (examHasNoDeadline(exam)) {
        return { ok: false, status: 400, error: 'Ujian ini tidak memiliki batas waktu — susulan tidak diperlukan' }
    }
    // Mode jendela boleh punya durasi 0 (selesai di jam tutup). Untuk susulan
    // setelah jam tutup, durasi 0 tidak punya arti yang aman (server akan
    // memakai masa grant 7 hari) — tolak dengan pesan jelas.
    if (!exam.duration_minutes || exam.duration_minutes <= 0) {
        return { ok: false, status: 400, error: 'Ujian ini tidak memiliki durasi pengerjaan — susulan tidak bisa dibuka' }
    }

    const { data: studentData } = await supabase
        .from('students')
        .select('id, class_id, school_id')
        .eq('id', studentId)
        .single()
    const student = studentData as unknown as StudentAuthRow | null
    if (!student) return { ok: false, status: 404, error: 'Siswa tidak ditemukan' }
    if (ctx.schoolId && student.school_id && student.school_id !== ctx.schoolId) {
        return { ok: false, status: 404, error: 'Siswa tidak ditemukan' }
    }

    const allowed = Array.isArray(exam.allowed_student_ids) ? exam.allowed_student_ids : []
    if (exam.is_remedial && allowed.length > 0 && !allowed.includes(studentId)) {
        return { ok: false, status: 403, error: 'Siswa tidak terdaftar dalam daftar remedial ini' }
    }

    const rosterClassId = await resolveRosterClassId(kind, exam, ulanganTa, student)
    if (!rosterClassId) {
        return { ok: false, status: 403, error: 'Siswa bukan anggota kelas ujian ini' }
    }
    // GURU UTS/UAS: scope harus mencakup kelas HISTORIS siswa (bukan sekadar
    // salah satu kelas target) — paritas revoke & roster Monitor Live.
    if (kind === 'official' && ctx.role === 'GURU') {
        const scope = await getTeacherScope(ctx.userId, exam.academic_year_id ?? null)
        if (!coTeachesClassSubject(scope, exam.subject_id, rosterClassId)) {
            return { ok: false, status: 403, error: 'Anda tidak mengajar kelas siswa ini' }
        }
    }

    const subsTable = kind === 'exam' ? 'exam_submissions' : 'official_exam_submissions'
    const { data: existingData } = await supabase
        .from(subsTable)
        .select('id, started_at, is_submitted, susulan_granted_at')
        .eq('exam_id', examId)
        .eq('student_id', studentId)
        .maybeSingle()
    const existing = existingData as unknown as SubmissionPlaceholderRow | null

    if (existing) {
        if (existing.is_submitted) {
            return { ok: false, status: 409, error: 'Siswa sudah mengumpulkan ujian ini' }
        }
        if (existing.started_at) {
            return { ok: false, status: 409, error: 'Siswa sudah mulai mengerjakan — gunakan Reset untuk memberi attempt baru' }
        }
        // Baris legacy (started_at NULL tanpa grant) boleh diadopsi menjadi
        // placeholder susulan — satu-satunya jalur pemulihan untuk data setengah jadi.
    }

    // Grant BARU (termasuk adopsi baris legacy tanpa grant) wajib setelah ujian
    // berakhir. Grant yang SUDAH ada tetap bisa diperbarui (cap/perpanjang) walau
    // "Tambah Waktu" menggeser jadwal ke depan — tanpa ini guru kehilangan
    // satu-satunya jalur mengelola grant.
    if (!existing?.susulan_granted_at && !isExamEnded(exam)) {
        return { ok: false, status: 400, error: 'Ujian belum berakhir — siswa masih bisa mulai seperti biasa' }
    }

    const nowIso = new Date().toISOString()
    const expiresAt = susulanExpiresAtIso()
    const maxScore = await computeExamMaxScore(kind, examId)
    if (maxScore === null) {
        return { ok: false, status: 500, error: 'Gagal menghitung max_score ujian. Coba lagi.' }
    }
    const grantFields = {
        // Normalisasi baris legacy yang is_submitted-nya NULL agar semua guard
        // `.eq('is_submitted', false)` (unpublish/delete/revoke) mendeteksinya.
        is_submitted: false,
        susulan_granted_at: nowIso,
        susulan_expires_at: expiresAt,
        susulan_max_percent: maxPercent,
        susulan_granted_by: ctx.userId,
        // Disimpan sejak grant (bukan hanya saat start) agar cap selalu punya
        // patokan yang valid di semua jalur baca/tulis.
        max_score: maxScore,
    }

    if (existing) {
        const { data: updated, error } = await supabase
            .from(subsTable)
            .update(grantFields)
            .eq('id', existing.id)
            .is('started_at', null)
            // Jangan menimpa baris yang baru saja disubmit jalur legacy.
            .not('is_submitted', 'is', true)
            .select('id')
            .single()
        if (error || !updated) {
            return { ok: false, status: 409, error: 'Gagal memperbarui susulan (siswa mungkin baru saja mulai/selesai)' }
        }
        return { ok: true, submissionId: (updated as { id: string }).id, expiresAt, maxPercent }
    }

    const { data: inserted, error: insertError } = await supabase
        .from(subsTable)
        .insert({
            exam_id: examId,
            student_id: studentId,
            started_at: null,
            ...grantFields,
        })
        .select('id')
        .single()

    if (insertError) {
        if (insertError.code === '23505') {
            // Race dengan request lain: placeholder mungkin baru dibuat.
            const { data: racedData } = await supabase
                .from(subsTable)
                .select('id, started_at, is_submitted, susulan_granted_at')
                .eq('exam_id', examId)
                .eq('student_id', studentId)
                .maybeSingle()
            const raced = racedData as unknown as SubmissionPlaceholderRow | null
            if (raced && !raced.is_submitted && !raced.started_at && raced.susulan_granted_at) {
                const { data: updated } = await supabase
                    .from(subsTable)
                    .update(grantFields)
                    .eq('id', raced.id)
                    .is('started_at', null)
                    .not('is_submitted', 'is', true)
                    .select('id')
                    .single()
                if (updated) {
                    return { ok: true, submissionId: (updated as { id: string }).id, expiresAt, maxPercent }
                }
            }
            return { ok: false, status: 409, error: 'Siswa sudah mulai/selesai mengerjakan ujian ini' }
        }
        return { ok: false, status: 500, error: 'Gagal membuka susulan: ' + insertError.message }
    }

    return {
        ok: true,
        submissionId: (inserted as { id: string }).id,
        expiresAt,
        maxPercent,
    }
}

/** Batalkan grant yang belum dimulai (placeholder). */
export async function revokeSusulan(
    kind: SusulanKind,
    params: { submissionId: string },
    ctx: SusulanAuthContext,
): Promise<SusulanRevokeResult> {
    const submissionId = params.submissionId
    if (!submissionId) return { ok: false, status: 400, error: 'submission_id required' }
    if (!ctx.schoolId) return { ok: false, status: 403, error: 'Forbidden' }

    if (kind === 'exam') {
        const { data: subData } = await supabase
            .from('exam_submissions')
            .select(`
                id, exam_id, student_id, started_at, is_submitted, susulan_granted_at,
                exam:exams(teaching_assignment:teaching_assignments(
                    teacher_id, subject_id, class_id, academic_year_id, teacher:teachers(school_id)
                ))
            `)
            .eq('id', submissionId)
            .single()
        const sub = subData as unknown as ExamSubmissionRevokeRow | null
        if (!sub) return { ok: false, status: 404, error: 'Submission tidak ditemukan' }

        const examEmbed = firstEmbed(sub.exam)
        const ta = firstEmbed(examEmbed?.teaching_assignment)
        const teacher = firstEmbed(ta?.teacher)
        if (ctx.schoolId && (!teacher?.school_id || teacher.school_id !== ctx.schoolId)) {
            return { ok: false, status: 404, error: 'Submission tidak ditemukan' }
        }
        if (ctx.role === 'GURU') {
            const scope = await getTeacherScope(ctx.userId, ta?.academic_year_id ?? null)
            if (!ownsTeachingAssignment(scope, ta?.teacher_id) && !coTeachesClassSubject(scope, ta?.subject_id, ta?.class_id)) {
                return { ok: false, status: 403, error: 'Anda tidak memiliki akses ke ulangan ini' }
            }
        } else if (ctx.role !== 'ADMIN') {
            return { ok: false, status: 403, error: 'Forbidden' }
        }

        return deletePlaceholder('exam_submissions', sub)
    }

    const { data: subData } = await supabase
        .from('official_exam_submissions')
        .select(`
            id, exam_id, student_id, started_at, is_submitted, susulan_granted_at,
            student:students(class_id),
            exam:official_exams(id, school_id, subject_id, target_class_ids, academic_year_id, start_time)
        `)
        .eq('id', submissionId)
        .single()
    const sub = subData as unknown as OfficialSubmissionRevokeRow | null
    if (!sub) return { ok: false, status: 404, error: 'Submission tidak ditemukan' }

    const exam = firstEmbed(sub.exam)
    const student = firstEmbed(sub.student)
    if (ctx.schoolId && (!exam?.school_id || exam.school_id !== ctx.schoolId)) {
        return { ok: false, status: 404, error: 'Submission tidak ditemukan' }
    }
    if (ctx.role === 'GURU') {
        const scope = await getTeacherScope(ctx.userId, exam?.academic_year_id ?? null)
        // Kelas historis saat ujian dimulai (paritas grant), bukan kelas siswa
        // sekarang — siswa yang pindah kelas setelah ujian tetap dikelola guru
        // yang mengampu kelas ujiannya.
        let historicalClassId = student?.class_id ?? null
        const targetIds = exam?.target_class_ids || []
        if (sub.student_id && targetIds.length > 0) {
            const { data: enrollmentRows } = await supabase
                .from('student_enrollments')
                .select('student_id, class_id, academic_year_id, status, enrolled_at, ended_at, created_at, updated_at')
                .eq('student_id', sub.student_id)
                .in('class_id', targetIds)
                .order('id')
            const picked = enrollmentClassAt(
                (enrollmentRows || []) as EnrollmentInterval[],
                exam?.start_time ?? null,
            )
            if (picked?.class_id) historicalClassId = picked.class_id
        }
        if (!coTeachesClassSubject(scope, exam?.subject_id, historicalClassId)) {
            return { ok: false, status: 403, error: 'Anda tidak mengajar kelas siswa ini' }
        }
    } else if (ctx.role !== 'ADMIN') {
        return { ok: false, status: 403, error: 'Forbidden' }
    }

    return deletePlaceholder('official_exam_submissions', sub)
}

async function deletePlaceholder(
    table: 'exam_submissions' | 'official_exam_submissions',
    sub: SubmissionPlaceholderRow,
): Promise<SusulanRevokeResult> {
    if (sub.is_submitted) {
        return { ok: false, status: 409, error: 'Siswa sudah mengumpulkan — susulan tidak bisa dibatalkan' }
    }
    if (sub.started_at) {
        return { ok: false, status: 409, error: 'Siswa sudah mulai mengerjakan — gunakan Reset, bukan batalkan susulan' }
    }
    if (!sub.susulan_granted_at) {
        return { ok: false, status: 400, error: 'Submission ini bukan grant susulan' }
    }
    const { data: deleted, error } = await supabase
        .from(table)
        .delete()
        .eq('id', sub.id)
        .is('started_at', null)
        .eq('is_submitted', false)
        .select('id')
    if (error) return { ok: false, status: 500, error: 'Gagal membatalkan susulan: ' + error.message }
    // Race: siswa mulai di antara SELECT validasi & DELETE. Jangan klaim sukses.
    if (!deleted || deleted.length === 0) {
        return { ok: false, status: 409, error: 'Siswa baru saja mulai mengerjakan — susulan tidak bisa dibatalkan. Gunakan Reset.' }
    }
    return { ok: true }
}
