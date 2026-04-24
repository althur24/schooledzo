import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { parseGeminiJson } from '@/lib/parse-gemini-json'
import { callGemini } from '@/lib/geminiClient'

const PROMPT_TEMPLATE = `Kamu adalah asisten yang membantu guru merapikan soal ujian/kuis.

Guru akan memberikan teks soal yang di-copy-paste dari website atau dokumen. Teksnya mungkin berantakan: spasi ganda, nomor soal ikut tercopy, pilihan jawaban campur dalam satu baris, format rusak, dsb.

Tugasmu:
1. Parse dan identifikasi setiap soal dari teks
2. Bersihkan format tanpa mengubah ISI soal sedikitpun
3. Hapus nomor soal di depan (1., 2., dst)
4. Tentukan tipe: "MULTIPLE_CHOICE" jika ada pilihan A/B/C/D/E, atau "ESSAY" jika tidak
5. Pisahkan opsi pilihan ganda menjadi array terpisah
6. Jika ada kunci jawaban, tentukan jawaban yang benar
7. Tentukan tingkat kesulitan: "EASY", "MEDIUM", atau "HARD"
8. JIKA ADA TEKS BACAAN (Passage) untuk beberapa soal (Contoh: "Teks untuk soal no 1-3"):
   - Masukkan teks tersebut ke field "passage_text" untuk SETIAP soal yang relevan.
   - Jangan masukkan teks bacaan ke dalam "question_text".

PENTING — KONTEN KHUSUS:

📐 MATEMATIKA:
- Semua ekspresi matematika HARUS dibungkus dengan tanda dolar: $...$ untuk inline, $$...$$ untuk display/block
- Contoh: "Tentukan nilai x jika $2x^2 + 3x - 5 = 0$"
- Contoh: "Hitung $\\\\log_2(x-1) + \\\\log_2(x+3) = 3$"
- Contoh: "Nilai dari $\\\\int_0^1 (3x^2 - 4x + 2) \\\\, dx$ adalah ..."
- Contoh: "Jika $\\\\frac{a}{b} = \\\\frac{3}{4}$, maka ..."
- Gunakan LaTeX untuk simbol: $\\\\sqrt{x}$, $x^2$, $\\\\pi$, $\\\\infty$, $\\\\leq$, $\\\\geq$, $\\\\neq$, $\\\\times$, $\\\\div$, $\\\\pm$
- JANGAN tulis simbol matematika mentah tanpa $...$ delimiter

🕌 BAHASA ARAB:
- PERTAHANKAN semua teks Arab apa adanya, termasuk harakat (fathah, kasrah, dhammah, dll)
- PERTAHANKAN arah teks (right-to-left)
- Jika soal campuran Arab-Indonesia, pertahankan keduanya
- Contoh: "Terjemahkan: بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ" → pertahankan teks Arab persis
- Jangan transliterasi teks Arab ke huruf latin

PENTING LAINNYA:
- JANGAN ubah isi/konten soal, hanya rapikan format
- JANGAN sertakan huruf A/B/C/D di awal opsi
- Contoh SALAH: ["A. Jakarta", "B. Bandung"]
- Contoh BENAR: ["Jakarta", "Bandung"]
- Balas HANYA dengan JSON valid, tanpa markdown atau teks lain

Format JSON:
{
  "questions": [
    {
      "question_text": "Teks soal yang sudah rapi",
      "question_type": "MULTIPLE_CHOICE atau ESSAY",
      "options": ["opsi 1", "opsi 2", "opsi 3", "opsi 4"] atau null,
      "correct_answer": "A/B/C/D" atau null,
      "difficulty": "EASY/MEDIUM/HARD",
      "passage_text": "Teks bacaan panjang jika ada (opsional)"
    }
  ]
}

Berikut teks soal yang perlu dirapikan:

`

// POST - Clean and parse messy pasted questions using Gemini
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { text } = await request.json()

        if (!text || !text.trim()) {
            return NextResponse.json({ error: 'Teks soal diperlukan' }, { status: 400 })
        }

        const result = await callGemini({ prompt: PROMPT_TEMPLATE + text })

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
        console.error('Error in clean-questions:', error?.message || error)
        return NextResponse.json({ error: 'Server error: ' + (error?.message || 'Unknown') }, { status: 500 })
    }
}
