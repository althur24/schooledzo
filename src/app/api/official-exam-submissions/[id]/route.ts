import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound } from '@/lib/tenantGuard'
import { getTeacherScope, canTeachStudentSubmission } from '@/lib/teacherScope'
import { logError } from '@/lib/logError'
import { logGradeChange } from '@/lib/gradeHistory'
import { resolveWindowExpiry } from '@/lib/examExpiry'
import { needsManualGrading } from '@/lib/questionTypeUtils'
import { getExamQuestionsForGrading } from '@/lib/examQuestionsCache'

// GET submission detail with answers
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx

        const { data: submission, error } = await supabase
            .from('official_exam_submissions')
            .select(`
                *,
                student:students(id, nis, class_id, user:users!students_user_id_fkey(full_name)),
                exam:official_exams(id, title, exam_type, duration_minutes, start_time, window_end_time, show_results_immediately, results_released, school_id, subject_id, target_class_ids, academic_year_id, subject:subjects(name))
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        // Tenant guard: submission harus milik sekolah caller (IDOR lintas sekolah)
        if (tenantMismatch((submission as any)?.exam?.school_id, ctx.schoolId)) {
            return notFound()
        }

        // S4 Security Fix: IDOR protection — SISWA can only access their own official exam submission
        if (ctx.user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students').select('id').eq('user_id', ctx.user.id).single()
            if (!student || (submission as any)?.student?.id !== student.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        }

        // GURU non-pengampu tidak boleh membaca jawaban siswa + kunci ujian
        // guru lain — paritas guard PUT grading & list submissions (sebelumnya
        // detail GET tanpa verifikasi guru sama sekali). Scope per-submission:
        // harus mengajar mapel ujian di kelas siswa pemilik submission.
        if (ctx.user.role === 'GURU') {
            const authExam = Array.isArray(submission?.exam) ? submission.exam[0] : (submission?.exam || {})
            const authStudent = submission?.student || {}
            const scope = await getTeacherScope(ctx.user.id, authExam.academic_year_id)
            if (!canTeachStudentSubmission(scope, authExam.subject_id, authStudent?.class_id)) {
                return NextResponse.json({ error: 'Anda tidak mengajar kelas siswa ini' }, { status: 403 })
            }
        }

        // Check visibility for SISWA
        const examObj = (submission as any)?.exam || {}
        const showImmediately = examObj.show_results_immediately ?? true
        const isReleased = examObj.results_released || false
        const isHidden = ctx.user.role === 'SISWA' && !showImmediately && !isReleased

        // K1 Security Fix: kunci jawaban hanya boleh terlihat guru/admin, ATAU siswa
        // yang SUDAH submit dan hasilnya boleh dilihat. Sebelumnya strip hanya
        // berbasis visibility setting — siswa yang masih mengerjakan ujian dengan
        // show_results_immediately=true (default) bisa membaca correct_answer.
        // H2 (audit eksternal, keputusan produk "tahan kunci s/d jam tutup"):
        // KUNCI JAWABAN ditahan sampai jendela ujian tertutup (endAt efektif dari
        // resolveWindowExpiry) — menutup kolusi pengumpul-cepat ke teman.
        // Ujian tanpa batas waktu tidak punya "jam tutup" → kunci langsung.
        // H2 CATATAN REVISI: skor/is_correct siswa yang sudah submit TETAP
        // dikirim selama jendela terbuka — itu hasilnya sendiri (fitur
        // "Tampilkan Hasil Langsung"), bukan kunci. Over-strip versi pertama
        // merusak halaman hasil (skor blank) — tertangkap e2e_runner_unification.
        const examKeysWindow = ctx.user.role === 'SISWA' && (submission as any)?.is_submitted
            ? (() => {
                const expiry = resolveWindowExpiry(
                    {
                        start_time: examObj.start_time ?? null,
                        duration_minutes: examObj.duration_minutes ?? null,
                        window_end_time: examObj.window_end_time ?? null,
                    },
                    {
                        started_at: (submission as any)?.started_at ?? null,
                        timer_override_until: (submission as any)?.timer_override_until ?? null,
                    },
                )
                return !expiry.limited || Date.now() > expiry.endAt
            })()
            : true
        // Kunci disembunyikan bila: siswa belum submit, hasil ditahan setting,
        // atau jendela masih terbuka (H2). Benar/salah & skor disembunyikan HANYA
        // untuk siswa yang belum submit (oracle mid-exam) — keduanya dipisah.
        const hideKeys = ctx.user.role === 'SISWA' && (!(submission as any)?.is_submitted || isHidden || !examKeysWindow)
        const hideResult = ctx.user.role === 'SISWA' && !(submission as any)?.is_submitted

        // Fetch answers
        const { data: answers } = await supabase
            .from('official_exam_answers')
            .select(`
                *,
                question:official_exam_questions(id, question_text, question_type, options, correct_answer, points)
            `)
            .eq('submission_id', id)

        const processedAnswers = hideKeys
            ? (answers || []).map((a: any) => ({
                ...a,
                // Kunci ditahan s/d jam tutup (H2); skor milik siswa hanya
                // disembunyikan bila belum submit (hideResult) — bukan saat
                // jendela terbuka, agar halaman hasil tetap menampilkan nilai.
                is_correct: hideResult ? undefined : a.is_correct,
                points_earned: hideResult ? undefined : a.points_earned,
                question: a.question ? { ...a.question, correct_answer: undefined } : a.question
            }))
            : (answers || [])

        const responseData: any = { ...submission, answers: processedAnswers, results_hidden: isHidden }
        if (isHidden) {
            responseData.total_score = null
            responseData.max_score = null
        }

        return NextResponse.json(responseData)
    } catch (error) {
        logError('Error fetching official exam submission', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT grade essay answers (Admin or Guru)
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN' && user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // K2 Security Fix: verifikasi akses guru/admin — sebelumnya PUT grading ini
        // tidak punya verifikasi sama sekali (guru manapun lintas sekolah bisa mengubah nilai).
        // GURU: scope per-submission — harus mengajar mapel ini di kelas SISWA pemilik
        // submission (bukan semua kelas target); ADMIN satu sekolah.
        const { data: subForAuth } = await supabase
            .from('official_exam_submissions')
            .select('is_submitted, student_id, total_score, max_score, student:students(class_id), exam:official_exams(id, title, school_id, subject_id, target_class_ids, academic_year_id)')
            .eq('id', id)
            .single()
        if (!subForAuth) {
            return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
        }
        // Guard integritas: hanya submission yang SUDAH dikumpulkan yang boleh
        // dinilai — nilai koreksi guru pada attempt yang masih berjalan akan
        // tertimpa autosave/submit siswa berikutnya. Paritas guard quiz-submissions/[id].
        if (!subForAuth.is_submitted) {
            return NextResponse.json({ error: 'Ujian ini belum dikumpulkan siswa — tidak bisa dinilai' }, { status: 400 })
        }
        const authExam: any = Array.isArray(subForAuth?.exam) ? subForAuth.exam[0] : subForAuth?.exam || {}
        if (user.role === 'GURU') {
            const authStudent: any = Array.isArray(subForAuth?.student) ? subForAuth.student[0] : subForAuth?.student
            const scope = await getTeacherScope(user.id, authExam.academic_year_id)
            if (!canTeachStudentSubmission(scope, authExam.subject_id, authStudent?.class_id)) {
                return NextResponse.json({ error: 'Anda tidak mengajar kelas siswa ini' }, { status: 403 })
            }
        } else if (authExam.school_id && schoolId && authExam.school_id !== schoolId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await request.json()
        const { grades } = body // Array of { answer_id, points_earned }

        if (!grades || !Array.isArray(grades)) {
            return NextResponse.json({ error: 'grades array required' }, { status: 400 })
        }

        // ── K2 hardening (paritas exam-submissions/[id], audit pra-UTS 2026-09-20) ──
        //  1. answer_id WAJIB baris jawaban milik submission ini — sebelumnya id
        //     asing lolos diam-diam (update 0 baris tanpa error).
        //  2. points_earned di-clamp 0..poin soal — skor koreksi tak mungkin
        //     melebihi bobot soal (audit membuktikan 9999 tersimpan di soal
        //     10 poin lewat request yang dibentuk manual).
        let clampedGrades: { id: string; points_earned: number; isManual?: boolean }[] = []
        if (grades.length > 0) {
            const { data: gradeRows } = await supabase
                .from('official_exam_answers')
                .select('id, question_id')
                .eq('submission_id', id)
                .in('id', grades.map((g: any) => g.answer_id))
            const rowById = new Map((gradeRows || []).map((r: any) => [r.id, r]))
            const missing = grades.filter((g: any) => !rowById.has(g.answer_id))
            if (missing.length > 0) {
                return NextResponse.json({
                    error: `Jawaban tidak ditemukan di submission ini: ${missing.slice(0, 3).map((g: any) => g.answer_id).join(', ')}${missing.length > 3 ? '…' : ''}`,
                }, { status: 400 })
            }

            const examQuestions = await getExamQuestionsForGrading('official_exam_questions', authExam?.id || id)
            const questionPoints = new Map(examQuestions.map(q => [q.id, q.points || 10]))
            // Tipe manual (isian/essay) per answer row — flag is_correct dinetralkan
            // saat guru menilai (dulu preserve false dari auto-grade lama → jawaban
            // bernilai penuh tampil merah ✗ + correctRate analytics salah).
            const manualByQuestion = new Map(examQuestions.map(q => [q.id, needsManualGrading(q.question_type)]))
            clampedGrades = grades.map((grade: any) => {
                const row = rowById.get(grade.answer_id)!
                // Soal tak terdaftar (draft basi/soal dihapus) → patokan 0 — jangan
                // biarkan nilai lolos tanpa batas yang diketahui.
                const maxPoints = questionPoints.get(row.question_id) ?? 0
                // Skor koreksi boleh desimal (paritas GK proporsional) — clamp 0..poin
                const raw = Number(grade.points_earned ?? 0)
                const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(raw, maxPoints)) : 0
                return {
                    id: grade.answer_id,
                    points_earned: Math.round(clamped * 100) / 100,
                    isManual: manualByQuestion.get(row.question_id) === true,
                }
            })
        }

        // BATCH UPDATE: parallel dengan filter submission_id (safety filter).
        // Error TIDAK ditelan — kegagalan parsial membuat nilai hilang diam-diam
        // sementara total_score & is_graded:true tetap ditulis.
        const gradeResults = await Promise.all(clampedGrades.map((grade) =>
            supabase
                .from('official_exam_answers')
                .update(grade.isManual
                    ? { points_earned: grade.points_earned, is_correct: null }
                    : { points_earned: grade.points_earned })
                .eq('id', grade.id)
                .eq('submission_id', id)
        ))
        const failedGrade = gradeResults.find(r => r.error)
        if (failedGrade?.error) {
            console.error('Error grading official exam answers:', failedGrade.error)
            return NextResponse.json({ error: 'Gagal menyimpan nilai: ' + failedGrade.error.message }, { status: 500 })
        }

        // Recalculate total score
        const { data: allAnswers } = await supabase
            .from('official_exam_answers')
            .select('points_earned')
            .eq('submission_id', id)

        // Round 2 desimal — jumlah skor desimal (GK proporsional) bisa berdebu float
        const totalScore = Math.round((allAnswers?.reduce((sum: number, a: any) => sum + (a.points_earned || 0), 0) || 0) * 100) / 100

        // Update submission with new total and mark as graded
        const { data: updatedSubmission, error } = await supabase
            .from('official_exam_submissions')
            .update({
                total_score: totalScore,
                is_graded: true
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error

        // Audit trail koreksi manual (append-only) — best-effort, lihat gradeHistory.ts
        await logGradeChange({
            schoolId,
            source: 'OFFICIAL_EXAM',
            refId: authExam?.id || id,
            refTitle: authExam?.title || null,
            studentId: subForAuth.student_id,
            oldScore: subForAuth.total_score ?? null,
            newScore: totalScore,
            maxScore: subForAuth.max_score ?? null,
            changedBy: user.id,
        })

        return NextResponse.json(updatedSubmission)
    } catch (error) {
        console.error('Error grading official exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
