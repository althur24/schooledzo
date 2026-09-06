import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { findExamsOutsideSchool } from '@/lib/tenantGuard'
import { gradeAnswer, needsManualGrading } from '@/lib/questionTypeUtils'
import { getExamQuestionsForGrading } from '@/lib/examQuestionsCache'
import { resolveWindowExpiry, isWriteAllowed, isSweepDue, endsAtIso } from '@/lib/examExpiry'
import { forceCloseExamSubmission } from '@/lib/autoCloseExpired'
import { canManageExam } from '@/lib/teacherScope'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { bufferTeacherSubmissionNotification } from '@/lib/teacherNotifyBuffer'
import { mergeViolations, IncomingViolation } from '@/lib/violationBatch'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'

// GET exam submissions
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const examId = request.nextUrl.searchParams.get('exam_id')
        const studentId = request.nextUrl.searchParams.get('student_id')
        const allYears = request.nextUrl.searchParams.get('all_years')

        // Lazy Sweep: Auto-close expired submissions if examId is provided (Teacher/Admin View)
        if (examId && (user.role === 'GURU' || user.role === 'ADMIN')) {
            try {
                const { data: examData } = await supabase
                    .from('exams')
                    .select('duration_minutes, start_time, window_end_time')
                    .eq('id', examId)
                    .single()

                if (examData) {
                    const { data: inProgress } = await supabase
                        .from('exam_submissions')
                        .select('id, started_at, timer_override_until')
                        .eq('exam_id', examId)
                        .eq('is_submitted', false)

                    // Satu sumber kebenaran: mode serentak / jendela (src/lib/examExpiry.ts)
                    const withExpiry = (inProgress || []).map(sub => ({
                        sub,
                        expiry: resolveWindowExpiry(
                            { start_time: examData.start_time, duration_minutes: examData.duration_minutes, window_end_time: examData.window_end_time },
                            { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
                        )
                    }))
                    const expired = withExpiry.filter(x => isSweepDue(x.expiry))

                    if (expired.length > 0) {
                        console.log(`[Auto-Close] Found ${expired.length} expired exam submissions for exam ${examId}`)
                        await Promise.all(expired.map(x =>
                            forceCloseExamSubmission(x.sub.id, examId, x.expiry.limited ? x.expiry.endAt : null)
                        ))
                    }
                }
            } catch (sweepError) {
                console.error('Lazy sweep error:', sweepError)
                // Continue even if sweep fails
            }
        }

        let query = supabase
            .from('exam_submissions')
            .select(`
                id, exam_id, student_id, started_at, submitted_at, is_submitted,
                total_score, max_score, violation_count, violations_log, is_graded, created_at, timer_override_until,
                student:students(id, nis, user:users!students_user_id_fkey(full_name)),
                exam:exams!inner(
                    id,
                    title,
                    duration_minutes,
                    start_time,
                    window_end_time,
                    show_results_immediately,
                    results_released,
                    teaching_assignment:teaching_assignments!inner(
                        academic_year_id,
                        subject:subjects(id, name),
                        class:classes(id, name)
                    )
                )
            `)
            .order('created_at', { ascending: false })
            // Tiebreaker stabil untuk paginasi fetchAllRows (batch submit saat
            // ulangan serentak → created_at sering identik)
            .order('id', { ascending: false })

        if (examId) {
            // Tenant guard: exam harus milik sekolah caller (param client dipercaya)
            if ((await findExamsOutsideSchool([examId], schoolId)).length > 0) {
                return NextResponse.json([])
            }
            query = query.eq('exam_id', examId)
        }
        if (studentId) {
            query = query.eq('student_id', studentId)
        }

        // S5 Security Fix: Auto-scope to student's own submissions for SISWA role
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students').select('id').eq('user_id', user.id).single()
            if (student) {
                query = query.eq('student_id', student.id)
            } else {
                return NextResponse.json([])
            }
        }

        // Filter by active year when no specific exam is requested
        if (!examId && allYears !== 'true') {
            // Tahan kasus 2 tahun aktif: .single() error diam-diam →
            // activeYear null → seluruh daftar submission kosong tanpa sebab.
            const { data: activeYears } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .order('created_at', { ascending: false })
                .limit(2)
            if ((activeYears || []).length > 1) {
                console.warn(`[exam-submissions] Sekolah ${schoolId} punya ${activeYears!.length} tahun aktif — pakai yang terbaru`)
            }
            const activeYear = activeYears?.[0] || null

            if (activeYear) {
                // Inner join filter replaces the old two-hop .in(list): hundreds of TA ids
                // overflow the 16KB header limit at larger schools and break this endpoint
                query = query.eq('exam.teaching_assignment.academic_year_id', activeYear.id)
            } else {
                // No active year: return empty instead of leaking content across years
                return NextResponse.json([])
            }
        }

        // fetchAllRows: guru/admin tanpa exam_id mendapat semua submission tahun
        // aktif; ulangan sekelas/sekolah juga bisa >1000 peserta — query biasa
        // terpotong diam-diam di 1000 baris.
        const data = await fetchAllRows(query)

        let finalData = data || []

        // If filtering by examId and the user is a teacher/admin, fetch remedial submissions and merge by highest score
        if (examId && (user.role === 'GURU' || user.role === 'ADMIN')) {
            const { data: remedials } = await supabase
                .from('exams')
                .select('id')
                .eq('remedial_for_id', examId)

            if (remedials && remedials.length > 0) {
                const remedialIds = remedials.map(r => r.id)
                // fetchAllRows: remedial sekelas/sekolah bisa >1000 submissions
                const remedialSubmissions = await fetchAllRows(supabase
                    .from('exam_submissions')
                    .select(`
                        *,
                        student:students(id, nis, user:users!students_user_id_fkey(full_name)),
                        exam:exams(
                            id,
                            title,
                            duration_minutes,
                            start_time,
                            window_end_time,
                            teaching_assignment:teaching_assignments(
                                academic_year_id,
                                subject:subjects(id, name),
                                class:classes(id, name)
                            )
                        )
                    `)
                    .in('exam_id', remedialIds)
                    .order('id'))

                if (remedialSubmissions && remedialSubmissions.length > 0) {
                    const studentHighestSubmissions = new Map<string, any>()

                    // Add all original submissions first
                    finalData.forEach((sub: any) => {
                        studentHighestSubmissions.set(sub.student.id, sub)
                    })

                    // Overwrite if remedial score is higher or equal
                    remedialSubmissions.forEach((sub: any) => {
                        const existing = studentHighestSubmissions.get(sub.student.id)
                        const currentScore = ((sub.total_score || 0) / (sub.max_score || 1))
                        const existingScore = existing ? ((existing.total_score || 0) / (existing.max_score || 1)) : -1

                        if (currentScore >= existingScore) {
                            studentHighestSubmissions.set(sub.student.id, sub)
                        }
                    })

                    finalData = Array.from(studentHighestSubmissions.values())
                    // Sort by submitted_at again just in case (using created_at as backup if needed)
                    finalData.sort((a: any, b: any) => {
                        const dateA = a.submitted_at ? new Date(a.submitted_at).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
                        const dateB = b.submitted_at ? new Date(b.submitted_at).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
                        return dateB - dateA;
                    });
                }
            }
        }

        // Apply visibility rules for SISWA
        if (user.role === 'SISWA') {
            finalData = finalData.map((sub: any) => {
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
        finalData = finalData.map((sub: any) => {
            const examObj = Array.isArray(sub.exam) ? sub.exam[0] : sub.exam
            const expiry = resolveWindowExpiry(
                { start_time: examObj?.start_time ?? null, duration_minutes: examObj?.duration_minutes ?? null, window_end_time: examObj?.window_end_time ?? null },
                { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
            )
            return { ...sub, ends_at: endsAtIso(expiry) }
        })

        return NextResponse.json(finalData)
    } catch (error) {
        console.error('Error fetching exam submissions:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST start exam (create submission)
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'SISWA') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const labels = await getMenuLabelsForSchool(schoolId)

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

        // Check if exam exists (+ kelas pemilik via teaching assignment)
        const { data: exam } = await supabase
            .from('exams')
            .select('*, exam_questions(id), teaching_assignment:teaching_assignments(class_id)')
            .eq('id', exam_id)
            .single()

        if (!exam) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }

        // Resume dulu: submission yang sudah berjalan tidak boleh terkunci saat reload.
        // K3 Security Fix: .maybeSingle() — .single() menelan error multi-row (PGRST116)
        // dan menganggap tidak ada submission → INSERT baris baru → duplikat.
        const { data: existingSubmission } = await supabase
            .from('exam_submissions')
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
                .from('exam_answers')
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
            return NextResponse.json({ error: `Anda sudah mengumpulkan ${labels.ulangan.toLowerCase()} ini` }, { status: 400 })
        }

        if (existingSubmission) {
            return resumeResponse(existingSubmission)
        }

        // === Sesi baru: semua gate wajib lolos ===
        if (!exam.is_active) {
            return NextResponse.json({ error: `${labels.ulangan} belum dibuka` }, { status: 400 })
        }

        // Check start time + window pengerjaan
        const now = new Date()
        const startTime = new Date(exam.start_time)
        if (now < startTime) {
            return NextResponse.json({ error: `${labels.ulangan} belum dimulai` }, { status: 400 })
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
                return NextResponse.json({ error: `Waktu pengerjaan ${labels.ulangan.toLowerCase()} sudah berakhir` }, { status: 400 })
            }
        }

        // Verifikasi kelas siswa
        const examClassId = (exam.teaching_assignment as any)?.class_id
        if (examClassId && student.class_id !== examClassId) {
            return NextResponse.json({ error: `${labels.ulangan} ini bukan untuk kelas Anda` }, { status: 403 })
        }

        // Verifikasi remedial
        if (exam.is_remedial && Array.isArray(exam.allowed_student_ids) && exam.allowed_student_ids.length > 0) {
            if (!exam.allowed_student_ids.includes(student.id)) {
                return NextResponse.json({ error: 'Anda tidak terdaftar dalam daftar remedial ini' }, { status: 403 })
            }
        }

        // Create randomized question order if enabled
        const questionIds = exam.exam_questions.map((q: any) => q.id)
        const questionOrder = exam.is_randomized
            ? questionIds.sort(() => Math.random() - 0.5)
            : questionIds

        // Calculate max score
        const { data: questions } = await supabase
            .from('exam_questions')
            .select('points')
            .eq('exam_id', exam_id)

        const maxScore = questions?.reduce((sum, q) => sum + (q.points || 1), 0) || 0

        // Create new submission
        // K3 Security Fix: race double-POST — request paralel bisa sama-sama lolos
        // cek existing di atas; UNIQUE (exam_id, student_id) menolak insert kedua
        // (23505) → re-fetch dan kembalikan respons resume.
        const { data: submission, error: insertError } = await supabase
            .from('exam_submissions')
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
            if (insertError.code === '23505') {
                const { data: raced } = await supabase
                    .from('exam_submissions')
                    .select('id, is_submitted, question_order, started_at, violation_count, max_score, timer_override_until')
                    .eq('exam_id', exam_id)
                    .eq('student_id', student.id)
                    .maybeSingle()
                if (raced && !raced.is_submitted) return resumeResponse(raced)
                if (raced?.is_submitted) {
                    return NextResponse.json({ error: `Anda sudah mengumpulkan ${labels.ulangan.toLowerCase()} ini` }, { status: 400 })
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
        console.error('Error starting exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update submission (submit answers, log violations)
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
            .from('exam_submissions')
            .select('*, exam:exams(max_violations, show_results_immediately, results_released, duration_minutes, start_time, window_end_time, teaching_assignment:teaching_assignments(teacher_id, teacher:teachers(school_id)))')
            .eq('id', submission_id)
            .single()

        if (!currentSubmission) {
            return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
        }

        // Helper: exam config sebagai objek tunggal (embed bisa array atau objek)
        const examCfgOf = (sub: any): any => Array.isArray(sub?.exam) ? sub.exam[0] : sub?.exam || {}
        const taCfgOf = (sub: any): any => {
            const cfg = examCfgOf(sub)
            const ta = Array.isArray(cfg?.teaching_assignment) ? cfg.teaching_assignment[0] : cfg?.teaching_assignment
            return ta || {}
        }

        // K2 Security Fix: otorisasi guru/admin — sebelumnya hanya cek role.
        // GURU harus pemilik TA ulangan ini; ADMIN harus satu sekolah (via TA → teachers.school_id).
        const verifyTeacherOrAdmin = async (): Promise<boolean> => {
            const ta = taCfgOf(currentSubmission)
            if (user.role === 'ADMIN') {
                const teacherSchoolId = (Array.isArray(ta.teacher) ? ta.teacher[0] : ta.teacher)?.school_id
                return !teacherSchoolId || !schoolId || teacherSchoolId === schoolId
            }
            if (user.role === 'GURU') {
                return canManageExam(user, ta.teacher_id)
            }
            return false
        }

        // C3 Security Fix: Verify SISWA ownership — only the student who owns this submission can modify it
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()
            if (!student || currentSubmission.student_id !== student.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        } else if (user.role === 'GURU' || user.role === 'ADMIN') {
            if (!(await verifyTeacherOrAdmin())) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        } else {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        // Handle Reset Attempt (Soft & Hard)
        if (reset_attempt) {
            if (user.role !== 'GURU' && user.role !== 'ADMIN') {
                return NextResponse.json({ error: 'Tidak punya izin untuk melakukan reset' }, { status: 403 })
            }
            if (!currentSubmission.is_submitted) {
                return NextResponse.json({ error: 'Submission ini belum dikumpulkan/di-submit' }, { status: 400 })
            }

            // Batas soft reset: mode jendela → jam tutup; mode serentak → start + durasi.
            // Hard Reset = pengecualian sengaja oleh guru: durasi penuh baru via timer_override_until
            // (override TIDAK dipotong jam tutup — lihat resolveWindowExpiry).
            const examCfg: any = examCfgOf(currentSubmission)
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

            // Jika hard reset, hapus semua jawaban yang tersimpan
            if (reset_attempt === 'hard') {
                await supabase
                    .from('exam_answers')
                    .delete()
                    .eq('submission_id', submission_id)
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

            // Jika hard reset, perbarui started_at agar mendapat full timer kembali
            if (reset_attempt === 'hard') {
                updateData.started_at = now.toISOString()
            }

            const { data, error } = await supabase
                .from('exam_submissions')
                .update(updateData)
                .eq('id', submission_id)
                .select()
                .single()

            if (error) throw error

            const expiryAfter = resolveWindowExpiry(
                { start_time: examCfg.start_time ?? null, duration_minutes: examCfg.duration_minutes ?? null, window_end_time: examCfg.window_end_time ?? null },
                { started_at: data.started_at, timer_override_until: data.timer_override_until }
            )

            return NextResponse.json({
                reset_success: true,
                message: reset_attempt === 'hard'
                    ? 'Hard reset berhasil. Jawaban dikosongkan dan siswa mendapat durasi penuh baru.'
                    : 'Soft reset berhasil. Siswa dapat melanjutkan dengan sisa waktu jendela.',
                effective_ends_at: endsAtIso(expiryAfter),
                submission: data
            })
        }

        if (currentSubmission.is_submitted) {
            return NextResponse.json({ error: 'Already submitted' }, { status: 400 })
        }

        // Penegakan batas waktu di server: mode serentak / jendela (src/lib/examExpiry.ts).
        // Lewat batas + grace → submission ditutup paksa, TAPI jawaban yang dikirim
        // ikut di-upsert (menang per soal) supaya jawaban yang diketik saat offline
        // tidak hilang (anti "jam habis tapi masih bisa mengerjakan").
        const writeExpiry = resolveWindowExpiry(
            { start_time: currentSubmission.exam?.start_time ?? null, duration_minutes: currentSubmission.exam?.duration_minutes ?? null, window_end_time: currentSubmission.exam?.window_end_time ?? null },
            { started_at: currentSubmission.started_at, timer_override_until: currentSubmission.timer_override_until }
        )
        if (!isWriteAllowed(writeExpiry)) {
            await forceCloseExamSubmission(
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
            const labels = await getMenuLabelsForSchool(schoolId)
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
                .from('exam_submissions')
                .update({
                    violation_count: merged.count,
                    violations_log: merged.log
                })
                .eq('id', submission_id)

            // Force submit if max violations exceeded
            if (merged.count >= maxViolations) {
                // Auto submit with current answers
                const { data: existingAnswers } = await supabase
                    .from('exam_answers')
                    .select('*, question:exam_questions(correct_answer, points, question_type)')
                    .eq('submission_id', submission_id)

                let totalScore = 0
                let hasEssays = false
                existingAnswers?.forEach(ans => {
                    const q = Array.isArray(ans.question) ? ans.question[0] : (ans.question as any);
                    if (q) {
                        if (!needsManualGrading(q.question_type)) {
                            const graded = gradeAnswer(
                                q.question_type,
                                ans.answer,
                                q.correct_answer,
                                null,
                                q.points || 1
                            )
                            totalScore += graded.pointsEarned
                        } else {
                            hasEssays = true
                        }
                    }
                })

                // Also check if there are unanswered essays in the exam (soal dari cache)
                const examQuestions = await getExamQuestionsForGrading('exam_questions', currentSubmission.exam_id)
                hasEssays = hasEssays || examQuestions.some(q => needsManualGrading(q.question_type))

                await supabase
                    .from('exam_submissions')
                    .update({
                        is_submitted: true,
                        submitted_at: new Date().toISOString(),
                        total_score: totalScore,
                        is_graded: !hasEssays
                    })
                    .eq('id', submission_id)

                // Notify teacher about force submission (diagregasi per menit — lihat teacherNotifyBuffer)
                bufferTeacherSubmissionNotification('exam', currentSubmission.exam_id, user.full_name || 'Siswa', true)

                return NextResponse.json({
                    force_submitted: true,
                    message: `${labels.ulangan} otomatis dikumpulkan karena pelanggaran melebihi batas`
                })
            }

            return NextResponse.json({
                violation_count: merged.count,
                max_violations: maxViolations
            })
        }

        // Handle saving/submitting answers
        if (answers && Array.isArray(answers) && answers.length > 0) {
            // Soal dari cache in-memory (TTL 10 mnt) — tanpa ini setiap autosave mem-fetch ulang seluruh soal
            const allQuestions = await getExamQuestionsForGrading('exam_questions', currentSubmission.exam_id)

            // Build a lookup map for instant grading
            const questionMap = new Map(allQuestions.map(q => [q.id, q]))

            // Grade all answers in memory
            const gradedAnswers = answers.map((ans: { question_id: string; answer: string }) => {
                const question = questionMap.get(ans.question_id)
                
                let isCorrect = false
                let pointsEarned = 0

                if (question) {
                    const graded = gradeAnswer(
                        question.question_type,
                        ans.answer,
                        question.correct_answer,
                        question.options,
                        question.points || 1
                    )
                    isCorrect = graded.isCorrect
                    pointsEarned = graded.pointsEarned
                }

                return {
                    submission_id,
                    question_id: ans.question_id,
                    answer: ans.answer,
                    is_correct: isCorrect,
                    points_earned: Math.round(pointsEarned)
                }
            })

            // BATCH UPSERT: 1 query instead of N
            const { error: upsertError } = await supabase
                .from('exam_answers')
                .upsert(gradedAnswers, {
                    onConflict: 'submission_id,question_id'
                })

            if (upsertError) {
                console.error('Error batch upserting answers:', upsertError)
                throw upsertError
            }
        }

        // Handle final submission
        if (submit) {
            // Fetch all saved answers to compute final score
            const { data: allAnswers } = await supabase
                .from('exam_answers')
                .select('points_earned')
                .eq('submission_id', submission_id)

            const totalScore = allAnswers?.reduce((sum, a) => sum + (a.points_earned || 0), 0) || 0

            // Check if there are essay questions in the exam (soal dari cache)
            const examQuestions = await getExamQuestionsForGrading('exam_questions', currentSubmission.exam_id)

            const hasEssays = examQuestions.some(q => needsManualGrading(q.question_type));
            const isGraded = !hasEssays

            const { data: updatedSubmission, error } = await supabase
                .from('exam_submissions')
                .update({
                    is_submitted: true,
                    submitted_at: new Date().toISOString(),
                    total_score: totalScore,
                    is_graded: isGraded
                })
                .eq('id', submission_id)
                .select()
                .single()

            if (error) throw error

            // Notify teacher about exam submission (diagregasi per menit — lihat teacherNotifyBuffer)
            bufferTeacherSubmissionNotification('exam', currentSubmission.exam_id, user.full_name || 'Siswa')

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
        console.error('Error updating exam submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
