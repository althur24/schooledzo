'use client'

import React from 'react'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface Props {
    isOnline: boolean
    /** Hanya untuk halaman dgn autosave (Ulangan/UTS-UAS). Kosongkan untuk Kuis (online/offline saja). */
    saveStatus?: SaveStatus
    latencyMs?: number | null
    /** Tampilkan teks status di samping ikon (disembunyikan otomatis di layar sangat kecil). */
    showLabel?: boolean
}

/** Ambang latency simpan yang dianggap "lemah" (ms). */
const WEAK_LATENCY_MS = 2500

type Tier = 'stable' | 'weak' | 'offline'

/**
 * Badge indikator jaringan untuk halaman pengerjaan ujian siswa.
 * - merah/offline: navigator.offline
 * - kuning/weak   : autosave terakhir gagal ATAU lambat (> WEAK_LATENCY_MS)
 * - hijau/stable  : online & simpan sehat
 */
export default function NetworkBadge({ isOnline, saveStatus, latencyMs, showLabel = true }: Props) {
    const tier: Tier = !isOnline
        ? 'offline'
        : saveStatus === 'error' || (latencyMs != null && latencyMs > WEAK_LATENCY_MS)
            ? 'weak'
            : 'stable'

    const color = tier === 'offline' ? 'text-red-500 dark:text-red-400'
        : tier === 'weak' ? 'text-amber-500 dark:text-amber-400'
            : 'text-green-500 dark:text-green-400'

    const bg = tier === 'offline' ? 'bg-red-500/10'
        : tier === 'weak' ? 'bg-amber-500/10'
            : 'bg-green-500/10'

    const title = tier === 'offline'
        ? 'Offline — jawaban disimpan lokal & dikirim saat online'
        : tier === 'weak'
            ? 'Koneksi lemah — jawaban lambat/gagal tersimpan'
            : 'Koneksi stabil'

    let label = ''
    if (showLabel) {
        if (tier === 'offline') label = 'Offline'
        else if (saveStatus === 'saving') label = 'Menyimpan…'
        else if (saveStatus === 'error') label = 'Gagal simpan'
        else if (saveStatus === 'saved') label = 'Tersimpan'
    }

    return (
        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${bg} ${color}`} title={title}>
            <WifiIcon tier={tier} />
            {label && <span className="text-xs font-semibold hidden sm:inline">{label}</span>}
        </div>
    )
}

/** Ikon WiFi inline (3 busur + titik). Tanpa dependency tambahan. */
function WifiIcon({ tier }: { tier: Tier }) {
    const filled = tier === 'stable' ? 3 : tier === 'weak' ? 2 : 0
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
