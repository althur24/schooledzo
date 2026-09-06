// ============================================================
// LOAD TEST k6 — Simulasi 1000 siswa mengerjakan Try Out (TO)
// ============================================================
// Prasyarat: jalankan dulu loadtest/seed_loadtest.sql di Supabase
// SQL Editor (membuat 1000 user + sesi lt_token_0001..1000 +
// ujian LOADTEST-TO dengan UUID tetap di bawah).
//
// Install k6:
//   macOS : brew install k6
//   Docker: docker run --rm -i grafana/k6 run - < loadtest/tryout.js
//
// Jalankan:
//   k6 run loadtest/tryout.js                                  (default: http://localhost:3000)
//   k6 run -e BASE_URL=https://app-kamu loadtest/tryout.js
//   k6 run -e BASE_URL=... -e SUBMIT=0 loadtest/tryout.js      (tanpa submit akhir)
//   k6 run -e EXAM_SECONDS=600 loadtest/tryout.js              (atur lama pengerjaan per VU)
//
// Perlu k6 v0.46+ (memakai responseCallback per-request).
//
// ⚠️ PERINGATAN:
//   - Jalankan di luar jam sibuk (off-peak).
//   - Window ujian dummy = start_time + 120 menit sejak seed;
//     lihat catatan di seed_loadtest.sql kalau perlu digeser.
//   - Setelah selesai, jalankan loadtest/cleanup_loadtest.sql.
// ============================================================
import http from 'k6/http'
import { check, sleep } from 'k6'

// ------------------------------------------------------------
// KONFIGURASI
// ------------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

// UUID tetap dari seed_loadtest.sql (ujian LOADTEST-TO)
const EXAM_ID = '7e575000-0000-0000-0000-000000000001'

// Submit akhir aktif secara default; matikan dengan -e SUBMIT=0
const SUBMIT = __ENV.SUBMIT !== '0'

// Lama pengerjaan per VU sebelum submit (detik). Default 8 menit
// supaya semua VU sempat submit di dalam fase hold 10 menit.
const EXAM_SECONDS = parseInt(__ENV.EXAM_SECONDS || '480', 10)

const TOTAL_USERS = 1000
const OPTION_LETTERS = ['A', 'B', 'C', 'D']

// Fallback: 50 UUID soal deterministik dari seed (dipakai hanya
// jika parsing response GET questions gagal)
const FALLBACK_QUESTION_IDS = []
for (let q = 1; q <= 50; q++) {
    let hex = q.toString(16)
    while (hex.length < 12) hex = '0' + hex
    FALLBACK_QUESTION_IDS.push('7e576000-0000-0000-0000-' + hex)
}

// Mode cepat (staging / CI): k6 run -e FAST=1 ... — ramp & hold dipersingkat
// (total ±9 mnt, puncak 1000 VU tetap tercapai). Default: profil lengkap 22 mnt.
const FAST = __ENV.FAST === '1'

