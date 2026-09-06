import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound } from '@/lib/tenantGuard'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'

// E3 Rescue draft: siswa kembali SETELAH attempt ditutup paksa (waktu habis /
// kuis dinonaktifkan) tetapi perangkatnya masih menyimpan jawaban yang belum
// sempat terkirim. Jawaban di-merge ke snapshot (menang per soal) dan submission
// ditandai needs_manual_review supaya guru bisa meninjau manual.
// Skor & tanggal TIDAK diubah — keputusan nilai sepenuhnya di tangan guru.
export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await context.params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'SISWA') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { answers } = await request.json()
        if (!Array.isArray(answers) || answers.length === 0) {
            return NextResponse.json({ error: 'Tidak ada jawaban untuk dikirim' }, { status: 400 })
        }

        const { data: sub } = await supabase
            .from('quiz_submissions')
            .select(`
                id, answers, submitted_at,
                student:students(user_id),
                quiz:quizzes(teaching_assignment:teaching_assignments(academic_year:academic_years(school_id)))
            `)
            .eq('id', id)
            .single()

        if (!sub) {
            return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
        }

        // Harus attempt milik siswa ini (IDOR guard)
        const rawStudent = Array.isArray(sub.student) ? (sub.student as any[])[0] : (sub.student as any)
        if (rawStudent?.user_id !== user.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        // Tenant guard
        const rawTa = (sub.quiz as any)?.teaching_assignment
        const ta = Array.isArray(rawTa) ? rawTa[0] : rawTa
        const subSchoolId = Array.isArray(ta?.academic_year) ? ta?.academic_year?.[0]?.school_id : ta?.academic_year?.school_id
        if (tenantMismatch(subSchoolId, schoolId)) {
            return notFound()
        }

        // Hanya untuk attempt yang SUDAH ditutup — attempt yang masih berjalan
        // harus lewat jalur autosave/submit biasa.
        if (!sub.submitted_at) {
            const labels = await getMenuLabelsForSchool(schoolId)
            return NextResponse.json({ error: `${labels.kuis} masih berjalan — gunakan tombol simpan biasa` }, { status: 400 })
        }

        // Merge per soal: snapshot server dulu, incoming (rescue) menang
        const stored: any[] = Array.isArray(sub.answers) ? sub.answers : []
        const mergedMap = new Map<string, any>()
        stored.forEach(a => { if (a?.question_id) mergedMap.set(a.question_id, a) })
        answers.forEach((a: { question_id: string; answer: string }) => {
            if (!a?.question_id) return
            mergedMap.set(a.question_id, { ...mergedMap.get(a.question_id), question_id: a.question_id, answer: a.answer })
        })
        const mergedAnswers = Array.from(mergedMap.values())

        const { error } = await supabase
            .from('quiz_submissions')
            .update({
                answers: mergedAnswers,
                needs_manual_review: true
            })
            .eq('id', id)

        if (error) throw error

        return NextResponse.json({ rescued: true })
    } catch (error) {
        console.error('Error rescuing draft:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
