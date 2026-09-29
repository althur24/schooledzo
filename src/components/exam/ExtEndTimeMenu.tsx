'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Clock, Loader2, X } from 'lucide-react'

interface ExtendTimeMenuProps {
    /** Endpoint POST extend-time (ulangan / official). */
    endpoint: string
    /** Body tambahan (exam_id, dsb.) — additional_minutes disusun komponen. */
    extraBody?: Record<string, unknown>
    /** Ringkasan monitor untuk preview dampak di modal. */
    workingCount: number
    notStartedCount: number
    submittedCount: number
    /** Dipanggil dengan hasil — parent menampilkan toast & refresh data. */
    onResult: (ok: boolean, message: string) => void
}

const PRESETS = [5, 10, 15]
const MAX_MINUTES = 120
const MIN_MINUTES = 1

/**
 * Tombol + modal "Tambah Waktu" untuk Monitor Live (guru & admin, ulangan
 * dan UTS/UAS — satu komponen dipakai 2 halaman). Preset +5/+10/+15 dan
 * input custom (1–120, divalidasi client; server memvalidasi ulang).
 * Modal dirender via portal (pola ResetAttemptMenu) — bebas clip.
 */
export default function ExtEndTimeMenu({
    endpoint, extraBody = {}, workingCount, notStartedCount, submittedCount, onResult,
}: ExtendTimeMenuProps) {
    const [open, setOpen] = useState(false)
    const [minutes, setMinutes] = useState<number>(10)
    const [customValue, setCustomValue] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const applyCustom = (raw: string) => {
        setCustomValue(raw)
        const n = parseInt(raw, 10)
        if (!Number.isNaN(n) && n >= MIN_MINUTES && n <= MAX_MINUTES) {
            setMinutes(n)
            setError(null)
        } else {
            setError(`Masukkan angka ${MIN_MINUTES}–${MAX_MINUTES}`)
        }
    }

    const submit = async () => {
        if (minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
            setError(`Masukkan angka ${MIN_MINUTES}–${MAX_MINUTES}`)
            return
        }
        setBusy(true)
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...extraBody, additional_minutes: minutes }),
            })
            const data = await res.json().catch(() => null)
            if (res.ok && data?.success) {
                onResult(true, data.message || `+${minutes} menit diterapkan`)
                setOpen(false)
                setCustomValue('')
            } else {
                onResult(false, data?.error || `Gagal menambah waktu (status ${res.status})`)
            }
        } catch {
            onResult(false, 'Gagal menambah waktu — periksa koneksi')
        } finally {
            setBusy(false)
        }
    }

    const modal = open ? createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
            onClick={() => !busy && setOpen(false)}
        >
            <div
                className="bg-white dark:bg-surface-dark rounded-2xl shadow-2xl border border-secondary/20 w-full max-w-md overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-secondary/10">
                    <h3 className="font-bold text-text-main dark:text-white flex items-center gap-2">
                        <Clock className="w-5 h-5 text-primary" /> Tambah Waktu Pengerjaan
                    </h3>
                    <button
                        onClick={() => !busy && setOpen(false)}
                        className="p-1.5 rounded-lg hover:bg-secondary/10 text-text-secondary"
                        aria-label="Tutup"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-5 space-y-5">
                    <div>
                        <p className="text-sm font-bold text-text-main dark:text-white mb-3">Pilih tambahan menit:</p>
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            {PRESETS.map(p => (
                                <button
                                    key={p}
                                    onClick={() => { setMinutes(p); setCustomValue(''); setError(null) }}
                                    className={`py-2.5 rounded-xl font-bold text-sm transition-colors border ${
                                        minutes === p && customValue === ''
                                            ? 'bg-primary text-white border-primary'
                                            : 'bg-secondary/5 text-text-main dark:text-white border-secondary/20 hover:bg-secondary/10'
                                    }`}
                                >
                                    +{p} menit
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-text-secondary whitespace-nowrap">Custom:</span>
                            <input
                                type="number"
                                min={MIN_MINUTES}
                                max={MAX_MINUTES}
                                value={customValue}
                                onChange={e => applyCustom(e.target.value)}
                                placeholder={`${MIN_MINUTES}–${MAX_MINUTES}`}
                                className="w-24 px-3 py-2 bg-secondary/5 border border-secondary/20 rounded-xl text-text-main dark:text-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/50"
                            />
                            <span className="text-sm text-text-secondary">menit</span>
                        </div>
                        {error && <p className="text-xs text-red-500 font-bold mt-1.5">{error}</p>}
                    </div>

                    <div className="text-xs bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/20 rounded-xl p-3 space-y-1.5">
                        <p className="font-bold text-blue-800 dark:text-blue-300">Dampak penerapan +{minutes} menit:</p>
                        <p className="text-blue-700 dark:text-blue-400">• <strong>{workingCount} siswa</strong> sedang mengerjakan — timer diperpanjang, muncul otomatis tanpa reload.</p>
                        <p className="text-blue-700 dark:text-blue-400">• <strong>{notStartedCount} siswa</strong> belum mulai — batas akhir digeser (ikut diuntungkan).</p>
                        <p className="text-blue-700 dark:text-blue-400">• <strong>{submittedCount} siswa</strong> sudah selesai — tidak terpengaruh.</p>
                        {submittedCount > 0 && (
                            <p className="text-blue-600/70 dark:text-blue-400/70">Siswa yang sudah terkirim otomatis tidak bisa diperpanjang — gunakan menu Reset per siswa.</p>
                        )}
                    </div>

                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={() => !busy && setOpen(false)}
                            className="px-4 py-2.5 rounded-xl text-sm font-bold text-text-secondary hover:bg-secondary/10"
                            disabled={busy}
                        >
                            Batal
                        </button>
                        <button
                            onClick={submit}
                            disabled={busy || !!error}
                            className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-orange-500/25"
                        >
                            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                            Terapkan +{minutes} Menit
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    ) : null

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 rounded-lg hover:bg-orange-200 dark:hover:bg-orange-500/30 transition-colors text-xs font-bold"
                title="Perpanjang waktu pengerjaan untuk siswa yang sedang mengerjakan"
            >
                <Clock className="w-3.5 h-3.5" />
                Tambah Waktu
            </button>
            {modal}
        </>
    )
}
