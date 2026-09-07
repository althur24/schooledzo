/**
 * Validasi bentuk daftar lampiran (JSONB) sebelum disimpan ke DB.
 *
 * Lampiran dirender client sebagai <a href>/<img src> — URL sembarang
 * (javascript:, data:) adalah vektor XSS. Wajib http(s) di sisi server
 * karena client-side check bisa dilewati dengan request API langsung.
 *
 * Bentuk valid (selaras SubmissionAttachment): array of
 * { url: string (http/https), name: string, type?: string, size?: number }.
 */

export type AttachmentValidation =
    | { ok: true; value: any[] | null }
    | { ok: false }

export function validateAttachments(value: unknown, maxItems = 10): AttachmentValidation {
    if (value === null || value === undefined) return { ok: true, value: null }
    if (!Array.isArray(value)) return { ok: false }
    if (value.length > maxItems) return { ok: false }

    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false }
        const { url, name } = item as { url?: unknown; name?: unknown }
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false }
        if (typeof name !== 'string' || name.length === 0) return { ok: false }
    }
    return { ok: true, value: value as any[] }
}
