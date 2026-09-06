import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { logGradeChange } from '@/lib/gradeHistory'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'

// POST input nilai manual untuk kuis OFFLINE (dilaksanakan di luar LMS).
// Sengaja terpisah dari POST /api/quiz-submissions (hot path ujian online:
// autosave, anti-race, timer) agar jalur siswa tidak tersentuh sama sekali.
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { quiz_id, student_id, score } = await request.json()

        if (!quiz_id || !student_id || score === undefined) {
            return NextResponse.json({ error: 'Data tidak lengkap' }, { status: 400 })
        }

        const numScore = parseInt(score)
        if (isNaN(numScore) || numScore < 0 || numScore > 100) {
            return NextResponse.json({ error: 'Nilai harus antara 0 dan 100' }, { status: 400 })
        }

        // Verifikasi kuis + kepemilikan guru
        const { data: quiz } = await supabase
            .from('quizzes')
            .select('id, title, submission_mode, teaching_assignment:teaching_assignments(teacher_id, subject:subjects(name))')
            .eq('id', quiz_id)
            .single()

        const labels = await getMenuLabelsForSchool(schoolId)
        if (!quiz) {
            return NextResponse.json({ error: `${labels.kuis} tidak ditemukan` }, { status: 404 })
        }

        // Input manual hanya untuk kuis offline — kuis online dinilai dari pengerjaan siswa
        if ((quiz as any).submission_mode !== 'OFFLINE') {
            return NextResponse.json({ error: `Input nilai manual hanya tersedia untuk ${labels.kuis.toLowerCase()} offline` }, { status: 400 })
        }

        const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        const quizTeacherId = (quiz as any)?.teaching_assignment?.teacher_id
        if (teacher && quizTeacherId && quizTeacherId !== teacher.id) {
            return NextResponse.json({ error: `Anda tidak memiliki akses untuk menilai ${labels.kuis.toLowerCase()} ini` }, { status: 403 })
        }

        // Upsert submission manual (skala tetap 0-100: total = nilai, max = 100)
        const { data: existing } = await supabase
            .from('quiz_submissions')
            .select('id, total_score')
            .eq('quiz_id', quiz_id)
            .eq('student_id', student_id)
            .maybeSingle()

        let submissionData
        const nowIso = new Date().toISOString()

        if (existing) {
            const { data, error } = await supabase
                .from('quiz_submissions')
                .update({ total_score: numScore, max_score: 100, is_graded: true, submitted_at: nowIso })
                .eq('id', existing.id)
                .select()
                .single()
            if (error) throw error
            submissionData = data
        } else {
            const { data, error } = await supabase
                .from('quiz_submissions')
                .insert({
                    quiz_id,
                    student_id,
                    started_at: nowIso,
                    submitted_at: nowIso,
                    answers: null,
                    total_score: numScore,
                    max_score: 100,
                    is_graded: true
                })
                .select()
                .single()
            if (error) throw error
            submissionData = data
        }

        // Audit trail: catat perubahan nilai (nilai sama tidak dicatat — diff di helper)
        await logGradeChange({
            schoolId,
            source: 'QUIZ',
            refId: quiz_id,
            refTitle: quiz.title,
            studentId: student_id,
            oldScore: existing?.total_score ?? null,
            newScore: numScore,
            maxScore: 100,
            changedBy: user.id
        })

        // Notifikasi nilai keluar ke siswa
        try {
            const { data: student } = await supabase
                .from('students')
                .select('user_id')
                .eq('id', student_id)
                .single()

            if (student?.user_id) {
                const subjectName = (quiz as any)?.teaching_assignment?.subject?.name || ''
                await supabase.from('notifications').insert({
                    user_id: student.user_id,
                    type: 'NILAI_KELUAR',
                    title: `Nilai Keluar: ${quiz.title}`,
                    message: `${subjectName} — Nilai: ${numScore}/100`,
                    link: '/dashboard/siswa/nilai'
                })
            }
        } catch (notifError) {
            console.error('Error sending manual quiz grade notification:', notifError)
        }

        return NextResponse.json(submissionData)
    } catch (error) {
        console.error('Error saving manual quiz grade:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
