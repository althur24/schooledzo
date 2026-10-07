'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { Modal, Button } from '@/components/ui'
import { MenuLabels } from '@/lib/labels'
import { round2 } from '@/lib/formatScore'
import { exportToExcel, exportToCsv } from '@/lib/exportGrades'
import { Download } from 'lucide-react'

export interface GradeItem {
    student_id: string
    subject_id: string
    grade_type: string
    score: number
    item_id?: string | null
    item_title?: string | null
}

export interface SubjectGradeSummary {
    subject_id: string
    subject_name: string
    tugas: number | null
    kuis: number | null
    ulangan: number | null
    uts: number | null
    uas: number | null
    rata_rata: number | null
    kkm: number
}

export interface StudentExportData {
    student: {
        id: string
        nis: string | null
        user: { full_name: string | null }
    }
    grades: SubjectGradeSummary[]
    average: number | null
}

interface ExportNilaiModalProps {
    open: boolean
    onClose: () => void
    students: StudentExportData[]
    subjects: { id: string; name: string }[]
    rawGrades: GradeItem[]
    labels: MenuLabels
    className: string
    yearName: string
}

type CategoryKey = 'TUGAS' | 'KUIS' | 'ULANGAN' | 'UTS' | 'UAS'

const CATEGORY_ORDER: CategoryKey[] = ['TUGAS', 'KUIS', 'ULANGAN', 'UTS', 'UAS']

const CATEGORY_LABEL_KEY: Record<CategoryKey, keyof MenuLabels> = {
    TUGAS: 'tugas',
    KUIS: 'kuis',
    ULANGAN: 'ulangan',
    UTS: 'uts',
    UAS: 'uas'
}

const CHECKBOX_CLASS = 'w-5 h-5 rounded border-secondary/30 text-primary focus:ring-primary cursor-pointer'

interface DetailItemEntry {
    itemId: string
    title: string | null
    category: CategoryKey
    subjectId: string
}

function buildDetailItems(
    rawGrades: GradeItem[]
): Map<string, DetailItemEntry[]> {
    const subjectItems = new Map<string, DetailItemEntry[]>()
    const seen = new Set<string>()

    for (const g of rawGrades) {
        const cat = g.grade_type as CategoryKey
        if (!CATEGORY_ORDER.includes(cat)) continue
        const itemId = g.item_id || `${g.subject_id}:${cat}:unknown`
        const key = `${g.subject_id}:${itemId}`
        if (seen.has(key)) continue
        seen.add(key)

        if (!subjectItems.has(g.subject_id)) subjectItems.set(g.subject_id, [])
        subjectItems.get(g.subject_id)!.push({
            itemId,
            title: g.item_title || null,
            category: cat,
            subjectId: g.subject_id
        })
    }

    for (const items of subjectItems.values()) {
        items.sort((a, b) => {
            const ca = CATEGORY_ORDER.indexOf(a.category)
            const cb = CATEGORY_ORDER.indexOf(b.category)
            if (ca !== cb) return ca - cb
            return String(a.title || '').localeCompare(String(b.title || ''))
        })
    }

    return subjectItems
}

function categoryPrefix(labels: MenuLabels, cat: CategoryKey): string {
    return labels[CATEGORY_LABEL_KEY[cat]].charAt(0).toUpperCase()
}

function toggleSetItem<T>(set: Set<T>, item: T): Set<T> {
    const next = new Set(set)
    if (next.has(item)) next.delete(item)
    else next.add(item)
    return next
}

