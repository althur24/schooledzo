/**
 * Concise error logging.
 *
 * Supabase/PostgREST errors can carry an entire HTML error page (e.g. a
 * Cloudflare 522 page) inside `error.message`. Logging those verbatim floods
 * the log drain (Railway drops messages past 500 lines/sec), so summarize.
 */
export function summarizeError(error: unknown): string {
    const err = error as { message?: unknown; code?: unknown } | null
    const code = typeof err?.code === 'string' ? err.code : null
    let message = typeof err?.message === 'string' ? err.message : String(error)

    // HTML error page (e.g. Cloudflare 5xx returned by the Supabase gateway)
    if (/<!doctype html|<html[\s>]/i.test(message)) {
        const title = message.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim()
        message = title ? `HTML error page: ${title}` : 'HTML error page (upstream unreachable)'
    } else if (message.length > 300) {
        message = `${message.slice(0, 300)}…`
    }

    return code ? `${message} (code: ${code})` : message
}

/** Logs `${context}: ${one-line summary}` — use instead of console.error(context, err) */
export function logError(context: string, error: unknown) {
    console.error(`${context}: ${summarizeError(error)}`)
}
