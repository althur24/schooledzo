import bcrypt from 'bcryptjs'
import { supabaseAdmin as supabase } from './supabase'
import { User, Session, AuthUser } from './types'

const SALT_ROUNDS = 10
const SESSION_EXPIRY_HOURS = 24 // I1: Reduced from 7 days to 24 hours
const SESSION_REFRESH_THRESHOLD_HOURS = 12 // Refresh when less than 12h remaining

// Cookie lifetime for session_token / user_role. Set as an absolute backstop
// (7 days). The DB session (24h, sliding) is the real source of truth; when it
// expires the /api/auth/me route clears these cookies so the user lands on
// /login instead of getting stuck on a redirect loop ("Mengalihkan...").
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

// Password utilities
export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash)
}

// Session utilities
export function generateSessionToken(): string {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function getSessionExpiry(): Date {
    const date = new Date()
    date.setHours(date.getHours() + SESSION_EXPIRY_HOURS)
    return date
}

// Auth functions
export async function createSession(userId: string): Promise<string | null> {
    const token = generateSessionToken()
    const expiresAt = getSessionExpiry()

    const { error } = await supabase
        .from('sessions')
        .insert({
            user_id: userId,
            token,
            expires_at: expiresAt.toISOString()
        })

    if (error) {
        console.error('Error creating session:', error)
        return null
    }

    return token
}

// In-process micro-cache untuk validasi session endpoint polling frekuensi
// tinggi (notif dibell tiap 60 dtk per user). Trade-off: perubahan lock/logout
// berlaku paling lambat TTL di bawah — hanya dipakai route tidak-sensitif.
const SESSION_CACHE_TTL_MS = 30_000
const SESSION_CACHE_MAX = 2000
const sessionCache = new Map<string, { user: AuthUser; expiresAt: number }>()

export async function validateSessionCached(token: string): Promise<AuthUser | null> {
    const hit = sessionCache.get(token)
    if (hit && hit.expiresAt > Date.now()) return hit.user

    const user = await validateSession(token)
    if (user) {
        if (sessionCache.size >= SESSION_CACHE_MAX) {
            const oldest = sessionCache.keys().next().value
            if (oldest !== undefined) sessionCache.delete(oldest)
        }
        sessionCache.set(token, { user, expiresAt: Date.now() + SESSION_CACHE_TTL_MS })
    }
    return user
}

export async function validateSession(token: string): Promise<AuthUser | null> {
    const { data: session, error } = await supabase
        .from('sessions')
        .select(`
      *,
      user:users(id, username, full_name, role, school_id, must_change_password, is_locked, school:schools(id, name))
    `)
        .eq('token', token)
        .gt('expires_at', new Date().toISOString())
        .single()

    if (error || !session || !session.user) {
        return null
    }

    // Immediately invalidate session if the user account is locked
    if (session.user.is_locked) {
        return null
    }

    // I1: Sliding window — extend session if expiring within threshold
    const expiresAt = new Date(session.expires_at)
    const hoursRemaining = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60)
    if (hoursRemaining < SESSION_REFRESH_THRESHOLD_HOURS) {
        const newExpiry = getSessionExpiry()
        await supabase
            .from('sessions')
            .update({ expires_at: newExpiry.toISOString() })
            .eq('id', session.id)
    }

    return {
        id: session.user.id,
        username: session.user.username,
        full_name: session.user.full_name,
        role: session.user.role,
        school_id: session.user.role === 'SUPER_ADMIN' ? null : session.user.school_id,
        school_name: session.user.school?.name || null,
        must_change_password: session.user.must_change_password,
        is_locked: session.user.is_locked
    }
}

export async function deleteSession(token: string): Promise<boolean> {
    sessionCache.delete(token)
    const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('token', token)

    return !error
}

export async function deleteExpiredSessions(): Promise<void> {
    await supabase
        .from('sessions')
        .delete()
        .lt('expires_at', new Date().toISOString())
}

// User authentication — username is globally unique
export async function authenticateUser(username: string, password: string): Promise<User | null> {
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .single()

    if (error || !user) {
        return null
    }

    const isValid = await verifyPassword(password, user.password_hash)

    if (!isValid) {
        return null
    }

    return user as User
}

// Get user by ID
export async function getUserById(id: string): Promise<User | null> {
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .single()

    if (error || !user) {
        return null
    }

    return user as User
}