export default function ExportNilaiModal({
    open,
    onClose,
    students,
    subjects,
    rawGrades,
    labels,
    className,
    yearName
}: ExportNilaiModalProps) {
    const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx')
    const [mode, setMode] = useState<'ringkas' | 'detail'>('ringkas')
    const [selectedCategories, setSelectedCategories] = useState<Set<CategoryKey>>(
        new Set(CATEGORY_ORDER)
    )
    const [includeSubjectAvg, setIncludeSubjectAvg] = useState(true)
    const [includeOverallAvg, setIncludeOverallAvg] = useState(true)
    const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(
        new Set(subjects.map(s => s.id))
    )
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
    const [exporting, setExporting] = useState(false)

    useEffect(() => {
        if (open) {
            setSelectedSubjects(new Set(subjects.map(s => s.id)))
            setSelectedItems(new Set())
        }
    }, [open, subjects])

    const detailItems = useMemo(
        () => buildDetailItems(rawGrades),
        [rawGrades]
    )

    const allItemIds = useMemo(() => {
        const ids: string[] = []
        for (const items of detailItems.values()) {
            for (const item of items) ids.push(item.itemId)
        }
        return ids
    }, [detailItems])

    const allItemsSelected = useMemo(
        () => allItemIds.length > 0 && allItemIds.every(id => selectedItems.has(id)),
        [allItemIds, selectedItems]
    )

    const toggleAllItems = useCallback(() => {
        if (allItemsSelected) {
            setSelectedItems(new Set())
        } else {
            setSelectedItems(new Set(allItemIds))
        }
    }, [allItemsSelected, allItemIds])

    const toggleAllCategories = useCallback(() => {
        if (selectedCategories.size === CATEGORY_ORDER.length) {
            setSelectedCategories(new Set())
        } else {
            setSelectedCategories(new Set(CATEGORY_ORDER))
        }
    }, [selectedCategories])

    const toggleAllSubjects = useCallback(() => {
        if (selectedSubjects.size === subjects.length) {
            setSelectedSubjects(new Set())
        } else {
            setSelectedSubjects(new Set(subjects.map(s => s.id)))
        }
    }, [selectedSubjects, subjects])

    const previewColumns = useMemo(() => {
        let count = 3
        const activeSubjects = subjects.filter(s => selectedSubjects.has(s.id))

        if (mode === 'ringkas') {
            count += activeSubjects.length * selectedCategories.size
            if (includeSubjectAvg) count += activeSubjects.length
        } else {
            for (const subj of activeSubjects) {
                const items = detailItems.get(subj.id) || []
                for (const item of items) {
                    if (selectedItems.has(item.itemId)) count += 1
                }
                if (includeSubjectAvg) count += 1
            }
        }
        if (includeOverallAvg) count += 1
        return count
    }, [mode, subjects, selectedSubjects, selectedCategories, includeSubjectAvg, includeOverallAvg, detailItems, selectedItems])

    const canExport = students.length > 0 && previewColumns > 3 && (
        mode === 'ringkas'
            ? selectedCategories.size > 0 || includeSubjectAvg || includeOverallAvg
            : selectedItems.size > 0 || includeSubjectAvg || includeOverallAvg
    )

    const handleExport = useCallback(async () => {
        if (!canExport) return
        setExporting(true)
        try {
            const activeSubjects = subjects.filter(s => selectedSubjects.has(s.id))
            const infoRows: (string | number)[][] = [
                ['REKAP NILAI'],
                [`Kelas: ${className}`],
                [`Tahun Ajaran: ${yearName}`],
                [`Tanggal Export: ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`],
                [`Mode: ${mode === 'ringkas' ? 'Ringkas (Rata-rata per Kategori)' : 'Detail (Per Item)'}`],
                []
            ]

            const headers: (string | number)[] = ['No', 'NIS', 'Nama Siswa']

            if (mode === 'ringkas') {
                for (const subj of activeSubjects) {
                    for (const cat of CATEGORY_ORDER) {
                        if (!selectedCategories.has(cat)) continue
                        headers.push(`${subj.name} (${labels[CATEGORY_LABEL_KEY[cat]]})`)
                    }
                    if (includeSubjectAvg) {
                        headers.push(`${subj.name} (Rata-rata)`)
                    }
                }
            } else {
                for (const subj of activeSubjects) {
                    const items = detailItems.get(subj.id) || []
                    const catCounters: Partial<Record<CategoryKey, number>> = {}
                    for (const item of items) {
                        if (!selectedItems.has(item.itemId)) continue
                        catCounters[item.category] = (catCounters[item.category] || 0) + 1
                        const n = catCounters[item.category]!
                        const label = labels[CATEGORY_LABEL_KEY[item.category]]
                        const titlePart = item.title ? `: ${item.title}` : ''
                        headers.push(`${subj.name} - ${label} ${n}${titlePart}`)
                    }
                    if (includeSubjectAvg) {
                        headers.push(`${subj.name} (Rata-rata)`)
                    }
                }
            }
            if (includeOverallAvg) {
                headers.push('Rata-rata Keseluruhan')
            }

            const rows: (string | number)[][] = students.map((sg, idx) => {
                const row: (string | number)[] = [
                    idx + 1,
                    sg.student.nis || '-',
                    sg.student.user.full_name || '-'
                ]

                if (mode === 'ringkas') {
                    for (const subj of activeSubjects) {
                        const sg2 = sg.grades.find(g => g.subject_id === subj.id)
                        for (const cat of CATEGORY_ORDER) {
                            if (!selectedCategories.has(cat)) continue
                            const val = sg2
                                ? cat === 'TUGAS' ? sg2.tugas
                                  : cat === 'KUIS' ? sg2.kuis
                                  : cat === 'ULANGAN' ? sg2.ulangan
                                  : cat === 'UTS' ? sg2.uts
                                  : sg2.uas
                                : null
                            row.push(val !== null && val !== undefined ? round2(val) : '-')
                        }
                        if (includeSubjectAvg) {
                            row.push(sg2 && sg2.rata_rata !== null ? round2(sg2.rata_rata) : '-')
                        }
                    }
                } else {
                    for (const subj of activeSubjects) {
                        const items = detailItems.get(subj.id) || []
                        for (const item of items) {
                            if (!selectedItems.has(item.itemId)) continue
                            const studentGrade = rawGrades.find(
                                g => g.student_id === sg.student.id &&
                                     g.subject_id === subj.id &&
                                     g.item_id === item.itemId &&
                                     g.grade_type === item.category
                            )
                            row.push(studentGrade ? round2(studentGrade.score) : '-')
                        }
                        if (includeSubjectAvg) {
                            const sg2 = sg.grades.find(g => g.subject_id === subj.id)
                            row.push(sg2 && sg2.rata_rata !== null ? round2(sg2.rata_rata) : '-')
                        }
                    }
                }
                if (includeOverallAvg) {
                    row.push(sg.average !== null ? round2(sg.average) : '-')
                }
                return row
            })

            const columnWidths = [
                { wch: 4 }, { wch: 14 }, { wch: 26 },
                ...Array(Math.max(0, headers.length - 3)).fill({ wch: 14 })
            ]

            const filename = `Rekap_Nilai_${className}_${yearName}`

            if (format === 'xlsx') {
                await exportToExcel({
                    infoRows,
                    headers,
                    rows,
                    sheetName: 'Rekap Nilai',
                    filename,
                    columnWidths
                })
            } else {
                exportToCsv({
                    infoRows,
                    headers,
                    rows,
                    filename
                })
            }
            onClose()
        } catch (error) {
            console.error('Export error:', error)
        } finally {
            setExporting(false)
        }
    }, [
        canExport, students, subjects, selectedSubjects, selectedCategories,
        includeSubjectAvg, includeOverallAvg, mode, detailItems, selectedItems,
        rawGrades, labels, className, yearName, format, onClose
    ])

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Export Nilai"
            subtitle="Pilih data yang ingin diekspor"
            maxWidth="2xl"
        >
            <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Format</label>
                        <div className="flex gap-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="format" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} className={CHECKBOX_CLASS} />
                                <span className="text-sm text-text-main dark:text-white">Excel (.xlsx)</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="format" checked={format === 'csv'} onChange={() => setFormat('csv')} className={CHECKBOX_CLASS} />
                                <span className="text-sm text-text-main dark:text-white">CSV (.csv)</span>
                            </label>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Mode</label>
                        <div className="flex gap-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="mode" checked={mode === 'ringkas'} onChange={() => setMode('ringkas')} className={CHECKBOX_CLASS} />
                                <span className="text-sm text-text-main dark:text-white">Ringkas</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="mode" checked={mode === 'detail'} onChange={() => setMode('detail')} className={CHECKBOX_CLASS} />
                                <span className="text-sm text-text-main dark:text-white">Detail per Item</span>
                            </label>
                        </div>
                    </div>
                </div>

                {mode === 'ringkas' && (
                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-text-main dark:text-white">Kategori Nilai</span>
                            <button onClick={toggleAllCategories} className="text-xs font-semibold text-primary hover:text-primary-dark">
                                {selectedCategories.size === CATEGORY_ORDER.length ? 'Kosongkan' : 'Pilih Semua'}
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-4">
                            {CATEGORY_ORDER.map(cat => (
                                <label key={cat} className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selectedCategories.has(cat)}
                                        onChange={() => setSelectedCategories(prev => toggleSetItem(prev, cat))}
                                        className={CHECKBOX_CLASS}
                                    />
                                    <span className="text-sm text-text-main dark:text-white">{labels[CATEGORY_LABEL_KEY[cat]]}</span>
                                </label>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-4 pt-2 border-t border-slate-200 dark:border-slate-700">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={includeSubjectAvg} onChange={e => setIncludeSubjectAvg(e.target.checked)} className={CHECKBOX_CLASS} />
                                <span className="text-sm text-text-main dark:text-white">Rata-rata per Mapel</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={includeOverallAvg} onChange={e => setIncludeOverallAvg(e.target.checked)} className={CHECKBOX_CLASS} />
                                <span className="text-sm text-text-main dark:text-white">Rata-rata Keseluruhan</span>
                            </label>
                        </div>
                    </div>
                )}

                {mode === 'detail' && (
                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-text-main dark:text-white">Item Nilai per Mapel</span>
                            <button onClick={toggleAllItems} className="text-xs font-semibold text-primary hover:text-primary-dark">
                                {allItemsSelected ? 'Kosongkan' : 'Pilih Semua'}
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-4 pt-2 border-t border-slate-200 dark:border-slate-700">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={includeSubjectAvg} onChange={e => setIncludeSubjectAvg(e.target.checked)} className={CHECKBOX_CLASS} />
                                <span className="text-sm text-text-main dark:text-white">Rata-rata per Mapel</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={includeOverallAvg} onChange={e => setIncludeOverallAvg(e.target.checked)} className={CHECKBOX_CLASS} />
                                <span className="text-sm text-text-main dark:text-white">Rata-rata Keseluruhan</span>
                            </label>
                        </div>
                        {allItemIds.length === 0 ? (
                            <p className="text-sm text-text-secondary dark:text-zinc-400 italic">Belum ada item nilai untuk kelas ini.</p>
                        ) : (
                            <div className="max-h-64 overflow-y-auto space-y-4 pt-2">
                                {subjects.filter(s => selectedSubjects.has(s.id)).map(subj => {
                                    const items = detailItems.get(subj.id) || []
                                    if (items.length === 0) return null
                                    return (
                                        <div key={subj.id}>
                                            <p className="text-xs font-bold text-text-secondary dark:text-zinc-400 mb-2">{subj.name}</p>
                                            <div className="space-y-1.5">
                                                {CATEGORY_ORDER.map(cat => {
                                                    const catItems = items.filter(i => i.category === cat)
                                                    if (catItems.length === 0) return null
                                                    return (
                                                        <div key={cat}>
                                                            <p className="text-xs text-text-secondary dark:text-zinc-500 mb-1">{labels[CATEGORY_LABEL_KEY[cat]]}</p>
                                                            <div className="flex flex-wrap gap-3 ml-4">
                                                                {catItems.map((item, i) => (
                                                                    <label key={`${item.itemId}_${i}`} className="flex items-center gap-1.5 cursor-pointer">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={selectedItems.has(item.itemId)}
                                                                            onChange={() => setSelectedItems(prev => toggleSetItem(prev, item.itemId))}
                                                                            className={CHECKBOX_CLASS}
                                                                        />
                                                                        <span className="text-xs text-text-main dark:text-white">
                                                                            {categoryPrefix(labels, cat)}{i + 1}{item.title ? ` - ${item.title}` : ''}
                                                                        </span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )}

                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-text-main dark:text-white">Mata Pelajaran</span>
                        <button onClick={toggleAllSubjects} className="text-xs font-semibold text-primary hover:text-primary-dark">
                            {selectedSubjects.size === subjects.length ? 'Kosongkan' : 'Pilih Semua'}
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-3 max-h-32 overflow-y-auto">
                        {subjects.map(s => (
                            <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={selectedSubjects.has(s.id)}
                                    onChange={() => setSelectedSubjects(prev => toggleSetItem(prev, s.id))}
                                    className={CHECKBOX_CLASS}
                                />
                                <span className="text-sm text-text-main dark:text-white">{s.name}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4">
                    <div>
                        <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Preview</p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-500">
                            {students.length} siswa &times; {previewColumns - 3} kolom nilai = {students.length * (previewColumns - 3)} sel
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="ghost" size="md" onClick={onClose}>Batal</Button>
                        <Button
                            variant="primary"
                            size="md"
                            onClick={handleExport}
                            disabled={!canExport || exporting}
                            loading={exporting}
                            icon={!exporting ? <Download size={18} /> : undefined}
                        >
                            {exporting ? 'Mengekspor...' : 'Download'}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    )
}
