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
import { getMenuLabelsForSchool } from './serverLabels'

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
        const { data: entity, error: entityError } = await supabase
            .from(isExam ? 'exams' : 'quizzes')
            .select(`
                title,
                teaching_assignment:teaching_assignments(
                    subject_id, class_id, academic_year_id,
                    academic_year:academic_years(school_id)
                )
            `)
            .eq('id', entry.entityId)
            .single()
        if (entityError || !entity) {
            console.error(`[teacherNotifyBuffer] Gagal memuat ${entry.kind} ${entry.entityId} untuk notifikasi guru:`, entityError)
            return
        }

        // Embed PostgREST bisa berupa objek atau array — ambil elemen pertama
        const first = <T,>(v: T | T[] | null | undefined): T | undefined =>
            Array.isArray(v) ? v[0] : (v ?? undefined)
        const ta = first(entity?.teaching_assignment as { academic_year?: unknown; subject_id?: string; class_id?: string; academic_year_id?: string } | { academic_year?: unknown; subject_id?: string; class_id?: string; academic_year_id?: string }[] | undefined)
        if (!ta?.class_id || !ta?.subject_id) return

        // Semua co-teacher (pengampu mapel+kelas yang sama) dapat notifikasi —
        // bukan hanya TA anchor. 1 exam per kelas, semua pengampu setara.
        let teacherUserIds: string[] = []
        let coTeacherQuery = supabase
            .from('teaching_assignments')
            .select('teacher:teachers(user_id)')
            .eq('subject_id', ta.subject_id)
            .eq('class_id', ta.class_id)
        if (ta.academic_year_id) coTeacherQuery = coTeacherQuery.eq('academic_year_id', ta.academic_year_id)
        const { data: coTeachers, error: coErr } = await coTeacherQuery
        if (coErr) {
            console.error(`[teacherNotifyBuffer] Gagal memuat co-teacher ${entry.kind} ${entry.entityId}:`, coErr)
            return
        }
        teacherUserIds = [...new Set(
            (coTeachers || [])
                .map((r: any) => (first(r?.teacher as { user_id?: string } | { user_id?: string }[] | undefined))?.user_id)
                .filter(Boolean)
        )] as string[]
        if (teacherUserIds.length === 0) return

        // classes tidak punya school_id — scope via teaching_assignments → academic_years
        const ayInfo = first(ta?.academic_year as { school_id?: string } | { school_id?: string }[] | undefined)
        const labels = await getMenuLabelsForSchool(ayInfo?.school_id ?? null)
        // mid-sentence di message: aslinya lowercase ("telah mengumpulkan ulangan ...")
        const label = (isExam ? labels.ulangan : labels.kuis).toLowerCase()
        const who = entry.count === 1
            ? entry.names[0]
            : entry.count <= NAMES_CAP
                ? entry.names.join(', ')
                : `${entry.names.slice(0, 2).join(', ')} dan ${entry.count - 2} siswa lain`

        const message = entry.force
            ? `${who} — ${label} "${entity?.title}" dikumpulkan otomatis karena pelanggaran`
            : `${who} telah mengumpulkan ${label} "${entity?.title}"`

        await supabase.from('notifications').insert(
            teacherUserIds.map(user_id => ({
                user_id,
                type: isExam ? 'SUBMISSION_ULANGAN' : 'SUBMISSION_KUIS',
                title: isExam
                    ? (entry.force ? `${labels.ulangan} Dikumpulkan Otomatis` : `${labels.ulangan} Dikumpulkan`)
                    : `${labels.kuis} Dikumpulkan`,
                message,
                link: isExam ? '/dashboard/guru/ulangan' : '/dashboard/guru/kuis'
            }))
        )
    } catch (error) {
        console.error('Error flushing teacher submission notification:', error)
    }
}
