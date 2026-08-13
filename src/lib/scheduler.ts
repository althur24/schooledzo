import { runNotificationJobsForActiveUsers } from './notificationJobs'
import { logError } from './logError'

const INTERVAL_MS = 10 * 60 * 1000 // 10 menit

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

    run() // sekali saat boot
    setInterval(run, INTERVAL_MS)
    console.log('[scheduler] notification jobs every 10 min')
}
