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

    // Fetch notifications on mount and periodically (with Page Visibility API)
    useEffect(() => {
        fetchNotifications()

        // Poll every 60 seconds (reduced from 30s)
        let interval = setInterval(fetchNotifications, 60000)

        // Pause polling when tab is hidden, resume when visible
        const handleVisibilityChange = () => {
            if (document.hidden) {
                clearInterval(interval)
            } else {
                fetchNotifications() // Refresh immediately when tab becomes visible
                interval = setInterval(fetchNotifications, 60000)
            }
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            clearInterval(interval)
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

    const fetchNotifications = async () => {
        try {
            const res = await fetch('/api/notifications?limit=10')
            if (res.ok) {
                const data = await res.json()
                setNotifications(data.notifications || [])
                setUnreadCount(data.unreadCount || 0)
            }
        } catch (error) {
            console.error('Error fetching notifications:', error)
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
                <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-surface-dark border border-secondary/20 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-secondary/20 dark:border-white/10">
                        <h3 className="font-semibold text-text-main dark:text-white">Notifikasi</h3>
                        {unreadCount > 0 && (
                            <button
                                onClick={markAllAsRead}
                                disabled={loading}
                                className="text-xs text-primary hover:text-primary/80 disabled:opacity-50"
                            >
                                Tandai semua dibaca
                            </button>
                        )}
                    </div>

                    {/* Notifications List */}
                    <div className="max-h-80 overflow-y-auto">
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
                                            <span className="text-xl flex-shrink-0">
                                                {getNotificationIcon(notification.type as any)}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm ${!notification.is_read ? 'text-text-main dark:text-white font-medium' : 'text-text-secondary dark:text-zinc-300'}`}>
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
                                            <span className="text-xl flex-shrink-0">
                                                {getNotificationIcon(notification.type as any)}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm ${!notification.is_read ? 'text-text-main dark:text-white font-medium' : 'text-text-secondary dark:text-zinc-300'}`}>
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
            )}
        </div>
    )
}
