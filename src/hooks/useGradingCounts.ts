'use client'

import { useEffect, useState } from 'react'

export interface GradingCounts {
    tugas: number
    kuis: number
    ulangan: number
    utsUas: number
}

export interface GradingItem {
    type: string
    id: string
    title: string
    class_name: string
    subject_name: string
    submitted_count: number
    ungraded_count: number
}

const EMPTY_COUNTS: GradingCounts = { tugas: 0, kuis: 0, ulangan: 0, utsUas: 0 }

// Poller tunggal yang dibagi ke semua subscriber (Sidebar, BottomNavigation,
// dashboard). Mencegah double-fetch saat beberapa komponen mount bersamaan.
let cachedCounts: GradingCounts = EMPTY_COUNTS
let cachedItems: GradingItem[] = []
let hasLoaded = false

const listeners = new Set<() => void>()
let subscriberCount = 0
let intervalId: ReturnType<typeof setInterval> | null = null

function emit() {
    listeners.forEach((listener) => listener())
}

async function fetchOverview() {
    try {
        const res = await fetch('/api/dashboard/guru/grading-overview')
        if (!res.ok) return
        const data = await res.json()
        if (data?.counts) {
            cachedCounts = data.counts
            cachedItems = Array.isArray(data.items) ? data.items : []
            hasLoaded = true
            emit()
        }
    } catch {
        // Gagal fetch → biarkan angka lama; badge cukup tidak tampil.
    }
}

function startPolling() {
    if (intervalId !== null) return
    // Reset cache saat poller hidup kembali (subscriber pertama setelah semua
    // lepas — biasanya sesi/guru baru; logout tidak reload halaman). Mencegah
    // badge guru sebelumnya ter-flash ke guru berikutnya sebelum fetch segar.
    cachedCounts = EMPTY_COUNTS
    cachedItems = []
    hasLoaded = false
    emit()
    fetchOverview()
    intervalId = setInterval(fetchOverview, 60_000)
}

function stopPolling() {
    if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
    }
}

/**
 * Ringkasan beban koreksi guru. `enabled` biasanya diisi `user?.role === 'GURU'`.
 * Satu poller per 60 detik dibagi ke semua pemakai hook.
 */
export function useGradingCounts(enabled: boolean) {
    const [counts, setCounts] = useState<GradingCounts>(cachedCounts)
    const [items, setItems] = useState<GradingItem[]>(cachedItems)
    const [loaded, setLoaded] = useState(hasLoaded)

    useEffect(() => {
        if (!enabled) return

        const listener = () => {
            setCounts(cachedCounts)
            setItems(cachedItems)
            setLoaded(hasLoaded)
        }
        listeners.add(listener)
        subscriberCount += 1
        startPolling()
        listener()

        return () => {
            listeners.delete(listener)
            subscriberCount -= 1
            if (subscriberCount <= 0) stopPolling()
        }
    }, [enabled])

    return { counts, items, loaded }
}
