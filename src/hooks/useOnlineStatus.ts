'use client'

import { useEffect, useState } from 'react'

/**
 * Melacak status online/offline browser (navigator.onLine + event listener).
 * Menggantikan blok `isOffline` yang ter-duplikasi di banyak halaman siswa/guru.
 *
 * Asumsi awal: online (true). Nilai sebenarnya disegarkan langsung di efek mount
 * (client-side) supaya aman saat SSR.
 *
 * Return: `isOnline` (boolean).
 */
export function useOnlineStatus(): boolean {
    const [isOnline, setIsOnline] = useState<boolean>(true)

    useEffect(() => {
        setIsOnline(navigator.onLine)
        const goOnline = () => setIsOnline(true)
        const goOffline = () => setIsOnline(false)
        window.addEventListener('online', goOnline)
        window.addEventListener('offline', goOffline)
        return () => {
            window.removeEventListener('online', goOnline)
            window.removeEventListener('offline', goOffline)
        }
    }, [])

    return isOnline
}

export default useOnlineStatus
