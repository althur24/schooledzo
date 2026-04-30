import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'

/**
 * GET /api/admin/review-queue
 * 
 * Fetch all questions for admin review.
 * Shows all questions from all sources, with optional status filtering.
 * 
 * Query params:
 * - source: 'bank' | 'quiz' | 'exam' (optional filter)
 * - status: 'admin_review' | 'approved' | 'ai_reviewing' | 'returned' | 'draft' (optional)
 * - page: page number (default 1)
 * - limit: items per page (default 20)
 */
export async function GET(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const source = request.nextUrl.searchParams.get('source')
        const statusFilter = request.nextUrl.searchParams.get('status')
        const page = parseInt(request.nextUrl.searchParams.get('page') || '1')
        const limit = parseInt(request.nextUrl.searchParams.get('limit') || '20')
        const offset = (page - 1) * limit

        // Build results from all 3 question tables
        const results: any[] = []
        let totalCount = 0

        // Helper: fetch questions by source with their AI reviews
        async function fetchBySource(
            tableName: string,
            sourceType: string,
            extraSelect: string = '',
            inFilter?: { field: string; values: string[] }
        ) {
            let query = supabase
                .from(tableName)
                .select(`*, ${extraSelect}`, { count: 'exact' })

            // Apply status filter if provided, otherwise show all
            if (statusFilter) {
                query = query.eq('status', statusFilter)
            }

            // Apply school scoping filter
            if (inFilter) {
                if (inFilter.values.length === 0) return []
                query = query.in(inFilter.field, inFilter.values)
            }

            const { data, count, error } = await query
                .order('created_at', { ascending: false })
                .limit(1000)

            if (error) {
                console.error(`Error fetching ${sourceType} questions:`, error)
                return []
            }

            if (count) totalCount += count

            if (!data) return []

            // Fetch AI reviews for these questions
            const questionIds = data.map((q: any) => q.id)
            const { data: reviews } = await supabase
                .from('ai_reviews')
                .select('*')
                .eq('question_source', sourceType)
                .in('question_id', questionIds)

            // Map reviews to questions
            const reviewMap = new Map()
            reviews?.forEach((r: any) => reviewMap.set(r.question_id, r))

            return data.map((q: any) => ({
                ...q,
                question_source: sourceType,
                ai_review: reviewMap.get(q.id) || null
            }))
        }

        // Fetch based on source filter or all
        if (!source || source === 'bank') {
            // For question_bank, filter by teacher's school
            let bankTeacherIds: string[] | null = null
            if (schoolId) {
                const { data: schoolTeachers } = await supabase
                    .from('teachers')
                    .select('id')
                    .eq('school_id', schoolId)
                bankTeacherIds = schoolTeachers?.map(t => t.id) || []
            }
            const bankData = await fetchBySource(
                'question_bank', 'bank',
                'subject:subjects(id, name), teacher:teachers(id, user:users(full_name))',
                bankTeacherIds ? { field: 'teacher_id', values: bankTeacherIds } : undefined
            )
            results.push(...bankData)
        }

        // For quiz/exam questions, get teaching_assignment IDs belonging to this school
        let schoolTAIds: string[] | null = null
        if (schoolId && (!source || source === 'quiz' || source === 'exam')) {
            // teaching_assignments doesn't have school_id — scope via academic_years
            const { data: schoolYears } = await supabase
                .from('academic_years')
                .select('id')
                .eq('school_id', schoolId)
            const yearIds = schoolYears?.map(y => y.id) || []
            if (yearIds.length > 0) {
                const { data: schoolTAs } = await supabase
                    .from('teaching_assignments')
                    .select('id')
                    .in('academic_year_id', yearIds)
                schoolTAIds = schoolTAs?.map(ta => ta.id) || []
            } else {
                schoolTAIds = []
            }
        }

        if (!source || source === 'quiz') {
            // Get quiz IDs belonging to this school's teaching assignments
            let quizIdFilter: string[] | null = null
            if (schoolTAIds) {
                const { data: schoolQuizzes } = await supabase
                    .from('quizzes')
                    .select('id')
                    .in('teaching_assignment_id', schoolTAIds.length > 0 ? schoolTAIds : [])
                quizIdFilter = schoolQuizzes?.map(q => q.id) || []
            }
            const quizData = await fetchBySource(
                'quiz_questions', 'quiz',
                'quiz:quizzes(id, title, teaching_assignment:teaching_assignments(subject:subjects(name), class:classes(name, school_level), teacher:teachers(id, user:users(full_name))))',
                quizIdFilter ? { field: 'quiz_id', values: quizIdFilter } : undefined
            )
            results.push(...quizData)
        }

        if (!source || source === 'exam') {
            let examIdFilter: string[] | null = null
            if (schoolTAIds) {
                const { data: schoolExams } = await supabase
                    .from('exams')
                    .select('id')
                    .in('teaching_assignment_id', schoolTAIds.length > 0 ? schoolTAIds : [])
                examIdFilter = schoolExams?.map(e => e.id) || []
            }
            const examData = await fetchBySource(
                'exam_questions', 'exam',
                'exam:exams(id, title, teaching_assignment:teaching_assignments(subject:subjects(name), class:classes(name, school_level), teacher:teachers(id, user:users(full_name))))',
                examIdFilter ? { field: 'exam_id', values: examIdFilter } : undefined
            )
            results.push(...examData)
        }

        // Sort by AI review priority (lower = higher priority), then by date
        results.sort((a, b) => {
            const prioA = a.ai_review?.full_json_report?.priority || 100
            const prioB = b.ai_review?.full_json_report?.priority || 100
            if (prioA !== prioB) return prioA - prioB
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        })

        // Paginate using the true database count
        const total = totalCount || results.length
        const paginated = results.slice(offset, offset + limit)

        return NextResponse.json({
            data: paginated,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        })

    } catch (error) {
        console.error('Error fetching review queue:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

/**
 * POST /api/admin/review-queue
 * 
 * Admin action on a question: approve, return, or archive.
 * 
 * Body:
 * {
 *   question_id: string,
 *   question_source: 'bank' | 'quiz' | 'exam',
 *   decision: 'approve' | 'return' | 'archive',
 *   notes?: string,
 *   return_reasons?: string[],
 *   override_bloom?: number,
 *   override_hots_strength?: string,
 *   override_difficulty?: string,
 *   override_boundedness?: string
 * }
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const {
            question_id,
            question_source,
            decision,
            notes,
            return_reasons,
            override_bloom,
            override_hots_strength,
            override_difficulty,
            override_boundedness
        } = body

        if (!question_id || !question_source || !decision) {
            return NextResponse.json(
                { error: 'question_id, question_source, dan decision diperlukan' },
                { status: 400 }
            )
        }

        if (!['approve', 'return'].includes(decision)) {
            return NextResponse.json(
                { error: 'decision harus approve atau return' },
                { status: 400 }
            )
        }

        // 1. Save admin review
        const { error: reviewError } = await supabase
            .from('admin_reviews')
            .insert({
                question_source,
                question_id,
                reviewer_id: user.id,
                decision,
                notes: notes || null,
                return_reasons: return_reasons || null,
                override_bloom: override_bloom || null,
                override_hots_strength: override_hots_strength || null,
                override_difficulty: override_difficulty || null,
                override_boundedness: override_boundedness || null
            })

        if (reviewError) {
            console.error('Error saving admin review:', reviewError)
            throw reviewError
        }

        // 2. Update question status
        const tableName = question_source === 'bank' ? 'question_bank'
            : question_source === 'quiz' ? 'quiz_questions'
                : 'exam_questions'

        const statusMap: Record<string, string> = {
            approve: 'approved',
            return: 'returned'
        }

        const { error: updateError } = await supabase
            .from(tableName)
            .update({ status: statusMap[decision] })
            .eq('id', question_id)

        if (updateError) {
            console.error('Error updating question status:', updateError)
            throw updateError
        }

        // 3. Notify the teacher about the decision
        try {
            let teacherUserId: string | null = null
            let parentId: string | null = null
            let parentTitle: string | null = null

            if (question_source === 'bank') {
                const { data: q } = await supabase
                    .from('question_bank')
                    .select('teacher:teachers(user_id)')
                    .eq('id', question_id)
                    .single()
                teacherUserId = (q as any)?.teacher?.user_id || null
            } else {
                const sourceTable = question_source === 'quiz' ? 'quiz_questions' : 'exam_questions'
                const parentField = question_source === 'quiz' ? 'quiz:quizzes(id,title,teaching_assignment:teaching_assignments(teacher:teachers(user_id)))' : 'exam:exams(id,title,teaching_assignment:teaching_assignments(teacher:teachers(user_id)))'
                const { data: q } = await supabase
                    .from(sourceTable)
                    .select(parentField)
                    .eq('id', question_id)
                    .single()
                const parent = question_source === 'quiz' ? (q as any)?.quiz : (q as any)?.exam
                parentId = parent?.id || null
                parentTitle = parent?.title || null
                const ta = parent?.teaching_assignment
                const taObj = Array.isArray(ta) ? ta[0] : ta
                const teacher = taObj?.teacher
                const teacherObj = Array.isArray(teacher) ? teacher[0] : teacher
                teacherUserId = teacherObj?.user_id || null
                console.log(`[NOTIF-DEBUG] review-queue teacher lookup: parent=${JSON.stringify(parent)?.slice(0, 200)}, teacherUserId=${teacherUserId}`)
            }

            if (teacherUserId) {
                // Skip individual 'approve' notifications for quiz/exam questions
                // to prevent notification spam. autoPublish handles the aggregated notification.
                const shouldSend = !(decision === 'approve' && (question_source === 'quiz' || question_source === 'exam'))

                if (shouldSend) {
                    let notifTitle = decision === 'approve'
                        ? '✅ Soal Anda telah disetujui admin'
                        : '↩️ Soal Anda dikembalikan oleh admin'
                    
                    if (parentTitle && (question_source === 'quiz' || question_source === 'exam')) {
                        const typeName = question_source === 'quiz' ? 'Kuis' : 'Ulangan'
                        notifTitle = decision === 'approve'
                            ? `✅ Soal disetujui — ${typeName}: ${parentTitle}`
                            : `↩️ Soal dikembalikan — ${typeName}: ${parentTitle}`
                    }

                    const notifMessage = notes
                        ? `Catatan admin: ${notes}`
                        : decision === 'approve'
                            ? 'Soal Anda telah melewati review dan disetujui.'
                            : 'Silakan periksa dan perbaiki soal Anda.'

                    let link = decision === 'return' ? '/dashboard/guru/bank-soal?status=returned' : '/dashboard/guru/bank-soal'
                    if (question_source === 'quiz') {
                        link = parentId ? `/dashboard/guru/kuis/${parentId}?highlight=${question_id}` : '/dashboard/guru/kuis'
                    }
                    if (question_source === 'exam') {
                        link = parentId ? `/dashboard/guru/ulangan/${parentId}?highlight=${question_id}` : '/dashboard/guru/ulangan'
                    }

                    await supabase.from('notifications').insert({
                        user_id: teacherUserId,
                        type: 'HOTS_REVIEW',
                        title: notifTitle,
                        message: notifMessage,
                        link
                    })
                }
            }
        } catch (notifError) {
            console.error('Error sending notification:', notifError)
            // Don't fail the main action if notification fails
        }

        // 4. If approved, check if parent quiz/exam can be auto-published
        if (decision === 'approve' && (question_source === 'quiz' || question_source === 'exam')) {
            try {
                // Get the parent ID from the question
                const sourceTable = question_source === 'quiz' ? 'quiz_questions' : 'exam_questions'
                const parentField = question_source === 'quiz' ? 'quiz_id' : 'exam_id'
                const { data: questionData } = await supabase
                    .from(sourceTable)
                    .select(parentField)
                    .eq('id', question_id)
                    .single()

                const parentId = (questionData as any)?.[parentField]
                if (parentId) {
                    const { checkAndAutoPublish } = await import('@/lib/autoPublish')
                    await checkAndAutoPublish(question_source as 'quiz' | 'exam', parentId)
                }
            } catch (autoPublishError) {
                console.error('Error checking auto-publish:', autoPublishError)
                // Don't fail the main action
            }
        }

        // 5. If returned, reset pending_publish so guru can re-publish after fixing
        if (decision === 'return' && (question_source === 'quiz' || question_source === 'exam')) {
            try {
                const sourceTable = question_source === 'quiz' ? 'quiz_questions' : 'exam_questions'
                const parentField = question_source === 'quiz' ? 'quiz_id' : 'exam_id'
                const parentTable = question_source === 'quiz' ? 'quizzes' : 'exams'

                const { data: questionData } = await supabase
                    .from(sourceTable)
                    .select(parentField)
                    .eq('id', question_id)
                    .single()

                const parentId = (questionData as any)?.[parentField]
                if (parentId) {
                    // Reset pending_publish so the Publish button reappears for the teacher
                    await supabase
                        .from(parentTable)
                        .update({ pending_publish: false })
                        .eq('id', parentId)
                        .eq('pending_publish', true) // Only reset if currently pending
                    console.log(`[review-queue] Reset pending_publish for ${question_source}/${parentId} after return`)
                }
            } catch (resetError) {
                console.error('Error resetting pending_publish:', resetError)
                // Don't fail the main action
            }
        }

        return NextResponse.json({
            success: true,
            question_id,
            new_status: statusMap[decision]
        })

    } catch (error) {
        console.error('Error processing admin review:', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
