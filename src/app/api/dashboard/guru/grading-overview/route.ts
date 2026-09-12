import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { batchedIn } from '@/lib/batchedIn'
import { fetchAllRows } from '@/lib/fetchAllRows'

// batchedIn per 100 id (batas URL) + fetchAllRows per chunk: satu chunk 100 id bisa
// berisi >1000 baris (100 kuis × puluhan siswa) yang otherwise terpotong diam-diam.
function batchedFetchAll<T>(column: string, ids: string[], buildQuery: (chunk: string[]) => any): Promise<T[]> {
    return batchedIn<T>(column, ids, async (chunk) => ({ data: await fetchAllRows<T>(buildQuery(chunk)), error: null }))
}

const unwrap = (val: any) => Array.isArray(val) ? val[0] : val

const EMPTY_COUNTS = { tugas: 0, kuis: 0, ulangan: 0, utsUas: 0 }

// Cache in-memory per guru (TTL 30 dtk). Satu guru = satu query DB per ~30 detik
// WALAUPUN Sidebar + BottomNav + dashboard + halaman kuis/ulangan meminta
// bersamaan (semua memanggil endpoint ini). Data badge menunda maksimal 30 dtk —
// dapat diterima untuk polling 60 dtk. Next.js route handler = satu proses Node
// di Railway (next start), jadi module-level cache terbagi antar request.
const CACHE_TTL_MS = 30_000
const gradingCache = new Map<string, { at: number; body: { counts: typeof EMPTY_COUNTS; items: any[] } }>()

