import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { parseGeminiJson } from '@/lib/parse-gemini-json'
import { callGemini } from '@/lib/geminiClient'

const OCR_PROMPT = `Analisis gambar soal ujian/kuis ini dan ekstrak semua soal yang ada.

Untuk setiap soal, tentukan:
1. Teks soal lengkap (TANPA nomor soal di depan)
2. Tipe soal:
   - "MULTIPLE_CHOICE" jika ada pilihan A/B/C/D dengan SATU jawaban benar
   - "MULTIPLE_ANSWER" jika ada pilihan A/B/C/D dengan LEBIH DARI SATU jawaban benar
   - "TRUE_FALSE" jika soal memiliki pilihan Benar/Salah, B/S, True/False
   - "SHORT_ANSWER" jika soal memerlukan jawaban singkat (isian, 1-3 kata)
   - "ESSAY" jika soal memerlukan jawaban panjang/uraian
3. Jika pilihan ganda, sertakan opsi-opsinya sebagai array
4. Jika ada kunci jawaban yang terlihat, sertakan juga

PENTING: Balas HANYA dengan JSON valid, tanpa markdown atau teks lain.
Format JSON:
{
  "questions": [
    {
      "question_text": "Teks soal lengkap",
      "question_type": "MULTIPLE_CHOICE | MULTIPLE_ANSWER | TRUE_FALSE | SHORT_ANSWER | ESSAY",
      "options": ["opsi1", "opsi2", "opsi3", "opsi4"] (Gunakan null jika ESSAY / SHORT_ANSWER. Untuk TRUE_FALSE gunakan ["Benar", "Salah"]),
      "correct_answer": "A/B/C/D untuk pilihan ganda, [\\"A\\",\\"C\\"] untuk ganda kompleks, BENAR/SALAH untuk true-false, atau jawaban singkat"
    }
  ]
}

PENTING untuk options:
- JANGAN sertakan huruf A/B/C/D di awal opsi
- Contoh SALAH: ["A. Jakarta", "B. Bandung"]
- Contoh BENAR: ["Jakarta", "Bandung"]`

// POST - Extract questions from image using Gemini Vision
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const formData = await request.formData()
        const image = formData.get('image') as File

        if (!image) {
            return NextResponse.json({ error: 'Image diperlukan' }, { status: 400 })
        }

        const bytes = await image.arrayBuffer()
        const base64 = Buffer.from(bytes).toString('base64')
        const mimeType = image.type || 'image/jpeg'

        const result = await callGemini({
            prompt: OCR_PROMPT,
            inlineData: { mimeType, base64 }
        })

        if (!result.ok) {
            return NextResponse.json({ error: result.error }, { status: 500 })
        }

        try {
            const parsed = parseGeminiJson(result.data!)
            return NextResponse.json(parsed)
        } catch (parseError: any) {
            console.error('JSON parse error:', parseError?.message, 'Raw:', result.data?.substring(0, 300))
            return NextResponse.json({
                error: 'Gagal memproses respons AI',
                raw: result.data
            }, { status: 500 })
        }

    } catch (error: any) {
        console.error('Error in OCR:', error?.message || error)
        return NextResponse.json({ error: 'Server error: ' + (error?.message || 'Unknown') }, { status: 500 })
    }
}
