import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

// GET: Fetch dashboard data for parent (WALI) user — single child
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'WALI') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Find the child linked to this .wali account
        let child: any = null
        try {
            const { data, error } = await supabase
                .from('students')
                .select(`
                    id,
                    nis,
                    status,
                    gender,
                    angkatan,
                    user:users!students_user_id_fkey(id, full_name, username),
                    class:classes(id, name, grade_level, school_level)
                `)
                .eq('parent_user_id', user.id)
                .eq('status', 'ACTIVE')
                .single()

            if (error) {
                console.error('Error fetching child:', error)
                if (error.message?.includes('parent_user_id')) {
                    return NextResponse.json({
                        child: null,
                        announcements: [],
                        message: 'Kolom parent_user_id belum ada. Jalankan migrasi SQL.'
                    })
                }
            }
            child = data
        } catch (err) {
            console.error('Error querying students:', err)
        }

        // Fetch announcements regardless
        let announcements: any[] = []
        try {
            const { data } = await supabase
                .from('announcements')
                .select('id, title, content, created_at')
                .order('created_at', { ascending: false })
                .limit(5)
            announcements = data || []
        } catch { }

        if (!child) {
            return NextResponse.json({
                child: null,
                announcements,
                message: 'Belum ada anak yang terhubung ke akun Anda.'
            })
        }

        const childId = child.id

        // Fetch assignment grades
        let grades: any[] = []
        try {
            // Filter student_id di SQL (bukan fetch 50 terbaru GLOBAL lalu filter
            // di JS — nilai anak sering tidak ikut ter-fetch). Embed WAJIB !inner:
            // tanpa itu PostgREST mengembalikan grades siswa LAIN dengan submission
            // null (filter embed non-inner hanya menyaring isi embed, bukan baris utama).
            const { data } = await supabase
                .from('grades')
                .select(`
                    id, score, feedback, graded_at,
                    submission:student_submissions!inner(
                        id, student_id,
                        assignment:assignments(
                            id, title,
                            teaching_assignment:teaching_assignments(
                                subject:subjects(id, name)
                            )
                        )
                    )
                `)
                .eq('submission.student_id', childId)
                .order('graded_at', { ascending: false })
                .limit(50)

            grades = (data || [])
                .map((g: any) => ({
                    id: g.id,
                    score: g.score,
                    subject_name: g.submission?.assignment?.teaching_assignment?.subject?.name || '-',
                    assignment_title: g.submission?.assignment?.title || '-',
                    graded_at: g.graded_at
                }))
        } catch (err) {
            console.error('Error fetching grades:', err)
        }

        // Fetch quiz submissions
        let quizzes: any[] = []
        try {
            const { data } = await supabase
                .from('quiz_submissions')
                .select('id, student_id, total_score, max_score, submitted_at, quiz:quizzes(id, title)')
                .eq('student_id', childId)
                .not('submitted_at', 'is', null)
                .order('submitted_at', { ascending: false })
                .limit(20)

            quizzes = (data || []).map((q: any) => ({
                id: q.id,
                title: q.quiz?.title || 'Kuis',
                score: q.max_score > 0 ? Math.round((q.total_score / q.max_score) * 100) : 0,
                total_score: q.total_score,
                max_score: q.max_score,
                completed_at: q.submitted_at
            }))
        } catch (err) {
            console.error('Error fetching quizzes:', err)
        }

        // Fetch exam submissions
        let exams: any[] = []
        try {
            const { data } = await supabase
                .from('exam_submissions')
                .select('id, student_id, total_score, max_score, submitted_at, exam:exams(id, title)')
                .eq('student_id', childId)
                .not('submitted_at', 'is', null)
                .order('submitted_at', { ascending: false })
                .limit(20)

            exams = (data || []).map((e: any) => ({
                id: e.id,
                title: e.exam?.title || 'Ulangan',
                score: e.max_score > 0 ? Math.round((e.total_score / e.max_score) * 100) : 0,
                total_score: e.total_score,
                max_score: e.max_score,
                completed_at: e.submitted_at
            }))
        } catch (err) {
            console.error('Error fetching exams:', err)
        }

        // Fetch assignment submissions
        let submissions: any[] = []
        try {
            const { data } = await supabase
                .from('student_submissions')
                .select('id, student_id, status, submitted_at, created_at, assignment:assignments(id, title, deadline), grade:grades(score)')
                .eq('student_id', childId)
                .order('created_at', { ascending: false })
                .limit(20)

            submissions = (data || []).map((s: any) => ({
                id: s.id,
                title: s.assignment?.title || 'Tugas',
                status: s.status,
                score: Array.isArray(s.grade) && s.grade.length > 0 ? s.grade[0].score : null,
                submitted_at: s.submitted_at,
                deadline: s.assignment?.deadline
            }))
        } catch (err) {
            console.error('Error fetching submissions:', err)
        }

        // Count total assignments for the child's class
        let totalAssignments = 0
        try {
            if (child.class?.id) {
                const { count } = await supabase
                    .from('assignments')
                    .select('id, teaching_assignment:teaching_assignments!inner(class_id)', { count: 'exact', head: true })
                    .eq('teaching_assignment.class_id', child.class.id)

                totalAssignments = count || 0
            }
        } catch (err) {
            console.error('Error counting assignments:', err)
        }

        return NextResponse.json({
            child: {
                ...child,
                grades,
                recentSubmissions: submissions,
                recentQuizzes: quizzes,
                recentExams: exams,
                totalAssignments,
            },
            announcements
        })
    } catch (error) {
        console.error('Error fetching parent dashboard:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
