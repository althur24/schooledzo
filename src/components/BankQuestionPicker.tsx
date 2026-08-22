'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Card, Button, EmptyState } from '@/components/ui'
import FilterSelect from '@/components/FilterSelect'
import SmartText from '@/components/SmartText'
import { QuestionTypeBadge, DifficultyBadge } from '@/components/QuestionBadges'

export interface BankPickerQuestion {
    id: string
    question_text: string
    question_type: string
    options?: unknown
    correct_answer?: unknown
    difficulty?: string
    tags?: string[] | null
    status?: string
    teacher_hots_claim?: boolean
    passage_id?: string | null
}

export interface BankPickerPassage {
    id: string
    title: string
    passage_text: string
    audio_url?: string | null
    questions: BankPickerQuestion[]
}

interface BankQuestionPickerProps {
    questions: BankPickerQuestion[]
    passages: BankPickerPassage[]
    loading: boolean
    selectedIds: Set<string>
    onSelectedIdsChange: (ids: Set<string>) => void
    onClose: () => void
    /** Dipanggil saat tombol tambah diklik — editor yang menangani POST & mapping */
    onConfirm: () => void
    saving?: boolean
    targetLabel: string
}

const tagBadgeClass = 'inline-flex items-center px-2 py-0.5 text-xs rounded-full font-medium bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/20 whitespace-nowrap'

export function TagBadge({ tag }: { tag: string }) {
    return <span className={tagBadgeClass}>#{tag}</span>
}

/**
 * Picker bank soal terpadu untuk editor kuis/ulangan/UTS-UAS.
 * Fitur: pencarian teks, filter tipe soal & kesulitan, filter multi-tag,
 * pilih-semua (hasil filter), dan dukungan passage (toggle semua anak).
 */
