import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { grantSusulan, revokeSusulan } from '@/lib/susulanGrant'

/**
 * Grant/revoke Susulan untuk UTS/UAS.
 * POST   { exam_id, student_id, max_percent }
 * DELETE { submission_id }
 * Logika penuh ada di src/lib/susulanGrant.ts (satu sumber dengan ulangan).
 */
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json().catch(() => ({}))
        const result = await grantSusulan(
            'official',
            { examId: body?.exam_id, studentId: body?.student_id, maxPercent: body?.max_percent },
            { userId: user.id, role: user.role, schoolId },
        )
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

        return NextResponse.json({
            success: true,
            message: `Susulan dibuka (maks ${result.maxPercent}% nilai, berlaku 7 hari)`,
            submission_id: result.submissionId,
            susulan_expires_at: result.expiresAt,
            susulan_max_percent: result.maxPercent,
        })
    } catch (error) {
        console.error('Error granting susulan (official):', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json().catch(() => ({}))
        const result = await revokeSusulan(
            'official',
            { submissionId: body?.submission_id },
            { userId: user.id, role: user.role, schoolId },
        )
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

        return NextResponse.json({ success: true, message: 'Susulan dibatalkan' })
    } catch (error) {
        console.error('Error revoking susulan (official):', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
