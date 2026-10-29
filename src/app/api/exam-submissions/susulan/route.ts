import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { grantSusulan, revokeSusulan } from '@/lib/susulanGrant'

/**
 * Grant/revoke Susulan untuk ULANGAN.
 * POST   { exam_id, student_id, max_percent } -> buka/perpanjang attempt susulan
 * DELETE { submission_id }                    -> batalkan (hanya sebelum siswa mulai)
 * Lihat src/lib/susulanGrant.ts untuk seluruh guard tenant/scope/roster/waktu.
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
            'exam',
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
        console.error('Error granting susulan (exam):', error)
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
            'exam',
            { submissionId: body?.submission_id },
            { userId: user.id, role: user.role, schoolId },
        )
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

        return NextResponse.json({ success: true, message: 'Susulan dibatalkan' })
    } catch (error) {
        console.error('Error revoking susulan (exam):', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
