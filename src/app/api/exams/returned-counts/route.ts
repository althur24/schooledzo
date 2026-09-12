import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { pickBatchRepresentativeIds } from '@/lib/examBatch'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get this teacher's ID
        const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (!teacher) {
            return NextResponse.json([])
        }

        // TA guru ini — dipakai scope co-teaching (mapel+kelas), bukan hanya
        // TA milik sendiri: kelas multi-pengampu = 1 exam, semua pengampu
        // harus melihat badge "Perlu Diperbaiki" exam yang sama.
        const { data: assignments } = await supabase
            .from('teaching_assignments')
            .select('id, subject_id, class_id')
            .eq('teacher_id', teacher.id)

        if (!assignments || assignments.length === 0) {
            return NextResponse.json([])
        }

        const pairSet = new Set(assignments.map(a => `${a.subject_id}|${a.class_id}`))
        const classIds = [...new Set(assignments.map(a => a.class_id).filter(Boolean))]

        // Get exams with returned questions — pre-filter per kelas (murah di
        // DB), lalu exact pair mapel+kelas post-fetch (guru hanya co-teacher
        // untuk mapel yang dia ampau, bukan semua exam di kelas itu).
        const { data: exams, error } = await supabase
            .from('exams')
            .select(`
                id,
                title,
                batch_id,
                pending_publish,
                created_at,
                questions:exam_questions(id, status),
                ta:teaching_assignments!inner(subject_id, class_id)
            `)
            .in('ta.class_id', classIds)

        if (error) {
            console.error('Error fetching returned exam counts:', error)
            return NextResponse.json({ error: 'Database error' }, { status: 500 })
        }

        const pairVisible = (e: any) => {
            const ta = Array.isArray(e.ta) ? e.ta[0] : e.ta
            return pairSet.has(`${ta?.subject_id}|${ta?.class_id}`)
        }
        const visibleExams = (exams || []).filter(pairVisible)

        // Batch multi-kelas berbagi soal identik (mirror) — badge "Perlu Diperbaiki"
        // cukup di satu representative exam, bukan di setiap sibling
        const representativeIds = new Set(pickBatchRepresentativeIds(visibleExams))

        const returnedSummary = visibleExams
            .filter(e => representativeIds.has(e.id))
            .map(e => {
                const returnedQuestions = (e.questions || []).filter((question: any) => question.status === 'returned')
                return {
                    examId: e.id,
                    title: e.title,
                    returnedCount: returnedQuestions.length
                }
            })
            .filter(e => e.returnedCount > 0)

        return NextResponse.json(returnedSummary)
    } catch (error) {
        console.error('Error in returned summary:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
