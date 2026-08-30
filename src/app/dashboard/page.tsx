'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import AuthRetryScreen from '@/components/AuthRetryScreen'

export default function DashboardPage() {
    const router = useRouter()
    const { user, loading, authError, refreshUser } = useAuth()

    useEffect(() => {
        if (loading) return

        if (!user) {
            // Only redirect on a definitive session expiry — /api/auth/me
            // already cleared the cookie, so this lands on /login instead of
            // bouncing back to /dashboard. Network errors are handled in
            // render (retry screen) to avoid a redirect loop.
            if (authError === 'session') {
                router.replace('/login?expired=true')
            }
            return
        }

        // Enforce password change if required
        if (user.must_change_password) {
            router.replace('/dashboard/change-password')
            return
        }

        // Redirect based on role
        switch (user.role) {
            case 'SUPER_ADMIN':
                router.replace('/dashboard/super-admin')
                break
            case 'ADMIN':
                router.replace('/dashboard/admin')
                break
            case 'GURU':
                router.replace('/dashboard/guru')
                break
            case 'SISWA':
                router.replace('/dashboard/siswa')
                break
            case 'WALI':
                router.replace('/dashboard/wali')
                break
            default:
                router.replace('/login')
        }
    }, [user, loading, authError, router])

    // Network/server error — show retry screen instead of redirecting (which
    // would bounce-loop because the cookie is still alive).
    if (!loading && !user && authError === 'network') {
        return <AuthRetryScreen onRetry={refreshUser} />
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#D4E0D2]">
            <div className="flex items-center gap-3 text-primary">
                <svg className="animate-spin w-6 h-6" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="font-medium text-text-main">Mengalihkan...</span>
            </div>
        </div>
    )
}
