'use client'

import { ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'
import NotificationBell from '@/components/NotificationBell'
import HeaderNetworkIndicator from '@/components/HeaderNetworkIndicator'
import BottomNavigation from '@/components/BottomNavigation'
import TutorialFAB from '@/components/TutorialFAB'
import { Logout } from 'react-iconly'
import { Menu } from 'lucide-react'

import Sidebar from '@/components/Sidebar'
import AuthRetryScreen from '@/components/AuthRetryScreen'
import { LabelsProvider } from '@/contexts/LabelsContext'

const SIDEBAR_COLLAPSED_KEY = 'sidebar_collapsed'

// Store eksternal untuk state sidebar yang di-persist ke localStorage.
// Dipakai lewat useSyncExternalStore: server snapshot selalu false (bebas
// hydration mismatch), nilai localStorage terbaca setelah hydration.
const sidebarCollapsedStore = {
    listeners: new Set<() => void>(),
    get(): boolean {
        try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true' } catch { return false }
    },
    set(next: boolean) {
        try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)) } catch { /* private browsing */ }
        for (const listener of sidebarCollapsedStore.listeners) listener()
    },
    subscribe(listener: () => void) {
        sidebarCollapsedStore.listeners.add(listener)
        return () => { sidebarCollapsedStore.listeners.delete(listener) }
    },
}

