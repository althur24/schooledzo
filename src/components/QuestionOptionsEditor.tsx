import React from 'react'
import dynamic from 'next/dynamic'
import { Plus } from 'react-iconly'
import { plainToHtml } from '@/lib/richTextUtils'
import { shouldSkipCrop, uploadQuestionImage } from '@/lib/questionImage'
import { parseAnswerLetters } from '@/lib/questionTypeUtils'

const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), {
    ssr: false,
    loading: () => <div className="w-full px-4 py-3 bg-secondary/5 border border-secondary/20 rounded-xl text-text-secondary text-sm">Memuat editor...</div>
})

const ImageCropModal = dynamic(() => import('@/components/ImageCropModal'), { ssr: false })

interface QuestionOptionsEditorProps {
    questionType: string
    options: string[] | null
    correctAnswer: string | null
    onChange: (options: string[] | null, correctAnswer: string | null) => void
    textDirection?: 'ltr' | 'rtl'
    /** Mode penilaian Ganda Kompleks (hanya dipakai saat questionType = MULTIPLE_ANSWER). */
    gkGradingMode?: 'PROPORTIONAL' | 'ALL_OR_NOTHING' | null
    /** Callback perubahan mode penilaian GK — undefined = halaman belum mendukung (toggle disembunyikan). */
    onGkGradingModeChange?: (mode: 'PROPORTIONAL' | 'ALL_OR_NOTHING') => void
}

