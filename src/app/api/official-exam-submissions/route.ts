import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { gradeAnswer, needsManualGrading } from '@/lib/questionTypeUtils'
import { logError } from '@/lib/logError'
import { applyRemedialPolicy } from '@/lib/remedialScore'
import { getExamQuestionsForGrading } from '@/lib/examQuestionsCache'
import { resolveWindowExpiry, isWriteAllowed, isSweepDue, endsAtIso } from '@/lib/examExpiry'
import { forceCloseOfficialSubmission } from '@/lib/autoCloseExpired'
import { getTeacherScope, canTeachStudentSubmission } from '@/lib/teacherScope'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { batchedIn } from '@/lib/batchedIn'
import { mergeViolations, IncomingViolation } from '@/lib/violationBatch'

// GET official exam submissions
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const examId = request.nextUrl.searchParams.get('exam_id')
        const studentId = request.nextUrl.searchParams.get('student_id')
        const classId = request.nextUrl.searchParams.get('class_id')

        const SUBMISSIONS_SELECT = `
                id, exam_id, student_id, started_at, submitted_at, is_submitted,
                total_score, max_score, violation_count, violations_log, is_graded, created_at, timer_override_until,
                student:students(id, nis, class_id, user:users!students_user_id_fkey(full_name), class:classes(id, school_level, grade_level)),
                exam:official_exams(
                    id, title, exam_type, duration_minutes, start_time, window_end_time, is_active, subject_id, school_id,
                    academic_year_id, target_class_ids,
                    show_results_immediately, results_released,
                    subject:subjects(id, name, kkm)
                )
            `

        let query = supabase
            .from('official_exam_submissions')
            .select(SUBMISSIONS_SELECT)
            .order('created_at', { ascending: false })
            // Tiebreaker stabil untuk paginasi fetchAllRows (submissions dibuat
            // batch saat ujian serentak → created_at sering identik)
            .order('id', { ascending: false })

        if (examId) {
            query = query.eq('exam_id', examId)
        }
        if (studentId) {
            query = query.eq('student_id', studentId)
        }

        // S5-style scoping: siswa hanya melihat submission miliknya — filter di
        // SQL sebelum fetch supaya tidak full-table untuk tiap request siswa.
        let scopedStudentId: string | null = null
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()
            if (!student) return NextResponse.json([])
            scopedStudentId = student.id
            query = query.eq('student_id', student.id)
        }

        // fetchAllRows: filter school/role/class dilakukan post-fetch di JS,
        // jadi query ini harus mengembalikan SEMUA baris — tanpa ini, tabel
        // >1000 submissions terpotong diam-diam sebelum sempat difilter.
        //
        // Scope sekolah di SQL untuk GURU/ADMIN tanpa exam_id: filter embed
        // (exam.school_id) tidak membatasi baris induk di PostgREST — dulu
        // SEMUA baris semua sekolah ditarik dulu (full-table per request)
        // baru difilter di JS. exam_id tunggal tidak perlu (satu exam = satu
        // sekolah; filter JS line bawah sudah cukup).
        let data: any[] = []
        if (schoolId && user.role !== 'SISWA' && !examId) {
            const { data: schoolExams } = await supabase
                .from('official_exams')
                .select('id')
                .eq('school_id', schoolId)
            const schoolExamIds = (schoolExams || []).map((e: any) => e.id)
            if (schoolExamIds.length === 0) return NextResponse.json([])
            // batchedIn per 100 id (batas URL) + fetchAllRows per chunk
            // (ujian serentak >1000 peserta per sekolah)
            data = await batchedIn<any>(
                'exam_id', schoolExamIds,
                async (chunk) => {
                    let q = supabase
                        .from('official_exam_submissions')
                        .select(SUBMISSIONS_SELECT)
                        .order('created_at', { ascending: false })
                        .order('id', { ascending: false })
                        .in('exam_id', chunk)
                    if (studentId) q = q.eq('student_id', studentId)
                    return { data: await fetchAllRows(q), error: null }
                }
            )
        } else {
            data = await fetchAllRows(query)
        }

        let result = data || []

        // Scope multi-tenant: submission hanya milik sekolah user
        if (schoolId) {
            result = result.filter((s: any) => (s.exam as any)?.school_id === schoolId)
        }

        // Role-based filtering
        if (user.role === 'SISWA') {
            // Sudah di-scope di SQL; filter ulang idempotent untuk keamanan
            if (scopedStudentId) {
                result = result.filter((s: any) => s.student_id === scopedStudentId)
            } else {
                result = []
            }
        } else if (user.role === 'GURU') {
            // A guru sees submissions for official exams they teach: the exam's subject in
            // one of the exam's target classes. target_class_ids are unique per academic
            // year, so this is correct across years — unlike the old check on
            // student.class_id (current class), which dropped students who had moved up.
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()

            if (teacher) {
                const examIds = [...new Set(result.map((s: any) => s.exam_id))]
                // batchedIn per 100 id (batas URL): ratusan exam id → URL >16KB → error 500
                const exams = await batchedIn<any>(
                    'id', examIds,
                    (chunk) => supabase
                        .from('official_exams')
                        .select('id, subject_id, target_class_ids')
                        .in('id', chunk)
                )
                const examById = new Map((exams || []).map((e: any) => [e.id, e]))

                const targetClassIds = [...new Set(exams.flatMap((e: any) => e.target_class_ids || []))]
                const taught = await batchedIn<any>(
                    'class_id', targetClassIds,
                    (chunk) => supabase
                        .from('teaching_assignments')
                        .select('subject_id, class_id')
                        .eq('teacher_id', teacher.id)
                        .in('class_id', chunk)
                )
                const taughtKey = new Set((taught || []).map((a: any) => `${a.subject_id}|${a.class_id}`))

                result = result.filter((sub: any) => {
                    const ex = examById.get(sub.exam_id)
                    if (!ex) return false
                    return (ex.target_class_ids || []).some((cid: string) =>
                        taughtKey.has(`${ex.subject_id}|${cid}`)
                    )
                })
            } else {
                result = []
            }
        }

        // Additional class filter — resolve the student's class IN THE EXAM'S YEAR via
        // enrollment (not current class_id), so filtering works for past exams too.
        if (classId) {
            const studentIds = [...new Set(result.map((s: any) => s.student_id))]
            const examYears = new Set<string>()
            result.forEach((s: any) => {
                const ex: any = Array.isArray(s.exam) ? s.exam[0] : s.exam
                if (ex?.academic_year_id) examYears.add(ex.academic_year_id)
            })
            // batchedIn per 100 id (batas URL): ribuan student id → URL >16KB → error 500
            const enrollments = await batchedIn<any>(
                'student_id', studentIds,
                (chunk) => supabase
                    .from('student_enrollments')
                    .select('student_id, class_id, academic_year_id')
                    .in('student_id', chunk)
                    .in('academic_year_id', examYears.size ? [...examYears] : ['00000000-0000-0000-0000-000000000000'])
            )
            const studentYearClass = new Map<string, string>()
            enrollments.forEach((e: any) =>
                studentYearClass.set(`${e.student_id}|${e.academic_year_id}`, e.class_id)
            )
            result = result.filter((sub: any) => {
                const ex: any = Array.isArray(sub.exam) ? sub.exam[0] : sub.exam
                const year = ex?.academic_year_id
                const sc = year ? studentYearClass.get(`${sub.student_id}|${year}`) : undefined
                return sc === classId
            })
        }

        // Server-side auto-submit: detect and submit expired but unsubmitted entries
        // This catches submissions where the student's browser closed before auto-submit could fire.
        // SISWA disertakan: entri mereka sendiri sudah terfilter di atas, jadi aman & self-scoped.
        // Rumus kedaluwarsa dari satu sumber: src/lib/examExpiry.ts (jendela global + override hard reset)
        if (['GURU', 'ADMIN', 'SISWA'].includes(user.role)) {
            const expiredSubs = result.filter((sub: any) => {
                if (sub.is_submitted) return false
                const examObj = Array.isArray(sub.exam) ? sub.exam[0] : sub.exam
                const expiry = resolveWindowExpiry(
                    { start_time: examObj?.start_time ?? null, duration_minutes: examObj?.duration_minutes ?? null, window_end_time: examObj?.window_end_time ?? null },
                    { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
                )
                return isSweepDue(expiry)
            })

            if (expiredSubs.length > 0) {
                // Paralel per chunk 50 (pola monitor & scheduler closeExpired) —
                // loop sekuensial membuat satu GET ini mengeksekusi ±4 query × N
                // submission sekaligus (menit-an bila 1000 siswa browsernya mati
                // tepat saat ujian serentak berakhir).
                const closeOne = async (sub: any) => {
                    const examObj = Array.isArray(sub.exam) ? sub.exam[0] : sub.exam
                    const expiry = resolveWindowExpiry(
                        { start_time: examObj?.start_time ?? null, duration_minutes: examObj?.duration_minutes ?? null, window_end_time: examObj?.window_end_time ?? null },
                        { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
                    )
                    const expectedSubmittedAt = endsAtIso(expiry) || new Date().toISOString()

                    const closed = await forceCloseOfficialSubmission(sub.id, sub.exam_id, expiry.limited ? expiry.endAt : null)

                    // Update local data so the response reflects the change
                    sub.is_submitted = true
                    sub.submitted_at = expectedSubmittedAt
                    if (closed) {
                        sub.total_score = closed.totalScore
                        sub.is_graded = closed.isGraded
                    }
                }
                const CHUNK = 50
                for (let i = 0; i < expiredSubs.length; i += CHUNK) {
                    await Promise.all(expiredSubs.slice(i, i + CHUNK).map(closeOne))
                }
            }
        }

        // If filtering by examId and the user is ADMIN/GURU, fetch remedial submissions
        // and merge by score sesuai kebijakan remedial (HIGHEST/AVERAGE/CAP).
        if (examId && (user.role === 'GURU' || user.role === 'ADMIN')) {
            const { data: remedials } = await supabase
                .from('official_exams')
                .select('id, remedial_score_policy, remedial_max_score')
                .eq('remedial_for_id', examId)

            if (remedials && remedials.length > 0) {
                const remedialIds = remedials.map(r => r.id)
                // Kebijakan remedial diambil dari remedial pertama yang menaut langsung
                // ke ujian dasar (pola helper: remedial berlapis memakai kebijakan
                // remedial pertama — konsisten dengan titik merge lain).
                const remedialPolicy = (remedials[0] as any).remedial_score_policy
                const remedialCap = (remedials[0] as any).remedial_max_score
                // fetchAllRows: remedial seangkatan/sekolah bisa >1000 submissions
                const remedialSubmissions = await fetchAllRows(supabase
                    .from('official_exam_submissions')
                    .select(`
                        *,
                        student:students(id, nis, class_id, user:users!students_user_id_fkey(full_name), class:classes(id, school_level, grade_level)),
                        exam:official_exams(
                            id, title, exam_type, duration_minutes, is_active, subject_id,
                            show_results_immediately, results_released,
                            subject:subjects(id, name, kkm)
                        )
                    `)
                    .in('exam_id', remedialIds)
                    .order('id'))

                if (remedialSubmissions && remedialSubmissions.length > 0) {
                    const studentMerged = new Map<string, any>()

                    // Add all original submissions first
                    result.forEach((sub: any) => {
                        studentMerged.set(sub.student?.id, sub)
                    })

                    // Gabungkan per siswa: skor remedial tertinggi (perwakilan bila
                    // beberapa remedial berlapis) diproses bersama skor asli lewat
                    // helper kebijakan, lalu ditulis ke baris asli sebagai skor final.
                    const bestRemedialByStudent = new Map<string, any>()
                    remedialSubmissions.forEach((sub: any) => {
                        const studentId = sub.student?.id
                        if (!studentId) return
                        const currentScore = (sub.total_score || 0) / (sub.max_score || 1)
                        const prev = bestRemedialByStudent.get(studentId)
                        if (!prev || currentScore >= (prev.total_score || 0) / (prev.max_score || 1)) {
                            bestRemedialByStudent.set(studentId, sub)
                        }
                    })

                    bestRemedialByStudent.forEach((remSub, studentId) => {
                        const original = studentMerged.get(studentId)
                        const remScore = (remSub.total_score || 0) / (remSub.max_score || 1) * 100
                        const finalScore = original
                            ? applyRemedialPolicy(
                                (original.total_score || 0) / (original.max_score || 1) * 100,
                                remScore,
                                remedialPolicy,
                                remedialCap,
                            )
                            : remScore
                        if (!original) {
                            // Siswa hanya ikut remedial (tidak punya baris asli —
                            // kasus langka): masukkan baris remedial apa adanya.
                            studentMerged.set(studentId, remSub)
                            return
                        }
                        if (finalScore !== null) {
                            // Skor final disimpan proporsional pada max_score baris asli
                            const maxScore = original.max_score || 100
                            studentMerged.set(studentId, {
                                ...original,
                                total_score: Math.round(finalScore / 100 * maxScore * 10) / 10,
                                merged_from_remedial: true,
                            })
                        }
                    })

                    result = Array.from(studentMerged.values())
                    // Sort by submitted_at again just in case (using created_at as backup if needed)
                    result.sort((a: any, b: any) => {
                        const dateA = a.submitted_at ? new Date(a.submitted_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
                        const dateB = b.submitted_at ? new Date(b.submitted_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
                        return dateB - dateA;
                    });
                }
            }
        }

        // Apply visibility rules for SISWA
        if (user.role === 'SISWA') {
            result = result.map((sub: any) => {
                const examObj = sub.exam || {}
                const showImmediately = examObj.show_results_immediately ?? true
                const isReleased = examObj.results_released || false
                const isHidden = !showImmediately && !isReleased

                if (isHidden) {
                    return {
                        ...sub,
                        total_score: null,
                        max_score: null,
                        results_hidden: true
                    }
                }
                return { ...sub, results_hidden: false }
            })
        }

        // Lampirkan ends_at (batas efektif, dihitung server) per submission —
        // client (dashboard siswa) memakainya untuk kartu "Lanjutkan" & auto-submit.
        result = result.map((sub: any) => {
            const examObj = Array.isArray(sub.exam) ? sub.exam[0] : sub.exam
            const expiry = resolveWindowExpiry(
                { start_time: examObj?.start_time ?? null, duration_minutes: examObj?.duration_minutes ?? null, window_end_time: examObj?.window_end_time ?? null },
                { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
            )
            return { ...sub, ends_at: endsAtIso(expiry) }
        })

        return NextResponse.json(result)
    } catch (error) {
        logError('Error fetching official exam submissions', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST start official exam (student creates submission)
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'SISWA') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { exam_id } = await request.json()
        if (!exam_id) {
            return NextResponse.json({ error: 'exam_id required' }, { status: 400 })
        }

        // Get student record
        const { data: student } = await supabase
            .from('students')
            .select('id, class_id')
            .eq('user_id', user.id)
            .single()

        if (!student) {
            return NextResponse.json({ error: 'Student not found' }, { status: 404 })
        }

        // Check if exam exists
        const { data: exam } = await supabase
            .from('official_exams')
            .select('*, official_exam_questions(id)')
            .eq('id', exam_id)
            .single()

        if (!exam) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }

        // Resume dulu: submission yang sudah berjalan tidak boleh terkunci
        // (mis. auto-deaktivasi saat window lewat, atau reload di tengah ujian).
        // K3 Security Fix: .maybeSingle() — .single() LAMA menelan error multi-row
        // (PGRST116) dan menganggap tidak ada submission → INSERT baris baru →
        // amplifikasi duplikat. Constraint UNIQUE kini juga menjaga di level DB.
        const { data: existingSubmission } = await supabase
            .from('official_exam_submissions')
            .select('id, is_submitted, question_order, started_at, violation_count, max_score, timer_override_until')
            .eq('exam_id', exam_id)
            .eq('student_id', student.id)
            .maybeSingle()

        // Helper: respons resume untuk submission yang sedang berjalan
        const resumeResponse = async (existing: NonNullable<typeof existingSubmission>) => {
            const expiry = resolveWindowExpiry(
                { start_time: exam.start_time, duration_minutes: exam.duration_minutes, window_end_time: exam.window_end_time },
                { started_at: existing.started_at, timer_override_until: existing.timer_override_until }
            )
            // Jawaban tersimpan ikut dikirim — resume lintas device (localStorage kosong)
            // tidak menampilkan soal kosong padahal server punya jawaban
            const { data: savedAnswers } = await supabase
                .from('official_exam_answers')
                .select('question_id, answer')
                .eq('submission_id', existing.id)
            return NextResponse.json({
                ...existing,
                saved_answers: savedAnswers || [],
                server_time: new Date().toISOString(),
                ends_at: endsAtIso(expiry)
            })
        }

        if (existingSubmission?.is_submitted) {
            return NextResponse.json({ error: 'Anda sudah mengumpulkan ujian ini' }, { status: 400 })
        }

        if (existingSubmission) {
            return resumeResponse(existingSubmission)
        }

        // === Sesi baru: semua gate wajib lolos ===
        if (!exam.is_active) {
            return NextResponse.json({ error: 'Ujian belum dibuka' }, { status: 400 })
        }

        // Kelas siswa: utamakan enrollment ACTIVE di tahun aktif (selaras jalur notifikasi)
        let studentClassId = student.class_id
        if (schoolId) {
            const { data: activeYears } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .order('created_at', { ascending: false })
                .limit(1)
            const yearId = activeYears?.[0]?.id
            if (yearId) {
                const { data: enrollment } = await supabase
                    .from('student_enrollments')
                    .select('class_id')
                    .eq('student_id', student.id)
                    .eq('academic_year_id', yearId)
                    .eq('status', 'ACTIVE')
                    .maybeSingle()
                if (enrollment?.class_id) studentClassId = enrollment.class_id
            }
        }

        // Check if student's class is in target_class_ids
        if (!exam.target_class_ids?.includes(studentClassId)) {
            return NextResponse.json({ error: 'Anda tidak terdaftar dalam ujian ini' }, { status: 403 })
        }

        // C3 Hotfix: Remedial guard
        if (exam.is_remedial && exam.allowed_student_ids && exam.allowed_student_ids.length > 0) {
            if (!exam.allowed_student_ids.includes(student.id)) {
                return NextResponse.json({ error: 'Anda tidak terdaftar untuk ujian remedial ini' }, { status: 403 })
            }
        }

        // Check start time + window pengerjaan
        const now = new Date()
        const startTime = new Date(exam.start_time)
        if (now < startTime) {
            return NextResponse.json({ error: 'Ujian belum dimulai' }, { status: 400 })
        }
        if (exam.window_end_time) {
            // Mode jendela: siswa hanya boleh MEMULAI sebelum jam tutup
            if (now > new Date(exam.window_end_time)) {
                return NextResponse.json({ error: 'Jendela waktu pengerjaan sudah ditutup' }, { status: 400 })
            }
        } else {
            // Mode serentak (lama): semua berakhir di start + durasi
            const endTime = new Date(startTime.getTime() + (exam.duration_minutes || 0) * 60 * 1000)
            if (now > endTime) {
                return NextResponse.json({ error: 'Waktu pengerjaan ujian sudah berakhir' }, { status: 400 })
            }
        }

        // Create randomized question order if enabled
        const questionIds = exam.official_exam_questions.map((q: any) => q.id)
        const questionOrder = exam.is_randomized
            ? questionIds.sort(() => Math.random() - 0.5)
            : questionIds

        // Calculate max score
        const { data: questions } = await supabase
            .from('official_exam_questions')
            .select('points')
            .eq('exam_id', exam_id)

        const maxScore = questions?.reduce((sum: number, q: any) => sum + (q.points || 10), 0) || 0

        // Create new submission
        // K3 Security Fix: race double-POST — dua request bersamaan bisa sama-sama
        // lolos cek existing di atas. Constraint UNIQUE (exam_id, student_id) kini
        // menolak insert kedua (23505) → re-fetch dan kembalikan respons resume,
        // bukan error 500.
        const { data: submission, error: insertError } = await supabase
            .from('official_exam_submissions')
            .insert({
                exam_id,
                student_id: student.id,
                question_order: questionOrder,
                max_score: maxScore,
                started_at: new Date().toISOString()
            })
            .select()
            .single()

        if (insertError) {
            // unique violation "uq_official_exam_submissions_exam_student" → request
            // paralel sudah membuat submission; ambil dan resume
            if (insertError.code === '23505') {
                const { data: raced } = await supabase
                    .from('official_exam_submissions')
                    .select('id, is_submitted, question_order, started_at, violation_count, max_score, timer_override_until')
                    .eq('exam_id', exam_id)
                    .eq('student_id', student.id)
                    .maybeSingle()
                if (raced && !raced.is_submitted) return resumeResponse(raced)
                if (raced?.is_submitted) {
                    return NextResponse.json({ error: 'Anda sudah mengumpulkan ujian ini' }, { status: 400 })
                }
            }
            throw insertError
        }

        const newExpiry = resolveWindowExpiry(
            { start_time: exam.start_time, duration_minutes: exam.duration_minutes, window_end_time: exam.window_end_time },
            { started_at: submission.started_at, timer_override_until: submission.timer_override_until }
        )
        return NextResponse.json({
            ...submission,
            server_time: new Date().toISOString(),
            ends_at: endsAtIso(newExpiry)
        })
    } catch (error) {
        console.error('Error starting official exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update submission (save answers, submit, log violations)
export async function PUT(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const body = await request.json()
        const { submission_id, answers, submit, violation, violations, reset_attempt } = body

        if (!submission_id) {
            return NextResponse.json({ error: 'submission_id required' }, { status: 400 })
        }

        // Get current submission
        const { data: currentSubmission } = await supabase
            .from('official_exam_submissions')
            .select('*, exam:official_exams(max_violations, show_results_immediately, results_released, duration_minutes, start_time, window_end_time, school_id, subject_id, target_class_ids, academic_year_id)')
            .eq('id', submission_id)
            .single()

        if (!currentSubmission) {
            return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
        }

        // Helper: exam config sebagai objek tunggal (embed bisa array atau objek)
        const examCfgOf = (sub: any): any => Array.isArray(sub?.exam) ? sub.exam[0] : sub?.exam || {}

        // Handle reset attempt — must be checked BEFORE the is_submitted guard
        if (reset_attempt) {
            // Otorisasi: ADMIN (scope sekolah) atau GURU yang mengajar kelas
            // siswa ini untuk mapel ujian — scope sama dengan jalur save/grade
            // di bawah (getTeacherScope + canTeachStudentSubmission), dipakai
            // oleh tombol reset di monitor live guru maupun admin.
            const resetExamCfg = examCfgOf(currentSubmission)
            if (user.role === 'ADMIN') {
                // K2 Security Fix: scope sekolah — admin hanya boleh mereset submission
                // ujian sekolahnya sendiri (sebelumnya admin sekolah manapun bisa reset lintas sekolah)
                if (resetExamCfg.school_id && schoolId && resetExamCfg.school_id !== schoolId) {
                    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
                }
            } else if (user.role === 'GURU') {
                const { data: subStudent } = await supabase
                    .from('students')
                    .select('class_id')
                    .eq('id', currentSubmission.student_id)
                    .single()
                const scope = await getTeacherScope(user.id, resetExamCfg.academic_year_id)
                if (!canTeachStudentSubmission(scope, resetExamCfg.subject_id, subStudent?.class_id)) {
                    return NextResponse.json({ error: 'Anda tidak mengajar kelas siswa ini' }, { status: 403 })
                }
            } else {
                return NextResponse.json({ error: 'Tidak punya izin untuk melakukan reset' }, { status: 403 })
            }

            if (!currentSubmission.is_submitted) {
                return NextResponse.json({ error: 'Submission belum di-submit, tidak perlu di-reset' }, { status: 400 })
            }

            // Batas soft reset: mode jendela → jam tutup; mode serentak → start + durasi.
            // Hard Reset = pengecualian sengaja oleh guru/admin: durasi penuh baru via
            // timer_override_until (override TIDAK dipotong jam tutup — src/lib/examExpiry.ts).
            const examCfg = resetExamCfg
            const durationMs = (examCfg.duration_minutes || 0) * 60000
            const softLimitMs = examCfg.window_end_time
                ? new Date(examCfg.window_end_time).getTime()
                : (examCfg.start_time && durationMs > 0
                    ? new Date(examCfg.start_time).getTime() + durationMs
                    : null)

            if (reset_attempt === 'soft' && softLimitMs !== null && Date.now() > softLimitMs) {
                return NextResponse.json({
                    error: 'Jendela waktu pengerjaan sudah berakhir — soft reset tidak menambah waktu. Gunakan Hard Reset untuk memberi attempt baru dengan durasi penuh.'
                }, { status: 400 })
            }

            if (reset_attempt === 'hard') {
                // Delete existing answers for Hard Reset
                const { error: deleteAnswersError } = await supabase
                    .from('official_exam_answers')
                    .delete()
                    .eq('submission_id', submission_id)

                if (deleteAnswersError) throw deleteAnswersError
            }

            const now = new Date()
            const updateData: any = {
                is_submitted: false,
                submitted_at: null,
                violation_count: 0,
                violations_log: [],
                total_score: 0,
                is_graded: false,
                // Soft: kembali murni ikut jendela global. Hard: override = now + durasi (durasi penuh baru).
                timer_override_until: reset_attempt === 'hard' && durationMs > 0
                    ? new Date(now.getTime() + durationMs).toISOString()
                    : null
            }

            // Hard reset: fresh timer
            if (reset_attempt === 'hard') {
                updateData.started_at = now.toISOString()
            }

            const { data: resetSubmission, error: resetError } = await supabase
                .from('official_exam_submissions')
                .update(updateData)
                .eq('id', submission_id)
                .select()
                .single()

            if (resetError) throw resetError

            const expiryAfter = resolveWindowExpiry(
                { start_time: examCfg.start_time ?? null, duration_minutes: examCfg.duration_minutes ?? null, window_end_time: examCfg.window_end_time ?? null },
                { started_at: resetSubmission.started_at, timer_override_until: resetSubmission.timer_override_until }
            )

            return NextResponse.json({
                reset_success: true,
                message: reset_attempt === 'hard'
                    ? 'Hard reset berhasil. Jawaban dihapus dan siswa mendapat durasi penuh baru.'
                    : 'Soft reset berhasil. Siswa dapat melanjutkan dengan sisa waktu jendela.',
                effective_ends_at: endsAtIso(expiryAfter),
                submission: resetSubmission
            })
        }

        // Verify ownership for SISWA
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()
            if (!student || currentSubmission.student_id !== student.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        } else if (user.role === 'GURU') {
            // K2 Security Fix: scope per-submission — guru boleh mengelola submission
            // siswa yang kelasnya dia ajar untuk mapel ujian ini. (Sebelumnya .every:
            // guru harus mengajar SEMUA kelas target → guru mapel per-kelas kena 403
            // saat menyimpan nilai padahal halaman hasil bisa dibuka.)
            const examCfg = examCfgOf(currentSubmission)
            const { data: subStudent } = await supabase
                .from('students')
                .select('class_id')
                .eq('id', currentSubmission.student_id)
                .single()
            const scope = await getTeacherScope(user.id, examCfg.academic_year_id)
            if (!canTeachStudentSubmission(scope, examCfg.subject_id, subStudent?.class_id)) {
                return NextResponse.json({ error: 'Anda tidak mengajar kelas siswa ini' }, { status: 403 })
            }
        } else if (user.role === 'ADMIN') {
            // K2 Security Fix: scope sekolah untuk admin
            const examCfg = examCfgOf(currentSubmission)
            if (examCfg.school_id && schoolId && examCfg.school_id !== schoolId) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        } else {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        if (currentSubmission.is_submitted) {
            return NextResponse.json({ error: 'Already submitted' }, { status: 400 })
        }

        // Penegakan batas waktu di server: mode serentak / jendela (src/lib/examExpiry.ts).
        // Lewat batas + grace → submission ditutup paksa, TAPI jawaban yang dikirim
        // ikut di-upsert (menang per soal) supaya jawaban yang diketik saat offline
        // tidak hilang (anti "jam habis tapi masih bisa mengerjakan").
        const writeExamCfg: any = Array.isArray(currentSubmission.exam) ? currentSubmission.exam[0] : currentSubmission.exam
        const writeExpiry = resolveWindowExpiry(
            { start_time: writeExamCfg?.start_time ?? null, duration_minutes: writeExamCfg?.duration_minutes ?? null, window_end_time: writeExamCfg?.window_end_time ?? null },
            { started_at: currentSubmission.started_at, timer_override_until: currentSubmission.timer_override_until }
        )
        if (!isWriteAllowed(writeExpiry)) {
            await forceCloseOfficialSubmission(
                submission_id,
                currentSubmission.exam_id,
                writeExpiry.limited ? writeExpiry.endAt : null,
                answers
            )
            return NextResponse.json({
                code: 'TIME_EXPIRED',
                force_submitted: true,
                message: 'Waktu pengerjaan sudah berakhir. Jawaban terakhirmu otomatis dikumpulkan.'
            }, { status: 409 })
        }

        // Handle violation logging — tunggal (legacy `violation`) atau batch
        // (`violations` = queue pelanggaran dari client yang offline; timestamp
        // kejadian asli client dipertahankan & di-clamp, lihat violationBatch.ts)
        const incomingViolations: IncomingViolation[] = Array.isArray(violations) && violations.length > 0
            ? violations
            : (violation ? [violation] : [])
        if (incomingViolations.length > 0) {
            const maxViolations = currentSubmission.exam?.max_violations || 3
            const merged = mergeViolations(
                currentSubmission.violations_log || [],
                currentSubmission.violation_count,
                incomingViolations,
                currentSubmission.started_at
            )

            if (!merged) {
                // Semua entri kena dedup 3 dtk — abaikan tanpa update (perilaku jalur lama)
                return NextResponse.json({
                    violation_count: currentSubmission.violation_count,
                    max_violations: maxViolations
                })
            }

            await supabase
                .from('official_exam_submissions')
                .update({
                    violation_count: merged.count,
                    violations_log: merged.log
                })
                .eq('id', submission_id)

            // Force submit if max violations exceeded
            if (merged.count >= maxViolations) {
                const { data: existingAnswers } = await supabase
                    .from('official_exam_answers')
                    .select('*, question:official_exam_questions(correct_answer, points, question_type)')
                    .eq('submission_id', submission_id)

                let totalScore = 0
                let hasEssays = false
                existingAnswers?.forEach((ans: any) => {
                    const q = Array.isArray(ans.question) ? ans.question[0] : ans.question
                    if (q) {
                        if (!needsManualGrading(q.question_type)) {
                            const graded = gradeAnswer(
                                q.question_type,
                                ans.answer,
                                q.correct_answer,
                                null,
                                q.points || 10
                            )
                            totalScore += graded.pointsEarned
                        } else {
                            hasEssays = true
                        }
                    }
                })

                const examQuestions = await getExamQuestionsForGrading('official_exam_questions', currentSubmission.exam_id)
                hasEssays = hasEssays || examQuestions.some(q => needsManualGrading(q.question_type))

                await supabase
                    .from('official_exam_submissions')
                    .update({
                        is_submitted: true,
                        submitted_at: new Date().toISOString(),
                        total_score: totalScore,
                        is_graded: !hasEssays
                    })
                    .eq('id', submission_id)

                return NextResponse.json({
                    force_submitted: true,
                    message: 'Ujian otomatis dikumpulkan karena pelanggaran melebihi batas'
                })
            }

            return NextResponse.json({
                violation_count: merged.count,
                max_violations: maxViolations
            })
        }

        // Handle saving answers
        if (answers && Array.isArray(answers) && answers.length > 0) {
            // Soal dari cache in-memory (TTL 10 mnt) — tanpa ini setiap autosave mem-fetch ulang seluruh soal
            const allQuestions = await getExamQuestionsForGrading('official_exam_questions', currentSubmission.exam_id)

            const questionMap = new Map(allQuestions.map(q => [q.id, q]))

            // Cap payload: jumlah jawaban tidak mungkin melebihi jumlah soal ujian —
            // array raksasa (script/spam/retry agresif) memakan bandwidth & pool DB
            // saat 1000 siswa serentak.
            if (answers.length > questionMap.size) {
                return NextResponse.json({ error: 'Payload jawaban melebihi jumlah soal' }, { status: 400 })
            }

            // Buang jawaban dengan question_id yang tidak ada di ujian ini —
            // tanpa filter, id arbitrer (ujian lain/script) jadi junk rows dan
            // meng-inflate answered_count di Monitor Live via RPC count.
            const validAnswers = answers.filter((ans: { question_id: string }) => questionMap.has(ans.question_id))

            const gradedAnswers = validAnswers.map((ans: { question_id: string; answer: string }) => {
                const question = questionMap.get(ans.question_id)!

                const graded = gradeAnswer(
                    question.question_type,
                    ans.answer,
                    question.correct_answer,
                    question.options,
                    question.points || 10
                )

                return {
                    submission_id,
                    question_id: ans.question_id,
                    answer: ans.answer,
                    is_correct: graded.isCorrect,
                    points_earned: Math.round(graded.pointsEarned)
                }
            })

            if (gradedAnswers.length > 0) {
                const { error: upsertError } = await supabase
                    .from('official_exam_answers')
                    .upsert(gradedAnswers, {
                        onConflict: 'submission_id,question_id'
                    })

                if (upsertError) throw upsertError
            }
        }

        // Handle final submission
        if (submit) {
            const { data: allAnswers } = await supabase
                .from('official_exam_answers')
                .select('points_earned')
                .eq('submission_id', submission_id)

            const totalScore = allAnswers?.reduce((sum: number, a: any) => sum + (a.points_earned || 0), 0) || 0

            const examQuestions = await getExamQuestionsForGrading('official_exam_questions', currentSubmission.exam_id)

            const hasEssays = examQuestions.some(q => needsManualGrading(q.question_type))

            const { data: updatedSubmission, error } = await supabase
                .from('official_exam_submissions')
                .update({
                    is_submitted: true,
                    submitted_at: new Date().toISOString(),
                    total_score: totalScore,
                    is_graded: !hasEssays
                })
                .eq('id', submission_id)
                .select()
                .single()

            if (error) throw error

            const examConfig = currentSubmission.exam || {}
            const showImmediately = examConfig.show_results_immediately ?? true
            const isReleased = examConfig.results_released || false
            const isHidden = !showImmediately && !isReleased

            const responseData = { ...updatedSubmission, results_hidden: isHidden }
            if (isHidden) {
                responseData.total_score = null
                responseData.max_score = null
            }

            return NextResponse.json(responseData)
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error updating official exam submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
