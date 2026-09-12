import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { findExamsOutsideSchool } from '@/lib/tenantGuard'
import { getTeacherScope, ownsTeachingAssignment, coTeachesClassSubject } from '@/lib/teacherScope'
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
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json()
        const { source_exam_id, target_exam_ids, also_publish } = body

        if (!source_exam_id || !Array.isArray(target_exam_ids) || target_exam_ids.length === 0) {
            return NextResponse.json(
                { error: 'source_exam_id and target_exam_ids (array) are required' },
                { status: 400 }
            )
        }

        // Tenant guard: source & semua target harus milik sekolah caller.
        // Tanpa ini guru/admin bisa menyalin (membaca) soal + kunci jawaban
        // exam sekolah lain, atau menyuntik soal ke exam sekolah lain.
        const outside = await findExamsOutsideSchool([source_exam_id, ...target_exam_ids], schoolId)
        if (outside.length > 0) {
            return NextResponse.json({ error: 'Exam not found or not accessible' }, { status: 404 })
        }

        // Ownership guard: GURU hanya boleh menyalin dari/ke exam yang penugasannya
        // miliknya sendiri ATAU co-taught (mapel+kelas sama) — tanpa ini guru A bisa
        // menimpa seluruh soal exam guru B (sekolah sama) lalu menerbitkannya
        // via also_publish. Co-teacher pengampu kelas sama memang berhak.
        if (user.role === 'GURU') {
            const scope = await getTeacherScope(user.id)
            const { data: scopeExams } = await supabase
                .from('exams')
                .select('id, teaching_assignment:teaching_assignments(teacher_id, subject_id, class_id)')
                .in('id', [source_exam_id, ...target_exam_ids])
            for (const ex of scopeExams || []) {
                const ta = Array.isArray(ex.teaching_assignment) ? (ex.teaching_assignment as any)[0] : ex.teaching_assignment as any
                const isOwner = ownsTeachingAssignment(scope, ta?.teacher_id)
                if (!isOwner && !coTeachesClassSubject(scope, ta?.subject_id, ta?.class_id)) {
                    return NextResponse.json({ error: 'Anda hanya dapat menyalin soal dari/ke ulangan penugasan Anda sendiri' }, { status: 403 })
                }
            }
        }

        // Block writes to archived (COMPLETED) academic years (checked per target exam)
        const { data: targetExams } = await supabase
            .from('exams')
            .select('teaching_assignment:teaching_assignments(academic_year_id)')
            .in('id', target_exam_ids)
        const targetYearIds = [...new Set(
            (targetExams || []).map((e: any) => e.teaching_assignment?.academic_year_id).filter(Boolean)
        )] as string[]
        for (const yearId of targetYearIds) {
            const yearStatus = await getYearStatusById(yearId)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
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

        // 2. Copy questions to each target (per-target error isolation).
        // Insert-first, delete-after: kalau insert gagal, soal lama di target tetap utuh.
        let totalCopied = 0
        const failedTargets: string[] = []
        const cleanupWarnings: string[] = []

        for (const targetId of target_exam_ids) {
            try {
                // Prepare new questions for this target
                const questionsForTarget = sourceQuestions.map(q => {
                    const { id, exam_id, created_at, ...rest } = q
                    return { ...rest, exam_id: targetId }
                })

                // Snapshot soal yang ada di target (dibersihkan setelah insert sukses)
                const { data: oldRows, error: fetchOldError } = await supabase
                    .from('exam_questions')
                    .select('id')
                    .eq('exam_id', targetId)

                if (fetchOldError) {
                    console.error(`Error fetching old questions for target ${targetId}:`, fetchOldError)
                    failedTargets.push(targetId)
                    continue
                }
                const oldIds = (oldRows || []).map(r => r.id)

                // Insert copied questions FIRST — soal lama selamat kalau ini gagal
                const { error: insertError } = await supabase
                    .from('exam_questions')
                    .insert(questionsForTarget)

                if (insertError) {
                    console.error(`Error inserting questions for target ${targetId}:`, insertError)
                    failedTargets.push(targetId)
                    continue
                }

                // Baru hapus soal lama setelah salinan berhasil dibuat
                if (oldIds.length > 0) {
                    const { error: deleteError } = await supabase
                        .from('exam_questions')
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

        // 3. also_publish untuk target yang berhasil disalin — WAJIB mengikuti
        // publish gate yang sama dengan PUT /api/exams/[id]. Tanpa ini guru bisa
        // menerbitkan exam berisi soal draft/returned via copy-questions
        // (termasuk self-target: source sekaligus target), bypass total gate.
        // Soal target = salinan persis sumber, jadi status sumber mewakili semua.
        let publishBlockedTargets: string[] = []
        let publishPendingTargets: string[] = []
        if (also_publish) {
            const counts = {
                draft: sourceQuestions.filter(q => q.status === 'draft').length,
                ai_reviewing: sourceQuestions.filter(q => q.status === 'ai_reviewing').length,
                admin_review: sourceQuestions.filter(q => q.status === 'admin_review').length,
                returned: sourceQuestions.filter(q => q.status === 'returned').length,
            }
            const successTargets = target_exam_ids.filter(id => !failedTargets.includes(id))
            if (successTargets.length > 0) {
                if (counts.draft + counts.ai_reviewing + counts.returned > 0) {
                    // Ada soal belum selesai review — jangan aktifkan (paritas gate
                    // PUT yang menolak 400). Copy tetap sah, hanya publish ditahan.
                    publishBlockedTargets = successTargets
                } else if (counts.admin_review > 0) {
                    // Menunggu approve admin — tandai pending_publish; autoPublish
                    // akan menerbitkan otomatis saat semua soal approved.
                    publishPendingTargets = successTargets
                    const { error: updateError } = await supabase
                        .from('exams')
                        .update({ is_active: false, pending_publish: true })
                        .in('id', successTargets)
                    if (updateError) {
                        console.error('Error marking targets pending_publish:', updateError)
                    }
                } else {
                    const { error: updateError } = await supabase
                        .from('exams')
                        .update({ is_active: true })
                        .in('id', successTargets)

                    if (updateError) {
                        console.error('Error updating target exams publish state:', updateError)
                    }
                }
            }
        }

        return NextResponse.json({
            success: true,
            copied_count: totalCopied,
            failed_targets: failedTargets.length > 0 ? failedTargets : undefined,
            cleanup_warnings: cleanupWarnings.length > 0 ? cleanupWarnings : undefined,
            publish_blocked: publishBlockedTargets.length > 0 ? publishBlockedTargets : undefined,
            publish_pending: publishPendingTargets.length > 0 ? publishPendingTargets : undefined,
        })

    } catch (error: any) {
        console.error('API /exams/copy-questions error:', error)
        return NextResponse.json(
            { error: 'Internal Server Error', details: error.message },
            { status: 500 }
        )
    }
}
