'use client'

import WifiTierIcon, { tierToWifiTier } from '@/components/WifiTierIcon'
import useNetworkQuality from '@/hooks/useNetworkQuality'

/**
 * Indikator kualitas jaringan di header global (semua role).
 * Pill dark senada role pill header; label ms hanya di layar md+;
 * detail lengkap (latensi, jenis koneksi) di tooltip.
 *
 * Tidak pernah tampil bersamaan dengan NetworkBadge halaman ujian siswa —
 * exam mode menyembunyikan header seluruhnya (layout.tsx).
 */
export default function HeaderNetworkIndicator() {
    const { tier, latencyMs, pingFailed, effectiveType, downlinkMbps } = useNetworkQuality()

    const color = tier === 'good' ? 'text-emerald-400'
        : tier === 'fair' ? 'text-amber-400'
            : 'text-red-400'

    // pingFailed = server tak terjangkau — tampilkan "Lemah", bukan ms basi
    // dari ping sukses terakhir
    const label = tier === 'offline' ? 'Offline'
        : pingFailed ? 'Lemah'
            : latencyMs == null ? 'Online'
                : `${Math.round(latencyMs)} ms`

    const connDetail = effectiveType
        ? `Jenis koneksi: ${effectiveType.toUpperCase()}${downlinkMbps ? ` (~${downlinkMbps} Mbps)` : ''}`
        : 'Jenis koneksi: —'

    const title = tier === 'offline'
        ? 'Offline — tidak terhubung ke jaringan'
        : pingFailed
            ? 'Koneksi bermasalah — server tidak terjangkau, mencoba lagi otomatis'
            : tier === 'poor'
                ? `Koneksi lemah (${latencyMs != null ? Math.round(latencyMs) + ' ms' : 'memuat…'}) — bersabar saat memuat data`
                : `Koneksi ${tier === 'good' ? 'bagus' : 'sedang'} (${latencyMs != null ? Math.round(latencyMs) + ' ms' : 'memuat…'})`

    return (
        <div
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 ${color}`}
            title={`${title}\n${connDetail}`}
            role="status"
            aria-label={`Status jaringan: ${label}`}
        >
            <WifiTierIcon tier={tierToWifiTier(tier)} size={16} />
            <span className="text-xs font-semibold hidden md:inline tabular-nums">{label}</span>
        </div>
    )
}