export default function QuestionOptionsEditor({
    questionType,
    options,
    correctAnswer,
    onChange,
    textDirection = 'ltr',
    gkGradingMode,
    onGkGradingModeChange
}: QuestionOptionsEditorProps) {
    // --- Image upload state (hooks must be before any early return) ---
    const [uploadingIdx, setUploadingIdx] = React.useState<number | null>(null)
    // Gambar yang menunggu konfirmasi crop di ImageCropModal
    const [pendingUploadFile, setPendingUploadFile] = React.useState<File | null>(null)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const pendingUploadIdx = React.useRef<number | null>(null)

    if (questionType === 'ESSAY') {
        return (
            <div>
                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Kunci Jawaban (opsional)</label>
                <textarea
                    value={correctAnswer || ''}
                    onChange={(e) => onChange(null, e.target.value)}
                    className={`w-full px-4 py-3 bg-secondary/5 border border-secondary/30 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none ${textDirection === 'rtl' ? 'text-right' : ''}`}
                    rows={3}
                    dir={textDirection}
                    placeholder="Kunci jawaban essay..."
                />
            </div>
        )
    }

    if (questionType === 'SHORT_ANSWER') {
        return (
            <div>
                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Jawaban Benar</label>
                <p className="text-xs text-text-secondary mb-2">Pisahkan beberapa variasi jawaban dengan koma (,). Contoh: fotosintesis, Fotosintesis</p>
                <textarea
                    value={correctAnswer || ''}
                    onChange={(e) => onChange(null, e.target.value)}
                    className={`w-full px-4 py-3 bg-secondary/5 border border-secondary/30 rounded-xl text-text-main dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none ${textDirection === 'rtl' ? 'text-right' : ''}`}
                    rows={2}
                    dir={textDirection}
                    placeholder="Masukkan jawaban..."
                />
            </div>
        )
    }

    if (questionType === 'TRUE_FALSE') {
        return (
            <div>
                <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pilih Jawaban Benar</label>
                <div className="flex gap-4">
                    <button
                        type="button"
                        onClick={() => onChange(['Benar', 'Salah'], 'BENAR')}
                        className={`flex-1 px-4 py-3 rounded-xl font-bold transition-all border ${correctAnswer === 'BENAR' ? 'bg-green-500 text-white border-green-500' : 'bg-secondary/5 text-text-main border-secondary/20 hover:bg-secondary/10'}`}
                    >
                        Benar
                    </button>
                    <button
                        type="button"
                        onClick={() => onChange(['Benar', 'Salah'], 'SALAH')}
                        className={`flex-1 px-4 py-3 rounded-xl font-bold transition-all border ${correctAnswer === 'SALAH' ? 'bg-green-500 text-white border-green-500' : 'bg-secondary/5 text-text-main border-secondary/20 hover:bg-secondary/10'}`}
                    >
                        Salah
                    </button>
                </div>
            </div>
        )
    }

    // MULTIPLE_CHOICE or MULTIPLE_ANSWER
    const isMultipleAnswer = questionType === 'MULTIPLE_ANSWER'
    const safeOptions = options || ['', '', '', '']
    
    // For MULTIPLE_ANSWER, correctAnswer is a JSON array string.
    // Parse via parseAnswerLetters (sumber yang sama dengan grading) — kunci
    // format lama "A, C" tetap terbaca hijau; tanpa ini guru yang men-toggle
    // ulang satu opsi akan menimpa kunci lama dengan '[]' + 1 huruf (data loss).
    let correctAnswersSet = new Set<string>()
    if (isMultipleAnswer) {
        correctAnswersSet = new Set(parseAnswerLetters(correctAnswer))
    } else {
        if (correctAnswer) correctAnswersSet.add(correctAnswer)
    }

    const toggleCorrectAnswer = (letter: string) => {
        if (isMultipleAnswer) {
            const newSet = new Set(correctAnswersSet)
            if (newSet.has(letter)) newSet.delete(letter)
            else newSet.add(letter)
            onChange(safeOptions, JSON.stringify(Array.from(newSet)))
        } else {
            onChange(safeOptions, letter)
        }
    }

    // --- Image upload handlers for options ---
    const triggerImageUpload = (idx: number) => {
        pendingUploadIdx.current = idx
        fileInputRef.current?.click()
    }

    // Upload gambar ke opsi yang sedang menunggu (pendingUploadIdx)
    const uploadOptionImage = async (file: File) => {
        if (pendingUploadIdx.current === null) return
        const idx = pendingUploadIdx.current
        setUploadingIdx(idx)
        try {
            const data = await uploadQuestionImage(file)
            if (data.url) {
                const letter = String.fromCharCode(65 + idx)
                const imgTag = `<img src="${data.url}" alt="Opsi ${letter}" style="max-width:100%;border-radius:8px;" />`
                const newOptions = [...safeOptions]
                // Append (never wipe existing text); wrap plain text so it stays valid HTML
                const current = safeOptions[idx] || ''
                newOptions[idx] = (current ? plainToHtml(current) : '') + imgTag
                onChange(newOptions, correctAnswer)
            }
        } catch (error) {
            alert(error instanceof Error ? error.message : 'Gagal upload gambar')
        } finally {
            setUploadingIdx(null)
            pendingUploadIdx.current = null
        }
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (fileInputRef.current) fileInputRef.current.value = ''
        if (!file || pendingUploadIdx.current === null) return

        // GIF langsung upload (crop via canvas mematikan animasi)
        if (shouldSkipCrop(file)) {
            await uploadOptionImage(file)
            return
        }
        setPendingUploadFile(file)
    }

    // Extract full <img ...> tags from an option's HTML (for the delete-✕ thumbnails)
    const extractImgTags = (html: string): string[] => {
        if (!html) return []
        return Array.from(html.matchAll(/<img[^>]*>/g)).map(m => m[0])
    }

    const extractImgSrc = (tag: string): string => {
        const match = tag.match(/src="([^"]+)"/)
        return match ? match[1] : ''
    }

    const removeImageFromOption = (idx: number, tag: string) => {
        const newOptions = [...safeOptions]
        const cleaned = (safeOptions[idx] || '').replace(tag, '')
        // Removing an inline image can leave an empty paragraph behind
        newOptions[idx] = (cleaned === '<p></p>' || cleaned.trim() === '') ? '' : cleaned
        onChange(newOptions, correctAnswer)
    }

    return (
        <div>
            <label className="block text-sm font-bold text-text-main dark:text-white mb-2">Pilihan Jawaban</label>
            <p className="text-xs text-text-secondary mb-2">💡 Gambar bisa ditempel (Ctrl+V) atau diseret langsung ke kolom opsi, atau lewat tombol 🖼️.</p>
            {isMultipleAnswer && <p className="text-xs text-text-secondary mb-2">Pilih lebih dari satu opsi sebagai jawaban benar.</p>}
            <div className="space-y-2">
                {safeOptions.map((opt, optIdx) => {
                    const letter = String.fromCharCode(65 + optIdx)
                    const isCorrect = correctAnswersSet.has(letter)

                    return (
                        <div key={optIdx} className="space-y-1">
                            <div className="flex items-center gap-2">
                                <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${isCorrect ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300'}`}>
                                    {letter}
                                </span>
                                <div className="flex-1">
                                    <RichTextEditor
                                        value={opt}
                                        onChange={(val: string) => {
                                            const newOptions = [...safeOptions]
                                            // Normalize empty TipTap doc back to empty string
                                            newOptions[optIdx] = val === '<p></p>' ? '' : val
                                            onChange(newOptions, correctAnswer)
                                        }}
                                        placeholder={`Pilihan ${letter}`}
                                        textDirection={textDirection}
                                        compact
                                    />
                                </div>
                                <button
                                    onClick={() => toggleCorrectAnswer(letter)}
                                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${isCorrect ? 'bg-green-500 text-white' : 'bg-secondary/10 text-text-main dark:text-zinc-300 hover:bg-green-500/20'}`}
                                >
                                    {isCorrect ? '✓ Benar' : 'Set Benar'}
                                </button>
                                <button
                                    onClick={() => triggerImageUpload(optIdx)}
                                    disabled={uploadingIdx === optIdx}
                                    className="px-2.5 py-2 rounded-lg text-sm transition-colors flex-shrink-0 bg-secondary/10 text-text-main dark:text-zinc-300 hover:bg-primary/10 disabled:opacity-50"
                                    title="Sisipkan Gambar"
                                >
                                    {uploadingIdx === optIdx ? '⏳' : '🖼️'}
                                </button>
                                {safeOptions.length > 2 && (
                                    <button
                                        onClick={() => {
                                            const newOptions = [...safeOptions]
                                            newOptions.splice(optIdx, 1)
                                            
                                            // Adjust correct answers logic if removing an option
                                            let newCorrectAnswerStr = correctAnswer || ''
                                            if (isMultipleAnswer) {
                                                const arr = Array.from(correctAnswersSet)
                                                const newArr = arr.filter(c => c !== letter).map(c => {
                                                    const charCode = c.charCodeAt(0) - 65
                                                    return charCode > optIdx ? String.fromCharCode(charCode + 65 - 1) : c
                                                })
                                                newCorrectAnswerStr = JSON.stringify(newArr)
                                            } else {
                                                if (newCorrectAnswerStr === letter) newCorrectAnswerStr = ''
                                                else {
                                                    const charCode = newCorrectAnswerStr.charCodeAt(0) - 65
                                                    if (charCode > optIdx) newCorrectAnswerStr = String.fromCharCode(charCode + 65 - 1)
                                                }
                                            }
                                            onChange(newOptions, newCorrectAnswerStr)
                                        }}
                                        className="px-3 py-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                            {/* Thumbnails gambar di opsi ini — tombol ✕ untuk menghapus gambar */}
                            {extractImgTags(opt).length > 0 && (
                                <div className="ml-10 mt-3 flex flex-wrap items-center gap-3">
                                    {extractImgTags(opt).map((tag, imgIdx) => (
                                        <div key={imgIdx} className="relative">
                                            <img
                                                src={extractImgSrc(tag)}
                                                alt={`Gambar opsi ${letter}`}
                                                className="h-14 w-auto object-contain rounded-md border border-secondary/20 bg-white p-0.5"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => removeImageFromOption(optIdx, tag)}
                                                title="Hapus gambar ini"
                                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow hover:bg-red-600"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}
                {safeOptions.length < 6 && (
                    <button
                        onClick={() => onChange([...safeOptions, ''], correctAnswer)}
                        className="mt-2 text-sm text-primary font-bold hover:underline flex items-center gap-1"
                    >
                        <Plus set="bold" primaryColor="currentColor" size={16} /> Tambah Opsi
                    </button>
                )}
            </div>

            {/* Mode penilaian Ganda Kompleks — guru memilih: skor dibagi (default) atau salah satu = salah semua */}
            {isMultipleAnswer && onGkGradingModeChange && (
                <div className="mt-4 p-3 bg-secondary/5 dark:bg-white/5 border border-secondary/20 dark:border-white/10 rounded-xl">
                    <label className="block text-sm font-bold text-text-main dark:text-white">Mode Penilaian</label>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                        <button
                            type="button"
                            onClick={() => onGkGradingModeChange('PROPORTIONAL')}
                            className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors text-left ${gkGradingMode !== 'ALL_OR_NOTHING'
                                ? 'bg-primary text-white border-primary'
                                : 'bg-secondary/5 dark:bg-white/5 text-text-main dark:text-white border-secondary/20 dark:border-white/20 hover:border-primary/50'}`}
                        >
                            Bagi Otomatis <span className="font-normal opacity-75">(default)</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => onGkGradingModeChange('ALL_OR_NOTHING')}
                            className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors text-left ${gkGradingMode === 'ALL_OR_NOTHING'
                                ? 'bg-primary text-white border-primary'
                                : 'bg-secondary/5 dark:bg-white/5 text-text-main dark:text-white border-secondary/20 dark:border-white/20 hover:border-primary/50'}`}
                        >
                            Salah Satu = Salah Semua
                        </button>
                    </div>
                    <p className="text-xs text-text-secondary mt-2">
                        {gkGradingMode === 'ALL_OR_NOTHING'
                            ? 'Jawaban harus persis sama dengan kunci. Salah pilih satu atau kurang satu = 0 poin.'
                            : 'Skor proporsional: (benar − salah) / jumlah kunci × poin soal, minimum 0 — pilihan salah mengurangi skor. Contoh: 3 kunci, siswa benar 2 + salah 1 pada soal 10 poin = 3,33. Siswa hanya bisa memilih maksimal sebanyak jumlah kunci.'}
                    </p>
                </div>
            )}
            {/* Hidden file input for option image upload */}
            <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileChange}
            />

            {/* Crop gambar sebelum upload ke opsi */}
            <ImageCropModal
                file={pendingUploadFile}
                onCancel={() => setPendingUploadFile(null)}
                onConfirm={(processed) => uploadOptionImage(processed)}
            />
        </div>
    )
}
