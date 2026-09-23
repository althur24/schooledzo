import { supabaseAdmin as supabase } from './supabase'
import { logError } from './logError'
import { fetchAllRows } from './fetchAllRows'
import { batchedIn, IN_BATCH_SIZE } from './batchedIn'
import { AuthUser } from './types'
import { getMenuLabelsForSchool } from './serverLabels'

/**
 * Proactive notification jobs (deadline reminders, exam reminders, cleanups).
 *
 * Dipindahkan dari GET /api/notifications: route itu dipolling tiap 60 detik
 * per user. Kini dijalankan terjadwal oleh src/lib/scheduler.ts hanya untuk
 * user dengan sesi aktif.
 *
 * ARSITEKTUR BATCH (rewrite 2026-09): satu run mem-prefetch SEMUA data yang
 * dibutuhkan secara massal (students/teachers, teaching_assignments, tugas &
 * kuis urgent, official_exams aktif, snapshot notifications untuk dedup),
 * lalu keputusan per user dihitung di memori, lalu insert/delete ditulis per
 * chunk. Versi lama menjalankan 12–15 query PER USER per run — query dedup
 * ILIKE 'notifications' tercatat 914rb panggilan kumulatif di
 * pg_stat_statements, beban latar terbesar DB saat sepi.
 *
 * Perilaku notifikasi dipertahankan identik: penerima, jenis, timing, isi
 * pesan, urutan job per user (cleanup → tugas/kuis → ujian), dan aturan dedup
 * sama dengan versi per-user — termasuk fakta bahwa cek dedup versi lama
 * membaca DB hidup (insert awal run terlihat oleh cek dedup berikutnya untuk
 * user yang sama), direplikasi lewat insert virtual ke snapshot. Satu-satunya
 * deviasi: padanan ILIKE di sini mencocokkan %/_ pada judul secara literal
 * (bukan wildcard) — lebih benar dan tidak ada judul yang memakai karakter itu.
 */

type Counter = { inserts: number }

interface NotifRow {
    id: string
    user_id: string
    type: string
    title: string
    created_at: string
}

interface PendingNotif {
    user_id: string
    type: string
    title: string
    message: string
    link: string
}

interface ExamRow {
    id: string
    school_id: string
    title: string
    exam_type: string | null
    start_time: string
    window_end_time: string | null
    duration_minutes: number | null
    target_class_ids: string[] | null
    subject_id: string | null
    is_remedial: boolean | null
    allowed_student_ids: string[] | null
    subject: { name: string } | { name: string }[] | null
}

interface StudentRow { id: string; user_id: string; class_id: string | null }
interface TeacherRow { id: string; user_id: string }
interface ClassTaRow { id: string; class_id: string }
interface AssignmentRow { id: string; title: string; due_date: string; teaching_assignment_id: string }
interface QuizRow { id: string; title: string; deadline: string; is_remedial: boolean | null; allowed_student_ids: string[] | null; teaching_assignment_id: string }
interface SubmissionRow { assignment_id: string; student_id: string }
interface QuizSubmissionRow { quiz_id: string; student_id: string; submitted_at: string | null }
interface TeacherTaRow { teacher_id: string; subject_id: string | null; class_id: string | null; academic_year_id: string | null }
interface YearRow { id: string; school_id: string }

interface RunContext {
    nowMs: number
    in24hMs: number
    twentyFourHoursAgoMs: number
    studentByUserId: Map<string, StudentRow>
    teacherByUserId: Map<string, TeacherRow>
    taIdsByClassId: Map<string, string[]>
    urgentAssignmentsByTa: Map<string, AssignmentRow[]>
    urgentQuizzesByTa: Map<string, QuizRow[]>
    teacherTasByTeacherId: Map<string, TeacherTaRow[]>
    activeYearsBySchool: Map<string, YearRow[]>
    officialExamsBySchool: Map<string, ExamRow[]>
    notifsByUser: Map<string, NotifRow[]>
    submittedAssignmentKeys: Set<string>
    submittedQuizKeys: Set<string>
}

// batchedIn per 100 id (batas URL) + fetchAllRows per chunk (batas 1000 baris)
// — pola batchedFetchAll yang sama dengan dashboard/guru/warnings.
async function batchedFetchAll<T>(column: string, ids: string[], buildQuery: (chunk: string[]) => unknown, maxPages = 20): Promise<T[]> {
    return batchedIn<T>(column, ids, async (chunk) => ({ data: await fetchAllRows<T>(buildQuery(chunk), 1000, maxPages), error: null }))
}

