import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { batchedIn, IN_BATCH_SIZE } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { logError } from '@/lib/logError'
import { canManageOfficialExam, getTeacherScope, coTeachesClassSubject } from '@/lib/teacherScope'
import { validateTargetClassIds } from '@/lib/targetClassValidation'
import { checkOfficialExamDuplicate } from '@/lib/officialExamDuplicateCheck'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'
import { hasStartedSubmissions } from '@/lib/hasSubmissions'

// GET single official exam
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { schoolId } = ctx

        const { data, error } = await supabase
            .from('official_exams')
            .select(`
                *,
                subject:subjects(id, name, kkm),
                academic_year:academic_years(id, name, is_active),
                creator:users!official_exams_created_by_fkey(full_name)
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        // Scope multi-tenant: ujian sekolah lain tidak boleh dibaca
        if (data && schoolId && (data as any).school_id && (data as any).school_id !== schoolId) {
            return NextResponse.json({ error: 'Ujian tidak ditemukan' }, { status: 404 })
        }

        // GURU non-pengampu tidak boleh membaca metadata ujian guru lain
        // (paritas guard GET soal & list /api/official-exams — sebelumnya guru
        // mana pun di sekolah bisa membuka detail ujian via API langsung).
        // Guard baca longgar: mengajar mapel ujian di ≥1 kelas target.
        if (ctx.user && ctx.user.role === 'GURU') {
            const scope = await getTeacherScope(ctx.user.id, data?.academic_year_id ?? null)
            const canRead = !!data && (data.target_class_ids || []).some((cid: string) =>
                coTeachesClassSubject(scope, data.subject_id, cid)
            )
            if (!canRead) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke ujian ini' }, { status: 403 })
            }
        }

        // Resolve target class names
        if (data?.target_class_ids?.length > 0) {
            const { data: classes } = await supabase
                .from('classes')
                .select('id, name, school_level, grade_level')
                .in('id', data.target_class_ids)

            ;(data as any).target_classes = classes || []
        } else {
            ;(data as any).target_classes = []
        }

        // SISWA: jangan bocorkan allowed_student_ids (daftar "siapa yang
        // remedial") — paritas GET /api/exams/[id] & list /api/official-exams;
        // jalur detail ini sebelumnya terlewat (bocor via inspect network).
        if (ctx.user?.role === 'SISWA') {
            delete (data as any).allowed_student_ids
        }

        return NextResponse.json(data)
    } catch (error) {
        logError('Error fetching official exam', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update official exam
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'ADMIN' && user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Kepemilikan: ADMIN hanya di sekolahnya sendiri (tenant guard di
        // canManageOfficialExam); GURU hanya bila mapel & kelas target ujian ini diajarnya
        const { data: examScope } = await supabase
            .from('official_exams')
            .select('subject_id, target_class_ids, academic_year_id, school_id, title, is_remedial')
            .eq('id', id)
            .single()
        if (!examScope || !(await canManageOfficialExam(user, examScope))) {
            return NextResponse.json({ error: 'Anda tidak memiliki akses ke ujian ini' }, { status: 403 })
        }

        // ── Lock settings setelah siswa mulai mengerjakan ──
        // Setelah ada submission dengan started_at (siswa pernah buka ujian),
        // field yang mempengaruhi konsistensi nilai TIDAK boleh diubah.
        // Strategi: silent ignore — field terkunci tidak masuk updateData,
        // field yang aman (title, description, show_results, results_released,
        // is_active) tetap tersimpan. Mencegah "save all at once" break.
        const { hasSubmissions: hasSubs } = await hasStartedSubmissions('official_exam_submissions', id)

        const body = await request.json()
        const {
            title, description, start_time, duration_minutes, window_end_time,
            is_randomized, is_active, max_violations,
            target_class_ids, subject_id, show_results_immediately, results_released,
            force_duplicate
        } = body

        // Field yang di-lock saat ada submission — skip validasi & penulisan.
        // Field yang tetap allow: title, description, show_results_immediately,
        // results_released, is_active.
        const effectiveTargetClassIds = hasSubs ? undefined : target_class_ids
        const effectiveStartTime = hasSubs ? undefined : start_time
        const effectiveDuration = hasSubs ? undefined : duration_minutes
        const effectiveWindowEnd = hasSubs ? undefined : window_end_time
        const effectiveIsRandomized = hasSubs ? undefined : is_randomized
        const effectiveMaxViolations = hasSubs ? undefined : max_violations
        const effectiveSubjectId = hasSubs ? undefined : subject_id

        // Validasi kelas target baru (bila diubah): wajib milik sekolah caller +
        // tahun ajaran exam — paritas guard POST create/duplicate (A1/A2).
        if (effectiveTargetClassIds !== undefined) {
            const { data: examYear } = await supabase
                .from('official_exams')
                .select('academic_year_id')
                .eq('id', id)
                .single()
            const targetValidation = await validateTargetClassIds(effectiveTargetClassIds, ctx.schoolId ?? null, examYear?.academic_year_id ?? null)
            if (!targetValidation.ok) {
                return NextResponse.json({ error: targetValidation.errorMessage }, { status: 400 })
            }
        }

        // Validasi jendela waktu: jam tutup harus setelah jam buka (pakai start_time
        // baru bila ada, jika tidak cek start_time lama di DB)
        if (effectiveWindowEnd) {
            let effectiveStart = effectiveStartTime
            if (!effectiveStart) {
                const { data: cur } = await supabase
                    .from('official_exams')
                    .select('start_time')
                    .eq('id', id)
                    .single()
                effectiveStart = cur?.start_time
            }
            if (effectiveStart && new Date(effectiveWindowEnd) <= new Date(effectiveStart)) {
                return NextResponse.json({ error: 'Jam tutup jendela waktu harus setelah jam buka' }, { status: 400 })
            }
        }

        // Server-side guard: jangan aktifkan ujian tanpa soal
        if (is_active === true) {
            const { count: questionCount } = await supabase
                .from('official_exam_questions')
                .select('id', { count: 'exact', head: true })
                .eq('exam_id', id)
            if (!questionCount || questionCount === 0) {
                return NextResponse.json({ error: 'Tidak bisa mengaktifkan ujian tanpa soal. Tambahkan minimal 1 soal terlebih dahulu.' }, { status: 400 })
            }
        }

        // ── Guard duplikat-judul saat RENAME (paritas PUT /api/exams/[id]) ──
        // Scope: school_id + subject_id + academic_year_id + target_class overlap.
        // Kontrak tahun-scoping: tahun beda = tidak collision. Remedial dikecualikan.
        // force_duplicate = override eksplisit. Hanya cek bila title berubah.
        if (!force_duplicate && !examScope?.is_remedial && title !== undefined) {
            const normNew = (title || '').trim().toLowerCase()
            const normCurrent = (examScope?.title || '').trim().toLowerCase()
            if (normNew && normNew !== normCurrent) {
                const effectiveTargets = (effectiveTargetClassIds !== undefined ? effectiveTargetClassIds : examScope?.target_class_ids) || []
                const dupe = await checkOfficialExamDuplicate({
                    supabase,
                    schoolId: examScope.school_id,
                    subjectId: examScope.subject_id,
                    academicYearId: examScope.academic_year_id,
                    title,
                    targetClassIds: effectiveTargets,
                    excludeId: id,
                })
                if (dupe) {
                    return NextResponse.json({
                        error: 'DUPLICATE_TITLE',
                        existing: {
                            id: dupe.id,
                            title: dupe.title,
                            subjectName: dupe.className,
                            isActive: dupe.isActive,
                            submissionCount: dupe.submissionCount,
                            createdAt: dupe.createdAt,
                        }
                    }, { status: 409 })
                }
            }
        }

        const updateData: any = { updated_at: new Date().toISOString() }
        if (title !== undefined) updateData.title = title
        if (description !== undefined) updateData.description = description
        if (effectiveStartTime !== undefined) updateData.start_time = effectiveStartTime
        if (effectiveDuration !== undefined) updateData.duration_minutes = effectiveDuration
        if (effectiveWindowEnd !== undefined) updateData.window_end_time = effectiveWindowEnd || null
        if (effectiveIsRandomized !== undefined) updateData.is_randomized = effectiveIsRandomized
        if (is_active !== undefined) updateData.is_active = is_active
        if (effectiveMaxViolations !== undefined) updateData.max_violations = effectiveMaxViolations
        if (effectiveTargetClassIds !== undefined) updateData.target_class_ids = effectiveTargetClassIds
        if (effectiveSubjectId !== undefined) updateData.subject_id = effectiveSubjectId
        if (show_results_immediately !== undefined) updateData.show_results_immediately = show_results_immediately
        if (results_released !== undefined) updateData.results_released = results_released

        // Fetch current state to detect the results_released false→true transition
        let wasResultsReleased = false
        if (results_released === true) {
            const { data: currentExam } = await supabase
                .from('official_exams')
                .select('results_released')
                .eq('id', id)
                .single()
            wasResultsReleased = currentExam?.results_released === true
        }

        const { data, error } = await supabase
            .from('official_exams')
            .update(updateData)
            .eq('id', id)
            .select(`
                *,
                subject:subjects(id, name, kkm),
                academic_year:academic_years(id, name)
            `)
            .single()

        if (error) throw error

        // Catatan: official_exams TIDAK punya kolom batch_id (UTS/UAS pakai
        // target_class_ids — 1 exam untuk multi-kelas, otomatis seragam).
        // Propagasi batch hanya relevan untuk exams (ulangan) — lihat
        // PATCH /api/exams/[id]. Jangan tambahkan blok propagasi di sini
        // kecuali official_exams someday mendapat kolom batch_id.

        // If just activated, send notifications to all target students and teachers
        if (is_active === true && data) {
            try {
                const { data: activeYear } = await supabase
                    .from('academic_years')
                    .select('id')
                    .eq('is_active', true)
                    .eq('school_id', data.school_id)
                    .single()

                if (activeYear && data.target_class_ids?.length > 0) {
                    const isFuture = new Date(data.start_time) > new Date()
                    const startDate = new Date(data.start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
                    const labels = await getMenuLabelsForSchool(data.school_id)
                    const examLabel = data.exam_type === 'UTS' ? labels.uts : labels.uas
                    const subjectName = (data as any).subject?.name || ''

                    // 1. Student Notifications
                    // fetchAllRows: UTS seangkatan/sekolah bisa >1000 enrollment — query
                    // biasa terpotong diam-diam dan sebagian siswa tidak dinotifikasi.
                    // .order('id') wajib: paginasi tanpa order stabil dobel/melewatkan
                    // baris intermitten (siswa terlewat dari notifikasi).
                    const enrollments = await fetchAllRows(
                        supabase
                            .from('student_enrollments')
                            .select('student:students(user_id)')
                            .eq('academic_year_id', activeYear.id)
                            .in('class_id', data.target_class_ids)
                            .order('id')
                    )

                    if (enrollments && enrollments.length > 0) {
                        const studentTitle = isFuture 
                            ? `📅 ${examLabel} Dijadwalkan: ${data.title}`
                            : `🔔 ${examLabel} Sekarang Aktif: ${data.title}`
                        const studentMessage = isFuture
                            ? `${subjectName} — Dimulai pada: ${startDate}`
                            : `${subjectName} — Silakan kerjakan pada: ${startDate}`

                        const userIds = enrollments.map((e: any) => e.student.user_id).filter(Boolean)
                        // batchedIn: ratusan–1088 user id dalam satu .in() overflow URL
                        const existingNotifs = await batchedIn<{ user_id: string }>(
                            'user_id', userIds,
                            (chunk) => supabase
                                .from('notifications')
                                .select('user_id')
                                .in('user_id', chunk)
                                .eq('title', studentTitle)
                                .eq('type', 'UJIAN_RESMI')
                        )

                        const alreadyNotified = new Set((existingNotifs || []).map((n: any) => n.user_id))
                        const toNotify = userIds.filter((uid: string) => !alreadyNotified.has(uid))

                        if (toNotify.length > 0) {
                            await supabase.from('notifications').insert(
                                toNotify.map((uid: string) => ({
                                    user_id: uid,
                                    type: 'UJIAN_RESMI',
                                    title: studentTitle,
                                    message: studentMessage,
                                    link: '/dashboard/siswa/ulangan'
                                }))
                            )
                        }
                    }

                    // 2. Teacher Notifications
                    const { data: teacherAssignments } = await supabase
                        .from('teaching_assignments')
                        .select('teacher:teachers(user_id)')
                        .eq('subject_id', data.subject_id)
                        .in('class_id', data.target_class_ids)
                        .eq('academic_year_id', activeYear.id)

                    if (teacherAssignments && teacherAssignments.length > 0) {
                        const teacherTitle = isFuture
                            ? `📋 ${examLabel} Dijadwalkan: ${data.title}`
                            : `🔔 ${examLabel} Dimulai: ${data.title}`
                        const teacherMessage = isFuture
                            ? `${subjectName} — Admin menjadwalkan ujian kelas Anda pada: ${startDate}`
                            : `${subjectName} — Siswa diijinkan mulai mengerjakan ujian.`

                        const teacherUserIds = [...new Set(
                            teacherAssignments.map((a: any) => {
                                const t = Array.isArray(a.teacher) ? a.teacher[0] : a.teacher
                                return t?.user_id
                            }).filter(Boolean)
                        )]

                        const { data: existingTeacherNotifs } = await supabase
                            .from('notifications')
                            .select('user_id')
                            .in('user_id', teacherUserIds)
                            .eq('title', teacherTitle)
                            .eq('type', 'UJIAN_RESMI')

                        const alreadyNotifiedTeachers = new Set(
                            (existingTeacherNotifs || []).map((n: any) => n.user_id)
                        )
                        const teachersToNotify = teacherUserIds.filter(
                            uid => !alreadyNotifiedTeachers.has(uid)
                        )

                        if (teachersToNotify.length > 0) {
                            await supabase.from('notifications').insert(
                                teachersToNotify.map(uid => ({
                                    user_id: uid,
                                    type: 'UJIAN_RESMI',
                                    title: teacherTitle,
                                    message: teacherMessage,
                                    link: '/dashboard/guru/ulangan'
                                }))
                            )
                        }
                    }
                }
            } catch (notifError) {
                console.error('Error sending official exam notifications:', notifError)
            }
        }

        // Notify target students when results are released ("Bagikan Hasil" — false→true transition only)
        if (results_released === true && !wasResultsReleased && data?.target_class_ids?.length > 0) {
            try {
                const { data: activeYear } = await supabase
                    .from('academic_years')
                    .select('id')
                    .eq('is_active', true)
                    .eq('school_id', data.school_id)
                    .single()

                if (activeYear) {
                    // fetchAllRows: sama seperti notif aktivasi — roster >1000 terpotong
                    // diam-diam. .order('id') wajib: paginasi tanpa order stabil
                    // dobel/melewatkan baris intermitten (siswa terlewat).
                    const enrollments = await fetchAllRows(
                        supabase
                            .from('student_enrollments')
                            .select('student:students(user_id)')
                            .eq('academic_year_id', activeYear.id)
                            .in('class_id', data.target_class_ids)
                            .order('id')
                    )

                    const userIds = [...new Set(
                        (enrollments || []).map((e: any) => (Array.isArray(e.student) ? e.student[0]?.user_id : e.student?.user_id)).filter(Boolean)
                    )] as string[]

                    if (userIds.length > 0) {
                        const labels = await getMenuLabelsForSchool(data.school_id)
                        const examLabel = data.exam_type === 'UTS' ? labels.uts : labels.uas
                        const subjectName = (data as any).subject?.name || ''
                        await supabase.from('notifications').insert(
                            userIds.map(uid => ({
                                user_id: uid,
                                type: 'NILAI_KELUAR',
                                title: `Nilai Keluar: ${data.title}`,
                                message: `${examLabel} ${subjectName} — Hasil ujian sudah bisa dilihat`,
                                link: '/dashboard/siswa/ulangan'
                            }))
                        )
                    }
                }
            } catch (notifError) {
                console.error('Error sending results-released notifications:', notifError)
            }
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating official exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE official exam
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'ADMIN' && user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Kepemilikan: ADMIN hanya di sekolahnya sendiri (tenant guard di
        // canManageOfficialExam); GURU hanya boleh hapus ujian resmi pada mapel & kelas yang diajarnya
        {
            const { data: examScope } = await supabase
                .from('official_exams')
                .select('subject_id, target_class_ids, academic_year_id, school_id')
                .eq('id', id)
                .single()
            if (!examScope || !(await canManageOfficialExam(user, examScope))) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke ujian ini' }, { status: 403 })
            }
        }

        // Cascade: delete related records first (foreign key constraints)
        // 1. Delete submission answers. fetchAllRows: UTS sekolah bisa >1000 submissions
        //    (query biasa terpotong diam-diam); delete di-batch per 100 id karena satu
        //    .in() dengan ribuan id overflow URL. Error TIDAK boleh ditelan — answers
        //    yang tersisa membuat delete submissions gagal (FK constraint).
        //    .order('id') wajib: submission terlewat oleh paginasi tak stabil =
        //    answers orphan → delete submissions gagal FK → ujian setengah terhapus.
        const subs = await fetchAllRows<{ id: string }>(
            supabase
                .from('official_exam_submissions')
                .select('id')
                .eq('exam_id', id)
                .order('id')
        )
        const subIds = subs.map(s => s.id)
        for (let i = 0; i < subIds.length; i += IN_BATCH_SIZE) {
            const { error: answersError } = await supabase
                .from('official_exam_answers')
                .delete()
                .in('submission_id', subIds.slice(i, i + IN_BATCH_SIZE))
            if (answersError) throw answersError
        }

        // 2. Delete submissions
        const { error: submissionsError } = await supabase
            .from('official_exam_submissions')
            .delete()
            .eq('exam_id', id)
        if (submissionsError) throw submissionsError

        // 3. Delete questions
        const { error: questionsError } = await supabase
            .from('official_exam_questions')
            .delete()
            .eq('exam_id', id)
        if (questionsError) throw questionsError

        // 4. Delete the exam itself
        const { error } = await supabase
            .from('official_exams')
            .delete()
            .eq('id', id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting official exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
