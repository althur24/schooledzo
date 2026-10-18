'use client'

import { Modal, Button } from '@/components/ui'
import { AlertTriangle } from 'lucide-react'

export interface DuplicateConfirmHit {
    className: string | null
    existingTitle: string
    isActive: boolean | null
}

/**
 * Dialog konfirmasi saat pre-flight mendeteksi ulangan dengan judul sama sudah
 * ada untuk salah satu kelas target. Shared (guru + admin) — jadi tampilan &
 * kata konsisten antar role (adil).
 *
 * On confirm → caller kirim POST dengan `force_duplicate: true` (bypass guard
 * server). On close → batal, tidak ada exam dibuat.
 */
export default function DuplicateConfirmDialog({
    open,
    onClose,
    onConfirm,
    hits,
    ulanganLabel,
}: {
    open: boolean
    onClose: () => void
    onConfirm: () => void
    hits: DuplicateConfirmHit[]
    ulanganLabel: string,
}) {
    return (
        <Modal open={open} onClose={onClose} title={`Peringatan: ${ulanganLabel} Serupa Sudah Ada`}>
            <div className="space-y-4">
                <div className="flex items-start gap-3 p-3 bg-amber-500/10 text-amber-700 dark:text-amber-300 rounded-xl">
                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <p className="font-bold">
                            {ulanganLabel} dengan judul yang sama sudah ada untuk kelas berikut:
                        </p>
                        <ul className="mt-2 space-y-1">
                            {hits.map((h, i) => (
                                <li key={i} className="text-xs">
                                    <span className="font-bold">{h.className || 'Kelas'}</span>
                                    {' — '}
                                    <span className="italic">&ldquo;{h.existingTitle}&rdquo;</span>
                                    {h.isActive ? ' (aktif)' : ' (draft)'}
                                </li>
                            ))}
                        </ul>
                        <p className="mt-2 text-xs opacity-90">
                            Siswa dapat bingung jika ada {ulanganLabel.toLowerCase()} ganda dengan judul
                            sama. Pastikan ini memang yang Anda maksud (mis. re-test sah) sebelum
                            melanjutkan.
                        </p>
                    </div>
                </div>
                <div className="flex gap-3 pt-2">
                    <Button variant="secondary" onClick={onClose} className="flex-1">Batal</Button>
                    <Button onClick={onConfirm} className="flex-1">Tetap Buat</Button>
                </div>
            </div>
        </Modal>
    )
}