// Prefetch non-fatal: grup ini gagal → job terkait dilewati untuk run ini
// (log error), sisanya tetap jalan — paritas dengan resiliensi per-user
// versi lama. Dua grup LAIN (notifications & official_exams) sengaja TIDAK
// memakai safe(): snapshot dedup kosong → duplikat massal; map exam kosong →
// cleanup stale menganggap semua ujian nonaktif → salah hapus massal.
// Keduanya harus abort run (lock menahan retry 10 mnt).
async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | []> {
    try {
        return await fn()
    } catch (e) {
        logError(`Notification prefetch ${label} gagal — dilewati run ini`, e)
        return []
    }
}

// Embed many-to-one supabase-js bisa berupa object atau array — seragamkan.
const firstEmbed = (v: ExamRow['subject']) => (Array.isArray(v) ? v[0] : v)

// Padanan memori untuk filter ILIKE '%judul%': substring case-insensitive.
const titleContains = (haystack: string, needle: string) =>
    haystack.toLowerCase().includes(needle.toLowerCase())

// Dedup: reminder DEADLINE_REMINDER untuk judul ini dalam 24 jam terakhir.
const hasRecentDeadlineReminder = (notifs: NotifRow[], titlePart: string, sinceMs: number) =>
    notifs.some(n => n.type === 'DEADLINE_REMINDER' && titleContains(n.title, titlePart) && new Date(n.created_at).getTime() > sinceMs)

// Dedup: notifikasi APA PUN (any type) untuk judul ini dalam 24 jam terakhir.
const hasRecentAnyType = (notifs: NotifRow[], titlePart: string, sinceMs: number) =>
    notifs.some(n => titleContains(n.title, titlePart) && new Date(n.created_at).getTime() > sinceMs)

// Dedup: notifikasi APA PUN untuk judul ini, sepanjang masa.
const hasAllTimeAnyType = (notifs: NotifRow[], titlePart: string) =>
    notifs.some(n => titleContains(n.title, titlePart))

// Dedup: judul PERSIS + type tertentu, sepanjang masa.
const hasAllTimeExact = (notifs: NotifRow[], exactTitle: string, type: string) =>
    notifs.some(n => n.title === exactTitle && n.type === type)

/**
 * Prefetch massal SEMUA data yang dibutuhkan satu run — menggantikan
 * 12–15 query per user. Semua query diberi .order('id') (tiebreaker unik)
 * sebelum fetchAllRows sesuai aturan paginasi stabil.
 */
