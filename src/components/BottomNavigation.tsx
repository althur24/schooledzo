'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import {
    Home, Document as DocumentIcon, Edit, Game, Graph, TimeCircle, User, Work,
    Category, Bookmark, Chart, Ticket, Notification, Calendar, Folder
} from 'react-iconly'

interface NavItem {
    icon: React.ElementType
    label: string
    path: string
}

// --- SISWA ---
const siswaBarLeft: NavItem[] = [
    { icon: Home, label: 'Home', path: '/dashboard/siswa' },
    { icon: Edit, label: 'Tugas', path: '/dashboard/siswa/tugas' },
]
const siswaBarRight: NavItem[] = [
    { icon: Game, label: 'Kuis', path: '/dashboard/siswa/kuis' },
    { icon: TimeCircle, label: 'Ulangan', path: '/dashboard/siswa/ulangan' },
]
const siswaArc: NavItem[] = [
    { icon: DocumentIcon, label: 'Materi', path: '/dashboard/siswa/materi' },
    { icon: Graph, label: 'Nilai', path: '/dashboard/siswa/nilai' },
]

// --- GURU ---
const guruBarLeft: NavItem[] = [
    { icon: Home, label: 'Home', path: '/dashboard/guru' },
    { icon: Edit, label: 'Tugas', path: '/dashboard/guru/tugas' },
]
const guruBarRight: NavItem[] = [
    { icon: Game, label: 'Kuis', path: '/dashboard/guru/kuis' },
    { icon: TimeCircle, label: 'Ulangan', path: '/dashboard/guru/ulangan' },
]
const guruArc: NavItem[] = [
    { icon: DocumentIcon, label: 'Materi', path: '/dashboard/guru/materi' },
    { icon: Folder, label: 'Bank Soal', path: '/dashboard/guru/bank-soal' },
    { icon: Graph, label: 'Nilai', path: '/dashboard/guru/nilai' },
    { icon: User, label: 'Wali', path: '/dashboard/guru/wali-kelas' },
]

// --- ADMIN ---
const adminBarLeft: NavItem[] = [
    { icon: Home, label: 'Home', path: '/dashboard/admin' },
    { icon: User, label: 'Siswa', path: '/dashboard/admin/siswa' },
]
const adminBarRight: NavItem[] = [
    { icon: Work, label: 'Guru', path: '/dashboard/admin/guru' },
    { icon: Category, label: 'Kelas', path: '/dashboard/admin/kelas' },
]
const adminArc: NavItem[] = [
    { icon: Graph, label: 'Kenaikan', path: '/dashboard/admin/kenaikan-kelas' },
    { icon: Bookmark, label: 'Mapel', path: '/dashboard/admin/mapel' },
    { icon: Calendar, label: 'Tahun', path: '/dashboard/admin/tahun-ajaran' },
    { icon: Chart, label: 'Analitik', path: '/dashboard/admin/analitik' },
    { icon: Ticket, label: 'Penugasan', path: '/dashboard/admin/penugasan' },
    { icon: Notification, label: 'Info', path: '/dashboard/admin/pengumuman' },
    { icon: Calendar, label: 'Jadwal', path: '/dashboard/admin/jadwal' },
]

// --- WALI ---
const waliBarLeft: NavItem[] = [
    { icon: Home, label: 'Home', path: '/dashboard/wali' },
]
const waliBarRight: NavItem[] = []
const waliArc: NavItem[] = []

// --- SUPER ADMIN ---
const superAdminBarLeft: NavItem[] = [
    { icon: Home, label: 'Home', path: '/dashboard/super-admin' },
]
const superAdminBarRight: NavItem[] = [
    { icon: Category, label: 'Sekolah', path: '/dashboard/super-admin/sekolah' },
]
const superAdminArc: NavItem[] = []

