import bcrypt from 'bcryptjs'
import { supabaseAdmin as supabase } from './supabase'
import { User, Session, AuthUser } from './types'

const SALT_ROUNDS = 10
const SESSION_EXPIRY_HOURS = 24 // I1: Reduced from 7 days to 24 hours
const SESSION_REFRESH_THRESHOLD_HOURS = 12 // Refresh when less than 12h remaining

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

export async function validateSession(token: string): Promise<AuthUser | null> {
    const { data: session, error } = await supabase
        .from('sessions')
        .select(`
      *,
      user:users(id, username, full_name, role, school_id, school:schools(id, name))
    `)
        .eq('token', token)
        .gt('expires_at', new Date().toISOString())
        .single()

    if (error || !session || !session.user) {
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
        school_name: session.user.school?.name || null
    }
}

export async function deleteSession(token: string): Promise<boolean> {
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
