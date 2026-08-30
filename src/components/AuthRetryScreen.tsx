'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface AuthRetryScreenProps {
    onRetry: () => Promise<void> | void
}

export default function AuthRetryScreen({ onRetry }: AuthRetryScreenProps) {
    const [retrying, setRetrying] = useState(false)

    const handleRetry = async () => {
        setRetrying(true)
        try {
            await onRetry()
        } finally {
            setRetrying(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#D4E0D2]">
            <div className="flex flex-col items-center gap-4 text-center px-6 max-w-sm">
                <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
                    <svg className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <p className="font-semibold text-text-main">Koneksi bermasalah</p>
                <p className="text-sm text-text-main/70">
                    Tidak dapat memverifikasi sesi Anda. Periksa koneksi internet lalu coba lagi.
                </p>
                <button
                    onClick={handleRetry}
                    disabled={retrying}
                    className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold transition-colors disabled:opacity-70"
                >
                    <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
                    {retrying ? 'Memproses...' : 'Coba lagi'}
                </button>
            </div>
        </div>
    )
}
