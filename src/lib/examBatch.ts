import { supabaseAdmin } from './supabase'

/**
 * examBatch — sinkronisasi soal + status terbit untuk ujian/kuis multi-kelas
 * yang diikat kolom `batch_id` di database.
 *
 * Menggantikan linkage URL/sessionStorage (hilang saat tab tertutup).
 * Pola per sibling: insert-first (kegagalan insert tidak menghapus soal lama),
 * bersihkan soal lama setelah insert sukses, lalu terbitkan sibling + notifikasi
 * siswa kelas sibling (dengan dedup agar sync ulang tidak mengirim dua kali).
 */

export interface BatchSyncResult {
    total: number
    failed: string[]
}

/** Notifikasi "Ulangan/Kuis Baru" ke siswa kelas sibling yang baru diaktifkan. */
async function notifySiblingActivated(table: 'exams' | 'quizzes', targetId: string): Promise<void> {
    try {
        const { data: sibling } = await supabaseAdmin
            .from(table)
            .select('title, start_time, teaching_assignment:teaching_assignments(class_id, subject:subjects(name), class:classes(school_id))')
            .eq('id', targetId)
            .single()
        const ta = sibling?.teaching_assignment as any
        if (!sibling || !ta?.class_id) return

        const schoolId = ta?.class?.school_id
        let yearQuery = supabaseAdmin
            .from('academic_years').select('id')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
        if (schoolId) yearQuery = yearQuery.eq('school_id', schoolId)
        const { data: yearRows } = await yearQuery
        const yearId = yearRows?.[0]?.id
        if (!yearId) return

        const { data: enrollments } = await supabaseAdmin
            .from('student_enrollments')
            .select('student:students(user_id)')
            .eq('academic_year_id', yearId)
            .eq('class_id', ta.class_id)
            .eq('status', 'ACTIVE')
        const userIds = [...new Set(
            (enrollments || [])
                .map((e: any) => (Array.isArray(e.student) ? e.student[0]?.user_id : e.student?.user_id))
                .filter(Boolean)
        )] as string[]
        if (userIds.length === 0) return

        const isQuiz = table === 'quizzes'
        const type = isQuiz ? 'KUIS_BARU' : 'ULANGAN_BARU'
        const title = `${isQuiz ? 'Kuis' : 'Ulangan'} Baru: ${sibling.title}`
        const subjectName = ta?.subject?.name || ''
        const startDate = sibling.start_time
            ? new Date(sibling.start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
            : ''
        const link = isQuiz ? '/dashboard/siswa/kuis' : '/dashboard/siswa/ulangan'

        // Dedup: sync ulang tidak mengirim notifikasi kedua
        const { data: existing } = await supabaseAdmin
            .from('notifications').select('user_id')
            .in('user_id', userIds)
            .eq('title', title)
            .eq('type', type)
        const already = new Set((existing || []).map((n: any) => n.user_id))
        const toNotify = userIds.filter(uid => !already.has(uid))
        if (toNotify.length === 0) return

        await supabaseAdmin.from('notifications').insert(
            toNotify.map(uid => ({
                user_id: uid,
                type,
                title,
                message: `${subjectName} - Mulai: ${startDate}`,
                link
            }))
        )
    } catch (e) {
        console.error('[batch] gagal mengirim notifikasi sibling:', e)
    }
}

async function syncBatch(
    table: 'exams' | 'quizzes',
    questionsTable: 'exam_questions' | 'quiz_questions',
    fkColumn: 'exam_id' | 'quiz_id',
    primaryId: string,
    /** Field jadwal yang ikut disinkronkan ke sibling saat publish (jendela/serentak). */
    timingFields: string[]
): Promise<BatchSyncResult> {
    // Select dinamis (field jadwal berbeda per tabel) — tipe di-cast manual
    const { data } = await supabaseAdmin
        .from(table).select('id, batch_id, ' + timingFields.join(', ')).eq('id', primaryId).single()
    const primary = data as { id: string; batch_id: string | null } & Record<string, unknown> | null
    if (!primary?.batch_id) return { total: 0, failed: [] }

    const { data: siblings } = await supabaseAdmin
        .from(table).select('id').eq('batch_id', primary.batch_id).neq('id', primaryId)
    const siblingIds = (siblings || []).map(s => s.id as string)
    if (siblingIds.length === 0) return { total: 0, failed: [] }

    const { data: sourceQuestions, error: srcErr } = await supabaseAdmin
        .from(questionsTable).select('*').eq(fkColumn, primaryId)
    if (srcErr) throw srcErr
    // Primary tanpa soal = semua sibling gagal (caller sudah menjaga publish 0 soal,
    // ini pelindung ganda)
    if (!sourceQuestions || sourceQuestions.length === 0) {
        return { total: siblingIds.length, failed: siblingIds }
    }

    const failed: string[] = []
    for (const targetId of siblingIds) {
        try {
            const rows = sourceQuestions.map((q: any) => {
                const { id, created_at, ...rest } = q
                delete rest[fkColumn]
                return { ...rest, [fkColumn]: targetId }
            })

            // Snapshot soal lama target (dibersihkan setelah insert sukses)
            const { data: oldRows, error: fetchOldError } = await supabaseAdmin
                .from(questionsTable).select('id').eq(fkColumn, targetId)
            if (fetchOldError) {
                console.error(`[batch] fetch old questions gagal untuk ${targetId}:`, fetchOldError)
                failed.push(targetId)
                continue
            }
            const oldIds = (oldRows || []).map((r: any) => r.id)

            const { error: insertError } = await supabaseAdmin
                .from(questionsTable).insert(rows)
            if (insertError) {
                console.error(`[batch] insert soal gagal untuk ${targetId}:`, insertError)
                failed.push(targetId)
                continue
            }

            if (oldIds.length > 0) {
                const { error: deleteError } = await supabaseAdmin
                    .from(questionsTable).delete().in('id', oldIds)
                if (deleteError) {
                    // Tidak fatal: target punya soal ganda sementara, bukan kehilangan soal
                    console.error(`[batch] cleanup soal lama gagal untuk ${targetId}:`, deleteError)
                }
            }

            // Jadwal (jam buka/tutup/durasi) ikut disinkronkan dari kelas utama —
            // batch multi-kelas adalah satu kesatuan. Perubahan jadwal per-kelas
            // yang berbeda tetap bisa lewat form pengaturan masing-masing editor.
            const timingUpdate: Record<string, unknown> = {}
            for (const f of timingFields) timingUpdate[f] = (primary as any)[f] ?? null

            const { error: pubError } = await supabaseAdmin
                .from(table)
                .update({ is_active: true, updated_at: new Date().toISOString(), ...timingUpdate })
                .eq('id', targetId)
            if (pubError) {
                console.error(`[batch] aktivasi gagal untuk ${targetId}:`, pubError)
                failed.push(targetId)
                continue
            }

            // Beritahu siswa kelas sibling (dedup — sync ulang tidak mengirim dua kali)
            await notifySiblingActivated(table, targetId)
        } catch (e) {
            console.error(`[batch] error tak terduga untuk ${targetId}:`, e)
            failed.push(targetId)
        }
    }

    return { total: siblingIds.length, failed }
}

export async function syncExamBatch(primaryExamId: string): Promise<BatchSyncResult> {
    return syncBatch('exams', 'exam_questions', 'exam_id', primaryExamId, ['start_time', 'duration_minutes', 'window_end_time'])
}

export async function syncQuizBatch(primaryQuizId: string): Promise<BatchSyncResult> {
    return syncBatch('quizzes', 'quiz_questions', 'quiz_id', primaryQuizId, ['duration_minutes', 'deadline', 'available_from'])
}