// Nama sekolah menyusut sampai muat (auto-fit via pengukuran scrollWidth),
// floor 11px — di bawah itu fallback ellipsis (overflow-hidden).
function AutoFitSchoolName({ name }: { name: string }) {
    const ref = useRef<HTMLSpanElement>(null)

    useEffect(() => {
        const el = ref.current
        if (!el) return

        const MAX = 20
        const MIN = 11

        const fit = () => {
            let size = MAX
            el.style.fontSize = `${MAX}px`
            while (size > MIN && el.scrollWidth > el.clientWidth) {
                size -= 0.5
                el.style.fontSize = `${size}px`
            }
        }

        fit()
        const parent = el.parentElement
        if (!parent || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(fit)
        observer.observe(parent)
        return () => observer.disconnect()
    }, [name])

    return (
        <span ref={ref} className="text-xl font-bold text-white leading-none whitespace-nowrap overflow-hidden">
            {name}
        </span>
    )
}

interface DashboardLayoutProps {
    children: ReactNode
}

// LabelsProvider di luar semua branch render (termasuk exam mode &
// change-password) supaya semua halaman dashboard bisa memakai
// useSchoolLabels().
export default function DashboardLayout({ children }: DashboardLayoutProps) {
    return (
        <LabelsProvider>
            <DashboardLayoutInner>{children}</DashboardLayoutInner>
        </LabelsProvider>
    )
}

function DashboardLayoutInner({ children }: DashboardLayoutProps) {
    const router = useRouter()
    const pathname = usePathname()
    const { user, logout, loading, authError, refreshUser } = useAuth()
    const isIntentionalLogout = useRef(false)

    // Sidebar: desktop collapse (persisted) + mobile drawer
    const sidebarCollapsed = useSyncExternalStore(
        sidebarCollapsedStore.subscribe,
        sidebarCollapsedStore.get,
        () => false,
    )
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

    const toggleSidebarCollapsed = () => {
        sidebarCollapsedStore.set(!sidebarCollapsed)
    }

    // Tutup drawer mobile saat navigasi (termasuk browser back) —
    // penyesuaian state saat render, bukan setState dalam effect.
    const [prevPathname, setPrevPathname] = useState(pathname)
    if (prevPathname !== pathname) {
        setPrevPathname(pathname)
        setMobileMenuOpen(false)
    }

    const handleLogout = async () => {
        isIntentionalLogout.current = true
        await logout()
        router.push('/login')
    }

    // Redirect to login only on a definitive session-expiry (401 from
    // /api/auth/me, which also cleared the cookie). On network errors,
    // AuthContext restores the last-known user so the app keeps rendering
    // (offline-capable pages like materi still work); redirecting with a
    // still-alive cookie would bounce-loop via middleware.
    useEffect(() => {
        if (!loading && !user && !isIntentionalLogout.current && authError === 'session') {
            router.replace('/login?expired=true')
        }
    }, [user, loading, authError, router])

    // Enforce password change
    useEffect(() => {
        if (!loading && user?.must_change_password && pathname !== '/dashboard/change-password') {
            router.replace('/dashboard/change-password')
        }
    }, [user, loading, pathname, router])

    // Role-based route guard: prevent cross-role access
    useEffect(() => {
        if (!loading && user) {
            const role = user.role
            const roleRouteMap: Record<string, string> = {
                'SISWA': '/dashboard/siswa',
                'GURU': '/dashboard/guru',
                'ADMIN': '/dashboard/admin',
                'SUPER_ADMIN': '/dashboard/super-admin',
                'WALI': '/dashboard/wali',
            }

            // Check if user is accessing a role-specific route that doesn't match their role
            for (const [routeRole, routePrefix] of Object.entries(roleRouteMap)) {
                if (pathname.startsWith(routePrefix) && role !== routeRole) {
                    // Exception: ADMIN can access guru pages for oversight
                    if (role === 'ADMIN' && routeRole === 'GURU') continue
                    // Exception: SUPER_ADMIN can access all pages
                    if (role === 'SUPER_ADMIN') continue

                    router.replace(roleRouteMap[role] || '/dashboard')
                    return
                }
            }
        }
    }, [user, loading, pathname, router])

    // Only show loading screen on initial mount, not after login redirect
    if (loading && !user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#D4E0D2]">
                <div className="flex flex-col items-center gap-4 text-primary">
                    <svg className="animate-spin w-10 h-10" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span className="font-medium text-text-main">Memuat...</span>
                </div>
            </div>
        )
    }

    // Session ended or unreachable — intercept before the shell so child pages
    // never render with a null user (avoids dead-ends / crashes). On a network
    // error show a retry screen; on session-expiry show a spinner while the
    // redirect effect above sends the user to /login.
    if (!loading && !user) {
        if (authError === 'network') {
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

    // Blocking render guard: prevent page flash while redirect is in progress
    if (user) {
        const role = user.role
        const roleRoutePrefixes: Record<string, string> = {
            'SISWA': '/dashboard/siswa',
            'GURU': '/dashboard/guru',
            'ADMIN': '/dashboard/admin',
            'SUPER_ADMIN': '/dashboard/super-admin',
            'WALI': '/dashboard/wali',
        }
        for (const [routeRole, routePrefix] of Object.entries(roleRoutePrefixes)) {
            if (pathname.startsWith(routePrefix) && role !== routeRole) {
                // Exception: ADMIN can access guru pages
                if (role === 'ADMIN' && routeRole === 'GURU') continue
                // Exception: SUPER_ADMIN can access all pages
                if (role === 'SUPER_ADMIN') continue

                // Block render — show loading while useEffect redirect fires
                return (
                    <div className="min-h-screen flex items-center justify-center bg-[#D4E0D2]">
                        <div className="flex flex-col items-center gap-4 text-primary">
                            <svg className="animate-spin w-10 h-10" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span className="font-medium text-text-main">Mengalihkan...</span>
                        </div>
                    </div>
                )
            }
        }
    }

    const getRoleLabel = (role: string) => {
        switch (role) {
            case 'SUPER_ADMIN': return 'Super Admin'
            case 'ADMIN': return 'Administrator'
            case 'GURU': return 'Guru'
            case 'SISWA': return 'Siswa'
            case 'WALI': return 'Orang Tua'
            default: return role
        }
    }

    // Detect if student is actively taking an exam or quiz (hide all navigation)
    const isExamMode = (() => {
        // Match /dashboard/siswa/ulangan/[id] or /dashboard/siswa/kuis/[id] or /dashboard/siswa/uts-uas/[id]
        // But NOT /hasil pages
        const examPattern = /^\/dashboard\/siswa\/(ulangan|kuis|uts-uas)\/[^/]+$/
        return examPattern.test(pathname)
    })()

    if (isExamMode) {
        return (
            <div className="min-h-screen bg-background-light dark:bg-background-dark transition-colors duration-300">
                <main className="w-full overflow-y-auto animate-in fade-in duration-500">
                    {children}
                </main>
            </div>
        )
    }

    // Hide sidebar and bottom nav on the change password page
    const isChangePasswordMode = pathname === '/dashboard/change-password'

    if (isChangePasswordMode) {
        return (
            <div className="min-h-screen bg-background-light dark:bg-background-dark transition-colors duration-300">
                <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 overflow-y-auto animate-in fade-in duration-500">
                    {children}
                </main>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-background-light dark:bg-background-dark transition-colors duration-300">
            {/* Header */}
            <header className="sticky top-0 z-50 bg-slate-900 text-white shadow-md border-b border-slate-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-20">
                        {/* Hamburger (mobile) + Logo */}
                        <div className="flex items-center gap-2 min-w-0">
                            <button
                                onClick={() => setMobileMenuOpen(true)}
                                className="lg:hidden shrink-0 p-2.5 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                                aria-label="Buka menu"
                            >
                                <Menu className="w-6 h-6" />
                            </button>
                            <Link href="/dashboard" className="flex items-center gap-2 sm:gap-3 group min-w-0">
                                <img src="/logoedzo.png" alt="HIPPOCAMPUS Logo" className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl shadow-lg shadow-emerald-500/20 group-hover:scale-110 transition-transform object-cover" />
                                <div className="flex flex-col min-w-0">
                                    <AutoFitSchoolName name={user?.school_name || 'HIPPOCAMPUS'} />
                                    <span className="hidden sm:block text-xs text-slate-400 font-medium tracking-wide truncate">Learning Management System</span>
                                </div>
                            </Link>
                        </div>

                        {/* User info */}
                        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                            <HeaderNetworkIndicator />
                            <NotificationBell />
                            <div className="hidden sm:flex flex-col items-end">
                                <span className="text-[10px] text-slate-400 font-medium tracking-wide">Login sebagai</span>
                                <p className="text-sm font-bold text-white">{user?.full_name || user?.username}</p>
                                <p className="text-xs text-emerald-400 font-semibold bg-slate-800 px-2 py-0.5 rounded-full mt-0.5 border border-slate-700">
                                    {getRoleLabel(user?.role || '')}
                                </p>
                            </div>
                            <div className="relative group cursor-pointer">
                                <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-white font-bold text-base sm:text-lg shadow-lg group-hover:scale-105 transition-all">
                                    {user?.full_name?.[0] || user?.username?.[0] || '?'}
                                </div>
                                <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full"></div>
                            </div>
                            <button
                                onClick={handleLogout}
                                className="flex items-center gap-1.5 p-2.5 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Logout"
                                aria-label="Logout"
                            >
                                <Logout set="bold" primaryColor="currentColor" size="medium" />
                                <span className="hidden sm:inline text-sm font-semibold">Logout</span>
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <div className="flex h-[calc(100vh-5rem)]">
                {/* Sidebar: desktop (collapsible) + mobile (drawer) */}
                <Sidebar
                    collapsed={sidebarCollapsed}
                    onToggleCollapse={toggleSidebarCollapsed}
                    mobileOpen={mobileMenuOpen}
                    onCloseMobile={() => setMobileMenuOpen(false)}
                />

                {/* Main content - bottom padding on mobile for bottom nav, left padding follows desktop sidebar width */}
                <main className={`flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 lg:pb-8 overflow-y-auto animate-in fade-in duration-500 transition-[padding] duration-300 ease-in-out ${sidebarCollapsed ? 'lg:pl-28' : 'lg:pl-[17rem]'}`}>
                    {children}
                </main>
            </div>

            {/* Bottom Navigation - only visible on mobile/tablet */}
            <BottomNavigation />
            <TutorialFAB />
        </div>
    )
}

