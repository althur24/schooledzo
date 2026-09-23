import { supabaseAdmin } from './supabase'
import { getMenuLabelsForSchool } from './serverLabels'
import { batchedIn } from './batchedIn'
import { fetchAllRows } from './fetchAllRows'

/**
 * examBatch — sinkronisasi soal + status terbit untuk ujian/kuis multi-kelas
 * yang diikat kolom `batch_id` di database.
 *
 * Menggantikan linkage URL/sessionStorage (hilang saat tab tertutup).
 * Pola per sibling: insert-first (kegagalan insert tidak menghapus soal lama),
 * bersihkan soal lama setelah insert sukses, lalu terbitkan sibling + notifikasi
 * siswa kelas sibling (dengan dedup agar sync ulang tidak mengirim dua kali).
 *
 * ─── Pencegahan runaway (kasus nyata 2026-09-16: batch 6 kelas × 15 soal
 * membengkak jadi ±777.000 baris karena cleanup delete .in(>±440 id) ditolak
 * URL-limit dan setiap save menambah salinan baru) ───
 *  - Semua fetch soal lewat fetchAllRows + .order('id') (batas potong 1000).
 *  - Semua delete oldIds lewat batchedIn chunk 100 (batas URL 16KB).
 *  - Insert belah chunk 500 baris.
 *  - SOURCE_QUESTIONS_LIMIT: sumber > 500 soal = data anomali — sync DITOLAK
 *    keras supaya exam rusak tidak menular ke sibling lain.
 *  - Idempotency guard: target yang isinya sudah identik dengan sumber
 *    (count + fingerprint) di-skip — memutus spiral duplikasi tanpa mengubah
 *    kontrak, dan membuat sync ulang murah.
 *  - Lock in-process per batch: sync paralel untuk batch yang sama diper
 *    (queue) — dua sync membaca oldIds lalu insert ganda adalah sumber
 *    duplikat pertama pada kasus runaway.
 */

// pickBatchRepresentativeIds/BatchMemberRow kini hidup di examBatchGrouping
// (module pure — examBatch meng-import supabaseAdmin sehingga tidak boleh
// dipakai komponen client). Re-export untuk backward-compat server callers.
export { pickBatchRepresentativeIds, type BatchMemberRow } from './examBatchGrouping'

export interface BatchSyncResult {
    total: number
    failed: string[]
}

export interface BatchInfo {
    /**
     * Jumlah KELAS unik dalam batch — bukan jumlah baris exam/quiz.
     * Batch lama (pra co-teaching) bisa berisi beberapa exam untuk kelas
     * yang sama (satu per guru pengampu); kelas tetap dihitung sekali
     * agar badge "N Kelas Paralel" mencerminkan jumlah kelas sesungguhnya.
     */
    uniqueClassCount: number
    /** Nama kelas unik, urut abjad — untuk tooltip badge. */
    classNames: string[]
}

/**
 * Batas jumlah soal sumber yang masih disinkronkan. Sumber di atas ini =
 * data anomali (import/generate gila, atau bekas runaway) — menyalinnya ke
 * semua sibling hanya melipatgandakan kerusakan. 500 soal jauh di atas
 * ulangan/kuis yang wajar (lihat data historis: maks 50).
 */
const SOURCE_QUESTIONS_LIMIT = 500

/** Ukuran chunk insert (PostgREST nyaman dengan payload ratusan baris). */
const INSERT_CHUNK = 500

/**
 * Lock per batch (in-process): sync untuk batch yang sama berjalan satu
 * per satu. Next.js route handler = satu proses Node di Railway (next start),
 * jadi lock ini efektif untuk seluruh request dalam satu instance.
 */
const batchLocks = new Map<string, Promise<unknown>>()

async function withBatchLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    const prev = batchLocks.get(lockKey) ?? Promise.resolve()
    const run = prev.then(fn, fn)
    // Simpan tail; bersihkan entry saat antrian habis agar map tidak bocor
    const settled = run.catch(() => { })
    batchLocks.set(lockKey, settled)
    settled.finally(() => {
        if (batchLocks.get(lockKey) === settled) batchLocks.delete(lockKey)
    })
    return run
}

