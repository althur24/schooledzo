import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound, resolveExamSchoolId, findExamsOutsideSchool } from '@/lib/tenantGuard'
import { isAIReviewEnabled } from '@/lib/triggerHOTS'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'
import { syncExamBatch } from '@/lib/examBatch'
import { canManageExamCoTaught, getTeacherScope, ownsTeachingAssignment } from '@/lib/teacherScope'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'
import { hasStartedSubmissions } from '@/lib/hasSubmissions'
import { fetchAllRows } from '@/lib/fetchAllRows'

// GET single exam
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
            .from('exams')
            .select(`
                *,
                teaching_assignment:teaching_assignments(
                    id,
                    teacher:teachers(id, user:users(full_name)),
                    subject:subjects(id, name, kkm),
                    class:classes(id, name, school_level, grade_level),
                    academic_year:academic_years(id, name)
                )
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        // Tenant guard: ulangan harus milik sekolah caller (IDOR lintas
        // sekolah — paritas dengan /api/quizzes/[id] yang sudah punya guard)
        if (tenantMismatch(await resolveExamSchoolId(id), schoolId)) {
            return notFound()
        }

        // Sibling batch (kelas paralel) — sumber definitif untuk checkbox
        // "Terapkan jadwal juga ke kelas paralel" (sessionStorage bisa hilang)
        // dan dropdown kelas di tab hasil batch.
        // A4: untuk GURU, hanya sibling kelas yang dia ampou (owner/co-teacher
        // mapel+kelas) — co-teacher parsial tidak boleh melihat kelas yang
        // bukan haknya di dropdown. ADMIN melihat semua sibling se-sekolah.
        // Tenant: sibling difilter sekolah caller juga (batch_id client-generated,
        // tabrakan lintas sekolah nyaris mustahil — ini lapisan berjaga-jaga).
        // SISWA: TIDAK diberi sibling sama sekali — daftar kelas paralel satu
        // sekolah bukan informasi miliknya (halaman siswa tidak memakainya;
        // ini menutup bocor via inspect network).
        let batchSiblings: { id: string; class_id: string; class_name: string }[] = []
        if (data?.batch_id && user.role !== 'SISWA') {
            const { data: siblings } = await supabase
                .from('exams')
                .select('id, teaching_assignment:teaching_assignments(subject_id, class:classes(id, name))')
                .eq('batch_id', data.batch_id)
                .neq('id', id)
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
                    pairs = new Set((myTAs || []).map((ta: any) => `${ta.subject_id}|${ta.class_id}`))
                }
            }
            // Tenant guard: buang sibling yang ternyata milik sekolah lain
            const siblingIds = (siblings || []).map((s: any) => s.id)
            const outsideIds = new Set(siblingIds.length > 0
                ? await findExamsOutsideSchool(siblingIds, schoolId)
                : [])
            batchSiblings = (siblings || [])
                .filter((s: any) => !outsideIds.has(s.id))
                .map((s: any) => {
                    const ta = Array.isArray(s.teaching_assignment) ? s.teaching_assignment[0] : s.teaching_assignment
                    const cls = Array.isArray(ta?.class) ? ta?.class[0] : ta?.class
                    return { id: s.id, subject_id: ta?.subject_id, class_id: cls?.id, class_name: cls?.name || '-' }
                })
                .filter((s: any) => !pairs || pairs.has(`${s.subject_id}|${s.class_id}`))
                .map(({ id, class_id, class_name }) => ({ id, class_id, class_name }))
        }

        // SISWA: jangan bocorkan allowed_student_ids (daftar "siapa yang
        // remedial") — paritas GET /api/quizzes/[id] & list /api/exams yang
        // sudah strip; jalur detail exam ini sebelumnya terlewat (bocor via
        // inspect network saat siswa membuka halaman remedial). batch_siblings
        // juga tidak dikirim (daftar kelas paralel sekolah bukan miliknya).
        if (user.role === 'SISWA') {
            delete (data as any).allowed_student_ids
            // Penanda untuk ExamRunner: placeholder susulan harus di-start
            // sebelum soal dimuat (mencegah baca soal tanpa timer berjalan).
            const { data: student } = await supabase
                .from('students').select('id').eq('user_id', user.id).single()
            let susulanPending = false
            if (student) {
                const { data: pending } = await supabase
                    .from('exam_submissions')
                    .select('id')
                    .eq('exam_id', id)
                    .eq('student_id', student.id)
                    .is('started_at', null)
                    .not('susulan_granted_at', 'is', null)
                    // Grant kedaluwarsa bukan "pending" — jangan memicu alur
                    // start-sebelum-soal yang pasti ditolak server.
                    .gt('susulan_expires_at', new Date().toISOString())
                    .maybeSingle()
                susulanPending = !!pending
            }
            return NextResponse.json({ ...(data as any), susulan_pending: susulanPending })
        }

        return NextResponse.json({ ...data, batch_siblings: batchSiblings })
    } catch (error) {
        console.error('Error fetching exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update exam
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: examForYear } = await supabase
            .from('exams')
            .select('teaching_assignment_id, title, results_released, start_time, is_active, is_remedial, batch_id, teaching_assignment:teaching_assignments(teacher_id, subject_id, class_id, academic_year_id)')
            .eq('id', id)
            .single()
        if (examForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(examForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        // Kepemilikan: ADMIN sekolah yang sama, guru pemilik TA, ATAU co-teacher
        // (mengampu mapel+kelas yang sama) — semua pengampu kelola ulangan yang sama
        const labels = await getMenuLabelsForSchool(schoolId)
        const taCtx = Array.isArray(examForYear?.teaching_assignment)
            ? (examForYear.teaching_assignment as any)[0]
            : (examForYear?.teaching_assignment as any)
        if (!(await canManageExamCoTaught(user, taCtx))) {
            return NextResponse.json({ error: `Anda tidak memiliki akses ke ${labels.ulangan.toLowerCase()} ini` }, { status: 403 })
        }

        // ── Lock settings setelah siswa mulai mengerjakan ──
        // Setelah ada submission dengan started_at (siswa pernah buka ujian),
        // field yang mempengaruhi konsistensi nilai TIDAK boleh diubah.
        // Strategi: silent ignore — field terkunci tidak masuk updateData,
        // field yang aman tetap tersimpan. Mencegah "save all at once" break.
        const { hasSubmissions: hasSubs } = await hasStartedSubmissions('exam_submissions', id)

        const body = await request.json()
        const { title, description, start_time, duration_minutes, window_end_time, is_randomized, is_active, max_violations, show_results_immediately, results_released, batch_id, force_duplicate } = body

        // Field yang di-lock saat ada submission — skip validasi & penulisan.
        const effectiveStartTime = hasSubs ? undefined : start_time
        const effectiveDuration = hasSubs ? undefined : duration_minutes
        const effectiveWindowEnd = hasSubs ? undefined : window_end_time
        const effectiveIsRandomized = hasSubs ? undefined : is_randomized
        const effectiveMaxViolations = hasSubs ? undefined : max_violations
        const effectiveBatchId = hasSubs ? undefined : batch_id

        // Validasi jendela waktu: jam tutup harus setelah jam buka
        if (effectiveWindowEnd) {
            const effectiveStart = effectiveStartTime ?? examForYear?.start_time
            if (effectiveStart && new Date(effectiveWindowEnd) <= new Date(effectiveStart)) {
                return NextResponse.json({ error: 'Jam tutup jendela waktu harus setelah jam buka' }, { status: 400 })
            }
        }

        let finalIsActive = is_active
        let finalPendingPublish = false

        // If trying to publish, check question statuses first
        if (is_active === true) {
            const aiEnabled = await isAIReviewEnabled(schoolId)

            const { data: questions } = await supabase
                .from('exam_questions')
                .select('id, status')
                .eq('exam_id', id)

            if (!questions || questions.length === 0) {
                return NextResponse.json({ error: `Tidak bisa mempublikasikan ${labels.ulangan.toLowerCase()} tanpa soal. Tambahkan minimal 1 soal terlebih dahulu.` }, { status: 400 })
            }
            if (questions.length > 0) {
                if (!aiEnabled) {
                    // AI Review OFF — auto-approve any non-approved questions
                    const nonApproved = questions.filter(q => q.status !== 'approved')
                    if (nonApproved.length > 0) {
                        await supabase.from('exam_questions')
                            .update({ status: 'approved' })
                            .in('id', nonApproved.map(q => q.id))
                    }
                } else {
                    // AI Review ON — block publish while questions are still processing or returned.
                    // (The previous "auto-recover stuck after 3 min" used updated_at, which doesn't
                    //  exist on exam_questions and isn't written by any status update, so it never
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

        const updateData: any = { updated_at: new Date().toISOString() }

        // ── K3 (audit eksternal): validasi durasi end-to-end ──
        // Durasi ulangan wajib angka >= 5 menit — tanpa ini, mode serentak dengan
        // durasi 0/negatif membuat seluruh kelas tidak bisa memulai (start-gate
        // menolak), sementara data absurd tersimpan diam-diam (modal create sudah
        // memblokir < 5 di client; settings modal & API belum).
        if (effectiveDuration !== undefined
            && (typeof effectiveDuration !== 'number' || !Number.isFinite(effectiveDuration) || effectiveDuration < 5)) {
            return NextResponse.json({ error: 'Durasi pengerjaan minimal 5 menit' }, { status: 400 })
        }
        // M7: max_violations wajar (1..10 — paritas min/max di form)
        if (effectiveMaxViolations !== undefined
            && (typeof effectiveMaxViolations !== 'number' || !Number.isFinite(effectiveMaxViolations) || effectiveMaxViolations < 1 || effectiveMaxViolations > 10)) {
            return NextResponse.json({ error: 'Maksimal pelanggaran harus antara 1 sampai 10' }, { status: 400 })
        }

        // ── Bind batch: fitur "Tambah Kelas Paralel" dari modal Pengaturan guru ──
        // SATU ARAH: hanya exam TANPA batch yang boleh diikat ke batch (draft).
        // Exam yang sudah punya batch TIDAK bisa pindah/dilepas dari PUT (member
        // yatim & sync liar). batch_id client-generated; guard paritas M9 di
        // POST /api/exams: bila batch sudah punya member, caller GURU harus
        // pengampu TA anchor (own) ATAU TA baru se-mapel yang kelasnya memang
        // kelas member batch (co-teacher). Mencegah exam ulangan B menyerobot
        // batch guru A → syncDraft menyalin soal guru A ke exam B (ekfiltrasi).
        let bindBatch = false
        if (effectiveBatchId !== undefined) {
            if (examForYear?.batch_id) {
                if (examForYear.batch_id !== effectiveBatchId) {
                    return NextResponse.json({ error: 'Ulangan ini sudah terikat kelas paralel lain' }, { status: 409 })
                }
                // batch_id sama → no-op (idempoten)
            } else if (examForYear?.is_active) {
                return NextResponse.json({ error: `Tidak bisa menambah kelas paralel saat ${labels.ulangan.toLowerCase()} aktif — tarik ke draft dulu` }, { status: 400 })
            } else if (examForYear?.is_remedial) {
                return NextResponse.json({ error: 'Ulangan remedial tidak bisa diikat ke kelas paralel' }, { status: 400 })
            } else {
                // Batch kosong (baru) atau sudah ada member — validasi kepemilikan
                const { data: batchMembers } = await supabase
                    .from('exams')
                    .select('id, teaching_assignment:teaching_assignments(teacher_id, subject_id, class_id)')
                    .eq('batch_id', effectiveBatchId)
                type BatchMember = { id: string; teaching_assignment?: { teacher_id: string; subject_id: string; class_id: string } | { teacher_id: string; subject_id: string; class_id: string }[] }
                const anchorFirst = (batchMembers || [])[0] as BatchMember | undefined
                const anchorTaRaw = anchorFirst?.teaching_assignment
                const anchorTa = Array.isArray(anchorTaRaw) ? anchorTaRaw[0] : anchorTaRaw
                if (anchorTa && user.role === 'GURU') {
                    const scope = await getTeacherScope(user.id)
                    const isOwn = ownsTeachingAssignment(scope, anchorTa.teacher_id)
                    if (!isOwn) {
                        const myTa = taCtx
                        const sameSubject = !!myTa?.subject_id && myTa.subject_id === anchorTa.subject_id
                        const myClassIsMember = !!myTa?.class_id && (batchMembers || []).some((m: BatchMember) => {
                            const ta = Array.isArray(m.teaching_assignment) ? m.teaching_assignment[0] : m.teaching_assignment
                            return ta?.class_id === myTa.class_id
                        })
                        if (!sameSubject || !myClassIsMember) {
                            return NextResponse.json({ error: 'Kelas paralel ini bukan milik penugasan Anda' }, { status: 403 })
                        }
                    }
                }
                bindBatch = true
            }
        }

        // ── Guard duplikat-judul saat RENAME (paritas POST /api/exams guard) ──
        // Hanya cek bila title berubah (normalized new ≠ normalized current).
        // Scope per teaching_assignment_id — TA unik per (teacher+subject+class+year),
        // jadi guru 4 tahun depan tetap bisa pakai judul sama (TA beda, tak collision).
        // Remedial dikecualikan (make-up sah). force_duplicate = override eksplisit.
        // Kontrak tahun-scoping: guard WAJIB scope per TA, BUKAN global per sekolah.
        if (!force_duplicate && !examForYear?.is_remedial && title !== undefined) {
            const normNew = (title || '').trim().toLowerCase()
            const normCurrent = (examForYear?.title || '').trim().toLowerCase()
            if (normNew && normNew !== normCurrent && examForYear?.teaching_assignment_id) {
                const existingExams = await fetchAllRows(supabase
                    .from('exams')
                    .select('id, title, is_active, created_at, teaching_assignment:teaching_assignments(class:classes(name))')
                    .eq('teaching_assignment_id', examForYear.teaching_assignment_id)
                    .neq('is_remedial', true)
                    .neq('id', id) // exclude diri sendiri
                    .order('created_at', { ascending: false })
                    .order('id'))
                const dupe = (existingExams || []).find((e: any) => {
                    const eNorm = (e.title || '').trim().toLowerCase()
                    return eNorm === normNew
                })
                if (dupe) {
                    let submissionCount = 0
                    try {
                        const { count } = await supabase
                            .from('exam_submissions')
                            .select('id', { count: 'exact', head: true })
                            .eq('exam_id', dupe.id)
                        submissionCount = count || 0
                    } catch { /* non-fatal — info dialog saja */ }
                    const taEmbed: any = Array.isArray(dupe.teaching_assignment)
                        ? dupe.teaching_assignment[0]
                        : dupe.teaching_assignment
                    const className = taEmbed?.class?.name
                    return NextResponse.json({
                        error: 'DUPLICATE_TITLE',
                        existing: {
                            id: dupe.id,
                            title: dupe.title,
                            className: className || null,
                            isActive: dupe.is_active,
                            submissionCount,
                            createdAt: dupe.created_at,
                        }
                    }, { status: 409 })
                }
            }
        }

        if (title !== undefined) updateData.title = title
        if (description !== undefined) updateData.description = description
        if (effectiveStartTime !== undefined) updateData.start_time = effectiveStartTime
        if (effectiveDuration !== undefined) updateData.duration_minutes = effectiveDuration
        if (effectiveWindowEnd !== undefined) updateData.window_end_time = effectiveWindowEnd || null
        if (effectiveIsRandomized !== undefined) updateData.is_randomized = effectiveIsRandomized
        if (is_active !== undefined) updateData.is_active = finalIsActive
        if (show_results_immediately !== undefined) updateData.show_results_immediately = show_results_immediately
        if (results_released !== undefined) updateData.results_released = results_released

        // Set pending_publish correctly when explicitly publishing
        if (is_active !== undefined) {
            updateData.pending_publish = finalPendingPublish
        }

        if (effectiveMaxViolations !== undefined) updateData.max_violations = effectiveMaxViolations
        if (bindBatch) updateData.batch_id = effectiveBatchId

        // ── H1 (audit eksternal): tolak unpublish bila sudah ada yang mengumpulkan ──
        // Alur "tarik ke draft untuk edit soal" sah, TAPI setelah ada submission
        // terkumpul, unpublish membuka jalan hapus soal → CASCADE menghapus
        // jawaban siswa & merusak nilai historis permanen.
        if (is_active === false && examForYear?.is_active) {
            const { count: submittedCount } = await supabase
                .from('exam_submissions')
                .select('id', { count: 'exact', head: true })
                .eq('exam_id', id)
                .eq('is_submitted', true)
            if ((submittedCount || 0) > 0) {
                return NextResponse.json({
                    error: `Tidak bisa menarik ke draft — ${submittedCount} siswa sudah mengumpulkan ${labels.ulangan.toLowerCase()} ini. Nilai historis harus dijaga.`,
                }, { status: 409 })
            }

            // Grant susulan yang belum dimulai akan menjadi tidak terlihat &
            // tidak bisa dikelola bila ujian ditarik ke draft. Minta guru
            // membatalkannya dulu dari Monitor Live.
            const { count: pendingSusulan } = await supabase
                .from('exam_submissions')
                .select('id', { count: 'exact', head: true })
                .eq('exam_id', id)
                .eq('is_submitted', false)
                .is('started_at', null)
                .not('susulan_granted_at', 'is', null)
            if ((pendingSusulan || 0) > 0) {
                return NextResponse.json({
                    error: `Tidak bisa menarik ke draft — masih ada ${pendingSusulan} grant susulan yang belum dimulai. Batalkan susulan dulu di Monitor Live.`,
                }, { status: 409 })
            }
        }

        // ── M3 (audit eksternal): optimistic-concurrency pada transisi is_active ──
        // Publish paralel (double-click / dua guru publish member sama serentak)
        // dulu dua-duanya sukses + dua-duanya mengirim notifikasi dobel. Kini
        // update is_active dibatasi kondisi state yang dibaca (eq is_active
        // lama) → hanya SATU request yang berhasil flip; yang kalah mendapat
        // 0 baris → di-handle sebagai "sudah berubah oleh request lain" tanpa
        // notifikasi/batch-sync dobel.
        const prevActive = examForYear?.is_active === true
        const examSelect = `
            *,
            teaching_assignment:teaching_assignments(
                class_id,
                subject:subjects(name)
            )
        `
        let updateQuery = supabase.from('exams').update(updateData).eq('id', id)
        if (is_active !== undefined) updateQuery = updateQuery.eq('is_active', prevActive)
        const { data, error } = await updateQuery.select(examSelect).single()

        if (error) {
            // PGRST116 = 0 baris ter-update → kondisi is_active berubah di tengah
            // jalan (publish/unpublish paralel). State terkini dikembalikan apa
            // adanya — bukan error bagi user, hanya "request lain lebih dulu".
            if (error.code === 'PGRST116' && is_active !== undefined) {
                const { data: fresh } = await supabase
                    .from('exams').select(examSelect).eq('id', id).single()
                return NextResponse.json({ ...fresh, batch_sync: null, concurrent_update: true })
            }
            throw error
        }

        // ── K3: field batch dipaksa SERAGAM (paritas UTS/UAS) ──
        // Prinsip desain: 1 batch = 1 pengaturan kelas paralel (siswa seangkatan
        // mengerjakan kondisi yang sama). Guru yang butuh pengaturan beda membuat
        // batch lain. Bila PUT menyentuh field batch pada member → perubahan
        // otomatis menular ke semua member (TANPA menyentuh is_active/
        // pending_publish/results_released — itu tetap per-member).
        // BUG NYATA (TKA MTK PIIS 30 Sep 2026): max_violations TIDAK termasuk
        // propagasi → guru set 5 di 1 member, 9 kelas lain tetap 3 → siswa
        // dipaksa-submit di pelanggaran ke-3 padahal batas 5 → nilai 0.
        // Kategori batch (wajib seragam): jadwal + aturan + tampilan hasil.
        //
        // LOCK GUARD: bila ada sibling di batch yang sudah punya submission
        // (started_at), field terkunci (jadwal + aturan) TIDAK di-propagate —
        // hanya field aman (show_results_immediately) yang menular. Mencegah
        // bypass lock: guru PUT member B (belum ada siswa) → propagate ke
        // member A (sudah ada siswa) → setting A berubah tanpa guard.
        const BATCH_SYNC_KEYS_EXAM = [
            'start_time', 'duration_minutes', 'window_end_time',   // jadwal
            'max_violations', 'is_randomized',                      // aturan
            'show_results_immediately',                              // tampilan
        ] as const
        const BATCH_LOCKED_KEYS_EXAM = [
            'start_time', 'duration_minutes', 'window_end_time',
            'max_violations', 'is_randomized',
        ] as const
        const batchTouched = BATCH_SYNC_KEYS_EXAM.some(k => (updateData as any)[k] !== undefined)
        if (data?.batch_id && batchTouched) {
            try {
                // Cek apakah ada sibling di batch yang sudah punya siswa mulai
                const { data: batchMembers } = await supabase
                    .from('exams')
                    .select('id')
                    .eq('batch_id', data.batch_id)
                const memberIds = (batchMembers || []).map((m: any) => m.id)
                const { count: siblingSubsCount, error: subsErr } = await supabase
                    .from('exam_submissions')
                    .select('id', { count: 'exact', head: true })
                    .in('exam_id', memberIds)
                    .not('started_at', 'is', null)
                if (subsErr) {
                    // Fail-closed: bila query error, anggap ADA submission —
                    // jangan propagate locked fields saat tak yakin.
                    console.error('[exam][batch-sync] gagal cek submission sibling:', subsErr)
                }
                const anySiblingHasSubs = subsErr ? true : ((siblingSubsCount || 0) > 0)

                const siblingSync: Record<string, unknown> = {}
                for (const k of BATCH_SYNC_KEYS_EXAM) {
                    if ((updateData as any)[k] !== undefined) {
                        // Skip locked fields jika ada sibling dengan submission
                        if (anySiblingHasSubs && (BATCH_LOCKED_KEYS_EXAM as readonly string[]).includes(k)) continue
                        siblingSync[k] = (updateData as any)[k]
                    }
                }
                if (Object.keys(siblingSync).length === 0) return
                const { error: timingErr } = await supabase
                    .from('exams')
                    .update({ ...siblingSync, updated_at: new Date().toISOString() })
                    .eq('batch_id', data.batch_id)
                if (timingErr) {
                    console.error('[exam][batch-sync] gagal menular ke sibling:', timingErr)
                }
            } catch (timingError) {
                console.error('[exam][batch-sync] error:', timingError)
            }
        }

        // Notifikasi hanya saat transisi draft→publish (false→true). Re-PUT
        // is_active:true (mis. edit judul) tidak boleh mengirim ulang notifikasi
        // ke sekelas — paritas guard wasActive di quizzes/[id] & dedup official-exams.
        const justPublished = finalIsActive === true && !examForYear?.is_active
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
                    const { data: enrollments } = await supabase
                        .from('student_enrollments')
                        .select('student:students(user_id)')
                        .eq('academic_year_id', activeYear.id)
                        .eq('class_id', data.teaching_assignment.class_id)
                        .eq('status', 'ACTIVE') // siswa pindah/keluar tidak dinotifikasi

                     if (enrollments && enrollments.length > 0) {
                        const subjectName = data.teaching_assignment.subject?.name || ''
                        const startDate = new Date(data.start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
                        // e.student bisa ARRAY (embed PostgREST ambigu) — unwrap
                        // seperti pola first() di codebase; tanpa ini user_id
                        // undefined → notifikasi hilang diam-diam.
                        const unwrapStudent = (e: any) => Array.isArray(e.student) ? e.student[0] : e.student
                        await supabase.from('notifications').insert(
                            enrollments.map((e: any) => ({
                                user_id: unwrapStudent(e)?.user_id,
                                type: 'ULANGAN_BARU',
                                title: `${labels.ulangan} Baru: ${data.title}`,
                                message: `${subjectName} - Mulai: ${startDate}`,
                                link: '/dashboard/siswa/ulangan'
                            })).filter((n: any) => !!n.user_id)
                        )
                    }
                }
            } catch (notifError) {
                console.error('Error sending exam notifications:', notifError)
            }
        }

        // Notify students when results are released ("Bagikan Hasil" — only on the false→true transition)
        if (results_released === true && !examForYear?.results_released && data?.teaching_assignment?.class_id) {
            try {
                const { data: activeYear } = await supabase
                    .from('academic_years')
                    .select('id')
                    .eq('is_active', true)
                    .eq('school_id', schoolId)
                    .single()

                if (activeYear) {
                    const { data: enrollments } = await supabase
                        .from('student_enrollments')
                        .select('student:students(user_id)')
                        .eq('academic_year_id', activeYear.id)
                        .eq('class_id', data.teaching_assignment.class_id)

                    if (enrollments && enrollments.length > 0) {
                        const subjectName = data.teaching_assignment.subject?.name || ''
                        // Unwrap embed ambigu (student bisa array) — tanpa ini
                        // user_id undefined → notifikasi "Nilai Keluar" hilang
                        // diam-diam untuk sebagian kelas.
                        const unwrapStudent = (e: any) => Array.isArray(e.student) ? e.student[0] : e.student
                        await supabase.from('notifications').insert(
                            enrollments.map((e: any) => ({
                                user_id: unwrapStudent(e)?.user_id,
                                type: 'NILAI_KELUAR',
                                title: `Nilai Keluar: ${data.title}`,
                                message: `${subjectName} — Hasil ${labels.ulangan.toLowerCase()} sudah bisa dilihat`,
                                link: '/dashboard/siswa/ulangan'
                            })).filter((n: any) => !!n.user_id)
                        )
                    }
                }
            } catch (notifError) {
                console.error('Error sending results-released notifications:', notifError)
            }
        }
        // Sinkronkan kelas satu batch (multi-kelas) bila ulangan baru saja diaktifkan
        let batchSync: { total: number, failed: string[] } | null = null
        if (finalIsActive === true && data?.batch_id) {
            try {
                batchSync = await syncExamBatch(id)
            } catch (batchError) {
                console.error('Batch sync error (exam):', batchError)
                batchSync = { total: -1, failed: [] }
            }
        }

        return NextResponse.json({ ...data, batch_sync: batchSync })
    } catch (error) {
        console.error('Error updating exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// DELETE exam
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Block writes to archived (COMPLETED) academic years
        const { data: examForYear } = await supabase
            .from('exams')
            .select('teaching_assignment_id, teaching_assignment:teaching_assignments(teacher_id, subject_id, class_id, academic_year_id)')
            .eq('id', id)
            .single()
        if (examForYear?.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(examForYear.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        // Kepemilikan: ADMIN sekolah yang sama, guru pemilik TA, ATAU co-teacher
        const taCtx = Array.isArray(examForYear?.teaching_assignment)
            ? (examForYear.teaching_assignment as any)[0]
            : (examForYear?.teaching_assignment as any)
        if (!(await canManageExamCoTaught(user, taCtx))) {
            const labels = await getMenuLabelsForSchool(schoolId)
            return NextResponse.json({ error: `Anda tidak memiliki akses ke ${labels.ulangan.toLowerCase()} ini` }, { status: 403 })
        }

        // Guard server-side: jangan hapus exam yang sudah ada submission.
        // Tanpa ini, FK CASCADE (jika ada) menghapus exam_submissions +
        // exam_answers secara permanen → data loss siswa. Atau FK RESTRICT
        // → 500 generic yang membingungkan. Client ada yang cek (batch member
        // remove), ada yang tidak (list page delete) — ini pelindung mutlak.
        // Placeholder susulan BUKAN attempt — jangan salah menyuruh "Reset attempt".
        // Semua baris selain placeholder grant (termasuk baris legacy started_at
        // NULL) tetap dianggap data nyata dan memblokir delete.
        const { count: allSubmissionCount } = await supabase
            .from('exam_submissions')
            .select('id', { count: 'exact', head: true })
            .eq('exam_id', id)

        const { count: pendingSusulanCount } = await supabase
            .from('exam_submissions')
            .select('id', { count: 'exact', head: true })
            .eq('exam_id', id)
            .eq('is_submitted', false)
            .is('started_at', null)
            .not('susulan_granted_at', 'is', null)

        const realSubmissionCount = Math.max(0, (allSubmissionCount || 0) - (pendingSusulanCount || 0))
        if (realSubmissionCount > 0) {
            return NextResponse.json({
                error: `Tidak bisa menghapus: sudah ada ${realSubmissionCount} submission. Reset attempt di halaman detail dulu, lalu hapus.`
            }, { status: 409 })
        }

        if ((pendingSusulanCount || 0) > 0) {
            return NextResponse.json({
                error: `Tidak bisa menghapus: masih ada ${pendingSusulanCount} grant susulan yang belum dimulai. Batalkan susulan dulu di Monitor Live.`
            }, { status: 409 })
        }

        const { error } = await supabase
            .from('exams')
            .delete()
            .eq('id', id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
