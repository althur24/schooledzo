'use client'

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { MenuLabels, DEFAULT_MENU_LABELS, resolveMenuLabels } from '@/lib/labels'

/**
 * Label menu kustom sekolah aktif (lihat src/lib/labels.ts).
 * Di-fetch sekali per sesi saat dashboard dimuat; halaman Pengaturan admin
 * memanggil refresh() setelah menyimpan agar seluruh app langsung ikut
 * (Sidebar, BottomNavigation, header, tab nilai, dst).
 * Gagal fetch (offline/dll) → tetap pakai label terakhir / default.
 */

interface LabelsContextType {
    labels: MenuLabels
    refresh: () => Promise<void>
}

const LabelsContext = createContext<LabelsContextType | undefined>(undefined)

export function LabelsProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth()
    const [labels, setLabels] = useState<MenuLabels>(DEFAULT_MENU_LABELS)

    const refresh = useCallback(async () => {
        try {
            const res = await fetch('/api/school-settings')
            if (res.ok) {
                const data = await res.json()
                setLabels(resolveMenuLabels(data.menu_labels))
            }
        } catch {
            // Offline / error → pertahankan label terakhir (default saat pertama kali)
        }
    }, [])

    useEffect(() => {
        if (user) refresh()
    }, [user, refresh])

    return (
        <LabelsContext.Provider value={{ labels, refresh }}>
            {children}
        </LabelsContext.Provider>
    )
}

/** Label menu kustom sekolah aktif. Selalu terisi — fallback ke default. */
export function useSchoolLabels(): MenuLabels {
    const ctx = useContext(LabelsContext)
    if (!ctx) throw new Error('useSchoolLabels must be used within a LabelsProvider')
    return ctx.labels
}

/** Paksa re-fetch label (dipakai halaman Pengaturan setelah simpan). */
export function useSchoolLabelsRefresh(): () => Promise<void> {
    const ctx = useContext(LabelsContext)
    if (!ctx) throw new Error('useSchoolLabelsRefresh must be used within a LabelsProvider')
    return ctx.refresh
}
