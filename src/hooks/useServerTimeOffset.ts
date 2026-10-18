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
 * Penggunaan:
 *   const { offsetRef, now: serverNow, minutes, dismissed, sync, dismiss } = useServerTimeOffset()
 *   // Di fetchData: sync(examsRes)
 *   // Di timer: setCurrentTime(new Date(serverNow()))
 *   // Di render: <ServerTimeWarning minutes={minutes} dismissed={dismissed} onDismiss={dismiss} />
 */
export function useServerTimeOffset() {
    const offsetRef = useRef(0)
    const [minutes, setMinutes] = useState<number | null>(null)
    const [dismissed, setDismissed] = useState(false)

    const sync = useCallback((res: Response) => {
        const hdr = res.headers.get('x-server-time')
        if (!hdr) return
        const offset = new Date(hdr).getTime() - Date.now()
        if (!Number.isFinite(offset)) return
        offsetRef.current = offset
        setMinutes(Math.round(offset / 60000))
        setDismissed(false)
    }, [])

    const dismiss = useCallback(() => setDismissed(true), [])

    /** Returns server-corrected Date.now() — gunakan di semua tempat yang sebelumnya pakai Date.now() */
    const now = useCallback(() => Date.now() + offsetRef.current, [])

    return { offsetRef, now, minutes, dismissed, sync, dismiss }
}
