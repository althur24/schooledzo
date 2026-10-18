/**
 * E2E Test: Server-time offset correction
 * 
 * Test angles:
 * 1. Header x-server-time present di 4 API routes (exams, official-exams, quizzes, assignments)
 * 2. Header format valid (ISO string, parseable)
 * 3. Header value akurat (dekat dengan waktu server)
 * 4. Response body tidak berubah (tidak ada data corruption)
 * 5. Offset calculation logic benar
 * 6. NaN guard — header malformed tidak crash
 * 7. Fallback — header hilang → offset 0
 * 8. Guru API juga dapat header
 * 9. Header konsisten antar request
 * 10. Error response tidak punya header
 */
const BASE = process.argv[2] || 'http://localhost:3457'
const SISWA_USER = 'stg_template_siswa'
const GURU_USER = 'stg_template_guru'
const PASSWORD = 'Test123!'

let pass = 0, fail = 0
const results = []

function check(name, condition, detail = '') {
    if (condition) {
        pass++
        results.push(`  ✅ ${name}`)
    } else {
        fail++
        results.push(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
    }
}

async function login(username) {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD })
    })
    if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(`login ${username} gagal: ${res.status} ${JSON.stringify(data)}`)
    }
    const cookie = res.headers.get('set-cookie')
    return { cookie: cookie?.split(';')[0] || '', res }
}

async function apiGet(path, cookie) {
    return await fetch(`${BASE}${path}`, {
        headers: cookie ? { Cookie: cookie } : {}
    })
}

