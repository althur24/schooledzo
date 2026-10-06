'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Render bertahap untuk list panjang (±378 kartu ulangan di PIIS) —
 * DOM penuh dirender sekaligus membuat halaman tersendat walau data sudah
 * sampai. Hook ini menyediakan:
 *   - items  : irisan list yang dirender (24 kartu pertama, +28 per muatan)
 *   - sentinelRef : pasang di elemen div kosong di AKHIR list
 *   - hasMore / muatLagi : sisanya menyusul saat sentinel terlihat (scroll)
 * Tanpa dependency eksternal (IntersectionObserver bawaan browser).
 *
 * Pemanggil BOLEH mengoper array derived inline (tanpa useMemo): hook
 * menstabilkan identitas via signature konten (panjang + id elemen awal &
 * akhir). Array baru tiap render dengan isi sama → signature sama → tanpa
 * reset; isi benar-benar berubah (filter/refresh) → signature beda → reset
 * ke muatan pertama. Reset via setState-during-render (pola resmi React
 * "adjusting state when props change") dan KONVERGEN karena signature
 * deterministik dari data, bukan referensi.
 */
const FIRST_BATCH = 24
const NEXT_BATCH = 28

interface IncrementalState {
    sig: string
    visible: number
}

/** Signature konten yang stabil antar render bila ISI tidak berubah. */
function signatureOf<T>(list: T[]): string {
    if (list.length === 0) return '0'
    const first = list[0] as { id?: string } | undefined
    const last = list[list.length - 1] as { id?: string } | undefined
    return `${list.length}|${first?.id ?? ''}|${last?.id ?? ''}`
}

export function useIncrementalList<T>(list: T[]) {
    // useMemo ber-deps signature: identitas memoized stabil selama isi tak berubah.
    const sig = signatureOf(list)
    // list sengaja tidak di-deps: signature-lah kunci stabilisasinya (list inline
    // baru tiap render dgn isi sama tidak boleh mengganti identitas memo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const stableList = useMemo(() => list, [sig])

    const [state, setState] = useState<IncrementalState>({ sig, visible: FIRST_BATCH })

    // List berisi beda (filter/refresh) → kembali ke muatan pertama.
    // Konvergen: sig deterministik dari data — render berikutnya sig sama.
    if (state.sig !== sig) {
        setState({ sig, visible: FIRST_BATCH })
    }

    const sentinelRef = useRef<HTMLDivElement | null>(null)

    const loadMore = useCallback(() => {
        setState(prev => ({ ...prev, visible: prev.visible + NEXT_BATCH }))
    }, [])

    // hasMore ikut jadi deps: saat data pertama masuk (loading → hasMore true)
    // sentinel baru terpasang di DOM — tanpa re-run efek ini, observer tidak
    // pernah dibuat dan auto-load scroll tidak pernah aktif.
    const hasMore = list.length > state.visible
    useEffect(() => {
        const el = sentinelRef.current
        if (!el || typeof IntersectionObserver === 'undefined') return
        const observer = new IntersectionObserver((entries) => {
            if (entries.some(e => e.isIntersecting)) loadMore()
        }, { rootMargin: '400px' })
        observer.observe(el)
        return () => observer.disconnect()
    }, [loadMore, hasMore])

    const items = stableList.slice(0, Math.min(state.visible, stableList.length))

    return { items, sentinelRef, hasMore, visibleCount: state.visible, total: list.length, muatLagi: loadMore }
}
