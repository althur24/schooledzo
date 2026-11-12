// ============================================================
// LOAD TEST k6 — 1500 SISWA MASUK ULANGAN BERSAMAAN
// ============================================================
// Mempersempit skenario nyata "bel berbunyi 07:30": semua siswa menekan
// "Mulai Ulangan" hampir serentak (window masuk sangat sempit), lalu
// beberapa detik kemudian semua sudah autosave +
// polling notifikasi. Ini menguji kapasitas PUNCAK KEDATANGAN (bukan rata-rata
// sepanjang ujian seperti ulangan_load.js).
//
// Prasyarat (staging):
//   ENV_FILE=.env.staging node loadtest/seed_loadtest.cjs
//   ENV_FILE=.env.staging node loadtest/seed_ulangan_loadtest.cjs seed
//
// Jalankan (remote Railway staging — hindari somaxconn lokal utk >=300 VU):
//   k6 run -e BASE_URL=https://<railway> loadtest/ulangan_masuk_serentak.js
//   Opsi: -e N=1500 -e LT_CLASSES=15 -e LT_PER_CLASS=100
//         -e ARRIVE_SEC=5     (semua VU harus sudah mulai dalam rentang ini)
//         -e WORK_SEC=60      (lama mengerjakan setelah semua masuk)
//         -e SAVE_MIN=2 -e SAVE_MAX=4 -e NOTIF_SEC=30
//
// Profil:
//   constant-vus N selama (ARRIVE_SEC + WORK_SEC + 20) dtk.
//   Semua VU langsung start begitu dijadwalkan → beban start_exam menumpuk
//   di detik-detik awal. Setelah semua masuk, tiap VU autosave + notif seperti
//   ulangan nyata (pergerakan siswa), lalu submit di akhir.
//
// Interpretasi (doktrin CLAUDE 25 Sep):
//   http_req_failed 2–4% via hotspot = artefak klien. Kebenaran sisi server
//   dibuktikan monitor_poll_ulangan.cjs yang jalan paralel.
// ============================================================
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const LT_CLASSES = parseInt(__ENV.LT_CLASSES || '15', 10)
const PER_CLASS = parseInt(__ENV.LT_PER_CLASS || '100', 10)
const N = parseInt(__ENV.N || String(LT_CLASSES * PER_CLASS), 10)
const ARRIVE_SEC = parseInt(__ENV.ARRIVE_SEC || '5', 10)
const WORK_SEC = parseInt(__ENV.WORK_SEC || '60', 10)
const SAVE_MIN = parseFloat(__ENV.SAVE_MIN || '2')
const SAVE_MAX = parseFloat(__ENV.SAVE_MAX || '4')
const NOTIF_SEC = parseInt(__ENV.NOTIF_SEC || '30', 10)
// ARRIVE_MODE=instan (default): semua VU mulai bersamaan (uji puncak).
// ARRIVE_MODE=ramp: masuk bertahap dalam RAMP_SEC (murid nyata berbondong).
const ARRIVE_MODE = __ENV.ARRIVE_MODE || 'instan'
const RAMP_SEC = parseInt(__ENV.RAMP_SEC || '120', 10)

function examIdForClass(i) {
    return '7e578900-0000-0000-0000-' + i.toString(16).padStart(12, '0')
}
const OPTION_LETTERS = ['A', 'B', 'C', 'D']

export const options = {
    scenarios: {
        masuk_serentak: ARRIVE_MODE === 'ramp'
            ? {
                executor: 'ramping-vus',
                startVUs: 0,
                stages: [
                    { duration: Math.floor(RAMP_SEC * 0.5) + 's', target: Math.floor(N / 2) },
                    { duration: Math.floor(RAMP_SEC * 0.5) + 's', target: N },
                    { duration: (WORK_SEC + 20) + 's', target: N },
                    { duration: '10s', target: 0 },
                ],
                gracefulRampDown: '30s',
            }
            : {
                executor: 'constant-vus',
                vus: N,
                duration: `${ARRIVE_SEC + WORK_SEC + 20}s`,
                gracefulStop: '30s',
            },
    },
    thresholds: {
        http_req_failed: ['rate<0.03'],
        'http_req_duration{name:start_exam}': ['p(95)<3000'],
        'http_req_duration{name:get_questions}': ['p(95)<3000'],
        'http_req_duration{name:save_answer}': ['p(95)<2000'],
        'http_req_duration{name:notifications}': ['p(95)<2500'],
    },
}

function pad(num, width) {
    let s = String(num)
    while (s.length < width) s = '0' + s
    return s
}
function randomIntBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}
function safeJson(res) {
    try { return res.json() } catch (e) { return null }
}
function params(token, name) {
    return { headers: { Cookie: 'session_token=' + token, 'Content-Type': 'application/json' }, tags: { name } }
}

