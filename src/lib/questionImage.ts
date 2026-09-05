/**
 * Utilitas gambar soal — dipakai bersama oleh RichTextEditor,
 * QuestionImageUpload, dan QuestionOptionsEditor lewat ImageCropModal.
 *
 * - processCroppedImage: crop area (koordinat px pada gambar hasil rotasi)
 *   → canvas → batasi dimensi → kompresi → File siap upload.
 * - uploadQuestionImage: POST ke /api/questions/upload-image (endpoint yang
 *   sudah ada, tidak diubah).
 */

export interface CropArea {
    x: number
    y: number
    width: number
    height: number
}

// Batas dimensi & kualitas kompresi — cukup tajam untuk teks soal di layar
// siswa mana pun, tapi jauh lebih ringan daripada foto HP mentah (3-5MB).
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.85

// GIF tidak boleh lewat canvas — animasi hilang. Upload apa adanya.
export function shouldSkipCrop(file: File): boolean {
    return file.type === 'image/gif'
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('Gagal memuat gambar'))
        image.src = src
    })
}

// Ukuran bounding box gambar setelah rotasi (90°/270° menukar lebar-tinggi)
function rotateSize(width: number, height: number, rotation: number) {
    const rot = Math.abs(rotation) % 180
    return rot === 90 ? { width: height, height: width } : { width, height }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('Gagal memproses gambar'))),
            type,
            quality
        )
    })
}

/**
 * Crop + kompres gambar lewat canvas.
 *
 * `pixelCrop` adalah koordinat piksel area crop PADA GAMBAR YANG SUDAH
 * dirotasi (sesuai output croppedAreaPixels react-easy-crop).
 * PNG tetap PNG (transparansi dijaga); format lain keluar sebagai JPEG 85%.
 * Tidak pernah upscale: hasil maksimal 1600px sisi terpanjang.
 */
export async function processCroppedImage(
    imageSrc: string,
    pixelCrop: CropArea,
    rotation = 0,
    outputType: 'image/jpeg' | 'image/png' = 'image/jpeg'
): Promise<File> {
    const image = await loadImage(imageSrc)

    // Kanvas A: gambar penuh dengan rotasi diterapkan
    // (browser modern otomatis menerapkan orientasi EXIF saat load)
    const { width: bBoxWidth, height: bBoxHeight } = rotateSize(image.width, image.height, rotation)
    const canvas = document.createElement('canvas')
    canvas.width = bBoxWidth
    canvas.height = bBoxHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas tidak didukung browser ini')

    ctx.translate(bBoxWidth / 2, bBoxHeight / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.translate(-image.width / 2, -image.height / 2)
    ctx.drawImage(image, 0, 0)

    // Kanvas B: area crop, diskalakan ke batas dimensi
    const maxSide = Math.max(pixelCrop.width, pixelCrop.height)
    const scale = maxSide > MAX_DIMENSION ? MAX_DIMENSION / maxSide : 1
    const targetW = Math.max(1, Math.round(pixelCrop.width * scale))
    const targetH = Math.max(1, Math.round(pixelCrop.height * scale))

    const cropped = document.createElement('canvas')
    cropped.width = targetW
    cropped.height = targetH
    const croppedCtx = cropped.getContext('2d')
    if (!croppedCtx) throw new Error('Canvas tidak didukung browser ini')

    // JPEG tidak punya alpha: area transparan diisi putih (bukan hitam)
    if (outputType === 'image/jpeg') {
        croppedCtx.fillStyle = '#ffffff'
        croppedCtx.fillRect(0, 0, targetW, targetH)
    }

    croppedCtx.drawImage(
        canvas,
        pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
        0, 0, targetW, targetH
    )

    const blob = await canvasToBlob(
        cropped,
        outputType,
        outputType === 'image/jpeg' ? JPEG_QUALITY : undefined
    )
    const ext = outputType === 'image/png' ? 'png' : 'jpg'
    return new File([blob], `soal-${Date.now()}.${ext}`, { type: outputType })
}

/**
 * Upload gambar soal ke endpoint yang sudah ada.
 * Melempar Error dengan pesan server bila gagal.
 */
export async function uploadQuestionImage(file: File): Promise<{ url: string; filename: string }> {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/questions/upload-image', {
        method: 'POST',
        body: formData
    })

    if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Gagal upload gambar')
    }
    return res.json()
}
