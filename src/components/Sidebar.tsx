'use client'

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

export const siswaNav: NavItem[] = [
    { icon: Home, label: 'Dashboard', path: '/dashboard/siswa' },
    { icon: DocumentIcon, label: 'Materi', path: '/dashboard/siswa/materi' },
    { icon: Edit, label: 'Tugas', path: '/dashboard/siswa/tugas' },
    { icon: TimeCircle, label: 'Ulangan', path: '/dashboard/siswa/ulangan' },
    { icon: Game, label: 'Kuis', path: '/dashboard/siswa/kuis' },
    { icon: Graph, label: 'Nilai', path: '/dashboard/siswa/nilai' },
]

export const guruNav: NavItem[] = [
    { icon: Home, label: 'Dashboard', path: '/dashboard/guru' },
    { icon: DocumentIcon, label: 'Materi', path: '/dashboard/guru/materi' },
    { icon: Edit, label: 'Tugas', path: '/dashboard/guru/tugas' },
    { icon: TimeCircle, label: 'Ulangan', path: '/dashboard/guru/ulangan' },
    { icon: Game, label: 'Kuis', path: '/dashboard/guru/kuis' },
    { icon: Folder, label: 'Bank Soal', path: '/dashboard/guru/bank-soal' },
    { icon: Graph, label: 'Nilai', path: '/dashboard/guru/nilai' },
    { icon: User, label: 'Wali Kelas', path: '/dashboard/guru/wali-kelas' },
]

export const adminNav: NavItem[] = [
    { icon: Home, label: 'Dashboard', path: '/dashboard/admin' },
    { icon: User, label: 'Siswa', path: '/dashboard/admin/siswa' },
    { icon: Work, label: 'Guru', path: '/dashboard/admin/guru' },
    { icon: Category, label: 'Kelas', path: '/dashboard/admin/kelas' },
    { icon: Graph, label: 'Kenaikan', path: '/dashboard/admin/kenaikan-kelas' },
    { icon: Folder, label: 'Alumni', path: '/dashboard/admin/alumni' },
    { icon: Bookmark, label: 'Mapel', path: '/dashboard/admin/mapel' },
    { icon: Calendar, label: 'Tahun', path: '/dashboard/admin/tahun-ajaran' },
    { icon: Chart, label: 'Analitik', path: '/dashboard/admin/analitik' },
    { icon: Ticket, label: 'Penugasan', path: '/dashboard/admin/penugasan' },
    { icon: Notification, label: 'Info', path: '/dashboard/admin/pengumuman' },
    { icon: Calendar, label: 'Jadwal', path: '/dashboard/admin/jadwal' },
]

export const waliNav: NavItem[] = [
    { icon: Home, label: 'Dashboard', path: '/dashboard/wali' },
]

export const superAdminNav: NavItem[] = [
    { icon: Home, label: 'Dashboard', path: '/dashboard/super-admin' },
    { icon: Category, label: 'Sekolah', path: '/dashboard/super-admin/sekolah' },
]

export default function Sidebar() {
    const pathname = usePathname()
    const { user } = useAuth()

    if (!user) return null

    const getNavItems = (): NavItem[] => {
        switch (user.role) {
            case 'SUPER_ADMIN': return superAdminNav
            case 'SISWA': return siswaNav
            case 'GURU': return guruNav
            case 'ADMIN': return adminNav
            case 'WALI': return waliNav
            default: return []
        }
    }

    const navItems = getNavItems()

    const isActive = (path: string) => {
        if (path === `/dashboard/${user.role.toLowerCase()}`) {
            return pathname === path
        }
        return pathname.startsWith(path)
    }

    return (
        <aside className="fixed left-0 top-20 bottom-0 w-64 bg-surface-light dark:bg-surface-dark border-r border-[#E8F0E6] dark:border-primary/20 hidden lg:flex flex-col z-40 overflow-y-auto">
            <div className="flex-1 py-6 px-4 space-y-2">
                <div className="px-3 pb-4 mb-2 border-b border-[#E8F0E6] dark:border-primary/10">
                    <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                        Menu Utama
                    </h3>
                </div>

                {navItems.map((item) => {
                    const active = isActive(item.path)
                    const IconComponent = item.icon

                    return (
                        <Link
                            key={item.path}
                            href={item.path}
                            className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group ${active
                                ? 'bg-primary/10 dark:bg-primary/20 text-primary dark:text-emerald-400 font-bold'
                                : 'text-text-secondary hover:bg-[#F2F7F1] dark:hover:bg-white/5 hover:text-text-main dark:hover:text-white font-medium'
                                }`}
                        >
                            <div className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${active
                                ? 'bg-primary text-white shadow-md shadow-primary/30'
                                : 'bg-[#E8F0E6] dark:bg-surface-ground text-text-secondary group-hover:bg-white dark:group-hover:bg-surface-light group-hover:shadow-sm'
                                }`}>
                                <IconComponent
                                    set={active ? 'bold' : 'light'}
                                    primaryColor={active ? 'white' : 'currentColor'}
                                    size="small"
                                />
                            </div>
                            <span className="text-sm">{item.label}</span>
                        </Link>
                    )
                })}
            </div>
        </aside>
    )
}
