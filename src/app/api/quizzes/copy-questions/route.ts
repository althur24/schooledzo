import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { source_quiz_id, target_quiz_ids, also_publish } = body

        if (!source_quiz_id || !Array.isArray(target_quiz_ids) || target_quiz_ids.length === 0) {
            return NextResponse.json(
                { error: 'source_quiz_id and target_quiz_ids (array) are required' },
                { status: 400 }
            )
        }

        // 1. Fetch source questions
        const { data: sourceQuestions, error: fetchError } = await supabase
            .from('quiz_questions')
            .select('*')
            .eq('quiz_id', source_quiz_id)

        if (fetchError) {
            console.error('Error fetching source questions:', fetchError)
            return NextResponse.json({ error: fetchError.message }, { status: 500 })
        }

        if (!sourceQuestions || sourceQuestions.length === 0) {
            return NextResponse.json({ message: 'No questions to copy' })
        }

        // 2. Prepare inserts for all targets
        const newQuestions = []
        for (const targetId of target_quiz_ids) {
            // Optional: delete existing questions in target before copying
            await supabase.from('quiz_questions').delete().eq('quiz_id', targetId)

            for (const q of sourceQuestions) {
                // omit id, quiz_id, created_at
                const { id, quiz_id, created_at, ...rest } = q
                newQuestions.push({
                    ...rest,
                    quiz_id: targetId
                })
            }
        }

        // 3. Insert copied questions
        if (newQuestions.length > 0) {
            const { error: insertError } = await supabase
                .from('quiz_questions')
                .insert(newQuestions)

            if (insertError) {
                console.error('Error inserting copied questions:', insertError)
                return NextResponse.json({ error: insertError.message }, { status: 500 })
            }
        }

        // 4. Update also_publish for targets
        if (also_publish) {
            const { error: updateError } = await supabase
                .from('quizzes')
                .update({ 
                    is_active: true
                })
                .in('id', target_quiz_ids)

            if (updateError) {
                console.error('Error updating target quizzes publish state:', updateError)
                // non-fatal, continue
            }
        }

        return NextResponse.json({ success: true, copied_count: newQuestions.length })

    } catch (error: any) {
        console.error('API /quizzes/copy-questions error:', error)
        return NextResponse.json(
            { error: 'Internal Server Error', details: error.message },
            { status: 500 }
        )
    }
}
