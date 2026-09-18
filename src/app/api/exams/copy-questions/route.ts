import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { findExamsOutsideSchool } from '@/lib/tenantGuard'
import { getTeacherScope, ownsTeachingAssignment, coTeachesClassSubject } from '@/lib/teacherScope'
import { getYearStatusById, archivedYearResponse } from '@/lib/academicYear'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Batas soal sumber yang masih disalin — paritas guard runaway examBatch.ts
 * (kasus 2026-09-16: exam anomali 35k–224k soal tidak boleh bisa disalin).
 */
const SOURCE_QUESTIONS_LIMIT = 500

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
        // M2 (audit eksternal): batchedIn — batch besar (mis. salin ke 20+ kelas
        // paralel) melewati batas URL 16KB pada .in() mentah.
        if (user.role === 'GURU') {
            const scope = await getTeacherScope(user.id)
            const scopeExams = await batchedIn<any>('id', [source_exam_id, ...target_exam_ids], (chunk) =>
                supabase
                    .from('exams')
                    .select('id, teaching_assignment:teaching_assignments(teacher_id, subject_id, class_id)')
                    .in('id', chunk))
            for (const ex of scopeExams || []) {
                const ta = Array.isArray(ex.teaching_assignment) ? (ex.teaching_assignment as any)[0] : ex.teaching_assignment as any
                const isOwner = ownsTeachingAssignment(scope, ta?.teacher_id)
                if (!isOwner && !coTeachesClassSubject(scope, ta?.subject_id, ta?.class_id)) {
                    return NextResponse.json({ error: 'Anda hanya dapat menyalin soal dari/ke ulangan penugasan Anda sendiri' }, { status: 403 })
                }
            }
        }

        // Block writes to archived (COMPLETED) academic years (checked per target exam)
        const targetExams = await batchedIn<any>('id', target_exam_ids, (chunk) =>
            supabase
                .from('exams')
                .select('teaching_assignment:teaching_assignments(academic_year_id)')
                .in('id', chunk))
        const targetYearIds = [...new Set(
            (targetExams || []).map((e: any) => e.teaching_assignment?.academic_year_id).filter(Boolean)
        )] as string[]
        for (const yearId of targetYearIds) {
            const yearStatus = await getYearStatusById(yearId)
            if (yearStatus === 'COMPLETED') return archivedYearResponse()
        }

        // 1. Fetch source questions
        // fetchAllRows + order pedagogis: exam bisa punya >1000 baris (anomali) —
        // query biasa terpotong diam-diam di 1000; order_index dulu (bukan id —
        // UUID acak) agar baris hasil salinan ter-insert terurut = urutan fisik tabel.
        const sourceQuestions = await fetchAllRows(supabase
            .from('exam_questions')
            .select('*')
            .eq('exam_id', source_exam_id)
            .order('order_index', { ascending: true })
            .order('id'))

        if (!sourceQuestions || sourceQuestions.length === 0) {
            return NextResponse.json({ message: 'No questions to copy' })
        }

        // Guard runaway: sumber anomali ditolak — menyalinnya hanya melipatgandakan
        // kerusakan ke target-target (paritas SOURCE_QUESTIONS_LIMIT examBatch.ts).
        if (sourceQuestions.length > SOURCE_QUESTIONS_LIMIT) {
            console.error(`[copy-questions] ABORT: sumber ${source_exam_id} punya ${sourceQuestions.length} soal (> ${SOURCE_QUESTIONS_LIMIT}) — data anomali.`)
            return NextResponse.json(
                { error: `Sumber punya ${sourceQuestions.length} soal — di atas batas ${SOURCE_QUESTIONS_LIMIT}. Periksa ulangan sumber (kemungkinan soal terduplikasi).` },
                { status: 400 }
            )
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

                // Snapshot soal yang ada di target (dibersihkan setelah insert sukses).
                // fetchAllRows: target bekas anomali bisa >1000 baris.
                const oldRows = await fetchAllRows(supabase
                    .from('exam_questions')
                    .select('id')
                    .eq('exam_id', targetId)
                    .order('id'))
                const oldIds = (oldRows || []).map((r: any) => r.id)

                // Insert copied questions FIRST — soal lama selamat kalau ini gagal.
                // Chunk 500 + T1 fix: satu chunk gagal = SELURUH target gagal
                // (break, bukan continue) dan delete soal lama DI-SKIP — tanpa
                // ini insert parsial + delete lama = target kehilangan soal.
                let insertOk = true
                for (let i = 0; i < questionsForTarget.length; i += 500) {
                    const { error: insertError } = await supabase
                        .from('exam_questions')
                        .insert(questionsForTarget.slice(i, i + 500))
                    if (insertError) {
                        console.error(`Error inserting questions for target ${targetId}:`, insertError)
                        insertOk = false
                        break
                    }
                }
                if (!insertOk) {
                    failedTargets.push(targetId)
                    continue
                }

                // Baru hapus soal lama setelah salinan berhasil dibuat.
                // batchedIn chunk 100: delete .in(>±440 id) ditolak URL-limit 16KB
                // — akar runaway 2026-09-16 (duplikat menetap permanen).
                // Callback mengembalikan builder (kontrak {data,error} batchedIn);
                // callback void membuat destructure TypeError = false warning.
                if (oldIds.length > 0) {
                    try {
                        await batchedIn('id', oldIds, (chunk) =>
                            supabase
                                .from('exam_questions')
                                .delete()
                                .in('id', chunk)
                        )
                    } catch (deleteErr: any) {
                        // Tidak fatal utk soal lama (sudah tersalin), tapi duplikat
                        // menetap harus dilaporkan eksplisit ke caller.
                        console.error(`Error cleaning old questions for target ${targetId}:`, deleteErr)
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
                // M2 (audit eksternal): update publish/pending per chunk 100 —
                // .in() mentah dengan banyak target kena batas URL 16KB.
                const updateTargetsBatched = async (updateData: Record<string, unknown>) => {
                    await batchedIn('id', successTargets, async (chunk) => {
                        const { error: updateError } = await supabase
                            .from('exams')
                            .update(updateData)
                            .in('id', chunk)
                        if (updateError) throw new Error(updateError.message)
                    })
                }
                if (counts.draft + counts.ai_reviewing + counts.returned > 0) {
                    // Ada soal belum selesai review — jangan aktifkan (paritas gate
                    // PUT yang menolak 400). Copy tetap sah, hanya publish ditahan.
                    publishBlockedTargets = successTargets
                } else if (counts.admin_review > 0) {
                    // Menunggu approve admin — tandai pending_publish; autoPublish
                    // akan menerbitkan otomatis saat semua soal approved.
                    publishPendingTargets = successTargets
                    try {
                        await updateTargetsBatched({ is_active: false, pending_publish: true })
                    } catch (updateError: any) {
                        console.error('Error marking targets pending_publish:', updateError)
                    }
                } else {
                    try {
                        await updateTargetsBatched({ is_active: true })
                    } catch (updateError: any) {
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
