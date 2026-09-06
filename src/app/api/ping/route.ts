import { NextResponse } from 'next/server'

// Ping endpoint untuk indikator kualitas jaringan di header (useNetworkQuality).
// Sengaja zero-DB & tanpa auth-sensitive data — murni mengukur round-trip HTTP.
// Didaftarkan di PUBLIC_PATHS middleware agar hasil pengukuran tidak tercemar
// redirect 302 saat session kadaluarsa.
export const dynamic = 'force-dynamic'

export async function GET() {
    return NextResponse.json(
        {
            ok: true,
            timestamp: Date.now(),
            // UV_THREADPOOL_SIZE dibaca libuv saat proses Node start — kalau
            // nilainya terlihat di sini, threadpool berjalan dengan ukuran itu.
            // null = tidak diset (default libuv = 4 thread → login serentak ~50/dtk).
            runtime: {
                uv_threadpool_size: process.env.UV_THREADPOOL_SIZE || null,
                node: process.version,
            },
        },
        { headers: { 'Cache-Control': 'no-store' } }
    )
}