/** Fingerprint konten soal — dipakai idempotency guard (stabil walau id/created_at beda). */
function questionFingerprint(q: any): string {
    return JSON.stringify([
        q.order_index ?? 0,
        q.question_text ?? '',
        q.question_type ?? '',
        q.options ?? null,
        q.correct_answer ?? null,
        q.points ?? 0,
        q.difficulty ?? null,
        q.passage_text ?? null,
        q.image_url ?? null,
        q.status ?? null,
        q.gk_grading_mode ?? null,
    ])
}

/** Signature isi sebuah exam/quiz: jumlah + fingerprint semua soal (urut stabil). */
async function questionsSignature(
    questionsTable: 'exam_questions' | 'quiz_questions',
    fkColumn: 'exam_id' | 'quiz_id',
    targetId: string
): Promise<{ count: number; fingerprint: string } | null> {
    const rows = await fetchAllRows(supabaseAdmin
        .from(questionsTable)
        .select('order_index, question_text, question_type, options, correct_answer, points, difficulty, passage_text, image_url, status, gk_grading_mode')
        .eq(fkColumn, targetId)
        .order('id'))
    const fps = rows.map(questionFingerprint).sort()
    return { count: rows.length, fingerprint: fps.join('|') }
}

/** Baca SEMUA soal sumber (fetchAllRows + order stabil) — null bila error.
 *  Order = order_index + id (bukan id saja: id UUID acak ≠ urutan insert —
 *  baris hasil mirror harus ter-insert terurut pedagogis agar urutan fisik
 *  tabel tetap = order_index untuk pembaca embed tanpa order eksplisit). */
async function fetchAllQuestions(
    questionsTable: 'exam_questions' | 'quiz_questions',
    fkColumn: 'exam_id' | 'quiz_id',
    sourceId: string
): Promise<any[] | null> {
    const rows = await fetchAllRows(supabaseAdmin
        .from(questionsTable)
        .select('*')
        .eq(fkColumn, sourceId)
        .order('order_index', { ascending: true })
        .order('id'))
    return rows
}

/** Hapus baris soal lama dalam chunk aman URL (batchedIn chunk 100). */
async function deleteQuestionsByIds(
    questionsTable: 'exam_questions' | 'quiz_questions',
    ids: string[]
): Promise<void> {
    // Callback WAJIB mengembalikan query builder-nya — batchedIn mendestructure
    // { data, error } dari hasil callback; callback void (undefined) membuatnya
    // TypeError padahal delete sudah tereksekusi (false failure → syncBatch
    // meng-skip aktivasi sibling yang sebenarnya berhasil di-mirror).
    await batchedIn('id', ids, (chunk) =>
        supabaseAdmin.from(questionsTable).delete().in('id', chunk)
    )
}

/** Insert baris soal dalam chunk 500 — melempar error bila ada chunk gagal. */
async function insertQuestionsChunked(
    questionsTable: 'exam_questions' | 'quiz_questions',
    rows: any[]
): Promise<void> {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const { error } = await supabaseAdmin
            .from(questionsTable)
            .insert(rows.slice(i, i + INSERT_CHUNK))
        if (error) throw new Error(`${questionsTable} insert chunk gagal: ${error.message}`)
    }
}

/**
 * Mirror soal sumber → satu target (replace penuh, insert-first).
 * - Skip bila isi target sudah identik (idempotency — anti spiral).
 * - Cleanup oldIds via batchedIn (anti URL-limit — akar kasus runaway).
 * - Gagal cleanup = FAILED (bukan "tidak fatal"): duplikat menetap adalah
 *   kondisi yang memulai runaway dulu; biarkan sync berikutnya mencoba lagi.
 * Return true bila target berhasil disamakan dengan sumber.
 */
