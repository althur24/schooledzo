import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from '@/lib/auth'

export async function GET(request: NextRequest) {
    try {
        const sessionToken = request.cookies.get('session_token')?.value

        if (!sessionToken) {
            return NextResponse.json(
                { error: 'Tidak ada session' },
                { status: 401 }
            )
        }

        const user = await validateSession(sessionToken)

        if (!user) {
            return NextResponse.json(
                { error: 'Session tidak valid' },
                { status: 401 }
            )
        }

        const response = NextResponse.json({ user })

        // Ensure user_role cookie stays in sync (for middleware route protection)
        response.cookies.set('user_role', user.role, {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7,
            path: '/'
        })

        return response
    } catch (error) {
        console.error('Session check error:', error)
        return NextResponse.json(
            { error: 'Terjadi kesalahan server' },
            { status: 500 }
        )
    }
}
