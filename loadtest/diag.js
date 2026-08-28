// Diagnostik kapasitas — steady-state pada N VU (env VUS, default 400).
// Perilaku per VU identik dengan tryout.js (start 1x, autosave 15-30s,
// notifikasi 60s), TANPA submit akhir — fokus mengukur steady-state.
// Jalankan: k6 run -e BASE_URL=... -e VUS=400 loadtest/diag.js
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const EXAM_ID = '7e575000-0000-0000-0000-000000000001'
const VUS = parseInt(__ENV.VUS || '400', 10)
const TOTAL_USERS = 1000
const OPTION_LETTERS = ['A', 'B', 'C', 'D']

export const options = {
    scenarios: {
        diag: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '1m', target: VUS },
                { duration: '5m', target: VUS },
                { duration: '30s', target: 0 },
            ],
            gracefulRampDown: '30s',
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.01'],
        'http_req_duration{name:save_answer}': ['p(95)<800'],
        'http_req_duration{name:notifications}': ['p(95)<300'],
    },
}

const FALLBACK_QUESTION_IDS = []
for (let q = 1; q <= 50; q++) {
    let hex = q.toString(16)
    while (hex.length < 12) hex = '0' + hex
    FALLBACK_QUESTION_IDS.push('7e576000-0000-0000-0000-' + hex)
}

function pad(num, width) { let s = String(num); while (s.length < width) s = '0' + s; return s }
function randomIntBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function safeJson(res) { try { return res.json() } catch (e) { return null } }
function reqParams(token, name) {
    return { headers: { Cookie: 'session_token=' + token, 'Content-Type': 'application/json' }, tags: { name: name } }
}

let submissionId = null
let startFinished = false
let questionIds = null
let lastNotifMs = 0

export default function () {
    const userNum = ((__VU - 1) % TOTAL_USERS) + 1
    const token = 'lt_token_' + pad(userNum, 4)

    if (!submissionId && !startFinished) {
        const res = http.post(BASE_URL + '/api/official-exam-submissions',
            JSON.stringify({ exam_id: EXAM_ID }),
            { headers: reqParams(token, 'start_exam').headers, tags: { name: 'start_exam' }, responseCallback: http.expectedStatuses(200, 400) })
        check(res, { 'start_exam ok': (r) => r.status === 200 || r.status === 400 })
        if (res.status === 200) { const b = safeJson(res); if (b && b.id) submissionId = b.id }
        else if (res.status === 400) { startFinished = true }
        sleep(randomIntBetween(2, 5))
        return
    }

    if (submissionId && !questionIds) {
        const res = http.get(BASE_URL + '/api/official-exams/' + EXAM_ID + '/questions', reqParams(token, 'get_questions'))
        check(res, { 'get_questions 200': (r) => r.status === 200 })
        const body = safeJson(res)
        let parsed = null
        if (res.status === 200 && Array.isArray(body) && body.length > 0) parsed = body.map((q) => q.id).filter(Boolean)
        questionIds = parsed && parsed.length > 0 ? parsed : FALLBACK_QUESTION_IDS
        return
    }

    if (submissionId && questionIds && questionIds.length > 0) {
        const qid = questionIds[randomIntBetween(0, questionIds.length - 1)]
        const res = http.put(BASE_URL + '/api/official-exam-submissions',
            JSON.stringify({ submission_id: submissionId, answers: [{ question_id: qid, answer: OPTION_LETTERS[randomIntBetween(0, 3)] }] }),
            reqParams(token, 'save_answer'))
        check(res, { 'save_answer 200': (r) => r.status === 200 })
    }

    if (Date.now() - lastNotifMs >= 60000) {
        const res = http.get(BASE_URL + '/api/notifications?limit=10', reqParams(token, 'notifications'))
        check(res, { 'notifications 200': (r) => r.status === 200 })
        lastNotifMs = Date.now()
    }

    sleep(randomIntBetween(15, 30))
}
