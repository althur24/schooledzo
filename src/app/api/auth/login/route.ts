import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser, createSession, SESSION_COOKIE_MAX_AGE } from '@/lib/auth'

// M1 Security Fix: In-memory rate limiter untuk login.
// PENTING: hanya PERCOBAAN GAGAL yang dihitung. Ratusan siswa login sukses
// serentak dari WiFi sekolah (1 IP publik) tidak boleh diblok — skenario
// normal jam 07:30 sebelum ulangan. Yang dibatasi:
//  - per-IP: gagal massal dari satu sumber (bot/brute-force distribusi)
//  - per-username: brute-force terarah ke satu akun
const IP_FAIL_LIMIT = 200          // gagal per IP per 1 menit
const USERNAME_FAIL_LIMIT = 10     // gagal per username per 10 menit
const IP_WINDOW_MS = 60 * 1000
const USERNAME_WINDOW_MS = 10 * 60 * 1000

const ipFails = new Map<string, { count: number; resetTime: number }>()
const usernameFails = new Map<string, { count: number; resetTime: number }>()

function isBlocked(ip: string, username: string): boolean {
    const now = Date.now()
    const ipEntry = ipFails.get(ip)
    if (ipEntry && now <= ipEntry.resetTime && ipEntry.count >= IP_FAIL_LIMIT) return true
    const userEntry = usernameFails.get(username)
    if (userEntry && now <= userEntry.resetTime && userEntry.count >= USERNAME_FAIL_LIMIT) return true
    return false
}

function recordFailure(ip: string, username: string) {
    const now = Date.now()
    const ipEntry = ipFails.get(ip)
    if (!ipEntry || now > ipEntry.resetTime) {
        ipFails.set(ip, { count: 1, resetTime: now + IP_WINDOW_MS })
    } else {
        ipEntry.count++
    }
    const userEntry = usernameFails.get(username)
    if (!userEntry || now > userEntry.resetTime) {
        usernameFails.set(username, { count: 1, resetTime: now + USERNAME_WINDOW_MS })
    } else {
        userEntry.count++
    }
}

// Login sukses: hapus hitungan gagal username (IP dipertahankan —
// hanya berisi kegagalan nyata, bukan trafik login sukses)
function clearUsernameFails(username: string) {
    usernameFails.delete(username)
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
    const now = Date.now()
    for (const [ip, entry] of ipFails.entries()) {
        if (now > entry.resetTime) ipFails.delete(ip)
    }
    for (const [username, entry] of usernameFails.entries()) {
        if (now > entry.resetTime) usernameFails.delete(username)
    }
}, 5 * 60 * 1000)

export async function POST(request: NextRequest) {
    try {
        // M1: Rate limit — hanya blokir sumber yang terbukti gagal berulang
        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
        const { username, password } = await request.json()
        if (isBlocked(String(ip), String(username || ''))) {
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
            recordFailure(String(ip), String(username))
            return NextResponse.json(
                { error: 'Username atau password salah' },
                { status: 401 }
            )
        }

        clearUsernameFails(String(username))

        if (user.is_locked) {
            return NextResponse.json(
                { error: 'Akun Anda ditangguhkan sementara. Silakan hubungi administrasi sekolah.' },
                { status: 403 }
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
                school_name: null, // Will be populated by /api/auth/me
                must_change_password: user.must_change_password
            }
        })

        // Set HTTP-only cookie
        response.cookies.set('session_token', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: SESSION_COOKIE_MAX_AGE,
            path: '/'
        })

        // Set role cookie (non-httpOnly) for middleware-level route protection
        response.cookies.set('user_role', user.role, {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: SESSION_COOKIE_MAX_AGE,
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
