/**
 * MONITOR POLLER ULANGAN — guru polling Monitor Live (mode ulangan/batch)
 * tiap 15 dtk selama run k6 ulangan_load.js berjalan.
 *
 * Ini bukti KESEHATAN SISI SERVER (doktrin CLAUDE.md 25 Sep: http_req_failed
 * k6 2-4% dari hotspot = artefak klien; kalau poll ini 200 & cepat SELAMA
 * burst, server terbukti sehat). Sekaligus mengukur hipotesis "banyak guru
 * membuka monitor live saat ulangan".
 *
 * Prasyarat: seed_loadtest.cjs + seed_ulangan_loadtest.cjs (token guru ulg).
 * Jalankan (paralel dgn k6):
 *   ENV_FILE=.env.staging LOAD_BASE=https://<railway> \
 *     MINUTES=25 node loadtest/e2e/monitor_poll_ulangan.cjs
 */
require('./helpers.cjs').loadEnvGuarded()
const GURU_TOKEN = 'lt_guru_ulg_token_0001'
const EXAM_1 = '7e578900-0000-0000-0000-000000000001'
const BASE = process.env.LOAD_BASE || 'http://localhost:3000'
const MINUTES = parseInt(process.env.MINUTES || '25', 10)
const POLL_MS = 15_000

async function main() {
    console.log(`monitor ulangan → ${BASE} tiap ${POLL_MS / 1000}s selama ${MINUTES} mnt`)
    const stopAt = Date.now() + MINUTES * 60_000
    const lat = []
    let n = 0, bad = 0
    while (Date.now() < stopAt) {
        const t0 = Date.now()
        try {
            const res = await fetch(`${BASE}/api/exam-submissions/monitor?exam_id=${EXAM_1}&batch=1`, {
                headers: { Cookie: `session_token=${GURU_TOKEN}` },
                signal: AbortSignal.timeout(30_000),
            })
            const ms = Date.now() - t0
            n++
            if (res.status !== 200) {
                bad++
                console.log(`poll #${n}: status ${res.status} (${ms}ms) — SISIS SERVER BERMASALAH`)
            } else {
                lat.push(ms)
                if (n % 4 === 0) {
                    const j = await res.json().catch(() => null)
                    console.log(`poll #${n}: ${ms}ms | target ${j?.summary?.total_target_students ?? '?'} · kerjakan ${j?.summary?.working ?? '?'} · selesai ${j?.summary?.submitted ?? '?'}`)
                }
            }
        } catch (e) {
            n++; bad++
            console.log(`poll #${n}: ERROR ${e.message} — SISI SERVER BERMASALAH`)
        }
        await new Promise(r => setTimeout(r, POLL_MS))
    }
    const s = [...lat].sort((a, b) => a - b)
    const pct = (p) => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : -1
    console.log(`\nMONITOR POLL RINGKASAN: ${n} poll · gagal=${bad} · p50=${pct(0.5)}ms p95=${pct(0.95)}ms max=${s[s.length - 1] ?? -1}ms`)
    console.log(bad === 0 ? 'SISI SERVER SEHAT SEPANJANG RUN ✅' : `⚠ ${bad} poll gagal — selidiki log Railway`)
    process.exit(bad === 0 ? 0 : 1)
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
