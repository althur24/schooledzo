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

export interface BatchMemberRow {
    id: string
    batch_id: string | null
    pending_publish: boolean | null
    created_at: string | null
}

/**
 * Hitung jumlah anggota per batch untuk sekumpulan exam/quiz.
 *
 * Dipakai API list agar UI bisa menampilkan badge "N Kelas Paralel" —
 * guru (terutama yang senior) perlu tahu bahwa card yang diedit akan
 * tersinkron ke kelas lain dalam batch yang sama.
 *
 * Query terpisah (bukan hitung dari data yang sudah terfilter) supaya
 * ukuran batch tetap benar walau list dipangkas (filter TA / tahun ajaran).
 */
export async function getBatchSizes(
    table: 'exams' | 'quizzes',
    batchIds: string[]
): Promise<Map<string, number>> {
    const sizes = new Map<string, number>()
    if (batchIds.length === 0) return sizes

    const { data, error } = await supabaseAdmin
        .from(table)
        .select('batch_id')
        .in('batch_id', batchIds)

    if (error) {
        console.error(`[batch] gagal menghitung ukuran batch ${table}:`, error)
        return sizes
    }
    for (const row of data || []) {
        const id = (row as { batch_id: string | null }).batch_id
        if (id) sizes.set(id, (sizes.get(id) || 0) + 1)
    }
    return sizes
}

/**
 * Pilih satu exam/quiz "representative" per batch multi-kelas.
 *
 * Anggota batch berbagi soal identik (hasil mirror), jadi antrian review admin
 * dan notifikasi "soal dikembalikan" cukup menampilkan satu anggota — tanpa ini,
 * batch 3 kelas × 10 soal membanjiri antrian dengan 30 baris identik.
 *
 * Prioritas representative: anggota yang sedang `pending_publish` (menunggu
 * review agar bisa dipublish), kalau tidak ada maka anggota tertua (primary).
 * Anggota di luar batch (batch_id null) selalu lolos.
 */
export function pickBatchRepresentativeIds(rows: BatchMemberRow[]): string[] {
    const byBatch = new Map<string, BatchMemberRow[]>()
    const singles: string[] = []

    for (const row of rows) {
        if (!row.batch_id) {
            singles.push(row.id)
            continue
        }
        const list = byBatch.get(row.batch_id) || []
        list.push(row)
        byBatch.set(row.batch_id, list)
    }

    const representativeIds = [...singles]
    for (const members of byBatch.values()) {
        const sorted = [...members].sort((a, b) =>
            new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        )
        const pending = sorted.find(m => m.pending_publish)
        representativeIds.push((pending || sorted[0]).id)
    }
    return representativeIds
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
                .update({ is_active: true, pending_publish: false, updated_at: new Date().toISOString(), ...timingUpdate })
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

/**
 * Mirror soal dari primary ke semua sibling batch SELAGI MASIH DRAFT.
 *
 * Tanpa ini, soal yang disimpan guru hanya menempel di exam kelas pertama;
 * kelas lain kosong sampai publish (bug "draft multi-kelas kehilangan soal").
 *
 * Perbedaan vs syncBatch (publish): tidak mengaktifkan sibling, tidak
 * mengirim notifikasi, tidak menyentuh jadwal, dan tetap mirror saat primary
 * kosong (mis. guru menghapus semua soal) agar sibling konsisten.
 */
async function syncDraftQuestionsBatch(
    table: 'exams' | 'quizzes',
    questionsTable: 'exam_questions' | 'quiz_questions',
    fkColumn: 'exam_id' | 'quiz_id',
    primaryId: string
): Promise<BatchSyncResult> {
    const { data: primary } = await supabaseAdmin
        .from(table).select('id, batch_id, is_active').eq('id', primaryId).single()
    // Hanya untuk draft batch multi-kelas; exam aktif tetap lewat alur publish
    if (!primary?.batch_id || primary.is_active) return { total: 0, failed: [] }

    const { data: siblings } = await supabaseAdmin
        .from(table).select('id, is_active').eq('batch_id', primary.batch_id).neq('id', primaryId)
    // JANGAN sentuh sibling yang sudah aktif/publish: publish batch bisa gagal
    // parsial (satu kelas aktif, lainnya masih draft). Menimpa soal exam aktif
    // di tengah ujian akan memutus jawaban siswa yang mengacu id soal lama.
    const siblingIds = (siblings || [])
        .filter(s => !(s as { is_active: boolean | null }).is_active)
        .map(s => s.id as string)
    if (siblingIds.length === 0) return { total: 0, failed: [] }

    const { data: sourceQuestions, error: srcErr } = await supabaseAdmin
        .from(questionsTable).select('*').eq(fkColumn, primaryId)
    if (srcErr) throw srcErr

    const rowsToCopy = (sourceQuestions || []).map((q: any) => {
        const { id, created_at, ...rest } = q
        delete rest[fkColumn]
        return rest
    })

    const failed: string[] = []
    for (const targetId of siblingIds) {
        try {
            // Snapshot soal lama target (dibersihkan setelah insert sukses)
            const { data: oldRows, error: fetchOldError } = await supabaseAdmin
                .from(questionsTable).select('id').eq(fkColumn, targetId)
            if (fetchOldError) {
                console.error(`[draft-sync] fetch old questions gagal untuk ${targetId}:`, fetchOldError)
                failed.push(targetId)
                continue
            }
            const oldIds = (oldRows || []).map((r: any) => r.id)

            // Insert-first; primary kosong = cukup bersihkan target
            if (rowsToCopy.length > 0) {
                const insertRows = rowsToCopy.map(r => ({ ...r, [fkColumn]: targetId }))
                const { error: insertError } = await supabaseAdmin
                    .from(questionsTable).insert(insertRows)
                if (insertError) {
                    console.error(`[draft-sync] insert soal gagal untuk ${targetId}:`, insertError)
                    failed.push(targetId)
                    continue
                }
            }

            if (oldIds.length > 0) {
                const { error: deleteError } = await supabaseAdmin
                    .from(questionsTable).delete().in('id', oldIds)
                if (deleteError) {
                    // Tidak fatal: target punya soal ganda sementara, bukan kehilangan soal
                    console.error(`[draft-sync] cleanup soal lama gagal untuk ${targetId}:`, deleteError)
                }
            }
        } catch (e) {
            console.error(`[draft-sync] error tak terduga untuk ${targetId}:`, e)
            failed.push(targetId)
        }
    }

    return { total: siblingIds.length, failed }
}

export async function syncDraftExamQuestions(primaryExamId: string): Promise<BatchSyncResult> {
    return syncDraftQuestionsBatch('exams', 'exam_questions', 'exam_id', primaryExamId)
}

export async function syncDraftQuizQuestions(primaryQuizId: string): Promise<BatchSyncResult> {
    return syncDraftQuestionsBatch('quizzes', 'quiz_questions', 'quiz_id', primaryQuizId)
}
