'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'

const ZOOM_LEVELS = [1, 1.25, 1.5]
const DOUBLE_TAP_MS = 300
const HINT_DURATION_MS = 6000
const ZOOM_ACTION_DEDUP_MS = 500

const isInteractiveTarget = (target: HTMLElement | null) =>
    !!target?.closest('button, input, textarea, select, audio, video, a, label')

export default function useExamZoom(enabled: boolean, hintActive = enabled) {
    const [zoomLevel, setZoomLevel] = useState(1)
    const [showHint, setShowHint] = useState(false)
    const lastTapAtRef = useRef(0)
    const lastZoomActionAtRef = useRef(0)

    // Hint tampil sekali saat siswa benar-benar mulai melihat soal (mis. setelah masuk
    // fullscreen / menutup modal resume), hilang otomatis atau begitu zoom dipakai.
    useEffect(() => {
        if (!hintActive) return
        setShowHint(true)
        const t = setTimeout(() => setShowHint(false), HINT_DURATION_MS)
        return () => {
            clearTimeout(t)
            setShowHint(false)
        }
    }, [hintActive])

    const dismissHint = useCallback(() => setShowHint(false), [])

    const zoomIn = useCallback(() => {
        dismissHint()
        setZoomLevel(prev => ZOOM_LEVELS.find(l => l > prev + 0.01) ?? prev)
    }, [dismissHint])

    const zoomOut = useCallback(() => {
        dismissHint()
        setZoomLevel(prev => {
            const candidates = ZOOM_LEVELS.filter(l => l < prev - 0.01)
            return candidates.length ? candidates[candidates.length - 1] : prev
        })
    }, [dismissHint])

    const cycleZoom = useCallback(() => {
        dismissHint()
        setZoomLevel(prev => {
            const idx = ZOOM_LEVELS.findIndex(l => Math.abs(l - prev) < 0.01)
            return ZOOM_LEVELS[(idx + 1) % ZOOM_LEVELS.length]
        })
    }, [dismissHint])

    const handleDoubleClick = useCallback((e: ReactMouseEvent<HTMLElement>) => {
        // Cegah seleksi teks bawaan browser saat double-klik
        e.preventDefault()
        if (isInteractiveTarget(e.target as HTMLElement)) return
        // Lewati dblclick sintetis yang menyusul double-tap sentuh (sudah ditangani)
        if (Date.now() - lastZoomActionAtRef.current < ZOOM_ACTION_DEDUP_MS) return
        lastZoomActionAtRef.current = Date.now()
        cycleZoom()
    }, [cycleZoom])

    // Fallback double-tap layar sentuh — event dblclick tidak reliable di iOS Safari,
    // jadi deteksi manual lewat jeda antar touchend.
    const handleTouchEnd = useCallback((e: ReactTouchEvent<HTMLElement>) => {
        // Multi-touch (pinch) bukan double-tap
        if (e.touches.length > 0) {
            lastTapAtRef.current = 0
            return
        }
        if (isInteractiveTarget(e.target as HTMLElement)) {
            lastTapAtRef.current = 0
            return
        }
        const now = Date.now()
        if (now - lastTapAtRef.current < DOUBLE_TAP_MS) {
            lastTapAtRef.current = 0
            // Cegah dblclick sintetis dobel + seleksi teks
            e.preventDefault()
            lastZoomActionAtRef.current = now
            cycleZoom()
        } else {
            lastTapAtRef.current = now
        }
    }, [cycleZoom])

    // Blokir zoom level browser (Ctrl/Cmd + +/-/0 dan Ctrl/Cmd + scroll/pinch trackpad)
    // selama ujian aktif — interaksi browser chrome memicu window blur yang salah
    // tercatat sebagai pelanggaran TAB_SWITCH.
    useEffect(() => {
        if (!enabled) return

        const isZoomShortcut = (e: KeyboardEvent) =>
            (e.ctrlKey || e.metaKey) && (
                ['+', '-', '=', '0'].includes(e.key) ||
                ['NumpadAdd', 'NumpadSubtract', 'Numpad0'].includes(e.code)
            )

        const handleKeyDown = (e: KeyboardEvent) => {
            if (isZoomShortcut(e)) e.preventDefault()
        }

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) e.preventDefault()
        }

        document.addEventListener('keydown', handleKeyDown)
        window.addEventListener('wheel', handleWheel, { passive: false })
        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('wheel', handleWheel)
        }
    }, [enabled])

    const canZoomIn = zoomLevel < ZOOM_LEVELS[ZOOM_LEVELS.length - 1] - 0.01
    const canZoomOut = zoomLevel > ZOOM_LEVELS[0] + 0.01

    return { zoomLevel, zoomIn, zoomOut, cycleZoom, handleDoubleClick, handleTouchEnd, canZoomIn, canZoomOut, showHint, dismissHint }
}
