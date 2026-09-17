import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { needsManualGrading } from '@/lib/questionTypeUtils'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { getExamQuestionsForGrading } from '@/lib/examQuestionsCache'
import { getAnswerStats } from '@/lib/monitorAnswerStats'
import { resolveWindowExpiry, isSweepDue, endsAtIso } from '@/lib/examExpiry'
import { getTeacherScope, coTeachesClassSubject } from '@/lib/teacherScope'
import { findExamsOutsideSchool } from '@/lib/tenantGuard'

// Monitor ulangan reguler (tabel exams/exam_submissions/exam_answers/exam_questions).
// Mirror dari /api/official-exam-submissions/monitor, dengan roster diturunkan dari
// teaching_assignment.class_id (ulangan = per-kelas). Shape respons dibuat IDENTIK
// dengan official agar halaman monitor dapat dipakai bersama (cukup ganti URL).
//
// ?batch=1 → monitor SEMUA member batch multi-kelas sekaligus (mirror UTS/UAS):
// roster merge per kelas member, `target_classes` berisi semua kelas member
// (kolom kelas + "Saring Kelas" di halaman sudah ready), tiap siswa membawa
// submission dari exam member kelasnya sendiri (reset attempt mengenai exam
// yang benar). GURU hanya melihat kelas yang dia ampou; ADMIN semua member.
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
        const batchMode = request.nextUrl.searchParams.get('batch') === '1'
        if (!examId) {
            return NextResponse.json({ error: 'exam_id required' }, { status: 400 })
        }

        // 1. Fetch Exam representative + teaching_assignment (kelas/mapel/guru/tahun)
        const { data: exam, error: examError } = await supabase
            .from('exams')
            .select(`
                id, title, duration_minutes, start_time, window_end_time, is_active, max_violations,
                is_remedial, allowed_student_ids, batch_id,
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

        // 2. GURU guard: pemilik teaching_assignment ini ATAU co-teacher
        //    (mengampu mapel+kelas yang sama di tahun TA) — admin bebas
        let teacherId: string | null = null
        let teacherScope: Awaited<ReturnType<typeof getTeacherScope>> | null = null
        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()

            if (!teacher) {
                return NextResponse.json({ error: 'Teacher profile not found' }, { status: 404 })
            }
            teacherId = teacher.id

            if (ta?.teacher_id !== teacher.id) {
                teacherScope = await getTeacherScope(user.id, ta?.academic_year_id ?? null)
                if (!coTeachesClassSubject(teacherScope, ta?.subject_id, ta?.class_id)) {
                    return NextResponse.json({ error: 'You do not teach this class' }, { status: 403 })
                }
            }
        }

        // Question count (representative — soal batch identik via sync)
        const { count: totalQuestions } = await supabase
            .from('exam_questions')
            .select('id', { count: 'exact', head: true })
            .eq('exam_id', examId)

        // 3. Resolve member batch (batch mode): 1 exam per kelas, scope-filtered.
        //    Member membawa jadwalnya sendiri (timer/sisa waktu dihitung per member).
        interface MemberCtx {
            id: string
            start_time: string
            duration_minutes: number
            window_end_time: string | null
            is_remedial: boolean | null
            allowed_student_ids: string[]
            classId: string
            classObj: any
            academicYearId: string | null
        }
        const members: MemberCtx[] = [{
            id: exam.id,
            start_time: exam.start_time,
            duration_minutes: exam.duration_minutes,
            window_end_time: exam.window_end_time,
            is_remedial: exam.is_remedial,
            allowed_student_ids: Array.isArray(exam.allowed_student_ids) ? exam.allowed_student_ids : [],
            classId,
            classObj,
            academicYearId: ta?.academic_year_id ?? null,
        }]

        if (batchMode && exam.batch_id) {
            const { data: siblingRows } = await supabase
                .from('exams')
                .select(`
                    id, start_time, duration_minutes, window_end_time, is_remedial, allowed_student_ids,
                    teaching_assignment:teaching_assignments(
                        teacher_id, subject_id, class_id, academic_year_id,
                        class:classes(id, name, school_level, grade_level)
                    )
                `)
                .eq('batch_id', exam.batch_id)
                .neq('id', examId)
            let visible: any[] = siblingRows || []
            if (visible.length > 0) {
                // Tenant guard: semua member harus milik sekolah caller
                if ((await findExamsOutsideSchool(visible.map(r => r.id), schoolId)).length > 0) {
                    return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
                }
                if (user.role === 'GURU') {
                    if (!teacherScope) teacherScope = await getTeacherScope(user.id, null)
                    const scope = teacherScope
                    const myTeacherId = teacherId
                    visible = visible.filter(row => {
                        const rta = Array.isArray(row.teaching_assignment) ? row.teaching_assignment[0] : row.teaching_assignment
                        if (myTeacherId && rta?.teacher_id === myTeacherId) return true
                        return coTeachesClassSubject(scope, rta?.subject_id, rta?.class_id)
                    })
                }
            }
            for (const row of visible) {
                const rta = Array.isArray(row.teaching_assignment) ? row.teaching_assignment[0] : row.teaching_assignment
                const rcls = Array.isArray(rta?.class) ? rta?.class[0] : rta?.class
                if (!rta?.class_id) continue
                members.push({
                    id: row.id,
                    start_time: row.start_time,
                    duration_minutes: row.duration_minutes,
                    window_end_time: row.window_end_time,
                    is_remedial: row.is_remedial,
                    allowed_student_ids: Array.isArray(row.allowed_student_ids) ? row.allowed_student_ids : [],
                    classId: rta.class_id,
                    classObj: rcls,
                    academicYearId: rta.academic_year_id ?? null,
                })
            }
        }

        // Header exam — shape IDENTIK dengan official monitor:
        // target_classes berisi semua kelas member (kolom kelas + saring kelas)
        const targetClasses = members.map(m => m.classObj).filter(Boolean)
        const examData: any = {
            id: exam.id,
            title: exam.title,
            exam_type: 'Ulangan',
            duration_minutes: exam.duration_minutes,
            start_time: exam.start_time,
            window_end_time: exam.window_end_time,
            is_active: exam.is_active,
            max_violations: exam.max_violations ?? 3,
            subject_id: subjectId,
            subject_name: subjectObj?.name || 'Unknown Subject',
            subject_kkm: subjectObj?.kkm || 75,
            total_questions: totalQuestions || 0,
            target_classes: targetClasses,
            target_class_ids: targetClasses.map((c: any) => c.id)
        }

        const now = new Date()
        const nowTime = now.getTime()

        // 4. Roster per member: siswa ACTIVE yang terdaftar di kelas member untuk
        //    tahun ajaran TA member. fetchAllRows: roster bisa >1000 baris.
        const rosterByMember = new Map<string, any[]>()
        const allTargetStudents: any[] = []
        for (const m of members) {
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
                .eq('class_id', m.classId)
                .eq('status', 'ACTIVE')
            // Filter tahun hanya saat TA punya academic_year_id — eq('') akan
            // mengosongkan roster diam-diam pada data lama yang NULL
            if (m.academicYearId) {
                rosterQuery = rosterQuery.eq('academic_year_id', m.academicYearId)
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
            const allowedIds = m.allowed_student_ids
            const targetStudents = (m.is_remedial && allowedIds.length > 0)
                ? students.filter(s => allowedIds.includes(s.id))
                : students

            rosterByMember.set(m.id, targetStudents)
            allTargetStudents.push(...targetStudents)
        }

        if (allTargetStudents.length === 0) {
            return NextResponse.json({
                exam: examData,
                students: [],
                summary: { total_target_students: 0, not_started: 0, working: 0, submitted: 0 }
            })
        }

        // 5. Submissions per member (exam member kelasnya masing-masing)
        // batchedIn: ratusan–1000+ student id dalam satu .in() membuat URL >16KB → 500
        const submissionsByMember = new Map<string, any[]>()
        for (const m of members) {
            const studentIds = (rosterByMember.get(m.id) || []).map(s => s.id)
            if (studentIds.length === 0) {
                submissionsByMember.set(m.id, [])
                continue
            }
            const subs = await batchedIn<any>('student_id', studentIds, (chunk) =>
                supabase
                    .from('exam_submissions')
                    .select(`
                        id, student_id, is_submitted, is_graded, violation_count, started_at, submitted_at, timer_override_until,
                        total_score, max_score
                    `)
                    .eq('exam_id', m.id)
                    .in('student_id', chunk)
            )
            submissionsByMember.set(m.id, subs || [])
        }

        // 6. Answer stats per submission — satu agregasi DB-side (RPC ber-index)
        //    menggantikan scan seluruh baris exam_answers: 1.000 siswa × 50 soal
        //    = 50.000+ baris + puluhan request PostgREST PER POLL sebelumnya.
        const answerStatsByMember = new Map<string, Awaited<ReturnType<typeof getAnswerStats>>>()
        for (const m of members) {
            const subIds = (submissionsByMember.get(m.id) || []).map(s => s.id)
            answerStatsByMember.set(m.id, await getAnswerStats('exam', m.id, subIds))
        }

        // 7. Server-side auto-submit per member: expired & unsubmitted → skor & flip submitted
        // Satu sumber kebenaran: mode serentak / jendela + override (src/lib/examExpiry.ts)
        for (const m of members) {
            const subs = submissionsByMember.get(m.id) || []
            const stats = answerStatsByMember.get(m.id)!
            const expiredSubmissionIds: string[] = []
            for (const sub of subs) {
                if (!sub.is_submitted && sub.started_at) {
                    const expiry = resolveWindowExpiry(
                        { start_time: m.start_time, duration_minutes: m.duration_minutes, window_end_time: m.window_end_time },
                        { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
                    )
                    if (isSweepDue(expiry, nowTime)) {
                        expiredSubmissionIds.push(sub.id)
                    }
                }
            }

            if (expiredSubmissionIds.length > 0) {
                // Soal dari cache in-memory (TTL 10 mnt) — sama dengan jalur autosave/submit
                const examQuestions = await getExamQuestionsForGrading('exam_questions', m.id)
                const hasEssays = examQuestions.some(q => needsManualGrading(q.question_type)) || false

                // Update paralel per chunk 50 — menggantikan loop sekuensial
                // (SELECT answers + UPDATE per siswa = N+1 query saat massal).
                // Skor diambil dari agregasi RPC (answerStats), bukan SELECT per siswa.
                const CHUNK = 50
                for (let i = 0; i < expiredSubmissionIds.length; i += CHUNK) {
                    await Promise.all(expiredSubmissionIds.slice(i, i + CHUNK).map(async (subId) => {
                        const sub = subs.find(s => s.id === subId)
                        if (!sub) return

                        const totalScore = stats.get(subId)?.points || 0

                        const expiry = resolveWindowExpiry(
                            { start_time: m.start_time, duration_minutes: m.duration_minutes, window_end_time: m.window_end_time },
                            { started_at: sub.started_at, timer_override_until: sub.timer_override_until }
                        )
                        const expectedSubmittedAt = endsAtIso(expiry) || new Date(sub.started_at).toISOString()

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
                    }))
                }
            }
        }

        let notStartedCount = 0
        let workingCount = 0
        let submittedCount = 0

        // 8. Assemble final student progress list (merge semua kelas member)
        const processedStudents: any[] = []
        for (const m of members) {
            const roster = rosterByMember.get(m.id) || []
            const subs = submissionsByMember.get(m.id) || []
            const stats = answerStatsByMember.get(m.id)!
            const submissionMap = new Map()
            subs.forEach(sub => submissionMap.set(sub.student_id, sub))

            for (const student of roster) {
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
                        // (per member — jadwal tiap kelas bisa berbeda via editor per-kelas)
                        const expiry = resolveWindowExpiry(
                            { start_time: m.start_time, duration_minutes: m.duration_minutes, window_end_time: m.window_end_time },
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

                const answeredCount = sub ? (stats.get(sub.id)?.count || 0) : 0

                processedStudents.push({
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
                })
            }
        }

        return NextResponse.json({
            exam: examData,
            students: processedStudents,
            summary: {
                total_target_students: processedStudents.length,
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
