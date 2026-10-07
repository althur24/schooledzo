import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { syncQuizBatch } from '@/lib/examBatch'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound, resolveQuizSchoolId, findQuizzesOutsideSchool } from '@/lib/tenantGuard'

import { isAIReviewEnabled } from '@/lib/triggerHOTS'
import { gkMaxPicks } from '@/lib/questionTypeUtils'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'
import { getTeacherScope, ownsTeachingAssignment, coTeachesClassSubject } from '@/lib/teacherScope'

// GET single quiz with questions
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const { data, error } = await supabase
            .from('quizzes')
            .select(`
                *,
                teaching_assignment:teaching_assignments(
                    id,
                    teacher_id,
                    subject_id,
                    class_id,
                    academic_year_id,
                    teacher:teachers(id, user:users(full_name)),
                    subject:subjects(id, name),
                    class:classes(id, name, school_level, grade_level),
                    academic_year:academic_years(id, name, school_id)
                ),
                questions:quiz_questions(*)
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        // Tenant guard: kuis harus milik sekolah caller (IDOR lintas sekolah)
        if (tenantMismatch((data?.teaching_assignment as any)?.academic_year?.school_id, schoolId)) {
            return notFound()
        }

        // Halaman siswa memuat soal dari endpoint ini (embed questions) —
        // guard paritas /api/quizzes/[id]/questions & /api/exams/[id]/questions:
        // siswa luar kelas tidak boleh membaca soal, dan soal hanya boleh dibaca
        // saat kuis aktif & sudah dibuka. Pengecualian attempt (resume/hasil).
        const taEmbed = data?.teaching_assignment
        const taCtx = Array.isArray(taEmbed) ? taEmbed[0] : taEmbed
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students')
                .select('id, class_id')
                .eq('user_id', user.id)
                .single()

            if (!student || !taCtx?.class_id || student.class_id !== taCtx.class_id) {
                return notFound()
            }

            const { data: mySubmission } = await supabase
                .from('quiz_submissions')
                .select('id')
                .eq('quiz_id', id)
                .eq('student_id', student.id)
                .limit(1)
            const hasAttempt = (mySubmission || []).length > 0
            const started = data.available_from ? new Date(data.available_from).getTime() <= Date.now() : true
            if (!hasAttempt && (!data.is_active || !started)) {
                return NextResponse.json({ error: 'Kuis belum tersedia' }, { status: 403 })
            }
        }

        // GURU non-pemilik tidak boleh membaca detail + soal kuis guru lain
        // (embed questions menyertakan correct_answer untuk guru). Co-teacher
        // (mapel+kelas sama) tetap boleh — paritas guard /questions & PUT.
        if (user.role === 'GURU') {
            const scope = await getTeacherScope(user.id, taCtx?.academic_year_id ?? null)
            if (!ownsTeachingAssignment(scope, taCtx?.teacher_id) && !coTeachesClassSubject(scope, taCtx?.subject_id, taCtx?.class_id)) {
                return notFound()
            }
        }

        // Sort questions by order_index
        if (data.questions) {
            data.questions.sort((a: any, b: any) => a.order_index - b.order_index)
        }

        // C1 Security Fix (parity dgn route /questions): strip kunci jawaban untuk siswa
        // yang belum mengumpulkan — halaman pengerjaan kuis memuat soal dari endpoint ini.
        if (user.role === 'SISWA' && data.questions) {
            // Jangan bocorkan daftar siswa remedial (siapa yang gagal) ke sekelasnya
            delete (data as any).allowed_student_ids

            const { data: student } = await supabase
                .from('students')
                .select('id')
                .eq('user_id', user.id)
                .single()

            let hasSubmitted = false
            if (student) {
                const { data: submission } = await supabase
                    .from('quiz_submissions')
                    .select('submitted_at')
                    .eq('quiz_id', id)
                    .eq('student_id', student.id)
                    .single()
                hasSubmitted = !!submission?.submitted_at
            }

            if (!hasSubmitted) {
                // Batas pilihan GK = jumlah kunci — dihitung SEBELUM kunci di-strip;
                // hanya jumlahnya yang dikirim (kunci tidak bocor). UI siswa memblokir
                // pilihan ke-(N+1) supaya over-pick tidak mungkin.
                data.questions = data.questions.map(({ correct_answer, ...rest }: any) => {
                    const cap = gkMaxPicks(rest.question_type, correct_answer)
                    return cap ? { ...rest, gk_max_picks: cap } : rest
                })
            }
        }

        // Sibling batch (kelas paralel) — sumber definitif blok "Kelas Paralel"
        // di modal Pengaturan kuis. A4-parity dengan GET /api/exams/[id]: untuk
        // GURU, hanya sibling kelas+mapel yang dia ampu (co-teacher parsial tidak
        // boleh melihat kelas yang bukan haknya — tombol × di UI hanya muncul
        // untuk member yang bisa dihapus). Tenant guard: buang sibling sekolah
        // lain. SISWA: tidak diberi sibling (bukan informasinya — paritas exam).
        let batchSiblings: { id: string; class_id: string | null; class_name: string }[] = []
        if (data?.batch_id && user.role !== 'SISWA') {
            const { data: siblings } = await supabase
                .from('quizzes')
                .select('id, teaching_assignment:teaching_assignments(subject_id, class:classes(id, name))')
                .eq('batch_id', data.batch_id)
                .neq('id', id)
            // A4: untuk GURU, filter sibling yang tidak dia ampu
            let pairs: Set<string> | null = null
            if (user.role === 'GURU') {
                const { data: teacher } = await supabase
                    .from('teachers')
                    .select('id')
                    .eq('user_id', user.id)
                    .single()
                if (teacher) {
                    const { data: myTAs } = await supabase
                        .from('teaching_assignments')
                        .select('subject_id, class_id')
                        .eq('teacher_id', teacher.id)
                    pairs = new Set((myTAs || []).map((ta: { subject_id: string; class_id: string }) => `${ta.subject_id}|${ta.class_id}`))
                }
            }
            // Tenant guard: buang sibling milik sekolah lain
            const siblingIds = (siblings || []).map((s: { id: string }) => s.id)
            const outsideIds = new Set(siblingIds.length > 0
                ? await findQuizzesOutsideSchool(siblingIds, schoolId)
                : [])
            type SiblingTa = { subject_id: string; class?: { id: string; name: string } | { id: string; name: string }[] }
            type SiblingRow = { id: string; teaching_assignment?: SiblingTa | SiblingTa[] }
            const normTa = (s: SiblingRow): SiblingTa | undefined =>
                Array.isArray(s.teaching_assignment) ? s.teaching_assignment[0] : s.teaching_assignment
            const normCls = (ta?: SiblingTa): { id?: string; name?: string } | undefined =>
                Array.isArray(ta?.class) ? ta.class[0] : ta?.class
            batchSiblings = (siblings || [] as SiblingRow[])
                .filter((s: SiblingRow) => !outsideIds.has(s.id))
                .map((s: SiblingRow) => {
                    const ta = normTa(s)
                    const cls = normCls(ta)
                    return { id: s.id, subject_id: ta?.subject_id, class_id: cls?.id || null, class_name: cls?.name || '-' }
                })
                .filter((s: { subject_id?: string; class_id: string | null }) => !pairs || pairs.has(`${s.subject_id}|${s.class_id}`))
                .map(({ subject_id, ...rest }: { id: string; subject_id?: string; class_id: string | null; class_name: string }) => rest)
        }

        return NextResponse.json({ ...data, batch_siblings: batchSiblings })
    } catch (error) {
        console.error('Error fetching quiz:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update quiz
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()
            
            const { data: quiz } = await supabase
                .from('quizzes')
                .select('teaching_assignment:teaching_assignments(teacher_id)')
                .eq('id', id)
                .single()
            
            if (!teacher || (quiz?.teaching_assignment as any)?.teacher_id !== teacher.id) {
                const labels = await getMenuLabelsForSchool(schoolId)
                return NextResponse.json({ error: `Anda tidak memiliki akses ke ${labels.kuis.toLowerCase()} ini` }, { status: 403 })
            }
        } else if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Tenant guard: kuis harus milik sekolah caller (ADMIN dulu lolos tanpa cek)
        if (tenantMismatch(await resolveQuizSchoolId(id), schoolId)) {
            return notFound()
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: quizForYear } = await supabase
            .from('quizzes')
            .select('teaching_assignment_id, deadline, available_from, is_active, is_remedial, batch_id, teaching_assignment:teaching_assignments(teacher_id, subject_id, class_id, academic_year_id)')
            .eq('id', id)
            .single()
        if (quizForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(quizForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }
        // is_active SEBELUM update — dipakai untuk membedakan publish pertama
        // (kirim notifikasi) vs re-PUT kuis yang sudah aktif (jangan spam notifikasi).
        const wasActive = quizForYear?.is_active === true
        const labels = await getMenuLabelsForSchool(schoolId)

        const body = await request.json()
        const { title, description, duration_minutes, is_randomized, is_active, deadline, available_from, batch_id } = body

        // Validasi jendela waktu kuis: deadline harus setelah jam buka
        if (deadline || available_from) {
            const effectiveOpen = available_from !== undefined ? (available_from || null) : quizForYear?.available_from
            const effectiveDeadline = deadline !== undefined ? (deadline || null) : quizForYear?.deadline
            if (effectiveOpen && effectiveDeadline && new Date(effectiveDeadline) <= new Date(effectiveOpen)) {
                return NextResponse.json({ error: 'Batas waktu (deadline) harus setelah jam buka' }, { status: 400 })
            }
        }

        let finalIsActive = is_active
        let finalPendingPublish = false

        // If trying to publish, check question statuses first
        if (is_active === true) {
            const aiEnabled = await isAIReviewEnabled(schoolId)

            const { data: questions } = await supabase
                .from('quiz_questions')
                .select('id, status')
                .eq('quiz_id', id)

            if (!questions || questions.length === 0) {
                return NextResponse.json({ error: `Tidak bisa mempublikasikan ${labels.kuis.toLowerCase()} tanpa soal. Tambahkan minimal 1 soal terlebih dahulu.` }, { status: 400 })
            }
            if (questions.length > 0) {
                if (!aiEnabled) {
                    // AI Review OFF — auto-approve any non-approved questions
                    const nonApproved = questions.filter(q => q.status !== 'approved')
                    if (nonApproved.length > 0) {
                        await supabase.from('quiz_questions')
                            .update({ status: 'approved' })
                            .in('id', nonApproved.map(q => q.id))
                    }
                } else {
                    // AI Review ON — block publish while questions are still processing or returned.
                    // (The previous "auto-recover stuck after 3 min" used updated_at, which doesn't
                    //  exist on quiz_questions and isn't written by any status update, so it never
                    //  worked. Admin can move a truly-stuck question to admin_review manually.)
                    // Check statuses
                    const statuses = {
                        draft: questions.filter(q => q.status === 'draft').length,
                        ai_reviewing: questions.filter(q => q.status === 'ai_reviewing').length,
                        admin_review: questions.filter(q => q.status === 'admin_review').length,
                        returned: questions.filter(q => q.status === 'returned').length,
                        approved: questions.filter(q => q.status === 'approved').length,
                    }
                    
                    const stillProcessing = statuses.draft + statuses.ai_reviewing
                    const returned = statuses.returned
                    const needsReview = statuses.admin_review
                    
                    if (stillProcessing > 0 || returned > 0) {
                        const parts: string[] = []
                        if (stillProcessing > 0)
                            parts.push(`${stillProcessing} soal masih diproses AI`)
                        if (returned > 0)
                            parts.push(`${returned} soal dikembalikan admin`)
                        
                        return NextResponse.json({
                            error: `Gagal mempublikasikan: ${parts.join(', ')}. Perbaiki atau tunggu proses AI selesai sebelum mempublikasikan.`,
                            _status: 'blocked',
                            statusBreakdown: statuses
                        }, { status: 400 })
                    }
                    
                    if (needsReview > 0) {
                        // Publish requested, but needs admin review.
                        finalIsActive = false
                        finalPendingPublish = true
                    }
                }
            }
        }

        // Construct update object dynamically to avoid overwriting with null/undefined
        const updateData: any = {
            updated_at: new Date().toISOString()
        }

        if (title !== undefined) updateData.title = title
        if (description !== undefined) updateData.description = description
        if (duration_minutes !== undefined) updateData.duration_minutes = duration_minutes
        if (is_randomized !== undefined) updateData.is_randomized = is_randomized
        if (is_active !== undefined) updateData.is_active = finalIsActive
        if (deadline !== undefined) updateData.deadline = deadline || null
        if (available_from !== undefined) updateData.available_from = available_from || null

        // Set pending_publish correctly when explicitly publishing
        if (is_active !== undefined) {
            updateData.pending_publish = finalPendingPublish
        }

        // ── Bind batch: fitur "Tambah Kelas Paralel" dari modal Pengaturan kuis ──
        // Paritas PUT /api/exams/[id]. SATU ARAH: hanya kuis TANPA batch yang boleh
        // diikat. Guard M9 paritas POST /api/quizzes: caller GURU harus own TA
        // anchor ATAU TA baru se-mapel yang kelasnya kelas member batch. Mencegah
        // kuis B menyerobot batch guru A → syncDraftQuizQuestions menyalin soal
        // guru A ke kuis B (ekfiltrasi soal).
        let bindBatch = false
        if (batch_id !== undefined) {
            if (quizForYear?.batch_id) {
                if (quizForYear.batch_id !== batch_id) {
                    return NextResponse.json({ error: 'Kuis ini sudah terikat kelas paralel lain' }, { status: 409 })
                }
            } else if (quizForYear?.is_active) {
                return NextResponse.json({ error: `Tidak bisa menambah kelas paralel saat ${labels.kuis.toLowerCase()} aktif — tarik ke draft dulu` }, { status: 400 })
            } else if (quizForYear?.is_remedial) {
                return NextResponse.json({ error: 'Kuis remedial tidak bisa diikat ke kelas paralel' }, { status: 400 })
            } else {
                const { data: batchMembers } = await supabase
                    .from('quizzes')
                    .select('id, teaching_assignment:teaching_assignments(teacher_id, subject_id, class_id)')
                    .eq('batch_id', batch_id)
                type BatchMember = { id: string; teaching_assignment?: { teacher_id: string; subject_id: string; class_id: string } | { teacher_id: string; subject_id: string; class_id: string }[] }
                const anchorFirst = (batchMembers || [])[0] as BatchMember | undefined
                const anchorTaRaw = anchorFirst?.teaching_assignment
                const anchorTa = Array.isArray(anchorTaRaw) ? anchorTaRaw[0] : anchorTaRaw
                if (anchorTa && user.role === 'GURU') {
                    const scope = await getTeacherScope(user.id)
                    const isOwn = ownsTeachingAssignment(scope, anchorTa.teacher_id)
                    if (!isOwn) {
                        const myTaRaw = quizForYear?.teaching_assignment
                        const myTaNorm = Array.isArray(myTaRaw) ? myTaRaw[0] : myTaRaw
                        const sameSubject = !!myTaNorm?.subject_id && myTaNorm.subject_id === anchorTa.subject_id
                        const myClassIsMember = !!myTaNorm?.class_id && (batchMembers || []).some((m: BatchMember) => {
                            const ta = Array.isArray(m.teaching_assignment) ? m.teaching_assignment[0] : m.teaching_assignment
                            return ta?.class_id === myTaNorm.class_id
                        })
                        if (!sameSubject || !myClassIsMember) {
                            return NextResponse.json({ error: 'Kelas paralel ini bukan milik penugasan Anda' }, { status: 403 })
                        }
                    }
                }
                bindBatch = true
            }
        }
        if (bindBatch) updateData.batch_id = batch_id

        const { data, error } = await supabase
            .from('quizzes')
            .update(updateData)
            .eq('id', id)
            .select(`
                *,
                teaching_assignment:teaching_assignments(
                    class_id,
                    subject:subjects(name)
                )
            `)
            .single()

        if (error) {
            console.error('Database update error:', error)
            throw error
        }

        // ── K3: jadwal batch kuis dipaksa SERAGAM (paritas UTS/UAS) ──
        // 1 batch = 1 jadwal; PUT field jadwal pada member batch menular ke
        // semua member TANPA menyentuh is_active/pending_publish. Paritas
        // implementasi exams/[id] PUT.
        const TIMING_KEYS_QUIZ = ['duration_minutes', 'deadline', 'available_from'] as const
        const quizTimingTouched = TIMING_KEYS_QUIZ.some(k => (updateData as any)[k] !== undefined)
        if (data?.batch_id && quizTimingTouched) {
            try {
                const siblingTiming: Record<string, unknown> = {}
                for (const k of TIMING_KEYS_QUIZ) siblingTiming[k] = (updateData as any)[k]
                const { error: timingErr } = await supabase
                    .from('quizzes')
                    .update({ ...siblingTiming, updated_at: new Date().toISOString() })
                    .eq('batch_id', data.batch_id)
                if (timingErr) {
                    console.error('[quiz][batch-timing] gagal menular ke sibling:', timingErr)
                }
            } catch (timingError) {
                console.error('[quiz][batch-timing] error:', timingError)
            }
        }

        // If quiz was JUST published (belum aktif → aktif), send notifications to students.
        // Re-PUT kuis yang sudah aktif tidak boleh mengirim ulang notifikasi "Kuis Baru"
        // ke sekelas (spam) ataupun mengulang sinkronisasi batch.
        const justPublished = finalIsActive === true && !wasActive
        if (justPublished && data?.teaching_assignment?.class_id) {
            try {
                // Get the active academic year
                const { data: activeYear } = await supabase
                    .from('academic_years')
                    .select('id')
                    .eq('is_active', true)
                    .eq('school_id', schoolId)
                    .single()

                if (activeYear) {
                    // Check if this is a remedial quiz with specific allowed students
                    if (data.is_remedial && data.allowed_student_ids && data.allowed_student_ids.length > 0) {
                        // Send targeted notifications to remedial students only
                        const { data: students } = await supabase
                            .from('students')
                            .select('user_id')
                            .in('id', data.allowed_student_ids)

                        if (students && students.length > 0) {
                            const subjectName = data.teaching_assignment.subject?.name || ''
                            await supabase.from('notifications').insert(
                                students.map((s: any) => ({
                                    user_id: s.user_id,
                                    type: 'REMEDIAL',
                                    title: `Remedial ${labels.kuis}: ${data.title}`,
                                    message: `${subjectName} - ${data.duration_minutes || 0} menit. Segera kerjakan!`,
                                    link: '/dashboard/siswa/kuis'
                                }))
                            )
                        }
                    } else {
                        // Regular quiz: notify all students in the class
                        const { data: enrollments } = await supabase
                            .from('student_enrollments')
                            .select('student:students(user_id)')
                            .eq('academic_year_id', activeYear.id)
                            .eq('class_id', data.teaching_assignment.class_id)

                        if (enrollments && enrollments.length > 0) {
                            const subjectName = data.teaching_assignment.subject?.name || ''
                            // Unwrap embed ambigu (student bisa array) — paritas fix
                            // exams/[id] & examBatch; tanpa ini user_id undefined.
                            const unwrapStudent = (e: any) => Array.isArray(e.student) ? e.student[0] : e.student
                            await supabase.from('notifications').insert(
                                enrollments.map((e: any) => ({
                                    user_id: unwrapStudent(e)?.user_id,
                                    type: 'KUIS_BARU',
                                    title: `${labels.kuis} Baru: ${data.title}`,
                                    message: `${subjectName} - ${data.duration_minutes || 0} menit`,
                                    link: '/dashboard/siswa/kuis'
                                })).filter((n: any) => !!n.user_id)
                            )
                        }
                    }
                }
            } catch (notifError) {
                console.error('Error sending quiz notifications:', notifError)
            }
        }
        // Sinkronkan kelas satu batch (multi-kelas) bila kuis baru saja diaktifkan
        let batchSync: { total: number, failed: string[] } | null = null
        if (justPublished && data?.batch_id) {
            try {
                batchSync = await syncQuizBatch(id)
            } catch (batchError) {
                console.error('Batch sync error (quiz):', batchError)
                batchSync = { total: -1, failed: [] }
            }
        }

        return NextResponse.json({ ...data, batch_sync: batchSync })
    } catch (error) {
        console.error('Error updating quiz:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE quiz
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()
            
            const { data: quiz } = await supabase
                .from('quizzes')
                .select('teaching_assignment:teaching_assignments(teacher_id)')
                .eq('id', id)
                .single()
            
            if (!teacher || (quiz?.teaching_assignment as any)?.teacher_id !== teacher.id) {
                const labels = await getMenuLabelsForSchool(schoolId)
                return NextResponse.json({ error: `Anda tidak memiliki akses ke ${labels.kuis.toLowerCase()} ini` }, { status: 403 })
            }
        } else if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Tenant guard: kuis harus milik sekolah caller (ADMIN dulu lolos tanpa cek)
        if (tenantMismatch(await resolveQuizSchoolId(id), schoolId)) {
            return notFound()
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: quizForYear } = await supabase
            .from('quizzes')
            .select('teaching_assignment_id')
            .eq('id', id)
            .single()
        if (quizForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(quizForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        // Guard server-side: jangan hapus kuis yang sudah ada submission.
        // Paritas DELETE /api/exams/[id]. Tanpa ini, data siswa (submission +
        // jawaban) hilang permanen atau orphan. Client ada yang cek (batch
        // member remove), ada yang tidak (list page delete) — pelindung mutlak.
        const { count: submissionCount } = await supabase
            .from('quiz_submissions')
            .select('id', { count: 'exact', head: true })
            .eq('quiz_id', id)
        if ((submissionCount || 0) > 0) {
            return NextResponse.json({
                error: `Tidak bisa menghapus: sudah ada ${submissionCount} submission. Reset attempt di halaman detail dulu, lalu hapus.`
            }, { status: 409 })
        }

        const { error } = await supabase
            .from('quizzes')
            .delete()
            .eq('id', id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting quiz:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
