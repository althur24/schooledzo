'use client'

import React from 'react'

interface Props {
    children: React.ReactNode
}

interface State {
    hasError: boolean
}

/**
 * ErrorBoundary untuk halaman editor soal — menangkap error render apa pun
 * (mis. chunk JS gagal dimuat setelah deploy) dan menampilkan jalan keluar
 * alih-alih layar putih polos.
 */
export default class EditorErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError(): State {
        return { hasError: true }
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('EditorErrorBoundary caught:', error, info)
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-[60vh] flex items-center justify-center p-6">
                    <div className="bg-white dark:bg-surface-dark border border-secondary/20 rounded-2xl p-8 max-w-sm w-full text-center shadow-xl">
                        <div className="w-16 h-16 bg-amber-500/15 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
                            ⚠️
                        </div>
                        <h2 className="text-xl font-bold text-text-main dark:text-white mb-2">
                            Tampilan Gagal Dimuat
                        </h2>
                        <p className="text-sm text-text-secondary mb-6">
                            Terjadi kesalahan saat menampilkan halaman ini — biasanya karena aplikasi baru saja diperbarui. Muat ulang untuk memperbaikinya. Pekerjaan yang sudah tersimpan tidak hilang.
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="w-full py-3 bg-primary hover:bg-primary-dark text-white font-bold rounded-xl transition-colors"
                        >
                            🔄 Muat Ulang Halaman
                        </button>
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}