async function mirrorQuestionsToTarget(
    questionsTable: 'exam_questions' | 'quiz_questions',
    fkColumn: 'exam_id' | 'quiz_id',
    sourceQuestions: any[],
    sourceSignature: { count: number; fingerprint: string },
    targetId: string
): Promise<boolean> {
    try {
        // Idempotency: isi target sudah identik → tidak ada kerjaan
        const targetSig = await questionsSignature(questionsTable, fkColumn, targetId)
        if (targetSig && targetSig.count === sourceSignature.count
            && targetSig.fingerprint === sourceSignature.fingerprint) {
            return true
        }

        // Snapshot soal lama target (dibersihkan setelah insert sukses)
        const oldRows = await fetchAllRows(supabaseAdmin
            .from(questionsTable)
            .select('id')
            .eq(fkColumn, targetId)
            .order('id'))
        const oldIds = (oldRows || []).map((r: any) => r.id)

        // Insert-first; sumber kosong = cukup bersihkan target
        if (sourceQuestions.length > 0) {
            const insertRows = sourceQuestions.map((q: any) => {
                const { id, created_at, ...rest } = q
                delete rest[fkColumn]
                return { ...rest, [fkColumn]: targetId }
            })
            await insertQuestionsChunked(questionsTable, insertRows)
        }

        if (oldIds.length > 0) {
            await deleteQuestionsByIds(questionsTable, oldIds)
        }
        return true
    } catch (e) {
        console.error(`[batch-mirror] gagal untuk ${targetId}:`, e)
        return false
    }
}

/**
 * Info batch multi-kelas untuk sekumpulan exam/quiz.
 *
 * Dipakai API list agar UI bisa menampilkan badge "N Kelas Paralel" yang
 * akurat (kelas unik, bukan jumlah exam) beserta tooltip nama kelasnya —
 * guru (terutama yang senior) perlu tahu kelas mana saja yang tersinkron.
 *
 * Query terpisah (bukan hitung dari data yang sudah terfilter) supaya
 * ukuran batch tetap benar walau list dipangkas (filter TA / tahun ajaran).
 */
export async function getBatchInfo(
    table: 'exams' | 'quizzes',
    batchIds: string[]
): Promise<Map<string, BatchInfo>> {
    const byBatch = new Map<string, { classIds: Set<string>; nameById: Map<string, string> }>()
    if (batchIds.length === 0) return new Map()

    try {
        // batchedIn: jumlah anggota batch bisa ratusan (belah per 100 — batas URL)
        const rows = await batchedIn<any>('batch_id', batchIds, (chunk) =>
            supabaseAdmin
                .from(table)
                .select('batch_id, teaching_assignment:teaching_assignments(class:classes(id, name))')
                .in('batch_id', chunk)
        )

        for (const row of rows || []) {
            const batchId = row?.batch_id as string | null
            if (!batchId) continue
            // Embed PostgREST bisa objek atau array — ambil elemen pertama
            const ta = Array.isArray(row.teaching_assignment) ? row.teaching_assignment[0] : row.teaching_assignment
            const cls = Array.isArray(ta?.class) ? ta?.class[0] : ta?.class
            let entry = byBatch.get(batchId)
            if (!entry) {
                entry = { classIds: new Set(), nameById: new Map<string, string>() }
                byBatch.set(batchId, entry)
            }
            if (cls?.id && !entry.classIds.has(cls.id)) {
                entry.classIds.add(cls.id)
                entry.nameById.set(cls.id, cls.name || '-')
            }
        }
    } catch (err) {
        // Degrade seperti pendahulunya (getBatchSizes): kegagalan hitung batch
        // tidak boleh merobohkan daftar ulangan/kuis — caller fallback ke 1.
        console.error(`[batch] gagal menghitung info batch ${table}:`, err)
        return new Map()
    }

    const result = new Map<string, BatchInfo>()
    for (const [batchId, entry] of byBatch) {
        result.set(batchId, {
            uniqueClassCount: entry.classIds.size,
            classNames: [...entry.nameById.values()].sort((a, b) => a.localeCompare(b)),
        })
    }
    return result
}

