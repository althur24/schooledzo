import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'
import { syncQuizBatch } from '@/lib/examBatch'

// POST /api/quizzes/:id/sync-batch — salin ulang soal + terbitkan semua kelas satu batch.
// Dipakai tombol "Salin Ulang Soal" setelah kegagalan penyalinan sebagian.
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: quiz } = await supabase
            .from('quizzes').select('teaching_assignment_id, batch_id').eq('id', id).single()
        if (!quiz) return NextResponse.json({ error: 'Kuis tidak ditemukan' }, { status: 404 })
        if (!quiz.batch_id) return NextResponse.json({ success: true, total: 0, failed: [] })

        if (quiz.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(quiz.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        const result = await syncQuizBatch(id)
        return NextResponse.json({ success: result.failed.length === 0, ...result })
    } catch (error: any) {
        console.error('API /quizzes/sync-batch error:', error)
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 })
    }
}
