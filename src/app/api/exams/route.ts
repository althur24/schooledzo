import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { findTeachingAssignmentsOutsideSchool, findExamsOutsideSchool } from '@/lib/tenantGuard'
import { getYearStatusByTA, archivedYearResponse } from '@/lib/academicYear'
import { getTeacherScope, ownsTeachingAssignment, coTeachesClassSubject } from '@/lib/teacherScope'
import { getBatchInfo } from '@/lib/examBatch'
import { getMenuLabelsForSchool } from '@/lib/serverLabels'
import { sanitizePolicyInput } from '@/lib/remedialScore'
import { fetchAllRows } from '@/lib/fetchAllRows'

// GET all exams
export async function GET(request: NextRequest) {
    // SISWA: id siswa untuk filter remedial (null = bukan siswa → tanpa filter)
    let remedialStudentId: string | null = null
    // Scope pasangan mapel+kelas guru (co-teaching) — diisi bila caller GURU
    let guruScopePairs: Set<string> | null = null
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        const teachingAssignmentId = request.nextUrl.searchParams.get('teaching_assignment_id')
        const allYears = request.nextUrl.searchParams.get('all_years')

        let query = supabase
            .from('exams')
            .select(`
                *,
                teaching_assignment:teaching_assignments!inner(
                    id,
                    academic_year_id,
                    teacher:teachers(id, user:users(full_name)),
                    subject:subjects(id, name, kkm),
                    class:classes(id, name, school_level, grade_level),
                    academic_year:academic_years(id, name, is_active)
                ),
                exam_questions(id)
            `)
            .order('created_at', { ascending: false })

        if (teachingAssignmentId) {
            // Jalur editor guru/admin — SISWA tidak boleh memakai param ini
            // (tanpa cek role, siswa bisa mendaftar semua ulangan satu TA
            // termasuk draft via API langsung; UI siswa tidak memakai param ini).
            if (user.role === 'SISWA') {
                return NextResponse.json([])
            }
            // Tenant guard: TA harus milik sekolah caller (param client dipercaya)
            if ((await findTeachingAssignmentsOutsideSchool([teachingAssignmentId], schoolId)).length > 0) {
                return NextResponse.json([])
            }
            query = query.eq('teaching_assignment_id', teachingAssignmentId)
        } else if (allYears !== 'true') {
            // Filter by active year — via inner join (NOT .in(list): hundreds of TA ids
            // overflow the 16KB header limit at larger schools and break this endpoint)
            // Tahan kasus 2 tahun aktif: ambil terbaru + peringatan (index DB mencegah sisanya)
            const { data: activeYears } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .order('created_at', { ascending: false })
                .limit(2)
            if ((activeYears || []).length > 1) {
                console.warn(`[exams] Sekolah ${schoolId} punya ${activeYears!.length} tahun aktif — pakai yang terbaru`)
            }
            const activeYear = activeYears?.[0] || null

            if (activeYear) {
                query = query.eq('teaching_assignment.academic_year_id', activeYear.id)

                // STRICT FILTERING FOR SISWA
                if (user.role === 'SISWA') {
                    const { data: student } = await supabase
                        .from('students')
                        .select('id, class_id')
                        .eq('user_id', user.id)
                        .single()

                    if (student?.class_id) {
                        query = query.eq('teaching_assignment.class_id', student.class_id)
                        // Siswa hanya melihat ulangan yang sudah dipublish —
                        // draft/tarik tidak boleh bocor via API langsung (UI
                        // sudah memfilter is_active client-side; ini menutup
                        // inspect-network).
                        query = query.eq('is_active', true)
                        // Remedial: siswa hanya melihat remedial miliknya
                        // (mirror /api/official-exams) — post-fetch di bawah.
                        remedialStudentId = (student as any).id
                    } else {
                        // Student has no valid class -> returns empty list
                        return NextResponse.json([])
                    }
                } else if (user.role === 'GURU') {
                    // STRICT FILTERING FOR GURU: exams milik TA sendiri ATAU TA
                    // co-teacher (mapel+kelas yang sama) — kelas multi-pengampu
                    // membuat 1 exam per kelas; semua pengampu melihatnya.
                    const { data: teacher } = await supabase
                        .from('teachers')
                        .select('id')
                        .eq('user_id', user.id)
                        .single()

                    if (teacher) {
                        const { data: myTAs } = await supabase
                            .from('teaching_assignments')
                            .select('subject_id, class_id')
                            .eq('teacher_id', teacher.id)
                            .eq('academic_year_id', activeYear.id)
                        const pairs = new Set((myTAs || []).map((ta: any) => `${ta.subject_id}|${ta.class_id}`))
                        const classIds = [...new Set((myTAs || []).map((ta: any) => ta.class_id).filter(Boolean))]
                        if (classIds.length === 0) return NextResponse.json([])
                        // Pre-filter per kelas (murah di DB), lalu exact pair mapel+kelas
                        // post-fetch — guru A co-teacher kelas X hanya untuk mapel yang
                        // dia ampau, bukan semua exam di kelas X.
                        query = query.in('teaching_assignment.class_id', classIds)
                        guruScopePairs = pairs
                    } else {
                        return NextResponse.json([])
                    }
                }
                // ADMIN: active-year filter above is sufficient
            } else {
                // No active year: return empty instead of leaking content across years
                return NextResponse.json([])
            }
        }

        const { data, error } = await query

        if (error) throw error

        // SISWA: buang remedial yang bukan miliknya (ulangan remedial hanya
        // terlihat oleh siswa terdaftar — guard attempt sudah menolak siswa
        // lain, ini mencegah item tak bisa dikerjakan tampil di daftar).
        // GURU: pre-filter per kelas diperketat jadi exact pair mapel+kelas
        // (co-teaching — guru hanya co-teacher untuk mapel yang dia ampau).
        let visibleData = remedialStudentId
            ? (data || []).filter((e: any) => !(e.is_remedial && Array.isArray(e.allowed_student_ids) && e.allowed_student_ids.length > 0 && !e.allowed_student_ids.includes(remedialStudentId)))
            : (data || [])
        if (guruScopePairs) {
            const first = (v: unknown) => Array.isArray(v) ? v[0] : v
            visibleData = visibleData.filter((e: any) => {
                const ta = first(e?.teaching_assignment)
                return guruScopePairs!.has(`${first(ta?.subject)?.id}|${first(ta?.class)?.id}`)
            })
        }

        // Label pembuat (untuk badge "Dibuatkan Admin" di daftar guru)
        let roleMap = new Map<string, string>()
        const creatorIds = [...new Set(visibleData.map((e: any) => e.created_by).filter(Boolean))] as string[]
        if (creatorIds.length > 0) {
            const { data: creators } = await supabase.from('users').select('id, role').in('id', creatorIds)
            roleMap = new Map((creators || []).map((c: any) => [c.id, c.role]))
        }

        // Info batch (untuk badge "N Kelas Paralel" — kelas unik — + tooltip nama kelas)
        const batchIds = [...new Set(visibleData.map((e: any) => e.batch_id).filter(Boolean))] as string[]
        const batchInfos = await getBatchInfo('exams', batchIds)

        // Add question count
        const examsWithCount = visibleData.map(exam => ({
            ...exam,
            question_count: exam.exam_questions?.length || 0,
            exam_questions: undefined,
            creator_role: exam.created_by ? roleMap.get(exam.created_by) || null : null,
            batch_size: exam.batch_id ? batchInfos.get(exam.batch_id)?.uniqueClassCount || 1 : 1,
            batch_class_names: exam.batch_id ? batchInfos.get(exam.batch_id)?.classNames || [] : []
        }))

        // SISWA: jangan bocorkan allowed_student_ids (daftar "siapa yang remedial")
        if (user.role === 'SISWA') {
            examsWithCount.forEach((e: any) => { delete (e as any).allowed_student_ids })
        }

        return NextResponse.json(examsWithCount)
    } catch (error) {
        console.error('Error fetching exams:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// POST create new exam
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { title, description, start_time, duration_minutes, window_end_time, teaching_assignment_id, is_randomized, max_violations, is_remedial, remedial_for_id, allowed_student_ids, duplicate_questions, duplicate_from_exam_id, show_results_immediately, batch_id, remedial_score_policy, remedial_max_score } = body

        if (!title || !start_time || duration_minutes === undefined || !teaching_assignment_id) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // K3 (audit eksternal): durasi wajib angka >= 5 — POST dulu hanya cek
        // !== undefined; durasi 0/negatif lolos dan (mode serentak) membuat
        // seluruh kelas tidak bisa memulai.
        if (typeof duration_minutes !== 'number' || !Number.isFinite(duration_minutes) || duration_minutes < 5) {
            return NextResponse.json({ error: 'Durasi pengerjaan minimal 5 menit' }, { status: 400 })
        }
        // M7: max_violations wajar (1..10 — paritas min/max form)
        if (max_violations !== undefined
            && (typeof max_violations !== 'number' || !Number.isFinite(max_violations) || max_violations < 1 || max_violations > 10)) {
            return NextResponse.json({ error: 'Maksimal pelanggaran harus antara 1 sampai 10' }, { status: 400 })
        }

        // Validasi kebijakan nilai remedial (hanya relevan saat is_remedial)
        let policyFields: { remedial_score_policy?: string; remedial_max_score?: number } = {}
        if (is_remedial) {
            const sanitized = sanitizePolicyInput(remedial_score_policy, remedial_max_score)
            if ('error' in sanitized) {
                return NextResponse.json({ error: sanitized.error }, { status: 400 })
            }
            policyFields = {
                remedial_score_policy: sanitized.policy,
                ...(sanitized.policy === 'CAP' && sanitized.cap !== null ? { remedial_max_score: sanitized.cap } : {}),
            }
        }

        // Validasi jendela waktu: jam tutup harus setelah jam buka
        if (window_end_time && new Date(window_end_time) <= new Date(start_time)) {
            return NextResponse.json({ error: 'Jam tutup jendela waktu harus setelah jam buka' }, { status: 400 })
        }

        // Validasi TA + kepemilikan: ADMIN boleh TA mana pun di sekolahnya (buat untuk guru);
        // GURU hanya boleh TA miliknya sendiri (pengetatan — sebelumnya tidak dicek).
        const { data: ta } = await supabase
            .from('teaching_assignments')
            .select('id, teacher_id, teacher:teachers(school_id)')
            .eq('id', teaching_assignment_id)
            .single()
        if (!ta) {
            return NextResponse.json({ error: 'Teaching assignment tidak ditemukan' }, { status: 404 })
        }
        if (user.role === 'ADMIN') {
            const taSchoolId = (ta.teacher as any)?.school_id
            if (schoolId && taSchoolId && taSchoolId !== schoolId) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
            }
        } else {
            const scope = await getTeacherScope(user.id)
            if (!ownsTeachingAssignment(scope, ta.teacher_id)) {
                return NextResponse.json({ error: 'Anda hanya dapat membuat ulangan untuk penugasan Anda sendiri' }, { status: 403 })
            }
        }

        // Block writes to archived (COMPLETED) academic years
        const yearStatus = await getYearStatusByTA(teaching_assignment_id)
        if (yearStatus === 'COMPLETED') return archivedYearResponse()

        // ── M9: validasi batch_id dari client (audit eksternal 2026-09-18) ──
        // batch_id dibuat client (crypto.randomUUID saat wizard multi-kelas) —
        // tanpa validasi, guru bisa MENYUSUP exam ke batch guru lain; syncDraft
        // lalu menyalin soal SEMUA sibling → ekfiltrasi soal guru korban.
        // Aturan: batch yang sudah punya member hanya boleh diikuti exam dengan
        // mapel sama DAN kelas TUJUAN yang memang kelas member batch, dan caller
        // pengampu mapel itu di kelas tujuan (pemilik batch atau co-teacher).
        // ADMIN boleh semua TA se-sekolahnya (paritas "admin buat ulangan utk guru").
        if (batch_id) {
            const { data: batchMembers } = await supabase
                .from('exams')
                .select('id, teaching_assignment:teaching_assignments(teacher_id, subject_id, class_id)')
                .eq('batch_id', batch_id)
            const anchorTa = (() => {
                const first = batchMembers?.[0]
                const ta = Array.isArray(first?.teaching_assignment) ? first.teaching_assignment[0] : first?.teaching_assignment
                return ta || null
            })()
            if (anchorTa && (batchMembers || []).length > 0) {
                if (user.role === 'GURU') {
                    const scope = await getTeacherScope(user.id)
                    const isOwn = ownsTeachingAssignment(scope, anchorTa.teacher_id)
                    if (!isOwn) {
                        const memberClassIds = new Set(
                            (batchMembers || []).map((m: any) => {
                                const ta = Array.isArray(m.teaching_assignment) ? m.teaching_assignment[0] : m.teaching_assignment
                                return ta?.class_id
                            }).filter(Boolean)
                        )
                        const { data: newTa } = await supabase
                            .from('teaching_assignments')
                            .select('subject_id, class_id')
                            .eq('id', teaching_assignment_id)
                            .single()
                        // (a) mapel TA baru == mapel batch
                        const sameSubject = !!newTa && newTa.subject_id === anchorTa.subject_id
                        // (b) kelas tujuan memang kelas member batch (bukan kelas
                        //     asing milik penyerang yang kebetulan se-mapel)
                        const targetIsMemberClass = !!newTa?.class_id && memberClassIds.has(newTa.class_id)
                        if (!sameSubject || !targetIsMemberClass) {
                            return NextResponse.json({ error: 'Batch ulangan ini bukan milik penugasan Anda' }, { status: 403 })
                        }
                    }
                }
                // ADMIN: boleh melanjutkan batch (alur modal terpadu admin membuat
                // member per TA guru) — tenant guard TA di atas sudah membatasi
                // se-sekolah.
            }
        }

        // Tenant guard: exam sumber duplikasi/remedial harus milik sekolah caller —
        // duplicate_questions menyalin seluruh soal + kunci jawaban; tanpa guard
        // ini guru mana pun bisa exfiltrate soal guru/sekolah lain.
        const duplicateSourceId = duplicate_from_exam_id || (is_remedial ? remedial_for_id : null)
        if (duplicateSourceId) {
            if ((await findExamsOutsideSchool([duplicateSourceId], schoolId)).length > 0) {
                return NextResponse.json({ error: 'Ulangan sumber tidak valid' }, { status: 403 })
            }
            const { data: srcExam } = await supabase
                .from('exams')
                .select('teaching_assignment_id, teaching_assignment:teaching_assignments(teacher_id)')
                .eq('id', duplicateSourceId)
                .single()
            const srcTa = srcExam?.teaching_assignment as any
            if (user.role === 'GURU') {
                // Sumber harus penugasan guru sendiri — guru lain sekalipun sed sekolah
                const scope = await getTeacherScope(user.id)
                if (!srcTa || !ownsTeachingAssignment(scope, srcTa.teacher_id)) {
                    return NextResponse.json({ error: 'Ulangan sumber remedial/duplikasi harus milik penugasan Anda sendiri' }, { status: 403 })
                }
            }
            // Remedial: kelas & mapel harus sama dengan TA target (paritas guard kuis)
            if (is_remedial && srcExam?.teaching_assignment_id !== teaching_assignment_id) {
                return NextResponse.json({ error: 'Ulangan remedial harus berasal dari kelas & mapel yang sama' }, { status: 400 })
            }
        }

        const { data, error } = await supabase
            .from('exams')
            .insert({
                title,
                description,
                start_time,
                duration_minutes,
                window_end_time: window_end_time || null,
                teaching_assignment_id,
                is_active: false,
                is_randomized: is_randomized || false,
                max_violations: max_violations || 3,
                is_remedial: is_remedial || false,
                remedial_for_id: remedial_for_id || null,
                allowed_student_ids: allowed_student_ids || null,
                ...(is_remedial ? policyFields : {}),
                show_results_immediately: show_results_immediately ?? true,
                batch_id: batch_id || null,
                created_by: user.id
            })
            .select()
            .single()

        if (error) throw error

        // Handle question duplication: remedial (salin dari exam sumber remedial)
        // atau duplikasi biasa (duplicate_from_exam_id, meniru official-exams/duplicate).
        // duplicateSourceId sudah tervalidasi tenant/ownership di guard atas.
        if (duplicate_questions && duplicateSourceId) {
            // fetchAllRows (batas 1000 diam-diam) + order pedagogis (order_index
            // dulu, bukan id UUID acak) — baris salinan ter-insert terurut.
            let originalQuestions: any[] = []
            try {
                originalQuestions = await fetchAllRows(supabase
                    .from('exam_questions')
                    .select('*')
                    .eq('exam_id', duplicateSourceId)
                    .order('order_index', { ascending: true })
                    .order('id'))
            } catch (fetchError) {
                console.error('Error fetching source questions for duplicate:', fetchError)
                await supabase.from('exams').delete().eq('id', data.id)
                return NextResponse.json({ error: 'Gagal membaca soal sumber. Duplikasi dibatalkan.' }, { status: 500 })
            }

            // M1 (audit eksternal): clamp sumber anomali — paritas
            // SOURCE_QUESTIONS_LIMIT di copy-questions & examBatch. Sumber > 500
            // soal = kandidat data terduplikasi (kasus runaway); menyalinnya
            // hanya melipatgandakan kerusakan ke exam baru.
            if (originalQuestions.length > 500) {
                console.error(`[duplicate] ABORT: sumber ${duplicateSourceId} punya ${originalQuestions.length} soal (> 500) — data anomali.`)
                await supabase.from('exams').delete().eq('id', data.id)
                return NextResponse.json({ error: 'Sumber punya soal melebihi batas (kemungkinan terduplikasi). Periksa ulangan sumber.' }, { status: 400 })
            }

            if (originalQuestions && originalQuestions.length > 0) {
                const newQuestions = originalQuestions.map((q: any) => ({
                    exam_id: data.id,
                    question_text: q.question_text,
                    question_type: q.question_type,
                    options: q.options,
                    correct_answer: q.correct_answer,
                    points: q.points,
                    order_index: q.order_index,
                    difficulty: q.difficulty,
                    passage_text: q.passage_text,
                    passage_audio_url: q.passage_audio_url,
                    image_url: q.image_url,
                    status: q.status, // Inherit approval status
                    teacher_hots_claim: q.teacher_hots_claim,
                    text_direction: q.text_direction,
                    content_format: q.content_format,
                    tags: q.tags,
                    gk_grading_mode: q.gk_grading_mode ?? 'PROPORTIONAL'
                }))
                // M1: insert belah chunk 500 (payload raksasa rawan timeout /
                // ditolak — paritas insertQuestionsChunked examBatch)
                let duplicateError: unknown = null
                for (let i = 0; i < newQuestions.length; i += 500) {
                    const { error: chunkErr } = await supabase.from('exam_questions').insert(newQuestions.slice(i, i + 500))
                    if (chunkErr) { duplicateError = chunkErr; break }
                }
                if (duplicateError) {
                    console.error('Error inserting duplicated questions:', duplicateError)
                    await supabase.from('exams').delete().eq('id', data.id)
                    return NextResponse.json({ error: 'Gagal menyalin soal. Duplikasi dibatalkan.' }, { status: 500 })
                }
            }
        }

        // Send notifications to remedial students
        if (is_remedial && allowed_student_ids && allowed_student_ids.length > 0) {
            try {
                const { data: students } = await supabase
                    .from('students')
                    .select('user_id')
                    .in('id', allowed_student_ids)

                if (students && students.length > 0) {
                    const startDate = new Date(start_time).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
                    const labels = await getMenuLabelsForSchool(schoolId)
                    await supabase.from('notifications').insert(
                        students.map((s: any) => ({
                            user_id: s.user_id,
                            type: 'REMEDIAL',
                            title: `Remedial ${labels.ulangan}: ${title}`,
                            message: `${labels.ulangan} remedial telah dibuat untuk Anda. Mulai: ${startDate}`,
                            link: '/dashboard/siswa/ulangan'
                        }))
                    )
                }
            } catch (notifError) {
                console.error('Error sending remedial notification:', notifError)
            }
        }

        return NextResponse.json(data)
    } catch (error) {
        console.error('Error creating exam:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
