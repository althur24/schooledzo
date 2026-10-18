'use client'

import { Clock, X } from 'lucide-react'

/**
 * Banner warning kuning — muncul kalau jam HP meleset >2 menit dari server.
 * Dismissible. Tidak muncul kalau offset belum diketahui (null) atau <2 menit.
 *
 * Props:
 *   minutes  — selisih dalam menit (positif = HP maju, negatif = HP mundur)
 *   dismissed — apakah siswa sudah tutup banner
 *   onDismiss — callback untuk tutup banner
 */
export function ServerTimeWarning({
    minutes,
    dismissed,
    onDismiss,
}: {
    minutes: number | null
    dismissed: boolean
    onDismiss: () => void
}) {
    if (minutes === null || dismissed || Math.abs(minutes) < 2) return null

    const direction = minutes > 0 ? 'maju' : 'mundur'
    const absMin = Math.abs(minutes)

    return (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3 flex items-center gap-3">
            <Clock className="text-amber-500 shrink-0" size={18} />
            <p className="text-sm text-amber-700 dark:text-amber-300 flex-1">
                Jam perangkat Anda terdeteksi meleset {direction} {absMin} menit.
                Waktu ujian mengikuti waktu server.
            </p>
            <button
                onClick={onDismiss}
                className="text-amber-400 hover:text-amber-600 dark:text-amber-500 dark:hover:text-amber-300 shrink-0"
                aria-label="Tutup peringatan"
            >
                <X size={16} />
            </button>
        </div>
    )
}
