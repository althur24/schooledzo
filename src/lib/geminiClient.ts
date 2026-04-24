/**
 * Centralized Gemini API client with:
 * - Request queueing (max concurrent)
 * - Retry with exponential backoff
 * - Model fallback (if primary model hits 429, try alternate model)
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_BASE = `https://generativelanguage.googleapis.com/v1beta/models`

// Models to try in order (each has separate quota)
const MODELS = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
]

// --- Config ---
const MAX_CONCURRENT = 5
const MAX_RETRIES = 2           // Retries per model
const BASE_BACKOFF_MS = 3000
const QUEUE_TIMEOUT_MS = 60000

// --- State ---
let activeCount = 0
const waitQueue: Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }> = []

function releaseSlot() {
    activeCount--
    if (waitQueue.length > 0) {
        const next = waitQueue.shift()!
        clearTimeout(next.timer)
        next.resolve()
    }
}

async function acquireSlot(): Promise<void> {
    if (activeCount < MAX_CONCURRENT) {
        activeCount++
        return
    }

    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            const idx = waitQueue.findIndex(w => w.resolve === wrappedResolve)
            if (idx >= 0) waitQueue.splice(idx, 1)
            reject(new Error('Gemini queue timeout — terlalu banyak request bersamaan. Coba lagi nanti.'))
        }, QUEUE_TIMEOUT_MS)

        const wrappedResolve = () => {
            activeCount++
            resolve()
        }

        waitQueue.push({ resolve: wrappedResolve, timer })
    })
}

// --- Try a single model with retries ---
async function tryModel(
    model: string,
    body: string
): Promise<{ ok: boolean; data?: string; error?: string; is429?: boolean }> {
    let lastError = ''

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            const delay = attempt * BASE_BACKOFF_MS
            console.log(`[Gemini:${model}] Retry ${attempt + 1}/${MAX_RETRIES} after ${delay}ms...`)
            await new Promise(r => setTimeout(r, delay))
        }

        try {
            await acquireSlot()
        } catch (err: any) {
            return { ok: false, error: err.message }
        }

        try {
            const response = await fetch(
                `${GEMINI_BASE}/${model}:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body
                }
            )

            if (!response.ok) {
                const errorText = await response.text()
                lastError = `HTTP ${response.status}: ${errorText.substring(0, 200)}`
                console.error(`[Gemini:${model}] Attempt ${attempt + 1} failed:`, lastError)
                releaseSlot()

                if (response.status === 429) {
                    // Don't retry same model on 429 — let caller try fallback model
                    return { ok: false, error: lastError, is429: true }
                }
                if (response.status >= 500) continue // retry server errors
                return { ok: false, error: lastError }
            }

            const result = await response.json()
            releaseSlot()

            const textContent = result.candidates?.[0]?.content?.parts?.[0]?.text
            if (!textContent) {
                lastError = 'Empty response from Gemini'
                console.error(`[Gemini:${model}] ${lastError}`)
                continue
            }

            console.log(`[Gemini] Success using model: ${model}`)
            return { ok: true, data: textContent }
        } catch (err: any) {
            releaseSlot()
            lastError = err?.message || 'Network error'
            console.error(`[Gemini:${model}] Attempt ${attempt + 1} error:`, lastError)
        }
    }

    return { ok: false, error: lastError }
}

// --- Public API ---

export interface GeminiRequest {
    prompt: string
    temperature?: number
    maxOutputTokens?: number
    inlineData?: { mimeType: string; base64: string }
}

export interface GeminiResponse {
    ok: boolean
    data?: string
    error?: string
}

/**
 * Call Gemini API with automatic queueing, retry, and model fallback.
 * Tries models in order. If one returns 429, automatically switches to the next.
 */
export async function callGemini(req: GeminiRequest): Promise<GeminiResponse> {
    if (!GEMINI_API_KEY) {
        return { ok: false, error: 'Gemini API key not configured' }
    }

    const parts: any[] = [{ text: req.prompt }]
    if (req.inlineData) {
        parts.push({
            inline_data: {
                mime_type: req.inlineData.mimeType,
                data: req.inlineData.base64
            }
        })
    }

    const body = JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
            temperature: req.temperature ?? 0.1,
            maxOutputTokens: req.maxOutputTokens ?? 16384,
            responseMimeType: 'application/json',
        },
    })

    // Try each model in order
    let lastError = ''
    for (const model of MODELS) {
        const result = await tryModel(model, body)
        if (result.ok) {
            return { ok: true, data: result.data }
        }

        lastError = result.error || 'Unknown error'

        if (result.is429) {
            console.log(`[Gemini] Model ${model} rate limited, trying next model...`)
            continue // try next model
        }

        // For non-429 errors, don't try other models
        return { ok: false, error: lastError }
    }

    return { ok: false, error: `Semua model Gemini gagal. Error terakhir: ${lastError}` }
}
