import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getYearStatusById, archivedYearResponse } from '@/lib/academicYear'
import { extendTimeForExam, validateExtendMinutes, type ExtendableExamRow } from '@/lib/extendExamTime'

/**
 * POST /api/official-exam-submissions/extend-time — "Tambah Waktu" UTS/UAS
 * dari Monitor Live. Mirror /api/exam-submissions/extend-time (ulangan);
 * official_exams punya kolom school_id → tenant guard langsung, dan GURU
 * diizinkan bila mengampu mapel ini di salah satu kelas target (mirror
 * guard monitor official). Tahun ajaran arsip ditolak.
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
        const { exam_id: examId, additional_minutes: minutes } = body
        if (!examId) {
            return NextResponse.json({ error: 'exam_id required' }, { status: 400 })
        }
        const minutesError = validateExtendMinutes(minutes)
        if (minutesError) {
            return NextResponse.json({ error: minutesError }, { status: 400 })
        }

        // 1. Exam + tenant guard (school_id langsung — 404 anti-bocor lintas sekolah)
        const { data: exam, error: examError } = await supabase
            .from('official_exams')
            .select('id, title, start_time, duration_minutes, window_end_time, is_active, school_id, subject_id, target_class_ids, academic_year_id')
            .eq('id', examId)
            .single()

        if (examError || !exam || exam.school_id !== schoolId) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 })
        }
        if (!exam.is_active) {
            return NextResponse.json({ error: 'Ujian tidak aktif' }, { status: 400 })
        }

        // Tahun arsip: tolak
        if (exam.academic_year_id) {
            const yearStatus = await getYearStatusById(exam.academic_year_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        // 2. Guard GURU: mengampu mapel ini di minimal satu kelas target
        //    (mirror guard monitor official — TA aktif sekolah × mapel × kelas target)
        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()
            if (!teacher) {
                return NextResponse.json({ error: 'Teacher profile not found' }, { status: 404 })
            }
            const { data: activeYear } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .single()
            const { data: assignments } = await supabase
                .from('teaching_assignments')
                .select('class_id')
                .eq('teacher_id', teacher.id)
                .eq('academic_year_id', activeYear?.id || '')
                .eq('subject_id', exam.subject_id)
            const teacherClassIds = (assignments || []).map(a => a.class_id)
            const allowed = (exam.target_class_ids || []).some((id: string) => teacherClassIds.includes(id))
            if (!allowed) {
                return NextResponse.json({ error: 'You do not teach any classes for this exam' }, { status: 403 })
            }
        }

        // 3. Terapkan
        const member: ExtendableExamRow = {
            id: exam.id,
            start_time: exam.start_time,
            duration_minutes: exam.duration_minutes,
            window_end_time: exam.window_end_time,
        }
        const r = await extendTimeForExam('official', member, Number(minutes))

        return NextResponse.json({
            success: true,
            extended: r.extended,
            window_shifted: r.window_shifted,
            new_window_end_time: r.new_window_end_time,
            new_duration_minutes: r.new_duration_minutes,
            message: `+${minutes} menit diterapkan untuk ${r.extended} siswa yang sedang mengerjakan`
                + (r.window_shifted ? ' (jam tutup digeser — siswa belum mulai ikut diuntungkan)' : ' (durasi diperpanjang)'),
        })
    } catch (error) {
        console.error('Error extending official exam time:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
