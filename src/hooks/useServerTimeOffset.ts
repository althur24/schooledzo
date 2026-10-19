'use client'

import { useRef, useState, useCallback } from 'react'

/**
 * Hook untuk koreksi jam HP vs waktu server.
 *
 * Panggil sync(res) dengan Response dari API manapun yang mengirim
 * header x-server-time. Offset disimpan di ref (untuk timer/interval)
 * dan state (untuk banner warning).
 *
 * Fallback: jika header tidak ada (offline, error, CDN strip) →
 * offset = 0 → jam HP (behavior lama).
 *
 * Persistensi dismissal: bila user menutup banner, offset (dalam menit)
 * disimpan di localStorage. Pada mount berikutnya, dismissal dipulihkan
 * via lazy state initializer (anti setState-in-effect). Banner hanya muncul
 * ulang bila offset berubah signifikan (≥1 menit) dari nilai yang di-dismiss.
 *
 * Penggunaan:
 *   const { offsetRef, now: serverNow, minutes, dismissed, sync, dismiss } = useServerTimeOffset()
 *   // Di fetchData: sync(examsRes)
 *   // Di timer: setCurrentTime(new Date(serverNow()))
 *   // Di render: <ServerTimeWarning minutes={minutes} dismissed={dismissed} onDismiss={dismiss} />
 */
const DISMISS_KEY = 'server-time-dismissed-offset'
const SIGNIFICANT_SHIFT_MIN = 1 // re-show banner jika offset shift ≥1 menit dari dismissed value

export function useServerTimeOffset() {
    const offsetRef = useRef(0)
    const [minutes, setMinutes] = useState<number | null>(null)
    // Lazy initializer — restore dismissal dari localStorage pada first render
    // (client-only via typeof window check, SSR-safe). Anti setState-in-effect.
    const [dismissed, setDismissed] = useState(() => {
        if (typeof window === 'undefined') return false
        try {
            return localStorage.getItem(DISMISS_KEY) !== null
        } catch {
            return false
        }
    })

    const sync = useCallback((res: Response) => {
        const hdr = res.headers.get('x-server-time')
        if (!hdr) return
        const offset = new Date(hdr).getTime() - Date.now()
        if (!Number.isFinite(offset)) return
        offsetRef.current = offset
        const newMinutes = Math.round(offset / 60000)
        setMinutes(newMinutes)
        // Hanya re-show banner bila offset berubah signifikan dari nilai yang
        // di-dismiss. Bila shift < SIGNIFICANT_SHIFT_MIN, pertahankan dismissed.
        try {
            const dismissedOffset = localStorage.getItem(DISMISS_KEY)
            if (dismissedOffset !== null) {
                const dismissedMin = parseInt(dismissedOffset, 10)
                if (Number.isFinite(dismissedMin) && Math.abs(newMinutes - dismissedMin) < SIGNIFICANT_SHIFT_MIN) {
                    setDismissed(true)
                    return
                }
            }
        } catch { /* non-fatal */ }
        setDismissed(false)
    }, [])

    const dismiss = useCallback(() => {
        setDismissed(true)
        // Persist offset bucket saat ini — dismissal dipulihkan pada mount berikutnya
        // bila offset belum berubah signifikan.
        try {
            if (minutes !== null) {
                localStorage.setItem(DISMISS_KEY, String(minutes))
            }
        } catch { /* SSR atau privacy mode — non-fatal */ }
    }, [minutes])

    /** Returns server-corrected Date.now() — gunakan di semua tempat yang sebelumnya pakai Date.now() */
    const now = useCallback(() => Date.now() + offsetRef.current, [])

    return { offsetRef, now, minutes, dismissed, sync, dismiss }
}
