'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import { useAuth } from '@/contexts/AuthContext'
import { useSchoolLabels } from '@/contexts/LabelsContext'

/**
 * Halaman Rescue Draft Ulangan/UTS-UAS.
 *
 * Kasus: siswa mengerjakan dengan koneksi tidak stabil → autosave gagal semua
 * → submission dipaksa tutup server (pelanggaran / waktu habis) saat draft
 * hanya ada di localStorage perangkat → nilai 0 padahal siswa mengerjakan.
 *
 * Halaman ini membaca draft dari localStorage perangkat INI (bukan akun),
 * menampilkannya untuk dikonfirmasi, lalu mengirimkannya ke
 * POST /api/exam-submissions/rescue — server memvalidasi kepemilikan,
 * menilai dengan kunci resmi, tidak menimpa jawaban yang sudah ada, dan
 * mencatat perubahan nilai di grade_history.
 *
 * PENTING: draft hanya ada di browser tempat ujian dikerjakan. Membuka
 * halaman ini di perangkat lain TIDAK akan menemukan draft.
 */

const EXAM_TYPES = [
    {
        prefix: 'exam',
        kind: 'exam' as const,
        submissionApi: '/api/exam-submissions',
        listRoute: '/dashboard/siswa/ulangan',
        label: 'Ulangan',
    },
    {
        prefix: 'official_exam',
        kind: 'official' as const,
        submissionApi: '/api/official-exam-submissions',
        listRoute: '/dashboard/siswa/ulangan',
        label: 'UTS/UAS',
    },
] as const

interface DraftEntry {
    key: string
    prefix: string
    kind: 'exam' | 'official'
    examId: string
    label: string
    listRoute: string
    submissionApi: string
    answers: Record<string, string>
    synced: Record<string, string>
    lastSaved: string | null
}

interface SubmissionInfo {
    id: string
    is_submitted: boolean
    total_score: number | null
    max_score: number | null
}