async function buildRunContext(users: AuthUser[]): Promise<RunContext> {
    const nowMs = Date.now()
    const in24hMs = nowMs + 24 * 60 * 60 * 1000
    const twentyFourHoursAgoMs = nowMs - 24 * 60 * 60 * 1000
    const nowIso = new Date(nowMs).toISOString()
    const in24hIso = new Date(in24hMs).toISOString()

    const userIds = users.map(u => u.id)
    const siswaUserIds = users.filter(u => u.role === 'SISWA').map(u => u.id)
    const guruUserIds = users.filter(u => u.role === 'GURU').map(u => u.id)

    // Students (hanya user SISWA yang butuh). safe: gagal → siswa skip run ini
    // (paritas OLD — query gagal → data null → if(student) skip).
    const studentRows = siswaUserIds.length > 0
        ? await safe('students', () => batchedFetchAll<StudentRow>('user_id', siswaUserIds, chunk =>
            supabase.from('students').select('id, user_id, class_id').in('user_id', chunk).order('id')))
        : []
    const studentByUserId = new Map<string, StudentRow>()
    for (const s of studentRows) {
        // Baris pertama menang — .single() lama error pada duplikat (anomali data)
        if (!studentByUserId.has(s.user_id)) studentByUserId.set(s.user_id, s)
    }

    // Teachers (hanya user GURU). safe: gagal → guru skip run ini.
    const teacherRows = guruUserIds.length > 0
        ? await safe('teachers', () => batchedFetchAll<TeacherRow>('user_id', guruUserIds, chunk =>
            supabase.from('teachers').select('id, user_id').in('user_id', chunk).order('id')))
        : []
    const teacherByUserId = new Map<string, TeacherRow>()
    for (const t of teacherRows) {
        if (!teacherByUserId.has(t.user_id)) teacherByUserId.set(t.user_id, t)
    }

    // Teaching assignments untuk kelas para siswa (jalur reminder tugas/kuis).
    // batchedIn: kelas sekolah besar bisa >100 id (prod: 105) — .in() besar
    // membuat URL >16KB dan PostgREST menolak dengan 500.
    const classIds = [...new Set(studentRows.map(s => s.class_id).filter((c): c is string => !!c))]
    const classTaRows = classIds.length > 0
        ? await safe('ta kelas', () => batchedFetchAll<ClassTaRow>('class_id', classIds, chunk =>
            supabase
                .from('teaching_assignments')
                .select('id, class_id')
                .in('class_id', chunk)
                .order('id')))
        : []
    const taIdsByClassId = new Map<string, string[]>()
    const allTaIds = new Set<string>()
    for (const ta of classTaRows) {
        if (!ta.class_id) continue
        const list = taIdsByClassId.get(ta.class_id) || []
        list.push(ta.id)
        taIdsByClassId.set(ta.class_id, list)
        allTaIds.add(ta.id)
    }

    // Tugas & kuis dengan deadline dalam 24 jam (kecuali offline) — hanya
    // untuk TA kelas di atas; jumlahnya kecil karena terikat jendela waktu.
    // batchedIn: total TA sekolah besar bisa >440 id (prod: 1116 TA) — satu
    // .in() sebesar itu ditolak PostgREST (URL >16KB), persis insiden yang
    // pernah terjadi di examBatch cleanup.
    const allTaIdList = [...allTaIds]
    const urgentAssignments = allTaIdList.length > 0
        ? await safe('tugas urgent', () => batchedFetchAll<AssignmentRow>('teaching_assignment_id', allTaIdList, chunk =>
            supabase
                .from('assignments')
                .select('id, title, due_date, teaching_assignment_id')
                .in('teaching_assignment_id', chunk)
                .neq('submission_mode', 'OFFLINE')
                .gt('due_date', nowIso)
                .lte('due_date', in24hIso)
                .order('id')))
        : []
    const urgentAssignmentsByTa = new Map<string, AssignmentRow[]>()
    for (const a of urgentAssignments) {
        const list = urgentAssignmentsByTa.get(a.teaching_assignment_id) || []
        list.push(a)
        urgentAssignmentsByTa.set(a.teaching_assignment_id, list)
    }

    const urgentQuizzes = allTaIdList.length > 0
        ? await safe('kuis urgent', () => batchedFetchAll<QuizRow>('teaching_assignment_id', allTaIdList, chunk =>
            supabase
                .from('quizzes')
                .select('id, title, deadline, is_remedial, allowed_student_ids, teaching_assignment_id')
                .in('teaching_assignment_id', chunk)
                .eq('is_active', true)
                .neq('submission_mode', 'OFFLINE')
                .not('deadline', 'is', null)
                .gt('deadline', nowIso)
                .lte('deadline', in24hIso)
                .order('id')))
        : []
    const urgentQuizzesByTa = new Map<string, QuizRow[]>()
    for (const q of urgentQuizzes) {
        const list = urgentQuizzesByTa.get(q.teaching_assignment_id) || []
        list.push(q)
        urgentQuizzesByTa.set(q.teaching_assignment_id, list)
    }

    // Submission untuk tugas/kuis urgent di atas — dibaca SEKALI untuk semua
    // siswa, menggantikan query exists per (tugas, siswa).
    const urgentAssignmentIds = urgentAssignments.map(a => a.id)
    const urgentQuizIds = urgentQuizzes.map(q => q.id)

    const subRows = urgentAssignmentIds.length > 0
        ? await safe('submissions tugas', () => batchedFetchAll<SubmissionRow>('assignment_id', urgentAssignmentIds, chunk =>
            supabase
                .from('student_submissions')
                .select('assignment_id, student_id')
                .in('assignment_id', chunk)
                .order('id')))
        : []
    const submittedAssignmentKeys = new Set(subRows.map(r => `${r.assignment_id}:${r.student_id}`))

    const quizSubRows = urgentQuizIds.length > 0
        ? await safe('submissions kuis', () => batchedFetchAll<QuizSubmissionRow>('quiz_id', urgentQuizIds, chunk =>
            supabase
                .from('quiz_submissions')
                .select('quiz_id, student_id, submitted_at')
                .in('quiz_id', chunk)
                .order('id')))
        : []
    const submittedQuizKeys = new Set(
        quizSubRows.filter(r => r.submitted_at != null).map(r => `${r.quiz_id}:${r.student_id}`)
    )

    // Semua ujian resmi aktif untuk sekolah para user aktif — filter waktu
    // (upcoming / scheduled / started) diterapkan di memori per penerima.
    const schoolIds = [...new Set(users.map(u => u.school_id).filter((s): s is string => !!s))]
    const examRows = schoolIds.length > 0
        ? await batchedFetchAll<ExamRow>('school_id', schoolIds, chunk =>
            supabase
                .from('official_exams')
                .select(`
                    id, school_id, title, exam_type, start_time, window_end_time, duration_minutes,
                    target_class_ids, subject_id, is_remedial, allowed_student_ids,
                    subject:subjects(name)
                `)
                .in('school_id', chunk)
                .eq('is_active', true)
                .order('id'))
        : []
    const officialExamsBySchool = new Map<string, ExamRow[]>()
    for (const e of examRows) {
        const list = officialExamsBySchool.get(e.school_id) || []
        list.push(e)
        officialExamsBySchool.set(e.school_id, list)
    }

    // Tahun ajaran aktif per sekolah (jalur reminder guru). Dipertahankan
    // semantik .single() lama: harus TEPAT SATU — 0 atau >1 → job guru skip.
    const activeYearRows = schoolIds.length > 0
        ? await safe('tahun ajaran', () => fetchAllRows<YearRow>(supabase
            .from('academic_years')
            .select('id, school_id')
            .eq('is_active', true)
            .order('id')))
        : []
    const activeYearsBySchool = new Map<string, YearRow[]>()
    for (const y of activeYearRows) {
        const list = activeYearsBySchool.get(y.school_id) || []
        list.push(y)
        activeYearsBySchool.set(y.school_id, list)
    }

    // Teaching assignments para guru (filter academic_year_id di memori).
    // batchedIn: guru aktif bisa >100 di sekolah besar.
    const teacherIds = [...teacherByUserId.values()].map(t => t.id)
    const teacherTaRows = teacherIds.length > 0
        ? await safe('ta guru', () => batchedFetchAll<TeacherTaRow>('teacher_id', teacherIds, chunk =>
            supabase
                .from('teaching_assignments')
                .select('teacher_id, subject_id, class_id, academic_year_id')
                .in('teacher_id', chunk)
                .order('id')))
        : []
    const teacherTasByTeacherId = new Map<string, TeacherTaRow[]>()
    for (const ta of teacherTaRows) {
        const list = teacherTasByTeacherId.get(ta.teacher_id) || []
        list.push(ta)
        teacherTasByTeacherId.set(ta.teacher_id, list)
    }

    // Snapshot notifications SEMUA user aktif untuk dedup in-memory —
    // pengganti ratusan query ILIKE per user per run.
    // FATAL (tanpa safe): snapshot kosong karena error → dedup buta →
    // duplikat massal. Abort run lebih aman (lock menahan retry 10 mnt).
    // Order TERBARU dulu + maxPages 100: bila snapshot user hoarder terpotong,
    // yang terbuang baris TERTUA — jendela dedup 24 jam selalu utuh.
    // (Versi lama terpotong diam-diam di 1000 baris per user via PostgREST.)
    const notifRows = userIds.length > 0
        ? await batchedFetchAll<NotifRow>('user_id', userIds, chunk =>
            supabase
                .from('notifications')
                .select('id, user_id, type, title, created_at')
                .in('user_id', chunk)
                .order('created_at', { ascending: false })
                .order('id', { ascending: false }), 100)
        : []
    const notifsByUser = new Map<string, NotifRow[]>()
    for (const n of notifRows) {
        const list = notifsByUser.get(n.user_id) || []
        list.push(n)
        notifsByUser.set(n.user_id, list)
    }
    // Entry kosong untuk user tanpa notifikasi — supaya insert virtual (dedup
    // antar-job dalam satu run) selalu menempel ke array yang hidup di Map.
    for (const u of users) {
        if (!notifsByUser.has(u.id)) notifsByUser.set(u.id, [])
    }

    return {
        nowMs,
        in24hMs,
        twentyFourHoursAgoMs,
        studentByUserId,
        teacherByUserId,
        taIdsByClassId,
        urgentAssignmentsByTa,
        urgentQuizzesByTa,
        teacherTasByTeacherId,
        activeYearsBySchool,
        officialExamsBySchool,
        notifsByUser,
        submittedAssignmentKeys,
        submittedQuizKeys,
    }
}

