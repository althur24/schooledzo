'use client'

import { ReactNode, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'
import NotificationBell from '@/components/NotificationBell'
import BottomNavigation from '@/components/BottomNavigation'
import { Logout } from 'react-iconly'

import Sidebar from '@/components/Sidebar'

interface DashboardLayoutProps {
    children: ReactNode
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
    const router = useRouter()
    const pathname = usePathname()
    const { user, logout, loading } = useAuth()

    const handleLogout = async () => {
        await logout()
        router.push('/login')
    }

    // Redirect to login if session expired (user is null after loading completes)
    useEffect(() => {
        if (!loading && !user) {
            router.replace('/login?expired=true')
        }
    }, [user, loading, router])

    // Enforce password change
    useEffect(() => {
        if (!loading && user?.must_change_password && pathname !== '/dashboard/change-password') {
            router.replace('/dashboard/change-password')
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
        // Match /dashboard/siswa/ulangan/[id] or /dashboard/siswa/kuis/[id]
        // But NOT /hasil pages
        const examPattern = /^\/dashboard\/siswa\/(ulangan|kuis)\/[^/]+$/
        return examPattern.test(pathname)
    })()

    if (isExamMode) {
        return (
            <div className="min-h-screen bg-background-light dark:bg-background-dark transition-colors duration-300">
                <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 overflow-y-auto animate-in fade-in duration-500" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    <style>{`main::-webkit-scrollbar { display: none; }`}</style>
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
                        {/* Logo */}
                        <Link href="/dashboard" className="flex items-center gap-3 group">
                            <img src="/logoedzo.png" alt="EDZO Logo" className="w-10 h-10 rounded-xl shadow-lg shadow-emerald-500/20 group-hover:scale-110 transition-transform object-cover" />
                            <div className="flex flex-col">
                                <span className="text-xl font-bold text-white leading-none">{user?.school_name || 'LMS Sekolah'}</span>
                                <span className="text-xs text-slate-400 font-medium tracking-wide">Learning Management System</span>
                            </div>
                        </Link>

                        {/* User info */}
                        <div className="flex items-center gap-4">
                            <NotificationBell />
                            <div className="hidden sm:flex flex-col items-end">
                                <p className="text-sm font-bold text-white">{user?.full_name || user?.username}</p>
                                <p className="text-xs text-emerald-400 font-semibold bg-slate-800 px-2 py-0.5 rounded-full mt-0.5 border border-slate-700">
                                    {getRoleLabel(user?.role || '')}
                                </p>
                            </div>
                            <div className="relative group cursor-pointer">
                                <div className="w-11 h-11 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-white font-bold text-lg shadow-lg group-hover:scale-105 transition-all">
                                    {user?.full_name?.[0] || user?.username?.[0] || '?'}
                                </div>
                                <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full"></div>
                            </div>
                            <button
                                onClick={handleLogout}
                                className="p-2.5 rounded-full text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Logout"
                                aria-label="Logout"
                            >
                                <Logout set="bold" primaryColor="currentColor" size="medium" />
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <div className="flex h-[calc(100vh-5rem)]">
                {/* Desktop Sidebar (Left spacing provided by internal fixed class) */}
                <Sidebar />

                {/* Main content - add bottom padding on mobile for bottom nav, left padding for desktop sidebar */}
                <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 lg:pb-8 lg:pl-[17rem] overflow-y-auto animate-in fade-in duration-500" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    <style>{`main::-webkit-scrollbar { display: none; }`}</style>
                    {children}
                </main>
            </div>

            {/* Bottom Navigation - only visible on mobile/tablet */}
            <BottomNavigation />
        </div>
    )
}

