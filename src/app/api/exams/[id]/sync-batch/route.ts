import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { resolveExamSchoolId, tenantMismatch } from '@/lib/tenantGuard'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'
import { syncExamBatch } from '@/lib/examBatch'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'

// POST /api/exams/:id/sync-batch — salin ulang soal + terbitkan semua kelas satu batch.
// Dipakai tombol "Salin Ulang Soal" setelah kegagalan penyalinan sebagian.
export async function POST(
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

        const { data: exam } = await supabase
            .from('exams').select('teaching_assignment_id, batch_id').eq('id', id).single()
        if (!exam) {
            const labels = await getMenuLabelsForSchool(schoolId)
            return NextResponse.json({ error: `${labels.ulangan} tidak ditemukan` }, { status: 404 })
        }

        // Tenant guard: ulangan harus milik sekolah caller
        if (tenantMismatch(await resolveExamSchoolId(id), schoolId)) {
            const labels = await getMenuLabelsForSchool(schoolId)
            return NextResponse.json({ error: `${labels.ulangan} tidak ditemukan` }, { status: 404 })
        }

        // Guru hanya boleh sync ujian miliknya sendiri
        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers').select('id').eq('user_id', user.id).single()
            const { data: ta } = await supabase
                .from('teaching_assignments').select('teacher_id').eq('id', exam.teaching_assignment_id).single()
            if (!teacher || ta?.teacher_id !== teacher.id) {
                return NextResponse.json({ error: 'Anda tidak memiliki akses ke ujian ini' }, { status: 403 })
            }
        }

        if (!exam.batch_id) return NextResponse.json({ success: true, total: 0, failed: [] })

        if (exam.teaching_assignment_id) {
            const yearStatus = await getYearStatusByTA(exam.teaching_assignment_id)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        const result = await syncExamBatch(id)
        return NextResponse.json({ success: result.failed.length === 0, ...result })
    } catch (error: any) {
        console.error('API /exams/sync-batch error:', error)
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 })
    }
}