/** Notifikasi "Ulangan/Kuis Baru" ke siswa kelas sibling yang baru diaktifkan. */
async function notifySiblingActivated(table: 'exams' | 'quizzes', targetId: string): Promise<void> {
    try {
        const { data: sibling } = await supabaseAdmin
            .from(table)
            .select('title, start_time, teaching_assignment:teaching_assignments(class_id, subject:subjects(name), academic_year:academic_years(school_id))')
            .eq('id', targetId)
            .single()
        const ta = sibling?.teaching_assignment as any
        if (!sibling || !ta?.class_id) return

        // classes tidak punya school_id — scope via academic_years
        const schoolId = ta?.academic_year?.school_id
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
        const labels = await getMenuLabelsForSchool(schoolId ?? null)
        const type = isQuiz ? 'KUIS_BARU' : 'ULANGAN_BARU'
        const title = `${isQuiz ? labels.kuis : labels.ulangan} Baru: ${sibling.title}`
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

    return withBatchLock(`${table}:${primary.batch_id}`, async () => {
        const { data: siblings } = await supabaseAdmin
            .from(table).select('id').eq('batch_id', primary.batch_id).neq('id', primaryId)
        const siblingIds = (siblings || []).map(s => s.id as string)
        if (siblingIds.length === 0) return { total: 0, failed: [] }

        const sourceQuestions = await fetchAllQuestions(questionsTable, fkColumn, primaryId)
        if (!sourceQuestions) throw new Error(`gagal membaca soal sumber ${primaryId}`)
        // Primary tanpa soal = semua sibling gagal (caller sudah menjaga publish 0 soal,
        // ini pelindung ganda)
        if (sourceQuestions.length === 0) {
            return { total: siblingIds.length, failed: siblingIds }
        }
        // Guard runaway: sumber anomali TIDAK disalin — laporkan semua sibling gagal
        // agar caller tahu publish tidak menular.
        if (sourceQuestions.length > SOURCE_QUESTIONS_LIMIT) {
            console.error(`[batch] ABORT sync ${table} ${primaryId}: sumber punya ${sourceQuestions.length} soal (> ${SOURCE_QUESTIONS_LIMIT}) — data anomali, penyalinan ditolak agar tidak menular ke sibling.`)
            return { total: siblingIds.length, failed: siblingIds }
        }

        const sourceSig = {
            count: sourceQuestions.length,
            fingerprint: sourceQuestions.map(questionFingerprint).sort().join('|'),
        }

        const failed: string[] = []
        for (const targetId of siblingIds) {
            try {
                const mirrored = await mirrorQuestionsToTarget(
                    questionsTable, fkColumn, sourceQuestions, sourceSig, targetId
                )
                if (!mirrored) {
                    failed.push(targetId)
                    continue
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
    })
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

    return withBatchLock(`${table}:${primary.batch_id}`, async () => {
        const { data: siblings } = await supabaseAdmin
            .from(table).select('id, is_active').eq('batch_id', primary.batch_id).neq('id', primaryId)
        // JANGAN sentuh sibling yang sudah aktif/publish: publish batch bisa gagal
        // parsial (satu kelas aktif, lainnya masih draft). Menimpa soal exam aktif
        // di tengah ujian akan memutus jawaban siswa yang mengacu id soal lama.
        const siblingIds = (siblings || [])
            .filter(s => !(s as { is_active: boolean | null }).is_active)
            .map(s => s.id as string)
        if (siblingIds.length === 0) return { total: 0, failed: [] }

        const sourceQuestions = await fetchAllQuestions(questionsTable, fkColumn, primaryId)
        if (!sourceQuestions) throw new Error(`gagal membaca soal sumber ${primaryId}`)

        // Guard runaway: draft anomali TIDAK disalin ke sibling lain.
        // (Kasus 2026-09-16: sumber 35k–224k soal terus menular antar 6 member.)
        if (sourceQuestions.length > SOURCE_QUESTIONS_LIMIT) {
            console.error(`[draft-sync] ABORT ${table} ${primaryId}: sumber punya ${sourceQuestions.length} soal (> ${SOURCE_QUESTIONS_LIMIT}) — data anomali, mirror ditolak agar tidak menular.`)
            return { total: siblingIds.length, failed: siblingIds }
        }

        const sourceSig = {
            count: sourceQuestions.length,
            fingerprint: sourceQuestions.map(questionFingerprint).sort().join('|'),
        }

        const failed: string[] = []
        for (const targetId of siblingIds) {
            const mirrored = await mirrorQuestionsToTarget(
                questionsTable, fkColumn, sourceQuestions, sourceSig, targetId
            )
            if (!mirrored) failed.push(targetId)
        }

        return { total: siblingIds.length, failed }
    })
}

export async function syncDraftExamQuestions(primaryExamId: string): Promise<BatchSyncResult> {
    return syncDraftQuestionsBatch('exams', 'exam_questions', 'exam_id', primaryExamId)
}

export async function syncDraftQuizQuestions(primaryQuizId: string): Promise<BatchSyncResult> {
    return syncDraftQuestionsBatch('quizzes', 'quiz_questions', 'quiz_id', primaryQuizId)
}
