'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { driver, Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { tutorialDefinitions, TutorialDef, buildDriverSteps } from '@/lib/tutorialSteps'

const STORAGE_PREFIX = 'tutorial_done_'
const FAB_SEEN_KEY = 'tutorial_fab_seen'

export default function TutorialFAB() {
    const { user } = useAuth()
    const pathname = usePathname()
    const router = useRouter()
    const [tutorialEnabled, setTutorialEnabled] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
    const [fabSeen, setFabSeen] = useState(true)
    const [isRunning, setIsRunning] = useState(false)

    const [activeTutorialId, setActiveTutorialId] = useState<string | null>(null)
    const [settingsLoaded, setSettingsLoaded] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const fabRef = useRef<HTMLButtonElement>(null)
    const driverRef = useRef<Driver | null>(null)
    // Guards the pre-start window (mobile start is delayed ~600ms) against double-starts
    const startingRef = useRef(false)
    const isGuru = user?.role === 'GURU'

    // Fetch school settings
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await fetch('/api/school-settings')
                if (res.ok) {
                    const data = await res.json()
                    setTutorialEnabled(data.tutorial_enabled === true)
                }
            } catch {
                // silently fail
            } finally {
                setSettingsLoaded(true)
            }
        }
        if (user && isGuru) fetchSettings()
    }, [user, isGuru])

    // Load completed tutorials from localStorage
    useEffect(() => {
        try {
            const completed = new Set<string>()
            tutorialDefinitions.forEach(t => {
                if (localStorage.getItem(`${STORAGE_PREFIX}${t.id}`) === 'true') {
                    completed.add(t.id)
                }
            })
            setCompletedIds(completed)
            setFabSeen(localStorage.getItem(FAB_SEEN_KEY) === 'true')
        } catch {
            // localStorage unavailable (private browsing)
        }
    }, [])

    // Close menu on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                menuRef.current && !menuRef.current.contains(e.target as Node) &&
                fabRef.current && !fabRef.current.contains(e.target as Node)
            ) {
                setMenuOpen(false)
            }
        }
        if (menuOpen) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [menuOpen])

    const markComplete = useCallback((id: string) => {
        try {
            localStorage.setItem(`${STORAGE_PREFIX}${id}`, 'true')
        } catch { /* private browsing */ }
        setCompletedIds(prev => new Set([...prev, id]))
    }, [])

    // Use ref to avoid stale closures in event handlers
    const runTutorialRef = useRef<(tutorial: TutorialDef, startIndex?: number) => void>(() => {})

    const runTutorial = useCallback((tutorial: TutorialDef, startIndex = 0) => {
        // Block double-starts (a tutorial is already running, or a delayed
        // mobile start is still within its ~600ms pre-start window)
        if (driverRef.current || startingRef.current) return
        startingRef.current = true

        setMenuOpen(false)
        setIsRunning(true)
        setActiveTutorialId(tutorial.id)
        document.body.classList.add('driver-active')

        // Mark FAB as seen
        if (!fabSeen) {
            try { localStorage.setItem(FAB_SEEN_KEY, 'true') } catch { /* private browsing */ }
            setFabSeen(true)
        }

        const start = () => {
            // Build Driver.js steps from our interactive step definitions
            const driverSteps = buildDriverSteps(tutorial.steps, driverRef)

            const driverObj = driver({
                showProgress: true,
                showButtons: ['next', 'previous'],
                nextBtnText: 'Lanjut →',
                prevBtnText: '← Kembali',
                doneBtnText: 'Selesai ✓',
                progressText: '{{current}} / {{total}}',
                allowClose: false,
                overlayColor: 'black',
                overlayOpacity: 0.5,
                stagePadding: 4,
                stageRadius: 12,
                popoverClass: 'tutorial-popover',
                disableActiveInteraction: false,
                onPopoverRender: (popover) => {
                    // Add "Akhiri Tutorial" footer link to every popover
                    const footer = document.createElement('div')
                    footer.className = 'tutorial-exit-footer'
                    footer.innerHTML = '<button class="tutorial-exit-btn">✕ Akhiri Tutorial</button>'
                    footer.querySelector('button')!.addEventListener('click', (e) => {
                        e.stopPropagation()
                        const currentStepIndex = driverObj.getActiveIndex() ?? 0
                        // DESTROY driver first — remove ALL overlays
                        driverObj.destroy()
                        driverRef.current = null
                        document.body.classList.remove('driver-active')
                        // Show exit dialog on clean screen
                        showExitConfirm(tutorial, currentStepIndex)
                    })
                    popover.wrapper.appendChild(footer)
                },
                onDestroyStarted: () => {
                    if (driverObj.isLastStep()) {
                        markComplete(tutorial.id)
                        driverObj.destroy()
                        driverRef.current = null
                        setIsRunning(false)
                        setActiveTutorialId(null)
                        document.body.classList.remove('driver-active')
                        window.dispatchEvent(new CustomEvent('tutorial:close-bottom-nav'))
                    }
                    // Otherwise: block — only allow close via custom "Akhiri Tutorial" button
                },
                steps: driverSteps,
            })

            driverRef.current = driverObj
            startingRef.current = false // pre-start window over; driverRef now guards
            if (startIndex > 0) {
                driverObj.drive(startIndex)
            } else {
                driverObj.drive()
            }
        }

        // On mobile, the dashboard-intro nav steps highlight BottomNavigation items —
        // some live inside the collapsed arc menu, so open it first and wait for the animation
        const isMobile = window.innerWidth < 1024
        if (isMobile && tutorial.id === 'dashboard-intro' && startIndex === 0) {
            window.dispatchEvent(new CustomEvent('tutorial:open-bottom-nav'))
            setTimeout(start, 600)
        } else {
            start()
        }
    }, [fabSeen, markComplete])

    // Keep ref in sync so vanilla JS handlers always call the latest version
    useEffect(() => { runTutorialRef.current = runTutorial }, [runTutorial])

    // Show exit confirmation dialog (driver.js is already destroyed at this point)
    const showExitConfirm = useCallback((tutorial: TutorialDef, stepIndex: number) => {
        document.getElementById('tutorial-confirm-overlay')?.remove()

        const overlay = document.createElement('div')
        overlay.id = 'tutorial-confirm-overlay'
        overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:16px;'

        overlay.innerHTML = `
            <div style="background:white;border-radius:16px;max-width:384px;width:100%;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);font-family:system-ui,-apple-system,sans-serif">
                <div style="padding:24px;text-align:center">
                    <div style="width:56px;height:56px;border-radius:50%;background:#fef3c7;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
                        <span style="font-size:24px">⚠️</span>
                    </div>
                    <h3 style="font-size:18px;font-weight:bold;color:#27272a;margin:0 0 8px">Akhiri Tutorial?</h3>
                    <p style="font-size:14px;color:#71717a;margin:0;line-height:1.5">Tutorial belum selesai. Anda bisa mengulanginya kapan saja dari tombol tutorial.</p>
                </div>
                <div style="display:flex;border-top:1px solid #e4e4e7">
                    <button id="tcb-cancel" style="flex:1;padding:14px;font-size:14px;font-weight:600;color:#52525b;background:none;border:none;cursor:pointer;font-family:inherit;transition:background 0.15s">Lanjutkan</button>
                    <button id="tcb-confirm" style="flex:1;padding:14px;font-size:14px;font-weight:600;color:#ef4444;background:none;border:none;cursor:pointer;border-left:1px solid #e4e4e7;font-family:inherit;transition:background 0.15s">Ya, Akhiri</button>
                </div>
            </div>
        `

        // Hover effects
        const cancelBtn = overlay.querySelector('#tcb-cancel') as HTMLButtonElement
        const confirmBtn = overlay.querySelector('#tcb-confirm') as HTMLButtonElement
        cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = '#f4f4f5' })
        cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'none' })
        confirmBtn.addEventListener('mouseenter', () => { confirmBtn.style.background = '#fef2f2' })
        confirmBtn.addEventListener('mouseleave', () => { confirmBtn.style.background = 'none' })

        // "Lanjutkan" — use ref to always call latest runTutorial
        cancelBtn.addEventListener('click', () => {
            overlay.remove()
            runTutorialRef.current(tutorial, stepIndex)
        })

        // "Ya, Akhiri" — close tutorial completely
        confirmBtn.addEventListener('click', () => {
            overlay.remove()
            setIsRunning(false)
            setActiveTutorialId(null)
            window.dispatchEvent(new CustomEvent('tutorial:close-bottom-nav'))
        })

        document.body.appendChild(overlay)
    }, []) // No dependencies needed — uses ref for runTutorial

    // Check if pending tutorial should run after navigation
    useEffect(() => {
        let pendingId: string | null = null
        try { pendingId = sessionStorage.getItem('pending_tutorial') } catch { /* */ }
        if (pendingId) {
            try { sessionStorage.removeItem('pending_tutorial') } catch { /* */ }
            const timer = setTimeout(() => {
                const tutorial = tutorialDefinitions.find(t => t.id === pendingId)
                if (tutorial) {
                    runTutorial(tutorial)
                }
            }, 800)
            return () => clearTimeout(timer)
        }
    }, [pathname, runTutorial])

    const handleTutorialClick = useCallback((tutorial: TutorialDef) => {
        const isOnPage = tutorial.targetPage.endsWith('/')
            ? pathname.startsWith(tutorial.targetPage) && pathname !== tutorial.targetPage.slice(0, -1)
            : pathname === tutorial.targetPage

        const isOnMainPage = pathname === tutorial.targetPage

        if (tutorial.requiresDetailPage && !isOnPage) {
            return
        }

        if (isOnMainPage || isOnPage) {
            runTutorial(tutorial)
        } else {
            try { sessionStorage.setItem('pending_tutorial', tutorial.id) } catch { /* */ }
            router.push(tutorial.targetPage.endsWith('/') ? tutorial.targetPage.slice(0, -1) : tutorial.targetPage)
        }
    }, [pathname, router, runTutorial])

    const handleResetAll = useCallback(() => {
        try {
            tutorialDefinitions.forEach(t => {
                localStorage.removeItem(`${STORAGE_PREFIX}${t.id}`)
            })
        } catch { /* private browsing */ }
        setCompletedIds(new Set())
    }, [])

    const handleFabClick = () => {
        if (!fabSeen) {
            try { localStorage.setItem(FAB_SEEN_KEY, 'true') } catch { /* */ }
            setFabSeen(true)
        }
        setMenuOpen(!menuOpen)
    }

    // Don't render if not guru, not loaded, not enabled
    if (!isGuru || !settingsLoaded || !tutorialEnabled) return null

    const completedCount = completedIds.size
    const totalCount = tutorialDefinitions.length
    const allCompleted = completedCount === totalCount

    return (
        <>
            {/* Custom styles for Driver.js */}
            <style>{`
                .tutorial-popover {
                    background: white !important;
                    border-radius: 16px !important;
                    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25) !important;
                    max-width: 360px !important;
                    z-index: 100000 !important;
                }
                .tutorial-popover .driver-popover-title {
                    font-size: 17px !important;
                    font-weight: 800 !important;
                    color: #1a1a1a !important;
                    line-height: 1.4 !important;
                }
                .tutorial-popover .driver-popover-description {
                    font-size: 14px !important;
                    color: #444 !important;
                    line-height: 1.7 !important;
                    white-space: pre-line !important;
                }
                .tutorial-popover .driver-popover-progress-text {
                    font-size: 11px !important;
                    font-weight: 700 !important;
                    color: #999 !important;
                }
                .tutorial-popover .driver-popover-navigation-btns {
                    gap: 8px !important;
                }
                .tutorial-popover .driver-popover-next-btn {
                    background: #2E7D32 !important;
                    color: white !important;
                    border: none !important;
                    border-radius: 10px !important;
                    padding: 8px 20px !important;
                    font-weight: 700 !important;
                    font-size: 13px !important;
                    text-shadow: none !important;
                }
                .tutorial-popover .driver-popover-next-btn:hover {
                    background: #1B5E20 !important;
                }
                .tutorial-popover .driver-popover-prev-btn {
                    background: #f5f5f5 !important;
                    color: #333 !important;
                    border: 1px solid #ddd !important;
                    border-radius: 10px !important;
                    padding: 8px 20px !important;
                    font-weight: 700 !important;
                    font-size: 13px !important;
                    text-shadow: none !important;
                }
                .tutorial-popover .driver-popover-close-btn {
                    display: none !important;
                }
                .tutorial-exit-footer {
                    padding: 8px 16px 12px;
                    border-top: 1px solid rgba(0,0,0,0.08);
                    margin-top: 4px;
                    text-align: center;
                }
                .tutorial-exit-btn {
                    color: #999;
                    font-size: 12px;
                    font-weight: 600;
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 4px 12px;
                    border-radius: 6px;
                    transition: all 0.15s;
                }
                .tutorial-exit-btn:hover {
                    color: #e53e3e;
                    background: rgba(229,62,62,0.08);
                }
                .driver-active-element {
                    cursor: pointer !important;
                    z-index: 10003 !important;
                    box-shadow: inset 0 0 0 3px #2E7D32 !important;
                    outline: none !important;
                    scroll-margin: 20px !important;
                    animation: tutorial-pulse-ring 1.5s ease-in-out infinite !important;
                }
                @keyframes tutorial-pulse-ring {
                    0% { box-shadow: inset 0 0 0 3px #2E7D32, 0 0 0 0 rgba(46,125,50,0.4); }
                    70% { box-shadow: inset 0 0 0 3px #2E7D32, 0 0 0 8px rgba(46,125,50,0); }
                    100% { box-shadow: inset 0 0 0 3px #2E7D32, 0 0 0 0 rgba(46,125,50,0); }
                }
                /* Elevate modals and dropdowns above driver.js overlay when tutorial is active */
                body.driver-active .fixed.z-\\[60\\] {
                    z-index: 10002 !important;
                }
                body.driver-active .absolute.z-50 {
                    z-index: 10002 !important;
                }
                body.driver-active .fixed.inset-0.z-40 {
                    display: none !important;
                }
                /* In-modal dimming: dim all form fields except the highlighted one */
                body.driver-active .fixed.z-\\[60\\] [data-tutorial] {
                    opacity: 0.2 !important;
                    filter: grayscale(0.5) !important;
                    transition: all 0.3s ease !important;
                    scroll-margin: 20px !important;
                }
                body.driver-active .fixed.z-\\[60\\] [data-tutorial].driver-active-element,
                body.driver-active .fixed.z-\\[60\\] .driver-active-element,
                body.driver-active .fixed.z-\\[60\\] .driver-active-element [data-tutorial] {
                    opacity: 1 !important;
                    filter: none !important;
                    box-shadow: inset 0 0 0 3px #2E7D32 !important;
                    outline: none !important;
                    scroll-margin: 20px !important;
                }
                @media (prefers-color-scheme: dark) {
                    .tutorial-popover {
                        background: #1e1e2e !important;
                        border: 1px solid rgba(255,255,255,0.1) !important;
                    }
                    .tutorial-popover .driver-popover-title {
                        color: #fff !important;
                    }
                    .tutorial-popover .driver-popover-description {
                        color: #bbb !important;
                    }
                    .tutorial-popover .driver-popover-prev-btn {
                        background: #333 !important;
                        color: #ddd !important;
                        border-color: #555 !important;
                    }
                    .tutorial-exit-footer {
                        border-top-color: rgba(255,255,255,0.08);
                    }
                    .tutorial-exit-btn {
                        color: #666;
                    }
                    .tutorial-exit-btn:hover {
                        color: #fc8181;
                        background: rgba(252,129,129,0.1);
                    }
                }
                @keyframes tutorial-glow {
                    0%, 100% { box-shadow: 0 0 8px 2px rgba(46,125,50,0.3); }
                    50% { box-shadow: 0 0 20px 6px rgba(46,125,50,0.6); }
                }
                .tutorial-fab { bottom: calc(80px + 8px); }
                .tutorial-menu { bottom: calc(80px + 60px); }
                .tutorial-welcome { bottom: calc(80px + 70px); }
                @media (min-width: 1024px) {
                    .tutorial-fab { bottom: 24px; }
                    .tutorial-menu { bottom: 90px; }
                    .tutorial-welcome { bottom: 96px; }
                }
            `}</style>

            {/* Welcome banner — one-time nudge for new teachers (dashboard only) */}
            {!fabSeen && !isRunning && !menuOpen && pathname === '/dashboard/guru' && (
                <div
                    className="tutorial-welcome fixed z-[55] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 p-4 animate-in slide-in-from-bottom-2 fade-in duration-300"
                    style={{ right: '16px', width: '300px' }}
                >
                    <p className="font-bold text-zinc-800 dark:text-white text-sm">👋 Baru di sini?</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                        Ikuti tutorial singkat untuk mengenal fitur-fitur aplikasi — mulai dari dashboard sampai membuat kuis.
                    </p>
                    <div className="flex gap-2 mt-3">
                        <button
                            onClick={() => {
                                try { localStorage.setItem(FAB_SEEN_KEY, 'true') } catch { /* private browsing */ }
                                setFabSeen(true)
                            }}
                            className="flex-1 px-3 py-2 text-xs font-bold text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
                        >
                            Nanti Saja
                        </button>
                        <button
                            onClick={() => runTutorial(tutorialDefinitions[0])}
                            className="flex-1 px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors"
                        >
                            Mulai Tutorial 📚
                        </button>
                    </div>
                </div>
            )}

            {/* Menu Popup */}
            {menuOpen && (
                <div
                    ref={menuRef}
                    className="tutorial-menu fixed z-[55] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200"
                    style={{
                        right: '16px',
                        width: '320px',
                        maxHeight: '70vh',
                    }}
                >
                    {/* Menu Header */}
                    <div className="p-4 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white">
                        <h3 className="font-bold text-base">📚 Tutorial Guru</h3>
                        <p className="text-emerald-100 text-xs mt-1">
                            {allCompleted
                                ? 'Semua tutorial sudah selesai! 🎉'
                                : `${completedCount}/${totalCount} selesai`}
                        </p>
                        {/* Progress bar */}
                        <div className="mt-2 h-1.5 bg-emerald-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-white rounded-full transition-all duration-500"
                                style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
                            />
                        </div>
                    </div>

                    {/* Tutorial List */}
                    <div className="max-h-[50vh] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                        {tutorialDefinitions.map((tutorial) => {
                            const isCompleted = completedIds.has(tutorial.id)
                            const isDetailOnly = tutorial.requiresDetailPage && !(
                                tutorial.targetPage.endsWith('/')
                                    ? pathname.startsWith(tutorial.targetPage) && pathname !== tutorial.targetPage.slice(0, -1)
                                    : false
                            )
                            return (
                                <button
                                    key={tutorial.id}
                                    onClick={() => !isDetailOnly && handleTutorialClick(tutorial)}
                                    className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left border-b border-black/5 dark:border-white/5 last:border-b-0 ${
                                        isDetailOnly
                                            ? 'opacity-50 cursor-not-allowed'
                                            : 'hover:bg-emerald-50 dark:hover:bg-emerald-900/20 cursor-pointer'
                                    }`}
                                    title={isDetailOnly ? tutorial.description : ''}
                                >
                                    <span className="text-xl flex-shrink-0">{tutorial.icon}</span>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm font-bold ${isCompleted ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-800 dark:text-white'}`}>
                                            {tutorial.title}
                                        </p>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                            {tutorial.description}
                                        </p>
                                    </div>
                                    {isCompleted ? (
                                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs font-bold">✓</span>
                                    ) : (
                                        <span className="flex-shrink-0 text-zinc-300 dark:text-zinc-600">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </span>
                                    )}
                                </button>
                            )
                        })}
                    </div>

                    {/* Footer */}
                    {completedCount > 0 && (
                        <div className="p-3 border-t border-black/5 dark:border-white/5 bg-zinc-50 dark:bg-zinc-800/50">
                            <button
                                onClick={handleResetAll}
                                className="w-full text-xs text-zinc-500 hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400 font-medium transition-colors py-1"
                            >
                                🔄 Reset Semua Progress
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* FAB Button */}
            <button
                ref={fabRef}
                onClick={handleFabClick}
                className={`tutorial-fab fixed z-[55] w-14 h-14 rounded-full flex items-center justify-center text-2xl shadow-lg transition-all duration-300 hover:scale-110 active:scale-95 ${
                    menuOpen
                        ? 'bg-zinc-700 text-white shadow-zinc-500/30'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/40'
                }`}
                style={{
                    right: '16px',
                    animation: !fabSeen ? 'tutorial-glow 2s ease-in-out 3' : undefined,
                }}
                title="Tutorial"
            >
                {menuOpen ? '✕' : '📚'}

                {/* Unread badge */}
                {!menuOpen && completedCount < totalCount && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm">
                        {totalCount - completedCount}
                    </span>
                )}
            </button>
        </>
    )
}
