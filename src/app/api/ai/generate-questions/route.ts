import { NextRequest, NextResponse } from 'next/server'
import { getSchoolContextOrError, isErrorResponse } from '@/lib/schoolContext'
import { parseGeminiJson } from '@/lib/parse-gemini-json'
import { callGemini } from '@/lib/geminiClient'
import { normalizeQuestionTypes } from '@/lib/normalizeQuestionTypes'

// POST - Generate questions from material using Gemini
export async function POST(request: NextRequest) {
    try {
        const ctx = await getSchoolContextOrError(request)
        if (isErrorResponse(ctx)) return ctx
        const { user, schoolId } = ctx

        if (user.role !== 'GURU' && user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { material, count, type, difficulty } = await request.json()

        if (!material || material.trim().length < 50) {
            return NextResponse.json({ error: 'Materi terlalu pendek. Masukkan materi pembelajaran yang cukup (minimal 50 karakter) agar AI dapat membuat soal yang akurat.' }, { status: 400 })
        }

        const questionCount = count || 5
        const questionType = type || 'MIXED'
        const difficultyLevel = difficulty || 'MEDIUM'

        let typeInstruction = ''
        if (questionType === 'MULTIPLE_CHOICE') {
            typeInstruction = 'Semua soal harus Pilihan Ganda (MULTIPLE_CHOICE) dengan 4 opsi dan kunci jawaban huruf A/B/C/D.'
        } else if (questionType === 'MULTIPLE_ANSWER') {
            typeInstruction = 'Semua soal harus Ganda Kompleks (MULTIPLE_ANSWER) di mana siswa bisa memilih lebih dari satu jawaban benar. Berikan 4-5 opsi, dan kunci jawaban dalam format JSON array misal ["A", "C"].'
        } else if (questionType === 'TRUE_FALSE') {
            typeInstruction = 'Semua soal harus Benar/Salah (TRUE_FALSE). Opsi selalu ["Benar", "Salah"]. Kunci jawaban harus "BENAR" atau "SALAH".'
        } else if (questionType === 'SHORT_ANSWER') {
            typeInstruction = 'Semua soal harus Isian Singkat (SHORT_ANSWER). Tanpa opsi (null). Kunci jawaban berupa teks singkat yang benar.'
        } else if (questionType === 'ESSAY') {
            typeInstruction = 'Semua soal harus berbentuk essay/uraian (ESSAY). Tanpa opsi. Berikan panduan jawaban di correct_answer.'
        } else {
            typeInstruction = 'Buat campuran kelima tipe soal secara proporsional: MULTIPLE_CHOICE, MULTIPLE_ANSWER, TRUE_FALSE, SHORT_ANSWER, ESSAY.'
        }

        let difficultyInstruction = ''
        if (difficultyLevel === 'EASY') {
            difficultyInstruction = 'Buat soal dengan tingkat kesulitan MUDAH, fokus pada pemahaman dasar.'
        } else if (difficultyLevel === 'HARD') {
            difficultyInstruction = 'Buat soal dengan tingkat kesulitan SULIT, termasuk analisis dan penerapan konsep.'
        } else {
            difficultyInstruction = 'Buat soal dengan tingkat kesulitan SEDANG.'
        }

        const prompt = `Kamu adalah guru profesional yang HANYA membuat soal berdasarkan materi yang diberikan.

ATURAN KETAT — WAJIB DIIKUTI:
1. Kamu HANYA boleh membuat soal dari informasi yang ADA di dalam materi di bawah ini.
2. DILARANG KERAS menggunakan pengetahuan umum atau informasi di luar materi yang diberikan.
3. Setiap soal HARUS bisa dijawab dengan membaca materi yang diberikan saja.
4. Jika materi tidak cukup untuk membuat ${questionCount} soal, buat soal sebanyak mungkin yang bisa dibuat dari materi tersebut.
5. JANGAN mengarang fakta, angka, atau informasi yang tidak ada dalam materi.

${typeInstruction}
${difficultyInstruction}

===== MATERI DARI GURU (SATU-SATUNYA SUMBER SOAL) =====
${material}
===== AKHIR MATERI =====

Buatlah ${questionCount} soal berdasarkan HANYA materi di atas.

PENTING: Balas HANYA dengan JSON valid, tanpa markdown atau teks lain.
Format JSON:
{
  "questions": [
    {
      "question_text": "Teks soal lengkap dan jelas",
      "question_type": "MULTIPLE_CHOICE | MULTIPLE_ANSWER | TRUE_FALSE | SHORT_ANSWER | ESSAY",
      "options": ["opsi1", "opsi2", "opsi3", "opsi4"] (Gunakan null jika ESSAY / SHORT_ANSWER. Untuk TRUE_FALSE gunakan ["Benar", "Salah"]),
      "correct_answer": "A/B/C/D untuk pilihan ganda, [\"A\",\"C\"] untuk ganda kompleks, BENAR/SALAH untuk true-false, atau jawaban singkat untuk short-answer",
      "difficulty": "EASY/MEDIUM/HARD"
    }
  ]
}

PENTING untuk options:
- JANGAN sertakan huruf A/B/C/D di awal opsi
- Contoh SALAH: ["A. Jakarta", "B. Bandung"]
- Contoh BENAR: ["Jakarta", "Bandung"]

KONTEN KHUSUS:
📐 Jika materi mengandung MATEMATIKA: bungkus semua ekspresi matematika dalam $...$ (inline) atau $$...$$ (display). Contoh: "$\\\\log_2(x)$", "$\\\\int_0^1 f(x) \\\\, dx$", "$x^2 + 3x - 5 = 0$". Gunakan LaTeX: $\\\\sqrt{}$, $\\\\frac{}{}$, $\\\\pi$, dll.
🕌 Jika materi mengandung BAHASA ARAB: pertahankan teks Arab apa adanya termasuk harakat. Jangan transliterasi ke huruf latin.

Pastikan soal:
1. 100% berdasarkan materi yang diberikan, BUKAN dari pengetahuan AI
2. Bervariasi dalam topik (selama masih dalam materi)
3. Jelas dan tidak ambigu
4. Untuk pilihan ganda, pengecoh harus masuk akal tapi tetap berasal dari konteks materi`

        const result = await callGemini({ prompt, temperature: 0.3 })

        if (!result.ok) {
            return NextResponse.json({ error: result.error }, { status: 500 })
        }

        try {
            const parsed = parseGeminiJson(result.data!)
            // Post-process: fix AI-misclassified question types
            if (parsed.questions && Array.isArray(parsed.questions)) {
                parsed.questions = normalizeQuestionTypes(parsed.questions)
            }
            return NextResponse.json(parsed)
        } catch (parseError: any) {
            console.error('JSON parse error:', parseError?.message, 'Raw:', result.data?.substring(0, 300))
            return NextResponse.json({
                error: 'Gagal memproses respons AI',
                raw: result.data
            }, { status: 500 })
        }

    } catch (error: any) {
        console.error('Error generating questions:', error?.message || error)
        return NextResponse.json({ error: 'Server error: ' + (error?.message || 'Unknown') }, { status: 500 })
    }
}
