import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { needsManualGrading } from '@/lib/questionTypeUtils'
import { batchedIn, IN_BATCH_SIZE } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { resolveWindowExpiry, isSweepDue, endsAtIso } from '@/lib/examExpiry'

// Monitor ulangan reguler (tabel exams/exam_submissions/exam_answers/exam_questions).
// Mirror dari /api/official-exam-submissions/monitor, dengan roster diturunkan dari
// teaching_assignment.class_id (ulangan = per-kelas). Shape respons dibuat IDENTIK
// dengan official agar halaman monitor dapat dipakai bersama (cukup ganti URL).
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        // Only GURU and ADMIN can monitor
        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const examId = request.nextUrl.searchParams.get('exam_id')
        if (!examId) {
            return NextResponse.json({ error: 'exam_id required' }, { status: 400 })
        }

        // 1. Fetch Exam + teaching_assignment (kelas/mapel/guru/tahun)
        const { data: exam, error: examError } = await supabase
            .from('exams')
            .select(`
                id, title, duration_minutes, start_time, window_end_time, is_active, max_violations,
                is_remedial, allowed_student_ids,
                teaching_assignment:teaching_assignments(
                    id, teacher_id, class_id, subject_id, academic_year_id,
                    class:classes(id, name, school_level, grade_level),
                    subject:subjects(id, name, kkm),
                    teacher:teachers(id, school_id)
                )
            `)
            .eq('id', examId)
            .single()

        if (examError || !exam) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }

        const taAny = exam.teaching_assignment as any
        const ta = Array.isArray(taAny) ? taAny[0] : taAny
        const classId = ta?.class_id
        const subjectId = ta?.subject_id
        const subjectObjAny = ta?.subject as any
        const subjectObj = Array.isArray(subjectObjAny) ? subjectObjAny[0] : subjectObjAny
        const classObjAny = ta?.class as any
        const classObj = Array.isArray(classObjAny) ? classObjAny[0] : classObjAny

        if (!classId) {
            return NextResponse.json({ error: 'Exam class not found' }, { status: 404 })
        }

        // Tenant guard: exam harus milik sekolah user. Anchor via guru TA —
        // selalu ada, tidak bergantung academic_year_id yang bisa NULL.
        // (exams tidak punya kolom school_id; 404 agar keberadaan exam tidak bocor)
        const teacherObjAny = ta?.teacher as any
        const teacherObj = Array.isArray(teacherObjAny) ? teacherObjAny[0] : teacherObjAny
        if (!teacherObj || teacherObj.school_id !== schoolId) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }

        // Question count
        const { count: totalQuestions } = await supabase
            .from('exam_questions')
            .select('id', { count: 'exact', head: true })
            .eq('exam_id', examId)

        const examData: any = {
            id: exam.id,
            title: exam.title,
            exam_type: 'Ulangan',
            duration_minutes: exam.duration_minutes,
            start_time: exam.start_time,
            is_active: exam.is_active,
            max_violations: exam.max_violations ?? 3,
            subject_id: subjectId,
            subject_name: subjectObj?.name || 'Unknown Subject',
            subject_kkm: subjectObj?.kkm || 75,
            total_questions: totalQuestions || 0,
            // Samakan shape dgn official monitor (target_classes / target_class_ids)
            target_classes: classObj ? [classObj] : [],
            target_class_ids: [classId]
        }

        // 2. GURU guard: harus pemilik teaching_assignment ini (admin bebas)
        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()

            if (!teacher) {
                return NextResponse.json({ error: 'Teacher profile not found' }, { status: 404 })
            }

            if (ta?.teacher_id !== teacher.id) {
                return NextResponse.json({ error: 'You do not teach this class' }, { status: 403 })
            }
        }

        // 3. Roster: siswa ACTIVE yang terdaftar di kelas ini untuk tahun ajaran TA.
        //    fetchAllRows: roster bisa >1000 baris (batas default PostgREST 1000).
        let rosterQuery = supabase
            .from('student_enrollments')
            .select(`
                class_id,
                student:students!student_enrollments_student_id_fkey(
                    id, nis,
                    user:users!students_user_id_fkey(full_name)
                ),
                class:classes!student_enrollments_class_id_fkey(id, name)
            `)
            .eq('class_id', classId)
            .eq('status', 'ACTIVE')
        // Filter tahun hanya saat TA punya academic_year_id — eq('') akan
        // mengosongkan roster diam-diam pada data lama yang NULL
        if (ta?.academic_year_id) {
            rosterQuery = rosterQuery.eq('academic_year_id', ta.academic_year_id)
        }
        const rosterEnrollments = await fetchAllRows(rosterQuery)

        const seenStudent = new Set<string>()
        const students: any[] = []
        for (const e of (rosterEnrollments || [])) {
            const s = e.student as any
            if (!s || seenStudent.has(s.id)) continue
            seenStudent.add(s.id)
            students.push({
                id: s.id,
                nis: s.nis,
                class_id: e.class_id,
                user: s.user,
                class: e.class
            })
        }

        // Ulangan remedial: roster dibatasi ke siswa yang memang terdaftar remedial,
        // bukan seluruh kelas (siswa lain bukan target dan tidak akan pernah submit)
        const allowedIds = Array.isArray(exam.allowed_student_ids) ? exam.allowed_student_ids : []
        const targetStudents = (exam.is_remedial && allowedIds.length > 0)
            ? students.filter(s => allowedIds.includes(s.id))
            : students

        if (targetStudents.length === 0) {
            return NextResponse.json({
                exam: examData,
                students: [],
                summary: { total_target_students: 0, not_started: 0, working: 0, submitted: 0 }
            })
        }

        // 4. Submissions for these students
        const studentIds = targetStudents.map(s => s.id)
        // batchedIn: ratusan–1000+ student id dalam satu .in() membuat URL >16KB → 500
        const submissions = await batchedIn('student_id', studentIds, (chunk) =>
            supabase
                .from('exam_submissions')
                .select(`
                    id, student_id, is_submitted, is_graded, violation_count, started_at, submitted_at, timer_override_until,
                    total_score, max_score
                `)
                .eq('exam_id', examId)
                .in('student_id', chunk)
        )

        const submissionMap = new Map()
        if (submissions) {
            submissions.forEach(sub => {
                submissionMap.set(sub.student_id, sub)
            })
        }

        // 5. Answer counts per submission (batch per 100 + fetchAllRows per chunk) — ganti N+1.
        const submissionIds = submissions?.map(s => s.id) || []
        const answerCounts = new Map<string, number>()
        if (submissionIds.length > 0) {
            const chunks: string[][] = []
            for (let i = 0; i < submissionIds.length; i += IN_BATCH_SIZE) {
                chunks.push(submissionIds.slice(i, i + IN_BATCH_SIZE))
            }
            await Promise.all(chunks.map(async (chunk) => {
                const rows = await fetchAllRows<{ submission_id: string }>(
                    supabase
                        .from('exam_answers')
                        .select('submission_id')
                        .in('submission_id', chunk)
                )
                for (const a of rows) {
                    answerCounts.set(a.submission_id, (answerCounts.get(a.submission_id) || 0) + 1)
                }
            }))
        }

        const now = new Date()
        const nowTime = now.getTime()

        // 6. Server-side auto-submit: expired & unsubmitted → skor & flip submitted
        // Satu sumber kebenaran: mode serentak / jendela + override (src/lib/examExpiry.ts)
        const expiredSubmissionIds: string[] = []
        if (submissions) {
            for (const sub of submissions) {
                if (!sub.is_submitted && sub.started_at) {
                    const expiry = resolveWindowExpiry(
                        { start_time: exam.start_time, duration_minutes: exam.duration_minutes, window_end_time: exam.window_end_time },
                        { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
                    )
                    if (isSweepDue(expiry, nowTime)) {
                        expiredSubmissionIds.push(sub.id)
                    }
                }
            }
        }

        if (expiredSubmissionIds.length > 0) {
            const { data: examQuestions } = await supabase
                .from('exam_questions')
                .select('question_type')
                .eq('exam_id', examId)
            const hasEssays = examQuestions?.some(q => needsManualGrading(q.question_type)) || false

            for (const subId of expiredSubmissionIds) {
                const sub = submissions!.find(s => s.id === subId)
                if (!sub) continue

                const { data: existingAnswers } = await supabase
                    .from('exam_answers')
                    .select('points_earned')
                    .eq('submission_id', subId)
                const totalScore = existingAnswers?.reduce((sum, a) => sum + (a.points_earned || 0), 0) || 0

                const startedTime = new Date(sub.started_at).getTime()
                const expiry = resolveWindowExpiry(
                    { start_time: exam.start_time, duration_minutes: exam.duration_minutes, window_end_time: exam.window_end_time },
                    { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
                )
                const expectedSubmittedAt = endsAtIso(expiry) || new Date(startedTime).toISOString()

                await supabase
                    .from('exam_submissions')
                    .update({
                        is_submitted: true,
                        submitted_at: expectedSubmittedAt,
                        total_score: totalScore,
                        is_graded: !hasEssays
                    })
                    .eq('id', subId)

                sub.is_submitted = true
                sub.submitted_at = expectedSubmittedAt
                sub.total_score = totalScore
                sub.is_graded = !hasEssays
            }
        }

        let notStartedCount = 0
        let workingCount = 0
        let submittedCount = 0

        // 7. Assemble final student progress list
        const processedStudents = targetStudents.map(student => {
            const sub = submissionMap.get(student.id)
            let status = 'not_started'
            let timeRemainingSec = null

            if (sub) {
                if (sub.is_submitted) {
                    status = 'submitted'
                    submittedCount++
                } else {
                    status = 'working'
                    workingCount++
                    // Satu sumber kebenaran: mode serentak / jendela + override hard reset
                    const expiry = resolveWindowExpiry(
                        { start_time: exam.start_time, duration_minutes: exam.duration_minutes, window_end_time: exam.window_end_time },
                        { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
                    )
                    const endTarget = expiry.limited ? expiry.endAt : null
                    timeRemainingSec = endTarget !== null
                        ? Math.max(0, Math.floor((endTarget - nowTime) / 1000))
                        : null
                }
            } else {
                notStartedCount++
            }

            const answeredCount = sub ? (answerCounts.get(sub.id) || 0) : 0

            return {
                student_id: student.id,
                submission_id: sub?.id || null,
                student_name: Array.isArray(student.user) ? student.user[0]?.full_name : (student.user as any)?.full_name || 'Tanpa Nama',
                nis: student.nis || '-',
                class_name: Array.isArray(student.class) ? student.class[0]?.name : (student.class as any)?.name || '-',
                status,
                answered_count: answeredCount,
                total_questions: examData.total_questions,
                violation_count: sub?.violation_count || 0,
                started_at: sub?.started_at || null,
                submitted_at: sub?.submitted_at || null,
                time_remaining_seconds: timeRemainingSec,
                total_score: sub?.total_score ?? null,
                max_score: sub?.max_score ?? null,
                is_graded: sub?.is_graded ?? false
            }
        })

        return NextResponse.json({
            exam: examData,
            students: processedStudents,
            summary: {
                total_target_students: targetStudents.length,
                not_started: notStartedCount,
                working: workingCount,
                submitted: submittedCount
            }
        })

    } catch (error) {
        console.error('Error in ulangan monitor API:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