/**
 * Catat insert secara VIRTUAL ke snapshot dedup — versi lama membaca DB hidup
 * saat dedup, sehingga notifikasi yang dibuat di awal run (mis. "UTS Segera")
 * ikut menekan notifikasi lain untuk judul yang sama di cek berikutnya
 * (mis. "UTS Dijadwalkan") untuk user yang sama. Tanpa ini user akan menerima
 * notifikasi ganda dalam satu run.
 */
function trackVirtualInsert(ctx: RunContext, notif: PendingNotif, createdIso: string) {
    const list = ctx.notifsByUser.get(notif.user_id)
    if (list) list.push({ id: `virtual:${notif.title}`, user_id: notif.user_id, type: notif.type, title: notif.title, created_at: createdIso })
}

/**
 * Auto-cleanup: notifikasi "Dijadwalkan" untuk ujian resmi yang sudah TIDAK
 * aktif lagi. Mengembalikan id yang akan dihapus.
 */
function decideStaleExamNotifications(user: AuthUser, ctx: RunContext): string[] {
    // SUPER_ADMIN tanpa sekolah → padanan jalur error query lama: skip.
    if (!user.school_id) return []
    const activeTitles = new Set(
        (ctx.officialExamsBySchool.get(user.school_id) || []).map(e => e.title)
    )
    const stale: string[] = []
    for (const n of ctx.notifsByUser.get(user.id) || []) {
        if (n.type !== 'UJIAN_RESMI') continue
        if (!n.title.toLowerCase().includes('dijadwalkan')) continue
        const examTitle = n.title.replace(/^.*Dijadwalkan:\s*/, '')
        if (!activeTitles.has(examTitle)) stale.push(n.id)
    }
    return stale
}