export default function BottomNavigation() {
    const pathname = usePathname()
    const { user } = useAuth()
    const [isOpen, setIsOpen] = useState(false)

    useEffect(() => {
        setIsOpen(false)
    }, [pathname])

    if (!user) return null

    let barLeft: NavItem[], barRight: NavItem[], arcItems: NavItem[]
    switch (user.role) {
        case 'SUPER_ADMIN':
            barLeft = superAdminBarLeft; barRight = superAdminBarRight; arcItems = superAdminArc; break
        case 'SISWA':
            barLeft = siswaBarLeft; barRight = siswaBarRight; arcItems = siswaArc; break
        case 'GURU':
            barLeft = guruBarLeft; barRight = guruBarRight; arcItems = guruArc; break
        case 'ADMIN':
            barLeft = adminBarLeft; barRight = adminBarRight; arcItems = adminArc; break
        case 'WALI':
            barLeft = waliBarLeft; barRight = waliBarRight; arcItems = waliArc; break
        default:
            barLeft = []; barRight = []; arcItems = []
    }

    const isActive = (path: string) => {
        if (path === `/dashboard/${user.role.toLowerCase()}`) {
            return pathname === path
        }
        return pathname.startsWith(path)
    }


    // Arc positions
    const getItemStyle = (index: number, total: number) => {
        const startAngle = 150
        const endAngle = 30
        const angleStep = (startAngle - endAngle) / Math.max(total - 1, 1)
        const angleDeg = startAngle - index * angleStep
        const angleRad = (angleDeg * Math.PI) / 180
        const radius = total <= 3 ? 110 : total <= 5 ? 130 : 155
        const delay = index * 50
        return {
            x: radius * Math.cos(angleRad),
            y: -radius * Math.sin(angleRad),
            delay,
        }
    }

    const renderBarItem = (item: NavItem) => {
        const active = isActive(item.path)
        const IconComponent = item.icon
        return (
            <Link
                key={item.path}
                href={item.path}
                className="relative flex flex-col items-center justify-center w-14"
                onClick={() => setIsOpen(false)}
            >
                <div className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-300 ${active
                    ? 'bg-gradient-to-br from-primary to-emerald-500 text-white shadow-lg shadow-primary/30 scale-105 -translate-y-0.5'
                    : isOpen
                        ? 'text-white/60 dark:text-slate-500'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}>
                    <IconComponent
                        set={active ? 'bold' : 'light'}
                        primaryColor={active ? 'white' : 'currentColor'}
                        size="small"
                    />
                </div>
                <span className={`text-[10px] mt-0.5 font-bold transition-colors ${active
                    ? 'text-primary'
                    : isOpen
                        ? 'text-white/50 dark:text-slate-600'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}>
                    {item.label}
                </span>
            </Link>
        )
    }

    return (
        <>
            {/* Backdrop overlay — separate from nav for clean layering */}
            {isOpen && (
                <div
                    className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setIsOpen(false)}
                />
            )}

            {/* Arc items — rendered as a fixed layer above backdrop, below bar */}
            <div className="lg:hidden fixed bottom-0 left-0 right-0 z-[52] flex justify-center pb-5" style={{ pointerEvents: 'none' }}>
                <div className="relative" style={{ width: 0, height: 0, marginBottom: '56px' }}>
                    {arcItems.map((item, index) => {
                        const { x, y, delay } = getItemStyle(index, arcItems.length)
                        const active = isActive(item.path)
                        const IconComponent = item.icon

                        return (
                            <div
                                key={item.path}
                                className="absolute flex flex-col items-center"
                                style={{
                                    left: '-23px',
                                    top: '-23px',
                                    width: '46px',
                                    pointerEvents: isOpen ? 'auto' : 'none',
                                    transform: isOpen
                                        ? `translate(${x}px, ${y}px) scale(1)`
                                        : `translate(0px, 0px) scale(0)`,
                                    opacity: isOpen ? 1 : 0,
                                    transition: isOpen
                                        ? `transform 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${delay}ms, opacity 0.3s ease ${delay}ms`
                                        : `transform 0.3s cubic-bezier(0.6, -0.28, 0.735, 0.045) ${(arcItems.length - index) * 30}ms, opacity 0.2s ease ${(arcItems.length - index) * 30}ms`,
                                }}
                            >
                                <Link
                                    href={item.path}
                                    onClick={() => setIsOpen(false)}
                                    className="flex flex-col items-center"
                                >
                                    <div className={`w-[46px] h-[46px] rounded-full flex items-center justify-center transition-all duration-200 ${active
                                        ? 'bg-gradient-to-br from-primary to-emerald-500 text-white shadow-xl shadow-primary/40 ring-2 ring-white/30'
                                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 shadow-xl shadow-black/20 dark:shadow-black/50 active:scale-90'
                                        }`}>
                                        <IconComponent
                                            set="bold"
                                            primaryColor={active ? 'white' : 'currentColor'}
                                            size="small"
                                        />
                                    </div>
                                    <span className={`text-[10px] mt-1 font-bold whitespace-nowrap ${active
                                        ? 'text-primary'
                                        : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]'
                                        }`}>
                                        {item.label}
                                    </span>
                                </Link>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Bottom Bar — highest z-index, always clickable */}
            <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-[51] flex justify-center pb-5 px-4" style={{ pointerEvents: 'none' }}>
                <div className={`flex items-center h-16 rounded-[28px] transition-all duration-500 ${isOpen
                    ? 'bg-slate-900/90 dark:bg-white/90 backdrop-blur-xl shadow-2xl shadow-black/30'
                    : 'bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl shadow-2xl shadow-black/10 dark:shadow-black/30 border border-black/5 dark:border-white/10'
                    }`} style={{ pointerEvents: 'auto' }}>

                    {/* Left items */}
                    <div className="flex items-center gap-1 pl-3 pr-2">
                        {barLeft.map(item => renderBarItem(item))}
                    </div>

                    {/* Center Trigger Button */}
                    <div className="relative -mt-5 mx-1">
                        <button
                            onClick={() => setIsOpen(!isOpen)}
                            type="button"
                            className={`relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-500 cursor-pointer ${isOpen
                                ? 'bg-red-500 shadow-xl shadow-red-500/30 rotate-[135deg] scale-105'
                                : 'bg-gradient-to-br from-primary to-emerald-500 shadow-lg shadow-primary/40 hover:shadow-xl hover:scale-105 active:scale-95'
                                }`}
                            aria-label={isOpen ? 'Close menu' : 'Open menu'}
                        >
                            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-white">
                                <line x1="11" y1="4" x2="11" y2="18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                                <line x1="4" y1="11" x2="18" y2="11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                            </svg>
                        </button>
                        {!isOpen && (
                            <div className="absolute inset-[-4px] rounded-full border-2 border-primary/20 animate-ping pointer-events-none" style={{ animationDuration: '2.5s' }} />
                        )}
                    </div>

                    {/* Right items */}
                    <div className="flex items-center gap-1 pl-2 pr-3">
                        {barRight.map(item => renderBarItem(item))}
                    </div>
                </div>
            </nav>
        </>
    )
}
