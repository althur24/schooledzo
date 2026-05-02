import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const {
            source_exam_id,
            title,
            start_time,
            duration_minutes,
            target_class_ids,
            is_remedial,
            allowed_student_ids
        } = body

        if (!source_exam_id || !title || !start_time) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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

        // 2. Insert new exam
        const newExamData: any = {
            exam_type: sourceExam.exam_type,
            title,
            description: sourceExam.description,
            start_time,
            duration_minutes: duration_minutes || sourceExam.duration_minutes,
            is_active: false, // Default to inactive/draft
            is_randomized: sourceExam.is_randomized,
            max_violations: sourceExam.max_violations,
            target_class_ids: target_class_ids || sourceExam.target_class_ids,
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

        // 4. Insert questions to new exam
        if (!questionsError && sourceQuestions && sourceQuestions.length > 0) {
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

            if (duplicateError) throw duplicateError
        }

        // 5. Send notifications if remedial
        if (is_remedial && allowed_student_ids && allowed_student_ids.length > 0) {
            try {
                const { data: students } = await supabase
                    .from('students')
                    .select('user_id')
                    .in('id', allowed_student_ids)

                if (students && students.length > 0) {
                    const startDate = new Date(start_time).toLocaleString('id-ID')
                    const examLabel = sourceExam.exam_type === 'UTS' ? 'UTS' : 'UAS'
                    
                    await supabase.from('notifications').insert(
                        students.map((s: any) => ({
                            user_id: s.user_id,
                            type: 'UJIAN_RESMI', // Using existing type for official exams
                            title: `Remedial ${examLabel}: ${title}`,
                            message: `Admin telah membuat ujian remedial untuk Anda. Dimulai pada: ${startDate}`,
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
