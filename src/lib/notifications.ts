// Notification helper for creating notifications when events happen

type NotificationType =
    | 'TUGAS_BARU'
    | 'KUIS_BARU'
    | 'ULANGAN_BARU'
    | 'NILAI_KELUAR'
    | 'SUBMISSION_BARU'
    | 'SUBMISSION_KUIS'
    | 'SUBMISSION_ULANGAN'
    | 'DEADLINE_REMINDER'
    | 'PENGUMUMAN'
    | 'REMEDIAL'
    | 'UJIAN_RESMI'
    | 'EXAM_REMINDER'
    | 'HOTS_REVIEW'

interface CreateNotificationParams {
    userIds: string[]
    type: NotificationType
    title: string
    message?: string
    link?: string
}

// Client-side helper to create notifications
export async function createNotification(params: CreateNotificationParams): Promise<boolean> {
    try {
        const res = await fetch('/api/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_ids: params.userIds,
                type: params.type,
                title: params.title,
                message: params.message,
                link: params.link
            })
        })
        return res.ok
    } catch (error) {
        console.error('Error creating notification:', error)
        return false
    }
}

// Get icon for notification type
export function getNotificationIcon(type: NotificationType): string {
    switch (type) {
        case 'TUGAS_BARU':
            return '📝'
        case 'KUIS_BARU':
            return '🎯'
        case 'ULANGAN_BARU':
            return '📋'
        case 'NILAI_KELUAR':
            return '📊'
        case 'SUBMISSION_BARU':
            return '📨'
        case 'SUBMISSION_KUIS':
            return '✅'
        case 'SUBMISSION_ULANGAN':
            return '📩'
        case 'DEADLINE_REMINDER':
            return '⏰'
        case 'PENGUMUMAN':
            return '📢'
        case 'REMEDIAL':
            return '🔄'
        case 'UJIAN_RESMI':
            return '🏫'
        case 'EXAM_REMINDER':
            return '⏰'
        case 'HOTS_REVIEW':
            return '🔬'
        default:
            return '🔔'
    }
}

// Format time ago
export function timeAgo(dateString: string): string {
    const now = new Date()
    const date = new Date(dateString)
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Baru saja'
    if (diffMins < 60) return `${diffMins} menit lalu`
    if (diffHours < 24) return `${diffHours} jam lalu`
    if (diffDays < 7) return `${diffDays} hari lalu`
    return date.toLocaleDateString('id-ID')
}