export default function BankQuestionPicker({
    questions,
    passages,
    loading,
    selectedIds,
    onSelectedIdsChange,
    onClose,
    onConfirm,
    saving = false,
    targetLabel
}: BankQuestionPickerProps) {
    const [search, setSearch] = useState('')
    const [typeFilter, setTypeFilter] = useState('')
    const [difficultyFilter, setDifficultyFilter] = useState('')
    const [selectedTags, setSelectedTags] = useState<string[]>([])

    const standalone = useMemo(
        () => questions.filter((q) => q.passage_id == null),
        [questions]
    )

    // Semua tag yang tersedia di bank soal (urut alfabetis)
    const allTags = useMemo(() => {
        const set = new Set<string>()
        questions.forEach((q) => (q.tags || []).forEach((t) => set.add(t)))
        passages.forEach((p) => (p.questions || []).forEach((q) => (q.tags || []).forEach((t) => set.add(t))))
        return Array.from(set).sort((a, b) => a.localeCompare(b))
    }, [questions, passages])

    const hasActiveFilters = Boolean(search.trim() || typeFilter || difficultyFilter || selectedTags.length > 0)

    const matchesFilters = (q: BankPickerQuestion): boolean => {
        const s = search.trim().toLowerCase()
        if (s && !String(q.question_text || '').toLowerCase().includes(s)) return false
        if (typeFilter && q.question_type !== typeFilter) return false
        if (difficultyFilter && (q.difficulty || 'MEDIUM') !== difficultyFilter) return false
        if (selectedTags.length > 0) {
            const qTags = q.tags || []
            if (!selectedTags.some((t) => qTags.includes(t))) return false
        }
        return true
    }

    const filteredStandalone = useMemo(
        () => standalone.filter(matchesFilters),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [standalone, search, typeFilter, difficultyFilter, selectedTags]
    )

    const filteredPassages = useMemo(() => {
        const s = search.trim().toLowerCase()
        return passages
            .map((p) => {
                const passageMatches = Boolean(s) && (
                    String(p.title || '').toLowerCase().includes(s) ||
                    String(p.passage_text || '').toLowerCase().includes(s)
                )
                const matchingChildren = (p.questions || []).filter(matchesFilters)
                // Bacaan tampil bila judul/isi cocok, atau ada anak soal yang cocok.
                // Anak yang ditampilkan: semua bila bacaannya yang cocok, selain itu hanya yang cocok filter.
                const displayedChildren = hasActiveFilters
                    ? (passageMatches ? p.questions : matchingChildren)
                    : p.questions
                return { passage: p, passageMatches, children: displayedChildren, matchingCount: matchingChildren.length }
            })
            .filter(({ passageMatches, children, matchingCount }) =>
                passageMatches || (!hasActiveFilters ? true : matchingCount > 0) || children.length > 0
            )
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [passages, search, typeFilter, difficultyFilter, selectedTags, hasActiveFilters])

    // Semua ID soal yang tampil (untuk "Pilih Semua" hasil filter)
    const visibleIds = useMemo(() => {
        const ids = filteredStandalone.map((q) => q.id)
        filteredPassages.forEach(({ children }) => children.forEach((q) => ids.push(q.id)))
        return ids
    }, [filteredStandalone, filteredPassages])

    const totalQuestions = standalone.length + passages.reduce((n, p) => n + (p.questions?.length || 0), 0)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))

    const toggleQuestion = (id: string, checked: boolean) => {
        const next = new Set(selectedIds)
        if (checked) next.add(id)
        else next.delete(id)
        onSelectedIdsChange(next)
    }

    const toggleAllVisible = () => {
        const next = new Set(selectedIds)
        if (allVisibleSelected) {
            visibleIds.forEach((id) => next.delete(id))
        } else {
            visibleIds.forEach((id) => next.add(id))
        }
        onSelectedIdsChange(next)
    }

    const toggleTag = (tag: string) => {
        setSelectedTags((prev) =>
            prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
        )
    }

    const close = () => {
        setSearch('')
        setTypeFilter('')
        setDifficultyFilter('')
        setSelectedTags([])
        onSelectedIdsChange(new Set())
        onClose()
    }

    return (
        <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-text-main dark:text-white">🗃️ Ambil dari Bank Soal</h2>
                <Button variant="ghost" icon={<>✕</>} onClick={close} />
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin text-3xl text-primary">⏳</div>
                </div>
            ) : totalQuestions === 0 ? (
                <EmptyState
                    icon="🗃️"
                    title="Bank Soal Kosong"
                    description="Belum ada soal tersimpan untuk mata pelajaran ini."
                />
            ) : (
                <>
                    {/* ── Pencarian & Filter ── */}
                    <div className="space-y-3 mb-5">
                        <div className="relative">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Cari soal atau bacaan... (mis. pecahan, deret)"
                                className="w-full pl-10 pr-4 py-2.5 bg-secondary/5 border border-secondary/20 rounded-xl text-sm text-text-main dark:text-white placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <FilterSelect
                                value={typeFilter}
                                onChange={setTypeFilter}
                                placeholder="Semua Tipe Soal"
                                options={[
                                    { value: 'MULTIPLE_CHOICE', label: 'Pilihan Ganda' },
                                    { value: 'MULTIPLE_ANSWER', label: 'PG Kompleks' },
                                    { value: 'TRUE_FALSE', label: 'Benar/Salah' },
                                    { value: 'SHORT_ANSWER', label: 'Isian Singkat' },
                                    { value: 'ESSAY', label: 'Essay' },
                                ]}
                            />
                            <FilterSelect
                                value={difficultyFilter}
                                onChange={setDifficultyFilter}
                                placeholder="Semua Kesulitan"
                                options={[
                                    { value: 'EASY', label: 'Mudah' },
                                    { value: 'MEDIUM', label: 'Sedang' },
                                    { value: 'HARD', label: 'Sulit' },
                                ]}
                            />
                        </div>
                        {allTags.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-bold text-text-secondary mr-1">Tag:</span>
                                {allTags.map((tag) => (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => toggleTag(tag)}
                                        className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                                            selectedTags.includes(tag)
                                                ? 'bg-primary text-white border-primary'
                                                : 'bg-secondary/10 text-text-secondary border-secondary/20 hover:border-primary/40 hover:text-primary'
                                        }`}
                                    >
                                        #{tag}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <p className="text-sm text-text-secondary dark:text-zinc-400 mb-4">
                        {hasActiveFilters ? (
                            <>Menampilkan <span className="font-bold text-primary">{visibleIds.length}</span> dari {totalQuestions} soal — pilih yang ingin ditambahkan ke {targetLabel.toLowerCase()} ini:</>
                        ) : (
                            <>Pilih soal yang ingin ditambahkan ke {targetLabel.toLowerCase()} ini:</>
                        )}
                    </p>

                    {/* ── Bacaan & Listening ── */}
                    {filteredPassages.length > 0 && (
                        <div className="mb-6">
                            <h3 className="text-md font-bold text-text-main dark:text-white mb-3 flex items-center gap-2">
                                📖 Bacaan ({filteredPassages.length})
                            </h3>
                            <div className="space-y-3">
                                {filteredPassages.map(({ passage: p, children }) => {
                                    const childIds = children.map((q) => q.id)
                                    const allChildrenSelected = childIds.length > 0 && childIds.every((id) => selectedIds.has(id))
                                    return (
                                        <div key={p.id} className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-xl overflow-hidden">
                                            <div
                                                className="p-4 cursor-pointer hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-colors"
                                                onClick={() => {
                                                    const next = new Set(selectedIds)
                                                    if (allChildrenSelected) {
                                                        childIds.forEach((id) => next.delete(id))
                                                    } else {
                                                        childIds.forEach((id) => next.add(id))
                                                    }
                                                    onSelectedIdsChange(next)
                                                }}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={allChildrenSelected}
                                                        readOnly
                                                        className="w-5 h-5 rounded bg-teal-100 border-teal-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                                                    />
                                                    <div className="flex-1">
                                                        <h4 className="font-bold text-text-main dark:text-white">{p.title || 'Untitled Passage'}</h4>
                                                        <span className="text-xs text-teal-600 dark:text-teal-400">{childIds.length} soal terkait</span>
                                                    </div>
                                                </div>
                                                <p className="text-sm text-text-secondary dark:text-zinc-400 mt-2 line-clamp-2">{p.passage_text}</p>
                                            </div>
                                            {children.length > 0 && (
                                                <div className="border-t border-teal-200 dark:border-teal-700 px-4 py-2 bg-white/50 dark:bg-black/10 space-y-2">
                                                    {children.map((q, idx) => (
                                                        <label
                                                            key={q.id}
                                                            className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer text-sm ${selectedIds.has(q.id) ? 'bg-teal-100 dark:bg-teal-800/30' : 'hover:bg-teal-50 dark:hover:bg-teal-900/20'}`}
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedIds.has(q.id)}
                                                                onChange={(e) => toggleQuestion(q.id, e.target.checked)}
                                                                className="mt-0.5 w-4 h-4 rounded bg-teal-100 border-teal-300 text-teal-600 focus:ring-teal-500"
                                                            />
                                                            <span className="w-5 h-5 rounded-full bg-teal-500 text-white text-xs flex items-center justify-center font-bold flex-shrink-0">{idx + 1}</span>
                                                            <span className="flex-1 min-w-0">
                                                                <SmartText text={q.question_text} as="span" className="text-text-main dark:text-white" />
                                                                {(q.tags || []).length > 0 && (
                                                                    <span className="flex flex-wrap gap-1 mt-1">
                                                                        {(q.tags || []).map((t) => <TagBadge key={t} tag={t} />)}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </label>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* ── Soal Mandiri ── */}
                    {filteredStandalone.length > 0 && (
                        <div className="mb-4">
                            <h3 className="text-md font-bold text-text-main dark:text-white mb-3">❓ Soal Mandiri ({filteredStandalone.length})</h3>
                            <div className="space-y-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                                {filteredStandalone.map((q) => (
                                    <label
                                        key={q.id}
                                        className={`flex items-start gap-3 p-4 rounded-xl cursor-pointer transition-all border ${selectedIds.has(q.id)
                                            ? 'bg-primary/10 border-primary'
                                            : 'bg-secondary/5 border-transparent hover:bg-secondary/10'
                                            }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(q.id)}
                                            onChange={(e) => toggleQuestion(q.id, e.target.checked)}
                                            className="mt-1 w-5 h-5 rounded bg-secondary/10 border-secondary/30 text-primary focus:ring-primary"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <QuestionTypeBadge type={q.question_type} />
                                                <DifficultyBadge difficulty={q.difficulty || 'MEDIUM'} />
                                                {(q.tags || []).map((t) => <TagBadge key={t} tag={t} />)}
                                            </div>
                                            <SmartText text={q.question_text} className="text-text-main dark:text-white text-sm" />
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Hasil filter kosong */}
                    {hasActiveFilters && visibleIds.length === 0 && (
                        <div className="py-8">
                            <EmptyState
                                icon="🔍"
                                title="Tidak Ada Hasil"
                                description="Coba ubah kata kunci, filter, atau tag yang dipilih."
                            />
                        </div>
                    )}

                    <div className="flex flex-wrap gap-3 pt-4 border-t border-secondary/20 mt-4">
                        <Button
                            variant="secondary"
                            onClick={toggleAllVisible}
                            disabled={visibleIds.length === 0}
                        >
                            {allVisibleSelected ? 'Batalkan Pilihan' : `Pilih Semua (${visibleIds.length})`}
                        </Button>
                        <Button
                            onClick={onConfirm}
                            disabled={saving || selectedIds.size === 0}
                            loading={saving}
                            className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600"
                        >
                            {saving ? 'Menyimpan...' : `Tambahkan ${selectedIds.size} Soal ke ${targetLabel}`}
                        </Button>
                    </div>
                </>
            )}
        </Card>
    )
}
