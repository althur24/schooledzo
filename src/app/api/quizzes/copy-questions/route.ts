import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getYearStatusById, archivedYearResponse } from '@/lib/academicYear'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export async function POST(req: NextRequest) {
    try {
        // Auth check
        const ctx = await getSchoolContextOrError(req)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json()
        const { source_quiz_id, target_quiz_ids, also_publish } = body

        if (!source_quiz_id || !Array.isArray(target_quiz_ids) || target_quiz_ids.length === 0) {
            return NextResponse.json(
                { error: 'source_quiz_id and target_quiz_ids (array) are required' },
                { status: 400 }
            )
        }

        // Block writes to archived (COMPLETED) academic years (checked per target quiz)
        const { data: targetQuizzes } = await supabase
            .from('quizzes')
            .select('teaching_assignment:teaching_assignments(academic_year_id)')
            .in('id', target_quiz_ids)
        const targetYearIds = [...new Set(
            (targetQuizzes || []).map((q: any) => q.teaching_assignment?.academic_year_id).filter(Boolean)
        )] as string[]
        for (const yearId of targetYearIds) {
            const yearStatus = await getYearStatusById(yearId)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
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

        // 2. Copy questions to each target (per-target error isolation).
        // Insert-first, delete-after: kalau insert gagal, soal lama di target tetap utuh.
        let totalCopied = 0
        const failedTargets: string[] = []
        const cleanupWarnings: string[] = []

        for (const targetId of target_quiz_ids) {
            try {
                // Prepare new questions for this target
                const questionsForTarget = sourceQuestions.map(q => {
                    const { id, quiz_id, created_at, ...rest } = q
                    return { ...rest, quiz_id: targetId }
                })

                // Snapshot soal yang ada di target (dibersihkan setelah insert sukses)
                const { data: oldRows, error: fetchOldError } = await supabase
                    .from('quiz_questions')
                    .select('id')
                    .eq('quiz_id', targetId)

                if (fetchOldError) {
                    console.error(`Error fetching old questions for target ${targetId}:`, fetchOldError)
                    failedTargets.push(targetId)
                    continue
                }
                const oldIds = (oldRows || []).map(r => r.id)

                // Insert copied questions FIRST — soal lama selamat kalau ini gagal
                const { error: insertError } = await supabase
                    .from('quiz_questions')
                    .insert(questionsForTarget)

                if (insertError) {
                    console.error(`Error inserting questions for target ${targetId}:`, insertError)
                    failedTargets.push(targetId)
                    continue
                }

                // Baru hapus soal lama setelah salinan berhasil dibuat
                if (oldIds.length > 0) {
                    const { error: deleteError } = await supabase
                        .from('quiz_questions')
                        .delete()
                        .in('id', oldIds)
                    if (deleteError) {
                        // Tidak fatal: target punya soal ganda sementara, bukan kehilangan soal
                        console.error(`Error cleaning old questions for target ${targetId}:`, deleteError)
                        cleanupWarnings.push(targetId)
                    }
                }

                totalCopied += questionsForTarget.length
            } catch (targetError) {
                console.error(`Unexpected error for target ${targetId}:`, targetError)
                failedTargets.push(targetId)
            }
        }

        // 3. Update also_publish for successfully copied targets
        if (also_publish) {
            const successTargets = target_quiz_ids.filter(id => !failedTargets.includes(id))
            if (successTargets.length > 0) {
                const { error: updateError } = await supabase
                    .from('quizzes')
                    .update({ is_active: true })
                    .in('id', successTargets)

                if (updateError) {
                    console.error('Error updating target quizzes publish state:', updateError)
                }
            }
        }

        return NextResponse.json({
            success: true,
            copied_count: totalCopied,
            failed_targets: failedTargets.length > 0 ? failedTargets : undefined,
            cleanup_warnings: cleanupWarnings.length > 0 ? cleanupWarnings : undefined
        })

    } catch (error: any) {
        console.error('API /quizzes/copy-questions error:', error)
        return NextResponse.json(
            { error: 'Internal Server Error', details: error.message },
            { status: 500 }
        )
    }
}
