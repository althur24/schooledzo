'use client'

import React from 'react'
import { Scale } from 'lucide-react'

/**
 * BalancePointsControl — "Seimbangkan" poin soal secara otomatis.
 *
 * Guru memasukkan TOTAL poin target (mis. 100); seluruh soal dibagi rata
 * dengan metode largest-remainder dalam presisi 2 desimal, sehingga jumlah
 * SEMUA soal = total PERSIS (100/3 soal → 33.33 + 33.33 + 33.34).
 * Poin desimal didukung penuh (kolom points double precision).
 *
 * Komponen ini hanya menghitung & men-trigger onApply — pemanggil yang
 * bertugas menyimpan (PUT per soal) dan refetch.
 */
export default function BalancePointsControl({
    count,
    disabled,
    disabledReason,
    applying,
    onApply,
}: {
    /** Jumlah soal yang akan dibagi rata. */
    count: number
    /** Dimatikan saat ujian aktif/terkunci dsb. */
    disabled?: boolean
    disabledReason?: string
    applying?: boolean
    /** Menerima daftar poin per soal (urutan = urutan soal pemanggil). */
    onApply: (pointsPerQuestion: number[]) => Promise<void>
}) {
    const [total, setTotal] = React.useState('100')
    const [error, setError] = React.useState<string | null>(null)
    const [busy, setBusy] = React.useState(false)

    const handleBalance = async () => {
        setError(null)
        const target = parseFloat(total)
        if (!Number.isFinite(target) || target <= 0) {
            setError('Total poin harus angka > 0')
            return
        }
        if (count <= 0) {
            setError('Belum ada soal untuk diseimbangkan')
            return
        }
        // Largest-remainder dalam satuan sen (0.01) — jumlah hasil PERSIS total
        const cents = Math.round(target * 100)
        if (cents < count) {
            setError(`Total terlalu kecil: ${count} soal × 0.01 minimum = ${(count / 100).toFixed(2)}`)
            return
        }
        const base = Math.floor(cents / count)
        const rem = cents - base * count
        const points = Array.from({ length: count }, (_, i) => (i < rem ? base + 1 : base) / 100)

        setBusy(true)
        try {
            await onApply(points)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Gagal menyeimbangkan poin')
        } finally {
            setBusy(false)
        }
    }

    const isDisabled = disabled || busy || applying

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-secondary/5 dark:bg-white/5 border border-secondary/20 dark:border-white/10 rounded-lg px-2 py-1.5">
                    <Scale size={14} className="text-text-secondary flex-shrink-0" />
                    <input
                        type="number"
                        value={total}
                        onChange={(e) => setTotal(e.target.value)}
                        className="w-14 bg-transparent text-sm text-text-main dark:text-white text-center focus:outline-none"
                        min={0.01}
                        step={0.01}
                        title="Total poin target untuk semua soal"
                        disabled={isDisabled}
                    />
                    <span className="text-xs text-text-secondary whitespace-nowrap">total</span>
                </div>
                <button
                    type="button"
                    onClick={handleBalance}
                    disabled={isDisabled}
                    title={disabled ? (disabledReason || 'Tidak tersedia') : `Bagi rata ${total} poin ke ${count} soal`}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                    {busy ? 'Menyeimbangkan…' : 'Seimbangkan'}
                </button>
            </div>
            {error && <p className="text-[11px] text-red-500">{error}</p>}
        </div>
    )
}
