import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { tenantMismatch, notFound } from '@/lib/tenantGuard'
import { getTeacherScope, coTeachesClassSubject } from '@/lib/teacherScope'
import { logGradeChange } from '@/lib/gradeHistory'
import { needsManualGrading } from '@/lib/questionTypeUtils'
import { getExamQuestionsForGrading } from '@/lib/examQuestionsCache'
import { resolveWindowExpiry } from '@/lib/examExpiry'

// GET single exam submission with questions and answers
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const params = await context.params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const id = params.id

        const { data, error } = await supabase
            .from('exam_submissions')
            .select(`
                *,
                exam:exams(
                    id,
                    title,
                    show_results_immediately,
                    results_released,
                    start_time,
                    duration_minutes,
                    window_end_time,
                    questions:exam_questions(*),
                    teaching_assignment:teaching_assignments(academic_year:academic_years(school_id))
                ),
                student:students(
                    id,
                    nis,
                    user:users!students_user_id_fkey(full_name)
                )
            `)
            .eq('id', id)
            .single()

        if (error) throw error

        // Tenant guard: submission harus milik sekolah caller (IDOR lintas sekolah)
        if (tenantMismatch((data as any)?.exam?.teaching_assignment?.academic_year?.school_id, schoolId)) {
            return notFound()
        }

        // S2 Security Fix: IDOR protection — SISWA can only access their own submission
        if (user.role === 'SISWA') {
            const { data: student } = await supabase
                .from('students').select('id').eq('user_id', user.id).single()
            if (!student || (data as any)?.student?.id !== student.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        }

        // G1 Security Fix (parity dengan official-exam-submissions/[id] & PUT di
        // bawah): GURU non-pengampu tidak boleh membaca jawaban siswa + kunci
        // ulangan kelas lain — sebelumnya GET detail tanpa verifikasi guru
        // sama sekali (cukup bypass tenant guard + fetch id).
        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers').select('id').eq('user_id', user.id).single()
            const { data: subAuth } = await supabase
                .from('exam_submissions')
                .select('exam:exams(teaching_assignment:teaching_assignments(teacher_id, subject_id, class_id, academic_year_id))')
                .eq('id', id)
                .single()
            const taAny = (subAuth?.exam as any)?.teaching_assignment
            const ta = Array.isArray(taAny) ? taAny[0] : taAny
            if (ta) {
                const isOwner = !!teacher && ta.teacher_id === teacher.id
                if (!isOwner) {
                    const scope = await getTeacherScope(user.id, ta.academic_year_id ?? null)
                    if (!coTeachesClassSubject(scope, ta.subject_id, ta.class_id)) {
                        return NextResponse.json({ error: 'Anda tidak memiliki akses ke ulangan ini' }, { status: 403 })
                    }
                }
            }
        }

        // Check visibility for SISWA
        const examObj = (data as any)?.exam || {}
        const showImmediately = examObj.show_results_immediately ?? true
        const isReleased = examObj.results_released || false
        const isHidden = user.role === 'SISWA' && !showImmediately && !isReleased

        // K1 Security Fix: kunci jawaban (correct_answer di exam_questions) hanya boleh
        // terlihat oleh guru/admin, ATAU siswa yang SUDAH submit dan hasilnya boleh
        // dilihat. Sebelumnya embed exam_questions(*) membocorkan kunci ke siswa
        // yang masih mengerjakan (show_results_immediately default true).
        // H2 (audit eksternal, keputusan produk "tahan kunci s/d jam tutup"):
        // siswa yang mengumpulkan cepat saat ujian MASIH berjalan belum boleh
        // melihat kunci — menutup kolusi "submit dulu, bagikan kunci ke teman".
        // Kunci baru terbuka setelah jendela ujian tertutup (endAt efektif,
        // satu sumber kebenaran resolveWindowExpiry — termasuk jam tutup mode
        // jendela & start+durasi mode serentak). Ujian tanpa batas waktu
        // (durasi 0/null tanpa jendela) tidak punya "jam tutup" → kunci langsung.
        const examKeysWindow = user.role === 'SISWA' && (data as any)?.is_submitted
            ? (() => {
                const expiry = resolveWindowExpiry(
                    {
                        start_time: examObj.start_time ?? null,
                        duration_minutes: examObj.duration_minutes ?? null,
                        window_end_time: examObj.window_end_time ?? null,
                    },
                    {
                        started_at: (data as any)?.started_at ?? null,
                        timer_override_until: (data as any)?.timer_override_until ?? null,
                    },
                )
                return !expiry.limited || Date.now() > expiry.endAt
            })()
            : true
        const canSeeAnswerKeys = user.role !== 'SISWA' || ((data as any)?.is_submitted && !isHidden && examKeysWindow)
        const responseDataRaw: any = data
        if (!canSeeAnswerKeys && responseDataRaw?.exam?.questions) {
            responseDataRaw.exam.questions = responseDataRaw.exam.questions.map((q: any) => {
                const { correct_answer, ...rest } = q
                return rest
            })
        }

        // Fetch answers from exam_answers table
        const { data: examAnswers, error: answersError } = await supabase
            .from('exam_answers')
            .select('*')
            .eq('submission_id', id)

        if (answersError) throw answersError

        // K1 lanjutan: is_correct/score jawaban dirahasiakan dari siswa yang
        // BELUM submit (mirror versi official) — jangan sampai jadi oracle
        // benar/salah saat ujian masih berjalan.
        // H2 CATATAN REVISI: untuk siswa yang SUDAH submit, is_correct/score
        // miliknya TETAP dikirim selama jendela terbuka — itu hasilnya sendiri
        // (fitur "Tampilkan Hasil Langsung"), bukan kunci jawaban. Yang ditahan
        // sampai jam tutup hanya correct_answer (canSeeAnswerKeys di atas).
        // Over-strip versi pertama merusak halaman hasil (skor blank/NaN) —
        // tertangkap e2e_exam_runner_unification.
        const hideAnswers = user.role === 'SISWA' && !(data as any)?.is_submitted

        // Map exam_answers to the format the frontend expects
        const answers = (examAnswers || []).map(a => ({
            question_id: a.question_id,
            answer: a.answer,
            is_correct: hideAnswers ? undefined : a.is_correct,
            score: hideAnswers ? undefined : a.points_earned,
            feedback: hideAnswers ? '' : (a.feedback || '')
        }))

        const responseData = {
            ...data,
            answers,
            results_hidden: isHidden
        }

        if (isHidden) {
            responseData.total_score = null
            responseData.max_score = null
        }

        return NextResponse.json(responseData)
    } catch (error) {
        console.error('Error fetching exam submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// PUT update exam submission (Teacher Grading)
export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const params = await context.params
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const id = params.id
        const { answers, is_graded } = await request.json()

        // Guard integritas: hanya submission yang SUDAH dikumpulkan yang boleh
        // dinilai — nilai koreksi guru pada attempt yang masih berjalan akan
        // tertimpa autosave/submit siswa berikutnya (points_earned semua jawaban
        // di-upsert ulang saat autosave), dan is_graded:true pada attempt hidup
        // membuat state inkonsisten. Paritas guard di quiz-submissions/[id].
        // total_score/exam ikut diambil untuk audit trail grade_history.
        const { data: subCheck } = await supabase
            .from('exam_submissions')
            .select('is_submitted, student_id, total_score, exam:exams(id, title)')
            .eq('id', id)
            .single()
        if (!subCheck) {
            return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
        }
        if (!subCheck.is_submitted) {
            return NextResponse.json({ error: 'Ulangan ini belum dikumpulkan siswa — tidak bisa dinilai' }, { status: 400 })
        }

        // Verify teacher owns the teaching assignment for this exam (ADMIN bypass);
        // co-teacher (mapel+kelas sama) juga boleh menilai
        if (user.role === 'GURU') {
            const { data: teacher } = await supabase
                .from('teachers')
                .select('id')
                .eq('user_id', user.id)
                .single()

            const { data: submissionData } = await supabase
                .from('exam_submissions')
                .select('exam:exams(teaching_assignment:teaching_assignments(teacher_id, subject_id, class_id, academic_year_id))')
                .eq('id', id)
                .single()

            const taAny = (submissionData?.exam as any)?.teaching_assignment
            const ta = Array.isArray(taAny) ? taAny[0] : taAny
            const isOwner = !!teacher && ta?.teacher_id === teacher.id
            if (!isOwner) {
                const scope = await getTeacherScope(user.id, ta?.academic_year_id ?? null)
                if (!coTeachesClassSubject(scope, ta?.subject_id, ta?.class_id)) {
                    return NextResponse.json({ error: 'Forbidden: You do not have access to grade this class' }, { status: 403 })
                }
            }
        } else if (user.role === 'ADMIN') {
            // K2 Security Fix: scope sekolah untuk admin — exams tidak punya school_id,
            // scope diperoleh via TA pemilik → teachers.school_id
            const { data: submissionData } = await supabase
                .from('exam_submissions')
                .select('exam:exams(teaching_assignment:teaching_assignments(teacher_id, teacher:teachers(school_id)))')
                .eq('id', id)
                .single()
            const ta = (submissionData?.exam as any)?.teaching_assignment as any
            const taTeacher = Array.isArray(ta?.teacher) ? ta.teacher[0] : ta?.teacher
            if (taTeacher?.school_id && schoolId && taTeacher.school_id !== schoolId) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        }

        // BATCH UPDATE: Update all exam_answers scores at once instead of one-by-one
        // ── K2 hardening (audit eksternal 2026-09-18) ──
        //  1. question_id WAJIB soal ujian ini (via questionMap dari cache —
        //     paritas jalur siswa POST /api/exam-submissions). Id asing membuat
        //     junk row yang ikut di-SUM ke total_score di bawah.
        //  2. points_earned di-clamp 0..question.points — skor koreksi tak
        //     mungkin melebihi bobot soal.
        //  3. answer & is_correct TIDAK diterima dari body — koreksi guru hanya
        //     boleh mengubah nilai/feedback, bukan menimpa jawaban siswa atau
        //     flag benar/salah (yang ditetapkan gradeAnswer server-side).
        if (answers && Array.isArray(answers) && answers.length > 0) {
            const examRow: any = Array.isArray(subCheck.exam) ? subCheck.exam[0] : subCheck.exam
            const examIdForQuestions = examRow?.id ?? (subCheck as any).exam_id
            const examQuestions = await getExamQuestionsForGrading('exam_questions', examIdForQuestions)
            const questionMap = new Map(examQuestions.map(q => [q.id, q]))
            const invalidIds = answers.filter((ans: any) => !questionMap.has(ans.question_id)).map((ans: any) => ans.question_id)
            if (invalidIds.length > 0) {
                return NextResponse.json({ error: `Soal tidak ditemukan di ujian ini: ${invalidIds.slice(0, 3).join(', ')}${invalidIds.length > 3 ? '…' : ''}` }, { status: 400 })
            }
            // K2e: upsert partial (tanpa answer/is_correct) membuat PostgREST
            // menimpa kolom tak-ada-di-payload dengan NULL/default saat ON CONFLICT
            // — jawaban siswa & flag auto-grade hilang. Sertakan nilai CURRENT
            // dari DB secara eksplisit untuk kolom yang tidak boleh berubah.
            const qIds = answers.map((ans: any) => ans.question_id)
            const { data: currentRows } = await supabase
                .from('exam_answers')
                .select('question_id, answer, is_correct')
                .eq('submission_id', id)
                .in('question_id', qIds)
            const currentByQ = new Map((currentRows || []).map((r: any) => [r.question_id, r]))
            const updates = answers.map((ans: any) => {
                const q = questionMap.get(ans.question_id)!
                // Skor koreksi boleh desimal (paritas GK proporsional) — clamp 0..poin
                const raw = Number(ans.score ?? ans.points_earned ?? 0)
                // Fallback paritas grading: soal points NULL dinilai auto dgn poin 1 —
                // clamp patokan 0 memaksa koreksi guru selalu 0 utk soal itu.
                const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(raw, q.points || 1)) : 0
                const cur = currentByQ.get(ans.question_id)
                return {
                    submission_id: id,
                    question_id: ans.question_id,
                    points_earned: Math.round(clamped * 100) / 100,
                    feedback: ans.feedback || null,
                    // pertahankan apa adanya (bukan dari body!)
                    answer: cur?.answer ?? null,
                    // Tipe manual (isian/essay): flag NETRAL — dulu preserve false
                    // dari auto-grade lama → jawaban bernilai penuh tetap tampil
                    // merah ✗ di view koreksi & correctRate analytics salah.
                    is_correct: needsManualGrading(q.question_type) ? null : (cur?.is_correct ?? null),
                }
            })

            // Jangan telan error upsert diam-diam: kegagalan di sini membuat nilai
            // essay guru hilang tanpa kabar (bug kolom feedback yang lama tak terdeteksi
            // justru karena error ini di-skip). Gagal keras supaya ketahuan.
            const { error: upsertError } = await supabase
                .from('exam_answers')
                .upsert(updates, { onConflict: 'submission_id,question_id' })
            if (upsertError) {
                console.error('Error upserting exam_answers (grading):', upsertError)
                return NextResponse.json({ error: 'Gagal menyimpan nilai: ' + upsertError.message }, { status: 500 })
            }
        }

        // Recalculate total score server-side (prevent client manipulation)
        const { data: allAnswers } = await supabase
            .from('exam_answers')
            .select('points_earned')
            .eq('submission_id', id)

        // Round 2 desimal — jumlah skor desimal (GK proporsional) bisa berdebu float
        const totalScore = Math.round((allAnswers?.reduce((sum, a) => sum + (a.points_earned || 0), 0) || 0) * 100) / 100

        // Update the submission record with server-calculated total_score and is_graded
        const { data, error } = await supabase
            .from('exam_submissions')
            .update({
                total_score: totalScore,
                is_graded
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error

        // Audit trail koreksi manual (append-only) — kegagalan audit tidak
        // boleh menggagalkan penilaian (best-effort, lihat gradeHistory.ts)
        const examInfo = Array.isArray(subCheck.exam) ? subCheck.exam[0] : subCheck.exam
        await logGradeChange({
            schoolId,
            source: 'EXAM',
            refId: examInfo?.id || id,
            refTitle: examInfo?.title || null,
            studentId: subCheck.student_id,
            oldScore: subCheck.total_score ?? null,
            newScore: totalScore,
            maxScore: data?.max_score ?? null,
            changedBy: user.id,
        })

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error updating exam submission:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

