import { NextRequest, NextResponse } from 'next/server'
import { validateSession, SESSION_COOKIE_MAX_AGE } from '@/lib/auth'
import { isSecureRequest } from '@/lib/cookieSecure'

// Shared cookie options (must match login/logout routes).
// secure ditentukan per-request (isSecureRequest) — lihat src/lib/cookieSecure.ts.
const sessionCookieOpts = (request: NextRequest) => ({
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'lax' as const,
    path: '/',
})

const roleCookieOpts = (request: NextRequest) => ({
    httpOnly: false,
    secure: isSecureRequest(request),
    sameSite: 'lax' as const,
    path: '/',
})

function clearAuthCookies(request: NextRequest, response: NextResponse): NextResponse {
    response.cookies.set('session_token', '', { ...sessionCookieOpts(request), maxAge: 0 })
    response.cookies.set('user_role', '', { ...roleCookieOpts(request), maxAge: 0 })
    return response
}

export async function GET(request: NextRequest) {
    try {
        const sessionToken = request.cookies.get('session_token')?.value

        if (!sessionToken) {
            return clearAuthCookies(request, NextResponse.json(
                { error: 'Tidak ada session' },
                { status: 401 }
            ))
        }

        const user = await validateSession(sessionToken)

        if (!user) {
            // Session expired/invalid in DB but cookie may still be alive (it
            // outlives the 24h DB session). Clear it so middleware stops
            // bouncing /login -> /dashboard (the "Mengalihkan..." loop).
            return clearAuthCookies(request, NextResponse.json(
                { error: 'Session tidak valid' },
                { status: 401 }
            ))
        }

        const response = NextResponse.json({ user })

        // Slide the cookie lifetime on each successful check so active users
        // don't get logged out by the cookie's absolute maxAge while their DB
        // session is still valid (refreshed by validateSession).
        response.cookies.set('session_token', sessionToken, {
            ...sessionCookieOpts(request),
            maxAge: SESSION_COOKIE_MAX_AGE,
        })
        // Keep user_role cookie in sync for middleware-level route protection
        response.cookies.set('user_role', user.role, {
            ...roleCookieOpts(request),
            maxAge: SESSION_COOKIE_MAX_AGE,
        })

        return response
    } catch (error) {
        console.error('Session check error:', error)
        // Do NOT clear the cookie on a server error — the session may still be
        // valid (transient Supabase blip). The client treats 5xx as a
        // connection error and shows a retry screen instead of redirecting to
        // /login, which would bounce-loop because the cookie is still alive.
        return NextResponse.json(
            { error: 'Terjadi kesalahan server' },
            { status: 500 }
        )
    }
}
