import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser, createSession } from '@/lib/auth'

// M1 Security Fix: In-memory rate limiter for login attempts
const loginAttempts = new Map<string, { count: number; resetTime: number }>()
const MAX_ATTEMPTS = 100  // High limit: 40+ students may login from same school WiFi (shared IP)
const WINDOW_MS = 60 * 1000 // 1 minute

function checkRateLimit(ip: string): boolean {
    const now = Date.now()
    const entry = loginAttempts.get(ip)
    if (!entry || now > entry.resetTime) {
        loginAttempts.set(ip, { count: 1, resetTime: now + WINDOW_MS })
        return true
    }
    entry.count++
    if (entry.count > MAX_ATTEMPTS) return false
    return true
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
    const now = Date.now()
    for (const [ip, entry] of loginAttempts.entries()) {
        if (now > entry.resetTime) loginAttempts.delete(ip)
    }
}, 5 * 60 * 1000)

export async function POST(request: NextRequest) {
    try {
        // M1: Rate limit check by IP
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
        const { username, password } = await request.json()
        if (!checkRateLimit(ip)) {
            return NextResponse.json(
                { error: 'Terlalu banyak percobaan login. Coba lagi dalam 1 menit.' },
                { status: 429 }
            )
        }

        if (!username || !password) {
            return NextResponse.json(
                { error: 'Username dan password harus diisi' },
                { status: 400 }
            )
        }

        const user = await authenticateUser(username, password)

        if (!user) {
            return NextResponse.json(
                { error: 'Username atau password salah' },
                { status: 401 }
            )
        }

        const sessionToken = await createSession(user.id)

        if (!sessionToken) {
            return NextResponse.json(
                { error: 'Gagal membuat session' },
                { status: 500 }
            )
        }

        const response = NextResponse.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                role: user.role,
                school_id: user.role === 'SUPER_ADMIN' ? null : user.school_id,
                school_name: null // Will be populated by /api/auth/me
            }
        })

        // Set HTTP-only cookie
        response.cookies.set('session_token', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7, // 7 days
            path: '/'
        })

        return response
    } catch (error) {
        console.error('Login error:', error)
        return NextResponse.json(
            { error: 'Terjadi kesalahan server' },
            { status: 500 }
        )
    }
}
