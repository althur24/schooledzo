'use client'

/**
 * Ikon WiFi bersama — bahasa visual tunggal untuk indikator jaringan LMS.
 * Dipakai oleh HeaderNetworkIndicator (header global) dan NetworkBadge
 * (halaman ujian siswa).
 *
 * 4 tier: 3 busur penuh (good/stable), 2 busur (fair/weak), 1 busur (poor),
 * garis coret (offline). Tanpa dependency tambahan (SVG inline).
 */

export type WifiTier = 'full' | 'two' | 'one' | 'offline'

/** Peta tier umum → tier ikon. 'poor' (latency/ping gagal) tampil 1 busur. */
export function tierToWifiTier(tier: 'good' | 'fair' | 'poor' | 'offline'): WifiTier {
    return tier === 'good' ? 'full' : tier === 'fair' ? 'two' : tier === 'poor' ? 'one' : 'offline'
}

export default function WifiTierIcon({ tier, size = 18 }: { tier: WifiTier; size?: number }) {
    const filled = tier === 'full' ? 3 : tier === 'two' ? 2 : tier === 'one' ? 1 : 0
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
            <path d="M2 8.5C8 3.5 16 3.5 22 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity={filled >= 3 ? 1 : 0.22} />
            <path d="M5.5 12C9 9 15 9 18.5 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity={filled >= 2 ? 1 : 0.22} />
            <path d="M9 15.5C10.5 14.3 13.5 14.3 15 15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity={filled >= 1 ? 1 : 0.22} />
            <circle cx="12" cy="19" r="1.6" fill="currentColor" />
            {tier === 'offline' && (
                <line x1="3.5" y1="20.5" x2="20.5" y2="3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
        </svg>
    )
}
