/**
 * MONITOR ULANGAN/UTS-UAS — pemantau performa read-only saat ujian berjalan.
 *
 * Tidak mengganggu ujian: hanya membaca DB (service-role) + health HTTP.
 * Tidak memanggil endpoint tulis apa pun.
 *
 * Tampilkan tiap interval:
 *  - Health production: /api/schools/public, /api/ping (status + latensi)
 *  - Per ujian: total siswa target, submission masuk, sedang mengerjakan,
 *    sudah submit, belum mulai, jumlah jawaban tersimpan, rata-rata progres
 *  - Alert bila: health gagal/lambat, ada submission stuck (kerja > durasi+15mnt),
 *    atau ada submit dengan 0 jawaban (indikasi kehilangan data)
 *
 * Pemakaian:
 *   # pantau semua ujian aktif hari ini di satu sekolah
 *   ENV_FILE=.env.local node scripts/monitor-ujian.cjs --school piis --interval 60 --minutes 75
 *   # pantau ujian tertentu (id)
 *   ENV_FILE=.env.local node scripts/monitor-ujian.cjs --official <examId> --interval 30
 *   # pantau ulangan (id)
 *   ENV_FILE=.env.local node scripts/monitor-ujian.cjs --exam <examId>
 *
 * Env: ENV_FILE (.env.local production / .env.staging), MON_BASE (URL app)
 */
require('./../loadtest/e2e/helpers.cjs').loadEnvGuarded()
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const args = process.argv.slice(2)
function arg(name, def) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def }
const SCHOOL_CODE = arg('school', null)
const OFFICIAL_ID = arg('official', null)
const EXAM_ID = arg('exam', null)
const INTERVAL = parseInt(arg('interval', '60'), 10) * 1000
const MINUTES = parseInt(arg('minutes', '75'), 10)
// Default: HANYA ujian yang sedang berjalan (start <= now <= end) → monitor ringan
// & tidak memindai ujian lama yang masih "terbuka". --all untuk semua yang relevan.
const ONLY_RUNNING = !args.includes('--all')
const BASE = process.env.MON_BASE || (process.env.ENV_FILE === '.env.staging'
    ? 'https://schooledzo-production-e036.up.railway.app'
    : 'https://hippocampus.educationzone.id')
const ONCE = args.includes('--once')

const fmt = (ms) => ms === null || ms === undefined ? '-' : `${Math.round(ms)}ms`
const t = () => new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })

let alerts = 0
const log = (...a) => console.log(`[${t()}]`, ...a)

async function httpHealth(path) {
    const t0 = Date.now()
    try {
        const res = await fetch(BASE + path, { signal: AbortSignal.timeout(20000) })
        return { status: res.status, ms: Date.now() - t0 }
    } catch (e) { return { status: 0, ms: Date.now() - t0, err: e.name } }
}

async function resolveOfficialExamIds() {
    if (OFFICIAL_ID) return [OFFICIAL_ID]
    // Hanya ujian yang JENDELANYA relevan sekarang (hindari 100+ ujian lama aktif).
    // Window: start <= now+30mnt DAN (window_end >= now-6jam ATAU tanpa window & start >= now-6jam)
    const now = Date.now()
    const soon = new Date(now + 30 * 60000).toISOString()
    const floor = new Date(now - 3 * 3600000).toISOString()
    let q = supabase.from('official_exams')
        .select('id,start_time,window_end_time')
        .eq('is_active', true)
        .lte('start_time', soon)
        .order('start_time', { ascending: false })
        .limit(50)
    if (SCHOOL_CODE) {
        const { data: sch } = await supabase.from('schools').select('id').eq('code', SCHOOL_CODE).maybeSingle()
        if (sch) q = q.eq('school_id', sch.id)
    }
    const { data } = await q
    return (data || []).filter(e => {
        const end = e.window_end_time ? new Date(e.window_end_time).getTime() : null
        const start = new Date(e.start_time).getTime()
        if (ONLY_RUNNING) {
            if (start > now) return false
            // Tanpa window_end: hanya ujian yang baru mulai (<= 60 mnt) → hindari
            // memindai ujian lama tanpa batas yang masih is_active.
            if (end !== null) return end >= now - 30 * 60000
            return start >= now - 60 * 60000
        }
        return end !== null ? end >= now - 30 * 60000 : start >= now - 3 * 3600000
    }).map(e => e.id)
}