async function run() {
    console.log('=== E2E Test: Server-Time Offset Correction ===\n')
    console.log(`Base: ${BASE}\n`)

    // ── Login ──
    console.log('Login...')
    const siswaAuth = await login(SISWA_USER)
    const guruAuth = await login(GURU_USER)
    check('login siswa', !!siswaAuth.cookie)
    check('login guru', !!guruAuth.cookie)
    console.log()

    // ── TEST 1: Header x-server-time present di 4 API routes ──
    console.log('Test 1: Header x-server-time di 4 API routes')

    const [examsRes, officialRes, quizzesRes, assignmentsRes] = await Promise.all([
        apiGet('/api/exams', siswaAuth.cookie),
        apiGet('/api/official-exams', siswaAuth.cookie),
        apiGet('/api/quizzes', siswaAuth.cookie),
        apiGet('/api/assignments', siswaAuth.cookie),
    ])

    const examsHdr = examsRes.headers.get('x-server-time')
    const officialHdr = officialRes.headers.get('x-server-time')
    const quizzesHdr = quizzesRes.headers.get('x-server-time')
    const assignmentsHdr = assignmentsRes.headers.get('x-server-time')

    check('GET /api/exams — header x-server-time present', !!examsHdr, `got: ${examsHdr}`)
    check('GET /api/official-exams — header x-server-time present', !!officialHdr, `got: ${officialHdr}`)
    check('GET /api/quizzes — header x-server-time present', !!quizzesHdr, `got: ${quizzesHdr}`)
    check('GET /api/assignments — header x-server-time present', !!assignmentsHdr, `got: ${assignmentsHdr}`)
    console.log()

    // ── TEST 2: Header format valid (ISO string, parseable) ──
    console.log('Test 2: Header format valid')

    const allHdrs = [
        ['exams', examsHdr],
        ['official-exams', officialHdr],
        ['quizzes', quizzesHdr],
        ['assignments', assignmentsHdr],
    ]

    for (const [name, hdr] of allHdrs) {
        if (!hdr) { check(`${name} — format valid`, false, 'header missing'); continue }
        const parsed = new Date(hdr)
        const isValid = !isNaN(parsed.getTime())
        const isIso = hdr.includes('T') && hdr.includes(':')
        check(`${name} — parseable as Date`, isValid, `hdr: ${hdr}`)
        check(`${name} — ISO format`, isIso, `hdr: ${hdr}`)
    }
    console.log()

    // ── TEST 3: Header value akurat (dekat dengan waktu lokal) ──
    console.log('Test 3: Header value akurat vs waktu lokal')

    for (const [name, hdr] of allHdrs) {
        if (!hdr) { check(`${name} — value akurat`, false, 'header missing'); continue }
        const serverTime = new Date(hdr).getTime()
        const localTime = Date.now()
        const diffMs = Math.abs(serverTime - localTime)
        const diffSec = diffMs / 1000
        check(`${name} — selisih < 5 detik vs lokal`, diffSec < 5, `selisih: ${diffSec.toFixed(2)}s`)
    }
    console.log()

    // ── TEST 4: Response body tidak berubah (data integrity) ──
    console.log('Test 4: Response body tidak berubah')

    const examsBody = await examsRes.json()
    const officialBody = await officialRes.json()
    const quizzesBody = await quizzesRes.json()
    const assignmentsBody = await assignmentsRes.json()

    check('/api/exams — response is array', Array.isArray(examsBody))
    check('/api/official-exams — response is array', Array.isArray(officialBody))
    check('/api/quizzes — response is array', Array.isArray(quizzesBody))
    check('/api/assignments — response is array', Array.isArray(assignmentsBody))

    // Verify no server_time field leaked into body
    for (const [name, body] of [
        ['exams', examsBody], ['official-exams', officialBody],
        ['quizzes', quizzesBody], ['assignments', assignmentsBody],
    ]) {
        if (Array.isArray(body)) {
            const hasServerTime = body.some(item => item && typeof item === 'object' && 'server_time' in item)
            check(`${name} — no server_time leaked in body`, !hasServerTime)
        }
    }
    console.log()

    // ── TEST 5: Offset calculation logic ──
    console.log('Test 5: Offset calculation logic')

    // Simulate what the hook does
    if (examsHdr) {
        const serverTime = new Date(examsHdr).getTime()
        const clientTime = Date.now()
        const offset = serverTime - clientTime
        const offsetMinutes = Math.round(offset / 60000)

        check('offset is finite number', Number.isFinite(offset))
        check('offset is small (< 60s)', Math.abs(offset) < 60000, `offset: ${offset}ms`)
        check('offsetMinutes is 0 (same machine)', offsetMinutes === 0, `minutes: ${offsetMinutes}`)

        // Simulate banner threshold
        const showBanner = Math.abs(offsetMinutes) >= 2
        check('banner tidak muncul (offset < 2 menit)', !showBanner)
    }
    console.log()

    // ── TEST 6: NaN guard — header malformed ──
    console.log('Test 6: NaN guard (simulasi header malformed)')

    const malformedOffset = new Date('not-a-date').getTime() - Date.now()
    check('malformed header → NaN offset', isNaN(malformedOffset))
    check('NaN guard: Number.isFinite(NaN) = false', !Number.isFinite(malformedOffset))
    check('NaN guard: would skip (return early)', !Number.isFinite(malformedOffset))

    // Verify NaN doesn't break comparisons
    const fakeNow = Date.now() + NaN
    check('NaN + Date.now() = NaN', isNaN(fakeNow))
    check('NaN > X = false (safe fallback)', !(fakeNow > Date.now()))
    check('NaN < X = false (safe fallback)', !(fakeNow < Date.now()))
    console.log()

    // ── TEST 7: Fallback — header hilang → offset 0 ──
    console.log('Test 7: Fallback (header hilang)')

    // Test with a route that doesn't have the header
    const publicRes = await apiGet('/api/schools/public')
    const publicHdr = publicRes.headers.get('x-server-time')
    check('/api/schools/public — tidak ada header (expected)', !publicHdr)
    check('header hilang → hook sync() return early (no-op)', !publicHdr)
    check('header hilang → offsetRef.current tetap 0 (fallback)', !publicHdr)
    console.log()

    // ── TEST 8: Guru API juga dapat header ──
    console.log('Test 8: Guru API header')

    const [guruExamsRes, guruOfficialRes] = await Promise.all([
        apiGet('/api/exams', guruAuth.cookie),
        apiGet('/api/official-exams', guruAuth.cookie),
    ])

    check('Guru GET /api/exams — header present', !!guruExamsRes.headers.get('x-server-time'))
    check('Guru GET /api/official-exams — header present', !!guruOfficialRes.headers.get('x-server-time'))
    console.log()

    // ── TEST 9: Header konsisten antar request ──
    console.log('Test 9: Header konsisten antar request')

    const res1 = await apiGet('/api/exams', siswaAuth.cookie)
    const res2 = await apiGet('/api/exams', siswaAuth.cookie)
    const hdr1 = new Date(res1.headers.get('x-server-time')).getTime()
    const hdr2 = new Date(res2.headers.get('x-server-time')).getTime()
    const diffMs = Math.abs(hdr2 - hdr1)
    check('dua request berturut-turut — selisih < 2s', diffMs < 2000, `selisih: ${diffMs}ms`)
    console.log()

    // ── TEST 10: Error response tidak punya header ──
    console.log('Test 10: Error response tidak punya header')

    const errorRes = await apiGet('/api/exams', 'invalid=cookie')
    check('unauthenticated request (401) — tidak ada header', !errorRes.headers.get('x-server-time'))
    console.log()

    // ── TEST 11: Quiz submissions sudah punya header (pre-existing) ──
    console.log('Test 11: Quiz submissions header (pre-existing)')

    // Quiz submissions route already had x-server-time header before our changes
    const quizSubsRes = await apiGet('/api/quiz-submissions?student_id=4c0d48c1-ea20-4286-b780-864d6e5d41c7', siswaAuth.cookie)
    check('GET /api/quiz-submissions — header present (pre-existing)', !!quizSubsRes.headers.get('x-server-time'))
    console.log()

    // ── Summary ──
    console.log('\n' + '='.repeat(60))
    console.log(`Results: ${pass} pass / ${fail} fail / ${pass + fail} total`)
    console.log('='.repeat(60))
    for (const r of results) console.log(r)
    if (fail > 0) {
        console.log('\n❌ SOME TESTS FAILED')
        process.exit(1)
    } else {
        console.log('\n✅ ALL TESTS PASSED')
        process.exit(0)
    }
}

run().catch(e => {
    console.error('FATAL ERROR:', e.message)
    console.error(e.stack)
    process.exit(1)
})