/** Deadline reminder — tugas/kuis due within 24 hours (SISWA). */
async function decideDeadlineReminders(user: AuthUser, ctx: RunContext, outbox: PendingNotif[], counter: Counter) {
    const student = ctx.studentByUserId.get(user.id)
    if (!student) return
    const labels = await getMenuLabelsForSchool(user.school_id)
    const taIds = student.class_id ? (ctx.taIdsByClassId.get(student.class_id) || []) : []
    const notifs = ctx.notifsByUser.get(user.id) || []
    const createdIso = new Date(ctx.nowMs).toISOString()

    // Tugas dengan deadline dalam 24 jam (kecuali tugas offline — tidak ada
    // yang harus dikumpulkan siswa)
    for (const taId of taIds) {
        for (const assignment of ctx.urgentAssignmentsByTa.get(taId) || []) {
            const hasSubmitted = ctx.submittedAssignmentKeys.has(`${assignment.id}:${student.id}`)
            const hasReminder = hasRecentDeadlineReminder(notifs, assignment.title, ctx.twentyFourHoursAgoMs)
            if (!hasSubmitted && !hasReminder) {
                const deadlineStr = new Date(assignment.due_date).toLocaleString('id-ID')
                const notif: PendingNotif = {
                    user_id: user.id,
                    type: 'DEADLINE_REMINDER',
                    title: `⏰ Deadline Segera: ${assignment.title}`,
                    message: `${labels.tugas} ini harus dikumpulkan sebelum ${deadlineStr}`,
                    link: '/dashboard/siswa/tugas'
                }
                outbox.push(notif)
                trackVirtualInsert(ctx, notif, createdIso)
                counter.inserts++
            }
        }
    }

    // Kuis dengan deadline dalam 24 jam — siswa belum MENGUMPULKAN
    // (kecuali kuis offline; cukup membuka kuis TIDAK boleh meniadakan
    // reminder: siswa yang buka lalu pergi justru yang paling perlu diingatkan)
    for (const taId of taIds) {
        for (const quiz of ctx.urgentQuizzesByTa.get(taId) || []) {
            // Remedial: hanya siswa terdaftar yang diingatkan — siswa lain di
            // kelas tidak melihat (dan tidak bisa mengerjakan) kuis remedial.
            if (quiz.is_remedial && Array.isArray(quiz.allowed_student_ids) && quiz.allowed_student_ids.length > 0) {
                if (!quiz.allowed_student_ids.includes(student.id)) continue
            }
            const hasSubmitted = ctx.submittedQuizKeys.has(`${quiz.id}:${student.id}`)
            const hasReminder = hasRecentDeadlineReminder(notifs, quiz.title, ctx.twentyFourHoursAgoMs)
            if (!hasSubmitted && !hasReminder) {
                const deadlineStr = new Date(quiz.deadline).toLocaleString('id-ID')
                const notif: PendingNotif = {
                    user_id: user.id,
                    type: 'DEADLINE_REMINDER',
                    title: `⏰ Deadline Segera: ${quiz.title}`,
                    message: `${labels.kuis} ini harus dikerjakan sebelum ${deadlineStr}`,
                    link: '/dashboard/siswa/kuis'
                }
                outbox.push(notif)
                trackVirtualInsert(ctx, notif, createdIso)
                counter.inserts++
            }
        }
    }
}

