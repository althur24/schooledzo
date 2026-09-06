import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/api/auth', '/api/schools/public', '/api/ping']

// Role-to-route mapping: which route prefixes each role is allowed to access
const ROLE_ROUTE_RULES: Record<string, string[]> = {
    'SISWA': ['/dashboard/siswa', '/dashboard/change-password'],
    'GURU': ['/dashboard/guru', '/dashboard/change-password'],
    'ADMIN': ['/dashboard/admin', '/dashboard/guru', '/dashboard/change-password'], // Admin can oversee guru
    'SUPER_ADMIN': ['/dashboard'], // Super admin can access everything
    'WALI': ['/dashboard/wali', '/dashboard/change-password'],
}

// Default redirect target for each role
const ROLE_HOME: Record<string, string> = {
    'SISWA': '/dashboard/siswa',
    'GURU': '/dashboard/guru',
    'ADMIN': '/dashboard/admin',
    'SUPER_ADMIN': '/dashboard/super-admin',
    'WALI': '/dashboard/wali',
}

// Route prefixes that are role-specific (need checking)
const ROLE_SPECIFIC_PREFIXES = [
    '/dashboard/siswa',
    '/dashboard/guru',
    '/dashboard/admin',
    '/dashboard/super-admin',
    '/dashboard/wali',
]

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl
    const sessionToken = request.cookies.get('session_token')?.value
    const userRole = request.cookies.get('user_role')?.value

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

    // Role-based route guard (server-side, runs before any page renders)
    if (userRole && pathname.startsWith('/dashboard')) {
        // Only check role-specific routes (not /dashboard itself or /dashboard/change-password)
        const isRoleSpecificRoute = ROLE_SPECIFIC_PREFIXES.some(prefix => pathname.startsWith(prefix))

        if (isRoleSpecificRoute) {
            const allowedPrefixes = ROLE_ROUTE_RULES[userRole] || []
            const isAllowed = allowedPrefixes.some(prefix => pathname.startsWith(prefix))

            if (!isAllowed) {
                // Redirect to user's own dashboard
                const home = ROLE_HOME[userRole] || '/dashboard'
                return NextResponse.redirect(new URL(home, request.url))
            }
        }
    }

    return NextResponse.next()
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|manifest\\.json|sw\\.js|offline\\.html|icons/.*|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)',
    ],
}
