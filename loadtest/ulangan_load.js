// ============================================================
// LOAD TEST k6 — ULANGAN SERENTAK 1000 SISWA (mode exam_submissions)
// ============================================================
// Reproduksi volume insiden 29 Sep 2026: siswa mengerjakan ULANGAN
// (bukan UTS/UAS) dengan autosave berkelanjutan — target ±147.000
// request API dalam satu run (≈ volume request pagi insiden).
//
// Prasyarat:
//   1. ENV_FILE=.env.staging node loadtest/seed_loadtest.cjs        (1000 siswa + token lt_token_NNNN)
//   2. ENV_FILE=.env.staging node loadtest/seed_ulangan_loadtest.cjs (guru + 10 exam batch × 50 soal)
//   3. k6 v0.46+
//
// Jalankan (remote Railway staging — bebas limit somaxconn lokal):
//   k6 run -e BASE_URL=https://<railway-staging> loadtest/ulangan_load.js
//   Opsi: -e EXAM_MIN/EXAM_MAX=menit (rentang lama pengerjaan per VU, submit menyebar)
//         -e PEAK=1000  -e HOLD_MIN=13
//         -e SAVE_MIN=2 -e SAVE_MAX=4 -e NOTIF_SEC=30  → 2× BEBAN (±294rb request)
//
// PROVIL DEFAULT (volume ±147rb):
//   ramp 2m→500 → 3m→1000 → HOLD 13m@1000 → turun 1m  (total 19 mnt)
//   per siswa: start(1) + soal(1) + autosave tiap 5–9 dtk (≈8,6/mnt)
//              + notif tiap 60±25% dtk (≈1/mnt) + submit(1, di menit 15–19)
//   ≈ 9,6 req/siswa/mnt × 1000 siswa × ~15 mnt efektif ≈ 147.000 request
// PROFIL 2× BEBAN (±294rb, infra staging di-upgrade setara produksi):
//   -e SAVE_MIN=2 -e SAVE_MAX=4 -e NOTIF_SEC=30
//   → autosave tiap 2–4 dtk (≈17/mnt) + notif tiap 30 dtk (≈2/mnt)
//   ≈ 19,5 req/siswa/mnt × 1000 × ~15 mnt ≈ 294.000 request, puncak ±330 req/dtk
//
// CATATAN interpretasi (doktrin CLAUDE.md 25 Sep):
//   http_req_failed 2–4% dari laptop via hotspot = artefak KLIEN (NAT),
//   BUKAN server. Kebenaran sisi server dibuktikan monitor_poll_ulangan.cjs
//   yang jalan paralel (guru polling monitor live tiap 15 dtk).
// ============================================================
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const PEAK = parseInt(__ENV.PEAK || '1000', 10)
const HOLD_MIN = parseInt(__ENV.HOLD_MIN || '13', 10)
const EXAM_MIN = parseInt(__ENV.EXAM_MIN || '15', 10) // rentang menit pengerjaan
const EXAM_MAX = parseInt(__ENV.EXAM_MAX || '19', 10) // → gelombang submit natural
// Intensitas autosave/poll — knob beban:
//   default:  save 5–9 dtk + notif 60 dtk  ≈ ±147rb request
//   2× beban: -e SAVE_MIN=2 -e SAVE_MAX=4 -e NOTIF_SEC=30 ≈ ±294rb request
const SAVE_MIN = parseFloat(__ENV.SAVE_MIN || '5')
const SAVE_MAX = parseFloat(__ENV.SAVE_MAX || '9')
const NOTIF_SEC = parseInt(__ENV.NOTIF_SEC || '60', 10)

// Exam batch member (seed_ulangan_loadtest.cjs): 10 kelas × 100 siswa
function examIdForClass(i) {
    return '7e578900-0000-0000-0000-' + i.toString(16).padStart(12, '0')
}
const TOTAL_USERS = 1000
const OPTION_LETTERS = ['A', 'B', 'C', 'D']