/** UTS/UAS Reminder — ujian resmi dimulai dalam 24 jam (SISWA). */
async function decideExamReminders(user: AuthUser, ctx: RunContext, outbox: PendingNotif[], counter: Counter) {
    const student = ctx.studentByUserId.get(user.id)
    if (!student) return
    const labels = await getMenuLabelsForSchool(user.school_id)
    const notifs = ctx.notifsByUser.get(user.id) || []
    const createdIso = new Date(ctx.nowMs).toISOString()

    for (const exam of ctx.officialExamsBySchool.get(user.school_id ?? '') || []) {
        const startMs = new Date(exam.start_time).getTime()
        if (!(startMs > ctx.nowMs && startMs <= ctx.in24hMs)) continue
        if (!student.class_id || !exam.target_class_ids?.includes(student.class_id)) continue
        // Remedial: hanya siswa terdaftar yang diingatkan — siswa lain di
        // kelas target tidak ikut ujian remedial.
        if (exam.is_remedial && Array.isArray(exam.allowed_student_ids) && exam.allowed_student_ids.length > 0) {
            if (!exam.allowed_student_ids.includes(student.id)) continue
        }
        // Skip jika notifikasi APA PUN untuk ujian ini sudah terkirim < 24 jam
        if (hasRecentAnyType(notifs, exam.title, ctx.twentyFourHoursAgoMs)) continue

        const label = exam.exam_type === 'UTS' ? labels.uts : labels.uas
        const startStr = new Date(exam.start_time).toLocaleString('id-ID')
        const subjectName = firstEmbed(exam.subject)?.name || ''
        const notif: PendingNotif = {
            user_id: user.id,
            type: 'EXAM_REMINDER',
            title: `⏰ ${label} Segera: ${exam.title}`,
            message: `${subjectName} — Mulai: ${startStr}`,
            link: '/dashboard/siswa/ulangan'
        }
        outbox.push(notif)
        trackVirtualInsert(ctx, notif, createdIso)
        counter.inserts++
    }
}

/**
 * Proactive Initial Notification for Scheduled Exams (SISWA) — menjamin
 * siswa yang melewatkan push notification POST /api/official-exams tetap
 * melihat "UTS/UAS Dijadwalkan".
 */
async function decideScheduledExamNotifications(user: AuthUser, ctx: RunContext, outbox: PendingNotif[], counter: Counter) {
    const student = ctx.studentByUserId.get(user.id)
    if (!student) return
    const labels = await getMenuLabelsForSchool(user.school_id)
    const notifs = ctx.notifsByUser.get(user.id) || []
    const createdIso = new Date(ctx.nowMs).toISOString()

    for (const exam of ctx.officialExamsBySchool.get(user.school_id ?? '') || []) {
        const startMs = new Date(exam.start_time).getTime()
        if (!(startMs > ctx.nowMs)) continue
        if (!student.class_id || !exam.target_class_ids?.includes(student.class_id)) continue
        // Remedial: hanya siswa terdaftar yang diberi tahu.
        if (exam.is_remedial && Array.isArray(exam.allowed_student_ids) && exam.allowed_student_ids.length > 0) {
            if (!exam.allowed_student_ids.includes(student.id)) continue
        }
        // Skip jika notifikasi APA PUN untuk ujian ini sudah ada (sepanjang masa)
        if (hasAllTimeAnyType(notifs, exam.title)) continue

        const label = exam.exam_type === 'UTS' ? labels.uts : labels.uas
        const startStr = new Date(exam.start_time).toLocaleString('id-ID')
        const subjectName = firstEmbed(exam.subject)?.name || ''
        const notif: PendingNotif = {
            user_id: user.id,
            type: 'UJIAN_RESMI',
            title: `📅 ${label} Dijadwalkan: ${exam.title}`,
            message: `${subjectName} — Dimulai pada: ${startStr}`,
            link: '/dashboard/siswa/ulangan'
        }
        outbox.push(notif)
        trackVirtualInsert(ctx, notif, createdIso)
        counter.inserts++
    }
}