export default function RescueDraftPage() {
    const { user } = useAuth()
    const labels = useSchoolLabels()

    const [scanning, setScanning] = useState(true)
    const [drafts, setDrafts] = useState<DraftEntry[]>([])
    const [statusByExam, setStatusByExam] = useState<Record<string, SubmissionInfo | 'no_submission' | 'fetch_error'>>({})
    const [sendingKey, setSendingKey] = useState<string | null>(null)
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

    /** Kumpulkan draft ulangan/UTS-UAS dari localStorage perangkat ini. */
    const scanDrafts = useCallback(() => {
        const found: DraftEntry[] = []
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (!key) continue
                for (const t of EXAM_TYPES) {
                    const marker = `${t.prefix}_answers`
                    if (!key.startsWith(`${t.prefix}_`) || !key.endsWith(marker)) continue
                    const examId = key.slice(t.prefix.length + 1, key.length - marker.length)
                    if (!examId || examId.includes('_')) continue
                    try {
                        const parsed = JSON.parse(localStorage.getItem(key) || '{}')
                        const answers = parsed?.answers || {}
                        if (examId && Object.keys(answers).length > 0) {
                            found.push({
                                key,
                                prefix: t.prefix,
                                kind: t.kind,
                                examId,
                                label: t.label,
                                listRoute: t.listRoute,
                                submissionApi: t.submissionApi,
                                answers,
                                synced: parsed?.synced || {},
                                lastSaved: parsed?.lastSaved || null,
                            })
                        }
                    } catch { /* draft korup — skip */ }
                }
            }
        } catch { /* localStorage tidak tersedia (private mode) */ }
        setDrafts(found)
    }, [])

    /** Cek status submission tiap draft di server (sudah terkumpul? nilai?). */
    const checkStatuses = useCallback(async (entries: DraftEntry[]) => {
        for (const d of entries) {
            try {
                const res = await fetch(`${d.submissionApi}?exam_id=${d.examId}`)
                if (!res.ok) { setStatusByExam(p => ({ ...p, [d.examId]: 'fetch_error' })); continue }
                const data = await res.json()
                const mine = Array.isArray(data) ? data : []
                const sub = mine[0] || null
                setStatusByExam(p => ({
                    ...p,
                    [d.examId]: sub
                        ? { id: sub.id, is_submitted: !!sub.is_submitted, total_score: sub.total_score, max_score: sub.max_score }
                        : 'no_submission'
                }))
            } catch {
                setStatusByExam(p => ({ ...p, [d.examId]: 'fetch_error' }))
            }
        }
    }, [])

    useEffect(() => {
        if (!user) return
        scanDrafts()
    }, [user, scanDrafts])

    useEffect(() => {
        if (drafts.length > 0) checkStatuses(drafts)
        setScanning(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drafts.length])

    const sendRescue = async (d: DraftEntry, submissionId: string) => {
        setSendingKey(d.key)
        setResult(null)
        try {
            const res = await fetch('/api/exam-submissions/rescue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    submission_id: submissionId,
                    kind: d.kind,
                    // String kosong = soal dikosongkan siswa — bukan jawaban,
                    // jangan kirim (anti baris junk; paritas draft runner yang
                    // hanya menyimpan soal yang pernah diisi).
                    answers: Object.entries(d.answers)
                        .filter(([, answer]) => answer !== '' && answer !== null && answer !== undefined)
                        .map(([question_id, answer]) => ({ question_id, answer: String(answer) }))
                })
            })
            const data = await res.json().catch(() => null)
            if (res.ok) {
                setResult({
                    ok: true,
                    text: data?.message || `Berhasil: ${data?.rescued ?? 0} jawaban terselamatkan.`
                })
                checkStatuses([d])
            } else {
                setResult({ ok: false, text: data?.error || 'Gagal mengirim draft. Coba lagi.' })
            }
        } catch {
            setResult({ ok: false, text: 'Koneksi terputus. Pastikan internet aktif lalu coba lagi.' })
        } finally {
            setSendingKey(null)
        }
    }

    const fmtTime = (iso: string | null) => {
        if (!iso) return null
        const t = new Date(iso)
        if (Number.isNaN(t.getTime())) return null
        return t.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    }

    const unsyncedCount = (d: DraftEntry) =>
        Object.keys(d.answers).filter(qid => d.synced[qid] !== d.answers[qid]).length

    if (!user) {
        return (
            <div className="space-y-6">
                <PageHeader title="Selamatkan Draft Jawaban" backHref="/dashboard/siswa" />
                <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-6 text-center text-text-secondary">
                    Memuat data pengguna…
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Selamatkan Draft Jawaban"
                subtitle="Kirim jawaban yang tersimpan di perangkat ini ke server"
                backHref="/dashboard/siswa/ulangan"
            />

            <div className="bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30 rounded-xl p-4">
                <h3 className="font-bold text-amber-700 dark:text-amber-400">Perhatian</h3>
                <ul className="text-sm text-amber-600/90 dark:text-amber-200/80 list-disc ml-5 mt-1 space-y-1">
                    <li>Halaman ini <strong>harus dibuka di perangkat yang sama</strong> saat kamu mengerjakan ujian — draft tersimpan di memori browser perangkat, bukan di akun.</li>
                    <li><strong>Jangan hapus</strong> data/cache browser sebelum draft berhasil dikirim.</li>
                    <li>Jawaban yang sudah ada di server tidak akan ditimpa — hanya jawaban yang belum terkirim yang dikirim sekarang.</li>
                </ul>
            </div>

            {result && (
                <div className={`rounded-xl p-4 border font-bold ${result.ok
                    ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-500/10 dark:border-green-500/30 dark:text-green-400'
                    : 'bg-red-50 border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400'}`}>
                    {result.text}
                </div>
            )}

            {scanning ? (
                <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-6 text-center text-text-secondary">
                    Memeriksa draft di perangkat ini…
                </div>
            ) : drafts.length === 0 ? (
                <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-xl p-6 text-center space-y-2">
                    <p className="font-bold text-text-main dark:text-white">Tidak ada draft jawaban di perangkat ini</p>
                    <p className="text-sm text-text-secondary">
                        Kemungkinan: draft sudah pernah terkirim, perangkat/browser berbeda, atau data browser pernah dihapus.
                        Silakan hubungi gurumu untuk aturan susulan.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {drafts.map(d => {
                        const status = statusByExam[d.examId]
                        const total = Object.keys(d.answers).length
                        const unsynced = unsyncedCount(d)
                        return (
                            <div key={d.key} className="bg-white dark:bg-surface-dark border-2 border-amber-300 dark:border-amber-500/40 rounded-xl p-4 md:p-5 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="font-bold text-text-main dark:text-white">{d.label}</p>
                                        <p className="text-xs text-text-secondary font-mono break-all">{d.examId}</p>
                                        {d.lastSaved && (
                                            <p className="text-xs text-text-secondary mt-1">
                                                Terakhir disimpan di perangkat: {fmtTime(d.lastSaved)}
                                            </p>
                                        )}
                                    </div>
                                    <span className="text-xs px-2 py-1 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 whitespace-nowrap">
                                        {total} jawaban
                                    </span>
                                </div>

                                <div className="text-sm text-text-secondary">
                                    {unsynced > 0 ? (
                                        <p><strong className="text-red-600 dark:text-red-400">{unsynced} jawaban belum pernah terkirim</strong> ke server (kamu mengerjakan saat koneksi terputus).</p>
                                    ) : (
                                        <p>Semua jawaban di draft tampaknya pernah tersinkron — tetap bisa dikirim ulang bila server tidak menerimanya.</p>
                                    )}
                                </div>

                                {/* Status submission di server */}
                                {status === undefined ? (
                                    <p className="text-xs text-text-secondary">Memeriksa status ujian di server…</p>
                                ) : status === 'fetch_error' ? (
                                    <p className="text-xs text-red-500">Gagal memeriksa status — periksa koneksi lalu buka halaman ini lagi.</p>
                                ) : status === 'no_submission' ? (
                                    <p className="text-xs text-text-secondary">Belum ada sesi ujian tercatat di server untuk ujian ini.</p>
                                ) : status.is_submitted ? (
                                    <p className="text-xs text-text-secondary">
                                        Ujian sudah terkumpul di server · nilai saat ini:{' '}
                                        <strong className="text-text-main dark:text-white">
                                            {status.total_score === null || status.max_score === null
                                                ? 'disembunyikan sementara'
                                                : `${status.total_score}/${status.max_score}`}
                                        </strong>
                                    </p>
                                ) : (
                                    <p className="text-xs text-text-secondary">Ujian <strong>belum terkumpul</strong> — buka ujiannya untuk melanjutkan pengerjaan biasa, bukan lewat halaman ini.</p>
                                )}

                                <div className="flex flex-wrap items-center gap-3">
                                    {status && status !== 'fetch_error' && status !== 'no_submission' && status.is_submitted ? (
                                        <button
                                            onClick={() => sendRescue(d, status.id)}
                                            disabled={sendingKey !== null}
                                            className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl font-bold transition-colors"
                                        >
                                            {sendingKey === d.key ? 'Mengirim…' : 'Kirim Jawaban Saya'}
                                        </button>
                                    ) : (
                                        <span className="text-xs text-text-secondary">Tidak ada yang bisa dikirim untuk ujian ini.</span>
                                    )}
                                    <Link href={d.listRoute} className="text-sm text-primary hover:underline">
                                        Kembali ke daftar {labels.ulangan}
                                    </Link>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
