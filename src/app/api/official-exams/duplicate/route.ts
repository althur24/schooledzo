import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch } from '@/lib/tenantGuard'
import { canManageOfficialExam, getTeacherScope, coTeachesClassSubject } from '@/lib/teacherScope'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'
import { batchedIn } from '@/lib/batchedIn'
import { sanitizePolicyInput } from '@/lib/remedialScore'
import { validateTargetClassIds } from '@/lib/targetClassValidation'
import { checkOfficialExamDuplicate } from '@/lib/officialExamDuplicateCheck'

export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN' && user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const {
            source_exam_id,
            title,
            start_time,
            duration_minutes,
            window_end_time,
            target_class_ids,
            is_remedial,
            allowed_student_ids,
            remedial_score_policy,
            remedial_max_score,
            force_duplicate
        } = body

        if (!source_exam_id || !title || !start_time) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // Validasi kebijakan nilai remedial (hanya relevan saat is_remedial)
        let policyFields: { remedial_score_policy?: string; remedial_max_score?: number } = {}
        if (is_remedial) {
            const sanitized = sanitizePolicyInput(remedial_score_policy, remedial_max_score)
            if ('error' in sanitized) {
                return NextResponse.json({ error: sanitized.error }, { status: 400 })
            }
            policyFields = {
                remedial_score_policy: sanitized.policy,
                ...(sanitized.policy === 'CAP' && sanitized.cap !== null ? { remedial_max_score: sanitized.cap } : {}),
            }
        }

        // Validasi jendela waktu: jam tutup harus setelah jam buka
        if (window_end_time && new Date(window_end_time) <= new Date(start_time)) {
            return NextResponse.json({ error: 'Jam tutup jendela waktu harus setelah jam buka' }, { status: 400 })
        }

        // 1. Get source exam
        const { data: sourceExam, error: sourceError } = await supabase
            .from('official_exams')
            .select('*')
            .eq('id', source_exam_id)
            .single()

        if (sourceError || !sourceExam) {
            return NextResponse.json({ error: 'Source exam not found' }, { status: 404 })
        }

        // Tenant guard: source exam harus milik sekolah caller — tanpa ini
        // guru/admin bisa membaca soal + kunci jawaban ujian sekolah lain
        // dan menyuntik duplikat ke sekolah sumber (school_id ikut sumber).
        if (tenantMismatch((sourceExam as any).school_id, schoolId)) {
            return NextResponse.json({ error: 'Source exam not found' }, { status: 404 })
        }

        // Validasi kelas target efektif (payload bila diisi, jika tidak target
        // sumber): wajib milik sekolah caller + tahun ajaran exam. Duplicate
        // adalah jalur utama polusi — exam sumber lama bisa membawa kelas
        // tahun ajaran lampau yang ikut tersalin diam-diam.
        const effectiveTargetForValidation = (Array.isArray(target_class_ids) && target_class_ids.length > 0)
            ? target_class_ids
            : sourceExam.target_class_ids
        const targetValidation = await validateTargetClassIds(
            effectiveTargetForValidation,
            schoolId,
            sourceExam.academic_year_id
        )
        if (!targetValidation.ok) {
            return NextResponse.json({ error: targetValidation.errorMessage }, { status: 400 })
        }

        // Kepemilikan guru: boleh menyalin bila dia mengajar mapel source exam
        // di ≥1 kelas target (guard baca longgar — paritas questions route &
        // monitor yang sudah allow guru mengajar sebagian kelas). Target tetap
        // ketat: guru harus ajar SEMUA kelas target yang dipilih (payload).
        // Sebelumnya: sourceOk pakai canManageOfficialExam = ajar SEMUA kelas
        // sumber → guru parsial (1 dari 6) selalu 403 walau cuma duplikasi ke
        // kelasnya sendiri. Padahal guru sudah punya akses baca soal + kunci.
        if (user.role === 'GURU') {
            const effectiveTarget = (Array.isArray(target_class_ids) && target_class_ids.length > 0)
                ? target_class_ids
                : sourceExam.target_class_ids
            const scope = await getTeacherScope(user.id, sourceExam.academic_year_id)
            // Source: ajar mapel di ≥1 kelas sumber (guard longgar — guru
            // sudah bisa baca soal via questions route dengan guard yang sama)
            const sourceOk = (sourceExam.target_class_ids || []).some((cid: string) =>
                coTeachesClassSubject(scope, sourceExam.subject_id, cid)
            )
            // Target: ajar mapel di SEMUA kelas target (guard ketat —
            // mencegah duplikasi ke kelas yang guru tidak ajar)
            const targetOk = await canManageOfficialExam(user, {
                subject_id: sourceExam.subject_id,
                target_class_ids: effectiveTarget,
                academic_year_id: sourceExam.academic_year_id
            })
            if (!sourceOk || !targetOk) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke ujian ini atau kelas targetnya' }, { status: 403 })
            }
        }

        // ── Guard duplikat-judul (paritas POST /api/official-exams) ──
        // Scope: school_id + subject_id + academic_year_id + target_class overlap.
        // Kontrak tahun-scoping: tahun beda = tidak collision. Remedial dikecualikan.
        // force_duplicate = override eksplisit setelah dialog konfirmasi.
        if (!force_duplicate && !is_remedial) {
            const effectiveTarget = (Array.isArray(target_class_ids) && target_class_ids.length > 0)
                ? target_class_ids
                : sourceExam.target_class_ids
            const dupe = await checkOfficialExamDuplicate({
                supabase,
                schoolId: sourceExam.school_id,
                subjectId: sourceExam.subject_id,
                academicYearId: sourceExam.academic_year_id,
                title,
                targetClassIds: effectiveTarget || [],
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

        // 2. Insert new exam
        const newExamData: any = {
            exam_type: sourceExam.exam_type,
            title,
            description: sourceExam.description,
            start_time,
            duration_minutes: duration_minutes || sourceExam.duration_minutes,
            window_end_time: window_end_time || null,
            is_active: false, // Default to inactive/draft
            is_randomized: sourceExam.is_randomized,
            max_violations: sourceExam.max_violations,
            // Array kosong (truthy) fallback ke target sumber — lihat catatan scope di atas
            target_class_ids: (Array.isArray(target_class_ids) && target_class_ids.length > 0)
                ? target_class_ids
                : sourceExam.target_class_ids,
            subject_id: sourceExam.subject_id,
            school_id: sourceExam.school_id,
            academic_year_id: sourceExam.academic_year_id,
            show_results_immediately: sourceExam.show_results_immediately,
            results_released: false,
            target_levels: sourceExam.target_levels,
            created_by: user.id
        }

        // Add remedial specific fields if provided
        if (is_remedial) {
            newExamData.is_remedial = true
            newExamData.remedial_for_id = source_exam_id
            newExamData.allowed_student_ids = allowed_student_ids || null
            Object.assign(newExamData, policyFields)
        }

        const { data: newExam, error: insertExamError } = await supabase
            .from('official_exams')
            .insert(newExamData)
            .select()
            .single()

        if (insertExamError) {
            console.error('Error inserting new exam:', insertExamError)
            // Handle if columns don't exist yet gracefully
            if (insertExamError.message.includes('remedial')) {
                return NextResponse.json({ error: 'Database belum di-update. Tolong jalankan SQL migrasi untuk remedial.' }, { status: 500 })
            }
            throw insertExamError
        }

        // 3. Get source exam questions
        // Guard runaway (paritas examBatch.ts): sumber anomali >500 soal ditolak —
        // kandidat data terduplikasi, tidak layak disalin ke ujian baru.
        const { data: sourceQuestions, error: questionsError } = await supabase
            .from('official_exam_questions')
            .select('*')
            .eq('exam_id', source_exam_id)

        // 4. Insert questions to new exam — kegagalan select/insert menggagalkan duplikasi
        //    (ujian baru di-rollback agar tidak jadi ujian yatim 0 soal)
        if (questionsError) {
            console.error('Error fetching source questions for duplicate:', questionsError)
            await supabase.from('official_exams').delete().eq('id', newExam.id)
            return NextResponse.json({ error: 'Gagal membaca soal sumber. Duplikasi dibatalkan.' }, { status: 500 })
        }

        if ((sourceQuestions || []).length > 500) {
            console.error(`[duplicate] ABORT: ujian resmi ${source_exam_id} punya ${sourceQuestions!.length} soal (> 500) — data anomali.`)
            await supabase.from('official_exams').delete().eq('id', newExam.id)
            return NextResponse.json({ error: 'Sumber punya soal melebihi batas (kemungkinan terduplikasi). Periksa ujian sumber.' }, { status: 400 })
        }

        if (sourceQuestions && sourceQuestions.length > 0) {
            const newQuestions = sourceQuestions.map((q: any) => ({
                exam_id: newExam.id,
                question_text: q.question_text,
                question_type: q.question_type,
                options: q.options,
                correct_answer: q.correct_answer,
                points: q.points,
                order_index: q.order_index,
                difficulty: q.difficulty,
                passage_text: q.passage_text,
                passage_audio_url: q.passage_audio_url,
                image_url: q.image_url,
                status: q.status, // Inherit approval status
                teacher_hots_claim: q.teacher_hots_claim,
                text_direction: q.text_direction,
                content_format: q.content_format,
                gk_grading_mode: q.gk_grading_mode ?? 'PROPORTIONAL'
            }))

            const { error: duplicateError } = await supabase
                .from('official_exam_questions')
                .insert(newQuestions)

            if (duplicateError) {
                console.error('Error inserting duplicated questions:', duplicateError)
                await supabase.from('official_exams').delete().eq('id', newExam.id)
                return NextResponse.json({ error: 'Gagal menyalin soal. Duplikasi dibatalkan.' }, { status: 500 })
            }
        }

        // 5. Send notifications if remedial
        if (is_remedial && allowed_student_ids && allowed_student_ids.length > 0) {
            try {
                // batchedIn: ratusan siswa remedial melebihi batas URL 16KB
                const students = await batchedIn<{ user_id: string }>(
                    'id', allowed_student_ids,
                    (chunk) => supabase.from('students').select('user_id').in('id', chunk)
                )

                if (students && students.length > 0) {
                    const startDate = new Date(start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
                    const labels = await getMenuLabelsForSchool(schoolId)
                    const examLabel = sourceExam.exam_type === 'UTS' ? labels.uts : labels.uas
                    // Remedial bisa dibuat ADMIN maupun GURU — teks menyesuaikan pembuat
                    const creator = user.role === 'GURU' ? 'Guru' : 'Admin'

                    await supabase.from('notifications').insert(
                        students.map((s) => ({
                            user_id: s.user_id,
                            type: 'UJIAN_RESMI', // Using existing type for official exams
                            title: `Remedial ${examLabel}: ${title}`,
                            message: `${creator} telah membuat ujian remedial untuk Anda. Dimulai pada: ${startDate}`,
                            link: '/dashboard/siswa/ulangan'
                        }))
                    )
                }
            } catch (notifError) {
                console.error('Error sending official remedial notification:', notifError)
            }
        }

        return NextResponse.json(newExam)
    } catch (error) {
        console.error('Error duplicating official exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
