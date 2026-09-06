import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * r2 — akses Cloudflare R2 (S3-compatible) untuk file materi.
 *
 * Upload baru materi disimpan di R2 (egress gratis), file lama tetap
 * disajikan dari Supabase Storage. Metadata tetap di Postgres/Supabase.
 *
 * Fail-fast: tanpa kredensial R2, route upload harus error eksplisit —
 * bukan diam-diam fallback ke anon (selaras konvensi src/lib/supabase.ts).
 */
if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET) {
    throw new Error('Env R2 tidak lengkap — butuh R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.')
}

export const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL!

const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
})

const R2_BUCKET = process.env.R2_BUCKET

/** Presigned URL untuk upload langsung client→R2 (PUT, default umur 10 menit). */
export async function presignR2PutUrl(key: string, contentType: string, expiresIn = 600): Promise<string> {
    const command = new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        ContentType: contentType,
    })
    return getSignedUrl(r2Client, command, { expiresIn })
}

/** URL publik file R2 via custom domain (bucket custom domain aktif). */
export function publicR2Url(key: string): string {
    return encodeURI(`${R2_PUBLIC_BASE_URL}/${key}`)
}

/** Hapus object R2 — dipakai cleanup file (jika diperlukan nanti). */
export async function deleteR2Object(key: string): Promise<void> {
    await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }))
}
