'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { getNotificationIcon, timeAgo } from '@/lib/notifications'

interface Notification {
    id: string
    type: string
    title: string
    message: string | null
    link: string | null
    is_read: boolean
    created_at: string
}

export default function NotificationBell() {
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [isOpen, setIsOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    // Fetch notifications on mount and periodically (Page Visibility API + backoff on failure)
    useEffect(() => {
        let timeoutId: ReturnType<typeof setTimeout>
        let stopped = false
        let failCount = 0

        const POLL_INTERVAL = 60000 // 60s
        const MAX_INTERVAL = 5 * 60000 // back off up to 5 min when the server keeps failing

        const tick = async () => {
            const ok = await fetchNotifications()
            failCount = ok ? 0 : failCount + 1
            if (stopped) return
            // On repeated failure poll less often: 120s, 240s, then capped at 5 min
            const delay = failCount === 0 ? POLL_INTERVAL : Math.min(POLL_INTERVAL * 2 ** failCount, MAX_INTERVAL)
            timeoutId = setTimeout(tick, delay)
        }

        tick()

        // Pause polling when tab is hidden, resume when visible
        const handleVisibilityChange = () => {
            clearTimeout(timeoutId)
            if (!document.hidden) tick() // Refresh immediately when tab becomes visible
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            stopped = true
            clearTimeout(timeoutId)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [])

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const fetchNotifications = async (): Promise<boolean> => {
        try {
            const res = await fetch('/api/notifications?limit=10')
            if (res.ok) {
                const data = await res.json()
                setNotifications(data.notifications || [])
                setUnreadCount(data.unreadCount || 0)
                return true
            }
            console.warn(`Error fetching notifications: HTTP ${res.status}`)
            return false
        } catch (error) {
            console.warn('Error fetching notifications:', error instanceof Error ? error.message : error)
            return false
        }
    }

    const markAsRead = async (notificationId: string) => {
        try {
            await fetch('/api/notifications', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notification_id: notificationId })
            })
            setNotifications(prev =>
                prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
            )
            setUnreadCount(prev => Math.max(0, prev - 1))
        } catch (error) {
            console.error('Error marking notification as read:', error)
        }
    }

    const markAllAsRead = async () => {
        setLoading(true)
        try {
            await fetch('/api/notifications', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mark_all: true })
            })
            setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
            setUnreadCount(0)
        } catch (error) {
            console.error('Error marking all as read:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleNotificationClick = (notification: Notification) => {
        if (!notification.is_read) {
            markAsRead(notification.id)
        }
        setIsOpen(false)
    }

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 rounded-xl bg-secondary/10 hover:bg-secondary/20 text-text-secondary hover:text-text-main dark:hover:text-white transition-colors"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>

                {/* Badge */}
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {isOpen && (
                <>
                    {/* Mobile backdrop */}
                    <div
                        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 md:hidden"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Notification panel */}
                    <div className={`
                        fixed inset-x-0 top-20 mx-3 z-50
                        md:absolute md:inset-auto md:right-0 md:top-auto md:mt-2 md:mx-0 md:w-80
                        bg-white dark:bg-surface-dark border border-secondary/20 dark:border-white/10
                        rounded-2xl shadow-2xl overflow-hidden
                        animate-in fade-in slide-in-from-top-2 duration-200
                    `}>
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-secondary/20 dark:border-white/10">
                            <h3 className="font-semibold text-sm text-text-main dark:text-white">Notifikasi</h3>
                            <div className="flex items-center gap-3">
                                {unreadCount > 0 && (
                                    <button
                                        onClick={markAllAsRead}
                                        disabled={loading}
                                        className="text-xs text-primary hover:text-primary/80 disabled:opacity-50"
                                    >
                                        Tandai semua dibaca
                                    </button>
                                )}
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="md:hidden p-1 rounded-lg text-text-secondary hover:bg-secondary/10 transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* Notifications List */}
                        <div className="max-h-[60vh] md:max-h-80 overflow-y-auto">
                            {notifications.length === 0 ? (
                                <div className="p-8 text-center text-text-secondary">
                                    <div className="text-4xl mb-2">🔔</div>
                                    <p className="text-sm">Belum ada notifikasi</p>
                                </div>
                            ) : (
                                notifications.map((notification) => (
                                    notification.link ? (
                                        <Link
                                            key={notification.id}
                                            href={notification.link}
                                            onClick={() => handleNotificationClick(notification)}
                                            className={`block px-4 py-3 hover:bg-secondary/10 dark:hover:bg-white/5 transition-colors border-b border-secondary/10 dark:border-white/5 ${!notification.is_read ? 'bg-primary/5' : ''}`}
                                        >
                                            <div className="flex gap-3">
                                                <span className="text-lg flex-shrink-0">
                                                    {getNotificationIcon(notification.type as any)}
                                                </span>
                                                <div className="flex-1 min-w-0">
                                                    <p className={`text-sm leading-snug ${!notification.is_read ? 'text-text-main dark:text-white font-medium' : 'text-text-secondary dark:text-zinc-300'}`}>
                                                        {notification.title}
                                                    </p>
                                                    {notification.message && (
                                                        <p className="text-xs text-text-secondary dark:text-zinc-400 truncate mt-0.5">
                                                            {notification.message}
                                                        </p>
                                                    )}
                                                    <p className="text-xs text-text-secondary/70 dark:text-zinc-500 mt-1">
                                                        {timeAgo(notification.created_at)}
                                                    </p>
                                                </div>
                                                {!notification.is_read && (
                                                    <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-2"></span>
                                                )}
                                            </div>
                                        </Link>
                                    ) : (
                                        <div
                                            key={notification.id}
                                            onClick={() => handleNotificationClick(notification)}
                                            className={`px-4 py-3 cursor-pointer hover:bg-secondary/10 dark:hover:bg-white/5 transition-colors border-b border-secondary/10 dark:border-white/5 ${!notification.is_read ? 'bg-primary/5' : ''}`}
                                        >
                                            <div className="flex gap-3">
                                                <span className="text-lg flex-shrink-0">
                                                    {getNotificationIcon(notification.type as any)}
                                                </span>
                                                <div className="flex-1 min-w-0">
                                                    <p className={`text-sm leading-snug ${!notification.is_read ? 'text-text-main dark:text-white font-medium' : 'text-text-secondary dark:text-zinc-300'}`}>
                                                        {notification.title}
                                                    </p>
                                                    {notification.message && (
                                                        <p className="text-xs text-text-secondary dark:text-zinc-400 truncate mt-0.5">
                                                            {notification.message}
                                                        </p>
                                                    )}
                                                    <p className="text-xs text-text-secondary/70 dark:text-zinc-500 mt-1">
                                                        {timeAgo(notification.created_at)}
                                                    </p>
                                                </div>
                                                {!notification.is_read && (
                                                    <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-2"></span>
                                                )}
                                            </div>
                                        </div>
                                    )
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