async function resolveExamIds() {
    if (EXAM_ID) return [EXAM_ID]
    // Bila mode --official (pantau 1 UTS/UAS), jangan pindai ulangan (fokus & ringan).
    if (OFFICIAL_ID) return []
    // Ulangan aktif: butuh TA untuk filter sekolah (exams tak punya school_id langsung)
    let taIds = null
    if (SCHOOL_CODE) {
        const { data: sch } = await supabase.from('schools').select('id').eq('code', SCHOOL_CODE).maybeSingle()
        if (sch) {
            const { data: tas } = await supabase.from('teaching_assignments')
                .select('id,teacher:teachers(school_id)').order('id').limit(2000)
            taIds = (tas || []).filter(x => { const tt = Array.isArray(x.teacher) ? x.teacher[0] : x.teacher; return tt?.school_id === sch.id }).map(x => x.id)
            if (taIds.length === 0) return []
        }
    }
    const now = Date.now()
    const soon = new Date(now + 30 * 60000).toISOString()
    const floor = new Date(now - 3 * 3600000).toISOString()
    let q = supabase.from('exams').select('id,start_time,window_end_time')
        .eq('is_active', true).lte('start_time', soon).order('start_time', { ascending: false }).limit(50)
    if (taIds) q = q.in('teaching_assignment_id', taIds)
    const { data } = await q
    return (data || []).filter(e => {
        const end = e.window_end_time ? new Date(e.window_end_time).getTime() : null
        const start = new Date(e.start_time).getTime()
        if (ONLY_RUNNING) {
            if (start > now) return false
            if (end !== null) return end >= now - 30 * 60000
            return start >= now - 2 * 3600000
        }
        return end !== null ? end >= now - 30 * 60000 : start >= now - 3 * 3600000
    }).map(e => e.id)
}

async function statOfficial(examId) {
    const { data: ex } = await supabase.from('official_exams')
        .select('id,title,exam_type,duration_minutes,start_time,window_end_time,target_class_ids').eq('id', examId).single()
    if (!ex) return null
    const { data: subs } = await supabase.from('official_exam_submissions')
        .select('id,student_id,is_submitted,started_at,submitted_at,timer_override_until').eq('exam_id', examId)
    const ids = (subs || []).map(s => s.id)
    let answers = 0
    for (let i = 0; i < ids.length; i += 100) {
        const { count } = await supabase.from('official_exam_answers').select('id', { count: 'exact', head: true }).in('submission_id', ids.slice(i, i + 100))
        answers += (count || 0)
    }
    const now = Date.now()
    const durMs = (ex.duration_minutes || 0) * 60000
    const working = (subs || []).filter(s => !s.is_submitted && s.started_at)
    const submitted = (subs || []).filter(s => s.is_submitted)
    const notStarted = (subs || []).filter(s => !s.started_at)
    // stuck: kerja > durasi + 15 mnt tapi belum submit (patokan timer_override jika ada)
    const stuck = working.filter(s => {
        const end = s.timer_override_until ? new Date(s.timer_override_until).getTime()
            : (ex.window_end_time ? new Date(ex.window_end_time).getTime() : new Date(s.started_at).getTime() + durMs)
        return now > end + 15 * 60000
    })
    const zeroAnsSubmitted = []
    // Hanya periksa submission yang BARU submit (1 jam terakhir) — relevan untuk
    // memantau live & jauh lebih murah (hindari puluhan query ke data historis).
    const recent = submitted.filter(s => s.submitted_at && (now - new Date(s.submitted_at).getTime()) < 3600000)
    for (const s of recent.slice(0, 15)) {
        const { count } = await supabase.from('official_exam_answers').select('id', { count: 'exact', head: true }).eq('submission_id', s.id)
        if ((count || 0) === 0) zeroAnsSubmitted.push(s.id)
    }
    return { kind: 'OFFICIAL', ex, total: (subs || []).length, working: working.length, submitted: submitted.length, notStarted: notStarted.length, answers, stuck: stuck.length, zeroAns: zeroAnsSubmitted.length }
}

