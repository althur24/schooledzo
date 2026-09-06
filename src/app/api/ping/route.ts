import { NextResponse } from 'next/server'

// Ping endpoint untuk indikator kualitas jaringan di header (useNetworkQuality).
// Sengaja zero-DB & tanpa auth-sensitive data — murni mengukur round-trip HTTP.
// Didaftarkan di PUBLIC_PATHS middleware agar hasil pengukuran tidak tercemar
// redirect 302 saat session kadaluarsa.
export const dynamic = 'force-dynamic'

export async function GET() {
    return NextResponse.json(
        { ok: true, timestamp: Date.now() },
        { headers: { 'Cache-Control': 'no-store' } }
    )
}
