'use client'

import React from 'react'
import WifiTierIcon, { type WifiTier } from '@/components/WifiTierIcon'

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
            <WifiTierIcon tier={badgeTierToWifiTier(tier)} />
            {label && <span className="text-xs font-semibold hidden sm:inline">{label}</span>}
        </div>
    )
}

/** Peta tier badge ujian (3 tingkat) → tier ikon bersama (4 tingkat). */
function badgeTierToWifiTier(tier: Tier): WifiTier {
    return tier === 'stable' ? 'full' : tier === 'weak' ? 'two' : 'offline'
}
