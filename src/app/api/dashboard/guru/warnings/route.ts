import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { mergeRemedialScores } from '@/lib/remedialScore'

const DEFAULT_KKM = 75

// batchedIn per 100 id (batas URL) + fetchAllRows per chunk: satu chunk 100 id bisa
// berisi >1000 baris (100 kuis × puluhan siswa) yang otherwise terpotong diam-diam.
function batchedFetchAll<T>(column: string, ids: string[], buildQuery: (chunk: string[]) => any): Promise<T[]> {
    return batchedIn<T>(column, ids, async (chunk) => ({ data: await fetchAllRows<T>(buildQuery(chunk)), error: null }))
}

export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: teacher, error: teacherError } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (teacherError || !teacher) {
            return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })
        }

        const teacherId = teacher.id

        // 1. Get Homeroom Classes (only from active academic year)
        const { data: allHomeroomClasses } = await supabase
            .from('classes')
            .select('id, name, school_level, grade_level, academic_year:academic_years(is_active)')
            .eq('homeroom_teacher_id', teacherId)

        // Filter to active year only
        const homeroomClasses = (allHomeroomClasses || []).filter((c: any) => {
            const ay = Array.isArray(c.academic_year) ? c.academic_year[0] : c.academic_year
            return ay?.is_active === true
        })

        // 2. Get Teaching Assignments
        const { data: directAssignments } = await supabase
            .from('teaching_assignments')
            .select(`
                id, 
                class_id, 
                subject:subjects(id, name, kkm), 
                class:classes(id, name, school_level, grade_level),
                academic_year:academic_years(is_active)
            `)
            .eq('teacher_id', teacherId)

        // Filter active assignments only
        const activeDirectAssignments = (directAssignments || []).filter((ta: any) => {
            const arr = Array.isArray(ta.academic_year) ? ta.academic_year[0] : ta.academic_year
            return arr?.is_active === true
        })

        // Gather all relevant class IDs
        const hrClassIds = (homeroomClasses || []).map(c => c.id)
        const taClassIds = activeDirectAssignments.map(ta => ta.class_id)
        const allRelevantClassIds = Array.from(new Set([...hrClassIds, ...taClassIds]))

        if (allRelevantClassIds.length === 0) {
            return NextResponse.json({ teachingWarnings: [], homeroomWarnings: [], myClasses: [], missingSubmissions: [] })
        }

        // 3. Get Students in relevant classes
        // fetchAllRows WAJIB: students bisa >1000 baris — PostgREST memotong
        // diam-diam di 1000 tanpa error (siswa hilang = warning & missing bocor).
        // try/catch: kegagalan DB → response kosong 200 (paritas perilaku pra-refactor,
        // saat query biasa degrade ke data null) — dashboard guru tetap ter-render.
        let students: any[] = []
        try {
            students = await fetchAllRows<any>(
                supabase
                    .from('students')
                    .select(`
                        id, class_id, 
                        user:users!students_user_id_fkey(full_name),
                        class:classes(name)
                    `)
                    .in('class_id', allRelevantClassIds)
                    .eq('status', 'ACTIVE')
                    .order('id')
            )
        } catch (studentsError) {
            console.error('Error fetching students for dashboard warnings:', studentsError)
            return NextResponse.json({ teachingWarnings: [], homeroomWarnings: [], myClasses: [], missingSubmissions: [] })
        }

        if (students.length === 0) {
            return NextResponse.json({ teachingWarnings: [], homeroomWarnings: [], myClasses: [], missingSubmissions: [] })
        }
        const studentIds = students.map(s => s.id)

        // 4. Get ALL Teaching Assignments for these classes to know all subjects for HR students
        // fetchAllRows: kelas × mapel sekolah besar bisa mendekati batas 1000 baris.
        // try/catch: sama seperti students — gagal → response kosong 200, bukan 500.
        let allAssignments: any[] = []
        try {
            allAssignments = await fetchAllRows<any>(
                supabase
                    .from('teaching_assignments')
                    .select(`
                        id, class_id,
                        subject:subjects(id, name, kkm),
                        class:classes(id, name, school_level, grade_level),
                        academic_year:academic_years(is_active)
                    `)
                    .in('class_id', allRelevantClassIds)
                    .order('id')
            )
        } catch (assignmentsError) {
            console.error('Error fetching assignments for dashboard warnings:', assignmentsError)
            return NextResponse.json({ teachingWarnings: [], homeroomWarnings: [], myClasses: [], missingSubmissions: [] })
        }

        const activeAllAssignments = (allAssignments || []).filter((ta: any) => {
            const arr = Array.isArray(ta.academic_year) ? ta.academic_year[0] : ta.academic_year
            return arr?.is_active === true
        })
        const allTaIds = activeAllAssignments.map(ta => ta.id)

        // 5. Get Submissions Data
        // Satu query dengan .in(quizIds).in(studentIds) membawa ratusan id per kolom
        // untuk guru multi-kelas → URL overflow. Dipisah: batch per 100 id pada kolom
        // pertama, filter siswa di JS (pola yang sama seperti rantai tugas di bawah).
        const studentSet = new Set(studentIds)

        // - Quizzes (batched: guru multi-kelas × mapel menghasilkan puluhan TA id —
        //   .in() polos bisa overflow limit URL)
        const quizzes = await batchedIn<any>(
            'teaching_assignment_id', allTaIds,
            (chunk) => supabase.from('quizzes').select('id, title, teaching_assignment_id, is_remedial, remedial_for_id, remedial_score_policy, remedial_max_score, deadline, allowed_student_ids').in('teaching_assignment_id', chunk)
        )
        const quizIds = quizzes.map(q => q.id)
        const allQuizSubs = await batchedFetchAll<{ quiz_id: string; student_id: string; total_score: number; max_score: number }>(
            'quiz_id', quizIds,
            (chunk) => supabase
                .from('quiz_submissions')
                .select('quiz_id, student_id, total_score, max_score')
                .in('quiz_id', chunk)
                .not('submitted_at', 'is', null)
                .order('id')
        )
        let quizSubs: { quiz_id: string; student_id: string; total_score: number; max_score: number }[] = allQuizSubs.filter(s => studentSet.has(s.student_id))

        // Remedial merge — pakai engine kebijakan (mergeRemedialScores) selaras
        // rekap (api/grades): HIGHEST/AVERAGE/CAP dihitung sesuai kebijakan yang
        // dipilih guru saat membuat remedial, bukan sekadar skor tertinggi mentah.
        // Nilai remedial MENGGANTIKAN nilai asli (satu entri final per kuis asli),
        // bukan double-count yang membuat siswa lulus-remedial tetap muncul di warning.
        const quizMeta = new Map(quizzes.map(q => [q.id, q]))
        const quizGroups = new Map<string, { quiz_id: string; student_id: string; entries: any[] }>()
        for (const s of quizSubs) {
            const meta = quizMeta.get(s.quiz_id)
            const base = meta?.remedial_for_id || s.quiz_id
            const key = `${s.student_id}:${base}`
            let g = quizGroups.get(key)
            if (!g) {
                g = { quiz_id: base, student_id: s.student_id, entries: [] }
                quizGroups.set(key, g)
            }
            g.entries.push({
                score: s.max_score > 0 ? (s.total_score / s.max_score) * 100 : null,
                isRemedial: !!meta?.is_remedial,
                policy: meta?.remedial_score_policy,
                cap: meta?.remedial_max_score,
            })
        }
        quizSubs = Array.from(quizGroups.values())
            .map(g => ({ quiz_id: g.quiz_id, student_id: g.student_id, final: mergeRemedialScores(g.entries) }))
            .filter(g => g.final !== null)
            .map(g => ({ quiz_id: g.quiz_id, student_id: g.student_id, total_score: g.final as number, max_score: 100 }))

        // - Exams (batched, alasan sama)
        const exams = await batchedIn<any>(
            'teaching_assignment_id', allTaIds,
            (chunk) => supabase.from('exams').select('id, title, teaching_assignment_id, is_remedial, remedial_for_id, remedial_score_policy, remedial_max_score, start_time, duration_minutes, window_end_time, allowed_student_ids').in('teaching_assignment_id', chunk)
        )
        const examIds = exams.map(e => e.id)
        const allExamSubs = await batchedFetchAll<{ exam_id: string; student_id: string; total_score: number; max_score: number }>(
            'exam_id', examIds,
            (chunk) => supabase
                .from('exam_submissions')
                .select('exam_id, student_id, total_score, max_score')
                .in('exam_id', chunk)
                .eq('is_submitted', true)
                .order('id')
        )

        // Remedial merge (ULANGAN) — sama seperti kuis di atas; tanpa ini skor
        // remedial terhitung sebagai skor kedua (double-count) dan siswa yang
        // sudah lulus remedial tetap muncul di warning "di bawah KKM".
        const examMeta = new Map(exams.map(e => [e.id, e]))
        const examGroups = new Map<string, { exam_id: string; student_id: string; entries: any[] }>()
        for (const s of allExamSubs.filter(s => studentSet.has(s.student_id))) {
            const meta = examMeta.get(s.exam_id)
            const base = meta?.remedial_for_id || s.exam_id
            const key = `${s.student_id}:${base}`
            let g = examGroups.get(key)
            if (!g) {
                g = { exam_id: base, student_id: s.student_id, entries: [] }
                examGroups.set(key, g)
            }
            g.entries.push({
                score: s.max_score > 0 ? (s.total_score / s.max_score) * 100 : null,
                isRemedial: !!meta?.is_remedial,
                policy: meta?.remedial_score_policy,
                cap: meta?.remedial_max_score,
            })
        }
        const examSubs = Array.from(examGroups.values())
            .map(g => ({ exam_id: g.exam_id, student_id: g.student_id, final: mergeRemedialScores(g.entries) }))
            .filter(g => g.final !== null)
            .map(g => ({ exam_id: g.exam_id, student_id: g.student_id, total_score: g.final as number, max_score: 100 }))

        // - Tugas (batched, alasan sama)
        const tasks = await batchedIn<any>(
            'teaching_assignment_id', allTaIds,
            (chunk) => supabase.from('assignments').select('id, title, due_date, teaching_assignment_id').in('teaching_assignment_id', chunk)
        )
        const taskIds = tasks.map(t => t.id)
        let submissions: { id: string; student_id: string; assignment_id: string }[] = []
        let taskSubsWithGrades: any[] = []
        if (taskIds.length > 0) {
            // Batched to avoid URL overflow — a teacher with many classes yields many
            // assignment_ids / submission_ids that exceed Supabase's URL limit and make
            // the grades query silently fail (=> tugas not counted).
            const allSubs = await batchedFetchAll<{ id: string; student_id: string; assignment_id: string }>(
                'assignment_id', taskIds,
                (chunk) => supabase.from('student_submissions').select('id, student_id, assignment_id').in('assignment_id', chunk).order('id')
            )
            submissions = allSubs.filter(s => studentSet.has(s.student_id))

            if (submissions.length > 0) {
                const subIds = submissions.map(s => s.id)
                const gradesData = await batchedIn<{ submission_id: string; score: number }>(
                    'submission_id', subIds,
                    (chunk) => supabase.from('grades').select('submission_id, score').in('submission_id', chunk)
                )

                // Merge grades with submissions
                taskSubsWithGrades = submissions.map(sub => {
                    const grade = gradesData.find(g => g.submission_id === sub.id)
                    return { ...sub, score: grade ? grade.score : null }
                }).filter(sub => sub.score !== null)
            }
        }

        // 6. Aggregate Data
        // A helper to lookup a student's grades for a SPECIFIC teaching assignment (Mapel in a class)
        const getScoresForTAAndStudent = (taId: string, studentId: string) => {
            const scores: number[] = []

            // Quizzes (sudah di-merge remedial di atas: satu entri per kuis asli, skor terbaik)
            const relatedQuizzes = quizzes.filter(q => q.teaching_assignment_id === taId).map(q => q.id)
            for (const qs of quizSubs.filter(s => s.student_id === studentId && relatedQuizzes.includes(s.quiz_id))) {
                if (qs.max_score > 0) scores.push((qs.total_score / qs.max_score) * 100)
            }
            // Exams — normalize to percentage (total_score is raw points; max_score varies per exam)
            const relatedExams = exams.filter(e => e.teaching_assignment_id === taId).map(e => e.id)
            for (const es of examSubs.filter(s => s.student_id === studentId && relatedExams.includes(s.exam_id))) {
                const raw = es.total_score || 0
                // max_score 0/null → poin mentah TIDAK boleh dicampur dengan skala
                // persen (15 poin ≠ 15%) — skip entry daripada merusak rata-rata.
                if (es.max_score > 0) scores.push((raw / es.max_score) * 100)
            }
            // Tasks
            const relatedTasks = tasks.filter(t => t.teaching_assignment_id === taId).map(t => t.id)
            for (const ts of taskSubsWithGrades.filter(s => s.student_id === studentId && relatedTasks.includes(s.assignment_id))) {
                scores.push(ts.score || 0)
            }

            return scores
        }

        // Batch fetch all subject KKM for the school to avoid N+1
        const { data: allSubjectKkms } = await supabase
            .from('subject_kkm')
            .select('subject_id, school_level, grade_level, kkm')
            .eq('school_id', schoolId)
            
        const getKkm = (subjectId: string, schoolLevel: string, gradeLevel: number, fallbackKkm: number) => {
            if (!schoolLevel || !gradeLevel) return fallbackKkm || DEFAULT_KKM
            const granular = allSubjectKkms?.find(k => k.subject_id === subjectId && k.school_level === schoolLevel && k.grade_level === gradeLevel)
            return granular ? granular.kkm : (fallbackKkm || DEFAULT_KKM)
        }

        const teachingWarnings: any[] = []
        const homeroomWarnings: any[] = []

        // Helper to unwrap Array items from Supabase joins
        const unwrap = (val: any) => Array.isArray(val) ? val[0] : val

        // ===== Belum Mengumpulkan =====
        // Siswa yang tidak mengumpulkan penilaian yang sudah lewat tenggat, hanya
        // untuk mapel yang diajar guru ini. Definisi "sudah mengerjakan":
        //  - Tugas: ada baris student_submissions (walau belum dinilai)
        //  - Kuis: submitted_at terisi (submission remedial = menyelesaikan kuis asal)
        //  - Ulangan/UTS: is_submitted true (submission remedial = selesai untuk asal)
        const nowMs = Date.now()

        const doneTasks = new Set<string>()
        for (const sub of submissions) doneTasks.add(`${sub.student_id}:${sub.assignment_id}`)
        const doneQuizzes = new Set<string>()
        for (const s of quizSubs) doneQuizzes.add(`${s.student_id}:${s.quiz_id}`)
        const doneExams = new Set<string>()
        for (const s of examSubs) doneExams.add(`${s.student_id}:${s.exam_id}`)

        // Official exams (UTS/UAS) — scoped mapel + kelas yang diajar (pola sama
        // dengan notificationJobs: subject_id guru + target_class_ids overlap).
        // WAJIB filter tahun ajaran aktif — tanpa ini UTS/UAS tahun lalu ikut
        // terhitung (konsisten dengan GET /api/official-exams yang year-scoped).
        const taughtSubjectIds = Array.from(new Set(
            activeDirectAssignments.map((ta: any) => unwrap(ta.subject)?.id).filter(Boolean)
        ))
        const taughtClassIds = Array.from(new Set(activeDirectAssignments.map((ta: any) => ta.class_id)))
        let officialExams: any[] = []
        let officialSubs: { exam_id: string; student_id: string }[] = []
        if (taughtSubjectIds.length > 0) {
            try {
                const { data: activeYears } = await supabase
                    .from('academic_years')
                    .select('id')
                    .eq('is_active', true)
                    .eq('school_id', schoolId)
                    .order('created_at', { ascending: false })
                    .limit(1)
                const activeYearId = activeYears?.[0]?.id
                if (activeYearId) {
                    const { data: oe } = await supabase
                        .from('official_exams')
                        .select('id, title, exam_type, subject_id, start_time, duration_minutes, window_end_time, target_class_ids, allowed_student_ids, is_remedial, remedial_for_id')
                        .eq('school_id', schoolId)
                        .eq('academic_year_id', activeYearId)
                        .in('subject_id', taughtSubjectIds)
                    officialExams = (oe || []).filter((e: any) =>
                        (e.target_class_ids || []).some((cid: string) => taughtClassIds.includes(cid))
                    )
                    const oeIds = officialExams.map((e: any) => e.id)
                    if (oeIds.length > 0) {
                        const allOfficialSubs = await batchedFetchAll<{ exam_id: string; student_id: string }>(
                            'exam_id', oeIds,
                            (chunk) => supabase
                                .from('official_exam_submissions')
                                .select('exam_id, student_id')
                                .in('exam_id', chunk)
                                .eq('is_submitted', true)
                                .order('id')
                        )
                        officialSubs = allOfficialSubs.filter(s => studentSet.has(s.student_id))
                    }
                }
            } catch (officialError) {
                // Degradasi graceful: UTS/UAS hilang dari daftar "belum mengumpulkan",
                // tapi warning KKM & data lain di dashboard tetap ter-render.
                console.error('Error fetching official exams for missingSubmissions:', officialError)
                officialExams = []
                officialSubs = []
            }
        }
        const officialMeta = new Map(officialExams.map((e: any) => [e.id, e]))
        const doneOfficial = new Set<string>()
        for (const s of officialSubs) {
            const base = officialMeta.get(s.exam_id)?.remedial_for_id || s.exam_id
            doneOfficial.add(`${s.student_id}:${base}`)
        }

        // Hard Reset: siswa dengan timer_override_until masih hidup sedang
        // diberi durasi penuh baru oleh guru/admin (selaras examExpiry: override
        // TIDAK dipotong jam tutup). Jangan dihitung "belum mengumpulkan" selama
        // jendela reset masih berjalan — siswa lain yang sekadar in-progress
        // tanpa override self-heal lewat sweep global 1 menit.
        const nowIso = new Date(nowMs).toISOString()
        const stillWorkingExams = new Set<string>()
        const stillWorkingOfficial = new Set<string>()
        try {
            if (examIds.length > 0) {
                const overrides = await fetchAllRows<{ exam_id: string; student_id: string }>(
                    supabase
                        .from('exam_submissions')
                        .select('exam_id, student_id')
                        .in('exam_id', examIds)
                        .not('timer_override_until', 'is', null)
                        .gt('timer_override_until', nowIso)
                        .order('id')
                )
                for (const s of overrides) {
                    if (!studentSet.has(s.student_id)) continue
                    const base = examMeta.get(s.exam_id)?.remedial_for_id || s.exam_id
                    stillWorkingExams.add(`${s.student_id}:${base}`)
                }
            }
            const officialExamIds = officialExams.map((e: any) => e.id)
            if (officialExamIds.length > 0) {
                const overrides = await fetchAllRows<{ exam_id: string; student_id: string }>(
                    supabase
                        .from('official_exam_submissions')
                        .select('exam_id, student_id')
                        .in('exam_id', officialExamIds)
                        .not('timer_override_until', 'is', null)
                        .gt('timer_override_until', nowIso)
                        .order('id')
                )
                for (const s of overrides) {
                    if (!studentSet.has(s.student_id)) continue
                    const base = officialMeta.get(s.exam_id)?.remedial_for_id || s.exam_id
                    stillWorkingOfficial.add(`${s.student_id}:${base}`)
                }
            }
        } catch (overrideError) {
            // Degradasi graceful: tanpa info override, siswa reset tampil seperti
            // biasa (false positive akan self-heal saat reset berakhir + sweep).
            console.error('Error fetching timer overrides for missingSubmissions:', overrideError)
        }

        // Selaras resolveWindowExpiry (src/lib/examExpiry.ts — sumber kebenaran):
        //  - mode jendela (window_end_time terisi): selesai di jam tutup
        //  - mode serentak: selesai di start_time + durasi
        //  - mode serentak TANPA durasi (0/null): tanpa batas → TIDAK pernah berakhir
        const isEnded = (startTime: string, durationMin: number, windowEnd: string | null) => {
            if (windowEnd) return nowMs > new Date(windowEnd).getTime()
            if (!(durationMin > 0)) return false
            return nowMs > new Date(startTime).getTime() + durationMin * 60000
        }

        type MissingItem = { type: string; title: string; subject_name: string }
        const missingMap = new Map<string, {
            student_id: string
            student_name: string
            class_id: string
            class_name: string
            missing_count: number
            items: MissingItem[]
        }>()

        const addMissing = (student: any, classId: string, className: string, item: MissingItem) => {
            let entry = missingMap.get(student.id)
            if (!entry) {
                entry = {
                    student_id: student.id,
                    student_name: unwrap(student.user)?.full_name || 'Tanpa Nama',
                    class_id: classId,
                    class_name: className,
                    missing_count: 0,
                    items: [],
                }
                missingMap.set(student.id, entry)
            }
            entry.items.push(item)
            entry.missing_count += 1
        }

        const expectedStudents = (classStudents: any[], allowed: string[] | null) =>
            allowed && allowed.length > 0
                ? classStudents.filter(s => allowed.includes(s.id))
                : classStudents

        for (const ta of activeDirectAssignments) {
            const subject = unwrap(ta.subject)
            const cls = unwrap(ta.class)
            const classStudents = students.filter(s => s.class_id === ta.class_id)
            const subjectName = subject?.name || 'Tanpa Mapel'
            const className = cls?.name || 'Tanpa Kelas'

            // Tugas — hanya yang punya due_date dan sudah lewat
            for (const task of tasks.filter((t: any) => t.teaching_assignment_id === ta.id)) {
                if (!task.due_date || new Date(task.due_date).getTime() >= nowMs) continue
                for (const student of classStudents) {
                    if (!doneTasks.has(`${student.id}:${task.id}`)) {
                        addMissing(student, ta.class_id, className, { type: 'TUGAS', title: task.title, subject_name: subjectName })
                    }
                }
            }

            // Kuis — deadline sudah lewat; remedial bukan item terpisah
            for (const quiz of quizzes.filter((q: any) => q.teaching_assignment_id === ta.id && !q.is_remedial)) {
                if (!quiz.deadline || new Date(quiz.deadline).getTime() >= nowMs) continue
                for (const student of expectedStudents(classStudents, quiz.allowed_student_ids)) {
                    if (!doneQuizzes.has(`${student.id}:${quiz.id}`)) {
                        addMissing(student, ta.class_id, className, { type: 'KUIS', title: quiz.title, subject_name: subjectName })
                    }
                }
            }

            // Ulangan — jendela pengerjaan sudah tutup; remedial bukan item terpisah
            for (const exam of exams.filter((e: any) => e.teaching_assignment_id === ta.id && !e.is_remedial)) {
                if (!isEnded(exam.start_time, exam.duration_minutes, exam.window_end_time)) continue
                for (const student of expectedStudents(classStudents, exam.allowed_student_ids)) {
                    if (!doneExams.has(`${student.id}:${exam.id}`) && !stillWorkingExams.has(`${student.id}:${exam.id}`)) {
                        addMissing(student, ta.class_id, className, { type: 'ULANGAN', title: exam.title, subject_name: subjectName })
                    }
                }
            }
        }

        // UTS/UAS resmi
        for (const exam of officialExams) {
            if (exam.is_remedial) continue
            if (!isEnded(exam.start_time, exam.duration_minutes, exam.window_end_time)) continue
            const subjectName = unwrap(
                activeAllAssignments.find((ta: any) => unwrap(ta.subject)?.id === exam.subject_id)?.subject
            )?.name || 'Tanpa Mapel'
            for (const classId of (exam.target_class_ids || []).filter((cid: string) => taughtClassIds.includes(cid))) {
                const className = unwrap(students.find(s => s.class_id === classId)?.class)?.name || 'Tanpa Kelas'
                const classStudents = students.filter(s => s.class_id === classId)
                for (const student of expectedStudents(classStudents, exam.allowed_student_ids)) {
                    if (!doneOfficial.has(`${student.id}:${exam.id}`) && !stillWorkingOfficial.has(`${student.id}:${exam.id}`)) {
                        addMissing(student, classId, className, { type: exam.exam_type, title: exam.title, subject_name: subjectName })
                    }
                }
            }
        }

        const missingSubmissions = Array.from(missingMap.values())
            .sort((a, b) => b.missing_count - a.missing_count || a.student_name.localeCompare(b.student_name))

        // Process Teaching Warnings
        for (const ta of activeDirectAssignments) {
            const classStudents = students.filter(s => s.class_id === ta.class_id)
            for (const student of classStudents) {
                const scores = getScoresForTAAndStudent(ta.id, student.id)
                if (scores.length > 0) {
                    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
                    const subject = unwrap(ta.subject)
                    const cls = unwrap(ta.class)
                    const subjectKkm = getKkm(subject?.id, cls?.school_level, cls?.grade_level, subject?.kkm)
                    if (avg < subjectKkm) {
                        teachingWarnings.push({
                            student_id: student.id,
                            student_name: unwrap(student.user)?.full_name || 'Tanpa Nama',
                            class_id: ta.class_id,
                            class_name: cls?.name || 'Tanpa Kelas',
                            subject_name: subject?.name || 'Tanpa Mapel',
                            avg_score: Math.round(avg),
                            score_count: scores.length,
                            teaching_assignment_id: ta.id,
                            kkm: subjectKkm
                        })
                    }
                }
            }
        }

        // Process Homeroom Warnings
        for (const hrClass of (homeroomClasses || [])) {
            const classStudents = students.filter(s => s.class_id === hrClass.id)
            // Get all mapels (TAs) for this class
            const classTAs = activeAllAssignments.filter(ta => ta.class_id === hrClass.id)

            for (const student of classStudents) {
                for (const ta of classTAs) {
                    const scores = getScoresForTAAndStudent(ta.id, student.id)
                    if (scores.length > 0) {
                        const avg = scores.reduce((a, b) => a + b, 0) / scores.length
                        const subject = unwrap(ta.subject)
                        const cls = unwrap(ta.class) || hrClass // fallback to hrClass if class relation is missing in TA
                        const subjectKkm = getKkm(subject?.id, cls?.school_level, cls?.grade_level, subject?.kkm)
                        if (avg < subjectKkm) {
                            homeroomWarnings.push({
                                student_id: student.id,
                                student_name: unwrap(student.user)?.full_name || 'Tanpa Nama',
                                class_id: hrClass.id,
                                class_name: hrClass.name,
                                subject_name: subject?.name || 'Tanpa Mapel',
                                avg_score: Math.round(avg),
                                score_count: scores.length,
                                kkm: subjectKkm
                            })
                        }
                    }
                }
            }
        }

        // Sort by lowest scores first
        teachingWarnings.sort((a, b) => a.avg_score - b.avg_score)
        homeroomWarnings.sort((a, b) => a.avg_score - b.avg_score)

        // Build "My Classes" grouped data (reuses already-fetched data, no extra queries)
        const classMap = new Map<string, { class_id: string; class_name: string; subjects: string[]; isHomeroom: boolean }>()

        for (const ta of activeDirectAssignments) {
            const cls = unwrap(ta.class)
            const subj = unwrap(ta.subject)
            if (!cls) continue
            const existing = classMap.get(cls.id)
            if (existing) {
                if (subj?.name && !existing.subjects.includes(subj.name)) {
                    existing.subjects.push(subj.name)
                }
            } else {
                classMap.set(cls.id, {
                    class_id: cls.id,
                    class_name: cls.name,
                    subjects: subj?.name ? [subj.name] : [],
                    isHomeroom: hrClassIds.includes(cls.id)
                })
            }
        }

        // Include homeroom-only classes (not in teaching assignments)
        for (const hrClass of (homeroomClasses || [])) {
            if (!classMap.has(hrClass.id)) {
                classMap.set(hrClass.id, {
                    class_id: hrClass.id,
                    class_name: hrClass.name,
                    subjects: [],
                    isHomeroom: true
                })
            } else {
                classMap.get(hrClass.id)!.isHomeroom = true
            }
        }

        const myClasses = Array.from(classMap.values()).sort((a, b) => a.class_name.localeCompare(b.class_name))

        return NextResponse.json({
            teachingWarnings,
            homeroomWarnings,
            myClasses,
            missingSubmissions
        })
    } catch (error: any) {
        console.error('Error fetching dashboard warnings:', error)
        return NextResponse.json({ error: 'Server error', details: error.message }, { status: 500 })
    }
}