export const options = {
    scenarios: {
        tryout: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: FAST
                ? [
                    { duration: '1m', target: 500 },   // naik cepat
                    { duration: '2m', target: 1000 },  // puncak 1000 siswa
                    { duration: '5m', target: 1000 },  // hold 1000 siswa
                    { duration: '1m', target: 0 },     // turun
                ]
                : [
                    { duration: '3m', target: 250 },   // pemanasan
                    { duration: '4m', target: 750 },   // naik bertahap
                    { duration: '3m', target: 1000 },  // menuju puncak
                    { duration: '10m', target: 1000 }, // hold 1000 siswa
                    // ^ untuk simulasi penuh 30 menit: ubah jadi '30m'
                    //   dan sesuaikan EXAM_SECONDS
                    { duration: '2m', target: 0 },     // turun
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

// ------------------------------------------------------------
// HELPER
// ------------------------------------------------------------
function pad(num, width) {
    let s = String(num)
    while (s.length < width) s = '0' + s
    return s
}

function randomIntBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function safeJson(res) {
    try {
        return res.json()
    } catch (e) {
        return null
    }
}

function reqParams(token, name) {
    return {
        headers: {
            Cookie: 'session_token=' + token,
            'Content-Type': 'application/json',
        },
        tags: { name: name },
    }
}

// ------------------------------------------------------------
// SETUP — tidak ada login di sini. Login API punya rate limit
// 100/menit, jadi 1000 sesi sudah dibuat pre-made oleh seed SQL
// dengan token deterministik lt_token_NNNN.
// ------------------------------------------------------------
export function setup() {
    return { baseUrl: BASE_URL, examId: EXAM_ID }
}

export function teardown(data) {
    console.log('Load test selesai terhadap ' + data.baseUrl)
    console.log('Jangan lupa bersihkan data dummy: loadtest/cleanup_loadtest.sql')
}

// ------------------------------------------------------------
// STATE PER VU (persisten antar iterasi dalam satu VU)
// ------------------------------------------------------------
let submissionId = null   // id submission milik VU ini
let startFinished = false // true bila ujian sudah pernah disubmit / tak bisa mulai
let questionIds = null    // cache daftar id soal
let submitted = false     // sudah submit final
let examStartMs = 0       // kapan VU ini mulai (untuk timing submit)
let lastNotifMs = 0       // terakhir polling notifikasi

// ------------------------------------------------------------
// ALUR UTAMA PER VU — meniru siswa mengerjakan TO
// ------------------------------------------------------------
export default function () {
    // VU id → siswa ke-N (1..1000, berputar bila VU > 1000)
    const userNum = ((__VU - 1) % TOTAL_USERS) + 1
    const token = 'lt_token_' + pad(userNum, 4)

    // 1) Mulai / resume ujian — SEKALI per VU
    if (!submissionId && !startFinished) {
        const res = http.post(
            BASE_URL + '/api/official-exam-submissions',
            JSON.stringify({ exam_id: EXAM_ID }),
            {
                headers: reqParams(token, 'start_exam').headers,
                tags: { name: 'start_exam' },
                // 400 = sudah pernah submit / window habis → ditoleransi
                // (idempotensi re-run), bukan kegagalan server
                responseCallback: http.expectedStatuses(200, 400),
            }
        )

        check(res, {
            'start_exam: 200 (mulai/resume) atau 400 (sudah submit)': (r) =>
                r.status === 200 || r.status === 400,
        })

        if (res.status === 200) {
            const body = safeJson(res)
            if (body && body.id) {
                submissionId = body.id
                examStartMs = Date.now()
            }
        } else if (res.status === 400) {
            // Sudah submit (data lama) atau window ujian habis:
            // VU ini tidak bisa ujian lagi → hanya polling ringan.
            startFinished = true
            submitted = true
        }
        // 5xx/timeout: submissionId tetap null → iterasi berikutnya retry

        sleep(randomIntBetween(2, 5))
        return
    }

    // 2) Ambil daftar soal — SEKALI per VU
    if (submissionId && !questionIds) {
        const res = http.get(
            BASE_URL + '/api/official-exams/' + EXAM_ID + '/questions',
            reqParams(token, 'get_questions')
        )

        check(res, {
            'get_questions: status 200': (r) => r.status === 200,
        })

        // Response = array soal (correct_answer sudah di-strip server)
        let parsed = null
        const body = safeJson(res)
        if (res.status === 200 && Array.isArray(body) && body.length > 0) {
            parsed = body.map((q) => q.id).filter(Boolean)
        }
        questionIds = parsed && parsed.length > 0 ? parsed : FALLBACK_QUESTION_IDS
        return
    }

    // 3) Submit final di akhir waktu pengerjaan VU ini
    if (
        SUBMIT &&
        submissionId &&
        !submitted &&
        Date.now() - examStartMs >= EXAM_SECONDS * 1000
    ) {
        const res = http.put(
            BASE_URL + '/api/official-exam-submissions',
            JSON.stringify({ submission_id: submissionId, submit: true }),
            {
                headers: reqParams(token, 'submit').headers,
                tags: { name: 'submit' },
                // 400 = sudah submit (mis. auto-submit server) → toleransi
                responseCallback: http.expectedStatuses(200, 400),
            }
        )

        check(res, {
            'submit: 200 (terkirim) atau 400 (sudah submit)': (r) =>
                r.status === 200 || r.status === 400,
        })
        submitted = true
    }

    // 4) Autosave: satu jawaban acak per iterasi (seperti siswa asli)
    if (submissionId && !submitted && questionIds && questionIds.length > 0) {
        const qid = questionIds[randomIntBetween(0, questionIds.length - 1)]
        const answer = OPTION_LETTERS[randomIntBetween(0, OPTION_LETTERS.length - 1)]

        const res = http.put(
            BASE_URL + '/api/official-exam-submissions',
            JSON.stringify({
                submission_id: submissionId,
                answers: [{ question_id: qid, answer: answer }],
            }),
            reqParams(token, 'save_answer')
        )

        check(res, {
            'save_answer: status 200': (r) => r.status === 200,
        })
    }

    // 5) Polling notifikasi tiap ±60 detik (meniru dashboard siswa)
    if (Date.now() - lastNotifMs >= 60000) {
        const res = http.get(
            BASE_URL + '/api/notifications?limit=10',
            reqParams(token, 'notifications')
        )

        check(res, {
            'notifications: status 200': (r) => r.status === 200,
        })
        lastNotifMs = Date.now()
    }

    // 6) Jeda ala siswa: 15–30 detik antar aksi
    sleep(randomIntBetween(15, 30))
}
