'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Mesin pengukuran kualitas jaringan tunggal untuk LMS.
 *
 * Sumber data:
 * 1. Event online/offline browser (offline instan terdeteksi; event 'online'
 *    langsung memicu ping ulang supaya indikator pulih cepat, tidak menunggu
 *    timer backoff)
 * 2. Polling GET /api/ping (round-trip HTTP asli) — pola NotificationBell:
 *    - 30 detik saat tab aktif
 *    - backoff eksponensial saat gagal (×2, maks 5 menit)
 *    - pause penuh saat tab hidden, ping ulang instan saat visible lagi
 *    - token generasi (runId) mencegah rantai polling ganda bila tab di-toggle
 *      saat ping sedang melayang (timeout ping bisa 8 detik)
 * 3. navigator.connection (Network Information API) bila tersedia
 *    (Chrome/Android) — effectiveType & downlink. Safari tidak punya:
 *    degrade gracefully.
 *
 * Tier:
 *  - 'good'     : online & latensi < 200ms
 *  - 'fair'     : online & latensi 200–600ms
 *  - 'poor'     : online & latensi > 600ms ATAU ping terakhir gagal/timeout
 *  - 'offline'  : navigator.onLine === false
 *
 * Catatan desain: ping gagal saat browser masih mengaku online dianggap
 * 'poor' (bukan offline) — WiFi terhubung tapi upstream mati adalah kondisi
 * "lemah" yang jujur, bukan "offline".
 */

export type NetworkTier = 'good' | 'fair' | 'poor' | 'offline'

/** Network Information API (Chrome/Android) — Safari tidak punya, degrade gracefully. */
interface NavigatorConnection extends EventTarget {
    effectiveType?: string
    downlink?: number
}

function getNavigatorConnection(): NavigatorConnection | null {
    const conn = (navigator as Navigator & { connection?: NavigatorConnection }).connection
    return conn ?? null
}

export interface NetworkQuality {
    tier: NetworkTier
    /** Latensi round-trip ping terakhir yang sukses (ms), null bila belum pernah. */
    latencyMs: number | null
    /** true bila ping terakhir gagal/timeout — server tak terjangkau. */
    pingFailed: boolean
    /** effectiveType dari navigator.connection ('4g' dll), null bila API tak tersedia. */
    effectiveType: string | null
    /** Estimasi downlink navigator.connection (Mbps), null bila tak tersedia. */
    downlinkMbps: number | null
}

const POLL_INTERVAL = 30000 // 30 detik
const MAX_INTERVAL = 5 * 60000 // backoff maks 5 menit saat terus gagal
const PING_TIMEOUT_MS = 8000

const GOOD_MS = 200
const FAIR_MS = 600

export function useNetworkQuality(): NetworkQuality {
    const [isOnline, setIsOnline] = useState(true)
    const [latencyMs, setLatencyMs] = useState<number | null>(null)
    const [pingFailed, setPingFailed] = useState(false)
    const [connInfo, setConnInfo] = useState<{ effectiveType: string | null; downlinkMbps: number | null }>({
        effectiveType: null,
        downlinkMbps: null,
    })

    // Dibuka oleh efek polling setelah mount; dipakai efek online/offline untuk
    // memicu ping instan saat koneksi pulih (tidak menunggu timer backoff).
    const pingNowRef = useRef<() => void>(() => { })

    // Event online/offline browser
    useEffect(() => {
        setIsOnline(navigator.onLine)
        const goOnline = () => {
            setIsOnline(true)
            pingNowRef.current() // ping instan: indikator pulih segera setelah reconnect
        }
        const goOffline = () => setIsOnline(false)
        window.addEventListener('online', goOnline)
        window.addEventListener('offline', goOffline)
        return () => {
            window.removeEventListener('online', goOnline)
            window.removeEventListener('offline', goOffline)
        }
    }, [])

    // navigator.connection (bila tersedia) — refresh saat jenis koneksi berubah
    useEffect(() => {
        const conn = getNavigatorConnection()
        if (!conn) return
        const read = () => setConnInfo({
            effectiveType: conn.effectiveType ?? null,
            downlinkMbps: typeof conn.downlink === 'number' ? conn.downlink : null,
        })
        read()
        conn.addEventListener?.('change', read)
        return () => conn.removeEventListener?.('change', read)
    }, [])

    // Polling ping — pola NotificationBell (visibility-aware + backoff)
    useEffect(() => {
        let timeoutId: ReturnType<typeof setTimeout>
        let stopped = false
        let failCount = 0
        // Token generasi: tick baru (tab visible lagi / reconnect) membatalkan
        // kelanjutan rantai lama — tanpa ini, toggle tab di tengah ping yang
        // melayang membuat rantai polling ganda menumpuk.
        let runId = 0

        const ping = async (): Promise<void> => {
            const controller = new AbortController()
            const abortTimer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
            try {
                const t0 = performance.now()
                const res = await fetch('/api/ping', {
                    cache: 'no-store',
                    signal: controller.signal,
                })
                if (!stopped) {
                    if (res.ok) {
                        setLatencyMs(performance.now() - t0)
                        setPingFailed(false)
                        failCount = 0
                    } else {
                        setPingFailed(true)
                        failCount++
                    }
                }
            } catch {
                if (!stopped) {
                    setPingFailed(true)
                    failCount++
                }
            } finally {
                clearTimeout(abortTimer)
            }
        }

        const tick = async () => {
            if (document.hidden) return // jangan ping saat tab tersembunyi
            const myRun = ++runId
            await ping()
            // stopped = unmount; myRun !== runId = sudah ada tick yang lebih baru
            if (stopped || myRun !== runId) return
            // Gagal beruntun: rencanakan ping lebih jarang (60s, 120s, …, maks 5 mnt)
            const delay = failCount === 0 ? POLL_INTERVAL : Math.min(POLL_INTERVAL * 2 ** failCount, MAX_INTERVAL)
            timeoutId = setTimeout(tick, delay)
        }

        const kick = () => {
            clearTimeout(timeoutId)
            tick()
        }
        pingNowRef.current = kick

        tick()

        // Pause saat hidden; ping ulang instan saat kembali visible
        const handleVisibilityChange = () => {
            if (document.hidden) clearTimeout(timeoutId)
            else kick()
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            stopped = true
            clearTimeout(timeoutId)
            pingNowRef.current = () => { }
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [])

    const tier: NetworkTier = !isOnline
        ? 'offline'
        : pingFailed
            ? 'poor'
            : latencyMs == null
                ? 'good' // belum ada data — anggap baik, jangan alarm palsu
                : latencyMs <= GOOD_MS
                    ? 'good'
                    : latencyMs <= FAIR_MS
                        ? 'fair'
                        : 'poor'

    return { tier, latencyMs, pingFailed, effectiveType: connInfo.effectiveType, downlinkMbps: connInfo.downlinkMbps }
}

export default useNetworkQuality
