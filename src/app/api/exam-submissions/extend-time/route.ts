import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getTeacherScope, coTeachesClassSubject } from '@/lib/teacherScope'
import { findExamsOutsideSchool } from '@/lib/tenantGuard'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'
import { extendTimeForExam, validateExtendMinutes, type ExtendableExamRow } from '@/lib/extendExamTime'

/**
 * POST /api/exam-submissions/extend-time — "Tambah Waktu" ulangan dari Monitor Live.
 * Body: { exam_id, additional_minutes (1–120), batch? (true = semua member batch) }
 *
 * Otorisasi (mirror /api/exam-submissions/monitor): GURU pemilik TA / co-teacher
 * ATAU ADMIN sekolah yang sama. Tenant-guard via guru TA (exams tidak punya
 * kolom school_id) + findExamsOutsideSchool untuk seluruh member batch.
 * Tahun ajaran arsip (COMPLETED) ditolak — paritas guard PUT /api/exams/[id].
 *
 * Semantik perpanjangan: lihat src/lib/extendExamTime.ts (max+N per siswa,
 * jendela/durasi digeser utk siswa belum mulai, stackable).
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { exam_id: examId, additional_minutes: minutes, batch: batchMode } = body
        if (!examId) {
            return NextResponse.json({ error: 'exam_id required' }, { status: 400 })
        }
        const minutesError = validateExtendMinutes(minutes)
        if (minutesError) {
            return NextResponse.json({ error: minutesError }, { status: 400 })
        }

        // 1. Exam representative + TA (anchor tenant & scope)
        const { data: exam, error: examError } = await supabase
            .from('exams')
            .select(`
                id, title, start_time, duration_minutes, window_end_time, is_active, batch_id,
                teaching_assignment:teaching_assignments(
                    id, teacher_id, subject_id, class_id, academic_year_id,
                    teacher:teachers(school_id)
                )
            `)
            .eq('id', examId)
            .single()

        if (examError || !exam) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }
        if (!exam.is_active) {
            return NextResponse.json({ error: `${exam.is_active === false ? 'Ulangan tidak aktif (draft/selesai)' : 'Ulangan tidak aktif'}` }, { status: 400 })
        }

        const taAny = exam.teaching_assignment as unknown as { class_id?: string, teacher_id?: string, subject_id?: string, academic_year_id?: string, id?: string, teacher?: unknown } | { class_id?: string, teacher_id?: string, subject_id?: string, academic_year_id?: string, id?: string, teacher?: unknown }[]
        const ta = Array.isArray(taAny) ? taAny[0] : taAny
        const teacherObjAny = ta?.teacher as unknown as { school_id?: string } | { school_id?: string }[] | undefined
        const teacherObj = Array.isArray(teacherObjAny) ? teacherObjAny[0] : teacherObjAny
        if (!ta?.class_id || !teacherObj || teacherObj.school_id !== schoolId) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }

        // Tahun arsip: tolak (paritas guard PUT /api/exams/[id])
        if (ta.academic_year_id && ta.id) {
            const yearStatus = await getYearStatusByTA(ta.id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        // 2. Resolve member batch (mirror monitor): 1 exam per kelas, scope-filtered
        const members: ExtendableExamRow[] = [{
            id: exam.id,
            start_time: exam.start_time,
            duration_minutes: exam.duration_minutes,
            window_end_time: exam.window_end_time,
        }]
        let myTeacherId: string | null = null
        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()
            if (!teacher) {
                return NextResponse.json({ error: 'Teacher profile not found' }, { status: 404 })
            }
            myTeacherId = teacher.id
        }

        if (batchMode === true && exam.batch_id) {
            const { data: siblingRows } = await supabase
                .from('exams')
                .select(`
                    id, start_time, duration_minutes, window_end_time,
                    teaching_assignment:teaching_assignments(
                        teacher_id, subject_id, class_id, academic_year_id,
                        teacher:teachers(school_id)
                    )
                `)
                .eq('batch_id', exam.batch_id)
                .neq('id', examId)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let visible: any[] = siblingRows || []
            if (visible.length > 0) {
                // Tenant guard: SEMUA member harus milik sekolah caller
                if ((await findExamsOutsideSchool(visible.map(r => r.id), schoolId)).length > 0) {
                    return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
                }
                if (user.role === 'GURU') {
                    const scope = await getTeacherScope(user.id, null)
                    visible = visible.filter(row => {
                        const rta = Array.isArray(row.teaching_assignment) ? row.teaching_assignment[0] : row.teaching_assignment
                        if (myTeacherId && rta?.teacher_id === myTeacherId) return true
                        return coTeachesClassSubject(scope, rta?.subject_id, rta?.class_id)
                    })
                }
            }
            for (const row of visible) {
                members.push({
                    id: row.id,
                    start_time: row.start_time,
                    duration_minutes: row.duration_minutes,
                    window_end_time: row.window_end_time,
                })
            }
        }

        // 3. Guard GURU utk exam representative (pemilik / co-teacher)
        if (user.role === 'GURU') {
            if (ta.teacher_id !== myTeacherId) {
                const scope = await getTeacherScope(user.id, ta.academic_year_id ?? null)
                if (!coTeachesClassSubject(scope, ta.subject_id, ta.class_id)) {
                    return NextResponse.json({ error: 'You do not teach this class' }, { status: 403 })
                }
            }
        }

        // 4. Terapkan per member
        let extended = 0
        let windowShifted = false
        let newWindowEnd: string | null = null
        let newDuration: number | null = null
        for (const m of members) {
            const r = await extendTimeForExam('exam', m, Number(minutes))
            extended += r.extended
            windowShifted = windowShifted || r.window_shifted
            newWindowEnd = r.new_window_end_time ?? newWindowEnd
            newDuration = r.new_duration_minutes ?? newDuration
        }

        return NextResponse.json({
            success: true,
            extended,
            window_shifted: windowShifted,
            new_window_end_time: newWindowEnd,
            new_duration_minutes: newDuration,
            message: `+${minutes} menit diterapkan untuk ${extended} siswa yang sedang mengerjakan`
                + (windowShifted ? ' (jam tutup digeser — siswa belum mulai ikut diuntungkan)' : ' (durasi diperpanjang)'),
        })
    } catch (error) {
        console.error('Error extending exam time:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
