import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { source_exam_id, target_exam_ids, also_publish } = body

        if (!source_exam_id || !Array.isArray(target_exam_ids) || target_exam_ids.length === 0) {
            return NextResponse.json(
                { error: 'source_exam_id and target_exam_ids (array) are required' },
                { status: 400 }
            )
        }

        // 1. Fetch source questions
        const { data: sourceQuestions, error: fetchError } = await supabase
            .from('exam_questions')
            .select('*')
            .eq('exam_id', source_exam_id)

        if (fetchError) {
            console.error('Error fetching source questions:', fetchError)
            return NextResponse.json({ error: fetchError.message }, { status: 500 })
        }

        if (!sourceQuestions || sourceQuestions.length === 0) {
            return NextResponse.json({ message: 'No questions to copy' })
        }

        // 2. Prepare inserts for all targets
        const newQuestions = []
        for (const targetId of target_exam_ids) {
            // Optional: delete existing questions in target before copying
            await supabase.from('exam_questions').delete().eq('exam_id', targetId)

            for (const q of sourceQuestions) {
                // omit id, exam_id, created_at
                const { id, exam_id, created_at, ...rest } = q
                newQuestions.push({
                    ...rest,
                    exam_id: targetId
                })
            }
        }

        // 3. Insert copied questions
        if (newQuestions.length > 0) {
            const { error: insertError } = await supabase
                .from('exam_questions')
                .insert(newQuestions)

            if (insertError) {
                console.error('Error inserting copied questions:', insertError)
                return NextResponse.json({ error: insertError.message }, { status: 500 })
            }
        }

        // 4. Update also_publish for targets
        if (also_publish) {
            const { error: updateError } = await supabase
                .from('exams')
                .update({ 
                    is_active: true
                })
                .in('id', target_exam_ids)

            if (updateError) {
                console.error('Error updating target exams publish state:', updateError)
                // non-fatal, continue
            }
        }

        return NextResponse.json({ success: true, copied_count: newQuestions.length })

    } catch (error: any) {
        console.error('API /exams/copy-questions error:', error)
        return NextResponse.json(
            { error: 'Internal Server Error', details: error.message },
            { status: 500 }
        )
    }
}
