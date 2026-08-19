import { runNotificationJobsForActiveUsers } from './notificationJobs'
import { closeExpiredSubmissions } from './autoCloseExpired'
import { logError } from './logError'

const INTERVAL_MS = 10 * 60 * 1000 // 10 menit
const SWEEP_INTERVAL_MS = 60 * 1000 // 1 menit — sweep submission kedaluwarsa

let started = false

/**
 * Scheduler in-process untuk job background. Railway menjalankan `next start`
 * sebagai proses Node persisten, jadi setInterval di sini aman.
 * Set DISABLE_JOBS=1 untuk mematikan tanpa deploy (debug/rollback).
 */
export function startScheduler() {
    if (started || process.env.DISABLE_JOBS === '1') return
    started = true

    const run = () => runNotificationJobsForActiveUsers().catch(e => logError('Scheduler error', e))
    // Sweep aktif: tutup submission yang lewat batas waktu tanpa menunggu guru buka monitor.
    // Idempoten & discovery dibatasi per tick — aman dipanggil sesering ini.
    const sweep = () => closeExpiredSubmissions().catch(e => logError('Auto-close sweep error', e))

    run() // sekali saat boot
    setInterval(run, INTERVAL_MS)
    sweep() // sekali saat boot
    setInterval(sweep, SWEEP_INTERVAL_MS)
    console.log('[scheduler] notification jobs every 10 min; auto-close sweep every 1 min')
}
