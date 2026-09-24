/**
 * Auto-notify teachers when official exams (UTS/UAS) end.
 *
 * Checks for exams where:
 *   - is_active = true
 *   - end time (start_time + duration_minutes) has passed
 *
 * Sends a one-time notification to all relevant subject teachers.
 * Uses a unique notification `link` per exam to avoid duplicates.
 *
 * DOES NOT touch `is_active` — ujian yang sudah berakhir tetap published
 * supaya badge admin/guru menampilkan "Selesai" (bukan "Draft"), paritas
 * dengan tabel exams (ulangan). Jangan tambahkan auto-deactivate lagi:
 * getOfficialExamStatus mengecek is_active SEBELUM waktu, jadi ujian
 * yang dimatikan di sini tidak bisa pernah tampil "Selesai".
 *
 * BIAYA (pelajaran CPU 100% 24 Sep 2026): helper ini dulunya loop
 * per-ujian-berakhir dengan SATU query dedup notifications per iterasi
 * (seq-scan tanpa index) — dipicu SETIAP GET /api/official-exams termasuk
 * oleh siswa. Set ujian berakhir-aktif tumbuh permanen (98+), burst siswa
 * jam UTS mem-pin DB. Sekarang:
 *   1. Route hanya memanggil untuk GURU/ADMIN (siswa tak butuh notif guru).
 *   2. Throttle in-process per sekolah (TTL 10 mnt) — refresh halaman tidak
 *      menghajar ulang.
 *   3. Dedup BATCH: satu query .in('link', semuaLink) untuk semua kandidat.
 *   4. Hanya ujian yang berakhir <= 7 hari (lebih tua dari itu notifikasi
 *      sudah tidak relevan — korban reaktivasi lama keluar dari loop
 *      selamanya).
 *
 * This is a fire-and-forget helper — call it from GET /api/official-exams
 * so it triggers whenever admin/guru opens the UTS/UAS page.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'
import { batchedIn } from '@/lib/batchedIn'

/** Throttle per sekolah — halaman list dibuka berkali-kali per menit. */
const CHECK_THROTTLE_MS = 10 * 60 * 1000
const lastRunBySchool = new Map<string, number>()

/**
 * Ujian berakhir lebih tua dari ini tidak diproses. Tanpa batas, daftar
 * kandidat tumbuh permanen (ujian aktif tidak pernah dinonaktifkan lagi)
 * — tradeoff disengaja: notifikasi "selesai" >7 hari sudah tidak relevan.
 */
const MAX_ENDED_AGE_MS = 7 * 24 * 60 * 60 * 1000

export async function checkEndedOfficialExams(schoolId: string): Promise<void> {
    try {
        // Throttle di depan (sinkron, sebelum await apa pun) supaya GET
        // serentak tidak lolos semua sebelum run pertama selesai. Kalau run
        // ini gagal, retry berikutnya menunggu TTL — dapat diterima untuk
        // notifikasi kosmetik.
        const lastRun = lastRunBySchool.get(schoolId) ?? 0
        if (Date.now() - lastRun < CHECK_THROTTLE_MS) return
        lastRunBySchool.set(schoolId, Date.now())

        const labels = await getMenuLabelsForSchool(schoolId)
        const now = new Date()

        // Get all active official exams for this school
        const { data: activeExams } = await supabase
            .from('official_exams')
            .select('id, title, exam_type, start_time, duration_minutes, window_end_time, subject_id, target_class_ids, school_id, subject:subjects(name)')
            .eq('school_id', schoolId)
            .eq('is_active', true)

        if (!activeExams || activeExams.length === 0) return

        // Filter exams whose end time has passed — tapi hanya yang berakhir
        // <= 7 hari (mode jendela → jam tutup; mode serentak → start + durasi)
        const nowMs = now.getTime()
        const endedExams = activeExams.filter(exam => {
            const endTimeMs = exam.window_end_time
                ? new Date(exam.window_end_time).getTime()
                : new Date(new Date(exam.start_time).getTime() + exam.duration_minutes * 60 * 1000).getTime()
            const age = nowMs - endTimeMs
            return age > 0 && age <= MAX_ENDED_AGE_MS
        })

        if (endedExams.length === 0) return

        // Get active academic year
        const { data: activeYear } = await supabase
            .from('academic_years')
            .select('id')
            .eq('is_active', true)
            .eq('school_id', schoolId)
            .single()

        if (!activeYear) return

        // Dedup BATCH — satu query (pecah per 100 link via batchedIn) untuk
        // semua kandidat, menggantikan satu query per ujian (seq-scan
        // notifications × 98 ujian = root cause CPU 100%). Dua format link:
        // `#hasil` (kini) dan `/hasil` (legacy halaman lama).
        const notifLink = (examId: string) => `/dashboard/guru/uts-uas/${examId}#hasil`
        const legacyNotifLink = (examId: string) => `/dashboard/guru/uts-uas/${examId}/hasil`
        const allLinks = endedExams.flatMap(exam => [notifLink(exam.id), legacyNotifLink(exam.id)])
        const existingNotifs = await batchedIn<{ link: string }>('link', allLinks, chunk =>
            supabase
                .from('notifications')
                .select('link')
                .eq('type', 'UJIAN_SELESAI')
                .in('link', chunk)
        )
        const notifiedLinks = new Set(existingNotifs.map(n => n.link))

        for (const exam of endedExams) {
            // Skip jika notifikasi sudah terkirim (cek batch di atas)
            if (notifiedLinks.has(notifLink(exam.id)) || notifiedLinks.has(legacyNotifLink(exam.id))) continue

            // Find teachers who teach this subject in target classes
            if (!exam.target_class_ids?.length) continue

            const { data: assignments } = await supabase
                .from('teaching_assignments')
                .select('teacher:teachers(user_id)')
                .eq('subject_id', exam.subject_id)
                .in('class_id', exam.target_class_ids)
                .eq('academic_year_id', activeYear.id)

            if (!assignments || assignments.length === 0) continue

            type TaRow = { teacher?: Array<{ user_id?: string }> | { user_id?: string } }
            const teacherUserIds = [...new Set(
                (assignments as TaRow[]).map(a => {
                    const t = Array.isArray(a.teacher) ? a.teacher[0] : a.teacher
                    return t?.user_id
                }).filter((uid): uid is string => typeof uid === 'string')
            )]

            if (teacherUserIds.length === 0) continue

            const examLabel = exam.exam_type === 'UTS' ? labels.uts : labels.uas
            const subjectName = (exam.subject as { name?: string } | null | undefined)?.name || ''

            await supabase.from('notifications').insert(
                teacherUserIds.map(uid => ({
                    user_id: uid,
                    type: 'UJIAN_SELESAI',
                    title: `✅ ${examLabel} Selesai: ${exam.title}`,
                    message: `${subjectName} — Ujian telah berakhir. Silakan cek hasil dan koreksi essay siswa.`,
                    link: notifLink(exam.id)
                }))
            )

            console.log(`[NOTIF] Sent exam-ended notifications for ${exam.title} to ${teacherUserIds.length} teachers`)
        }
    } catch (error) {
        console.error('Error in checkEndedOfficialExams:', error)
    }
}