/** Teacher UTS/UAS Reminders (GURU) — "Segera" + "Dimulai". */
async function decideTeacherExamReminders(user: AuthUser, ctx: RunContext, outbox: PendingNotif[], counter: Counter) {
    const teacher = ctx.teacherByUserId.get(user.id)
    if (!teacher) return
    const labels = await getMenuLabelsForSchool(user.school_id)
    const notifs = ctx.notifsByUser.get(user.id) || []
    const createdIso = new Date(ctx.nowMs).toISOString()

    // Semantik .single() lama: tahun ajaran aktif harus TEPAT SATU per sekolah.
    const activeYears = user.school_id ? (ctx.activeYearsBySchool.get(user.school_id) || []) : []
    if (activeYears.length !== 1) return

    const myTas = (ctx.teacherTasByTeacherId.get(teacher.id) || [])
        .filter(ta => ta.academic_year_id === activeYears[0].id)
    if (myTas.length === 0) return

    const subjectIds = new Set(myTas.map(a => a.subject_id))
    const classIds = new Set(myTas.map(a => a.class_id))

    for (const exam of ctx.officialExamsBySchool.get(user.school_id ?? '') || []) {
        if (!exam.subject_id || !subjectIds.has(exam.subject_id)) continue
        const startMs = new Date(exam.start_time).getTime()
        const upcoming = startMs > ctx.nowMs && startMs <= ctx.in24hMs
        const started = startMs <= ctx.nowMs
        if (!upcoming && !started) continue
        if (!exam.target_class_ids?.some((cid: string) => classIds.has(cid))) continue

        const label = exam.exam_type === 'UTS' ? labels.uts : labels.uas
        const startStr = new Date(exam.start_time).toLocaleString('id-ID')
        const subjectName = firstEmbed(exam.subject)?.name || ''

        if (upcoming) {
            // "Segera" — skip jika notifikasi apa pun untuk ujian ini < 24 jam
            if (hasRecentAnyType(notifs, exam.title, ctx.twentyFourHoursAgoMs)) continue
            const notif: PendingNotif = {
                user_id: user.id,
                type: 'EXAM_REMINDER',
                title: `⏰ ${label} Segera: ${exam.title}`,
                message: `${subjectName} — Mulai: ${startStr}`,
                link: '/dashboard/guru/ulangan'
            }
            outbox.push(notif)
            trackVirtualInsert(ctx, notif, createdIso)
            counter.inserts++
        } else {
            // "Dimulai" — hanya saat window pengerjaan belum lewat.
            // official_exams tidak punya end_time — window = window_end_time
            // (mode jendela) ?? start_time + duration_minutes (mode serentak).
            const windowEndMs = exam.window_end_time
                ? new Date(exam.window_end_time).getTime()
                : startMs + (exam.duration_minutes || 0) * 60000
            if (ctx.nowMs > windowEndMs) continue

            const dimulaiTitle = `🔔 ${label} Dimulai: ${exam.title}`
            if (hasAllTimeExact(notifs, dimulaiTitle, 'UJIAN_RESMI')) continue
            const notif: PendingNotif = {
                user_id: user.id,
                type: 'UJIAN_RESMI',
                title: dimulaiTitle,
                message: `${subjectName} — Siswa sedang mengerjakan sejak ${startStr}`,
                link: '/dashboard/guru/ulangan'
            }
            outbox.push(notif)
            trackVirtualInsert(ctx, notif, createdIso)
            counter.inserts++
        }
    }
}

/** Tulis hasil run secara massal — urutan padanan versi lama: hapus stale
 *  dulu (cleanup berjalan sebelum reminder), lalu insert. */
async function flushWrites(outbox: PendingNotif[], staleIds: string[]) {
    for (let i = 0; i < staleIds.length; i += IN_BATCH_SIZE) {
        const chunk = staleIds.slice(i, i + IN_BATCH_SIZE)
        const { error } = await supabase.from('notifications').delete().in('id', chunk)
        if (error) logError('Notification stale delete error', error)
    }
    for (let i = 0; i < outbox.length; i += IN_BATCH_SIZE) {
        const chunk = outbox.slice(i, i + IN_BATCH_SIZE)
        const { error } = await supabase.from('notifications').insert(chunk)
        if (error) logError('Notification bulk insert error', error)
    }
}

const JOB_NAME = 'notification_jobs'
const LOCK_MAX_AGE_MS = 9 * 60 * 1000 // scheduler berjalan tiap 10 mnt; lock dianggap basi setelah 9 mnt

/**
 * Jalankan semua job notifikasi untuk user dengan sesi aktif.
 * Aman multi-replica: hanya satu instance yang memenangkan klaim atomik.
 */
