import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch } from '@/lib/tenantGuard'
import { canManageOfficialExam } from '@/lib/teacherScope'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'
import { batchedIn } from '@/lib/batchedIn'
import { sanitizePolicyInput } from '@/lib/remedialScore'

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
            remedial_max_score
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

        // Kepemilikan guru: boleh menyalin hanya bila dia mengajar mapel source exam
        // DAN semua kelas targetnya (kecuali target diganti — cek target baru)
        if (user.role === 'GURU') {
            // Array kosong adalah truthy di JS — fallback ke target sumber agar
            // tidak lahir ujian tanpa kelas target dari payload kosong.
            const effectiveTarget = (Array.isArray(target_class_ids) && target_class_ids.length > 0)
                ? target_class_ids
                : sourceExam.target_class_ids
            const sourceOk = await canManageOfficialExam(user, sourceExam)
            const targetOk = sourceOk && await canManageOfficialExam(user, {
                subject_id: sourceExam.subject_id,
                target_class_ids: effectiveTarget,
                academic_year_id: sourceExam.academic_year_id
            })
            if (!sourceOk || !targetOk) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke ujian ini atau kelas targetnya' }, { status: 403 })
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
                text_direction: q.text_direction
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
