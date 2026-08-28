import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { batchedIn } from '@/lib/batchedIn'

export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Run all diagnostic checks in parallel (scoped to school)
        const schoolFilter = (query: any) => schoolId ? query.eq('school_id', schoolId) : query

        // fetchAllRows untuk tabel yang bisa >1000 baris (sekolah besar: 1088+
        // siswa, ribuan sesi/submissions) — query biasa terpotong diam-diam
        // sehingga statistik & check diagnostik salah. .order('id') wajib agar
        // paginasi range-loop stabil (tanpa order bisa skip/duplikat baris).
        const [
            users,
            students,
            teachers,
            sessionsResult,
            orphanStudentsResult,
            orphanTeachersResult,
            emptyQuizzesResult,
            emptyExamsResult,
            classesResult,
            noClassStudentsResult,
            academicYearsResult,
        ] = await Promise.all([
            // Total users by role (scoped)
            fetchAllRows(schoolFilter(supabase.from('users').select('id, role')).order('id')),
            // Total students (scoped)
            fetchAllRows(schoolFilter(supabase.from('students').select('id, user_id, class_id, status')).order('id')),
            // Total teachers (scoped)
            fetchAllRows(schoolFilter(supabase.from('teachers').select('id, user_id')).order('id')),
            // Active sessions (join through users for school scope)
            fetchAllRows(supabase.from('sessions').select('id, expires_at, user:users!inner(school_id)')
                .eq('users.school_id', schoolId || '').order('id')),
            // Orphaned students (scoped)
            fetchAllRows(schoolFilter(supabase.from('students').select('id, user_id, user:users!students_user_id_fkey(id)')).order('id')),
            // Orphaned teachers (scoped)
            fetchAllRows(schoolFilter(supabase.from('teachers').select('id, user_id, user:users(id)')).order('id')),
            // Quizzes with no questions (chain-filtered via TA → academic_year)
            supabase.from('quizzes').select('id, title, quiz_questions(id), teaching_assignment:teaching_assignments!inner(academic_year:academic_years!inner(school_id))').eq('is_active', true).eq('teaching_assignments.academic_years.school_id', schoolId || ''),
            // Exams with no questions (similar chain)
            supabase.from('exams').select('id, title, exam_questions(id), teaching_assignment:teaching_assignments!inner(academic_year:academic_years!inner(school_id))').eq('is_active', true).eq('teaching_assignments.academic_years.school_id', schoolId || ''),
            // Classes (scoped via academic year)
            supabase.from('classes').select('id, name, academic_year:academic_years!inner(school_id)').eq('academic_years.school_id', schoolId || ''),
            // Students without class (scoped)
            schoolFilter(supabase.from('students').select('id').is('class_id', null).eq('status', 'ACTIVE')),
            // Academic years (scoped) — kolomnya `name`, bukan `year`
            schoolFilter(supabase.from('academic_years').select('id, name, is_active')),
        ])

        const now = new Date()

        // Ungraded submissions (scoped via assignment → TA → academic year).
        // student_submissions TIDAK punya kolom graded_at. Anti-join "belum dinilai"
        // tidak bisa lewat embed filter (PostgREST tidak memfilter baris utama dari
        // embed non-inner), jadi dihitung dua langkah: submissions sekolah ini
        // dikurangi yang sudah punya baris grades.
        const schoolSubmissions = await fetchAllRows<{ id: string }>(supabase
            .from('student_submissions')
            .select('id, assignment:assignments!inner(teaching_assignment:teaching_assignments!inner(academic_year:academic_years!inner(school_id)))')
            .eq('assignments.teaching_assignments.academic_years.school_id', schoolId || '')
            .order('id'))
        const gradedIds = new Set<string>()
        if (schoolSubmissions.length > 0) {
            const gradedRows = await batchedIn<{ submission_id: string }>(
                'submission_id',
                schoolSubmissions.map(s => s.id),
                (chunk) => supabase.from('grades').select('submission_id').in('submission_id', chunk)
            )
            for (const g of gradedRows) gradedIds.add(g.submission_id)
        }
        const ungradedSubmissionsResult = schoolSubmissions.filter(s => !gradedIds.has(s.id))

        const sessions = sessionsResult || []
        const expiredSessions = sessions.filter((s: any) => new Date(s.expires_at) < now)
        const activeSessions = sessions.filter((s: any) => new Date(s.expires_at) >= now)

        // Count orphaned records
        const orphanStudents = (orphanStudentsResult || []).filter((s: any) => !s.user)
        const orphanTeachers = (orphanTeachersResult || []).filter((t: any) => !t.user)

        // Empty quizzes/exams (active but no questions)
        const emptyQuizzes = (emptyQuizzesResult.data || []).filter((q: any) => !q.quiz_questions || q.quiz_questions.length === 0)
        const emptyExams = (emptyExamsResult.data || []).filter((e: any) => !e.exam_questions || e.exam_questions.length === 0)

        // User stats
        const adminCount = users.filter((u: any) => u.role === 'ADMIN').length
        const guruCount = users.filter((u: any) => u.role === 'GURU').length
        const siswaCount = users.filter((u: any) => u.role === 'SISWA').length
        const waliCount = users.filter((u: any) => u.role === 'WALI').length
        const noRoleCount = users.filter((u: any) => !u.role).length

        const diagnostics = {
            timestamp: now.toISOString(),
            status: 'ok' as string,
            checks: [
                {
                    id: 'db_connection',
                    name: 'Koneksi Database',
                    status: users.length > 0 ? 'healthy' : 'error',
                    message: users.length > 0 ? 'Database terhubung' : 'Gagal terhubung ke database',
                    severity: users.length > 0 ? 'success' : 'critical',
                },
                {
                    id: 'expired_sessions',
                    name: 'Sesi Kadaluarsa',
                    status: expiredSessions.length === 0 ? 'healthy' : 'warning',
                    message: expiredSessions.length === 0
                        ? 'Tidak ada sesi kadaluarsa'
                        : `${expiredSessions.length} sesi sudah kadaluarsa dan perlu dibersihkan`,
                    count: expiredSessions.length,
                    severity: expiredSessions.length > 50 ? 'warning' : 'info',
                    fixable: true,
                    fixAction: 'clean_sessions',
                },
                {
                    id: 'orphan_students',
                    name: 'Siswa Tanpa Akun User',
                    status: orphanStudents.length === 0 ? 'healthy' : 'warning',
                    message: orphanStudents.length === 0
                        ? 'Semua data siswa memiliki akun user'
                        : `${orphanStudents.length} record siswa tidak memiliki akun user terkait`,
                    count: orphanStudents.length,
                    severity: orphanStudents.length > 0 ? 'warning' : 'success',
                    fixable: true,
                    fixAction: 'remove_orphan_students',
                },
                {
                    id: 'orphan_teachers',
                    name: 'Guru Tanpa Akun User',
                    status: orphanTeachers.length === 0 ? 'healthy' : 'warning',
                    message: orphanTeachers.length === 0
                        ? 'Semua data guru memiliki akun user'
                        : `${orphanTeachers.length} record guru tidak memiliki akun user terkait`,
                    count: orphanTeachers.length,
                    severity: orphanTeachers.length > 0 ? 'warning' : 'success',
                    fixable: true,
                    fixAction: 'remove_orphan_teachers',
                },
                {
                    id: 'empty_quizzes',
                    name: 'Kuis Aktif Tanpa Soal',
                    status: emptyQuizzes.length === 0 ? 'healthy' : 'warning',
                    message: emptyQuizzes.length === 0
                        ? 'Semua kuis aktif memiliki soal'
                        : `${emptyQuizzes.length} kuis aktif tidak memiliki soal: ${emptyQuizzes.map((q: any) => q.title).join(', ')}`,
                    count: emptyQuizzes.length,
                    severity: emptyQuizzes.length > 0 ? 'warning' : 'success',
                },
                {
                    id: 'empty_exams',
                    name: 'Ulangan Aktif Tanpa Soal',
                    status: emptyExams.length === 0 ? 'healthy' : 'warning',
                    message: emptyExams.length === 0
                        ? 'Semua ulangan aktif memiliki soal'
                        : `${emptyExams.length} ulangan aktif tidak memiliki soal: ${emptyExams.map((e: any) => e.title).join(', ')}`,
                    count: emptyExams.length,
                    severity: emptyExams.length > 0 ? 'warning' : 'success',
                },
                {
                    id: 'ungraded_submissions',
                    name: 'Tugas Belum Dinilai',
                    status: (ungradedSubmissionsResult?.length || 0) === 0 ? 'healthy' : 'info',
                    message: (ungradedSubmissionsResult?.length || 0) === 0
                        ? 'Semua tugas sudah dinilai'
                        : `${ungradedSubmissionsResult?.length} tugas menunggu penilaian guru`,
                    count: ungradedSubmissionsResult?.length || 0,
                    severity: 'info',
                },
                {
                    id: 'no_class_students',
                    name: 'Siswa Tanpa Kelas',
                    status: (noClassStudentsResult.data?.length || 0) === 0 ? 'healthy' : 'warning',
                    message: (noClassStudentsResult.data?.length || 0) === 0
                        ? 'Semua siswa aktif sudah memiliki kelas'
                        : `${noClassStudentsResult.data?.length} siswa aktif belum ditempatkan di kelas`,
                    count: noClassStudentsResult.data?.length || 0,
                    severity: (noClassStudentsResult.data?.length || 0) > 0 ? 'warning' : 'success',
                },
                {
                    id: 'no_role_users',
                    name: 'User Tanpa Role',
                    status: noRoleCount === 0 ? 'healthy' : 'warning',
                    message: noRoleCount === 0
                        ? 'Semua user memiliki role'
                        : `${noRoleCount} user tidak memiliki role/peran`,
                    count: noRoleCount,
                    severity: noRoleCount > 0 ? 'warning' : 'success',
                },
            ],
            stats: {
                totalUsers: users.length,
                admin: adminCount,
                guru: guruCount,
                siswa: siswaCount,
                wali: waliCount,
                totalStudents: students.length,
                totalTeachers: teachers.length,
                totalClasses: classesResult.data?.length || 0,
                activeSessions: activeSessions.length,
                activeAcademicYear: (academicYearsResult.data || []).find((y: any) => y.is_active)?.name || 'Tidak ada',
            },
        }

        // Set overall status
        const hasCritical = diagnostics.checks.some(c => c.severity === 'critical')
        const hasWarning = diagnostics.checks.some(c => c.severity === 'warning')
        diagnostics.status = hasCritical ? 'critical' : hasWarning ? 'warning' : 'ok'

        return NextResponse.json(diagnostics)
    } catch (error) {
        console.error('Diagnostics error:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
