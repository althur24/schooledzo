import { NextRequest, NextResponse } from 'next/server'
import { deleteSession } from '@/lib/auth'
import { isSecureRequest } from '@/lib/cookieSecure'

export async function POST(request: NextRequest) {
    try {
        const sessionToken = request.cookies.get('session_token')?.value

        if (sessionToken) {
            await deleteSession(sessionToken)
        }

        const response = NextResponse.json({ success: true })

        // Clear the cookies
        response.cookies.set('session_token', '', {
            httpOnly: true,
            secure: isSecureRequest(request),
            sameSite: 'lax',
            maxAge: 0,
            path: '/'
        })
        response.cookies.set('user_role', '', {
            httpOnly: false,
            secure: isSecureRequest(request),
            sameSite: 'lax',
            maxAge: 0,
            path: '/'
        })

        return response
    } catch (error) {
        console.error('Logout error:', error)
        return NextResponse.json(
            { error: 'Terjadi kesalahan server' },
            { status: 500 }
        )
    }
}
