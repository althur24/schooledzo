'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { AuthUser } from '@/lib/types'

export type AuthError = 'session' | 'network' | null

interface AuthContextType {
    user: AuthUser | null
    loading: boolean
    authError: AuthError
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>
    logout: () => Promise<void>
    refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Last-known user profile, persisted for OFFLINE use. When /api/auth/me is
// unreachable (offline / 5xx) we restore this so offline-capable pages keep
// rendering: materi reads from IndexedDB, exam pages resume drafts from
// localStorage, the shell shows the cached name. The cookie (httpOnly, not
// here) is the real auth token; this is just a cached profile. When the
// connection returns, refreshUser() re-validates against the server and
// corrects any stale state (incl. forcing re-login on a real 401).
const LAST_USER_KEY = 'lms_auth_user'

function saveLastUser(u: AuthUser) {
    try { localStorage.setItem(LAST_USER_KEY, JSON.stringify(u)) } catch { /* private browsing */ }
}
function loadLastUser(): AuthUser | null {
    try {
        const s = localStorage.getItem(LAST_USER_KEY)
        return s ? JSON.parse(s) as AuthUser : null
    } catch { return null }
}
function clearLastUser() {
    try { localStorage.removeItem(LAST_USER_KEY) } catch { /* private browsing */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null)
    const [loading, setLoading] = useState(true)
    const [authError, setAuthError] = useState<AuthError>(null)

    const refreshUser = async () => {
        try {
            const res = await fetch('/api/auth/me')
            if (res.ok) {
                const data = await res.json()
                setUser(data.user)
                setAuthError(null)
                saveLastUser(data.user)
            } else if (res.status === 401) {
                // Definitive session expiry. /api/auth/me cleared the cookie,
                // so redirecting to /login is safe (no middleware bounce).
                setUser(null)
                setAuthError('session')
                clearLastUser()
            } else {
                // 5xx — transient server error. Session may still be valid.
                // Restore last-known user so offline-capable pages render; if
                // we have none (first-ever load), surface a retry screen.
                const last = loadLastUser()
                if (last) { setUser(last); setAuthError(null) }
                else { setUser(null); setAuthError('network') }
            }
        } catch {
            // fetch threw (offline / DNS / aborted) — no response, so the
            // cookie was NOT cleared. Redirecting to /login would bounce-loop,
            // so restore the last-known user and let the app render offline.
            const last = loadLastUser()
            if (last) { setUser(last); setAuthError(null) }
            else { setUser(null); setAuthError('network') }
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        refreshUser()
        // Re-validate the moment the connection comes back, so a session that
        // actually expired while offline is corrected (-> re-login) and stale
        // profile data is refreshed. Silent: does not flip `loading`, so there
        // is no disruptive full-screen flash.
        const goOnline = () => { refreshUser() }
        if (typeof window !== 'undefined') {
            window.addEventListener('online', goOnline)
            return () => window.removeEventListener('online', goOnline)
        }
    }, [])

    const login = async (username: string, password: string) => {
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            })

            const data = await res.json()

            if (res.ok) {
                setUser(data.user)
                setAuthError(null)
                saveLastUser(data.user)
                return { success: true }
            } else {
                return { success: false, error: data.error }
            }
        } catch {
            return { success: false, error: 'Terjadi kesalahan' }
        }
    }

    const logout = async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' })
        } catch (error) {
            console.error('Logout error:', error)
        } finally {
            setUser(null)
            setAuthError(null)
            clearLastUser()
        }
    }

    return (
        <AuthContext.Provider value={{ user, loading, authError, login, logout, refreshUser }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
