import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth', '/api/schools/public']

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl
    const sessionToken = request.cookies.get('session_token')?.value

    // Allow public paths and external APIs
    if (PUBLIC_PATHS.some(path => pathname.startsWith(path)) || pathname.startsWith('/api/external')) {
        // If logged in and trying to access login, redirect to dashboard
        if (pathname === '/login' && sessionToken) {
            return NextResponse.redirect(new URL('/dashboard', request.url))
        }
        return NextResponse.next()
    }

    // Check if user is authenticated
    if (!sessionToken) {
        const loginUrl = new URL('/login', request.url)
        loginUrl.searchParams.set('redirect', pathname)
        return NextResponse.redirect(loginUrl)
    }

    // Role-based access is handled in the dashboard pages
    // because middleware can't make async database calls efficiently
    return NextResponse.next()
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)',
    ],
}