async function statExam(examId) {
    const { data: ex } = await supabase.from('exams')
        .select('id,title,duration_minutes,start_time,window_end_time').eq('id', examId).single()
    if (!ex) return null
    const { data: subs } = await supabase.from('exam_submissions')
        .select('id,student_id,is_submitted,started_at,submitted_at,timer_override_until').eq('exam_id', examId)
    const ids = (subs || []).map(s => s.id)
    let answers = 0
    for (let i = 0; i < ids.length; i += 100) {
        const { count } = await supabase.from('exam_answers').select('id', { count: 'exact', head: true }).in('submission_id', ids.slice(i, i + 100))
        answers += (count || 0)
    }
    const now = Date.now(); const durMs = (ex.duration_minutes || 0) * 60000
    const working = (subs || []).filter(s => !s.is_submitted && s.started_at)
    const submitted = (subs || []).filter(s => s.is_submitted)
    const stuck = working.filter(s => {
        const end = s.timer_override_until ? new Date(s.timer_override_until).getTime()
            : (ex.window_end_time ? new Date(ex.window_end_time).getTime() : new Date(s.started_at).getTime() + durMs)
        return now > end + 15 * 60000
    })
    let zeroAns = 0
    const recentEx = submitted.filter(s => s.submitted_at && (now - new Date(s.submitted_at).getTime()) < 3600000)
    for (const s of recentEx.slice(0, 15)) {
        const { count } = await supabase.from('exam_answers').select('id', { count: 'exact', head: true }).eq('submission_id', s.id)
        if ((count || 0) === 0) zeroAns++
    }
    return { kind: 'ULANGAN', ex, total: (subs || []).length, working: working.length, submitted: submitted.length, notStarted: (subs || []).filter(s => !s.started_at).length, answers, stuck: stuck.length, zeroAns }
}

function renderStat(r) {
    if (!r) return
    const now = Date.now()
    const start = r.ex.start_time ? new Date(r.ex.start_time).getTime() : null
    const end = r.ex.window_end_time ? new Date(r.ex.window_end_time).getTime() : null
    let status = 'BERJALAN'
    if (start && now < start) status = 'BELUM MULAI'
    else if (end && now > end) status = 'TUTUP'
    const label = `${r.kind} [${status}] ${r.ex.title.slice(0, 40)}`
    log(`  ${label} | total=${r.total} kerja=${r.working} submit=${r.submitted} belum=${r.notStarted} jawaban=${r.answers}`)
    if (r.stuck > 0) { alerts++; log(`    ⚠ ${r.stuck} submission "stuck" (lewat batas >15mnt, belum submit)`) }
    if (r.zeroAns > 0) { alerts++; log(`    ⚠ ${r.zeroAns} submission submit TANPA jawaban (indikasi kehilangan data / siswa tak menjawab)`) }
}

async function tick() {
    const schools = await httpHealth('/api/schools/public')
    const ping = await httpHealth('/api/ping')
    log(`HEALTH schools=${schools.status} ${fmt(schools.ms)} | ping=${ping.status} ${fmt(ping.ms)}`)
    if (schools.status !== 200 || ping.status !== 200) { alerts++; log('    ⚠ HEALTH BERMASALAH') }
    if (ping.ms > 2000) { alerts++; log(`    ⚠ ping lambat (${fmt(ping.ms)})`) }

    const offIds = await resolveOfficialExamIds()
    const exIds = await resolveExamIds()
    if (offIds.length === 0 && exIds.length === 0) log('  (tidak ada ujian aktif)')
    for (const id of offIds) { try { renderStat(await statOfficial(id)) } catch (e) { log('  err official', id.slice(0, 8), e.message) } }
    for (const id of exIds) { try { renderStat(await statExam(id)) } catch (e) { log('  err exam', id.slice(0, 8), e.message) } }
}

async function main() {
    log(`MONITOR UJIAN → ${BASE} | interval ${INTERVAL / 1000}s | durasi ${MINUTES}m${ONCE ? ' (sekali)' : ''}`)
    log(`scope: ${SCHOOL_CODE ? 'sekolah ' + SCHOOL_CODE : ''}${OFFICIAL_ID ? ' official ' + OFFICIAL_ID.slice(0, 8) : ''}${EXAM_ID ? ' exam ' + EXAM_ID.slice(0, 8) : ''}`)
    const stopAt = Date.now() + MINUTES * 60000
    let n = 0
    while (true) {
        n++
        log(`───── poll #${n} ─────`)
        try { await tick() } catch (e) { log('  FATAL tick:', e.message); alerts++ }
        if (ONCE || Date.now() >= stopAt) break
        await new Promise(r => setTimeout(r, INTERVAL))
    }
    log(`SELESAI · ${n} poll · alert=${alerts}`)
    process.exit(alerts === 0 ? 0 : 1)
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
