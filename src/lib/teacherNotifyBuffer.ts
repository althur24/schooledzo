/**
 * teacherNotifyBuffer.ts — agregasi notifikasi "pengumpulan" ke guru.
 *
 * Masalah: saat 1000 siswa submit serentak di menit-menit akhir ulangan,
 * tiap submit men-INSERT 1 notifikasi ke guru → 1000 baris notifikasi +
 * 1000 select exam/quiz (hanya untuk ambil judul & user_id guru).
 *
 * Solusi: submit hanya menambah hitungan di buffer in-memory. Sekali per
 * jendela 60 detik per (guru, exam/kuis, varian), SATU notifikasi ringkasan
 * di-flush (select judul+guru juga cukup sekali per flush, bukan per submit).
 * Best-effort: kegagalan flush tidak memengaruhi submit siswa.
 */

import { supabaseAdmin as supabase } from './supabase'

type SubmissionKind = 'exam' | 'quiz'

const FLUSH_MS = 60_000
const NAMES_CAP = 3

interface BufferedSubmission {
    kind: SubmissionKind
    entityId: string
    force: boolean
    names: string[]
    count: number
    timer: NodeJS.Timeout
}

const buffers = new Map<string, BufferedSubmission>()

export function bufferTeacherSubmissionNotification(
    kind: SubmissionKind,
    entityId: string,
    studentName: string,
    isForceSubmit: boolean = false
) {
    const key = `${kind}:${entityId}:${isForceSubmit ? 'force' : 'normal'}`
    const existing = buffers.get(key)
    if (existing) {
        existing.count++
        if (existing.names.length < NAMES_CAP) existing.names.push(studentName)
        return
    }

    const entry: BufferedSubmission = {
        kind,
        entityId,
        force: isForceSubmit,
        names: [studentName],
        count: 1,
        timer: setTimeout(() => { flush(key) }, FLUSH_MS)
    }
    buffers.set(key, entry)
}

async function flush(key: string) {
    const entry = buffers.get(key)
    if (!entry) return
    buffers.delete(key)

    try {
        const isExam = entry.kind === 'exam'
        const { data: entity } = await supabase
            .from(isExam ? 'exams' : 'quizzes')
            .select(`
                title,
                teaching_assignment:teaching_assignments(
                    teacher:teachers(user_id)
                )
            `)
            .eq('id', entry.entityId)
            .single()

        // Embed PostgREST bisa berupa objek atau array — ambil elemen pertama
        const first = <T,>(v: T | T[] | null | undefined): T | undefined =>
            Array.isArray(v) ? v[0] : (v ?? undefined)
        const ta = first(entity?.teaching_assignment as { teacher?: unknown } | { teacher?: unknown }[] | undefined)
        const teacherUserId = (first(ta?.teacher as { user_id?: string } | { user_id?: string }[] | undefined))?.user_id
        if (!teacherUserId) return

        const label = isExam ? 'ulangan' : 'kuis'
        const who = entry.count === 1
            ? entry.names[0]
            : entry.count <= NAMES_CAP
                ? entry.names.join(', ')
                : `${entry.names.slice(0, 2).join(', ')} dan ${entry.count - 2} siswa lain`

        const message = entry.force
            ? `${who} — ${label} "${entity?.title}" dikumpulkan otomatis karena pelanggaran`
            : `${who} telah mengumpulkan ${label} "${entity?.title}"`

        await supabase.from('notifications').insert({
            user_id: teacherUserId,
            type: isExam ? 'SUBMISSION_ULANGAN' : 'SUBMISSION_KUIS',
            title: isExam
                ? (entry.force ? 'Ulangan Dikumpulkan Otomatis' : 'Ulangan Dikumpulkan')
                : 'Kuis Dikumpulkan',
            message,
            link: isExam ? '/dashboard/guru/ulangan' : '/dashboard/guru/kuis'
        })
    } catch (error) {
        console.error('Error flushing teacher submission notification:', error)
    }
}
