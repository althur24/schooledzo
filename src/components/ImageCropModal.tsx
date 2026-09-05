'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Cropper, { type Area } from 'react-easy-crop'
import { RotateCw } from 'lucide-react'
import { Modal, Button } from '@/components/ui'
import { processCroppedImage } from '@/lib/questionImage'

/**
 * Modal "Sesuaikan Gambar" — dipakai semua jalur gambar soal
 * (RichTextEditor paste/drag/tombol, gambar utama soal, tombol 🖼️ per opsi).
 *
 * Interaksi: geser & pinch/scroll-zoom gambar di belakang frame crop tetap
 * (pola Instagram/WhatsApp — paling cepat di layar sentuh). Frame punya rasio
 * tetap (bawaan react-easy-crop): "Asli" mengikuti rasio gambar.
 * Output: crop → maks 1600px → JPEG 85% (PNG tetap PNG) → dikembalikan
 * sebagai File ke onConfirm; upload ditangani pemanggil.
 */

type AspectKey = 'auto' | '1:1' | '4:3' | '16:9'

const ASPECT_PRESETS: { key: AspectKey; label: string; ratio: number | null }[] = [
    { key: 'auto', label: 'Asli', ratio: null },
    { key: '1:1', label: '1:1', ratio: 1 },
    { key: '4:3', label: '4:3', ratio: 4 / 3 },
    { key: '16:9', label: '16:9', ratio: 16 / 9 },
]

interface ImageCropModalProps {
    /** null = modal tertutup */
    file: File | null
    onCancel: () => void
    onConfirm: (file: File) => void
}

export default function ImageCropModal({ file, onCancel, onConfirm }: ImageCropModalProps) {
    const [objectUrl, setObjectUrl] = useState<string | null>(null)
    const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
    const [crop, setCrop] = useState({ x: 0, y: 0 })
    const [zoom, setZoom] = useState(1)
    const [rotation, setRotation] = useState(0)
    const [aspectKey, setAspectKey] = useState<AspectKey>('auto')
    const [croppedPixels, setCroppedPixels] = useState<Area | null>(null)
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // File masuk → object URL + dimensi asli; reset state interaksi
    useEffect(() => {
        if (!file) {
            setObjectUrl(null)
            setNaturalSize(null)
            return
        }
        const url = URL.createObjectURL(file)
        setObjectUrl(url)
        const img = new Image()
        img.onload = () => setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
        img.src = url

        setCrop({ x: 0, y: 0 })
        setZoom(1)
        setRotation(0)
        setAspectKey('auto')
        setCroppedPixels(null)
        setError(null)

        return () => URL.revokeObjectURL(url)
    }, [file])

    // Rasio frame: "Asli" = rasio gambar (dengan pertukaran w/h saat rotasi 90°/270°)
    const aspect = useMemo(() => {
        if (aspectKey === 'auto') {
            if (!naturalSize) return 4 / 3
            const swap = Math.abs(rotation) % 180 === 90
            const w = swap ? naturalSize.h : naturalSize.w
            const h = swap ? naturalSize.w : naturalSize.h
            return w / h
        }
        return ASPECT_PRESETS.find(p => p.key === aspectKey)?.ratio ?? 4 / 3
    }, [aspectKey, naturalSize, rotation])

    const handleAspectChange = (key: AspectKey) => {
        setAspectKey(key)
        setCrop({ x: 0, y: 0 })
        setZoom(1)
    }

    const handleRotate = () => {
        setRotation(r => (r + 90) % 360)
        setCrop({ x: 0, y: 0 })
        setZoom(1)
    }

    const handleConfirm = async () => {
        if (!file || !objectUrl || !croppedPixels) return
        setProcessing(true)
        setError(null)
        try {
            // PNG tetap PNG agar transparansi tidak rusak; selain itu JPEG 85%
            const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
            const processed = await processCroppedImage(objectUrl, croppedPixels, rotation, outputType)
            onConfirm(processed)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Gagal memproses gambar')
        } finally {
            setProcessing(false)
        }
    }

    // Escape = batal (guard saat processing). Enter dibiarkan default browser
    // agar tidak konflik dengan fokus tombol/slider.
    useEffect(() => {
        if (!file) return
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !processing) onCancel()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [file, processing, onCancel])

    // Portal ke body: modal ini sering dibuka DI DALAM modal form soal —
    // keluar dari subtree-nya agar posisi fixed tak terpengaruh
    // transform/stacking context parent (pola yang sama dengan MathInsertMenu).
    if (typeof document === 'undefined') return null

    return createPortal(
        <Modal
            open={!!file}
            onClose={processing ? () => { } : onCancel}
            title="Sesuaikan Gambar"
            subtitle="Geser & zoom gambar sampai pas, putar bila miring, lalu klik Gunakan."
            maxWidth="lg"
            scaleIn={false}
        >
            <div className="space-y-4">
                {/* Area crop — wajib relative + tinggi eksplisit (react-easy-crop) */}
                <div className="relative h-64 sm:h-80 rounded-xl overflow-hidden bg-black">
                    {objectUrl && (
                        <Cropper
                            image={objectUrl}
                            crop={crop}
                            zoom={zoom}
                            rotation={rotation}
                            aspect={aspect}
                            onCropChange={setCrop}
                            onZoomChange={setZoom}
                            onRotationChange={setRotation}
                            onCropComplete={(_, areaPixels) => setCroppedPixels(areaPixels)}
                            showGrid
                        />
                    )}
                </div>

                {/* Kontrol: rasio + rotasi + zoom */}
                <div className="flex flex-wrap items-center gap-2">
                    {ASPECT_PRESETS.map(p => (
                        <button
                            key={p.key}
                            type="button"
                            onClick={() => handleAspectChange(p.key)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${aspectKey === p.key
                                ? 'bg-primary text-white border-primary'
                                : 'bg-secondary/5 text-text-secondary border-secondary/20 hover:border-primary/40'}`}
                        >
                            {p.label}
                        </button>
                    ))}

                    <button
                        type="button"
                        onClick={handleRotate}
                        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-secondary/5 text-text-main dark:text-white border border-secondary/20 hover:border-primary/40 transition-colors"
                        title="Putar 90°"
                    >
                        <RotateCw className="w-3.5 h-3.5" /> Putar
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-text-secondary select-none">Zoom</span>
                    <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.01}
                        value={zoom}
                        onChange={e => setZoom(Number(e.target.value))}
                        className="w-full accent-primary"
                        aria-label="Zoom gambar"
                    />
                </div>

                <p className="text-xs text-text-secondary">
                    {croppedPixels
                        ? <>Hasil: <span className="font-bold text-primary">{Math.round(croppedPixels.width)}×{Math.round(croppedPixels.height)} px</span> — dikompresi otomatis maks. 1600px</>
                        : 'Geser gambar untuk memilih area…'}
                </p>

                {error && (
                    <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">
                        {error}
                    </p>
                )}

                <div className="flex gap-3 pt-2">
                    <Button
                        variant="secondary"
                        onClick={onCancel}
                        disabled={processing}
                        className="flex-1"
                    >
                        Batal
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        loading={processing}
                        disabled={!croppedPixels || processing}
                        className="flex-1"
                    >
                        Gunakan
                    </Button>
                </div>
            </div>
        </Modal>,
        document.body
    )
}
