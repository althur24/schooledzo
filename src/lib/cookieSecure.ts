import { NextRequest } from 'next/server'

/**
 * Cookie `Secure` flag berdasarkan protokol request aktual, bukan NODE_ENV.
 *
 * Mengapa bukan `NODE_ENV === 'production'`: mode `next start` (production
 * build) untuk testing lokal berjalan di HTTP — Safari menolak menyimpan
 * cookie ber-flag Secure di HTTP, sehingga login lokal selalu gagal 401
 * (cookie session tak pernah tersimpan). Sebaliknya di Railway, request
 * datang lewat reverse proxy HTTPS dengan header x-forwarded-proto: https.
 *
 * - x-forwarded-proto ada → ikuti nilai pertamanya ( Railway/proxy: 'https').
 * - tidak ada → lihat protokol request langsung (lokal http → false).
 */
export function isSecureRequest(request: NextRequest): boolean {
    const proto = request.headers.get('x-forwarded-proto')
    if (proto) return proto.split(',')[0].trim() === 'https'
    return request.nextUrl.protocol === 'https:'
}
