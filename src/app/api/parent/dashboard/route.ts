import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'
import { mergeRemedialScores } from '@/lib/remedialScore'

/**
 * Gabungkan entri asli + remedial per ujian dasar (kebijakan HIGHEST/AVERAGE/CAP)
 * untuk feed "Terbaru" wali — 1 entri per ujian dengan skor final, completed_at
 * dari pengerjaan terakhir. Tanpa ini rata-rata wali menghitung remedial 2x.
 */
function mergeRecentRemedial(entries: any[]): any[] {
    const groups = new Map<string, any[]>()
    for (const e of entries) {
        const key = String(e.baseId)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(e)
    }
    const out: any[] = []
    groups.forEach(group => {
        const original = group.find(e => !e.isRemedial) || group[0]
        const remedial = group.find(e => e.isRemedial)
        const final = mergeRemedialScores(group.map(e => ({ score: e.score, isRemedial: e.isRemedial, policy: e.policy, cap: e.cap })))
        const finalScore = final !== null ? final : original.score
        out.push({
            ...original,
            score: Math.round(finalScore),
            total_score: Math.round(finalScore / 100 * (original.max_score || 100) * 10) / 10,
            completed_at: (remedial ?? original).completed_at,
        })
    })
    // Urut ulang berdasar completed_at hasil merge (terbaru dulu)
    out.sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())
    return out
}

// GET: Fetch dashboard data for parent (WALI) user — single child
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'WALI') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const labels = await getMenuLabelsForSchool(schoolId)

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
            let annQuery = supabase
                .from('announcements')
                .select('id, title, content, created_at')
                .order('created_at', { ascending: false })
                .limit(5)
            // Tenant guard: pengumuman sekolah caller saja
            if (schoolId) annQuery = annQuery.eq('school_id', schoolId)
            const { data } = await annQuery
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

        // Fetch quiz submissions — remedial di-merge per kuis dasar sesuai
        // kebijakan (HIGHEST/AVERAGE/CAP) supaya "Rata² Kuis" orang tua tidak
        // menghitung remedial dua kali. Fetch lebih banyak (60) sebagai jendela
        // merge — pasangan asli/remedial bisa terpisah jauh di urutan waktu.
        let quizzes: any[] = []
        try {
            const { data } = await supabase
                .from('quiz_submissions')
                .select('id, student_id, total_score, max_score, submitted_at, quiz:quizzes(id, title, is_remedial, remedial_for_id, remedial_score_policy, remedial_max_score)')
                .eq('student_id', childId)
                .not('submitted_at', 'is', null)
                .order('submitted_at', { ascending: false })
                .limit(60)

            quizzes = mergeRecentRemedial((data || []).map((q: any) => ({
                id: q.id,
                title: q.quiz?.title || labels.kuis,
                baseId: q.quiz?.remedial_for_id || q.quiz?.id,
                isRemedial: !!q.quiz?.is_remedial,
                policy: q.quiz?.remedial_score_policy,
                cap: q.quiz?.remedial_max_score,
                score: q.max_score > 0 ? (q.total_score / q.max_score) * 100 : 0,
                total_score: q.total_score,
                max_score: q.max_score,
                completed_at: q.submitted_at
            }))).slice(0, 20)
        } catch (err) {
            console.error('Error fetching quizzes:', err)
        }

        // Fetch exam submissions — merge remedial, pola sama dengan kuis.
        let exams: any[] = []
        try {
            const { data } = await supabase
                .from('exam_submissions')
                .select('id, student_id, total_score, max_score, submitted_at, exam:exams(id, title, is_remedial, remedial_for_id, remedial_score_policy, remedial_max_score)')
                .eq('student_id', childId)
                .not('submitted_at', 'is', null)
                .order('submitted_at', { ascending: false })
                .limit(60)

            exams = mergeRecentRemedial((data || []).map((e: any) => ({
                id: e.id,
                title: e.exam?.title || labels.ulangan,
                baseId: e.exam?.remedial_for_id || e.exam?.id,
                isRemedial: !!e.exam?.is_remedial,
                policy: e.exam?.remedial_score_policy,
                cap: e.exam?.remedial_max_score,
                score: e.max_score > 0 ? (e.total_score / e.max_score) * 100 : 0,
                total_score: e.total_score,
                max_score: e.max_score,
                completed_at: e.submitted_at
            }))).slice(0, 20)
        } catch (err) {
            console.error('Error fetching exams:', err)
        }

        // Fetch assignment submissions
        // (kolom status/created_at tidak ada di student_submissions; deadline -> due_date)
        let submissions: any[] = []
        try {
            const { data } = await supabase
                .from('student_submissions')
                .select('id, student_id, submitted_at, assignment:assignments(id, title, due_date), grade:grades(score)')
                .eq('student_id', childId)
                .order('submitted_at', { ascending: false })
                .limit(20)

            submissions = (data || []).map((s: any) => ({
                id: s.id,
                title: s.assignment?.title || labels.tugas,
                status: 'SUBMITTED', // semua baris di query ini memang sudah terkumpul
                score: Array.isArray(s.grade) && s.grade.length > 0 ? s.grade[0].score : null,
                submitted_at: s.submitted_at,
                deadline: s.assignment?.due_date
            }))
        } catch (err) {
            console.error('Error fetching submissions:', err)
        }

        // Count total assignments for the child's class
        // (kecuali kolom penilaian offline — bukan tugas yang dikumpulkan siswa)
        let totalAssignments = 0
        try {
            if (child.class?.id) {
                const { count } = await supabase
                    .from('assignments')
                    .select('id, teaching_assignment:teaching_assignments!inner(class_id)', { count: 'exact', head: true })
                    .eq('teaching_assignment.class_id', child.class.id)
                    .neq('submission_mode', 'OFFLINE')

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