export function handleSummary(data) {
    const reqs = data.metrics.http_reqs ? data.metrics.http_reqs.values : {}
    const dur = data.metrics.http_req_duration ? data.metrics.http_req_duration.values : {}
    const failed = data.metrics.http_req_failed ? data.metrics.http_req_failed.values : {}
    const c = data.metrics.checks ? data.metrics.checks.values : {}
    const text = `
===== RINGKASAN MASUK ULANGAN SERENTAK (${N} siswa) =====
total request : ${reqs.count || 0}
rate          : ${((reqs.rate || 0)).toFixed(1)} req/dtk
durasi p95    : ${(dur['p(95)'] || 0).toFixed(0)}ms | p99 ${(dur['p(99)'] || 0).toFixed(0)}ms | max ${(dur['max'] || 0).toFixed(0)}ms
http_req_failed: ${((failed.rate || 0) * 100).toFixed(2)}%
checks        : ${c.passes || 0}/${(c.passes || 0) + (c.fails || 0)}
=======================================================`
    return {
        stdout: text,
        '/tmp/k6-masuk-serentak-summary.json': JSON.stringify(data.metrics, null, 2),
    }
}

let submissionId = null
let startFinished = false
let questionIds = null
let submitted = false
let nextNotifMs = 0

export default function () {
    const userNum = ((__VU - 1) % N) + 1
    const token = 'lt_token_' + pad(userNum, 4)
    const classIdx = Math.floor((userNum - 1) / PER_CLASS) + 1
    const examId = examIdForClass(classIdx)

    // 1) START — detik-detik awal semua siswa klik "Mulai Ulangan"
    if (!submissionId && !startFinished) {
        const res = http.post(
            BASE_URL + '/api/exam-submissions',
            JSON.stringify({ exam_id: examId }),
            { ...params(token, 'start_exam'), responseCallback: http.expectedStatuses(200, 400) },
        )
        check(res, { 'start_exam: 200/400': (r) => r.status === 200 || r.status === 400 })
        if (res.status === 200) {
            const body = safeJson(res)
            if (body && body.id) submissionId = body.id
        } else if (res.status === 400) {
            startFinished = true
            submitted = true
        }
        return
    }

    // 2) SOAL — sekali per VU
    if (submissionId && !questionIds) {
        const res = http.get(BASE_URL + '/api/exams/' + examId + '/questions', params(token, 'get_questions'))
        check(res, { 'get_questions: 200': (r) => r.status === 200 })
        const body = safeJson(res)
        if (res.status === 200 && Array.isArray(body) && body.length > 0) {
            questionIds = body.map((q) => q.id).filter(Boolean)
        }
        return
    }

    // 3) Submit di akhir durasi kerja
    if (submissionId && !submitted && questionIds && __ITER > 0) {
        // kerja ± WORK_SEC: per iterasi ~SAVE (2-4 dtk) → kira-kira cukup; submit
        // ketika sudah cukup lama sejak soal dimuat.
        if (!startFinished) startFinished = true
        const answers = questionIds.slice(0, 25).map((qid, i) => ({
            question_id: qid, answer: i % 10 < 7 ? 'A' : 'B',
        }))
        const res = http.put(
            BASE_URL + '/api/exam-submissions',
            JSON.stringify({ submission_id: submissionId, submit: true, answers }),
            { ...params(token, 'submit'), responseCallback: http.expectedStatuses(200, 400) },
        )
        check(res, { 'submit: 200/400': (r) => r.status === 200 || r.status === 400 })
        submitted = true
        return
    }

    // 4) AUTOSAVE — pergerakan siswa nyata
    if (submissionId && !submitted && questionIds && questionIds.length > 0) {
        const qid = questionIds[randomIntBetween(0, questionIds.length - 1)]
        const answer = OPTION_LETTERS[randomIntBetween(0, OPTION_LETTERS.length - 1)]
        const res = http.put(
            BASE_URL + '/api/exam-submissions',
            JSON.stringify({ submission_id: submissionId, answers: [{ question_id: qid, answer }] }),
            params(token, 'save_answer'),
        )
        check(res, { 'save_answer: 200': (r) => r.status === 200 })
    }

    // 5) Polling notifikasi (dashboard siswa) — jitter
    if (Date.now() >= nextNotifMs) {
        const res = http.get(BASE_URL + '/api/notifications?limit=10', params(token, 'notifications'))
        check(res, { 'notifications: 200': (r) => r.status === 200 })
        const jitter = Math.round(NOTIF_SEC * 250)
        nextNotifMs = Date.now() + NOTIF_SEC * 1000 + randomIntBetween(-jitter, jitter)
    }

    sleep(randomIntBetween(SAVE_MIN, SAVE_MAX))
}
