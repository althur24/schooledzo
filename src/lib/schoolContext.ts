import { NextRequest, NextResponse } from 'next/server'
import { validateSession } from './auth'
import { AuthUser } from './types'
import { supabaseAdmin } from './supabase'

/**
 * Multi-tenant school context helper
 * Extracts the authenticated user and their school_id from the request.
 * Used by all API routes to ensure data isolation between schools.
 */
export interface SchoolContext {
    user: AuthUser
    schoolId: string | null  // null for SUPER_ADMIN (cross-school access)
}

/**
 * Get the school context from a request.
 * Returns the authenticated user and their school_id.
 * Throws if user is not authenticated.
 */
export async function getSchoolContext(request: NextRequest): Promise<SchoolContext> {
    const token = request.cookies.get('session_token')?.value
    if (!token) {
        throw new AuthError('Unauthorized', 401)
    }

    const user = await validateSession(token)
    if (!user) {
        throw new AuthError('Session expired', 401)
    }

    return {
        user,
        schoolId: user.school_id  // null for SUPER_ADMIN
    }
}

/**
 * Get school context or return error response.
 * Convenience wrapper that returns NextResponse on auth failure.
 */
export async function getSchoolContextOrError(
    request: NextRequest
): Promise<SchoolContext | NextResponse> {
    try {
        return await getSchoolContext(request)
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json(
                { error: error.message },
                { status: error.status }
            )
        }
        return NextResponse.json(
            { error: 'Server error' },
            { status: 500 }
        )
    }
}

/**
 * Check if a school context result is an error response
 */
export async function getSchoolCode(schoolId: string): Promise<string | null> {
    const { data } = await supabaseAdmin.from('schools').select('code').eq('id', schoolId).single()
    return data?.code || null
}

export function isErrorResponse(
    result: SchoolContext | NextResponse
): result is NextResponse {
    return result instanceof NextResponse
}

/**
 * Require a specific role (or array of roles).
 * Returns error response if role doesn't match.
 */
export function requireRole(
    user: AuthUser,
    roles: string | string[]
): NextResponse | null {
    const allowedRoles = Array.isArray(roles) ? roles : [roles]
    if (!allowedRoles.includes(user.role)) {
        return NextResponse.json(
            { error: 'Forbidden' },
            { status: 403 }
        )
    }
    return null
}

class AuthError extends Error {
    status: number
    constructor(message: string, status: number) {
        super(message)
        this.status = status
    }
}
