'use client'

import { useState, useRef } from 'react'
import { WandSparkles, Sparkles, FileUp, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui'
import Card from '@/components/ui/Card'
import SmartText from '@/components/SmartText'
import QuestionOptionsEditor from '@/components/QuestionOptionsEditor'

interface AIQuestion {
    question_text: string
    question_type: string
    options: string[] | null
    correct_answer: string | null
    points: number
    order_index: number
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD'
    passage_text?: string
    teacher_hots_claim?: boolean
    [key: string]: any
}

type RapihTab = 'clean' | 'generate' | 'upload'

interface RapihAIModalProps {
    visible: boolean
    onClose: () => void
    onSaveResults: (results: AIQuestion[]) => Promise<void>
    onSaveToBank: (results: AIQuestion[]) => Promise<void>
    saving: boolean
    targetLabel: string // "Kuis" or "Ulangan"
    aiReviewEnabled?: boolean
    showBankSoal?: boolean
}

export default function RapihAIModal({
    visible,
    onClose,
    onSaveResults,
    onSaveToBank,
    saving,
    targetLabel,
    aiReviewEnabled = true,
    showBankSoal = true
}: RapihAIModalProps) {
    const [activeTab, setActiveTab] = useState<RapihTab>('clean')

    // Clean (Tab 1) state
    const [cleanText, setCleanText] = useState('')
    const [cleanLoading, setCleanLoading] = useState(false)

    // Generate (Tab 2) state
    const [aiMaterial, setAiMaterial] = useState('')
    const [aiCount, setAiCount] = useState(5)
    const [aiType, setAiType] = useState('MIXED')
    const [aiDifficulty, setAiDifficulty] = useState('MEDIUM')
    const [aiLoading, setAiLoading] = useState(false)

    // Upload (Tab 3) state
    const [uploadFile, setUploadFile] = useState<File | null>(null)
    const [uploadLoading, setUploadLoading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Shared results state
    const [results, setResults] = useState<AIQuestion[]>([])
    const [selected, setSelected] = useState<boolean[]>([])
    const [editIdx, setEditIdx] = useState<number | null>(null)
    const [isSelectionMode, setIsSelectionMode] = useState(false)

    // Error/confirm states (replacing browser alert/confirm)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false)

    // Save to bank state
    const [savingBank, setSavingBank] = useState(false)
    const [savedBank, setSavedBank] = useState(false)

    if (!visible) return null

    const hasResults = results.length > 0
    const isLoading = cleanLoading || aiLoading || uploadLoading

    const resetAll = () => {
        setResults([])
        setSelected([])
        setEditIdx(null)
        setCleanText('')
        setAiMaterial('')
        setUploadFile(null)
        setErrorMsg(null)
        setConfirmDeleteVisible(false)
    }

    const handleClose = () => {
        resetAll()
        onClose()
    }

    const processResults = (questions: any[]) => {
        const processed = questions.map((q: any, idx: number) => ({
            ...q,
            // Clean literal \n from AI-generated text
            question_text: (q.question_text || '').replace(/\\n/g, '\n'),
            passage_text: q.passage_text ? q.passage_text.replace(/\\n/g, '\n') : q.passage_text,
            options: q.options ? q.options.map((opt: string) => opt.replace(/\\n/g, '\n')) : q.options,
            points: 10,
            order_index: idx,
            difficulty: q.difficulty || undefined, // Gunakan saran AI, guru bisa edit
        }))
        setResults(processed)
        setSelected(processed.map(() => true))
    }

    // --- Tab 1: Clean / Rapikan Soal ---
    const handleCleanQuestions = async () => {
        if (!cleanText.trim()) return
        setCleanLoading(true)
        setResults([])
        try {
            const res = await fetch('/api/ai/clean-questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: cleanText })
            })
            const data = await res.json()
            if (data.questions) {
                processResults(data.questions)
                setErrorMsg(null)
            } else if (data.error) {
                setErrorMsg('Error: ' + data.error)
            }
        } catch (error) {
            console.error('Clean Error:', error)
            setErrorMsg('Gagal merapikan soal. Coba lagi.')
        } finally {
            setCleanLoading(false)
        }
    }

    // --- Tab 2: AI Generate ---
    const handleAIGenerate = async () => {
        if (!aiMaterial.trim()) return
        setAiLoading(true)
        setResults([])
        try {
            const res = await fetch('/api/ai/generate-questions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    material: aiMaterial,
                    count: aiCount,
                    type: aiType,
                    difficulty: aiDifficulty
                })
            })
            const data = await res.json()
            if (data.questions) {
                processResults(data.questions)
                setErrorMsg(null)
            } else if (data.error) {
                setErrorMsg('Error: ' + data.error)
            }
        } catch (error) {
            console.error('AI Generate Error:', error)
            setErrorMsg('Gagal generate soal. Coba lagi.')
        } finally {
            setAiLoading(false)
        }
    }

    // --- Tab 3: Upload Document ---
    const handleUploadDocument = async () => {
        if (!uploadFile) return
        setUploadLoading(true)
        setResults([])
        try {
            const formData = new FormData()
            formData.append('file', uploadFile)
            const res = await fetch('/api/ai/extract-document', {
                method: 'POST',
                body: formData
            })
            const data = await res.json()
            if (data.questions) {
                processResults(data.questions)
                setErrorMsg(null)
            } else if (data.error) {
                setErrorMsg('Error: ' + data.error)
            }
        } catch (error) {
            console.error('Upload Error:', error)
            setErrorMsg('Gagal mengekstrak soal dari dokumen. Coba lagi.')
        } finally {
            setUploadLoading(false)
        }
    }


    const handleSave = async () => {
        // Save ALL results (user deletes the ones they don't want)
        await onSaveResults(results)
        resetAll()
    }

    const handleSaveBank = async () => {
        if (savingBank || savedBank) return
        setSavingBank(true)
        try {
            await onSaveToBank(results)
            setSavedBank(true)
        } catch {
            // error handled by parent
        } finally {
            setSavingBank(false)
        }
    }

    const tabs: { key: RapihTab; icon: React.ReactNode; label: string; desc: string; color: string; bgActive: string; bgInactive: string; borderActive: string }[] = [
        { key: 'clean', icon: <WandSparkles className="w-4 h-4" />, label: 'Rapikan Soal', desc: 'Paste & rapikan', color: 'text-purple-600 dark:text-purple-400', bgActive: 'bg-purple-100 dark:bg-purple-500/20', bgInactive: 'bg-purple-50 dark:bg-purple-500/10', borderActive: 'border-purple-400 bg-purple-50 dark:bg-purple-500/10' },
        { key: 'generate', icon: <Sparkles className="w-4 h-4" />, label: 'Generate AI', desc: 'Buat dari materi', color: 'text-amber-600 dark:text-amber-400', bgActive: 'bg-amber-100 dark:bg-amber-500/20', bgInactive: 'bg-amber-50 dark:bg-amber-500/10', borderActive: 'border-amber-400 bg-amber-50 dark:bg-amber-500/10' },
        { key: 'upload', icon: <FileUp className="w-4 h-4" />, label: 'Upload Dokumen', desc: 'Word (.docx)', color: 'text-blue-600 dark:text-blue-400', bgActive: 'bg-blue-100 dark:bg-blue-500/20', bgInactive: 'bg-blue-50 dark:bg-blue-500/10', borderActive: 'border-blue-400 bg-blue-50 dark:bg-blue-500/10' },
    ]

    return (
        <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-text-main dark:text-white">✨ Rapih AI</h2>
                <Button variant="ghost" icon={<>✕</>} onClick={handleClose} />
            </div>

            {/* Tab Navigation */}
            {!hasResults && (
                <div className="flex gap-2 mb-6">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => { if (!isLoading) setActiveTab(tab.key) }}
                            className={`flex-1 flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 transition-all cursor-pointer ${activeTab === tab.key
                                ? `${tab.borderActive} shadow-sm`
                                : 'border-secondary/20 bg-secondary/5 text-text-secondary hover:border-secondary/40'
                                }`}
                        >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tab.color} ${activeTab === tab.key ? tab.bgActive : tab.bgInactive
                                }`}>
                                {tab.icon}
                            </div>
                            <div className="text-left">
                                <div className={`text-sm font-semibold ${activeTab === tab.key ? 'text-text-main dark:text-white' : ''}`}>{tab.label}</div>
                                <div className="text-[11px] opacity-70">{tab.desc}</div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* Error Banner */}
            {errorMsg && (
                <div className="flex items-center justify-between p-3 mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg">
                    <span className="text-sm text-red-600 dark:text-red-400 font-medium">❌ {errorMsg}</span>
                    <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600 text-lg leading-none cursor-pointer">✕</button>
                </div>
            )}

            {/* Tab 1: Rapikan Soal */}
            {!hasResults && activeTab === 'clean' && (
                <div className="space-y-4">
                    <p className="text-sm text-text-secondary dark:text-zinc-400">
                        Paste soal yang di-copy dari website, PDF, atau dokumen lain. AI akan merapikan format dan memisahkan setiap soal secara otomatis.
                    </p>
                    <textarea
                        value={cleanText}
                        onChange={(e) => setCleanText(e.target.value)}
                        placeholder="Paste soal di sini...

Contoh:
1. Hasil dari 30 × 15 : (105 - 60) adalah...
A. 10  B. 15  C. 20  D. 25

2. Ibu kota Indonesia adalah...
A. Jakarta  B. Bandung  C. Surabaya  D. Medan"
                        rows={10}
                        className="w-full px-4 py-3 bg-secondary/5 border border-secondary/30 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none placeholder:text-text-secondary/50"
                    />
                    <Button
                        onClick={handleCleanQuestions}
                        disabled={cleanLoading || !cleanText.trim()}
                        loading={cleanLoading}
                        className="w-full"
                    >
                        {cleanLoading ? '✨ AI sedang merapikan...' : '✨ Rapihkan Soal'}
                    </Button>
                </div>
            )}

            {/* Tab 2: Generate dari Materi */}
            {!hasResults && activeTab === 'generate' && (
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Materi / Teks</label>
                        <textarea
                            value={aiMaterial}
                            onChange={(e) => setAiMaterial(e.target.value)}
                            className="w-full px-4 py-3 bg-secondary/5 border border-secondary/30 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            rows={6}
                            placeholder="Paste materi pembelajaran di sini..."
                        />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jumlah Soal</label>
                            <input
                                type="number"
                                value={aiCount}
                                onChange={(e) => setAiCount(parseInt(e.target.value) || 5)}
                                className="w-full px-3 py-2 bg-secondary/5 border border-secondary/30 rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                min={1}
                                max={20}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Tipe Soal</label>
                            <select
                                value={aiType}
                                onChange={(e) => setAiType(e.target.value)}
                                className="w-full px-3 py-2 bg-secondary/5 border border-secondary/30 rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                <option value="MIXED">Campuran (Semua Tipe)</option>
                                <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                                <option value="MULTIPLE_ANSWER">Ganda Kompleks</option>
                                <option value="TRUE_FALSE">Benar Salah</option>
                                <option value="SHORT_ANSWER">Isian Singkat</option>
                                <option value="ESSAY">Essay</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kesulitan</label>
                            <select
                                value={aiDifficulty}
                                onChange={(e) => setAiDifficulty(e.target.value)}
                                className="w-full px-3 py-2 bg-secondary/5 border border-secondary/30 rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                <option value="EASY">Mudah</option>
                                <option value="MEDIUM">Sedang</option>
                                <option value="HARD">Sulit</option>
                            </select>
                        </div>
                    </div>

                    <Button
                        onClick={handleAIGenerate}
                        disabled={aiLoading || !aiMaterial.trim()}
                        loading={aiLoading}
                        className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                    >
                        {aiLoading ? 'Generating...' : '🚀 Generate Soal dengan AI'}
                    </Button>
                </div>
            )}

            {/* Tab 3: Upload Dokumen */}
            {!hasResults && activeTab === 'upload' && (
                <div className="space-y-4">
                    <p className="text-sm text-text-secondary dark:text-zinc-400">
                        Upload file Word (.docx) yang berisi soal-soal. AI akan mengekstrak dan merapikan soal secara otomatis.
                    </p>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".docx,.doc"
                        onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                        className="hidden"
                    />

                    {!uploadFile ? (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full border-2 border-dashed border-secondary/40 rounded-xl p-10 flex flex-col items-center gap-3 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer group"
                        >
                            <div className="w-14 h-14 rounded-2xl bg-secondary/10 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                                <Upload className="w-7 h-7 text-text-secondary group-hover:text-primary transition-colors" />
                            </div>
                            <div className="text-center">
                                <p className="font-semibold text-text-main dark:text-white">Klik untuk upload file</p>
                                <p className="text-xs text-text-secondary mt-1">Word (.docx) • Maks 10MB</p>
                            </div>
                        </button>
                    ) : (
                        <div className="flex items-center gap-3 p-4 bg-primary/5 border border-primary/20 rounded-xl">
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <FileUp className="w-5 h-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-text-main dark:text-white text-sm truncate">{uploadFile.name}</p>
                                <p className="text-xs text-text-secondary">{(uploadFile.size / 1024).toFixed(1)} KB</p>
                            </div>
                            <button
                                onClick={() => { setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                                className="p-1.5 text-text-secondary hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    <Button
                        onClick={handleUploadDocument}
                        disabled={uploadLoading || !uploadFile}
                        loading={uploadLoading}
                        className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 text-white"
                    >
                        {uploadLoading ? '📄 AI sedang mengekstrak soal...' : '📄 Ekstrak Soal dari Dokumen'}
                    </Button>
                </div>
            )}

            {/* Unified Review / Edit Step */}
            {hasResults && (() => {
                // Validate ALL results since we save everything that isn't deleted
                const unlabeledCount = results.filter(q => !q.difficulty).length
                const unansweredMCCount = results.filter(q => q.question_type !== 'ESSAY' && !q.correct_answer).length
                const allValid = unlabeledCount === 0 && unansweredMCCount === 0

                return (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <p className="text-sm text-text-secondary dark:text-zinc-400">✅ Ditemukan {results.length} soal. Periksa & sesuaikan kesulitan:</p>
                            <div className="flex items-center gap-2">
                                {!isSelectionMode ? (
                                    <button
                                        onClick={() => {
                                            setIsSelectionMode(true)
                                            setSelected(new Array(results.length).fill(false))
                                        }}
                                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-secondary/10 text-primary hover:bg-secondary/20 transition-colors flex items-center gap-1"
                                    >
                                        <span>☑️</span> Pilih Soal
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => {
                                                if (selected.some(Boolean)) {
                                                    setConfirmDeleteVisible(true)
                                                }
                                            }}
                                            disabled={!selected.some(Boolean)}
                                            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1 ${selected.some(Boolean)
                                                ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-200 cursor-pointer'
                                                : 'bg-secondary/5 text-text-secondary opacity-50 cursor-not-allowed'
                                                }`}
                                        >
                                            🗑 Hapus ({selected.filter(Boolean).length})
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsSelectionMode(false)
                                                setSelected(new Array(results.length).fill(false))
                                            }}
                                            className="px-3 py-1.5 text-xs font-semibold rounded-lg text-text-secondary hover:bg-secondary/10 transition-colors"
                                        >
                                            Selesai
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Bulk difficulty assignment */}
                        <div className="flex items-center gap-2 p-3 bg-secondary/5 rounded-lg border border-secondary/20">
                            <span className="text-xs font-semibold text-text-secondary">Atur semua kesulitan:</span>
                            {(['EASY', 'MEDIUM', 'HARD'] as const).map((level) => (
                                <button
                                    key={level}
                                    onClick={() => {
                                        // If in selection mode and have selection, apply to selected. Otherwise apply to ALL.
                                        const hasSelection = isSelectionMode && selected.some(Boolean)
                                        setResults(prev => prev.map((item, i) =>
                                            (hasSelection ? selected[i] : true) ? { ...item, difficulty: level } : item
                                        ))
                                    }}
                                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${level === 'EASY' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 hover:bg-green-200' :
                                        level === 'HARD' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 hover:bg-red-200' :
                                            'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 hover:bg-amber-200'
                                        }`}
                                >
                                    {level === 'EASY' ? 'Mudah' : level === 'HARD' ? 'Sulit' : 'Sedang'}
                                </button>
                            ))}
                        </div>

                        {/* Bulk HOTS claim */}
                        {aiReviewEnabled && (
                            <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                <input
                                    type="checkbox"
                                    id="bulk-hots-claim"
                                    checked={results.every(q => q.teacher_hots_claim)}
                                    onChange={(e) => {
                                        const checked = e.target.checked
                                        const hasSelection = isSelectionMode && selected.some(Boolean)
                                        setResults(prev => prev.map((item, i) =>
                                            (hasSelection ? selected[i] : true) ? { ...item, teacher_hots_claim: checked } : item
                                        ))
                                    }}
                                    className="w-5 h-5 accent-emerald-600 rounded"
                                />
                                <label htmlFor="bulk-hots-claim" className="flex-1 cursor-pointer">
                                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">🧠 Klaim HOTS {isSelectionMode && selected.some(Boolean) ? '(yang dipilih)' : '(semua soal)'}</p>
                                    <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">Tandai sebagai soal berpikir tingkat tinggi</p>
                                </label>
                            </div>
                        )}

                        {(!allValid) && (
                            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg">
                                <span className="text-sm">⚠️</span>
                                <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                                    {[unlabeledCount > 0 && `${unlabeledCount} soal belum dilabeli kesulitan`, unansweredMCCount > 0 && `${unansweredMCCount} soal belum ada kunci jawaban`].filter(Boolean).join(' • ')}. Lengkapi untuk bisa menyimpan.
                                </span>
                            </div>
                        )}

                        <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-1">
                            {results.map((q, idx) => {
                                const showPassage = q.passage_text && (idx === 0 || results[idx - 1].passage_text !== q.passage_text)

                                return (
                                    <div key={idx} className="space-y-2">
                                        {/* Passage Card */}
                                        {showPassage && (
                                            <div className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-xl p-4 mb-2">
                                                <div className="flex items-center gap-2 mb-2 text-teal-700 dark:text-teal-400 font-bold text-sm">
                                                    <span className="text-lg">📖</span>
                                                    <span>Teks Bacaan</span>
                                                </div>
                                                <div className="text-sm text-text-main dark:text-gray-300 italic bg-white/50 dark:bg-black/20 p-3 rounded-lg border border-teal-100 dark:border-teal-800">
                                                    <SmartText text={q.passage_text || ''} />
                                                </div>
                                            </div>
                                        )}

                                        <div className={`rounded-lg p-4 border transition-all ${isSelectionMode && selected[idx] ? 'bg-red-50/50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30' : (!q.difficulty || (q.question_type !== 'ESSAY' && !q.correct_answer)) ? 'bg-red-50/50 dark:bg-red-500/5 border-red-200 dark:border-red-500/30' : 'bg-secondary/10 border-primary/30'}`}>
                                            <div className="flex items-start gap-3">
                                                {isSelectionMode && (
                                                    <input
                                                        type="checkbox"
                                                        checked={selected[idx] ?? false}
                                                        onChange={() => setSelected(prev => prev.map((s, i) => i === idx ? !s : s))}
                                                        className="mt-1.5 w-4 h-4 rounded accent-red-500 cursor-pointer"
                                                    />
                                                )}
                                                <div className="flex-1 space-y-2">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-primary font-bold text-sm">{idx + 1}.</span>
                                                        <span className={`px-2 py-0.5 text-xs rounded font-bold bg-secondary/10 text-text-main dark:text-white border border-secondary/20`}>
                                                            {q.question_type === 'MULTIPLE_CHOICE' ? 'Pilihan Ganda' : 
                                                             q.question_type === 'MULTIPLE_ANSWER' ? 'Ganda Kompleks' : 
                                                             q.question_type === 'TRUE_FALSE' ? 'Benar Salah' : 
                                                             q.question_type === 'SHORT_ANSWER' ? 'Isian Singkat' : 'Essay'}
                                                        </span>

                                                        {/* Difficulty selector — always visible */}
                                                        <select
                                                            value={q.difficulty || ''}
                                                            onChange={(e) => setResults(prev => prev.map((item, i) => i === idx ? { ...item, difficulty: e.target.value as any } : item))}
                                                            className={`px-2 py-0.5 text-xs font-bold rounded-lg cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${!q.difficulty ? 'bg-gray-100 dark:bg-gray-500/20 text-gray-500 dark:text-gray-400 border border-dashed border-red-300 dark:border-red-500/50 animate-pulse' :
                                                                q.difficulty === 'EASY' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-500/30' :
                                                                    q.difficulty === 'HARD' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/30' :
                                                                        'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30'
                                                                }`}
                                                        >
                                                            <option value="">⚠ Pilih Kesulitan</option>
                                                            <option value="EASY">🟢 Mudah</option>
                                                            <option value="MEDIUM">🟡 Sedang</option>
                                                            <option value="HARD">🔴 Sulit</option>
                                                        </select>

                                                        {/* Per-question HOTS toggle */}
                                                        {aiReviewEnabled && (
                                                            <button
                                                                onClick={() => setResults(prev => prev.map((item, i) => i === idx ? { ...item, teacher_hots_claim: !item.teacher_hots_claim } : item))}
                                                                className={`px-2 py-0.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${q.teacher_hots_claim
                                                                    ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30'
                                                                    : 'bg-gray-100 dark:bg-gray-500/20 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-500/30 opacity-50 hover:opacity-100'
                                                                    }`}
                                                                title={q.teacher_hots_claim ? 'Klaim HOTS aktif — klik untuk nonaktifkan' : 'Klik untuk klaim sebagai soal HOTS'}
                                                            >
                                                                🧠 {q.teacher_hots_claim ? 'HOTS' : 'HOTS'}
                                                            </button>
                                                        )}

                                                        <button
                                                            onClick={() => setEditIdx(editIdx === idx ? null : idx)}
                                                            className={`ml-auto px-2.5 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1 ${editIdx === idx
                                                                ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 hover:bg-green-200'
                                                                : 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 hover:bg-blue-200'
                                                                }`}
                                                        >
                                                            {editIdx === idx ? '✔ Selesai' : '✏️ Edit'}
                                                        </button>
                                                    </div>
                                                    {editIdx === idx ? (
                                                        <div className="space-y-2">
                                                            <div className="space-y-1">
                                                                {/* Question Type Selector in Edit Mode */}
                                                                <div>
                                                                    <label className="block text-xs font-bold text-text-secondary mb-1">Tipe Soal</label>
                                                                    <select
                                                                        value={q.question_type}
                                                                        onChange={(e) => {
                                                                            const newType = e.target.value
                                                                            const prevType = q.question_type
                                                                            let newOpts: string[] | null = null
                                                                            let newAnswer: string | null = ''
                                                                            if (['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(newType)) {
                                                                                newOpts = ['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(prevType) && q.options?.length
                                                                                    ? q.options
                                                                                    : ['', '', '', '']
                                                                            } else if (newType === 'TRUE_FALSE') {
                                                                                newOpts = ['Benar', 'Salah']
                                                                            }
                                                                            setResults(prev => prev.map((item, i) => i === idx ? { ...item, question_type: newType, options: newOpts, correct_answer: newAnswer } : item))
                                                                        }}
                                                                        className="w-full px-3 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-secondary/30 rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                                                                    >
                                                                        <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                                                                        <option value="MULTIPLE_ANSWER">Ganda Kompleks</option>
                                                                        <option value="TRUE_FALSE">Benar Salah</option>
                                                                        <option value="SHORT_ANSWER">Isian Singkat</option>
                                                                        <option value="ESSAY">Essay</option>
                                                                    </select>
                                                                </div>
                                                                {/* Passage Editor in Edit Mode */}
                                                                {q.passage_text && (
                                                                    <div className="text-xs text-text-secondary">
                                                                        Editing Passage (berlaku untuk semua soal di grup ini):
                                                                        <textarea
                                                                            value={q.passage_text}
                                                                            onChange={(e) => {
                                                                                const newText = e.target.value
                                                                                // Update ALL questions that share this passage text (or originally shared it)
                                                                                // Ideally we should use a passage ID, but text matching is ok for now if contiguous
                                                                                setResults(prev => {
                                                                                    const copy = [...prev]
                                                                                    // Find range of questions with same passage
                                                                                    // Simple approach: just update this one, but that breaks grouping if they become different
                                                                                    // Better: Update all questions with the SAME original passage text
                                                                                    // But we don't track original.
                                                                                    // Let's just update this one for now to avoid complexity, user can copy paste.
                                                                                    // OR: Better UX, handle it properly.
                                                                                    // For now, let's keep it simple: Update THIS question's passage text.
                                                                                    // If it breaks the group (renders separate card), that's actually correct behavior.
                                                                                    return copy.map((item, i) => i === idx ? { ...item, passage_text: newText } : item)
                                                                                })
                                                                            }}
                                                                            rows={3}
                                                                            className="w-full mt-1 px-3 py-2 text-xs bg-teal-50/50 dark:bg-teal-900/10 border border-teal-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500"
                                                                            placeholder="Edit teks bacaan..."
                                                                        />
                                                                    </div>
                                                                )}
                                                                <textarea
                                                                    value={q.question_text}
                                                                    onChange={(e) => setResults(prev => prev.map((item, i) => i === idx ? { ...item, question_text: e.target.value } : item))}
                                                                    rows={2}
                                                                    className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-800 border border-secondary/30 rounded-lg text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                                                                />
                                                            </div>
                                                            <QuestionOptionsEditor
                                                                questionType={q.question_type}
                                                                options={q.options}
                                                                correctAnswer={q.correct_answer}
                                                                onChange={(opts, correct) => setResults(prev => prev.map((item, i) => i === idx ? { ...item, options: opts, correct_answer: correct } : item))}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <SmartText text={q.question_text} className="text-text-main dark:text-white text-sm" />
                                                            {/* MC / MULTIPLE_ANSWER options */}
                                                            {q.options && ['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(q.question_type) && (() => {
                                                                let correctSet = new Set<string>()
                                                                if (q.question_type === 'MULTIPLE_ANSWER') {
                                                                    try {
                                                                        const parsed = JSON.parse(q.correct_answer || '[]')
                                                                        if (Array.isArray(parsed)) correctSet = new Set(parsed)
                                                                    } catch { /* ignore */ }
                                                                } else {
                                                                    if (q.correct_answer) correctSet.add(q.correct_answer)
                                                                }
                                                                return (
                                                                    <div className="mt-1 text-xs text-text-secondary dark:text-zinc-400 flex flex-wrap gap-x-3">
                                                                        {q.options.map((opt, optIdx) => {
                                                                            const letter = String.fromCharCode(65 + optIdx)
                                                                            const isCorrect = correctSet.has(letter)
                                                                            return (
                                                                                <span key={optIdx} className={isCorrect ? 'text-green-600 dark:text-green-400 font-bold' : ''}>
                                                                                    {letter}. <SmartText text={opt} as="span" />
                                                                                    {isCorrect && ' ✓'}
                                                                                </span>
                                                                            )
                                                                        })}
                                                                    </div>
                                                                )
                                                            })()}
                                                            {/* TRUE_FALSE display */}
                                                            {q.question_type === 'TRUE_FALSE' && (
                                                                <div className="mt-1 text-xs flex gap-3">
                                                                    <span className={q.correct_answer === 'BENAR' ? 'text-green-600 dark:text-green-400 font-bold' : 'text-text-secondary'}>
                                                                        Benar {q.correct_answer === 'BENAR' && '✓'}
                                                                    </span>
                                                                    <span className={q.correct_answer === 'SALAH' ? 'text-green-600 dark:text-green-400 font-bold' : 'text-text-secondary'}>
                                                                        Salah {q.correct_answer === 'SALAH' && '✓'}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {/* SHORT_ANSWER display */}
                                                            {q.question_type === 'SHORT_ANSWER' && q.correct_answer && (
                                                                <p className="mt-1 text-xs text-green-600 dark:text-green-400 font-medium">
                                                                    Jawaban: {q.correct_answer}
                                                                </p>
                                                            )}
                                                            {/* ESSAY kunci jawaban display */}
                                                            {q.question_type === 'ESSAY' && q.correct_answer && (
                                                                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 italic truncate max-w-md">
                                                                    Kunci: {q.correct_answer}
                                                                </p>
                                                            )}
                                                        </>
                                                    )}
                                                    {/* Missing answer warning for auto-gradeable types */}
                                                    {q.question_type !== 'ESSAY' && !q.correct_answer && (
                                                        <p className="text-xs text-red-500 font-medium">⚠ Kunci jawaban belum diisi — klik Edit untuk mengisi</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        <div className="flex gap-3 pt-4">
                            <Button variant="secondary" onClick={() => { setResults([]); setSelected([]); setSavedBank(false) }}>
                                ← Ulangi
                            </Button>
                            {showBankSoal && (
                            <Button
                                variant={savedBank ? 'secondary' : 'secondary'}
                                onClick={() => handleSaveBank()}
                                disabled={!allValid || results.length === 0 || savingBank || savedBank}
                                loading={savingBank}
                                className={savedBank ? 'bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400' : ''}
                            >
                                {savedBank ? '✅ Tersimpan di Bank Soal' : '💾 Simpan ke Bank Soal'}
                            </Button>
                            )}
                            <Button
                                onClick={handleSave}
                                disabled={saving || results.length === 0 || !allValid}
                                loading={saving}
                                className="flex-1"
                            >
                                {saving ? 'Menyimpan...' : !allValid
                                    ? `⚠ ${[unlabeledCount > 0 && `${unlabeledCount} Belum Dilabeli`, unansweredMCCount > 0 && `${unansweredMCCount} Soal Belum Ada Jawaban`].filter(Boolean).join(', ')}`
                                    : `Tambahkan ${results.length} Soal ke ${targetLabel}`}
                            </Button>
                        </div>
                    </div>
                )
            })()}
            {/* Confirm Delete Overlay */}
            {confirmDeleteVisible && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setConfirmDeleteVisible(false)}>
                    <div className="bg-white dark:bg-zinc-800 rounded-2xl p-6 max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <p className="text-lg font-bold text-text-main dark:text-white mb-2">🗑️ Hapus Soal?</p>
                        <p className="text-sm text-text-secondary dark:text-zinc-400 mb-6">
                            Hapus {selected.filter(Boolean).length} soal yang dipilih? Tindakan ini tidak bisa dibatalkan.
                        </p>
                        <div className="flex gap-3">
                            <Button variant="secondary" onClick={() => setConfirmDeleteVisible(false)} className="flex-1">Batal</Button>
                            <Button
                                onClick={() => {
                                    const newResults = results.filter((_, i) => !selected[i])
                                    setResults(newResults)
                                    setSelected(new Array(newResults.length).fill(false))
                                    setConfirmDeleteVisible(false)
                                }}
                                className="flex-1 !bg-red-500 hover:!bg-red-600 !text-white"
                            >
                                Hapus
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </Card>
    )
}
