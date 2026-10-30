'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarClock, Loader2, ShieldCheck, X } from 'lucide-react'
import { SUSULAN_MAX_PERCENT, SUSULAN_MIN_PERCENT, SUSULAN_VALIDITY_DAYS } from '@/lib/susulan'

export interface SusulanTarget {
    examId: string
    studentId: string
    studentName: string
    submissionId: string | null
    durationMinutes: number
    existing: {
        max_percent: number | null
        expires_at: string | null
        expired: boolean
    } | null
}

interface SusulanModalProps {
    target: SusulanTarget | null
    /** Endpoint POST/DELETE susulan sesuai jenis ujian. */
    endpoint: string
    onClose: () => void
    onResult: (ok: boolean, message: string) => void
}

/**
 * Modal Susulan di Monitor Live (guru & admin, ulangan & UTS/UAS).
 * - siswa mengerjakan attempt susulan (durasi penuh sejak mulai)
 * - guru memilih nilai penuh (100% = tanpa cap) atau batas maksimal X%
 * - grant berlaku 7 hari, bisa dibatalkan selama siswa belum mulai
 */
export default function SusulanModal({ target, endpoint, onClose, onResult }: SusulanModalProps) {
    const [mode, setMode] = useState<'full' | 'cap'>('full')
    const [percent, setPercent] = useState('80')
    const [busy, setBusy] = useState(false)
    const [revoking, setRevoking] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!target) return
        const existingPercent = target.existing?.max_percent
        const hasCap = typeof existingPercent === 'number' && existingPercent < 100
        setMode(hasCap ? 'cap' : 'full')
        setPercent(hasCap ? String(existingPercent) : '80')
        setError(null)
        setBusy(false)
        setRevoking(false)
    }, [target])

    useEffect(() => {
        if (!target) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busy && !revoking) onClose()
        }
        window.addEventListener('keydown', onKey)
        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            window.removeEventListener('keydown', onKey)
            document.body.style.overflow = prevOverflow
        }
    }, [target, busy, revoking, onClose])

    if (!target) return null

    const parsedPercent = Number(percent)
    const percentValid = Number.isInteger(parsedPercent)
        && parsedPercent >= SUSULAN_MIN_PERCENT
        && parsedPercent <= SUSULAN_MAX_PERCENT
    const canSubmit = !busy && !revoking && (mode === 'full' || percentValid)

    const submit = async () => {
        if (!canSubmit) return
        setBusy(true)
        setError(null)
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    exam_id: target.examId,
                    student_id: target.studentId,
                    max_percent: mode === 'full' ? 100 : parsedPercent,
                }),
            })
            const data = await res.json().catch(() => null)
            if (res.ok && data?.success) {
                onResult(true, data.message || 'Susulan dibuka')
                onClose()
            } else {
                // Error cukup inline (hindari toast ganda); modal tetap terbuka
                // agar guru bisa memperbaiki cap atau melihat race 409.
                setError(data?.error || `Gagal membuka susulan (status ${res.status})`)
            }
        } catch {
            setError('Gagal membuka susulan — periksa koneksi')
        } finally {
            setBusy(false)
        }
    }

    const revoke = async () => {
        if (!target.submissionId) return
        if (!confirm(`Batalkan susulan untuk ${target.studentName}?\n\nSiswa tidak akan bisa mengerjakan susulan ini sampai guru membukanya lagi.`)) return
        setRevoking(true)
        setError(null)
        try {
            const res = await fetch(endpoint, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ submission_id: target.submissionId }),
            })
            const data = await res.json().catch(() => null)
            if (res.ok && data?.success) {
                onResult(true, data.message || 'Susulan dibatalkan')
                onClose()
            } else {
                setError(data?.error || `Gagal membatalkan susulan (status ${res.status})`)
            }
        } catch {
            setError('Gagal membatalkan susulan — periksa koneksi')
        } finally {
            setRevoking(false)
        }
    }

    const expiresLabel = target.existing?.expires_at
        ? new Date(target.existing.expires_at).toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        })
        : null

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
            onClick={() => !busy && !revoking && onClose()}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="susulan-modal-title"
                className="bg-white dark:bg-surface-dark rounded-2xl shadow-2xl border border-secondary/20 w-full max-w-md overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-secondary/10">
                    <h3 id="susulan-modal-title" className="font-bold text-text-main dark:text-white flex items-center gap-2">
                        <CalendarClock className="w-5 h-5 text-primary" />
                        {target.existing ? 'Kelola Susulan' : 'Buka Susulan'} — {target.studentName}
                    </h3>
                    <button
                        onClick={() => !busy && !revoking && onClose()}
                        className="p-1.5 rounded-lg hover:bg-secondary/10 text-text-secondary"
                        aria-label="Tutup"
                        autoFocus
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-5 space-y-5">
                    {target.existing && (
                        <div className={`rounded-xl border p-3 flex items-start gap-3 ${
                            target.existing.expired
                                ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/30'
                                : 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-900/30'
                        }`}>
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                                target.existing.expired
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
                                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                            }`}>
                                <CalendarClock className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                                <p className={`text-sm font-bold ${target.existing.expired ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-800 dark:text-emerald-300'}`}>
                                    {target.existing.expired ? 'Susulan sudah kedaluwarsa' : 'Susulan sedang aktif'}
                                </p>
                                <p className="text-xs text-text-secondary mt-0.5">
                                    {typeof target.existing.max_percent === 'number' && target.existing.max_percent < 100
                                        ? `Batas nilai: maksimal ${target.existing.max_percent}%`
                                        : 'Batas nilai: tanpa cap (100%)'}
                                    {expiresLabel ? <> · berlaku sampai <strong>{expiresLabel}</strong></> : ''}
                                </p>
                                <p className="text-[11px] text-text-secondary mt-1">
                                    {target.existing.expired
                                        ? 'Simpan untuk memperpanjang 7 hari dari sekarang.'
                                        : 'Ubah batas nilai atau perpanjang masa berlaku. Siswa belum mulai, jadi perubahan aman.'}
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="text-xs bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/20 rounded-xl p-3 space-y-1.5">
                        <p className="font-bold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4" /> Siswa mengerjakan attempt susulan
                        </p>
                        <p className="text-blue-700 dark:text-blue-400">
                            • Durasi <strong>{target.durationMinutes > 0 ? `${target.durationMinutes} menit` : 'mengikuti batas ujian'}</strong> dihitung sejak siswa mulai — tidak terpotong jam tutup ujian.
                        </p>
                        <p className="text-blue-700 dark:text-blue-400">
                            • Berlaku <strong>{SUSULAN_VALIDITY_DAYS} hari</strong> sejak dibuka/diperpanjang. Bisa dibatalkan selama siswa belum mulai.
                        </p>
                    </div>

                    <div>
                        <p className="text-sm font-bold text-text-main dark:text-white mb-3">Nilai akhir siswa:</p>
                        <div className="space-y-2">
                            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${mode === 'full' ? 'border-primary bg-primary/5' : 'border-secondary/20 hover:bg-secondary/5'}`}>
                                <input
                                    type="radio"
                                    name="susulan-mode"
                                    className="mt-0.5"
                                    checked={mode === 'full'}
                                    onChange={() => setMode('full')}
                                    disabled={busy || revoking}
                                />
                                <span>
                                    <span className="block text-sm font-bold text-text-main dark:text-white">Nilai penuh (tanpa batas)</span>
                                    <span className="block text-[11px] text-text-secondary mt-0.5">Nilai dihitung dari jawaban siswa, maksimal 100% dari total poin.</span>
                                </span>
                            </label>

                            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${mode === 'cap' ? 'border-primary bg-primary/5' : 'border-secondary/20 hover:bg-secondary/5'}`}>
                                <input
                                    type="radio"
                                    name="susulan-mode"
                                    className="mt-0.5"
                                    checked={mode === 'cap'}
                                    onChange={() => setMode('cap')}
                                    disabled={busy || revoking}
                                />
                                <span className="flex-1">
                                    <span className="block text-sm font-bold text-text-main dark:text-white">Batasi nilai maksimal</span>
                                    <span className="block text-[11px] text-text-secondary mt-0.5">Berapa pun benar jawabannya, nilai akhir tidak melebihi batas ini.</span>
                                    <span className="mt-2 flex items-center gap-2">
                                        <input
                                            type="number"
                                            min={SUSULAN_MIN_PERCENT}
                                            max={SUSULAN_MAX_PERCENT}
                                            step={1}
                                            value={percent}
                                            onChange={e => setPercent(e.target.value)}
                                            disabled={mode !== 'cap' || busy || revoking}
                                            className="w-24 px-3 py-2 bg-white dark:bg-surface-dark border border-secondary/30 rounded-xl text-text-main dark:text-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                                        />
                                        <span className="text-sm text-text-secondary">% dari nilai maksimal</span>
                                    </span>
                                    {mode === 'cap' && !percentValid && (
                                        <span className="block text-xs text-red-500 font-bold mt-1">
                                            Masukkan angka {SUSULAN_MIN_PERCENT}–{SUSULAN_MAX_PERCENT}
                                        </span>
                                    )}
                                </span>
                            </label>
                        </div>
                    </div>

                    {error && <p className="text-xs text-red-500 font-bold">{error}</p>}

                    <div className="flex items-center justify-between gap-3">
                        {target.submissionId ? (
                            <button
                                onClick={revoke}
                                disabled={busy || revoking}
                                className="px-3 py-2 rounded-xl text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50 flex items-center gap-1.5"
                            >
                                {revoking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                Batalkan Susulan
                            </button>
                        ) : <span />}

                        <div className="flex gap-2">
                            <button
                                onClick={() => !busy && !revoking && onClose()}
                                className="px-4 py-2.5 rounded-xl text-sm font-bold text-text-secondary hover:bg-secondary/10"
                                disabled={busy || revoking}
                            >
                                Batal
                            </button>
                            <button
                                onClick={submit}
                                disabled={!canSubmit}
                                className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-primary/20"
                            >
                                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                                {target.existing
                                    ? (target.existing.expired ? `Perpanjang ${SUSULAN_VALIDITY_DAYS} Hari` : 'Simpan Perubahan')
                                    : 'Buka Susulan'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    )
}