export const options = {
    scenarios: {
        ulangan: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '2m', target: Math.floor(PEAK / 2) },
                { duration: '3m', target: PEAK },
                { duration: HOLD_MIN + 'm', target: PEAK },
                { duration: '1m', target: 0 },
            ],
            gracefulRampDown: '30s',
        },
    },
    thresholds: {
        // hotspot: 2-4% bisa artefak klien — cek monitor paralel sebelum menyimpulkan
        http_req_failed: ['rate<0.02'],
        'http_req_duration{name:save_answer}': ['p(95)<1500'],
        'http_req_duration{name:notifications}': ['p(95)<2000'],
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
function reqParams(token, name) {
    return { headers: { Cookie: 'session_token=' + token, 'Content-Type': 'application/json' }, tags: { name } }
}

export function setup() {
    return { baseUrl: BASE_URL }
}

// Ringkasan volume — dibuktikan di stdout + file
export function handleSummary(data) {
    const reqs = data.metrics.http_reqs ? data.metrics.http_reqs.values : {}
    const dur = data.metrics.http_req_duration ? data.metrics.http_req_duration.values : {}
    const failed = data.metrics.http_req_failed ? data.metrics.http_req_failed.values : {}
    const text = `
===== RINGKASAN ULANGAN LOAD =====
total request : ${reqs.count || 0}  (target ±147.000)
rate          : ${((reqs.rate || 0)).toFixed(1)} req/dtk
duration p95  : ${(dur['p(95)'] || 0).toFixed(0)}ms | p99 ${(dur['p(99)'] || 0).toFixed(0)}ms
http_req_failed: ${((failed.rate || 0) * 100).toFixed(2)}% (cek monitor paralel utk kebenaran server)
checks passed : ${data.metrics.checks ? (data.metrics.checks.values.passes || 0) + '/' + ((data.metrics.checks.values.passes || 0) + (data.metrics.checks.values.fails || 0)) : '-'}
==================================`
    return {
        stdout: text,
        '/tmp/k6-ulangan-summary.json': JSON.stringify(data.metrics, null, 2),
    }
}

// ---- state per VU ----
let submissionId = null
let startFinished = false
let questionIds = null
let submitted = false
let examStartMs = 0
let workMs = 0        // lama pengerjaan VU ini (acak → gelombang submit natural)
let nextNotifMs = 0

export default function () {
    const userNum = ((__VU - 1) % TOTAL_USERS) + 1
    const token = 'lt_token_' + pad(userNum, 4)
    const classIdx = Math.floor((userNum - 1) / 100) + 1
    const examId = examIdForClass(classIdx)

    // 1) Mulai / resume ulangan — sekali per VU
    if (!submissionId && !startFinished) {
        const res = http.post(
            BASE_URL + '/api/exam-submissions',
            JSON.stringify({ exam_id: examId }),
            {
                headers: reqParams(token, 'start_exam').headers,
                tags: { name: 'start_exam' },
                // 400 = sudah submit / window habis (idempotensi re-run)
                responseCallback: http.expectedStatuses(200, 400),
            },
        )
        check(res, { 'start_exam: 200/400': (r) => r.status === 200 || r.status === 400 })
        if (res.status === 200) {
            const body = safeJson(res)
            if (body && body.id) {
                submissionId = body.id
                examStartMs = Date.now()
                workMs = randomIntBetween(EXAM_MIN, EXAM_MAX) * 60 * 1000
            }
        } else if (res.status === 400) {
            startFinished = true
            submitted = true
        }
        sleep(randomIntBetween(2, 5))
        return
    }

    // 2) Daftar soal — sekali per VU (id generik dari seed → wajib parse, tak ada fallback)
    if (submissionId && !questionIds) {
        const res = http.get(BASE_URL + '/api/exams/' + examId + '/questions', reqParams(token, 'get_questions'))
        check(res, { 'get_questions: 200': (r) => r.status === 200 })
        const body = safeJson(res)
        if (res.status === 200 && Array.isArray(body) && body.length > 0) {
            questionIds = body.map((q) => q.id).filter(Boolean)
        }
        return
    }

    // 3) Submit final — setelah lama pengerjaan VU (menyebar, gelombang natural)
    if (submissionId && !submitted && questionIds && Date.now() - examStartMs >= workMs) {
        const answers = questionIds.slice(0, 25).map((qid, i) => ({
            question_id: qid, answer: i % 10 < 7 ? 'A' : 'B', // ~70% benar
        }))
        const res = http.put(
            BASE_URL + '/api/exam-submissions',
            JSON.stringify({ submission_id: submissionId, submit: true, answers }),
            {
                headers: reqParams(token, 'submit').headers,
                tags: { name: 'submit' },
                responseCallback: http.expectedStatuses(200, 400),
            },
        )
        check(res, { 'submit: 200/400': (r) => r.status === 200 || r.status === 400 })
        submitted = true
        return
    }

    // 4) AUTOSAVE — 1 jawaban acak per iterasi (jalur dominan insiden)
    if (submissionId && !submitted && questionIds && questionIds.length > 0) {
        const qid = questionIds[randomIntBetween(0, questionIds.length - 1)]
        const answer = OPTION_LETTERS[randomIntBetween(0, OPTION_LETTERS.length - 1)]
        const res = http.put(
            BASE_URL + '/api/exam-submissions',
            JSON.stringify({ submission_id: submissionId, answers: [{ question_id: qid, answer }] }),
            reqParams(token, 'save_answer'),
        )
        check(res, { 'save_answer: 200': (r) => r.status === 200 })
    }

    // 5) Polling notifikasi (dashboard siswa) — jitter anti-lockstep
    if (Date.now() >= nextNotifMs) {
        const res = http.get(BASE_URL + '/api/notifications?limit=10', reqParams(token, 'notifications'))
        check(res, { 'notifications: 200': (r) => r.status === 200 })
        const jitter = Math.round(NOTIF_SEC * 250) // ±25%
        nextNotifMs = Date.now() + NOTIF_SEC * 1000 + randomIntBetween(-jitter, jitter)
    }

    // 6) Jeda siswa — knob beban: default 5–9 dtk (±147rb); 2–4 dtk = 2× beban (±294rb)
    sleep(randomIntBetween(SAVE_MIN, SAVE_MAX))
}
