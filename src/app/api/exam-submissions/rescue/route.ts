import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { findExamsOutsideSchool } from '@/lib/tenantGuard'
import { gradeAnswer, needsManualGrading } from '@/lib/questionTypeUtils'
import { getExamQuestionsForGrading } from '@/lib/examQuestionsCache'
import { logGradeChange } from '@/lib/gradeHistory'

/**
 * POST /api/exam-submissions/rescue — selamatkan draft jawaban offline yang
 * tak pernah sampai ke server (kasus: paksa-kumpul karena pelanggaran /
 * sweep waktu terjadi saat koneksi siswa putus → autosave gagal semua →
 * server menutup submission dengan 0 jawaban tersimpan → nilai 0).
 *
 * Client mengirim draft dari localStorage perangkat tempat ujian dikerjakan
 * (+ `kind` pilih tabel ulangan/UTS-UAS — bukan data otoritatif, hanya
 * pemilih tabel; semua otorisasi tetap divalidasi server).
 * Server MEMVALIDASI ISI (bukan memercayai client):
 *   1. SISWA hanya boleh men-rescue submission miliknya sendiri.
 *   2. Tenant guard: ujian milik sekolah caller.
 *   3. Draft difilter ke soal yang benar-benar ada di ujian ini.
 *   4. Jawaban yang sudah ada di server TIDAK ditimpa (server menang per
 *      soal — mencegah abuse menulis jawaban setelah melihat kunci).
 *   5. Grading memakai jalur resmi yang sama dengan submit normal
 *      (gradeAnswer + gk_grading_mode); tipe manual (isian/essay) disimpan
 *      tanpa poin — menunggu koreksi guru.
 *   6. total_score direkap ulang dari SELURUH jawaban submission, is_graded
 *      dihitung ulang, dan perubahan tercatat di grade_history (audit).
 *
 * Idempotent: pemanggilan ulang dengan draft yang sama tidak mengubah
 * perhitungan (hanya menambah baris jawaban yang belum ada).
 */

interface RescueAnswer {
    question_id: string
    answer: string
}

interface RescuePayload {
    submission_id?: string
    kind?: 'exam' | 'official'
    answers?: RescueAnswer[]
}