// Ringkasan beban koreksi guru: jumlah pengumpulan yang sudah masuk tapi belum
// dinilai, per kategori + per penilaian. Definisi "belum dikoreksi" sengaja
// disamakan dengan yang dipakai halaman Kuis/Ulangan (sumber kebenaran lama):
//  - Kuis    : submitted_at terisi && is_graded !== true
//  - Ulangan : is_submitted && is_graded !== true
//  - UTS/UAS : is_submitted && is_graded !== true (official_exam_submissions)
//  - Tugas   : baris student_submissions tanpa baris grades
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: teacher, error: teacherError } = await supabase
            .from('teachers')
            .select('id')
            .eq('user_id', user.id)
            .single()

        if (teacherError || !teacher) {
            return NextResponse.json({ error: 'Teacher not found' }, { status: 404 })
        }

        // Cache hit → langsung balas tanpa menyentuh DB (lihat komentar deklarasi
        // gradingCache). Kunci = teacher.id, bukan user.id — aman lintas sekolah.
        const cached = gradingCache.get(teacher.id)
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
            return NextResponse.json(cached.body)
        }

        const { data: allAssignments } = await supabase
            .from('teaching_assignments')
            .select(`
                id, class_id,
                subject:subjects(id, name),
                class:classes(id, name),
                academic_year:academic_years(is_active)
            `)
            .eq('teacher_id', teacher.id)

        const activeAssignments = (allAssignments || []).filter((ta: any) => {
            const ay = Array.isArray(ta.academic_year) ? ta.academic_year[0] : ta.academic_year
            return ay?.is_active === true
        })

        const taIds = activeAssignments.map((ta: any) => ta.id)
        const classIds = Array.from(new Set(activeAssignments.map((ta: any) => ta.class_id)))
        const subjectIds = Array.from(new Set(
            activeAssignments.map((ta: any) => unwrap(ta.subject)?.id).filter(Boolean)
        ))

        const taMeta = new Map<string, { class_name: string; subject_name: string }>(
            activeAssignments.map((ta: any) => [ta.id, {
                class_name: unwrap(ta.class)?.name || 'Tanpa Kelas',
                subject_name: unwrap(ta.subject)?.name || 'Tanpa Mapel',
            }])
        )
        const classNameById = new Map<string, string>(
            activeAssignments.map((ta: any) => [ta.class_id, unwrap(ta.class)?.name || 'Tanpa Kelas'])
        )
        const subjectNameById = new Map<string, string>(
            activeAssignments
                .map((ta: any) => unwrap(ta.subject))
                .filter(Boolean)
                .map((s: any) => [s.id, s.name])
        )

        if (taIds.length === 0) {
            const body = { counts: EMPTY_COUNTS, items: [] }
            gradingCache.set(teacher.id, { at: Date.now(), body })
            return NextResponse.json(body)
        }

        const [quizzes, tasks] = await Promise.all([
            batchedIn<any>('teaching_assignment_id', taIds,
                (chunk) => supabase.from('quizzes').select('id, title, teaching_assignment_id, is_remedial').in('teaching_assignment_id', chunk)),
            batchedIn<any>('teaching_assignment_id', taIds,
                (chunk) => supabase.from('assignments').select('id, title, teaching_assignment_id').in('teaching_assignment_id', chunk)),
        ])

        // Ulangan — CO-TAUGHT: exam milik TA sendiri ATAU TA pengampu lain dengan
        // mapel+kelas yang sama (kelas multi-guru = 1 exam per kelas; semua
        // pengampu menanggapi beban koreksinya). class_id unik per tahun ajaran
        // (tiap tahun punya baris kelas sendiri) → pair filter otomatis year-scoped.
        let exams: any[] = []
        if (subjectIds.length > 0 && classIds.length > 0) {
            const pairSet = new Set(
                activeAssignments.map((ta: any) => `${unwrap(ta.subject)?.id}|${ta.class_id}`)
            )
            const { data: exRows } = await supabase
                .from('exams')
                .select('id, title, teaching_assignment_id, is_remedial, ta:teaching_assignments!inner(subject_id, class_id)')
                .in('ta.subject_id', subjectIds)
                .in('ta.class_id', classIds)
            exams = (exRows || []).filter((e: any) => {
                const ta = unwrap(e.ta)
                return pairSet.has(`${ta?.subject_id}|${ta?.class_id}`)
            })
        }
        const quizIds = quizzes.map((q: any) => q.id)
        const examIds = exams.map((e: any) => e.id)
        const taskIds = tasks.map((t: any) => t.id)

        // Kuis
        const quizSubs = await batchedFetchAll<{ quiz_id: string; is_graded: boolean | null }>(
            'quiz_id', quizIds,
            (chunk) => supabase.from('quiz_submissions').select('quiz_id, is_graded').in('quiz_id', chunk).not('submitted_at', 'is', null).order('id')
        )
        const quizStats = new Map<string, { submitted: number; ungraded: number }>()
        for (const s of quizSubs) {
            const stat = quizStats.get(s.quiz_id) || { submitted: 0, ungraded: 0 }
            stat.submitted += 1
            if (s.is_graded !== true) stat.ungraded += 1
            quizStats.set(s.quiz_id, stat)
        }

        // Ulangan harian
        const examSubs = await batchedFetchAll<{ exam_id: string; is_graded: boolean | null }>(
            'exam_id', examIds,
            (chunk) => supabase.from('exam_submissions').select('exam_id, is_graded').in('exam_id', chunk).eq('is_submitted', true).order('id')
        )
        const examStats = new Map<string, { submitted: number; ungraded: number }>()
        for (const s of examSubs) {
            const stat = examStats.get(s.exam_id) || { submitted: 0, ungraded: 0 }
            stat.submitted += 1
            if (s.is_graded !== true) stat.ungraded += 1
            examStats.set(s.exam_id, stat)
        }

        // Tugas (submission tanpa baris grades = belum dikoreksi)
        const taskSubs = await batchedFetchAll<{ id: string; assignment_id: string }>(
            'assignment_id', taskIds,
            (chunk) => supabase.from('student_submissions').select('id, assignment_id').in('assignment_id', chunk).order('id')
        )
        const taskGradedSubIds = new Set<string>()
        if (taskSubs.length > 0) {
            const gradedRows = await batchedIn<{ submission_id: string }>(
                'submission_id', taskSubs.map(s => s.id),
                (chunk) => supabase.from('grades').select('submission_id').in('submission_id', chunk)
            )
            for (const g of gradedRows) taskGradedSubIds.add(g.submission_id)
        }
        const taskStats = new Map<string, { submitted: number; ungraded: number }>()
        for (const s of taskSubs) {
            const stat = taskStats.get(s.assignment_id) || { submitted: 0, ungraded: 0 }
            stat.submitted += 1
            if (!taskGradedSubIds.has(s.id)) stat.ungraded += 1
            taskStats.set(s.assignment_id, stat)
        }

        // UTS/UAS resmi — scoped mapel + kelas yang diajar. WAJIB filter tahun
        // ajaran aktif — tanpa ini pengumpulan belum-dinilai dari ujian resmi
        // tahun lalu ikut menggelembungkan angka (konsisten dengan
        // GET /api/official-exams yang year-scoped).
        let officialExams: any[] = []
        const officialStats = new Map<string, { submitted: number; ungraded: number }>()
        if (subjectIds.length > 0) {
            const { data: activeYears } = await supabase
                .from('academic_years')
                .select('id')
                .eq('is_active', true)
                .eq('school_id', schoolId)
                .order('created_at', { ascending: false })
                .limit(1)
            const activeYearId = activeYears?.[0]?.id
            if (activeYearId) {
                const { data: oe } = await supabase
                    .from('official_exams')
                    .select('id, title, exam_type, subject_id, target_class_ids, is_remedial')
                    .eq('school_id', schoolId)
                    .eq('academic_year_id', activeYearId)
                    .in('subject_id', subjectIds)
                officialExams = (oe || []).filter((e: any) =>
                    (e.target_class_ids || []).some((cid: string) => classIds.includes(cid))
                )
                const oeIds = officialExams.map((e: any) => e.id)
                const officialSubs = await batchedFetchAll<{ exam_id: string; is_graded: boolean | null }>(
                    'exam_id', oeIds,
                    (chunk) => supabase.from('official_exam_submissions').select('exam_id, is_graded').in('exam_id', chunk).eq('is_submitted', true).order('id')
                )
                for (const s of officialSubs) {
                    const stat = officialStats.get(s.exam_id) || { submitted: 0, ungraded: 0 }
                    stat.submitted += 1
                    if (s.is_graded !== true) stat.ungraded += 1
                    officialStats.set(s.exam_id, stat)
                }
            }
        }

        const items: {
            type: string
            id: string
            title: string
            class_name: string
            subject_name: string
            submitted_count: number
            ungraded_count: number
        }[] = []

        for (const t of tasks) {
            const meta = taMeta.get(t.teaching_assignment_id) || { class_name: '', subject_name: '' }
            const stat = taskStats.get(t.id) || { submitted: 0, ungraded: 0 }
            items.push({ type: 'TUGAS', id: t.id, title: t.title, class_name: meta.class_name, subject_name: meta.subject_name, submitted_count: stat.submitted, ungraded_count: stat.ungraded })
        }

        for (const q of quizzes) {
            const meta = taMeta.get(q.teaching_assignment_id) || { class_name: '', subject_name: '' }
            const stat = quizStats.get(q.id) || { submitted: 0, ungraded: 0 }
            items.push({ type: 'KUIS', id: q.id, title: q.title, class_name: meta.class_name, subject_name: meta.subject_name, submitted_count: stat.submitted, ungraded_count: stat.ungraded })
        }

        for (const e of exams) {
            // TA anchor bisa milik co-teacher — resolve nama via map kelas/mapel
            const ta = unwrap((e as any).ta)
            const meta = taMeta.get(e.teaching_assignment_id) || {
                class_name: classNameById.get(ta?.class_id) || '',
                subject_name: subjectNameById.get(ta?.subject_id) || '',
            }
            const stat = examStats.get(e.id) || { submitted: 0, ungraded: 0 }
            items.push({ type: 'ULANGAN', id: e.id, title: e.title, class_name: meta.class_name, subject_name: meta.subject_name, submitted_count: stat.submitted, ungraded_count: stat.ungraded })
        }

        for (const e of officialExams) {
            const targetNames = Array.from(new Set(
                (e.target_class_ids || [])
                    .filter((cid: string) => classNameById.has(cid))
                    .map((cid: string) => classNameById.get(cid) as string)
            ))
            const stat = officialStats.get(e.id) || { submitted: 0, ungraded: 0 }
            items.push({
                type: e.exam_type || 'UTS',
                id: e.id,
                title: e.title,
                class_name: targetNames.join(', ') || 'Ujian Resmi',
                subject_name: subjectNameById.get(e.subject_id) || '',
                submitted_count: stat.submitted,
                ungraded_count: stat.ungraded,
            })
        }

        // counts = jumlah PENILAIAN yang punya minimal 1 pengumpulan belum dinilai
        // (dipakai badge menu). Detail beban per penilaian ada di items.ungraded_count.
        const pendingItems = items.filter(i => i.ungraded_count > 0)
        const counts = {
            tugas: pendingItems.filter(i => i.type === 'TUGAS').length,
            kuis: pendingItems.filter(i => i.type === 'KUIS').length,
            ulangan: pendingItems.filter(i => i.type === 'ULANGAN').length,
            utsUas: pendingItems.filter(i => i.type === 'UTS' || i.type === 'UAS').length,
        }

        items.sort((a, b) => b.ungraded_count - a.ungraded_count || a.title.localeCompare(b.title))

        const body = { counts, items }
        gradingCache.set(teacher.id, { at: Date.now(), body })
        return NextResponse.json(body)
    } catch (error: any) {
        console.error('Error fetching grading overview:', error)
        return NextResponse.json({ error: 'Server error', details: error.message }, { status: 500 })
    }
}
