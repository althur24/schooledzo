'use client'

import { useState } from 'react'
import { Card } from '@/components/ui'
import { InfoCircle, ChevronDown } from 'react-iconly'

export interface NotSubmittedStudent {
    id: string
    name: string
    nis: string
    className?: string
}

interface NotSubmittedPanelProps {
    students: NotSubmittedStudent[]
    /** Group daftar per kelas (untuk ujian multi-kelas) */
    groupByClass?: boolean
}

/**
 * Panel merah collapsible "N Siswa Belum Mengerjakan".
 * Dipakai bersama di halaman hasil kuis, ulangan, dan UTS/UAS
 * (guru & admin) supaya bentuknya konsisten di semua jenis penilaian.
 */
export default function NotSubmittedPanel({ students, groupByClass = false }: NotSubmittedPanelProps) {
    const [show, setShow] = useState(false)

    if (students.length === 0) return null

    const groups = new Map<string, NotSubmittedStudent[]>()
    if (groupByClass) {
        for (const s of students) {
            const key = s.className || 'Tanpa Kelas'
            if (!groups.has(key)) groups.set(key, [])
            groups.get(key)!.push(s)
        }
    } else {
        groups.set('', students)
    }

    return (
        <Card className="bg-red-500/10 border-red-500/30">
            <button
                onClick={() => setShow(!show)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-red-500/20 transition-colors rounded-lg"
            >
                <div className="flex items-center gap-3">
                    <span className="text-red-400"><InfoCircle set="bold" primaryColor="currentColor" size={20} /></span>
                    <span className="text-red-400 font-medium">{students.length} Siswa Belum Mengerjakan</span>
                </div>
                <div className={`text-red-400 transition-transform ${show ? 'rotate-180' : ''}`}>
                    <ChevronDown set="bold" primaryColor="currentColor" size={20} />
                </div>
            </button>
            {show && (
                <div className="px-4 pb-4 space-y-4 mt-2">
                    {[...groups.entries()].map(([className, list]) => (
                        <div key={className}>
                            {groupByClass && (
                                <p className="text-xs font-bold text-red-400/80 uppercase tracking-wide mb-2">
                                    {className} — {list.length} siswa
                                </p>
                            )}
                            <div className="space-y-2">
                                {list.map(student => (
                                    <div key={student.id} className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-surface-dark rounded-lg shadow-sm">
                                        <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-500/20 text-red-500 dark:text-red-400 flex items-center justify-center text-xs font-bold">
                                            {student.name.charAt(0)}
                                        </div>
                                        <div>
                                            <p className="text-text-main dark:text-white text-sm font-medium">{student.name}</p>
                                            <p className="text-xs text-text-secondary dark:text-zinc-500">{student.nis}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    )
}