export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'SISWA') {
            return NextResponse.json({ error: 'Hanya siswa yang dapat men-rescue draft' }, { status: 403 })
        }

        const body = await request.json().catch(() => null) as RescuePayload | null
        const submissionId = body?.submission_id
        const kind = body?.kind === 'official' ? 'official' : 'exam'
        const draftAnswers = body?.answers

        if (!submissionId || typeof submissionId !== 'string') {
            return NextResponse.json({ error: 'submission_id wajib diisi' }, { status: 400 })
        }
        if (!Array.isArray(draftAnswers) || draftAnswers.length === 0) {
            return NextResponse.json({ error: 'Draft jawaban kosong — tidak ada yang bisa diselamatkan' }, { status: 400 })
        }
        if (draftAnswers.length > 200) {
            return NextResponse.json({ error: 'Payload draft melebihi batas' }, { status: 400 })
        }
        for (const a of draftAnswers) {
            if (!a || typeof a.question_id !== 'string' || typeof a.answer !== 'string') {
                return NextResponse.json({ error: 'Format draft tidak valid' }, { status: 400 })
            }
        }

        // Normalisasi draft:
        // (a) string kosong = soal dikosongkan siswa — bukan jawaban, buang
        //     (anti baris junk; paritas filter client-side di halaman rescue).
        // (b) dedup `question_id` (occurrence TERAKHIR menang — semantik autosave
        //     "tulisan terakhir menang"). Wajib sebelum upsert: PostgREST menolak
        //     SELURUH batch bila 2 baris memukul konflik target yang sama
        //     ("ON CONFLICT DO UPDATE cannot affect row a second time") —
        //     ditemukan E2E fase-2, bukan kasus draft normal (objek localStorage
        //     tak bisa duplikat kunci) tapi API harus defensif.
        const seen = new Set<string>()
        const normalizedDraft: RescueAnswer[] = []
        for (let i = draftAnswers.length - 1; i >= 0; i--) {
            const a = draftAnswers[i]
            if (a.answer.trim() === '') continue
            if (seen.has(a.question_id)) continue
            seen.add(a.question_id)
            normalizedDraft.push(a)
        }
        normalizedDraft.reverse()
        if (normalizedDraft.length === 0) {
            return NextResponse.json({ error: 'Draft tidak berisi jawaban (semua kosong)' }, { status: 400 })
        }

        // 1. Siswa pemilik submission (C3 paritas: hanya pemilik boleh menyentuh)
        const { data: student, error: eStudent } = await supabase
            .from('students')
            .select('id')
            .eq('user_id', user.id)
            .single()
        if (eStudent || !student) {
            return NextResponse.json({ error: 'Data siswa tidak ditemukan' }, { status: 404 })
        }

        // 2. Muat submission + tenant guard per jenis ujian
        const isOfficial = kind === 'official'
        const subTable = isOfficial ? 'official_exam_submissions' : 'exam_submissions'
        const ansTable = isOfficial ? 'official_exam_answers' : 'exam_answers'
        const qTable = isOfficial ? 'official_exam_questions' : 'exam_questions'
        const auditSource = isOfficial ? 'OFFICIAL_EXAM' : 'EXAM'

        const { data: submission, error: eSub } = await supabase
            .from(subTable)
            .select('id, exam_id, student_id, is_submitted, submitted_at, total_score, max_score, is_graded')
            .eq('id', submissionId)
            .single()
        if (eSub || !submission) {
            return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
        }
        if (submission.student_id !== student.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        if (isOfficial) {
            // official_exams membawa school_id langsung
            const { data: examRow } = await supabase
                .from('official_exams')
                .select('school_id')
                .eq('id', submission.exam_id)
                .single()
            if (!examRow || (schoolId && examRow.school_id !== schoolId)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        } else {
            const outside = await findExamsOutsideSchool([submission.exam_id], schoolId)
            if (outside.length > 0) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        }

        // 3. Jalur hanya relevan untuk submission yang sudah terkumpul.
        //    (Yang belum submit memakai PUT biasa.)
        if (!submission.is_submitted) {
            return NextResponse.json({ error: 'Ujian ini belum dikumpulkan — lanjutkan pengerjaan di halaman ujian' }, { status: 400 })
        }

        // 4. Filter draft ke soal ujian ini (anti junk rows — paritas PUT normal)
        const allQuestions = await getExamQuestionsForGrading(qTable as 'exam_questions' | 'official_exam_questions', submission.exam_id)
        const questionMap = new Map(allQuestions.map(q => [q.id, q]))

        // 5. Jawaban yang SUDAH ada di server tidak ditimpa (server menang)
        const existingIds = new Set<string>()
        for (let i = 0; i < normalizedDraft.length; i += 100) {
            const chunkIds = normalizedDraft.slice(i, i + 100).map(a => a.question_id)
            const { data: chunk, error } = await supabase
                .from(ansTable)
                .select('question_id')
                .eq('submission_id', submissionId)
                .in('question_id', chunkIds)
            if (error) throw error
            for (const r of chunk || []) existingIds.add(r.question_id)
        }
        const missingDraft = normalizedDraft.filter(a => questionMap.has(a.question_id) && !existingIds.has(a.question_id))

        const rescuedCount = missingDraft.length
        const skippedExisting = normalizedDraft.filter(a => existingIds.has(a.question_id)).length
        const invalidCount = normalizedDraft.length - normalizedDraft.filter(a => questionMap.has(a.question_id)).length

        if (rescuedCount === 0) {
            return NextResponse.json({
                rescued: 0,
                skipped_existing: skippedExisting,
                invalid_questions: invalidCount,
                total_score: submission.total_score,
                is_graded: submission.is_graded,
                message: skippedExisting > 0
                    ? 'Semua jawaban draft sudah ada di server — tidak ada perubahan.'
                    : 'Tidak ada jawaban yang cocok dengan soal ujian ini.'
            })
        }

        // 6. Grade jalur resmi — paritas submit normal (PUT). Tipe manual
        //    (isian/essay): simpan jawaban saja tanpa menyentuh poin (K1 paritas).
        const gradedRows = missingDraft.map((ans: RescueAnswer) => {            const q = questionMap.get(ans.question_id)!
            if (needsManualGrading(q.question_type)) {
                return {
                    submission_id: submissionId,
                    question_id: ans.question_id,
                    answer: ans.answer,
                    is_correct: null,
                    points_earned: null
                }
            }
            const graded = gradeAnswer(
                q.question_type,
                ans.answer,
                q.correct_answer,
                q.options,
                q.points || 1,
                q.gk_grading_mode ?? 'PROPORTIONAL'
            )
            return {
                submission_id: submissionId,
                question_id: ans.question_id,
                answer: ans.answer,
                is_correct: graded.isCorrect,
                points_earned: graded.pointsEarned
            }
        })

        const { error: upsertError } = await supabase
            .from(ansTable)
            .upsert(gradedRows, { onConflict: 'submission_id,question_id' })
        if (upsertError) {
            console.error('[rescue] upsert gagal:', upsertError)
            return NextResponse.json({ error: 'Gagal menyimpan jawaban — coba lagi' }, { status: 500 })
        }

        // 7. Rekap ulang dari SELURUH jawaban submission (bukan hanya draft)
        const { data: allAnswers, error: eAll } = await supabase
            .from(ansTable)
            .select('points_earned, is_correct')
            .eq('submission_id', submissionId)
        if (eAll) throw eAll

        const hasEssay = allQuestions.some(q => needsManualGrading(q.question_type))
        // is_graded konsisten dgn jalur submit: exam tanpa esai langsung final;
        // exam beresai: final hanya bila semua jawaban esai sudah dinilai guru
        const answerRows = (allAnswers || []) as { points_earned: number | null; is_correct: boolean | null }[]
        const essayPending = hasEssay
            && answerRows.some(a => a.points_earned === null && a.is_correct === null)
        const totalScore = Math.round(
            answerRows.reduce((sum, a) => sum + (a.points_earned || 0), 0) * 100
        ) / 100

        const { data: updated, error: eUpd } = await supabase
            .from(subTable)
            .update({
                total_score: totalScore,
                is_graded: !essayPending
            })
            .eq('id', submissionId)
            .select('total_score, max_score, is_graded')
            .single()
        if (eUpd) throw eUpd

        // 8. Audit trail (append-only) — paritas reset attempt & koreksi guru.
        //    MaxScore dari DB submission (bukan ekspektasi client).
        await logGradeChange({
            schoolId,
            source: auditSource as 'EXAM' | 'OFFICIAL_EXAM',
            refId: submission.exam_id,
            refTitle: null,
            studentId: submission.student_id,
            oldScore: submission.total_score ?? null,
            newScore: totalScore,
            maxScore: updated?.max_score ?? null,
            changedBy: user.id
        })

        return NextResponse.json({
            rescued: rescuedCount,
            skipped_existing: skippedExisting,
            invalid_questions: invalidCount,
            total_score: updated?.total_score,
            is_graded: updated?.is_graded,
            message: 'Jawaban berhasil diselamatkan dan dinilai ulang.'
        })
    } catch (error) {
        console.error('[rescue] error:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