export async function runNotificationJobsForActiveUsers() {
    // 1. Klaim lock atomik — instance lain yang kalah klaim langsung keluar
    const lockStaleBefore = new Date(Date.now() - LOCK_MAX_AGE_MS).toISOString()
    const { data: claimed, error: claimError } = await supabase
        .from('cron_runs')
        .update({ last_run_at: new Date().toISOString() })
        .eq('job', JOB_NAME)
        .lt('last_run_at', lockStaleBefore)
        .select('job')

    if (claimError) {
        logError('Cron lock error', claimError)
        return
    }
    if (!claimed || claimed.length === 0) return

    const t0 = Date.now()

    // 2. Cleanup global (pengganti cleanup per-user): hapus notifikasi terbaca
    //    > 30 hari — 1 query untuk semua user
    try {
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        await supabase
            .from('notifications')
            .delete()
            .eq('is_read', true)
            .lt('created_at', thirtyDaysAgo.toISOString())
    } catch (cleanupError) {
        logError('Notification cleanup error', cleanupError)
    }

    // 3. Ambil user dengan sesi aktif (mirror validateSession: user terkunci diskip).
    //    Wajib fetchAllRows: PostgREST diam-diam memotong ke 1000 baris — saat TO
    //    dengan >1000 sesi aktif, user sisanya akan terlewat dari job reminder.
    let sessions
    try {
        sessions = await fetchAllRows(
            supabase
                .from('sessions')
                .select('user:users(id, username, full_name, role, school_id, must_change_password, is_locked)')
                .gt('expires_at', new Date().toISOString())
                .order('id')
        )
    } catch (sessionsError) {
        logError('Scheduler sessions fetch error', sessionsError)
        return
    }

    const seen = new Set<string>()
    const users: AuthUser[] = []
    for (const s of sessions || []) {
        const u = (Array.isArray(s.user) ? s.user[0] : s.user) as AuthUser | null
        if (u && !u.is_locked && !seen.has(u.id)) {
            seen.add(u.id)
            users.push(u)
        }
    }

    // 4. Prefetch massal SEKALI per run — menggantikan 12–15 query PER USER.
    //    Total query kini konstan (±10 + chunk batchedIn), berapa pun user aktif.
    let ctx: RunContext
    try {
        ctx = await buildRunContext(users)
    } catch (prefetchError) {
        logError('Notification prefetch error', prefetchError)
        return
    }

    // 5a. Pass stale (padanan urutan lama: cleanup user berjalan SEBELUM
    //     reminder user) — kumpulkan id "Dijadwalkan" basi semua user,
    //     lalu buang dari snapshot dedup agar tak terlihat cek berikutnya.
    const staleIds: string[] = []
    const staleIdSet = new Set<string>()
    for (const user of users) {
        try {
            for (const id of decideStaleExamNotifications(user, ctx)) {
                staleIds.push(id)
                staleIdSet.add(id)
            }
        } catch (staleError) {
            logError(`Notification jobs error for user ${user.id}`, staleError)
        }
    }
    if (staleIdSet.size > 0) {
        for (const [uid, list] of ctx.notifsByUser) {
            if (list.some(n => staleIdSet.has(n.id))) {
                ctx.notifsByUser.set(uid, list.filter(n => !staleIdSet.has(n.id)))
            }
        }
    }

    // 5b. Keputusan per user — murni in-memory (Set/Map lookup, 0 query DB).
    //     Isolasi error per-job (bukan per-user) agar kegagalan satu job
    //     tidak mematikan job lain — mirror try/catch per-fungsi versi lama.
    const outbox: PendingNotif[] = []
    const counter: Counter = { inserts: 0 }
    for (const user of users) {
        if (user.role === 'SISWA') {
            try { await decideDeadlineReminders(user, ctx, outbox, counter) } catch (e) { logError(`Notification jobs error for user ${user.id}`, e) }
            try { await decideExamReminders(user, ctx, outbox, counter) } catch (e) { logError(`Notification jobs error for user ${user.id}`, e) }
            try { await decideScheduledExamNotifications(user, ctx, outbox, counter) } catch (e) { logError(`Notification jobs error for user ${user.id}`, e) }
        }
        if (user.role === 'GURU') {
            try { await decideTeacherExamReminders(user, ctx, outbox, counter) } catch (e) { logError(`Notification jobs error for user ${user.id}`, e) }
        }
    }

    // 6. Tulis massal per chunk
    await flushWrites(outbox, staleIds)

    console.log(`[jobs] ${JOB_NAME}: ${users.length} active users, ${counter.inserts} notifications created, ${Math.round((Date.now() - t0) / 1000)}s`)
}
