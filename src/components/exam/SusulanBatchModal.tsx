'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, Users, X } from 'lucide-react'
import { SUSULAN_MAX_PERCENT, SUSULAN_MIN_PERCENT, SUSULAN_VALIDITY_DAYS } from '@/lib/susulan'

export interface SusulanBatchStudent {
    studentId: string
    studentName: string
    nis: string
    className: string
    examId: string | null
    durationMinutes: number
    susulan: {
        max_percent: number | null
        expires_at: string | null
        expired: boolean
    } | null
}

interface SusulanBatchModalProps {
    open: boolean
    students: SusulanBatchStudent[]
    fallbackExamId: string
    endpoint: string
    onClose: () => void
    /** Dipanggil sekali setelah proses batch selesai (parent refresh + toast). */
    onResult: (ok: boolean, message: string) => void
}

interface BatchResponse {
    success: true
    opened_count: number
    updated_count: number
    skipped_count: number
    failed_count: number
    skipped: { student_id: string; reason: string }[]
    failed: { student_id: string; reason: string }[]
}

const keyOf = (s: SusulanBatchStudent) => `${s.examId ?? ''}|${s.studentId}`

const isActiveGrant = (s: SusulanBatchStudent): boolean => !!s.susulan && !s.susulan.expired

export default function SusulanBatchModal({
    open, students, fallbackExamId, endpoint, onClose, onResult,
}: SusulanBatchModalProps) {
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [includeActive, setIncludeActive] = useState(false)
    const [mode, setMode] = useState<'full' | 'cap'>('full')
    const [percent, setPercent] = useState('80')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [result, setResult] = useState<BatchResponse | null>(null)

    // Reset pilihan saat modal dibuka. Siswa "belum dibuka" + "kedaluwarsa"
    // tercentang otomatis; yang masih aktif TIDAK (opsional lewat toggle).
    useEffect(() => {
        if (!open) return
        const next = new Set<string>()
        for (const s of students) {
            if (!s.susulan || s.susulan.expired) next.add(keyOf(s))
        }
        setSelected(next)
        setIncludeActive(false)
        setMode('full')
        setPercent('80')
        setBusy(false)
        setError(null)
        setResult(null)
        // sengaja hanya [open] — refresh monitor saat modal terbuka tidak boleh
        // mereset pilihan guru.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busy) onClose()
        }
        window.addEventListener('keydown', onKey)
        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            window.removeEventListener('keydown', onKey)
            document.body.style.overflow = prevOverflow
        }
    }, [open, busy, onClose])

    if (!open) return null

    const parsedPercent = Number(percent)
    const percentValid = Number.isInteger(parsedPercent)
        && parsedPercent >= SUSULAN_MIN_PERCENT
        && parsedPercent <= SUSULAN_MAX_PERCENT
    const capValue = mode === 'full' ? 100 : parsedPercent
    const canSubmit = !busy && selected.size > 0 && (mode === 'full' || percentValid)

    const groups = (() => {
        const map = new Map<string, SusulanBatchStudent[]>()
        for (const s of students) {
            const cls = s.className || 'Tanpa Kelas'
            if (!map.has(cls)) map.set(cls, [])
            map.get(cls)!.push(s)
        }
        return [...map.entries()]
            .map(([className, list]) => ({
                className,
                list: [...list].sort((a, b) => a.studentName.localeCompare(b.studentName, 'id')),
            }))
            .sort((a, b) => a.className.localeCompare(b.className, 'id', { numeric: true, sensitivity: 'base' }))
    })()

    const selectableIn = (list: SusulanBatchStudent[]) =>
        list.filter(s => !isActiveGrant(s) || includeActive)

    const toggleKey = (key: string) => {
        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const toggleGroup = (list: SusulanBatchStudent[]) => {
        const keys = selectableIn(list).map(keyOf)
        const allSelected = keys.length > 0 && keys.every(k => selected.has(k))
        setSelected(prev => {
            const next = new Set(prev)
            if (allSelected) keys.forEach(k => next.delete(k))
            else keys.forEach(k => next.add(k))
            return next
        })
    }

    const toggleAll = () => {
        const keys = students.filter(s => !isActiveGrant(s) || includeActive).map(keyOf)
        const allSelected = keys.length > 0 && keys.every(k => selected.has(k))
        setSelected(allSelected ? new Set() : new Set(keys))
    }

    const onIncludeActiveChange = (checked: boolean) => {
        setIncludeActive(checked)
        setSelected(prev => {
            const next = new Set(prev)
            for (const s of students) {
                if (!isActiveGrant(s)) continue
                if (checked) next.add(keyOf(s))
                else next.delete(keyOf(s))
            }
            return next
        })
    }

    const submit = async () => {
        if (!canSubmit) return
        setBusy(true)
        setError(null)

        const chosen = students.filter(s => selected.has(keyOf(s)))
        const byExam = new Map<string, string[]>()
        for (const s of chosen) {
            const examId = s.examId || fallbackExamId
            if (!byExam.has(examId)) byExam.set(examId, [])
            byExam.get(examId)!.push(s.studentId)
        }

        try {
            // allSettled: satu grup exam gagal TIDAK boleh menggugurkan hasil
            // grup lain yang sudah benar-benar ter-grant di server.
            const entries = [...byExam.entries()]
            const settled = await Promise.allSettled(entries.map(async ([examId, studentIds]) => {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ exam_id: examId, student_ids: studentIds, max_percent: capValue }),
                })
                const data = await res.json().catch(() => null)
                if (!res.ok || !data?.success) {
                    throw new Error(data?.error || `Gagal memproses (status ${res.status})`)
                }
                return data as BatchResponse
            }))

            const responses: BatchResponse[] = []
            const groupFailures: { student_id: string; reason: string }[] = []
            settled.forEach((outcome, i) => {
                if (outcome.status === 'fulfilled') {
                    responses.push(outcome.value)
                } else {
                    const reason = outcome.reason instanceof Error ? outcome.reason.message : 'Gagal memproses'
                    for (const sid of entries[i][1]) groupFailures.push({ student_id: sid, reason })
                }
            })

            const merged: BatchResponse = {
                success: true,
                opened_count: responses.reduce((n, r) => n + r.opened_count, 0),
                updated_count: responses.reduce((n, r) => n + r.updated_count, 0),
                skipped_count: responses.reduce((n, r) => n + r.skipped_count, 0),
                failed_count: responses.reduce((n, r) => n + r.failed_count, 0) + groupFailures.length,
                skipped: responses.flatMap(r => r.skipped),
                failed: [...responses.flatMap(r => r.failed), ...groupFailures],
            }
            setResult(merged)

            const parts = [
                merged.opened_count > 0 ? `${merged.opened_count} dibuka` : null,
                merged.updated_count > 0 ? `${merged.updated_count} diperpanjang` : null,
                merged.skipped_count > 0 ? `${merged.skipped_count} dilewati` : null,
                merged.failed_count > 0 ? `${merged.failed_count} gagal` : null,
            ].filter(Boolean)
            const message = parts.length > 0 ? `Susulan diproses: ${parts.join(', ')}` : 'Tidak ada perubahan'
            // Sukses hanya bila ADA yang benar-benar terproses. Semua gagal →
            // toast error (jangan hijau) agar guru tidak salah paham.
            const anySuccess = merged.opened_count + merged.updated_count > 0
            if (anySuccess) {
                onResult(true, message)
            } else {
                onResult(false, message)
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Gagal memproses susulan massal')
        } finally {
            setBusy(false)
        }
    }

    const nameById = new Map(students.map(s => [s.studentId, s.studentName]))
    const visibleCount = students.length
    const notStartedCount = students.filter(s => !isActiveGrant(s)).length
    const activeCount = students.length - notStartedCount

    const modal = (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/50"
            onClick={() => !busy && onClose()}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="susulan-batch-title"
                className="bg-white dark:bg-surface-dark rounded-2xl shadow-2xl border border-secondary/20 w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-secondary/10 flex-shrink-0">
                    <div className="min-w-0">
                        <h3 id="susulan-batch-title" className="font-bold text-text-main dark:text-white flex items-center gap-2">
                            <CalendarClock className="w-5 h-5 text-primary flex-shrink-0" /> Buka Susulan
                        </h3>
                        <p className="text-xs text-text-secondary mt-0.5">
                            Pilih siswa yang belum mengerjakan, lalu tentukan nilai sekali untuk semua.
                        </p>
                    </div>
                    <button
                        onClick={() => !busy && onClose()}
                        className="p-1.5 rounded-lg hover:bg-secondary/10 text-text-secondary flex-shrink-0"
                        aria-label="Tutup"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {result ? (
                    <div className="p-6 overflow-y-auto">
                        <div className="flex flex-col items-center text-center">
                            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
                                <CheckCircle2 className="w-7 h-7" />
                            </div>
                            <p className="font-bold text-text-main dark:text-white">Susulan selesai diproses</p>
                            <div className="flex flex-wrap items-center justify-center gap-2 mt-3 text-xs font-bold">
                                {result.opened_count > 0 && <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">{result.opened_count} dibuka</span>}
                                {result.updated_count > 0 && <span className="px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400">{result.updated_count} diperpanjang</span>}
                                {result.skipped_count > 0 && <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">{result.skipped_count} dilewati</span>}
                                {result.failed_count > 0 && <span className="px-3 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400">{result.failed_count} gagal</span>}
                            </div>
                        </div>

                        {result.skipped.length > 0 && (
                            <div className="mt-5 rounded-xl border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-900/10 p-3">
                                <p className="text-xs font-bold text-amber-800 dark:text-amber-300 mb-1.5">Dilewati</p>
                                <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
                                    {result.skipped.slice(0, 10).map(item => (
                                        <li key={item.student_id}>
                                            • {nameById.get(item.student_id) || 'Siswa'} — {item.reason}
                                        </li>
                                    ))}
                                    {result.skipped.length > 10 && <li>• dan {result.skipped.length - 10} lainnya</li>}
                                </ul>
                            </div>
                        )}

                        <div className="flex justify-end mt-5">
                            <button
                                onClick={onClose}
                                className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white text-sm font-bold"
                            >
                                Tutup
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="p-5 overflow-y-auto space-y-4 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <span className="font-bold text-text-main dark:text-white">{visibleCount} siswa belum mengerjakan</span>
                                <span className="text-text-secondary">{notStartedCount} perlu dibuka · {activeCount} sudah dibuka</span>
                            </div>

                            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${includeActive ? 'border-primary bg-primary/5' : 'border-secondary/20 hover:bg-secondary/5'}`}>
                                <input
                                    type="checkbox"
                                    checked={includeActive}
                                    onChange={e => onIncludeActiveChange(e.target.checked)}
                                    disabled={busy || activeCount === 0}
                                    className="mt-0.5"
                                />
                                <span>
                                    <span className="block text-sm font-bold text-text-main dark:text-white">Perbarui juga yang sudah dibuka</span>
                                    <span className="block text-[11px] text-text-secondary mt-0.5">
                                        Nilai dan masa berlaku siswa yang masih punya susulan aktif akan diganti dengan pengaturan di bawah.
                                    </span>
                                </span>
                            </label>

                            <div className="flex items-center justify-between">
                                <p className="text-xs font-bold text-text-main dark:text-white">Pilih siswa:</p>
                                <button
                                    onClick={toggleAll}
                                    disabled={busy}
                                    className="text-xs font-bold text-primary hover:underline disabled:opacity-50"
                                >
                                    Pilih semua
                                </button>
                            </div>

                            <div className="space-y-3">
                                {groups.map(group => {
                                    const selectable = selectableIn(group.list)
                                    const allSelected = selectable.length > 0 && selectable.every(s => selected.has(keyOf(s)))
                                    return (
                                        <div key={group.className} className="rounded-xl border border-secondary/20 overflow-hidden">
                                            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-secondary/5">
                                                <p className="text-xs font-bold text-text-main dark:text-white">{group.className}</p>
                                                <button
                                                    onClick={() => toggleGroup(group.list)}
                                                    disabled={busy || selectable.length === 0}
                                                    className="text-[11px] font-bold text-primary hover:underline disabled:opacity-40"
                                                >
                                                    {allSelected ? 'Batal pilih kelas' : 'Pilih kelas ini'}
                                                </button>
                                            </div>
                                            <div className="divide-y divide-secondary/10">
                                                {group.list.map(s => {
                                                    const active = isActiveGrant(s)
                                                    const disabled = busy || (active && !includeActive)
                                                    const checked = selected.has(keyOf(s))
                                                    return (
                                                        <label
                                                            key={keyOf(s)}
                                                            className={`flex items-center gap-3 px-3 py-2.5 ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-secondary/5'}`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                disabled={disabled}
                                                                onChange={() => toggleKey(keyOf(s))}
                                                            />
                                                            <span className="flex-1 min-w-0">
                                                                <span className="block text-sm font-medium text-text-main dark:text-white truncate">{s.studentName}</span>
                                                                <span className="block text-[11px] text-text-secondary">
                                                                    {s.nis ? `NIS ${s.nis}` : 'Tanpa NIS'}
                                                                    {s.susulan?.expires_at
                                                                        ? ` · s.d. ${new Date(s.susulan.expires_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}`
                                                                        : ''}
                                                                </span>
                                                            </span>
                                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${
                                                                !s.susulan
                                                                    ? 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-400'
                                                                    : s.susulan.expired
                                                                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
                                                                        : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400'
                                                            }`}>
                                                                {!s.susulan ? 'Belum dibuka' : s.susulan.expired ? 'Kedaluwarsa' : 'Sudah dibuka'}
                                                            </span>
                                                        </label>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            <div className="rounded-xl border border-secondary/20 p-3 space-y-3">
                                <p className="text-sm font-bold text-text-main dark:text-white">Nilai untuk siswa yang dipilih</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer ${mode === 'full' ? 'border-primary bg-primary/5' : 'border-secondary/20'}`}>
                                        <input type="radio" name="batch-mode" checked={mode === 'full'} onChange={() => setMode('full')} disabled={busy} className="mt-0.5" />
                                        <span className="text-xs font-bold text-text-main dark:text-white">Nilai penuh</span>
                                    </label>
                                    <label className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer ${mode === 'cap' ? 'border-primary bg-primary/5' : 'border-secondary/20'}`}>
                                        <input type="radio" name="batch-mode" checked={mode === 'cap'} onChange={() => setMode('cap')} disabled={busy} className="mt-0.5" />
                                        <span className="text-xs font-bold text-text-main dark:text-white">Batasi nilai maksimal</span>
                                    </label>
                                </div>
                                {mode === 'cap' && (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min={SUSULAN_MIN_PERCENT}
                                            max={SUSULAN_MAX_PERCENT}
                                            step={1}
                                            value={percent}
                                            onChange={e => setPercent(e.target.value)}
                                            disabled={busy}
                                            className="w-24 px-3 py-2 bg-white dark:bg-surface-dark border border-secondary/30 rounded-xl text-sm font-bold text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                                        />
                                        <span className="text-xs text-text-secondary">% dari nilai maksimal</span>
                                        {!percentValid && <span className="text-xs text-red-500 font-bold">Masukkan 1–100</span>}
                                    </div>
                                )}
                                <p className="text-[11px] text-text-secondary">
                                    Siswa mengerjakan dengan durasi penuh sejak mulai. Izin berlaku {SUSULAN_VALIDITY_DAYS} hari.
                                </p>
                            </div>

                            {error && (
                                <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-xl p-3 flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}
                        </div>

                        <div className="px-5 py-4 border-t border-secondary/10 flex items-center justify-between gap-3 flex-shrink-0 bg-white dark:bg-surface-dark">
                            <button
                                onClick={() => !busy && onClose()}
                                disabled={busy}
                                className="px-4 py-2.5 rounded-xl text-sm font-bold text-text-secondary hover:bg-secondary/10 disabled:opacity-50"
                            >
                                Batal
                            </button>
                            <button
                                onClick={submit}
                                disabled={!canSubmit}
                                className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-dark text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-primary/20"
                            >
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                                {busy ? 'Memproses...' : `Buka Susulan untuk ${selected.size} Siswa`}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )

    return createPortal(modal, document.body)
}
