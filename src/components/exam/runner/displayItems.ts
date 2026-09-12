import type { RunnerQuestion } from './types'

export type DisplayItem =
    | { type: 'standalone'; question: RunnerQuestion; questionNumbers: number[] }
    | { type: 'audio_group'; audioUrl: string; passageText?: string | null; questions: RunnerQuestion[]; questionNumbers: number[] }

/**
 * Bangun unit tampilan ujian: soal ber-audio dikelompokkan per passage_audio_url
 * (kartu Listening), sisanya standalone. Penomoran soal mengikuti urutan asli
 * (group audio menempati nomor urut soal-soal anggotanya).
 *
 * Sebelumnya logika ini diduplikasi 3× dengan perilaku berbeda-beda
 * (ulangan 2-pass in-order, kuis splice-insert, hasil kuis groupByPassage).
 */
export function buildDisplayItems(questions: RunnerQuestion[]): DisplayItem[] {
    const displayItems: DisplayItem[] = []
    const audioGroupMap = new Map<string, { audioUrl: string; passageText?: string | null; questions: RunnerQuestion[] }>()
    const processedAudioUrls = new Set<string>()

    // Pass 1: identifikasi audio group
    questions.forEach(q => {
        if (q.passage_audio_url) {
            const key = q.passage_audio_url
            if (!audioGroupMap.has(key)) {
                audioGroupMap.set(key, { audioUrl: q.passage_audio_url, passageText: q.passage_text, questions: [] })
            }
            audioGroupMap.get(key)!.questions.push(q)
        }
    })

    // Pass 2: susun item sesuai urutan soal asli
    let questionNumber = 0
    questions.forEach(q => {
        if (q.passage_audio_url) {
            if (!processedAudioUrls.has(q.passage_audio_url)) {
                processedAudioUrls.add(q.passage_audio_url)
                const group = audioGroupMap.get(q.passage_audio_url)!
                const nums: number[] = []
                group.questions.forEach(() => {
                    questionNumber++
                    nums.push(questionNumber)
                })
                displayItems.push({ type: 'audio_group', ...group, questionNumbers: nums })
            }
        } else {
            questionNumber++
            displayItems.push({ type: 'standalone', question: q, questionNumbers: [questionNumber] })
        }
    })

    return displayItems
}
