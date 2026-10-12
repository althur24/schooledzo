'use client'

import { useEffect, useState } from 'react'

interface DraftFound {
    key: string
    kind: 'exam' | 'official' | 'quiz'
    examId: string
    label: string
    examTitle: string
    answerCount: number
    rescueLink: string
}

const SCAN_PREFIXES = [
    { prefix: 'exam', kind: 'exam' as const, submissionApi: '/api/exam-submissions', label: 'Ulangan', idParam: 'exam_id' },
    { prefix: 'official_exam', kind: 'official' as const, submissionApi: '/api/official-exam-submissions', label: 'UTS/UAS', idParam: 'exam_id' },
    { prefix: 'quiz', kind: 'quiz' as const, submissionApi: '/api/quiz-submissions', label: 'Kuis', idParam: 'quiz_id' },
]

/**
 * Scan localStorage untuk draft jawaban yang belum terkirim.
 * Untuk tiap draft: cek apakah submission sudah submitted di server.
 * Jika ya (sweep sudah tutup): tampilkan banner ajakan rescue.
 */
export default function ProactiveRescueBanner() {
    const [drafts, setDrafts] = useState<DraftFound[]>([])

    useEffect(() => {
        const found: DraftFound[] = []
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (!key || !key.endsWith('_answers')) continue
                for (const t of SCAN_PREFIXES) {
                    const prefixWithDash = `${t.prefix}_`
                    if (!key.startsWith(prefixWithDash)) continue
                    const examId = key.slice(prefixWithDash.length, key.length - '_answers'.length)
                    if (!examId || examId.includes('_')) continue
                    try {
                        const parsed = JSON.parse(localStorage.getItem(key) || '{}')
                        const answers = parsed?.answers || {}
                        const synced = parsed?.synced || {}
                        // Hanya draft yang punya jawaban belum tersinkron
                        const hasUnsynced = Object.keys(answers).some(
                            qid => synced[qid] !== answers[qid]
                        )
                        if (hasUnsynced) {
                            found.push({
                                key, kind: t.kind, examId,
                                label: t.label,
                                examTitle: t.label,
                                answerCount: Object.keys(answers).length,
                                rescueLink: t.kind === 'quiz'
                                    ? `/dashboard/siswa/kuis/${examId}`
                                    : '/dashboard/siswa/ulangan/rescue',
                            })
                        }
                    } catch { /* draft korup — skip */ }
                }
            }
        } catch { /* localStorage tidak tersedia */ }

        // Cek tiap draft: sudah submitted di server?
        Promise.all(found.map(async d => {
            try {
                const t = SCAN_PREFIXES.find(s => s.kind === d.kind)!
                const res = await fetch(`${t.submissionApi}?${t.idParam}=${encodeURIComponent(d.examId)}`)
                if (!res.ok) return null
                const data = await res.json()
                const subs = Array.isArray(data) ? data : []
                const sub = subs[0]
                // exam/official: is_submitted (boolean); quiz: submitted_at (non-null = submitted)
                if (sub && (sub.is_submitted || sub.submitted_at)) {
                    return { ...d, examTitle: sub.exam?.title || sub.quiz?.title || d.label }
                }
                return null
            } catch { return null }
        })).then(results => {
            setDrafts(results.filter(Boolean) as DraftFound[])
        })
    }, [])

    if (drafts.length === 0) return null

    return (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-4">
            <div className="flex items-start gap-3">
                <div className="text-amber-500 mt-0.5">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                </div>
                <div className="flex-1">
                    <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
                        Anda memiliki jawaban yang belum terkirim
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        {drafts.length} {drafts.length === 1 ? 'ujian' : 'ujian'} berikut memiliki jawaban tersimpan di perangkat ini yang belum sampai ke server:
                    </p>
                    <ul className="mt-2 space-y-1">
                        {drafts.map(d => (
                            <li key={d.key}>
                                <a href={d.rescueLink} className="text-xs text-amber-700 dark:text-amber-300 hover:underline font-medium">
                                    • {d.examTitle} ({d.answerCount} jawaban) → Kirim
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    )
}
